package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// fakeSetupRelay answers the claim like the relay does, taking one code once.
func fakeSetupRelay(t *testing.T) (*httptest.Server, *[]map[string]string) {
	t.Helper()
	var claims []map[string]string
	used := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/claim"):
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			claims = append(claims, body)
			w.Header().Set("Content-Type", "application/json")
			switch {
			case body["code"] == "GOOD-CODE" && !used:
				used = true
				_ = json.NewEncoder(w).Encode(map[string]string{"name": "Bridge on test"})
			case body["code"] == "GOOD-CODE":
				w.WriteHeader(http.StatusGone)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "This setup code expired or was already used.", "code": "expired"})
			default:
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "nope", "code": "wrong"})
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &claims
}

func TestJoinAccountSpendsTheSetupCodeOnce(t *testing.T) {
	srv, claims := fakeSetupRelay(t)
	cfg, err := loadConfig(filepath.Join(t.TempDir(), "bridge.json"), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	// No code: a setup code error, so the install scripts ask for one.
	if err := joinAccount(cfg, "", ""); !errors.As(err, new(setupCodeError)) {
		t.Fatalf("no code: got %v", err)
	}
	// "--code" with nothing after it is no code either.
	if err := joinAccount(cfg, "true", ""); !errors.As(err, new(setupCodeError)) {
		t.Fatalf("empty --code: got %v", err)
	}
	if err := joinAccount(cfg, "BAD0-CODE", ""); !errors.As(err, new(setupCodeError)) || !strings.Contains(err.Error(), "isn't right") {
		t.Fatalf("wrong code: got %v", err)
	}
	if err := joinAccount(cfg, "GOOD-CODE", "printer"); err != nil {
		t.Fatal(err)
	}
	if !cfg.Claimed {
		t.Fatal("not marked as in an account")
	}
	last := (*claims)[len(*claims)-1]
	if last["key"] != cfg.Key || last["place"] != "printer" || last["system"] == "" {
		t.Fatalf("claim sent %v", last)
	}
	// It stays in the account: saved, and never spends a code again.
	again, _ := loadConfig(cfg.path, "")
	if !again.Claimed {
		t.Fatal("the account wasn't saved")
	}
	n := len(*claims)
	if err := joinAccount(again, "GOOD-CODE", ""); err != nil || len(*claims) != n {
		t.Fatalf("claimed again: %v", err)
	}
	// A spent code, on another bridge: expired.
	other, _ := loadConfig(filepath.Join(t.TempDir(), "other.json"), srv.URL)
	if err := joinAccount(other, "GOOD-CODE", ""); !errors.As(err, new(setupCodeError)) || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("used code: got %v", err)
	}
}

// A bridge only ever joins with a setup code: not even a relay that can't be
// reached lets it set up without one (it used to, and then printed an old-style
// pairing link nobody can use).
func TestJoinAccountAlwaysNeedsACode(t *testing.T) {
	cfg, _ := loadConfig(filepath.Join(t.TempDir(), "bridge.json"), "http://127.0.0.1:9")
	if err := joinAccount(cfg, "", ""); !errors.As(err, new(setupCodeError)) || cfg.Claimed {
		t.Fatalf("got %v, claimed %v", err, cfg.Claimed)
	}
	if err := joinAccount(cfg, "GOOD-CODE", ""); err == nil || !strings.Contains(err.Error(), "Couldn't reach") || cfg.Claimed {
		t.Fatalf("unreachable relay: got %v, claimed %v", err, cfg.Claimed)
	}
}
