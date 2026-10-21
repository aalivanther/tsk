// Archivo: ScheduleCalendar.tsx — El CALENDARIO DE EMISIÓN de una serie (fechas reales de episodios).
//
// En español: las series y los contenidos por entregas no tienen UNA fecha (como las películas), sino
// un CALENDARIO: cada episodio sale un día concreto. El backend trae esas fechas reales (mensaje
// Schedule, generado desde TMDB con la herramienta schedulegen) y este componente las presenta en dos
// piezas integradas al lenguaje visual del detalle:
//   1) PRÓXIMAS ENTREGAS: una lista corta de los episodios que vienen (o los últimos, si ya terminó),
//      con su S#E#, su nombre y su fecha, y el más cercano resaltado en oro.
//   2) MINI-CALENDARIOS por mes: una cuadrícula Lun..Dom por cada mes con episodios; los días con
//      entrega se marcan con el acento de la serie y el día de HOY se enmarca.
// Es un componente PURO de presentación: recibe el calendario ya armado y el marcador HOY; no hace
// fetch ni guarda estado. Todas las fechas se interpretan en UTC (igual que el resto de la app) para
// que el día mostrado no se "corra" según la zona horaria de quien mira.

import { type JSX } from "react";

import { ui } from "@/lib/i18n";
import { MONTHS, type TodayMarker } from "@/lib/timeline";
import { type EpisodeDate, type Schedule } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// UPCOMING_LIST_LIMIT es cuántas entregas muestra la lista de "próximas" (las más cercanas a hoy).
const UPCOMING_LIST_LIMIT = 5;

// WEEKDAY_HEADERS son las iniciales de los días (Lun..Dom) para la cabecera de cada mini-calendario.
const WEEKDAY_HEADERS: readonly string[] = ["L", "M", "M", "J", "V", "S", "D"] as const;

// ScheduleCalendarProps son las props del calendario de emisión.
type ScheduleCalendarProps = {
  // schedule es el calendario real de la serie (episodios con fecha, ya ordenados por el backend).
  schedule: Schedule;
  // today es el marcador HOY (opcional): resalta el día actual y decide qué entregas son "próximas".
  // Si no llega (montajes sin fecha de referencia), la lista muestra las primeras entregas sin resaltes.
  today?: TodayMarker;
};

// ParsedEpisode es un episodio con su fecha ya descompuesta (año/mes/día) para agrupar y comparar.
type ParsedEpisode = {
  episode: EpisodeDate;
  year: number;
  month: number;
  day: number;
};

// parseEpisodes descompone la fecha ISO de cada episodio en números, descartando fechas inválidas.
// En español: leemos los componentes directamente del texto "AAAA-MM-DD" (sin objetos Date) para que
// el resultado sea idéntico en servidor y navegador (sin zona horaria de por medio).
function parseEpisodes(schedule: Schedule): ParsedEpisode[] {
  const parsed: ParsedEpisode[] = [];
  for (const episode of schedule.episodes) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(episode.airDate);
    if (match === null) {
      continue;
    }
    parsed.push({
      episode,
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    });
  }
  return parsed;
}

// compareToToday devuelve negativo/cero/positivo según si la fecha es anterior/igual/posterior a HOY.
function compareToToday(entry: ParsedEpisode, today: TodayMarker): number {
  if (entry.year !== today.year) {
    return entry.year - today.year;
  }
  if (entry.month !== today.month) {
    return entry.month - today.month;
  }
  return entry.day - today.day;
}

// formatEpisodeCode arma el código corto del episodio (ej. "T1·E4") para la lista de entregas.
function formatEpisodeCode(episode: EpisodeDate): string {
  return `T${episode.season}·E${episode.number}`;
}

// formatShortDate arma la fecha corta es-MX de una entrega (ej. "15 jun") desde sus componentes.
function formatShortDate(entry: ParsedEpisode): string {
  const monthName = (MONTHS[entry.month] ?? "").slice(0, 3).toLowerCase();
  return `${String(entry.day).padStart(2, "0")} ${monthName}`;
}

// daysInMonthUTC devuelve cuántos días tiene un mes (1-12) de un año, vía el truco del "día 0".
function daysInMonthUTC(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// firstWeekdayIndexUTC devuelve el índice (0=lunes..6=domingo) del PRIMER día del mes, para saber
// cuántas celdas vacías van antes del día 1 en la cuadrícula.
function firstWeekdayIndexUTC(year: number, month: number): number {
  const sundayBased = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (sundayBased + 6) % 7;
}

// MonthBucket agrupa los episodios de UN mes para su mini-calendario.
type MonthBucket = {
  year: number;
  month: number;
  // episodesByDay junta los episodios de cada día del mes (un día puede traer varios: estrenos binge).
  episodesByDay: Map<number, EpisodeDate[]>;
};

// groupByMonthYear agrupa los episodios por año+mes, en orden cronológico.
function groupByMonthYear(entries: ParsedEpisode[]): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>();
  for (const entry of entries) {
    const key = `${entry.year}-${entry.month}`;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { year: entry.year, month: entry.month, episodesByDay: new Map() };
      buckets.set(key, bucket);
    }
    const dayList = bucket.episodesByDay.get(entry.day);
    if (dayList === undefined) {
      bucket.episodesByDay.set(entry.day, [entry.episode]);
    } else {
      dayList.push(entry.episode);
    }
  }
  return Array.from(buckets.values()).sort((left, right) =>
    left.year !== right.year ? left.year - right.year : left.month - right.month,
  );
}

// ScheduleCalendar dibuja la lista de próximas entregas + los mini-calendarios por mes.
export function ScheduleCalendar({ schedule, today }: ScheduleCalendarProps): JSX.Element | null {
  const entries = parseEpisodes(schedule);
  if (entries.length === 0) {
    return null;
  }

  // PRÓXIMAS entregas: las de hoy en adelante. Si la serie ya terminó (no queda ninguna), mostramos
  // las ÚLTIMAS emitidas (información real igual de útil), etiquetadas como "últimas entregas".
  const upcomingEntries =
    today !== undefined ? entries.filter((entry) => compareToToday(entry, today) >= 0) : entries;
  const showingUpcoming = upcomingEntries.length > 0;
  const listEntries = showingUpcoming
    ? upcomingEntries.slice(0, UPCOMING_LIST_LIMIT)
    : entries.slice(-UPCOMING_LIST_LIMIT);
  // La entrega MÁS CERCANA a hoy se resalta en oro (es "la que sigue").
  const nextKey = showingUpcoming && today !== undefined ? entryKey(listEntries[0]) : null;

  const monthBuckets = groupByMonthYear(entries);

  return (
    <div className="rf-cal">
      {/* Lista corta de entregas: S#E#, nombre (si lo hay) y fecha; la próxima va resaltada. */}
      <p className="rf-cal-list-label font-mono">
        {showingUpcoming ? ui.detail.scheduleUpcoming : ui.detail.scheduleLatest}
      </p>
      <ul className="rf-cal-list">
        {listEntries.map((entry) => {
          const isNext = nextKey !== null && entryKey(entry) === nextKey;
          return (
            <li
              key={entryKey(entry)}
              className="rf-cal-item"
              data-next={isNext ? "true" : undefined}
            >
              <span className="rf-cal-code font-mono">{formatEpisodeCode(entry.episode)}</span>
              <span className="rf-cal-name">
                {entry.episode.name || ui.detail.scheduleUnnamedEpisode}
              </span>
              <span className="rf-cal-date font-mono">{formatShortDate(entry)}</span>
            </li>
          );
        })}
      </ul>

      {/* Mini-calendarios: una cuadrícula Lun..Dom por cada mes con entregas. */}
      <div className="rf-cal-months">
        {monthBuckets.map((bucket) => (
          <MonthGrid key={`${bucket.year}-${bucket.month}`} bucket={bucket} today={today} />
        ))}
      </div>
    </div>
  );
}

// entryKey identifica una entrega de forma estable (temporada+episodio+fecha) para keys y comparación.
function entryKey(entry: ParsedEpisode): string {
  return `${entry.episode.season}-${entry.episode.number}-${entry.episode.airDate}`;
}

// MonthGrid dibuja el mini-calendario de UN mes: cabecera con su nombre, fila Lun..Dom y la cuadrícula
// de días, marcando con el acento los días con entrega y enmarcando el día de HOY si cae en este mes.
function MonthGrid({ bucket, today }: { bucket: MonthBucket; today?: TodayMarker }): JSX.Element {
  const monthName = MONTHS[bucket.month] ?? String(bucket.month);
  const totalDays = daysInMonthUTC(bucket.year, bucket.month);
  const leadingBlanks = firstWeekdayIndexUTC(bucket.year, bucket.month);

  // Armamos las celdas: huecos iniciales (para alinear el día 1 con su día de semana) + los días reales.
  const cells: JSX.Element[] = [];
  for (let blank = 0; blank < leadingBlanks; blank += 1) {
    cells.push(<span key={`blank-${blank}`} className="rf-cal-cell" aria-hidden="true" />);
  }
  for (let day = 1; day <= totalDays; day += 1) {
    const episodes = bucket.episodesByDay.get(day);
    const hasEpisodes = episodes !== undefined && episodes.length > 0;
    const isToday =
      today !== undefined &&
      today.year === bucket.year &&
      today.month === bucket.month &&
      today.day === day;
    // Etiqueta accesible solo en los días CON entrega (los demás son relleno del mes).
    const ariaLabel = hasEpisodes
      ? ui.detail.scheduleDayAria(day, monthName.toLowerCase(), episodes.length)
      : undefined;
    cells.push(
      <span
        key={`day-${day}`}
        className="rf-cal-cell rf-cal-day font-mono"
        data-episodes={hasEpisodes ? "true" : undefined}
        data-today={isToday ? "true" : undefined}
        aria-label={ariaLabel}
        // Los días sin entrega son decorativos (el dato útil son los días marcados y HOY).
        aria-hidden={ariaLabel === undefined ? true : undefined}
        title={
          hasEpisodes ? episodes.map((episode) => formatEpisodeCode(episode)).join(", ") : undefined
        }
      >
        {day}
      </span>,
    );
  }

  return (
    <div className="rf-cal-month">
      <p className="rf-cal-month-name font-mono">{monthName.toLowerCase()}</p>
      <div
        className="rf-cal-grid"
        role="img"
        aria-label={ui.detail.scheduleMonthAria(monthName.toLowerCase())}
      >
        {WEEKDAY_HEADERS.map((header, index) => (
          <span key={`h-${index}`} className="rf-cal-cell rf-cal-head font-mono" aria-hidden="true">
            {header}
          </span>
        ))}
        {cells}
      </div>
    </div>
  );
}
