package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"wacalls/internal/voip/call"
	"wacalls/internal/voip/core"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

const serverOwnerID = "__server__"
const maxAudioQueueSamples = 800000 // ~50 segundos a 16kHz

// ServerAIAgent orquestra a ponte de áudio entre o WhatsApp e o Gemini Live no servidor.
type ServerAIAgent struct {
	gemini    *GeminiLiveClient
	cm        *call.CallManager
	sess      *Session
	callID    string
	peer      string
	direction string
	log       *slog.Logger

	mu       sync.Mutex
	detached bool
	maxTimer *time.Timer

	// Buffer de áudio para pacing (evitar choppy audio)
	audioQueue []float32
	queueMu    sync.Mutex
	pacedStop  chan struct{}

	// Buffer de áudio de entrada para pacer (evitar latência de VAD e eco)
	inboundQueue []float32
	inboundMu    sync.Mutex
	inboundStop  chan struct{}
}

// NewServerAIAgent cria e acopla um agente de IA ao CallManager.
func NewServerAIAgent(sess *Session, callID, peer, direction string, cm *call.CallManager, config AIConfig, log *slog.Logger) *ServerAIAgent {
	agent := &ServerAIAgent{
		sess:        sess,
		callID:      callID,
		peer:        peer,
		direction:   direction,
		cm:          cm,
		log:         log.With("agent_call", callID),
		pacedStop:   make(chan struct{}),
		inboundStop: make(chan struct{}),
	}

	// Concatena os prompts das ferramentas habilitadas (modularidade de prompt)
	if config.ToolsEnabled {
		var toolRules []string
		for _, name := range config.PredefinedTools {
			promptText := config.ToolPrompts[name]
			if promptText == "" {
				promptText = DefaultToolPrompts[name]
			}
			if promptText != "" {
				toolRules = append(toolRules, promptText)
			}
		}
		if len(toolRules) > 0 {
			config.SystemInstruction += "\n\n### REGRAS PARA O USO DE FERRAMENTAS (APIS):\n* Se a ferramenta exigir argumentos (como a mensagem de texto ou número no send_message), extraia-os naturalmente da fala do usuário ou use os valores padrões fornecidos, sem soletrar os parâmetros tecnicamente para o cliente.\n" + strings.Join(toolRules, "\n")
		}
	}

	// Processa tags dinâmicas no prompt (mesmo comportamento do frontend)
	now := time.Now()
	tzEnv := os.Getenv("TZ")
	if tzEnv == "" {
		tzEnv = "America/Sao_Paulo"
	}
	if loc, err := time.LoadLocation(tzEnv); err == nil {
		now = now.In(loc)
	}

	localTime := now.Format("02/01/2006 15:04")
	_, offset := now.Zone()
	tzH := offset / 3600
	tzM := (offset % 3600) / 60
	tzSign := "+"
	if tzH < 0 {
		tzSign = "-"
		tzH = -tzH
	}
	tzStr := fmt.Sprintf("UTC%s%02d:%02d", tzSign, tzH, tzM)
	utcTime := now.UTC().Format(time.RFC3339)
	nowStr := fmt.Sprintf("%s (%s) / %s (UTC)", localTime, tzStr, utcTime)

	dir := "saída (efetuada)"
	if direction == "inbound" {
		dir = "entrada (recebida)"
	}

	processed := config.SystemInstruction
	processed = strings.ReplaceAll(processed, "[today]", nowStr)
	processed = strings.ReplaceAll(processed, "[phone]", peer)
	processed = strings.ReplaceAll(processed, "[direction]", dir)
	processed = strings.ReplaceAll(processed, "[session_name]", sess.name)
	if config.CustomFields != "" {
		processed = strings.ReplaceAll(processed, "[custom_fields]", config.CustomFields)
	} else {
		processed = strings.ReplaceAll(processed, "[custom_fields]", "")
	}
	config.SystemInstruction = processed

	agent.gemini = NewGeminiLiveClient(config, log)
	return agent
}

// Start conecta ao Gemini, acopla o pipeline de áudio e inicia o agente.
func (a *ServerAIAgent) Start(ctx context.Context) error {
	a.log.Info("[ServerAIAgent] Iniciando agente de voz server-side")

	// Conecta ao Gemini Live
	err := a.gemini.Connect(
		// onAudio: áudio da IA → WhatsApp (salva na fila para reprodução ritmada/paced)
		func(pcm24k []float32) {
			pcm16k := Downsample24to16(pcm24k)
			if len(pcm16k) == 0 {
				return
			}
			a.queueMu.Lock()
			a.audioQueue = append(a.audioQueue, pcm16k...)
			if len(a.audioQueue) > maxAudioQueueSamples {
				a.audioQueue = a.audioQueue[len(a.audioQueue)-maxAudioQueueSamples:]
				a.log.Warn("[ServerAIAgent] Audio queue truncada (excedeu cap)")
			}
			a.queueMu.Unlock()
		},
		// onText: transcrições (log + emitir via SSE se frontend estiver aberto)
		func(speaker, text string) {
			prefix := "🎤 Cliente disse:"
			if speaker == "ai" {
				prefix = "📝 IA disse:"
			}
			a.log.Info(fmt.Sprintf("[ServerAI] %s %s", prefix, text))

			a.sess.mgr.broker.broadcast(map[string]any{
				"type":      "ai-transcript",
				"sessionId": a.sess.id,
				"callId":    a.callID,
				"speaker":   speaker,
				"text":      text,
			})
		},
		// onToolCall: handlers de ferramentas
		func(name string, args map[string]any) map[string]any {
			return a.handleToolCall(ctx, name, args)
		},
		// onClose: sessão Gemini fechou
		func() {
			a.log.Warn("[ServerAIAgent] Sessão Gemini fechou inesperadamente")
			a.Detach()
		},
	)
	if err != nil {
		return fmt.Errorf("gemini connect: %w", err)
	}

	// Inicia os pacers para reprodução e captura estáveis
	go a.startPacedSender(ctx)
	go a.startInboundPacer(ctx)

	// Acopla o callback de áudio do peer (WhatsApp → Gemini) com fila e contador para monitorar se estamos ouvindo o cliente
	var peerPackets uint64
	a.cm.OnPeerAudio = func(pcm16 []float32) {
		a.mu.Lock()
		detached := a.detached
		a.mu.Unlock()
		if detached {
			return
		}

		count := atomic.AddUint64(&peerPackets, 1)
		if count%50 == 1 {
			a.log.Info("[ServerAIAgent] Recebendo áudio do cliente", "samples", len(pcm16), "packetCount", count)
		}

		// Apenas enfileira para processamento ritmado
		a.inboundMu.Lock()
		a.inboundQueue = append(a.inboundQueue, pcm16...)
		if len(a.inboundQueue) > maxAudioQueueSamples {
			a.inboundQueue = a.inboundQueue[len(a.inboundQueue)-maxAudioQueueSamples:]
			a.log.Warn("[ServerAIAgent] Inbound queue truncada (excedeu cap)")
		}
		a.inboundMu.Unlock()
	}

	// Emite evento SSE para que o frontend saiba que o servidor gerencia esta chamada
	a.sess.mgr.broker.broadcast(map[string]any{
		"type":      "ai-agent-active",
		"sessionId": a.sess.id,
		"callId":    a.callID,
		"server":    true,
	})

	// Primeira fala (saudação)
	if a.gemini.config.FirstUtterance != "" {
		a.gemini.SendText(a.gemini.config.FirstUtterance)
	}

	// Timer de duração máxima
	if a.gemini.config.MaxDurationMin > 0 {
		dur := time.Duration(a.gemini.config.MaxDurationMin) * time.Minute
		a.maxTimer = time.AfterFunc(dur, func() {
			a.log.Info("[ServerAIAgent] Duração máxima atingida, encerrando")
			a.Detach()
			a.sess.terminateCall(a.callID, core.EndCallReasonUserEnded)
			a.sess.removeCall(a.callID)
			a.sess.mgr.broker.endCall(a.callID, string(core.EndCallReasonUserEnded))
		})
	}

	a.log.Info("[ServerAIAgent] Agente de voz IA ativo para a chamada")
	return nil
}

// startPacedSender envia áudio PCM para o CallManager em intervalos regulares de 60ms.
func (a *ServerAIAgent) startPacedSender(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Millisecond)
	defer ticker.Stop()

	frameSize := 960 // 60ms de áudio a 16kHz

	for {
		select {
		case <-a.pacedStop:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.queueMu.Lock()
			qLen := len(a.audioQueue)
			if qLen == 0 {
				a.queueMu.Unlock()
				continue
			}

			var frame []float32
			if qLen >= frameSize {
				frame = a.audioQueue[:frameSize]
				a.audioQueue = a.audioQueue[frameSize:]
			} else {
				// Fim da fila: preenche o restante com silêncio
				frame = make([]float32, frameSize)
				copy(frame, a.audioQueue)
				a.audioQueue = nil
			}
			a.queueMu.Unlock()

			// Envia o frame ritmado para o WhatsApp
			a.cm.FeedCapturedPCM(frame)
		}
	}
}

// startInboundPacer envia áudio contínuo para o Gemini para manter a VAD (detecção de fala) ativa e evitar delays de silêncio.
func (a *ServerAIAgent) startInboundPacer(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Millisecond)
	defer ticker.Stop()

	frameSize := 960 // 60ms de áudio a 16kHz
	silenceFrame := make([]float32, frameSize)

	for {
		select {
		case <-a.inboundStop:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.inboundMu.Lock()
			qLen := len(a.inboundQueue)

			var frame []float32
			if qLen >= frameSize {
				frame = a.inboundQueue[:frameSize]
				a.inboundQueue = a.inboundQueue[frameSize:]
				a.inboundMu.Unlock()
			} else {
				// Fila incompleta ou vazia: limpa resíduos e usa silêncio
				a.inboundQueue = nil
				a.inboundMu.Unlock()
				frame = silenceFrame
			}

			// Cancelamento de Eco Acústico básico: se a IA estiver falando, ignoramos o microfone do usuário
			a.queueMu.Lock()
			aiSpeaking := len(a.audioQueue) > 0
			a.queueMu.Unlock()

			if aiSpeaking {
				a.gemini.SendAudio(silenceFrame)
			} else {
				a.gemini.SendAudio(frame)
			}
		}
	}
}

// Detach desacopla o agente, fecha o Gemini e executa post-call actions.
func (a *ServerAIAgent) Detach() {
	a.mu.Lock()
	if a.detached {
		a.mu.Unlock()
		return
	}
	a.detached = true
	a.mu.Unlock()

	// Encerra os pacers
	close(a.pacedStop)
	close(a.inboundStop)

	if a.maxTimer != nil {
		a.maxTimer.Stop()
	}

	// Limpa callback de áudio
	a.cm.OnPeerAudio = nil

	a.gemini.Close()

	// Post-call actions em background
	go a.executePostCallActions()
}

// handleToolCall processa tool calls do Gemini.
func (a *ServerAIAgent) handleToolCall(ctx context.Context, name string, args map[string]any) map[string]any {
	switch name {
	case "hangup":
		a.log.Info("[ServerAIAgent] Tool hangup disparada")
		// Aguarda brevemente para a IA terminar de falar, depois desliga
		go func() {
			time.Sleep(2 * time.Second)
			a.Detach()
			a.sess.terminateCall(a.callID, core.EndCallReasonUserEnded)
			a.sess.removeCall(a.callID)
			a.sess.mgr.broker.endCall(a.callID, string(core.EndCallReasonUserEnded))
		}()
		return map[string]any{"status": "chamada sendo encerrada"}

	case "open_ticket":
		a.log.Info("[ServerAIAgent] Tool open_ticket disparada", "args", args)
		reason, _ := args["reason"].(string)

		// Sinaliza no broker que a chamada teve um chamado aberto
		if rec, ok := a.sess.mgr.broker.getCall(a.callID); ok {
			rec.TicketOpened = true
			rec.TicketReason = reason
			a.sess.mgr.broker.upsertCall(*rec)
		}

		// Envia a notificação do chamado pelo WhatsApp para o admin se configurado
		config := a.sess.getAIConfig()
		if config.PostCall.SendAdmin && config.PostCall.AdminNumber != "" {
			go func() {
				adminJid, err := resolveRecipient(config.PostCall.AdminNumber)
				if err == nil {
					contactName := a.resolveContactPhone(context.Background())
					msg := fmt.Sprintf("⚠️ *Novo Chamado Aberto pela IA*\n\n• *Cliente:* %s\n• *Sessão:* %s\n• *Motivo:* %s\n• *ID Chamada:* %s", contactName, a.sess.name, reason, a.callID)
					_, _ = a.sess.client.SendMessage(context.Background(), adminJid, &waE2E.Message{
						Conversation: proto.String(msg),
					})
				}
			}()
		}

		return map[string]any{"status": "chamado aberto com sucesso"}

	case "send_message":
		return a.toolSendMessage(ctx, args)

	case "schedule_call":
		return a.toolScheduleCall(ctx, args)

	default:
		return a.toolCustomWebhook(ctx, name, args)
	}
}

// toolSendMessage envia uma mensagem de texto WhatsApp pelo backend.
func (a *ServerAIAgent) toolSendMessage(ctx context.Context, args map[string]any) map[string]any {
	message, _ := args["message"].(string)
	to, _ := args["to"].(string)
	if message == "" {
		return map[string]any{"error": "mensagem vazia"}
	}
	if to == "" {
		to = a.peer
	}

	jid, err := resolveRecipient(to)
	if err != nil {
		return map[string]any{"error": err.Error()}
	}

	_, err = a.sess.client.SendMessage(ctx, jid, &waE2E.Message{
		Conversation: proto.String(message),
	})
	if err != nil {
		a.log.Error("[ServerAIAgent] Erro ao enviar mensagem", "err", err)
		return map[string]any{"error": err.Error()}
	}
	a.log.Info("[ServerAIAgent] Mensagem enviada", "to", jid.String())
	return map[string]any{"status": "mensagem enviada com sucesso"}
}

// resolveContactPhone resolve o JID do peer para retornar o número de telefone (PN) real, convertendo de LID se necessário.
func (a *ServerAIAgent) resolveContactPhone(ctx context.Context) string {
	jid, err := types.ParseJID(a.peer)
	if err != nil {
		return a.peer
	}
	if jid.Server == "lid" && a.sess.client != nil && a.sess.client.Store.LIDs != nil {
		if pn, e := a.sess.client.Store.LIDs.GetPNForLID(ctx, jid); e == nil && !pn.IsEmpty() {
			return pn.User
		}
	}
	return jid.User
}

// toolScheduleCall agenda uma ligação futura.
func (a *ServerAIAgent) toolScheduleCall(ctx context.Context, args map[string]any) map[string]any {
	datetimeStr, _ := args["datetime"].(string)
	prompt, _ := args["prompt"].(string)
	if datetimeStr == "" {
		return map[string]any{"error": "datetime obrigatório"}
	}

	scheduledDate, err := time.Parse(time.RFC3339, datetimeStr)
	if err != nil {
		// Tenta formatos alternativos
		scheduledDate, err = time.Parse("2006-01-02T15:04:05Z", datetimeStr)
		if err != nil {
			return map[string]any{"error": "formato de datetime inválido"}
		}
	}

	config := a.sess.getAIConfig()
	var schedules []map[string]any
	_ = json.Unmarshal([]byte(config.ScheduledCalls), &schedules)

	newCall := map[string]any{
		"id":     fmt.Sprintf("srv_%d", time.Now().UnixNano()),
		"phone":  normalizePhone(a.resolveContactPhone(ctx)),
		"time":   scheduledDate.Format(time.RFC3339),
		"active": true,
	}
	if prompt != "" {
		newCall["prompt"] = prompt
	}
	schedules = append(schedules, newCall)

	b, _ := json.Marshal(schedules)
	config.ScheduledCalls = string(b)
	a.sess.setAIConfig(config)
	cfgJSON, _ := json.Marshal(config)
	_ = a.sess.mgr.store.setAIConfig(ctx, a.sess.id, string(cfgJSON))

	if a.sess.mgr.Scheduler != nil {
		a.sess.mgr.Scheduler.RecalculateActiveCount()
	}

	a.log.Info("[ServerAIAgent] Ligação agendada", "time", scheduledDate.Format(time.RFC3339))
	return map[string]any{"status": "ligação agendada com sucesso", "time": scheduledDate.Format(time.RFC3339)}
}

// toolCustomWebhook executa uma tool customizada via webhook proxy.
func (a *ServerAIAgent) toolCustomWebhook(ctx context.Context, name string, args map[string]any) map[string]any {
	var tool *CustomTool
	for i := range a.gemini.config.CustomTools {
		if a.gemini.config.CustomTools[i].Name == name {
			tool = &a.gemini.config.CustomTools[i]
			break
		}
	}
	if tool == nil {
		return map[string]any{"error": fmt.Sprintf("ferramenta %s não encontrada", name)}
	}

	jsonBytes, _ := json.Marshal(args)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tool.WebhookURL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	defer resp.Body.Close()

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return map[string]any{"output": "ok"}
	}
	return result
}

// executePostCallActions gera o resumo e executa ações pós-chamada.
func (a *ServerAIAgent) executePostCallActions() {
	transcript := a.gemini.Transcript()
	if len(transcript) == 0 {
		a.log.Info("[ServerAIAgent] Sem transcrição para processar pós-chamada")
		return
	}

	// Salva a transcrição no banco de dados principal
	if a.sess.mgr != nil && a.sess.mgr.store != nil {
		go func() {
			err := a.sess.mgr.store.saveTranscript(context.Background(), a.sess.id, a.callID, transcript)
			if err != nil {
				a.log.Error("[ServerAIAgent] Erro ao salvar transcrição no banco", "err", err)
			} else {
				a.log.Info("[ServerAIAgent] Transcrição salva no banco com sucesso")
			}
		}()
	}

	config := a.gemini.config
	if !config.PostCall.SummaryEnabled {
		return
	}

	// Monta o texto da transcrição
	var sb strings.Builder
	for _, line := range transcript {
		speaker := "IA"
		if line.Speaker == "client" {
			speaker = "Cliente"
		}
		sb.WriteString(fmt.Sprintf("%s: %s\n", speaker, line.Text))
	}
	transcriptText := sb.String()

	// Busca info do contato
	contactInfo := a.peer
	if a.sess.client != nil {
		jid, err := types.ParseJID(a.peer)
		if err == nil {
			phone := jid.User
			if jid.Server == "lid" && a.sess.client.Store.LIDs != nil {
				if pn, e := a.sess.client.Store.LIDs.GetPNForLID(context.Background(), jid); e == nil && !pn.IsEmpty() {
					phone = pn.User
					jid = pn
				}
			}
			name := ""
			if contact, e := a.sess.client.Store.Contacts.GetContact(context.Background(), jid); e == nil && contact.Found {
				if contact.FullName != "" {
					name = contact.FullName
				} else if contact.PushName != "" {
					name = contact.PushName
				}
			}
			if name != "" {
				contactInfo = fmt.Sprintf("%s (%s)", name, phone)
			} else {
				contactInfo = phone
			}
		}
	}

	tzEnv := os.Getenv("TZ")
	if tzEnv == "" {
		tzEnv = "America/Sao_Paulo"
	}
	now := time.Now()
	if loc, err := time.LoadLocation(tzEnv); err == nil {
		now = now.In(loc)
	}
	startTime := now.Add(-5 * time.Minute) // estimativa
	formattedDate := startTime.Format("02/01/2006 15:04")
	dir := "Recebida"
	if a.direction != "inbound" {
		dir = "Efetuada"
	}

	prompt := fmt.Sprintf(`Analise a transcrição abaixo e gere um resumo muito objetivo e formatado para WhatsApp (use *negrito* nos títulos e emojis). Seja extremamente conciso.

📞 *RESUMO DE ATENDIMENTO*
• *Contato*: %s
• *Horário*: %s
• *Sentido*: %s

🎯 *Assunto principal*: (máximo 1 frase)
📝 *Pontos tratados*: (máximo 3 tópicos rápidos)
🤝 *Ações/Decisões*: (máximo 2 tópicos rápidos ou "Nenhuma")

Não crie introduções ou conclusões. Resuma diretamente nos tópicos acima.

Transcrição:
%s`, contactInfo, formattedDate, dir, transcriptText)

	// Chama a API REST do Gemini para gerar o resumo
	geminiURL := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=%s", config.GeminiAPIKey)
	body := map[string]any{
		"contents": []map[string]any{{
			"parts": []map[string]any{{"text": prompt}},
		}},
	}
	jsonBody, _ := json.Marshal(body)

	resp, err := http.Post(geminiURL, "application/json", bytes.NewBuffer(jsonBody))
	if err != nil {
		a.log.Error("[ServerAIAgent] Erro ao gerar resumo", "err", err)
		return
	}
	defer resp.Body.Close()

	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		a.log.Error("[ServerAIAgent] Erro ao decodificar resumo", "err", err)
		return
	}

	summary := extractSummaryText(data)
	if summary == "" {
		a.log.Warn("[ServerAIAgent] Resumo vazio")
		return
	}

	a.log.Info("[ServerAIAgent] Resumo gerado com sucesso")

	// Salva no histórico do broker
	a.sess.mgr.broker.saveSummary(a.sess.id, a.callID, summary)

	ctx := context.Background()

	// Envia para o admin
	if config.PostCall.SendAdmin && config.PostCall.AdminNumber != "" {
		adminJID, err := resolveRecipient(config.PostCall.AdminNumber)
		if err == nil {
			_, _ = a.sess.client.SendMessage(ctx, adminJID, &waE2E.Message{
				Conversation: proto.String(summary),
			})
			a.log.Info("[ServerAIAgent] Resumo enviado para admin")
		}
	}

	// Envia para o cliente
	if config.PostCall.SendClient {
		clientJID, err := types.ParseJID(a.peer)
		if err == nil {
			// Se for LID, tenta buscar o número de telefone (PN) real para envio correto do WhatsApp
			if clientJID.Server == "lid" && a.sess.client.Store.LIDs != nil {
				if pn, e := a.sess.client.Store.LIDs.GetPNForLID(ctx, clientJID); e == nil && !pn.IsEmpty() {
					clientJID = pn
				}
			}
			_, _ = a.sess.client.SendMessage(ctx, clientJID, &waE2E.Message{
				Conversation: proto.String(summary),
			})
			a.log.Info("[ServerAIAgent] Resumo enviado para cliente", "to", clientJID.String())
		}
	}

	// Webhook pós-chamada
	if config.PostCall.WebhookEnabled && config.PostCall.WebhookURL != "" {
		var duration int64
		var ticketOpened bool
		var ticketReason string
		var startedAtVal, endedAtVal int64

		if hCall, ok := a.sess.mgr.broker.findHistoryCall(a.callID); ok {
			startedAtVal = hCall.StartedAt
			if hCall.EndedAt != nil {
				endedAtVal = *hCall.EndedAt
				duration = (endedAtVal - startedAtVal) / 1000
			}
			ticketOpened = hCall.TicketOpened
			ticketReason = hCall.TicketReason
		}

		transcript := a.gemini.Transcript()

		webhookBody, _ := json.Marshal(map[string]any{
			"sessionId":    a.sess.id,
			"callId":       a.callID,
			"peer":         a.peer,
			"direction":    a.direction,
			"summary":      summary,
			"duration":     duration,
			"ticketOpened": ticketOpened,
			"ticketReason": ticketReason,
			"startedAt":    startedAtVal,
			"endedAt":      endedAtVal,
			"transcript":   transcript,
		})
		go func() {
			c := &http.Client{Timeout: 10 * time.Second}
			_, _ = c.Post(config.PostCall.WebhookURL, "application/json", bytes.NewBuffer(webhookBody))
		}()
	}
}

// extractSummaryText extrai o texto do resumo da resposta do Gemini REST.
func extractSummaryText(data map[string]any) string {
	candidates, _ := data["candidates"].([]any)
	if len(candidates) == 0 {
		return ""
	}
	c0, _ := candidates[0].(map[string]any)
	if c0 == nil {
		return ""
	}
	content, _ := c0["content"].(map[string]any)
	if content == nil {
		return ""
	}
	parts, _ := content["parts"].([]any)
	if len(parts) == 0 {
		return ""
	}
	p0, _ := parts[0].(map[string]any)
	if p0 == nil {
		return ""
	}
	text, _ := p0["text"].(string)
	return text
}
