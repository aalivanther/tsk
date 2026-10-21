// Command admintool es la herramienta de línea de comandos para administrar la alpha cerrada.
//
// En español: hay tres cosas que alguien tiene que poder hacer a mano durante la alpha y que no
// tienen (ni deben tener) una pantalla en la aplicación, porque son operaciones del dueño del
// servicio y no de los usuarios:
//
//	invite        genera un código de invitación nuevo y lo enseña UNA vez.
//	reset         emite un permiso de restablecimiento de contraseña para alguien que perdió la suya.
//	list-users    enseña quién tiene cuenta, cuándo entró y cuántas sesiones tiene abiertas.
//	install-seed  pone en servicio un catálogo nuevo sin reconstruir ni reiniciar nada.
//
// Se conecta a la MISMA base de datos que el servidor. Como la aplicación corre en un contenedor
// sin consola (imagen distroless), esta herramienta se ejecuta desde el taller de desarrollo
// apuntando al mismo archivo de base de datos (ver los objetivos "admin-*" del Makefile).
//
// Necesita la misma clave secreta que el servidor (SESSION_SIGNING_KEY), porque es la clave con la
// que se calculan las huellas de los tokens: sin ella, un código generado aquí no lo reconocería el
// servidor. La excepción es "install-seed", que no toca las cuentas y por eso ni abre la base de
// datos ni necesita la clave.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"mdm7mo/internal/catalog"
	"mdm7mo/internal/config"
	"mdm7mo/internal/store"
)

// exitCodeFailure es el código de salida cuando el comando no pudo completarse.
// En español: devolver un código distinto de cero es la forma en que un programa de consola avisa
// de que algo salió mal, para que quien lo llame (una persona o un script) se entere.
const exitCodeFailure = 1

// commandTimeout es lo máximo que se le da a una operación contra la base antes de rendirse.
const commandTimeout = 30 * time.Second

// usageText es la ayuda que se enseña cuando no se entiende lo que se pidió.
const usageText = `admintool — administración de la alpha cerrada de The Story Keeper

Uso:
  admintool invite       [-note "para quién es"] [-days 30]
  admintool reset        -email persona@ejemplo.com [-hours 1]
  admintool list-users
  admintool install-seed -candidate ruta/al/seed-nuevo.json

Variables de entorno (las mismas que usa el servidor):
  DB_PATH               ruta del archivo de base de datos (por defecto data/tsk.db)
  SESSION_SIGNING_KEY   clave secreta obligatoria; debe ser LA MISMA que la del servidor
  WRITABLE_SEED_PATH    dónde vive el catálogo actualizable (solo lo usa install-seed)
`

// main ejecuta el subcomando pedido y termina con el código de salida adecuado.
func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))

	if err := run(logger, os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(exitCodeFailure)
	}
}

// run elige el subcomando y lo ejecuta. Separarlo de main permite devolver errores en vez de
// terminar el proceso desde cualquier rincón del código.
func run(logger *slog.Logger, arguments []string) error {
	if len(arguments) == 0 {
		fmt.Fprint(os.Stderr, usageText)
		return errors.New("falta el subcomando")
	}

	subcommand := arguments[0]
	subcommandArguments := arguments[1:]

	// La configuración sale del entorno, igual que en el servidor, para no tener dos formas distintas
	// de decir dónde está la base de datos y cuál es la clave.
	cfg := config.Load()

	// install-seed se atiende ANTES de validar la clave y de abrir la base de datos, porque no toca
	// las cuentas para nada: solo valida un archivo de catálogo y lo copia a su sitio. Exigirle la
	// clave secreta del servidor sería pedir una credencial que no necesita, y abrir la base de datos
	// impediría instalar un catálogo en una instalación que todavía no tiene ninguna cuenta.
	if subcommand == "install-seed" {
		return runInstallSeed(cfg.WritableSeedPath, subcommandArguments)
	}

	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("configuración inválida: %w", err)
	}

	persistentStore, err := store.Open(store.Options{
		Path:         cfg.DatabasePath,
		TokenHashKey: cfg.SessionSigningKey,
		Logger:       logger,
	})
	if err != nil {
		return fmt.Errorf("no se pudo abrir la base de datos %q: %w", cfg.DatabasePath, err)
	}
	defer func() {
		if err := persistentStore.Close(); err != nil {
			fmt.Fprintf(os.Stderr, "aviso: no se pudo cerrar la base de datos: %v\n", err)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()

	switch subcommand {
	case "invite":
		return runInvite(ctx, persistentStore, subcommandArguments)
	case "reset":
		return runReset(ctx, persistentStore, subcommandArguments)
	case "list-users":
		return runListUsers(ctx, persistentStore)
	default:
		fmt.Fprint(os.Stderr, usageText)
		return fmt.Errorf("subcomando desconocido %q", subcommand)
	}
}

// runInvite genera un código de invitación y lo imprime EN CLARO una única vez.
//
// En español: este es el único momento de la vida del código en que se puede leer. En la base solo
// queda su huella, así que si se pierde, no hay forma de recuperarlo: se genera otro.
func runInvite(ctx context.Context, persistentStore *store.Store, arguments []string) error {
	flags := flag.NewFlagSet("invite", flag.ContinueOnError)
	note := flags.String("note", "", "nota para recordar a quién se le entrega el código")
	days := flags.Int("days", int(store.DefaultInviteTTL.Hours()/24), "días que el código seguirá sirviendo")
	if err := flags.Parse(arguments); err != nil {
		return fmt.Errorf("argumentos inválidos de 'invite': %w", err)
	}
	if *days <= 0 {
		return errors.New("los días de vigencia deben ser mayores que cero")
	}

	invite, err := persistentStore.CreateInvite(ctx, *note, time.Duration(*days)*24*time.Hour)
	if err != nil {
		return fmt.Errorf("no se pudo generar la invitación: %w", err)
	}

	fmt.Println("Invitación generada. Este código NO se puede volver a consultar: cópialo ahora.")
	fmt.Printf("  código:  %s\n", invite.Code)
	fmt.Printf("  nota:    %s\n", displayOrDash(invite.Note))
	fmt.Printf("  caduca:  %s\n", invite.ExpiresAt.Format(time.RFC3339))
	return nil
}

// runReset emite un permiso de restablecimiento de contraseña para la cuenta de un correo dado.
//
// En español: es lo que se hace cuando alguien de la alpha escribe "olvidé mi contraseña". Se genera
// aquí y se le pasa el token por el canal privado que ya se use (mensaje directo). El permiso dura
// poco y solo sirve una vez.
func runReset(ctx context.Context, persistentStore *store.Store, arguments []string) error {
	flags := flag.NewFlagSet("reset", flag.ContinueOnError)
	email := flags.String("email", "", "correo de la cuenta que necesita restablecer su contraseña")
	hours := flags.Int("hours", int(store.DefaultPasswordResetTTL.Hours()), "horas que el permiso seguirá sirviendo")
	if err := flags.Parse(arguments); err != nil {
		return fmt.Errorf("argumentos inválidos de 'reset': %w", err)
	}
	if strings.TrimSpace(*email) == "" {
		return errors.New("hace falta indicar el correo con -email")
	}
	if *hours <= 0 {
		return errors.New("las horas de vigencia deben ser mayores que cero")
	}

	user, err := persistentStore.FindUserByEmail(ctx, *email)
	if err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			// Aquí SÍ se dice claramente que no existe: quien ejecuta esto es el administrador, que
			// ya tiene acceso a toda la base. Ocultárselo no protegería a nadie y solo le haría
			// perder el tiempo buscando un fallo inexistente.
			return fmt.Errorf("no hay ninguna cuenta activa con el correo %q", *email)
		}
		return fmt.Errorf("no se pudo buscar la cuenta: %w", err)
	}

	reset, err := persistentStore.CreatePasswordReset(ctx, user.ID, time.Duration(*hours)*time.Hour)
	if err != nil {
		return fmt.Errorf("no se pudo emitir el restablecimiento: %w", err)
	}

	fmt.Println("Restablecimiento emitido. Entrega este token por un canal privado; sirve UNA sola vez.")
	fmt.Printf("  cuenta:  %s (%s)\n", user.Email, user.ID)
	fmt.Printf("  token:   %s\n", reset.Token)
	fmt.Printf("  caduca:  %s\n", reset.ExpiresAt.Format(time.RFC3339))
	return nil
}

// runListUsers imprime la lista de cuentas activas con su información de un vistazo.
func runListUsers(ctx context.Context, persistentStore *store.Store) error {
	summaries, err := persistentStore.ListUsers(ctx)
	if err != nil {
		return fmt.Errorf("no se pudieron listar las cuentas: %w", err)
	}

	if len(summaries) == 0 {
		fmt.Println("Todavía no hay ninguna cuenta.")
		return nil
	}

	fmt.Printf("%d cuenta(s):\n", len(summaries))
	for _, summary := range summaries {
		fmt.Printf(
			"  %-40s  alta:%s  sesiones:%d  perfil:%s  nombre:%s\n",
			summary.User.Email,
			summary.User.CreatedAt.Format(time.DateOnly),
			summary.OpenSessions,
			yesOrNo(summary.HasProfile),
			displayOrDash(summary.User.DisplayName),
		)
	}
	return nil
}

// runInstallSeed valida un archivo de catálogo candidato y, si es correcto, lo pone en servicio.
//
// En español: es la forma de renovar el catálogo SIN reconstruir la imagen ni reiniciar el servidor.
// Hace dos cosas, en este orden y nunca al revés:
//
//  1. VALIDA el archivo candidato entero, con exactamente las mismas reglas que aplica el servidor
//     al arrancar. Si algo no cuadra (JSON roto, un estreno sin fecha, dos con el mismo id), se
//     detiene aquí y no se toca nada: el catálogo que está sirviendo sigue intacto.
//  2. Lo copia a su sitio definitivo de forma ATÓMICA (escribe un temporal y lo renombra encima), de
//     modo que en ningún instante existe un archivo a medio escribir.
//
// Después el servidor lo recoge solo: su vigilante nota que el archivo cambió y hace el relevo en
// caliente (ver internal/catalog/watcher.go). No hay que reiniciar nada ni avisar a nadie.
//
// Por qué es un COMANDO y no una ruta del API: instalar un catálogo es una operación del dueño del
// servicio. Como ruta HTTP habría que inventarle un mecanismo de autorización propio —el servicio no
// tiene hoy ningún concepto de administrador— y quedaría una puerta abierta más que vigilar para
// siempre. Como comando, el permiso es el que ya existe: quien puede ejecutar herramientas contra el
// volumen de datos del servicio.
func runInstallSeed(writableSeedPath string, arguments []string) error {
	flags := flag.NewFlagSet("install-seed", flag.ContinueOnError)
	candidate := flags.String("candidate", "", "ruta del archivo de catálogo que se quiere poner en servicio")
	if err := flags.Parse(arguments); err != nil {
		return fmt.Errorf("argumentos inválidos de 'install-seed': %w", err)
	}
	if strings.TrimSpace(*candidate) == "" {
		return errors.New("hace falta indicar el archivo con -candidate")
	}
	if strings.TrimSpace(writableSeedPath) == "" {
		return errors.New("no hay ruta de catálogo actualizable configurada (WRITABLE_SEED_PATH)")
	}

	installed, err := catalog.InstallSeed(*candidate, writableSeedPath, time.Now())
	if err != nil {
		return fmt.Errorf("no se pudo instalar el catálogo: %w", err)
	}

	// El mensaje dice CUÁNTO hay que esperar, no solo que hay que esperar. Sin el plazo, quien
	// instala un catálogo no sabe si tiene que esperar diez segundos o media hora, y lo natural es
	// concluir que no funcionó y volver a ejecutarlo.
	fmt.Println("Catálogo instalado. El servidor lo recoge solo, en menos de un minuto (no hay que reiniciar nada).")
	fmt.Printf("  archivo:      %s\n", installed.Path)
	fmt.Printf("  estrenos:     %d\n", len(installed.Releases))
	fmt.Printf("  días futuros: %d\n", installed.DaysRemaining)
	return nil
}

// displayOrDash devuelve el texto, o un guion cuando está vacío, para que las columnas se lean bien.
func displayOrDash(value string) string {
	if strings.TrimSpace(value) == "" {
		return "—"
	}
	return value
}

// yesOrNo traduce un sí/no a texto legible en español para la salida por pantalla.
func yesOrNo(value bool) string {
	if value {
		return "sí"
	}
	return "no"
}
