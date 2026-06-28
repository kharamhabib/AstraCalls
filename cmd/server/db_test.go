package main

import (
	"os"
	"testing"
)

func TestPostgresConfig(t *testing.T) {
	pgURL := os.Getenv("WACALLS_PG_URL")
	if pgURL == "" {
		t.Skip("WACALLS_PG_URL environment variable is not set, skipping test")
	}
}

