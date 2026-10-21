"use client";

// Archivo: AgendaMobile.tsx — La vista de catálogo DEDICADA A MÓVIL: una agenda vertical.
//
// En español: en escritorio, el producto se presenta como una ESPINA horizontal que se arrastra de
// lado (su firma visual). En un teléfono esa cinta obliga a arrastrar para descubrir contenido y, en
// pantallas estrechas, esconde casi todo lo que hay. Esta pantalla resuelve lo mismo girando el eje:
// la espina dorada baja por el margen izquierdo, cada día es una FILA y los paquetes por categoría
// cuelgan a la derecha. Se conserva íntegro el lenguaje visual (espina, nodos, rareza, marca de agua
// del mes, marca de gusto ♥); lo único que cambia es la dirección de lectura, que en móvil es
// vertical — como el resto del teléfono.
//
// Decisiones de diseño explícitas:
//   - Encabezado de mes PEGAJOSO (sticky): al recorrer meses, siempre se sabe en cuál se está.
//   - Solo se listan los días CON estrenos: en vertical, un calendario completo obligaría a
//     desplazarse por decenas de filas vacías (en horizontal sí aportaban continuidad visual).
//   - La fila de HOY va marcada y es el punto al que salta "Ir a hoy".
//   - Cada paquete es un botón de 44px de alto mínimo (área táctil fiable) que abre el mismo overlay
//     que en escritorio: la lógica del flujo de 3 niveles NO se duplica.

import { memo, useEffect, useMemo, useRef } from "react";

import { tmdbImage } from "@/lib/images";
import { deriveRarity } from "@/lib/rarity";
import { useProfile } from "@/lib/profile-context";
import { useFilter } from "@/lib/timeline-context";
import {
  CATEGORY_META,
  MONTHS,
  cssUrl,
  groupByMonth,
  matchesFilter,
  yearOfMonth,
  type CategoryKey,
  type CategoryPackage,
  type MonthGroup,
  type TodayMarker,
} from "@/lib/timeline";
import { ui } from "@/lib/i18n";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// AgendaMobileProps son los datos que necesita la agenda: el catálogo, HOY y el gancho del overlay.
type AgendaMobileProps = {
  // releases es el catálogo completo de la ventana de meses vigente (sin filtrar: filtra la agenda).
  releases: ReleaseSummary[];
  // today es el marcador HOY: marca su fila y decide qué está por venir.
  today: TodayMarker;
  // onOpenPackage abre el overlay de categoría (el MISMO que usa la espina de escritorio).
  onOpenPackage: (month: number, day: number, categoryKey: CategoryKey) => void;
};

// releaseMatchesPrefs indica si un estreno encaja con los gustos del usuario (género o plataforma).
// Es la misma regla que aplica la espina de escritorio, para que la marca ♥ signifique lo mismo.
function releaseMatchesPrefs(
  release: ReleaseSummary,
  genreSet: Set<string>,
  platformSet: Set<string>,
): boolean {
  for (const genre of release.genres) {
    if (genreSet.has(genre)) {
      return true;
    }
  }
  for (const platform of release.availability?.platforms ?? []) {
    if (platformSet.has(platform)) {
      return true;
    }
  }
  return false;
}

// AgendaMobile dibuja la lista vertical de meses y días con sus paquetes.
export function AgendaMobile({ releases, today, onOpenPackage }: AgendaMobileProps) {
  const { filter, registerGoToToday, registerScrollToDate } = useFilter();

  // Gustos del usuario, calculados UNA vez para toda la agenda (igual que en la espina): así las
  // filas memoizadas no se re-renderizan cuando cambia cualquier otra parte del perfil.
  const { profile } = useProfile();
  const genreSet = useMemo(() => new Set(profile.settings.genres), [profile.settings.genres]);
  const platformSet = useMemo(
    () => new Set(profile.settings.platforms),
    [profile.settings.platforms],
  );

  // Agrupamos aplicando el filtro activo ANTES, para que los conteos reflejen lo que se ve.
  // A diferencia de la espina, aquí NO se usa el calendario completo: solo los días con estrenos.
  const monthGroups = useMemo<MonthGroup[]>(
    () => groupByMonth(releases.filter((release) => matchesFilter(release, filter))),
    [releases, filter],
  );

  // Referencias a cada fila de día ("mes-día") para poder saltar a una fecha concreta.
  const dayRefs = useRef<Map<string, HTMLElement>>(new Map());

  // monthSections son los meses a pintar con la función de registro de cada día YA preparada.
  //
  // Por qué existe, en español: cada fila de la agenda está "memoizada", que significa que React
  // promete no volver a dibujarla si sus datos no han cambiado. Esa promesa se comprueba comparando
  // las props una por una, y una función escrita directamente dentro del JSX es un objeto NUEVO en
  // cada dibujado — distinto del anterior aunque haga exactamente lo mismo. Bastaba con eso para que
  // la comparación fallara SIEMPRE y se redibujaran todas las filas ante cualquier cambio ajeno
  // (marcar un título como visto, por ejemplo, redibujaba la agenda entera). La memoización estaba
  // puesta pero no servía absolutamente de nada.
  //
  // Preparando aquí las funciones, cada fila recibe exactamente la misma en cada dibujado mientras el
  // contenido de la agenda no cambie, y la comparación de React vuelve a dar el resultado correcto.
  // Solo se rehacen cuando cambian los días mostrados, que es justo cuando las filas cambian igualmente.
  //
  // Cada función de registro es la que React llama con el elemento cuando la fila aparece en pantalla
  // y con null cuando desaparece; por eso el null borra la entrada en vez de guardarla (una referencia
  // a algo que ya no está en pantalla haría que "Ir a hoy" intentara desplazarse a la nada).
  const monthSections = useMemo(
    () =>
      monthGroups.map((monthGroup) => ({
        monthGroup,
        days: monthGroup.days.map((dayGroup) => {
          const dayKey = `${monthGroup.year}-${monthGroup.month}-${dayGroup.day}`;
          return {
            dayGroup,
            registerRef: (element: HTMLElement | null) => {
              if (element === null) {
                dayRefs.current.delete(dayKey);
                return;
              }
              dayRefs.current.set(dayKey, element);
            },
          };
        }),
      })),
    [monthGroups],
  );

  // scrollToDate centra la fila del día pedido; si ese día no tiene fila (no hay estrenos), busca la
  // más cercana del mismo mes. Es la misma semántica que en escritorio, en vertical.
  const scrollToDate = useMemo(
    () => (month: number, day: number) => {
      const refs = dayRefs.current;
      const year = yearOfMonth(today, month);
      let target = refs.get(`${year}-${month}-${day}`);
      if (target === undefined) {
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const [key, element] of refs) {
          const [keyYear, keyMonth, keyDay] = key.split("-").map(Number);
          if (keyYear !== year || keyMonth !== month) {
            continue;
          }
          const distance = Math.abs(keyDay - day);
          if (distance < bestDistance) {
            bestDistance = distance;
            target = element;
          }
        }
      }
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [today],
  );

  // "Ir a hoy" en vertical: lleva a la fila de HOY (o a la más cercana).
  const scrollToToday = useMemo(
    () => () => scrollToDate(today.month, today.day),
    [scrollToDate, today.month, today.day],
  );

  // Registramos ambos saltos en el contexto para que el Topbar y el navegador de fecha los usen,
  // exactamente igual que hace la espina de escritorio.
  useEffect(() => registerGoToToday(scrollToToday), [registerGoToToday, scrollToToday]);
  useEffect(() => registerScrollToDate(scrollToDate), [registerScrollToDate, scrollToDate]);

  // Al montar, aterrizamos en HOY: es el punto de referencia del producto.
  useEffect(() => {
    const target =
      dayRefs.current.get(`${today.year}-${today.month}-${today.day}`) ??
      // Si hoy no tiene estrenos, buscamos el primer día POSTERIOR con contenido ("lo que viene").
      [...dayRefs.current.entries()]
        .map(([key, element]) => {
          const [year, month, day] = key.split("-").map(Number);
          return { year, month, day, element };
        })
        .filter(
          (entry) =>
            entry.year > today.year ||
            (entry.year === today.year && entry.month > today.month) ||
            (entry.year === today.year && entry.month === today.month && entry.day >= today.day),
        )
        .sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day)[0]?.element;
    target?.scrollIntoView({ behavior: "auto", block: "center" });
    // Solo al montar: después manda el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Estado VACÍO: el filtro dejó la agenda sin nada que mostrar.
  const hasAnyDay = monthGroups.some((group) => group.days.length > 0);

  return (
    <div className="ag-root">
      {!hasAnyDay ? (
        <p className="ag-empty font-mono" role="status">
          {ui.timeline.emptyHint}
        </p>
      ) : (
        monthSections.map(({ monthGroup, days }) => (
          <section
            key={`${monthGroup.year}-${monthGroup.month}`}
            className="ag-month"
            aria-label={`${monthGroup.label} ${monthGroup.year}`}
          >
            {/* Encabezado de mes pegajoso: la referencia temporal siempre visible al desplazarse. */}
            <h2 className="ag-month-head font-hud">
              <span className="ag-month-name">
                {monthGroup.label || MONTHS[monthGroup.month]} {monthGroup.year}
              </span>
              <span className="ag-month-count font-mono">
                {monthGroup.days.reduce(
                  (sum, day) => sum + day.packages.reduce((s, p) => s + p.count, 0),
                  0,
                )}
              </span>
            </h2>

            {days.map(({ dayGroup, registerRef }) => {
              const isToday =
                monthGroup.year === today.year &&
                monthGroup.month === today.month &&
                dayGroup.day === today.day;
              const isPast =
                monthGroup.year < today.year ||
                (monthGroup.year === today.year && monthGroup.month < today.month) ||
                (monthGroup.year === today.year &&
                  monthGroup.month === today.month &&
                  dayGroup.day < today.day);
              return (
                <AgendaDay
                  key={dayGroup.day}
                  month={monthGroup.month}
                  day={dayGroup.day}
                  weekdayFull={dayGroup.weekdayFull || dayGroup.weekdayShort}
                  packages={dayGroup.packages}
                  isToday={isToday}
                  isPast={isPast}
                  genreSet={genreSet}
                  platformSet={platformSet}
                  onOpenPackage={onOpenPackage}
                  // La función de registro viene ya preparada de arriba: conserva su identidad entre
                  // dibujados, que es lo que hace que la memoización de la fila sirva de algo.
                  registerRef={registerRef}
                />
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}

// AgendaDayProps son las props de UNA fila de día de la agenda.
type AgendaDayProps = {
  month: number;
  day: number;
  weekdayFull: string;
  packages: CategoryPackage[];
  isToday: boolean;
  isPast: boolean;
  genreSet: Set<string>;
  platformSet: Set<string>;
  onOpenPackage: (month: number, day: number, categoryKey: CategoryKey) => void;
  registerRef: (element: HTMLElement | null) => void;
};

// AgendaDay dibuja una fila: nodo sobre la espina + fecha + los paquetes de ese día.
// Memoizado por el mismo motivo que las estaciones de la espina: son muchas y no deben re-renderizarse
// cuando cambia algo ajeno (por ejemplo, marcar un título en la watchlist).
const AgendaDay = memo(function AgendaDay({
  month,
  day,
  weekdayFull,
  packages,
  isToday,
  isPast,
  genreSet,
  platformSet,
  onOpenPackage,
  registerRef,
}: AgendaDayProps) {
  const total = packages.reduce((sum, group) => sum + group.count, 0);

  return (
    <article
      ref={registerRef}
      className="ag-day"
      data-today={isToday ? "true" : undefined}
      data-past={isPast ? "true" : undefined}
    >
      {/* Columna izquierda: el nodo sobre la espina y la fecha. La espina es un pseudo-elemento del
          contenedor (globals.css), así que aquí solo va el nodo y el texto. */}
      <div className="ag-day-axis">
        <span aria-hidden="true" className="ag-day-node" />
        <span className="ag-day-num font-mono">{String(day).padStart(2, "0")}</span>
        <span className="ag-day-dow font-mono">{weekdayFull.slice(0, 3).toUpperCase()}</span>
      </div>

      {/* Columna derecha: los paquetes por categoría de ese día. */}
      <div className="ag-day-body">
        {isToday ? <span className="ag-today-flag font-hud">{ui.timeline.nowLabel}</span> : null}
        {packages.map((categoryPackage) => (
          <AgendaPackage
            key={categoryPackage.categoryKey}
            month={month}
            day={day}
            categoryPackage={categoryPackage}
            upcoming={!isPast}
            matchesTaste={
              (genreSet.size > 0 || platformSet.size > 0) &&
              categoryPackage.items.some((item) => releaseMatchesPrefs(item, genreSet, platformSet))
            }
            onOpenPackage={onOpenPackage}
          />
        ))}
        <span className="sr-only">{`${total} ${total === 1 ? "estreno" : "estrenos"}`}</span>
      </div>
    </article>
  );
});

// AgendaPackageProps son las props de un paquete (categoría de un día) dentro de la agenda.
type AgendaPackageProps = {
  month: number;
  day: number;
  categoryPackage: CategoryPackage;
  upcoming: boolean;
  matchesTaste: boolean;
  onOpenPackage: (month: number, day: number, categoryKey: CategoryKey) => void;
};

// AgendaPackage es el botón de un paquete: banner del mejor título, categoría, conteo y calificación.
// Es más ancho y alto que el chip de escritorio porque en móvil hay espacio horizontal de sobra
// (una columna) y lo que escasea es la precisión del dedo.
function AgendaPackage({
  month,
  day,
  categoryPackage,
  upcoming,
  matchesTaste,
  onOpenPackage,
}: AgendaPackageProps) {
  const meta = CATEGORY_META[categoryPackage.categoryKey];
  const tier = deriveRarity(Number.parseFloat(categoryPackage.maxTmdb));
  const score = Number.parseFloat(categoryPackage.maxTmdb);
  // Título destacado: el mejor calificado del paquete, para que la fila diga QUÉ se estrena y no
  // solo "3 estrenos de cine". Es la diferencia entre una agenda útil y un contador.
  const headline = categoryPackage.items[0]?.title ?? "";

  return (
    <button
      type="button"
      className={`ag-pkg ag-pkg-${categoryPackage.categoryKey} ag-tier-${tier}${matchesTaste ? " is-match" : ""}`}
      onClick={() => onOpenPackage(month, day, categoryPackage.categoryKey)}
      aria-label={ui.timeline.packageAriaLabel(
        meta.label,
        day,
        (MONTHS[month] ?? "").toLowerCase(),
        categoryPackage.count,
        categoryPackage.maxTmdb,
      )}
    >
      {/* Mini-banner del título más importante del paquete (decorativo: el texto ya lo nombra). */}
      {categoryPackage.bannerUrl !== "" ? (
        <span
          aria-hidden="true"
          className="ag-pkg-banner"
          // El banner de una fila mide ~310px de ancho: se pide la variante pequeña de la imagen en
          // lugar de la de 1280px que guarda el catálogo (más de cuatro veces el peso necesario).
          style={{ backgroundImage: cssUrl(tmdbImage(categoryPackage.bannerUrl, "thumb")) }}
        />
      ) : null}

      <span className="ag-pkg-body">
        <span className="ag-pkg-top font-mono">
          <span className="ag-pkg-cat">{meta.label}</span>
          {categoryPackage.count > 1 ? (
            <span className="ag-pkg-count">+{categoryPackage.count - 1}</span>
          ) : null}
        </span>
        <span className="ag-pkg-title font-display">{headline}</span>
      </span>

      <span className="ag-pkg-score font-mono">
        {score > 0 ? (
          <>
            <span aria-hidden="true">★ </span>
            {categoryPackage.maxTmdb}
          </>
        ) : upcoming ? (
          ui.status.upcomingShort
        ) : (
          ui.status.dash
        )}
      </span>

      {matchesTaste ? (
        <span aria-hidden="true" className="ag-pkg-match">
          ♥
        </span>
      ) : null}
    </button>
  );
}
