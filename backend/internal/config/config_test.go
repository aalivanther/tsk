// Archivo: config_test.go — Pruebas de la validación de configuración de arranque.
// En español: verifican que Validate() rechaza las configuraciones inseguras (clave de firma ausente o
// demasiado corta) y acepta una clave decente, y que Load() aplica los valores por defecto y respeta
// las variables de entorno definidas.
package config

import (
	"strings"
	"testing"
)

// TestValidateRejectsMissingSigningKey: sin clave de firma, el backend NO debe arrancar.
func TestValidateRejectsMissingSigningKey(t *testing.T) {
	cfg := Config{SessionSigningKey: ""}
	if err := cfg.Validate(); err == nil {
		t.Fatal("want error for missing SESSION_SIGNING_KEY, got nil")
	}
}

// TestValidateRejectsShortSigningKey: una clave corta es forjable; también debe impedir el arranque.
func TestValidateRejectsShortSigningKey(t *testing.T) {
	cfg := Config{SessionSigningKey: "corta"}
	err := cfg.Validate()
	if err == nil {
		t.Fatal("want error for short SESSION_SIGNING_KEY, got nil")
	}
	if !strings.Contains(err.Error(), "corta") {
		t.Fatalf("want a clear 'too short' error message, got: %v", err)
	}
}

// TestValidateAcceptsStrongSigningKey: una clave de longitud suficiente pasa la validación.
func TestValidateAcceptsStrongSigningKey(t *testing.T) {
	cfg := Config{SessionSigningKey: strings.Repeat("a", minSessionSigningKeyLength)}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("want nil for strong key, got: %v", err)
	}
}

// TestLoadAppliesDefaults: sin variables definidas, Load() entrega los valores por defecto documentados.
func TestLoadAppliesDefaults(t *testing.T) {
	// t.Setenv con valor vacío también nos protege de variables ya presentes en el entorno de CI/dev.
	for _, key := range []string{
		"PORT", "SEED_PATH", "TMDB_READ_TOKEN", "OMDB_API_KEY",
		"SESSION_SIGNING_KEY", "AUTH_DATA_PATH", "CORS_ALLOWED_ORIGIN",
	} {
		t.Setenv(key, "")
	}

	cfg := Load()
	if cfg.Port != defaultPort {
		t.Fatalf("want default port %q, got %q", defaultPort, cfg.Port)
	}
	if cfg.SeedPath != defaultSeedPath {
		t.Fatalf("want default seed path %q, got %q", defaultSeedPath, cfg.SeedPath)
	}
	if cfg.AuthDataPath != defaultAuthDataPath {
		t.Fatalf("want default auth data path %q, got %q", defaultAuthDataPath, cfg.AuthDataPath)
	}
	if cfg.CORSAllowedOrigin != defaultCORSAllowedOrigin {
		t.Fatalf("want default CORS origin %q, got %q", defaultCORSAllowedOrigin, cfg.CORSAllowedOrigin)
	}
}

// TestLoadTrimsAndReadsEnv: Load() respeta las variables definidas y recorta espacios accidentales.
func TestLoadTrimsAndReadsEnv(t *testing.T) {
	t.Setenv("PORT", "  9090  ")
	t.Setenv("SESSION_SIGNING_KEY", "  clave-con-espacios-alrededor-0123456789  ")

	cfg := Load()
	if cfg.Port != "9090" {
		t.Fatalf("want trimmed port 9090, got %q", cfg.Port)
	}
	if cfg.SessionSigningKey != "clave-con-espacios-alrededor-0123456789" {
		t.Fatalf("want trimmed signing key, got %q", cfg.SessionSigningKey)
	}
}
