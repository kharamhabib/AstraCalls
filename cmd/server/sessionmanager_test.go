package main

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"go.mau.fi/whatsmeow"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func newTestManager(t *testing.T) *SessionManager {
	t.Helper()
	pgURL := os.Getenv("WACALLS_PG_URL")
	if pgURL == "" {
		t.Skip("WACALLS_PG_URL environment variable is not set, skipping test")
		return nil
	}
	ctx := context.Background()
	db, err := newDBProvider(ctx, pgURL, "wacalls_test", waLog.Noop, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.close()
	})

	mainDB, err := db.openMainDB(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { mainDB.Close() })

	store, err := newSessionStore(ctx, mainDB)
	if err != nil {
		t.Fatal(err)
	}
	return newSessionManager(ctx, db, NewBroker(), store, waLog.Noop, slog.Default(), 0)
}

func (m *SessionManager) addUnconnected(t *testing.T, name string) *Session {
	t.Helper()
	id := newSessionID()
	if err := m.store.insert(m.appCtx, id, name); err != nil {
		t.Fatal(err)
	}
	container, db, err := m.db.openSessionContainer(m.appCtx, id)
	if err != nil {
		t.Fatal(err)
	}
	client := whatsmeow.NewClient(container.NewDevice(), waLog.Noop)
	s := newSession(m, id, name, client)
	s.waContainer = container
	s.waDB = db
	m.register(s)
	return s
}

func TestSessionManagerRegistry(t *testing.T) {
	pgURL := os.Getenv("WACALLS_PG_URL")
	if pgURL == "" {
		t.Skip("WACALLS_PG_URL environment variable is not set, skipping test")
	}
	m := newTestManager(t)

	if len(m.infos()) != 0 {
		t.Fatal("expected no sessions when empty")
	}

	a := m.addUnconnected(t, "Account A")
	b := m.addUnconnected(t, "Account B")

	infos := m.infos()
	if len(infos) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(infos))
	}
	if infos[0].Name != "Account A" || infos[1].Name != "Account B" {
		t.Fatalf("registration order not preserved: %+v", infos)
	}
	if infos[0].Paired {
		t.Fatal("unconnected session should not report paired")
	}

	if got, ok := m.Get(a.id); !ok || got != a {
		t.Fatal("Get did not return registered session")
	}

	m.unregister(b.id)
	if _, ok := m.Get(b.id); ok {
		t.Fatal("session b should be gone after unregister")
	}
	if len(m.infos()) != 1 {
		t.Fatal("expected 1 session after unregister")
	}
}

