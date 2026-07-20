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

// envStr lê uma string de uma variável de ambiente primária (KALLIA_*) ou fallback (WACALLS_*).
func envStr(key, fallbackKey, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	if fallbackKey != "" {
		if v := os.Getenv(fallbackKey); v != "" {
			return v
		}
	}
	return def
}

// envInt lê um inteiro de uma variável de ambiente primária (KALLIA_*) ou fallback (WACALLS_*).
func envInt(key, fallbackKey string, def int) int {
	vStr := envStr(key, fallbackKey, "")
	if vStr != "" {
		if n, err := strconv.Atoi(vStr); err == nil {
			return n
		}
	}
	return def
}

func loadDotEnv() {
	if os.Getenv("KALLIA_PG_URL") != "" || os.Getenv("WACALLS_PG_URL") != "" {
		return
	}
	paths := []string{".env", "../.env", "../../.env"}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				val := strings.TrimSpace(parts[1])
				val = strings.Trim(val, `"'`)
				if os.Getenv(key) == "" {
					os.Setenv(key, val)
				}
			}
		}
		break
	}
}

func main() {
	loadDotEnv()
	initJWTSecret()
	addr := flag.String("addr", ":8080", "HTTP listen address")
	// Storage: Postgres (1 banco por sessão). URL de manutenção em KALLIA_PG_URL
	pgURL := flag.String("pg-url", envStr("KALLIA_PG_URL", "WACALLS_PG_URL", ""), "Postgres maintenance URL")
	pgNS := flag.String("pg-namespace", envStr("KALLIA_PG_NAMESPACE", "WACALLS_PG_NAMESPACE", "kallia"), "prefix for per-session databases")
	staticDir := flag.String("static", "client/dist", "static client directory (optional)")
	debug := flag.Bool("debug", false, "verbose logging")
	maxCalls := flag.Int("max-calls-per-session", envInt("KALLIA_MAX_CALLS", "WACALLS_MAX_CALLS", 8), "max concurrent calls per session (0 = unlimited)")
	flag.Parse()

	level := slog.LevelInfo
	if *debug {
		level = slog.LevelDebug
	}
	switch strings.ToLower(envStr("KALLIA_LOG_LEVEL", "WACALLS_LOG_LEVEL", "")) {
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
