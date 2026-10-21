// Archivo: summary.go — Convierte la ficha COMPLETA de un estreno en su versión de LISTA.
//
// En español: la ficha completa de una película trae todo lo que se sabe de ella (reparto, equipo,
// galería, calendario de episodios, saga y videos). Las pantallas que enseñan LISTAS de estrenos
// —la línea de tiempo, la agenda del teléfono, el buscador, los avisos y el fondo— no leen nada de
// eso: solo el título, la fecha, la carátula y un puñado de datos más. Este archivo es el filtro que
// se queda con esa parte y descarta el resto antes de mandarlo por la red.
//
// Por qué esto vive en el servidor y no en el navegador: porque el problema que resuelve es
// justamente el TAMAÑO de lo que viaja. Filtrar en el navegador exigiría que los datos llegaran
// primero, que es exactamente lo que se quiere evitar.
//
// Además calcula los tres datos DERIVADOS del resumen (el nombre de la saga, quién dirige y el
// reparto principal). Esa deducción vive aquí, en un solo sitio, para que no acabe existiendo una
// segunda versión de las mismas reglas escrita en TypeScript: dos copias de una regla terminan,
// tarde o temprano, diciendo cosas distintas.

package catalog

import (
	"strings"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// leadCastDepth es cuántos nombres del reparto entran en el resumen.
//
// En español: los diez primeros. El reparto viene ordenado por importancia, así que esos son los
// protagonistas — los que de verdad hacen que alguien diga "ah, es la de este actor". Este número
// tiene que coincidir con el que usa la interfaz al buscar conexiones (CAST_DEPTH en
// web/src/lib/timeline.ts): si aquí se mandaran menos nombres de los que allá se comparan, algunas
// conexiones reales dejarían de aparecer sin que nada fallara.
const leadCastDepth = 10

// directorRoles son los nombres del puesto de dirección tal y como VIENEN EN LOS DATOS.
//
// En español: se reconocen las tres formas que aparecen en el catálogo real. La fuente de datos
// (TMDB) los entrega en inglés ("Director"), y se acepta también la forma en español por si alguna
// curaduría manual los escribiera así. Es la MISMA lista que usaba la interfaz antes de que este
// cálculo se mudara al servidor, de modo que las conexiones "mismo director" salen exactamente
// iguales que antes; cambiar el criterio sería una decisión de producto, no parte de este cambio.
var directorRoles = map[string]struct{}{
	"director":        {},
	"dirección":       {},
	"series director": {},
}

// directingDepartment es cómo llama TMDB al área de trabajo de la dirección.
//
// En español: TMDB clasifica a cada persona de la ficha técnica en un área ("Directing", "Writing",
// "Sound", "Production"…). Esa lista es cerrada y viene siempre en inglés, así que se compara contra
// este texto exacto (sin distinguir mayúsculas).
const directingDepartment = "directing"

// belongsToDirectingDepartment dice si un crédito pertenece al área de dirección de TMDB.
//
// EL DETALLE QUE HACE ÚTIL ESTA FUNCIÓN, y que es la razón de que no baste con comparar el área a
// secas: el área SOLA no sirve para saber quién dirigió algo. Se contó sobre el catálogo vigente: de
// 540 créditos con área "Directing", 69 (el 12,8 %) son asistentes de dirección, supervisores de
// guion o directores de segunda unidad. El área agrupa al departamento entero, no a quien firma la
// obra. Por eso quien decide sigue siendo el PUESTO (ver directorRoles) y el área se usa aquí solo
// como filtro de seguridad, para que un puesto que lleve la palabra "director" pero pertenezca a
// otro departamento —"Casting Director", que TMDB clasifica en Producción— no pueda colarse.
//
// El área VACÍA se acepta a propósito. Es un dato que se empezó a guardar más tarde que el resto: los
// respaldos del catálogo y los títulos de curaduría antiguos traen el puesto pero no el área. Si aquí
// se exigiera, cargar uno de esos archivos dejaría de reconocer a NINGÚN director, y la conexión
// "mismo director" desaparecería de golpe sin que nada fallara. Ausencia de dato no es contradicción:
// solo el área que dice explícitamente otra cosa descarta el crédito.
func belongsToDirectingDepartment(department string) bool {
	normalized := strings.ToLower(strings.TrimSpace(department))
	return normalized == "" || normalized == directingDepartment
}

// summaryOf construye el resumen de un estreno a partir de su ficha completa.
//
// En español: copia tal cual los campos que las listas sí dibujan y deduce los tres derivados. Nunca
// devuelve nil para una ficha válida: un resumen vacío sería indistinguible de "no hay estreno".
func summaryOf(release *catalogv1.Release) *catalogv1.ReleaseSummary {
	if release == nil {
		return nil
	}

	summary := &catalogv1.ReleaseSummary{
		Id:          release.GetId(),
		Type:        release.GetType(),
		Category:    release.GetCategory(),
		Title:       release.GetTitle(),
		Overview:    release.GetOverview(),
		ReleaseDate: release.GetReleaseDate(),
		PosterUrl:   release.GetPosterUrl(),
		BackdropUrl: release.GetBackdropUrl(),
		// Los géneros se copian a un arreglo NUEVO en vez de compartir el de la ficha: el catálogo
		// vive en memoria y lo leen muchas peticiones a la vez, así que dos respuestas no deben poder
		// acabar apuntando al mismo arreglo y modificándolo sin querer.
		Genres:       append([]string(nil), release.GetGenres()...),
		Ratings:      release.GetRatings(),
		Availability: release.GetAvailability(),
		// La etiqueta del idioma de la sinopsis viaja también en el resumen: la vista previa que se
		// abre al pulsar un día pinta esa sinopsis desde aquí y, sin la etiqueta, no tenía forma de
		// avisar de que el texto no está en español (le pasa a 112 de los 422 estrenos del catálogo).
		OverviewLanguage: release.GetOverviewLanguage(),
		SagaName:         release.GetSaga().GetName(),
		DirectorNames:    directorNamesOf(release),
		LeadCastNames:    leadCastNamesOf(release),
	}

	return summary
}

// summariesOf convierte una lista de fichas completas en la lista de sus resúmenes.
// En español: conserva el orden recibido, que es el orden estable que espera la línea de tiempo.
func summariesOf(releases []*catalogv1.Release) []*catalogv1.ReleaseSummary {
	summaries := make([]*catalogv1.ReleaseSummary, 0, len(releases))
	for _, release := range releases {
		summaries = append(summaries, summaryOf(release))
	}
	return summaries
}

// directorNamesOf saca los nombres de quienes dirigen un estreno, sin repetir.
//
// En español: recorre el equipo técnico y se queda con los créditos que cumplen DOS condiciones a la
// vez: que su puesto sea de dirección (ver directorRoles) y que su área de trabajo no diga que
// pertenecen a otro departamento (ver belongsToDirectingDepartment). Se descartan los nombres vacíos
// (un crédito sin nombre no conecta con nada) y los repetidos (una persona puede figurar dos veces
// con puestos distintos).
//
// Por qué las dos condiciones y no una, en español: el área sola metería a los asistentes de
// dirección (uno de cada ocho créditos de esa área lo es) y el puesto solo dejaría entrar a
// cualquier puesto de otro departamento que lleve la palabra "director". Juntas, cada una tapa el
// agujero de la otra. Sobre el catálogo de hoy el resultado es idéntico al del puesto solo —los 471
// créditos con puesto de dirección tienen todos el área "Directing"—, así que esto no cambia lo que
// se ve: cambia lo que puede pasar mañana.
func directorNamesOf(release *catalogv1.Release) []string {
	names := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)

	for _, credit := range release.GetCrew() {
		if _, isDirector := directorRoles[strings.ToLower(strings.TrimSpace(credit.GetRole()))]; !isDirector {
			continue
		}
		if !belongsToDirectingDepartment(credit.GetDepartment()) {
			continue
		}
		name := strings.TrimSpace(credit.GetName())
		if name == "" {
			continue
		}
		if _, alreadySeen := seen[name]; alreadySeen {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}

	return names
}

// leadCastNamesOf saca los nombres del reparto principal (ver leadCastDepth), sin repetir.
//
// En español: se toman los primeros créditos de reparto, que es como llegan ordenados por
// importancia, y se descartan los vacíos y los repetidos por el mismo motivo que arriba. El recorte
// se aplica sobre los créditos CONSIDERADOS, no sobre los nombres finales, para que el resultado sea
// idéntico al que producía la interfaz cuando hacía este mismo cálculo con la ficha completa.
func leadCastNamesOf(release *catalogv1.Release) []string {
	cast := release.GetCast()
	if len(cast) > leadCastDepth {
		cast = cast[:leadCastDepth]
	}

	names := make([]string, 0, len(cast))
	seen := make(map[string]struct{}, len(cast))

	for _, credit := range cast {
		name := strings.TrimSpace(credit.GetName())
		if name == "" {
			continue
		}
		if _, alreadySeen := seen[name]; alreadySeen {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}

	return names
}
