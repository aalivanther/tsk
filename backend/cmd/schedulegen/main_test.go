// Archivo: main_test.go — Pruebas de las piezas puras del generador de calendarios de emisión.
//
// En español: schedulegen recorre las series del catálogo y les añade las fechas reales de sus
// episodios consultando TMDB. Las llamadas de red no se prueban aquí (eso exigiría credenciales y una
// conexión), pero sí las decisiones que se toman ALREDEDOR de esas llamadas, que son las que causan
// datos silenciosamente incorrectos: de qué identificador se saca la serie, y qué pasa cuando el
// archivo del catálogo está roto o vacío.

package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestTmdbIDFromSeedID comprueba cómo se extrae el identificador de TMDB del id del catálogo.
//
// En español: los ids del catálogo tienen la forma "titulo-en-slug-tmdb-1234". De ese número depende
// TODA la consulta posterior; si se leyera mal, se pediría el calendario de OTRA serie y el error
// pasaría inadvertido porque las fechas parecerían perfectamente válidas.
func TestTmdbIDFromSeedID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		seedID  string
		wantID  int
		wantOK  bool
		comment string
	}{
		{
			name:    "id normal",
			seedID:  "la-casa-del-dragon-tmdb-94997",
			wantID:  94997,
			wantOK:  true,
			comment: "el caso habitual del catálogo",
		},
		{
			name:    "título que contiene números",
			seedID:  "1899-tmdb-90669",
			wantID:  90669,
			wantOK:  true,
			comment: "el número del título no debe confundirse con el identificador",
		},
		{
			name:    "título que contiene la palabra tmdb",
			seedID:  "tmdb-la-serie-tmdb-555",
			wantID:  555,
			wantOK:  true,
			comment: "se toma el sufijo FINAL, no la primera coincidencia",
		},
		{
			name:    "sin sufijo de tmdb",
			seedID:  "una-serie-curada-a-mano",
			wantOK:  false,
			comment: "sin identificador no hay fuente de fechas: debe reconocerse, no adivinarse",
		},
		{
			name:    "sufijo con texto en vez de número",
			seedID:  "serie-tmdb-abc",
			wantOK:  false,
			comment: "un sufijo no numérico no es un identificador válido",
		},
		{
			name:    "id vacío",
			seedID:  "",
			wantOK:  false,
			comment: "defensivo: un id vacío nunca debe producir un número",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			gotID, gotOK := tmdbIDFromSeedID(testCase.seedID)
			if gotOK != testCase.wantOK {
				t.Fatalf("%s: want ok=%v for %q, got %v", testCase.comment, testCase.wantOK, testCase.seedID, gotOK)
			}
			if testCase.wantOK && gotID != testCase.wantID {
				t.Fatalf("%s: want id %d for %q, got %d", testCase.comment, testCase.wantID, testCase.seedID, gotID)
			}
		})
	}
}

// TestReadSeedFileRejectsBrokenInput comprueba que un catálogo ilegible se detecta en vez de
// producir un resultado a medias.
//
// En español: si el archivo no existe o no es válido, la herramienta debe fallar con un mensaje
// claro. Lo peligroso sería lo contrario: continuar con una lista vacía y reescribir el catálogo
// dejándolo sin nada.
func TestReadSeedFileRejectsBrokenInput(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()

	// Archivo inexistente.
	if _, err := readSeedFile(filepath.Join(dir, "no-existe.json")); err == nil {
		t.Fatal("want an error for a missing seed file, got nil")
	}

	// Archivo con JSON inválido.
	brokenPath := filepath.Join(dir, "roto.json")
	if err := os.WriteFile(brokenPath, []byte("{no es json"), 0o644); err != nil {
		t.Fatalf("failed to write the broken fixture: %v", err)
	}
	if _, err := readSeedFile(brokenPath); err == nil {
		t.Fatal("want an error for an invalid seed file, got nil")
	}
}

// TestSeedRoundTripPreservesReleases comprueba que leer y volver a escribir el catálogo no pierde
// datos, que es la operación central de esta herramienta (reescribe el archivo EN SITIO).
func TestSeedRoundTripPreservesReleases(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "seed.json")
	original := `{"releases":[
		{"id":"serie-tmdb-1","type":"SERIES","category":"STREAMING","title":"Serie Uno","releaseDate":"2026-08-10"},
		{"id":"peli-tmdb-2","type":"MOVIE","category":"CINE","title":"Peli Dos","releaseDate":"2026-08-12"}
	]}`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatalf("failed to write the fixture: %v", err)
	}

	loaded, err := readSeedFile(path)
	if err != nil {
		t.Fatalf("unexpected error reading the seed: %v", err)
	}
	if len(loaded.GetReleases()) != 2 {
		t.Fatalf("want 2 releases loaded, got %d", len(loaded.GetReleases()))
	}

	// Se reescribe y se vuelve a leer: el contenido debe sobrevivir intacto.
	if err := writeSeedFile(path, loaded); err != nil {
		t.Fatalf("unexpected error writing the seed: %v", err)
	}
	reloaded, err := readSeedFile(path)
	if err != nil {
		t.Fatalf("unexpected error reading the seed back: %v", err)
	}
	if len(reloaded.GetReleases()) != 2 {
		t.Fatalf("want the round trip to preserve 2 releases, got %d", len(reloaded.GetReleases()))
	}
	if reloaded.GetReleases()[0].GetTitle() != "Serie Uno" {
		t.Fatalf("want the first title preserved, got %q", reloaded.GetReleases()[0].GetTitle())
	}
	if reloaded.GetReleases()[1].GetReleaseDate() != "2026-08-12" {
		t.Fatalf("want dates preserved, got %q", reloaded.GetReleases()[1].GetReleaseDate())
	}
}
