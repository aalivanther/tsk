// Package store es la capa de PERSISTENCIA REAL del backend: la base de datos donde viven las
// cuentas, las sesiones abiertas, las invitaciones, los permisos de restablecimiento de contraseña
// y los perfiles de los usuarios.
//
// En español: hasta la Fase BETA todo esto vivía en un archivo de texto (users.json) que se
// reescribía entero en cada cambio. Eso funcionaba en una computadora local, pero se rompe en el
// momento en que la aplicación se despliega: en las plataformas gratuitas de 2026 el disco del
// contenedor es EFÍMERO, así que cada actualización del servidor borraría todas las cuentas. Además
// un archivo JSON no sabe hacer transacciones, y sin transacciones no se puede garantizar algo tan
// básico como "este código de invitación solo lo puede canjear una persona".
//
// Por qué SQLite y no un servidor de base de datos: la aplicación es de una sola instancia (así lo
// exige también el catálogo en memoria y el limitador de peticiones), tiene decenas de usuarios en
// la alpha y sus datos caben en unos pocos megabytes. SQLite da transacciones de verdad, claves
// foráneas, índices y borrado en cascada sin añadir ni un servicio más que mantener, y el archivo
// resultante se puede copiar como respaldo con un simple "cp".
//
// Por qué el controlador modernc.org/sqlite y no el clásico mattn/go-sqlite3: modernc es una
// traducción de SQLite a Go PURO, sin C de por medio. Eso importa mucho aquí porque la imagen de
// producción es "distroless" y el binario se compila estático: con un controlador que necesitara C
// (CGO) el binario dejaría de ser estático y no arrancaría en esa imagen.
package store

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	// El controlador de SQLite se importa SOLO por su efecto de registro: al cargarse, se apunta a
	// sí mismo en el catálogo de controladores de database/sql con el nombre "sqlite". El guion bajo
	// significa "impórtalo aunque no lo llame por su nombre en el código".
	_ "modernc.org/sqlite"
)

// sqlDriverName es el nombre con el que modernc.org/sqlite se registra en database/sql.
const sqlDriverName = "sqlite"

// busyTimeout es cuánto espera SQLite a que se libere la base si otra operación la tiene ocupada,
// antes de rendirse con un error. En español: es la paciencia del motor. Con un margen de segundos,
// un pico de escrituras simultáneas se resuelve esperando en vez de fallando.
const busyTimeout = 5 * time.Second

// maxOpenConnections limita a UNA la cantidad de conexiones abiertas contra el archivo de la base.
//
// En español: SQLite admite muchos lectores a la vez pero UN SOLO escritor. Al permitir una única
// conexión, todas las operaciones se ponen en fila de forma natural y la clase entera de errores
// "base de datos ocupada" desaparece: no hay que reintentar nada ni razonar sobre carreras entre
// conexiones. El coste sería relevante en una aplicación con miles de peticiones por segundo; con
// las decenas de usuarios de la alpha es literalmente imperceptible, y a cambio el código queda
// mucho más simple y predecible. Regla que se deriva de esto y hay que respetar: ninguna función
// que ya tenga una transacción abierta puede llamar a otra que pida su propia conexión.
const maxOpenConnections = 1

// dirPermissions son los permisos del directorio de datos (dueño puede todo, el resto solo leer/entrar).
const dirPermissions = 0o755

// tokenBytes es cuánta aleatoriedad lleva un token opaco (sesión o restablecimiento): 32 bytes = 256
// bits. En español: adivinar uno por fuerza bruta es tan imposible como adivinar una clave de cifrado.
const tokenBytes = 32

// ErrUserNotFound indica que no existe una cuenta activa con ese identificador o correo.
var ErrUserNotFound = errors.New("store: usuario no encontrado")

// ErrEmailTaken indica que ya hay una cuenta registrada con ese correo.
var ErrEmailTaken = errors.New("store: email ya registrado")

// ErrSessionNotFound indica que el token de sesión no corresponde a ninguna sesión viva (nunca
// existió, ya se cerró o caducó).
var ErrSessionNotFound = errors.New("store: sesión no encontrada o expirada")

// ErrInviteNotUsable indica que el código de invitación no sirve: no existe, ya caducó o ya lo canjeó
// otra persona. Se devuelve el MISMO error en los tres casos a propósito, para no dar pistas a quien
// esté probando códigos al azar.
var ErrInviteNotUsable = errors.New("store: código de invitación inválido, caducado o ya usado")

// ErrResetTokenNotUsable indica que el token de restablecimiento no sirve: no existe, caducó o ya se
// usó. También aquí el error es único para no distinguir los casos.
var ErrResetTokenNotUsable = errors.New("store: token de restablecimiento inválido, caducado o ya usado")

// ErrRevisionConflict indica que el perfil que se intentó guardar partía de una revisión que ya no es
// la vigente: otro dispositivo guardó antes. Quien reciba este error obtiene además el documento del
// servidor para poder fusionar y reintentar.
var ErrRevisionConflict = errors.New("store: la revisión del perfil está desfasada")

// Options son los ajustes con los que se abre el almacén.
type Options struct {
	// Path es la ruta del archivo de base de datos en disco (por ejemplo "data/tsk.db").
	Path string

	// TokenHashKey es la clave secreta con la que se calcula la huella de los tokens.
	//
	// Por qué una huella CON CLAVE y no un simple SHA-256: los tokens de sesión y de
	// restablecimiento son aleatorios de 256 bits, así que un SHA-256 pelado ya sería irreversible.
	// Pero los CÓDIGOS DE INVITACIÓN no: son cortos y legibles por humanos (TSK-XXXX-XXXX, unos 40
	// bits) precisamente para poder dictarlos por mensaje. Con una huella sin clave, cualquiera que
	// obtuviera una copia de la base podría probar todas las combinaciones posibles en minutos y
	// recuperar los códigos sin usar. Al mezclar una clave secreta del servidor en el cálculo, ese
	// ataque deja de ser posible: sin la clave no se puede ni siquiera comprobar un intento.
	TokenHashKey string

	// Now permite inyectar un reloj propio. Sirve para que las pruebas puedan simular el paso del
	// tiempo (caducidades, sesiones deslizantes) sin esperar días de verdad. Si es nil, se usa el
	// reloj real del sistema.
	Now func() time.Time

	// Logger es donde el almacén deja constancia de lo que hace por su cuenta (limpieza de sesiones
	// caducadas, migraciones aplicadas, importación de datos antiguos). Si es nil, se usa el logger
	// por defecto del proceso.
	Logger *slog.Logger
}

// Store es el almacén persistente completo. Se abre una vez al arrancar y se comparte: es seguro de
// usar desde varias peticiones a la vez.
type Store struct {
	// db es el conjunto de conexiones a SQLite gestionado por la librería estándar de Go.
	db *sql.DB

	// tokenHashKey es la clave secreta para calcular la huella de los tokens (ver Options).
	tokenHashKey []byte

	// now es el reloj del almacén (el real, o uno simulado en pruebas).
	now func() time.Time

	// logger recibe los avisos de las tareas automáticas del almacén.
	logger *slog.Logger

	// lastSessionPurgeUnix guarda cuándo se hizo la última limpieza de sesiones caducadas, para no
	// repetirla en cada petición. Es atómico porque lo consultan y actualizan varias peticiones a la
	// vez sin coordinarse entre ellas.
	lastSessionPurgeUnix atomic.Int64
}

// Open abre (o crea) la base de datos, aplica las migraciones pendientes y devuelve el almacén listo.
//
// En español: es el "encendido" de la persistencia. Crea el directorio si hace falta, abre el
// archivo con los ajustes correctos de SQLite, comprueba que esos ajustes se aplicaron de verdad y
// pone el esquema al día. Si algo de esto falla, devuelve error: es preferible que el servidor no
// arranque a que arranque a medias y pierda datos.
func Open(options Options) (*Store, error) {
	if options.Path == "" {
		return nil, errors.New("store: la ruta de la base de datos no puede estar vacía")
	}
	if options.TokenHashKey == "" {
		return nil, errors.New("store: la clave de huella de tokens no puede estar vacía")
	}

	clock := options.Now
	if clock == nil {
		clock = time.Now
	}
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}

	// El archivo de la base vive en un directorio escribible (en Docker, un volumen). Si aún no
	// existe, lo creamos: es la primera ejecución.
	if err := os.MkdirAll(filepath.Dir(options.Path), dirPermissions); err != nil {
		return nil, fmt.Errorf("store: no se pudo crear el directorio de la base de datos: %w", err)
	}

	database, err := sql.Open(sqlDriverName, buildDataSourceName(options.Path))
	if err != nil {
		return nil, fmt.Errorf("store: no se pudo abrir la base de datos %q: %w", options.Path, err)
	}

	// Una sola conexión (ver la constante para el razonamiento completo).
	database.SetMaxOpenConns(maxOpenConnections)
	database.SetMaxIdleConns(maxOpenConnections)

	store := &Store{
		db:           database,
		tokenHashKey: []byte(options.TokenHashKey),
		now:          clock,
		logger:       logger,
	}

	// sql.Open no toca el disco todavía; la primera consulta real es la que confirma que el archivo
	// se puede abrir y que los ajustes tomaron efecto.
	if err := store.verifyPragmas(context.Background()); err != nil {
		// Cerramos lo que ya abrimos para no dejar el archivo tomado por un almacén que no vamos a usar.
		return nil, errors.Join(err, store.Close())
	}

	if err := store.applyMigrations(context.Background()); err != nil {
		return nil, errors.Join(err, store.Close())
	}

	return store, nil
}

// Close cierra la base de datos y libera sus recursos.
func (s *Store) Close() error {
	if err := s.db.Close(); err != nil {
		return fmt.Errorf("store: no se pudo cerrar la base de datos: %w", err)
	}
	return nil
}

// buildDataSourceName arma la cadena de conexión de SQLite con los ajustes obligatorios del proyecto.
//
// En español: SQLite se configura con "pragmas", que son interruptores del motor. Aquí se activan
// tres, y los tres importan:
//   - foreign_keys(ON): hace que las relaciones entre tablas se respeten de verdad. SQLite las trae
//     APAGADAS por omisión, y sin esto el "borrar la cuenta borra también su perfil y sus sesiones"
//     simplemente no ocurriría, dejando basura huérfana.
//   - journal_mode(WAL): cambia la forma de escribir para que quien lee no bloquee a quien escribe y
//     viceversa. Es lo que hace que la aplicación siga respondiendo mientras se guarda algo.
//   - busy_timeout: la paciencia antes de rendirse si la base está ocupada.
//
// La ruta se codifica como parte de una URI para que rutas con espacios o caracteres raros no
// rompan la cadena de conexión.
func buildDataSourceName(path string) string {
	pragmas := url.Values{}
	pragmas.Add("_pragma", "foreign_keys(ON)")
	pragmas.Add("_pragma", "journal_mode(WAL)")
	pragmas.Add("_pragma", fmt.Sprintf("busy_timeout(%d)", busyTimeout.Milliseconds()))
	return "file:" + path + "?" + pragmas.Encode()
}

// verifyPragmas comprueba que los ajustes pedidos en la cadena de conexión están REALMENTE activos.
//
// En español: no damos por hecho que un ajuste se aplicó solo porque lo pedimos. Las claves foráneas
// son la pieza de la que depende el borrado en cascada; si quedaran apagadas por un cambio del
// controlador o un error de sintaxis en la cadena, la aplicación seguiría funcionando en apariencia
// pero dejaría perfiles y sesiones huérfanos al borrar cuentas. Mejor comprobarlo y fallar al arrancar.
func (s *Store) verifyPragmas(ctx context.Context) error {
	var foreignKeysEnabled int
	if err := s.db.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&foreignKeysEnabled); err != nil {
		return fmt.Errorf("store: no se pudo consultar el pragma foreign_keys: %w", err)
	}
	if foreignKeysEnabled != 1 {
		return errors.New("store: las claves foráneas quedaron desactivadas; el borrado en cascada no funcionaría")
	}

	var journalMode string
	if err := s.db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journalMode); err != nil {
		return fmt.Errorf("store: no se pudo consultar el pragma journal_mode: %w", err)
	}
	// El modo se devuelve en minúsculas ("wal"). Solo dejamos constancia: si el sistema de archivos
	// no admitiera WAL (algunos montajes de red), SQLite cae a "delete" y sigue siendo correcto,
	// solo que con menos concurrencia. No es motivo para no arrancar, pero sí para saberlo.
	if journalMode != "wal" {
		s.logger.Warn(
			"sqlite journal mode is not WAL",
			slog.String("journal_mode", journalMode),
		)
	}

	return nil
}

// hashToken calcula la huella con clave (HMAC-SHA256) de un token y la devuelve en base64url.
// En español: convierte el token que enseña el cliente en la cadena con la que se busca su fila.
// La operación solo va en un sentido: de la huella no se puede volver al token.
func (s *Store) hashToken(token string) string {
	mac := hmac.New(sha256.New, s.tokenHashKey)
	// hash.Hash documenta explícitamente que Write nunca devuelve error, por eso no hay nada que
	// comprobar aquí (no es un error silenciado: es que no existe tal error).
	mac.Write([]byte(token))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// newOpaqueToken genera un token aleatorio de 256 bits en base64url.
// En español: es la "llave" que se entrega al cliente. Se genera con el generador criptográfico del
// sistema, no con números pseudoaleatorios corrientes, para que sea imposible de predecir.
func newOpaqueToken() (string, error) {
	buffer := make([]byte, tokenBytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("store: no se pudo generar un token aleatorio: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

// unixOrNil convierte un instante opcional al número que guarda la base (o NULL si no hay instante).
func unixOrNil(instant *time.Time) any {
	if instant == nil {
		return nil
	}
	return instant.UTC().Unix()
}

// timeFromUnixPointer convierte el número opcional leído de la base a un instante opcional.
func timeFromUnixPointer(seconds *int64) *time.Time {
	if seconds == nil {
		return nil
	}
	instant := time.Unix(*seconds, 0).UTC()
	return &instant
}

// runInTransaction ejecuta una operación dentro de una transacción y se encarga de cerrarla bien.
//
// En español: una transacción es un "todo o nada". Si la función de dentro devuelve error, se
// deshacen TODOS los cambios que hubiera hecho; si termina bien, se confirman de golpe. Es la pieza
// que garantiza, por ejemplo, que no pueda quedar una invitación marcada como usada sin que la
// cuenta correspondiente exista.
//
// No hace falta pedir ningún bloqueo especial al abrirla: como el almacén trabaja con UNA sola
// conexión (ver maxOpenConnections), dos transacciones nunca pueden estar abiertas a la vez. La
// segunda espera educadamente a que la primera termine, que es exactamente el comportamiento que
// hace imposible, por ejemplo, que dos registros simultáneos canjeen la misma invitación.
func (s *Store) runInTransaction(ctx context.Context, operation func(tx *sql.Tx) error) error {
	transaction, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: no se pudo abrir la transacción: %w", err)
	}

	if err := operation(transaction); err != nil {
		// Deshacemos. Si el deshacer también fallara, unimos ambos errores para no perder ninguna
		// pista de lo que pasó (uno explica QUÉ se intentaba, el otro que la base quedó en mal estado).
		if rollbackErr := transaction.Rollback(); rollbackErr != nil {
			return errors.Join(err, fmt.Errorf("store: además falló el rollback: %w", rollbackErr))
		}
		return err
	}

	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("store: no se pudo confirmar la transacción: %w", err)
	}
	return nil
}
