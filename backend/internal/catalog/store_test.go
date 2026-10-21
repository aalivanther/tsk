// Package catalog (archivo de pruebas) verifica el filtrado por periodo del Store.
// En español: comprueba que List() descarta los estrenos con fecha vacía o mal formada (sin romper
// la consulta) y que incluye solo los del año y mes pedidos, ya ordenados. Estas son justamente las
// ramas defensivas que el seed real (con fechas limpias) nunca ejercita, por eso las probamos aquí.

package catalog

import (
	"testing"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// TestStoreListSkipsMalformedDates comprueba que las fechas inválidas se descartan del listado.
// En español: armamos un almacén con un estreno válido de junio 2026 y varios con fechas imposibles
// o mal formadas; al pedir "junio 2026" solo debe salir el válido, y los rotos no deben aparecer ni
// provocar error. Así confirmamos que parseYearMonth (vía time.Parse) actúa de filtro seguro.
func TestStoreListSkipsMalformedDates(t *testing.T) {
	t.Parallel()

	releases := []*catalogv1.Release{
		// Único estreno con fecha válida de junio 2026: es el que debe salir.
		{Id: "valid-june", Title: "Válido", ReleaseDate: "2026-06-15"},
		// Fecha vacía: se descarta.
		{Id: "empty-date", Title: "Sin fecha", ReleaseDate: ""},
		// Día imposible (junio no tiene 99 días): time.Parse lo rechaza, se descarta.
		{Id: "bad-day", Title: "Día absurdo", ReleaseDate: "2026-06-99"},
		// Mes fuera de rango (13): se descarta.
		{Id: "bad-month", Title: "Mes absurdo", ReleaseDate: "2026-13-01"},
		// Signo incrustado en el año: se descarta (antes pasaba como año 26).
		{Id: "signed-year", Title: "Año con signo", ReleaseDate: "+026-06-15"},
		// Formato que no calza (no es AAAA-MM-DD): se descarta.
		{Id: "bad-format", Title: "Formato raro", ReleaseDate: "15/06/2026"},
	}

	store := NewStore(releases)

	// Pedimos junio 2026 sin filtros de tipo/categoría: solo debe salir el estreno con fecha válida.
	got := store.List(2026, 6, nil, nil)

	if len(got) != 1 {
		t.Fatalf("List(2026, 6) returned %d releases, want exactly 1 (only the valid date)", len(got))
	}
	if got[0].GetId() != "valid-june" {
		t.Errorf("List(2026, 6) returned id %q, want %q", got[0].GetId(), "valid-june")
	}
}

// TestStoreListSortsByDateThenTitle comprueba el orden estable: fecha ascendente y luego título.
// En español: con tres estrenos de junio, dos de ellos en la misma fecha, verificamos que salgan
// ordenados por fecha y que el empate se rompa por título de forma determinista.
func TestStoreListSortsByDateThenTitle(t *testing.T) {
	t.Parallel()

	releases := []*catalogv1.Release{
		// Mismo día que "Bravo"; por título debe ir después (B < Z).
		{Id: "z-same-day", Title: "Zorro", ReleaseDate: "2026-06-10"},
		{Id: "b-same-day", Title: "Bravo", ReleaseDate: "2026-06-10"},
		// Fecha más temprana: debe ir primero de todos.
		{Id: "early", Title: "Alfa", ReleaseDate: "2026-06-01"},
	}

	store := NewStore(releases)
	got := store.List(2026, 6, nil, nil)

	wantOrder := []string{"early", "b-same-day", "z-same-day"}
	if len(got) != len(wantOrder) {
		t.Fatalf("List returned %d releases, want %d", len(got), len(wantOrder))
	}
	for index, wantID := range wantOrder {
		if got[index].GetId() != wantID {
			t.Errorf("release[%d] id = %q, want %q", index, got[index].GetId(), wantID)
		}
	}
}
