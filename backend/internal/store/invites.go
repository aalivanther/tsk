package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// inviteCodePrefix es el prefijo fijo de los códigos de invitación ("The Story Keeper").
// En español: sirve para que un código se reconozca de un vistazo y para descartar de inmediato
// cualquier cosa pegada por error que no tenga esta forma.
const inviteCodePrefix = "TSK"

// inviteCodeGroupLength es cuántos caracteres lleva cada uno de los dos grupos del código.
const inviteCodeGroupLength = 4

// inviteCodeBodyLength es el total de caracteres aleatorios del código (dos grupos de cuatro).
const inviteCodeBodyLength = inviteCodeGroupLength * 2

// inviteCodeAlphabet es el juego de caracteres de los códigos: base32 SIN los que se confunden al
// dictarlos o teclearlos (no hay I, L, O ni U). En español: el código está pensado para que una
// persona se lo mande a otra por mensaje y lo escriba a mano; quitar las letras ambiguas evita la
// mitad de los "no me funciona el código".
const inviteCodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// inviteCodeAlphabetMask permite elegir un carácter del alfabeto a partir de un byte aleatorio sin
// introducir sesgo. Funciona porque el alfabeto tiene exactamente 32 caracteres (una potencia de
// dos): quedarse con los 5 bits bajos de un byte al azar da los 32 valores con la misma probabilidad.
const inviteCodeAlphabetMask = 0x1F

// DefaultInviteTTL es cuánto vale una invitación desde que se genera si no se dice otra cosa.
// En español: 30 días es tiempo de sobra para que la persona invitada se anime a entrar, y a la vez
// evita que un código olvidado en una conversación siga sirviendo un año después.
const DefaultInviteTTL = 30 * 24 * time.Hour

// Invite es una invitación tal como se acaba de generar. El código EN CLARO solo existe en este
// momento: en la base únicamente queda su huella.
type Invite struct {
	// Code es el código legible que hay que entregar a la persona invitada ("TSK-XXXX-XXXX").
	Code string
	// Note es la nota para acordarse de a quién se le dio.
	Note string
	// ExpiresAt es hasta cuándo sirve.
	ExpiresAt time.Time
}

// CreateInvite genera un código de invitación nuevo, guarda su huella y devuelve el código en claro.
//
// En español: el código se enseña UNA sola vez, justo aquí. A partir de este momento ni el servidor
// ni quien lo administra pueden volver a leerlo, porque en disco solo queda una huella irreversible.
// Si se pierde, se genera otro.
func (s *Store) CreateInvite(ctx context.Context, note string, timeToLive time.Duration) (Invite, error) {
	if timeToLive <= 0 {
		timeToLive = DefaultInviteTTL
	}

	code, err := generateInviteCode()
	if err != nil {
		return Invite{}, err
	}

	createdAt := s.now().UTC()
	expiresAt := createdAt.Add(timeToLive)

	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO invites (code_hash, note, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		s.hashToken(canonicalInviteCode(code)),
		strings.TrimSpace(note),
		createdAt.Unix(),
		expiresAt.Unix(),
	); err != nil {
		return Invite{}, fmt.Errorf("store: no se pudo guardar la invitación: %w", err)
	}

	return Invite{Code: code, Note: strings.TrimSpace(note), ExpiresAt: expiresAt}, nil
}

// verifyInviteIsUsableWithinTransaction comprueba, SIN canjearla, que una invitación sirve.
//
// En español: existe por un motivo de privacidad, no de corrección. El canje de verdad
// (consumeInviteWithinTransaction) ocurre después de crear la cuenta, porque la invitación tiene que
// apuntar a una cuenta que ya exista; el efecto secundario de ese orden era que un correo repetido
// se detectaba ANTES que un código inválido, y las dos respuestas distintas convertían el registro
// en un buscador de correos ajenos para cualquiera, con código o sin él. Adelantando esta
// comprobación, quien no traiga un código válido recibe siempre la misma negativa.
//
// No sustituye al canje ni debilita el "un solo uso": comprobar y canjear siguen siendo dos cosas, y
// la que manda es el canje, que es una única sentencia condicional. Entre ambas no se puede colar
// nadie porque las dos ocurren dentro de la MISMA transacción y el almacén trabaja con una sola
// conexión (ver maxOpenConnections), así que no hay dos transacciones vivas a la vez.
//
// Devuelve ErrInviteNotUsable si el código no existe, ya caducó o ya lo canjeó alguien.
func (s *Store) verifyInviteIsUsableWithinTransaction(
	ctx context.Context,
	tx *sql.Tx,
	code string,
	now time.Time,
) error {
	normalized := canonicalInviteCode(code)
	if !looksLikeInviteCode(normalized) {
		// Ni siquiera tiene la forma de un código: no hace falta consultar la base.
		return ErrInviteNotUsable
	}

	var usableInvites int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT COUNT(*)
		   FROM invites
		  WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
		s.hashToken(normalized),
		now.Unix(),
	).Scan(&usableInvites); err != nil {
		return fmt.Errorf("store: no se pudo comprobar la invitación: %w", err)
	}
	if usableInvites == 0 {
		return ErrInviteNotUsable
	}
	return nil
}

// consumeInviteWithinTransaction marca una invitación como canjeada, dentro de la transacción que
// está creando la cuenta. Es privada a propósito: canjear una invitación FUERA del alta de una
// cuenta no tiene sentido y abriría la puerta a que el código quedara quemado sin cuenta detrás.
//
// Devuelve ErrInviteNotUsable si el código no existe, ya caducó o ya lo canjeó alguien.
func (s *Store) consumeInviteWithinTransaction(
	ctx context.Context,
	tx *sql.Tx,
	code, userID string,
	usedAt time.Time,
) error {
	normalized := canonicalInviteCode(code)
	if !looksLikeInviteCode(normalized) {
		// Ni siquiera tiene la forma de un código: no hace falta consultar la base.
		return ErrInviteNotUsable
	}

	// La condición del UPDATE es la que hace el trabajo de seguridad: solo modifica la fila si
	// SIGUE sin usar y SIGUE vigente. Al ser una única sentencia dentro de la transacción, no
	// existe un hueco entre "comprobar" y "marcar" por el que se pudiera colar un segundo registro.
	result, err := tx.ExecContext(
		ctx,
		`UPDATE invites
		    SET used_by = ?, used_at = ?
		  WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
		userID,
		usedAt.Unix(),
		s.hashToken(normalized),
		usedAt.Unix(),
	)
	if err != nil {
		return fmt.Errorf("store: no se pudo canjear la invitación: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("store: no se pudo comprobar el canje de la invitación: %w", err)
	}
	if affected == 0 {
		return ErrInviteNotUsable
	}
	return nil
}

// generateInviteCode crea un código nuevo con el formato "TSK-XXXX-XXXX".
// En español: los ocho caracteres salen del generador criptográfico del sistema, así que no se
// pueden predecir a partir de códigos anteriores.
func generateInviteCode() (string, error) {
	randomBytes := make([]byte, inviteCodeBodyLength)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("store: no se pudo generar el código de invitación: %w", err)
	}

	body := make([]byte, inviteCodeBodyLength)
	for index, randomByte := range randomBytes {
		body[index] = inviteCodeAlphabet[randomByte&inviteCodeAlphabetMask]
	}

	return fmt.Sprintf(
		"%s-%s-%s",
		inviteCodePrefix,
		body[:inviteCodeGroupLength],
		body[inviteCodeGroupLength:],
	), nil
}

// canonicalInviteCode reduce un código escrito por una persona a su forma única y comparable.
//
// En español: la gente escribe los códigos con minúsculas, con espacios, sin guiones o copiando de
// más. Aquí se quita todo lo que no sea letra o número y se pasa a mayúsculas, de modo que
// "tsk 9k2m-4rt7", "TSK-9K2M-4RT7" y "tsk9k2m4rt7" acaben siendo exactamente el mismo texto. La
// huella se calcula SIEMPRE sobre esta forma, para que la comparación no dependa de cómo se copió.
func canonicalInviteCode(code string) string {
	var builder strings.Builder
	builder.Grow(len(code))
	for _, character := range strings.ToUpper(code) {
		if (character >= '0' && character <= '9') || (character >= 'A' && character <= 'Z') {
			builder.WriteRune(character)
		}
	}
	return builder.String()
}

// looksLikeInviteCode comprueba que un código ya normalizado tenga la forma esperada: el prefijo
// seguido de ocho caracteres del alfabeto permitido.
func looksLikeInviteCode(normalized string) bool {
	if len(normalized) != len(inviteCodePrefix)+inviteCodeBodyLength {
		return false
	}
	if !strings.HasPrefix(normalized, inviteCodePrefix) {
		return false
	}
	for _, character := range normalized[len(inviteCodePrefix):] {
		if !strings.ContainsRune(inviteCodeAlphabet, character) {
			return false
		}
	}
	return true
}

// errNoInviteAvailable se usa solo en pruebas y utilidades internas para señalar que se buscó una
// invitación que no está. No se expone fuera del paquete porque el flujo público nunca consulta una
// invitación suelta: solo la canjea al crear la cuenta.
var errNoInviteAvailable = errors.New("store: invitación inexistente")

// inviteUsedBy indica quién canjeó una invitación, o error si no consta canje.
// En español: existe para que las pruebas puedan confirmar que el canje quedó atado a la cuenta
// correcta, que es la parte del comportamiento que más importa verificar de las invitaciones.
func (s *Store) inviteUsedBy(ctx context.Context, code string) (string, error) {
	var usedBy *string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT used_by FROM invites WHERE code_hash = ? AND used_at IS NOT NULL`,
		s.hashToken(canonicalInviteCode(code)),
	).Scan(&usedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNoInviteAvailable
	}
	if err != nil {
		return "", fmt.Errorf("store: no se pudo consultar la invitación: %w", err)
	}
	if usedBy == nil {
		return "", errNoInviteAvailable
	}
	return *usedBy, nil
}
