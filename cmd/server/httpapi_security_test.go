package main

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestTicketStore(t *testing.T) {
	ts := newTicketStore()
	tk := ts.issue()
	if tk == "" {
		t.Fatal("ticket vazio")
	}
	// uso único
	if !ts.consume(tk) {
		t.Fatal("ticket válido deveria ser aceito")
	}
	if ts.consume(tk) {
		t.Fatal("ticket já consumido não deveria ser aceito novamente")
	}
	if ts.consume("inexistente") {
		t.Fatal("ticket inexistente não deveria ser aceito")
	}
	if ts.consume("") {
		t.Fatal("ticket vazio não deveria ser aceito")
	}
}

func TestTicketStoreExpiry(t *testing.T) {
	ts := newTicketStore()
	tk := ts.issue()
	// força expiração
	ts.mu.Lock()
	ts.tickets[tk] = time.Now().Add(-time.Second)
	ts.mu.Unlock()
	if ts.consume(tk) {
		t.Fatal("ticket expirado não deveria ser aceito")
	}
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestWithAuth(t *testing.T) {
	const key = "segredo-super-forte"
	tickets := newTicketStore()
	h := withAuth(okHandler(), key, tickets, testLogger())

	cases := []struct {
		name   string
		path   string
		header string
		want   int
	}{
		{"header correto", "/api/sessions", key, http.StatusOK},
		{"header errado", "/api/sessions", "errado", http.StatusUnauthorized},
		{"sem credencial", "/api/sessions", "", http.StatusUnauthorized},
		{"rota não-api livre", "/index.html", "", http.StatusOK},
		{"healthz livre", "/healthz", "", http.StatusOK},
		{"webhook chatwoot bypassa middleware", "/api/sessions/abc/chatwoot/webhook", "", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			if tc.header != "" {
				req.Header.Set("X-API-Key", tc.header)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("path %s: status %d, esperado %d", tc.path, rec.Code, tc.want)
			}
		})
	}

	t.Run("apiKey em query (deprecado) ainda funciona", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/sessions?apiKey="+key, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d, esperado 200", rec.Code)
		}
	})

	t.Run("ticket válido autoriza /api/events", func(t *testing.T) {
		tk := tickets.issue()
		req := httptest.NewRequest(http.MethodGet, "/api/events?ticket="+tk, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d, esperado 200", rec.Code)
		}
	})

	t.Run("ticket não autoriza outras rotas", func(t *testing.T) {
		tk := tickets.issue()
		req := httptest.NewRequest(http.MethodGet, "/api/sessions?ticket="+tk, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status %d, esperado 401", rec.Code)
		}
	})

	t.Run("ticket é de uso único", func(t *testing.T) {
		tk := tickets.issue()
		for i, want := range []int{http.StatusOK, http.StatusUnauthorized} {
			req := httptest.NewRequest(http.MethodGet, "/api/events?ticket="+tk, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != want {
				t.Fatalf("uso %d: status %d, esperado %d", i+1, rec.Code, want)
			}
		}
	})

	t.Run("ticket autoriza gemini ws", func(t *testing.T) {
		tk := tickets.issue()
		req := httptest.NewRequest(http.MethodGet, "/api/sessions/abc/gemini/ws?ticket="+tk, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d, esperado 200", rec.Code)
		}
	})
}

func TestGetClientIPTrustedProxies(t *testing.T) {
	// sem proxies confiáveis: XFF ignorado
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.50:1234"
	req.Header.Set("X-Forwarded-For", "198.51.100.7")
	if ip := getClientIP(req); ip != "203.0.113.50" {
		t.Fatalf("XFF não deveria ser honrado sem proxy confiável: %s", ip)
	}

	// com proxy confiável configurado
	t.Setenv("WACALLS_TRUSTED_PROXIES", "203.0.113.50, 10.0.0.0/8")
	// força recarga (a var sync.Once já foi usada acima — reinicializa manualmente)
	trustedProxiesOnce = sync.Once{}
	if ip := getClientIP(req); ip != "198.51.100.7" {
		t.Fatalf("XFF deveria ser honrado via proxy confiável: %s", ip)
	}

	// peer direto não confiável: XFF ignorado mesmo com a env setada
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "203.0.113.99:1234"
	req2.Header.Set("X-Forwarded-For", "198.51.100.7")
	if ip := getClientIP(req2); ip != "203.0.113.99" {
		t.Fatalf("XFF não deveria ser honrado de peer não confiável: %s", ip)
	}

	// CIDR confiável
	req3 := httptest.NewRequest(http.MethodGet, "/", nil)
	req3.RemoteAddr = "10.1.2.3:8080"
	req3.Header.Set("X-Forwarded-For", "198.51.100.9, 203.0.113.1")
	if ip := getClientIP(req3); ip != "198.51.100.9" {
		t.Fatalf("XFF deveria ser honrado via CIDR confiável: %s", ip)
	}
}

func TestWithBodyLimit(t *testing.T) {
	h := withBodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	big := make([]byte, 3<<20) // 3 MB > teto de 2 MB
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/x/ai-config", bytes.NewReader(big))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("body de 3MB deveria estourar o limite: status %d", rec.Code)
	}

	// rota de mensagens tem teto maior
	req2 := httptest.NewRequest(http.MethodPost, "/api/sessions/x/messages/image", bytes.NewReader(big))
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("rota de mensagens deveria aceitar 3MB: status %d", rec2.Code)
	}
}
