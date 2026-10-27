"use client";

// Archivo: TimelineStage.tsx — El ENVOLTORIO que une la línea de tiempo con el overlay del flujo (S7).
//
// En español: la línea de tiempo (Timeline) sabe DIBUJAR los paquetes y avisar cuando se pulsa uno;
// el overlay (Stage) sabe MOSTRAR el modal de categoría y el detalle. Pero alguien tiene que poseer el
// ESTADO de "qué hay abierto" (nada / un paquete / un detalle) y conectar a los dos. Ese es el trabajo
// de este componente: mantiene el estado del overlay, calcula los estrenos del paquete pulsado y se los
// pasa al Stage; y le entrega a la Timeline el gancho onOpenPackage que dispara todo.
//
// Lleva 'use client' porque maneja estado de interacción (useState) y vive bajo el FilterProvider, del
// que LEE el filtro de tipo activo para que el modal muestre EXACTAMENTE los mismos estrenos que el
// paquete de la timeline (ni más ni menos). Reenvía june/july/todayLabel a la Timeline sin tocarlos.
//
// Por qué calculamos los estrenos del paquete aquí (y no los guarda la Timeline): así el overlay no
// depende de los detalles internos de la timeline. Replicamos la MISMA receta que usa la Timeline para
// armar sus paquetes —combinar junio+julio, filtrar por tipo y agrupar con groupByMonth— y de ahí
// sacamos el paquete exacto (mes + día + categoría). Una sola fuente de verdad para el agrupado.

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import { AgendaMobile } from "@/components/AgendaMobile";
import { Timeline } from "@/components/Timeline";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useFilter } from "@/lib/timeline-context";
import {
  DATE_RANGES,
  LANE_ORDER,
  findConnections,
  formatPeriodLabel,
  groupByMonth,
  isAnchorAtToday,
  matchesFilter,
  releasesForLane,
  shiftCalendar,
  weekInsideCatalog,
  yearOfMonth,
  type CategoryKey,
  type Connection,
  type DateRange,
  type TodayMarker,
} from "@/lib/timeline";
import { ui } from "@/lib/i18n";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// El overlay (Stage) se carga aparte: cerrado no pinta nada (ni en el servidor), y con él viaja el
// lector de fichas y el motor de protobuf, que la línea de tiempo no necesita para pintarse. Se pide
// en cuanto la página arranca, sin bloquearla, así que al pulsar un paquete ya está aquí.
const Stage = dynamic(() => import("@/components/Stage").then((module) => module.Stage), {
  ssr: false,
});

// OpenPackage describe el paquete ABIERTO en el overlay (nivel 1): su ubicación y sus estrenos.
// En español: cuando hay un modal de categoría abierto, guardamos qué mes/día/categoría es y la lista
// de estrenos ya resuelta para ese paquete (en el ORDEN en que la timeline los muestra). Si no hay nada
// abierto, el estado vale null.
type OpenPackage = {
  // month y day ubican el paquete en el tiempo.
  month: number;
  day: number;
  // categoryKey es la categoría del paquete ("cine"/"streaming"/"tv").
  categoryKey: CategoryKey;
  // releases son los estrenos del paquete, ya filtrados por tipo y ordenados por calificación TMDB.
  releases: ReleaseSummary[];
};

// TimelineStageProps son las props del envoltorio: los mismos datos que necesita la Timeline.
// En español: recibe los estrenos de los dos meses de Fase 0 y el texto del marcador HOY, y los reenvía
// tal cual a la Timeline. No añade datos nuevos: solo orquesta el estado del overlay sobre esos datos.
type TimelineStageProps = {
  // releases son TODOS los estrenos del catálogo (mayo+junio+julio combinados); puede venir vacío.
  releases: ReleaseSummary[];
  // today es el marcador HOY de la demo (componentes de fecha + etiqueta), calculado en el servidor.
  today: TodayMarker;
};

// TimelineStage orquesta el flujo de 3 niveles sobre la línea de tiempo.
// En español: dibuja la Timeline (pasándole el gancho onOpenPackage) y el Stage (pasándole el estado del
// overlay y los ganchos para seleccionar/volver/cerrar). Mantiene dos piezas de estado: el paquete
// abierto (nivel 1) y el estreno seleccionado dentro de él (nivel 2).
export function TimelineStage({ releases, today }: TimelineStageProps) {
  // Leemos el filtro activo del contexto compartido (el MISMO que aplica la Timeline, para que el modal
  // muestre los mismos estrenos que el paquete) y el setter del FONDO de selección (para que el fondo
  // global "mute" al abrir una categoría/título y vuelva a la rotación al cerrar).
  const {
    filter,
    setActiveBackdrop,
    dateRange,
    setDateRange,
    dateAnchor,
    setDateAnchor,
    scrollToDate,
  } = useFilter();

  // Meses con estrenos presentes en el catálogo (ordenados), para acotar la navegación: solo se puede
  // saltar a meses/semanas que existan. groupByMonth ya devuelve los meses en orden ascendente.
  const availableMonths = useMemo<number[]>(
    () => groupByMonth(releases).map((group) => group.month),
    [releases],
  );

  // handleSelectGranularity cambia entre MES y SEMANA conservando el ANCLA (quedan conectados: cambiar a
  // semana enfoca la semana del mismo periodo) y re-centra la vista para dar feedback del foco.
  const handleSelectGranularity = useCallback(
    (range: DateRange) => {
      setDateRange(range);
      scrollToDate(dateAnchor.month, dateAnchor.day);
    },
    [setDateRange, scrollToDate, dateAnchor.month, dateAnchor.day],
  );

  // handleStepWeek mueve el ancla ±7 días (salto semanal) y centra la vista en la nueva semana. Acotado a
  // que la semana TOQUE el catálogo (weekOverlapsMonths); si no, no navega (la flecha va deshabilitada).
  const handleStepWeek = useCallback(
    (delta: number) => {
      const next = shiftCalendar(
        yearOfMonth(today, dateAnchor.month),
        dateAnchor.month,
        dateAnchor.day,
        delta * 7,
      );
      if (!weekInsideCatalog(next.year, next.month, next.day, today)) {
        return;
      }
      setDateAnchor({ month: next.month, day: next.day });
      scrollToDate(next.month, next.day);
    },
    [today, dateAnchor, setDateAnchor, scrollToDate],
  );

  // handleStepMonth mueve el ancla al mes anterior/siguiente DISPONIBLE (día 1) y centra la vista en él.
  const handleStepMonth = useCallback(
    (delta: number) => {
      const currentIndex = availableMonths.indexOf(dateAnchor.month);
      const nextIndex = currentIndex + delta;
      if (nextIndex < 0 || nextIndex >= availableMonths.length) {
        return;
      }
      const nextMonth = availableMonths[nextIndex];
      setDateAnchor({ month: nextMonth, day: 1 });
      scrollToDate(nextMonth, 1);
    },
    [availableMonths, dateAnchor.month, setDateAnchor, scrollToDate],
  );

  // handleStep enruta la flecha al salto correcto según la granularidad activa (semana o mes).
  const handleStep = useCallback(
    (delta: number) => {
      if (dateRange === "week") {
        handleStepWeek(delta);
      } else {
        handleStepMonth(delta);
      }
    },
    [dateRange, handleStepWeek, handleStepMonth],
  );

  // handleGoToday lleva el ancla al periodo que contiene HOY (mes o semana, según la granularidad) y
  // centra la vista. Es el "volver a hoy" del navegador de fecha.
  const handleGoToday = useCallback(() => {
    setDateAnchor({ month: today.month, day: today.day });
    scrollToDate(today.month, today.day);
  }, [setDateAnchor, scrollToDate, today.month, today.day]);

  // Límites de las flechas en la granularidad activa y datos derivados para el control.
  const monthIndex = availableMonths.indexOf(dateAnchor.month);
  const anchorYear = yearOfMonth(today, dateAnchor.month);
  const previousWeek = shiftCalendar(anchorYear, dateAnchor.month, dateAnchor.day, -7);
  const nextWeek = shiftCalendar(anchorYear, dateAnchor.month, dateAnchor.day, 7);
  const canStepBack =
    dateRange === "month"
      ? monthIndex > 0
      : weekInsideCatalog(previousWeek.year, previousWeek.month, previousWeek.day, today);
  const canStepForward =
    dateRange === "month"
      ? monthIndex >= 0 && monthIndex < availableMonths.length - 1
      : weekInsideCatalog(nextWeek.year, nextWeek.month, nextWeek.day, today);
  // Etiqueta del periodo enfocado (centro del stepper) y si ya contiene HOY (atenúa "Hoy").
  // El año es el del mes enfocado, no el de hoy: en octubre, enero es del año siguiente.
  const periodLabel = formatPeriodLabel(dateRange, dateAnchor, anchorYear);
  const atToday = isAnchorAtToday(dateRange, dateAnchor, today);

  // Estado del overlay (modal de categoría con carrusel + panel de previa/detalle):
  //   - openPackage: el paquete (categoría) abierto, o null si el overlay está cerrado.
  //   - activeRelease: el título RESALTADO ahora en el carrusel (el que el panel derecho previsualiza o
  //     detalla). Arranca en el mejor del paquete al abrir, para que el panel NUNCA se vea vacío/negro.
  //   - detailExpanded: si el panel derecho muestra el DETALLE completo (true) o solo la PREVIA (false).
  // Presentación según el tamaño de pantalla: agenda vertical en móvil, espina horizontal en
  // escritorio (ver el bloque de render). El hook resuelve en el navegador; durante el render del
  // servidor asume escritorio, que es el valor con el que la app venía funcionando.
  //
  // Hasta que el navegador mide la pantalla (resolved), se escriben LAS DOS presentaciones y el CSS
  // enseña la que corresponde (tlx-view, globals.css, con el mismo punto de corte que el hook). Antes
  // el servidor escribía solo la de escritorio y en el teléfono se veía la espina horizontal durante
  // el primer segundo, hasta que la agenda la sustituía. En cuanto se resuelve queda montada solo una.
  const { isMobile, resolved: screenResolved } = useIsMobile();
  const showDesktop = !screenResolved || !isMobile;
  const showMobile = !screenResolved || isMobile;

  const [openPackage, setOpenPackage] = useState<OpenPackage | null>(null);
  const [activeRelease, setActiveRelease] = useState<ReleaseSummary | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);

  // Combinamos los estrenos de los dos meses una sola vez (memoizado). El orden no importa aquí porque
  // groupByMonth ordena de forma determinista por mes y día.
  const allReleases = releases;

  // Asignamos a cada estreno (por id) su "seed" de degradado: su posición en la lista combinada. Es la
  // MISMA asignación que hace la Timeline, para que el color de cada estreno sea idéntico en la cinta,
  // en el modal y en el detalle. El filtro no cambia esta asignación (el color es estable por estreno).
  const seedById = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    allReleases.forEach((release, index) => {
      map.set(release.id, index);
    });
    return map;
  }, [allReleases]);

  // Conexiones reales del título ACTIVO (misma saga / mismo director / por género) dentro de todo el
  // catálogo cargado (jun+jul). Las calcula aquí porque el detalle por sí solo no conoce los demás títulos.
  // Se recalcula solo cuando cambia el título activo o el catálogo. Si no hay activo, va vacío.
  const relatedForActive = useMemo<Connection[]>(
    () => (activeRelease !== null ? findConnections(activeRelease, allReleases) : []),
    [activeRelease, allReleases],
  );

  // handleOpenPackage resuelve los estrenos del paquete pulsado y abre el modal de categoría (nivel 1).
  // En español: es el gancho que recibe la Timeline. Replicamos su receta de agrupado —filtrar por tipo
  // y agrupar con groupByMonth— y buscamos el paquete exacto (mes + día + categoría). Si por alguna
  // condición de carrera el paquete ya no existiera (p. ej. el filtro cambió), no abrimos nada en vez de
  // mostrar un modal vacío. Al abrir un paquete nuevo, reiniciamos la selección de detalle.
  const handleOpenPackage = useCallback(
    (month: number, day: number, categoryKey: CategoryKey) => {
      // Filtramos por el tipo activo ANTES de agrupar, igual que la Timeline.
      const filtered = allReleases.filter((release) => matchesFilter(release, filter));
      const monthGroups = groupByMonth(filtered);

      // Localizamos el mes, el día y la categoría pedidos dentro de la estructura agrupada.
      const monthGroup = monthGroups.find((group) => group.month === month);
      const dayGroup = monthGroup?.days.find((group) => group.day === day);
      const categoryPackage = dayGroup?.packages.find((group) => group.categoryKey === categoryKey);

      // Si el paquete no existe (no debería, pero somos defensivos), no abrimos el overlay.
      if (categoryPackage === undefined) {
        return;
      }

      // Abrimos el modal con sus estrenos (ya ordenados por TMDB). El título activo arranca en el mejor
      // (items[0]) y el panel derecho muestra su PREVIA (detailExpanded=false): nunca se ve vacío/negro.
      setOpenPackage({
        month,
        day,
        categoryKey,
        releases: categoryPackage.items,
      });
      const bestRelease = categoryPackage.items[0];
      setActiveRelease(bestRelease ?? null);
      setDetailExpanded(false);
      // El fondo global "muta" al mejor calificado del paquete (su backdrop). Si viniera vacío, no tocamos.
      if (bestRelease !== undefined) {
        setActiveBackdrop({
          url: bestRelease.backdropUrl,
          seed: seedById.get(bestRelease.id) ?? 0,
        });
      }
    },
    [allReleases, filter, seedById, setActiveBackdrop],
  );

  // handleSelectCard RESALTA un título del carrusel: el panel derecho vuelve a la PREVIA de ese título y
  // el fondo global muta a SU backdrop. No abre el detalle todavía (eso lo hace handleOpenDetail).
  const handleSelectCard = useCallback(
    (release: ReleaseSummary) => {
      setActiveRelease(release);
      setDetailExpanded(false);
      setActiveBackdrop({ url: release.backdropUrl, seed: seedById.get(release.id) ?? 0 });
    },
    [seedById, setActiveBackdrop],
  );

  // handleOpenDetail expande la PREVIA al DETALLE completo del título activo (panel derecho).
  const handleOpenDetail = useCallback(() => {
    setDetailExpanded(true);
  }, []);

  // handleCollapseDetail vuelve del detalle a la PREVIA, conservando el título activo y el paquete.
  const handleCollapseDetail = useCallback(() => {
    setDetailExpanded(false);
  }, []);

  // handleClose cierra TODO el overlay (vuelve a la línea de tiempo), limpiando estado y el fondo.
  const handleClose = useCallback(() => {
    setOpenPackage(null);
    setActiveRelease(null);
    setDetailExpanded(false);
    // Al cerrar, el fondo de selección se limpia (null): vuelve la rotación de los mejores estrenos.
    setActiveBackdrop(null);
  }, [setActiveBackdrop]);

  return (
    <>
      {/*
        DOS líneas de tiempo apiladas (sprint de cierre): la de ESTRENOS DE CINE (Cine + Indie) arriba y
        la de SERIES Y STREAMING (Streaming + Cadenas) abajo. Cada carril recibe SOLO sus estrenos (el
        reparto lo hace releasesForLane, la única fuente de la regla) y el MISMO gancho onOpenPackage:
        el overlay de detalle es compartido, porque un paquete (mes+día+categoría) identifica su carril
        sin ambigüedad. El reparto vertical de la pantalla lo hace .tlx-lanes (globals.css).
      */}
      <div className="tlx-lanes">
        {/*
          FILTRO POR FECHA integrado EN la línea: grupo de chips de rango rápido flotando sobre la
          espina, centrado y compartido por los DOS carriles (un solo control afecta a ambos). Atenúa
          —no oculta— lo que cae fuera del rango (la atenuación la aplica cada Timeline por estación).
          En móvil NO se muestra: la agenda vertical ya se recorre con el propio desplazamiento y el
          navegador de periodo ocuparía una franja valiosa de una pantalla pequeña.
        */}
        <div
          className="tlx-view tlx-view-desktop"
          data-pending={screenResolved ? undefined : "true"}
        >
          {showDesktop ? (
            <DateRangeControl
              active={dateRange}
              onChange={handleSelectGranularity}
              periodLabel={periodLabel}
              canStepBack={canStepBack}
              canStepForward={canStepForward}
              onStep={handleStep}
              onGoToday={handleGoToday}
              atToday={atToday}
            />
          ) : null}

          {/*
          DOS PRESENTACIONES DEL MISMO CATÁLOGO, no una encogida:
            - Escritorio: los dos carriles de ESPINA horizontal (la firma visual del producto).
            - Móvil: la AGENDA vertical, que es la espina girada 90° — se recorre con el pulgar, como
              el resto del teléfono, y no esconde contenido tras un arrastre lateral.
          Se monta SOLO una: renderizar ambas y ocultar una con CSS duplicaría cientos de nodos del
          DOM. Ambas comparten el mismo gancho onOpenPackage, así que el flujo de 3 niveles y todo el
          estado del overlay son EXACTAMENTE los mismos en las dos.
        */}
          {showDesktop
            ? LANE_ORDER.map((lane) => (
                <Timeline
                  key={lane}
                  lane={lane}
                  releases={releasesForLane(releases, lane)}
                  today={today}
                  onOpenPackage={handleOpenPackage}
                />
              ))
            : null}
        </div>
        <div
          className="tlx-view tlx-view-mobile"
          data-pending={screenResolved ? undefined : "true"}
        >
          {showMobile ? (
            <AgendaMobile releases={releases} today={today} onOpenPackage={handleOpenPackage} />
          ) : null}
        </div>
      </div>

      {/*
        El overlay del flujo. open depende de si hay un paquete abierto. Cuando no lo hay, pasamos valores
        neutros (no se usan porque Stage no renderiza nada con open=false). Le entregamos los estrenos del
        paquete, el título ACTIVO (resaltado), si el detalle está expandido, el mapa de seeds y los ganchos
        de resaltar tarjeta / abrir detalle / colapsar detalle / cerrar.
      */}
      <Stage
        open={openPackage !== null}
        month={openPackage?.month ?? 0}
        day={openPackage?.day ?? 0}
        categoryKey={openPackage?.categoryKey ?? "cine"}
        releases={openPackage?.releases ?? []}
        activeRelease={activeRelease}
        detailExpanded={detailExpanded}
        related={relatedForActive}
        catalog={allReleases}
        today={today}
        seedById={seedById}
        onSelectCard={handleSelectCard}
        onOpenDetail={handleOpenDetail}
        onCollapseDetail={handleCollapseDetail}
        onClose={handleClose}
      />
    </>
  );
}

// DATE_RANGE_LABELS traduce cada granularidad a su etiqueta de toggle (Mes / Semana), desde i18n.
const DATE_RANGE_LABELS: Record<DateRange, string> = {
  month: ui.timeline.dateRange.month,
  week: ui.timeline.dateRange.week,
};

// DateRangeControlProps son las props del navegador de fecha (toggle de granularidad + stepper + Hoy).
type DateRangeControlProps = {
  // active es la granularidad activa (Mes/Semana), resaltada en oro.
  active: DateRange;
  // onChange cambia la granularidad (conserva el ancla, re-centra el foco).
  onChange: (range: DateRange) => void;
  // periodLabel es el texto del periodo enfocado ("JUNIO 2026" o "09 – 15 jun") en el centro del stepper.
  periodLabel: string;
  // canStepBack / canStepForward deshabilitan la flecha en los extremos del catálogo.
  canStepBack: boolean;
  canStepForward: boolean;
  // onStep avanza el foco por delta (-1 / +1): una SEMANA o un MES, según la granularidad activa.
  onStep: (delta: number) => void;
  // onGoToday vuelve al periodo (mes/semana) que contiene HOY.
  onGoToday: () => void;
  // atToday indica que el periodo enfocado YA contiene hoy (atenúa "Hoy": no hay a dónde volver).
  atToday: boolean;
};

// DateRangeControl es el NAVEGADOR DE FECHA integrado en la espina (patrón "stepper de calendario"):
//   [ Mes | Semana ]   ‹  PERIODO  ›   [⊙ Hoy]
// En español: el toggle elige la granularidad (qué se enfoca/atenúa y el salto de las flechas); el
// stepper ‹ PERIODO › navega en esa granularidad (semana a semana o mes a mes) mostrando el periodo
// enfocado; "Hoy" vuelve al periodo actual. Mes y semana comparten el ANCLA, así quedan conectados
// (navegas a otro mes y, al pasar a semana, enfocas una semana de ese mes). Flota sobre la línea
// (posición la da .tlx-range en globals.css) y es 100% navegable por teclado.
function DateRangeControl({
  active,
  onChange,
  periodLabel,
  canStepBack,
  canStepForward,
  onStep,
  onGoToday,
  atToday,
}: DateRangeControlProps) {
  // Etiquetas accesibles de las flechas según la granularidad (semana o mes).
  const backLabel =
    active === "week" ? ui.timeline.dateRange.prevWeek : ui.timeline.dateRange.prevMonth;
  const forwardLabel =
    active === "week" ? ui.timeline.dateRange.nextWeek : ui.timeline.dateRange.nextMonth;

  return (
    <div className="tlx-range font-hud" role="group" aria-label={ui.timeline.dateRange.groupLabel}>
      {/* TOGGLE de granularidad: Mes / Semana (uno activo, en oro). */}
      <div
        className="tlx-range-toggle"
        role="group"
        aria-label={ui.timeline.dateRange.granularityLabel}
      >
        {DATE_RANGES.map((range) => {
          const isActive = range === active;
          return (
            <button
              key={range}
              type="button"
              className={`tlx-range-chip${isActive ? " is-on" : ""}`}
              aria-pressed={isActive}
              onClick={() => onChange(range)}
            >
              {DATE_RANGE_LABELS[range]}
            </button>
          );
        })}
      </div>

      {/* STEPPER: ‹ PERIODO › navega en la granularidad activa; el centro muestra el periodo enfocado. */}
      <div className="tlx-range-stepper">
        <button
          type="button"
          className="tlx-range-nav"
          onClick={() => onStep(-1)}
          disabled={!canStepBack}
          aria-label={backLabel}
        >
          <span aria-hidden="true">‹</span>
        </button>
        {/* aria-live: al navegar, el lector de pantalla anuncia el nuevo periodo enfocado. */}
        <span className="tlx-range-period" aria-live="polite">
          {periodLabel}
        </span>
        <button
          type="button"
          className="tlx-range-nav"
          onClick={() => onStep(1)}
          disabled={!canStepForward}
          aria-label={forwardLabel}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {/* HOY: vuelve al periodo que contiene la fecha actual. Atenuado e inerte si ya estás en él. */}
      <button
        type="button"
        className="tlx-range-today"
        onClick={onGoToday}
        disabled={atToday}
        aria-label={ui.timeline.dateRange.goToday}
      >
        {ui.timeline.dateRange.today}
      </button>
    </div>
  );
}
