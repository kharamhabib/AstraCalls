package main

import (
	"errors"
	"net"
	"strings"
	"testing"
)

func fakeLookup(ips ...string) ipLookupFunc {
	return func(host string) ([]net.IP, error) {
		var out []net.IP
		for _, s := range ips {
			out = append(out, net.ParseIP(s))
		}
		return out, nil
	}
}

func TestValidateOutboundURL(t *testing.T) {
	publicLookup := fakeLookup("93.184.216.34")
	privateLookup := fakeLookup("192.168.1.10")
	mixedLookup := fakeLookup("93.184.216.34", "10.0.0.5")
	failLookup := func(host string) ([]net.IP, error) { return nil, errors.New("nxdomain") }

	cases := []struct {
		name         string
		raw          string
		allowPrivate bool
		lookup       ipLookupFunc
		wantErr      bool
	}{
		{"http publico ok", "http://example.com/hook", false, publicLookup, false},
		{"https publico ok", "https://hooks.example.com/path?q=1", false, publicLookup, false},
		{"esquema ftp bloqueado", "ftp://example.com", false, publicLookup, true},
		{"esquema file bloqueado", "file:///etc/passwd", false, publicLookup, true},
		{"gopher bloqueado", "gopher://127.0.0.1:6379/", false, publicLookup, true},
		{"sem host", "http://", false, publicLookup, true},
		{"ip loopback literal", "http://127.0.0.1/admin", false, publicLookup, true},
		{"ip privado literal", "http://10.0.0.8/internal", false, publicLookup, true},
		{"metadata cloud literal", "http://169.254.169.254/latest/meta-data", false, publicLookup, true},
		{"cgnat literal", "http://100.64.1.1/", false, publicLookup, true},
		{"ipv6 loopback", "http://[::1]:8080/", false, publicLookup, true},
		{"ipv6 publico", "http://[2606:4700:4700::1111]/", false, publicLookup, false},
		{"localhost nome", "http://localhost:9000/hook", false, publicLookup, true},
		{"sub localhost", "http://app.localhost/hook", false, publicLookup, true},
		{"dominio interno", "http://db.internal/query", false, publicLookup, true},
		{"dns privado", "http://intranet.corp/hook", false, privateLookup, true},
		{"dns misto (1 privado) bloqueia", "http://cdn.example.com/", false, mixedLookup, true},
		{"dns falha", "http://naoexiste.example/", false, failLookup, true},
		{"privado permitido", "http://10.0.0.8/internal", true, privateLookup, false},
		{"privado permitido sem lookup", "http://192.168.0.20/", true, failLookup, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOutboundURLWithLookup(tc.raw, tc.allowPrivate, tc.lookup)
			if tc.wantErr && err == nil {
				t.Fatalf("esperava erro para %q", tc.raw)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("não esperava erro para %q: %v", tc.raw, err)
			}
		})
	}
}

func TestValidateOutboundURLAllowPrivateSkipsDNS(t *testing.T) {
	called := false
	lookup := func(host string) ([]net.IP, error) {
		called = true
		return nil, nil
	}
	if err := validateOutboundURLWithLookup("http://qualquer.host.local/", true, lookup); err != nil {
		t.Fatalf("allowPrivate não deveria falhar: %v", err)
	}
	if called {
		t.Fatal("allowPrivate não deveria consultar DNS")
	}
}

func TestPrivateURLErrorMessage(t *testing.T) {
	err := validateOutboundURLWithLookup("http://127.0.0.1/", false, fakeLookup("127.0.0.1"))
	if !errors.Is(err, errPrivateURL) && !strings.Contains(err.Error(), "SSRF") {
		t.Fatalf("esperava errPrivateURL, got %v", err)
	}
}
