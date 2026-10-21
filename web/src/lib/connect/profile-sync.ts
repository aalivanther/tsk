"use client";

// Archivo: profile-sync.ts — Lleva y trae el perfil entre este dispositivo y el servidor.
//
// En español: el perfil se sigue guardando en este navegador, igual que antes, porque es lo que hace
// que la aplicación responda al instante sin esperar a nadie. Lo que añade este archivo es la otra
// mitad: que ese mismo perfil exista también en el servidor, para que quien entre desde el teléfono
// encuentre SU biblioteca y no una pantalla vacía. Sin esto, tener cuenta no servía absolutamente de
// nada: el servidor sabía quién eras y no guardaba nada tuyo.
//
// Cómo se reparte el trabajo entre las dos copias:
//
//   - Este dispositivo manda para LEER. Todo lo que se ve en pantalla sale de aquí, al momento. El
//     servidor nunca hace esperar a nadie mirando una ruedita.
//   - El servidor manda para RECORDAR. Cada cambio se le envía poco después de ocurrir, agrupando los
//     que caen seguidos para no mandar una llamada por cada clic.
//
// Y la parte delicada: el servidor lleva la cuenta de cuántas veces se ha guardado ese perfil. Al
// enviar cambios se le dice sobre qué versión se hicieron; si mientras tanto otro dispositivo guardó
// algo, el servidor rechaza el envío y devuelve lo que él tiene. Entonces se juntan las dos versiones
// (ver profile-merge.ts) y se reintenta. Ese "no" del servidor es justo lo que evita que el último
// dispositivo en hablar borre en silencio lo que hizo el otro.

import { Code, ConnectError, createClient, type Client } from "@connectrpc/connect";

import { ProfileConflictSchema, ProfileService } from "@/gen/mdm7mo/profile/v1/profile_pb";
import { createBrowserTransport } from "@/lib/connect/browser-transport";

// SyncedProfile es un documento de perfil junto con la versión que el servidor le asignó.
export type SyncedProfile<TProfile> = {
  // profile es el documento tal cual lo guarda la aplicación.
  profile: TProfile;
  // revision es el número de versión del servidor. Cero significa "aquí no hay nada guardado".
  revision: bigint;
};

// createProfileClient arma el cliente del servicio de perfil sobre la conexión del navegador.
export function createProfileClient(): Client<typeof ProfileService> {
  return createClient(ProfileService, createBrowserTransport());
}

// parseProfileJson convierte el texto guardado en el servidor en un objeto, o devuelve null.
//
// En español: el servidor guarda el perfil como texto, sin mirar lo que hay dentro. Si por lo que
// fuera ese texto no fuera un documento válido, lo correcto es tratarlo como "no hay nada guardado" y
// seguir con lo de este dispositivo, en vez de dejar la aplicación rota por un dato corrupto.
function parseProfileJson<TProfile>(json: string): TProfile | null {
  if (json.trim() === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as TProfile;
  } catch {
    return null;
  }
}

// fetchServerProfile trae el perfil guardado en el servidor para la sesión abierta.
//
// Devuelve null cuando no hay nada guardado todavía o cuando no hay sesión. Un fallo de red también
// devuelve null: la aplicación tiene que seguir funcionando con lo que hay en este dispositivo.
export async function fetchServerProfile<TProfile>(
  client: Client<typeof ProfileService>,
): Promise<SyncedProfile<TProfile> | null> {
  try {
    const response = await client.getProfile({});
    const profile = parseProfileJson<TProfile>(response.profileJson);
    if (profile === null) {
      return null;
    }
    return { profile, revision: response.revision };
  } catch {
    return null;
  }
}

// PushOutcome describe cómo terminó un intento de guardar en el servidor.
export type PushOutcome<TProfile> =
  // "saved": quedó guardado, con la versión nueva que asignó el servidor.
  | { status: "saved"; revision: bigint }
  // "conflict": otro dispositivo guardó antes. Viene el documento del servidor para poder fusionar.
  | { status: "conflict"; serverProfile: TProfile; serverRevision: bigint }
  // "unavailable": no se pudo hablar con el servidor. Se reintentará más adelante.
  | { status: "unavailable" }
  // "rejected": el servidor NO acepta este documento (supera algún tope, tiene una nota fuera de
  // rango…). Reintentarlo no lo arreglaría: fallaría exactamente igual la próxima vez. Se distingue
  // de "unavailable" precisamente para no quedarse reintentando en bucle un documento imposible, que
  // es la forma más silenciosa de que el perfil de alguien deje de sincronizarse sin que nadie lo note.
  | { status: "rejected"; reason: string }
  // "unauthenticated": la sesión ya no vale. Deja de tener sentido seguir enviando.
  | { status: "unauthenticated" };

// conflictFromError saca el documento del servidor del detalle que acompaña al rechazo por versión.
//
// En español: cuando el servidor rechaza un guardado por versión desfasada no se limita a decir "no";
// adjunta el documento que él tiene, descrito con el mismo contrato que comparten las dos partes. Al
// pedirlo por ese contrato —y no rebuscando a mano entre los datos del error— se obtiene un objeto ya
// validado, y cualquier cambio futuro del contrato lo detectaría el compilador en vez de fallar
// calladamente en producción.
function conflictFromError<TProfile>(error: ConnectError): PushOutcome<TProfile> | null {
  for (const conflict of error.findDetails(ProfileConflictSchema)) {
    const serverProfile = parseProfileJson<TProfile>(conflict.serverProfileJson);
    if (serverProfile === null) {
      continue;
    }
    return {
      status: "conflict",
      serverProfile,
      serverRevision: conflict.serverRevision,
    };
  }
  return null;
}

// pushProfile envía el perfil al servidor diciendo sobre qué versión se hicieron los cambios.
export async function pushProfile<TProfile>(
  client: Client<typeof ProfileService>,
  profile: TProfile,
  baseRevision: bigint,
): Promise<PushOutcome<TProfile>> {
  try {
    const response = await client.putProfile({
      profileJson: JSON.stringify(profile),
      baseRevision,
    });
    return { status: "saved", revision: response.revision };
  } catch (error) {
    if (error instanceof ConnectError) {
      if (error.code === Code.Unauthenticated) {
        return { status: "unauthenticated" };
      }
      if (error.code === Code.InvalidArgument || error.code === Code.ResourceExhausted) {
        return { status: "rejected", reason: error.rawMessage };
      }
      if (error.code === Code.FailedPrecondition) {
        const conflict = conflictFromError<TProfile>(error);
        if (conflict !== null) {
          return conflict;
        }
      }
    }
    return { status: "unavailable" };
  }
}
