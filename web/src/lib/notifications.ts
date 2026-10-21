// Archivo: notifications.ts — Derivación PURA de los AVISOS in-app de los títulos que el usuario sigue.
//
// En español: el usuario "sigue" títulos (su watchlist). The Story Keeper le avisa DENTRO de la app, en
// DOS TIEMPOS por cada título:
//   1) ESTRENO ("release"): cuando el título sale —su fecha de estreno está por llegar o acaba de pasar—.
//   2) EN PLATAFORMAS ("platform"): cuando YA se puede ver en streaming/cadenas. Como el catálogo no trae
//      la fecha exacta de llegada a plataformas, este aviso se DERIVA de la disponibilidad real: se
//      dispara cuando el título tiene plataformas/cadenas listadas y su fecha de estreno ya pasó. No se
//      inventan fechas: si no hay disponibilidad conocida, no hay segundo aviso.
//
// Es PURO: recibe la watchlist (ids), el catálogo cargado y el marcador HOY, y devuelve la lista de avisos
// ya ordenada. No toca el DOM ni localStorage; el estado de "leído" lo maneja el perfil (seenNotifications).

import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { type TodayMarker } from "@/lib/timeline";

// RELEASE_PAST_WINDOW_DAYS / RELEASE_FUTURE_WINDOW_DAYS acotan la ventana de relevancia del aviso de
// ESTRENO: avisamos de lo que sale pronto (hasta 30 días antes) y de lo recién estrenado (hasta 7 días
// después). Fuera de esa ventana, un estreno ya no genera aviso de "sale" (sería ruido viejo).
const RELEASE_FUTURE_WINDOW_DAYS = 30;
const RELEASE_PAST_WINDOW_DAYS = 7;

// NotificationKind es el TIPO de aviso: el estreno del título o su llegada a plataformas.
export type NotificationKind = "release" | "platform";

// AppNotification es UN aviso in-app ya listo para mostrar.
export type AppNotification = {
  // id es estable ("kind:releaseId") para marcarlo como leído sin duplicar.
  id: string;
  // kind distingue el aviso de estreno del de plataformas (los "2 tiempos").
  kind: NotificationKind;
  // releaseId es el título al que pertenece (para enlazar a su ficha).
  releaseId: string;
  // title es el nombre del título (para el texto del aviso).
  title: string;
  // date es la fecha de estreno de referencia (ISO AAAA-MM-DD).
  date: string;
  // daysFromToday es la distancia en días a HOY (negativa = ya pasó). Ordena y redacta el aviso.
  daysFromToday: number;
  // platforms son las plataformas/cadenas donde verlo (solo en avisos "platform").
  platforms: string[];
};

// dayDistanceFromToday devuelve la distancia EN DÍAS (con signo) entre una fecha ISO y HOY (UTC).
// Negativa si ya pasó, positiva si está por venir; Infinity si la fecha no es válida.
// En español: usamos el AÑO REAL de la fecha del estreno (match[1]), no el año de HOY. Antes se
// ignoraba el año capturado y todo se calculaba "dentro del año de hoy": funcionaba solo porque el
// catálogo entero era 2026 — un título de otro año habría generado avisos con distancias absurdas.
function dayDistanceFromToday(releaseDate: string, today: TodayMarker): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(releaseDate);
  if (match === null) {
    return Number.POSITIVE_INFINITY;
  }
  const releaseTime = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const todayTime = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((releaseTime - todayTime) / 86_400_000);
}

// buildNotifications deriva los avisos de la watchlist según el catálogo y HOY (los 2 tiempos por título).
// En español: por cada título seguido que exista en el catálogo, genera (a) un aviso de ESTRENO si su
// fecha cae en la ventana de relevancia, y (b) un aviso de PLATAFORMAS si ya se puede ver (tiene
// plataformas/cadenas y su fecha ya pasó). La lista sale ordenada por cercanía a HOY (lo más inminente
// primero) y, a igualdad, el aviso de estreno antes que el de plataformas.
export function buildNotifications(
  watchlistIds: string[],
  catalog: ReleaseSummary[],
  today: TodayMarker,
): AppNotification[] {
  const byId = new Map(catalog.map((release) => [release.id, release]));
  const notifications: AppNotification[] = [];

  for (const id of watchlistIds) {
    const release = byId.get(id);
    if (release === undefined) {
      continue;
    }
    const distance = dayDistanceFromToday(release.releaseDate, today);
    if (!Number.isFinite(distance)) {
      continue;
    }

    // (1) ESTRENO: dentro de la ventana de relevancia (por venir pronto o recién estrenado).
    if (distance <= RELEASE_FUTURE_WINDOW_DAYS && distance >= -RELEASE_PAST_WINDOW_DAYS) {
      notifications.push({
        id: `release:${id}`,
        kind: "release",
        releaseId: id,
        title: release.title,
        date: release.releaseDate,
        daysFromToday: distance,
        platforms: [],
      });
    }

    // (2) EN PLATAFORMAS: ya estrenado (distance <= 0) y con disponibilidad real conocida.
    const platforms = [
      ...(release.availability?.platforms ?? []),
      ...(release.availability?.networks ?? []),
    ];
    if (distance <= 0 && platforms.length > 0) {
      notifications.push({
        id: `platform:${id}`,
        kind: "platform",
        releaseId: id,
        title: release.title,
        date: release.releaseDate,
        daysFromToday: distance,
        platforms,
      });
    }
  }

  // Orden: por cercanía a HOY (|días|); a igualdad, el estreno antes que el de plataformas.
  notifications.sort((left, right) => {
    const byDistance = Math.abs(left.daysFromToday) - Math.abs(right.daysFromToday);
    if (byDistance !== 0) {
      return byDistance;
    }
    return left.kind === right.kind ? 0 : left.kind === "release" ? -1 : 1;
  });

  return notifications;
}
