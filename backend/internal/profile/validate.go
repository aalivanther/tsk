// Package profile implementa el servicio de PERFIL: el lugar donde se guarda, atado a la cuenta y
// no al navegador, todo lo que la persona ha ido acumulando en la aplicación (su lista de "quiero
// ver", lo que ya vio, sus reseñas, sus ajustes y su actividad reciente).
//
// En español: hasta ahora ese perfil vivía solo en el navegador, así que cambiar de teléfono a
// computadora significaba empezar de cero. El perfil se guarda como UN documento completo en formato
// JSON; el servidor no necesita entender su estructura interna para almacenarlo, pero sí la revisa
// antes de aceptarlo, porque un servidor que guarda a ciegas lo que le mandan acaba siendo el
// almacén gratuito de cualquiera.
package profile

import (
	"encoding/json"
	"errors"
	"fmt"
)

// maxProfileDocumentBytes es el tamaño máximo aceptado para el documento de perfil.
//
// En español: un perfil real, con cientos de títulos guardados y reseñas, ronda unas pocas decenas
// de kilobytes. 128 KiB deja muchísimo margen para el uso legítimo y a la vez impide que alguien
// convierta su cuenta en un disco duro gratis. Es un tope MÁS ESTRICTO que el límite general de
// tamaño de petición del servidor (1 MiB), a propósito: aquel protege al servidor de mensajes
// enormes; este protege a la base de datos de perfiles absurdos.
const maxProfileDocumentBytes = 128 * 1024

// maxIdentifiersPerList es cuántos títulos como máximo puede tener cada lista del perfil.
//
// En español: 500 películas o series en "quiero ver" es más de lo que nadie acumula en años de uso;
// una lista con más que eso no viene de una persona usando la aplicación, sino de un programa
// llenándola. El tope evita que una cuenta crezca sin freno.
const maxIdentifiersPerList = 500

// maxReviewedTitles es cuántas reseñas como máximo se aceptan. Mismo razonamiento que las listas.
const maxReviewedTitles = 500

// maxActivityEvents es cuántos eventos de actividad reciente se aceptan.
// En español: la actividad es una memoria CORTA (lo último que hiciste), no un historial infinito;
// el frontend ya la recorta a 50, y el servidor comprueba que así sea.
const maxActivityEvents = 50

// maxSeenNotifications es cuántos avisos marcados como vistos se aceptan.
const maxSeenNotifications = 200

// maxIdentifierLength es lo más largo que puede ser el identificador de un título.
// En español: los identificadores del catálogo son cortos ("movie-1234"); un valor de 200 caracteres
// ya es sospechoso y no hay ninguna razón legítima para aceptarlo.
const maxIdentifierLength = 200

// minReviewScore y maxReviewScore son las notas válidas de una reseña (de 1 a 10).
const (
	minReviewScore = 1.0
	maxReviewScore = 10.0
)

// errEmptyDocument indica que llegó un documento vacío donde se esperaba un perfil.
var errEmptyDocument = errors.New("profile: el documento del perfil viene vacío")

// profileDocument es la parte del perfil que el servidor SÍ mira para validarla.
//
// En español: no se declaran todos los campos posibles a propósito. El servidor comprueba lo que
// puede crecer sin límite o tomar valores absurdos (las listas, las notas), y deja pasar el resto
// tal cual. Así el frontend puede añadir un ajuste nuevo sin que haya que tocar el backend, y a la
// vez ninguna de las cosas que importan queda sin revisar.
type profileDocument struct {
	Watchlist         []string           `json:"watchlist"`
	Watched           []string           `json:"watched"`
	Reviews           map[string]float64 `json:"reviews"`
	Activity          []activityEvent    `json:"activity"`
	SeenNotifications []string           `json:"seenNotifications"`
}

// activityEvent es una acción registrada en la actividad reciente del perfil.
type activityEvent struct {
	Kind  string   `json:"kind"`
	ID    string   `json:"id"`
	At    string   `json:"at"`
	Score *float64 `json:"score"`
}

// validateDocument revisa que un documento de perfil sea aceptable antes de guardarlo.
//
// En español: comprueba tres cosas. Que sea JSON de verdad (si no, la base se llenaría de basura que
// reventaría al leerla). Que no ocupe más de lo razonable. Y que sus listas y notas estén dentro de
// límites lógicos. Devuelve un error explicando QUÉ está mal, para que el cliente pueda corregirlo.
func validateDocument(rawDocument string) error {
	if rawDocument == "" {
		return errEmptyDocument
	}
	if len(rawDocument) > maxProfileDocumentBytes {
		return fmt.Errorf(
			"profile: el perfil ocupa %d bytes y el máximo son %d",
			len(rawDocument), maxProfileDocumentBytes,
		)
	}

	var document profileDocument
	if err := json.Unmarshal([]byte(rawDocument), &document); err != nil {
		return fmt.Errorf("profile: el perfil no es un documento JSON válido: %w", err)
	}

	if err := validateIdentifierList("watchlist", document.Watchlist, maxIdentifiersPerList); err != nil {
		return err
	}
	if err := validateIdentifierList("watched", document.Watched, maxIdentifiersPerList); err != nil {
		return err
	}
	if err := validateIdentifierList("seenNotifications", document.SeenNotifications, maxSeenNotifications); err != nil {
		return err
	}
	if err := validateReviews(document.Reviews); err != nil {
		return err
	}
	return validateActivity(document.Activity)
}

// validateIdentifierList comprueba que una lista de identificadores no se pase de larga y que cada
// identificador tenga una pinta razonable.
func validateIdentifierList(listName string, identifiers []string, maximumEntries int) error {
	if len(identifiers) > maximumEntries {
		return fmt.Errorf(
			"profile: la lista %q tiene %d elementos y el máximo son %d",
			listName, len(identifiers), maximumEntries,
		)
	}
	for _, identifier := range identifiers {
		if identifier == "" {
			return fmt.Errorf("profile: la lista %q contiene un identificador vacío", listName)
		}
		if len(identifier) > maxIdentifierLength {
			return fmt.Errorf(
				"profile: la lista %q contiene un identificador de %d caracteres (máximo %d)",
				listName, len(identifier), maxIdentifierLength,
			)
		}
	}
	return nil
}

// validateReviews comprueba que las reseñas sean pocas y con notas dentro del rango del producto.
func validateReviews(reviews map[string]float64) error {
	if len(reviews) > maxReviewedTitles {
		return fmt.Errorf(
			"profile: hay %d reseñas y el máximo son %d",
			len(reviews), maxReviewedTitles,
		)
	}
	for identifier, score := range reviews {
		if identifier == "" || len(identifier) > maxIdentifierLength {
			return errors.New("profile: hay una reseña con un identificador de título inválido")
		}
		if score < minReviewScore || score > maxReviewScore {
			return fmt.Errorf(
				"profile: la reseña de %q tiene nota %v y solo se aceptan notas entre %v y %v",
				identifier, score, minReviewScore, maxReviewScore,
			)
		}
	}
	return nil
}

// validateActivity comprueba que la actividad reciente no crezca más allá de su tope y que las notas
// que la acompañan sigan la misma regla que las reseñas.
func validateActivity(events []activityEvent) error {
	if len(events) > maxActivityEvents {
		return fmt.Errorf(
			"profile: la actividad tiene %d eventos y el máximo son %d",
			len(events), maxActivityEvents,
		)
	}
	for _, event := range events {
		if event.ID == "" || len(event.ID) > maxIdentifierLength {
			return errors.New("profile: hay un evento de actividad con un identificador de título inválido")
		}
		if event.Score != nil && (*event.Score < minReviewScore || *event.Score > maxReviewScore) {
			return fmt.Errorf(
				"profile: un evento de actividad lleva nota %v y solo se aceptan notas entre %v y %v",
				*event.Score, minReviewScore, maxReviewScore,
			)
		}
	}
	return nil
}
