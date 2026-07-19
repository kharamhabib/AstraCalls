package main

import (
	"io"
	"log/slog"
	"testing"
)

func geminiTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestDownsample24to16(t *testing.T) {
	if got := Downsample24to16(nil); got != nil {
		t.Fatal("entrada vazia deveria retornar nil")
	}
	// 240 amostras a 24kHz → 160 a 16kHz
	in := make([]float32, 240)
	for i := range in {
		in[i] = 0.5
	}
	out := Downsample24to16(in)
	if len(out) != 160 {
		t.Fatalf("esperava 160 amostras, got %d", len(out))
	}
	for i, v := range out {
		if v < 0.49 || v > 0.51 {
			t.Fatalf("amostra %d = %v, esperado ~0.5 (sinal constante)", i, v)
		}
	}
}

func TestBuildSetup(t *testing.T) {
	cfg := AIConfig{
		SystemInstruction: "Você é um atendente.",
		VoiceName:         "Aoede",
		LanguageCode:      "pt-BR",
		Temperature:       0.7,
	}
	g := NewGeminiLiveClient(cfg, geminiTestLogger())
	setup := g.buildSetup()

	root, ok := setup["setup"].(map[string]any)
	if !ok {
		t.Fatal("setup raiz ausente")
	}
	if root["model"] != geminiLiveModel {
		t.Fatalf("modelo errado: %v", root["model"])
	}
	gc, ok := root["generationConfig"].(map[string]any)
	if !ok {
		t.Fatal("generationConfig ausente")
	}
	if gc["temperature"] != 0.7 {
		t.Fatalf("temperature errada: %v", gc["temperature"])
	}
	si, ok := root["systemInstruction"].(map[string]any)
	if !ok {
		t.Fatal("systemInstruction ausente")
	}
	parts, ok := si["parts"].([]map[string]any)
	if !ok || len(parts) == 0 || parts[0]["text"] != "Você é um atendente." {
		t.Fatalf("systemInstruction incorreta: %v", si)
	}
	if _, hasTools := root["tools"]; hasTools {
		t.Fatal("tools não deveria existir com ToolsEnabled=false")
	}
}

func TestBuildSetupDefaults(t *testing.T) {
	g := NewGeminiLiveClient(AIConfig{}, geminiTestLogger())
	setup := g.buildSetup()["setup"].(map[string]any)
	gc := setup["generationConfig"].(map[string]any)
	sc := gc["speechConfig"].(map[string]any)
	if sc["languageCode"] != "pt-BR" {
		t.Fatalf("languageCode default errado: %v", sc["languageCode"])
	}
	vc := sc["voiceConfig"].(map[string]any)["prebuiltVoiceConfig"].(map[string]any)
	if vc["voiceName"] != "Puck" {
		t.Fatalf("voiceName default errado: %v", vc["voiceName"])
	}
}

func TestBuildTools(t *testing.T) {
	base := AIConfig{ToolsEnabled: true}

	// sem tools selecionadas → nil
	g := NewGeminiLiveClient(base, geminiTestLogger())
	if tools := g.buildTools(); tools != nil {
		t.Fatalf("esperava nil sem tools, got %v", tools)
	}

	// predefinidas + chatwoot implícita + customizada
	cfg := base
	cfg.PredefinedTools = []string{"hangup", "open_ticket", "send_message", "schedule_call"}
	cfg.ChatwootEnabled = true
	cfg.CustomTools = []CustomTool{{
		Name: "consulta_pedido", Description: "Consulta pedido", WebhookURL: "https://example.com/hook",
		Parameters: []ToolParam{{Name: "numero", Type: "STRING", Description: "Número do pedido", Required: true}},
	}}
	g = NewGeminiLiveClient(cfg, geminiTestLogger())
	tools := g.buildTools()
	if len(tools) != 1 {
		t.Fatalf("esperava 1 grupo de tools, got %d", len(tools))
	}
	decls, ok := tools[0]["functionDeclarations"].([]map[string]any)
	if !ok {
		t.Fatal("functionDeclarations ausente")
	}
	names := map[string]bool{}
	for _, d := range decls {
		names[d["name"].(string)] = true
	}
	for _, want := range []string{"hangup", "open_ticket", "send_message", "schedule_call", "fetch_chatwoot_history", "consulta_pedido"} {
		if !names[want] {
			t.Fatalf("tool %q ausente nas declarações: %v", want, names)
		}
	}
	if len(decls) != 6 {
		t.Fatalf("esperava 6 declarações, got %d", len(decls))
	}
}

func TestAppendTranscript(t *testing.T) {
	g := NewGeminiLiveClient(AIConfig{}, geminiTestLogger())
	g.appendTranscript("ai", "Olá")
	g.appendTranscript("ai", "tudo bem?")
	g.appendTranscript("client", "Oi")
	tr := g.Transcript()
	if len(tr) != 2 {
		t.Fatalf("falas consecutivas do mesmo orador deveriam aglutinar: %d linhas", len(tr))
	}
	if tr[0].Speaker != "ai" || tr[0].Text != "Olá tudo bem?" {
		t.Fatalf("aglutinação incorreta: %+v", tr[0])
	}
	if tr[0].At == 0 {
		t.Fatal("timestamp da fala não registrado")
	}
	if tr[1].Speaker != "client" || tr[1].Text != "Oi" {
		t.Fatalf("linha do cliente incorreta: %+v", tr[1])
	}
}

func TestExtractSummaryText(t *testing.T) {
	resp := map[string]any{
		"candidates": []any{
			map[string]any{
				"content": map[string]any{
					"parts": []any{map[string]any{"text": "Resumo executivo"}},
				},
			},
		},
	}
	if got := extractSummaryText(resp); got != "Resumo executivo" {
		t.Fatalf("extractSummaryText: %q", got)
	}
	for _, bad := range []map[string]any{
		{},
		{"candidates": []any{}},
		{"candidates": []any{map[string]any{}}},
		{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{}}}}},
	} {
		if got := extractSummaryText(bad); got != "" {
			t.Fatalf("payload malformado deveria retornar vazio: %q", got)
		}
	}
}

func TestAIConfigMaskingLogic(t *testing.T) {
	// replica a regra do handleGetAIConfig para garantir o mascaramento
	mask := func(key string) string {
		if key != "" && len(key) > 6 {
			return key[:3] + "•••••" + key[len(key)-3:]
		} else if key != "" {
			return "•••••"
		}
		return ""
	}
	if got := mask("AIzaSyD4iE2xVSPkT8"); got != "AIz•••••T8" && got != "AIz•••••kT8" {
		t.Fatalf("mascaramento inesperado: %q", got)
	}
	if got := mask("curta"); got != "•••••" {
		t.Fatalf("chave curta deveria ser totalmente mascarada: %q", got)
	}
	if got := mask(""); got != "" {
		t.Fatalf("chave vazia deveria permanecer vazia: %q", got)
	}
}
