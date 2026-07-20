package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

var (
	// mediaHTTP baixa mídias de URLs externas (redirects revalidados pelo SSRF guard).
	mediaHTTP = safeHTTPClient(30*time.Second, false)
	// chatwootMediaHTTP baixa anexos do próprio Chatwoot (LAN permitida; esquema validado).
	chatwootMediaHTTP = safeHTTPClient(30*time.Second, true)
)

// pairedSession devolve a sessão se existir E estiver pareada, ou escreve o erro.
func (s *server) pairedSession(w http.ResponseWriter, sid string) *Session {
	sess := s.sessionByID(w, sid)
	if sess == nil {
		return nil
	}
	if sess.getClient().Store.ID == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "not paired"})
		return nil
	}
	return sess
}

// resolveRecipient aceita um número (DDI+DDD+num) ou um JID completo (com @).
func resolveRecipient(to string) (types.JID, error) {
	to = strings.TrimSpace(to)
	if to == "" {
		return types.JID{}, errors.New("recipient required")
	}
	if strings.Contains(to, "@") {
		return types.ParseJID(to)
	}
	return types.NewJID(normalizePhone(to), types.DefaultUserServer), nil
}

// fetchMedia obtém os bytes da mídia a partir de base64 (data) ou de uma URL.
// Downloads por URL passam pelo guarda de SSRF (apenas http(s) públicos, salvo
// WACALLS_ALLOW_PRIVATE_URLS=true para mídias hospedadas na própria LAN).
func fetchMedia(b64, url string) ([]byte, error) {
	if b64 != "" {
		if strings.HasPrefix(b64, "data:") {
			if i := strings.Index(b64, ","); i > 0 {
				b64 = b64[i+1:]
			}
		}
		return base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	}
	if url != "" {
		if err := validateOutboundURL(url, false); err != nil {
			return nil, err
		}
		resp, err := mediaHTTP.Get(url)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, errors.New("download failed: " + resp.Status)
		}
		return io.ReadAll(io.LimitReader(resp.Body, 100<<20)) // teto de 100MB
	}
	return nil, errors.New("base64 or url required")
}

// fetchChatwootAttachment baixa anexo hospedado no próprio Chatwoot (URLs de
// LAN/VPS privada são legítimas aqui — apenas o esquema é validado).
func fetchChatwootAttachment(url string) ([]byte, error) {
	if _, err := parseHTTPURL(url); err != nil {
		return nil, err
	}
	resp, err := chatwootMediaHTTP.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("download failed: " + resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 100<<20))
}

func (s *server) send(sess *Session, w http.ResponseWriter, r *http.Request, to string, msg *waE2E.Message) {
	jid, err := resolveRecipient(to)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	resp, err := sess.getClient().SendMessage(r.Context(), jid, msg)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": resp.ID, "to": jid.String(), "timestamp": resp.Timestamp.UnixMilli(),
	})
}

// uploadFor faz o download/decode + upload da mídia, retornando a mensagem montada
// pela função builder. Centraliza o tratamento de erro de mídia.
func (s *server) uploadMedia(sess *Session, w http.ResponseWriter, r *http.Request, b64, url string, mt whatsmeow.MediaType) (*whatsmeow.UploadResponse, bool) {
	data, err := fetchMedia(b64, url)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return nil, false
	}
	up, err := sess.getClient().Upload(r.Context(), data, mt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return nil, false
	}
	return &up, true
}

// ---- Handlers de envio ----

func (s *server) handleSendText(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b struct {
		To   string `json:"to"`
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || strings.TrimSpace(b.Text) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to and text required"})
		return
	}
	s.send(sess, w, r, b.To, &waE2E.Message{Conversation: proto.String(b.Text)})
}

func (s *server) handleSendImage(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b struct {
		To, Base64, URL, Caption, Mimetype string
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	up, ok := s.uploadMedia(sess, w, r, b.Base64, b.URL, whatsmeow.MediaImage)
	if !ok {
		return
	}
	mime := b.Mimetype
	if mime == "" {
		mime = "image/jpeg"
	}
	s.send(sess, w, r, b.To, &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
		Caption: proto.String(b.Caption), Mimetype: proto.String(mime),
		URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
		FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: proto.Uint64(up.FileLength),
	}})
}

func (s *server) handleSendAudio(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b struct {
		To, Base64, URL, Mimetype string
		PTT                       bool
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	up, ok := s.uploadMedia(sess, w, r, b.Base64, b.URL, whatsmeow.MediaAudio)
	if !ok {
		return
	}
	mime := b.Mimetype
	if mime == "" {
		mime = "audio/ogg; codecs=opus"
	}
	s.send(sess, w, r, b.To, &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
		Mimetype: proto.String(mime), PTT: proto.Bool(b.PTT),
		URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
		FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: proto.Uint64(up.FileLength),
	}})
}

func (s *server) handleSendVideo(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b struct {
		To, Base64, URL, Caption, Mimetype string
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	up, ok := s.uploadMedia(sess, w, r, b.Base64, b.URL, whatsmeow.MediaVideo)
	if !ok {
		return
	}
	mime := b.Mimetype
	if mime == "" {
		mime = "video/mp4"
	}
	s.send(sess, w, r, b.To, &waE2E.Message{VideoMessage: &waE2E.VideoMessage{
		Caption: proto.String(b.Caption), Mimetype: proto.String(mime),
		URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
		FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: proto.Uint64(up.FileLength),
	}})
}

func (s *server) handleSendDocument(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b struct {
		To, Base64, URL, FileName, Mimetype string
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	up, ok := s.uploadMedia(sess, w, r, b.Base64, b.URL, whatsmeow.MediaDocument)
	if !ok {
		return
	}
	mime := b.Mimetype
	if mime == "" {
		mime = "application/octet-stream"
	}
	name := b.FileName
	if name == "" {
		name = "file"
	}
	s.send(sess, w, r, b.To, &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
		FileName: proto.String(name), Title: proto.String(name), Mimetype: proto.String(mime),
		URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
		FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: proto.Uint64(up.FileLength),
	}})
}

type sendPollReq struct {
	To              string   `json:"to"`
	Name            string   `json:"name"`
	Options         []string `json:"options"`
	SelectableCount int      `json:"selectable_count"`
}

func (s *server) handleSendPoll(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b sendPollReq
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if b.To == "" || b.Name == "" || len(b.Options) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to, name and at least 2 options required"})
		return
	}
	selectableCount := b.SelectableCount
	if selectableCount <= 0 {
		selectableCount = 1
	}

	jid, err := resolveRecipient(b.To)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	msg := sess.getClient().BuildPollCreation(b.Name, b.Options, selectableCount)
	resp, err := sess.getClient().SendMessage(r.Context(), jid, msg)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if err := sess.mgr.store.savePollOptions(r.Context(), sess.id, resp.ID, b.Options); err != nil {
		sess.log.Error("falha ao persistir opcoes da enquete", "session", sess.id, "poll_id", resp.ID, "err", err)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id": resp.ID, "to": jid.String(), "timestamp": resp.Timestamp.UnixMilli(),
	})
}

type interactiveButtonReq struct {
	Type        string `json:"type"` // "quick_reply", "url", "call"
	DisplayText string `json:"display_text"`
	ID          string `json:"id,omitempty"`
	URL         string `json:"url,omitempty"`
	Phone       string `json:"phone,omitempty"`
}

type sendInteractiveReq struct {
	To      string                 `json:"to"`
	Title   string                 `json:"title,omitempty"`
	Body    string                 `json:"body"`
	Footer  string                 `json:"footer,omitempty"`
	Buttons []interactiveButtonReq `json:"buttons"`
}

func (s *server) handleSendInteractive(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b sendInteractiveReq
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if b.To == "" || b.Body == "" || len(b.Buttons) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to, body and at least 1 button required"})
		return
	}

	jid, err := resolveRecipient(b.To)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	buttons := make([]*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton, 0, len(b.Buttons))
	for _, btn := range b.Buttons {
		var params string
		var name string
		switch btn.Type {
		case "quick_reply":
			name = "quick_reply"
			paramsBytes, _ := json.Marshal(map[string]string{
				"display_text": btn.DisplayText,
				"id":           btn.ID,
			})
			params = string(paramsBytes)
		case "url":
			name = "cta_url"
			paramsBytes, _ := json.Marshal(map[string]string{
				"display_text": btn.DisplayText,
				"url":          btn.URL,
				"merchant_url": btn.URL,
			})
			params = string(paramsBytes)
		case "call":
			name = "cta_call"
			paramsBytes, _ := json.Marshal(map[string]string{
				"display_text": btn.DisplayText,
				"phone_number": btn.Phone,
			})
			params = string(paramsBytes)
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid button type: %s", btn.Type)})
			return
		}
		buttons = append(buttons, &waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
			Name:             proto.String(name),
			ButtonParamsJSON: proto.String(params),
		})
	}

	interactiveMsg := &waE2E.InteractiveMessage{
		Body: &waE2E.InteractiveMessage_Body{
			Text: proto.String(b.Body),
		},
		InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{
			NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
				Buttons: buttons,
			},
		},
	}

	if b.Title != "" {
		interactiveMsg.Header = &waE2E.InteractiveMessage_Header{
			Title: proto.String(b.Title),
		}
	}
	if b.Footer != "" {
		interactiveMsg.Footer = &waE2E.InteractiveMessage_Footer{
			Text: proto.String(b.Footer),
		}
	}

	msg := &waE2E.Message{
		ViewOnceMessage: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				InteractiveMessage: interactiveMsg,
			},
		},
	}

	resp, err := sess.getClient().SendMessage(r.Context(), jid, msg)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id": resp.ID, "to": jid.String(), "timestamp": resp.Timestamp.UnixMilli(),
	})
}

// ---- Handlers de configuração do webhook ----

func (s *server) handleSetWebhook(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url required"})
		return
	}
	url := strings.TrimSpace(b.URL)
	sess.setWebhook(url)
	if err := sess.mgr.store.setWebhook(r.Context(), sess.id, url); err != nil {
		sess.log.Error("falha ao persistir webhook", "session", sess.id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar webhook no banco"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"webhook": url})
}

func (s *server) handleGetWebhook(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"webhook": sess.getWebhook()})
}

func (s *server) handleDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionByID(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	sess.setWebhook("")
	if err := sess.mgr.store.setWebhook(r.Context(), sess.id, ""); err != nil {
		sess.log.Error("falha ao remover webhook", "session", sess.id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao remover webhook no banco"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
