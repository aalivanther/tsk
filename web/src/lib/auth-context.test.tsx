// Archivo: auth-context.test.tsx — Pruebas de la SESIÓN de usuario (registro, entrada, cuenta).
//
// En español: este archivo es el que habla con el backend en nombre de toda la aplicación, así que
// un fallo aquí no rompe una pantalla: rompe el acceso a las cuentas. Se prueba sin red, sustituyendo
// el "cable" que lleva las llamadas al servidor por uno de mentira que registra lo que se le pidió y
// responde lo que la prueba decida. Así se puede comprobar, con exactitud y sin depender de nada
// externo, QUÉ se manda y CÓMO se traduce lo que vuelve.
//
// Lo que se protege:
//   - Que el CÓDIGO DE INVITACIÓN de la beta cerrada viaje de verdad en el registro. Si no viaja, con
//     el servidor exigiéndolo NINGUNA cuenta se puede crear, y el fallo se ve como un error genérico.
//   - Que un "permiso denegado" se explique según lo que se estaba haciendo: en el registro habla del
//     código de invitación; al restablecer, del enlace caducado. El mismo código con dos significados.
//   - Que cambiar la contraseña y borrar la cuenta dejen la aplicación como anónima, porque el
//     servidor cierra las sesiones en ambos casos.
//   - Que pedir un restablecimiento NO se considere un fallo cuando la cuenta no existe (el servidor
//     responde igual a propósito, para no delatar qué correos están registrados).

import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Code, ConnectError, type Transport } from "@connectrpc/connect";

// El transporte real se sustituye por el de mentira ANTES de importar el contexto, que es quien lo
// pide al crearse. La fábrica se declara con vi.hoisted porque Vitest sube las llamadas a vi.mock al
// principio del archivo, antes que cualquier const normal.
// FakeUnaryHandler es la firma de la respuesta del servidor de mentira: recibe el nombre del método y
// lo que se le mandó, y devuelve el contenido de la respuesta (o lanza un error para simular un fallo).
type FakeUnaryHandler = (
  methodName: string,
  input: Record<string, unknown>,
) => Record<string, unknown>;

const { transportState } = vi.hoisted(() => ({
  transportState: {
    // handler decide qué responde el servidor de mentira. Cada prueba lo cambia a su gusto; el de
    // partida responde vacío y sin error, que es lo que hacen las llamadas que no devuelven datos.
    handler: ((): Record<string, unknown> => ({})) as FakeUnaryHandler,
    // calls guarda todas las llamadas hechas, para poder comprobar qué se mandó exactamente.
    calls: [] as { methodName: string; input: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/connect/browser-transport", () => ({
  createBrowserTransport: (): Transport =>
    // Un transporte de Connect es un objeto con dos operaciones (llamada simple y flujo). Aquí se
    // implementa la simple, que es la única que usa el servicio de cuentas, y se declara la de flujo
    // para cumplir la forma. El "as unknown as Transport" es la manera de decirle a TypeScript que
    // este doble encaja donde iba el de verdad sin arrastrar toda su maquinaria de tipos genéricos:
    // es código de prueba y su único usuario es el cliente que se está probando.
    ({
      unary: async (
        method: { name: string },
        _signal: unknown,
        _timeoutMs: unknown,
        _header: unknown,
        input: Record<string, unknown>,
      ) => {
        transportState.calls.push({ methodName: method.name, input });
        // Si el handler lanza, el error sale tal cual hacia el cliente, igual que un fallo real.
        const message = transportState.handler(method.name, input);
        return {
          stream: false,
          service: {},
          method,
          header: new Headers(),
          message,
          trailer: new Headers(),
        };
      },
      stream: async () => {
        throw new Error("AuthService does not use streaming");
      },
    }) as unknown as Transport,
}));

const { AuthProvider, useAuth } = await import("@/lib/auth-context");

// SAMPLE_USER es la cuenta que devuelve el servidor de mentira cuando una llamada sale bien.
const SAMPLE_USER = {
  id: "user-1",
  email: "ana@ejemplo.mx",
  displayName: "Ana",
  createdAt: "2026-07-28T00:00:00Z",
};

// VALID_PASSWORD cumple el mínimo que exige el servidor (ocho caracteres).
const VALID_PASSWORD = "contrasena-larga";

// AuthProbe expone la sesión en pantalla y ofrece un botón por operación.
// En español: en vez de espiar el estado por dentro, la prueba pulsa botones y lee lo que aparece,
// que es exactamente lo que hace una persona usando la aplicación.
function AuthProbe() {
  const {
    user,
    register,
    login,
    changePassword,
    deleteAccount,
    requestPasswordReset,
    resetPassword,
  } = useAuth();
  // result guarda lo que devolvió la última operación: "ok" si fue bien, o el mensaje de error.
  const [result, setResult] = useState("sin-llamada");

  // report ejecuta una operación y deja su resultado a la vista.
  const report = async (operation: Promise<string | null>) => {
    const failure = await operation;
    setResult(failure ?? "ok");
  };

  return (
    <>
      <span data-testid="usuario">{user === null ? "anonimo" : user.email}</span>
      <span data-testid="resultado">{result}</span>
      <button
        type="button"
        onClick={() => report(register("ana@ejemplo.mx", VALID_PASSWORD, "Ana", "TSK-ABCD-1234"))}
      >
        registrar
      </button>
      <button type="button" onClick={() => report(login("ana@ejemplo.mx", VALID_PASSWORD))}>
        entrar
      </button>
      <button
        type="button"
        onClick={() => report(changePassword(VALID_PASSWORD, "otra-contrasena"))}
      >
        cambiar-contrasena
      </button>
      <button type="button" onClick={() => report(deleteAccount(VALID_PASSWORD))}>
        borrar-cuenta
      </button>
      <button type="button" onClick={() => report(requestPasswordReset("nadie@ejemplo.mx"))}>
        pedir-restablecimiento
      </button>
      <button type="button" onClick={() => report(resetPassword("token-malo", "otra-contrasena"))}>
        restablecer
      </button>
    </>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  );
}

describe("auth-context", () => {
  beforeEach(() => {
    window.localStorage.clear();
    transportState.calls = [];
    transportState.handler = () => ({});
  });

  it("manda el CÓDIGO DE INVITACIÓN al registrar una cuenta", async () => {
    const user = userEvent.setup();
    transportState.handler = () => ({ user: SAMPLE_USER });
    renderProbe();

    await user.click(screen.getByRole("button", { name: "registrar" }));

    // La llamada de registro tiene que llevar el código tal y como lo escribió la persona. Sin este
    // campo, una instalación con invitación obligatoria rechaza absolutamente todos los registros.
    const registerCall = transportState.calls.find((call) => call.methodName === "Register");
    expect(registerCall?.input.inviteCode).toBe("TSK-ABCD-1234");
    // Y la sesión queda abierta con la cuenta que devolvió el servidor.
    expect(await screen.findByTestId("usuario")).toHaveTextContent("ana@ejemplo.mx");
  });

  it("explica un permiso denegado del REGISTRO como problema del código de invitación", async () => {
    const user = userEvent.setup();
    transportState.handler = () => {
      throw new ConnectError("invite not usable", Code.PermissionDenied);
    };
    renderProbe();

    await user.click(screen.getByRole("button", { name: "registrar" }));

    // El mensaje debe hablar del código de invitación y decir qué hacer, no soltar un "algo salió
    // mal" que deja a la persona sin saber si el problema es suyo, del código o del servidor.
    const message = (await screen.findByTestId("resultado")).textContent ?? "";
    expect(message).toMatch(/código de invitación/i);
    expect(message).toMatch(/beta cerrada/i);
    // Y la sesión sigue sin abrirse.
    expect(screen.getByTestId("usuario")).toHaveTextContent("anonimo");
  });

  it("explica un permiso denegado del RESTABLECIMIENTO como enlace caducado o ya usado", async () => {
    const user = userEvent.setup();
    transportState.handler = () => {
      throw new ConnectError("reset token not usable", Code.PermissionDenied);
    };
    renderProbe();

    await user.click(screen.getByRole("button", { name: "restablecer" }));

    // Mismo código de error que arriba, significado distinto: aquí no hay ningún código de
    // invitación de por medio y mencionarlo confundiría.
    const message = (await screen.findByTestId("resultado")).textContent ?? "";
    expect(message).toMatch(/enlace de restablecimiento/i);
    expect(message).not.toMatch(/invitación/i);
  });

  it("deja la app como ANÓNIMA tras cambiar la contraseña", async () => {
    const user = userEvent.setup();
    transportState.handler = (methodName) => (methodName === "Login" ? { user: SAMPLE_USER } : {});
    renderProbe();

    await user.click(screen.getByRole("button", { name: "entrar" }));
    expect(await screen.findByTestId("usuario")).toHaveTextContent("ana@ejemplo.mx");

    await user.click(screen.getByRole("button", { name: "cambiar-contrasena" }));

    // El servidor cierra TODAS las sesiones al cambiar la contraseña, incluida esta. Si la interfaz
    // siguiera mostrando a la persona dentro, su siguiente acción fallaría sin explicación.
    expect(await screen.findByTestId("resultado")).toHaveTextContent("ok");
    expect(screen.getByTestId("usuario")).toHaveTextContent("anonimo");
  });

  it("deja la app como ANÓNIMA tras borrar la cuenta", async () => {
    const user = userEvent.setup();
    transportState.handler = (methodName) => (methodName === "Login" ? { user: SAMPLE_USER } : {});
    renderProbe();

    await user.click(screen.getByRole("button", { name: "entrar" }));
    expect(await screen.findByTestId("usuario")).toHaveTextContent("ana@ejemplo.mx");

    await user.click(screen.getByRole("button", { name: "borrar-cuenta" }));

    expect(await screen.findByTestId("resultado")).toHaveTextContent("ok");
    expect(screen.getByTestId("usuario")).toHaveTextContent("anonimo");
  });

  it("da por BUENA la petición de restablecimiento aunque la cuenta no exista", async () => {
    const user = userEvent.setup();
    // El servidor responde exactamente igual exista o no la cuenta: una respuesta vacía sin error.
    transportState.handler = () => ({});
    renderProbe();

    await user.click(screen.getByRole("button", { name: "pedir-restablecimiento" }));

    // Que esto se tratara como un error convertiría la pantalla en un detector de correos
    // registrados, que es justo lo que el diseño del backend evita.
    expect(await screen.findByTestId("resultado")).toHaveTextContent("ok");
  });
});
