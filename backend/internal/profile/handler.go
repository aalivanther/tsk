package profile

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"

	profilev1 "mdm7mo/gen/mdm7mo/profile/v1"
	"mdm7mo/gen/mdm7mo/profile/v1/profilev1connect"
	"mdm7mo/internal/auth"
	"mdm7mo/internal/store"
)

// Handler implementa el servicio de perfil sobre el almacén persistente.
type Handler struct {
	profilev1connect.UnimplementedProfileServiceHandler

	// store es la base de datos donde vive el documento de perfil de cada cuenta.
	store *store.Store
}

// NewHandler arma el handler del servicio de perfil.
// Devuelve error si falta el almacén: sin él el servicio no puede hacer absolutamente nada, y es
// preferible no arrancar a arrancar con una ventanilla rota.
func NewHandler(persistentStore *store.Store) (*Handler, error) {
	if persistentStore == nil {
		return nil, errors.New("profile: el handler necesita un almacén persistente")
	}
	return &Handler{store: persistentStore}, nil
}

// GetProfile devuelve el perfil guardado de la cuenta que llama.
// En español: si esa cuenta nunca guardó nada, devuelve documento vacío y revisión 0, que es
// precisamente lo que el cliente necesita saber para subir el suyo por primera vez.
func (h *Handler) GetProfile(
	ctx context.Context,
	_ *connect.Request[profilev1.GetProfileRequest],
) (*connect.Response[profilev1.GetProfileResponse], error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}

	stored, err := h.store.GetProfile(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("profile: no se pudo leer el perfil: %w", err))
	}

	return connect.NewResponse(&profilev1.GetProfileResponse{
		ProfileJson: stored.Document,
		Revision:    stored.Revision,
		UpdatedAt:   formatInstant(stored.UpdatedAt),
	}), nil
}

// PutProfile guarda el perfil completo, siempre que nadie se haya adelantado.
//
// En español: el cliente dice sobre qué revisión trabajaba. Si el servidor sigue en esa misma, el
// guardado se acepta y la revisión sube uno. Si el servidor ya va por otra (porque otro dispositivo
// guardó mientras tanto), el guardado se RECHAZA con FailedPrecondition y —esto es lo importante—
// el error lleva adjunto el documento que el servidor tiene, para que el cliente pueda fusionar los
// dos y reintentar. Sin ese adjunto, el cliente sabría que falló pero no tendría con qué arreglarlo.
func (h *Handler) PutProfile(
	ctx context.Context,
	request *connect.Request[profilev1.PutProfileRequest],
) (*connect.Response[profilev1.PutProfileResponse], error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}

	document := request.Msg.GetProfileJson()
	baseRevision := request.Msg.GetBaseRevision()

	if baseRevision < 0 {
		return nil, connect.NewError(
			connect.CodeInvalidArgument,
			errors.New("la revisión de partida no puede ser negativa"),
		)
	}
	if err := validateDocument(document); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	saved, err := h.store.PutProfile(ctx, userID, document, baseRevision)
	if errors.Is(err, store.ErrRevisionConflict) {
		return nil, newRevisionConflictError(saved)
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("profile: no se pudo guardar el perfil: %w", err))
	}

	return connect.NewResponse(&profilev1.PutProfileResponse{
		Revision:  saved.Revision,
		UpdatedAt: formatInstant(saved.UpdatedAt),
	}), nil
}

// newRevisionConflictError arma el error de conflicto llevando adjunto el perfil del servidor.
//
// En español: Connect permite acompañar un error con "detalles" estructurados, que son mensajes del
// propio contrato. Aquí se aprovecha para mandar, junto al "no puedo guardar esto", el documento
// vigente. Si el detalle no se pudiera adjuntar (algo que solo ocurriría ante un fallo interno de
// serialización), se devuelve igualmente el error de conflicto: es mejor un rechazo sin adjunto que
// aceptar un guardado que pisaría datos ajenos.
func newRevisionConflictError(serverProfile store.Profile) error {
	conflictError := connect.NewError(
		connect.CodeFailedPrecondition,
		errors.New("el perfil cambió en otro dispositivo; hay que fusionar y reintentar"),
	)

	detail, err := connect.NewErrorDetail(&profilev1.ProfileConflict{
		ServerProfileJson: serverProfile.Document,
		ServerRevision:    serverProfile.Revision,
		ServerUpdatedAt:   formatInstant(serverProfile.UpdatedAt),
	})
	if err != nil {
		return conflictError
	}
	conflictError.AddDetail(detail)
	return conflictError
}

// requireUserID exige que la llamada venga de una sesión válida y devuelve de quién es.
// En español: todas las operaciones del perfil son personales; sin sesión no hay perfil que servir.
func requireUserID(ctx context.Context) (string, error) {
	userID, ok := auth.UserIDFromContext(ctx)
	if !ok {
		return "", connect.NewError(connect.CodeUnauthenticated, errors.New("se necesita una sesión para ver o guardar el perfil"))
	}
	return userID, nil
}

// formatInstant convierte un instante a texto ISO-8601 para el contrato, dejando vacío el instante
// "cero" (que significa "esto nunca ocurrió", no "ocurrió en 1970").
func formatInstant(instant time.Time) string {
	if instant.IsZero() {
		return ""
	}
	return instant.UTC().Format(time.RFC3339)
}
