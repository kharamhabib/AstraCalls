package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"sync"

	"github.com/gorilla/websocket"
)

// geminiLiveModel é o modelo usado para sessões de voz bidirecional.
const geminiLiveModel = "models/gemini-3.1-flash-live-preview"

// TranscriptLine representa uma linha de transcrição acumulada.
type TranscriptLine struct {
	Speaker string `json:"speaker"` // "ai" ou "client"
	Text    string `json:"text"`
}

// GeminiLiveClient gerencia a conexão WebSocket bidirecional com a API Gemini Live.
type GeminiLiveClient struct {
	conn   *websocket.Conn
	config AIConfig
	log    *slog.Logger

	// Callbacks
	onAudioOut  func(pcm16 []float32) // Áudio gerado pela IA → WhatsApp
	onText      func(speaker, text string)
	onToolCall  func(name string, args map[string]any) map[string]any
	onClose     func()

	mu         sync.Mutex
	transcript []TranscriptLine
	ready      bool
	closed     bool
}

// NewGeminiLiveClient cria um novo cliente Gemini Live.
func NewGeminiLiveClient(config AIConfig, log *slog.Logger) *GeminiLiveClient {
	return &GeminiLiveClient{
		config: config,
		log:    log,
	}
}

// Connect abre o WebSocket e envia a mensagem de setup. Bloqueia até setupComplete.
func (g *GeminiLiveClient) Connect(
	onAudio func(pcm16 []float32),
	onText func(speaker, text string),
	onToolCall func(name string, args map[string]any) map[string]any,
	onClose func(),
) error {
	g.onAudioOut = onAudio
	g.onText = onText
	g.onToolCall = onToolCall
	g.onClose = onClose

	url := fmt.Sprintf("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=%s", g.config.GeminiAPIKey)

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return fmt.Errorf("gemini live dial: %w", err)
	}
	g.conn = conn
	g.log.Info("[GeminiLive] Conexão WebSocket aberta")

	// Monta e envia a mensagem de setup
	setup := g.buildSetup()
	if err := conn.WriteJSON(setup); err != nil {
		conn.Close()
		return fmt.Errorf("gemini live setup: %w", err)
	}

	// Aguarda setupComplete
	setupDone := make(chan error, 1)
	go func() {
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				setupDone <- fmt.Errorf("gemini live read during setup: %w", err)
				return
			}
			var msg map[string]any
			if err := json.Unmarshal(raw, &msg); err != nil {
				continue
			}
			if _, ok := msg["setupComplete"]; ok {
				g.mu.Lock()
				g.ready = true
				g.mu.Unlock()
				g.log.Info("[GeminiLive] setupComplete recebido — sessão ativa")
				setupDone <- nil
				// Inicia a goroutine de leitura contínua
				go g.readLoop()
				return
			}
		}
	}()

	return <-setupDone
}

// buildSetup constrói o payload de setup com voice, tools e system instruction.
func (g *GeminiLiveClient) buildSetup() map[string]any {
	tools := g.buildTools()
	setup := map[string]any{
		"model": geminiLiveModel,
		"generationConfig": map[string]any{
			"responseModalities": []string{"AUDIO"},
			"speechConfig": map[string]any{
				"voiceConfig": map[string]any{
					"prebuiltVoiceConfig": map[string]any{
						"voiceName": orDefault(g.config.VoiceName, "Puck"),
					},
				},
				"languageCode": orDefault(g.config.LanguageCode, "pt-BR"),
			},
			"temperature": g.config.Temperature,
		},
		"inputAudioTranscription":  map[string]any{},
		"outputAudioTranscription": map[string]any{},
		"systemInstruction": map[string]any{
			"parts": []map[string]any{{"text": g.config.SystemInstruction}},
		},
	}
	if len(tools) > 0 {
		setup["tools"] = tools
	}
	return map[string]any{"setup": setup}
}

// buildTools constrói a declaração de ferramentas (predefinidas + customizadas).
func (g *GeminiLiveClient) buildTools() []map[string]any {
	if !g.config.ToolsEnabled {
		return nil
	}
	var decls []map[string]any

	for _, name := range g.config.PredefinedTools {
		switch name {
		case "hangup":
			decls = append(decls, map[string]any{
				"name":        "hangup",
				"description": "Termina a chamada de voz imediatamente e desliga o telefone do cliente.",
				"parameters":  map[string]any{"type": "OBJECT", "properties": map[string]any{}},
			})
		case "human_transfer":
			decls = append(decls, map[string]any{
				"name":        "human_transfer",
				"description": "Transfere a chamada para um atendente humano imediatamente.",
				"parameters":  map[string]any{"type": "OBJECT", "properties": map[string]any{}},
			})
		case "send_message":
			decls = append(decls, map[string]any{
				"name":        "send_message",
				"description": "Envia uma mensagem de texto via WhatsApp para o cliente.",
				"parameters": map[string]any{
					"type": "OBJECT",
					"properties": map[string]any{
						"message": map[string]any{"type": "STRING", "description": "O conteúdo da mensagem a ser enviada."},
						"to":      map[string]any{"type": "STRING", "description": "Número do destinatário com DDI. Se vazio, envia para o cliente atual."},
					},
					"required": []string{"message"},
				},
			})
		case "schedule_call":
			decls = append(decls, map[string]any{
				"name":        "schedule_call",
				"description": "Agenda uma ligação telefônica da IA para este cliente.",
				"parameters": map[string]any{
					"type": "OBJECT",
					"properties": map[string]any{
						"datetime": map[string]any{"type": "STRING", "description": "Data e Hora do agendamento em ISO 8601 UTC."},
						"prompt":   map[string]any{"type": "STRING", "description": "Instruções para a IA na próxima chamada."},
					},
					"required": []string{"datetime"},
				},
			})
		}
	}

	for _, ct := range g.config.CustomTools {
		props := map[string]any{}
		var required []string
		for _, p := range ct.Parameters {
			props[p.Name] = map[string]any{
				"type":        p.Type,
				"description": p.Description,
			}
			if p.Required {
				required = append(required, p.Name)
			}
		}
		decls = append(decls, map[string]any{
			"name":        ct.Name,
			"description": ct.Description,
			"parameters": map[string]any{
				"type":       "OBJECT",
				"properties": props,
				"required":   required,
			},
		})
	}

	if len(decls) == 0 {
		return nil
	}
	return []map[string]any{{"functionDeclarations": decls}}
}

// SendAudio envia um chunk de áudio PCM float32 (16kHz mono) ao Gemini.
func (g *GeminiLiveClient) SendAudio(pcm16 []float32) {
	g.mu.Lock()
	if !g.ready || g.closed {
		g.mu.Unlock()
		return
	}
	g.mu.Unlock()

	// float32 → int16 → bytes → base64
	buf := make([]byte, len(pcm16)*2)
	for i, s := range pcm16 {
		if s > 1 {
			s = 1
		} else if s < -1 {
			s = -1
		}
		var v int16
		if s < 0 {
			v = int16(s * 32768)
		} else {
			v = int16(s * 32767)
		}
		binary.LittleEndian.PutUint16(buf[i*2:], uint16(v))
	}
	b64 := base64.StdEncoding.EncodeToString(buf)

	msg := map[string]any{
		"realtimeInput": map[string]any{
			"audio": map[string]any{
				"data":     b64,
				"mimeType": "audio/pcm;rate=16000",
			},
		},
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	if g.conn != nil && !g.closed {
		_ = g.conn.WriteJSON(msg)
	}
}

// SendText envia um texto ao Gemini (usado para primeira fala / saudação).
func (g *GeminiLiveClient) SendText(text string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.conn == nil || g.closed || !g.ready {
		return
	}
	msg := map[string]any{
		"realtimeInput": map[string]any{
			"text": text,
		},
	}
	_ = g.conn.WriteJSON(msg)
}

// SendToolResponse envia a resposta de uma tool call ao Gemini.
func (g *GeminiLiveClient) SendToolResponse(name, callID string, result map[string]any) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.conn == nil || g.closed {
		return
	}
	msg := map[string]any{
		"toolResponse": map[string]any{
			"functionResponses": []map[string]any{{
				"name":     name,
				"id":       callID,
				"response": map[string]any{"output": result},
			}},
		},
	}
	_ = g.conn.WriteJSON(msg)
}

// Transcript retorna a transcrição acumulada da sessão.
func (g *GeminiLiveClient) Transcript() []TranscriptLine {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make([]TranscriptLine, len(g.transcript))
	copy(out, g.transcript)
	return out
}

// Close encerra a conexão WebSocket.
func (g *GeminiLiveClient) Close() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.closed {
		return
	}
	g.closed = true
	if g.conn != nil {
		_ = g.conn.Close()
	}
}

// readLoop é a goroutine que lê mensagens do Gemini continuamente.
func (g *GeminiLiveClient) readLoop() {
	defer func() {
		g.mu.Lock()
		wasClosed := g.closed
		g.closed = true
		g.mu.Unlock()
		if !wasClosed && g.onClose != nil {
			g.onClose()
		}
	}()

	for {
		_, raw, err := g.conn.ReadMessage()
		if err != nil {
			g.log.Debug("[GeminiLive] readLoop encerrado", "err", err)
			return
		}
		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		g.handleMessage(msg)
	}
}

// handleMessage processa uma mensagem recebida do Gemini.
func (g *GeminiLiveClient) handleMessage(msg map[string]any) {
	// Tool Calls
	if tc, ok := msg["toolCall"].(map[string]any); ok {
		if fcs, ok := tc["functionCalls"].([]any); ok {
			for _, fc := range fcs {
				fcMap, _ := fc.(map[string]any)
				if fcMap == nil {
					continue
				}
				name, _ := fcMap["name"].(string)
				id, _ := fcMap["id"].(string)
				args, _ := fcMap["args"].(map[string]any)
				if args == nil {
					args = map[string]any{}
				}
				g.log.Info("[GeminiLive] Tool call recebido", "name", name)
				if g.onToolCall != nil {
					result := g.onToolCall(name, args)
					g.SendToolResponse(name, id, result)
				}
			}
		}
	}

	// Server Content (áudio + transcrições)
	sc, ok := msg["serverContent"].(map[string]any)
	if !ok {
		return
	}

	// Áudio de saída da IA
	if mt, ok := sc["modelTurn"].(map[string]any); ok {
		if parts, ok := mt["parts"].([]any); ok {
			for _, part := range parts {
				pMap, _ := part.(map[string]any)
				if pMap == nil {
					continue
				}
				if inl, ok := pMap["inlineData"].(map[string]any); ok {
					if b64, ok := inl["data"].(string); ok && b64 != "" {
						pcm := base64ToFloat32PCM(b64)
						if g.onAudioOut != nil && len(pcm) > 0 {
							g.onAudioOut(pcm)
						}
					}
				}
			}
		}
	}

	// Transcrições de áudio de saída (IA)
	if ot, ok := sc["outputTranscription"].(map[string]any); ok {
		if text, ok := ot["text"].(string); ok && text != "" {
			g.appendTranscript("ai", text)
			if g.onText != nil {
				g.onText("ai", text)
			}
		}
	}

	// Transcrições de áudio de entrada (cliente)
	if it, ok := sc["inputTranscription"].(map[string]any); ok {
		if text, ok := it["text"].(string); ok && text != "" {
			g.appendTranscript("client", text)
			if g.onText != nil {
				g.onText("client", text)
			}
		}
	}
}

// appendTranscript adiciona texto à transcrição acumulada.
func (g *GeminiLiveClient) appendTranscript(speaker, text string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	// Concatena se for o mesmo falante consecutivo
	if len(g.transcript) > 0 {
		last := &g.transcript[len(g.transcript)-1]
		if last.Speaker == speaker {
			last.Text += " " + text
			return
		}
	}
	g.transcript = append(g.transcript, TranscriptLine{Speaker: speaker, Text: text})
}

// base64ToFloat32PCM decodifica base64 → int16 LE → float32.
func base64ToFloat32PCM(b64 string) []float32 {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil
	}
	n := len(data) / 2
	out := make([]float32, n)
	for i := 0; i < n; i++ {
		v := int16(binary.LittleEndian.Uint16(data[i*2:]))
		out[i] = float32(v) / 32768.0
	}
	return out
}

// orDefault retorna s se não vazio, senão def.
func orDefault(s, def string) string {
	if s != "" {
		return s
	}
	return def
}

// Downsample24to16 reamostra áudio de 24kHz para 16kHz (ratio 3:2).
func Downsample24to16(in []float32) []float32 {
	if len(in) == 0 {
		return nil
	}
	// Reamostragem linear simples: para cada amostra de saída a 16kHz,
	// interpola na posição correspondente a 24kHz.
	outLen := int(math.Floor(float64(len(in)) * 2.0 / 3.0))
	out := make([]float32, outLen)
	for i := 0; i < outLen; i++ {
		srcPos := float64(i) * 3.0 / 2.0
		idx := int(srcPos)
		frac := float32(srcPos - float64(idx))
		if idx+1 < len(in) {
			out[i] = in[idx]*(1-frac) + in[idx+1]*frac
		} else if idx < len(in) {
			out[i] = in[idx]
		}
	}
	return out
}
