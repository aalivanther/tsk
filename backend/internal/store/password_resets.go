package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// DefaultPasswordResetTTL es cuánto vale un permiso de restablecimiento desde que se emite.
//
// En español: este token es, durante su vigencia, una llave maestra de la cuenta: quien lo tenga
// puede poner la contraseña que quiera sin conocer la anterior. Por eso su vida es CORTA. Una hora
// es tiempo suficiente para que la persona lo reciba y lo use, y demasiado poco para que sirva de
// nada si aparece meses después en un historial de mensajes.
const DefaultPasswordResetTTL = time.Hour

// PasswordReset es un permiso de restablecimiento recién emitido. El token en claro solo existe
// aquí; en la base queda su huella.
type PasswordReset struct {
	// Token es el valor que hay que hacer llegar a la persona.
	Token string
	// UserID es la cuenta a la que pertenece.
	UserID string
	// ExpiresAt es hasta cuándo sirve.
	ExpiresAt time.Time
}

// CreatePasswordReset emite un permiso de restablecimiento para una cuenta e invalida los anteriores.
//
// En español: invalidar los anteriores es importante. Si alguien pide restablecer su contraseña tres
// veces seguidas porque no le llega, no deben quedar tres llaves maestras vivas a la vez: vale la
// última y las demás mueren en el acto.
func (s *Store) CreatePasswordReset(
	ctx context.Context,
	userID string,
	timeToLive time.Duration,
) (PasswordReset, error) {
	if timeToLive <= 0 {
		timeToLive = DefaultPasswordResetTTL
	}

	token, err := newOpaqueToken()
	if err != nil {
		return PasswordReset{}, err
	}

	createdAt := s.now().UTC()
	expiresAt := createdAt.Add(timeToLive)

	err = s.runInTransaction(ctx, func(tx *sql.Tx) error {
		// Fuera los permisos anteriores de esta cuenta (usados o no).
		if _, err := tx.ExecContext(ctx, `DELETE FROM password_resets WHERE user_id = ?`, userID); err != nil {
			return fmt.Errorf("store: no se pudieron invalidar los restablecimientos anteriores: %w", err)
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
			s.hashToken(token),
			userID,
			createdAt.Unix(),
			expiresAt.Unix(),
		); err != nil {
			return fmt.Errorf("store: no se pudo emitir el restablecimiento de contraseña: %w", err)
		}
		return nil
	})
	if err != nil {
		return PasswordReset{}, err
	}

	return PasswordReset{Token: token, UserID: userID, ExpiresAt: expiresAt}, nil
}

// ConsumePasswordReset canjea un permiso de restablecimiento: fija la contraseña nueva, marca el
// permiso como usado y cierra todas las sesiones de la cuenta. Todo, o nada.
//
// En español: las tres cosas van en la misma operación indivisible porque las tres son la misma
// decisión ("esta cuenta cambia de manos ahora"). Si el permiso se marcara usado pero la contraseña
// no llegara a cambiar, la persona se quedaría fuera con su token quemado; y si la contraseña
// cambiara sin cerrar sesiones, quien hubiera entrado antes seguiría dentro.
//
// Devuelve el identificador de la cuenta afectada y cuántas sesiones se cerraron. Si el token no
// existe, ya caducó o ya se usó, devuelve ErrResetTokenNotUsable.
func (s *Store) ConsumePasswordReset(
	ctx context.Context,
	token, newPasswordHash string,
) (userID string, revokedSessions int64, err error) {
	if token == "" {
		return "", 0, ErrResetTokenNotUsable
	}

	now := s.now().UTC()
	tokenHash := s.hashToken(token)

	err = s.runInTransaction(ctx, func(tx *sql.Tx) error {
		// Paso 1: marcar el permiso como usado, PERO solo si sigue sin usar y vigente. Esta única
		// sentencia es la que garantiza el "un solo uso": dos canjes simultáneos del mismo token
		// harían que el segundo no modificara ninguna fila.
		result, err := tx.ExecContext(
			ctx,
			`UPDATE password_resets
			    SET used_at = ?
			  WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
			now.Unix(),
			tokenHash,
			now.Unix(),
		)
		if err != nil {
			return fmt.Errorf("store: no se pudo canjear el restablecimiento: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("store: no se pudo comprobar el canje del restablecimiento: %w", err)
		}
		if affected == 0 {
			return ErrResetTokenNotUsable
		}

		// Paso 2: averiguar de qué cuenta era el permiso.
		if err := tx.QueryRowContext(
			ctx,
			`SELECT user_id FROM password_resets WHERE token_hash = ?`,
			tokenHash,
		).Scan(&userID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrResetTokenNotUsable
			}
			return fmt.Errorf("store: no se pudo leer la cuenta del restablecimiento: %w", err)
		}

		// Paso 3: fijar la contraseña nueva. Si la cuenta estuviera inhabilitada, no se cambia nada
		// y el canje entero se deshace.
		updateResult, err := tx.ExecContext(
			ctx,
			`UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL`,
			newPasswordHash,
			userID,
		)
		if err != nil {
			return fmt.Errorf("store: no se pudo aplicar la contraseña nueva: %w", err)
		}
		updatedUsers, err := updateResult.RowsAffected()
		if err != nil {
			return fmt.Errorf("store: no se pudo comprobar la contraseña nueva: %w", err)
		}
		if updatedUsers == 0 {
			return ErrUserNotFound
		}

		// Paso 4: cerrar todas las sesiones abiertas de esa cuenta.
		revokedSessions, err = deleteUserSessionsWithinTransaction(ctx, tx, userID)
		return err
	})
	if err != nil {
		return "", 0, err
	}

	return userID, revokedSessions, nil
}
