// Archivo: LoginView.test.tsx — Pruebas de la pantalla de ENTRAR / CREAR CUENTA.
//
// En español: es la puerta de entrada del producto. Aquí se comprueba lo que una persona haría con
// ella, sin red: que el campo del código de invitación existe al crear cuenta y que lo escrito llega
// a la llamada, que los errores del servidor se ven, y que desde aquí se puede recuperar el acceso.
//
// Se sustituye el contexto de sesión por uno de mentira: esta prueba es de la PANTALLA (qué muestra y
// qué manda), no de la comunicación con el servidor, que tiene sus propias pruebas en auth-context.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// El doble del contexto de sesión y el del enrutador se declaran con vi.hoisted porque Vitest sube
// las llamadas a vi.mock al principio del archivo, antes que cualquier const normal.
const { authState, routerState } = vi.hoisted(() => ({
  authState: {
    // registerResult / loginResult son lo que devuelven las operaciones: null si todo fue bien, o el
    // mensaje de error que la pantalla debe mostrar.
    registerResult: null as string | null,
    loginResult: null as string | null,
    requestResult: null as string | null,
    // Lo que recibió cada operación, para comprobar qué mandó la pantalla.
    registerCalls: [] as { email: string; password: string; displayName: string; invite: string }[],
    requestCalls: [] as string[],
  },
  routerState: {
    pushed: [] as string[],
  },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    register: async (email: string, password: string, displayName: string, invite: string) => {
      authState.registerCalls.push({ email, password, displayName, invite });
      return authState.registerResult;
    },
    login: async () => authState.loginResult,
    logout: async () => {},
    changePassword: async () => null,
    deleteAccount: async () => null,
    requestPasswordReset: async (email: string) => {
      authState.requestCalls.push(email);
      return authState.requestResult;
    },
    resetPassword: async () => null,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (destination: string) => {
      routerState.pushed.push(destination);
    },
  }),
}));

const { LoginView } = await import("@/components/auth/LoginView");

// VALID_PASSWORD cumple el mínimo de ocho caracteres que exige el producto.
const VALID_PASSWORD = "contrasena-larga";

// fillCredentials escribe correo y contraseña, que son los campos comunes a las dos pestañas.
async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Correo"), "ana@ejemplo.mx");
  await user.type(screen.getByLabelText("Contraseña"), VALID_PASSWORD);
}

describe("LoginView", () => {
  beforeEach(() => {
    authState.registerResult = null;
    authState.loginResult = null;
    authState.requestResult = null;
    authState.registerCalls = [];
    authState.requestCalls = [];
    routerState.pushed = [];
  });

  it("solo pide el CÓDIGO DE INVITACIÓN al crear cuenta, no al entrar", async () => {
    const user = userEvent.setup();
    render(<LoginView />);

    // En la pestaña de entrar no pinta nada: quien ya tiene cuenta no necesita invitación.
    expect(screen.queryByLabelText(/código de invitación/i)).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Crear cuenta" }));
    expect(screen.getByLabelText(/código de invitación/i)).toBeInTheDocument();
  });

  it("manda el código de invitación escrito al crear la cuenta", async () => {
    const user = userEvent.setup();
    render(<LoginView />);

    await user.click(screen.getByRole("tab", { name: "Crear cuenta" }));
    await fillCredentials(user);
    await user.type(screen.getByLabelText("Nombre"), "Ana");
    // Con espacios sobrantes a propósito: un código copiado de un mensaje los arrastra y eso no debe
    // tumbar un registro.
    await user.type(screen.getByLabelText(/código de invitación/i), "  TSK-ABCD-1234  ");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(authState.registerCalls).toHaveLength(1);
    expect(authState.registerCalls[0].invite).toBe("TSK-ABCD-1234");
    // Y al lograrlo se va al perfil.
    expect(routerState.pushed).toContain("/perfil");
  });

  it("permite crear cuenta SIN código cuando el servidor no lo exige", async () => {
    const user = userEvent.setup();
    render(<LoginView />);

    await user.click(screen.getByRole("tab", { name: "Crear cuenta" }));
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    // El campo no es obligatorio en la pantalla porque quien decide es el servidor: si esta
    // instalación no pide invitación, exigirla aquí dejaría fuera a gente que sí puede entrar.
    expect(authState.registerCalls).toHaveLength(1);
    expect(authState.registerCalls[0].invite).toBe("");
  });

  it("muestra el error del servidor cuando el código de invitación no sirve", async () => {
    const user = userEvent.setup();
    authState.registerResult = "Ese código de invitación no es válido o ya se usó.";
    render(<LoginView />);

    await user.click(screen.getByRole("tab", { name: "Crear cuenta" }));
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    // El aviso se anuncia como alerta: interrumpe la tarea y hay que enterarse sí o sí.
    expect(await screen.findByRole("alert")).toHaveTextContent(/código de invitación/i);
    // Y no se navega a ningún sitio: la cuenta no se creó.
    expect(routerState.pushed).toHaveLength(0);
  });

  it("recupera el acceso sin prometer que la cuenta existe", async () => {
    const user = userEvent.setup();
    render(<LoginView />);

    await user.click(screen.getByRole("button", { name: /olvidaste tu contraseña/i }));
    await user.type(screen.getByLabelText("Correo"), "quizas@ejemplo.mx");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(authState.requestCalls).toEqual(["quizas@ejemplo.mx"]);

    // El mensaje tiene que ser CONDICIONAL ("si ese correo tiene una cuenta…"). Afirmar que se envió
    // algo delataría qué correos están registrados, que es justo lo que el backend evita respondiendo
    // siempre lo mismo.
    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(/si ese correo tiene una cuenta/i);
    expect(confirmation.textContent ?? "").not.toMatch(/te enviamos un correo/i);
  });

  it("se sale de recuperar el acceso con la tecla Esc", async () => {
    const user = userEvent.setup();
    render(<LoginView />);

    await user.click(screen.getByRole("button", { name: /olvidaste tu contraseña/i }));
    expect(screen.queryByRole("tab", { name: "Crear cuenta" })).toBeNull();

    await user.keyboard("{Escape}");

    // Esc devuelve al formulario de entrada: la salida que todo el mundo intenta primero.
    expect(await screen.findByRole("tab", { name: "Crear cuenta" })).toBeInTheDocument();
  });
});
