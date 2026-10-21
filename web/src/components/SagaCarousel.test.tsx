// Archivo: SagaCarousel.test.tsx — Pruebas de la tira horizontal de la saga de un título.
//
// En español: dentro de la ficha de un estreno, esta tira muestra el resto de su saga como una fila de
// portadas que se arrastra de lado y no tiene principio ni fin. Para lograr ese "sin fin", el contenido
// se dibuja TRES veces seguidas y solo la copia del medio es la de verdad: las de los lados están
// marcadas como inexistentes para los lectores de pantalla y fuera del orden de tabulación.
//
// Ese truco tiene una consecuencia que se pasó por alto al extraer el carrusel a su propio archivo: un
// contenedor desplazable arranca siempre en su extremo izquierdo, o sea, mostrando el primer CLON. La
// primera pantalla que veía la persona era precisamente la copia que la aplicación declara que no
// existe — en silencio para un lector de pantalla, y con el primer tabulador saltando a una tarjeta
// que no era ninguna de las visibles. Las pruebas de aquí fijan eso y el resto del comportamiento:
//
//   - Que la tira aterrice en la copia principal.
//   - Que se pueda RECORRER con el teclado (antes solo respondía al dedo y al ratón).
//   - Que los clones sigan fuera del alcance del teclado y de los lectores de pantalla.
//   - Que pulsar una entrada abra la ficha completa si está en el catálogo, y su ficha ligera si no.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SagaCarousel } from "@/components/SagaCarousel";
import { ui } from "@/lib/i18n";
import {
  TitleType,
  type CollectionItem,
  type ReleaseSummary,
} from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// TRACK_SCROLL_WIDTH / COPY_WIDTH: medidas simuladas de la tira (tres copias de 300 px).
// El navegador simulado no calcula tamaños, así que se los damos nosotros; el componente solo consulta
// scrollWidth y scrollLeft, que es exactamente lo que aquí se sustituye.
const TRACK_SCROLL_WIDTH = 900;
const COPY_WIDTH = TRACK_SCROLL_WIDTH / 3;

// KEYBOARD_STEP_PX es el paso que debe dar la tira con cada flecha (el mismo que la línea de tiempo).
const KEYBOARD_STEP_PX = 320;

// scrollPositions recuerda el scrollLeft de cada elemento, porque jsdom lo devuelve siempre a cero.
const scrollPositions = new WeakMap<Element, number>();

// scrollByCalls recoge las peticiones de desplazamiento programado (las flechas del teclado).
const scrollByCalls: ScrollToOptions[] = [];

// makeItem arma una entrada de saga (una película de la colección o una temporada).
function makeItem(title: string, year: string, overview = ""): CollectionItem {
  return {
    title,
    year,
    overview,
    posterUrl: "",
    backdropUrl: "",
    extra: "",
    rating: 0,
  } as unknown as CollectionItem;
}

// makeRelease arma un título del catálogo (para probar el caso "esta entrada SÍ está en el catálogo").
function makeRelease(id: string, title: string, releaseDate: string): ReleaseSummary {
  return { id, title, releaseDate, type: TitleType.MOVIE } as ReleaseSummary;
}

// ITEMS son tres entradas de saga; la primera coincide con un título del catálogo de prueba.
const ITEMS: CollectionItem[] = [
  makeItem("Duna: Parte Dos", "2024"),
  makeItem("Duna", "2021", "El comienzo de todo."),
  makeItem("Duna: Parte Tres", "2026"),
];

// CATALOG contiene SOLO la primera entrada: las otras dos son entregas que el catálogo no cubre.
const CATALOG: ReleaseSummary[] = [makeRelease("id-duna-2", "Duna: Parte Dos", "2024-03-01")];

// renderCarousel monta la tira y devuelve el riel y el espía de "abrir ficha del catálogo".
function renderCarousel(items: CollectionItem[] = ITEMS, catalog: ReleaseSummary[] = CATALOG) {
  const onOpenCatalogRelease = vi.fn();
  const { container } = render(
    <SagaCarousel
      items={items}
      baseSeed={7}
      catalog={catalog}
      onOpenCatalogRelease={onOpenCatalogRelease}
    />,
  );
  const track = container.querySelector(".rf-saga-track") as HTMLElement;
  return { track, onOpenCatalogRelease, container };
}

beforeEach(() => {
  scrollByCalls.length = 0;
  // Medidas simuladas: solo el riel del carrusel tiene ancho de contenido; el resto sigue en cero.
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("rf-saga-track") ? TRACK_SCROLL_WIDTH : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
    configurable: true,
    get(this: HTMLElement) {
      return scrollPositions.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      scrollPositions.set(this, value);
    },
  });
  // scrollBy no existe en el navegador simulado: se sustituye por un espía que anota lo que se pidió.
  Object.defineProperty(HTMLElement.prototype, "scrollBy", {
    configurable: true,
    value: (options: ScrollToOptions) => {
      scrollByCalls.push(options);
    },
  });
});

afterEach(() => {
  // Se retiran las medidas simuladas para no contaminar otros archivos de prueba.
  Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollLeft");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollBy");
});

describe("SagaCarousel · la tira de la saga", () => {
  it("aterriza en la copia PRINCIPAL, no en el clon de la izquierda", () => {
    const { track } = renderCarousel();

    // El contenedor arrancaría solo en cero (el primer clon). Debe colocarse al inicio de la copia
    // central, que es la única que los lectores de pantalla y el teclado pueden usar.
    expect(track.scrollLeft).toBe(COPY_WIDTH);
  });

  it("el riel es enfocable y se anuncia como una región con nombre", () => {
    renderCarousel();

    const track = screen.getByRole("group", { name: ui.detail.sagaLabel });
    expect(track).toHaveAttribute("tabindex", "0");
  });

  it("las flechas del teclado recorren la tira", () => {
    const { track } = renderCarousel();
    track.focus();

    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(scrollByCalls).toHaveLength(1);
    expect(scrollByCalls[0].left).toBe(KEYBOARD_STEP_PX);

    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(scrollByCalls).toHaveLength(2);
    expect(scrollByCalls[1].left).toBe(-KEYBOARD_STEP_PX);
  });

  it("no le roba al navegador las teclas que no le conciernen", () => {
    const { track } = renderCarousel();

    // Tabular, buscar o recargar deben seguir funcionando con normalidad estando dentro de la tira.
    for (const key of ["Tab", "Enter", "a", "PageDown"]) {
      const handled = fireEvent.keyDown(track, { key });
      // fireEvent devuelve false cuando alguien llamó a preventDefault: aquí nadie debe hacerlo.
      expect(handled).toBe(true);
    }
    expect(scrollByCalls).toHaveLength(0);
  });

  it("respeta la preferencia de menos movimiento al desplazarse con el teclado", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    const { track } = renderCarousel();

    fireEvent.keyDown(track, { key: "ArrowRight" });

    // Quien pidió menos movimiento recibe un salto instantáneo, no un desplazamiento animado.
    expect(scrollByCalls[0].behavior).toBe("auto");
    vi.restoreAllMocks();
  });

  it("solo las tarjetas de la copia principal son alcanzables con el tabulador", () => {
    const { container } = renderCarousel();

    // Tres copias por tres entradas = nueve tarjetas dibujadas, pero solo tres son "de verdad".
    const allCards = container.querySelectorAll(".rf-saga-card");
    expect(allCards).toHaveLength(ITEMS.length * 3);

    const reachable = [...allCards].filter((card) => card.getAttribute("tabindex") === "0");
    expect(reachable).toHaveLength(ITEMS.length);

    // Y las copias clon están además ocultas a los lectores de pantalla: si no, cada película de la
    // saga se anunciaría tres veces y la lista parecería tener el triple de entradas de las que hay.
    const hiddenCards = [...allCards].filter((card) => card.getAttribute("aria-hidden") === "true");
    expect(hiddenCards).toHaveLength(ITEMS.length * 2);
  });

  it("si la entrada ESTÁ en el catálogo, abre su ficha completa", async () => {
    const user = userEvent.setup();
    const { onOpenCatalogRelease } = renderCarousel();

    const cards = screen.getAllByRole("button", {
      name: ui.detail.sagaOpenAria("Duna: Parte Dos"),
    });
    await user.click(cards[0]);

    expect(onOpenCatalogRelease).toHaveBeenCalledWith(expect.objectContaining({ id: "id-duna-2" }));
  });

  it("si la entrada NO está en el catálogo, abre su ficha ligera con lo que sí se sabe", async () => {
    const user = userEvent.setup();
    const { onOpenCatalogRelease } = renderCarousel();

    const cards = screen.getAllByRole("button", { name: ui.detail.sagaOpenAria("Duna") });
    await user.click(cards[0]);

    const modal = await screen.findByRole("dialog", { name: "Duna" });
    // La ficha ligera muestra la información real de la entrada, no un póster suelto.
    expect(modal).toHaveTextContent("El comienzo de todo.");
    expect(onOpenCatalogRelease).not.toHaveBeenCalled();
  });

  it("Escape cierra la ficha ligera de una entrada", async () => {
    const user = userEvent.setup();
    renderCarousel();
    await user.click(screen.getAllByRole("button", { name: ui.detail.sagaOpenAria("Duna") })[0]);
    await screen.findByRole("dialog", { name: "Duna" });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Duna" })).toBeNull();
    });
  });

  it("arrastrar la tira NO abre la ficha de la tarjeta que quedó bajo el dedo", async () => {
    const { track, onOpenCatalogRelease } = renderCarousel();
    const card = screen.getAllByRole("button", {
      name: ui.detail.sagaOpenAria("Duna: Parte Dos"),
    })[0];

    // Gesto completo de arrastre que termina sobre una tarjeta: es lo que ocurre cada vez que alguien
    // recorre la tira. El clic con el que acaba no debe abrir nada.
    fireEvent.pointerDown(track, { clientX: 300, button: 0, pointerId: 1, isPrimary: true });
    fireEvent.pointerMove(track, { clientX: 200, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(track, { pointerId: 1, isPrimary: true });
    fireEvent.click(card);

    expect(onOpenCatalogRelease).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
