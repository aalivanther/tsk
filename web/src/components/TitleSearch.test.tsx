// Archivo: TitleSearch.test.tsx — Pruebas del buscador de títulos, usado como lo usaría una persona.
//
// En español: el buscador es una pieza que se puede romper en silencio (un filtro que deja de ignorar
// acentos, una flecha que deja de moverse) sin que nada avise. Estas pruebas montan el componente de
// verdad en un navegador simulado y lo operan como alguien real: pulsando la lupa, escribiendo,
// moviéndose con las flechas y pulsando Enter.
//
// Lo que se protege:
//   - Que el filtro IGNORE ACENTOS y mayúsculas (escribir "cronica" debe encontrar "Crónica").
//   - Que se pueda llegar al resultado y abrirlo SOLO con el teclado (accesibilidad no negociable).
//   - Que Escape cierre el panel y devuelva el foco al botón que lo abrió.
//   - Que los dos estados —sin escribir nada y sin coincidencias— se muestren con su mensaje.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TitleSearch } from "@/components/TitleSearch";
import { ui } from "@/lib/i18n";
import { TitleType, type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// pushMock recoge las navegaciones que dispara el buscador, para comprobar a dónde lleva cada
// resultado. En español: en una prueba no hay navegador que cambie de página, así que se sustituye el
// enrutador de Next por un doble que solo apunta la dirección a la que se habría ido.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// makeRelease arma un estreno mínimo con lo único que el buscador consulta (id, título, tipo y fecha).
function makeRelease(id: string, title: string, releaseDate: string): ReleaseSummary {
  return { id, title, releaseDate, type: TitleType.MOVIE } as ReleaseSummary;
}

// CATALOG es el catálogo de prueba. Incluye un título CON ACENTO a propósito: es el caso que más se
// escribe mal en un buscador real y el que más veces se rompe al tocar la normalización.
const CATALOG: ReleaseSummary[] = [
  makeRelease("id-cronica", "Crónica del Fin", "2026-06-15"),
  makeRelease("id-horas", "Las Horas Doradas", "2026-06-20"),
  makeRelease("id-eco", "El Eco de las Horas", "2026-07-02"),
];

// openSearch pulsa la lupa y devuelve el campo de texto ya listo para escribir.
async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: ui.search.openLabel }));
  return screen.getByRole("combobox");
}

describe("TitleSearch", () => {
  it("al abrirlo sin escribir nada explica cuántos títulos hay (estado vacío)", async () => {
    const user = userEvent.setup();
    render(<TitleSearch releases={CATALOG} />);
    await openSearch(user);
    expect(screen.getByText(ui.search.hint(CATALOG.length))).toBeInTheDocument();
  });

  it("sin catálogo cargado lo dice, en vez de fingir una búsqueda vacía", async () => {
    const user = userEvent.setup();
    render(<TitleSearch releases={[]} />);
    await openSearch(user);
    expect(screen.getByText(ui.search.emptyCatalog)).toBeInTheDocument();
  });

  it("encuentra un título ESCRITO SIN ACENTOS y en minúsculas", async () => {
    const user = userEvent.setup();
    render(<TitleSearch releases={CATALOG} />);
    const input = await openSearch(user);
    await user.type(input, "cronica");
    expect(screen.getByRole("option", { name: /Crónica del Fin/ })).toBeInTheDocument();
  });

  it("muestra primero los títulos que EMPIEZAN por lo escrito", async () => {
    const user = userEvent.setup();
    render(<TitleSearch releases={CATALOG} />);
    const input = await openSearch(user);
    await user.type(input, "las horas");
    const options = screen.getAllByRole("option");
    // "Las Horas Doradas" empieza por lo escrito; "El Eco de las Horas" solo lo contiene.
    expect(options[0]).toHaveTextContent("Las Horas Doradas");
  });

  it("permite llegar a un resultado y abrirlo SOLO con el teclado", async () => {
    const user = userEvent.setup();
    pushMock.mockClear();
    render(<TitleSearch releases={CATALOG} />);
    const input = await openSearch(user);
    await user.type(input, "horas");
    // Dos flechas abajo bajan al SEGUNDO resultado; Enter lo abre.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(pushMock).toHaveBeenCalledTimes(1);
    const destination = pushMock.mock.calls[0][0] as string;
    expect(destination.startsWith("/titulo/")).toBe(true);
  });

  it("la flecha arriba desde el principio da la vuelta al ÚLTIMO resultado", async () => {
    const user = userEvent.setup();
    render(<TitleSearch releases={CATALOG} />);
    const input = await openSearch(user);
    await user.type(input, "horas");
    const options = screen.getAllByRole("option");
    await user.keyboard("{ArrowUp}");
    expect(options[options.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("Enter sin haber movido las flechas abre el PRIMER resultado", async () => {
    const user = userEvent.setup();
    pushMock.mockClear();
    render(<TitleSearch releases={CATALOG} />);
    const input = await openSearch(user);
    await user.type(input, "cronica");
    await user.keyboard("{Enter}");
    expect(pushMock).toHaveBeenCalledWith("/titulo/id-cronica");
  });

  it("dice claramente cuando lo escrito no coincide con ningún título", async () => {
    const user = userEvent.setup();
    render(<TitleSearch releases={CATALOG} />);
    const input = await openSearch(user);
    await user.type(input, "zzzz");
    expect(screen.getByText(ui.search.noResults("zzzz"))).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("Escape cierra el panel y devuelve el foco al botón que lo abrió", async () => {
    const user = userEvent.setup();
    render(<TitleSearch releases={CATALOG} />);
    await openSearch(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui.search.openLabel })).toHaveFocus();
  });
});
