// Package localsettings guarda en disco las llaves del arranque local.
//
// El archivo no viaja en el repositorio: vive en el volumen de datos del
// servicio. Lo escribe el API y lo leen la web y las herramientas de catálogo.
// El permiso es 0644 porque la web corre con otro usuario y tiene que leer la
// llave de paso y la contraseña del panel. El volumen no está en el árbol del
// código.
package localsettings

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"mdm7mo/internal/config"
)

// EnvPath es la variable con la ruta del archivo. En Docker apunta a
// /data/local-settings.json.
const EnvPath = "LOCAL_SETTINGS_PATH"

// DefaultPath es la ruta cuando nadie definió EnvPath (backend suelto, sin Docker).
const DefaultPath = "data/local-settings.json"

// GateHeader es la cabecera que la web presenta al API para escribir ajustes.
// El navegador no la conoce: la añade el servidor de la web después de comprobar
// que la visita es de localhost.
const GateHeader = "X-TSK-Setup-Gate"

// minSessionKeyLength coincide con el mínimo que exige config.Validate.
const minSessionKeyLength = 32

// maxSettingsBytes rechaza un archivo desproporcionado para este uso.
const maxSettingsBytes = 64 << 10

// maxSecretLength rechaza una llave que no cabe en una credencial real.
const maxSecretLength = 4096

// fileMode permite que el proceso de la web, con otro usuario, lea el archivo.
const fileMode os.FileMode = 0o644

// ErrSessionKeyMissing impide encender el servicio sin una clave de sesión usable.
var ErrSessionKeyMissing = errors.New("localsettings: session signing key is missing or too short")

// ErrSecretTooLong rechaza un cuerpo que intenta guardar basura en una llave.
var ErrSecretTooLong = errors.New("localsettings: secret exceeds the maximum length")

// Document es el archivo de ajustes. Los valores vacíos se omiten al escribir.
type Document struct {
	SessionSigningKey string `json:"sessionSigningKey,omitempty"`
	TMDBReadToken     string `json:"tmdbReadToken,omitempty"`
	OMDBAPIKey        string `json:"omdbApiKey,omitempty"`
	AdminAccessKey    string `json:"adminAccessKey,omitempty"`
	MetricsAccessKey  string `json:"metricsAccessKey,omitempty"`
	SetupGate         string `json:"setupGate,omitempty"`
	SetupPending      bool   `json:"setupPending"`
}

// Patch describe un cambio pedido desde la página. Un puntero nil no toca el
// campo. Una cadena vacía lo borra.
type Patch struct {
	TMDBReadToken    *string `json:"tmdbReadToken"`
	OMDBAPIKey       *string `json:"omdbApiKey"`
	AdminAccessKey   *string `json:"adminAccessKey"`
	MetricsAccessKey *string `json:"metricsAccessKey"`
}

// Status es lo único que sale hacia la página: hay o no hay, nunca el valor.
type Status struct {
	SetupMode                 bool     `json:"setupMode"`
	SessionKeyConfigured      bool     `json:"sessionKeyConfigured"`
	SessionKeyFromEnvironment bool     `json:"sessionKeyFromEnvironment"`
	TMDBConfigured            bool     `json:"tmdbConfigured"`
	TMDBFromEnvironment       bool     `json:"tmdbFromEnvironment"`
	OMDBConfigured            bool     `json:"omdbConfigured"`
	OMDBFromEnvironment       bool     `json:"omdbFromEnvironment"`
	AdminConfigured           bool     `json:"adminConfigured"`
	AdminFromEnvironment      bool     `json:"adminFromEnvironment"`
	MetricsConfigured         bool     `json:"metricsConfigured"`
	MetricsFromEnvironment    bool     `json:"metricsFromEnvironment"`
	Ignored                   []string `json:"ignored,omitempty"`
}

// mu serializa la lectura y la escritura del archivo dentro del proceso.
var mu sync.Mutex

// Path devuelve la ruta efectiva del archivo.
func Path() string {
	if value := strings.TrimSpace(os.Getenv(EnvPath)); value != "" {
		return value
	}
	return DefaultPath
}

// Bootstrap prepara el archivo y devuelve la configuración con la que debe
// arrancar este proceso. setupMode queda en true cuando la clave de sesión aún
// no debe usarse: el proceso solo atiende la preparación hasta el reinicio.
func Bootstrap(env config.Config) (config.Config, bool, error) {
	mu.Lock()
	defer mu.Unlock()

	doc, err := readUnlocked(Path())
	if err != nil {
		return config.Config{}, false, err
	}
	changed := false

	if strings.TrimSpace(doc.SetupGate) == "" {
		gate, err := randomHex(32)
		if err != nil {
			return config.Config{}, false, err
		}
		doc.SetupGate = gate
		changed = true
	}

	envKey := strings.TrimSpace(env.SessionSigningKey)
	if envKey != "" {
		if doc.SessionSigningKey != envKey || doc.SetupPending {
			doc.SessionSigningKey = envKey
			doc.SetupPending = false
			changed = true
		}
	} else if strings.TrimSpace(doc.SessionSigningKey) == "" {
		key, err := randomHex(32)
		if err != nil {
			return config.Config{}, false, err
		}
		doc.SessionSigningKey = key
		doc.SetupPending = true
		changed = true
	}

	changed = mergeEnvSecret(&doc.TMDBReadToken, env.TMDBReadToken) || changed
	changed = mergeEnvSecret(&doc.OMDBAPIKey, env.OMDBAPIKey) || changed
	changed = mergeEnvSecret(&doc.MetricsAccessKey, env.MetricsAccessKey) || changed
	changed = mergeEnvSecret(&doc.AdminAccessKey, adminFromEnv()) || changed

	if changed {
		if err := writeUnlocked(Path(), doc); err != nil {
			return config.Config{}, false, err
		}
	}

	setupMode := envKey == "" && doc.SetupPending
	merged := env
	if !setupMode && merged.SessionSigningKey == "" {
		merged.SessionSigningKey = doc.SessionSigningKey
	}
	if merged.TMDBReadToken == "" {
		merged.TMDBReadToken = doc.TMDBReadToken
	}
	if merged.OMDBAPIKey == "" {
		merged.OMDBAPIKey = doc.OMDBAPIKey
	}
	if merged.MetricsAccessKey == "" {
		merged.MetricsAccessKey = doc.MetricsAccessKey
	}
	return merged, setupMode, nil
}

// Read lee el archivo. Si no existe, devuelve un documento vacío.
func Read(path string) (Document, error) {
	mu.Lock()
	defer mu.Unlock()
	return readUnlocked(path)
}

// Update aplica un parche. Los campos que ya vienen del entorno se ignoran.
func Update(path string, env config.Config, patch Patch) (Status, error) {
	mu.Lock()
	defer mu.Unlock()

	doc, err := readUnlocked(path)
	if err != nil {
		return Status{}, err
	}
	ignored := make([]string, 0)
	if err := applyPatch(&doc.TMDBReadToken, patch.TMDBReadToken, env.TMDBReadToken, "tmdbReadToken", &ignored); err != nil {
		return Status{}, err
	}
	if err := applyPatch(&doc.OMDBAPIKey, patch.OMDBAPIKey, env.OMDBAPIKey, "omdbApiKey", &ignored); err != nil {
		return Status{}, err
	}
	if err := applyPatch(&doc.AdminAccessKey, patch.AdminAccessKey, adminFromEnv(), "adminAccessKey", &ignored); err != nil {
		return Status{}, err
	}
	if err := applyPatch(&doc.MetricsAccessKey, patch.MetricsAccessKey, env.MetricsAccessKey, "metricsAccessKey", &ignored); err != nil {
		return Status{}, err
	}
	if err := writeUnlocked(path, doc); err != nil {
		return Status{}, err
	}
	status := statusFrom(env, doc, env.SessionSigningKey == "" && doc.SetupPending)
	status.Ignored = ignored
	return status, nil
}

// Activate marca la clave de sesión como usable. El proceso que llama tiene
// que reiniciar para empezar a firmar con ella.
func Activate(path string) error {
	mu.Lock()
	defer mu.Unlock()

	doc, err := readUnlocked(path)
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(doc.SessionSigningKey)) < minSessionKeyLength {
		return ErrSessionKeyMissing
	}
	doc.SetupPending = false
	return writeUnlocked(path, doc)
}

// CurrentStatus relee el archivo y arma la respuesta pública.
func CurrentStatus(path string, env config.Config, setupMode bool) (Status, error) {
	mu.Lock()
	defer mu.Unlock()
	doc, err := readUnlocked(path)
	if err != nil {
		return Status{}, err
	}
	return statusFrom(env, doc, setupMode), nil
}

// Gate devuelve la llave de paso actual. Cadena vacía si el archivo no está.
func Gate(path string) (string, error) {
	doc, err := Read(path)
	if err != nil {
		return "", err
	}
	return doc.SetupGate, nil
}

// FirstSet devuelve la variable de entorno si tiene valor y, si no, el campo
// del archivo. Un archivo ausente cuenta como vacío. Un archivo ilegible es un error.
func FirstSet(envName string, pick func(Document) string) (string, error) {
	if value := strings.TrimSpace(os.Getenv(envName)); value != "" {
		return value, nil
	}
	doc, err := Read(Path())
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(pick(doc)), nil
}

func statusFrom(env config.Config, doc Document, setupMode bool) Status {
	adminEnv := adminFromEnv()
	return Status{
		SetupMode:                 setupMode,
		SessionKeyConfigured:      usableKey(env.SessionSigningKey) || usableKey(doc.SessionSigningKey),
		SessionKeyFromEnvironment: strings.TrimSpace(env.SessionSigningKey) != "",
		TMDBConfigured:            strings.TrimSpace(env.TMDBReadToken) != "" || strings.TrimSpace(doc.TMDBReadToken) != "",
		TMDBFromEnvironment:       strings.TrimSpace(env.TMDBReadToken) != "",
		OMDBConfigured:            strings.TrimSpace(env.OMDBAPIKey) != "" || strings.TrimSpace(doc.OMDBAPIKey) != "",
		OMDBFromEnvironment:       strings.TrimSpace(env.OMDBAPIKey) != "",
		AdminConfigured:           adminEnv != "" || strings.TrimSpace(doc.AdminAccessKey) != "",
		AdminFromEnvironment:      adminEnv != "",
		MetricsConfigured:         strings.TrimSpace(env.MetricsAccessKey) != "" || strings.TrimSpace(doc.MetricsAccessKey) != "",
		MetricsFromEnvironment:    strings.TrimSpace(env.MetricsAccessKey) != "",
	}
}

func usableKey(value string) bool {
	return len(strings.TrimSpace(value)) >= minSessionKeyLength
}

func applyPatch(dest *string, incoming *string, envValue string, name string, ignored *[]string) error {
	if incoming == nil {
		return nil
	}
	value := strings.TrimSpace(*incoming)
	if len(value) > maxSecretLength {
		return ErrSecretTooLong
	}
	if strings.TrimSpace(envValue) != "" {
		*ignored = append(*ignored, name)
		return nil
	}
	*dest = value
	return nil
}

func mergeEnvSecret(dest *string, envValue string) bool {
	envValue = strings.TrimSpace(envValue)
	if envValue == "" || *dest == envValue {
		return false
	}
	*dest = envValue
	return true
}

func adminFromEnv() string {
	return strings.TrimSpace(os.Getenv("ADMIN_ACCESS_KEY"))
}

func readUnlocked(path string) (Document, error) {
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Document{}, nil
	}
	if err != nil {
		return Document{}, err
	}
	if len(payload) > maxSettingsBytes {
		return Document{}, errors.New("localsettings: file is too large")
	}
	var doc Document
	if err := json.Unmarshal(payload, &doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

func writeUnlocked(path string, doc Document) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')

	temp, err := os.CreateTemp(directory, ".local-settings-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tempName)
		}
	}()
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Chmod(fileMode); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempName, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func randomHex(byteCount int) (string, error) {
	buf := make([]byte, byteCount)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
