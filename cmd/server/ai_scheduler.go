package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"wacalls/internal/voip/call"
	"wacalls/internal/voip/core"

	"go.mau.fi/whatsmeow/types"
)

// AIScheduler é o agendador background que dispara chamadas IA server-side.
type AIScheduler struct {
	mgr  *SessionManager
	log  *slog.Logger
	stop chan struct{}

	// Rastreia agentes ativos por callID para evitar duplicação
	agents map[string]*ServerAIAgent
}

// NewAIScheduler cria um novo scheduler.
func NewAIScheduler(mgr *SessionManager, log *slog.Logger) *AIScheduler {
	return &AIScheduler{
		mgr:    mgr,
		log:    log,
		stop:   make(chan struct{}),
		agents: make(map[string]*ServerAIAgent),
	}
}

// Run inicia o ticker que verifica agendamentos a cada 10 segundos.
func (s *AIScheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	s.log.Info("[AIScheduler] Scheduler background iniciado")

	for {
		select {
		case <-ctx.Done():
			s.log.Info("[AIScheduler] Scheduler encerrado (context)")
			return
		case <-s.stop:
			s.log.Info("[AIScheduler] Scheduler encerrado (stop)")
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

// Stop encerra o scheduler.
func (s *AIScheduler) Stop() {
	close(s.stop)
}

// tick verifica todas as sessões por agendamentos prontos para disparar.
func (s *AIScheduler) tick(ctx context.Context) {
	s.mgr.mu.RLock()
	sessions := make([]*Session, 0, len(s.mgr.sessions))
	for _, sess := range s.mgr.sessions {
		sessions = append(sessions, sess)
	}
	s.mgr.mu.RUnlock()

	for _, sess := range sessions {
		s.checkSession(ctx, sess)
	}
}

// checkSession verifica e dispara agendamentos para uma sessão específica.
func (s *AIScheduler) checkSession(ctx context.Context, sess *Session) {
	config := sess.getAIConfig()

	// Só processa se serverSideAI estiver ativado e houver chave API
	if !config.ServerSideAI || config.GeminiAPIKey == "" {
		return
	}

	// Evita disparar se já houver chamadas ativas nesta sessão
	if sess.reg.count() > 0 {
		return
	}

	var schedules []map[string]any
	if err := json.Unmarshal([]byte(config.ScheduledCalls), &schedules); err != nil {
		return
	}

	now := time.Now()
	var toTrigger map[string]any
	var toTriggerIdx int = -1

	for i, sched := range schedules {
		active, _ := sched["active"].(bool)
		if !active {
			continue
		}
		timeStr, _ := sched["time"].(string)
		if timeStr == "" {
			continue
		}
		t, err := time.Parse(time.RFC3339, timeStr)
		if err != nil {
			continue
		}
		if t.Before(now) || t.Equal(now) {
			toTrigger = sched
			toTriggerIdx = i
			break
		}
	}

	if toTrigger == nil {
		return
	}

	phone, _ := toTrigger["phone"].(string)
	prompt, _ := toTrigger["prompt"].(string)
	if phone == "" {
		return
	}

	s.log.Info("[AIScheduler] Disparando agendamento automático", "phone", phone, "session", sess.id)

	// Marca o agendamento como inativo antes de disparar
	schedules[toTriggerIdx]["active"] = false
	b, _ := json.Marshal(schedules)
	config.ScheduledCalls = string(b)
	sess.setAIConfig(config)
	cfgJSON, _ := json.Marshal(config)
	_ = sess.mgr.store.setAIConfig(ctx, sess.id, string(cfgJSON))

	// Sessão WhatsApp precisa estar pareada
	if sess.client.Store.ID == nil {
		s.log.Warn("[AIScheduler] Sessão não pareada, ignorando agendamento", "session", sess.id)
		return
	}

	// Inicia a chamada
	peer := types.NewJID(normalizePhone(phone), types.DefaultUserServer)
	callID, err := sess.startOutgoing(ctx, peer, false)
	if err != nil {
		s.log.Error("[AIScheduler] Erro ao iniciar chamada", "err", err, "phone", phone)
		return
	}

	s.log.Info("[AIScheduler] Chamada iniciada", "callId", callID, "phone", phone)

	// Marca o owner como __server__
	sess.mgr.broker.setOwner(callID, serverOwnerID)

	// Vincula o callId ao agendamento
	schedules[toTriggerIdx]["callId"] = callID
	b2, _ := json.Marshal(schedules)
	config.ScheduledCalls = string(b2)
	sess.setAIConfig(config)
	cfgJSON2, _ := json.Marshal(config)
	_ = sess.mgr.store.setAIConfig(ctx, sess.id, string(cfgJSON2))

	// Aplica prompt adicional se houver
	agentConfig := config
	if prompt != "" {
		agentConfig.SystemInstruction = config.SystemInstruction + "\n\nInstrução adicional para esta chamada específica: " + prompt
	}

	// Acopla o agente quando a chamada conectar
	ac, ok := sess.reg.get(callID)
	if !ok {
		return
	}

	// Guarda o OnStateChange original para interceptar o estado "connected"
	originalOnState := ac.cm.OnStateChange
	ac.cm.OnStateChange = func(info *call.CallInfo) {
		// Propaga para o handler original (broker updates)
		if originalOnState != nil {
			originalOnState(info)
		}
		if info.IsEnded() {
			return
		}
		if info.StateData.State == core.CallStateActive {
			// Chamada conectada — acopla o agente de voz
			agent := NewServerAIAgent(sess, callID, phone, "outbound", ac.cm, agentConfig, s.log)
			if err := agent.Start(ctx); err != nil {
				s.log.Error("[AIScheduler] Erro ao iniciar agente", "err", err, "callId", callID)
				return
			}
			s.agents[callID] = agent
			s.log.Info("[AIScheduler] Agente IA acoplado à chamada agendada", "callId", callID)
		}
	}
}

// CleanupAgent remove um agente ao encerrar a chamada.
func (s *AIScheduler) CleanupAgent(callID string) {
	if agent, ok := s.agents[callID]; ok {
		agent.Detach()
		delete(s.agents, callID)
	}
}
