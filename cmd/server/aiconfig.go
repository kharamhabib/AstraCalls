package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

type ToolParam struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}

type CustomTool struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	WebhookURL  string      `json:"webhookUrl"`
	Parameters  []ToolParam `json:"parameters"`
}

type PostCallActions struct {
	SummaryEnabled bool   `json:"summaryEnabled"`
	SendAdmin      bool   `json:"sendAdmin"`
	AdminNumber    string `json:"adminNumber"`
	SendClient     bool   `json:"sendClient"`
	WebhookEnabled bool   `json:"webhookEnabled"`
	WebhookURL     string `json:"webhookUrl"`
}

type NPSConfig struct {
	Enabled         bool   `json:"enabled"`
	DelaySec        int    `json:"delaySec"`
	MinCallDuration int    `json:"minCallDuration"`
	SupervisorPhone string `json:"supervisorPhone"`
	MessageTemplate string `json:"messageTemplate"`
}

type MissedFollowupConfig struct {
	Enabled         bool   `json:"enabled"`
	DelaySec        int    `json:"delaySec"`
	MessageTemplate string `json:"messageTemplate"`
}

var DefaultToolPrompts = map[string]string{
	"hangup":        "* Ferramenta hangup (Desligar Chamada): Quando a conversa estiver resolvida, o cliente se despedir e não houver mais nenhuma pendência, agradeça pelo contato, despeça-se educadamente e chame a ferramenta hangup para desligar a ligação. Nunca deixe a ligação em silêncio ou pendente após a despedida.",
	"open_ticket":   "* Ferramenta open_ticket (Abrir Chamado): Use esta ferramenta quando o cliente solicitar falar com um atendente humano, suporte ou precisar de ajuda especializada que a IA não consiga resolver. Pergunte brevemente o motivo do chamado, informe ao cliente que o chamado foi registrado/aberto e pergunte educadamente se há mais alguma coisa em que você possa ajudar. Não desligue a chamada após usar esta ferramenta — apenas aguarde a resposta do cliente e use a ferramenta hangup para finalizar quando ele não precisar de mais nada.",
	"send_message":  "* Ferramenta send_message (Enviar WhatsApp): Use esta ferramenta quando o cliente solicitar que você envie informações por escrito, como um código de barras, chave Pix, link de confirmação, ou endereço. Diga ao cliente: \"Estou te enviando esses dados agora mesmo no seu WhatsApp\" e execute a ferramenta.",
	"schedule_call": "* Ferramenta schedule_call (Reagendar/Agendar Ligação): Se o cliente disser que não pode falar no momento, pedir para retornar mais tarde, ou solicitar um lembrete (ex: \"me ligue e confirme a reunião as 10 da manhã\"), pergunte educadamente pela data e hora desejada. Calcule a data/hora exata relativa ao horário atual ([today]) e execute esta ferramenta preenchendo o parâmetro 'datetime' em formato ISO e 'prompt' com o roteiro ou lembrete (ex: \"Confirmar reunião\"). Confirme para o cliente o agendamento antes de desligar.",
}

type AIConfig struct {
	ServerSideAI      bool                 `json:"serverSideAI"`
	GeminiAPIKey      string               `json:"geminiApiKey"`
	VoiceName         string               `json:"voiceName"`
	LanguageCode      string               `json:"languageCode"`
	SystemInstruction string               `json:"systemInstruction"`
	AutoAnswer        bool                 `json:"autoAnswer"`
	AutoAnswerDelay   int                  `json:"autoAnswerDelay"`
	Temperature       float64              `json:"temperature"`
	MaxDurationMin    int                  `json:"maxDurationMin"`
	SilenceOperator   bool                 `json:"silenceOperator"`
	TranscribeAudio   bool                 `json:"transcribeAudio"`
	ScheduledCalls    string               `json:"scheduledCalls"` // Array JSON de agendamentos
	FirstUtterance    string               `json:"firstUtterance"`
	ToolsEnabled      bool                 `json:"toolsEnabled"`
	PredefinedTools   []string             `json:"predefinedTools"`
	ToolPrompts       map[string]string    `json:"toolPrompts"`
	CustomTools       []CustomTool         `json:"customTools"`
	PostCall          PostCallActions      `json:"postCall"`
	NPS               NPSConfig            `json:"nps"`
	MissedFollowup    MissedFollowupConfig `json:"missedFollowup"`
	CustomFields      string               `json:"customFields"`
	ChatwootEnabled   bool                 `json:"chatwootEnabled"`
}

func (s *server) handleSetAIConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}

	var cfg AIConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid payload"})
		return
	}

	existing := sess.getAIConfig()
	if strings.Contains(cfg.GeminiAPIKey, "•••••") {
		cfg.GeminiAPIKey = existing.GeminiAPIKey
	}

	sess.setAIConfig(cfg)
	b, _ := json.Marshal(cfg)
	if err := sess.mgr.store.setAIConfig(r.Context(), sess.id, string(b)); err != nil {
		sess.log.Error("falha ao persistir ai-config", "session", sess.id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar configuração no banco"})
		return
	}

	if sess.mgr.Scheduler != nil {
		sess.mgr.Scheduler.RecalculateActiveCount()
	}

	writeJSON(w, http.StatusOK, map[string]any{"aiConfig": cfg})
}

func (s *server) handleGetAIConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}

	cfg := sess.getAIConfig()
	hasKey := cfg.GeminiAPIKey != ""

	if hasKey && len(cfg.GeminiAPIKey) > 6 {
		cfg.GeminiAPIKey = cfg.GeminiAPIKey[:3] + "•••••" + cfg.GeminiAPIKey[len(cfg.GeminiAPIKey)-3:]
	} else if hasKey {
		cfg.GeminiAPIKey = "•••••"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"aiConfig": cfg,
		"enabled":  hasKey,
		// Indica ao cliente que a key pode ser usada via proxy do servidor
		// (sem expor a key no navegador) — ver /api/sessions/{sid}/gemini/*.
		"geminiProxy": true,
	})
}

func (s *server) handleDeleteAIConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}

	sess.setAIConfig(AIConfig{})
	if err := sess.mgr.store.setAIConfig(r.Context(), sess.id, ""); err != nil {
		sess.log.Error("falha ao remover ai-config", "session", sess.id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao remover configuração no banco"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
