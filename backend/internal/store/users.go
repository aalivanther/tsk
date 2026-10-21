package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// sqliteUniqueConstraintFragment es el trozo de texto que SQLite pone en el mensaje de error cuando
// se intenta insertar un valor duplicado en una columna UNIQUE.
//
// En español: el controlador de SQLite en Go puro no expone códigos de error tipados que se puedan
// comparar directamente, así que la única forma de distinguir "correo repetido" de un fallo real de
// disco es mirar el texto del error. Se comprueba también el nombre de la columna para no confundir
// este caso con la duplicidad de cualquier otra clave.
const sqliteUniqueConstraintFragment = "UNIQUE constraint failed: users.email"

// User es una cuenta tal como vive en la base de datos.
type User struct {
	// ID es el identificador opaco de la cuenta.
	ID string
	// Email es el correo normalizado (minúsculas, sin espacios alrededor).
	Email string
	// DisplayName es el nombre visible elegido por la persona.
	DisplayName string
	// PasswordHash es la huella bcrypt de su contraseña (nunca la contraseña).
	PasswordHash string
	// CreatedAt es cuándo se creó la cuenta.
	CreatedAt time.Time
	// AcceptedPrivacyAt es cuándo aceptó el aviso de privacidad, o nil si aún no consta.
	AcceptedPrivacyAt *time.Time
}

// NewUser son los datos con los que se da de alta una cuenta.
type NewUser struct {
	// ID es el identificador ya generado por quien llama (el handler de registro).
	ID string
	// Email es el correo, que se normaliza aquí antes de guardarse.
	Email string
	// DisplayName es el nombre visible.
	DisplayName string
	// PasswordHash es la huella bcrypt de la contraseña, calculada ANTES de llamar (a propósito:
	// calcular bcrypt es lento por diseño, y no queremos tener la base ocupada mientras tanto).
	PasswordHash string
	// AcceptedPrivacyAt es cuándo aceptó el aviso de privacidad, o nil si no consta.
	AcceptedPrivacyAt *time.Time
	// InviteCode es el código de invitación a canjear. Cadena vacía = la instalación no exige
	// invitación, y entonces no se toca la tabla de invitaciones.
	InviteCode string
}

// userSelectColumns son las columnas que se leen al recuperar una cuenta, siempre en el mismo orden.
const userSelectColumns = `id, email, display_name, password_hash, created_at, accepted_privacy_at`

// CreateUser da de alta una cuenta y, si se pidió, canjea su código de invitación EN LA MISMA
// operación indivisible.
//
// En español: esto es lo que hace imposible el fraude clásico de las invitaciones. Si el canje y el
// alta fueran dos pasos separados, dos personas podrían mandar su registro en el mismo instante,
// las dos verían el código "sin usar" y las dos entrarían. Al hacerlo todo dentro de una única
// transacción, la segunda se encuentra el código ya marcado y es rechazada.
//
// Devuelve ErrEmailTaken si el correo ya existe, y ErrInviteNotUsable si el código no sirve.
func (s *Store) CreateUser(ctx context.Context, params NewUser) (User, error) {
	email := NormalizeEmail(params.Email)
	createdAt := s.now().UTC()

	user := User{
		ID:                params.ID,
		Email:             email,
		DisplayName:       params.DisplayName,
		PasswordHash:      params.PasswordHash,
		CreatedAt:         createdAt,
		AcceptedPrivacyAt: params.AcceptedPrivacyAt,
	}

	err := s.runInTransaction(ctx, func(tx *sql.Tx) error {
		// Paso 1: si la instalación exige invitación, COMPROBAR que el código sirve antes de tocar
		// nada más.
		//
		// Por qué esta comprobación existe además del canje real del paso 3: sin ella, quien no
		// tuviera ninguna invitación podía usar el registro como buscador de correos ajenos. Bastaba
		// con mandar un código inventado y mirar la respuesta: si el correo ya tenía cuenta, el alta
		// fallaba primero por correo repetido ("ya existe"); si no la tenía, el alta pasaba y el
		// fallo llegaba después por la invitación ("código inválido"). Dos respuestas distintas =
		// un sí o un no a "¿esta persona está registrada?", gratis y sin gastar nada.
		//
		// Comprobando el código PRIMERO, quien no traiga uno válido recibe siempre la misma
		// respuesta ("código inválido") y nunca llega a enterarse de si el correo existía.
		if params.InviteCode != "" {
			if err := s.verifyInviteIsUsableWithinTransaction(ctx, tx, params.InviteCode, createdAt); err != nil {
				return err
			}
		}

		// Paso 2: crear la cuenta.
		//
		// El ORDEN importa y no es intercambiable: la invitación, al canjearse, anota QUIÉN la usó
		// apuntando a la cuenta correspondiente. Si se canjeara antes de que esa cuenta exista, la
		// base rechazaría la operación por apuntar a alguien inexistente.
		//
		// Hacerlo en este orden NO debilita la garantía de "un solo uso": ambos pasos ocurren dentro
		// de la misma transacción, así que si el código resulta inválido o ya usado, TODO se deshace
		// —incluida la cuenta recién insertada— y no queda rastro. Dicho de otro modo: o se crean la
		// cuenta y el canje juntos, o no se crea ninguno de los dos.
		_, err := tx.ExecContext(
			ctx,
			`INSERT INTO users (id, email, display_name, password_hash, created_at, accepted_privacy_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			user.ID,
			user.Email,
			user.DisplayName,
			user.PasswordHash,
			user.CreatedAt.Unix(),
			unixOrNil(user.AcceptedPrivacyAt),
		)
		if err != nil {
			if strings.Contains(err.Error(), sqliteUniqueConstraintFragment) {
				return ErrEmailTaken
			}
			return fmt.Errorf("store: no se pudo crear la cuenta: %w", err)
		}

		// Paso 3: canjear la invitación de verdad, si la instalación las exige. Este paso, y no la
		// comprobación del paso 1, es el que garantiza el "un solo uso". Si falla, la transacción se
		// deshace entera y la cuenta del paso anterior desaparece con ella.
		if params.InviteCode != "" {
			if err := s.consumeInviteWithinTransaction(ctx, tx, params.InviteCode, params.ID, createdAt); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return User{}, err
	}

	return user, nil
}

// FindUserByEmail busca una cuenta ACTIVA por su correo.
// En español: "activa" significa que no está inhabilitada (deleted_at vacío). Una cuenta suspendida
// se comporta, a todos los efectos, como si no existiera.
func (s *Store) FindUserByEmail(ctx context.Context, email string) (User, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT `+userSelectColumns+` FROM users WHERE email = ? AND deleted_at IS NULL`,
		NormalizeEmail(email),
	)
	return scanUser(row)
}

// FindUserByID busca una cuenta ACTIVA por su identificador.
func (s *Store) FindUserByID(ctx context.Context, id string) (User, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT `+userSelectColumns+` FROM users WHERE id = ? AND deleted_at IS NULL`,
		id,
	)
	return scanUser(row)
}

// UpdatePasswordAndRevokeSessions cambia la contraseña de una cuenta y cierra TODAS sus sesiones.
//
// En español: las dos cosas van juntas a propósito y en una sola operación indivisible. Cambiar la
// contraseña sin cerrar las sesiones abiertas dejaría dentro a quien hubiera entrado con la
// contraseña vieja, que es justo de quien uno se quiere deshacer al cambiarla. Al estar unidas en la
// misma transacción, no existe forma de hacer una sin la otra ni de olvidarse.
//
// Devuelve cuántas sesiones se cerraron (útil para dejarlo en el registro del servidor).
func (s *Store) UpdatePasswordAndRevokeSessions(ctx context.Context, userID, newPasswordHash string) (int64, error) {
	var revokedSessions int64

	err := s.runInTransaction(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(
			ctx,
			`UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL`,
			newPasswordHash,
			userID,
		)
		if err != nil {
			return fmt.Errorf("store: no se pudo actualizar la contraseña: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("store: no se pudo comprobar el cambio de contraseña: %w", err)
		}
		if affected == 0 {
			return ErrUserNotFound
		}

		revokedSessions, err = deleteUserSessionsWithinTransaction(ctx, tx, userID)
		return err
	})
	if err != nil {
		return 0, err
	}
	return revokedSessions, nil
}

// DeleteUser borra FÍSICAMENTE una cuenta y, en cascada, su perfil y todas sus sesiones.
//
// En español: es la "cancelación" del aviso de privacidad, y por eso el borrado es real y no una
// marca. No hace falta borrar el perfil ni las sesiones a mano: las claves foráneas declaradas con
// ON DELETE CASCADE se encargan de arrastrarlos, lo cual además garantiza que no pueda quedar nada
// olvidado por un descuido del código.
func (s *Store) DeleteUser(ctx context.Context, userID string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, userID)
	if err != nil {
		return fmt.Errorf("store: no se pudo borrar la cuenta: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("store: no se pudo comprobar el borrado de la cuenta: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}
	return nil
}

// UserSummary es la ficha resumida de una cuenta para la herramienta de administración.
type UserSummary struct {
	// User son los datos de la cuenta.
	User User
	// OpenSessions es cuántas sesiones vivas tiene en este momento.
	OpenSessions int
	// HasProfile indica si ya ha guardado su perfil en el servidor.
	HasProfile bool
}

// ListUsers devuelve todas las cuentas activas con su resumen, de la más nueva a la más vieja.
// En español: la usa el comando de administración "list-users" para saber quién hay dentro sin
// tener que abrir la base a mano.
func (s *Store) ListUsers(ctx context.Context) ([]UserSummary, error) {
	now := s.now().UTC().Unix()

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT `+userSelectColumns+`,
		        (SELECT COUNT(*) FROM sessions WHERE sessions.user_id = users.id AND sessions.expires_at > ?),
		        (SELECT COUNT(*) FROM profiles WHERE profiles.user_id = users.id)
		 FROM users
		 WHERE deleted_at IS NULL
		 ORDER BY created_at DESC`,
		now,
	)
	if err != nil {
		return nil, fmt.Errorf("store: no se pudieron listar las cuentas: %w", err)
	}
	defer func() { _ = rows.Close() }()

	summaries := make([]UserSummary, 0)
	for rows.Next() {
		var (
			user              User
			createdAtUnix     int64
			acceptedPrivacy   *int64
			openSessions      int
			profileRowsForUse int
		)
		if err := rows.Scan(
			&user.ID,
			&user.Email,
			&user.DisplayName,
			&user.PasswordHash,
			&createdAtUnix,
			&acceptedPrivacy,
			&openSessions,
			&profileRowsForUse,
		); err != nil {
			return nil, fmt.Errorf("store: no se pudo leer una fila de cuentas: %w", err)
		}
		user.CreatedAt = time.Unix(createdAtUnix, 0).UTC()
		user.AcceptedPrivacyAt = timeFromUnixPointer(acceptedPrivacy)

		summaries = append(summaries, UserSummary{
			User:         user,
			OpenSessions: openSessions,
			HasProfile:   profileRowsForUse > 0,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: error recorriendo las cuentas: %w", err)
	}
	return summaries, nil
}

// rowScanner es lo mínimo que necesitamos de una fila para leer una cuenta. Sirve tanto para
// *sql.Row (una fila suelta) como para *sql.Rows (dentro de un recorrido).
type rowScanner interface {
	Scan(destinations ...any) error
}

// scanUser convierte una fila de la tabla users en la estructura User.
func scanUser(row rowScanner) (User, error) {
	var (
		user                  User
		createdAtUnix         int64
		acceptedPrivacyAtUnix *int64
	)
	err := row.Scan(
		&user.ID,
		&user.Email,
		&user.DisplayName,
		&user.PasswordHash,
		&createdAtUnix,
		&acceptedPrivacyAtUnix,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("store: no se pudo leer la cuenta: %w", err)
	}

	user.CreatedAt = time.Unix(createdAtUnix, 0).UTC()
	user.AcceptedPrivacyAt = timeFromUnixPointer(acceptedPrivacyAtUnix)
	return user, nil
}

// NormalizeEmail estandariza un correo para poder compararlo siempre igual (minúsculas y sin
// espacios alrededor). En español: sin esto, "Ana@Example.com " y "ana@example.com" parecerían dos
// cuentas distintas y alguien podría registrarse dos veces con el mismo correo.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
