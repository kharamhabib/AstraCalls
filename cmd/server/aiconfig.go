package main

import (
	"encoding/json"
	"net/http"
)

type AIConfig struct {
	GeminiAPIKey      string  `json:"geminiApiKey"`
	VoiceName         string  `json:"voiceName"`
	LanguageCode      string  `json:"languageCode"`
	SystemInstruction string  `json:"systemInstruction"`
	AutoAnswer        bool    `json:"autoAnswer"`
	Temperature       float64 `json:"temperature"`
	MaxDurationMin    int     `json:"maxDurationMin"`
	SilenceOperator   bool    `json:"silenceOperator"`
	TranscribeAudio   bool    `json:"transcribeAudio"`
	ScheduledCalls    string  `json:"scheduledCalls"` // Array JSON de agendamentos
	FirstUtterance    string  `json:"firstUtterance"`
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

	sess.setAIConfig(cfg)
	b, _ := json.Marshal(cfg)
	_ = sess.mgr.store.setAIConfig(r.Context(), sess.id, string(b))

	writeJSON(w, http.StatusOK, map[string]any{"aiConfig": cfg})
}

func (s *server) handleGetAIConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}

	cfg := sess.getAIConfig()
	hasKey := cfg.GeminiAPIKey != ""

	writeJSON(w, http.StatusOK, map[string]any{
		"aiConfig": cfg,
		"enabled":  hasKey,
	})
}

func (s *server) handleDeleteAIConfig(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}

	sess.setAIConfig(AIConfig{})
	_ = sess.mgr.store.setAIConfig(r.Context(), sess.id, "")
	w.WriteHeader(http.StatusNoContent)
}
