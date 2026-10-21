// Package catalog contiene la implementación del servicio de catálogo del producto.
// En español: aquí vive la lógica que responde a las preguntas del frontend sobre el catálogo.
// En Sprint 2 el servicio ya está completo: además de GetServiceInfo (diagnóstico), responde
// ListReleases (los estrenos de un mes/año, con filtros) y GetRelease (el detalle de uno por su
// ID). Los datos salen de un almacén en memoria (Store) cargado del seed.json al arrancar; todavía
// no hay base de datos. Este archivo es el "traductor": recibe peticiones del contrato, valida la
// entrada, consulta el Store y arma las respuestas o los errores apropiados.
package catalog

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"

	"connectrpc.com/connect"

	// catalogv1 contiene los mensajes generados a partir de catalog.proto (request/response).
	// En español: lo genera `buf generate`; son los "tipos de datos" del contrato.
	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
	// catalogv1connect aporta la interfaz y el adaptador HTTP generados por connect-go.
	// En español: define la firma del servicio que debemos implementar.
	"mdm7mo/gen/mdm7mo/catalog/v1/catalogv1connect"
)

// serviceName es el nombre lógico del servicio que reportamos en GetServiceInfo.
// En español: es una etiqueta fija que identifica a este servicio ante el frontend.
const serviceName = "CatalogService"

// minMonth y maxMonth delimitan el rango válido de meses (1 = enero, 12 = diciembre).
// En español: cualquier mes fuera de este rango es un error de quien pregunta, no del backend;
// los usamos para validar la petición de ListReleases antes de tocar el almacén de datos.
const (
	minMonth int32 = 1
	maxMonth int32 = 12
)

// Handler implementa el servicio de catálogo de Connect.
// En español: es la pieza del backend que responde las llamadas del frontend hacia el catálogo.
// Conoce dos cosas: la versión del proyecto (para GetServiceInfo) y el almacén de estrenos en
// memoria (para listar y traer detalles). Ambas se le inyectan al construirlo, lo que mantiene
// el handler simple y fácil de probar sin red ni archivos.
type Handler struct {
	// version es la versión del proyecto que devolvemos en GetServiceInfo.
	// En español: la etiqueta de versión (ej. "0.0.21") que viene de la configuración, la cual a
	// su vez la toma del archivo VERSION de la raíz del monorepo.
	version string

	// store es el almacén en memoria de estrenos del catálogo, guardado como puntero ATÓMICO.
	// En español: la "bodega" de donde el handler saca los estrenos. Es atómico porque el catálogo
	// se puede RECARGAR mientras el servidor atiende peticiones (ver SwapStore y el refresco
	// automático del seed): el almacén nunca se modifica por dentro, se sustituye entero por uno
	// nuevo. Cambiar un puntero de forma atómica hace que ese relevo sea instantáneo y seguro —
	// quien esté leyendo termina con la versión antigua y las peticiones siguientes ven la nueva,
	// sin candados en la ruta de lectura y sin que nadie llegue a ver un catálogo a medio construir.
	store atomic.Pointer[Store]
}

// Verificación en tiempo de compilación de que Handler cumple el contrato.
// En español: esta línea NO ejecuta nada; solo le pide a Go que confirme, al compilar, que Handler
// tiene todos los métodos que la interfaz generada exige. Si falta alguno, el build falla aquí
// mismo en vez de en un punto lejano.
var _ catalogv1connect.CatalogServiceHandler = (*Handler)(nil)

// NewHandler construye un Handler con la versión del proyecto y el almacén de estrenos inyectados.
// En español: crea la pieza del catálogo dándole la versión que debe reportar y la "bodega" de
// datos que debe consultar. Recibir ambas por parámetro (en vez de leerlas aquí dentro) mantiene
// el handler desacoplado y fácil de probar con datos de mentira.
func NewHandler(version string, store *Store) *Handler {
	handler := &Handler{version: version}
	handler.store.Store(store)
	return handler
}

// SwapStore sustituye el catálogo en caliente por uno nuevo, sin detener el servicio.
// En español: lo usa el refresco automático del seed. Devuelve el almacén anterior por si el
// llamador quiere registrar de qué se pasó a qué. La sustitución es atómica: ninguna petición en
// curso ve un estado intermedio.
func (h *Handler) SwapStore(next *Store) *Store {
	return h.store.Swap(next)
}

// currentStore devuelve el almacén vigente en este instante.
func (h *Handler) currentStore() *Store {
	return h.store.Load()
}

// GetServiceInfo devuelve metadata básica del servicio: su nombre y la versión.
// En español: responde a la pregunta "¿qué servicio eres y qué versión corres?". Sirve para
// confirmar que el backend está vivo y para validar el cableado de extremo a extremo
// (frontend -> red -> backend).
func (h *Handler) GetServiceInfo(
	_ context.Context,
	_ *connect.Request[catalogv1.GetServiceInfoRequest],
) (*connect.Response[catalogv1.GetServiceInfoResponse], error) {
	// Armamos la respuesta con el nombre fijo del servicio y la versión configurada.
	// En español: rellenamos el "sobre" de respuesta con los dos datos del contrato.
	response := connect.NewResponse(&catalogv1.GetServiceInfoResponse{
		ServiceName: serviceName,
		Version:     h.version,
	})
	return response, nil
}

// validatePeriod comprueba que el año y el mes pedidos tengan sentido.
//
// En español: devuelve un error de "argumento inválido" (culpa de quien pregunta, no del servidor)
// cuando el periodo no existe. Vive aparte porque las DOS operaciones que acotan por periodo
// —ListReleases y ListReleaseDetails— tienen que validar exactamente igual; escrito dos veces,
// bastaría con arreglar una para que la otra se quedara atrás sin que nadie lo notara.
func validatePeriod(year, month int32) error {
	// Validamos el año: debe ser un número positivo (no tiene sentido pedir "el año 0" o negativo).
	if year <= 0 {
		return connect.NewError(
			connect.CodeInvalidArgument,
			fmt.Errorf("year must be a positive number, got %d", year),
		)
	}

	// Validamos el mes: debe estar dentro del rango 1-12 (enero a diciembre).
	if month < minMonth || month > maxMonth {
		return connect.NewError(
			connect.CodeInvalidArgument,
			fmt.Errorf("month must be between %d and %d, got %d", minMonth, maxMonth, month),
		)
	}

	return nil
}

// ListReleases devuelve los RESÚMENES de los estrenos de un mes/año, con filtros opcionales.
//
// En español: es la consulta principal de la línea de tiempo ("dame los estrenos de junio 2026").
// Primero valida que el periodo pedido tenga sentido; si no, lo reporta como error de argumento.
// Si el periodo es válido, le pide al almacén los estrenos que cumplen los filtros y los ADELGAZA a
// su forma de lista antes de devolverlos (ver summary.go): el reparto, la galería, el calendario de
// episodios, la saga completa y los videos NO salen por aquí, porque ninguna pantalla de lista los
// dibuja. Quien abra una ficha la pide entera con GetRelease en ese momento.
func (h *Handler) ListReleases(
	_ context.Context,
	request *connect.Request[catalogv1.ListReleasesRequest],
) (*connect.Response[catalogv1.ListReleasesResponse], error) {
	message := request.Msg

	if err := validatePeriod(message.GetYear(), message.GetMonth()); err != nil {
		return nil, err
	}

	// Pedimos al almacén los estrenos del periodo, aplicando los filtros opcionales de la petición.
	// En español: el Store ya sabe filtrar por año/mes y, si las listas de tipos/categorías vienen
	// vacías, no filtra por ellas (vacío = "todos"). El resultado llega ordenado de forma estable.
	releases := h.currentStore().List(
		message.GetYear(),
		message.GetMonth(),
		message.GetTypes(),
		message.GetCategories(),
	)

	// Empaquetamos los RESÚMENES en la respuesta del contrato y los devolvemos.
	response := connect.NewResponse(&catalogv1.ListReleasesResponse{
		Summaries: summariesOf(releases),
	})
	return response, nil
}

// ListReleaseDetails vuelca las fichas COMPLETAS de un mes/año. No es un listado de pantalla.
//
// En español: la usan las tres pantallas que no dibujan una lista sino que RECORREN el catálogo
// entero mirando dentro de cada ficha —la constelación personal, la página de una persona y la de
// una saga—, porque lo que buscan (quién actúa, quién dirige, a qué colección pertenece) vive dentro
// de los campos pesados. Es deliberadamente cara y se llama así para que se note: si algún día
// aparece una pantalla de LISTA llamando a esto, se ve a simple vista en la revisión del código.
func (h *Handler) ListReleaseDetails(
	_ context.Context,
	request *connect.Request[catalogv1.ListReleaseDetailsRequest],
) (*connect.Response[catalogv1.ListReleaseDetailsResponse], error) {
	message := request.Msg

	if err := validatePeriod(message.GetYear(), message.GetMonth()); err != nil {
		return nil, err
	}

	releases := h.currentStore().List(
		message.GetYear(),
		message.GetMonth(),
		message.GetTypes(),
		message.GetCategories(),
	)

	response := connect.NewResponse(&catalogv1.ListReleaseDetailsResponse{
		Releases: releases,
	})
	return response, nil
}

// GetRelease devuelve el detalle completo de un estreno por su identificador.
// En español: alimenta la pantalla de detalle (deep-link /titulo/[id]). Valida que venga un ID
// (un ID vacío es un error de quien pregunta) y, si el estreno no existe en el catálogo, lo
// reporta como "no encontrado". Si existe, devuelve su ficha completa.
func (h *Handler) GetRelease(
	_ context.Context,
	request *connect.Request[catalogv1.GetReleaseRequest],
) (*connect.Response[catalogv1.GetReleaseResponse], error) {
	id := request.Msg.GetId()

	// Validamos que el ID no venga vacío: sin ID no hay nada que buscar.
	if id == "" {
		return nil, connect.NewError(
			connect.CodeInvalidArgument,
			errors.New("release id must not be empty"),
		)
	}

	// Buscamos el estreno en el almacén por su ID.
	// En español: si el almacén dice que no existe, respondemos "no encontrado" (CodeNotFound),
	// que es la forma correcta de avisar que el dato no está sin tratarlo como un fallo del sistema.
	release, found := h.currentStore().Get(id)
	if !found {
		return nil, connect.NewError(
			connect.CodeNotFound,
			fmt.Errorf("release with id %q was not found", id),
		)
	}

	// El estreno existe: lo empaquetamos en la respuesta del contrato y lo devolvemos, con su resumen
	// al lado. El resumen viaja junto a la ficha porque lleva tres datos DERIVADOS (el nombre de la
	// saga, quién dirige y el reparto principal) que la sección de "Conexiones" necesita y que, si no
	// se mandaran, el navegador tendría que volver a deducir con una copia de las mismas reglas.
	response := connect.NewResponse(&catalogv1.GetReleaseResponse{
		Release: release,
		Summary: summaryOf(release),
	})
	return response, nil
}
