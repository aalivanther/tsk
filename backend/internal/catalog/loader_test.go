// Package catalog (archivo de pruebas) verifica la carga del catálogo desde el seed REAL.
// En español: esta prueba NO usa datos de mentira; abre el archivo seed.json verdadero del
// proyecto (el catálogo curado de Fase 0) y comprueba que se lee, se valida y se indexa bien.
// Sirve como red de seguridad: si alguien edita el seed y lo deja roto, incompleto o con menos
// estrenos de los esperados, esta prueba lo detecta antes de que el backend intente arrancar.
package catalog

import (
	"os"
	"path/filepath"
	"testing"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// realSeedPath es la ruta al archivo seed.json real, relativa a este paquete de pruebas.
// En español: las pruebas de Go corren con el directorio de trabajo puesto en la carpeta del
// paquete (backend/internal/catalog), así que subimos dos niveles para llegar a backend/seed.
const realSeedPath = "../../seed/seed.json"

// minSeedReleases es el mínimo de estrenos que el seed real debe contener para considerarse válido.
// En español: el seed curado de Fase 0 mapea fielmente los 17 títulos de muestra del prototipo
// (cascaron-mdm7mo-v3.html); no se inventa ninguno. Menos de 17 indicaría un seed truncado o roto.
// Lo dejamos como umbral explícito para que el requisito quede documentado.
const minSeedReleases = 17

// loadRealSeed carga el seed real y falla la prueba de inmediato si la carga devuelve error.
// En español: ayudante que centraliza la lectura del archivo real para no repetirla en cada test.
// Marcarlo con t.Helper hace que, si falla, el reporte señale la línea del test que lo llamó (más
// útil) en lugar de una línea interna de este ayudante.
func loadRealSeed(t *testing.T) []*catalogv1.Release {
	t.Helper()

	releases, err := LoadSeed(realSeedPath)
	if err != nil {
		t.Fatalf("LoadSeed(%q) returned an unexpected error: %v", realSeedPath, err)
	}
	return releases
}

// TestLoadSeedReal verifica que el seed real se carga con suficientes estrenos y campos mínimos.
// En español: comprueba tres cosas sobre el catálogo verdadero: que tenga al menos el mínimo de
// estrenos esperado, que cada estreno traiga sus datos mínimos (id, título y fecha de estreno) y
// que el indexado por ID funcione (que cada estreno se pueda recuperar por su propio identificador).
func TestLoadSeedReal(t *testing.T) {
	t.Parallel()

	releases := loadRealSeed(t)

	// Comprobamos que el catálogo trae al menos el mínimo de estrenos esperado.
	if len(releases) < minSeedReleases {
		t.Fatalf("real seed has %d releases, want at least %d", len(releases), minSeedReleases)
	}

	// Comprobamos que cada estreno trae sus campos mínimos no vacíos.
	// En español: aunque el loader ya valida esto al cargar, lo reafirmamos aquí para dejar claro
	// el contrato de datos del seed y para que el test documente qué campos son obligatorios.
	for index, release := range releases {
		if release.GetId() == "" {
			t.Errorf("release at index %d has an empty id", index)
		}
		if release.GetTitle() == "" {
			t.Errorf("release at index %d (id %q) has an empty title", index, release.GetId())
		}
		if release.GetReleaseDate() == "" {
			t.Errorf("release at index %d (id %q) has an empty release_date", index, release.GetId())
		}
	}

	// Comprobamos que el indexado por ID del Store recupera cada estreno por su propio ID.
	// En español: construimos el almacén con el catálogo real y verificamos que pedir un estreno
	// por su ID devuelve exactamente ese estreno; así confirmamos que el índice quedó bien armado.
	store := NewStore(releases)
	for _, release := range releases {
		gotRelease, found := store.Get(release.GetId())
		if !found {
			t.Errorf("store could not find release with id %q after indexing", release.GetId())
			continue
		}
		if gotRelease.GetId() != release.GetId() {
			t.Errorf("store returned id %q for lookup of %q", gotRelease.GetId(), release.GetId())
		}
	}
}

// seedDirectory es la carpeta donde viven el catálogo en servicio y todos sus respaldos.
const seedDirectory = "../../seed"

// curatedInputFileName es el ÚNICO archivo .json de esa carpeta que NO es un catálogo.
// En español: "curated.json" es la lista de títulos investigados a mano que se le da al generador
// como ENTRADA (lleva comentarios y una forma propia); no es un catálogo y no tiene por qué cargar
// como tal. Se nombra aquí para excluirlo a propósito, en vez de que la prueba lo excluya "por
// casualidad" al no reconocerlo.
const curatedInputFileName = "curated.json"

// TestEverySeedFileInTheDirectoryStillLoads es la red que impide tener respaldos inservibles.
//
// EL PROBLEMA QUE VIGILA, en español: un respaldo del catálogo existe para una sola cosa —volver
// atrás si el catálogo nuevo sale mal—. Se comprobó y 6 de los 8 respaldos guardados ya NO se
// podían cargar: se habían escrito con campos que el contrato retiró después (las dos claves de
// video sueltas, el reparto de doblaje, las listas de idiomas), y el lector los rechaza a propósito
// para no tragarse datos que no entiende. Es decir, el día que hiciera falta volver atrás no había
// a dónde volver, y nadie lo iba a descubrir hasta ese día exacto.
//
// Los respaldos se migraron al formato vigente. Esta prueba es lo que impide que la situación
// vuelva: a partir de ahora, retirar un campo del contrato hace fallar las pruebas hasta que los
// respaldos se pongan al día también. Un respaldo que no carga no es un respaldo.
func TestEverySeedFileInTheDirectoryStillLoads(t *testing.T) {
	t.Parallel()

	entries, err := os.ReadDir(seedDirectory)
	if err != nil {
		t.Fatalf("failed to list the seed directory: %v", err)
	}

	checked := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		if entry.Name() == curatedInputFileName {
			continue
		}

		checked++
		path := filepath.Join(seedDirectory, entry.Name())
		releases, loadErr := LoadSeed(path)
		if loadErr != nil {
			t.Errorf("the catalog file %q no longer loads: %v", entry.Name(), loadErr)
			continue
		}
		if len(releases) == 0 {
			t.Errorf("the catalog file %q loaded but has no releases", entry.Name())
		}
	}

	if checked == 0 {
		t.Fatal("no catalog files were checked; the seed directory looks wrong")
	}
}
