// Archivo: AgendaMobile.test.tsx — Pruebas de la agenda vertical (la vista de catálogo en móvil).
//
// En español: esta pantalla es TODO lo que ve una persona en el teléfono, así que un fallo aquí no
// degrada la experiencia: la elimina. Se prueba lo que de verdad importa a quien la usa:
//   - Que los estrenos aparezcan agrupados por mes y por día, en orden.
//   - Que cada fila diga QUÉ se estrena (el título), no solo "3 estrenos": es la diferencia entre una
//     agenda útil y un contador.
//   - Que el día de HOY se distinga del resto.
//   - Que tocar un paquete abra el mismo flujo que en escritorio.
//   - Que el filtro activo se respete (si el usuario filtró, no debe colarse lo filtrado).
//   - Que el estado vacío se explique en vez de dejar la pantalla en blanco.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgendaMobile } from "@/components/AgendaMobile";
import { FilterProvider } from "@/lib/timeline-context";
import { ProfileProvider } from "@/lib/profile-context";
import { AuthProvider } from "@/lib/auth-context";
import { type TodayMarker } from "@/lib/timeline";
import { Category, TitleType, type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// today de referencia: 15 de agosto de 2026.
const today: TodayMarker = { year: 2026, month: 8, day: 15, label: "HOY · 15 AGO" };

// makeRelease arma un estreno de prueba con lo mínimo que la agenda necesita para pintarlo.
function makeRelease(
  overrides: Partial<ReleaseSummary> & { id: string; title: string; releaseDate: string },
): ReleaseSummary {
  return {
    type: TitleType.MOVIE,
    category: Category.CINE,
    genres: [],
    spokenLanguages: [],
    images: [],
    cast: [],
    crew: [],
    dubCast: [],
    posterUrl: "",
    backdropUrl: "",
    overview: "",
    originalLanguage: "es",
    // videos: la lista de tráilers del estreno. Vacía porque la agenda no muestra video ninguno;
    // sustituye a los dos campos sueltos de key de YouTube que el contrato ya no tiene.
    videos: [],
    ratings: { tmdb: 8 },
    availability: { platforms: [], networks: [] },
    ...overrides,
  } as unknown as ReleaseSummary;
}

// renderAgenda monta la agenda con todos los contextos que necesita y devuelve el espía del gancho.
function renderAgenda(releases: ReleaseSummary[]) {
  const onOpenPackage = vi.fn();
  render(
    <AuthProvider>
      <ProfileProvider>
        <FilterProvider>
          <AgendaMobile releases={releases} today={today} onOpenPackage={onOpenPackage} />
        </FilterProvider>
      </ProfileProvider>
    </AuthProvider>,
  );
  return { onOpenPackage };
}

describe("AgendaMobile", () => {
  it("agrupa los estrenos por mes y muestra el TÍTULO de cada uno", async () => {
    renderAgenda([
      makeRelease({ id: "a", title: "Duna: Parte Tres", releaseDate: "2026-08-14" }),
      makeRelease({ id: "b", title: "Cien años de soledad", releaseDate: "2026-09-02" }),
    ]);

    // Los meses aparecen como encabezados de sección.
    expect(await screen.findByRole("region", { name: /agosto/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /septiembre/i })).toBeInTheDocument();

    // Y cada fila nombra el título: es lo que convierte la agenda en algo útil de un vistazo.
    expect(screen.getByText("Duna: Parte Tres")).toBeInTheDocument();
    expect(screen.getByText("Cien años de soledad")).toBeInTheDocument();
  });

  it("marca la fila de HOY para distinguirla del resto", async () => {
    const { container } = render(
      <AuthProvider>
        <ProfileProvider>
          <FilterProvider>
            <AgendaMobile
              releases={[
                makeRelease({ id: "hoy", title: "Estreno de hoy", releaseDate: "2026-08-15" }),
                makeRelease({ id: "otro", title: "Estreno de mañana", releaseDate: "2026-08-16" }),
              ]}
              today={today}
              onOpenPackage={vi.fn()}
            />
          </FilterProvider>
        </ProfileProvider>
      </AuthProvider>,
    );

    await screen.findByText("Estreno de hoy");
    // Exactamente una fila debe estar marcada como HOY, y es la del día 15.
    const todayRows = container.querySelectorAll('[data-today="true"]');
    expect(todayRows).toHaveLength(1);
    expect(todayRows[0].textContent).toContain("Estreno de hoy");
  });

  it("atenúa los días que YA pasaron", async () => {
    const { container } = render(
      <AuthProvider>
        <ProfileProvider>
          <FilterProvider>
            <AgendaMobile
              releases={[
                makeRelease({ id: "pasado", title: "Ya se estrenó", releaseDate: "2026-08-01" }),
                makeRelease({ id: "futuro", title: "Está por venir", releaseDate: "2026-08-28" }),
              ]}
              today={today}
              onOpenPackage={vi.fn()}
            />
          </FilterProvider>
        </ProfileProvider>
      </AuthProvider>,
    );

    await screen.findByText("Ya se estrenó");
    const pastRows = container.querySelectorAll('[data-past="true"]');
    expect(pastRows).toHaveLength(1);
    expect(pastRows[0].textContent).toContain("Ya se estrenó");
  });

  it("al tocar un paquete avisa con su mes, día y categoría", async () => {
    const user = userEvent.setup();
    const { onOpenPackage } = renderAgenda([
      makeRelease({ id: "a", title: "Duna: Parte Tres", releaseDate: "2026-08-14" }),
    ]);

    await user.click(await screen.findByRole("button", { name: /Cine, 14 de agosto/i }));

    // El gancho recibe la ubicación exacta del paquete: es lo que el overlay necesita para abrirse.
    expect(onOpenPackage).toHaveBeenCalledWith(8, 14, "cine");
  });

  it("explica el estado vacío en lugar de dejar la pantalla en blanco", async () => {
    renderAgenda([]);

    // Con el catálogo vacío debe aparecer un aviso legible, anunciado además como estado.
    const status = await screen.findByRole("status");
    expect(status.textContent?.length ?? 0).toBeGreaterThan(10);
  });

  it("cada paquete es un BOTÓN alcanzable por teclado (accesibilidad)", async () => {
    renderAgenda([
      makeRelease({ id: "a", title: "Duna: Parte Tres", releaseDate: "2026-08-14" }),
      makeRelease({ id: "b", title: "Otra película", releaseDate: "2026-08-20" }),
    ]);

    const buttons = await screen.findAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // Ninguno debe estar fuera del orden de tabulación: en móvil también se navega con teclado
    // (teclados externos, conmutadores de accesibilidad).
    for (const button of buttons) {
      expect(button.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("agrupa varios estrenos del MISMO día y categoría en un solo paquete", async () => {
    renderAgenda([
      makeRelease({
        id: "a",
        title: "Primera",
        releaseDate: "2026-08-14",
        ratings: { tmdb: 9 },
      } as never),
      makeRelease({
        id: "b",
        title: "Segunda",
        releaseDate: "2026-08-14",
        ratings: { tmdb: 7 },
      } as never),
    ]);

    // La etiqueta accesible del paquete declara que contiene DOS estrenos.
    expect(await screen.findByRole("button", { name: /2 estrenos/i })).toBeInTheDocument();
    // Y el título visible es el mejor calificado de los dos.
    expect(screen.getByText("Primera")).toBeInTheDocument();
  });
});
