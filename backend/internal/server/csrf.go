package server

import (
	"net/http"
	"strings"
)

// Archivo: csrf.go — Rechaza las peticiones que otro sitio web intenta hacer en tu nombre.
//
// El problema, explicado sin tecnicismos:
//
// Desde que la sesión vive en una cookie, el navegador la manda SOLO, sin que la página tenga que
// hacer nada. Eso es lo que la hace segura frente a scripts inyectados (ningún script puede leerla),
// pero abre otra puerta: si estando con la sesión abierta visitas una página cualquiera de otro sitio,
// esa página puede intentar mandarle una orden a nuestro servidor —"bórrale la cuenta", "cámbiale la
// contraseña"— y el navegador adjuntaría tu cookie obedientemente. El servidor vería una petición
// perfectamente válida tuya. A ese engaño se le llama falsificación de petición entre sitios.
//
// La defensa es comprobar DE DÓNDE viene la orden. Un navegador siempre delata el origen de una
// petición que cambia algo, y no deja que la página lo falsee. Aquí se aprovechan las dos señales que
// mandan los navegadores actuales:
//
//   - "Sec-Fetch-Site": el propio navegador dice si la petición nace de nuestro sitio o de otro. Es la
//     señal más fiable porque la escribe el navegador, no la página, y la página no puede tocarla.
//   - "Origin": la dirección del sitio desde el que se lanzó. También la pone el navegador.
//
// Sobre las peticiones que NO traen ninguna de las dos: se dejan pasar. No es un descuido. Un
// navegador SIEMPRE manda al menos una de las dos en una petición que modifica algo; si no viene
// ninguna, quien llama no es un navegador (una herramienta de línea de comandos, una prueba
// automatizada, otro servidor), y en ese caso no hay ningún engaño posible: nadie tiene una sesión
// abierta a la que engañar. Rechazarlas solo rompería las herramientas legítimas sin ganar nada.
//
// Esto es una capa ADICIONAL, no la única: la cookie ya se emite con la marca que impide que se envíe
// en navegaciones desde otros sitios, y el protocolo que habla esta aplicación exige una cabecera que
// un formulario de otro sitio no puede añadir. Se ponen las tres porque son baratas y ninguna sola es
// infalible.

// originHeader es la cabecera donde el navegador declara desde qué sitio se lanzó la petición.
const originHeader = "Origin"

// fetchSiteHeader es la cabecera con la que el navegador clasifica la relación entre el sitio de
// origen y el de destino.
const fetchSiteHeader = "Sec-Fetch-Site"

// crossSiteValue es el valor de esa cabecera que significa "esto viene de un sitio ajeno".
const crossSiteValue = "cross-site"

// CSRFGuard envuelve un handler y bloquea las peticiones que cambian algo y vienen de otro sitio.
//
// allowedOrigin es la dirección de nuestro propio frontend, la única desde la que tiene sentido que
// llegue una orden. Sale de la configuración (la misma que ya gobierna los permisos del navegador),
// de modo que no hay una segunda lista que mantener sincronizada a mano.
func CSRFGuard(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		// Las peticiones que solo LEEN no se comprueban: un engaño de este tipo busca provocar un
		// cambio, y leer el catálogo público no cambia nada. Además, restringirlas rompería enlaces
		// legítimos desde otros sitios.
		if isReadOnlyMethod(request.Method) {
			next.ServeHTTP(writer, request)
			return
		}

		if isCrossSiteRequest(request, allowedOrigin) {
			// Se responde con un texto claro y sin detalles internos. Quien ve este mensaje es, casi
			// siempre, quien está desarrollando y ha configurado mal la dirección del frontend.
			http.Error(
				writer,
				"cross-site request rejected: this endpoint only accepts requests from its own frontend",
				http.StatusForbidden,
			)
			return
		}

		next.ServeHTTP(writer, request)
	})
}

// isReadOnlyMethod dice si el método HTTP es de los que solo consultan.
func isReadOnlyMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

// isCrossSiteRequest decide si la petición nació fuera de nuestro propio frontend.
//
// El orden importa: se mira primero la señal del navegador (Sec-Fetch-Site) porque es la más precisa,
// y solo después la dirección declarada (Origin). Si no llega ninguna de las dos, la petición no
// viene de un navegador y se considera legítima (ver la explicación de arriba).
func isCrossSiteRequest(request *http.Request, allowedOrigin string) bool {
	fetchSite := strings.TrimSpace(request.Header.Get(fetchSiteHeader))
	if fetchSite != "" {
		// Los valores posibles son "same-origin", "same-site", "none" (el usuario escribió la
		// dirección o abrió un marcador) y "cross-site". Solo el último delata a otro sitio.
		return strings.EqualFold(fetchSite, crossSiteValue)
	}

	origin := strings.TrimSpace(request.Header.Get(originHeader))
	if origin == "" {
		// Ni una señal ni la otra: no es un navegador. No hay sesión ajena que aprovechar.
		return false
	}
	// "null" es lo que manda un navegador desde contextos sin dirección propia (por ejemplo, una
	// página abierta desde un archivo local o dentro de un marco aislado). Nunca es nuestro frontend.
	if strings.EqualFold(origin, "null") {
		return true
	}
	return !strings.EqualFold(origin, allowedOrigin)
}
