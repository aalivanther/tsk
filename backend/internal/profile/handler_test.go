// Archivo: handler_test.go — Pruebas del servicio de perfil.
//
// En español: comprueban que el perfil se lee y se guarda contra la cuenta correcta, que hace falta
// sesión para tocarlo, que el conflicto de revisión devuelve el documento del servidor para poder
// fusionar, y que las validaciones del servidor rechazan documentos absurdos.
package profile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"

	profilev1 "mdm7mo/gen/mdm7mo/profile/v1"
	"mdm7mo/internal/auth"
	"mdm7mo/internal/store"
)

// testTokenHashKey es la clave con la que las pruebas calculan las huellas de los tokens.
const testTokenHashKey = "clave-de-pruebas-para-huellas-de-tokens-0123456789"

// testUserID es la cuenta sobre la que trabajan casi todas las pruebas.
const testUserID = "user-de-prueba"

// newTestHandler arma el servicio de perfil sobre una base de datos limpia con una cuenta ya creada.
func newTestHandler(t *testing.T) (*Handler, *store.Store) {
	t.Helper()

	persistentStore, err := store.Open(store.Options{
		Path:         filepath.Join(t.TempDir(), "tsk.db"),
		TokenHashKey: testTokenHashKey,
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("store.Open devolvió error: %v", err)
	}
	t.Cleanup(func() {
		if err := persistentStore.Close(); err != nil {
			t.Errorf("Close devolvió error: %v", err)
		}
	})

	if _, err := persistentStore.CreateUser(context.Background(), store.NewUser{
		ID:           testUserID,
		Email:        "perfil@example.com",
		DisplayName:  "Persona de prueba",
		PasswordHash: "hash-bcrypt-simulado",
	}); err != nil {
		t.Fatalf("CreateUser devolvió error: %v", err)
	}

	handler, err := NewHandler(persistentStore)
	if err != nil {
		t.Fatalf("NewHandler devolvió error: %v", err)
	}
	return handler, persistentStore
}

// authenticatedContext arma el context que el interceptor prepararía para una sesión válida.
func authenticatedContext() context.Context {
	return auth.WithIdentity(context.Background(), auth.Identity{
		UserID:       testUserID,
		SessionToken: "token-de-prueba",
	})
}

// TestProfileRequiresASession comprueba que sin sesión no hay perfil ni para leer ni para guardar.
func TestProfileRequiresASession(t *testing.T) {
	handler, _ := newTestHandler(t)
	anonymous := context.Background()

	cases := []struct {
		name string
		call func() error
	}{
		{
			name: "leer el perfil sin sesión",
			call: func() error {
				_, err := handler.GetProfile(anonymous, connect.NewRequest(&profilev1.GetProfileRequest{}))
				return err
			},
		},
		{
			name: "guardar el perfil sin sesión",
			call: func() error {
				_, err := handler.PutProfile(anonymous, connect.NewRequest(&profilev1.PutProfileRequest{
					ProfileJson:  `{"watchlist":[]}`,
					BaseRevision: 0,
				}))
				return err
			},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := testCase.call(); connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("se esperaba Unauthenticated y se obtuvo %v", err)
			}
		})
	}
}

// TestGetProfileOnAFreshAccountIsEmpty comprueba el estado inicial que ve un cliente nuevo.
func TestGetProfileOnAFreshAccountIsEmpty(t *testing.T) {
	handler, _ := newTestHandler(t)

	response, err := handler.GetProfile(authenticatedContext(), connect.NewRequest(&profilev1.GetProfileRequest{}))
	if err != nil {
		t.Fatalf("GetProfile devolvió error: %v", err)
	}
	if response.Msg.GetProfileJson() != "" {
		t.Fatalf("un perfil sin guardar debería venir vacío, vino %q", response.Msg.GetProfileJson())
	}
	if response.Msg.GetRevision() != 0 {
		t.Fatalf("un perfil sin guardar debería estar en la revisión 0, está en la %d", response.Msg.GetRevision())
	}
	if response.Msg.GetUpdatedAt() != "" {
		t.Fatalf("un perfil sin guardar no debería tener fecha, tiene %q", response.Msg.GetUpdatedAt())
	}
}

// TestPutProfileStoresAndGetProfileReadsItBack comprueba el ciclo completo de guardar y leer.
func TestPutProfileStoresAndGetProfileReadsItBack(t *testing.T) {
	handler, _ := newTestHandler(t)
	ctx := authenticatedContext()

	document := `{"watchlist":["movie-1","series-2"],"watched":["movie-9"],"reviews":{"movie-9":8.5}}`

	saved, err := handler.PutProfile(ctx, connect.NewRequest(&profilev1.PutProfileRequest{
		ProfileJson:  document,
		BaseRevision: 0,
	}))
	if err != nil {
		t.Fatalf("PutProfile devolvió error: %v", err)
	}
	if saved.Msg.GetRevision() != 1 {
		t.Fatalf("el primer guardado debería dejar la revisión en 1 y la dejó en %d", saved.Msg.GetRevision())
	}
	if saved.Msg.GetUpdatedAt() == "" {
		t.Fatal("el guardado debería informar de la fecha en que ocurrió")
	}

	read, err := handler.GetProfile(ctx, connect.NewRequest(&profilev1.GetProfileRequest{}))
	if err != nil {
		t.Fatalf("GetProfile devolvió error: %v", err)
	}
	if read.Msg.GetProfileJson() != document {
		t.Fatalf("el documento leído no coincide con el guardado:\n leído:    %s\n guardado: %s",
			read.Msg.GetProfileJson(), document)
	}
	if read.Msg.GetRevision() != 1 {
		t.Fatalf("la revisión leída debería ser 1 y es %d", read.Msg.GetRevision())
	}
}

// TestPutProfileConflictReturnsTheServerDocument es la prueba de la revisión optimista.
//
// En español: el segundo dispositivo, que trabajaba sobre una revisión vieja, recibe un rechazo
// FailedPrecondition; y ese rechazo trae adjunto el documento actual del servidor, que es lo que le
// permite fusionar sus cambios y reintentar en vez de perderlos.
func TestPutProfileConflictReturnsTheServerDocument(t *testing.T) {
	handler, _ := newTestHandler(t)
	ctx := authenticatedContext()

	// Estado compartido de partida: revisión 1.
	if _, err := handler.PutProfile(ctx, connect.NewRequest(&profilev1.PutProfileRequest{
		ProfileJson:  `{"watchlist":["movie-1"]}`,
		BaseRevision: 0,
	})); err != nil {
		t.Fatalf("PutProfile inicial devolvió error: %v", err)
	}

	// El teléfono guarda primero: el servidor pasa a la revisión 2.
	phoneDocument := `{"watchlist":["movie-1","desde-el-telefono"]}`
	if _, err := handler.PutProfile(ctx, connect.NewRequest(&profilev1.PutProfileRequest{
		ProfileJson:  phoneDocument,
		BaseRevision: 1,
	})); err != nil {
		t.Fatalf("el guardado del teléfono devolvió error: %v", err)
	}

	// La computadora llega tarde con la revisión 1.
	_, err := handler.PutProfile(ctx, connect.NewRequest(&profilev1.PutProfileRequest{
		ProfileJson:  `{"watchlist":["desde-la-computadora"]}`,
		BaseRevision: 1,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("se esperaba FailedPrecondition y se obtuvo %v", err)
	}

	conflict := extractProfileConflict(t, err)
	if conflict.GetServerRevision() != 2 {
		t.Fatalf("el conflicto debería informar de la revisión 2 y informó de la %d", conflict.GetServerRevision())
	}
	if conflict.GetServerProfileJson() != phoneDocument {
		t.Fatalf("el conflicto debería traer el documento del servidor, trajo %q", conflict.GetServerProfileJson())
	}
	if conflict.GetServerUpdatedAt() == "" {
		t.Fatal("el conflicto debería informar de cuándo se guardó la revisión del servidor")
	}

	// Y el guardado tardío no cambió nada.
	read, err := handler.GetProfile(ctx, connect.NewRequest(&profilev1.GetProfileRequest{}))
	if err != nil {
		t.Fatalf("GetProfile devolvió error: %v", err)
	}
	if read.Msg.GetProfileJson() != phoneDocument {
		t.Fatalf("el guardado rechazado no debía pisar nada, quedó %q", read.Msg.GetProfileJson())
	}
}

// TestPutProfileRejectsInvalidDocuments recorre las validaciones del servidor.
//
// En español: el servidor no guarda a ciegas lo que le manden. Estas son las formas de documento que
// rechaza, y por qué cada una importa.
func TestPutProfileRejectsInvalidDocuments(t *testing.T) {
	handler, _ := newTestHandler(t)
	ctx := authenticatedContext()

	cases := []struct {
		name     string
		document string
	}{
		{
			name:     "documento vacío",
			document: "",
		},
		{
			name:     "texto que no es JSON",
			document: "esto no es json",
		},
		{
			name:     "lista de 'quiero ver' con más títulos de los permitidos",
			document: buildDocumentWithIdentifiers(t, "watchlist", maxIdentifiersPerList+1),
		},
		{
			name:     "lista de vistos con más títulos de los permitidos",
			document: buildDocumentWithIdentifiers(t, "watched", maxIdentifiersPerList+1),
		},
		{
			name:     "una reseña con nota por debajo del mínimo",
			document: `{"reviews":{"movie-1":0}}`,
		},
		{
			name:     "una reseña con nota por encima del máximo",
			document: `{"reviews":{"movie-1":11}}`,
		},
		{
			name:     "una reseña con nota negativa",
			document: `{"reviews":{"movie-1":-3}}`,
		},
		{
			name:     "un evento de actividad con nota fuera de rango",
			document: `{"activity":[{"kind":"review","id":"movie-1","at":"2026-07-28","score":42}]}`,
		},
		{
			name:     "un evento de actividad sin título",
			document: `{"activity":[{"kind":"watched","id":"","at":"2026-07-28"}]}`,
		},
		{
			name:     "un identificador vacío en una lista",
			document: `{"watchlist":["movie-1",""]}`,
		},
		{
			name:     "un identificador absurdamente largo",
			document: `{"watchlist":["` + strings.Repeat("x", maxIdentifierLength+1) + `"]}`,
		},
		{
			name:     "un documento más grande que el tope permitido",
			document: `{"watchlist":["` + strings.Repeat("x", maxProfileDocumentBytes) + `"]}`,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := handler.PutProfile(ctx, connect.NewRequest(&profilev1.PutProfileRequest{
				ProfileJson:  testCase.document,
				BaseRevision: 0,
			}))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("se esperaba InvalidArgument y se obtuvo %v", err)
			}
		})
	}
}

// TestPutProfileAcceptsDocumentsAtTheLimits comprueba que los topes no son demasiado estrictos.
//
// En español: importa tanto rechazar lo absurdo como NO rechazar lo legítimo. Un perfil justo en el
// límite (500 títulos, notas de 1 y de 10) tiene que entrar sin problemas.
func TestPutProfileAcceptsDocumentsAtTheLimits(t *testing.T) {
	handler, _ := newTestHandler(t)
	ctx := authenticatedContext()

	cases := []struct {
		name     string
		document string
	}{
		{
			name:     "exactamente el máximo de títulos en la lista",
			document: buildDocumentWithIdentifiers(t, "watchlist", maxIdentifiersPerList),
		},
		{
			name:     "notas justo en los extremos del rango",
			document: `{"reviews":{"movie-1":1,"movie-2":10,"movie-3":7.5}}`,
		},
		{
			name: "un perfil realista completo",
			document: `{"watchlist":["movie-1"],"watched":["series-2"],"reviews":{"series-2":9},` +
				`"settings":{"language":"es","genres":["Drama"],"platforms":["Netflix"],"theme":"dark"},` +
				`"createdAt":"2026-07-28","activity":[{"kind":"review","id":"series-2","at":"2026-07-28","score":9}],` +
				`"seenNotifications":["aviso-1"]}`,
		},
		{
			name:     "un objeto vacío (perfil recién creado)",
			document: `{}`,
		},
	}

	for index, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			// Cada guardado parte de la revisión que dejó el anterior.
			if _, err := handler.PutProfile(ctx, connect.NewRequest(&profilev1.PutProfileRequest{
				ProfileJson:  testCase.document,
				BaseRevision: int64(index),
			})); err != nil {
				t.Fatalf("este documento debería aceptarse: %v", err)
			}
		})
	}
}

// TestPutProfileRejectsNegativeBaseRevision comprueba el rechazo de una revisión imposible.
func TestPutProfileRejectsNegativeBaseRevision(t *testing.T) {
	handler, _ := newTestHandler(t)

	_, err := handler.PutProfile(authenticatedContext(), connect.NewRequest(&profilev1.PutProfileRequest{
		ProfileJson:  `{"watchlist":[]}`,
		BaseRevision: -1,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("se esperaba InvalidArgument y se obtuvo %v", err)
	}
}

// TestNewHandlerRejectsAMissingStore comprueba que el servicio no se arma sin almacén.
func TestNewHandlerRejectsAMissingStore(t *testing.T) {
	if _, err := NewHandler(nil); err == nil {
		t.Fatal("se esperaba un error y no hubo ninguno")
	}
}

// buildDocumentWithIdentifiers arma un documento de perfil con una lista de N títulos inventados.
// En español: sirve para probar los topes de tamaño de las listas sin escribir 500 identificadores
// a mano en el archivo de pruebas.
func buildDocumentWithIdentifiers(t *testing.T, listName string, count int) string {
	t.Helper()

	identifiers := make([]string, count)
	for index := range identifiers {
		identifiers[index] = fmt.Sprintf("movie-%d", index)
	}

	encoded, err := json.Marshal(map[string][]string{listName: identifiers})
	if err != nil {
		t.Fatalf("no se pudo construir el documento de prueba: %v", err)
	}
	return string(encoded)
}

// extractProfileConflict saca del error el detalle con el documento del servidor.
func extractProfileConflict(t *testing.T, err error) *profilev1.ProfileConflict {
	t.Helper()

	var connectError *connect.Error
	if !errors.As(err, &connectError) {
		t.Fatalf("el error no es un error de Connect: %v", err)
	}
	for _, detail := range connectError.Details() {
		message, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}
		if conflict, ok := message.(*profilev1.ProfileConflict); ok {
			return conflict
		}
	}
	t.Fatal("el error de conflicto no traía adjunto el documento del servidor")
	return nil
}
