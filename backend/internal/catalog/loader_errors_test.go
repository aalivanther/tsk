// Package catalog (archivo de pruebas) verifica las RUTAS DE ERROR de la carga del seed.
// En español: el loader es el "blindaje" del arranque (mejor no arrancar que servir datos rotos).
// Estas pruebas comprueban que cada forma de seed inválido se rechaza de verdad: archivo que no
// existe, JSON mal formado, catálogo vacío, estrenos sin campos mínimos, ids duplicados y campos
// desconocidos. Sin estas pruebas, una regresión podría debilitar una validación sin que nadie lo note.

package catalog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTempSeed escribe un contenido de seed en un archivo temporal y devuelve su ruta.
// En español: cada prueba necesita su propio archivo de seed "de mentira"; este ayudante lo crea en
// una carpeta temporal que Go borra al terminar (t.TempDir), para no ensuciar el proyecto.
func writeTempSeed(t *testing.T, content string) string {
	t.Helper()

	// Creamos la carpeta temporal exclusiva de esta prueba y el archivo seed dentro de ella.
	seedPath := filepath.Join(t.TempDir(), "seed.json")
	if err := os.WriteFile(seedPath, []byte(content), 0o600); err != nil {
		t.Fatalf("failed to write temporary seed file: %v", err)
	}
	return seedPath
}

// TestLoadSeedErrors comprueba que cada seed inválido produce un error (y no una carga silenciosa).
// En español: es una prueba "table-driven"; cada caso describe un seed roto distinto y exige que
// LoadSeed devuelva error. Donde tiene sentido, comprobamos además que el mensaje de error mencione
// la causa (por ejemplo "duplicate"), para que el error sea útil al diagnosticar.
func TestLoadSeedErrors(t *testing.T) {
	t.Parallel()

	// errorCase describe un escenario de seed inválido y, opcionalmente, un fragmento que el mensaje
	// de error debe contener. Si wantErrorContains está vacío, basta con que haya error.
	type errorCase struct {
		name              string
		seedContent       string
		useNonexistent    bool // si es true, ignoramos seedContent y usamos una ruta que no existe.
		wantErrorContains string
	}

	cases := []errorCase{
		{
			name:           "nonexistent file is rejected",
			useNonexistent: true,
		},
		{
			name:        "malformed json is rejected",
			seedContent: `{"releases": [ {"id": "x"`, // JSON incompleto/roto.
		},
		{
			name:              "empty releases list is rejected",
			seedContent:       `{"releases": []}`,
			wantErrorContains: "no releases",
		},
		{
			name:              "release with empty id is rejected",
			seedContent:       `{"releases": [ {"id": "", "title": "T", "releaseDate": "2026-06-01"} ]}`,
			wantErrorContains: "empty id",
		},
		{
			name:              "release with empty title is rejected",
			seedContent:       `{"releases": [ {"id": "a", "title": "", "releaseDate": "2026-06-01"} ]}`,
			wantErrorContains: "empty title",
		},
		{
			name:              "release with empty release_date is rejected",
			seedContent:       `{"releases": [ {"id": "a", "title": "T", "releaseDate": ""} ]}`,
			wantErrorContains: "empty release_date",
		},
		{
			name: "duplicate release id is rejected",
			seedContent: `{"releases": [
				{"id": "dup", "title": "Primero", "releaseDate": "2026-06-01"},
				{"id": "dup", "title": "Segundo", "releaseDate": "2026-06-02"}
			]}`,
			wantErrorContains: "duplicate",
		},
		{
			name:              "unknown field is rejected (DiscardUnknown is false)",
			seedContent:       `{"releases": [ {"id": "a", "title": "T", "releaseDate": "2026-06-01", "featured": true} ]}`,
			wantErrorContains: "featured",
		},
	}

	for _, errorCaseEntry := range cases {
		t.Run(errorCaseEntry.name, func(t *testing.T) {
			t.Parallel()

			// Elegimos la ruta: una inexistente, o un archivo temporal con el contenido del caso.
			path := filepath.Join(t.TempDir(), "does-not-exist.json")
			if !errorCaseEntry.useNonexistent {
				path = writeTempSeed(t, errorCaseEntry.seedContent)
			}

			_, err := LoadSeed(path)
			if err == nil {
				t.Fatalf("LoadSeed expected an error for %q, got nil", errorCaseEntry.name)
			}

			// Si el caso espera un fragmento concreto en el mensaje, lo verificamos.
			if errorCaseEntry.wantErrorContains != "" &&
				!strings.Contains(err.Error(), errorCaseEntry.wantErrorContains) {
				t.Errorf(
					"LoadSeed error = %q, want it to contain %q",
					err.Error(), errorCaseEntry.wantErrorContains,
				)
			}
		})
	}
}
