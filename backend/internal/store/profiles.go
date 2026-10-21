package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Profile es el documento de perfil de una cuenta tal como está guardado en el servidor.
type Profile struct {
	// Document es el perfil serializado como texto JSON. Cadena vacía = todavía no hay nada guardado.
	Document string
	// Revision es el número de versión del documento: 0 si nunca se guardó, y sube +1 por guardado.
	Revision int64
	// UpdatedAt es cuándo se guardó por última vez (instante cero si nunca se guardó).
	UpdatedAt time.Time
}

// GetProfile devuelve el perfil guardado de una cuenta.
// En español: si esa cuenta nunca guardó nada, no es un error: devuelve un perfil vacío con
// revisión 0, que es exactamente lo que el cliente necesita saber para subir el suyo por primera vez.
func (s *Store) GetProfile(ctx context.Context, userID string) (Profile, error) {
	var (
		profile       Profile
		updatedAtUnix int64
	)

	err := s.db.QueryRowContext(
		ctx,
		`SELECT doc, revision, updated_at FROM profiles WHERE user_id = ?`,
		userID,
	).Scan(&profile.Document, &profile.Revision, &updatedAtUnix)
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, nil
	}
	if err != nil {
		return Profile{}, fmt.Errorf("store: no se pudo leer el perfil: %w", err)
	}

	profile.UpdatedAt = time.Unix(updatedAtUnix, 0).UTC()
	return profile, nil
}

// PutProfile guarda el documento de perfil comprobando antes que nadie se haya adelantado.
//
// En español: el cliente dice "yo trabajaba sobre la versión N". Si el servidor sigue en la versión
// N, guarda y pasa a la N+1. Si el servidor ya va por otra (porque el teléfono guardó mientras la
// computadora editaba), NO guarda: devuelve ErrRevisionConflict junto con el documento que él tiene,
// para que el cliente pueda fusionar los dos y reintentar. Sin esta comprobación, el último en
// guardar borraría en silencio el trabajo del otro.
//
// El valor devuelto es siempre útil: en caso de éxito, el perfil recién guardado; en caso de
// conflicto, el perfil vigente en el servidor.
func (s *Store) PutProfile(ctx context.Context, userID, document string, baseRevision int64) (Profile, error) {
	now := s.now().UTC()
	saved := Profile{
		Document:  document,
		Revision:  baseRevision + 1,
		UpdatedAt: now,
	}

	var currentServerProfile Profile

	err := s.runInTransaction(ctx, func(tx *sql.Tx) error {
		// Leemos la revisión vigente DENTRO de la transacción: así, entre la comprobación y la
		// escritura no puede colarse otro guardado.
		var (
			existingRevision  int64
			existingDocument  string
			existingUpdatedAt int64
		)
		err := tx.QueryRowContext(
			ctx,
			`SELECT doc, revision, updated_at FROM profiles WHERE user_id = ?`,
			userID,
		).Scan(&existingDocument, &existingRevision, &existingUpdatedAt)

		switch {
		case errors.Is(err, sql.ErrNoRows):
			// Nunca se guardó nada: la revisión vigente es 0.
			existingRevision = 0
		case err != nil:
			return fmt.Errorf("store: no se pudo leer la revisión del perfil: %w", err)
		default:
			currentServerProfile = Profile{
				Document:  existingDocument,
				Revision:  existingRevision,
				UpdatedAt: time.Unix(existingUpdatedAt, 0).UTC(),
			}
		}

		if existingRevision != baseRevision {
			return ErrRevisionConflict
		}

		// INSERT ... ON CONFLICT DO UPDATE ("upsert"): crea la fila la primera vez y la reemplaza
		// las siguientes, en una sola sentencia. Evita el clásico "mira si existe y luego decide",
		// que deja un hueco por el que se cuelan las carreras.
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO profiles (user_id, doc, revision, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT (user_id) DO UPDATE SET doc = excluded.doc,
			                                     revision = excluded.revision,
			                                     updated_at = excluded.updated_at`,
			userID,
			saved.Document,
			saved.Revision,
			saved.UpdatedAt.Unix(),
		); err != nil {
			return fmt.Errorf("store: no se pudo guardar el perfil: %w", err)
		}
		return nil
	})

	if errors.Is(err, ErrRevisionConflict) {
		// Devolvemos el documento del servidor JUNTO con el error: es lo que permite al cliente
		// fusionar y reintentar en vez de quedarse sin saber qué hacer.
		return currentServerProfile, ErrRevisionConflict
	}
	if err != nil {
		return Profile{}, err
	}

	return saved, nil
}
