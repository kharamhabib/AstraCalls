package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	if err := st.insert(ctx, id, "Account A", "default", "kc_test"); err != nil {
		t.Fatal(err)
	}

	rows, err := st.listAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != id || rows[0].Name != "Account A" || rows[0].JID != "" {
		t.Fatalf("unexpected rows after insert: %+v", rows)
	}

	if err := st.setJID(ctx, id, "5511999999999:1@s.whatsapp.net"); err != nil {
		t.Fatal(err)
	}
	rows, _ = st.listAll(ctx)
	if rows[0].JID != "5511999999999:1@s.whatsapp.net" {
		t.Fatalf("jid not persisted: %+v", rows[0])
	}

	if err := st.delete(ctx, id); err != nil {
		t.Fatal(err)
	}
	rows, _ = st.listAll(ctx)
	if len(rows) != 0 {
		t.Fatalf("expected empty after delete, got %+v", rows)
	}
}

func TestPollOptionsRoundtrip(t *testing.T) {
	pgURL := os.Getenv("WACALLS_PG_URL")
	if pgURL == "" {
		t.Skip("WACALLS_PG_URL environment variable is not set, skipping test")
	}

	ctx := context.Background()
	db, err := newDBProvider(ctx, pgURL, "wacalls_test_polls", waLog.Noop, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	defer db.close()

	mainDB, err := db.openMainDB(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer mainDB.Close()

	_, _ = mainDB.ExecContext(ctx, "DROP TABLE IF EXISTS sent_polls")

	st, err := newSessionStore(ctx, mainDB)
	if err != nil {
		t.Fatal(err)
	}

	sessID := "test_session_123"
	pollID := "ABC123XYZ"
	options := []string{"Option Red", "Option Blue", "Option Green"}

	if err := st.savePollOptions(ctx, sessID, pollID, options); err != nil {
		t.Fatal(err)
	}

	hRed := sha256.Sum256([]byte("Option Red"))
	hashRedHex := hex.EncodeToString(hRed[:])

	resolved, err := st.resolvePollOption(ctx, sessID, pollID, hashRedHex)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != "Option Red" {
		t.Fatalf("expected 'Option Red', got %q", resolved)
	}

	resolvedNonExisting, err := st.resolvePollOption(ctx, sessID, pollID, "nonexistinghash")
	if err != nil {
		t.Fatal(err)
	}
	if resolvedNonExisting != "" {
		t.Fatalf("expected empty string for non-existing hash, got %q", resolvedNonExisting)
	}
}

