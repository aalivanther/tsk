package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"connectrpc.com/connect"

	"mdm7mo/internal/auth"
	"mdm7mo/internal/store"
)

// cookieHeader es la cabecera donde el navegador manda, por su cuenta, las cookies del sitio.
const cookieHeader = "Cookie"

// SessionLookup es lo único que el interceptor necesita saber hacer del almacén: traducir un token
// en la sesión que representa.
//
// En español: se declara como interfaz, y no como el tipo concreto del almacén, para que las pruebas
// del interceptor puedan comprobar su comportamiento (qué pasa con un token bueno, uno malo, uno
// caducado) sin montar una base de datos entera. Es también la forma de dejar claro que el
// interceptor no puede hacer nada más que consultar: no crea ni borra sesiones.
type SessionLookup interface {
	// LookupSession devuelve la sesión viva a la que corresponde un token.
	LookupSession(ctx context.Context, token string) (store.Session, error)
}

// AuthInterceptor crea el "filtro" que identifica a quien llama antes de que la petición llegue a su
// destino.
//
// De dónde saca la identidad: ÚNICAMENTE de la cookie "tsk_session".
//
// Hubo un tiempo en que también se aceptaba un token en la cabecera "Authorization", porque la web y
// el API vivían en direcciones distintas y el navegador no habría mandado la cookie. Eso obligaba a
// que la página guardara el token donde su propio JavaScript pudiera leerlo — y, con él, cualquier
// script que alguien lograra colar. Desde que la web habla con el API a través de su propio dominio
// (ver el puente en web/app/rpc), la cookie llega sola y ese camino sobra. Se ha quitado a propósito:
// una credencial que el JavaScript de la página NO PUEDE LEER no se puede robar leyéndola, y dejar
// abierto un segundo camino que ya nadie usa solo daría una puerta más que vigilar.
//
// El interceptor NO rechaza las llamadas sin sesión: en este producto se puede explorar el catálogo
// sin cuenta. Simplemente no adjunta identidad, y cada handler decide si la necesita. Tampoco
// distingue "no había token" de "el token no vale": ambos casos siguen como llamada anónima.
func AuthInterceptor(sessions SessionLookup, logger *slog.Logger) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, request connect.AnyRequest) (connect.AnyResponse, error) {
			token := sessionTokenFromCookie(request.Header())
			if token == "" {
				return next(ctx, request)
			}

			session, err := sessions.LookupSession(ctx, token)
			switch {
			case errors.Is(err, store.ErrSessionNotFound):
				// Token desconocido, ya cerrado o caducado: la llamada sigue como anónima. No es un
				// error del servidor ni hay nada que registrar; es el caso normal de una sesión vieja.
				return next(ctx, request)
			case err != nil:
				// Aquí sí hubo un problema REAL al consultar (por ejemplo, la base no responde). No
				// se puede confirmar la identidad, así que la llamada continúa como anónima, pero
				// queda constancia: si esto pasa, no es que la gente tenga tokens malos, es que algo
				// está roto y hay que verlo en los registros. El token NUNCA se registra.
				logger.Warn("failed to look up session; continuing as anonymous", slog.String("error", err.Error()))
				return next(ctx, request)
			}

			ctx = auth.WithIdentity(ctx, auth.Identity{
				UserID:       session.UserID,
				SessionToken: token,
			})
			return next(ctx, request)
		}
	}
}

// sessionTokenFromCookie busca la cookie de sesión entre las cookies de la petición.
//
// En español: las cabeceras que trae Connect no son una petición HTTP completa, así que no se puede
// pedir la cookie directamente. Se arma una petición mínima que solo lleva esas cabeceras y se usa
// el lector de cookies de la librería estándar, en lugar de partir el texto a mano: el formato de
// esa cabecera tiene más esquinas de las que parece y no merece la pena reimplementarlo.
func sessionTokenFromCookie(header http.Header) string {
	rawCookies := header.Get(cookieHeader)
	if rawCookies == "" {
		return ""
	}

	carrier := http.Request{Header: http.Header{cookieHeader: []string{rawCookies}}}
	cookie, err := carrier.Cookie(auth.SessionCookieName)
	if err != nil {
		// No venía esa cookie entre las demás: no es un fallo, simplemente no hay token por aquí.
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}
