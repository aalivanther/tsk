// Archivo: rarity_test.go — Pruebas de la derivación de rareza a partir de la calificación TMDB.
// En español: estas pruebas blindan los BORDES EXACTOS de los umbrales, que son la parte frágil de
// la regla (un "<" en vez de "<=" cambiaría el resultado justo en el corte). Probamos cada umbral
// por su valor exacto (sube de nivel) y por un pelín menos (se queda en el nivel inferior), más los
// extremos 0 y 10. Son table-driven y cubren las cuatro ramas de Derive (cobertura 100%).

package rarity

import "testing"

// TestDeriveBoundaries verifica la rareza en los bordes exactos de cada umbral y en los extremos.
// En español: cada caso declara una calificación de entrada y la rareza esperada. La clave son los
// pares "valor del umbral" vs "umbral menos un pelín": confirman que la comparación es por
// "mayor o igual" (en el umbral exacto sube; justo por debajo, no).
func TestDeriveBoundaries(t *testing.T) {
	t.Parallel()

	// testCases enumera los bordes que la regla DEBE respetar, con su rareza esperada.
	testCases := []struct {
		name string  // descripción legible del caso (sale en el log si falla).
		tmdb float64 // calificación de TMDB de entrada (0 a 10).
		want Tier    // rareza esperada para esa calificación.
	}{
		// Borde legendary: 8.5 exacto sube a legendary; 8.49 se queda en epic.
		{name: "8.5 es el corte exacto de legendary", tmdb: 8.5, want: TierLegendary},
		{name: "8.49 cae justo por debajo, sigue epic", tmdb: 8.49, want: TierEpic},

		// Borde epic: 7.5 exacto sube a epic; 7.49 se queda en rare.
		{name: "7.5 es el corte exacto de epic", tmdb: 7.5, want: TierEpic},
		{name: "7.49 cae justo por debajo, sigue rare", tmdb: 7.49, want: TierRare},

		// Borde rare: 6.5 exacto sube a rare; 6.49 se queda en common.
		{name: "6.5 es el corte exacto de rare", tmdb: 6.5, want: TierRare},
		{name: "6.49 cae justo por debajo, sigue common", tmdb: 6.49, want: TierCommon},

		// Extremos: 0 (sin calificación) es common; 10 (máximo) es legendary.
		{name: "0 (sin calificación) es common", tmdb: 0, want: TierCommon},
		{name: "10 (máximo) es legendary", tmdb: 10, want: TierLegendary},
	}

	for _, testCase := range testCases {
		// Capturamos la variable del bucle y aislamos cada caso como subprueba con su propio nombre.
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			got := Derive(testCase.tmdb)
			if got != testCase.want {
				t.Errorf("Derive(%v) = %q, want %q", testCase.tmdb, got, testCase.want)
			}
		})
	}
}
