package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Proteção contra SSRF (Server-Side Request Forgery) para URLs fornecidas por
// clientes da API (tool-proxy, download de mídia por URL, etc.).
//
// Regras:
//   - apenas esquemas http/https;
//   - o host é resolvido via DNS e TODOS os IPs precisam ser públicos
//     (bloqueia loopback, RFC1918, link-local — inclui o metadata 169.254.169.254,
//     CGNAT, multicast e unspecified);
//   - redirects são revalidados um a um (máx. 5).
//
// WACALLS_ALLOW_PRIVATE_URLS=true desativa o bloqueio de IPs privados (útil
// quando as integrações rodam na mesma LAN/VPS privada).

var errPrivateURL = errors.New("url resolve para endereço privado/interno (SSRF bloqueado)")

// allowPrivateURLs indica se o bloqueio de IPs privados está desativado.
func allowPrivateURLs() bool {
	return strings.EqualFold(envStr("KALLIA_ALLOW_PRIVATE_URLS", "WACALLS_ALLOW_PRIVATE_URLS", ""), "true")
}

type ipLookupFunc func(host string) ([]net.IP, error)

// validateOutboundURL valida uma URL de destino externo. Quando allowPrivate é
// false (e WACALLS_ALLOW_PRIVATE_URLS não está ativa), rejeita hosts que
// resolvem para IPs não públicos.
func validateOutboundURL(raw string, allowPrivate bool) error {
	return validateOutboundURLWithLookup(raw, allowPrivate, net.LookupIP)
}

func validateOutboundURLWithLookup(raw string, allowPrivate bool, lookup ipLookupFunc) error {
	u, err := parseHTTPURL(raw)
	if err != nil {
		return err
	}
	if allowPrivate || allowPrivateURLs() {
		return nil
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") || strings.HasSuffix(strings.ToLower(host), ".internal") {
		return errPrivateURL
	}
	if ip := net.ParseIP(host); ip != nil {
		if !isPublicIP(ip) {
			return errPrivateURL
		}
		return nil
	}
	ips, err := lookup(host)
	if err != nil {
		return fmt.Errorf("dns do host não resolveu: %w", err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("dns do host sem registros")
	}
	for _, ip := range ips {
		if !isPublicIP(ip) {
			return errPrivateURL
		}
	}
	return nil
}

func parseHTTPURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("url inválida: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("esquema não permitido: %q (apenas http/https)", u.Scheme)
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("url sem host")
	}
	return u, nil
}

// isPublicIP retorna false para qualquer IP não roteável publicamente.
func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsPrivate() {
		return false
	}
	// CGNAT 100.64.0.0/10
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return false
		}
		// 0.0.0.0/8, 192.0.0.0/24 (IETF), 198.18.0.0/15 (benchmark), 240.0.0.0/4 (reservado)
		if ip4[0] == 0 || (ip4[0] == 192 && ip4[1] == 0 && ip4[2] == 0) ||
			(ip4[0] == 198 && (ip4[1] == 18 || ip4[1] == 19)) || ip4[0] >= 240 {
			return false
		}
		// Documentação: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 — tratadas como públicas
		// para não quebrar testes/ambientes que as utilizem.
		return true
	}
	// IPv6: ULA (fc00::/7) e link-local (fe80::/10) já cobertos por IsPrivate/IsLinkLocal.
	return true
}

// safeHTTPClient devolve um client que revalida cada redirect com as mesmas
// regras de SSRF (máx. 5 redirects).
func safeHTTPClient(timeout time.Duration, allowPrivate bool) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("muitos redirects")
			}
			return validateOutboundURL(req.URL.String(), allowPrivate)
		},
	}
}
