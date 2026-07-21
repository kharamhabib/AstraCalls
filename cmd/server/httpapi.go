package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"kallia/internal/voip/call"
	"kallia/internal/voip/core"
	"kallia/internal/voip/media"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"golang.org/x/time/rate"
	"google.golang.org/protobuf/proto"
)

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	// Health/liveness (fora de /api, sem auth — usado por Docker/Swarm/Traefik)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /ready", s.handleReady)

	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("GET /api/metrics", s.handleMetrics)
	mux.HandleFunc("GET /api/sessions", s.handleSessionList)
	mux.HandleFunc("POST /api/sessions", s.handleSessionCreate)
	mux.HandleFunc("POST /api/sessions/{sid}/rename", s.handleSessionRename)
	mux.HandleFunc("GET /api/sessions/{sid}/calls", s.handleSessionCalls)
	mux.HandleFunc("DELETE /api/sessions/{sid}", s.handleSessionDelete)
	mux.HandleFunc("POST /api/sessions/{sid}/logout", s.handleSessionLogout)
	mux.HandleFunc("POST /api/sessions/{sid}/pair", s.handleSessionPair)
	mux.HandleFunc("POST /api/sessions/{sid}/calls", s.handleStartCall)
	mux.HandleFunc("POST /api/sessions/{sid}/calls/{id}/webrtc", s.handleWebRTC)
	mux.HandleFunc("POST /api/sessions/{sid}/calls/{id}/accept", s.handleAccept)
	mux.HandleFunc("POST /api/sessions/{sid}/calls/{id}/reject", s.handleReject)
	mux.HandleFunc("DELETE /api/sessions/{sid}/calls/{id}", s.handleEndCall)
	mux.HandleFunc("GET /api/sessions/{sid}/history", s.handleHistory)
	mux.HandleFunc("DELETE /api/sessions/{sid}/history/{callId}", s.handleDeleteHistoryCall)
	mux.HandleFunc("POST /api/sessions/{sid}/history/{callId}/summary", s.handleSaveCallSummary)
	mux.HandleFunc("POST /api/sessions/{sid}/history/{callId}/ticket", s.handleOpenTicket)
	mux.HandleFunc("GET /api/sessions/{sid}/history/{callId}/transcript", s.handleGetCallTranscript)

	// Mensageria (whatsmeow)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/text", s.handleSendText)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/image", s.handleSendImage)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/audio", s.handleSendAudio)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/video", s.handleSendVideo)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/document", s.handleSendDocument)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/poll", s.handleSendPoll)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/interactive", s.handleSendInteractive)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/list", s.handleSendList)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/carousel", s.handleSendCarousel)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/contact", s.handleSendContact)
	mux.HandleFunc("POST /api/sessions/{sid}/messages/location", s.handleSendLocation)

	// Webhook por sessão (recebimento -> Chatwoot etc.)
	mux.HandleFunc("POST /api/sessions/{sid}/webhook", s.handleSetWebhook)
	mux.HandleFunc("GET /api/sessions/{sid}/webhook", s.handleGetWebhook)
	mux.HandleFunc("DELETE /api/sessions/{sid}/webhook", s.handleDeleteWebhook)

	// Integração Chatwoot por sessão
	mux.HandleFunc("POST /api/sessions/{sid}/chatwoot", s.handleSetChatwoot)
	mux.HandleFunc("GET /api/sessions/{sid}/chatwoot", s.handleGetChatwoot)
	mux.HandleFunc("DELETE /api/sessions/{sid}/chatwoot", s.handleDeleteChatwoot)
	mux.HandleFunc("POST /api/sessions/{sid}/chatwoot/webhook", s.handleChatwootWebhook)
	mux.HandleFunc("GET /api/chatwoot/resolve", s.handleChatwootResolve)
	mux.HandleFunc("GET /api/sessions/{sid}/chatwoot-history", s.handleGetChatwootHistory)

	// Configurações de IA por sessão
	mux.HandleFunc("POST /api/sessions/{sid}/ai-config", s.handleSetAIConfig)
	mux.HandleFunc("GET /api/sessions/{sid}/ai-config", s.handleGetAIConfig)
	mux.HandleFunc("DELETE /api/sessions/{sid}/ai-config", s.handleDeleteAIConfig)
	mux.HandleFunc("POST /api/sessions/{sid}/tool-proxy", s.handleToolProxy)

	// Agentes (Personas) por sessão
	mux.HandleFunc("GET /api/sessions/{sid}/agents", s.handleListAgents)
	mux.HandleFunc("POST /api/sessions/{sid}/agents", s.handleCreateAgent)
	mux.HandleFunc("PUT /api/sessions/{sid}/agents/{agentId}", s.handleUpdateAgent)
	mux.HandleFunc("DELETE /api/sessions/{sid}/agents/{agentId}", s.handleDeleteAgent)
	mux.HandleFunc("POST /api/sessions/{sid}/agents/{agentId}/set-active", s.handleSetActiveAgent)

	// Proxy do Gemini (a API key nunca sai do servidor: o navegador conecta aqui)
	mux.HandleFunc("GET /api/sessions/{sid}/gemini/ws", s.handleGeminiWS)
	mux.HandleFunc("POST /api/sessions/{sid}/gemini/generateContent", s.handleGeminiGenerateContent)

	// Gravações de áudio e NPS
	mux.HandleFunc("GET /api/sessions/{sid}/recordings/{callId}", s.handleGetCallRecording)
	mux.HandleFunc("GET /api/sessions/{sid}/nps", s.handleListNPS)
	mux.HandleFunc("GET /api/sessions/{sid}/nps/summary", s.handleNPSSummary)

	mux.HandleFunc("GET /api/sessions/{sid}/contacts/{jid}", s.handleGetContactInfo)

	mux.HandleFunc("POST /api/events/ticket", s.handleEventTicket)
	mux.HandleFunc("GET /api/events", s.handleEvents)

	// Rotas de Autenticação do Usuário
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)

	if s.staticDir != "" {
		if _, err := os.Stat(s.staticDir); err == nil {
			mux.Handle("/", http.FileServer(http.Dir(s.staticDir)))
		}
	}
	var handler http.Handler = s.withCombinedAuth(mux)

	limiters := &apiLimiters{
		global:   NewRateLimiter(rate.Limit(10), 30),
		sessions: NewRateLimiter(rate.Every(time.Minute), 1),
		calls:    NewRateLimiter(rate.Every(12*time.Second), 5),
	}
	handler = s.withRateLimit(handler, limiters)
	handler = withBodyLimit(handler)
	handler = withRequestLog(handler, s.log)

	return withCORS(handler, s.log)
}

// withCORS aplica a política de origens. WACALLS_CORS_ORIGINS (lista separada
// por vírgula) restringe as origens permitidas; sem ela, mantém "*" (necessário
// para o widget do Chatwoot em domínio diverso), com aviso se houver API key.
func withCORS(h http.Handler, log *slog.Logger) http.Handler {
	allowed := parseCSVEnv("KALLIA_CORS_ORIGINS", "WACALLS_CORS_ORIGINS")
	if len(allowed) == 0 && envStr("KALLIA_API_KEY", "WACALLS_API_KEY", "") != "" {
		log.Warn("KALLIA_CORS_ORIGINS não definida — CORS aberto (*). Restrinja para os domínios do painel/Chatwoot em produção.")
	}
	allowedSet := map[string]bool{}
	for _, o := range allowed {
		allowedSet[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if len(allowedSet) == 0 {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else if origin != "" && allowedSet[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Client-Id, X-API-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func parseCSVEnv(primaryKey, fallbackKey string) []string {
	v := strings.TrimSpace(envStr(primaryKey, fallbackKey, ""))
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// withAuth protege as rotas /api/* com uma API key (header X-API-Key).
// Alternativas de autenticação:
//   - ?ticket= (uso único, 30s) para /api/events e /gemini/ws — fluxo preferido
//     para clientes que não enviam headers (EventSource/WebSocket do navegador);
//   - ?apiKey= (DEPRECADO: vaza em logs/histórico — mantido por compatibilidade).
//
// Exceções: o webhook do Chatwoot (autenticado por token próprio no handler)
// e os arquivos estáticos do painel (precisam carregar a tela de login).
func withAuth(h http.Handler, key string, tickets *ticketStore, log *slog.Logger) http.Handler {
	var warnedQueryKey atomic.Bool
	keyBytes := []byte(key)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		guarded := strings.HasPrefix(p, "/api/") && !strings.HasSuffix(p, "/chatwoot/webhook")
		if guarded {
			got := r.Header.Get("X-API-Key")
			if got == "" {
				got = r.URL.Query().Get("apiKey")
				if got != "" && warnedQueryKey.CompareAndSwap(false, true) {
					log.Warn("autenticação via ?apiKey= em query string está DEPRECADA (vaza em logs de proxy e histórico). Migre para X-API-Key ou POST /api/events/ticket.")
				}
			}
			authorized := subtle.ConstantTimeCompare([]byte(got), keyBytes) == 1
			if !authorized {
				// Ticket de uso único para conexões sem header (SSE / WebSocket)
				tk := r.URL.Query().Get("ticket")
				if tk != "" && (p == "/api/events" || strings.HasSuffix(p, "/gemini/ws")) && tickets.consume(tk) {
					authorized = true
				}
			}
			if !authorized {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

// withBodyLimit impõe teto de tamanho aos bodies (DoS por payload gigante).
// Endpoints de mensagens aceitam mídia em base64 (teto maior); demais JSONs, 2MB.
func withBodyLimit(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/") {
			limit := int64(2 << 20) // 2 MB
			if strings.Contains(r.URL.Path, "/messages/") {
				limit = 200 << 20 // 200 MB (mídia em base64)
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		h.ServeHTTP(w, r)
	})
}

// statusRecorder registra o status HTTP preservando http.Flusher (SSE).
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

func (sr *statusRecorder) Flush() {
	if f, ok := sr.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// withRequestLog loga método, path, status e duração de cada requisição.
// 5xx → Warn; demais → Debug (SSE de longa duração só aparece ao encerrar).
func withRequestLog(h http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sr := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		h.ServeHTTP(sr, r)
		dur := time.Since(start)
		if sr.status >= 500 {
			log.Warn("http request", "method", r.Method, "path", r.URL.Path, "status", sr.status, "dur", dur)
		} else {
			log.Debug("http request", "method", r.Method, "path", r.URL.Path, "status", sr.status, "dur", dur)
		}
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func clientID(r *http.Request) string {
	if id := r.Header.Get("X-Client-Id"); id != "" {
		return id
	}
	return r.URL.Query().Get("clientId")
}

func (s *server) sessionByID(w http.ResponseWriter, sid string) *Session {
	sess, ok := s.sessions.Get(sid)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such session"})
		return nil
	}
	return sess
}

func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	s.broker.serveSSE(w, r, clientID(r))
}

// handleEventTicket emite um ticket de uso único (30s) para autenticar a
// conexão SSE/WebSocket sem expor a API key na URL.
func (s *server) handleEventTicket(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ticket": s.tickets.issue(), "ttl": 30})
}

// handleHealthz: liveness simples (processo no ar).
func (s *server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleReady: readiness — verifica conectividade com o Postgres principal.
func (s *server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.mainDB.PingContext(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// handleMetrics: telemetria operacional básica (autenticada).
func (s *server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	infos := s.sessions.infos()
	paired := 0
	for _, i := range infos {
		if i.Paired {
			paired++
		}
	}
	activeCalls := 0
	s.sessions.mu.RLock()
	for _, sess := range s.sessions.sessions {
		activeCalls += sess.reg.count()
	}
	s.sessions.mu.RUnlock()

	s.scheduler.mu.Lock()
	activeAgents := len(s.scheduler.agents)
	s.scheduler.mu.Unlock()

	dbStats := s.mainDB.Stats()
	writeJSON(w, http.StatusOK, map[string]any{
		"uptimeSeconds":    int64(time.Since(s.startedAt).Seconds()),
		"sessions":         len(infos),
		"sessionsPaired":   paired,
		"activeCalls":      activeCalls,
		"activeAIAgents":   activeAgents,
		"goroutines":       runtime.NumGoroutine(),
		"scheduledPending": atomic.LoadInt64(&s.scheduler.activeCount),
		"db": map[string]any{
			"openConnections": dbStats.OpenConnections,
			"inUse":           dbStats.InUse,
			"idle":            dbStats.Idle,
			"waitCount":       dbStats.WaitCount,
		},
	})
}

func (s *server) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"maxCallsPerSession": s.sessions.maxCalls,
	})
}

func (s *server) handleSessionList(w http.ResponseWriter, r *http.Request) {
	projectID, _ := r.Context().Value(ctxKeyProjectID).(string)
	role, _ := r.Context().Value(ctxKeyUserRole).(string)

	all := s.sessions.infos()
	filtered := []SessionInfo{}

	for _, info := range all {
		if role == "appadmin" || info.ProjectID == projectID {
			filtered = append(filtered, info)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"sessions": filtered})
}

func (s *server) handleSessionCalls(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"active":             sess.reg.count(),
		"maxCallsPerSession": s.sessions.maxCalls,
	})
}

func (s *server) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
	if !s.checkWritePermission(w, r) {
		return
	}

	projectID, _ := r.Context().Value(ctxKeyProjectID).(string)
	planStatus, _ := r.Context().Value(ctxKeyPlanStatus).(string)
	role, _ := r.Context().Value(ctxKeyUserRole).(string)

	// Se for appadmin, permite bypass de restrições do projeto
	if role != "appadmin" {
		if projectID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "usuário não está associado a nenhum projeto"})
			return
		}
		if planStatus != "active" {
			writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": "o plano deste projeto está inativo. Regularize o faturamento para gerenciar conexões."})
			return
		}

		// Contar conexões atuais do projeto
		var count int
		err := s.sessions.store.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM sessions WHERE project_id = $1`, projectID).Scan(&count)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "erro ao checar limite de conexões"})
			return
		}

		// Obter plano do projeto
		proj, err := s.sessions.store.getProject(r.Context(), projectID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "erro ao obter projeto"})
			return
		}
		if proj == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "projeto não encontrado"})
			return
		}

		limit := 1
		switch proj.Plan {
		case "advantage":
			limit = 3
		case "expert":
			limit = 5
		}

		if count >= limit {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": fmt.Sprintf("limite de conexões do plano %s atingido (%d/%d)", proj.Plan, count, limit)})
			return
		}
	}

	var body struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "Session"
	}

	// Se o projeto for vazio (como no caso de appadmin sem projeto específico), atribuir "default"
	targetProjectID := projectID
	if targetProjectID == "" {
		targetProjectID = "default"
	}

	id, apiKey, err := s.sessions.Create(name, targetProjectID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "apiKey": apiKey})
}

func (s *server) handleSessionDelete(w http.ResponseWriter, r *http.Request) {
	if !s.checkWritePermission(w, r) {
		return
	}
	if err := s.sessions.Delete(r.Context(), r.PathValue("sid")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSessionRename(w http.ResponseWriter, r *http.Request) {
	if !s.checkWritePermission(w, r) {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
		return
	}
	sid := r.PathValue("sid")
	if err := s.sessions.Rename(r.Context(), sid, name); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleSessionLogout(w http.ResponseWriter, r *http.Request) {
	if !s.checkWritePermission(w, r) {
		return
	}
	if err := s.sessions.Logout(r.Context(), r.PathValue("sid")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSessionPair(w http.ResponseWriter, r *http.Request) {
	if !s.checkWritePermission(w, r) {
		return
	}
	if err := s.sessions.Pair(r.PathValue("sid")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleStartCall(w http.ResponseWriter, r *http.Request) {
	planStatus, _ := r.Context().Value(ctxKeyPlanStatus).(string)
	if planStatus != "active" {
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": "o plano deste projeto está inativo. Regularize o faturamento para realizar ou receber chamadas."})
		return
	}
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doStartCall(sess, w, r)
	}
}

func (s *server) handleWebRTC(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doWebRTC(sess, w, r)
	}
}

func (s *server) handleAccept(w http.ResponseWriter, r *http.Request) {
	planStatus, _ := r.Context().Value(ctxKeyPlanStatus).(string)
	if planStatus != "active" {
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": "o plano deste projeto está inativo. Regularize o faturamento para realizar ou receber chamadas."})
		return
	}
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doAccept(sess, w, r)
	}
}

func (s *server) handleReject(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doReject(sess, w, r)
	}
}

func (s *server) handleEndCall(w http.ResponseWriter, r *http.Request) {
	if sess := s.sessionByID(w, r.PathValue("sid")); sess != nil {
		s.doEndCall(sess, w, r)
	}
}

func (s *server) handleHistory(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	rawRows := s.broker.historyRows(sess.id, 50)
	
	type ExtendedRow struct {
		CallID       string `json:"callId"`
		Peer         string `json:"peer"`
		Phone        string `json:"phone"`
		Name         string `json:"name,omitempty"`
		Direction    string `json:"direction"`
		StartedAt    int64  `json:"startedAt"`
		EndedAt      *int64 `json:"endedAt,omitempty"`
		EndReason    string `json:"endReason,omitempty"`
		Summary      string `json:"summary,omitempty"`
		TicketOpened bool   `json:"ticketOpened,omitempty"`
		TicketReason string `json:"ticketReason,omitempty"`
		RecordingURL string `json:"recordingUrl,omitempty"`
	}
	
	rows := make([]ExtendedRow, 0, len(rawRows))
	for _, row := range rawRows {
		phone := row.Peer
		name := ""
		
		jid, err := types.ParseJID(row.Peer)
		if err == nil {
			phone = jid.User
		cli := sess.getClient()
		if cli != nil && cli.Store != nil {
			if jid.Server == "lid" && cli.Store.LIDs != nil {
				if pn, err := cli.Store.LIDs.GetPNForLID(r.Context(), jid); err == nil && !pn.IsEmpty() {
					phone = pn.User
					jid = pn
				}
			}
			if cli.Store.Contacts != nil {
				if contact, err := cli.Store.Contacts.GetContact(r.Context(), jid); err == nil && contact.Found {
					if contact.FullName != "" {
						name = contact.FullName
					} else if contact.PushName != "" {
						name = contact.PushName
					}
				}
			}
		}
		}
		
		recURL := row.RecordingURL
		if recURL == "" {
			if path := findRecordingPath(row.CallID); path != "" {
				recURL = fmt.Sprintf("/api/sessions/%s/recordings/%s", sess.id, row.CallID)
			}
		}

		rows = append(rows, ExtendedRow{
			CallID:       row.CallID,
			Peer:         row.Peer,
			Phone:        phone,
			Name:         name,
			Direction:    row.Direction,
			StartedAt:    row.StartedAt,
			EndedAt:      row.EndedAt,
			EndReason:    row.EndReason,
			Summary:      row.Summary,
			TicketOpened: row.TicketOpened,
			TicketReason: row.TicketReason,
			RecordingURL: recURL,
		})
	}
	
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows})
}

func (s *server) handleDeleteHistoryCall(w http.ResponseWriter, r *http.Request) {
	if !s.checkWritePermission(w, r) {
		return
	}
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	callID := r.PathValue("callId")
	if callID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "callId required"})
		return
	}

	// 1. Delete recording file if it exists on disk
	if filePath := findRecordingPath(callID); filePath != "" {
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			s.log.Warn("falha ao remover gravacao do disco", "call_id", callID, "path", filePath, "err", err)
		} else {
			s.log.Info("gravacao removida do disco", "call_id", callID, "path", filePath)
		}
	}

	// 2. Delete from database history tables
	if err := s.sessions.store.deleteCall(r.Context(), sess.id, callID); err != nil {
		s.log.Error("falha ao deletar chamada do banco", "session", sess.id, "call_id", callID, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// 3. Remove from broker memory cache
	s.broker.removeCall(sess.id, callID)

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *server) handleSaveCallSummary(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	callID := r.PathValue("callId")
	var body struct {
		Summary string `json:"summary"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	
	s.broker.saveSummary(sess.id, callID, body.Summary)
	writeJSON(w, http.StatusOK, map[string]string{"status": "summary saved"})
}

func (s *server) handleOpenTicket(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	callID := r.PathValue("callId")
	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	
	rec, ok := s.broker.openTicket(callID, body.Reason)

	// Notifica via WhatsApp admin se configurado
	config := sess.getAIConfig()
	if config.PostCall.SendAdmin && config.PostCall.AdminNumber != "" {
		goSafe(s.log, func() {
			adminJid, err := resolveRecipient(config.PostCall.AdminNumber)
			if err == nil {
				peer := callID
				if ok && rec.Peer != "" {
					peer = rec.Peer
				}
				contactName := resolveContactPhoneRaw(context.Background(), sess, peer)
				msg := fmt.Sprintf("⚠️ *Novo Chamado Aberto pela IA (Local)*\n\n• *Cliente:* %s\n• *Sessão:* %s\n• *Motivo:* %s\n• *ID Chamada:* %s", contactName, sess.name, body.Reason, callID)
				_, _ = sess.getClient().SendMessage(context.Background(), adminJid, &waE2E.Message{
					Conversation: proto.String(msg),
				})
			}
		})
	}
	
	writeJSON(w, http.StatusOK, map[string]string{"status": "ticket saved"})
}

func (s *server) handleGetCallTranscript(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	callID := r.PathValue("callId")

	lines, err := s.sessions.store.getTranscript(r.Context(), sess.id, callID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if lines == nil {
		lines = []TranscriptLine{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"transcript": lines})
}

func resolveContactPhoneRaw(ctx context.Context, sess *Session, peer string) string {
	jid, err := types.ParseJID(peer)
	if err != nil {
		return peer
	}
	if jid.Server == "lid" && sess.getClient() != nil && sess.getClient().Store.LIDs != nil {
		if pn, e := sess.getClient().Store.LIDs.GetPNForLID(ctx, jid); e == nil && !pn.IsEmpty() {
			return pn.User
		}
	}
	return jid.User
}

func (s *server) doStartCall(sess *Session, w http.ResponseWriter, r *http.Request) {
	if sess.getClient().Store.ID == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "not paired"})
		return
	}
	var body struct {
		Phone      string `json:"phone"`
		DurationMs int    `json:"duration_ms"`
		Record     bool   `json:"record"`
		AI         bool   `json:"ai"`
		Prompt     string `json:"prompt"`
		Greeting   string `json:"greeting"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Phone) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone required"})
		return
	}
	owner := clientID(r)
	config := sess.getAIConfig()
	isServerAI := body.AI && config.ServerSideAI && config.GeminiAPIKey != ""
	if isServerAI {
		owner = serverOwnerID
	}

	// (removido) regra "1 chamada por operador" — agora o mesmo navegador/aba
	// pode disparar várias ligações na mesma sessão (até -max-calls-per-session).
	if max := s.sessions.maxCalls; max > 0 && sess.reg.count() >= max {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "max concurrent calls"})
		return
	}
	peer := types.NewJID(normalizePhone(body.Phone), types.DefaultUserServer)

	callID, err := sess.startOutgoing(r.Context(), peer, false)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.broker.upsertCall(CallRecord{
		SessionID: sess.id, CallID: callID, Owner: &owner, Direction: "outbound", Peer: peer.String(),
		StartedAt: time.Now().UnixMilli(), Status: StatusRinging,
	})

	if isServerAI {
		ac, ok := sess.reg.get(callID)
		if ok {
			agentConfig := config
			if body.Prompt != "" {
				agentConfig.SystemInstruction = config.SystemInstruction + "\n\nInstrução adicional para esta chamada específica: " + body.Prompt
			}
			if body.Greeting != "" {
				agentConfig.FirstUtterance = body.Greeting
			}
			sess.attachServerAI(ac.cm, callID, "outbound", agentConfig, func(info *call.CallInfo) string {
				return body.Phone
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"call": map[string]string{"callId": callID}})
}

func (s *server) doWebRTC(sess *Session, w http.ResponseWriter, r *http.Request) {
	callID := r.PathValue("id")
	ac, ok := sess.reg.get(callID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}
	var body struct {
		SDPOffer string `json:"sdp_offer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.SDPOffer == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sdp_offer required"})
		return
	}
	bridge, answer, err := NewBridge(body.SDPOffer, s.log)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	browserOpus, ocErr := media.NewOpusCodec(16000, 320)
	if ocErr != nil {
		s.log.Warn("browser Opus codec unavailable — call audio disabled", "err", ocErr)
		browserOpus = nil
	}
	bridge.OnBrowserRTP = func(payload []byte) {
		if browserOpus == nil {
			return
		}
		pcm16, err := browserOpus.Decode(payload)
		if err != nil {
			s.log.Error("OnBrowserRTP: Decode failed", "err", err)
			return
		}
		if len(pcm16) == 0 {
			s.log.Warn("OnBrowserRTP: Decode returned 0 samples")
			return
		}
		ac.cm.FeedCapturedPCM(pcm16)
	}
	bridge.OnTerminalICE = func() {
		go sess.terminateCall(callID, core.EndCallReasonUserEnded)
	}
	sess.setBridge(callID, bridge, browserOpus)
	writeJSON(w, http.StatusOK, map[string]string{"sdp_answer": answer})
}

func (s *server) doAccept(sess *Session, w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ac, ok := sess.reg.get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return
	}

	var body struct {
		AI     bool   `json:"ai"`
		Prompt string `json:"prompt"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	owner := clientID(r)
	config := sess.getAIConfig()
	isServerAI := body.AI && config.ServerSideAI && config.GeminiAPIKey != ""
	if isServerAI {
		owner = serverOwnerID
		if body.Prompt != "" {
			config.SystemInstruction = config.SystemInstruction + "\n\nInstrução adicional para esta chamada específica: " + body.Prompt
		}
	}

	if !isServerAI {
		if other := s.broker.ownerActiveCall(owner); other != "" && other != id {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "operator already on a call"})
			return
		}
	}

	if !s.broker.setOwner(id, owner) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "claimed by another client"})
		return
	}
	s.broker.emitIncomingClaimed(sess.id, id, owner)

	if isServerAI {
		sess.attachServerAI(ac.cm, id, "inbound", config, func(info *call.CallInfo) string {
			peerPhone := info.PeerJid
			if info.CallerPn != "" {
				peerPhone = info.CallerPn
			} else if jid, err := types.ParseJID(peerPhone); err == nil {
				peerPhone = sess.realPhone(jid)
			}
			return peerPhone
		})
	}

	if err := ac.cm.AcceptCall(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"call": map[string]string{"callId": id}})
}

func (s *server) doReject(sess *Session, w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if ac, ok := sess.reg.get(id); ok {
		_ = ac.cm.RejectCall(r.Context(), id, core.EndCallReasonDeclined)
	}
	sess.removeCall(id)
	s.broker.endCall(id, string(core.EndCallReasonDeclined))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) doEndCall(sess *Session, w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if ac, ok := sess.reg.get(id); ok {
		_ = ac.cm.EndCall(r.Context(), core.EndCallReasonUserEnded)
	}
	sess.removeCall(id)
	s.broker.endCall(id, string(core.EndCallReasonUserEnded))
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleGetContactInfo(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	cli := sess.getClient()
	if cli == nil || cli.Store == nil || cli.Store.Contacts == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "not paired"})
		return
	}

	jidStr := r.PathValue("jid")
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		jid = types.NewJID(normalizePhone(jidStr), types.DefaultUserServer)
	}

	var phone string = sess.realPhone(jid)
	if phone != jid.User {
		if parsedJid, err := types.ParseJID(phone + "@" + types.DefaultUserServer); err == nil {
			jid = parsedJid
		}
	}

	var name string
	contact, err := cli.Store.Contacts.GetContact(r.Context(), jid)
	if err == nil && contact.Found {
		if contact.FullName != "" {
			name = contact.FullName
		} else if contact.FirstName != "" {
			name = contact.FirstName
		} else if contact.PushName != "" {
			name = contact.PushName
		}
	}
	if name == "" {
		name = jid.User
	}

	var pictureURL string
	pfpCtx, pfpCancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer pfpCancel()
	pfp, err := cli.GetProfilePictureInfo(pfpCtx, jid, &whatsmeow.GetProfilePictureParams{
		Preview: true,
	})
	if err == nil && pfp != nil {
		pictureURL = pfp.URL
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"jid":        jid.String(),
		"phone":      phone,
		"name":       name,
		"pictureUrl": pictureURL,
	})
}

func normalizePhone(p string) string {
	p = strings.TrimSpace(p)
	p = strings.TrimPrefix(p, "+")
	var b strings.Builder
	for _, c := range p {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// clientLimiter representa um limiter de IP
type clientLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type RateLimiter struct {
	mu      sync.Mutex
	clients map[string]*clientLimiter
	r       rate.Limit
	b       int
}

func NewRateLimiter(r rate.Limit, b int) *RateLimiter {
	rl := &RateLimiter{
		clients: make(map[string]*clientLimiter),
		r:       r,
		b:       b,
	}
	go rl.cleanupLoop()
	return rl
}

func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(10 * time.Minute)
	for range ticker.C {
		rl.mu.Lock()
		for ip, cl := range rl.clients {
			if time.Since(cl.lastSeen) > 30*time.Minute {
				delete(rl.clients, ip)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *RateLimiter) getLimiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	cl, exists := rl.clients[ip]
	if !exists {
		cl = &clientLimiter{
			limiter: rate.NewLimiter(rl.r, rl.b),
		}
		rl.clients[ip] = cl
	}
	cl.lastSeen = time.Now()
	return cl.limiter
}

// trustedProxies é calculado uma vez a partir de WACALLS_TRUSTED_PROXIES
// (IPs ou CIDRs separados por vírgula). X-Forwarded-For só é honrado quando o
// peer direto é um proxy confiável — caso contrário qualquer cliente poderia
// spoofar o header e bypassar o rate limit.
var (
	trustedProxiesOnce sync.Once
	trustedCIDRs       []*net.IPNet
	trustedIPs         map[string]bool
)

func loadTrustedProxies() {
	trustedProxiesOnce.Do(func() {
		trustedIPs = map[string]bool{}
		for _, entry := range parseCSVEnv("KALLIA_TRUSTED_PROXIES", "WACALLS_TRUSTED_PROXIES") {
			if _, cidr, err := net.ParseCIDR(entry); err == nil {
				trustedCIDRs = append(trustedCIDRs, cidr)
				continue
			}
			if ip := net.ParseIP(entry); ip != nil {
				trustedIPs[ip.String()] = true
			}
		}
	})
}

func isTrustedProxy(ip string) bool {
	loadTrustedProxies()
	if trustedIPs[ip] {
		return true
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, cidr := range trustedCIDRs {
		if cidr.Contains(parsed) {
			return true
		}
	}
	return false
}

func getClientIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" && isTrustedProxy(ip) {
		parts := strings.Split(xff, ",")
		if first := strings.TrimSpace(parts[0]); first != "" {
			return first
		}
	}
	return ip
}

type apiLimiters struct {
	global   *RateLimiter
	sessions *RateLimiter
	calls    *RateLimiter
}

func (s *server) withRateLimit(next http.Handler, limiters *apiLimiters) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := getClientIP(r)

		var rl *RateLimiter
		var limit int
		var resetSecs int

		p := r.URL.Path
		if r.Method == "POST" && p == "/api/sessions" {
			rl = limiters.sessions
			limit = 1
			resetSecs = 60
		} else if r.Method == "POST" && strings.HasPrefix(p, "/api/sessions/") && strings.HasSuffix(p, "/calls") {
			rl = limiters.calls
			limit = 5
			resetSecs = 60
		} else {
			rl = limiters.global
			limit = 30
			resetSecs = 1
		}

		lim := rl.getLimiter(ip)
		if !lim.Allow() {
			w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", limit))
			w.Header().Set("X-RateLimit-Remaining", "0")
			w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", resetSecs))
			http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
			return
		}

		tokens := lim.Tokens()
		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", limit))
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", int(tokens)))
		w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", resetSecs))

		next.ServeHTTP(w, r)
	})
}

func (s *server) checkCallSession(ctx context.Context, sessionID, callID string) bool {
	// 1. Check active calls in broker memory
	if rec, ok := s.broker.getCall(callID); ok {
		return rec.SessionID == sessionID
	}
	// 2. Check history in database
	exists, err := s.sessions.store.checkCallSession(ctx, sessionID, callID)
	if err == nil && exists {
		return true
	}
	return false
}

func findRecordingPath(callID string) string {
	// Sanitize callID to prevent path traversal (only allow letters, numbers, underscores, and hyphens)
	for _, r := range callID {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-') {
			return ""
		}
	}

	recordingsDir := filepath.Join("storage", "recordings")
	exactPath := filepath.Join(recordingsDir, fmt.Sprintf("%s.wav", callID))
	if _, err := os.Stat(exactPath); err == nil {
		return exactPath
	}
	entries, err := os.ReadDir(recordingsDir)
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.Contains(entry.Name(), callID) && strings.HasSuffix(entry.Name(), ".wav") {
				return filepath.Join(recordingsDir, entry.Name())
			}
		}
	}
	return ""
}

func (s *server) handleGetCallRecording(w http.ResponseWriter, r *http.Request) {
	sid := r.PathValue("sid")
	callID := r.PathValue("callId")
	if sid == "" || callID == "" {
		http.Error(w, "sid and callId required", http.StatusBadRequest)
		return
	}

	// SEC-03: Validar que a chamada pertence a esta sessão antes de servir o áudio
	if !s.checkCallSession(r.Context(), sid, callID) {
		http.Error(w, "unauthorized or recording not found", http.StatusForbidden)
		return
	}

	filePath := findRecordingPath(callID)
	if filePath == "" {
		http.Error(w, "recording not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", filepath.Base(filePath)))
	http.ServeFile(w, r, filePath)
}

func (s *server) handleListNPS(w http.ResponseWriter, r *http.Request) {
	sid := r.PathValue("sid")
	sess := s.sessionByID(w, sid)
	if sess == nil {
		return
	}
	ratings, err := s.sessions.store.listRatings(r.Context(), sid, 100)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if ratings == nil {
		ratings = []CallRating{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ratings": ratings})
}

func (s *server) handleNPSSummary(w http.ResponseWriter, r *http.Request) {
	sid := r.PathValue("sid")
	sess := s.sessionByID(w, sid)
	if sess == nil {
		return
	}
	summary, err := s.sessions.store.getNPSSummary(r.Context(), sid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": summary})
}

// checkWritePermission valida se o usuário autenticado possui cargo de admin ou appadmin para ações de alteração
func (s *server) checkWritePermission(w http.ResponseWriter, r *http.Request) bool {
	role, _ := r.Context().Value(ctxKeyUserRole).(string)
	if role == "normal" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "seu usuário não tem permissão para realizar esta operação de escrita"})
		return false
	}
	return true
}
