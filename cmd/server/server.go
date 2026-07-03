package main

import (
	"context"
	"database/sql"
	"log/slog"

	waLog "go.mau.fi/whatsmeow/util/log"
)

type server struct {
	db        *dbProvider
	mainDB    *sql.DB
	broker    *Broker
	sessions  *SessionManager
	scheduler *AIScheduler
	log       *slog.Logger
	staticDir string
}

// newServer monta o provedor de banco (Postgres, 1 banco por sessão no estilo
// WAHA), abre o banco principal e inicializa o gerenciador de sessões.
func newServer(ctx context.Context, pgURL, pgNamespace, staticDir string, maxCalls int, log *slog.Logger) (*server, error) {
	waLogger := waLog.Noop
	if log.Enabled(ctx, slog.LevelDebug) {
		waLogger = waLog.Stdout("WA", "DEBUG", true)
	}

	provider, err := newDBProvider(ctx, pgURL, pgNamespace, waLogger, log)
	if err != nil {
		return nil, err
	}

	mainDB, err := provider.openMainDB(ctx)
	if err != nil {
		provider.close()
		return nil, err
	}
	store, err := newSessionStore(ctx, mainDB)
	if err != nil {
		mainDB.Close()
		provider.close()
		return nil, err
	}

	broker := NewBroker()
	mgr := newSessionManager(ctx, provider, broker, store, waLogger, log, maxCalls)
	broker.SnapshotFn = mgr.snapshotEvents
	scheduler := NewAIScheduler(mgr, log)
	mgr.Scheduler = scheduler

	return &server{
		db:        provider,
		mainDB:    mainDB,
		broker:    broker,
		sessions:  mgr,
		scheduler: scheduler,
		log:       log,
		staticDir: staticDir,
	}, nil
}

func (s *server) Close() {
	if s.mainDB != nil {
		_ = s.mainDB.Close()
	}
	if s.db != nil {
		s.db.close()
	}
}
