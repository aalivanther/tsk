// Archivo: store.go — Almacén en memoria de los estrenos del catálogo.
// En español: este archivo guarda en memoria la lista de estrenos (cargada desde el
// seed.json) y ofrece dos formas de consultarla: listar los estrenos de un mes/año
// con filtros opcionales, y traer el detalle de uno por su identificador. No habla con
// ninguna base de datos: en Fase 0 toda la información vive dentro del proceso, ya
// preparada para responder en milisegundos.

package catalog

import (
	"sort"
	"time"

	// catalogv1 contiene los mensajes generados a partir de catalog.proto (Release, enums...).
	// En español: son los "tipos de datos" del contrato; aquí trabajamos directamente con ellos.
	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// isoDateLayout es el formato de fecha ISO 8601 "AAAA-MM-DD" en la notación de referencia de Go.
// En español: Go expresa los formatos de fecha con la fecha-patrón "2006-01-02" (2 ene 2006). Se
// la pasamos a time.Parse para que entienda y VALIDE las fechas del seed de verdad (rechazando
// días o meses imposibles, signos raros, o formatos que no calcen).
const isoDateLayout = "2006-01-02"

// Store es el almacén en memoria de los estrenos del catálogo.
// En español: es como una pequeña "bodega" que tiene la lista completa de estrenos y, además,
// un índice por ID para encontrar cualquiera al instante. Se construye una sola vez al arrancar
// el backend (con NewStore) y luego solo se consulta; nunca se modifica en caliente.
type Store struct {
	// releases es la lista completa de estrenos tal como llegó del seed.
	// En español: es el "catálogo entero", del que partimos para filtrar por mes, tipo, etc.
	releases []*catalogv1.Release

	// byID indexa cada estreno por su identificador, para encontrarlo en tiempo constante O(1).
	// En español: es un diccionario donde la "palabra" es el ID y la "definición" es el estreno
	// completo. Así, pedir un detalle por ID no recorre toda la lista: lo encuentra de inmediato.
	byID map[string]*catalogv1.Release
}

// NewStore construye un Store a partir de la lista de estrenos y arma su índice por ID.
// En español: recibe el catálogo completo (ya validado por el loader) y prepara el diccionario
// de búsqueda por ID. Si dos estrenos compartieran ID (no debería pasar tras la validación del
// loader), el último gana en el índice, pero ambos siguen presentes en la lista para el listado.
func NewStore(releases []*catalogv1.Release) *Store {
	// Construimos el índice por ID recorriendo la lista una sola vez.
	// En español: precalcular este diccionario al arrancar evita tener que buscar linealmente
	// en cada petición de detalle, manteniendo las respuestas rápidas y predecibles.
	byID := make(map[string]*catalogv1.Release, len(releases))
	for _, release := range releases {
		byID[release.GetId()] = release
	}

	return &Store{
		releases: releases,
		byID:     byID,
	}
}

// List devuelve los estrenos de un año y mes concretos, aplicando filtros opcionales.
// En español: recorre el catálogo y se queda con los estrenos cuya fecha cae en el año y mes
// pedidos. Los filtros por tipo y por categoría son opcionales: si la lista respectiva viene
// vacía, ese criterio NO filtra (vacío = "todos"). El resultado sale ordenado de forma estable:
// primero por fecha de estreno ascendente y, ante empate, por título en orden lexicográfico por
// código de carácter (NO es una ordenación alfabética localizada es-MX: los acentos no se igualan
// a su letra base). Es determinista y reproducible, que es lo que necesita la línea de tiempo para
// mostrar siempre los mismos elementos en el mismo orden.
func (s *Store) List(
	year int32,
	month int32,
	types []catalogv1.TitleType,
	categories []catalogv1.Category,
) []*catalogv1.Release {
	// Preparamos conjuntos de filtros para consultar la pertenencia en tiempo constante.
	// En español: convertimos las listas de tipos/categorías permitidos en "conjuntos" (mapas)
	// para preguntar rápido "¿este tipo está permitido?" sin recorrer la lista en cada estreno.
	allowedTypes := buildTypeFilterSet(types)
	allowedCategories := buildCategoryFilterSet(categories)

	// Recolectamos los estrenos que cumplen TODOS los criterios activos.
	// En español: empezamos con una lista vacía y vamos agregando solo los que pasan el cribado.
	matches := make([]*catalogv1.Release, 0, len(s.releases))
	for _, release := range s.releases {
		// Extraemos el año y el mes de la fecha ISO del estreno.
		// En español: si la fecha está vacía o mal formada, este estreno simplemente no entra
		// en ningún listado por periodo (se ignora sin romper la consulta).
		releaseYear, releaseMonth, ok := parseYearMonth(release.GetReleaseDate())
		if !ok {
			continue
		}

		// Filtro por periodo: el estreno debe ser exactamente de ese año y mes.
		if releaseYear != year || releaseMonth != month {
			continue
		}

		// Filtro por tipo (solo si se pidió alguno): el tipo del estreno debe estar permitido.
		if allowedTypes != nil {
			if _, isAllowed := allowedTypes[release.GetType()]; !isAllowed {
				continue
			}
		}

		// Filtro por categoría (solo si se pidió alguna): la categoría debe estar permitida.
		if allowedCategories != nil {
			if _, isAllowed := allowedCategories[release.GetCategory()]; !isAllowed {
				continue
			}
		}

		// El estreno superó todos los filtros activos: lo incluimos en el resultado.
		matches = append(matches, release)
	}

	// Ordenamos el resultado de forma estable y determinista.
	// En español: garantizamos que dos llamadas idénticas devuelvan exactamente el mismo orden.
	// El criterio principal es la fecha ascendente; el desempate es el título alfabético.
	sort.SliceStable(matches, func(firstIndex, secondIndex int) bool {
		first := matches[firstIndex]
		second := matches[secondIndex]

		// Si las fechas difieren, mandamos primero la más temprana (orden ascendente).
		if first.GetReleaseDate() != second.GetReleaseDate() {
			return first.GetReleaseDate() < second.GetReleaseDate()
		}

		// Con la misma fecha, desempatamos por título (orden por código de carácter, determinista).
		return first.GetTitle() < second.GetTitle()
	})

	return matches
}

// Releases devuelve la lista completa de estrenos que tiene cargados este almacén.
//
// En español: la usa el vigilante del catálogo (watcher.go) para volver a contar, cada cierto
// tiempo, cuántos estrenos hay y cuántos días de futuro les quedan. Devuelve la lista tal cual, sin
// copiarla, porque un almacén NUNCA se modifica por dentro: cuando el catálogo se renueva se
// sustituye el almacén entero por uno nuevo. Esa regla es la que hace que compartir la lista sea
// seguro; si algún día se rompiera, habría que devolver una copia.
func (s *Store) Releases() []*catalogv1.Release {
	return s.releases
}

// Get devuelve el detalle de un estreno por su identificador.
// En español: busca en el índice por ID y devuelve el estreno junto con un booleano que indica
// si se encontró (true) o no (false). Quien llama decide qué hacer cuando no existe (por ejemplo,
// responder "no encontrado"). No devuelve error porque "no existe" no es un fallo, es un resultado.
func (s *Store) Get(id string) (*catalogv1.Release, bool) {
	release, found := s.byID[id]
	return release, found
}

// buildTypeFilterSet convierte la lista de tipos permitidos en un conjunto para consultas rápidas.
// En español: si la lista viene vacía, devolvemos nil para señalar "no filtrar por tipo" (todos
// pasan). Si trae valores, armamos un mapa-conjunto donde basta preguntar si un tipo está presente.
func buildTypeFilterSet(types []catalogv1.TitleType) map[catalogv1.TitleType]struct{} {
	// Lista vacía significa "sin filtro": devolvemos nil para que List lo trate como "todos".
	if len(types) == 0 {
		return nil
	}

	set := make(map[catalogv1.TitleType]struct{}, len(types))
	for _, titleType := range types {
		set[titleType] = struct{}{}
	}
	return set
}

// buildCategoryFilterSet convierte la lista de categorías permitidas en un conjunto de consulta.
// En español: igual que con los tipos, una lista vacía significa "no filtrar por categoría"
// (devolvemos nil); con valores, armamos el conjunto para preguntar la pertenencia al instante.
func buildCategoryFilterSet(categories []catalogv1.Category) map[catalogv1.Category]struct{} {
	// Lista vacía significa "sin filtro": devolvemos nil para que List lo trate como "todas".
	if len(categories) == 0 {
		return nil
	}

	set := make(map[catalogv1.Category]struct{}, len(categories))
	for _, category := range categories {
		set[category] = struct{}{}
	}
	return set
}

// parseYearMonth extrae el año y el mes de una fecha ISO 8601 con forma "AAAA-MM-DD".
// En español: usa time.Parse, que VALIDA la fecha de verdad: rechaza fechas vacías o mal
// formadas, con signos incrustados (ej. "+026-06-15" o "2026-+6-15"), con días o meses
// imposibles (ej. "2026-06-99" o "2026-13-01") y cualquier formato que no calce exactamente con
// "AAAA-MM-DD". Devuelve un tercer valor booleano que vale false cuando la fecha no es válida; en
// ese caso, quien llama debe descartar ese estreno sin romper la consulta.
func parseYearMonth(releaseDate string) (year, month int32, ok bool) {
	// Intentamos interpretar la cadena como una fecha real con el formato ISO esperado.
	// En español: si time.Parse devuelve error, la fecha es inválida y la rechazamos.
	parsedDate, err := time.Parse(isoDateLayout, releaseDate)
	if err != nil {
		return 0, 0, false
	}

	// La fecha es válida: devolvemos su año y su mes ya como números del periodo.
	return int32(parsedDate.Year()), int32(parsedDate.Month()), true
}
