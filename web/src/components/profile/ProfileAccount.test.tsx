// Archivo: ProfileAccount.test.tsx — Pruebas del bloque «Tu cuenta» dentro de «Mi perfil».
//
// En español: aquí viven los dos controles que el AVISO DE PRIVACIDAD promete y que hasta ahora no
// existían en la interfaz: cambiar la contraseña y borrar la cuenta (el derecho de cancelación de la
// ley mexicana). Que estos botones estén y funcionen no es un detalle de comodidad: es la diferencia
// entre cumplir el aviso publicado y no cumplirlo.
//
// Lo que se protege:
//   - Que sin sesión no se ofrezcan controles de cuenta (no habría cuenta que tocar) y sí el camino
//     para iniciar sesión.
//   - Que borrar la cuenta EXIJA contraseña y una confirmación escrita a mano; un clic despistado no
//     puede destruir una cuenta.
//   - Que se avise de lo que pasa después: al cambiar la contraseña se cierran todas las sesiones, y
//     tras borrar la cuenta la aplicación queda como anónima.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// authState es el doble del contexto de sesión. Se declara con vi.hoisted porque Vitest sube las
// llamadas a vi.mock por encima de cualquier const normal del archivo.
const { authState } = vi.hoisted(() => ({
  authState: {
    // signedIn decide si hay sesión abierta cuando se monta la pantalla.
    signedIn: true,
    // changeResult / deleteResult: null si la operación va bien, o el mensaje de error del servidor.
    changeResult: null as string | null,
    deleteResult: null as string | null,
    changeCalls: [] as { current: string; next: string }[],
    deleteCalls: [] as string[],
  },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: authState.signedIn
      ? { id: "user-1", email: "ana@ejemplo.mx", displayName: "Ana", createdAt: "2026-07-01" }
      : null,
    loading: false,
    register: async () => null,
    login: async () => null,
    logout: async () => {},
    changePassword: async (current: string, next: string) => {
      authState.changeCalls.push({ current, next });
      if (authState.changeResult === null) {
        // Al lograrlo, el servidor cierra TODAS las sesiones: la app queda anónima. El doble lo imita
        // porque de eso depende lo que la pantalla debe mostrar después.
        authState.signedIn = false;
      }
      return authState.changeResult;
    },
    deleteAccount: async (password: string) => {
      authState.deleteCalls.push(password);
      if (authState.deleteResult === null) {
        authState.signedIn = false;
      }
      return authState.deleteResult;
    },
    requestPasswordReset: async () => null,
    resetPassword: async () => null,
  }),
}));

const { ProfileView } = await import("@/components/profile/ProfileView");
const { ProfileProvider } = await import("@/lib/profile-context");

// VALID_PASSWORD cumple el mínimo de ocho caracteres que exige el servidor.
const VALID_PASSWORD = "contrasena-larga";

// renderProfile monta el perfil con un catálogo vacío: estas pruebas miran los AJUSTES, no las
// colecciones de estrenos, así que resolver títulos no aporta nada aquí.
function renderProfile() {
  return render(
    <ProfileProvider>
      <ProfileView catalog={[]} genres={[]} platforms={[]} />
    </ProfileProvider>,
  );
}

// openSettings entra en la pestaña de ajustes, que es donde vive el bloque de la cuenta.
async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Ajustes" }));
}

describe("ProfileView · bloque «Tu cuenta»", () => {
  beforeEach(() => {
    window.localStorage.clear();
    authState.signedIn = true;
    authState.changeResult = null;
    authState.deleteResult = null;
    authState.changeCalls = [];
    authState.deleteCalls = [];
  });

  it("sin sesión no ofrece controles de cuenta, sino el camino para entrar", async () => {
    const user = userEvent.setup();
    authState.signedIn = false;
    renderProfile();
    await openSettings(user);

    expect(screen.queryByRole("button", { name: "Cambiar contraseña" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Borrar mi cuenta" })).toBeNull();
    // El perfil local sigue siendo suyo, pero no hay ninguna cuenta que gestionar: se dice y se
    // ofrece la salida en vez de enseñar botones que fallarían.
    expect(screen.getByText(/navegando sin cuenta/i)).toBeInTheDocument();
  });

  it("cambia la contraseña y avisa de que se cerraron todas las sesiones", async () => {
    const user = userEvent.setup();
    renderProfile();
    await openSettings(user);

    await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
    await user.type(screen.getByLabelText("Contraseña actual"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Contraseña nueva"), "otra-contrasena");
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), "otra-contrasena");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(authState.changeCalls).toEqual([{ current: VALID_PASSWORD, next: "otra-contrasena" }]);

    // Tras el cambio la sesión ya no existe. La pantalla tiene que explicarlo: si desapareciera sin
    // más, la persona pensaría que algo se rompió justo cuando todo salió bien.
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/se cerraron todas las sesiones/i);
  });

  it("no cambia nada si la contraseña nueva se escribe distinta las dos veces", async () => {
    const user = userEvent.setup();
    renderProfile();
    await openSettings(user);

    await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
    await user.type(screen.getByLabelText("Contraseña actual"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Contraseña nueva"), "otra-contrasena");
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), "otra-contrasena-mal");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    // Sin esta comprobación, una errata dejaría a la persona fuera con una contraseña que ni ella
    // conoce, porque lo que teclea no se ve.
    expect(await screen.findByRole("alert")).toHaveTextContent(/no coinciden/i);
    expect(authState.changeCalls).toHaveLength(0);
  });

  it("EXIGE la palabra de confirmación antes de borrar la cuenta", async () => {
    const user = userEvent.setup();
    renderProfile();
    await openSettings(user);

    await user.click(screen.getByRole("button", { name: "Borrar mi cuenta" }));
    await user.type(screen.getByLabelText("Tu contraseña"), VALID_PASSWORD);
    await user.type(screen.getByLabelText(/escribe borrar para confirmar/i), "borrar");
    await user.click(screen.getByRole("button", { name: /borrar mi cuenta para siempre/i }));

    // "borrar" en minúsculas no vale: la palabra tiene que escribirse exactamente. Es una acción
    // irreversible y el trámite está pensado para obligar a detenerse.
    expect(screen.getByRole("alert")).toHaveTextContent(/escribe exactamente BORRAR/i);
    expect(authState.deleteCalls).toHaveLength(0);
  });

  it("borra la cuenta con contraseña y confirmación, y deja la app como anónima", async () => {
    const user = userEvent.setup();
    renderProfile();
    await openSettings(user);

    // Antes de desplegar nada, las consecuencias ya están escritas en pantalla.
    expect(screen.getByText(/IRREVERSIBLE/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Borrar mi cuenta" }));
    await user.type(screen.getByLabelText("Tu contraseña"), VALID_PASSWORD);
    await user.type(screen.getByLabelText(/escribe borrar para confirmar/i), "BORRAR");
    await user.click(screen.getByRole("button", { name: /borrar mi cuenta para siempre/i }));

    expect(authState.deleteCalls).toEqual([VALID_PASSWORD]);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/se borró para siempre/i);
    // Y ya no queda ningún control de cuenta, porque ya no hay cuenta.
    expect(screen.queryByRole("button", { name: "Cambiar contraseña" })).toBeNull();
  });

  it("cierra el formulario de borrado con la tecla Esc", async () => {
    const user = userEvent.setup();
    renderProfile();
    await openSettings(user);

    await user.click(screen.getByRole("button", { name: "Borrar mi cuenta" }));
    expect(screen.getByLabelText("Tu contraseña")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    // Esc es la salida de emergencia de cualquier cosa que se abra en el producto.
    expect(screen.queryByLabelText("Tu contraseña")).toBeNull();
  });
});
