package main

import (
	"context"
	"log/slog"
	"os"
	"testing"

	waLog "go.mau.fi/whatsmeow/util/log"
)

func TestSessionStoreRoundtrip(t *testing.T) {
	pgURL := os.Getenv("WACALLS_PG_URL")
	if pgURL == "" {
		t.Skip("WACALLS_PG_URL environment variable is not set, skipping test")
	}

	ctx := context.Background()
	db, err := newDBProvider(ctx, pgURL, "wacalls_test_store", waLog.Noop, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	defer db.close()

	mainDB, err := db.openMainDB(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer mainDB.Close()

	// Clean up table if exists
	_, _ = mainDB.ExecContext(ctx, "DROP TABLE IF EXISTS sessions")

	st, err := newSessionStore(ctx, mainDB)
	if err != nil {
		t.Fatal(err)
	}

	id := newSessionID()
	if len(id) != 32 {
		t.Fatalf("session id should be 32 hex chars, got %d", len(id))
	}
	if err := st.insert(ctx, id, "Account A"); err != nil {
		t.Fatal(err)
	}

	rows, err := st.list(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != id || rows[0].Name != "Account A" || rows[0].JID != "" {
		t.Fatalf("unexpected rows after insert: %+v", rows)
	}

	if err := st.setJID(ctx, id, "5511999999999:1@s.whatsapp.net"); err != nil {
		t.Fatal(err)
	}
	rows, _ = st.list(ctx)
	if rows[0].JID != "5511999999999:1@s.whatsapp.net" {
		t.Fatalf("jid not persisted: %+v", rows[0])
	}

	if err := st.delete(ctx, id); err != nil {
		t.Fatal(err)
	}
	rows, _ = st.list(ctx)
	if len(rows) != 0 {
		t.Fatalf("expected empty after delete, got %+v", rows)
	}
}

