package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"connectrpc.com/connect"

	authv1 "mdm7mo/gen/mdm7mo/auth/v1"
	"mdm7mo/gen/mdm7mo/auth/v1/authv1connect"
	"mdm7mo/internal/store"
)

// setCookieHeader es la cabecera con la que el servidor le pide al navegador que guarde una cookie.
const setCookieHeader = "Set-Cookie"

// genericCredentialsMessage es el mensaje ÚNICO para "correo o contraseña incorrectos".
// En español: es el mismo tanto si la cuenta no existe como si la contraseña está mal, a propósito.
// Distinguirlos convertiría el inicio de sesión en un buscador de correos registrados.
const genericCredentialsMessage = "email o contraseña incorrectos"

// Handler implementa el servicio de autenticación completo sobre el almacén persistente.
//
// En español: es la ventanilla de cuentas. Recibe las peticiones ya traducidas desde el contrato
// Protobuf, aplica las reglas del producto y delega el guardado en el almacén.
type Handler struct {
	authv1connect.UnimplementedAuthServiceHandler

	// store es la base de datos donde viven cuentas, sesiones, invitaciones y restablecimientos.
	store *store.Store

	// requireInvite dice si hace falta un código de invitación para poder registrarse.
	// En español: durante la alpha cerrada está activo; el día que la beta se abra al público se
	// apaga con la variable de entorno REQUIRE_INVITE y el registro queda libre.
	requireInvite bool

	// cookieOptions son los ajustes con los que se emite la cookie de sesión.
	cookieOptions SessionCookieOptions

	// resetDelivery es el canal por el que se entrega un token de restablecimiento a su dueño.
	resetDelivery ResetDelivery

	// logger recibe los avisos operativos del handler (revocaciones, borrados de cuenta).
	logger *slog.Logger
}

// HandlerOptions agrupa las piezas con las que se arma el handler de autenticación.
type HandlerOptions struct {
	// Store es el almacén persistente. Obligatorio.
	Store *store.Store
	// RequireInvite activa la exigencia de código de invitación en el registro.
	RequireInvite bool
	// CookieOptions son los ajustes de la cookie de sesión.
	CookieOptions SessionCookieOptions
	// ResetDelivery es el canal de entrega de restablecimientos. Obligatorio.
	ResetDelivery ResetDelivery
	// Logger es el registro donde escribir. Si es nil se usa el del proceso.
	Logger *slog.Logger
}

// NewHandler arma el handler de autenticación.
// Devuelve error si falta alguna pieza imprescindible: es preferible no arrancar a arrancar con una
// ventanilla incapaz de, por ejemplo, entregar un restablecimiento.
func NewHandler(options HandlerOptions) (*Handler, error) {
	if options.Store == nil {
		return nil, errors.New("auth: el handler necesita un almacén persistente")
	}
	if options.ResetDelivery == nil {
		return nil, errors.New("auth: el handler necesita un canal de entrega de restablecimientos")
	}

	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}

	return &Handler{
		store:         options.Store,
		requireInvite: options.RequireInvite,
		cookieOptions: options.CookieOptions,
		resetDelivery: options.ResetDelivery,
		logger:        logger,
	}, nil
}

// Register crea una cuenta nueva y abre su primera sesión.
//
// En español: valida los datos, canjea el código de invitación si la instalación lo exige y crea la
// cuenta. El canje y el alta ocurren en la misma operación indivisible dentro del almacén, que es lo
// que impide que dos personas usen el mismo código a la vez.
func (h *Handler) Register(
	ctx context.Context,
	request *connect.Request[authv1.RegisterRequest],
) (*connect.Response[authv1.AuthResponse], error) {
	email := store.NormalizeEmail(request.Msg.GetEmail())
	password := request.Msg.GetPassword()
	displayName := strings.TrimSpace(request.Msg.GetDisplayName())
	inviteCode := strings.TrimSpace(request.Msg.GetInviteCode())

	if !looksLikeEmail(email) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("email inválido"))
	}
	if err := validatePassword(password); err != nil {
		return nil, err
	}
	if displayName == "" {
		// Sin nombre visible usamos la parte del correo anterior a la arroba: un respaldo razonable
		// que evita perfiles llamados "(sin nombre)".
		displayName, _, _ = strings.Cut(email, "@")
	}
	if h.requireInvite && inviteCode == "" {
		return nil, connect.NewError(
			connect.CodePermissionDenied,
			errors.New("se necesita un código de invitación para crear una cuenta"),
		)
	}

	// La huella de la contraseña se calcula ANTES de tocar la base: bcrypt tarda décimas de segundo
	// a propósito, y no queremos tener la base ocupada durante ese rato.
	passwordHash, err := hashPassword(password)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	userID, err := newUserID()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Si la instalación no exige invitación, no se canjea ninguna aunque venga un código en la
	// petición: sería quemar un código sin necesidad.
	codeToConsume := ""
	if h.requireInvite {
		codeToConsume = inviteCode
	}

	user, err := h.store.CreateUser(ctx, store.NewUser{
		ID:           userID,
		Email:        email,
		DisplayName:  displayName,
		PasswordHash: passwordHash,
		// AcceptedPrivacyAt queda sin rellenar porque la pantalla de registro todavía no pide el
		// consentimiento del aviso de privacidad (entregable B7 de la fase). Poner aquí una fecha
		// sería registrar un consentimiento que nadie dio.
		AcceptedPrivacyAt: nil,
		InviteCode:        codeToConsume,
	})
	switch {
	case errors.Is(err, store.ErrEmailTaken):
		// DECISIÓN TOMADA: el código de error SÍ distingue este caso (AlreadyExists) aunque el
		// mensaje sea neutro. Es una elección consciente, no un descuido, y conviene entender las dos
		// caras porque tirar de una empeora la otra.
		//
		// Qué se pierde: quien sepa mirar el código de la respuesta puede preguntar "¿existe esta
		// cuenta?" y obtener un sí o un no. Unificarlo con los demás fallos cerraría esa puerta.
		//
		// Qué se ganaría cerrándola, en realidad, muy poco: la persona que se registró hace meses y
		// no se acuerda vería "revisa tus datos" y probaría otra contraseña, y otra, hasta rendirse,
		// sin que nada le sugiera nunca lo único que resuelve su problema, que es iniciar sesión.
		// Esa persona existe de verdad y es mucho más frecuente que el atacante.
		//
		// Y qué protege esa puerta a cambio: nada que no esté ya protegido por otras vías, que son
		// las que de verdad sostienen la decisión. (1) Durante la alpha cerrada hace falta una
		// invitación VÁLIDA y de un solo uso para llegar siquiera a esta comprobación —el código se
		// valida ANTES de tocar la tabla de cuentas, ver store.CreateUser—, así que cada correo
		// probado costaría quemar una invitación repartida a mano. (2) La cuota estricta de 10
		// operaciones por minuto y por IP hace inviable recorrer una lista. (3) El mismo dato se
		// obtiene igualmente de cualquier servicio que permita registrarse, así que el secreto que se
		// estaría protegiendo tampoco es gran cosa.
		//
		// El mensaje, en cambio, sí es deliberadamente neutro: orienta ("inicia sesión") sin afirmar
		// que la cuenta existe, que es lo que se leería en pantalla si alguien mira por encima del
		// hombro. La prueba TestRegisterRejectsDuplicateEmailWithoutRevealingIt fija este
		// comportamiento exacto para que no cambie por accidente.
		return nil, connect.NewError(
			connect.CodeAlreadyExists,
			errors.New("no se pudo completar el registro; revisa tus datos o inicia sesión"),
		)
	case errors.Is(err, store.ErrInviteNotUsable):
		return nil, connect.NewError(
			connect.CodePermissionDenied,
			errors.New("el código de invitación no es válido, ya caducó o ya se usó"),
		)
	case err != nil:
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("auth: falló el registro: %w", err))
	}

	return h.openSessionResponse(ctx, user)
}

// Login comprueba las credenciales y abre una sesión.
//
// En español: tanto "ese correo no existe" como "la contraseña está mal" devuelven el mismo error Y
// tardan lo mismo. Lo segundo importa tanto como lo primero: si el caso "no existe" respondiera al
// instante, bastaría con medir el tiempo de respuesta para averiguar qué correos tienen cuenta, sin
// necesidad de leer ningún mensaje. Por eso, cuando el correo no existe, se comprueba igualmente la
// contraseña contra una huella señuelo.
func (h *Handler) Login(
	ctx context.Context,
	request *connect.Request[authv1.LoginRequest],
) (*connect.Response[authv1.AuthResponse], error) {
	email := store.NormalizeEmail(request.Msg.GetEmail())
	password := request.Msg.GetPassword()

	user, err := h.store.FindUserByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, store.ErrUserNotFound) {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("auth: falló el inicio de sesión: %w", err))
		}
		// Pagamos el mismo coste que un inicio de sesión real (ver el comentario de arriba).
		_ = checkPassword(decoyPasswordHash, password)
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New(genericCredentialsMessage))
	}

	if err := checkPassword(user.PasswordHash, password); err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New(genericCredentialsMessage))
	}

	return h.openSessionResponse(ctx, user)
}

// Me devuelve la cuenta de la sesión actual. Lo usa el frontend al cargar para restaurar la sesión.
func (h *Handler) Me(
	ctx context.Context,
	_ *connect.Request[authv1.MeRequest],
) (*connect.Response[authv1.MeResponse], error) {
	user, err := h.requireAuthenticatedUser(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.MeResponse{User: toPublicUser(user)}), nil
}

// Logout cierra la sesión con la que se hizo la llamada y vacía la cookie del navegador.
//
// En español: cierra SOLO esa sesión, no todas las de la cuenta. Si alguien tiene la aplicación
// abierta en el teléfono y en la computadora, salir en una no debe echarlo de la otra.
func (h *Handler) Logout(
	ctx context.Context,
	_ *connect.Request[authv1.LogoutRequest],
) (*connect.Response[authv1.LogoutResponse], error) {
	identity, ok := IdentityFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("no hay sesión que cerrar"))
	}

	if err := h.store.DeleteSession(ctx, identity.SessionToken); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("auth: falló el cierre de sesión: %w", err))
	}

	response := connect.NewResponse(&authv1.LogoutResponse{})
	response.Header().Add(setCookieHeader, NewExpiredSessionCookie(h.cookieOptions).String())
	return response, nil
}

// ChangePassword cambia la contraseña exigiendo la vigente, y cierra TODAS las sesiones de la cuenta.
//
// En español: cerrar todas las sesiones es intencionado y no un efecto secundario. El motivo típico
// para cambiar la contraseña es sospechar que alguien más entró; dejar abiertas las sesiones que ya
// existían haría inútil el cambio. La contrapartida es que la propia persona tiene que volver a
// entrar con su contraseña nueva, lo cual además confirma que la recuerda.
func (h *Handler) ChangePassword(
	ctx context.Context,
	request *connect.Request[authv1.ChangePasswordRequest],
) (*connect.Response[authv1.ChangePasswordResponse], error) {
	user, err := h.requireAuthenticatedUser(ctx)
	if err != nil {
		return nil, err
	}

	if err := checkPassword(user.PasswordHash, request.Msg.GetCurrentPassword()); err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("la contraseña actual no es correcta"))
	}
	newPassword := request.Msg.GetNewPassword()
	if err := validatePassword(newPassword); err != nil {
		return nil, err
	}
	if newPassword == request.Msg.GetCurrentPassword() {
		return nil, connect.NewError(
			connect.CodeInvalidArgument,
			errors.New("la contraseña nueva debe ser distinta de la actual"),
		)
	}

	newHash, err := hashPassword(newPassword)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	revokedSessions, err := h.store.UpdatePasswordAndRevokeSessions(ctx, user.ID, newHash)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("auth: falló el cambio de contraseña: %w", err))
	}

	h.logger.Info(
		"password changed and sessions revoked",
		slog.String("user_id", user.ID),
		slog.Int64("revoked_sessions", revokedSessions),
	)

	response := connect.NewResponse(&authv1.ChangePasswordResponse{})
	// La sesión con la que se hizo el cambio también murió, así que se vacía la cookie: dejarla
	// puesta haría que el navegador siguiera mandando un token que ya no vale.
	response.Header().Add(setCookieHeader, NewExpiredSessionCookie(h.cookieOptions).String())
	return response, nil
}

// DeleteAccount borra la cuenta y todo lo asociado, exigiendo la contraseña como confirmación.
//
// En español: es el derecho de CANCELACIÓN del aviso de privacidad. El borrado es físico y
// definitivo: desaparecen la cuenta, su perfil y todas sus sesiones. No queda copia ni marca.
func (h *Handler) DeleteAccount(
	ctx context.Context,
	request *connect.Request[authv1.DeleteAccountRequest],
) (*connect.Response[authv1.DeleteAccountResponse], error) {
	user, err := h.requireAuthenticatedUser(ctx)
	if err != nil {
		return nil, err
	}

	// Pedir la contraseña para una acción irreversible evita que un dispositivo desatendido, o una
	// petición falsificada desde otra web, borre la cuenta de alguien.
	if err := checkPassword(user.PasswordHash, request.Msg.GetPassword()); err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("la contraseña no es correcta"))
	}

	if err := h.store.DeleteUser(ctx, user.ID); err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("la cuenta ya no existe"))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("auth: falló el borrado de la cuenta: %w", err))
	}

	h.logger.Info("account deleted with its profile and sessions", slog.String("user_id", user.ID))

	response := connect.NewResponse(&authv1.DeleteAccountResponse{})
	response.Header().Add(setCookieHeader, NewExpiredSessionCookie(h.cookieOptions).String())
	return response, nil
}

// RequestPasswordReset pide un permiso temporal para poner una contraseña nueva sin saber la anterior.
//
// En español: responde SIEMPRE lo mismo, exista o no la cuenta. Y "lo mismo" no significa solo el
// mismo mensaje: significa también EL MISMO TIEMPO. Igualar únicamente el texto no servía de nada,
// porque el reloj delataba la respuesta igual de bien: medido antes de esta corrección, una cuenta
// existente tardaba 1,078 ms y una inexistente 0,476 ms — el doble de rápido. Con esa diferencia,
// cualquiera podía recorrer una lista de correos y quedarse con los que "tardan", sin leer ni un
// mensaje. Por eso todas las salidas de esta función pasan por el mismo suelo de tiempo (ver
// waitUntilResponseFloor): tarde lo que tarde el trabajo real, la respuesta no sale antes de ese
// plazo, así que desde fuera todos los caminos duran exactamente igual.
func (h *Handler) RequestPasswordReset(
	ctx context.Context,
	request *connect.Request[authv1.RequestPasswordResetRequest],
) (*connect.Response[authv1.RequestPasswordResetResponse], error) {
	// El cronómetro arranca en la PRIMERA línea, antes incluso de mirar el correo, para que ninguna
	// parte del trabajo quede fuera de la igualación. El defer se ejecuta pase lo que pase (respuesta
	// correcta, error interno o pánico), de modo que ningún camino se puede escapar sin esperar.
	startedAt := time.Now()
	defer waitUntilResponseFloor(ctx, startedAt, passwordResetResponseFloor)

	email := store.NormalizeEmail(request.Msg.GetEmail())

	user, err := h.store.FindUserByEmail(ctx, email)
	switch {
	case errors.Is(err, store.ErrUserNotFound):
		// No existe: se responde exactamente igual que si existiera, sin hacer nada más. El correo
		// NO se escribe en el registro: dejaría en el disco del servidor la lista de correos que
		// alguien ha ido probando, que es justo el dato que esta función se dedica a no revelar.
		h.logger.Info("password reset requested for an unknown account; responding identically")
		return connect.NewResponse(&authv1.RequestPasswordResetResponse{}), nil
	case err != nil:
		return nil, connect.NewError(
			connect.CodeInternal,
			fmt.Errorf("auth: falló la petición de restablecimiento: %w", err),
		)
	}

	// El permiso NO se emite aquí: se le pasa al canal de entrega la capacidad de emitirlo, y es él
	// quien decide si tirar de esa cuerda. El canal manual de la alpha no la tira, porque no entrega
	// tokens: avisa a quien administra para que lo emita con `make admin-reset`. Ver auth/delivery.go.
	issueReset := func(ctx context.Context) (string, time.Time, error) {
		reset, err := h.store.CreatePasswordReset(ctx, user.ID, store.DefaultPasswordResetTTL)
		if err != nil {
			return "", time.Time{}, fmt.Errorf("auth: no se pudo emitir el restablecimiento: %w", err)
		}
		return reset.Token, reset.ExpiresAt, nil
	}

	if err := h.resetDelivery.DeliverPasswordReset(ctx, ResetRecipient{
		UserID:      user.ID,
		Email:       user.Email,
		DisplayName: user.DisplayName,
	}, issueReset); err != nil {
		// La entrega falló: nadie va a recibir nada. Es un fallo real del servidor y hay que decirlo,
		// porque si no la persona esperaría eternamente algo que no llegará. Aun así el mensaje no
		// revela si la cuenta existía.
		return nil, connect.NewError(
			connect.CodeInternal,
			fmt.Errorf("auth: no se pudo entregar el restablecimiento: %w", err),
		)
	}

	return connect.NewResponse(&authv1.RequestPasswordResetResponse{}), nil
}

// passwordResetResponseFloor es lo que tarda COMO MÍNIMO una respuesta de RequestPasswordReset.
//
// En español: es el "suelo" que iguala los tiempos. Se elige holgadamente por encima de lo que
// cuesta el camino más lento medido (1,078 ms con la cuenta existente, incluidas la consulta a la
// base y la entrega), para que el trabajo real quepa siempre dentro y nunca asome por debajo del
// suelo. 50 ms es a la vez imperceptible para una persona —que acaba de pulsar un botón y espera
// medio segundo de red de todos modos— y unas cincuenta veces mayor que la diferencia que se
// pretende esconder. Lo que queda fuera del alcance de esta defensa, dicho sin adornos: si algún día
// el trabajo real superase los 50 ms de forma sistemática (una base mucho más grande, un canal de
// correo lento), el suelo dejaría de tapar la diferencia y habría que subirlo. La cuota estricta de
// 10 peticiones por minuto y por IP limita mucho cuántas medidas puede tomar quien lo intente.
const passwordResetResponseFloor = 50 * time.Millisecond

// waitUntilResponseFloor espera lo que falte para que la respuesta cumpla su tiempo mínimo.
//
// En español: mira cuánto se ha tardado ya y duerme la diferencia. Si el trabajo real ya pasó del
// suelo, no espera nada. La espera se interrumpe si quien preguntó se marcha (contexto cancelado):
// seguir durmiendo para responderle a nadie solo ocuparía una tarea del servidor sin motivo, y no
// debilita nada, porque quien se fue no llega a medir ningún tiempo.
func waitUntilResponseFloor(ctx context.Context, startedAt time.Time, floor time.Duration) {
	remaining := floor - time.Since(startedAt)
	if remaining <= 0 {
		return
	}

	timer := time.NewTimer(remaining)
	defer timer.Stop()

	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

// ResetPassword canjea el permiso de restablecimiento y fija la contraseña nueva.
//
// En español: el token es de UN SOLO USO y de vida corta. Al canjearlo se cierran todas las sesiones
// abiertas de la cuenta: si el restablecimiento se pidió porque alguien más había entrado, esta es
// la parte que lo echa fuera.
func (h *Handler) ResetPassword(
	ctx context.Context,
	request *connect.Request[authv1.ResetPasswordRequest],
) (*connect.Response[authv1.ResetPasswordResponse], error) {
	resetToken := strings.TrimSpace(request.Msg.GetResetToken())
	newPassword := request.Msg.GetNewPassword()

	if err := validatePassword(newPassword); err != nil {
		return nil, err
	}

	newHash, err := hashPassword(newPassword)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	userID, revokedSessions, err := h.store.ConsumePasswordReset(ctx, resetToken, newHash)
	switch {
	case errors.Is(err, store.ErrResetTokenNotUsable), errors.Is(err, store.ErrUserNotFound):
		return nil, connect.NewError(
			connect.CodePermissionDenied,
			errors.New("el enlace de restablecimiento no es válido, ya caducó o ya se usó"),
		)
	case err != nil:
		return nil, connect.NewError(
			connect.CodeInternal,
			fmt.Errorf("auth: falló el restablecimiento de contraseña: %w", err),
		)
	}

	h.logger.Info(
		"password reset consumed and sessions revoked",
		slog.String("user_id", userID),
		slog.Int64("revoked_sessions", revokedSessions),
	)

	return connect.NewResponse(&authv1.ResetPasswordResponse{}), nil
}

// openSessionResponse abre una sesión para la cuenta dada y arma la respuesta de autenticación.
//
// En español: la sesión se entrega por DOS caminos a la vez. Como cookie HttpOnly, que es el camino
// seguro y el que se usará cuando el frontend hable con el backend a través de su propio dominio; y
// en el campo `token` de la respuesta, que es lo que el frontend guarda hoy y reenvía en la cabecera
// Authorization. Es la misma sesión por ambos caminos: cerrarla la cierra para los dos.
func (h *Handler) openSessionResponse(
	ctx context.Context,
	user store.User,
) (*connect.Response[authv1.AuthResponse], error) {
	issued, err := h.store.CreateSession(ctx, user.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("auth: no se pudo abrir la sesión: %w", err))
	}

	// El token viaja SOLO en la cookie. La respuesta visible para el JavaScript de la página lleva
	// únicamente los datos públicos de la cuenta: si un script conseguera colarse en la página, no
	// encontraría la credencial por ningún lado.
	response := connect.NewResponse(&authv1.AuthResponse{
		User: toPublicUser(user),
	})
	response.Header().Add(setCookieHeader, NewSessionCookie(issued.Token, h.cookieOptions).String())
	return response, nil
}

// requireAuthenticatedUser recupera la cuenta de quien llama, o devuelve el error adecuado.
// En español: junta en un solo sitio la comprobación que repiten todos los handlers que exigen
// sesión, para que ninguno pueda olvidarse de hacerla.
func (h *Handler) requireAuthenticatedUser(ctx context.Context) (store.User, error) {
	userID, ok := UserIDFromContext(ctx)
	if !ok {
		return store.User{}, connect.NewError(connect.CodeUnauthenticated, errors.New("sin sesión"))
	}

	user, err := h.store.FindUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			// La sesión era válida pero la cuenta ya no está (se borró o se inhabilitó): para quien
			// llama es indistinguible de no tener sesión, y así debe ser.
			return store.User{}, connect.NewError(connect.CodeUnauthenticated, errors.New("sesión inválida"))
		}
		return store.User{}, connect.NewError(connect.CodeInternal, fmt.Errorf("auth: no se pudo leer la cuenta: %w", err))
	}
	return user, nil
}

// validatePassword comprueba que una contraseña cumpla los mínimos del producto.
func validatePassword(password string) error {
	if len(password) < minPasswordLength {
		return connect.NewError(
			connect.CodeInvalidArgument,
			errors.New("la contraseña debe tener al menos 8 caracteres"),
		)
	}
	if len(password) > maxPasswordLength {
		return connect.NewError(
			connect.CodeInvalidArgument,
			errors.New("la contraseña es demasiado larga (máximo 72 caracteres)"),
		)
	}
	return nil
}

// toPublicUser convierte la cuenta guardada (que incluye la huella de la contraseña) en su forma
// PÚBLICA del contrato, que jamás lleva nada secreto.
func toPublicUser(user store.User) *authv1.User {
	return &authv1.User{
		Id:          user.ID,
		Email:       user.Email,
		DisplayName: user.DisplayName,
		CreatedAt:   user.CreatedAt.UTC().Format(time.RFC3339),
	}
}

// looksLikeEmail hace la validación mínima de un correo (una arroba con texto a ambos lados y un
// punto en el dominio). No pretende ser exhaustiva: la validación definitiva de un correo es que
// llegue un mensaje a él, y eso no se hace aquí.
func looksLikeEmail(email string) bool {
	local, domain, found := strings.Cut(email, "@")
	return found && local != "" && strings.Contains(domain, ".")
}
