package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strings"
)

// migrationFiles empotra los archivos .sql de migración DENTRO del binario compilado.
//
// En español: la directiva de abajo le dice al compilador de Go "mete el contenido de esta carpeta
// dentro del programa". Gracias a eso, el servidor lleva su propio esquema encima: no hay que copiar
// archivos .sql junto al binario ni acordarse de ejecutarlos a mano antes de desplegar. Arrancar el
// servidor es suficiente para que la base quede al día.
//
//go:embed migrations/*.sql
var migrationFiles embed.FS

// migrationsDirectory es la carpeta empotrada donde viven los archivos de migración.
const migrationsDirectory = "migrations"

// migrationFileSuffix es la extensión que deben tener los archivos de migración.
const migrationFileSuffix = ".sql"

// createSchemaMigrationsTable crea la libreta donde el servidor apunta qué migraciones ya aplicó.
//
// En español: es el "diario de obra" de la base de datos. Sin él, el servidor no tendría forma de
// saber si el esquema ya está creado y volvería a intentar crearlo en cada arranque. Se crea aparte
// de las migraciones normales, con IF NOT EXISTS, porque es la propia condición para poder llevar
// esa cuenta.
const createSchemaMigrationsTable = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
) STRICT;`

// applyMigrations pone el esquema de la base al día, aplicando solo lo que falte.
//
// En español: mira qué migraciones vienen empotradas en el binario, consulta cuáles ya se aplicaron
// y ejecuta únicamente las nuevas, en orden por nombre de archivo. Es IDEMPOTENTE: correrlo diez
// veces seguidas deja exactamente el mismo resultado que correrlo una, porque las ya aplicadas se
// saltan. Cada migración se ejecuta dentro de su propia transacción junto con la anotación en el
// diario, así que es imposible que quede una migración "a medias" o aplicada pero sin registrar.
func (s *Store) applyMigrations(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, createSchemaMigrationsTable); err != nil {
		return fmt.Errorf("store: no se pudo crear la tabla schema_migrations: %w", err)
	}

	appliedVersions, err := s.loadAppliedMigrationVersions(ctx)
	if err != nil {
		return err
	}

	availableVersions, err := listEmbeddedMigrationVersions()
	if err != nil {
		return err
	}

	appliedNow := 0
	for _, version := range availableVersions {
		if appliedVersions[version] {
			continue
		}

		statements, err := migrationFiles.ReadFile(migrationsDirectory + "/" + version + migrationFileSuffix)
		if err != nil {
			return fmt.Errorf("store: no se pudo leer la migración %q: %w", version, err)
		}

		if err := s.applySingleMigration(ctx, version, string(statements)); err != nil {
			return err
		}

		appliedNow++
		s.logger.Info("database migration applied", slog.String("version", version))
	}

	if appliedNow == 0 {
		s.logger.Info("database schema already up to date", slog.Int("known_migrations", len(availableVersions)))
	}
	return nil
}

// applySingleMigration ejecuta UNA migración y anota que quedó aplicada, todo dentro de una transacción.
func (s *Store) applySingleMigration(ctx context.Context, version, statements string) error {
	return s.runInTransaction(ctx, func(tx *sql.Tx) error {
		// ExecContext de SQLite acepta varias sentencias separadas por punto y coma en una sola
		// llamada, que es justo como están escritos los archivos de migración.
		if _, err := tx.ExecContext(ctx, statements); err != nil {
			return fmt.Errorf("store: falló la migración %q: %w", version, err)
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
			version,
			s.now().UTC().Unix(),
		); err != nil {
			return fmt.Errorf("store: no se pudo registrar la migración %q como aplicada: %w", version, err)
		}
		return nil
	})
}

// loadAppliedMigrationVersions lee del diario qué migraciones ya están aplicadas.
func (s *Store) loadAppliedMigrationVersions(ctx context.Context) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("store: no se pudieron leer las migraciones aplicadas: %w", err)
	}
	defer func() { _ = rows.Close() }()

	applied := make(map[string]bool)
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("store: no se pudo leer una fila de schema_migrations: %w", err)
		}
		applied[version] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: error recorriendo schema_migrations: %w", err)
	}
	return applied, nil
}

// listEmbeddedMigrationVersions devuelve, ordenadas, las versiones de migración empotradas.
//
// En español: la "versión" es el nombre del archivo sin la extensión (por ejemplo
// "0001_initial_schema"). El orden alfabético es el orden de aplicación, y por eso los archivos
// empiezan por un número con ceros a la izquierda: así "0002" siempre va después de "0001", y no
// pasa lo que ocurriría con "2" y "10".
func listEmbeddedMigrationVersions() ([]string, error) {
	entries, err := fs.ReadDir(migrationFiles, migrationsDirectory)
	if err != nil {
		return nil, fmt.Errorf("store: no se pudieron listar las migraciones empotradas: %w", err)
	}

	versions := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), migrationFileSuffix) {
			continue
		}
		versions = append(versions, strings.TrimSuffix(entry.Name(), migrationFileSuffix))
	}
	sort.Strings(versions)

	if len(versions) == 0 {
		return nil, fmt.Errorf("store: no hay migraciones empotradas en %q", migrationsDirectory)
	}
	return versions, nil
}
