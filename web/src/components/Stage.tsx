"use client";

// Archivo: Stage.tsx — El MODAL de categoría con CARRUSEL VERTICAL + panel de PREVIA/DETALLE.
//
// En español: cuando el usuario pulsa un chip de categoría (Cine/Streaming/Cadenas de un día) en la
// línea de tiempo, se abre esta capa flotante sobre toda la página. Su layout (rediseño con bocetos) es:
//
//   IZQUIERDA — CARRUSEL VERTICAL: los títulos de esa categoría apilados en columna, con scroll vertical
//     (no en fila lado a lado). Cada tarjeta es un mini-póster con su marco de rareza, título y meta.
//     La tarjeta ACTIVA (resaltada) es la que se previsualiza/detalla a la derecha.
//
//   DERECHA — PANEL DE PREVIA / DETALLE: NUNCA se ve vacío. Por defecto muestra la PREVIA del título
//     activo (portada ancha + datos clave: tipo, fecha, géneros, calificaciones, sinopsis) con un botón
//     "Ver detalle completo". Al pulsarlo, el panel se EXPANDE al DETALLE rico completo (ReleaseDetail),
//     desplazable y SIN barra visible (scrollbar oculta), para mantener la estética. Un botón discreto
//     "volver" regresa a la previa; elegir otra tarjeta del carrusel también vuelve a previa.
//
// Lleva 'use client' porque es 100% interactivo: foco, teclado (ESC), "clic fuera", bloqueo del scroll
// de fondo y trampa de foco del diálogo. El ESTADO (qué categoría, qué título activo, previa o detalle)
// lo posee TimelineStage y nos lo pasa por props; aquí va la PRESENTACIÓN + la accesibilidad.
//
// Accesibilidad (regla §12): role="dialog" + aria-modal con aria-label; ESC (en detalle vuelve a previa,
// en previa cierra); clic en el velo cierra; foco al abrir + trampa de foco; restauración del foco al
// cerrar; prefers-reduced-motion anula las animaciones (en globals.css).
//
// DE DÓNDE SALEN LOS DATOS DE ESTE MODAL, que cambió y conviene entender:
//
// Lo que llega desde la línea de tiempo son RESÚMENES de los estrenos: título, fecha, carátula,
// géneros, calificaciones y sinopsis. Con eso se dibuja entero el carrusel de la izquierda y casi
// toda la previa de la derecha, al instante y sin pedir nada.
//
// Lo único que NO viene en el resumen es lo que solo tiene sentido dentro de una ficha: el tráiler,
// el reparto, el equipo, la galería, el calendario de episodios y la saga. Eso se pide al backend en
// cuanto se abre el modal, para el título resaltado (y se va pidiendo por adelantado en cuanto el
// puntero pasa por otra tarjeta del carrusel, así que al pulsarla suele estar ya).
//
// La regla de oro de ese cambio: la pantalla NUNCA se queda en blanco esperando. Todo lo que se
// puede dibujar con el resumen se dibuja de inmediato, y solo los huecos que dependen de la ficha
// —el reproductor de arriba y el detalle completo— muestran su propio estado de carga, del mismo
// tamaño que el contenido final para que nada salte cuando llegue. Si la ficha no llega, esos huecos
// explican qué pasó y ofrecen reintentar; el resto del modal sigue siendo perfectamente usable.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { DetailErrorNotice, DetailSkeleton } from "@/components/DetailPending";
import { ReleaseDetail } from "@/components/ReleaseDetail";
import { YouTubeEmbed } from "@/components/YouTubeEmbed";
import { ProfileActions } from "@/components/profile/ProfileActions";
import { prefetchReleaseDetail, useReleaseDetail } from "@/lib/connect/release-detail";
import { useDialogEscape } from "@/lib/dialog-stack";
import { useProfile } from "@/lib/profile-context";
import { selectTrailer } from "@/lib/trailer-selection";
import { deriveRarity, type Tier } from "@/lib/rarity";
import {
  CATEGORY_META,
  MONTHS,
  coverStyleFor,
  isUpcoming,
  type CategoryKey,
  type Connection,
  type TodayMarker,
} from "@/lib/timeline";
import { ui } from "@/lib/i18n";
import { type Release, type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { TitleType } from "@/lib/catalog-enums";

// TIER_FRAME_CLASS asigna a cada rareza su clase CSS de marco (borde/halo tipo videojuego del cascarón).
const TIER_FRAME_CLASS: Record<Tier, string> = {
  legendary: "st-t-legendary",
  epic: "st-t-epic",
  rare: "st-t-rare",
  common: "st-t-common",
};

// TIER_LABELS traduce cada rareza a su etiqueta visible en es-MX (desde i18n).
const TIER_LABELS: Record<Tier, string> = {
  legendary: ui.tiers.legendary,
  epic: ui.tiers.epic,
  rare: ui.tiers.rare,
  common: ui.tiers.common,
};

// TIER_TOKENS asigna a cada rareza su variable CSS de color (para el texto de la tier-tag).
const TIER_TOKENS: Record<Tier, string> = {
  legendary: "var(--color-gold-bright)",
  epic: "var(--color-violet)",
  rare: "var(--color-teal)",
  common: "var(--color-text-subtle)",
};

// TYPE_LABELS traduce el tipo de título (película/serie) a su etiqueta es-MX para el meta.
// Los textos salen del catálogo i18n (ui.types), la fuente única de etiquetas de tipo.
const TYPE_LABELS: Record<TitleType, string> = {
  [TitleType.TITLE_TYPE_UNSPECIFIED]: ui.types.release,
  [TitleType.MOVIE]: ui.types.movie,
  [TitleType.SERIES]: ui.types.series,
};

// FOCUSABLE_SELECTOR enumera los elementos que pueden recibir foco dentro del diálogo (trampa de foco).
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// readTmdb obtiene la calificación TMDB de un estreno de forma segura (0 si falta).
function readTmdb(release: ReleaseSummary): number {
  return release.ratings?.tmdb ?? 0;
}

// formatTmdb formatea la calificación a un decimal ("8.6").
function formatTmdb(release: ReleaseSummary): string {
  return readTmdb(release).toFixed(1);
}

// StageProps son las propiedades del modal. El ESTADO lo posee TimelineStage; aquí recibimos los datos
// a pintar y los "ganchos" para avisar de cada acción.
type StageProps = {
  // open indica si el overlay está abierto. Cuando es false, no se dibuja nada.
  open: boolean;
  // month y day ubican el paquete abierto (para el encabezado y la a11y).
  month: number;
  day: number;
  // categoryKey es la categoría del paquete ("cine"/"streaming"/"tv"): da color y etiqueta.
  categoryKey: CategoryKey;
  // releases son los títulos del paquete (ya filtrados por el filtro y ordenados por TMDB).
  releases: ReleaseSummary[];
  // activeRelease es el título RESALTADO en el carrusel (el que el panel derecho previsualiza/detalla).
  activeRelease: ReleaseSummary | null;
  // detailExpanded indica si el panel derecho muestra el DETALLE completo (true) o la PREVIA (false).
  detailExpanded: boolean;
  // related son las conexiones reales del título activo (las calcula TimelineStage con el catálogo).
  related: Connection[];
  // catalog es el catálogo COMPLETO cargado: el detalle lo usa para abrir el modal de ficha completa
  // al pulsar conexiones o entradas de saga (y para encadenar fichas dentro de ese modal).
  catalog: ReleaseSummary[];
  // today es el marcador HOY de la demo: decide si un título es "Próximamente" (futuro) por su fecha.
  today: TodayMarker;
  // seedById asigna a cada estreno (por id) su semilla de degradado estable (placeholder de Fase 0).
  seedById: Map<string, number>;
  // onSelectCard resalta un título del carrusel (vuelve a previa + muta el fondo a su backdrop).
  onSelectCard: (release: ReleaseSummary) => void;
  // onOpenDetail expande la previa al detalle completo del título activo.
  onOpenDetail: () => void;
  // onCollapseDetail vuelve del detalle a la previa (conserva el título activo).
  onCollapseDetail: () => void;
  // onClose cierra TODO el overlay (vuelve a la línea de tiempo).
  onClose: () => void;
};

// Stage dibuja el modal completo (velo + panel con carrusel y panel de previa/detalle) y su a11y.
export function Stage({
  open,
  month,
  day,
  categoryKey,
  releases,
  activeRelease,
  detailExpanded,
  related,
  catalog,
  today,
  seedById,
  onSelectCard,
  onOpenDetail,
  onCollapseDetail,
  onClose,
}: StageProps) {
  // Referencia al panel del diálogo (para la trampa de foco y el foco inicial).
  const modalRef = useRef<HTMLDivElement | null>(null);
  // Elemento que tenía el foco ANTES de abrir, para devolvérselo al cerrar (a11y de diálogos).
  const triggerElementRef = useRef<HTMLElement | null>(null);
  // id estable para enlazar el título accesible del diálogo.
  const titleId = useId();

  // ----- Bloqueo del scroll del fondo mientras el overlay está abierto -----
  useEffect(() => {
    if (!open) {
      return;
    }
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousOverflow;
    };
  }, [open]);

  // ----- Captura del disparador al abrir y restauración del foco al cerrar -----
  useEffect(() => {
    if (!open) {
      return;
    }
    const activeElement = document.activeElement;
    triggerElementRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    return () => {
      const trigger = triggerElementRef.current;
      if (trigger !== null && trigger.isConnected) {
        trigger.focus();
      }
    };
  }, [open]);

  // ----- Foco INICIAL al abrir: primer elemento enfocable del diálogo -----
  useEffect(() => {
    if (!open) {
      return;
    }
    const panel = modalRef.current;
    if (panel === null) {
      return;
    }
    const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (firstFocusable !== null) {
      firstFocusable.focus();
    } else {
      panel.focus();
    }
  }, [open]);

  // ----- Teclado: ESC retrocede (detalle -> previa) o cierra (previa -> fuera) -----
  // Registrado en la PILA COMPARTIDA de diálogos (useDialogEscape): si encima del Stage hay otra capa
  // (la ficha ReleaseModal, el modal de saga o el lightbox), Escape cierra SOLO esa capa superior y el
  // Stage no se entera; cuando el Stage es el tope, Escape aplica su lógica de dos pasos.
  useDialogEscape(open, () => {
    if (detailExpanded) {
      onCollapseDetail();
    } else {
      onClose();
    }
  });

  // trapFocus mantiene el foco DENTRO del diálogo al tabular (trampa de foco básica).
  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const panel = modalRef.current;
    if (panel === null) {
      return;
    }
    // Los diálogos por PORTAL (ficha, saga, lightbox) viven en document.body, pero sus eventos SÍ
    // burbujean por el árbol de React hasta aquí. Si el Tab ocurrió fuera del panel del Stage (o sea,
    // dentro de un portal), NO intervenimos: ese diálogo tiene su PROPIA trampa (useFocusTrap) y
    // pelear con ella robaría el foco de vuelta al Stage.
    if (!panel.contains(event.target as Node)) {
      return;
    }
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const firstFocusable = focusables[0];
    const lastFocusable = focusables[focusables.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey) {
      if (activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }
  }, []);

  // El título a previsualizar/detallar: el activo, o el primero como respaldo (panel nunca vacío).
  //
  // Se calcula ANTES de la salida temprana de abajo a propósito: justo debajo hay que pedir su ficha,
  // y las peticiones de datos de React tienen que ejecutarse siempre en el mismo orden en cada
  // dibujado. Ponerla después de un "return" la haría condicional y React lo prohíbe.
  const shownRelease = activeRelease ?? (releases.length > 0 ? releases[0] : null);

  // ----- La FICHA COMPLETA del título resaltado, pedida al abrirlo -----
  //
  // En español: aquí es donde llega lo que el resumen no trae —el tráiler, el reparto, la galería, el
  // calendario y la saga— para el ÚNICO título que se está mirando. Devuelve tres cosas: la ficha
  // cuando llega, si sigue viniendo en camino y el aviso si algo falló (con su reintento). Mientras
  // el modal está cerrado no se pide nada.
  const detailId = open && shownRelease !== null ? shownRelease.id : null;
  const {
    release: shownDetail,
    loading: detailLoading,
    error: detailError,
    retry: retryDetail,
  } = useReleaseDetail(detailId);

  // Si el overlay no está abierto, no dibujamos nada (queda desmontado del DOM).
  if (!open) {
    return null;
  }

  // ----- Datos del encabezado -----
  const categoryMeta = CATEGORY_META[categoryKey];
  const monthLabelLower = (MONTHS[month] ?? "").toLowerCase();
  const catSubtitle = ui.stage.catSubtitle(day, monthLabelLower, releases.length);
  const catDialogLabel = ui.stage.catDialogLabel(categoryMeta.label, day, monthLabelLower);

  return (
    <>
      {/* Velo de fondo: oscurece; clic cierra. Detrás lleva el BACKDROP del título activo (tenue), para que
          el VIDRIO del modal tenga una imagen cinematográfica REAL que desenfocar (el glass se nota de
          verdad). Decorativo (aria-hidden). */}
      <div className="st-scrim" aria-hidden="true" onClick={onClose}>
        {shownRelease !== null ? (
          <div
            className="st-scrim-bg"
            style={coverStyleFor(shownRelease.backdropUrl, seedById.get(shownRelease.id) ?? 0)}
          />
        ) : null}
      </div>

      {/* Panel del diálogo: encabezado + cuerpo (carrusel | panel de previa/detalle). */}
      <div className="st-modal-wrap">
        <div
          ref={modalRef}
          className="st-modal"
          role="dialog"
          aria-modal="true"
          aria-label={catDialogLabel}
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          {/* ===== Encabezado: punto de categoría + título + subtítulo + cerrar ===== */}
          <div className="st-modal-head">
            <span
              aria-hidden="true"
              className="st-modal-dot"
              style={{
                background: categoryMeta.accentVar,
                boxShadow: `0 0 10px ${categoryMeta.accentVar}`,
              }}
            />
            <div className="st-modal-titles">
              <div id={titleId} className="st-modal-title font-display">
                {categoryMeta.label}
              </div>
              <div className="st-modal-sub font-mono">{catSubtitle}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={ui.stage.close}
              className="st-modal-close"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          {/* ===== Cuerpo: carrusel vertical (izq) + panel de previa/detalle (der) ===== */}
          <div className="st-modal-body">
            {/* --- Carrusel VERTICAL de títulos del paquete --- */}
            {releases.length > 0 ? (
              <div
                className="st-carousel"
                role="listbox"
                aria-label={ui.stage.carouselLabel(categoryMeta.label)}
              >
                {releases.map((release) => (
                  <CarouselCard
                    key={release.id}
                    release={release}
                    seed={seedById.get(release.id) ?? 0}
                    active={shownRelease !== null && release.id === shownRelease.id}
                    upcoming={isUpcoming(release, today)}
                    onSelect={onSelectCard}
                  />
                ))}
              </div>
            ) : (
              <p className="st-carousel" role="status">
                {ui.stage.emptyCategory}
              </p>
            )}

            {/* --- Panel derecho: PREVIA o DETALLE del título activo (nunca vacío si hay título) --- */}
            <div className="st-pane">
              {shownRelease === null ? (
                <p className="st-pane-empty" role="status">
                  {ui.stage.emptyCategory}
                </p>
              ) : detailExpanded ? (
                <DetailView
                  summary={shownRelease}
                  detail={shownDetail}
                  loading={detailLoading}
                  error={detailError}
                  onRetry={retryDetail}
                  related={related}
                  catalog={catalog}
                  today={today}
                  upcoming={isUpcoming(shownRelease, today)}
                  onBack={onCollapseDetail}
                />
              ) : (
                <PreviewPane
                  release={shownRelease}
                  detail={shownDetail}
                  loading={detailLoading}
                  error={detailError}
                  onRetry={retryDetail}
                  seed={seedById.get(shownRelease.id) ?? 0}
                  upcoming={isUpcoming(shownRelease, today)}
                  onOpenDetail={onOpenDetail}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// CarouselCardProps son las props de UNA tarjeta del carrusel vertical.
type CarouselCardProps = {
  // release es el título que representa la tarjeta.
  release: ReleaseSummary;
  // seed es la semilla del degradado de respaldo (placeholder de Fase 0), estable por estreno.
  seed: number;
  // active indica si esta tarjeta es la resaltada (la que el panel derecho previsualiza/detalla).
  active: boolean;
  // upcoming: si el título es futuro, sin nota muestra "Próx."; si ya pasó, no decimos "Próximamente".
  upcoming: boolean;
  // onSelect resalta esta tarjeta (vuelve a previa de su título).
  onSelect: (release: ReleaseSummary) => void;
};

// CarouselCard dibuja UNA tarjeta del carrusel: mini-póster con marco de rareza, título y meta. Es un
// <button> real (teclado, foco visible, aria). La activa lleva un anillo de acento (aria-selected).
function CarouselCard({ release, seed, active, upcoming, onSelect }: CarouselCardProps) {
  const tier = deriveRarity(readTmdb(release));
  const frameClass = TIER_FRAME_CLASS[tier];
  const tierLabel = TIER_LABELS[tier];
  const tierColor = TIER_TOKENS[tier];
  const tmdbText = formatTmdb(release);
  const typeLabel = TYPE_LABELS[release.type] ?? TYPE_LABELS[TitleType.TITLE_TYPE_UNSPECIFIED];
  const firstGenre = release.genres.length > 0 ? release.genres[0] : "";
  const metaText = ui.stage.cardMeta(typeLabel, firstGenre);
  const cardAriaLabel = ui.stage.cardAriaLabel(release.title, typeLabel, tmdbText);

  // Fondo del mini-póster: la imagen real si existe, o el degradado estable si no (Fase 0).
  const posterCover = coverStyleFor(release.posterUrl, seed);

  const handleClick = useCallback(() => {
    onSelect(release);
  }, [onSelect, release]);

  // handlePrefetch va pidiendo la ficha de este título ANTES de que nadie la haya abierto.
  //
  // En español: en cuanto el puntero pasa por encima de la tarjeta —o el foco del teclado llega a
  // ella— se empieza a traer su ficha. Como entre "señalar" y "pulsar" pasan unas décimas de segundo,
  // en la práctica la ficha ya está lista cuando la persona pulsa y la espera no se percibe. Si al
  // final no pulsa, lo único que se gastó fue una petición pequeña; si falla, no se avisa de nada
  // (nadie la pidió todavía) y se volverá a intentar cuando de verdad abra el título.
  const releaseId = release.id;
  const handlePrefetch = useCallback(() => {
    prefetchReleaseDetail(releaseId);
  }, [releaseId]);

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      aria-label={cardAriaLabel}
      onClick={handleClick}
      onPointerEnter={handlePrefetch}
      onFocus={handlePrefetch}
      className={`st-vcard${active ? " st-vcard-on" : ""}`}
    >
      <div className={`st-frame ${frameClass} st-vcard-pp`}>
        {/* Degradado/foto del póster (decorativo: la info va en el título y el aria-label). */}
        <div aria-hidden="true" className="absolute inset-0" style={posterCover} />
        {/* Destello (sheen) en rarezas altas. Decorativo. */}
        <span className="st-sheen" aria-hidden="true" />
        {/* Etiqueta de rareza (esquina superior izq). */}
        <span className="st-tier-tag" style={{ color: tierColor }}>
          <span aria-hidden="true">◆ </span>
          {tierLabel}
        </span>
        {/* Calificación TMDB (esquina superior der). Con nota: "★ X.X". Sin nota: "Próx." SOLO si es
            futuro (upcoming); si ya se estrenó sin nota, un guion neutro (nunca "Próximamente"). */}
        <span className="st-hcard-r">
          {readTmdb(release) > 0 ? (
            <>
              <span aria-hidden="true">★ </span>
              {tmdbText}
            </>
          ) : upcoming ? (
            ui.status.upcomingShort
          ) : (
            ui.status.dash
          )}
        </span>
        {/* Título superpuesto en la base del póster. */}
        <span className="st-hcard-ttl">{release.title}</span>
      </div>
      {/* Meta bajo la tarjeta: tipo · primer género. */}
      <span className="st-vcard-meta block">{metaText}</span>
    </button>
  );
}

// PreviewPaneProps son las props de la PREVIA (datos clave del título activo).
type PreviewPaneProps = {
  // release es el RESUMEN del título a previsualizar: con esto ya se dibuja casi toda la previa.
  release: ReleaseSummary;
  // detail es su ficha COMPLETA cuando ya llegó, o null mientras viene en camino o si falló.
  // En español: de ella sale ÚNICAMENTE el tráiler; todo lo demás de esta previa ya está en el resumen.
  detail: Release | null;
  // loading indica que la ficha viene en camino (el reproductor enseña su estado de carga).
  loading: boolean;
  // error es el aviso en es-MX si la ficha no se pudo traer, o null si todo fue bien.
  error: string | null;
  // onRetry vuelve a pedir la ficha que no llegó.
  onRetry: () => void;
  // seed es la semilla del degradado de respaldo (placeholder de Fase 0) para la portada.
  seed: number;
  // upcoming: si el título es futuro, sin nota muestra "Próximamente"; si ya pasó, no.
  upcoming: boolean;
  // onOpenDetail expande la previa al detalle completo.
  onOpenDetail: () => void;
};

// PreviewPane dibuja la PREVIA del título activo: EL TRÁILER arriba + datos clave (tipo/fecha/géneros,
// calificaciones, sinopsis) + botón "Ver detalle completo".
//
// AQUÍ ESTABA EL DEFECTO QUE REPORTÓ EL DUEÑO. Esta previa pintaba una imagen fija y ni siquiera
// importaba el reproductor: se midió en un navegador real y el panel tenía CERO reproductores y CERO
// botones de reproducir, mientras el mismo estreno sí traía tráiler desde el servidor. El dato
// llegaba, el frontend lo recibía, y esta función ni lo miraba. Ahora el tráiler es lo primero que se
// ve al entrar a un paquete, que es lo que la gente espera de una previa de cine.
//
// SOBRE EL RENDIMIENTO, porque es la trampa evidente de este cambio: el reproductor es una FACHADA.
// Lo que se pinta de entrada es la imagen real del estreno con un botón; el iframe de YouTube —que es
// lo caro, porque descarga el reproductor entero— solo se inserta cuando alguien pulsa. Además solo
// existe UNA previa a la vez (la del título resaltado), no una por tarjeta del carrusel. Un iframe por
// cada previa habría hundido la página.
function PreviewPane({
  release,
  detail,
  loading,
  error,
  onRetry,
  seed,
  upcoming,
  onOpenDetail,
}: PreviewPaneProps) {
  const tier = deriveRarity(readTmdb(release));
  const tierLabel = TIER_LABELS[tier];
  const tierColor = TIER_TOKENS[tier];
  const tmdbText = formatTmdb(release);
  const typeLabel = TYPE_LABELS[release.type] ?? TYPE_LABELS[TitleType.TITLE_TYPE_UNSPECIFIED];

  // Idioma preferido de la persona (de su perfil): decide QUÉ tráiler se elige y en qué idioma se
  // piden los subtítulos. Es el mismo criterio que usa el detalle, así que la previa y el detalle
  // enseñan siempre el mismo video: cambiar de vista no cambia el tráiler.
  const { profile } = useProfile();
  const preferredLanguage = profile.settings.language;

  // Elección del tráiler sobre la lista ya verificada de la FICHA. undefined = este título no tiene
  // ninguno, que es el caso de casi 4 de cada 10 y el reproductor lo dibuja como un estado digno, no
  // como un error. Mientras la ficha viene en camino la lista está vacía, y por eso el reproductor
  // recibe "loading": sin eso diría "no hay tráiler" un instante, que sería mentira y parpadearía.
  const trailerChoice = selectTrailer(detail?.videos ?? [], preferredLanguage);

  // Calificaciones presentes (TMDB siempre que > 0; IMDb/RT si existen) para la fila de datos clave.
  const imdb = release.ratings?.imdb ?? "";
  const rottenTomatoes = release.ratings?.rottenTomatoes ?? "";

  return (
    <div className="st-preview">
      {/*
        Tráiler de la previa, con la rareza y la calificación superpuestas encima, como estaban antes
        sobre la portada. El reproductor usa el backdrop real del estreno como imagen de fondo, así que
        cuando no hay video la previa se sigue viendo exactamente igual de bien que antes: la portada
        de siempre, con su rótulo explicando por qué no hay tráiler.
      */}
      <div className="st-preview-hero" style={{ aspectRatio: "16 / 9" }}>
        <YouTubeEmbed
          video={trailerChoice?.video}
          notice={trailerChoice?.notice}
          title={release.title}
          framed={tier}
          caption={ui.detail.trailerCaption}
          seed={seed}
          posterUrl={release.backdropUrl}
          captionLang={preferredLanguage}
          loading={loading}
          // Si la ficha NO llegó, el reproductor lo dice en vez de afirmar que no hay tráiler.
          //
          // En español: sin esto, un servidor caído hacía que esta misma pantalla dijera dos cosas
          // incompatibles a la vez — aquí arriba "este título aún no tiene tráiler publicado" y unas
          // líneas más abajo "no pudimos cargar la ficha". La primera era falsa (el título sí lo
          // tiene) y no había forma de distinguirla del caso, muy frecuente, en el que de verdad no
          // hay video. Ahora el marco de arriba y el aviso de abajo cuentan la misma historia.
          failed={error !== null}
        />
        <span className="st-preview-tier font-mono" style={{ color: tierColor }}>
          <span aria-hidden="true">◆ </span>
          {tierLabel}
        </span>
        <span className="st-preview-r font-mono">
          {readTmdb(release) > 0 ? (
            <>
              <span aria-hidden="true">★ </span>
              {tmdbText}
            </>
          ) : upcoming ? (
            ui.status.upcoming
          ) : (
            ui.status.released
          )}
        </span>
      </div>

      {/* Cuerpo de la previa: tipo, título, meta, calificaciones, sinopsis y CTA al detalle. */}
      <div className="st-preview-body">
        <div className="st-preview-type font-mono" style={{ color: tierColor }}>
          {typeLabel}
        </div>
        <h3 className="st-preview-title font-display">{release.title}</h3>

        {/* Géneros como meta tenue (si los hay). */}
        {release.genres.length > 0 ? (
          <div className="st-preview-genres">{release.genres.join(" · ")}</div>
        ) : null}

        {/* Datos clave: calificaciones disponibles, en píldoras compactas. */}
        <div className="st-preview-ratings font-mono">
          {readTmdb(release) > 0 ? (
            <span className="st-preview-rating">TMDB {tmdbText}</span>
          ) : upcoming ? (
            <span className="st-preview-rating">Próximamente</span>
          ) : null}
          {imdb ? <span className="st-preview-rating">IMDb {imdb}</span> : null}
          {rottenTomatoes ? <span className="st-preview-rating">RT {rottenTomatoes}</span> : null}
        </div>

        {/*
          Aviso de que la ficha no llegó, con su reintento. Solo aparece si de verdad falló algo.
          Va aquí, dentro del cuerpo de la previa, y NO tapa nada: el título, los géneros, las
          calificaciones y la sinopsis de arriba vienen del resumen y se ven igual de bien aunque la
          ficha no haya llegado. Lo único que falta en ese caso es el tráiler y el detalle completo,
          y eso es exactamente lo que este aviso explica.
        */}
        {error !== null ? <DetailErrorNotice message={error} onRetry={onRetry} /> : null}

        {/* Sinopsis (recortada con line-clamp en CSS) o respaldo si no hay. */}
        <p className="st-preview-synopsis">
          {release.overview ? release.overview : ui.detail.noSynopsis}
        </p>

        {/* Acciones de perfil: "Quiero ver" / "Vista" para gestionar el estreno desde la previa. */}
        <div className="st-preview-profile">
          <ProfileActions releaseId={release.id} />
        </div>

        {/* CTA: expandir al detalle completo. */}
        <button type="button" onClick={onOpenDetail} className="st-preview-cta font-mono">
          {ui.stage.openDetail}
          <span aria-hidden="true"> →</span>
        </button>
      </div>
    </div>
  );
}

// DetailViewProps son las props del DETALLE expandido dentro del panel derecho.
type DetailViewProps = {
  // summary es el RESUMEN del título: lo que se sabe de él sin haber pedido nada.
  summary: ReleaseSummary;
  // detail es su ficha COMPLETA cuando ya llegó, o null mientras viene en camino o si falló.
  detail: Release | null;
  // loading indica que la ficha viene en camino.
  loading: boolean;
  // error es el aviso en es-MX si la ficha no se pudo traer, o null si todo fue bien.
  error: string | null;
  // onRetry vuelve a pedir la ficha que no llegó.
  onRetry: () => void;
  // related son sus conexiones reales (se reenvían al detalle para la sección "Conexiones").
  related: Connection[];
  // catalog es el catálogo de la ventana en su forma ligera (para el modal de conexiones/saga).
  catalog: ReleaseSummary[];
  // today es el marcador HOY (para el calendario de emisión y el "Próximamente" del modal).
  today: TodayMarker;
  // upcoming: si el título es futuro, el detalle muestra "Próximamente" en vez de su rareza/nota.
  upcoming: boolean;
  // onBack vuelve a la PREVIA (sin cerrar el modal).
  onBack: () => void;
};

// DetailView monta el DETALLE rico completo (ReleaseDetail) en un contenedor desplazable SIN barra
// visible (scrollbar oculta en globals.css), con un botón discreto "volver" a la previa. Así el detalle
// es navegable manteniendo la estética (sin barras que ensucien), como pidió el usuario.
//
// Los tres estados, en español: si la ficha ya está, se dibuja entera como siempre; si viene en
// camino, se dibuja una silueta con el tamaño aproximado de la ficha (así el botón de volver no se
// mueve y la persona ve que hay algo llegando); si no llegó, un aviso con su reintento. En los tres
// casos el botón "Volver" sigue ahí, para que nunca sea un callejón sin salida.
function DetailView({
  summary,
  detail,
  loading,
  error,
  onRetry,
  related,
  catalog,
  today,
  upcoming,
  onBack,
}: DetailViewProps) {
  return (
    <div className="st-detailview">
      {/* Botón discreto "volver a la previa" (ghost, no una barra). La flecha es decorativa. */}
      <button type="button" onClick={onBack} className="st-detailview-back font-mono">
        <span aria-hidden="true">‹ </span>
        {ui.stage.back}
      </button>
      {/* Zona desplazable con scrollbar oculta: el detalle rico completo, navegable y limpio. */}
      <div className="st-detailview-scroll">
        {detail !== null ? (
          <ReleaseDetail
            release={detail}
            related={related}
            upcoming={upcoming}
            today={today}
            catalog={catalog}
          />
        ) : loading ? (
          <DetailSkeleton title={summary.title} />
        ) : (
          <DetailErrorNotice message={error ?? ui.detail.notFoundHint} onRetry={onRetry} />
        )}
      </div>
    </div>
  );
}

// La SILUETA de espera y el AVISO de "no llegó" viven ahora en components/DetailPending, compartidos
// con la ventana que se abre desde una conexión o desde una saga. Estaban escritos dos veces y las dos
// copias ya habían empezado a divergir: la de la ventana se había quedado sin la fila de retratos, así
// que la misma ficha tenía una silueta distinta según por dónde se abriera. Ver DetailPending.
