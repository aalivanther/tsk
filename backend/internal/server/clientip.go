package server

// Archivo: clientip.go — Cómo averiguamos QUIÉN hace cada petición cuando hay un proxy delante.
//
// En español: el servidor limita cuántas peticiones puede hacer cada cliente (ver limits.go). Para
// eso necesita distinguir a un cliente de otro, y lo hace por su dirección IP. El problema aparece al
// desplegar detrás de un proxy (todas las plataformas de hosting ponen uno): a partir de ese momento
// la conexión que ve el servidor NO viene del usuario, sino del proxy. Si siguiéramos usando esa
// dirección, TODOS los usuarios del mundo compartirían el mismo contador y el límite de intentos de
// inicio de sesión (10 por minuto) se convertiría en 10 por minuto PARA TODA LA APLICACIÓN: el primer
// puñado de personas que entrara dejaría fuera a las demás. Es decir, nos bloquearíamos a nosotros
// mismos el día del lanzamiento.
//
// La solución estándar es leer la cabecera "X-Forwarded-For", donde cada proxy va anotando de dónde
// recibió la petición. Pero esa cabecera la puede FALSIFICAR cualquiera: si un atacante manda
// "X-Forwarded-For: 1.2.3.4", un servidor ingenuo se lo cree y el atacante puede inventar una IP
// distinta en cada intento para saltarse el límite por completo.
//
// La regla segura, y la que aplica este archivo:
//   - Solo se hace caso a la cabecera si SE HA DECLARADO cuántos proxies de confianza hay delante
//     (variable de entorno TRUSTED_PROXY_HOPS). Si vale 0 —lo normal en local—, se ignora la cabecera
//     por completo y se usa la dirección real de la conexión.
//   - Se cuenta desde la DERECHA, no desde la izquierda. La lista crece por la derecha conforme la
//     petición atraviesa proxies, así que las últimas entradas las escribieron NUESTROS proxies y son
//     de fiar; las primeras las pudo escribir el cliente y no valen nada.

import (
	"net"
	"net/http"
	"strings"
)

// forwardedForHeader es la cabecera estándar donde los proxies anotan la cadena de direcciones.
const forwardedForHeader = "X-Forwarded-For"

// ClientIPResolver decide la dirección de un cliente según cuántos proxies de confianza hay delante.
// En español: se construye UNA vez al arrancar con el número declarado en la configuración y se
// consulta en cada petición. Es inmutable, así que se puede usar desde varias goroutines sin candados.
type ClientIPResolver struct {
	// trustedProxyHops es cuántos proxies NUESTROS hay entre el usuario y este servidor.
	// 0 significa "ninguno": el servidor recibe conexiones directas y la cabecera se ignora.
	trustedProxyHops int
}

// NewClientIPResolver crea el resolvedor. Un número negativo se trata como 0 (sin proxies), que es la
// opción segura: ante una configuración absurda, preferimos no fiarnos de ninguna cabecera.
func NewClientIPResolver(trustedProxyHops int) *ClientIPResolver {
	if trustedProxyHops < 0 {
		trustedProxyHops = 0
	}
	return &ClientIPResolver{trustedProxyHops: trustedProxyHops}
}

// ClientIP devuelve la dirección que identifica al cliente de esta petición.
//
// En español, con un ejemplo. Supongamos que hay 1 proxy de confianza (TRUSTED_PROXY_HOPS=1) y llega:
//
//	X-Forwarded-For: 9.9.9.9, 203.0.113.7
//
// La última entrada (203.0.113.7) la escribió nuestro proxy y dice de dónde recibió la petición: ese
// es el usuario real. La primera (9.9.9.9) la pudo escribir el propio cliente para engañarnos, así
// que se descarta. Con 2 proxies de confianza, saltaríamos una entrada más hacia la izquierda.
func (r *ClientIPResolver) ClientIP(request *http.Request) string {
	// La dirección de la conexión es siempre nuestro punto de partida y el respaldo de todo.
	directAddress := hostFromRemoteAddr(request.RemoteAddr)

	// Sin proxies declarados no se lee la cabecera: es la configuración de desarrollo y la segura.
	if r.trustedProxyHops == 0 {
		return directAddress
	}

	addresses := parseForwardedFor(request.Header.Get(forwardedForHeader))
	if len(addresses) == 0 {
		return directAddress
	}

	// Contamos saltos desde la DERECHA. Con 1 proxy, queremos la última entrada; con 2, la penúltima.
	index := len(addresses) - r.trustedProxyHops
	if index < 0 {
		// La cadena es más corta de lo declarado: alguien no puso la cabecera o hay menos proxies de
		// los configurados. Nos quedamos con la entrada más a la izquierda de las que SÍ existen,
		// nunca con una posición inventada.
		index = 0
	}
	if index >= len(addresses) {
		return directAddress
	}
	return addresses[index]
}

// parseForwardedFor parte la cabecera en direcciones limpias, descartando entradas vacías o inválidas.
// En español: la cabecera es una lista separada por comas con posibles espacios; además, algunas
// implementaciones incluyen el puerto o corchetes de IPv6. Aquí se normaliza todo a una IP a secas, y
// se descarta cualquier cosa que no sea una dirección válida (basura que alguien haya inyectado).
func parseForwardedFor(header string) []string {
	if strings.TrimSpace(header) == "" {
		return nil
	}
	parts := strings.Split(header, ",")
	addresses := make([]string, 0, len(parts))
	for _, part := range parts {
		candidate := strings.TrimSpace(part)
		if candidate == "" {
			continue
		}
		// Puede venir como "ip:puerto"; si es así, nos quedamos con la ip.
		if host, _, err := net.SplitHostPort(candidate); err == nil {
			candidate = host
		}
		// Los corchetes de IPv6 ("[::1]") sobran una vez separado el puerto.
		candidate = strings.Trim(candidate, "[]")
		if net.ParseIP(candidate) == nil {
			// No es una dirección válida: la ignoramos en vez de usar texto arbitrario como llave.
			continue
		}
		addresses = append(addresses, candidate)
	}
	return addresses
}

// hostFromRemoteAddr extrae la IP de la dirección de la conexión ("ip:puerto" -> "ip").
// Si no se puede partir (caso raro), devuelve la cadena tal cual: mejor una llave imperfecta que
// dejar pasar una petición sin ninguna cuota.
func hostFromRemoteAddr(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}
