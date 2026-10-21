package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"
)

// legacyMigratedSuffix es lo que se le añade al nombre del archivo antiguo una vez importado.
//
// En español: renombrarlo (en vez de borrarlo) cumple dos funciones. La primera, que la importación
// no se repita nunca más, porque el archivo original ya no está donde se busca. La segunda, y más
// importante, que quede una COPIA de seguridad de las cuentas antiguas por si hiciera falta revisar
// algo; borrar datos de usuarios durante una migración es exactamente lo que no se debe hacer.
const legacyMigratedSuffix = ".migrated"

// legacyUsersFile es la forma que tenía el archivo users.json: un objeto con una lista de cuentas.
type legacyUsersFile struct {
	Users []legacyUser `json:"users"`
}

// legacyUser es una cuenta tal como se guardaba en el archivo JSON antiguo.
type legacyUser struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	DisplayName  string `json:"displayName"`
	PasswordHash string `json:"passwordHash"`
	CreatedAt    string `json:"createdAt"`
}

// ImportLegacyUsersFile trae a la base de datos las cuentas del antiguo archivo users.json.
//
// En español: es el puente entre el mundo anterior (un archivo de texto) y el nuevo (base de datos).
// Corre solo al arrancar el servidor y se comporta con mucha prudencia:
//   - Si el archivo no existe, no hay nada que hacer (es el caso normal a partir de la segunda vez).
//   - Si YA hay cuentas en la base, no toca nada: la base manda, y sobrescribirla con datos viejos
//     sería destructivo.
//   - Si el archivo existe y la base está vacía, importa todas las cuentas dentro de una sola
//     operación indivisible y, solo si todo salió bien, renombra el archivo.
//
// Devuelve cuántas cuentas importó (0 si no había nada que importar).
func (s *Store) ImportLegacyUsersFile(ctx context.Context, path string) (int, error) {
	if path == "" {
		return 0, nil
	}

	rawContent, err := os.ReadFile(path) //nolint:gosec // ruta de configuración del propio servidor.
	if errors.Is(err, os.ErrNotExist) {
		// Caso normal: no hay archivo antiguo (instalación nueva o migración ya hecha).
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("store: no se pudo leer el archivo de cuentas antiguo %q: %w", path, err)
	}

	existingUsers, err := s.countUsers(ctx)
	if err != nil {
		return 0, err
	}
	if existingUsers > 0 {
		// La base ya tiene cuentas: la importación es de una sola vez y ya ocurrió (o hay cuentas
		// creadas después). No se toca nada, ni siquiera el archivo, para no perder información.
		s.logger.Info(
			"skipping legacy users import because the database already has accounts",
			slog.String("legacy_path", path),
			slog.Int("existing_users", existingUsers),
		)
		return 0, nil
	}

	var parsed legacyUsersFile
	if len(rawContent) > 0 {
		if err := json.Unmarshal(rawContent, &parsed); err != nil {
			return 0, fmt.Errorf("store: el archivo de cuentas antiguo %q está corrupto: %w", path, err)
		}
	}

	imported, err := s.insertLegacyUsers(ctx, parsed.Users, path)
	if err != nil {
		return 0, err
	}

	// Solo después de que la importación quedó CONFIRMADA en la base movemos el archivo. Si el
	// proceso se cortara antes de este punto, el archivo seguiría ahí y la próxima vez se
	// reintentaría desde cero, sin haber perdido nada.
	migratedPath := path + legacyMigratedSuffix
	if err := os.Rename(path, migratedPath); err != nil {
		return imported, fmt.Errorf(
			"store: se importaron %d cuentas pero no se pudo renombrar %q a %q: %w",
			imported, path, migratedPath, err,
		)
	}

	s.logger.Info(
		"legacy users file imported into the database",
		slog.String("legacy_path", path),
		slog.String("renamed_to", migratedPath),
		slog.Int("imported_accounts", imported),
	)
	return imported, nil
}

// insertLegacyUsers escribe las cuentas antiguas en la base, todas o ninguna.
func (s *Store) insertLegacyUsers(ctx context.Context, users []legacyUser, sourcePath string) (int, error) {
	imported := 0

	err := s.runInTransaction(ctx, func(tx *sql.Tx) error {
		for _, legacy := range users {
			if legacy.ID == "" || legacy.Email == "" || legacy.PasswordHash == "" {
				// Una fila sin identificador, sin correo o sin contraseña no es una cuenta con la
				// que nadie pueda entrar. Se detiene la importación en vez de tragársela en
				// silencio: un archivo así indica un problema que hay que mirar, no ignorar.
				return fmt.Errorf(
					"store: el archivo de cuentas antiguo %q tiene una cuenta incompleta (id=%q, email=%q)",
					sourcePath, legacy.ID, legacy.Email,
				)
			}

			createdAt := parseLegacyTimestamp(legacy.CreatedAt, s.now().UTC())

			if _, err := tx.ExecContext(
				ctx,
				`INSERT INTO users (id, email, display_name, password_hash, created_at, accepted_privacy_at)
				 VALUES (?, ?, ?, ?, ?, NULL)`,
				legacy.ID,
				NormalizeEmail(legacy.Email),
				legacy.DisplayName,
				legacy.PasswordHash,
				createdAt.Unix(),
			); err != nil {
				return fmt.Errorf("store: no se pudo importar la cuenta %q: %w", legacy.Email, err)
			}
			imported++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return imported, nil
}

// countUsers dice cuántas cuentas hay en la base, contando también las inhabilitadas.
// En español: para decidir si la importación procede hay que mirar TODAS las filas, no solo las
// activas; si hubiera una cuenta suspendida, la base tampoco está vacía.
func (s *Store) countUsers(ctx context.Context) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return 0, fmt.Errorf("store: no se pudieron contar las cuentas: %w", err)
	}
	return count, nil
}

// parseLegacyTimestamp convierte la fecha de alta del archivo antiguo (texto ISO-8601) al instante
// que guarda la base. Si esa fecha faltara o no se entendiera, se usa la del momento de la
// importación: es un dato menor (solo alimenta el "guardián desde…" del perfil) y perder la cuenta
// entera por una fecha mal escrita sería desproporcionado.
func parseLegacyTimestamp(value string, fallback time.Time) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return fallback
	}
	return parsed.UTC()
}
