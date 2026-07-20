package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type sessionRow struct {
	ID        string
	Name      string
	JID       string
	Webhook   string
	Chatwoot  string
	AIConfig  string
	ProjectID string
	APIKey    string
}

type sessionStore struct{ db *sql.DB }

// newSessionStore cria a tabela de config das sessões no banco PRINCIPAL.
// (O store do whatsmeow de cada sessão fica em um banco separado — ver db.go.)
func newSessionStore(ctx context.Context, db *sql.DB) (*sessionStore, error) {
	// 1. Criar a tabela de projetos
	_, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS projects (
		id             TEXT PRIMARY KEY,
		name           TEXT NOT NULL,
		plan           TEXT NOT NULL DEFAULT 'basic',
		plan_status    TEXT NOT NULL DEFAULT 'active',
		plan_starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		plan_ends_at   TIMESTAMPTZ,
		created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	if err != nil {
		return nil, fmt.Errorf("criar tabela projects: %w", err)
	}

	// 2. Criar a tabela de usuários
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS users (
		id            TEXT PRIMARY KEY,
		email         TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		role          TEXT NOT NULL DEFAULT 'normal',
		project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	if err != nil {
		return nil, fmt.Errorf("criar tabela users: %w", err)
	}

	// 3. Criar a tabela de conexões (sessions)
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS sessions (
		id         TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		jid        TEXT,
		webhook    TEXT,
		chatwoot   TEXT,
		ai_config  TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	if err != nil {
		return nil, err
	}

	// Migração para adicionar colunas webhook, chatwoot, ai_config, project_id, api_key
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS webhook TEXT`)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS chatwoot TEXT`)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ai_config TEXT`)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE CASCADE`)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE`)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`)

	// 4. Executar migrações de dados de legado
	_, _ = db.ExecContext(ctx, `
		INSERT INTO projects (id, name, plan, plan_status, plan_starts_at, plan_ends_at)
		VALUES ('default', 'Projeto Padrão', 'basic', 'active', now(), now() + interval '10 years')
		ON CONFLICT (id) DO NOTHING
	`)
	_, _ = db.ExecContext(ctx, `UPDATE sessions SET project_id = 'default' WHERE project_id IS NULL`)
	_, _ = db.ExecContext(ctx, `UPDATE sessions SET api_key = 'kc_' || md5(random()::text) WHERE api_key IS NULL`)

	// 5. Criar a tabela de agentes (personas)
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS agents (
		id          TEXT PRIMARY KEY,
		session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		name        TEXT NOT NULL,
		description TEXT,
		ai_config   TEXT NOT NULL,
		inbound     BOOLEAN NOT NULL DEFAULT FALSE,
		outbound    BOOLEAN NOT NULL DEFAULT FALSE,
		created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	if err != nil {
		return nil, fmt.Errorf("criar tabela agents: %w", err)
	}


	// Criar a tabela de transcrições de chamada
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS call_transcripts (
		id         SERIAL PRIMARY KEY,
		session_id TEXT NOT NULL,
		call_id    TEXT NOT NULL,
		speaker    TEXT NOT NULL,
		text       TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	if err != nil {
		return nil, fmt.Errorf("criar tabela call_transcripts: %w", err)
	}

	// Criar índice para buscas rápidas por sessão e chamada
	_, _ = db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_call_transcripts_session_call ON call_transcripts(session_id, call_id)`)

	// Histórico de chamadas persistido
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS call_history (
		session_id    TEXT NOT NULL,
		call_id       TEXT NOT NULL,
		owner         TEXT,
		direction     TEXT NOT NULL,
		peer          TEXT NOT NULL,
		started_at    BIGINT NOT NULL,
		ended_at      BIGINT,
		end_reason    TEXT,
		summary       TEXT,
		ticket_opened BOOLEAN NOT NULL DEFAULT FALSE,
		ticket_reason TEXT,
		recording_url TEXT,
		PRIMARY KEY (session_id, call_id)
	)`)
	if err != nil {
		return nil, fmt.Errorf("criar tabela call_history: %w", err)
	}
	_, _ = db.ExecContext(ctx, `ALTER TABLE call_history ADD COLUMN IF NOT EXISTS recording_url TEXT`)

	// Criar a tabela de pesquisas NPS
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS call_ratings (
		id         SERIAL PRIMARY KEY,
		session_id TEXT NOT NULL,
		call_id    TEXT NOT NULL,
		phone      TEXT NOT NULL,
		score      INT NOT NULL,
		comment    TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	if err != nil {
		return nil, fmt.Errorf("criar tabela call_ratings: %w", err)
	}
	_, _ = db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_call_ratings_session ON call_ratings(session_id)`)

	// Criar a tabela de enquetes enviadas
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS sent_polls (
		session_id  TEXT NOT NULL,
		poll_id     TEXT NOT NULL,
		option_hash TEXT NOT NULL,
		option_text TEXT NOT NULL,
		PRIMARY KEY (session_id, poll_id, option_hash)
	)`)
	if err != nil {
		return nil, fmt.Errorf("criar tabela sent_polls: %w", err)
	}
	_, _ = db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_sent_polls_lookup ON sent_polls(session_id, poll_id)`)

	store := &sessionStore{db: db}
	if err := store.bootstrapInitialUserAndProject(ctx); err != nil {
		slog.Error("[Bootstrap] Falha ao executar bootstrap inicial", "err", err)
	}

	return store, nil
}

// bootstrapInitialUserAndProject cria o projeto e usuário admin iniciais caso a tabela de usuários esteja vazia,
// e vincula as conexões ativas/existentes (sessões de WhatsApp) a este projeto inicial para não perder dados.
func (s *sessionStore) bootstrapInitialUserAndProject(ctx context.Context) error {
	adminEmail := strings.TrimSpace(strings.ToLower(envStr("KALLIA_ADMIN_EMAIL", "WACALLS_ADMIN_EMAIL", "")))
	adminPassword := envStr("KALLIA_ADMIN_PASSWORD", "WACALLS_ADMIN_PASSWORD", "")
	projectName := envStr("KALLIA_INITIAL_PROJECT_NAME", "WACALLS_INITIAL_PROJECT_NAME", "")
	projectPlan := envStr("KALLIA_INITIAL_PROJECT_PLAN", "WACALLS_INITIAL_PROJECT_PLAN", "expert")

	// 1. Verificar se já existem usuários cadastrados no banco
	var userCount int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&userCount)
	if err != nil {
		return fmt.Errorf("verificar usuários existentes: %w", err)
	}

	if userCount > 0 {
		// Se já houver usuários, garantir que conexões sem project_id pertençam ao primeiro projeto ativo
		var firstProjectID string
		_ = s.db.QueryRowContext(ctx, `SELECT id FROM projects ORDER BY created_at ASC LIMIT 1`).Scan(&firstProjectID)
		if firstProjectID != "" {
			res, _ := s.db.ExecContext(ctx, `UPDATE sessions SET project_id = $1 WHERE project_id IS NULL OR project_id = '' OR project_id = 'default'`, firstProjectID)
			if n, _ := res.RowsAffected(); n > 0 {
				slog.Info("[Bootstrap] Conexões de WhatsApp órfãs vinculadas ao projeto existente", "projectId", firstProjectID, "count", n)
			}
		}
		return nil
	}

	// 2. Caso não exista NENHUM usuário cadastrado, aplicar valores informados no .env ou padrão
	if adminEmail == "" {
		adminEmail = "kharamhabib@gmail.com"
	}
	if adminPassword == "" {
		adminPassword = "040851"
	}
	if projectName == "" {
		projectName = "KharaMhabib - Kallia"
	}

	// Criar/obter o projeto inicial
	var projectID string
	err = s.db.QueryRowContext(ctx, `SELECT id FROM projects WHERE name = $1 LIMIT 1`, projectName).Scan(&projectID)
	if err != nil || projectID == "" {
		projectID = newSessionID()
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO projects (id, name, plan, plan_status, plan_starts_at, plan_ends_at)
			VALUES ($1, $2, $3, 'active', now(), now() + interval '10 years')
			ON CONFLICT (id) DO NOTHING
		`, projectID, projectName, projectPlan)
		if err != nil {
			return fmt.Errorf("criar projeto inicial de bootstrap: %w", err)
		}
	}

	// Criar o usuário administrador inicial
	hashed, err := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("gerar hash de senha inicial: %w", err)
	}

	userID := newSessionID()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, role, project_id)
		VALUES ($1, $2, $3, 'admin', $4)
		ON CONFLICT (email) DO NOTHING
	`, userID, adminEmail, string(hashed), projectID)
	if err != nil {
		return fmt.Errorf("criar usuário admin inicial: %w", err)
	}

	// 3. Vincular TODAS as conexões de WhatsApp existentes no banco a este projeto inicial
	res, err := s.db.ExecContext(ctx, `UPDATE sessions SET project_id = $1 WHERE project_id IS NULL OR project_id = '' OR project_id = 'default'`, projectID)
	linkedSessionsCount := int64(0)
	if err == nil {
		linkedSessionsCount, _ = res.RowsAffected()
	}

	slog.Info("[Bootstrap] Projeto inicial e usuário admin criados com sucesso!",
		"email", adminEmail,
		"projectId", projectID,
		"projectName", projectName,
		"plan", projectPlan,
		"linkedSessions", linkedSessionsCount,
	)

	return nil
}

func (s *sessionStore) savePollOptions(ctx context.Context, sessionID, pollID string, options []string) error {
	for _, opt := range options {
		h := sha256.Sum256([]byte(opt))
		hashHex := hex.EncodeToString(h[:])
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO sent_polls (session_id, poll_id, option_hash, option_text)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (session_id, poll_id, option_hash) DO NOTHING
		`, sessionID, pollID, hashHex, opt)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *sessionStore) resolvePollOption(ctx context.Context, sessionID, pollID, hashHex string) (string, error) {
	var optText string
	err := s.db.QueryRowContext(ctx, `
		SELECT option_text FROM sent_polls
		WHERE session_id = $1 AND poll_id = $2 AND option_hash = $3
	`, sessionID, pollID, hashHex).Scan(&optText)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return optText, err
}

func (s *sessionStore) deleteCall(ctx context.Context, sessionID, callID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `DELETE FROM call_history WHERE session_id = $1 AND call_id = $2`, sessionID, callID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM call_transcripts WHERE session_id = $1 AND call_id = $2`, sessionID, callID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM call_ratings WHERE session_id = $1 AND call_id = $2`, sessionID, callID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM sent_polls WHERE session_id = $1 AND poll_id = $2`, sessionID, callID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func newSessionID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *sessionStore) getRawSession(ctx context.Context, id string) (*sessionRow, error) {
	r := &sessionRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, COALESCE(jid, ''), COALESCE(webhook, ''), COALESCE(chatwoot, ''), COALESCE(ai_config, ''), COALESCE(project_id, ''), COALESCE(api_key, '')
		FROM sessions WHERE id = $1
	`, id).Scan(&r.ID, &r.Name, &r.JID, &r.Webhook, &r.Chatwoot, &r.AIConfig, &r.ProjectID, &r.APIKey)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (s *sessionStore) listAll(ctx context.Context) ([]sessionRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(jid, ''), COALESCE(webhook, ''), COALESCE(chatwoot, ''), COALESCE(ai_config, ''), COALESCE(project_id, ''), COALESCE(api_key, '')
		FROM sessions ORDER BY created_at
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sessionRow
	for rows.Next() {
		var r sessionRow
		if err := rows.Scan(&r.ID, &r.Name, &r.JID, &r.Webhook, &r.Chatwoot, &r.AIConfig, &r.ProjectID, &r.APIKey); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *sessionStore) list(ctx context.Context, projectID string) ([]sessionRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(jid, ''), COALESCE(webhook, ''), COALESCE(chatwoot, ''), COALESCE(ai_config, ''), COALESCE(project_id, ''), COALESCE(api_key, '')
		FROM sessions WHERE project_id = $1 ORDER BY created_at
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sessionRow
	for rows.Next() {
		var r sessionRow
		if err := rows.Scan(&r.ID, &r.Name, &r.JID, &r.Webhook, &r.Chatwoot, &r.AIConfig, &r.ProjectID, &r.APIKey); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *sessionStore) insert(ctx context.Context, id, name, projectID, apiKey string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (id, name, jid, project_id, api_key)
		VALUES ($1, $2, NULL, $3, $4)
	`, id, name, projectID, apiKey)
	return err
}

func (s *sessionStore) setJID(ctx context.Context, id, jid string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET jid = $1 WHERE id = $2`, jid, id)
	return err
}

func (s *sessionStore) setWebhook(ctx context.Context, id, url string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET webhook = $1 WHERE id = $2`, url, id)
	return err
}

func (s *sessionStore) setChatwoot(ctx context.Context, id, cfgJSON string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET chatwoot = $1 WHERE id = $2`, cfgJSON, id)
	return err
}

func (s *sessionStore) setAIConfig(ctx context.Context, id, cfgJSON string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET ai_config = $1 WHERE id = $2`, cfgJSON, id)
	return err
}

func (s *sessionStore) setName(ctx context.Context, id, name string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET name = $1 WHERE id = $2`, name, id)
	return err
}

func (s *sessionStore) delete(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = $1`, id)
	return err
}

func (s *sessionStore) saveTranscript(ctx context.Context, sessionID, callID string, lines []TranscriptLine) error {
	if len(lines) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO call_transcripts (session_id, call_id, speaker, text, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now()
	for _, line := range lines {
		// Usa o timestamp real da fala quando disponível; senão, o momento do save.
		lineTime := now
		if line.At > 0 {
			lineTime = time.UnixMilli(line.At)
		}
		_, err = stmt.ExecContext(ctx, sessionID, callID, line.Speaker, line.Text, lineTime)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *sessionStore) getTranscript(ctx context.Context, sessionID, callID string) ([]TranscriptLine, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT speaker, text FROM call_transcripts
		WHERE session_id = $1 AND call_id = $2
		ORDER BY id
	`, sessionID, callID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TranscriptLine
	for rows.Next() {
		var line TranscriptLine
		if err := rows.Scan(&line.Speaker, &line.Text); err != nil {
			return nil, err
		}
		out = append(out, line)
	}
	return out, rows.Err()
}

// ---- Histórico de chamadas persistido ----

// saveCallHistory faz upsert do registro encerrado na tabela call_history.
func (s *sessionStore) saveCallHistory(ctx context.Context, rec CallRecord) error {
	var endedAt *int64
	if rec.EndedAt != nil {
		endedAt = rec.EndedAt
	}
	var owner *string
	if rec.Owner != nil {
		owner = rec.Owner
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO call_history (session_id, call_id, owner, direction, peer, started_at, ended_at, end_reason, summary, ticket_opened, ticket_reason, recording_url)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (session_id, call_id) DO UPDATE SET
			owner = EXCLUDED.owner,
			ended_at = EXCLUDED.ended_at,
			end_reason = EXCLUDED.end_reason,
			summary = COALESCE(NULLIF(EXCLUDED.summary, ''), call_history.summary),
			ticket_opened = call_history.ticket_opened OR EXCLUDED.ticket_opened,
			ticket_reason = COALESCE(NULLIF(EXCLUDED.ticket_reason, ''), call_history.ticket_reason),
			recording_url = COALESCE(NULLIF(EXCLUDED.recording_url, ''), call_history.recording_url)
	`, rec.SessionID, rec.CallID, owner, rec.Direction, rec.Peer, rec.StartedAt, endedAt, rec.EndReason, rec.Summary, rec.TicketOpened, rec.TicketReason, rec.RecordingURL)
	return err
}

// listCallHistory devolve os registros mais recentes de uma sessão (ordem cronológica).
func (s *sessionStore) listCallHistory(ctx context.Context, sessionID string, limit int) ([]CallRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT session_id, call_id, owner, direction, peer, started_at, ended_at,
		       COALESCE(end_reason,''), COALESCE(summary,''), ticket_opened, COALESCE(ticket_reason,''), COALESCE(recording_url,'')
		FROM call_history
		WHERE session_id = $1
		ORDER BY started_at DESC
		LIMIT $2
	`, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CallRecord
	for rows.Next() {
		var rec CallRecord
		var owner *string
		var endedAt *int64
		if err := rows.Scan(&rec.SessionID, &rec.CallID, &owner, &rec.Direction, &rec.Peer, &rec.StartedAt, &endedAt, &rec.EndReason, &rec.Summary, &rec.TicketOpened, &rec.TicketReason, &rec.RecordingURL); err != nil {
			return nil, err
		}
		rec.Owner = owner
		rec.EndedAt = endedAt
		rec.Status = StatusEnded
		out = append(out, rec)
	}
	// inverte para ordem cronológica (mais antigo primeiro), igual ao cache do broker
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

// updateCallSummary persiste o resumo de uma chamada do histórico.
func (s *sessionStore) updateCallSummary(ctx context.Context, sessionID, callID, summary string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE call_history SET summary = $3 WHERE session_id = $1 AND call_id = $2`, sessionID, callID, summary)
	return err
}

// updateCallRecording persiste a URL de gravação de uma chamada do histórico.
func (s *sessionStore) updateCallRecording(ctx context.Context, sessionID, callID, recordingURL string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE call_history SET recording_url = $3 WHERE session_id = $1 AND call_id = $2`, sessionID, callID, recordingURL)
	return err
}

// ---- Métodos da Pesquisa NPS ----

type CallRating struct {
	ID        int       `json:"id"`
	SessionID string    `json:"sessionId"`
	CallID    string    `json:"callId"`
	Phone     string    `json:"phone"`
	Score     int       `json:"score"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"createdAt"`
}

type NPSSummary struct {
	Total      int     `json:"total"`
	Average    float64 `json:"average"`
	Promoters  int     `json:"promoters"`
	Neutrals   int     `json:"neutrals"`
	Detractors int     `json:"detractors"`
	NPSScore   float64 `json:"npsScore"`
}

func (s *sessionStore) saveRating(ctx context.Context, r CallRating) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO call_ratings (session_id, call_id, phone, score, comment, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
	`, r.SessionID, r.CallID, r.Phone, r.Score, r.Comment)
	return err
}

func (s *sessionStore) listRatings(ctx context.Context, sessionID string, limit int) ([]CallRating, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, call_id, phone, score, COALESCE(comment, ''), created_at
		FROM call_ratings
		WHERE session_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CallRating
	for rows.Next() {
		var r CallRating
		if err := rows.Scan(&r.ID, &r.SessionID, &r.CallID, &r.Phone, &r.Score, &r.Comment, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *sessionStore) getNPSSummary(ctx context.Context, sessionID string) (NPSSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT score FROM call_ratings WHERE session_id = $1
	`, sessionID)
	if err != nil {
		return NPSSummary{}, err
	}
	defer rows.Close()

	var sum, count, promoters, neutrals, detractors int
	for rows.Next() {
		var score int
		if err := rows.Scan(&score); err != nil {
			return NPSSummary{}, err
		}
		count++
		sum += score
		if score >= 9 {
			promoters++
		} else if score >= 7 {
			neutrals++
		} else {
			detractors++
		}
	}
	if count == 0 {
		return NPSSummary{}, nil
	}

	avg := float64(sum) / float64(count)
	nps := (float64(promoters-detractors) / float64(count)) * 100.0

	return NPSSummary{
		Total:      count,
		Average:    avg,
		Promoters:  promoters,
		Neutrals:   neutrals,
		Detractors: detractors,
		NPSScore:   nps,
	}, nil
}

func (s *sessionStore) checkCallSession(ctx context.Context, sessionID, callID string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM call_history WHERE session_id = $1 AND call_id = $2)`, sessionID, callID).Scan(&exists)
	return exists, err
}

// updateCallTicket persiste a abertura de chamado de uma chamada do histórico.
func (s *sessionStore) updateCallTicket(ctx context.Context, sessionID, callID, reason string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE call_history SET ticket_opened = TRUE, ticket_reason = $3 WHERE session_id = $1 AND call_id = $2`, sessionID, callID, reason)
	return err
}

// pgHistoryPersister adapta o sessionStore à interface HistoryPersister do broker.
// Falhas são logadas e engolidas: o cache em memória segue autoritativo em runtime.
type pgHistoryPersister struct {
	store *sessionStore
	log   *slog.Logger
}

func (p *pgHistoryPersister) SaveCall(rec CallRecord) {
	goSafe(p.log, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := p.store.saveCallHistory(ctx, rec); err != nil {
			p.log.Error("falha ao persistir histórico da chamada", "callId", rec.CallID, "err", err)
		}
	})
}

func (p *pgHistoryPersister) SaveSummary(sessionID, callID, summary string) {
	goSafe(p.log, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := p.store.updateCallSummary(ctx, sessionID, callID, summary); err != nil {
			p.log.Error("falha ao persistir resumo da chamada", "callId", callID, "err", err)
		}
	})
}

func (p *pgHistoryPersister) SaveTicket(sessionID, callID, reason string) {
	goSafe(p.log, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := p.store.updateCallTicket(ctx, sessionID, callID, reason); err != nil {
			p.log.Error("falha ao persistir chamado da chamada", "callId", callID, "err", err)
		}
	})
}

// Structs e CRUD de Projetos, Usuários e Agentes para Multi-Tenancy

type projectRow struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Plan         string     `json:"plan"`
	PlanStatus   string     `json:"planStatus"`
	PlanStartsAt time.Time  `json:"planStartsAt"`
	PlanEndsAt   *time.Time `json:"planEndsAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type userRow struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	ProjectID    *string   `json:"projectId,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

type agentRow struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"sessionId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	AIConfig    string    `json:"aiConfig"`
	Inbound     bool      `json:"inbound"`
	Outbound    bool      `json:"outbound"`
	CreatedAt   time.Time `json:"createdAt"`
}

// --- CRUD Projetos ---

func (s *sessionStore) createProject(ctx context.Context, id, name, plan, planStatus string, start time.Time, end *time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO projects (id, name, plan, plan_status, plan_starts_at, plan_ends_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, name, plan, planStatus, start, end)
	return err
}

func (s *sessionStore) getProject(ctx context.Context, id string) (*projectRow, error) {
	r := &projectRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, plan, plan_status, plan_starts_at, plan_ends_at, created_at
		FROM projects WHERE id = $1
	`, id).Scan(&r.ID, &r.Name, &r.Plan, &r.PlanStatus, &r.PlanStartsAt, &r.PlanEndsAt, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (s *sessionStore) updateProjectBilling(ctx context.Context, id, plan, status string, end *time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE projects SET plan = $1, plan_status = $2, plan_ends_at = $3 WHERE id = $4
	`, plan, status, end, id)
	return err
}

// --- CRUD Usuários ---

func (s *sessionStore) createUser(ctx context.Context, id, email, passwordHash, role, projectID string) error {
	var projVal *string
	if projectID != "" {
		projVal = &projectID
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, role, project_id)
		VALUES ($1, $2, $3, $4, $5)
	`, id, email, passwordHash, role, projVal)
	return err
}

func (s *sessionStore) getUserByEmail(ctx context.Context, email string) (*userRow, error) {
	r := &userRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, email, password_hash, role, project_id, created_at
		FROM users WHERE email = $1
	`, email).Scan(&r.ID, &r.Email, &r.PasswordHash, &r.Role, &r.ProjectID, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (s *sessionStore) getUserByID(ctx context.Context, id string) (*userRow, error) {
	r := &userRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, email, password_hash, role, project_id, created_at
		FROM users WHERE id = $1
	`, id).Scan(&r.ID, &r.Email, &r.PasswordHash, &r.Role, &r.ProjectID, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

// --- CRUD Agentes ---

func (s *sessionStore) createAgent(ctx context.Context, id, sessionID, name, description, aiConfig string, inbound, outbound bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if inbound {
		_, err = tx.ExecContext(ctx, `UPDATE agents SET inbound = FALSE WHERE session_id = $1`, sessionID)
		if err != nil {
			return err
		}
	}
	if outbound {
		_, err = tx.ExecContext(ctx, `UPDATE agents SET outbound = FALSE WHERE session_id = $1`, sessionID)
		if err != nil {
			return err
		}
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO agents (id, session_id, name, description, ai_config, inbound, outbound)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, id, sessionID, name, description, aiConfig, inbound, outbound)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (s *sessionStore) updateAgent(ctx context.Context, id, name, description, aiConfig string, inbound, outbound bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var sessionID string
	err = tx.QueryRowContext(ctx, `SELECT session_id FROM agents WHERE id = $1`, id).Scan(&sessionID)
	if err != nil {
		return err
	}

	if inbound {
		_, err = tx.ExecContext(ctx, `UPDATE agents SET inbound = FALSE WHERE session_id = $1`, sessionID)
		if err != nil {
			return err
		}
	}
	if outbound {
		_, err = tx.ExecContext(ctx, `UPDATE agents SET outbound = FALSE WHERE session_id = $1`, sessionID)
		if err != nil {
			return err
		}
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE agents SET name = $1, description = $2, ai_config = $3, inbound = $4, outbound = $5
		WHERE id = $6
	`, name, description, aiConfig, inbound, outbound, id)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (s *sessionStore) deleteAgent(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM agents WHERE id = $1`, id)
	return err
}

func (s *sessionStore) getAgent(ctx context.Context, id string) (*agentRow, error) {
	r := &agentRow{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, name, COALESCE(description, ''), ai_config, inbound, outbound, created_at
		FROM agents WHERE id = $1
	`, id).Scan(&r.ID, &r.SessionID, &r.Name, &r.Description, &r.AIConfig, &r.Inbound, &r.Outbound, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (s *sessionStore) listAgents(ctx context.Context, sessionID string) ([]agentRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, name, COALESCE(description, ''), ai_config, inbound, outbound, created_at
		FROM agents WHERE session_id = $1 ORDER BY created_at
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []agentRow
	for rows.Next() {
		var r agentRow
		if err := rows.Scan(&r.ID, &r.SessionID, &r.Name, &r.Description, &r.AIConfig, &r.Inbound, &r.Outbound, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *sessionStore) getActiveAgent(ctx context.Context, sessionID string, direction string) (*agentRow, error) {
	r := &agentRow{}
	query := `SELECT id, session_id, name, COALESCE(description, ''), ai_config, inbound, outbound, created_at FROM agents WHERE session_id = $1 AND inbound = TRUE LIMIT 1`
	if direction == "outbound" {
		query = `SELECT id, session_id, name, COALESCE(description, ''), ai_config, inbound, outbound, created_at FROM agents WHERE session_id = $1 AND outbound = TRUE LIMIT 1`
	}
	err := s.db.QueryRowContext(ctx, query, sessionID).Scan(&r.ID, &r.SessionID, &r.Name, &r.Description, &r.AIConfig, &r.Inbound, &r.Outbound, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}
