package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestChatIDFromWebhook(t *testing.T) {
	withAttr := map[string]any{
		"conversation": map[string]any{
			"meta": map[string]any{
				"sender": map[string]any{
					"custom_attributes": map[string]any{cwChatIDAttr: "5511998887777@s.whatsapp.net"},
					"phone_number":      "+5511998887777",
				},
			},
		},
	}
	if got := chatIDFromWebhook(withAttr); got != "5511998887777@s.whatsapp.net" {
		t.Fatalf("custom attribute ignorado: %q", got)
	}

	withPhone := map[string]any{
		"conversation": map[string]any{
			"meta": map[string]any{
				"sender": map[string]any{"phone_number": "+55 11 99888-7777"},
			},
		},
	}
	if got := chatIDFromWebhook(withPhone); got != "55 11 99888-7777" {
		t.Fatalf("phone_number fallback: %q", got)
	}

	if got := chatIDFromWebhook(map[string]any{}); got != "" {
		t.Fatalf("payload vazio deveria retornar vazio: %q", got)
	}
}

func TestParseChatwootTime(t *testing.T) {
	// unix segundos
	if tm := parseChatwootTime(float64(1700000000)); tm.Unix() != 1700000000 {
		t.Fatalf("unix seconds: %v", tm)
	}
	// unix ms
	if tm := parseChatwootTime(float64(1700000000000)); tm.UnixMilli() != 1700000000000 {
		t.Fatalf("unix ms: %v", tm)
	}
	// RFC3339
	if tm := parseChatwootTime("2024-01-15T10:30:00Z"); tm.IsZero() || tm.Year() != 2024 {
		t.Fatalf("rfc3339: %v", tm)
	}
	// formato sem timezone com milissegundos
	if tm := parseChatwootTime("2024-01-15T10:30:00.000Z"); tm.IsZero() {
		t.Fatal("formato .000Z não parseou")
	}
	// inválidos
	if tm := parseChatwootTime("lixo"); !tm.IsZero() {
		t.Fatal("string inválida deveria retornar zero")
	}
	if tm := parseChatwootTime(nil); !tm.IsZero() {
		t.Fatal("nil deveria retornar zero")
	}
}

func TestComputeWaveform(t *testing.T) {
	if got := computeWaveform(nil); len(got) != 64 {
		t.Fatalf("waveform vazio deveria ter 64 buckets, got %d", len(got))
	}
	// PCM constante em amplitude máxima (int16) → todos os buckets em 100
	pcm := make([]byte, 2*6400)
	for i := 0; i < len(pcm); i += 2 {
		pcm[i] = 0xFF
		pcm[i+1] = 0x7F
	}
	got := computeWaveform(pcm)
	if len(got) != 64 {
		t.Fatalf("esperava 64 buckets, got %d", len(got))
	}
	for i, b := range got {
		if b != 100 {
			t.Fatalf("bucket %d = %d, esperado 100 (sinal constante normalizado)", i, b)
		}
	}
	// silêncio → zeros
	if got := computeWaveform(make([]byte, 2*6400)); got[0] != 0 || got[63] != 0 {
		t.Fatal("silêncio deveria gerar buckets zerados")
	}
}

func TestCheckWebhookToken(t *testing.T) {
	cfg := ChatwootConfig{WebhookSecret: "tok123"}

	req := httptest.NewRequest("POST", "/api/sessions/x/chatwoot/webhook", nil)
	if cfg.checkWebhookToken(req) {
		t.Fatal("sem token deveria falhar")
	}

	req = httptest.NewRequest("POST", "/api/sessions/x/chatwoot/webhook", nil)
	req.Header.Set("X-Chatwoot-Token", "tok123")
	if !cfg.checkWebhookToken(req) {
		t.Fatal("header correto deveria passar")
	}

	req = httptest.NewRequest("POST", "/api/sessions/x/chatwoot/webhook?token=tok123", nil)
	if !cfg.checkWebhookToken(req) {
		t.Fatal("query token correto deveria passar")
	}

	req = httptest.NewRequest("POST", "/api/sessions/x/chatwoot/webhook?token=errado", nil)
	if cfg.checkWebhookToken(req) {
		t.Fatal("token errado deveria falhar")
	}

	// config sem segredo nunca autoriza
	empty := ChatwootConfig{}
	req = httptest.NewRequest("POST", "/x?token=tok123", nil)
	if empty.checkWebhookToken(req) {
		t.Fatal("sem segredo configurado não deveria autorizar")
	}
}

func TestDigitsOnly(t *testing.T) {
	if got := digitsOnly("+55 (11) 99888-7777"); got != "5511998887777" {
		t.Fatalf("digitsOnly: %q", got)
	}
	if got := digitsOnly(""); got != "" {
		t.Fatalf("digitsOnly vazio: %q", got)
	}
}

func TestConfiguredLocation(t *testing.T) {
	loc := configuredLocation()
	if loc == nil {
		t.Fatal("location nula")
	}
	// default São Paulo (ou TZ do ambiente)
	t.Setenv("TZ", "UTC")
	if loc := configuredLocation(); loc.String() != "UTC" {
		t.Fatalf("esperava UTC, got %s", loc)
	}
	t.Setenv("TZ", "Invalid/Zone")
	if loc := configuredLocation(); loc != time.UTC {
		t.Fatalf("zona inválida deveria cair em UTC, got %s", loc)
	}
}
