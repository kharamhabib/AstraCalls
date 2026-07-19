package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

func (s *server) handleToolProxy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL     string         `json:"url"`
		Payload map[string]any `json:"payload"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.URL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid payload or missing url"})
		return
	}

	// SSRF guard: só http(s) e destinos públicos (bloqueia metadata de cloud,
	// loopback e IPs privados — configurável via WACALLS_ALLOW_PRIVATE_URLS).
	if err := validateOutboundURL(body.URL, false); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url não permitida: " + err.Error()})
		return
	}

	jsonBytes, err := json.Marshal(body.Payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	client := safeHTTPClient(10*time.Second, false)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, body.URL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	// Teto de 5 MB na resposta (proteção contra payload gigante)
	limited := io.LimitReader(resp.Body, 5<<20)
	var respPayload map[string]any
	if err := json.NewDecoder(limited).Decode(&respPayload); err != nil {
		// Se não for JSON, lê como texto e coloca num campo "output"
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(limited)
		writeJSON(w, resp.StatusCode, map[string]any{"output": buf.String()})
		return
	}

	writeJSON(w, resp.StatusCode, respPayload)
}
