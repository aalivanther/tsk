// Package auth implementa el CICLO DE VIDA COMPLETO de una cuenta: registro, inicio y cierre de
// sesión, cambio de contraseña, restablecimiento de la contraseña olvidada y borrado de la cuenta.
//
// En español: aquí vive la "recepción" del producto. Se apoya en el paquete store, que es quien
// guarda de verdad las cosas en la base de datos; este paquete se ocupa de las reglas (qué
// contraseñas se aceptan, qué se le responde a quién) y de traducir entre el contrato Protobuf y el
// almacén.
//
// DECISIÓN DE ARQUITECTURA — se eliminó el sistema anterior de tokens firmados (HMAC), no se
// conservó ni siquiera para aceptar los tokens ya emitidos. El motivo: aquellos tokens eran un papel
// firmado por el servidor que el servidor no recordaba haber emitido, y por tanto NO SE PODÍAN
// ANULAR. Si alguien copiaba uno, valía 30 días enteros aunque el dueño "cerrara sesión", cambiara
// su contraseña o borrara su cuenta. Toda la Fase BETA existe precisamente para arreglar eso, así
// que mantener una segunda puerta de entrada que sigue sin poder cerrarse habría dejado el agujero
// abierto justo mientras se decía haberlo tapado. El precio de eliminarlo es que las personas que
// tuvieran sesión abierta en el momento de la actualización deben volver a iniciar sesión una vez;
// es un precio pequeño y de una sola vez, y hoy la aplicación está en alpha cerrada, sin usuarios
// externos, que es el mejor momento posible para pagarlo. La clave secreta SESSION_SIGNING_KEY sigue
// siendo obligatoria y sigue teniendo un papel real: ahora es la clave con la que se calcula la
// huella de los tokens guardados (ver store.Options.TokenHashKey).
package auth

import "context"

// contextKey es un tipo privado para las claves de context, para que ninguna otra librería pueda
// pisar accidentalmente lo que guardamos aquí.
type contextKey string

// identityContextKey es la clave bajo la que el interceptor deja la identidad de quien llama.
const identityContextKey contextKey = "auth.identity"

// Identity es quién está haciendo la llamada, según la sesión que presentó.
type Identity struct {
	// UserID es la cuenta autenticada.
	UserID string

	// SessionToken es el token en claro con el que se presentó.
	//
	// En español: se arrastra porque hay una operación que lo necesita: "cerrar sesión" tiene que
	// borrar EXACTAMENTE la sesión con la que se está llamando (no todas las de la cuenta, que
	// dejaría fuera al resto de dispositivos de la persona). El token no se registra en los logs
	// nunca: es una credencial.
	SessionToken string
}

// WithIdentity devuelve un context derivado con la identidad adjunta. Lo usa el interceptor de
// autenticación después de validar la sesión.
func WithIdentity(ctx context.Context, identity Identity) context.Context {
	return context.WithValue(ctx, identityContextKey, identity)
}

// IdentityFromContext extrae la identidad de quien llama. El segundo valor es false cuando la
// llamada es anónima (sin sesión válida).
func IdentityFromContext(ctx context.Context) (Identity, bool) {
	identity, ok := ctx.Value(identityContextKey).(Identity)
	if !ok || identity.UserID == "" {
		return Identity{}, false
	}
	return identity, true
}

// UserIDFromContext es el atajo para cuando solo hace falta saber DE QUIÉN es la llamada y no con
// qué sesión concreta se hizo (que es el caso de casi todos los handlers).
func UserIDFromContext(ctx context.Context) (string, bool) {
	identity, ok := IdentityFromContext(ctx)
	if !ok {
		return "", false
	}
	return identity.UserID, true
}
