package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// SessionTTL es cuánto vale una sesión desde la última vez que se usó.
//
// En español: 30 días es el equilibrio elegido para un producto de consulta diaria. Como la
// caducidad se empuja hacia adelante cada vez que la persona entra (sesión "deslizante"), quien usa
// la aplicación con regularidad no vuelve a ver la pantalla de inicio de sesión nunca; quien la
// abandona un mes, sí. Y como la sesión existe en el servidor, se puede anular en cualquier momento
// sin esperar a que caduque.
const SessionTTL = 30 * 24 * time.Hour

// SessionAbsoluteTTL es cuánto vive una sesión COMO MÁXIMO desde que se abrió, pase lo que pase.
//
// En español: es el tope que le faltaba al párrafo de arriba. Como la caducidad se empuja hacia
// adelante con cada uso, quien entra a diario nunca la alcanzaba: su sesión se renovaba sola
// indefinidamente y en la práctica no caducaba jamás. Eso convertía un token copiado —de un
// dispositivo prestado, de una computadora compartida, de una copia de seguridad del navegador— en
// una llave permanente de la cuenta.
//
// Con este tope, toda sesión tiene fecha de muerte fija desde el día en que nació, y ningún uso la
// mueve. 90 días es el valor elegido por tres razones: es tres veces la caducidad deslizante, así
// que solo lo alcanza quien usa la aplicación de forma continuada durante un trimestre; obliga a
// escribir la contraseña cuatro veces al año, que es una molestia real pero pequeña y que además
// sirve para no olvidarla; y acota el daño de un token robado a un trimestre en el peor caso, en vez
// de a "para siempre". Quien quiera cortar antes tiene el botón de cerrar sesión y el cambio de
// contraseña, que revocan al instante sin esperar a ninguna fecha.
const SessionAbsoluteTTL = 90 * 24 * time.Hour

// sessionSlideAfter es cuánto tiene que pasar desde el último uso para volver a empujar la caducidad.
//
// En español: si empujáramos la caducidad en CADA petición, escribiríamos en disco decenas de veces
// por minuto para no cambiar nada relevante. Con este umbral, la escritura ocurre como mucho una vez
// al día por sesión, y el efecto para el usuario es idéntico.
const sessionSlideAfter = 24 * time.Hour

// sessionPurgeInterval es cada cuánto, como máximo, se barren las sesiones ya caducadas.
//
// En español: la limpieza es "perezosa": no hay ninguna tarea programada ni proceso de fondo (que en
// una plataforma con apagado automático ni siquiera correría). En su lugar, cuando llega una
// petición se mira si ya toca barrer; si toca, se barre de paso. Así la tabla no crece para siempre
// sin añadir ni una pieza más de infraestructura.
const sessionPurgeInterval = time.Hour

// Session es una sesión abierta tal como vive en la base de datos.
type Session struct {
	// UserID es la cuenta dueña de la sesión.
	UserID string
	// CreatedAt es cuándo se abrió.
	CreatedAt time.Time
	// ExpiresAt es cuándo deja de valer (se va empujando con el uso).
	ExpiresAt time.Time
	// AbsoluteExpiresAt es la fecha de muerte FIJA de la sesión: no la mueve ningún uso. La sesión
	// vale mientras no se haya pasado NINGUNA de las dos fechas (ver SessionAbsoluteTTL).
	AbsoluteExpiresAt time.Time
	// LastSeenAt es la última vez que se usó.
	LastSeenAt time.Time
}

// IssuedSession es una sesión recién abierta: la sesión más el token en claro que la abre.
// El token solo existe en este momento; en la base queda únicamente su huella.
type IssuedSession struct {
	// Token es el valor opaco que el cliente debe guardar y reenviar.
	Token string
	// Session son los datos de la sesión creada.
	Session Session
}

// CreateSession abre una sesión nueva para una cuenta y devuelve su token en claro.
//
// En español: genera una llave imposible de adivinar, apunta en la base solo su huella y entrega la
// llave a quien acaba de identificarse. Que en disco esté la huella y no la llave significa que una
// copia robada de la base no permite entrar como nadie.
func (s *Store) CreateSession(ctx context.Context, userID string) (IssuedSession, error) {
	token, err := newOpaqueToken()
	if err != nil {
		return IssuedSession{}, err
	}

	createdAt := s.now().UTC()
	session := Session{
		UserID:    userID,
		CreatedAt: createdAt,
		ExpiresAt: createdAt.Add(SessionTTL),
		// La fecha de muerte se fija AQUÍ, al nacer la sesión, y ya no se toca nunca más.
		AbsoluteExpiresAt: createdAt.Add(SessionAbsoluteTTL),
		LastSeenAt:        createdAt,
	}

	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, absolute_expires_at, last_seen_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		s.hashToken(token),
		session.UserID,
		session.CreatedAt.Unix(),
		session.ExpiresAt.Unix(),
		session.AbsoluteExpiresAt.Unix(),
		session.LastSeenAt.Unix(),
	); err != nil {
		return IssuedSession{}, fmt.Errorf("store: no se pudo abrir la sesión: %w", err)
	}

	return IssuedSession{Token: token, Session: session}, nil
}

// LookupSession traduce un token de sesión a la sesión viva que representa.
//
// En español: es la pregunta que se hace en CADA petición del usuario ("¿de quién es esta llave y
// sigue valiendo?"). Hace tres cosas: aprovecha para barrer sesiones muertas si ya tocaba, comprueba
// que la sesión exista y no haya caducado, y empuja su caducidad si lleva más de un día sin usarse.
//
// Devuelve ErrSessionNotFound si el token no vale, sea porque nunca existió, porque la sesión se
// cerró o porque caducó. Es un único error a propósito: quien pregunta no necesita —ni debe—
// distinguir esos casos.
func (s *Store) LookupSession(ctx context.Context, token string) (Session, error) {
	if token == "" {
		return Session{}, ErrSessionNotFound
	}

	s.purgeExpiredIfDue()

	now := s.now().UTC()
	tokenHash := s.hashToken(token)

	var (
		session               Session
		createdAtUnix         int64
		expiresAtUnix         int64
		absoluteExpiresAtUnix int64
		lastSeenAtUnix        int64
		nowUnixSnapshot       = now.Unix()
	)

	// La condición pide las DOS fechas a la vez: la deslizante y la fija. Una sesión solo vale si no
	// ha rebasado ninguna de las dos, y es la segunda la que impide que una sesión usada a diario se
	// renueve para siempre (ver SessionAbsoluteTTL).
	err := s.db.QueryRowContext(
		ctx,
		`SELECT user_id, created_at, expires_at, absolute_expires_at, last_seen_at
		   FROM sessions
		  WHERE token_hash = ? AND expires_at > ? AND absolute_expires_at > ?`,
		tokenHash,
		nowUnixSnapshot,
		nowUnixSnapshot,
	).Scan(&session.UserID, &createdAtUnix, &expiresAtUnix, &absoluteExpiresAtUnix, &lastSeenAtUnix)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("store: no se pudo consultar la sesión: %w", err)
	}

	session.CreatedAt = time.Unix(createdAtUnix, 0).UTC()
	session.ExpiresAt = time.Unix(expiresAtUnix, 0).UTC()
	session.AbsoluteExpiresAt = time.Unix(absoluteExpiresAtUnix, 0).UTC()
	session.LastSeenAt = time.Unix(lastSeenAtUnix, 0).UTC()

	// Sesión deslizante: solo si lleva un buen rato sin usarse, se anota el uso y se aleja la
	// caducidad. Si falla esta escritura, la sesión SIGUE siendo válida (lo único que se pierde es
	// el empujón), así que no se convierte en un error para el usuario: se deja constancia y sigue.
	if now.Sub(session.LastSeenAt) >= sessionSlideAfter {
		refreshed := Session{
			UserID:            session.UserID,
			CreatedAt:         session.CreatedAt,
			ExpiresAt:         slidExpiry(now, session.AbsoluteExpiresAt),
			AbsoluteExpiresAt: session.AbsoluteExpiresAt,
			LastSeenAt:        now,
		}
		if _, err := s.db.ExecContext(
			ctx,
			`UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?`,
			refreshed.ExpiresAt.Unix(),
			refreshed.LastSeenAt.Unix(),
			tokenHash,
		); err != nil {
			s.logger.Warn("failed to slide session expiry", slog.String("error", err.Error()))
		} else {
			session = refreshed
		}
	}

	return session, nil
}

// slidExpiry calcula hasta dónde se puede empujar la caducidad de una sesión al usarla.
//
// En español: normalmente son treinta días desde ahora, pero NUNCA más allá de la fecha de muerte
// fija de esa sesión. Sin este recorte, la caducidad guardada podría anunciar un futuro que no
// existe: la sesión moriría antes por el tope absoluto y el número guardado sería una mentira que
// confundiría a cualquiera que mirase la base de datos para entender por qué alguien se quedó fuera.
func slidExpiry(now, absoluteExpiresAt time.Time) time.Time {
	slid := now.Add(SessionTTL)
	if slid.After(absoluteExpiresAt) {
		return absoluteExpiresAt
	}
	return slid
}

// DeleteSession cierra UNA sesión concreta a partir de su token (es lo que hace "cerrar sesión").
// No devuelve error si el token ya no existía: el resultado deseado —que ese token no valga— se
// cumple igualmente, y avisar de la diferencia solo serviría para confirmarle a un curioso que el
// token que probó era real.
func (s *Store) DeleteSession(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, s.hashToken(token)); err != nil {
		return fmt.Errorf("store: no se pudo cerrar la sesión: %w", err)
	}
	return nil
}

// DeleteUserSessions cierra TODAS las sesiones de una cuenta y devuelve cuántas cerró.
// En español: es el "cerrar sesión en todos mis dispositivos". Lo usan el cambio de contraseña y el
// restablecimiento.
func (s *Store) DeleteUserSessions(ctx context.Context, userID string) (int64, error) {
	var deleted int64
	err := s.runInTransaction(ctx, func(tx *sql.Tx) error {
		var err error
		deleted, err = deleteUserSessionsWithinTransaction(ctx, tx, userID)
		return err
	})
	if err != nil {
		return 0, err
	}
	return deleted, nil
}

// CountOpenSessions dice cuántas sesiones vivas tiene una cuenta ahora mismo.
// En español: lo usa la herramienta de administración para ver de un vistazo quién está dentro, y
// las pruebas para comprobar que las revocaciones ocurren de verdad.
func (s *Store) CountOpenSessions(ctx context.Context, userID string) (int, error) {
	nowUnix := s.now().UTC().Unix()

	var count int
	// Igual que al verificar un token: cuenta como abierta solo la sesión que no ha rebasado NINGUNA
	// de sus dos fechas. Si aquí se olvidara el tope absoluto, la herramienta de administración
	// enseñaría como "dentro" a gente cuya sesión ya no la deja entrar.
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > ? AND absolute_expires_at > ?`,
		userID,
		nowUnix,
		nowUnix,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("store: no se pudieron contar las sesiones abiertas: %w", err)
	}
	return count, nil
}

// deleteUserSessionsWithinTransaction borra las sesiones de una cuenta dentro de una transacción ya
// abierta. Existe aparte para poder reutilizarla desde operaciones que deben ser indivisibles junto
// con otra cosa (cambiar la contraseña, canjear un restablecimiento).
func deleteUserSessionsWithinTransaction(ctx context.Context, tx *sql.Tx, userID string) (int64, error) {
	result, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	if err != nil {
		return 0, fmt.Errorf("store: no se pudieron cerrar las sesiones de la cuenta: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("store: no se pudo contar las sesiones cerradas: %w", err)
	}
	return deleted, nil
}

// sessionPurgeTimeout es lo máximo que se le concede al barrido antes de rendirse.
//
// En español: la limpieza no puede quedarse colgada para siempre si la base estuviera atascada, pero
// tampoco puede depender de que quien disparó la petición siga esperando (ver purgeExpiredIfDue).
// Diez segundos es tiempo de sobra para dos borrados sobre una tabla pequeña, y un techo claro.
const sessionPurgeTimeout = 10 * time.Second

// purgeExpiredIfDue barre las sesiones y los permisos de restablecimiento ya caducados, como mucho
// una vez por intervalo.
//
// En español: no devuelve error a propósito. La limpieza es mantenimiento, no parte de atender al
// usuario: si fallara (por ejemplo, disco lleno), lo correcto es dejar constancia en el registro y
// seguir sirviendo la petición, no negarle la entrada a alguien porque no se pudo barrer.
//
// OJO con el contexto: el barrido usa uno PROPIO y no el de la petición que lo disparó, y no es un
// detalle menor. El de la petición muere en cuanto quien preguntó cierra la conexión, y el barrido
// se dispara "de paso", montado en una petición cualquiera. Con el contexto de la petición, alguien
// que cortara la conexión en ese instante abortaba la limpieza a medias; pero el reloj de "ya toca
// barrer" ya se había adelantado, así que esa hora de limpieza se perdía entera y las filas muertas
// se quedaban acumulando hasta la siguiente. Con un contexto propio, el barrido termina su trabajo
// aunque quien pasaba por ahí se marche. Por eso esta función ya no recibe ningún contexto: si lo
// recibiera, alguien acabaría usándolo sin darse cuenta y el problema volvería.
func (s *Store) purgeExpiredIfDue() {
	nowUnix := s.now().UTC().Unix()
	lastPurgeUnix := s.lastSessionPurgeUnix.Load()

	if nowUnix-lastPurgeUnix < int64(sessionPurgeInterval.Seconds()) {
		return
	}
	// CompareAndSwap garantiza que, si varias peticiones llegan a la vez, solo UNA se lleva el
	// trabajo de barrer; las demás ven el valor ya cambiado y siguen su camino sin esperar.
	if !s.lastSessionPurgeUnix.CompareAndSwap(lastPurgeUnix, nowUnix) {
		return
	}

	purgeContext, cancel := context.WithTimeout(context.Background(), sessionPurgeTimeout)
	defer cancel()

	// Se borran las sesiones que rebasaron CUALQUIERA de sus dos fechas: la deslizante (nadie la usa
	// desde hace un mes) o la fija (lleva viva su plazo máximo, se use o no).
	result, err := s.db.ExecContext(
		purgeContext,
		`DELETE FROM sessions WHERE expires_at <= ? OR absolute_expires_at <= ?`,
		nowUnix,
		nowUnix,
	)
	if err != nil {
		s.logger.Warn("failed to purge expired sessions", slog.String("error", err.Error()))
		return
	}
	purgedSessions, err := result.RowsAffected()
	if err != nil {
		s.logger.Warn("failed to count purged sessions", slog.String("error", err.Error()))
		return
	}

	// De paso barremos los permisos de restablecimiento caducados: son igual de temporales y nadie
	// más los va a limpiar.
	if _, err := s.db.ExecContext(
		purgeContext,
		`DELETE FROM password_resets WHERE expires_at <= ?`,
		nowUnix,
	); err != nil {
		s.logger.Warn("failed to purge expired password resets", slog.String("error", err.Error()))
		return
	}

	if purgedSessions > 0 {
		s.logger.Info("purged expired sessions", slog.Int64("sessions", purgedSessions))
	}
}
