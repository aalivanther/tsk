package server

import "net/http"

// corsAllowedHeaders son las cabeceras que el navegador tiene permiso de enviar al API.
// Las Connect-* son las del propio protocolo; Authorization lleva el token de sesión del frontend actual.
const corsAllowedHeaders = "Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms, " +
	"Connect-Accept-Encoding, Connect-Content-Encoding, X-User-Agent"

// CORS envuelve un handler con los permisos que el NAVEGADOR exige para dejar que una página de un
// origen (por ejemplo http://localhost:3100) llame a un API que vive en otro (http://localhost:8080).
//
// En español: por defecto el navegador prohíbe esas llamadas entre orígenes distintos; estas
// cabeceras son la autorización explícita del API. Solo se permite el origen configurado, nunca "*":
// abrir el API a cualquier página web sería regalar el acceso a las cuentas.
func CORS(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("Access-Control-Allow-Origin", allowedOrigin)
		header.Set("Vary", "Origin")
		header.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		header.Set("Access-Control-Allow-Headers", corsAllowedHeaders)
		// Allow-Credentials es lo que permite que la COOKIE de sesión viaje en estas llamadas entre
		// orígenes distintos. Sin ella, el navegador manda la petición pero sin cookie, y la sesión
		// nunca se reconocería. Es seguro precisamente porque el origen permitido es UNO concreto:
		// la propia especificación prohíbe combinar credenciales con el comodín "*", y aquí nunca se
		// usa el comodín.
		header.Set("Access-Control-Allow-Credentials", "true")
		header.Set("Access-Control-Max-Age", "86400")

		// Preflight: antes del POST real, el navegador pregunta "¿puedo?". Se responde sin cuerpo.
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
