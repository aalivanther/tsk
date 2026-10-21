package auth

import (
	"context"
	"log/slog"
	"strings"
	"time"
)

// passwordResetPath es la ruta del frontend donde la persona escribe su contraseña nueva.
const passwordResetPath = "/restablecer"

// ResetRecipient es a quién va dirigido un restablecimiento de contraseña.
type ResetRecipient struct {
	// UserID es la cuenta afectada.
	UserID string
	// Email es el correo de la cuenta (a dónde iría el mensaje si hubiera envío de correo).
	Email string
	// DisplayName es el nombre visible, para poder dirigirse a la persona.
	DisplayName string
}

// IssueReset emite el permiso de restablecimiento y devuelve el token EN CLARO junto a su caducidad.
//
// En español: es un "tira de esta cuerda si de verdad vas a entregar el permiso". El canal de
// entrega la recibe y decide si la llama o no. Que la emisión sea una cuerda y no un dato ya hecho
// tiene una consecuencia práctica importante: el canal que NO entrega tokens (el manual de abajo) no
// provoca la emisión de ninguno. Sin esto, cada "he olvidado mi contraseña" del formulario público
// crearía un permiso que nadie puede leer y que —al emitirse— anula el permiso anterior de esa
// cuenta; cualquiera que conociera un correo podría inutilizar una y otra vez el permiso que quien
// administra acabara de entregarle a su dueño.
type IssueReset func(ctx context.Context) (resetToken string, expiresAt time.Time, err error)

// ResetDelivery es el CANAL por el que se hace llegar un restablecimiento de contraseña a su dueño.
//
// En español: es una "toma de corriente" con un enchufe estándar. Hoy hay enchufado un canal manual
// que avisa a quien administra la alpha, porque conectar un proveedor de correo exige un dominio
// propio y una cuenta de pago que la alpha cerrada no justifica. El día que se decida enviar correos
// de verdad, se escribe otra implementación de esta misma interfaz —que sí llamará a issueReset y
// mandará el enlace por correo— y se enchufa en su lugar: ni el handler ni el almacén se enteran.
type ResetDelivery interface {
	// DeliverPasswordReset hace llegar el restablecimiento a su destinatario por el canal que sea.
	// Recibe issueReset para poder emitir el permiso SOLO si va a entregarlo de verdad.
	// Devuelve error si la entrega falló, para que quien llama pueda actuar en consecuencia.
	DeliverPasswordReset(ctx context.Context, recipient ResetRecipient, issueReset IssueReset) error
}

// AdminDelivery es el canal MANUAL de entrega: avisa en el registro del servidor de que alguien pidió
// restablecer su contraseña, para que quien administra la alpha emita el permiso y se lo pase a esa
// persona por el medio privado que ya usen (mensaje directo).
//
// POR QUÉ NO ESCRIBE EL TOKEN EN EL REGISTRO, que es lo que hacía antes:
//
// El token de restablecimiento es, durante la hora que vive, una llave maestra de la cuenta: quien
// lo tenga pone la contraseña que quiera sin conocer la anterior. Un registro es el peor sitio
// posible para dejar una llave así, y no por paranoia: los registros se copian a otros sistemas para
// analizarlos, se rotan a archivos que sobreviven al contenedor, se pegan enteros en un chat cuando
// alguien pide ayuda y los puede leer cualquiera que tenga acceso de lectura a la máquina —que no es
// lo mismo que tener acceso a las cuentas—. Ninguna de esas cosas es un fallo: es lo que se hace
// normalmente con los registros, y por eso no puede haber secretos dentro.
//
// Qué se hace en su lugar: el aviso dice QUIÉN pidió el restablecimiento y el comando exacto que hay
// que ejecutar para atenderlo (`make admin-reset EMAIL=...`). Ese comando ya existía y ya sabía
// emitir el permiso, y su token aparece UNA vez en la terminal de quien administra, sin pasar por
// ningún registro. La contrapartida honesta es que el restablecimiento deja de ser instantáneo: la
// persona espera a que alguien lo atienda. En una alpha cerrada de unas decenas de personas
// conocidas eso es exactamente igual de rápido que como ya se reparten las invitaciones, y la
// alternativa —dejar llaves maestras en los registros— no es aceptable ni siquiera a esta escala.
type AdminDelivery struct {
	// logger es donde se escribe el aviso.
	logger *slog.Logger

	// webBaseURL es la dirección pública del frontend. Sirve para recordar en el aviso a qué
	// pantalla habrá que llevar a la persona con el token que se le entregue.
	webBaseURL string
}

// NewAdminDelivery crea el canal manual de entrega.
// En español: recibe el registro donde escribir y la dirección del frontend (la misma que ya se
// configura para permitir sus llamadas desde el navegador), de modo que no hace falta un ajuste
// nuevo solo para esto.
func NewAdminDelivery(logger *slog.Logger, webBaseURL string) *AdminDelivery {
	return &AdminDelivery{logger: logger, webBaseURL: strings.TrimRight(webBaseURL, "/")}
}

// DeliverPasswordReset avisa en el registro de que hay un restablecimiento pendiente de atender.
//
// En español: NO llama a issueReset a propósito (ver el comentario del tipo). Nadie va a recibir un
// token por esta vía, así que emitir uno solo serviría para anular el que quien administra entregue
// después. Tampoco devuelve error: el aviso se escribió y el trabajo de este canal termina ahí.
func (d *AdminDelivery) DeliverPasswordReset(
	_ context.Context,
	recipient ResetRecipient,
	_ IssueReset,
) error {
	d.logger.Warn(
		"password reset requested: issue it with `make admin-reset` and hand the token over privately",
		slog.String("user_id", recipient.UserID),
		slog.String("email", recipient.Email),
		slog.String("display_name", recipient.DisplayName),
		slog.String("issue_command", "make admin-reset EMAIL="+recipient.Email),
		slog.String("reset_page", d.buildResetPageURL()),
	)
	return nil
}

// buildResetPageURL compone la dirección de la pantalla donde la persona escribirá su contraseña
// nueva, SIN token: el token se lo entrega quien administra por un canal privado y se añade allí.
//
// En español: si no hay dirección de frontend configurada, se devuelve la ruta relativa, que sigue
// siendo útil (quien administra sabe a qué dominio pertenece) y nunca produce una dirección inventada.
func (d *AdminDelivery) buildResetPageURL() string {
	return d.webBaseURL + passwordResetPath
}
