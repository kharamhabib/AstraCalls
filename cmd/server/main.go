package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// envInt lê um inteiro de uma variável de ambiente (com valor padrão).
func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// envStr lê uma string de uma variável de ambiente (com valor padrão).
func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	// Storage: Postgres (1 banco por sessão, estilo WAHA). URL de manutenção em
	// WACALLS_PG_URL (ex.: postgres://user:pass@host:5432/postgres?sslmode=disable);
	// o usuário precisa de permissão CREATE DATABASE. WACALLS_PG_NAMESPACE = prefixo
	// dos bancos (default "wacalls" -> wacalls_main + wacalls_<id>).
	pgURL := flag.String("pg-url", os.Getenv("WACALLS_PG_URL"), "Postgres maintenance URL")
	pgNS := flag.String("pg-namespace", envStr("WACALLS_PG_NAMESPACE", "wacalls"), "prefix for per-session databases")
	staticDir := flag.String("static", "client/dist", "static client directory (optional)")
	debug := flag.Bool("debug", false, "verbose logging")
	// Padrão vem da env WACALLS_MAX_CALLS (fácil de editar na stack do Portainer);
	// a flag -max-calls-per-session ainda sobrescreve se passada.
	maxCalls := flag.Int("max-calls-per-session", envInt("WACALLS_MAX_CALLS", 8), "max concurrent calls per session (0 = unlimited)")
	flag.Parse()

	level := slog.LevelInfo
	if *debug {
		level = slog.LevelDebug
	}
	// WACALLS_LOG_LEVEL (debug|info|warn|error) tem precedência sobre a flag.
	switch strings.ToLower(envStr("WACALLS_LOG_LEVEL", "")) {
	case "debug":
		level = slog.LevelDebug
	case "info":
		level = slog.LevelInfo
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv, err := newServer(ctx, *pgURL, *pgNS, *staticDir, *maxCalls, log)
	if err != nil {
		log.Error("startup failed", "err", err)
		os.Exit(1)
	}
	defer srv.sessions.disconnectAll()
	defer srv.Close()

	if err := srv.sessions.Restore(ctx); err != nil {
		log.Error("session restore failed", "err", err)
		os.Exit(1)
	}

	// Hidrata o histórico de chamadas em memória a partir do Postgres
	// (summaries e chamados sobrevivem a restarts).
	srv.hydrateHistory(ctx)

	// Recalcula o total de agendamentos ativos ao iniciar
	srv.scheduler.RecalculateActiveCount()

	// Inicia o scheduler de IA server-side em background
	go srv.scheduler.Run(ctx)

	httpSrv := &http.Server{
		Addr:    *addr,
		Handler: srv.routes(),
		// Timeouts de leitura protegem contra Slowloris. WriteTimeout fica 0
		// porque o SSE (/api/events) é uma resposta de longa duração.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Info("HTTP server listening", "addr", *addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server error", "err", err)
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	// Para o scheduler e desacopla os agentes IA (fecha sessões Gemini Live).
	srv.scheduler.Stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
