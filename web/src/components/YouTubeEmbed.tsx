"use client";

// Archivo: YouTubeEmbed.tsx — Reproductor de YouTube con carga PEREZOSA (lazy) y marco de rareza.
//
// En español: este componente muestra un video de YouTube SIN cargarlo de entrada. Primero pinta un
// "póster" (la imagen real del estreno) con un botón de reproducir; SOLO cuando la persona pulsa ese
// botón se inserta el <iframe> real de YouTube. A esto se le llama una FACHADA, y es lo que permite
// poner el tráiler en la previa sin hundir la página. ¿Por qué así? Por tres razones:
//   1) Rendimiento: no descargamos el pesado reproductor de YouTube hasta que alguien quiere verlo.
//   2) Privacidad: usamos el dominio "youtube-nocookie.com" (modo de privacidad mejorada de YouTube),
//      que no deja cookies de seguimiento hasta que el usuario decide reproducir.
//   3) Degradado DIGNO, y con TRES estados distintos que no se confunden entre sí:
//        · "Cargando el tráiler…" mientras la ficha del título viene en camino y aún no se sabe nada.
//        · "Tráiler no disponible" cuando se sabe con certeza que ese título no tiene ningún video
//          publicado — el caso de una quinta parte larga del catálogo, medido, no estimado.
//        · "No se pudo cargar el tráiler" cuando la ficha no llegó y por tanto no se sabe si lo hay.
//      Los tres se pintan sobre la imagen real del estreno, sin botón que lleve a ningún lado y sin
//      inventar un video que no existe. Ninguno es un error de programa: son situaciones normales.
//      Mezclarlos fue un defecto real: con el servidor caído, la ficha llegaba a afirmar a la vez que
//      el título no tiene tráiler (falso) y que no se había podido cargar.
//
// QUÉ RECIBE ESTE COMPONENTE, y por qué importa: recibe el OBJETO de video completo (ya verificado por
// el generador del catálogo) o nada. Antes recibía un texto suelto con el código de YouTube, y ese
// texto podía apuntar a un video borrado, privado o que prohíbe incrustarse: eso es exactamente la
// caja negra que reportó el dueño. Con un objeto verificado, pasarle un video sin comprobar es
// imposible por construcción, no por disciplina.
//
// El "marco de rareza" (framed) es opcional: cuando se pasa, el contenedor recibe el borde/halo del
// nivel (legendary/epic/rare/common) que viven como clases en globals.css (rf-frame + rf-t-*). Así el
// tráiler héroe del detalle queda enmarcado con el mismo lenguaje visual que las cards de la timeline.
//
// FUENTE DE VERDAD: el cascarón v3 (.dr-hero / .dr-play / .vcomp del detalle) y su botón "▶" que en el
// cascarón solo lanzaba un alert; aquí se convierte en un embed real, accesible y diferido.

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";

import { cssUrl, gradientStyleFor } from "@/lib/timeline";
import { ui } from "@/lib/i18n";
import type { Tier } from "@/lib/rarity";
import type { TrailerNotice } from "@/lib/trailer-selection";
import type { Video } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// YOUTUBE_NOCOOKIE_EMBED_BASE es la base de la URL del reproductor de YouTube en modo privacidad.
// En español: usamos el dominio "youtube-nocookie.com" (el oficial de YouTube para incrustar videos
// sin cookies de seguimiento hasta que se reproduce). A esta base le añadimos la "key" del video y el
// parámetro de autoplay (porque el iframe se inserta justo tras el clic, así arranca solo).
const YOUTUBE_NOCOOKIE_EMBED_BASE = "https://www.youtube-nocookie.com/embed/";

// TIER_FRAME_CLASS asigna a cada nivel de rareza la clase CSS de su marco (definida en globals.css).
// En español: el marco (borde + halo) se aplica por CLASE porque usa pseudo-elementos y animaciones
// (el "sheen" del legendario) que no se pueden expresar con el atributo "style" de React. Estas
// clases (rf-frame base + rf-t-<nivel>) viven en globals.css y se anulan bajo prefers-reduced-motion.
const TIER_FRAME_CLASS: Record<Tier, string> = {
  legendary: "rf-frame rf-t-legendary",
  epic: "rf-frame rf-t-epic",
  rare: "rf-frame rf-t-rare",
  common: "rf-frame rf-t-common",
};

// YouTubeEmbedProps son las propiedades del reproductor diferido.
// En español: define qué necesita el componente para dibujarse y comportarse bien.
type YouTubeEmbedProps = {
  // video es el video YA VERIFICADO que hay que reproducir, o undefined si no hay ninguno.
  // En español: undefined significa "este estreno no tiene tráiler", que es un estado normal y
  // frecuente; el componente entonces pinta el estado digno "Tráiler no disponible".
  video: Video | undefined;
  // title es el texto descriptivo del video (normalmente el título del estreno). Se usa para las
  // etiquetas accesibles (aria-label del botón y title del iframe), para que el video tenga nombre.
  title: string;
  // framed es el nivel de rareza OPCIONAL del que viene el marco. Si se pasa, el contenedor recibe el
  // borde/halo de ese nivel; si no, queda sin marco (un borde neutro). El marco visual es informativo.
  framed?: Tier;
  // caption es el rótulo OPCIONAL bajo el botón de reproducir (ej. "Tráiler · YouTube"). Si no se da,
  // no se muestra ningún rótulo. Es decorativo respecto al video (el aria-label ya lo nombra).
  caption?: string;
  // seed es la semilla OPCIONAL del degradado del póster (placeholder de Fase 0, sin imágenes reales).
  // Igual estreno -> igual degradado. Si no se pasa, se usa 0 (un degradado válido y estable).
  seed?: number;
  // unavailableLabel es el texto OPCIONAL del estado "no disponible". Permite distinguir el tráiler
  // ("Tráiler no disponible") del video complementario ("Video complementario no disponible"). Si no
  // se pasa, se usa el de tráiler por defecto.
  unavailableLabel?: string;
  // posterUrl es la imagen REAL OPCIONAL del póster del hero (normalmente el backdrop del estreno). Si se
  // pasa, el estado "póster"/"no disponible" la usa de fondo (cine real) en vez del degradado de respaldo.
  posterUrl?: string;
  // overlay es contenido OPCIONAL superpuesto en la base del hero (badge + título + meta) que convierte
  // el tráiler en un HERO cinematográfico. Solo se muestra en el estado póster/no-disponible (NO sobre el
  // video en reproducción). No captura el puntero (pointer-events:none) para que el clic siga reproduciendo.
  overlay?: ReactNode;
  // captionLang es el código de idioma OPCIONAL preferido del usuario (ej. "es", "en"). Si se pasa, el
  // reproductor carga los subtítulos en ese idioma (cc_lang_pref + cc_load_policy) y su interfaz en él (hl).
  captionLang?: string;
  // notice es el AVISO que hay que enseñar cuando el video elegido NO está en el idioma que la
  // persona pidió (ver TrailerNotice en lib/trailer-selection). "none" o ausente = nada que avisar.
  // Es la petición explícita del dueño: nunca colar un video en otro idioma en silencio.
  notice?: TrailerNotice;
  // loading dice que el video TODAVÍA NO SE SABE porque la ficha del título viene en camino.
  //
  // Por qué hace falta distinguirlo, en español: "todavía no lo sé" y "no existe" son dos cosas
  // distintas y se parecen mucho en pantalla. La lista de estrenos ya no carga los videos de los
  // trescientos títulos —eran una quinta parte del peso de la página—, así que al abrir un título hay
  // un instante en el que la ficha viene en camino. Sin este aviso, ese instante se dibujaría como
  // "Tráiler no disponible": una afirmación falsa que además desaparecería sola un momento después,
  // que es justo el parpadeo que no se quiere. Con él, la persona lee lo que de verdad está pasando.
  loading?: boolean;
  // failed dice que la ficha del título NO SE PUDO TRAER, así que no se sabe si hay tráiler o no.
  //
  // Por qué es un tercer estado y no un caso del anterior, en español: sin él, un servidor caído hacía
  // que la ficha afirmara dos cosas contradictorias a la vez —arriba "este título aún no tiene tráiler
  // publicado", abajo "no pudimos cargar la ficha"—. La primera afirmación era sencillamente falsa, y
  // como una quinta parte larga del catálogo tampoco tiene tráiler de verdad, no había forma de saber
  // cuál de las dos cosas estaba pasando. Con este estado, el reproductor deja de afirmar nada sobre
  // el video y dice lo único que se sabe. Manda sobre "cargando": si ya falló, no está llegando nada.
  failed?: boolean;
};

// NOTICE_LABELS traduce cada aviso a su texto visible en es-MX.
// En español: el módulo de elección devuelve un identificador (código, en inglés) y aquí se convierte
// en la frase que lee la persona. Así la lógica se puede probar sin pantalla y el texto vive con el
// resto del texto de la interfaz.
const NOTICE_LABELS: Record<TrailerNotice, string> = {
  none: "",
  englishWithSubtitles: ui.detail.trailerNoticeEnglish,
  originalLanguage: ui.detail.trailerNoticeOriginal,
};

// NOTICE_STYLE es el aspecto del aviso de idioma, escrito aquí y no en la hoja de estilos global.
// En español: es una píldora oscura con borde tenue, centrada en la parte de arriba del reproductor.
// El fondo es casi opaco a propósito: el aviso se pinta encima de un fotograma de película, y sobre
// una imagen clara un texto tenue sería ilegible. Con este fondo el contraste queda en 12,2:1 incluso
// en el peor caso (imagen blanca detrás), muy por encima del mínimo AA de 4,5:1 que este proyecto no
// negocia.
const NOTICE_STYLE: CSSProperties = {
  position: "absolute",
  top: "12px",
  // Centrado horizontal: las esquinas superiores ya están ocupadas en la previa (la rareza a la
  // izquierda, la calificación a la derecha) y la base la ocupa el título del hero en el detalle. El
  // centro de arriba es el único sitio que está libre en las dos pantallas, así que el aviso cae
  // siempre en el mismo lugar y nunca tapa otro dato.
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 2,
  maxWidth: "calc(100% - 24px)",
  padding: "5px 11px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,.18)",
  // Fondo casi opaco a propósito: esto se pinta encima de un fotograma de película, y sobre una
  // imagen clara un texto tenue sería ilegible. Así el contraste cumple el mínimo AA pase lo que pase
  // detrás, que en este proyecto no es negociable.
  background: "rgba(7,8,9,.88)",
  color: "#e8e6e3",
  fontSize: "10px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  lineHeight: 1.4,
  textAlign: "center",
  // No captura el puntero: el clic tiene que seguir llegando al botón de reproducir que hay debajo.
  pointerEvents: "none",
};

// UNAVAILABLE_VEIL es el velo oscuro que se pone sobre la imagen en el estado "sin tráiler".
//
// POR QUÉ ES TAN OSCURO Y POR QUÉ ESE NÚMERO EXACTO, en español: el texto de este estado va CENTRADO,
// y el velo que usa el resto del componente solo oscurece la base de la imagen. Sobre un fotograma
// claro —un oso de peluche sobre una pared iluminada, por poner el caso real que se vio— el texto
// quedaba prácticamente ilegible. El contraste mínimo AA no es negociable en este proyecto, así que
// aquí el velo cubre TODO el marco con opacidad 0,82, que es el peor caso calculado: incluso si la
// imagen de debajo fuera blanca del todo, el fondo resultante deja el rótulo en 11,4:1 y la
// explicación en 7,7:1, ambos muy por encima del mínimo de 4,5:1. La imagen sigue viéndose como textura,
// que es lo que hace que este estado se lea como una decisión de diseño y no como un hueco.
const UNAVAILABLE_VEIL =
  "linear-gradient(0deg, rgba(7,8,9,.9), rgba(7,8,9,.82) 55%, rgba(7,8,9,.86))";

// UNAVAILABLE_LABEL_COLOR y UNAVAILABLE_HINT_COLOR son los colores del texto de ese estado.
//
// Son valores FIJOS y no variables del tema a propósito: el velo de arriba es siempre oscuro, así que
// en el tema claro los colores de texto del sitio (pensados para fondo claro) se volverían ilegibles
// justo aquí. Un texto claro sobre un velo oscuro es correcto en los dos temas.
const UNAVAILABLE_LABEL_COLOR = "#f5f5f7";
const UNAVAILABLE_HINT_COLOR = "#c9cbd3";

// YouTubeEmbed dibuja el póster con botón y, tras el clic, el iframe del video; o el estado sin video.
// En español: mantiene un único estado interno —si la persona ya pidió reproducir— para decidir qué
// pintar. Antes del clic: el póster (la imagen real del estreno) + botón de reproducir accesible.
// Después del clic: el iframe real de YouTube (en modo privacidad y con autoplay). Sin video: el
// estado digno "Tráiler no disponible".
export function YouTubeEmbed({
  video,
  title,
  framed,
  caption,
  seed = 0,
  unavailableLabel = ui.detail.trailerUnavailable,
  posterUrl,
  overlay,
  captionLang,
  notice,
  loading = false,
  failed = false,
}: YouTubeEmbedProps) {
  // playingKey guarda el CÓDIGO del video que la persona pidió reproducir, o null si todavía ninguno.
  //
  // Por qué se guarda el código y no un simple "sí/no", en español: en la previa, el reproductor es
  // el mismo mientras la persona va cambiando de título en el carrusel de la izquierda. Con un
  // "sí/no", al cambiar de título el reproductor seguiría creyendo que está reproduciendo y se oiría
  // el tráiler del título anterior encima de la ficha del nuevo. Guardando el código, la comparación
  // de abajo deja de coincidir en cuanto cambia el video y todo vuelve solo al póster, sin ningún
  // efecto secundario que sincronizar a mano.
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  // isPlaying es cierto solo si lo que se pidió reproducir es EXACTAMENTE el video que toca ahora.
  const isPlaying = video !== undefined && playingKey === video.youtubeKey;

  // startPlaying marca este video como "en reproducción", lo que provoca que se inserte el iframe.
  // En español: es el manejador del clic del botón de reproducir. Memoizado para no recrearlo en cada
  // render (estabilidad de la referencia que pasamos al onClick).
  const youtubeKey = video?.youtubeKey;
  const startPlaying = useCallback(() => {
    if (youtubeKey === undefined) {
      return;
    }
    setPlayingKey(youtubeKey);
  }, [youtubeKey]);

  // Texto del aviso de idioma, si lo hay. Vacío significa que no hay nada que avisar.
  const noticeLabel = notice !== undefined ? NOTICE_LABELS[notice] : "";

  // Clase del marco de rareza: si se pasó "framed", tomamos su clase; si no, un borde neutro sencillo.
  // En español: el contenedor siempre lleva el mismo redondeo y recorte; lo único que cambia es el
  // marco (con halo de rareza, o un borde simple cuando no hay nivel).
  const frameClassName = framed !== undefined ? TIER_FRAME_CLASS[framed] : "rf-frame";

  // Clase del contenedor: marco de rareza + base. Si es HERO (lleva overlay), añadimos "rf-hero" para
  // el relieve y la textura extra (capa rf-hero-tex). Así el hero del detalle se distingue del resto.
  const containerClassName = `${frameClassName} relative aspect-video w-full overflow-hidden${
    overlay ? " rf-hero" : ""
  }`;

  // Fondo del póster del hero: la imagen REAL (backdrop) si se pasó posterUrl; si no, el degradado de
  // respaldo por semilla. Igual estreno -> igual degradado cuando no hay imagen.
  const posterBackgroundStyle: CSSProperties = posterUrl
    ? {
        // cssUrl escapa/valida la URL (anti-inyección CSS); ver su doc en lib/timeline.
        backgroundImage: cssUrl(posterUrl),
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : gradientStyleFor(seed);

  // Velo del hero: si hay overlay (título encima), oscurecemos MÁS la base para que el texto se lea AA;
  // si no, una viñeta inferior suave. En ambos casos es decorativo.
  const heroVeil = overlay
    ? "linear-gradient(0deg, rgba(7,8,9,.92), rgba(7,8,9,.25) 52%, rgba(7,8,9,.45))"
    : "linear-gradient(0deg, rgba(7,8,9,.55), transparent 60%)";

  // ----- LOS TRES ESTADOS SIN REPRODUCTOR: cargando, sin tráiler y no se pudo cargar. -----
  //
  // Los tres se dibujan con el MISMO marco, la misma imagen de fondo y el mismo velo, de modo que al
  // pasar de uno a otro (o al llegar por fin el video) no se mueve ni un píxel de la pantalla. Lo
  // único que cambia entre ellos es lo que dicen, que es justamente lo que tenía que cambiar.
  //
  // POR QUÉ SON TRES Y NO DOS, que es la corrección: "no se sabe todavía", "no existe" y "no se pudo
  // averiguar" son tres situaciones distintas y antes las tres últimas se pintaban como la de en
  // medio. Con el servidor caído, la ficha llegó a afirmar a la vez que el título no tiene tráiler
  // —falso— y que no se había podido cargar. Ahora cada estado dice lo suyo y ninguno afirma de más.
  //
  // El ORDEN de las comprobaciones importa: el fallo manda sobre la carga (si ya falló, no está
  // llegando nada) y los dos mandan sobre "no hay video" (mientras no se sepa, no se puede afirmar).
  if (failed) {
    return (
      <TrailerStatePanel
        containerClassName={containerClassName}
        posterBackgroundStyle={posterBackgroundStyle}
        overlay={overlay}
        state="failed"
        label={ui.detail.trailerFailed}
        hint={ui.detail.trailerFailedHint}
      />
    );
  }

  if (loading) {
    return (
      <TrailerStatePanel
        containerClassName={containerClassName}
        posterBackgroundStyle={posterBackgroundStyle}
        overlay={overlay}
        state="loading"
        label={ui.stage.trailerLoading}
        // Sin explicación debajo: el rótulo ya lo dice todo y una frase extra que va a desaparecer en
        // un instante solo mueve el ojo. El símbolo late (ver TrailerStatePanel) y eso ya comunica
        // "esto está en marcha" mejor que cualquier texto añadido.
        hint=""
        busy
      />
    );
  }

  // Sin video: el estreno NO tiene tráiler. Esto no es un fallo del catálogo ni un hueco que rellenar.
  // Se midió: una quinta parte larga de los títulos no tiene ningún tráiler publicado, porque el video
  // sencillamente no existe. Por eso se trata como lo que es, un estado normal del producto, con CERO
  // botones que no lleven a ninguna parte. Prometer un reproductor y dar una caja negra fue el defecto
  // original que este componente vino a corregir.
  if (video === undefined) {
    return (
      <TrailerStatePanel
        containerClassName={containerClassName}
        posterBackgroundStyle={posterBackgroundStyle}
        overlay={overlay}
        state="unavailable"
        label={unavailableLabel}
        hint={ui.detail.trailerUnavailableHint}
      />
    );
  }

  // ----- Estado REPRODUCIENDO: ya se pulsó el botón. Insertamos el iframe real de YouTube. -----
  // En español: solo llegamos aquí tras el clic. Construimos la URL en modo privacidad con autoplay
  // (el video arranca solo, ya que el usuario acaba de pedir verlo). El iframe lleva un "title"
  // accesible (obligatorio para a11y) que nombra el video.
  if (isPlaying) {
    // URL final: base de privacidad + key del video + autoplay=1 (arranca tras el clic). Si el usuario
    // eligió un IDIOMA preferido (captionLang), pedimos a YouTube los subtítulos en ese idioma:
    //   - hl: idioma de la interfaz del reproductor.
    //   - cc_lang_pref: idioma PREFERIDO de los subtítulos.
    //   - cc_load_policy=1: forzar que los subtítulos se muestren de entrada.
    const languageParams =
      captionLang !== undefined && captionLang !== ""
        ? `&hl=${encodeURIComponent(captionLang)}&cc_lang_pref=${encodeURIComponent(captionLang)}&cc_load_policy=1`
        : "";
    const embedSource = `${YOUTUBE_NOCOOKIE_EMBED_BASE}${encodeURIComponent(video.youtubeKey)}?autoplay=1${languageParams}`;
    return (
      <div className={containerClassName} data-trailer-state="playing">
        <iframe
          className="absolute inset-0 h-full w-full"
          src={embedSource}
          // title accesible del iframe: imprescindible para lectores de pantalla (nombra el contenido).
          title={ui.detail.embedTitle(title)}
          // Permisos mínimos para que el reproductor funcione (autoplay, pantalla completa, etc.).
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          // referrerPolicy estricta: no filtramos la URL completa de origen al incrustar el video.
          referrerPolicy="strict-origin-when-cross-origin"
        />
        {/*
          Aviso de idioma SOBRE el video en reproducción. Sigue visible mientras se ve el tráiler,
          porque es justo entonces cuando la persona necesita saber que lo que está oyendo no está en
          el idioma que pidió. Se coloca arriba a la izquierda para no tapar los controles del
          reproductor, que viven en la base.
        */}
        {noticeLabel !== "" ? (
          <p className="font-mono" style={NOTICE_STYLE} data-trailer-notice="true">
            {noticeLabel}
          </p>
        ) : null}
      </div>
    );
  }

  // ----- Estado PÓSTER (por defecto): degradado + botón de reproducir. Carga perezosa. -----
  // En español: este es el estado inicial. El botón cubre todo el área (es fácil de pulsar y de
  // enfocar por teclado) y lleva un aria-label que nombra el video. Al pulsarlo, startPlaying cambia
  // el estado y, en el siguiente render, se inserta el iframe.
  return (
    <div className={containerClassName} data-trailer-state="ready">
      {/* Fondo del póster: el backdrop real si hay posterUrl; si no, el degradado de respaldo. Decorativo. */}
      <div className="absolute inset-0" style={posterBackgroundStyle} aria-hidden="true" />
      {/* Viñeta de legibilidad (más oscura abajo si hay overlay de título). Decorativa. */}
      <div className="absolute inset-0" aria-hidden="true" style={{ background: heroVeil }} />
      {/* Capa de TEXTURA/RELIEVE del hero (grano + sheen superior + viñeta), solo cuando es hero. */}
      {overlay ? <div className="rf-hero-tex" aria-hidden="true" /> : null}
      {/*
        Botón de reproducir que ocupa todo el contenedor: el área de clic es grande y el control es
        uno solo (mejor para teclado y para tocar en móvil). Su aria-label nombra el video; el círculo
        con "▶" y el caption son decorativos (aria-hidden), pues el aria-label ya comunica la acción.
      */}
      <button
        type="button"
        onClick={startPlaying}
        aria-label={ui.detail.playTrailerAria(title)}
        className="rf-play absolute inset-0 z-[1] flex cursor-pointer flex-col items-center justify-center gap-[9px]"
      >
        {/* Círculo con el triángulo de "play". Decorativo: el aria-label del botón ya dice qué hace. */}
        <span
          aria-hidden="true"
          className="rf-play-circle flex h-[60px] w-[60px] items-center justify-center rounded-full text-lg text-white"
          style={{
            border: "1px solid rgba(255,255,255,.3)",
            background: "rgba(7,8,9,.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          ▶
        </span>
        {/* Rótulo opcional bajo el botón (ej. "Tráiler · YouTube"). Se OCULTA si hay overlay (título), para
            no encimarse con él en pantallas chicas: el botón ▶ ya comunica la acción. Decorativo. */}
        {caption !== undefined && !overlay ? (
          <span
            aria-hidden="true"
            className="font-mono text-[10px] tracking-[0.16em] uppercase text-text-muted"
          >
            {caption}
          </span>
        ) : null}
      </button>
      {/*
        Aviso de idioma sobre el póster, ANTES de reproducir. Va fuera del botón a propósito: si
        estuviera dentro, el lector de pantalla lo leería como parte del nombre del botón ("Reproducir
        X, tráiler en inglés..."), y lo que es una advertencia se convertiría en ruido en la etiqueta
        de un control. No captura el puntero, así que el clic sigue llegando al botón que hay debajo.
      */}
      {noticeLabel !== "" ? (
        <p className="font-mono" style={NOTICE_STYLE} data-trailer-notice="true">
          {noticeLabel}
        </p>
      ) : null}
      {/* Overlay del hero (badge + título + meta) en la base. z sobre el botón pero sin capturar el
          puntero, así el clic en cualquier parte del hero sigue reproduciendo el tráiler. */}
      {overlay ? <div className="rf-hero-overlay">{overlay}</div> : null}
    </div>
  );
}

// TrailerStateName son los tres estados en los que el marco del tráiler no lleva reproductor.
//
// En español: "loading" es "la ficha viene en camino y aún no se sabe"; "unavailable" es "este título
// no tiene tráiler, y es un dato cierto"; "failed" es "no pudimos traer la ficha, así que no sabemos".
// Viajan también al atributo data-trailer-state del marco, que es por donde las pruebas automáticas
// comprueban cuál de los tres se está enseñando sin depender del texto.
type TrailerStateName = "loading" | "unavailable" | "failed";

// TrailerStatePanelProps son las propiedades del panel compartido por esos tres estados.
type TrailerStatePanelProps = {
  // containerClassName es la clase del marco (rareza + proporción), calculada por quien lo usa.
  containerClassName: string;
  // posterBackgroundStyle es el fondo: la imagen real del estreno o el degradado de respaldo.
  posterBackgroundStyle: CSSProperties;
  // overlay es el bloque superpuesto del hero (marca, título y meta), o nada si no es un hero.
  overlay: ReactNode;
  // state es cuál de los tres estados se está enseñando.
  state: TrailerStateName;
  // label es el rótulo grande, en mayúsculas.
  label: string;
  // hint es la frase que lo explica. Vacía significa que no se escribe ninguna.
  hint: string;
  // busy marca que falta información por llegar: hace latir el símbolo y avisa a los lectores de
  // pantalla de que lo que están leyendo va a cambiar, en vez de dejarles creer que es definitivo.
  busy?: boolean;
};

// TrailerStatePanel dibuja el marco del tráiler cuando no hay reproductor que enseñar.
//
// POR QUÉ EXISTE ESTE COMPONENTE, en español: los tres estados comparten el marco entero —la imagen
// de fondo, el velo oscuro que garantiza el contraste, la textura del hero y el bloque centrado— y
// solo se diferencian en dos frases. Escritos por separado eran el mismo bloque copiado tres veces, y
// tres copias del mismo dibujo acaban SIEMPRE divergiendo: se retoca el velo de una y las otras dos se
// quedan atrás, y entonces la pantalla da un salto al cambiar de estado. Con una sola copia eso no
// puede ocurrir: los tres se ven idénticos por construcción y no por disciplina.
function TrailerStatePanel({
  containerClassName,
  posterBackgroundStyle,
  overlay,
  state,
  label,
  hint,
  busy = false,
}: TrailerStatePanelProps) {
  return (
    <div
      className={containerClassName}
      // role="img" + aria-label: para un lector de pantalla esto es una imagen con un texto que
      // explica la situación, no un control con el que se pueda interactuar (no hay nada que pulsar).
      role="img"
      aria-label={label}
      aria-busy={busy ? "true" : undefined}
      data-trailer-state={state}
    >
      {/* Fondo: la imagen real del estreno si la hay; si no, el degradado de respaldo. Decorativo. */}
      <div className="absolute inset-0" style={posterBackgroundStyle} aria-hidden="true" />
      {/* Velo OSCURO Y COMPLETO sobre la imagen. Ver UNAVAILABLE_VEIL para el porqué del número. */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{ background: UNAVAILABLE_VEIL }}
      />
      {/* Capa de textura y relieve del hero (grano, brillo superior y viñeta), solo cuando es hero. */}
      {overlay ? <div className="rf-hero-tex" aria-hidden="true" /> : null}
      {/*
        Bloque central: un símbolo tenue, el rótulo y la explicación. El símbolo es decorativo (el
        aria-label ya nombra el estado). El conjunto se centra y respira, para que se lea como una
        decisión de diseño y no como algo que se rompió al cargar.
      */}
      <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-[9px] px-6 text-center">
        <span
          aria-hidden="true"
          // El latido (tl-skeleton) solo cuando falta algo por llegar: es la misma señal de espera que
          // el resto de la aplicación, y se detiene sola si la persona pidió menos movimiento.
          className={`${busy ? "tl-skeleton " : ""}flex h-[46px] w-[46px] items-center justify-center rounded-full text-base`}
          style={{
            border: "1px solid rgba(255,255,255,.22)",
            background: "rgba(7,8,9,.45)",
            color: UNAVAILABLE_HINT_COLOR,
          }}
        >
          ◎
        </span>
        <span
          className="font-mono text-[11px] tracking-[0.14em] uppercase"
          style={{ color: UNAVAILABLE_LABEL_COLOR }}
        >
          {label}
        </span>
        {hint !== "" ? (
          <span
            className="max-w-[36ch] text-[12px] leading-[1.5]"
            style={{ color: UNAVAILABLE_HINT_COLOR }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      {/* Overlay del hero (marca, título y meta), en la base. No captura el puntero. */}
      {overlay ? <div className="rf-hero-overlay">{overlay}</div> : null}
    </div>
  );
}
