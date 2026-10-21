// Estado público de la preparación local. No incluye ninguna llave.

// SETUP_HEADER es la cabecera que el navegador añade en las llamadas de esta
// pantalla. Un formulario de otro sitio no puede ponerla.
export const SETUP_HEADER = "x-tsk-local-setup";

export type SetupStatus = {
  apiReachable: boolean;
  setupMode: boolean;
  sessionKeyConfigured: boolean;
  sessionKeyFromEnvironment: boolean;
  tmdbConfigured: boolean;
  tmdbFromEnvironment: boolean;
  omdbConfigured: boolean;
  omdbFromEnvironment: boolean;
  adminConfigured: boolean;
  adminFromEnvironment: boolean;
  metricsConfigured: boolean;
  metricsFromEnvironment: boolean;
  ignored?: string[];
  message?: string;
};

export const emptySetupStatus = (): SetupStatus => ({
  apiReachable: false,
  setupMode: false,
  sessionKeyConfigured: false,
  sessionKeyFromEnvironment: false,
  tmdbConfigured: false,
  tmdbFromEnvironment: false,
  omdbConfigured: false,
  omdbFromEnvironment: false,
  adminConfigured: false,
  adminFromEnvironment: false,
  metricsConfigured: false,
  metricsFromEnvironment: false,
});
