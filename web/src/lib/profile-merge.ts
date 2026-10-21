// Archivo: profile-merge.ts — Cómo se juntan dos versiones del mismo perfil sin perder nada.
//
// El problema, en español:
//
// El perfil de cada persona (lo que quiere ver, lo que ya vio, sus notas) vive en dos sitios a la
// vez: en el navegador que tiene delante, para que la aplicación responda al instante sin esperar a
// nadie, y en el servidor, para que sea EL MISMO perfil cuando entra desde el teléfono. Dos copias
// de lo mismo significan, tarde o temprano, dos copias que no coinciden: marcó una película como
// vista en la computadora mientras el teléfono, sin señal, guardaba una reseña.
//
// La forma fácil de resolverlo es que gane la última copia que llega. Es también la forma de perder
// datos en silencio: la reseña del teléfono desaparece sin que nadie se entere, y a quien le pasa lo
// vive como "la aplicación borró mis cosas". Este archivo hace lo contrario — junta las dos versiones
// campo por campo, con una regla pensada para cada tipo de dato:
//
//   - Las LISTAS (quiero ver, ya vistas, avisos leídos) se UNEN. Que un título esté en una copia y no
//     en la otra casi siempre significa que se agregó en un sitio, no que se quitó en el otro; y
//     equivocarse dejando algo de más es infinitamente menos molesto que borrar algo de menos.
//   - Las RESEÑAS se resuelven por la actividad: cada reseña deja constancia de cuándo se puso, así
//     que gana la más reciente de las dos, que es la opinión más actual de esa persona.
//   - Los AJUSTES se toman del servidor. Son una preferencia única, no una acumulación: unirlos no
//     significaría nada, y el servidor es la copia que ya vieron los demás dispositivos.
//   - La FECHA DE ALTA es la más antigua de las dos: alguien es guardián desde que empezó, no desde
//     que estrenó su segundo dispositivo.
//   - La ACTIVIDAD se junta, se ordena por fecha y se recorta: es una memoria corta de lo último que
//     se hizo, no un historial.
//
// Todo esto vive en un archivo aparte, sin red ni navegador por medio, precisamente para poder
// comprobarlo con pruebas: es la clase de lógica en la que un error no revienta nada, solo hace
// desaparecer datos de alguien.

import type { ActivityEvent, ProfileState } from "@/lib/profile-context";

// MERGED_LIST_LIMIT es cuántos títulos como máximo puede tener cada lista tras la fusión.
//
// ESTE NÚMERO NO ES DECORATIVO: es el mismo tope que aplica el servidor (ver
// backend/internal/profile/validate.go). Si la fusión devolviera listas más largas, el servidor
// rechazaría el documento entero y —esto es lo grave— lo haría en cada intento, para siempre: el
// perfil de esa persona dejaría de sincronizarse sin ningún aviso, y solo se notaría el día que
// entrara desde otro dispositivo y no encontrara sus cosas. Unir dos listas de cuatrocientos títulos
// basta para llegar ahí.
//
// Cuando hay que recortar se conservan los ÚLTIMOS, que son los añadidos más recientemente: lo que
// alguien acaba de guardar le importa más que lo que guardó hace tres años.
const MERGED_LIST_LIMIT = 500;

// MERGED_REVIEWS_LIMIT es cuántas reseñas sobreviven a la fusión, por el mismo motivo y con el mismo
// tope que el servidor. Aquí sí hay con qué decidir cuáles: se conservan las más recientes según la
// actividad, que es donde queda constancia de cuándo se puso cada nota.
const MERGED_REVIEWS_LIMIT = 500;

// MERGED_ACTIVITY_LIMIT es cuántos eventos de actividad sobreviven a la fusión.
// En español: el mismo tope que usa el perfil normal. Al juntar dos historiales podrían salir el
// doble de eventos, y sin recorte el documento crecería cada vez que se sincroniza.
const MERGED_ACTIVITY_LIMIT = 50;

// MERGED_NOTIFICATIONS_LIMIT es cuántos avisos ya leídos se conservan tras la fusión.
const MERGED_NOTIFICATIONS_LIMIT = 200;

// unionOfLists junta dos listas de identificadores sin repetidos y conservando el orden de aparición.
//
// En español: se recorre primero una y luego la otra, saltándose lo que ya se vio. El orden importa
// poco para el usuario (la interfaz reordena por fecha de estreno), pero un orden estable evita que
// el documento parezca cambiar cuando en realidad no cambió nada.
function unionOfLists(
  first: readonly string[],
  second: readonly string[],
  limit: number,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...first, ...second]) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  // Recorte por el final: se conservan los más recientes (ver MERGED_LIST_LIMIT).
  return merged.length > limit ? merged.slice(-limit) : merged;
}

// latestReviewDates recorre la actividad y anota, por título, cuándo fue su reseña más reciente.
//
// En español: es lo que permite decidir qué nota gana sin inventarse nada. Si una copia no dejó
// constancia de cuándo se reseñó algo, ese título simplemente no aparece aquí y se resuelve por la
// regla de respaldo (ver mergeReviews).
function latestReviewDates(activity: readonly ActivityEvent[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const event of activity) {
    if (event.kind !== "review") {
      continue;
    }
    const previous = dates.get(event.id);
    if (previous === undefined || event.at > previous) {
      dates.set(event.id, event.at);
    }
  }
  return dates;
}

// mergeReviews decide, título a título, qué nota se queda.
//
// La regla: gana la reseña más reciente según la actividad. Cuando ninguna de las dos copias dejó
// constancia de la fecha —perfiles muy viejos, o actividad ya recortada por antigüedad—, se conserva
// la del servidor: es la que los demás dispositivos ya han visto, así que respetarla evita que un
// dispositivo que llevaba tiempo apagado resucite una opinión vieja.
function mergeReviews(
  localProfile: ProfileState,
  serverProfile: ProfileState,
): Record<string, number> {
  const localDates = latestReviewDates(localProfile.activity);
  const serverDates = latestReviewDates(serverProfile.activity);

  const merged: Record<string, number> = { ...serverProfile.reviews };

  for (const [releaseId, localScore] of Object.entries(localProfile.reviews)) {
    const serverScore = serverProfile.reviews[releaseId];
    if (serverScore === undefined) {
      // Solo existe en este dispositivo: se suma sin discusión.
      merged[releaseId] = localScore;
      continue;
    }
    if (serverScore === localScore) {
      continue;
    }
    const localDate = localDates.get(releaseId);
    const serverDate = serverDates.get(releaseId);
    if (localDate !== undefined && (serverDate === undefined || localDate > serverDate)) {
      merged[releaseId] = localScore;
    }
  }

  return capReviews(merged, localDates, serverDates);
}

// capReviews recorta las reseñas al tope que acepta el servidor, quedándose con las más recientes.
//
// En español: se ordena por la fecha que consta en la actividad —la más nueva primero— y se corta.
// Las que no tienen fecha conocida van al final, porque son las más antiguas (su rastro en la
// actividad ya se recortó por edad). Si no hay que recortar nada, se devuelve tal cual y ni siquiera
// se ordena.
function capReviews(
  reviews: Record<string, number>,
  localDates: Map<string, string>,
  serverDates: Map<string, string>,
): Record<string, number> {
  const entries = Object.entries(reviews);
  if (entries.length <= MERGED_REVIEWS_LIMIT) {
    return reviews;
  }

  const dateOf = (releaseId: string): string => {
    const local = localDates.get(releaseId) ?? "";
    const server = serverDates.get(releaseId) ?? "";
    return local > server ? local : server;
  };

  entries.sort((first, second) => {
    const firstDate = dateOf(first[0]);
    const secondDate = dateOf(second[0]);
    return firstDate < secondDate ? 1 : firstDate > secondDate ? -1 : 0;
  });

  return Object.fromEntries(entries.slice(0, MERGED_REVIEWS_LIMIT));
}

// mergeActivity junta los dos historiales, quita repeticiones y se queda con lo más reciente.
//
// Dos eventos se consideran EL MISMO si coinciden en qué se hizo, sobre qué título y qué día. Es la
// definición correcta aquí: la misma acción registrada en los dos dispositivos no debe aparecer dos
// veces en "tu actividad reciente".
function mergeActivity(
  localActivity: readonly ActivityEvent[],
  serverActivity: readonly ActivityEvent[],
): ActivityEvent[] {
  const merged: ActivityEvent[] = [];
  const seen = new Set<string>();
  for (const event of [...localActivity, ...serverActivity]) {
    const identity = `${event.kind}|${event.id}|${event.at}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    merged.push(event);
  }
  // Más reciente primero, que es como lo espera la pantalla de perfil.
  merged.sort((first, second) => (first.at < second.at ? 1 : first.at > second.at ? -1 : 0));
  return merged.slice(0, MERGED_ACTIVITY_LIMIT);
}

// earliestDate devuelve la más antigua de dos fechas ISO, ignorando las vacías.
function earliestDate(first: string, second: string): string {
  if (first === "") {
    return second;
  }
  if (second === "") {
    return first;
  }
  return first < second ? first : second;
}

// mergeProfiles junta el perfil de este dispositivo con el que tiene el servidor.
//
// El resultado es SIEMPRE un perfil nuevo: no se modifica ninguno de los dos que entran. Eso importa
// porque quien llama sigue usando el suyo mientras tanto, y un cambio por sorpresa debajo de la
// interfaz produce fallos que solo aparecen a veces y son muy difíciles de reproducir.
export function mergeProfiles(
  localProfile: ProfileState,
  serverProfile: ProfileState,
): ProfileState {
  return {
    watchlist: unionOfLists(localProfile.watchlist, serverProfile.watchlist, MERGED_LIST_LIMIT),
    watched: unionOfLists(localProfile.watched, serverProfile.watched, MERGED_LIST_LIMIT),
    reviews: mergeReviews(localProfile, serverProfile),
    // Los ajustes son una preferencia única: manda el servidor (ver la explicación de la cabecera).
    settings: { ...serverProfile.settings },
    createdAt: earliestDate(localProfile.createdAt, serverProfile.createdAt),
    activity: mergeActivity(localProfile.activity, serverProfile.activity),
    seenNotifications: unionOfLists(
      localProfile.seenNotifications,
      serverProfile.seenNotifications,
      MERGED_NOTIFICATIONS_LIMIT,
    ),
  };
}

// isEmptyProfile dice si un perfil no tiene nada que merezca conservarse.
//
// En español: sirve para distinguir "esta persona todavía no ha guardado nada" de "esta persona tiene
// datos". Es lo que decide, al entrar por primera vez desde un dispositivo nuevo, si hay que subir lo
// de aquí o simplemente traerse lo de allá. Los ajustes NO cuentan como contenido: un perfil solo con
// el tema elegido sigue estando vacío para este propósito.
export function isEmptyProfile(profile: ProfileState): boolean {
  return (
    profile.watchlist.length === 0 &&
    profile.watched.length === 0 &&
    Object.keys(profile.reviews).length === 0 &&
    profile.activity.length === 0
  );
}
