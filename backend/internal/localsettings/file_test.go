package localsettings

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mdm7mo/internal/config"
)

func TestBootstrapGeneratesKeyAndStaysInSetup(t *testing.T) {
	t.Setenv(EnvPath, filepath.Join(t.TempDir(), "local-settings.json"))
	t.Setenv("ADMIN_ACCESS_KEY", "")

	merged, setupMode, err := Bootstrap(config.Config{})
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if !setupMode {
		t.Fatal("want setup mode when no session key is configured")
	}
	if merged.SessionSigningKey != "" {
		t.Fatal("running config must not receive the key until setup is finished")
	}

	doc, err := Read(Path())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(doc.SessionSigningKey) < minSessionKeyLength {
		t.Fatalf("want a generated session key, got length %d", len(doc.SessionSigningKey))
	}
	if len(doc.SetupGate) < minSessionKeyLength {
		t.Fatalf("want a setup gate, got length %d", len(doc.SetupGate))
	}
	if !doc.SetupPending {
		t.Fatal("want setup pending until activate")
	}
	info, err := os.Stat(Path())
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != fileMode {
		t.Fatalf("want mode %o, got %o", fileMode, info.Mode().Perm())
	}
}

func TestBootstrapUsesEnvironmentKeyImmediately(t *testing.T) {
	t.Setenv(EnvPath, filepath.Join(t.TempDir(), "local-settings.json"))
	t.Setenv("ADMIN_ACCESS_KEY", "")
	envKey := strings.Repeat("k", minSessionKeyLength)

	merged, setupMode, err := Bootstrap(config.Config{SessionSigningKey: envKey, TMDBReadToken: "tmdb-from-env"})
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if setupMode {
		t.Fatal("an environment session key skips setup mode")
	}
	if merged.SessionSigningKey != envKey {
		t.Fatalf("want env session key, got %q", merged.SessionSigningKey)
	}
	if merged.TMDBReadToken != "tmdb-from-env" {
		t.Fatalf("want env tmdb token, got %q", merged.TMDBReadToken)
	}
}

func TestBootstrapFillsEmptySecretsFromFileAfterActivation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "local-settings.json")
	t.Setenv(EnvPath, path)
	t.Setenv("ADMIN_ACCESS_KEY", "")

	if _, _, err := Bootstrap(config.Config{}); err != nil {
		t.Fatalf("first bootstrap: %v", err)
	}
	if err := Activate(path); err != nil {
		t.Fatalf("activate: %v", err)
	}
	merged, setupMode, err := Bootstrap(config.Config{})
	if err != nil {
		t.Fatalf("second bootstrap: %v", err)
	}
	if setupMode {
		t.Fatal("activated file must leave setup mode")
	}
	doc, err := Read(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if merged.SessionSigningKey != doc.SessionSigningKey {
		t.Fatal("running config must load the stored session key")
	}
}

func TestUpdateDoesNotEchoOrOverrideEnvironment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-settings.json")
	t.Setenv(EnvPath, path)
	t.Setenv("ADMIN_ACCESS_KEY", "")
	env := config.Config{TMDBReadToken: "from-env"}
	if _, _, err := Bootstrap(env); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	replacement := "from-page"
	empty := ""
	status, err := Update(path, env, Patch{
		TMDBReadToken:  &replacement,
		OMDBAPIKey:     &replacement,
		AdminAccessKey: &empty,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !contains(status.Ignored, "tmdbReadToken") {
		t.Fatalf("want tmdb ignored, got %#v", status.Ignored)
	}
	if status.OMDBConfigured != true || status.OMDBFromEnvironment {
		t.Fatalf("omdb should be stored from the page: %#v", status)
	}
	doc, err := Read(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if doc.TMDBReadToken != "from-env" {
		t.Fatalf("env token was overwritten: %q", doc.TMDBReadToken)
	}
	if doc.OMDBAPIKey != replacement {
		t.Fatalf("page token was not stored: %q", doc.OMDBAPIKey)
	}
	encoded := mustJSON(t, status)
	if strings.Contains(encoded, replacement) || strings.Contains(encoded, "from-env") {
		t.Fatal("status must not include secret values")
	}
}

func TestUpdateRejectsHugeSecret(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-settings.json")
	huge := strings.Repeat("a", maxSecretLength+1)
	_, err := Update(path, config.Config{}, Patch{OMDBAPIKey: &huge})
	if !errors.Is(err, ErrSecretTooLong) {
		t.Fatalf("want ErrSecretTooLong, got %v", err)
	}
}

func TestActivateRejectsShortKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-settings.json")
	if err := writeUnlocked(path, Document{SessionSigningKey: "corta", SetupGate: "gate"}); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := Activate(path); !errors.Is(err, ErrSessionKeyMissing) {
		t.Fatalf("want ErrSessionKeyMissing, got %v", err)
	}
}

func TestFirstSetPrefersEnvironment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-settings.json")
	t.Setenv(EnvPath, path)
	t.Setenv("TMDB_READ_TOKEN", "from-env")
	if err := writeUnlocked(path, Document{TMDBReadToken: "from-file"}); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := FirstSet("TMDB_READ_TOKEN", func(doc Document) string { return doc.TMDBReadToken })
	if err != nil {
		t.Fatalf("first set: %v", err)
	}
	if got != "from-env" {
		t.Fatalf("want env value, got %q", got)
	}

	t.Setenv("TMDB_READ_TOKEN", "")
	got, err = FirstSet("TMDB_READ_TOKEN", func(doc Document) string { return doc.TMDBReadToken })
	if err != nil {
		t.Fatalf("first set file: %v", err)
	}
	if got != "from-file" {
		t.Fatalf("want file value, got %q", got)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func mustJSON(t *testing.T, status Status) string {
	t.Helper()
	payload, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(payload)
}
