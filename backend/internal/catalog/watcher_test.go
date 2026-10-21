// Archivo: watcher_test.go — Pruebas del vigilante del catálogo.
//
// En español: comprueban las dos promesas de la pieza. La primera, y la que motivó todo: que los
// días de futuro que le quedan al catálogo se vuelven a calcular contra la fecha de HOY, de modo que
// el número baja solo mientras el proceso sigue vivo en vez de quedarse clavado en el del arranque.
// La segunda: que un catálogo nuevo instalado en el archivo actualizable entra en servicio sin
// reiniciar nada, y que uno roto NO derriba el que ya estaba sirviendo.
package catalog

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// recordingStateSink es un receptor de estado de mentira: se limita a guardar lo último que le
// entregaron, para que las pruebas puedan comprobarlo sin montar las métricas reales del servidor.
//
// Lleva candado porque el vigilante escribe aquí desde SU tarea paralela mientras la prueba lee
// desde la suya. Sin él, el detector de carreras (go test -race) rompe la prueba, y con razón: leer
// y escribir el mismo dato a la vez sin coordinarse es exactamente lo que ese detector busca.
type recordingStateSink struct {
	// mutex protege los tres campos de abajo.
	mutex sync.Mutex
	// releases es el último número de estrenos recibido.
	releases int
	// daysRemaining son los últimos días de futuro recibidos.
	daysRemaining int
	// updates cuenta cuántas veces se ha actualizado el estado.
	updates int
}

// SetCatalogState apunta el estado recibido.
func (s *recordingStateSink) SetCatalogState(releases, daysRemaining int) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.releases = releases
	s.daysRemaining = daysRemaining
	s.updates++
}

// snapshot devuelve una copia coherente de lo último apuntado.
func (s *recordingStateSink) snapshot() (releases, daysRemaining, updates int) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.releases, s.daysRemaining, s.updates
}

// movableClock es un reloj que la prueba adelanta a mano, para simular el paso de los días sin
// esperarlos de verdad.
type movableClock struct {
	// current es el instante que devuelve ahora mismo.
	current time.Time
}

// Now devuelve el instante actual del reloj.
func (c *movableClock) Now() time.Time { return c.current }

// Advance adelanta el reloj el tiempo indicado.
func (c *movableClock) Advance(duration time.Duration) { c.current = c.current.Add(duration) }

// newTestWatcher arma un vigilante sobre un catálogo inicial, con reloj y receptor controlados.
//
// En español: el catálogo de partida tiene un único estreno con identificador "inicial", que es el
// que las pruebas buscan después para saber si el relevo ocurrió o no.
func newTestWatcher(t *testing.T, writableSeedPath, releaseDate string) (
	*Watcher, *Handler, *recordingStateSink, *movableClock,
) {
	t.Helper()

	initialReleases := []*catalogv1.Release{
		{Id: "inicial", Title: "Título inicial", ReleaseDate: releaseDate},
	}

	handler := NewHandler("0.0.0-test", NewStore(initialReleases))
	sink := &recordingStateSink{}
	clock := &movableClock{current: time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)}

	watcher, err := NewWatcher(WatcherOptions{
		Handler:          handler,
		State:            sink,
		WritableSeedPath: writableSeedPath,
		Interval:         time.Millisecond,
		Now:              clock.Now,
		Logger:           silentLogger(),
	})
	if err != nil {
		t.Fatalf("NewWatcher devolvió error: %v", err)
	}

	return watcher, handler, sink, clock
}

// TestWatcherRecalculatesTheCatalogHorizonAsDaysGoBy es LA prueba de este archivo.
//
// En español: reproduce el fallo original. El estado se calculaba una sola vez, al arrancar, así que
// un proceso encendido durante meses seguía anunciando los días del primer día. Aquí se adelanta el
// reloj y se comprueba que el número baja exactamente lo que han pasado los días, sin tocar el
// catálogo ni reiniciar nada.
func TestWatcherRecalculatesTheCatalogHorizonAsDaysGoBy(t *testing.T) {
	// Catálogo cuyo estreno más lejano es el 30 de noviembre de 2026; el reloj empieza el 28 de julio.
	watcher, _, sink, clock := newTestWatcher(t, "", "2026-11-30")

	watcher.RefreshOnce()
	releasesAtStartup, atStartup, _ := sink.snapshot()
	if atStartup <= 0 {
		t.Fatalf("el catálogo debería tener futuro por delante, y anuncia %d días", atStartup)
	}
	if releasesAtStartup != 1 {
		t.Fatalf("se esperaba 1 estreno cargado y se publicó %d", releasesAtStartup)
	}

	// Pasan sesenta días con el proceso encendido y sin tocar nada.
	const daysGoneBy = 60
	clock.Advance(daysGoneBy * 24 * time.Hour)
	watcher.RefreshOnce()

	want := atStartup - daysGoneBy
	_, daysNow, _ := sink.snapshot()
	if daysNow != want {
		t.Fatalf(
			"tras %d días el catálogo debería anunciar %d días restantes y anuncia %d (¿el número se quedó congelado?)",
			daysGoneBy, want, daysNow,
		)
	}
}

// TestWatcherReportsAnExhaustedCatalog comprueba el caso que la alarma existe para detectar: el
// catálogo se acabó y ya no queda futuro que enseñar.
func TestWatcherReportsAnExhaustedCatalog(t *testing.T) {
	watcher, _, sink, clock := newTestWatcher(t, "", "2026-08-15")

	// Se pasa de largo la fecha del último estreno.
	clock.Advance(365 * 24 * time.Hour)
	watcher.RefreshOnce()

	if _, daysRemaining, _ := sink.snapshot(); daysRemaining != 0 {
		t.Fatalf("un catálogo agotado debe anunciar 0 días de futuro y anuncia %d", daysRemaining)
	}
}

// TestWatcherSwapsTheCatalogWhenTheWritableSeedChanges comprueba el refresco en caliente completo.
func TestWatcherSwapsTheCatalogWhenTheWritableSeedChanges(t *testing.T) {
	writablePath := filepath.Join(t.TempDir(), "seed.json")
	watcher, handler, sink, _ := newTestWatcher(t, writablePath, "2026-11-30")

	// Todavía no hay archivo actualizable: el catálogo de partida sigue en servicio.
	watcher.RefreshOnce()
	if _, found := handler.currentStore().Get("inicial"); !found {
		t.Fatal("el catálogo inicial debería seguir en servicio mientras no haya archivo actualizable")
	}

	// Alguien instala un catálogo nuevo, con dos estrenos distintos.
	newSeed := `{"releases":[` +
		`{"id":"nuevo-1","type":"MOVIE","category":"CINE","title":"Primero","releaseDate":"2027-01-10"},` +
		`{"id":"nuevo-2","type":"MOVIE","category":"CINE","title":"Segundo","releaseDate":"2027-02-20"}]}`
	if err := os.WriteFile(writablePath, []byte(newSeed), 0o644); err != nil {
		t.Fatalf("no se pudo escribir el seed actualizable: %v", err)
	}

	watcher.RefreshOnce()

	if _, found := handler.currentStore().Get("nuevo-1"); !found {
		t.Fatal("el catálogo nuevo debería haber entrado en servicio")
	}
	if _, found := handler.currentStore().Get("inicial"); found {
		t.Fatal("el catálogo viejo no debería seguir en servicio tras el relevo")
	}
	releasesAfterSwap, _, updatesBefore := sink.snapshot()
	if releasesAfterSwap != 2 {
		t.Fatalf("el estado publicado debería reflejar los 2 estrenos nuevos, y publica %d", releasesAfterSwap)
	}

	// Una revisión más sin cambios no vuelve a relevar nada (se comprueba por el número de estrenos,
	// que sigue siendo el del catálogo nuevo, y porque no hay error alguno).
	watcher.RefreshOnce()
	releasesAfterNoChange, _, updatesAfter := sink.snapshot()
	if updatesAfter != updatesBefore+1 {
		t.Fatalf("cada revisión publica el estado exactamente una vez, y hubo %d", updatesAfter-updatesBefore)
	}
	if releasesAfterNoChange != 2 {
		t.Fatalf("sin cambios en el archivo, el catálogo no debe moverse; publica %d estrenos", releasesAfterNoChange)
	}
}

// TestWatcherKeepsServingWhenTheNewSeedIsBroken comprueba la regla de oro del refresco: es preferible
// un catálogo viejo pero correcto a uno nuevo pero corrupto.
func TestWatcherKeepsServingWhenTheNewSeedIsBroken(t *testing.T) {
	writablePath := filepath.Join(t.TempDir(), "seed.json")
	watcher, handler, sink, _ := newTestWatcher(t, writablePath, "2026-11-30")

	if err := os.WriteFile(writablePath, []byte("{esto no es json válido"), 0o644); err != nil {
		t.Fatalf("no se pudo escribir el seed roto: %v", err)
	}

	watcher.RefreshOnce()

	if _, found := handler.currentStore().Get("inicial"); !found {
		t.Fatal("un archivo roto NO debe derribar el catálogo que ya estaba sirviendo")
	}
	if releases, _, _ := sink.snapshot(); releases != 1 {
		t.Fatalf("el estado publicado debe seguir siendo el del catálogo vigente, y publica %d", releases)
	}
}

// TestWatcherDoesNotReloadTheSeedItStartedWith comprueba que arrancar con el catálogo actualizable ya
// puesto no provoca un relevo inútil en la primera revisión.
func TestWatcherDoesNotReloadTheSeedItStartedWith(t *testing.T) {
	directory := t.TempDir()
	writablePath := writeSeedFile(t, directory, "seed.json", validSeed("ya-instalado", "Ya instalado", "2026-12-31"))

	// El vigilante se construye DESPUÉS de que el archivo exista, igual que en el arranque real.
	watcher, handler, _, _ := newTestWatcher(t, writablePath, "2026-11-30")

	watcher.RefreshOnce()

	// El catálogo en servicio sigue siendo el que se le entregó al construirlo: el vigilante anotó la
	// firma del archivo al nacer y no ha visto ningún cambio desde entonces.
	if _, found := handler.currentStore().Get("inicial"); !found {
		t.Fatal("el vigilante no debe recargar el mismo archivo con el que arrancó el servidor")
	}
}

// TestWatcherStopsWhenTheContextIsCancelled comprueba el apagado ordenado del vigilante.
func TestWatcherStopsWhenTheContextIsCancelled(t *testing.T) {
	watcher, _, sink, _ := newTestWatcher(t, "", "2026-11-30")

	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{})
	go func() {
		watcher.Run(ctx)
		close(finished)
	}()

	// Con un intervalo de un milisegundo, unas cuantas revisiones ocurren enseguida.
	deadline := time.After(2 * time.Second)
	for {
		if _, _, updates := sink.snapshot(); updates > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("el vigilante no publicó ningún estado en dos segundos")
		default:
			time.Sleep(time.Millisecond)
		}
	}

	cancel()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("el vigilante no terminó tras cancelar su contexto")
	}
}

// TestNewWatcherRejectsMissingPieces comprueba que no se puede armar un vigilante a medias.
// En español: importa porque un vigilante incompleto sería peor que ninguno — daría la falsa
// sensación de que el número se está actualizando cuando en realidad nadie lo toca.
func TestNewWatcherRejectsMissingPieces(t *testing.T) {
	handler := NewHandler("0.0.0-test", NewStore(nil))

	cases := []struct {
		name    string
		options WatcherOptions
	}{
		{name: "sin handler", options: WatcherOptions{State: &recordingStateSink{}}},
		{name: "sin receptor de estado", options: WatcherOptions{Handler: handler}},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := NewWatcher(testCase.options); err == nil {
				t.Fatal("se esperaba un error y no hubo ninguno")
			}
		})
	}
}
