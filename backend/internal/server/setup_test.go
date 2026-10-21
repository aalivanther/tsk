package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"mdm7mo/internal/config"
	"mdm7mo/internal/localsettings"
)

func TestSetupStatusHidesSecretsAndRejectsMissingGate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-settings.json")
	t.Setenv(localsettings.EnvPath, path)
	t.Setenv("ADMIN_ACCESS_KEY", "")
	const secret = "token-de-pagina-que-no-debe-salir"
	if _, _, err := localsettings.Bootstrap(config.Config{}); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if _, err := localsettings.Update(path, config.Config{}, localsettings.Patch{OMDBAPIKey: strPtr(secret)}); err != nil {
		t.Fatalf("update: %v", err)
	}
	doc, err := localsettings.Read(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	mux := http.NewServeMux()
	MountSetup(mux, SetupOptions{Path: path, SetupMode: true, Env: config.Config{}})

	denied := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, setupStatusPath, nil)
	mux.ServeHTTP(denied, request)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("want 403 without gate, got %d", denied.Code)
	}

	allowed := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, setupStatusPath, nil)
	request.Header.Set(localsettings.GateHeader, doc.SetupGate)
	mux.ServeHTTP(allowed, request)
	if allowed.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body %s", allowed.Code, allowed.Body.String())
	}
	body := allowed.Body.String()
	if strings.Contains(body, secret) || strings.Contains(body, doc.SessionSigningKey) || strings.Contains(body, doc.SetupGate) {
		t.Fatalf("status leaked a secret: %s", body)
	}
	if !strings.Contains(body, `"setupMode":true`) || !strings.Contains(body, `"omdbConfigured":true`) {
		t.Fatalf("status missing flags: %s", body)
	}
}

func TestSetupActivateRestartsOnlyWithGate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-settings.json")
	t.Setenv(localsettings.EnvPath, path)
	t.Setenv("ADMIN_ACCESS_KEY", "")
	if _, _, err := localsettings.Bootstrap(config.Config{}); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	doc, err := localsettings.Read(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	restarted := false
	mux := http.NewServeMux()
	MountSetup(mux, SetupOptions{
		Path:      path,
		SetupMode: true,
		Restart:   func() { restarted = true },
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, setupActivatePath, bytes.NewReader([]byte("{}")))
	request.Header.Set(localsettings.GateHeader, doc.SetupGate)
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body %s", response.Code, response.Body.String())
	}
	if !restarted {
		t.Fatal("want restart callback")
	}
	updated, err := localsettings.Read(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if updated.SetupPending {
		t.Fatal("activate must clear setup pending")
	}
}

func strPtr(value string) *string {
	return &value
}
