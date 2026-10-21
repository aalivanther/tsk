// Archivo: profile-merge.test.ts — Pruebas de que sincronizar NUNCA borra datos de nadie.
//
// En español: estas pruebas defienden una promesa concreta al usuario. Cuando alguien usa la
// aplicación en la computadora y en el teléfono, sus dos versiones del perfil acaban siendo distintas.
// El peligro no es que falle algo con estruendo: es que la aplicación "resuelva" el desacuerdo
// quedándose con una versión y tirando la otra, y que la persona descubra semanas después que sus
// reseñas desaparecieron. Cada caso de abajo es una de esas situaciones reales.

import { describe, expect, it } from "vitest";

import type { ProfileState } from "@/lib/profile-context";
import { isEmptyProfile, mergeProfiles } from "@/lib/profile-merge";

// makeProfile arma un perfil de prueba partiendo de uno vacío y cambiando solo lo que interesa.
function makeProfile(overrides: Partial<ProfileState> = {}): ProfileState {
  return {
    watchlist: [],
    watched: [],
    reviews: {},
    settings: { language: "es", genres: [], platforms: [], theme: "dark" },
    createdAt: "2026-01-15",
    activity: [],
    seenNotifications: [],
    ...overrides,
  };
}

describe("mergeProfiles", () => {
  it("junta lo guardado en cada dispositivo en vez de quedarse con uno", () => {
    // La computadora guardó dos títulos; el teléfono, otro distinto. Los tres deben sobrevivir.
    const enLaComputadora = makeProfile({ watchlist: ["duna-3", "wicked-2"] });
    const enElTelefono = makeProfile({ watchlist: ["avatar-4"] });

    const resultado = mergeProfiles(enLaComputadora, enElTelefono);

    expect(resultado.watchlist).toHaveLength(3);
    expect(resultado.watchlist).toEqual(expect.arrayContaining(["duna-3", "wicked-2", "avatar-4"]));
  });

  it("no duplica lo que estaba en los dos sitios", () => {
    const primero = makeProfile({ watched: ["duna-3", "wicked-2"] });
    const segundo = makeProfile({ watched: ["wicked-2", "avatar-4"] });

    expect(mergeProfiles(primero, segundo).watched).toEqual(["duna-3", "wicked-2", "avatar-4"]);
  });

  it("ante dos notas para la misma película, gana la más reciente", () => {
    // Le puso 6 en enero desde la computadora y, tras volver a verla, 9 en marzo desde el teléfono.
    // La opinión válida es la de marzo.
    const antigua = makeProfile({
      reviews: { "duna-3": 6 },
      activity: [{ kind: "review", id: "duna-3", at: "2026-01-20", score: 6 }],
    });
    const reciente = makeProfile({
      reviews: { "duna-3": 9 },
      activity: [{ kind: "review", id: "duna-3", at: "2026-03-05", score: 9 }],
    });

    expect(mergeProfiles(reciente, antigua).reviews["duna-3"]).toBe(9);
    // Y da igual en qué orden se junten: el resultado debe ser el mismo.
    expect(mergeProfiles(antigua, reciente).reviews["duna-3"]).toBe(9);
  });

  it("conserva las reseñas que solo existen en un dispositivo", () => {
    const local = makeProfile({ reviews: { "solo-aqui": 8 } });
    const servidor = makeProfile({ reviews: { "solo-alla": 4 } });

    const resultado = mergeProfiles(local, servidor);

    expect(resultado.reviews).toEqual({ "solo-aqui": 8, "solo-alla": 4 });
  });

  it("sin constancia de cuándo se reseñó, se respeta la del servidor", () => {
    // Es el caso de un perfil viejo cuya actividad ya se recortó por antigüedad. Se prefiere la del
    // servidor porque es la que los demás dispositivos ya vieron: así un dispositivo que llevaba
    // meses apagado no resucita una opinión vieja.
    const local = makeProfile({ reviews: { "duna-3": 3 } });
    const servidor = makeProfile({ reviews: { "duna-3": 7 } });

    expect(mergeProfiles(local, servidor).reviews["duna-3"]).toBe(7);
  });

  it("la fecha de alta es la más antigua de las dos", () => {
    // Es guardián desde que empezó, no desde que estrenó su segundo dispositivo.
    const local = makeProfile({ createdAt: "2026-06-01" });
    const servidor = makeProfile({ createdAt: "2025-11-30" });

    expect(mergeProfiles(local, servidor).createdAt).toBe("2025-11-30");
  });

  it("los ajustes los decide el servidor", () => {
    // Un ajuste es una preferencia única: unir dos no significaría nada. Manda la copia que los demás
    // dispositivos ya conocen.
    const local = makeProfile({
      settings: { language: "en", genres: ["Terror"], platforms: [], theme: "light" },
    });
    const servidor = makeProfile({
      settings: { language: "es", genres: ["Drama"], platforms: ["Netflix"], theme: "dark" },
    });

    expect(mergeProfiles(local, servidor).settings).toEqual({
      language: "es",
      genres: ["Drama"],
      platforms: ["Netflix"],
      theme: "dark",
    });
  });

  it("la actividad se junta, se ordena por fecha y no repite la misma acción", () => {
    const local = makeProfile({
      activity: [
        { kind: "watched", id: "duna-3", at: "2026-03-10" },
        { kind: "watchlist", id: "avatar-4", at: "2026-01-02" },
      ],
    });
    const servidor = makeProfile({
      activity: [
        // La misma acción registrada en los dos sitios: debe aparecer UNA vez.
        { kind: "watched", id: "duna-3", at: "2026-03-10" },
        { kind: "watchlist", id: "wicked-2", at: "2026-02-14" },
      ],
    });

    const actividad = mergeProfiles(local, servidor).activity;

    expect(actividad).toHaveLength(3);
    expect(actividad.map((evento) => evento.at)).toEqual([
      "2026-03-10",
      "2026-02-14",
      "2026-01-02",
    ]);
  });

  it("la actividad no crece sin límite al sincronizar una y otra vez", () => {
    const muchosEventos = (desde: number) =>
      Array.from({ length: 40 }, (_, indice) => ({
        kind: "watched" as const,
        id: `titulo-${desde + indice}`,
        at: `2026-01-${String((indice % 28) + 1).padStart(2, "0")}`,
      }));

    const resultado = mergeProfiles(
      makeProfile({ activity: muchosEventos(0) }),
      makeProfile({ activity: muchosEventos(100) }),
    );

    // Ochenta eventos entran, pero la actividad es una memoria corta: se queda en su tope.
    expect(resultado.activity).toHaveLength(50);
  });

  it("nunca devuelve listas más largas de lo que el servidor acepta", () => {
    // Este caso protege contra un fallo especialmente traicionero: si la fusión devolviera listas por
    // encima del tope del servidor, el servidor rechazaría el perfil ENTERO en cada intento, para
    // siempre, sin ningún aviso. La persona solo se enteraría el día que entrara desde otro
    // dispositivo y no encontrara nada suyo.
    const cuatrocientos = (prefijo: string) =>
      Array.from({ length: 400 }, (_, indice) => `${prefijo}-${indice}`);

    const resultado = mergeProfiles(
      makeProfile({ watchlist: cuatrocientos("local"), watched: cuatrocientos("visto-local") }),
      makeProfile({
        watchlist: cuatrocientos("servidor"),
        watched: cuatrocientos("visto-servidor"),
      }),
    );

    expect(resultado.watchlist).toHaveLength(500);
    expect(resultado.watched).toHaveLength(500);
    // Al recortar se conservan los añadidos más recientemente, que están al final.
    expect(resultado.watchlist).toContain("servidor-399");
  });

  it("nunca devuelve más reseñas de las que el servidor acepta, y conserva las recientes", () => {
    const reseñas = (prefijo: string, cuantas: number) =>
      Object.fromEntries(
        Array.from({ length: cuantas }, (_, indice) => [`${prefijo}-${indice}`, 7]),
      );

    const resultado = mergeProfiles(
      makeProfile({
        reviews: reseñas("local", 400),
        // Una reseña con fecha reciente tiene que sobrevivir al recorte.
        activity: [{ kind: "review", id: "local-0", at: "2026-07-20", score: 7 }],
      }),
      makeProfile({ reviews: reseñas("servidor", 400) }),
    );

    expect(Object.keys(resultado.reviews)).toHaveLength(500);
    expect(resultado.reviews["local-0"]).toBe(7);
  });

  it("no modifica ninguno de los dos perfiles que recibe", () => {
    // Quien llama sigue usando el suyo mientras tanto; cambiárselo por debajo produce fallos que solo
    // aparecen a veces y son muy difíciles de reproducir.
    const local = makeProfile({ watchlist: ["duna-3"] });
    const servidor = makeProfile({ watchlist: ["avatar-4"] });

    mergeProfiles(local, servidor);

    expect(local.watchlist).toEqual(["duna-3"]);
    expect(servidor.watchlist).toEqual(["avatar-4"]);
  });
});

describe("isEmptyProfile", () => {
  it("un perfil recién creado está vacío", () => {
    expect(isEmptyProfile(makeProfile())).toBe(true);
  });

  it("elegir el tema NO cuenta como tener contenido", () => {
    // Importa: si contara, alguien que solo cambió a tema claro se consideraría "con datos" y su
    // perfil vacío se fusionaría con el del servidor en vez de adoptarlo tal cual.
    const soloTema = makeProfile({
      settings: { language: "es", genres: [], platforms: [], theme: "light" },
    });

    expect(isEmptyProfile(soloTema)).toBe(true);
  });

  it("cualquier título guardado, visto o reseñado ya es contenido", () => {
    expect(isEmptyProfile(makeProfile({ watchlist: ["duna-3"] }))).toBe(false);
    expect(isEmptyProfile(makeProfile({ watched: ["duna-3"] }))).toBe(false);
    expect(isEmptyProfile(makeProfile({ reviews: { "duna-3": 8 } }))).toBe(false);
  });
});
