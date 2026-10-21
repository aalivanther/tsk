// Archivo: refresher_test.go — Pruebas de la recarga del catálogo sin reiniciar el servidor.
// En español: lo que aquí se protege es que un seed nuevo pero ROTO nunca sustituya a uno válido, que
// el servidor prefiera el seed actualizable sobre el que viene en la imagen, y que el cálculo de
// "días de futuro que quedan" —la señal que avisa antes de que la app se vea vacía— sea correcto.
package catalog

import (
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// silentLogger devuelve un logger que no escribe nada, para no ensuciar la salida de las pruebas.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// writeSeedFile escribe un seed de prueba con los estrenos indicados y devuelve su ruta.
func writeSeedFile(t *testing.T, dir, name, releasesJSON string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(releasesJSON), 0o644); err != nil {
		t.Fatalf("failed to write the test seed: %v", err)
	}
	return path
}

// validSeed devuelve el JSON de un seed mínimo pero válido con una fecha concreta.
func validSeed(id, title, releaseDate string) string {
	return `{"releases":[{"id":"` + id + `","type":"MOVIE","category":"CINE","title":"` + title +
		`","releaseDate":"` + releaseDate + `"}]}`
}

// TestLoadPreferringWritableUsesWritableWhenValid: si el seed actualizable existe y sirve, gana.
func TestLoadPreferringWritableUsesWritableWhenValid(t *testing.T) {
	dir := t.TempDir()
	writable := writeSeedFile(t, dir, "writable.json", validSeed("nuevo", "Nuevo", "2026-12-01"))
	embedded := writeSeedFile(t, dir, "embedded.json", validSeed("viejo", "Viejo", "2026-01-01"))

	result, err := LoadPreferringWritable(writable, embedded, time.Now(), silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Source != SourceWritable {
		t.Fatalf("want the writable seed to win, got source %q", result.Source)
	}
	if len(result.Releases) != 1 || result.Releases[0].GetId() != "nuevo" {
		t.Fatalf("want the writable seed contents, got %+v", result.Releases)
	}
}

// TestLoadPreferringWritableFallsBackWhenMissing: sin seed actualizable, se usa el de la imagen.
// Es el caso normal de un despliegue recién estrenado, así que NO debe considerarse un error.
func TestLoadPreferringWritableFallsBackWhenMissing(t *testing.T) {
	dir := t.TempDir()
	embedded := writeSeedFile(t, dir, "embedded.json", validSeed("viejo", "Viejo", "2026-01-01"))

	result, err := LoadPreferringWritable(filepath.Join(dir, "no-existe.json"), embedded, time.Now(), silentLogger())
	if err != nil {
		t.Fatalf("a missing writable seed must not be an error, got: %v", err)
	}
	if result.Source != SourceEmbedded {
		t.Fatalf("want the embedded seed as fallback, got source %q", result.Source)
	}
}

// TestLoadPreferringWritableFallsBackWhenCorrupt: un seed actualizable ROTO no debe tumbar el
// arranque; se avisa y se usa el de la imagen. Servir datos viejos pero correctos es preferible a
// no arrancar, y muy preferible a servir datos corruptos.
func TestLoadPreferringWritableFallsBackWhenCorrupt(t *testing.T) {
	dir := t.TempDir()
	corrupt := writeSeedFile(t, dir, "writable.json", "{esto no es json valido")
	embedded := writeSeedFile(t, dir, "embedded.json", validSeed("viejo", "Viejo", "2026-01-01"))

	result, err := LoadPreferringWritable(corrupt, embedded, time.Now(), silentLogger())
	if err != nil {
		t.Fatalf("a corrupt writable seed must not break startup, got: %v", err)
	}
	if result.Source != SourceEmbedded {
		t.Fatalf("want the embedded seed when the writable one is corrupt, got source %q", result.Source)
	}
}

// TestInstallSeedRejectsInvalidCandidate: un candidato roto NO se instala y el seed vigente no se toca.
// Es la protección central del refresco automático: nunca cambiar datos buenos por datos rotos.
func TestInstallSeedRejectsInvalidCandidate(t *testing.T) {
	dir := t.TempDir()
	current := writeSeedFile(t, dir, "seed.json", validSeed("bueno", "Bueno", "2026-12-01"))
	candidate := writeSeedFile(t, dir, "candidate.json", `{"releases":[{"id":"","title":""}]}`)

	if _, err := InstallSeed(candidate, current, time.Now()); err == nil {
		t.Fatal("want an error when installing an invalid candidate seed, got nil")
	}

	// Y lo esencial: el seed vigente sigue siendo el bueno.
	releases, err := LoadSeed(current)
	if err != nil {
		t.Fatalf("the current seed must remain loadable, got: %v", err)
	}
	if len(releases) != 1 || releases[0].GetId() != "bueno" {
		t.Fatalf("the current seed was modified by a failed install: %+v", releases)
	}
}

// TestInstallSeedReplacesCurrentWhenValid: un candidato válido sustituye al vigente.
func TestInstallSeedReplacesCurrentWhenValid(t *testing.T) {
	dir := t.TempDir()
	current := filepath.Join(dir, "writable", "seed.json")
	candidate := writeSeedFile(t, dir, "candidate.json", validSeed("nuevo", "Nuevo", "2026-12-24"))

	result, err := InstallSeed(candidate, current, time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error installing a valid seed: %v", err)
	}
	if len(result.Releases) != 1 || result.Releases[0].GetId() != "nuevo" {
		t.Fatalf("want the new contents in the result, got %+v", result.Releases)
	}
	if result.DaysRemaining != 23 {
		t.Fatalf("want 23 days between 2026-12-01 and 2026-12-24, got %d", result.DaysRemaining)
	}

	// El archivo quedó escrito de verdad (y el directorio se creó solo).
	installed, err := LoadSeed(current)
	if err != nil {
		t.Fatalf("the installed seed must be loadable: %v", err)
	}
	if installed[0].GetId() != "nuevo" {
		t.Fatalf("want the installed file to hold the new contents, got %+v", installed)
	}

	// Y no quedó basura temporal alrededor. Se pregunta con errors.Is y no con os.IsNotExist por
	// costumbre: os.IsNotExist no desenvuelve los errores, así que en cuanto alguien añade contexto
	// con %w deja de funcionar en silencio. Mejor no usarlo en ningún sitio.
	if _, err := os.Stat(current + ".tmp"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("the temporary file was left behind after a successful install")
	}
}

// TestDaysRemaining cubre el cálculo del horizonte del catálogo, que es la señal de alerta temprana.
func TestDaysRemaining(t *testing.T) {
	now := time.Date(2026, 8, 1, 15, 30, 0, 0, time.UTC)

	makeReleases := func(dates ...string) []*catalogv1.Release {
		out := make([]*catalogv1.Release, 0, len(dates))
		for _, date := range dates {
			out = append(out, &catalogv1.Release{ReleaseDate: date})
		}
		return out
	}

	// Cuenta hasta la fecha MÁS LEJANA, no la primera.
	if got := DaysRemaining(makeReleases("2026-08-05", "2026-09-01", "2026-08-20"), now); got != 31 {
		t.Fatalf("want 31 days to the furthest release, got %d", got)
	}
	// Catálogo agotado: todo ya pasó.
	if got := DaysRemaining(makeReleases("2026-07-01", "2026-07-30"), now); got != 0 {
		t.Fatalf("want 0 for an exhausted catalog, got %d", got)
	}
	// Sin estrenos, cero.
	if got := DaysRemaining(nil, now); got != 0 {
		t.Fatalf("want 0 for an empty catalog, got %d", got)
	}
	// Las fechas basura se ignoran sin romper el cálculo.
	if got := DaysRemaining(makeReleases("no-es-fecha", "2026-08-11"), now); got != 10 {
		t.Fatalf("want malformed dates ignored, got %d", got)
	}
	// La hora del día no debe alterar el resultado.
	lateInTheDay := time.Date(2026, 8, 1, 23, 59, 0, 0, time.UTC)
	if got := DaysRemaining(makeReleases("2026-08-11"), lateInTheDay); got != 10 {
		t.Fatalf("want the result to be independent of the time of day, got %d", got)
	}
}
