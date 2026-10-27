// La demo no tiene cuentas: el perfil vive solo en este navegador y nunca se sincroniza con un
// servidor (useAuth siempre devuelve user = null, así que profile-context no llega a llamar a estas
// funciones). Sustituirlas por estas tres evita cargar en cada página el cliente de Connect y el
// motor de protobuf, que solo servían para esa sincronización. Los tipos vienen del módulo real
// (import type no carga nada), así que profile-context compila exactamente igual.

import type * as server from "@/lib/connect/profile-sync-server";

export type { PushOutcome, SyncedProfile } from "@/lib/connect/profile-sync-server";

const noServer = (): never => {
  throw new Error("La demo guarda el perfil solo en este navegador.");
};

// El cliente se crea al montar el perfil aunque no se use: un objeto vacío basta.
export const createProfileClient: typeof server.createProfileClient = () =>
  ({}) as ReturnType<typeof server.createProfileClient>;
export const fetchServerProfile: typeof server.fetchServerProfile = noServer;
export const pushProfile: typeof server.pushProfile = noServer;
