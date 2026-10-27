"use client";

// Archivo: PersonalGraphView.tsx — La pantalla completa del mapa personal ("tu constelación").
//
// Qué hace este archivo, en español: junta las piezas y decide QUÉ se enseña en cada situación. El
// cálculo de las conexiones vive en personal-graph.ts, el filtrado en graph-view-model.ts, el dibujo
// en GraphCanvas y la versión escrita en GraphTextView. Aquí está el pegamento y, sobre todo, la
// honestidad de los estados: qué se ve con cero títulos vistos, con tres, y con cuatrocientos.
//
// LOS ESTADOS, QUE SON LA MITAD DEL TRABAJO DE ESTA PANTALLA:
//
//   · Sin nada marcado: NO se dibuja un lienzo vacío. Un rectángulo negro con un rótulo se lee como
//     "esto está roto". Se explica qué es esta pantalla y se ofrece el camino para llenarla.
//   · Con uno a cuatro títulos: tampoco hay mapa. Con tan poco casi nada se repite, así que el grafo
//     saldría sin hilos y parecería estropeado. Se dice cuántos faltan y se enseña lo que hay.
//   · Con títulos de sobra pero sin nada en común: pasa de verdad con bibliotecas muy variadas. Se
//     dice, en vez de dibujar puntos sueltos flotando sin explicación.
//   · Con muchos: entran en juego los filtros por tipo de vínculo, el umbral de repetición y el
//     buscador. Sin ellos, cuatrocientos títulos son una maraña.
//
// Y LAS DOS COSAS QUE NO SON NEGOCIABLES, las dos presentes:
//   · Se respeta la preferencia del sistema de "reducir movimiento" (lo hace GraphCanvas).
//   · Y ADEMÁS hay un botón de pausa VISIBLE, porque la norma exige un mecanismo en la propia página
//     y el ajuste del sistema operativo —que muchísima gente no tiene activado— no cuenta como tal.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

import { useRouter } from "next/navigation";

import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphTextView } from "@/components/graph/GraphTextView";
import {
  ATTRIBUTE_KINDS,
  MIN_TITLES_FOR_GRAPH,
  DEFAULT_MIN_SHARED_TITLES,
  DENSE_MIN_SHARED_TITLES,
  defaultMinSharedTitles,
  filterGraph,
} from "@/lib/graph-view-model";
import { withCanonicalAttributes } from "@/lib/attribute-normalization";
import { buildPersonalGraph, describeConnection, type GraphNodeKind } from "@/lib/personal-graph";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useProfile } from "@/lib/profile-context";
import { ui } from "@/lib/i18n";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// KIND_LABELS traduce cada tipo de vínculo a su etiqueta visible.
const KIND_LABELS: Record<GraphNodeKind, string> = {
  title: ui.graph.kindTitle,
  cast: ui.graph.kindCast,
  director: ui.graph.kindDirector,
  genre: ui.graph.kindGenre,
  platform: ui.graph.kindPlatform,
};

// GraphViewMode son las dos formas de ver los MISMOS datos.
type GraphViewMode = "map" | "list";

// PersonalGraphViewProps son las propiedades de la pantalla.
type PersonalGraphViewProps = {
  // catalog es el catálogo cargado por el servidor, contra el que se resuelven los ids del perfil.
  // Son RESÚMENES, no fichas completas: el mapa solo necesita géneros, dirección, reparto principal y
  // plataformas, y todo eso ya viaja en el resumen. Pedir las fichas enteras para esto multiplicaba
  // por cinco el peso de la página sin añadir un solo punto al mapa.
  catalog: ReleaseSummary[];
};

// PersonalGraphView dibuja la pantalla entera del mapa personal.
export function PersonalGraphView({ catalog }: PersonalGraphViewProps) {
  const { profile, hydrated } = useProfile();
  const router = useRouter();
  const { isMobile, resolved: screenResolved } = useIsMobile();

  // --- Estado de la vista -----------------------------------------------------------------------

  // view arranca en null y se decide en el primer render que ya sabe el tamaño de pantalla: en el
  // teléfono, la lista; en escritorio, el mapa. Una vez que la persona elige, manda su elección.
  const [chosenView, setChosenView] = useState<GraphViewMode | null>(null);
  const view: GraphViewMode = chosenView ?? (screenResolved && isMobile ? "list" : "map");

  // activeKinds son los tipos de vínculo encendidos. Empiezan todos.
  const [activeKinds, setActiveKinds] = useState<GraphNodeKind[]>([...ATTRIBUTE_KINDS]);

  // denseMode es el interruptor del umbral. Arranca según lo grande que sea la biblioteca, pero la
  // persona puede deshacer esa decisión en cualquier momento (por eso el interruptor está a la vista).
  const [denseMode, setDenseMode] = useState<boolean | null>(null);
  const watchedCount = profile.watched.length;
  const minSharedTitles =
    denseMode === null
      ? defaultMinSharedTitles(watchedCount)
      : denseMode
        ? DENSE_MIN_SHARED_TITLES
        : DEFAULT_MIN_SHARED_TITLES;

  // paused es el botón de pausa visible (ver la cabecera).
  const [paused, setPaused] = useState(false);

  // searchQuery es lo escrito en el buscador.
  const [searchQuery, setSearchQuery] = useState("");

  // selectedId es el punto resaltado del mapa (o null).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // --- Los datos --------------------------------------------------------------------------------

  // El catálogo con los géneros y las plataformas UNIFICADOS antes de construir nada.
  //
  // Por qué antes y no después, en español: el mapa descarta los atributos que solo tocan un título,
  // porque un punto colgando de otro punto no une nada. Si la unificación se hiciera después, dos
  // variantes del mismo servicio con un título cada una se habrían descartado ya por separado y su
  // conexión —que existe— se habría perdido en el camino. Unificando primero, cuentan como lo que son:
  // el mismo servicio con dos títulos. Ver lib/attribute-normalization para el problema y los números.
  const canonicalCatalog = useMemo(() => withCanonicalAttributes(catalog), [catalog]);

  // El mapa completo, construido a partir de lo que la persona ha marcado como visto.
  const fullGraph = useMemo(
    () => buildPersonalGraph(profile.watched, canonicalCatalog),
    [profile.watched, canonicalCatalog],
  );

  // El mapa recortado a lo que la persona ha decidido ver.
  const graph = useMemo(
    () => filterGraph(fullGraph, { kinds: activeKinds, minSharedTitles }),
    [fullGraph, activeKinds, minSharedTitles],
  );

  // Cuántos títulos y cuántos hilos hay ahora mismo en pantalla.
  const titleCount = graph.nodes.filter((node) => node.kind === "title").length;
  const linkCount = graph.edges.length;

  // selectedDescription es la explicación EN PALABRAS del punto resaltado.
  //
  // En español: aquí es donde se usa describeConnection, la función que convierte una conexión en una
  // frase ("Ana Ruiz: Duna 3, Wicked 2"). Al pulsar un punto del dibujo, esa frase aparece escrita y
  // se anuncia en voz alta, así que la acción de "resaltar" tiene el mismo efecto para quien ve el
  // mapa y para quien no.
  const selectedDescription = useMemo(
    () => (selectedId === null ? "" : describeConnection(graph, selectedId)),
    [graph, selectedId],
  );

  // --- Acciones ---------------------------------------------------------------------------------

  const toggleKind = useCallback((kind: GraphNodeKind) => {
    setActiveKinds((previous) =>
      previous.includes(kind) ? previous.filter((active) => active !== kind) : [...previous, kind],
    );
  }, []);

  const openTitle = useCallback(
    (releaseId: string) => {
      router.push(`/titulo/${releaseId}`);
    },
    [router],
  );

  // --- Estados honestos -------------------------------------------------------------------------

  // Mientras no se ha leído el perfil de este navegador no se sabe nada: se dice, sin fingir vacío.
  if (!hydrated) {
    // pg-pending oculta el pie de página mientras se lee el perfil (ver globals.css): si no, aparecía
    // pegado al aviso y saltaba hacia abajo al llegar el mapa.
    return (
      <p className="pg-empty pg-pending font-mono" role="status">
        {ui.profile.loading}
      </p>
    );
  }

  // Cero títulos vistos: una invitación, no un lienzo vacío.
  if (watchedCount === 0) {
    return (
      <section className="pg-state glass-2">
        <h2 className="pg-state-title font-display">{ui.graph.emptyTitle}</h2>
        <p className="pg-state-hint">{ui.graph.emptyHint}</p>
        <Link href="/" prefetch={false} data-intent-prefetch="/" className="pg-state-action">
          {ui.graph.emptyAction}
        </Link>
      </section>
    );
  }

  // De uno a cuatro: no hay mapa que enseñar. Se dice cuántos faltan y se enseña lo que hay.
  if (watchedCount < MIN_TITLES_FOR_GRAPH) {
    const watchedReleases = profile.watched
      .map((id) => catalog.find((release) => release.id === id))
      .filter((release): release is ReleaseSummary => release !== undefined);
    return (
      <section className="pg-state glass-2">
        <h2 className="pg-state-title font-display">{ui.graph.fewTitle}</h2>
        <p className="pg-state-hint">{ui.graph.fewHint(MIN_TITLES_FOR_GRAPH - watchedCount)}</p>
        <h3 className="pg-list-heading font-hud">{ui.graph.watchedListLabel}</h3>
        <ul className="pg-state-list">
          {watchedReleases.map((release) => (
            <li key={release.id}>
              <Link href={`/titulo/${release.id}`} className="pg-title-link">
                {release.title}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/" prefetch={false} data-intent-prefetch="/" className="pg-state-action">
          {ui.graph.emptyAction}
        </Link>
      </section>
    );
  }

  return (
    <div className="pg-view">
      {/* ----- Barra de controles ----------------------------------------------------------- */}
      <div className="pg-controls">
        {/* Las dos vistas de los MISMOS datos. Ninguna es la buena y ninguna es el consuelo. */}
        <div className="pg-switch" role="group" aria-label={ui.graph.viewSwitchLabel}>
          <button
            type="button"
            className={`pg-chip${view === "map" ? " is-on" : ""}`}
            aria-pressed={view === "map"}
            onClick={() => setChosenView("map")}
          >
            {ui.graph.viewMap}
          </button>
          <button
            type="button"
            className={`pg-chip${view === "list" ? " is-on" : ""}`}
            aria-pressed={view === "list"}
            onClick={() => setChosenView("list")}
          >
            {ui.graph.viewList}
          </button>
        </div>

        {/*
          EL BOTÓN DE PAUSA. No es un extra: respetar la preferencia del sistema de "reducir
          movimiento" es obligatorio pero NO basta. La norma exige un mecanismo EN LA PROPIA PÁGINA
          para detener cualquier movimiento que dure más de cinco segundos, y un ajuste del sistema
          operativo —que muchísima gente no tiene activado ni sabe que existe— no cuenta como tal.

          Está siempre presente MIENTRAS SE VE EL MAPA, se esté moviendo o no: un control que aparece
          y desaparece es un control que no se puede encontrar cuando hace falta. En la lista no se
          dibuja, porque ahí no hay nada que pausar y un botón que no hace nada es peor que ninguno.
        */}
        {view === "map" ? (
          <button
            type="button"
            className={`pg-chip${paused ? " is-on" : ""}`}
            aria-pressed={paused}
            aria-label={paused ? ui.graph.resumeAria : ui.graph.pauseAria}
            onClick={() => setPaused((previous) => !previous)}
          >
            {paused ? ui.graph.resume : ui.graph.pause}
          </button>
        ) : null}

        {/*
          El recuento de lo que se está viendo, en palabras y no en jerga de grafos.

          Aquí se colaba además la TELEMETRÍA de la colocación ("Colocado en 3518 ms en la página").
          Es un dato que hay que poder vigilar, pero no es texto de producto: a quien mira su
          constelación no le dice nada, y leerlo pegado al recuento hace creer que forma parte de la
          información. Sigue disponible, fuera de la vista, en los atributos data-layout-* del mapa.
        */}
        <p className="pg-summary font-mono" role="status">
          {ui.graph.summary(titleCount, linkCount)}
        </p>
      </div>

      {/* ----- Filtros por tipo de vínculo --------------------------------------------------- */}
      <fieldset className="pg-filters">
        <legend className="pg-filters-legend font-hud">{ui.graph.filtersLabel}</legend>
        <p className="pg-filters-hint">{ui.graph.filtersHint}</p>
        <div className="pg-chips">
          {ATTRIBUTE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`pg-chip${activeKinds.includes(kind) ? " is-on" : ""}`}
              aria-pressed={activeKinds.includes(kind)}
              onClick={() => toggleKind(kind)}
              data-kind={kind}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
          {/* El umbral: con una biblioteca grande arranca encendido, y aquí se puede apagar. */}
          <button
            type="button"
            className={`pg-chip${minSharedTitles === DENSE_MIN_SHARED_TITLES ? " is-on" : ""}`}
            aria-pressed={minSharedTitles === DENSE_MIN_SHARED_TITLES}
            onClick={() => setDenseMode(minSharedTitles !== DENSE_MIN_SHARED_TITLES)}
          >
            {ui.graph.thresholdLabel}
          </button>
        </div>
        <p className="pg-filters-hint">{ui.graph.thresholdHint(minSharedTitles)}</p>
      </fieldset>

      {/* ----- Buscador ---------------------------------------------------------------------- */}
      <label className="pg-search">
        <span className="pg-search-label font-mono">{ui.graph.searchLabel}</span>
        <input
          type="search"
          className="pg-search-input"
          value={searchQuery}
          placeholder={ui.graph.searchPlaceholder}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </label>

      {/* ----- Instrucciones de teclado, a la vista de todos ---------------------------------
          Van escritas en la página y no escondidas solo para lectores de pantalla: quien navega con
          teclado y ve perfectamente la pantalla las necesita exactamente igual. Solo se enseñan con
          el mapa delante, porque describen cómo recorrerlo; la lista se recorre como cualquier otra
          lista y no hace falta explicar nada. */}
      {view === "map" ? (
        <p id="pg-keyboard-hint" className="pg-keyboard-hint">
          {ui.graph.keyboardHint}
        </p>
      ) : null}

      {/* ----- El punto resaltado, explicado en palabras ------------------------------------- */}
      {selectedId !== null && selectedDescription !== "" ? (
        <div className="pg-selected glass-2" role="status" aria-live="polite">
          <h2 className="pg-selected-label font-hud">{ui.graph.selectedLabel}</h2>
          <p className="pg-selected-text">{selectedDescription}</p>
          <button type="button" className="pg-chip" onClick={() => setSelectedId(null)}>
            {ui.graph.clearSelection}
          </button>
        </div>
      ) : null}

      {/* ----- Sin nada en común: se dice, en vez de dibujar puntos sueltos ------------------- */}
      {linkCount === 0 ? (
        <section className="pg-state glass-2">
          <h2 className="pg-state-title font-display">{ui.graph.noLinksTitle}</h2>
          <p className="pg-state-hint">{ui.graph.noLinksHint}</p>
        </section>
      ) : view === "map" ? (
        <GraphCanvas
          graph={graph}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpenTitle={openTitle}
          paused={paused}
          searchQuery={searchQuery}
        />
      ) : (
        <GraphTextView graph={graph} searchQuery={searchQuery} />
      )}
    </div>
  );
}
