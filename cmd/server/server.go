package main

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

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
	tickets   *ticketStore
	startedAt time.Time
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
	broker.History = &pgHistoryPersister{store: store, log: log}
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
		tickets:   newTicketStore(),
		startedAt: time.Now(),
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

// hydrateHistory carrega o histórico de chamadas persistido no Postgres para o
// cache em memória do broker (chamado uma vez no boot, após o Restore).
func (s *server) hydrateHistory(ctx context.Context) {
	loaded := 0
	for _, info := range s.sessions.infos() {
		recs, err := s.sessions.store.listCallHistory(ctx, info.ID, 100)
		if err != nil {
			s.log.Warn("falha ao hidratar histórico de chamadas", "session", info.ID, "err", err)
			continue
		}
		if len(recs) > 0 {
			s.broker.loadHistory(recs)
			loaded += len(recs)
		}
	}
	if loaded > 0 {
		s.log.Info("histórico de chamadas hidratado a partir do Postgres", "records", loaded)
	}
}
