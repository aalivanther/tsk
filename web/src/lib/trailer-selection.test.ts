// Archivo: trailer-selection.test.ts — Pruebas de la elección del tráiler.
//
// En español: esta es la lógica que decide QUÉ VIDEO VE LA PERSONA. Se prueba escalón por escalón,
// porque un error aquí no hace fallar nada: simplemente le enseña a alguien el tráiler equivocado (el
// doblaje de España a un público mexicano, o un video en inglés sin avisar) y nadie se entera. Por eso
// la función es pura y por eso estas pruebas no necesitan navegador: los mismos datos entran, el mismo
// resultado sale, siempre.

import { describe, expect, it } from "vitest";

import {
  selectComplementaryVideo,
  selectTrailer,
  type TrailerNotice,
} from "@/lib/trailer-selection";
import {
  ChannelKind,
  DubbingKind,
  VideoKind,
  type Video,
} from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// makeVideo arma un video de prueba con valores por defecto sanos.
//
// En español: por defecto el video está VERIFICADO como reproducible, es un tráiler oficial en inglés
// de un canal desconocido. Cada prueba cambia solo lo que le interesa, así se lee de un vistazo qué
// está probando cada caso y no hay veinte líneas de ruido en cada uno.
function makeVideo(overrides: Partial<Video>): Video {
  return {
    $typeName: "mdm7mo.catalog.v1.Video",
    youtubeKey: "key",
    language: "en",
    region: "US",
    kind: VideoKind.TRAILER,
    official: true,
    title: "Official Trailer",
    channel: "",
    channelKind: ChannelKind.UNSPECIFIED,
    dubbing: DubbingKind.ORIGINAL,
    publishedYear: 2026,
    resolution: 1080,
    playable: true,
    verifiedAt: "2026-07-29",
    ...overrides,
  };
}

// expectChoice comprueba de una vez el video elegido y el aviso que lo acompaña.
function expectChoice(
  choice: ReturnType<typeof selectTrailer>,
  expectedKey: string,
  expectedNotice: TrailerNotice,
): void {
  expect(choice).toBeDefined();
  expect(choice?.video.youtubeKey).toBe(expectedKey);
  expect(choice?.notice).toBe(expectedNotice);
}

describe("filtros duros: lo que nunca puede elegirse", () => {
  it("descarta un video que no se pudo verificar como reproducible", () => {
    // En español: es EL caso que produce la caja negra. Un video sin verificar no se muestra jamás.
    const videos = [makeVideo({ youtubeKey: "roto", playable: false })];
    expect(selectTrailer(videos, "es")).toBeUndefined();
  });

  it("descarta clips y detrás de cámaras: no son un tráiler", () => {
    const videos = [
      makeVideo({ youtubeKey: "clip", kind: VideoKind.CLIP }),
      makeVideo({ youtubeKey: "bts", kind: VideoKind.BEHIND_THE_SCENES }),
      makeVideo({ youtubeKey: "featurette", kind: VideoKind.FEATURETTE }),
    ];
    expect(selectTrailer(videos, "en")).toBeUndefined();
  });

  it("descarta un canal recopilador que TMDB tampoco marcó como oficial", () => {
    // En español: es el caso de "Colegio Abbott", cuyo tráiler venía de un canal recopilador y con
    // official=false en TMDB. Las dos señales coinciden, así que se puede excluir con confianza.
    const videos = [
      makeVideo({
        youtubeKey: "recopilador",
        channelKind: ChannelKind.AGGREGATOR,
        official: false,
      }),
    ];
    expect(selectTrailer(videos, "en")).toBeUndefined();
  });

  it("acepta un canal recopilador SI TMDB lo marcó como oficial, pero de últimas", () => {
    const videos = [
      makeVideo({ youtubeKey: "recopilador", channelKind: ChannelKind.AGGREGATOR, official: true }),
      makeVideo({ youtubeKey: "estudio", channelKind: ChannelKind.DISTRIBUTOR, official: true }),
    ];
    expectChoice(selectTrailer(videos, "en"), "estudio", "none");
  });

  it("devuelve nada cuando la lista viene vacía, que es el caso más común del catálogo", () => {
    // En español: casi 4 de cada 10 títulos no tienen ningún tráiler. No es un error, es lo normal.
    expect(selectTrailer([], "es")).toBeUndefined();
  });
});

describe("cadena en español: los diez escalones, en orden", () => {
  // Videos de todos los escalones a la vez. Cada prueba va quitando el de arriba para comprobar que
  // el siguiente toma el relevo exactamente en el orden diseñado.
  const mexicanDubbed = makeVideo({
    youtubeKey: "mx-doblado",
    language: "es",
    region: "MX",
    kind: VideoKind.TRAILER,
    dubbing: DubbingKind.DUBBED,
  });
  const mexicanSubtitled = makeVideo({
    youtubeKey: "mx-subtitulado",
    language: "es",
    region: "MX",
    kind: VideoKind.TRAILER,
    dubbing: DubbingKind.SUBTITLED,
  });
  const mexicanTeaser = makeVideo({
    youtubeKey: "mx-teaser",
    language: "es",
    region: "MX",
    kind: VideoKind.TEASER,
  });
  const spanishTrailer = makeVideo({
    youtubeKey: "es-trailer",
    language: "es",
    region: "ES",
    kind: VideoKind.TRAILER,
  });
  const spanishTeaser = makeVideo({
    youtubeKey: "es-teaser",
    language: "es",
    region: "ES",
    kind: VideoKind.TEASER,
  });
  const argentineTrailer = makeVideo({
    youtubeKey: "ar-trailer",
    language: "es",
    region: "AR",
    kind: VideoKind.TRAILER,
  });
  const argentineTeaser = makeVideo({
    youtubeKey: "ar-teaser",
    language: "es",
    region: "AR",
    kind: VideoKind.TEASER,
  });
  const englishTrailer = makeVideo({ youtubeKey: "en-trailer", kind: VideoKind.TRAILER });
  const englishTeaser = makeVideo({ youtubeKey: "en-teaser", kind: VideoKind.TEASER });
  const japaneseTrailer = makeVideo({
    youtubeKey: "ja-trailer",
    language: "ja",
    region: "JP",
    kind: VideoKind.TRAILER,
  });

  it("1. prefiere el tráiler mexicano DOBLADO por encima de todo", () => {
    // En español: quien pide español prefiere OÍR español. TMDB etiqueta como es-MX tanto el doblaje
    // latino como el tráiler en inglés con subtítulos latinos; el nombre del video los distingue.
    const videos = [mexicanSubtitled, englishTrailer, spanishTrailer, mexicanDubbed];
    expectChoice(selectTrailer(videos, "es"), "mx-doblado", "none");
  });

  it("2. sin doblado, toma cualquier tráiler mexicano", () => {
    const videos = [spanishTrailer, mexicanSubtitled, englishTrailer];
    expectChoice(selectTrailer(videos, "es"), "mx-subtitulado", "none");
  });

  it("3. sin tráiler mexicano, toma el teaser mexicano antes que el tráiler de España", () => {
    const videos = [spanishTrailer, mexicanTeaser, englishTrailer];
    expectChoice(selectTrailer(videos, "es"), "mx-teaser", "none");
  });

  it("4. sin nada de México, cae al tráiler de España", () => {
    const videos = [englishTrailer, spanishTeaser, spanishTrailer];
    expectChoice(selectTrailer(videos, "es"), "es-trailer", "none");
  });

  it("5. sin tráiler de España, toma el teaser de España", () => {
    const videos = [englishTrailer, argentineTrailer, spanishTeaser];
    expectChoice(selectTrailer(videos, "es"), "es-teaser", "none");
  });

  it("6. sin España, toma un tráiler en español de cualquier otra región", () => {
    const videos = [englishTrailer, argentineTrailer];
    expectChoice(selectTrailer(videos, "es"), "ar-trailer", "none");
  });

  it("7. sin tráiler en español, toma cualquier video en español que quede", () => {
    const videos = [englishTrailer, argentineTeaser];
    expectChoice(selectTrailer(videos, "es"), "ar-teaser", "none");
  });

  it("8. sin nada en español, cae al tráiler en inglés Y LO AVISA", () => {
    // En español: este es el requisito explícito del dueño. No se cuela un video en otro idioma en
    // silencio: si acaba en inglés, la pantalla tiene que decirlo.
    const videos = [japaneseTrailer, englishTrailer];
    expectChoice(selectTrailer(videos, "es"), "en-trailer", "englishWithSubtitles");
  });

  it("9. sin tráiler en inglés, toma el teaser en inglés con el mismo aviso", () => {
    const videos = [japaneseTrailer, englishTeaser];
    expectChoice(selectTrailer(videos, "es"), "en-teaser", "englishWithSubtitles");
  });

  it("10. sin español ni inglés, toma lo que haya avisando que está en su idioma original", () => {
    const videos = [japaneseTrailer];
    expectChoice(selectTrailer(videos, "es"), "ja-trailer", "originalLanguage");
  });
});

describe("cadena en inglés: prioridad por quién publicó el video", () => {
  const distributor = makeVideo({
    youtubeKey: "distribuidora",
    channelKind: ChannelKind.DISTRIBUTOR,
    channel: "Warner Bros. Pictures",
  });
  const indie = makeVideo({
    youtubeKey: "indie",
    channelKind: ChannelKind.INDIE,
    channel: "A24",
  });
  const platform = makeVideo({
    youtubeKey: "plataforma",
    channelKind: ChannelKind.PLATFORM,
    channel: "Netflix",
  });
  const unknownOfficial = makeVideo({ youtubeKey: "desconocido-oficial", official: true });
  const unknownUnofficial = makeVideo({ youtubeKey: "desconocido", official: false });
  const englishTeaser = makeVideo({ youtubeKey: "en-teaser", kind: VideoKind.TEASER });
  const spanishTrailer = makeVideo({ youtubeKey: "es-trailer", language: "es", region: "MX" });

  it("1. el tráiler del estudio gana a todo lo demás", () => {
    const videos = [platform, indie, unknownOfficial, distributor];
    expectChoice(selectTrailer(videos, "en"), "distribuidora", "none");
  });

  it("2. sin estudio, gana la distribuidora indie o el festival", () => {
    const videos = [platform, unknownOfficial, indie];
    expectChoice(selectTrailer(videos, "en"), "indie", "none");
  });

  it("3. sin indie, gana la plataforma de streaming", () => {
    const videos = [unknownOfficial, platform];
    expectChoice(selectTrailer(videos, "en"), "plataforma", "none");
  });

  it("4. sin canal reconocido, vale cualquier tráiler oficial en inglés", () => {
    const videos = [unknownUnofficial, unknownOfficial];
    expectChoice(selectTrailer(videos, "en"), "desconocido-oficial", "none");
  });

  it("5. sin ninguno oficial, acepta el tráiler en inglés no oficial", () => {
    const videos = [unknownUnofficial];
    expectChoice(selectTrailer(videos, "en"), "desconocido", "none");
  });

  it("6. sin tráiler en inglés, toma el teaser en inglés", () => {
    const videos = [spanishTrailer, englishTeaser];
    expectChoice(selectTrailer(videos, "en"), "en-teaser", "none");
  });

  it("7. sin nada en inglés, toma el tráiler en su idioma original y lo avisa", () => {
    const videos = [spanishTrailer];
    expectChoice(selectTrailer(videos, "en"), "es-trailer", "originalLanguage");
  });
});

describe("cadena para los demás idiomas del perfil", () => {
  it("portugués prefiere Brasil sobre Portugal", () => {
    // En español: el doblaje que llega a América Latina es el brasileño, no el europeo.
    const videos = [
      makeVideo({ youtubeKey: "pt-pt", language: "pt", region: "PT" }),
      makeVideo({ youtubeKey: "pt-br", language: "pt", region: "BR" }),
    ];
    expectChoice(selectTrailer(videos, "pt"), "pt-br", "none");
  });

  it("francés prefiere Francia", () => {
    const videos = [
      makeVideo({ youtubeKey: "fr-ca", language: "fr", region: "CA" }),
      makeVideo({ youtubeKey: "fr-fr", language: "fr", region: "FR" }),
    ];
    expectChoice(selectTrailer(videos, "fr"), "fr-fr", "none");
  });

  it("japonés cae al tráiler en inglés con aviso cuando no hay nada en japonés", () => {
    const videos = [makeVideo({ youtubeKey: "en-trailer" })];
    expectChoice(selectTrailer(videos, "ja"), "en-trailer", "englishWithSubtitles");
  });

  it("japonés avisa de idioma original cuando no hay ni japonés ni inglés", () => {
    const videos = [makeVideo({ youtubeKey: "ko-trailer", language: "ko", region: "KR" })];
    expectChoice(selectTrailer(videos, "ja"), "ko-trailer", "originalLanguage");
  });
});

describe("desempate dentro de un mismo escalón", () => {
  it("lo oficial va antes que lo no oficial", () => {
    const videos = [
      makeVideo({ youtubeKey: "a-no-oficial", official: false }),
      makeVideo({ youtubeKey: "z-oficial", official: true }),
    ];
    expectChoice(selectTrailer(videos, "en"), "z-oficial", "none");
  });

  it("a igual oficialidad, el mejor canal manda", () => {
    const videos = [
      makeVideo({ youtubeKey: "a-plataforma", channelKind: ChannelKind.PLATFORM, official: false }),
      makeVideo({ youtubeKey: "z-estudio", channelKind: ChannelKind.DISTRIBUTOR, official: false }),
    ];
    expectChoice(selectTrailer(videos, "en"), "z-estudio", "none");
  });

  it("a igual canal, gana el más reciente", () => {
    const videos = [
      makeVideo({ youtubeKey: "a-viejo", publishedYear: 2024 }),
      makeVideo({ youtubeKey: "z-nuevo", publishedYear: 2026 }),
    ];
    expectChoice(selectTrailer(videos, "en"), "z-nuevo", "none");
  });

  it("a igual fecha, gana el de mayor resolución", () => {
    const videos = [
      makeVideo({ youtubeKey: "a-baja", resolution: 480 }),
      makeVideo({ youtubeKey: "z-alta", resolution: 2160 }),
    ];
    expectChoice(selectTrailer(videos, "en"), "z-alta", "none");
  });

  it("a igualdad total, el resultado es SIEMPRE el mismo sin importar el orden de entrada", () => {
    // En español: sin este desempate final, la misma persona podría ver un tráiler distinto en cada
    // visita sin ninguna razón. El criterio es artificial a propósito: lo importante es que no cambie.
    const alpha = makeVideo({ youtubeKey: "alfa" });
    const beta = makeVideo({ youtubeKey: "beta" });
    expectChoice(selectTrailer([alpha, beta], "en"), "alfa", "none");
    expectChoice(selectTrailer([beta, alpha], "en"), "alfa", "none");
  });

  it("no modifica la lista que recibe", () => {
    // En español: los datos del catálogo se comparten entre varias pantallas. Si esta función
    // reordenara el arreglo original, cambiaría el catálogo de otras vistas sin querer.
    const videos = [makeVideo({ youtubeKey: "zzz" }), makeVideo({ youtubeKey: "aaa" })];
    selectTrailer(videos, "en");
    expect(videos.map((video) => video.youtubeKey)).toEqual(["zzz", "aaa"]);
  });
});

describe("video complementario", () => {
  it("prefiere la featurette sobre el detrás de cámaras, el teaser y el clip", () => {
    const videos = [
      makeVideo({ youtubeKey: "clip", kind: VideoKind.CLIP }),
      makeVideo({ youtubeKey: "teaser", kind: VideoKind.TEASER }),
      makeVideo({ youtubeKey: "bts", kind: VideoKind.BEHIND_THE_SCENES }),
      makeVideo({ youtubeKey: "featurette", kind: VideoKind.FEATURETTE }),
    ];
    expect(selectComplementaryVideo(videos, "es", undefined)?.youtubeKey).toBe("featurette");
  });

  it("nunca repite el video que ya se está mostrando como tráiler", () => {
    const videos = [
      makeVideo({ youtubeKey: "elegido", kind: VideoKind.TEASER }),
      makeVideo({ youtubeKey: "otro", kind: VideoKind.CLIP }),
    ];
    expect(selectComplementaryVideo(videos, "es", "elegido")?.youtubeKey).toBe("otro");
  });

  it("dentro de la misma clase, prefiere el idioma de la persona", () => {
    const videos = [
      makeVideo({ youtubeKey: "en-featurette", kind: VideoKind.FEATURETTE, language: "en" }),
      makeVideo({
        youtubeKey: "es-featurette",
        kind: VideoKind.FEATURETTE,
        language: "es",
        region: "MX",
      }),
    ];
    expect(selectComplementaryVideo(videos, "es", undefined)?.youtubeKey).toBe("es-featurette");
  });

  it("descarta lo que no se puede reproducir", () => {
    const videos = [makeVideo({ youtubeKey: "roto", kind: VideoKind.CLIP, playable: false })];
    expect(selectComplementaryVideo(videos, "es", undefined)).toBeUndefined();
  });

  it("devuelve nada cuando el único video es el tráiler que ya se muestra", () => {
    // En español: entonces la ficha NO dibuja la sección. Un hueco vacío es peor que no tenerla.
    const videos = [makeVideo({ youtubeKey: "solo-uno", kind: VideoKind.TRAILER })];
    expect(selectComplementaryVideo(videos, "es", "solo-uno")).toBeUndefined();
  });

  it("no acepta un tráiler suelto como complementario", () => {
    // En español: el complementario es "para profundizar"; otro tráiler del mismo título no aporta.
    const videos = [makeVideo({ youtubeKey: "otro-trailer", kind: VideoKind.TRAILER })];
    expect(selectComplementaryVideo(videos, "es", "el-elegido")).toBeUndefined();
  });
});

describe("caso real medido: Spider-Man: Un nuevo día", () => {
  // En español: estos son los videos REALES que TMDB devuelve para esa película cuando se le piden
  // los idiomas correctos. Antes de este trabajo el catálogo guardaba el tráiler en inglés
  // (P3uI5sLosKU) existiendo cinco tráilers mexicanos oficiales que nunca se llegaban a pedir. Esta
  // prueba fija que eso no puede volver a pasar.
  const realVideos = [
    makeVideo({
      youtubeKey: "QXibcL7-XbU",
      language: "es",
      region: "MX",
      title: "Spider-Man: Un Nuevo Día: Tráiler Final (El Viaje de Peter) (Doblado)",
      dubbing: DubbingKind.DUBBED,
      publishedYear: 2026,
      channelKind: ChannelKind.DISTRIBUTOR,
    }),
    makeVideo({
      youtubeKey: "pFcUZ5cG_HE",
      language: "es",
      region: "MX",
      title: "SPIDER-MAN: UN NUEVO DÍA - Nuevo Tráiler (Subtitulado)",
      dubbing: DubbingKind.SUBTITLED,
      publishedYear: 2026,
      channelKind: ChannelKind.DISTRIBUTOR,
    }),
    makeVideo({
      youtubeKey: "P3uI5sLosKU",
      language: "en",
      region: "US",
      title: "Final Trailer (Peter's Journey)",
      publishedYear: 2026,
      channelKind: ChannelKind.DISTRIBUTOR,
    }),
  ];

  it("a quien elige español le da el doblaje mexicano, no el inglés ni el subtitulado", () => {
    expectChoice(selectTrailer(realVideos, "es"), "QXibcL7-XbU", "none");
  });

  it("a quien elige inglés le da el tráiler de la distribuidora en inglés", () => {
    expectChoice(selectTrailer(realVideos, "en"), "P3uI5sLosKU", "none");
  });
});

describe("caso real medido: Batman: El enmascarado", () => {
  // En español: el catálogo guardaba el tráiler de ESPAÑA existiendo el mexicano, porque el mexicano
  // ni siquiera se pedía a TMDB. Este es el caso que mejor resume el fallo que se corrigió.
  const realVideos = [
    makeVideo({
      youtubeKey: "cgaG_XMdntA",
      language: "es",
      region: "ES",
      title: "Tráiler en español",
    }),
    makeVideo({
      youtubeKey: "A-JfvlLJgvM",
      language: "es",
      region: "MX",
      title: "Tráiler oficial [Doblado]",
      dubbing: DubbingKind.DUBBED,
    }),
    makeVideo({
      youtubeKey: "1TRK90KSkFM",
      language: "en",
      region: "US",
      title: "Official Trailer",
    }),
  ];

  it("el doblaje mexicano gana al de España", () => {
    expectChoice(selectTrailer(realVideos, "es"), "A-JfvlLJgvM", "none");
  });
});
