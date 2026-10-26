"use client";

// Archivo: profile-context.tsx — El perfil del usuario: en este navegador y, con cuenta, en el servidor.
//
// En español: el perfil vive en DOS sitios a la vez, y el reparto es deliberado. En este navegador,
// para que todo responda al instante sin esperar a la red; y en el servidor, para quien tiene cuenta,
// de modo que su biblioteca sea la misma en la computadora y en el teléfono. La sincronización se
// explica en lib/connect/profile-sync.ts y la forma de juntar dos versiones distintas del mismo
// perfil, en lib/profile-merge.ts. Quien navega sin cuenta funciona exactamente igual que antes: solo
// se usa este navegador y nunca se llama al servidor. Lo que se guarda aquí:
//   - watchlist: ids de estrenos que el usuario "quiere ver".
//   - watched:   ids de estrenos "vistos" (su biblioteca).
//   - reviews:   nota (1–10, con decimales) por estreno reseñado.
//   - settings:  idioma preferido, géneros favoritos y plataformas que tiene (para resaltar la timeline).
// Exponemos un contexto con el estado y acciones para leerlo/cambiarlo desde cualquier componente cliente.
// Es SSR-safe: en el servidor no hay localStorage, así que arrancamos con el estado por defecto y, ya en el
// navegador, hidratamos desde localStorage en un efecto (y persistimos en cada cambio).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/lib/auth-context";
import { fetchServerProfile, createProfileClient, pushProfile } from "@/lib/connect/profile-sync";
import { isEmptyProfile, mergeProfiles } from "@/lib/profile-merge";

// STORAGE_KEY es la llave de localStorage donde guardamos TODO el perfil (un solo JSON). La versión v2
// añade la FECHA DE ALTA (createdAt) y la ACTIVIDAD RECIENTE (activity) del plan de "Mi Perfil".
const STORAGE_KEY = "tsk-profile-v2";

// LEGACY_STORAGE_KEYS son las llaves previas, EN ORDEN de preferencia: la v1 del rename (tsk) y la
// original del producto anterior (mdm7mo). Si la llave v2 no existe, hidratamos desde la primera legada
// que aparezca; el efecto de persistencia reescribe ya bajo la v2 (migración transparente: nadie pierde
// watchlist/reseñas; la fecha de alta de un perfil migrado es el día de la migración).
const LEGACY_STORAGE_KEYS = ["tsk-profile-v1", "mdm7mo-profile-v1"] as const;

// THEME_MIRROR_KEY es una copia PLANA del tema activo (dark/light), aparte del perfil. La usa el script
// inline del layout para fijar <html data-theme> antes del primer paint (sin parpadeo), sin depender de
// qué cuenta tiene el perfil. Debe coincidir con la llave que lee ese script en app/layout.tsx.
export const THEME_MIRROR_KEY = "tsk-theme";

// Theme es el tema visual elegido por el usuario. "dark" (cine oscuro) es el default; "light" es el
// relavado claro. Se aplica como atributo data-theme en <html> (ver efecto de aplicación abajo).
export type Theme = "dark" | "light";

// ProfileSettings son los ajustes del perfil (idioma, gustos, plataformas, tema).
export type ProfileSettings = {
  // language: idioma preferido (ej. "es", "en"). Marca el tráiler/audio/subtítulos preferidos.
  language: string;
  // genres: géneros favoritos del usuario (nombres tal como vienen en release.genres).
  genres: string[];
  // platforms: plataformas que el usuario TIENE (nombres tal como vienen en availability.platforms).
  platforms: string[];
  // theme: tema visual (claro/oscuro). Persistido por perfil; aplicado a <html data-theme>.
  theme: Theme;
};

// ActivityKind clasifica una acción del usuario para la línea de "actividad reciente" del perfil.
export type ActivityKind = "watchlist" | "watched" | "review";

// ActivityEvent es UNA acción registrada: qué hizo el usuario, sobre qué título y cuándo.
// En español: alimenta la zona "Actividad" de Mi Perfil ("guardó X", "vio Y", "reseñó Z"). Solo se
// registran las acciones POSITIVAS (agregar/ver/reseñar); quitar algo no genera evento (sería ruido).
export type ActivityEvent = {
  // kind es el tipo de acción (guardar en watchlist / marcar vista / reseñar).
  kind: ActivityKind;
  // id es el identificador del estreno sobre el que se actuó.
  id: string;
  // at es la fecha de la acción en ISO (AAAA-MM-DD), en la zona horaria de México.
  at: string;
  // score es la nota (1–10) cuando la acción es una reseña; ausente en las demás.
  score?: number;
};

// PROFILE_SYNC_DELAY_MS es cuánto se espera, tras un cambio, antes de mandarlo al servidor.
//
// En español: dos segundos. Marcar tres películas seguidas produce UN envío en vez de tres, y a la
// vez es un retardo lo bastante corto para que cerrar la pestaña justo después no se lleve el cambio.
// El guardado en este mismo navegador es aparte y mucho más rápido: en pantalla nunca se espera.
const PROFILE_SYNC_DELAY_MS = 2000;

// MAX_ACTIVITY_EVENTS es cuántos eventos de actividad conservamos (los más recientes primero).
// En español: la actividad es una memoria CORTA (lo último que hiciste), no un historial infinito.
const MAX_ACTIVITY_EVENTS = 50;

// ProfileState es TODO el perfil persistido (formato v2).
export type ProfileState = {
  watchlist: string[];
  watched: string[];
  reviews: Record<string, number>;
  settings: ProfileSettings;
  // createdAt es la fecha de alta del perfil ("guardián desde…"), ISO AAAA-MM-DD. En perfiles migrados
  // desde v1 es la fecha de la migración (no se inventa una fecha anterior).
  createdAt: string;
  // activity son las acciones recientes del usuario, la más nueva primero (tope MAX_ACTIVITY_EVENTS).
  activity: ActivityEvent[];
  // seenNotifications son los ids de avisos in-app que el usuario YA vio (para el contador de no leídos).
  seenNotifications: string[];
};

// localIsoDate devuelve la fecha de HOY como "AAAA-MM-DD" en la zona horaria de México (la del
// producto), con el mismo truco en-CA que usa la línea de tiempo (formato ISO directo, sin ambigüedad).
// El formateador se crea UNA vez: construir un Intl.DateTimeFormat es caro (carga datos de zona y
// de idioma) y esta función se llama en cada perfil por defecto que se arma.
const MEXICO_ISO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function localIsoDate(): string {
  return MEXICO_ISO_DATE.format(new Date());
}

// makeDefaultProfile crea el estado inicial (perfil vacío, idioma español, alta HOY).
// En español: es una FUNCIÓN (no una constante) porque la fecha de alta debe ser la del momento en que
// el perfil nace, no la de la carga del módulo.
function makeDefaultProfile(): ProfileState {
  return {
    watchlist: [],
    watched: [],
    reviews: {},
    settings: { language: "es", genres: [], platforms: [], theme: "dark" },
    createdAt: localIsoDate(),
    activity: [],
    seenNotifications: [],
  };
}

// MAX_SEEN_NOTIFICATIONS acota cuántos ids de avisos "ya vistos" conservamos. En español: los avisos
// caducan solos (dependen de fechas de estreno cercanas a HOY), pero sus ids marcados como vistos se
// quedaban para siempre y la lista crecía sin límite. Con un tope generoso (muy por encima de los
// avisos simultáneos posibles) la lista se poda sola conservando los más recientes.
const MAX_SEEN_NOTIFICATIONS = 200;

// pushActivity antepone un evento a la actividad respetando el tope (la más nueva primero).
function pushActivity(activity: ActivityEvent[], event: ActivityEvent): ActivityEvent[] {
  return [event, ...activity].slice(0, MAX_ACTIVITY_EVENTS);
}

// sanitizeStringArray devuelve solo los elementos que son strings de un valor desconocido, o [] si el
// valor ni siquiera es un arreglo. En español: localStorage lo puede editar cualquiera (extensiones,
// usuario en DevTools, corrupción); si confiáramos ciegamente en la forma del JSON, un valor con el
// tipo equivocado (p. ej. watchlist: "hola") reventaría después en .includes/.filter y tiraría la
// pantalla entera al error boundary. Validar campo a campo degrada elegante: lo corrupto se descarta.
function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

// sanitizeReviews valida el mapa de reseñas: solo entradas con llave string y nota numérica finita.
function sanitizeReviews(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const clean: Record<string, number> = {};
  for (const [id, score] of Object.entries(value as Record<string, unknown>)) {
    if (typeof score === "number" && Number.isFinite(score)) {
      clean[id] = score;
    }
  }
  return clean;
}

// sanitizeActivity valida la lista de actividad: solo eventos con la forma correcta (kind conocido,
// id string, fecha string). El score se conserva solo si es número finito.
function sanitizeActivity(value: unknown): ActivityEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const validKinds: ActivityKind[] = ["watchlist", "watched", "review"];
  const clean: ActivityEvent[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.at !== "string" ||
      !validKinds.includes(candidate.kind as ActivityKind)
    ) {
      continue;
    }
    const event: ActivityEvent = {
      kind: candidate.kind as ActivityKind,
      id: candidate.id,
      at: candidate.at,
    };
    if (typeof candidate.score === "number" && Number.isFinite(candidate.score)) {
      event.score = candidate.score;
    }
    clean.push(event);
  }
  return clean.slice(0, MAX_ACTIVITY_EVENTS);
}

// sanitizeIsoDate valida una fecha "AAAA-MM-DD"; si no cumple el formato, devuelve el respaldo dado.
function sanitizeIsoDate(value: unknown, fallback: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return fallback;
}

// pushReviewActivity registra (o ACTUALIZA) el evento de reseña de un título. En español: ajustar la
// nota del mismo título el mismo día (slider/flechas) no debe generar un evento por movimiento; si ya
// existe el evento de reseña de ese título con la fecha de hoy, se actualiza su nota y sube al frente.
function pushReviewActivity(
  activity: ActivityEvent[],
  releaseId: string,
  score: number,
): ActivityEvent[] {
  const today = localIsoDate();
  const withoutTodaysReview = activity.filter(
    (event) => !(event.kind === "review" && event.id === releaseId && event.at === today),
  );
  return pushActivity(withoutTodaysReview, { kind: "review", id: releaseId, at: today, score });
}

// ProfileContextValue es lo que ofrece el contexto: el estado + acciones puras para mutarlo.
type ProfileContextValue = {
  profile: ProfileState;
  // hydrated indica si ya leímos localStorage (para no parpadear el estado por defecto antes de hidratar).
  hydrated: boolean;
  // Acciones de colección (alternan presencia del id en la lista correspondiente).
  toggleWatchlist: (releaseId: string) => void;
  toggleWatched: (releaseId: string) => void;
  inWatchlist: (releaseId: string) => boolean;
  inWatched: (releaseId: string) => boolean;
  // Reseñas: fija/lee/borra la nota (1–10) de un estreno.
  setReview: (releaseId: string, score: number) => void;
  removeReview: (releaseId: string) => void;
  getReview: (releaseId: string) => number | undefined;
  // Ajustes.
  setLanguage: (language: string) => void;
  toggleGenre: (genre: string) => void;
  togglePlatform: (platform: string) => void;
  setTheme: (theme: Theme) => void;
  // Datos: exportar el perfil como JSON (respaldo) y borrar TODOS los datos locales del perfil.
  exportProfile: () => string;
  clearLocalData: () => void;
  // Avisos: marca como vistos los ids de notificaciones indicados (para el contador de no leídos).
  markNotificationsSeen: (ids: string[]) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

// toggleInArray devuelve una copia del arreglo con `value` quitado si estaba, o añadido si no.
function toggleInArray(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

// ProfileProvider crea el estado del perfil, lo hidrata desde localStorage y lo persiste en cada cambio.
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ProfileState>(makeDefaultProfile);
  const [hydrated, setHydrated] = useState(false);
  // saveTimeout agrupa escrituras a localStorage (debounce) para no escribir en cada tecla.
  const saveTimeout = useRef<number | null>(null);
  // pendingWrite guarda la escritura agendada (llave + JSON) para poder DESCARGARLA (flush) si la
  // pestaña se cierra o se oculta antes de que venza el debounce. En español: sin esto, la última
  // reseña o toggle de los últimos 250 ms se perdía al cerrar la pestaña. La llave viaja JUNTO al
  // dato: si el usuario cambia de cuenta con una escritura pendiente, se descarga en la llave de la
  // cuenta a la que pertenecía ese perfil (nunca en la de la cuenta nueva).
  const pendingWrite = useRef<{ key: string; json: string } | null>(null);

  // flushPendingWrite escribe DE INMEDIATO la escritura pendiente (si la hay) y la marca como hecha.
  const flushPendingWrite = useCallback(() => {
    if (pendingWrite.current === null) {
      return;
    }
    try {
      window.localStorage.setItem(pendingWrite.current.key, pendingWrite.current.json);
    } catch {
      // Sin espacio o sin acceso a localStorage: no rompemos la app.
    }
    pendingWrite.current = null;
    if (saveTimeout.current !== null) {
      window.clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
  }, []);

  // NAMESPACING POR CUENTA: cada usuario logueado tiene su PROPIO perfil. La llave de localStorage deriva
  // del id de la sesión (useAuth): "tsk-profile-v2:<userId>" logueado, o la llave base anónima si no hay
  // sesión. Así al cambiar de cuenta se carga otro perfil sin mezclar bibliotecas/reseñas.
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const namespaced = useCallback(
    (baseKey: string): string => (userId === null ? baseKey : `${baseKey}:${userId}`),
    [userId],
  );
  const storageKey = namespaced(STORAGE_KEY);

  // Hidratación: leemos la llave ACTUAL (y re-leemos cuando cambia de cuenta). Si no hay datos v2 para
  // esa cuenta, probamos las llaves LEGADAS (v1 del rename y la original mdm7mo) en orden; si tampoco,
  // arrancamos su perfil en el default (no heredamos el de la cuenta anterior).
  useEffect(() => {
    try {
      let raw = window.localStorage.getItem(storageKey);
      // ¿No hay v2? Buscamos la primera llave legada con datos (migración transparente).
      if (raw === null) {
        for (const legacyBase of LEGACY_STORAGE_KEYS) {
          raw = window.localStorage.getItem(namespaced(legacyBase));
          if (raw !== null) {
            break;
          }
        }
      }
      if (raw !== null) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const parsedSettings =
          typeof parsed.settings === "object" && parsed.settings !== null
            ? (parsed.settings as Record<string, unknown>)
            : {};
        // Hidratación síncrona DELIBERADA desde localStorage: el perfil debe estar listo ANTES del
        // primer pintado útil (resaltes ♥ de la espina, tema). localStorage es una lectura inmediata
        // (no hay asincronía real que esperar); se suprime la regla con causa. CADA campo pasa por su
        // sanitizador: un JSON con la forma equivocada no debe poder tirar la app (ver sanitize*).
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratación inmediata de localStorage
        setProfile({
          watchlist: sanitizeStringArray(parsed.watchlist),
          watched: sanitizeStringArray(parsed.watched),
          reviews: sanitizeReviews(parsed.reviews),
          settings: {
            language: typeof parsedSettings.language === "string" ? parsedSettings.language : "es",
            genres: sanitizeStringArray(parsedSettings.genres),
            platforms: sanitizeStringArray(parsedSettings.platforms),
            theme: parsedSettings.theme === "light" ? "light" : "dark",
          },
          // Un perfil v1 no trae fecha de alta: su "alta" es HOY (la fecha de la migración; no se
          // inventa una previa). Un v2 conserva la suya.
          createdAt: sanitizeIsoDate(parsed.createdAt, localIsoDate()),
          activity: sanitizeActivity(parsed.activity),
          seenNotifications: sanitizeStringArray(parsed.seenNotifications).slice(
            -MAX_SEEN_NOTIFICATIONS,
          ),
        });
      } else {
        setProfile(makeDefaultProfile());
      }
    } catch {
      // localStorage corrupto o no disponible: seguimos con el default (degrada elegante).
      setProfile(makeDefaultProfile());
    }
    setHydrated(true);
  }, [storageKey, namespaced]);

  // Persistencia: cada vez que cambia el perfil (y ya hidratamos), lo guardamos con un pequeño debounce
  // en la llave ACTUAL. El cleanup ya NO descarta la escritura pendiente: la DESCARGA (flush) en la llave
  // con la que se agendó — así ni el desmontaje ni el cambio de cuenta pierden el último cambio, y una
  // escritura del perfil viejo jamás cae en la llave de la cuenta nueva (la llave viaja con el dato).
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (saveTimeout.current !== null) {
      window.clearTimeout(saveTimeout.current);
    }
    pendingWrite.current = { key: storageKey, json: JSON.stringify(profile) };
    saveTimeout.current = window.setTimeout(flushPendingWrite, 250);
    return flushPendingWrite;
  }, [profile, hydrated, storageKey, flushPendingWrite]);

  // Cierre/ocultado de pestaña: descargamos la escritura pendiente ANTES de que el navegador congele o
  // mate la página. "pagehide" cubre el cierre/navegación (también en iOS, donde beforeunload no es
  // fiable); "visibilitychange a hidden" cubre cambiar de pestaña o minimizar (momento en el que el
  // sistema puede matar la pestaña sin más aviso).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingWrite();
      }
    };
    window.addEventListener("pagehide", flushPendingWrite);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushPendingWrite);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPendingWrite]);

  // --- Sincronización con el servidor (solo con sesión iniciada) --------------------------------
  //
  // En español: todo lo de arriba guarda el perfil en ESTE navegador. Lo que sigue hace que, además,
  // exista en el servidor, que es lo único que permite entrar desde el teléfono y encontrar tu propia
  // biblioteca. Quien navega sin cuenta no ejecuta nada de esto.
  //
  // Son dos momentos distintos y conviene no confundirlos:
  //   1. Al ENTRAR: se juntan una sola vez lo que hay aquí y lo que hay allá (ver profile-merge.ts).
  //   2. Después: cada cambio se envía al servidor con un pequeño retardo, agrupando los que caen
  //      seguidos. Si otro dispositivo se adelantó, el servidor lo rechaza, se vuelven a juntar las
  //      dos versiones y se reintenta — nunca se pisan datos ajenos.

  // profileClient es la conexión con el servicio de perfil. Se crea una vez y se reutiliza.
  const profileClient = useMemo(() => createProfileClient(), []);

  // serverRevision es la versión del perfil que el servidor tiene ahora mismo, según lo último que
  // supimos. En null significa "todavía no hemos hablado con el servidor para esta cuenta", y mientras
  // esté así NO se envía nada: enviar sin saber sobre qué versión se trabaja es justo lo que pisa
  // datos de otro dispositivo.
  const serverRevision = useRef<bigint | null>(null);

  // lastSyncedJson es lo último que se dio por guardado en el servidor. Sirve para no repetir envíos
  // idénticos: sin esta comparación, la propia respuesta del servidor volvería a disparar un envío y
  // los dos se estarían mandando el mismo documento en bucle.
  const lastSyncedJson = useRef<string | null>(null);

  // syncTimeout agrupa los envíos al servidor (una persona marcando varias cosas seguidas genera un
  // solo envío, no cinco).
  const syncTimeout = useRef<number | null>(null);

  // Al cambiar de cuenta se olvida todo lo que sabíamos del servidor: la versión y el documento
  // enviado pertenecían a la cuenta anterior y aplicarlos a la nueva mezclaría perfiles de dos
  // personas distintas.
  useEffect(() => {
    serverRevision.current = null;
    lastSyncedJson.current = null;
  }, [userId]);

  // (1) RECONCILIACIÓN AL ENTRAR: una sola vez por sesión de cuenta.
  useEffect(() => {
    if (!hydrated || userId === null) {
      return;
    }
    if (serverRevision.current !== null) {
      // Ya se reconcilió esta cuenta en esta carga de la página.
      return;
    }

    let cancelled = false;

    const reconcile = async () => {
      const remote = await fetchServerProfile<ProfileState>(profileClient);
      if (cancelled) {
        return;
      }

      if (remote === null) {
        // El servidor no tiene nada de esta cuenta (o no se le pudo preguntar). Se parte de la
        // versión cero: el primer envío subirá lo que haya en este dispositivo.
        serverRevision.current = BigInt(0);
        return;
      }

      serverRevision.current = remote.revision;

      setProfile((current) => {
        // Si aquí no hay nada guardado, el perfil del servidor se adopta tal cual: es exactamente el
        // caso de estrenar dispositivo, y fusionar con un perfil vacío no aportaría nada.
        const merged = isEmptyProfile(current)
          ? remote.profile
          : mergeProfiles(current, remote.profile);
        // Si lo fusionado coincide con lo que el servidor ya tenía, se anota como enviado para que
        // no se dispare un envío que no cambiaría nada.
        if (JSON.stringify(merged) === JSON.stringify(remote.profile)) {
          lastSyncedJson.current = JSON.stringify(merged);
        }
        return merged;
      });
    };

    void reconcile();
    return () => {
      cancelled = true;
    };
  }, [hydrated, userId, profileClient]);

  // (2) ENVÍO DE CAMBIOS, con reintento inteligente ante conflicto.
  useEffect(() => {
    if (!hydrated || userId === null || serverRevision.current === null) {
      return;
    }
    const documentJson = JSON.stringify(profile);
    if (documentJson === lastSyncedJson.current) {
      return;
    }

    let cancelled = false;

    const send = async () => {
      // Hasta dos intentos: el primero puede chocar con lo que guardó otro dispositivo, y entonces se
      // fusiona y se reintenta con la versión actualizada. Si el segundo también choca, se deja para
      // el cambio siguiente en vez de insistir: el perfil local no se pierde, solo se envía más tarde.
      for (let attempt = 0; attempt < 2 && !cancelled; attempt += 1) {
        const outcome = await pushProfile<ProfileState>(
          profileClient,
          profile,
          serverRevision.current ?? BigInt(0),
        );
        if (cancelled) {
          return;
        }
        if (outcome.status === "saved") {
          serverRevision.current = outcome.revision;
          lastSyncedJson.current = documentJson;
          return;
        }
        if (outcome.status === "conflict") {
          serverRevision.current = outcome.serverRevision;
          setProfile((current) => mergeProfiles(current, outcome.serverProfile));
          // El cambio de estado vuelve a entrar por aquí con el documento ya fusionado; se sale para
          // no enviar el documento viejo.
          return;
        }
        if (outcome.status === "rejected") {
          // El servidor no puede guardar este documento y nunca podrá: reintentar sería un bucle
          // eterno. Se deja de sincronizar esta cuenta en esta carga de la página; el perfil sigue
          // completo en este navegador. Queda constancia en la consola porque es un fallo de
          // programación (un tope mal calculado en la fusión), no algo que el usuario pueda arreglar.
          console.error("El servidor rechazó el perfil y no se reintentará:", outcome.reason);
          serverRevision.current = null;
          return;
        }
        if (outcome.status === "unauthenticated") {
          // La sesión caducó o se cerró en otro sitio. Se deja de intentar; el perfil sigue completo
          // en este navegador y volverá a subirse cuando la persona vuelva a entrar.
          serverRevision.current = null;
          return;
        }
        // "unavailable": el servidor no contestó. Se deja para el siguiente cambio.
        return;
      }
    };

    if (syncTimeout.current !== null) {
      window.clearTimeout(syncTimeout.current);
    }
    // PROFILE_SYNC_DELAY_MS de espera: lo bastante para agrupar una ráfaga de clics, lo bastante poco
    // para que cerrar la pestaña justo después no se lleve el cambio por delante.
    syncTimeout.current = window.setTimeout(() => void send(), PROFILE_SYNC_DELAY_MS);

    return () => {
      cancelled = true;
      if (syncTimeout.current !== null) {
        window.clearTimeout(syncTimeout.current);
        syncTimeout.current = null;
      }
    };
  }, [profile, hydrated, userId, profileClient]);

  const toggleWatchlist = useCallback((releaseId: string) => {
    setProfile((previous) => {
      const adding = !previous.watchlist.includes(releaseId);
      return {
        ...previous,
        watchlist: toggleInArray(previous.watchlist, releaseId),
        // Solo el AGREGAR genera evento de actividad (quitar sería ruido en la línea de actividad).
        activity: adding
          ? pushActivity(previous.activity, {
              kind: "watchlist",
              id: releaseId,
              at: localIsoDate(),
            })
          : previous.activity,
      };
    });
  }, []);

  const toggleWatched = useCallback((releaseId: string) => {
    setProfile((previous) => {
      const adding = !previous.watched.includes(releaseId);
      return {
        ...previous,
        watched: toggleInArray(previous.watched, releaseId),
        activity: adding
          ? pushActivity(previous.activity, { kind: "watched", id: releaseId, at: localIsoDate() })
          : previous.activity,
      };
    });
  }, []);

  const setReview = useCallback((releaseId: string, score: number) => {
    setProfile((previous) => ({
      ...previous,
      reviews: { ...previous.reviews, [releaseId]: score },
      // Reseñar implica haberla visto: la añadimos a la biblioteca si no estaba.
      watched: previous.watched.includes(releaseId)
        ? previous.watched
        : [...previous.watched, releaseId],
      // La reseña genera evento (con su nota). DEDUPE: ajustar la nota del MISMO título el MISMO día
      // (arrastre del slider, flechas del teclado) actualiza el evento existente en vez de inundar la
      // actividad con un evento por tecla. Días distintos sí generan eventos separados (re-reseña real).
      activity: pushReviewActivity(previous.activity, releaseId, score),
    }));
  }, []);

  const removeReview = useCallback((releaseId: string) => {
    setProfile((previous) => {
      const nextReviews = { ...previous.reviews };
      delete nextReviews[releaseId];
      return { ...previous, reviews: nextReviews };
    });
  }, []);

  const setLanguage = useCallback((language: string) => {
    setProfile((previous) => ({ ...previous, settings: { ...previous.settings, language } }));
  }, []);

  const toggleGenre = useCallback((genre: string) => {
    setProfile((previous) => ({
      ...previous,
      settings: { ...previous.settings, genres: toggleInArray(previous.settings.genres, genre) },
    }));
  }, []);

  const togglePlatform = useCallback((platform: string) => {
    setProfile((previous) => ({
      ...previous,
      settings: {
        ...previous.settings,
        platforms: toggleInArray(previous.settings.platforms, platform),
      },
    }));
  }, []);

  const setTheme = useCallback((theme: Theme) => {
    setProfile((previous) => ({ ...previous, settings: { ...previous.settings, theme } }));
  }, []);

  // markNotificationsSeen añade ids de avisos al conjunto de "vistos" (sin duplicar). Lo llama el panel
  // de notificaciones al abrirse: los avisos mostrados dejan de contar como no leídos.
  const markNotificationsSeen = useCallback((ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    setProfile((previous) => {
      const merged = new Set(previous.seenNotifications);
      let changed = false;
      for (const id of ids) {
        if (!merged.has(id)) {
          merged.add(id);
          changed = true;
        }
      }
      // Si no había ninguno nuevo, no creamos un objeto nuevo (evita un re-render inútil). Al guardar,
      // podamos por el tope conservando los MÁS RECIENTES (los del final: se insertan en orden).
      return changed
        ? { ...previous, seenNotifications: [...merged].slice(-MAX_SEEN_NOTIFICATIONS) }
        : previous;
    });
  }, []);

  // exportProfile devuelve el perfil COMPLETO como JSON legible (respaldo del usuario). En español:
  // los datos son suyos; este texto es exactamente lo que vive en localStorage, con sangría para
  // poder leerlo. El componente lo convierte en descarga (Blob) al pulsar "Exportar".
  const exportProfile = useCallback((): string => JSON.stringify(profile, null, 2), [profile]);

  // clearLocalData BORRA todos los datos locales del perfil de esta cuenta (o del anónimo): la llave
  // v2 y las legadas (v1 y mdm7mo), y deja el estado en el default (perfil recién nacido, tema oscuro).
  // En español: es la acción "Borrar datos locales" del bloque "Tus datos" (con confirmación de dos
  // pasos en la interfaz). No toca la sesión (cerrar sesión es otra acción) ni perfiles de otras cuentas.
  const clearLocalData = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
      for (const legacyBase of LEGACY_STORAGE_KEYS) {
        window.localStorage.removeItem(namespaced(legacyBase));
      }
    } catch {
      // Sin acceso a localStorage: igual reiniciamos el estado en memoria (lo visible queda limpio).
    }
    setProfile(makeDefaultProfile());
  }, [storageKey, namespaced]);

  // Aplicación del tema: reflejamos settings.theme en <html data-theme> para que el CSS conmute la paleta.
  // El script inline del layout ya fija el tema correcto ANTES del paint (sin parpadeo); este efecto lo
  // mantiene sincronizado cuando el usuario lo cambia o tras hidratar/cambiar de cuenta. Además espejamos el
  // tema en una llave plana ("mdm7mo-theme"), independiente del namespacing del perfil por cuenta, para que
  // el script inline pueda leerlo sin tener que resolver de qué cuenta es el perfil.
  useEffect(() => {
    document.documentElement.dataset.theme = profile.settings.theme;
    try {
      window.localStorage.setItem(THEME_MIRROR_KEY, profile.settings.theme);
    } catch {
      // sin acceso a localStorage: el data-theme ya quedó aplicado, no rompemos nada.
    }
  }, [profile.settings.theme]);

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      hydrated,
      toggleWatchlist,
      toggleWatched,
      inWatchlist: (id) => profile.watchlist.includes(id),
      inWatched: (id) => profile.watched.includes(id),
      setReview,
      removeReview,
      getReview: (id) => profile.reviews[id],
      setLanguage,
      toggleGenre,
      togglePlatform,
      setTheme,
      exportProfile,
      clearLocalData,
      markNotificationsSeen,
    }),
    [
      profile,
      hydrated,
      toggleWatchlist,
      toggleWatched,
      setReview,
      removeReview,
      setLanguage,
      toggleGenre,
      togglePlatform,
      setTheme,
      exportProfile,
      clearLocalData,
      markNotificationsSeen,
    ],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

// useProfile da acceso al perfil desde cualquier componente cliente. Lanza si se usa fuera del Provider
// (error de programación claro, no un fallo silencioso).
export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (context === null) {
    throw new Error("useProfile debe usarse dentro de <ProfileProvider>");
  }
  return context;
}
