package main

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	waTypes "go.mau.fi/whatsmeow/types"
)

type FollowupEngine struct {
	mu            sync.Mutex
	pending       map[string]*time.Timer // phone -> timer
	log           *slog.Logger
	sessionGetter func(sessionID string) *Session
}

func newFollowupEngine(log *slog.Logger, sessionGetter func(sessionID string) *Session) *FollowupEngine {
	return &FollowupEngine{
		pending:       make(map[string]*time.Timer),
		log:           log.With("module", "followup"),
		sessionGetter: sessionGetter,
	}
}

func (f *FollowupEngine) ScheduleFollowup(sessionID, callID, peerJID string, cfg MissedFollowupConfig) {
	if !cfg.Enabled {
		return
	}

	phone := cleanPhoneNumber(peerJID)
	delay := time.Duration(cfg.DelaySec) * time.Second
	if delay < 1*time.Second {
		delay = 30 * time.Second
	}

	f.mu.Lock()
	if existing, found := f.pending[phone]; found && existing != nil {
		existing.Stop()
	}

	f.log.Info("agendando follow-up de chamada não atendida", "session", sessionID, "callId", callID, "phone", phone, "delay", delay)

	timer := time.AfterFunc(delay, func() {
		f.mu.Lock()
		delete(f.pending, phone)
		f.mu.Unlock()

		sess := f.sessionGetter(sessionID)
		if sess == nil || !sess.IsPaired() {
			return
		}

		msgText := cfg.MessageTemplate
		if strings.TrimSpace(msgText) == "" {
			msgText = "Olá! Vi que você tentou ligar e não conseguimos atender. Como posso te ajudar?"
		}

		targetJID, err := waTypes.ParseJID(phone + "@s.whatsapp.net")
		if err != nil {
			f.log.Error("JID inválido para follow-up", "phone", phone, "err", err)
			return
		}

		_, err = sess.SendMessage(context.Background(), targetJID, msgText)
		if err != nil {
			f.log.Error("falha ao enviar mensagem de follow-up", "phone", phone, "err", err)
		} else {
			f.log.Info("mensagem de follow-up enviada com sucesso", "phone", phone)
		}
	})

	f.pending[phone] = timer
	f.mu.Unlock()
}

// CancelFollowup cancela o follow-up pendente se o cliente ligar/escrever antes
func (f *FollowupEngine) CancelFollowup(phone string) {
	cleanPhone := cleanPhoneNumber(phone)
	f.mu.Lock()
	defer f.mu.Unlock()
	if timer, found := f.pending[cleanPhone]; found && timer != nil {
		timer.Stop()
		delete(f.pending, cleanPhone)
		f.log.Info("follow-up cancelado devido à interação do cliente", "phone", cleanPhone)
	}
}
