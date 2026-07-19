package main

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// Proxy do Gemini para o modo client-side da IA: a API key do Gemini fica
// SOMENTE no servidor. O navegador conecta nestes endpoints (autenticado por
// ticket ou X-API-Key) e o servidor injeta a key na conexão com o Google.
//
//	GET  /api/sessions/{sid}/gemini/ws               → proxy WebSocket (Gemini Live)
//	POST /api/sessions/{sid}/gemini/generateContent  → proxy REST (resumo pós-chamada)

const geminiLiveWSURL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
const geminiGenerateContentURL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

var geminiWSUpgrader = websocket.Upgrader{
	// A autenticação já foi feita pelo middleware (ticket/X-API-Key); o Origin
	// varia conforme o domínio do painel/Chatwoot.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// handleGeminiWS faz proxy bidirecional do WebSocket do Gemini Live.
func (s *server) handleGeminiWS(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	cfg := sess.getAIConfig()
	if cfg.GeminiAPIKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "gemini api key não configurada"})
		return
	}

	clientConn, err := geminiWSUpgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Warn("gemini proxy: upgrade falhou", "err", err)
		return
	}

	googleURL := fmt.Sprintf("%s?key=%s", geminiLiveWSURL, cfg.GeminiAPIKey)
	googleConn, _, err := websocket.DefaultDialer.Dial(googleURL, nil)
	if err != nil {
		s.log.Error("gemini proxy: dial no Google falhou", "err", err)
		_ = clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "upstream indisponível"))
		_ = clientConn.Close()
		return
	}

	s.log.Info("gemini proxy: sessão WebSocket intermediada", "session", sess.id)

	done := make(chan struct{}, 2)
	proxy := func(dst, src *websocket.Conn) {
		defer func() { done <- struct{}{} }()
		for {
			msgType, data, err := src.ReadMessage()
			if err != nil {
				_ = dst.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
			if err := dst.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	}
	go proxy(googleConn, clientConn) // navegador → Google
	go proxy(clientConn, googleConn) // Google → navegador

	<-done
	_ = clientConn.Close()
	_ = googleConn.Close()
}

// handleGeminiGenerateContent faz proxy do REST generateContent (resumo pós-chamada).
func (s *server) handleGeminiGenerateContent(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	cfg := sess.getAIConfig()
	if cfg.GeminiAPIKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "gemini api key não configurada"})
		return
	}

	googleURL := fmt.Sprintf("%s?key=%s", geminiGenerateContentURL, cfg.GeminiAPIKey)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, googleURL, r.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 10<<20))
}
