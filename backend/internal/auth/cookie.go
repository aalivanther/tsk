package auth

import (
	"net/http"
	"time"

	"mdm7mo/internal/store"
)

// SessionCookieName es el nombre de la cookie donde viaja la sesión.
//
// En español: una cookie es una nota que el navegador guarda por su cuenta y reenvía sola en cada
// petición al mismo sitio. Es el camino PREFERIDO para la sesión porque, marcada como HttpOnly, el
// código JavaScript de la página no puede leerla: aunque alguien lograra colar un script malicioso,
// no podría robársela. El token que se devuelve además en la respuesta existe para el frontend
// actual, que todavía lo guarda a mano.
const SessionCookieName = "tsk_session"

// sessionCookiePath es la ruta para la que vale la cookie: todo el sitio.
const sessionCookiePath = "/"

// SessionCookieOptions son los ajustes con los que se emite la cookie de sesión.
type SessionCookieOptions struct {
	// Secure hace que el navegador solo mande la cookie por conexiones cifradas (HTTPS).
	//
	// En español: en producción debe estar SIEMPRE activo; si no, la sesión viajaría legible por la
	// red. En el desarrollo local, donde se trabaja sobre http://localhost sin cifrado, tiene que
	// estar apagado o el navegador nunca mandaría la cookie y el inicio de sesión no funcionaría.
	// Por eso se decide a partir de la configuración y no se fija a fuego aquí.
	Secure bool
}

// NewSessionCookie arma la cookie que abre una sesión en el navegador.
//
// Los ajustes elegidos, y por qué:
//   - HttpOnly: el JavaScript de la página no puede leerla (defensa contra robo por scripts).
//   - SameSite=Lax: el navegador no la manda cuando la petición nace en OTRO sitio web, que es lo
//     que neutraliza el ataque clásico de "una web maliciosa hace acciones en tu nombre".
//   - MaxAge igual a la vida de la sesión: el navegador la tira solo cuando ya no puede servir.
func NewSessionCookie(token string, options SessionCookieOptions) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     sessionCookiePath,
		MaxAge:   int(store.SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   options.Secure,
		SameSite: http.SameSiteLaxMode,
	}
}

// NewExpiredSessionCookie arma la cookie que BORRA la sesión del navegador (al cerrar sesión o al
// borrar la cuenta).
//
// En español: no existe una orden de "borra esta cookie". La forma de conseguirlo es mandar la misma
// cookie vacía y con fecha de caducidad en el pasado; el navegador entiende que ya no sirve y la
// tira. Los demás ajustes deben coincidir con los de la cookie original o el navegador la trataría
// como una cookie distinta y no borraría nada.
func NewExpiredSessionCookie(options SessionCookieOptions) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     sessionCookiePath,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
		HttpOnly: true,
		Secure:   options.Secure,
		SameSite: http.SameSiteLaxMode,
	}
}
