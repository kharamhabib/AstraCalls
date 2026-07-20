package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/encoding/protojson"
)

var webhookClient = &http.Client{Timeout: 10 * time.Second}

// webhookSem limita o número de entregas de webhook em voo (evita milhares de
// goroutines/conexões simultâneas em bursts de mensagens do WhatsApp).
var webhookSem = make(chan struct{}, 32)

// dispatchWebhook envia um evento para a URL de webhook da sessão (se houver),
// de forma assíncrona, com retry (3 tentativas) e concorrência limitada.
// Formato: {session, event, timestamp, data}.
func (s *Session) dispatchWebhook(event string, data any) {
	url := s.getWebhook()
	if url == "" {
		return
	}
	body, err := json.Marshal(map[string]any{
		"session":   s.id,
		"event":     event,
		"timestamp": time.Now().UnixMilli(),
		"data":      data,
	})
	if err != nil {
		return
	}
	// A URL do webhook é configurada pelo operador — apenas o esquema é validado.
	if _, err := parseHTTPURL(url); err != nil {
		s.log.Warn("webhook: url inválida, evento descartado", "url", url, "err", err)
		return
	}
	goSafe(s.log, func() {
		webhookSem <- struct{}{}
		defer func() { <-webhookSem }()
		resp, err := doWithRetry(webhookClient, func() (*http.Request, error) {
			req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
			if err != nil {
				return nil, err
			}
			req.Header.Set("Content-Type", "application/json")
			return req, nil
		}, 3, s.log, "session-webhook")
		if err != nil {
			s.log.Warn("webhook post failed após retries", "url", url, "event", event, "err", err)
			return
		}
		_ = resp.Body.Close()
	})
}

// summarizeMessage extrai os campos úteis de uma mensagem recebida e inclui o
// payload bruto (protojson) para integrações que precisem de mais detalhes.
func summarizeMessage(evt *events.Message) map[string]any {
	info := evt.Info
	out := map[string]any{
		"id":        info.ID,
		"chat":      info.Chat.String(),
		"sender":    info.Sender.String(),
		"fromMe":    info.IsFromMe,
		"pushName":  info.PushName,
		"timestamp": info.Timestamp.UnixMilli(),
		"isGroup":   info.IsGroup,
		"type":      messageType(evt.Message),
		"text":      messageText(evt.Message),
	}

	if btnResp := evt.Message.GetButtonsResponseMessage(); btnResp != nil {
		out["buttonResponse"] = map[string]string{
			"id":   btnResp.GetSelectedButtonID(),
			"text": btnResp.GetSelectedDisplayText(),
		}
	} else if templResp := evt.Message.GetTemplateButtonReplyMessage(); templResp != nil {
		out["buttonResponse"] = map[string]string{
			"id":   templResp.GetSelectedID(),
			"text": templResp.GetSelectedDisplayText(),
		}
	} else if listResp := evt.Message.GetListResponseMessage(); listResp != nil {
		var rowID string
		if listResp.GetSingleSelectReply() != nil {
			rowID = listResp.GetSingleSelectReply().GetSelectedRowID()
		}
		out["buttonResponse"] = map[string]string{
			"id":   rowID,
			"text": listResp.GetTitle(),
		}
	}

	if raw, err := protojson.Marshal(evt.Message); err == nil {
		out["raw"] = json.RawMessage(raw)
	}
	return out
}

func messageText(m *waE2E.Message) string {
	switch {
	case m.GetConversation() != "":
		return m.GetConversation()
	case m.GetExtendedTextMessage() != nil:
		return m.GetExtendedTextMessage().GetText()
	case m.GetImageMessage() != nil:
		return m.GetImageMessage().GetCaption()
	case m.GetVideoMessage() != nil:
		return m.GetVideoMessage().GetCaption()
	case m.GetButtonsResponseMessage() != nil:
		return m.GetButtonsResponseMessage().GetSelectedDisplayText()
	case m.GetTemplateButtonReplyMessage() != nil:
		return m.GetTemplateButtonReplyMessage().GetSelectedDisplayText()
	case m.GetListResponseMessage() != nil:
		return m.GetListResponseMessage().GetTitle()
	}
	return ""
}

func messageType(m *waE2E.Message) string {
	switch {
	case m.GetConversation() != "" || m.GetExtendedTextMessage() != nil:
		return "text"
	case m.GetImageMessage() != nil:
		return "image"
	case m.GetAudioMessage() != nil:
		return "audio"
	case m.GetVideoMessage() != nil:
		return "video"
	case m.GetDocumentMessage() != nil:
		return "document"
	case m.GetStickerMessage() != nil:
		return "sticker"
	case m.GetLocationMessage() != nil:
		return "location"
	case m.GetContactMessage() != nil:
		return "contact"
	case m.GetButtonsResponseMessage() != nil || m.GetTemplateButtonReplyMessage() != nil:
		return "button_reply"
	case m.GetListResponseMessage() != nil:
		return "list_reply"
	}
	return "unknown"
}
