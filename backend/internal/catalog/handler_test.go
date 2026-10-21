// Package catalog (archivo de pruebas) verifica el comportamiento del CatalogHandler.
// En español: estas son las "pruebas automáticas" del handler de catálogo. Comprueban, sin
// levantar red ni Docker, que el servicio cumple lo que el contrato promete: GetServiceInfo
// devuelve el nombre y la versión correctos; ListReleases filtra por mes/tipo/categoría y rechaza
// periodos inválidos; y GetRelease encuentra un estreno, responde "no encontrado" cuando no existe
// y rechaza un ID vacío. Para no depender de archivos, fabricamos un almacén de prueba en memoria.
package catalog

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// testVersion es la versión de ejemplo que inyectamos en el handler de prueba.
// En español: un valor arbitrario pero conocido para confirmar que se propaga sin cambios.
const testVersion = "0.0.21"

// newTestHandler arma un Handler con un almacén en memoria de tres estrenos fabricados.
// En español: este ayudante crea datos de mentira (sin leer ningún archivo) que cubren los casos
// que queremos probar: dos estrenos del mismo mes (junio 2026) de distinto tipo y categoría, y uno
// de otro mes (julio 2026) para confirmar que el filtro por periodo realmente excluye lo que no toca.
func newTestHandler(t *testing.T) *Handler {
	t.Helper()

	// Estreno A: película en cine, junio 2026.
	releaseA := &catalogv1.Release{
		Id:          "rel-a",
		Type:        catalogv1.TitleType_MOVIE,
		Category:    catalogv1.Category_CINE,
		Title:       "Alborada",
		ReleaseDate: "2026-06-10",
	}
	// Estreno B: serie en streaming, junio 2026 (mismo mes que A, distinto tipo y categoría).
	releaseB := &catalogv1.Release{
		Id:          "rel-b",
		Type:        catalogv1.TitleType_SERIES,
		Category:    catalogv1.Category_STREAMING,
		Title:       "Bruma",
		ReleaseDate: "2026-06-25",
	}
	// Estreno C: película en cine, julio 2026 (otro mes; debe quedar fuera de las consultas de junio).
	releaseC := &catalogv1.Release{
		Id:          "rel-c",
		Type:        catalogv1.TitleType_MOVIE,
		Category:    catalogv1.Category_CINE,
		Title:       "Cenit",
		ReleaseDate: "2026-07-01",
	}

	// Construimos el almacén y el handler con la versión de prueba.
	store := NewStore([]*catalogv1.Release{releaseA, releaseB, releaseC})
	return NewHandler(testVersion, store)
}

// TestGetServiceInfo comprueba que GetServiceInfo reporta el nombre y la versión correctos.
// En español: llamamos al método como lo haría el frontend y verificamos que la respuesta trae el
// nombre fijo "CatalogService" y la misma versión que le inyectamos al construir el handler.
func TestGetServiceInfo(t *testing.T) {
	t.Parallel()

	handler := newTestHandler(t)

	response, err := handler.GetServiceInfo(
		context.Background(),
		connect.NewRequest(&catalogv1.GetServiceInfoRequest{}),
	)
	if err != nil {
		t.Fatalf("GetServiceInfo returned an unexpected error: %v", err)
	}

	if got := response.Msg.GetServiceName(); got != serviceName {
		t.Errorf("service_name = %q, want %q", got, serviceName)
	}
	if got := response.Msg.GetVersion(); got != testVersion {
		t.Errorf("version = %q, want %q", got, testVersion)
	}
}

// TestListReleases comprueba el listado por mes con filtros y la validación de argumentos.
// En español: es una prueba "table-driven": una tabla de casos, cada uno con su petición y el
// resultado esperado. Cubre el mes con resultados, el filtro por tipo, el filtro por categoría y
// los dos errores de argumento inválido (año no positivo y mes fuera de 1-12).
func TestListReleases(t *testing.T) {
	t.Parallel()

	// testCase describe un escenario de ListReleases: qué se pide y qué se espera de vuelta.
	// En español: si wantErrorCode no es cero esperamos un error con ese código; si es cero,
	// esperamos éxito y que los IDs devueltos coincidan exactamente (en orden) con wantIDs.
	type testCase struct {
		name          string
		request       *catalogv1.ListReleasesRequest
		wantErrorCode connect.Code
		wantIDs       []string
	}

	cases := []testCase{
		{
			// Junio 2026 sin filtros: deben salir los dos estrenos de ese mes, ordenados por fecha.
			name: "june 2026 without filters returns both releases sorted by date",
			request: &catalogv1.ListReleasesRequest{
				Year:  2026,
				Month: 6,
			},
			wantIDs: []string{"rel-a", "rel-b"},
		},
		{
			// Filtro por tipo SERIES: de junio solo debe salir la serie (rel-b).
			name: "june 2026 filtered by series returns only the series",
			request: &catalogv1.ListReleasesRequest{
				Year:  2026,
				Month: 6,
				Types: []catalogv1.TitleType{catalogv1.TitleType_SERIES},
			},
			wantIDs: []string{"rel-b"},
		},
		{
			// Filtro por categoría STREAMING: de junio solo debe salir el estreno de streaming (rel-b).
			name: "june 2026 filtered by streaming returns only the streaming release",
			request: &catalogv1.ListReleasesRequest{
				Year:       2026,
				Month:      6,
				Categories: []catalogv1.Category{catalogv1.Category_STREAMING},
			},
			wantIDs: []string{"rel-b"},
		},
		{
			// Filtro por categoría CINE en junio: solo rel-a; rel-c es cine pero de julio (excluido).
			name: "june 2026 filtered by cine excludes july cinema release",
			request: &catalogv1.ListReleasesRequest{
				Year:       2026,
				Month:      6,
				Categories: []catalogv1.Category{catalogv1.Category_CINE},
			},
			wantIDs: []string{"rel-a"},
		},
		{
			// Un mes sin estrenos devuelve lista vacía (no es un error).
			name: "month without releases returns an empty list",
			request: &catalogv1.ListReleasesRequest{
				Year:  2026,
				Month: 3,
			},
			wantIDs: []string{},
		},
		{
			// Año no positivo: error de argumento inválido.
			name: "non-positive year is rejected as invalid argument",
			request: &catalogv1.ListReleasesRequest{
				Year:  0,
				Month: 6,
			},
			wantErrorCode: connect.CodeInvalidArgument,
		},
		{
			// Mes fuera del rango 1-12: error de argumento inválido.
			name: "out-of-range month is rejected as invalid argument",
			request: &catalogv1.ListReleasesRequest{
				Year:  2026,
				Month: 13,
			},
			wantErrorCode: connect.CodeInvalidArgument,
		},
	}

	handler := newTestHandler(t)

	for _, testCaseEntry := range cases {
		t.Run(testCaseEntry.name, func(t *testing.T) {
			t.Parallel()

			response, err := handler.ListReleases(
				context.Background(),
				connect.NewRequest(testCaseEntry.request),
			)

			// Caso de error esperado: verificamos que falle con el código correcto.
			if testCaseEntry.wantErrorCode != 0 {
				if err == nil {
					t.Fatalf("ListReleases expected error code %v, got nil error", testCaseEntry.wantErrorCode)
				}
				if got := connect.CodeOf(err); got != testCaseEntry.wantErrorCode {
					t.Fatalf("ListReleases error code = %v, want %v", got, testCaseEntry.wantErrorCode)
				}
				return
			}

			// Caso de éxito: no debe haber error y los IDs deben coincidir en cantidad y orden.
			if err != nil {
				t.Fatalf("ListReleases returned an unexpected error: %v", err)
			}

			// El listado devuelve RESÚMENES, no fichas completas: lo que se compara son sus ids.
			gotSummaries := response.Msg.GetSummaries()
			if len(gotSummaries) != len(testCaseEntry.wantIDs) {
				t.Fatalf(
					"ListReleases returned %d summaries, want %d",
					len(gotSummaries), len(testCaseEntry.wantIDs),
				)
			}
			for index, wantID := range testCaseEntry.wantIDs {
				if got := gotSummaries[index].GetId(); got != wantID {
					t.Errorf("summary[%d] id = %q, want %q", index, got, wantID)
				}
			}
		})
	}
}

// TestGetRelease comprueba la búsqueda por ID: encontrado, no encontrado e ID vacío.
// En español: tabla de casos que valida los tres caminos del contrato: un ID existente devuelve su
// ficha; un ID inexistente responde "no encontrado"; y un ID vacío se rechaza como argumento inválido.
func TestGetRelease(t *testing.T) {
	t.Parallel()

	// testCase describe un escenario de GetRelease: qué ID se pide y qué se espera.
	type testCase struct {
		name          string
		id            string
		wantErrorCode connect.Code
		wantID        string
	}

	cases := []testCase{
		{
			// ID existente: debe devolver exactamente ese estreno.
			name:   "existing id returns the release",
			id:     "rel-a",
			wantID: "rel-a",
		},
		{
			// ID inexistente: debe responder "no encontrado".
			name:          "missing id returns not found",
			id:            "does-not-exist",
			wantErrorCode: connect.CodeNotFound,
		},
		{
			// ID vacío: debe rechazarse como argumento inválido.
			name:          "empty id returns invalid argument",
			id:            "",
			wantErrorCode: connect.CodeInvalidArgument,
		},
	}

	handler := newTestHandler(t)

	for _, testCaseEntry := range cases {
		t.Run(testCaseEntry.name, func(t *testing.T) {
			t.Parallel()

			response, err := handler.GetRelease(
				context.Background(),
				connect.NewRequest(&catalogv1.GetReleaseRequest{Id: testCaseEntry.id}),
			)

			// Caso de error esperado: verificamos que falle con el código correcto.
			if testCaseEntry.wantErrorCode != 0 {
				if err == nil {
					t.Fatalf("GetRelease expected error code %v, got nil error", testCaseEntry.wantErrorCode)
				}
				if got := connect.CodeOf(err); got != testCaseEntry.wantErrorCode {
					t.Fatalf("GetRelease error code = %v, want %v", got, testCaseEntry.wantErrorCode)
				}
				return
			}

			// Caso de éxito: no debe haber error y el ID devuelto debe ser el esperado.
			if err != nil {
				t.Fatalf("GetRelease returned an unexpected error: %v", err)
			}
			if got := response.Msg.GetRelease().GetId(); got != testCaseEntry.wantID {
				t.Errorf("release id = %q, want %q", got, testCaseEntry.wantID)
			}
		})
	}
}

// TestGetReleaseIncludesSummary comprueba que la ficha completa viaja con su resumen al lado.
//
// En español: la sección de "Conexiones" necesita tres datos deducidos (el nombre de la saga, quién
// dirige y el reparto principal) que no existen tal cual en la ficha. El servidor los manda ya
// calculados para que el navegador no tenga que volver a deducirlos con una segunda copia de las
// mismas reglas. Si este resumen faltara, las conexiones de la página de un título se quedarían
// vacías sin que nada fallara.
func TestGetReleaseIncludesSummary(t *testing.T) {
	t.Parallel()

	handler := newTestHandler(t)

	response, err := handler.GetRelease(
		context.Background(),
		connect.NewRequest(&catalogv1.GetReleaseRequest{Id: "rel-a"}),
	)
	if err != nil {
		t.Fatalf("GetRelease returned an unexpected error: %v", err)
	}

	summary := response.Msg.GetSummary()
	if summary == nil {
		t.Fatal("GetRelease returned no summary alongside the release")
	}
	if got := summary.GetId(); got != "rel-a" {
		t.Errorf("summary id = %q, want %q", got, "rel-a")
	}
	if got := summary.GetTitle(); got != response.Msg.GetRelease().GetTitle() {
		t.Errorf("summary title = %q, want %q", got, response.Msg.GetRelease().GetTitle())
	}
}

// TestListReleaseDetails comprueba el volcado de fichas COMPLETAS de un periodo.
//
// En español: es la operación que usan las tres pantallas que recorren el catálogo entero mirando
// dentro de cada ficha. Aquí se verifica que acota igual que el listado (mismo periodo, mismos
// filtros), que valida igual los periodos imposibles y que lo que devuelve son fichas de verdad.
func TestListReleaseDetails(t *testing.T) {
	t.Parallel()

	handler := newTestHandler(t)

	t.Run("returns the full releases of the period", func(t *testing.T) {
		t.Parallel()

		response, err := handler.ListReleaseDetails(
			context.Background(),
			connect.NewRequest(&catalogv1.ListReleaseDetailsRequest{Year: 2026, Month: 6}),
		)
		if err != nil {
			t.Fatalf("ListReleaseDetails returned an unexpected error: %v", err)
		}

		releases := response.Msg.GetReleases()
		wantIDs := []string{"rel-a", "rel-b"}
		if len(releases) != len(wantIDs) {
			t.Fatalf("ListReleaseDetails returned %d releases, want %d", len(releases), len(wantIDs))
		}
		for index, wantID := range wantIDs {
			if got := releases[index].GetId(); got != wantID {
				t.Errorf("release[%d] id = %q, want %q", index, got, wantID)
			}
		}
	})

	t.Run("applies the category filter", func(t *testing.T) {
		t.Parallel()

		response, err := handler.ListReleaseDetails(
			context.Background(),
			connect.NewRequest(&catalogv1.ListReleaseDetailsRequest{
				Year:       2026,
				Month:      6,
				Categories: []catalogv1.Category{catalogv1.Category_CINE},
			}),
		)
		if err != nil {
			t.Fatalf("ListReleaseDetails returned an unexpected error: %v", err)
		}
		releases := response.Msg.GetReleases()
		if len(releases) != 1 || releases[0].GetId() != "rel-a" {
			t.Errorf("ListReleaseDetails with category filter returned %d releases, want only rel-a", len(releases))
		}
	})

	t.Run("rejects an impossible month", func(t *testing.T) {
		t.Parallel()

		_, err := handler.ListReleaseDetails(
			context.Background(),
			connect.NewRequest(&catalogv1.ListReleaseDetailsRequest{Year: 2026, Month: 13}),
		)
		if err == nil {
			t.Fatal("ListReleaseDetails with month 13 should have failed")
		}
		if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
			t.Errorf("error code = %v, want %v", got, connect.CodeInvalidArgument)
		}
	})
}
