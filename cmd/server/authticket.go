package main

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// ticketTTL é o tempo de vida de um ticket de conexão (SSE / WebSocket).
const ticketTTL = 30 * time.Second

// ticketStore emite tickets de uso único e curta duração para autenticar
// conexões que não conseguem enviar headers (EventSource e WebSocket do
// navegador), substituindo a API key em query string — que vaza em logs de
// proxy, histórico do navegador e headers Referer.
//
// Fluxo: o cliente autenticado (X-API-Key) faz POST /api/events/ticket,
// recebe {ticket} e conecta em /api/events?ticket=... (ou /gemini/ws).
// O ticket é invalidado no primeiro uso (consume) e expira em 30s.
type ticketStore struct {
	mu      sync.Mutex
	tickets map[string]time.Time
}

func newTicketStore() *ticketStore {
	return &ticketStore{tickets: map[string]time.Time{}}
}

// issue gera e registra um novo ticket.
func (t *ticketStore) issue() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	tk := hex.EncodeToString(b)
	t.mu.Lock()
	t.sweepLocked()
	t.tickets[tk] = time.Now().Add(ticketTTL)
	t.mu.Unlock()
	return tk
}

// consume valida e invalida o ticket (uso único). Retorna false se inexistente
// ou expirado.
func (t *ticketStore) consume(tk string) bool {
	if tk == "" {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	exp, ok := t.tickets[tk]
	if !ok {
		return false
	}
	delete(t.tickets, tk)
	return time.Now().Before(exp)
}

// sweepLocked remove tickets expirados (chamado com o lock segurado).
func (t *ticketStore) sweepLocked() {
	now := time.Now()
	for tk, exp := range t.tickets {
		if now.After(exp) {
			delete(t.tickets, tk)
		}
	}
}
