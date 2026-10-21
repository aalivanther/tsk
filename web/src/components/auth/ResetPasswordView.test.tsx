// Archivo: ResetPasswordView.test.tsx — Pruebas de la pantalla donde se pone la CONTRASEÑA NUEVA.
//
// En español: es el final del camino de "olvidé mi contraseña". Si esta pantalla falla, la persona se
// queda fuera de su cuenta sin ninguna otra vía. Se comprueban los cuatro caminos que puede tomar:
// llegar sin enlace válido, equivocarse al repetir la contraseña, que el servidor rechace el enlace y
// que todo salga bien (incluido el aviso de que se cerraron las demás sesiones).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authState } = vi.hoisted(() => ({
  authState: {
    // resetResult es lo que devuelve el servidor de mentira: null si fue bien, o el mensaje de error.
    resetResult: null as string | null,
    // calls guarda lo que recibió la operación, para comprobar que el token viaja tal cual.
    calls: [] as { token: string; password: string }[],
  },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    register: async () => null,
    login: async () => null,
    logout: async () => {},
    changePassword: async () => null,
    deleteAccount: async () => null,
    requestPasswordReset: async () => null,
    resetPassword: async (token: string, password: string) => {
      authState.calls.push({ token, password });
      return authState.resetResult;
    },
  }),
}));

const { ResetPasswordView } = await import("@/components/auth/ResetPasswordView");

// VALID_PASSWORD cumple el mínimo de ocho caracteres que exige el servidor.
const VALID_PASSWORD = "contrasena-larga";

describe("ResetPasswordView", () => {
  beforeEach(() => {
    authState.resetResult = null;
    authState.calls = [];
  });

  it("sin enlace explica de dónde sale el código y deja pegarlo a mano", async () => {
    render(<ResetPasswordView resetToken="" />);

    // Nada de pantalla muda: se explica qué hace falta y se ofrece el campo para escribirlo. Es el
    // caso REAL de la beta cerrada, donde quien administra entrega el código en mano y no un enlace.
    expect(screen.getByText(/si te llegó un enlace completo/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Código de restablecimiento")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /iniciar sesión/i })).toBeInTheDocument();
  });

  it("no llama al servidor si no se escribió ningún código", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordView resetToken="" />);

    await user.type(screen.getByLabelText("Contraseña nueva"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/escribe el código/i);
    expect(authState.calls).toHaveLength(0);
  });

  it("acepta un código pegado a mano y lo manda tal cual, sin espacios sobrantes", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordView resetToken="" />);

    // Un código copiado de un mensaje arrastra espacios; eso no debe estropear el único intento.
    await user.type(screen.getByLabelText("Código de restablecimiento"), "  codigo-a-mano  ");
    await user.type(screen.getByLabelText("Contraseña nueva"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(authState.calls).toEqual([{ token: "codigo-a-mano", password: VALID_PASSWORD }]);
  });

  it("no vuelve a pedir el código cuando ya venía en el enlace", () => {
    render(<ResetPasswordView resetToken="token-bueno" />);

    // Enseñar un campo ya relleno solo invita a estropearlo: si vino en el enlace, no se pide.
    expect(screen.queryByLabelText("Código de restablecimiento")).toBeNull();
  });

  it("avisa cuando las dos contraseñas no coinciden, sin llamar al servidor", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordView resetToken="token-bueno" />);

    await user.type(screen.getByLabelText("Contraseña nueva"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), "otra-cosa-distinta");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no coinciden/i);
    // El token es de un solo uso: gastarlo en un intento que ya sabemos que está mal sería quemarlo.
    expect(authState.calls).toHaveLength(0);
  });

  it("muestra el motivo cuando el servidor rechaza el enlace", async () => {
    const user = userEvent.setup();
    authState.resetResult = "Ese enlace de restablecimiento ya no sirve: caducó o ya se usó.";
    render(<ResetPasswordView resetToken="token-caducado" />);

    await user.type(screen.getByLabelText("Contraseña nueva"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/caducó o ya se usó/i);
  });

  it("al lograrlo avisa de que se cerraron TODAS las sesiones", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordView resetToken="token-bueno" />);

    await user.type(screen.getByLabelText("Contraseña nueva"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    // El token viaja tal cual llegó en la dirección.
    expect(authState.calls).toEqual([{ token: "token-bueno", password: VALID_PASSWORD }]);

    // Y el mensaje final explica el efecto que más sorprende: quedarse fuera en los demás
    // dispositivos. Enterarse de eso por las malas, después, sería desconcertante.
    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(/sesiones abiertas/i);
    expect(screen.getByRole("link", { name: /iniciar sesión/i })).toBeInTheDocument();
  });
});
