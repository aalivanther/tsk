// Archivo: BottomNav.test.tsx — Pruebas de la barra de navegación inferior de móvil.
//
// En español: en un teléfono, esta barra ES la navegación del producto — no hay otra. Y dentro de ella
// vive la hoja de avisos, que se declara a sí misma como un diálogo modal. Esa declaración es una
// promesa hacia quien navega con teclado o lector de pantalla ("mientras esto esté abierto, el fondo
// no existe") y durante un tiempo fue una promesa falsa: la hoja no atrapaba el foco, así que el
// tabulador se escapaba a los enlaces de detrás, que ya no se ven porque el velo los tapa.
//
// Estas pruebas fijan lo que la barra debe cumplir:
//   - Los tres destinos existen y el actual se marca de forma accesible (no solo con color).
//   - Los avisos sin leer se cuentan, y abrir la hoja los da por vistos.
//   - La hoja de avisos atrapa el foco, Escape la cierra y el foco vuelve al botón que la abrió.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BottomNav } from "@/components/BottomNav";
import { AuthProvider } from "@/lib/auth-context";
import { ProfileProvider } from "@/lib/profile-context";
import { ui } from "@/lib/i18n";
import { type TodayMarker } from "@/lib/timeline";
import { Category, TitleType, type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// pathnameMock decide qué ruta cree la barra que está activa (la barra la consulta con usePathname).
const pathnameMock = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ push: vi.fn() }),
}));

// PROFILE_STORAGE_KEY es la llave donde vive el perfil sin sesión iniciada. Sembrarla antes de montar
// es la forma de darle a la barra una watchlist con la que generar avisos de verdad.
const PROFILE_STORAGE_KEY = "tsk-profile-v2";

// today de referencia: 15 de agosto de 2026 (el mismo que usan las demás pruebas de esta zona).
const today: TodayMarker = { year: 2026, month: 8, day: 15, label: "HOY · 15 AGO" };

// makeRelease arma un estreno de prueba con lo mínimo que necesitan los avisos.
function makeRelease(id: string, title: string, releaseDate: string): ReleaseSummary {
  return {
    id,
    title,
    releaseDate,
    type: TitleType.MOVIE,
    category: Category.CINE,
    genres: [],
    availability: { platforms: [], networks: [] },
  } as unknown as ReleaseSummary;
}

// CATALOG contiene dos títulos que estrenan dentro de la ventana de avisos, para que la hoja tenga
// contenido real (una hoja vacía no permitiría probar la trampa de foco sobre enlaces).
const CATALOG: ReleaseSummary[] = [
  makeRelease("r1", "Duna: Parte Tres", "2026-08-20"),
  makeRelease("r2", "Crónica del Fin", "2026-08-22"),
];

// renderNav monta la barra con los contextos que necesita, opcionalmente con títulos seguidos.
function renderNav({ watchlist = [] as string[] } = {}) {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ watchlist }));
  return render(
    <AuthProvider>
      <ProfileProvider>
        <BottomNav catalog={CATALOG} today={today} />
      </ProfileProvider>
    </AuthProvider>,
  );
}

// openAlerts pulsa el destino "Avisos" y devuelve el botón, para poder comprobar después dónde
// terminó el foco.
async function openAlerts(user: ReturnType<typeof userEvent.setup>) {
  const alertsButton = screen.getByRole("button", { name: new RegExp(ui.nav.alerts, "i") });
  await user.click(alertsButton);
  return alertsButton;
}

beforeEach(() => {
  window.localStorage.clear();
  pathnameMock.mockReturnValue("/");
});

describe("BottomNav · la navegación de móvil", () => {
  it("ofrece los tres destinos del producto", () => {
    renderNav();

    expect(screen.getByRole("navigation", { name: ui.nav.mobileLabel })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: new RegExp(ui.nav.timeline, "i") }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(ui.nav.profile, "i") })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(ui.nav.alerts, "i") }),
    ).toBeInTheDocument();
  });

  it("marca el destino actual de forma accesible, no solo con color", () => {
    pathnameMock.mockReturnValue("/perfil");
    renderNav();

    // aria-current="page" es lo que un lector de pantalla anuncia como "página actual". Sin él, quien
    // no ve el resalte de color no tiene forma de saber dónde está.
    const profileLink = screen.getByRole("link", { name: new RegExp(ui.nav.profile, "i") });
    expect(profileLink).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: new RegExp(ui.nav.timeline, "i") }),
    ).not.toHaveAttribute("aria-current");
  });

  it("cuenta los avisos sin leer de los títulos que se siguen", async () => {
    renderNav({ watchlist: ["r1", "r2"] });

    // El conteo se comunica por TEXTO accesible además de por el globito de color (que es decorativo).
    await waitFor(() => {
      expect(screen.getByText(ui.notifications.bellAria(2))).toBeInTheDocument();
    });
  });

  it("abrir la hoja da los avisos por vistos (deja de contarlos como sin leer)", async () => {
    const user = userEvent.setup();
    renderNav({ watchlist: ["r1", "r2"] });
    await waitFor(() => {
      expect(screen.getByText(ui.notifications.bellAria(2))).toBeInTheDocument();
    });

    await openAlerts(user);

    // Ya se leyeron: el contador baja a cero. Si no bajara, el globito quedaría encendido para siempre.
    await waitFor(() => {
      expect(screen.getByText(ui.notifications.bellAria(0))).toBeInTheDocument();
    });
  });

  it("la hoja de avisos se anuncia como diálogo modal y recibe el foco al abrirse", async () => {
    const user = userEvent.setup();
    renderNav({ watchlist: ["r1", "r2"] });

    await openAlerts(user);

    const sheet = await screen.findByRole("dialog", { name: ui.notifications.panelTitle });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    // El foco entra en la hoja: si se quedara detrás, el lector de pantalla seguiría leyendo el fondo
    // que el velo acaba de tapar, y la persona operaría a ciegas una pantalla que cree cerrada.
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it("el tabulador NO se escapa de la hoja al fondo", async () => {
    const user = userEvent.setup();
    renderNav({ watchlist: ["r1", "r2"] });
    await openAlerts(user);
    const sheet = await screen.findByRole("dialog", { name: ui.notifications.panelTitle });

    // Se recorre la hoja entera y una vuelta más: en ningún momento el foco debe salir de ella hacia
    // los destinos de la barra, que están detrás del velo.
    for (let step = 0; step < 5; step += 1) {
      await user.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
  });

  it("Escape cierra la hoja y devuelve el foco al botón que la abrió", async () => {
    const user = userEvent.setup();
    renderNav({ watchlist: ["r1", "r2"] });
    const alertsButton = await openAlerts(user);
    await screen.findByRole("dialog", { name: ui.notifications.panelTitle });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // El foco vuelve a donde estaba: nunca debe quedarse "en el aire" cuando desaparece lo que lo
    // contenía, porque entonces el siguiente Tab arranca desde el principio de la página.
    expect(alertsButton).toHaveFocus();
  });

  it("sin avisos, la hoja lo explica en vez de quedarse en blanco", async () => {
    const user = userEvent.setup();
    renderNav({ watchlist: [] });

    await openAlerts(user);

    const sheet = await screen.findByRole("dialog", { name: ui.notifications.panelTitle });
    expect(sheet).toHaveTextContent(ui.notifications.empty);
    // Y aun sin ningún elemento operable dentro, el foco tiene que estar en la hoja (es el respaldo
    // tabIndex={-1}); si no, el tabulador saldría al fondo en la primera pulsación.
    expect(sheet).toHaveFocus();
  });

  it("cada aviso enlaza a la ficha de su título", async () => {
    const user = userEvent.setup();
    renderNav({ watchlist: ["r1"] });

    await openAlerts(user);

    const link = await screen.findByRole("link", { name: /Duna: Parte Tres/ });
    expect(link).toHaveAttribute("href", "/titulo/r1");
  });
});
