package main

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	waTypes "go.mau.fi/whatsmeow/types"
)

type NPSEngine struct {
	mu            sync.Mutex
	pending       map[string]npsPending // phone -> npsPending
	log           *slog.Logger
	store         *sessionStore
	sessionGetter func(sessionID string) *Session
}

type npsPending struct {
	SessionID string
	CallID    string
	Phone     string
	ExpiresAt time.Time
}

func newNPSEngine(log *slog.Logger, store *sessionStore, sessionGetter func(sessionID string) *Session) *NPSEngine {
	return &NPSEngine{
		pending:       make(map[string]npsPending),
		log:           log.With("module", "nps"),
		store:         store,
		sessionGetter: sessionGetter,
	}
}

func (n *NPSEngine) ScheduleNPS(sessionID, callID, peerJID string, callDurationSec int, cfg NPSConfig) {
	if !cfg.Enabled {
		return
	}
	if callDurationSec < cfg.MinCallDuration {
		return
	}

	phone := cleanPhoneNumber(peerJID)
	delay := time.Duration(cfg.DelaySec) * time.Second
	if delay < 1*time.Second {
		delay = 5 * time.Second
	}

	n.log.Info("agendando pesquisa NPS", "session", sessionID, "callId", callID, "phone", phone, "delay", delay)

	go func() {
		time.Sleep(delay)

		sess := n.sessionGetter(sessionID)
		if sess == nil || !sess.IsPaired() {
			return
		}

		msgText := cfg.MessageTemplate
		if strings.TrimSpace(msgText) == "" {
			msgText = "Em uma escala de 0 a 10, como você avalia o nosso atendimento de hoje?"
		}

		targetJID, err := waTypes.ParseJID(phone + "@s.whatsapp.net")
		if err != nil {
			n.log.Error("JID inválido para NPS", "phone", phone, "err", err)
			return
		}

		_, err = sess.SendMessage(context.Background(), targetJID, msgText)
		if err != nil {
			n.log.Error("falha ao enviar mensagem de NPS", "phone", phone, "err", err)
			return
		}

		n.mu.Lock()
		n.pending[phone] = npsPending{
			SessionID: sessionID,
			CallID:    callID,
			Phone:     phone,
			ExpiresAt: time.Now().Add(24 * time.Hour),
		}
		n.mu.Unlock()
	}()
}

func (n *NPSEngine) HandleIncomingMessage(sessionID, senderJID, text string) bool {
	phone := cleanPhoneNumber(senderJID)

	n.mu.Lock()
	p, exists := n.pending[phone]
	if !exists {
		n.mu.Unlock()
		return false
	}
	if time.Now().After(p.ExpiresAt) {
		delete(n.pending, phone)
		n.mu.Unlock()
		return false
	}
	n.mu.Unlock()

	textTrim := strings.TrimSpace(text)
	score, err := strconv.Atoi(textTrim)
	if err != nil || score < 0 || score > 10 {
		return false
	}

	// Remove das pendências
	n.mu.Lock()
	delete(n.pending, phone)
	n.mu.Unlock()

	n.log.Info("resposta de NPS recebida", "session", sessionID, "phone", phone, "score", score)

	// Persiste no banco
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rating := CallRating{
		SessionID: sessionID,
		CallID:    p.CallID,
		Phone:     phone,
		Score:     score,
	}
	if err := n.store.saveRating(ctx, rating); err != nil {
		n.log.Error("falha ao salvar rating no banco", "err", err)
	}

	// Notifica o cliente agradecendo
	sess := n.sessionGetter(sessionID)
	if sess != nil && sess.IsPaired() {
		targetJID, _ := waTypes.ParseJID(phone + "@s.whatsapp.net")
		_, _ = sess.SendMessage(context.Background(), targetJID, "Obrigado pela sua avaliação!")

		// Se nota detratora (<= 6), notifica o supervisor no WhatsApp se configurado
		cfg := sess.getAIConfig()
		if score <= 6 && strings.TrimSpace(cfg.NPS.SupervisorPhone) != "" {
			supPhone := cleanPhoneNumber(cfg.NPS.SupervisorPhone)
			supJID, err := waTypes.ParseJID(supPhone + "@s.whatsapp.net")
			if err == nil {
				alertMsg := fmt.Sprintf("⚠️ *Alerta NPS Detrator*\nO cliente +%s atribuiu nota %d/10 no atendimento (Chamada ID: %s).", phone, score, p.CallID)
				_, _ = sess.SendMessage(context.Background(), supJID, alertMsg)
			}
		}
	}

	return true
}

func cleanPhoneNumber(jidOrPhone string) string {
	parts := strings.Split(jidOrPhone, "@")
	num := parts[0]
	numParts := strings.Split(num, ":")
	cleaned := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, numParts[0])
	return cleaned
}
