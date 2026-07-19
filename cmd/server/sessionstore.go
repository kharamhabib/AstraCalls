package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"
)

type sessionRow struct {
	ID       string
	Name     string
	JID      string
	Webhook  string
	Chatwoot string
	AIConfig string
}

type sessionStore struct{ db *sql.DB }

// newSessionStore cria a tabela de config das sessões no banco PRINCIPAL.
// (O store do whatsmeow de cada sessão fica em um banco separado — ver db.go.)
func newSessionStore(ctx context.Context, db *sql.DB) (*sessionStore, error) {
	_, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS sessions (
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
	// migração p/ bancos antigos (Postgres aceita IF NOT EXISTS no ADD COLUMN)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS webhook TEXT`)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS chatwoot TEXT`)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ai_config TEXT`)
	_, _ = db.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`)

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

	return &sessionStore{db: db}, nil
}

func newSessionID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *sessionStore) list(ctx context.Context) ([]sessionRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, COALESCE(jid, ''), COALESCE(webhook, ''), COALESCE(chatwoot, ''), COALESCE(ai_config, '') FROM sessions ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sessionRow
	for rows.Next() {
		var r sessionRow
		if err := rows.Scan(&r.ID, &r.Name, &r.JID, &r.Webhook, &r.Chatwoot, &r.AIConfig); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *sessionStore) insert(ctx context.Context, id, name string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO sessions (id, name, jid) VALUES ($1, $2, NULL)`, id, name)
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
