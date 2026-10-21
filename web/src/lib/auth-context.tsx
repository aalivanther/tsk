"use client";

// Archivo: auth-context.tsx — Sesión de usuario (cuentas reales) en el lado NAVEGADOR.
//
// Cómo funciona la sesión, en español:
//
// Este archivo NO guarda ninguna credencial. La sesión vive en una cookie que emite el servidor,
// marcada de forma que el JavaScript de la página no puede leerla ni escribirla. El navegador la
// adjunta solo en cada llamada. Eso significa que, aunque alguien lograra colar un script en la
// página, no encontraría nada que robar: no hay token en el almacenamiento ni en memoria.
//
// Antes no era así: la sesión se guardaba en el almacenamiento del navegador y se reenviaba a mano.
// Ese diseño venía forzado porque la web y el servidor vivían en direcciones distintas y el navegador
// habría descartado la cookie por considerarla "de terceros". Desde que las llamadas pasan por
// "/rpc" —la propia dirección de la web, ver web/app/rpc— la cookie es de primera parte y ese rodeo
// sobra.
//
// Dos consecuencias que se ven en el código de abajo:
//
//  - Para saber si hay sesión, hay que PREGUNTARLE al servidor (Me), porque la página no puede mirar
//    la cookie. Para no hacer esa pregunta en cada visita de quien nunca ha entrado, se deja una
//    marca sin ningún valor secreto ("aquí hubo una sesión") que solo sirve para decidir si merece la
//    pena preguntar. Perderla no cierra la sesión: solo retrasa su restauración a la siguiente visita.
//
//  - Cerrar sesión es una llamada al servidor, no un borrado local. Es la diferencia entre "dejo de
//    usar esta llave" y "esta llave deja de abrir": si solo se olvidara del lado del navegador, una
//    copia robada seguiría funcionando hasta que caducara.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Code, ConnectError, createClient, type Client } from "@connectrpc/connect";

import { AuthService, type User } from "@/gen/mdm7mo/auth/v1/auth_pb";
import { createBrowserTransport } from "@/lib/connect/browser-transport";

// SESSION_HINT_KEY marca que en este navegador hubo una sesión abierta.
//
// IMPORTANTE: aquí NO hay ninguna credencial. Es un simple "sí" o "no" que sirve para no molestar al
// servidor preguntando por una sesión que casi seguro no existe. Alguien que lo manipule no consigue
// entrar en ninguna cuenta: como mucho provoca una consulta de más o de menos.
const SESSION_HINT_KEY = "tsk-session-hint";

// LEGACY_TOKEN_KEYS son las llaves donde las versiones anteriores guardaban el token de sesión.
// Se borran al arrancar: son credenciales que ya no se usan y que no deben seguir ahí a la vista.
const LEGACY_TOKEN_KEYS = ["tsk-auth-token", "mdm7mo-auth-token"];

// AuthContextValue es lo que ofrece el contexto: el usuario actual + acciones de sesión.
type AuthContextValue = {
  // user es la cuenta autenticada, o null si se está navegando como anónimo.
  user: User | null;
  // loading es true mientras restauramos la sesión inicial (evita parpadeos del avatar).
  loading: boolean;
  // register/login devuelven null si todo fue bien, o un mensaje de error legible (es-MX) si falló.
  //
  // inviteCode es el código de la beta cerrada. Va SIEMPRE en la llamada aunque venga vacío: quien
  // decide si hace falta es el servidor (bandera REQUIRE_INVITE), no la pantalla. Si el servidor no
  // lo exige, lo ignora sin quemar el código; si lo exige y falta o no sirve, responde "permiso
  // denegado" y aquí se traduce a un mensaje que dice exactamente qué hacer.
  register: (
    email: string,
    password: string,
    displayName: string,
    inviteCode: string,
  ) => Promise<string | null>;
  login: (email: string, password: string) => Promise<string | null>;
  // logout cierra la sesión en el servidor y deja la app como anónima.
  logout: () => Promise<void>;
  // changePassword cambia la contraseña exigiendo la vigente. OJO: al lograrlo, el servidor cierra
  // TODAS las sesiones (incluida esta), así que la app queda como anónima y hay que volver a entrar.
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  // deleteAccount borra la cuenta para siempre exigiendo la contraseña; después queda todo anónimo.
  deleteAccount: (password: string) => Promise<string | null>;
  // requestPasswordReset pone en marcha el restablecimiento de quien olvidó su contraseña.
  // El servidor responde LO MISMO exista o no la cuenta (para no delatar qué correos hay
  // registrados), así que "sin error" NO significa "esa cuenta existe".
  requestPasswordReset: (email: string) => Promise<string | null>;
  // resetPassword canjea el token del enlace y fija la contraseña nueva; cierra todas las sesiones.
  resetPassword: (resetToken: string, newPassword: string) => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// GENERIC_ERROR_MESSAGE es lo que se dice cuando el fallo no tiene una explicación útil para quien
// lo lee (un error interno del servidor, un fallo raro de red). Ocultar el detalle es deliberado:
// enseñar entrañas del servidor no ayuda a la persona y sí ayuda a quien busca huecos.
const GENERIC_ERROR_MESSAGE = "Algo salió mal. Inténtalo de nuevo.";

// INVITE_CODE_REJECTED_MESSAGE explica el "permiso denegado" del REGISTRO.
// En español: el servidor devuelve ese código tanto si falta el código de invitación como si el que
// se escribió no existe, ya caducó o alguien ya lo usó. Los cuatro casos se resuelven igual —conseguir
// un código bueno—, así que un solo mensaje accionable los cubre a todos sin adivinar cuál fue.
const INVITE_CODE_REJECTED_MESSAGE =
  "Ese código de invitación no es válido o ya se usó. The Story Keeper está en beta cerrada: pide " +
  "un código nuevo a quien te invitó.";

// RESET_LINK_REJECTED_MESSAGE explica el "permiso denegado" del RESTABLECIMIENTO: el enlace es de un
// solo uso y de vida corta, así que "no vale" casi siempre significa "ya lo usaste o ya caducó".
const RESET_LINK_REJECTED_MESSAGE =
  "Ese enlace de restablecimiento ya no sirve: caducó o ya se usó. Pide uno nuevo desde " +
  "«¿Olvidaste tu contraseña?».";

// ACTION_DENIED_MESSAGE es el "permiso denegado" de cualquier otra operación de cuenta. No debería
// ocurrir en un uso normal, pero un mensaje concreto es mejor que uno genérico si algún día ocurre.
const ACTION_DENIED_MESSAGE = "No tienes permiso para hacer esto.";

// describeAuthError traduce un error de Connect a un mensaje legible en es-MX para el formulario.
// En español: mapeamos por el CÓDIGO del error (no por su texto), porque el texto puede venir en otro
// idioma o con detalles internos que no queremos enseñar. Para los códigos donde el backend ya redacta
// un mensaje es-MX pensado para el usuario (credenciales inválidas, argumento inválido, registro),
// mostramos ese mensaje; para el resto (fallos de red, internos), uno genérico propio.
//
// deniedMessage lo pone quien llama porque "permiso denegado" significa cosas distintas según la
// operación: en el registro habla del código de invitación y en el restablecimiento del enlace. Cada
// pantalla sabe cuál es su caso, y así el mensaje puede decir qué hacer a continuación en vez de
// limitarse a informar de que algo se denegó.
function describeAuthError(error: unknown, deniedMessage: string = ACTION_DENIED_MESSAGE): string {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.Unauthenticated:
      case Code.InvalidArgument:
      case Code.AlreadyExists:
      case Code.NotFound:
        // Estos mensajes los redacta nuestro backend en es-MX pensando en el usuario final.
        return error.rawMessage || GENERIC_ERROR_MESSAGE;
      case Code.PermissionDenied:
        // El mensaje lo pone la pantalla: solo ella sabe qué se estaba intentando hacer.
        return deniedMessage;
      case Code.ResourceExhausted:
        // La cuota de intentos de auth (429) se agotó: pedimos esperar, sin tecnicismos.
        return "Demasiados intentos. Espera un minuto y vuelve a intentarlo.";
      case Code.Unavailable:
      case Code.DeadlineExceeded:
        return "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
      default:
        return GENERIC_ERROR_MESSAGE;
    }
  }
  return GENERIC_ERROR_MESSAGE;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Cliente Connect del AuthService, estable durante toda la vida del provider.
  const client = useMemo<Client<typeof AuthService>>(
    () => createClient(AuthService, createBrowserTransport()),
    [],
  );

  // rememberSession deja (o quita) la marca de "aquí hubo sesión". No guarda ninguna credencial.
  const rememberSession = useCallback((hasSession: boolean) => {
    try {
      if (hasSession) {
        window.localStorage.setItem(SESSION_HINT_KEY, "1");
      } else {
        window.localStorage.removeItem(SESSION_HINT_KEY);
      }
      // De paso se barren los tokens que dejaron versiones anteriores. Ya no valen para nada, pero
      // una credencial olvidada en el almacenamiento es exactamente lo que este diseño quiere evitar.
      for (const legacyKey of LEGACY_TOKEN_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    } catch {
      // Sin acceso al almacenamiento: la sesión sigue funcionando igual, solo que en la próxima
      // visita habrá que preguntarle al servidor si sigue abierta.
    }
  }, []);

  // Restauración inicial: se le pregunta al servidor quién es el dueño de la cookie que el navegador
  // acaba de mandar. Solo se pregunta si consta que aquí hubo sesión alguna vez; para quien nunca ha
  // entrado, la respuesta sería siempre "nadie" y no merece una llamada en cada visita.
  useEffect(() => {
    let cancelled = false;
    let hadSession = false;
    try {
      hadSession =
        window.localStorage.getItem(SESSION_HINT_KEY) !== null ||
        // Quien venía de una versión anterior tenía su token guardado. La sesión de aquel token ya no
        // sirve, pero su presencia SÍ dice que esta persona tenía cuenta: se le pregunta al servidor
        // una vez y, si su cookie sigue viva, entra sin enterarse del cambio.
        LEGACY_TOKEN_KEYS.some((legacyKey) => window.localStorage.getItem(legacyKey) !== null);
    } catch {
      hadSession = false;
    }

    if (!hadSession) {
      // No consta que aquí hubiera sesión, así que la interfaz se pinta YA como anónima en vez de
      // enseñar un "cargando sesión…" que casi seguro no lleva a ninguna parte.
      //
      // Ojo: eso NO significa dejar de preguntar. La pregunta se hace igual, unas líneas más abajo, y
      // el motivo es un caso muy concreto: Safari borra por su cuenta el almacenamiento de las
      // páginas que llevan unos días sin visitarse, PERO conserva las cookies. Alguien que volviera
      // tras una semana tendría su sesión perfectamente viva y esta aplicación lo trataría como
      // desconocido — precisamente en el navegador para el que se hizo todo el trabajo de la cookie.
      // Preguntar siempre cuesta una llamada pequeña; no preguntar cuesta echar a gente que sí había
      // entrado.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- primer pintado como anónimo
      setLoading(false);
    }

    client
      .me({})
      .then((response) => {
        if (!cancelled && response.user) {
          setUser(response.user);
          rememberSession(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // La cookie caducó, se revocó o nunca existió: se queda como anónimo y se borra la marca,
          // que en ese caso ya no describe la realidad.
          rememberSession(false);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, rememberSession]);

  const register = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      inviteCode: string,
    ): Promise<string | null> => {
      try {
        const response = await client.register({ email, password, displayName, inviteCode });
        // La sesión ya viaja en la cookie que trajo esta misma respuesta: aquí solo se anota que la
        // hay, para saber que en la próxima visita merece la pena preguntar por ella.
        rememberSession(true);
        setUser(response.user ?? null);
        return null;
      } catch (error) {
        return describeAuthError(error, INVITE_CODE_REJECTED_MESSAGE);
      }
    },
    [client, rememberSession],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const response = await client.login({ email, password });
        rememberSession(true);
        setUser(response.user ?? null);
        return null;
      } catch (error) {
        return describeAuthError(error);
      }
    },
    [client, rememberSession],
  );

  // logout cierra la sesión EN EL SERVIDOR y después limpia lo local.
  //
  // En español: el orden y el hecho de llamar al servidor son lo importante. Si solo se borrara la
  // marca local, la sesión seguiría abierta del otro lado: quien tuviera una copia de la cookie
  // (alguien que usó tu computadora, un respaldo del navegador) podría seguir entrando durante días.
  // Al avisar al servidor, esa credencial deja de valer para siempre en ese mismo instante.
  //
  // La interfaz se actualiza pase lo que pase con la llamada: si el servidor no responde, lo peor que
  // ocurre es que la sesión siga viva allí, y ese caso ya lo cubre su caducidad. Dejar al usuario
  // "medio dentro" porque falló la red sería peor.
  const logout = useCallback(async (): Promise<void> => {
    try {
      await client.logout({});
    } catch {
      // Sin conexión o servidor caído: se continúa con el cierre local de todas formas.
    }
    rememberSession(false);
    setUser(null);
  }, [client, rememberSession]);

  // changePassword cambia la contraseña y deja la app como ANÓNIMA aunque el cambio saliera bien.
  //
  // En español: eso no es un fallo, es lo que hace el servidor. Cambiar la contraseña cierra todas
  // las sesiones de la cuenta —también la que pidió el cambio— porque el motivo habitual para
  // cambiarla es sospechar que alguien más entró; dejar vivas las sesiones ya abiertas haría inútil
  // el cambio. La cookie llega vacía en la respuesta, así que la interfaz debe reflejar de inmediato
  // que ya no hay sesión: si siguiera mostrando al usuario dentro, la siguiente acción fallaría con
  // un "no has iniciado sesión" incomprensible.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<string | null> => {
      try {
        await client.changePassword({ currentPassword, newPassword });
        rememberSession(false);
        setUser(null);
        return null;
      } catch (error) {
        return describeAuthError(error);
      }
    },
    [client, rememberSession],
  );

  // deleteAccount borra la cuenta para siempre y deja la app como anónima.
  // En español: si el servidor confirma el borrado, ya no existe ninguna sesión que restaurar, así
  // que se limpia también la marca local para no preguntar por una cuenta que ya no está.
  const deleteAccount = useCallback(
    async (password: string): Promise<string | null> => {
      try {
        await client.deleteAccount({ password });
        rememberSession(false);
        setUser(null);
        return null;
      } catch (error) {
        return describeAuthError(error);
      }
    },
    [client, rememberSession],
  );

  // requestPasswordReset pide un permiso temporal para poner contraseña nueva sin saber la anterior.
  //
  // En español: devolver null (éxito) NO significa que ese correo tenga cuenta. El servidor responde
  // exactamente lo mismo en los dos casos, a propósito, para que nadie pueda usar esta llamada como
  // un buscador de correos registrados. La pantalla que llame a esto tiene que redactar su mensaje
  // en consecuencia y no afirmar que "ya te llegó el correo".
  const requestPasswordReset = useCallback(
    async (email: string): Promise<string | null> => {
      try {
        await client.requestPasswordReset({ email });
        return null;
      } catch (error) {
        return describeAuthError(error);
      }
    },
    [client],
  );

  // resetPassword canjea el token del enlace y fija la contraseña nueva.
  //
  // En español: no hace falta tener sesión para llamarlo (justamente, quien lo usa no puede entrar).
  // Al lograrlo, el servidor cierra TODAS las sesiones de esa cuenta; por eso, si en este mismo
  // navegador había una sesión abierta, aquí se da por cerrada: seguir mostrándola sería enseñar una
  // llave que ya no abre.
  const resetPassword = useCallback(
    async (resetToken: string, newPassword: string): Promise<string | null> => {
      try {
        await client.resetPassword({ resetToken, newPassword });
        rememberSession(false);
        setUser(null);
        return null;
      } catch (error) {
        return describeAuthError(error, RESET_LINK_REJECTED_MESSAGE);
      }
    },
    [client, rememberSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      register,
      login,
      logout,
      changePassword,
      deleteAccount,
      requestPasswordReset,
      resetPassword,
    }),
    [
      user,
      loading,
      register,
      login,
      logout,
      changePassword,
      deleteAccount,
      requestPasswordReset,
      resetPassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// useAuth da acceso a la sesión desde cualquier componente cliente.
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return context;
}
