package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"
)

// goSafe executa fn em uma goroutine protegida por recover: um panic em código
// assíncrono (offer/accept/terminate, webhooks, agentes) vira log em vez de
// derrubar o processo inteiro.
func goSafe(log *slog.Logger, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Error("panic recuperado em goroutine", "panic", r)
			}
		}()
		fn()
	}()
}

// retryableHTTPClient executa req com retries e backoff para erros de rede e
// respostas 5xx. O corpo já deve estar materializado (GetBody é usado nos retries).
func doWithRetry(client *http.Client, makeReq func() (*http.Request, error), attempts int, log *slog.Logger, tag string) (*http.Response, error) {
	backoffs := []time.Duration{500 * time.Millisecond, 2 * time.Second, 5 * time.Second}
	var lastErr error
	for i := 0; i < attempts; i++ {
		if i > 0 {
			delay := backoffs[(i-1)%len(backoffs)]
			log.Debug("retry de requisição HTTP", "tag", tag, "tentativa", i+1, "delay", delay)
			time.Sleep(delay)
		}
		req, err := makeReq()
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode >= 500 && i < attempts-1 {
			_ = resp.Body.Close()
			lastErr = &httpStatusError{code: resp.StatusCode}
			continue
		}
		return resp, nil
	}
	return nil, lastErr
}

type httpStatusError struct{ code int }

func (e *httpStatusError) Error() string { return "http status " + http.StatusText(e.code) }

// configuredLocation devolve o fuso horário configurado via TZ (default
// America/Sao_Paulo), com fallback para UTC se o nome for inválido.
func configuredLocation() *time.Location {
	tz := os.Getenv("TZ")
	if tz == "" {
		tz = "America/Sao_Paulo"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.UTC
	}
	return loc
}
