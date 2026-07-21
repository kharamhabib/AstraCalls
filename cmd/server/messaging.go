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
	waBinary "go.mau.fi/whatsmeow/binary"
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
	Type        string `json:"type"` // "quick_reply", "url", "call", "copy", "send_location"
	DisplayText string `json:"display_text"`
	ID          string `json:"id,omitempty"`
	URL         string `json:"url,omitempty"`
	Phone       string `json:"phone,omitempty"`
	CopyCode    string `json:"copy_code,omitempty"`
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
		case "copy":
			name = "cta_copy"
			paramsBytes, _ := json.Marshal(map[string]string{
				"display_text": btn.DisplayText,
				"copy_code":    btn.CopyCode,
			})
			params = string(paramsBytes)
		case "send_location":
			name = "send_location"
			paramsBytes, _ := json.Marshal(map[string]string{
				"display_text": btn.DisplayText,
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
		ViewOnceMessageV2: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				InteractiveMessage: interactiveMsg,
			},
		},
	}

	// Inject standard business/interactive binary nodes so that WhatsApp client displays the buttons.
	bizNode := waBinary.Node{
		Tag: "biz",
		Content: []waBinary.Node{{
			Tag: "interactive",
			Attrs: waBinary.Attrs{"type": "native_flow", "v": "1"},
			Content: []waBinary.Node{{
				Tag: "native_flow",
				Attrs: waBinary.Attrs{"v": "9", "name": "mixed"},
			}},
		}},
	}

	additionalNodes := []waBinary.Node{bizNode}
	// O nó <bot biz_bot="1"> é o responsável pela marcação "IA" com a estrela ao lado do horário.
	// Vamos comentar essa injeção para testar se os botões ainda renderizam sem a marcação.
	/*
	if jid.Server == "s.whatsapp.net" {
		additionalNodes = append(additionalNodes, waBinary.Node{
			Tag:   "bot",
			Attrs: waBinary.Attrs{"biz_bot": "1"},
		})
	}
	*/

	resp, err := sess.getClient().SendMessage(r.Context(), jid, msg, whatsmeow.SendRequestExtra{
		AdditionalNodes: &additionalNodes,
	})
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

type listRowReq struct {
	RowID       string `json:"rowId"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

type listSectionReq struct {
	Title string       `json:"title,omitempty"`
	Rows  []listRowReq `json:"rows"`
}

type sendListReq struct {
	To          string           `json:"to"`
	Title       string           `json:"title,omitempty"`
	Description string           `json:"description"`
	ButtonText  string           `json:"buttonText"`
	Footer      string           `json:"footer,omitempty"`
	Sections    []listSectionReq `json:"sections"`
}

func (s *server) handleSendList(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b sendListReq
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if b.To == "" || b.Description == "" || b.ButtonText == "" || len(b.Sections) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to, description, buttonText and sections required"})
		return
	}

	jid, err := resolveRecipient(b.To)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	sections := make([]*waE2E.ListMessage_Section, 0, len(b.Sections))
	for _, sec := range b.Sections {
		rows := make([]*waE2E.ListMessage_Row, 0, len(sec.Rows))
		for _, row := range sec.Rows {
			rows = append(rows, &waE2E.ListMessage_Row{
				RowID:       proto.String(row.RowID),
				Title:       proto.String(row.Title),
				Description: proto.String(row.Description),
			})
		}
		sections = append(sections, &waE2E.ListMessage_Section{
			Title: proto.String(sec.Title),
			Rows:  rows,
		})
	}

	listMsg := &waE2E.ListMessage{
		Title:       proto.String(b.Title),
		Description: proto.String(b.Description),
		ButtonText:  proto.String(b.ButtonText),
		ListType:    waE2E.ListMessage_SINGLE_SELECT.Enum(),
		Sections:    sections,
	}
	if b.Footer != "" {
		listMsg.FooterText = proto.String(b.Footer)
	}

	msg := &waE2E.Message{
		ViewOnceMessageV2: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				ListMessage: listMsg,
			},
		},
	}

	bizNode := waBinary.Node{
		Tag: "biz",
		Content: []waBinary.Node{{
			Tag: "interactive",
			Attrs: waBinary.Attrs{"type": "native_flow", "v": "1"},
			Content: []waBinary.Node{{
				Tag: "native_flow",
				Attrs: waBinary.Attrs{"v": "9", "name": "mixed"},
			}},
		}},
	}
	additionalNodes := []waBinary.Node{bizNode}

	resp, err := sess.getClient().SendMessage(r.Context(), jid, msg, whatsmeow.SendRequestExtra{
		AdditionalNodes: &additionalNodes,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id": resp.ID, "to": jid.String(), "timestamp": resp.Timestamp.UnixMilli(),
	})
}

type carouselCardReq struct {
	Title   string                 `json:"title,omitempty"`
	Body    string                 `json:"body"`
	Footer  string                 `json:"footer,omitempty"`
	Buttons []interactiveButtonReq `json:"buttons"`
}

type sendCarouselReq struct {
	To    string            `json:"to"`
	Cards []carouselCardReq `json:"cards"`
}

func (s *server) handleSendCarousel(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b sendCarouselReq
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if b.To == "" || len(b.Cards) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to and cards required"})
		return
	}

	jid, err := resolveRecipient(b.To)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	cards := make([]*waE2E.InteractiveMessage, 0, len(b.Cards))
	for _, card := range b.Cards {
		buttons := make([]*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton, 0, len(card.Buttons))
		for _, btn := range card.Buttons {
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
			case "copy":
				name = "cta_copy"
				paramsBytes, _ := json.Marshal(map[string]string{
					"display_text": btn.DisplayText,
					"copy_code":    btn.CopyCode,
				})
				params = string(paramsBytes)
			case "send_location":
				name = "send_location"
				paramsBytes, _ := json.Marshal(map[string]string{
					"display_text": btn.DisplayText,
				})
				params = string(paramsBytes)
			default:
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid button type in carousel: %s", btn.Type)})
				return
			}
			buttons = append(buttons, &waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
				Name:             proto.String(name),
				ButtonParamsJSON: proto.String(params),
			})
		}

		cardMsg := &waE2E.InteractiveMessage{
			Body: &waE2E.InteractiveMessage_Body{
				Text: proto.String(card.Body),
			},
			InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{
				NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
					Buttons: buttons,
				},
			},
		}
		if card.Title != "" {
			cardMsg.Header = &waE2E.InteractiveMessage_Header{
				Title: proto.String(card.Title),
			}
		}
		if card.Footer != "" {
			cardMsg.Footer = &waE2E.InteractiveMessage_Footer{
				Text: proto.String(card.Footer),
			}
		}
		cards = append(cards, cardMsg)
	}

	interactiveMsg := &waE2E.InteractiveMessage{
		InteractiveMessage: &waE2E.InteractiveMessage_CarouselMessage_{
			CarouselMessage: &waE2E.InteractiveMessage_CarouselMessage{
				Cards:            cards,
				MessageVersion:   proto.Int32(1),
				CarouselCardType: waE2E.InteractiveMessage_CarouselMessage_HSCROLL_CARDS.Enum(),
			},
		},
	}

	msg := &waE2E.Message{
		ViewOnceMessageV2: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				InteractiveMessage: interactiveMsg,
			},
		},
	}

	bizNode := waBinary.Node{
		Tag: "biz",
		Content: []waBinary.Node{{
			Tag: "interactive",
			Attrs: waBinary.Attrs{"type": "native_flow", "v": "1"},
			Content: []waBinary.Node{{
				Tag: "native_flow",
				Attrs: waBinary.Attrs{"v": "9", "name": "mixed"},
			}},
		}},
	}
	additionalNodes := []waBinary.Node{bizNode}

	resp, err := sess.getClient().SendMessage(r.Context(), jid, msg, whatsmeow.SendRequestExtra{
		AdditionalNodes: &additionalNodes,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id": resp.ID, "to": jid.String(), "timestamp": resp.Timestamp.UnixMilli(),
	})
}

type sendContactReq struct {
	To          string `json:"to"`
	DisplayName string `json:"displayName"`
	Vcard       string `json:"vcard"`
}

func (s *server) handleSendContact(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b sendContactReq
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if b.To == "" || b.DisplayName == "" || b.Vcard == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to, displayName and vcard required"})
		return
	}

	jid, err := resolveRecipient(b.To)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	msg := &waE2E.Message{
		ContactMessage: &waE2E.ContactMessage{
			DisplayName: proto.String(b.DisplayName),
			Vcard:       proto.String(b.Vcard),
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

type sendLocationReq struct {
	To        string  `json:"to"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Name      string  `json:"name,omitempty"`
	Address   string  `json:"address,omitempty"`
	URL       string  `json:"url,omitempty"`
}

func (s *server) handleSendLocation(w http.ResponseWriter, r *http.Request) {
	sess := s.pairedSession(w, r.PathValue("sid"))
	if sess == nil {
		return
	}
	var b sendLocationReq
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if b.To == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to required"})
		return
	}

	jid, err := resolveRecipient(b.To)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	locMsg := &waE2E.LocationMessage{
		DegreesLatitude:  proto.Float64(b.Latitude),
		DegreesLongitude: proto.Float64(b.Longitude),
	}
	if b.Name != "" {
		locMsg.Name = proto.String(b.Name)
	}
	if b.Address != "" {
		locMsg.Address = proto.String(b.Address)
	}
	if b.URL != "" {
		locMsg.URL = proto.String(b.URL)
	}

	msg := &waE2E.Message{
		LocationMessage: locMsg,
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
