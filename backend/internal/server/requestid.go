package server

// Archivo: requestid.go — El "número de ticket" de cada petición.
//
// En español: cuando algo falla en producción, el trabajo consiste en reconstruir qué pasó leyendo
// los registros. El problema es que el servidor atiende muchas peticiones a la vez y sus líneas de
// log se entremezclan: sin una marca común, es imposible saber cuáles pertenecen al mismo suceso.
//
// Este middleware le pone a cada petición un identificador único al entrar, lo guarda en el contexto
// (para que cualquier parte del código pueda incluirlo en sus registros) y lo devuelve al cliente en
// la cabecera "X-Request-Id". Así, si un usuario reporta un problema, basta con que comparta ese
// identificador para encontrar exactamente sus líneas de log entre miles.
//
// Si el cliente (o un proxy) ya envió un identificador, se respeta en vez de generar otro: eso
// permite seguir una misma petición a través de varios servicios.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

// requestIDHeader es la cabecera donde viaja el identificador, de entrada y de salida.
const requestIDHeader = "X-Request-Id"

// requestIDBytes es cuántos bytes aleatorios tiene un identificador generado (16 = 32 caracteres hex).
// En español: suficiente para que dos peticiones no coincidan jamás en la práctica.
const requestIDBytes = 16

// maxAcceptedRequestIDLength acota el identificador que viene de fuera.
// En español: se acepta el que mande el cliente para poder seguir una petición entre servicios, pero
// sin permitir que meta un texto gigantesco que luego acabaría en todos los registros.
const maxAcceptedRequestIDLength = 128

// requestIDContextKey es el tipo privado de la clave del contexto (evita choques con otras librerías).
type requestIDContextKey struct{}

// WithRequestID devuelve un contexto que lleva adjunto el identificador de la petición.
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDContextKey{}, requestID)
}

// RequestIDFromContext recupera el identificador del contexto. El segundo valor es false si no hay.
func RequestIDFromContext(ctx context.Context) (string, bool) {
	requestID, ok := ctx.Value(requestIDContextKey{}).(string)
	if !ok || requestID == "" {
		return "", false
	}
	return requestID, true
}

// RequestID envuelve un handler asignando (o respetando) el identificador de cada petición.
// En español: va en la puerta del servidor, antes que todo lo demás, para que cualquier registro
// posterior —incluidos los de las llamadas rechazadas por cuota— pueda incluirlo.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestID := sanitizeIncomingRequestID(request.Header.Get(requestIDHeader))
		if requestID == "" {
			requestID = newRequestID()
		}

		// Se devuelve al cliente para que pueda citarlo si algo falla.
		writer.Header().Set(requestIDHeader, requestID)

		next.ServeHTTP(writer, request.WithContext(WithRequestID(request.Context(), requestID)))
	})
}

// sanitizeIncomingRequestID valida el identificador recibido de fuera.
// En español: solo se aceptan caracteres inofensivos (letras, números, guion y guion bajo) y una
// longitud acotada. Cualquier otra cosa se descarta y se genera uno nuevo: un identificador acaba
// escrito en los registros, y no se debe permitir que alguien inyecte ahí texto arbitrario.
func sanitizeIncomingRequestID(candidate string) string {
	if candidate == "" || len(candidate) > maxAcceptedRequestIDLength {
		return ""
	}
	for _, character := range candidate {
		isDigit := character >= '0' && character <= '9'
		isLower := character >= 'a' && character <= 'z'
		isUpper := character >= 'A' && character <= 'Z'
		isSeparator := character == '-' || character == '_'
		if !isDigit && !isLower && !isUpper && !isSeparator {
			return ""
		}
	}
	return candidate
}

// newRequestID genera un identificador aleatorio en hexadecimal.
// En español: si la fuente de aleatoriedad del sistema fallara (algo prácticamente imposible), se
// devuelve una cadena vacía y el middleware seguirá funcionando sin identificador, en vez de tumbar
// la petición: un log menos detallado es preferible a un servicio caído.
func newRequestID() string {
	buffer := make([]byte, requestIDBytes)
	if _, err := rand.Read(buffer); err != nil {
		return ""
	}
	return hex.EncodeToString(buffer)
}
