// Archivo: invites_test.go — Pruebas de los códigos de invitación de la alpha cerrada.
//
// En español: lo que aquí se comprueba es la propiedad más importante de una invitación: que sirva
// UNA sola vez, incluso cuando dos personas intentan canjearla exactamente en el mismo instante.
package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestInviteCodeHasTheExpectedShape comprueba el formato del código generado.
//
// En español: el código está pensado para dictarse por mensaje, así que su forma importa: prefijo
// reconocible, dos grupos de cuatro y ninguna letra de las que se confunden al teclear (I, L, O, U).
func TestInviteCodeHasTheExpectedShape(t *testing.T) {
	persistentStore, _ := newTestStore(t)

	invite, err := persistentStore.CreateInvite(context.Background(), "para Ana", DefaultInviteTTL)
	if err != nil {
		t.Fatalf("CreateInvite devolvió error: %v", err)
	}

	parts := strings.Split(invite.Code, "-")
	if len(parts) != 3 {
		t.Fatalf("el código debería tener tres partes separadas por guiones, es %q", invite.Code)
	}
	if parts[0] != inviteCodePrefix {
		t.Fatalf("el prefijo debería ser %q y es %q", inviteCodePrefix, parts[0])
	}
	for index, group := range parts[1:] {
		if len(group) != inviteCodeGroupLength {
			t.Fatalf("el grupo %d debería tener %d caracteres y tiene %q", index, inviteCodeGroupLength, group)
		}
		for _, character := range group {
			if !strings.ContainsRune(inviteCodeAlphabet, character) {
				t.Fatalf("el código contiene el carácter ambiguo %q: %s", character, invite.Code)
			}
		}
	}
}

// TestInviteIsConsumedExactlyOnce comprueba que un código solo sirve para una cuenta.
func TestInviteIsConsumedExactlyOnce(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	invite, err := persistentStore.CreateInvite(ctx, "para Ana", DefaultInviteTTL)
	if err != nil {
		t.Fatalf("CreateInvite devolvió error: %v", err)
	}

	// Primer registro: entra.
	firstUser, err := persistentStore.CreateUser(ctx, NewUser{
		ID:           "id-primera",
		Email:        "primera@example.com",
		DisplayName:  "Primera",
		PasswordHash: "hash",
		InviteCode:   invite.Code,
	})
	if err != nil {
		t.Fatalf("el primer registro debería haber funcionado: %v", err)
	}

	// Segundo registro con el mismo código: rechazado.
	_, err = persistentStore.CreateUser(ctx, NewUser{
		ID:           "id-segunda",
		Email:        "segunda@example.com",
		DisplayName:  "Segunda",
		PasswordHash: "hash",
		InviteCode:   invite.Code,
	})
	if !errors.Is(err, ErrInviteNotUsable) {
		t.Fatalf("se esperaba ErrInviteNotUsable en el segundo registro y se obtuvo %v", err)
	}

	// Y la cuenta rechazada NO se creó: el canje y el alta van juntos o no van.
	if _, err := persistentStore.FindUserByEmail(ctx, "segunda@example.com"); !errors.Is(err, ErrUserNotFound) {
		t.Fatal("el registro rechazado no debía dejar la cuenta creada")
	}

	// El canje quedó atado a la cuenta correcta.
	usedBy, err := persistentStore.inviteUsedBy(ctx, invite.Code)
	if err != nil {
		t.Fatalf("no se pudo consultar quién canjeó la invitación: %v", err)
	}
	if usedBy != firstUser.ID {
		t.Fatalf("la invitación debería figurar canjeada por %q y figura por %q", firstUser.ID, usedBy)
	}
}

// TestConcurrentRegistrationsWithTheSameInviteLeaveOneWinner es la prueba de la CARRERA.
//
// En español: es el escenario que un archivo de texto no podía resolver. Ocho registros salen a la
// vez con el mismo código de invitación; la respuesta correcta es que exactamente UNO entre y los
// otros siete sean rechazados. Lo que lo garantiza es que el canje del código y la creación de la
// cuenta ocurren dentro de la misma operación indivisible de la base de datos.
func TestConcurrentRegistrationsWithTheSameInviteLeaveOneWinner(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	invite, err := persistentStore.CreateInvite(ctx, "código en disputa", DefaultInviteTTL)
	if err != nil {
		t.Fatalf("CreateInvite devolvió error: %v", err)
	}

	const contenders = 8

	// startLine hace que las ocho tareas arranquen a la vez y no una detrás de otra: si empezaran
	// escalonadas, la prueba pasaría sin haber probado nada.
	startLine := make(chan struct{})
	var waitGroup sync.WaitGroup
	results := make([]error, contenders)

	for index := range contenders {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-startLine
			_, err := persistentStore.CreateUser(ctx, NewUser{
				ID:           fmt.Sprintf("id-%d", index),
				Email:        fmt.Sprintf("aspirante%d@example.com", index),
				DisplayName:  fmt.Sprintf("Aspirante %d", index),
				PasswordHash: "hash",
				InviteCode:   invite.Code,
			})
			results[index] = err
		}()
	}

	close(startLine)
	waitGroup.Wait()

	winners := 0
	for index, err := range results {
		switch {
		case err == nil:
			winners++
		case errors.Is(err, ErrInviteNotUsable):
			// Rechazo esperado.
		default:
			t.Fatalf("el aspirante %d falló por un motivo inesperado: %v", index, err)
		}
	}

	if winners != 1 {
		t.Fatalf("exactamente un registro debía tener éxito y tuvieron éxito %d", winners)
	}

	// Y en la base hay exactamente una cuenta: los rechazados no dejaron rastro.
	accounts, err := persistentStore.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers devolvió error: %v", err)
	}
	if len(accounts) != 1 {
		t.Fatalf("debería haber exactamente 1 cuenta creada y hay %d", len(accounts))
	}
}

// TestInviteRejectionCases recorre todas las formas en que un código NO sirve.
func TestInviteRejectionCases(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name string
		// prepare devuelve el código que se va a intentar canjear, tras dejar el almacén en el
		// estado que la prueba necesita.
		prepare func(t *testing.T, persistentStore *Store, clock *testClock) string
	}{
		{
			name: "código que nunca existió",
			prepare: func(_ *testing.T, _ *Store, _ *testClock) string {
				return "TSK-9999-9999"
			},
		},
		{
			name: "texto que ni siquiera tiene forma de código",
			prepare: func(_ *testing.T, _ *Store, _ *testClock) string {
				return "esto-no-es-un-codigo"
			},
		},
		{
			name: "código con letras ambiguas que el alfabeto no usa",
			prepare: func(_ *testing.T, _ *Store, _ *testClock) string {
				return "TSK-IIII-LLLL"
			},
		},
		{
			name: "código caducado",
			prepare: func(t *testing.T, persistentStore *Store, clock *testClock) string {
				t.Helper()
				invite, err := persistentStore.CreateInvite(ctx, "caduca pronto", time.Hour)
				if err != nil {
					t.Fatalf("CreateInvite devolvió error: %v", err)
				}
				clock.Advance(2 * time.Hour)
				return invite.Code
			},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			persistentStore, clock := newTestStore(t)
			code := testCase.prepare(t, persistentStore, clock)

			_, err := persistentStore.CreateUser(ctx, NewUser{
				ID:           "id-aspirante",
				Email:        "aspirante@example.com",
				DisplayName:  "Aspirante",
				PasswordHash: "hash",
				InviteCode:   code,
			})
			if !errors.Is(err, ErrInviteNotUsable) {
				t.Fatalf("se esperaba ErrInviteNotUsable y se obtuvo %v", err)
			}
		})
	}
}

// TestInviteCodeIsAcceptedHoweverItWasCopied comprueba la tolerancia al copiar y pegar.
//
// En español: la gente escribe los códigos en minúsculas, con espacios de más o sin los guiones.
// Todas esas formas tienen que valer, porque son el mismo código; lo contrario generaría un montón
// de "no me funciona" que en realidad son erratas de formato.
func TestInviteCodeIsAcceptedHoweverItWasCopied(t *testing.T) {
	ctx := context.Background()

	variants := []struct {
		name      string
		transform func(code string) string
	}{
		{name: "tal cual", transform: func(code string) string { return code }},
		{name: "en minúsculas", transform: strings.ToLower},
		{name: "sin guiones", transform: func(code string) string { return strings.ReplaceAll(code, "-", "") }},
		{name: "con espacios alrededor", transform: func(code string) string { return "  " + code + "  " }},
		{name: "con un espacio en medio", transform: func(code string) string { return strings.Replace(code, "-", " ", 1) }},
	}

	for _, variant := range variants {
		t.Run(variant.name, func(t *testing.T) {
			persistentStore, _ := newTestStore(t)

			invite, err := persistentStore.CreateInvite(ctx, "variantes", DefaultInviteTTL)
			if err != nil {
				t.Fatalf("CreateInvite devolvió error: %v", err)
			}

			if _, err := persistentStore.CreateUser(ctx, NewUser{
				ID:           "id-aspirante",
				Email:        "aspirante@example.com",
				DisplayName:  "Aspirante",
				PasswordHash: "hash",
				InviteCode:   variant.transform(invite.Code),
			}); err != nil {
				t.Fatalf("el código escrito como %q debería valer: %v", variant.name, err)
			}
		})
	}
}

// TestInviteCodeIsNotStoredInClear comprueba que en la base solo queda la huella del código.
func TestInviteCodeIsNotStoredInClear(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	invite, err := persistentStore.CreateInvite(ctx, "secreto", DefaultInviteTTL)
	if err != nil {
		t.Fatalf("CreateInvite devolvió error: %v", err)
	}

	var rowsWithTheCodeInClear int
	if err := persistentStore.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM invites WHERE code_hash = ? OR code_hash = ?`,
		invite.Code,
		canonicalInviteCode(invite.Code),
	).Scan(&rowsWithTheCodeInClear); err != nil {
		t.Fatalf("no se pudo consultar la tabla de invitaciones: %v", err)
	}
	if rowsWithTheCodeInClear != 0 {
		t.Fatal("el código de invitación está guardado en claro en la base de datos")
	}
}

// TestRegistrationWithoutInviteCodeSkipsTheInviteTable comprueba que, cuando no se exige invitación,
// el alta funciona sin tocar esa tabla.
// En español: es el escenario del día en que la beta se abra al público (REQUIRE_INVITE=false).
func TestRegistrationWithoutInviteCodeSkipsTheInviteTable(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	if _, err := persistentStore.CreateUser(ctx, NewUser{
		ID:           "id-libre",
		Email:        "libre@example.com",
		DisplayName:  "Sin invitación",
		PasswordHash: "hash",
	}); err != nil {
		t.Fatalf("el alta sin invitación debería funcionar: %v", err)
	}
}
