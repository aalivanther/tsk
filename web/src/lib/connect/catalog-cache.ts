// Archivo: catalog-cache.ts — Memoria de corta duración del catálogo, SOLO para respuestas correctas.
//
// El problema que resuelve, en español:
//
// El catálogo de estrenos cambia como mucho una vez al día, pero cada visita a la página lo pedía de
// nuevo al backend. Con varias personas navegando, eso son cientos de consultas idénticas para
// obtener exactamente la misma respuesta. Guardar el resultado un rato es lo obvio.
//
// El primer intento fue guardar la PÁGINA YA CONSTRUIDA durante unos minutos, que es lo que ofrece el
// framework de serie. Y ahí apareció un fallo peor que el problema original: si el backend estaba
// caído justo cuando se construyó la página, lo que quedaba guardado era la PANTALLA DE ERROR — y se
// seguía sirviendo durante todo el periodo aunque el backend se recuperara al segundo siguiente. Se
// reprodujo en una prueba real: el servicio volvía a estar sano y la página seguía diciendo "no se
// pudieron cargar los estrenos" durante cinco minutos.
//
// La solución es guardar los DATOS en vez de la página, y guardar únicamente los ÉXITOS. Así:
//   - Si el backend responde, su respuesta se reutiliza un rato y se le ahorran consultas.
//   - Si el backend falla, no se guarda nada: la siguiente visita lo vuelve a intentar de inmediato,
//     y en cuanto el servicio se recupere la página se ve bien sin esperar a que caduque nada.
//
// La memoria vive en el propio proceso del servidor. Es deliberado: no añade ninguna pieza que
// instalar ni mantener, y su único coste es que, si hubiera varias copias del servidor, cada una
// tendría la suya (lo que no es un problema: guardan lo mismo y caducan igual de rápido).

// CACHE_TTL_MS es cuánto se considera fresca una respuesta guardada.
//
// En español: cinco minutos. El catálogo se renueva a lo sumo una vez al día, así que este plazo es
// conservador de sobra; a cambio recorta las consultas al backend en más del noventa por ciento en
// cuanto hay algo de tráfico. Es corto a propósito: cuando el catálogo se refresque de verdad, el
// cambio se ve en cuestión de minutos sin tener que reiniciar ni vaciar nada a mano.
const CACHE_TTL_MS = 5 * 60 * 1000;

// MAX_ENTRIES acota cuántas respuestas distintas se guardan a la vez.
// En español: las llaves son combinaciones de año y mes, así que en la práctica son un puñado. El
// tope existe solo para que un caso imprevisto no haga crecer la memoria sin límite.
const MAX_ENTRIES = 64;

// CacheEntry es una respuesta guardada junto al momento en que caduca.
type CacheEntry<T> = {
  value: T;
  expiresAtMs: number;
};

// entries guarda las respuestas por llave. Vive a nivel de módulo para sobrevivir entre peticiones.
const entries = new Map<string, CacheEntry<unknown>>();

// readFromCache devuelve el valor guardado si sigue fresco; si caducó, lo olvida y devuelve null.
function readFromCache<T>(key: string, nowMs: number): T | null {
  const entry = entries.get(key);
  if (entry === undefined) {
    return null;
  }
  if (entry.expiresAtMs <= nowMs) {
    entries.delete(key);
    return null;
  }
  return entry.value as T;
}

// writeToCache guarda un valor con su caducidad, respetando el tope de entradas.
function writeToCache<T>(key: string, value: T, nowMs: number): void {
  // Si se alcanzó el tope, se olvida la entrada más antigua. Map conserva el orden de inserción, así
  // que la primera llave que devuelve es la que lleva más tiempo guardada.
  if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey !== undefined) {
      entries.delete(oldestKey);
    }
  }
  entries.set(key, { value, expiresAtMs: nowMs + CACHE_TTL_MS });
}

// cacheSuccessfulResult ejecuta una consulta reutilizando su resultado anterior si sigue fresco.
//
// El parámetro `isSuccess` es la pieza clave de todo el archivo: decide qué merece guardarse. Un
// resultado fallido se devuelve al llamador igual que siempre, pero NO se guarda, de modo que el
// siguiente intento vuelve a preguntar al backend en vez de repetir un error ya caducado.
export async function cacheSuccessfulResult<T>(
  key: string,
  isSuccess: (value: T) => boolean,
  load: () => Promise<T>,
): Promise<T> {
  const nowMs = Date.now();

  const cached = readFromCache<T>(key, nowMs);
  if (cached !== null) {
    return cached;
  }

  const value = await load();
  if (isSuccess(value)) {
    writeToCache(key, value, nowMs);
  }
  return value;
}

// clearCatalogCache vacía la memoria. Existe para las pruebas, que necesitan partir de cero, y para
// poder forzar un refresco desde el propio proceso si algún día hiciera falta.
export function clearCatalogCache(): void {
  entries.clear();
}
