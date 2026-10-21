// Archivo: loader.go — Carga del catálogo desde el archivo semilla (seed.json).
// En español: este archivo se encarga de leer el "seed.json" del disco al arrancar el backend.
// Ese archivo contiene el catálogo curado a mano de Fase 0 (sin base de datos todavía). Aquí lo
// leemos, lo traducimos de JSON a los tipos del contrato (Release) y comprobamos que tenga sentido
// (que haya estrenos y que cada uno traiga los datos mínimos). Si algo falla, devolvemos un error
// claro para que el arranque se detenga: es preferible no arrancar a arrancar con datos rotos.

package catalog

import (
	"fmt"
	"os"

	"google.golang.org/protobuf/encoding/protojson"

	// catalogv1 contiene los mensajes generados a partir de catalog.proto (Release, ListReleaseDetailsResponse...).
	// En español: son los "tipos de datos" del contrato a los que traducimos el JSON del seed.
	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// LoadSeed lee el archivo semilla del catálogo, lo valida y devuelve la lista de estrenos.
// En español: recibe la ruta del seed.json, lo lee del disco y lo convierte a la estructura del
// contrato. El JSON tiene la forma {"releases":[ ... ]}, idéntica al mensaje ListReleaseDetailsResponse,
// así que reutilizamos ese mensaje para deserializar. Después comprueba que haya al menos un
// estreno y que cada uno traiga id, título y fecha de estreno (los campos mínimos para que el
// catálogo funcione). Devuelve un error con contexto si el archivo no existe, no se puede leer,
// el JSON está mal formado o algún estreno está incompleto.
func LoadSeed(path string) ([]*catalogv1.Release, error) {
	// Leemos el archivo completo del disco a memoria.
	// En español: el seed es pequeño (decenas de estrenos), así que cargarlo entero de una vez
	// es simple y suficiente. Si el archivo no existe o no se puede leer, devolvemos el porqué.
	rawBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("catalog: failed to read seed file %q: %w", path, err)
	}

	// Configuramos la deserialización JSON -> Protobuf.
	// En español: DiscardUnknown en false significa que NO toleramos campos desconocidos en el
	// JSON; así, si el seed tiene una propiedad mal escrita o que no existe en el contrato, el
	// error salta de inmediato en lugar de ignorarse silenciosamente y esconder un dato perdido.
	unmarshalOptions := protojson.UnmarshalOptions{DiscardUnknown: false}

	// Traducimos el JSON al mensaje del contrato que envuelve la lista de estrenos.
	// En español: ListReleaseDetailsResponse ya tiene la forma {"releases":[...]} que usa el seed, por
	// eso lo reutilizamos como "molde" para leer el archivo sin definir una estructura aparte. Antes
	// este molde era ListReleasesResponse, pero esa respuesta dejó de llevar fichas completas cuando el
	// listado pasó a devolver resúmenes; el archivo del catálogo sí las lleva, y este otro mensaje es
	// el que describe exactamente eso (un volcado de fichas completas).
	parsedResponse := &catalogv1.ListReleaseDetailsResponse{}
	if err := unmarshalOptions.Unmarshal(rawBytes, parsedResponse); err != nil {
		return nil, fmt.Errorf("catalog: failed to parse seed file %q as JSON: %w", path, err)
	}

	releases := parsedResponse.GetReleases()

	// Validación de cantidad: un catálogo vacío es señal de un seed roto o de la ruta equivocada.
	// En español: si no hay ni un solo estreno, no tiene sentido arrancar el catálogo; avisamos.
	if len(releases) == 0 {
		return nil, fmt.Errorf("catalog: seed file %q contains no releases", path)
	}

	// seenIDs recuerda en qué índice apareció cada id ya visto, para detectar duplicados.
	// En español: el catálogo se indexa por id; si dos estrenos compartieran id, uno quedaría
	// inaccesible al pedir su detalle (el índice solo guarda uno) mientras seguiría apareciendo en
	// los listados. Eso es una pérdida silenciosa de datos, así que la prohibimos de raíz aquí.
	seenIDs := make(map[string]int, len(releases))

	// Validación de contenido: cada estreno debe traer sus campos mínimos no vacíos y un id único.
	// En español: recorremos uno por uno y, si alguno carece de id, título o fecha, o repite un id,
	// detenemos el arranque indicando la posición exacta del problema para facilitar corregir el seed.
	for index, release := range releases {
		if release.GetId() == "" {
			return nil, fmt.Errorf("catalog: seed file %q has a release at index %d with an empty id", path, index)
		}

		// Rechazamos ids duplicados señalando ambas posiciones para localizarlos rápido en el seed.
		if previousIndex, exists := seenIDs[release.GetId()]; exists {
			return nil, fmt.Errorf(
				"catalog: seed file %q has a duplicate release id %q (at index %d and index %d)",
				path, release.GetId(), previousIndex, index,
			)
		}
		seenIDs[release.GetId()] = index
		if release.GetTitle() == "" {
			return nil, fmt.Errorf(
				"catalog: seed file %q has a release at index %d (id %q) with an empty title",
				path, index, release.GetId(),
			)
		}
		if release.GetReleaseDate() == "" {
			return nil, fmt.Errorf(
				"catalog: seed file %q has a release at index %d (id %q) with an empty release_date",
				path, index, release.GetId(),
			)
		}
	}

	return releases, nil
}
