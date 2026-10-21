// Archivo: rpc-proxy.test.ts — Pruebas del puente entre el navegador y el backend.
//
// En español: este puente es por donde pasa TODO lo que la aplicación le pide al servidor, incluida
// la cookie de sesión. Un fallo aquí no rompe una pantalla: las rompe todas a la vez. Ya ocurrió una
// vez —el puente reenviaba una etiqueta que decía "esto viene comprimido" sobre un contenido que ya
// había dejado de estarlo, y cada llamada moría con un error incomprensible— y esa es literalmente
// la primera prueba de este archivo.

import { afterEach, describe, expect, it, vi } from "vitest";

import { forwardToBackend } from "@/lib/rpc-proxy";

// makeRequest arma una petición como la que llegaría del navegador.
function makeRequest(
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const { method = "POST", headers = {}, body = '{"email":"alguien@example.com"}' } = options;
  const request = new Request("http://localhost:3100/rpc/mdm7mo.auth.v1.AuthService/Login", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : body,
  });
  // El puente lee la parte de consulta a través de nextUrl; se añade lo mínimo que necesita.
  return Object.assign(request, {
    nextUrl: new URL("http://localhost:3100/rpc/mdm7mo.auth.v1.AuthService/Login"),
  }) as never;
}

// stubBackend sustituye la llamada al backend por una respuesta controlada y devuelve lo que recibió.
function stubBackend(response: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forwardToBackend", () => {
  it("NO reenvía las operaciones que el navegador no debe pedir", async () => {
    // El puente reenviaba cualquier dirección que le llegara, así que publicaba sin querer TODAS las
    // operaciones del servidor. La que lo destapó vuelca las fichas completas de un mes: nadie la
    // llama desde el navegador, y cualquiera podía pedirla desde fuera con treinta bytes y recibir
    // novecientos mil de vuelta. Cuatro peticiones bastaban para llevarse el catálogo entero.
    const calls = stubBackend(new Response("{}", { status: 200 }));

    const response = await forwardToBackend(makeRequest(), [
      "mdm7mo.catalog.v1.CatalogService",
      "ListReleaseDetails",
    ]);

    expect(response.status).toBe(404);
    // Y lo importante: NO se llegó a llamar al backend siquiera.
    expect(calls).toHaveLength(0);
  });

  it("tampoco deja pasar el listado del catálogo, que arma el servidor", async () => {
    const calls = stubBackend(new Response("{}", { status: 200 }));

    const response = await forwardToBackend(makeRequest(), [
      "mdm7mo.catalog.v1.CatalogService",
      "ListReleases",
    ]);

    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("sí deja pasar lo que la aplicación necesita de verdad", async () => {
    const calls = stubBackend(new Response("{}", { status: 200 }));

    for (const procedimiento of [
      ["mdm7mo.auth.v1.AuthService", "Login"],
      ["mdm7mo.profile.v1.ProfileService", "PutProfile"],
      ["mdm7mo.catalog.v1.CatalogService", "GetRelease"],
    ]) {
      const response = await forwardToBackend(makeRequest(), procedimiento);
      expect(response.status).toBe(200);
    }
    expect(calls).toHaveLength(3);
  });

  it("una ruta con una forma rara se rechaza sin mirar nada más", async () => {
    const calls = stubBackend(new Response("{}", { status: 200 }));

    for (const ruta of [[], ["solo-un-trozo"], ["a", "b", "c"], ["..", "etc"]]) {
      expect((await forwardToBackend(makeRequest(), ruta)).status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  it("NO reenvía la etiqueta de compresión al cliente", async () => {
    // El fallo real que motivó esta prueba: la herramienta con la que se llama al backend descomprime
    // el contenido ella sola. Reenviar la etiqueta "viene comprimido" junto al contenido ya
    // descomprimido hacía que el cliente intentara descomprimir algo que no lo estaba, y TODAS las
    // llamadas de la aplicación fallaban con "incorrect header check".
    stubBackend(
      new Response('{"user":{"email":"alguien@example.com"}}', {
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
      }),
    );

    const response = await forwardToBackend(makeRequest(), ["mdm7mo.auth.v1.AuthService", "Login"]);

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.json()).toEqual({ user: { email: "alguien@example.com" } });
  });

  it("deja pasar la cookie de sesión que emite el backend", async () => {
    // Si esta cabecera se perdiera, iniciar sesión "funcionaría" y el navegador no guardaría nada: la
    // persona volvería a la pantalla de entrada al recargar, sin ningún error que lo explicara.
    stubBackend(
      new Response("{}", {
        status: 200,
        headers: { "set-cookie": "tsk_session=abc123; Path=/; HttpOnly; SameSite=Lax" },
      }),
    );

    const response = await forwardToBackend(makeRequest(), ["mdm7mo.auth.v1.AuthService", "Login"]);

    expect(response.headers.get("set-cookie")).toContain("tsk_session=abc123");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("lleva la cookie del navegador hasta el backend", async () => {
    const calls = stubBackend(new Response("{}", { status: 200 }));

    await forwardToBackend(makeRequest({ headers: { cookie: "tsk_session=abc123" } }), [
      "mdm7mo.auth.v1.AuthService",
      "Me",
    ]);

    const enviadas = new Headers(calls[0].init.headers);
    expect(enviadas.get("cookie")).toBe("tsk_session=abc123");
  });

  it("no reenvía las cabeceras que describen la conexión, no el mensaje", async () => {
    // Reenviar estas rompe la conexión siguiente; el estándar de HTTP obliga a que un intermediario
    // las descarte.
    const calls = stubBackend(new Response("{}", { status: 200 }));

    await forwardToBackend(
      makeRequest({ headers: { connection: "keep-alive", host: "otro-sitio.example" } }),
      ["mdm7mo.auth.v1.AuthService", "Login"],
    );

    const enviadas = new Headers(calls[0].init.headers);
    expect(enviadas.get("connection")).toBeNull();
    expect(enviadas.get("host")).toBeNull();
  });

  it("NO deja pasar una dirección falsificada por el cliente", async () => {
    // Sin una plataforma de confianza delante, esta cabecera la puede escribir el propio atacante.
    // Dejarla pasar permitiría cambiarla en cada intento de contraseña y esquivar por completo el
    // límite del servidor, que identifica a cada persona precisamente por su dirección.
    const calls = stubBackend(new Response("{}", { status: 200 }));

    await forwardToBackend(
      makeRequest({ headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4" } }),
      ["mdm7mo.auth.v1.AuthService", "Login"],
    );

    const enviadas = new Headers(calls[0].init.headers);
    expect(enviadas.get("x-forwarded-for")).toBeNull();
    expect(enviadas.get("x-real-ip")).toBeNull();
  });

  it("sí la deja pasar cuando quien despliega afirma que hay una plataforma de confianza", async () => {
    // Detrás de una plataforma que reescribe esa cabecera, el valor SÍ es la dirección real y hay que
    // reenviarlo: si no, el servidor vería todas las peticiones del mundo viniendo del mismo sitio y
    // el primero en equivocarse de contraseña bloquearía a los demás.
    vi.stubEnv("TRUST_PLATFORM_FORWARDED_HEADERS", "true");
    const calls = stubBackend(new Response("{}", { status: 200 }));

    await forwardToBackend(makeRequest({ headers: { "x-forwarded-for": "203.0.113.9" } }), [
      "mdm7mo.auth.v1.AuthService",
      "Login",
    ]);

    expect(new Headers(calls[0].init.headers).get("x-forwarded-for")).toBe("203.0.113.9");
    vi.unstubAllEnvs();
  });

  it("apunta a la dirección del backend que diga el entorno", async () => {
    vi.stubEnv("API_BASE_URL", "http://api-interno:8080");
    const calls = stubBackend(new Response("{}", { status: 200 }));

    await forwardToBackend(makeRequest(), ["mdm7mo.auth.v1.AuthService", "Login"]);

    expect(calls[0].url).toBe("http://api-interno:8080/mdm7mo.auth.v1.AuthService/Login");
    vi.unstubAllEnvs();
  });

  it("conserva el código de error del backend en vez de convertirlo en un fallo propio", async () => {
    // Un 401 tiene que llegar como 401: es lo que hace que la aplicación sepa que la sesión caducó y
    // se comporte en consecuencia, en vez de enseñar un error genérico de servidor.
    stubBackend(new Response('{"code":"unauthenticated"}', { status: 401 }));

    const response = await forwardToBackend(makeRequest(), ["mdm7mo.auth.v1.AuthService", "Me"]);

    expect(response.status).toBe(401);
  });

  it("si el backend no contesta, responde 'no disponible' en vez de reventar", async () => {
    // La página tiene que poder enseñar su estado de error y ofrecer reintentar. Una excepción sin
    // atrapar dejaría al usuario ante una pantalla en blanco.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    const response = await forwardToBackend(makeRequest(), ["mdm7mo.auth.v1.AuthService", "Login"]);

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("unavailable");
  });
});
