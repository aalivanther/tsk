package server

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"mdm7mo/internal/config"
	"mdm7mo/internal/localsettings"
)

// Rutas de preparación local. Las atiende el mismo proceso del API.
const (
	setupStatusPath   = "/setup/status"
	setupSettingsPath = "/setup/settings"
	setupActivatePath = "/setup/activate"
)

// SetupOptions configura el grupo de rutas /setup.
type SetupOptions struct {
	// Path es el archivo de ajustes.
	Path string
	// SetupMode es el estado de ESTE proceso. No cambia hasta el reinicio.
	SetupMode bool
	// Env es la configuración leída del entorno, antes de mezclar el archivo.
	Env config.Config
	// Restart pide el reinicio del proceso después de encender. Puede ser nil en pruebas.
	Restart func()
}

// MountSetup publica las tres rutas de preparación.
func MountSetup(mux *http.ServeMux, opts SetupOptions) {
	handler := setupHandler{opts: opts}
	mux.HandleFunc(setupStatusPath, handler.status)
	mux.HandleFunc(setupSettingsPath, handler.settings)
	mux.HandleFunc(setupActivatePath, handler.activate)
}

type setupHandler struct {
	opts SetupOptions
}

func (h setupHandler) status(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.allowed(writer, request) {
		return
	}
	status, err := localsettings.CurrentStatus(h.opts.Path, h.opts.Env, h.opts.SetupMode)
	if err != nil {
		http.Error(writer, "settings unreadable", http.StatusInternalServerError)
		return
	}
	writeSetupJSON(writer, http.StatusOK, status)
}

func (h setupHandler) settings(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.allowed(writer, request) {
		return
	}
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var patch localsettings.Patch
	if err := decoder.Decode(&patch); err != nil {
		http.Error(writer, "invalid settings", http.StatusBadRequest)
		return
	}
	status, err := localsettings.Update(h.opts.Path, h.opts.Env, patch)
	if err != nil {
		writeSetupError(writer, err)
		return
	}
	writeSetupJSON(writer, http.StatusOK, status)
}

func (h setupHandler) activate(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.allowed(writer, request) {
		return
	}
	if err := localsettings.Activate(h.opts.Path); err != nil {
		writeSetupError(writer, err)
		return
	}
	writeSetupJSON(writer, http.StatusOK, map[string]bool{"restarting": true})
	if h.opts.Restart != nil {
		h.opts.Restart()
	}
}

func (h setupHandler) allowed(writer http.ResponseWriter, request *http.Request) bool {
	gate, err := localsettings.Gate(h.opts.Path)
	if err != nil || !gateMatches(request.Header.Get(localsettings.GateHeader), gate) {
		http.Error(writer, "forbidden", http.StatusForbidden)
		return false
	}
	return true
}

func gateMatches(got, want string) bool {
	got = strings.TrimSpace(got)
	want = strings.TrimSpace(want)
	if got == "" || want == "" || len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func writeSetupError(writer http.ResponseWriter, err error) {
	if errors.Is(err, localsettings.ErrSessionKeyMissing) || errors.Is(err, localsettings.ErrSecretTooLong) {
		http.Error(writer, "invalid settings", http.StatusBadRequest)
		return
	}
	http.Error(writer, "settings unreadable", http.StatusInternalServerError)
}

func writeSetupJSON(writer http.ResponseWriter, statusCode int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(statusCode)
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(true)
	_ = encoder.Encode(payload)
}
