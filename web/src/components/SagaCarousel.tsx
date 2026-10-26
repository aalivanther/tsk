"use client";

// Archivo: SagaCarousel.tsx — La tira de la SAGA de un título (sus otras películas o temporadas).
//
// En español: dentro de la ficha de un estreno, esta pieza muestra el resto de su saga como una tira
// horizontal de pósters que se arrastra de lado y que no tiene principio ni fin: al llegar a un
// extremo, continúa. Al tocar una entrada pasan dos cosas distintas según lo que sea:
//   - Si esa película o temporada ESTÁ en el catálogo, se abre su ficha completa.
//   - Si no está (una entrega antigua de la saga, por ejemplo), se abre una ficha ligera con lo que
//     sí se sabe de ella y un enlace para buscarla.
//
// Vivía dentro de ReleaseDetail.tsx, que había crecido hasta casi 1.400 líneas mezclando la ficha,
// la galería, el carrusel y varios diálogos. Separarlo tiene un motivo práctico: el carrusel es la
// parte con más lógica de interacción (arrastre, inercia, foco, dos tipos de diálogo) y encontrarlo
// entre el resto del detalle costaba más de lo razonable.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { useDialogEscape } from "@/lib/dialog-stack";
import { useDragScroll } from "@/lib/use-drag-scroll";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { COVER_SIZES, coverStyleFor } from "@/lib/timeline";
import { resolveCollectionItem } from "@/lib/saga";
import { ui } from "@/lib/i18n";
import { type CollectionItem, type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// SagaItemModalProps son las props del modal de UNA entrada de saga (peli vinculada / temporada).
type SagaItemModalProps = {
  // item es la entrada a mostrar (con su info ya seedeada: sinopsis, nota, backdrop, extra).
  item: CollectionItem;
  // seed es la semilla del degradado de respaldo (placeholder si faltan imágenes).
  seed: number;
  // onClose cierra el modal (botón, velo o Escape).
  onClose: () => void;
};

// SagaCarouselProps son las props del CARRUSEL horizontal infinito de la saga (pelis de la colección o
// temporadas de la serie).
type SagaCarouselProps = {
  // items son las entradas de la saga (otras películas) o las temporadas de la serie.
  items: CollectionItem[];
  // baseSeed siembra los degradados de respaldo de cada póster (placeholder cuando no hay imagen real).
  baseSeed: number;
  // catalog es el catálogo cargado: si una entrada de la saga ES un título del catálogo (mismo título y
  // año), su tarjeta abre la FICHA COMPLETA en vez del modal ligero. Vacío = siempre modal ligero.
  catalog: ReleaseSummary[];
  // onOpenCatalogRelease abre la ficha completa de un título del catálogo (la provee ReleaseDetail).
  onOpenCatalogRelease: (release: ReleaseSummary) => void;
};

// CAROUSEL_COPIES es en cuántas copias idénticas se repite la tira para el bucle infinito.
// En español: se pintan tres tiras iguales (clon · principal · clon) y el scroll se mantiene siempre
// en la del medio; como las tres son idénticas, el salto es invisible y la tira no parece acabarse.
// La constante existe para que el número lo diga UN solo sitio: lo usan el hook de arrastre, el
// centrado inicial y el JSX, y si los tres no coincidieran el bucle daría tirones.
const CAROUSEL_COPIES = 3;

// KEYBOARD_SCROLL_STEP_PX es cuánto avanza la tira con cada pulsación de flecha.
// En español: 320 px es aproximadamente dos pósters de la tira, un paso que recorre la saga a buen
// ritmo sin marear. Es el MISMO valor que usan las flechas de la línea de tiempo, para que moverse
// con el teclado se sienta igual en las dos tiras del producto.
const KEYBOARD_SCROLL_STEP_PX = 320;

// scrollBehaviorForMotionPreference elige desplazamiento animado o instantáneo según la preferencia.
// En español: quien pidió "reducir movimiento" en su sistema operativo no debe recibir animaciones;
// su desplazamiento es instantáneo. Ojo: pasar "smooth" explícitamente a scrollBy IGNORA lo que diga
// el CSS, así que la decisión tiene que tomarse aquí, en JavaScript.
function scrollBehaviorForMotionPreference(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "smooth";
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

// sagaSearchUrl arma un enlace de búsqueda de una entrada de la saga (título + año) en Google.
// En español: las entradas de saga no traen id del catálogo, así que las hacemos clicables como búsqueda.
function sagaSearchUrl(title: string, year: string): string {
  const query = year ? `${title} ${year} película` : `${title} película`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
// El emparejamiento de una entrada de saga con su estreno del catálogo VIVÍA AQUÍ, escrito a mano.
// Ahora vive en lib/saga (resolveCollectionItem) y se importa, porque la página de la saga necesita
// exactamente lo mismo: tenerlo dos veces habría garantizado que un día el carrusel y la página de
// la saga discreparan sobre qué entradas están en el catálogo. La explicación de por qué se comparan
// títulos escritos —y de lo frágil que es— está en ese archivo.

// SagaCarousel dibuja un CARRUSEL HORIZONTAL INFINITO de pósters (saga/temporadas): una tira de tarjetas
// (póster + título + año) que se ARRASTRA de lado y se redirige a sí misma (sin principio ni fin), igual
// que la línea de tiempo. Cada tarjeta es un enlace (búsqueda del título). Más orgánico que la ruleta
// vertical y consistente con el carrusel del timeline. Cliente porque lleva arrastre + inercia.
export function SagaCarousel({
  items,
  baseSeed,
  catalog,
  onOpenCatalogRelease,
}: SagaCarouselProps) {
  // trackRef es el riel desplazable (la "ventana" del carrusel, con overflow horizontal).
  const trackRef = useRef<HTMLDivElement | null>(null);
  // ARRASTRE de la tira de la saga: es EXACTAMENTE el mismo gesto que el de la línea de tiempo
  // ("agarrar y tirar", con inercia y bucle infinito), así que usa el mismo hook compartido. Antes
  // estaba escrito aquí una segunda vez, casi calcado, con el problema de que cualquier ajuste había
  // que repetirlo en los dos sitios y con el tiempo se desajustaban entre sí.
  const {
    handlers: dragHandlers,
    wrapScroll,
    shouldSuppressClick,
  } = useDragScroll(trackRef, {
    copies: CAROUSEL_COPIES,
  });

  // Un oyente de scroll mantiene el bucle también cuando el movimiento NO viene del arrastre (rueda
  // del ratón, teclado o desplazamiento por inercia del propio sistema).
  useEffect(() => {
    const track = trackRef.current;
    if (track === null) {
      return;
    }
    const onScroll = () => wrapScroll();
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
    };
  }, [wrapScroll]);

  // ATERRIZAJE EN LA COPIA PRINCIPAL al montar (y cada vez que cambia la saga que se muestra).
  //
  // En español: la tira se dibuja tres veces seguidas y solo la del MEDIO es la "de verdad" — las de
  // los lados son clones marcados como invisibles para los lectores de pantalla y fuera del orden de
  // tabulación, porque existen únicamente para que nunca se vea el borde al desplazarse. El navegador
  // arranca cualquier contenedor desplazable en su extremo izquierdo, es decir, mostrando el PRIMER
  // clon: lo que la persona veía al abrir la ficha era precisamente la copia que la app declara como
  // "no existe". Con lector de pantalla, esa primera pantalla estaba en silencio; con teclado, el
  // primer Tab saltaba a una tarjeta que no era ninguna de las visibles.
  //
  // La línea de tiempo no sufría esto porque al montar centra la aguja de HOY con scrollIntoView, y
  // ese centrado la dejaba de paso en la banda central; al extraer el carrusel a su propio archivo
  // ese paso se quedó atrás. Aquí se hace explícito: colocamos el scroll justo al inicio de la copia
  // central. Es la posición estable del bucle (el wrap no la mueve), así que no hay tirón inicial.
  useEffect(() => {
    const track = trackRef.current;
    if (track === null) {
      return;
    }
    const copyWidth = track.scrollWidth / CAROUSEL_COPIES;
    if (copyWidth <= 0) {
      return;
    }
    track.scrollLeft = copyWidth;
  }, [items]);

  // handleKeyDown recorre la tira con el TECLADO cuando el riel tiene el foco.
  //
  // En español: hasta ahora esta tira solo se podía mover arrastrando con el dedo o el ratón. Quien
  // navega con teclado podía llegar con Tab a las tarjetas, pero no tenía forma de RECORRER la tira,
  // que es justo lo que hace un carrusel. Las flechas izquierda/derecha lo resuelven; el bucle
  // infinito sigue funcionando porque el oyente de scroll de arriba reubica la banda central.
  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (track === null) {
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      // Cualquier otra tecla no nos concierne: se deja pasar para no robarle el teclado al navegador.
      return;
    }
    // Se evita el desplazamiento por defecto de la página: la flecha mueve ESTA tira, no el documento.
    event.preventDefault();
    const step = event.key === "ArrowRight" ? KEYBOARD_SCROLL_STEP_PX : -KEYBOARD_SCROLL_STEP_PX;
    track.scrollBy({ left: step, behavior: scrollBehaviorForMotionPreference() });
  }, []);

  // selected es la entrada de saga (peli vinculada / temporada) cuyo MODAL está abierto, o null si ninguno.
  // En español: al pulsar una tarjeta abrimos su modal propio con su info completa (sinopsis, nota, etc.).
  const [selected, setSelected] = useState<CollectionItem | null>(null);

  // onCardOpen abre el detalle de la entrada pulsada. Si el "clic" viene de un ARRASTRE (suppressRef),
  // lo ignoramos una vez (no abrir nada al soltar tras tirar de la tira). Si la entrada ES un título
  // del catálogo (mismo título y año), abrimos su FICHA COMPLETA (modal rico); si no está en el
  // catálogo (películas viejas de la saga, temporadas), abrimos su modal ligero con lo que sí sabemos.
  const onCardOpen = useCallback(
    (item: CollectionItem) => {
      // Si el "clic" es el final de un arrastre, se ignora: tirar de la tira no debe abrir una ficha.
      if (shouldSuppressClick()) {
        return;
      }
      const catalogRelease = resolveCollectionItem(item, catalog);
      if (catalogRelease !== null) {
        onOpenCatalogRelease(catalogRelease);
        return;
      }
      setSelected(item);
    },
    [catalog, onOpenCatalogRelease, shouldSuppressClick],
  );

  // Cierre del modal de saga con Escape vía la PILA compartida: al estar encima de otras capas (la
  // ficha, el Stage), una pulsación cierra SOLO este modal, no todo lo de abajo.
  useDialogEscape(selected !== null, () => setSelected(null));

  // renderCopy dibuja UNA copia de la tira. isMain=true es la copia enfocable por teclado; las clon quedan
  // fuera del tab-order (el efecto de arriba las pone en tabindex=-1) pero SÍ reciben clic de ratón/toque.
  // Cada tarjeta es un BOTÓN que abre el modal de su entrada (peli de la saga o temporada).
  const renderCopy = (copyKey: string, isMain: boolean) =>
    items.map((item, index) => (
      <button
        key={`${copyKey}-${item.title}-${index}`}
        type="button"
        aria-label={ui.detail.sagaOpenAria(item.title)}
        aria-hidden={isMain ? undefined : true}
        tabIndex={isMain ? 0 : -1}
        className="rf-saga-card"
        onClick={() => onCardOpen(item)}
      >
        <div
          className="rf-saga-poster"
          style={{
            ...coverStyleFor(item.posterUrl, baseSeed + index, 1, COVER_SIZES.sagaPoster),
            borderColor: "var(--color-border)",
          }}
        >
          {item.year ? <span className="rf-saga-year font-mono">{item.year}</span> : null}
        </div>
        <span className="rf-saga-name">{item.title}</span>
      </button>
    ));

  return (
    <>
      {/* El riel: ventana con overflow horizontal y arrastre. Tres copias idénticas para el bucle
          infinito. Es ENFOCABLE (tabIndex 0) y se anuncia como grupo con nombre, para que quien
          navega con teclado o lector de pantalla lo encuentre como una región recorrible y pueda
          moverla con las flechas — antes solo respondía al dedo y al ratón. */}
      <div
        ref={trackRef}
        className="rf-saga-track"
        role="group"
        aria-label={ui.detail.sagaLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        {...dragHandlers}
      >
        <div className="rf-saga-strip">
          <div className="rf-saga-copy" data-clone aria-hidden="true">
            {renderCopy("a", false)}
          </div>
          <div className="rf-saga-copy">{renderCopy("b", true)}</div>
          <div className="rf-saga-copy" data-clone aria-hidden="true">
            {renderCopy("c", false)}
          </div>
        </div>
      </div>

      {/* Modal de la entrada de saga: su info completa. Va por PORTAL a document.body para ESCAPAR del
          modal principal (que tiene backdrop-filter/overflow y, como ancestro, contendría/recortaría/
          difuminaría este position:fixed). En el body queda a pantalla completa, nítido y por encima. */}
      {selected !== null && typeof document !== "undefined"
        ? createPortal(
            <SagaItemModal item={selected} seed={baseSeed} onClose={() => setSelected(null)} />,
            document.body,
          )
        : null}
    </>
  );
}

// SagaItemModalProps son las props del modal de UNA entrada de saga (peli vinculada / temporada).

// SagaItemModal dibuja el MODAL de una entrada de saga: portada ancha (backdrop o póster), título, año,
// nota TMDB y sinopsis reales, además de un enlace para buscar más. Es el "otro modal" pedido para que
// las pelis vinculadas o temporadas anteriores muestren su info correctamente, no solo un póster.
function SagaItemModal({ item, seed, onClose }: SagaItemModalProps) {
  // Fondo del héroe: el backdrop si existe; si no (típico de temporadas), el póster; si no, el degradado.
  const heroUrl = item.backdropUrl || item.posterUrl;
  // Trampa de foco propia (este modal vive en la capa superior): foco inicial al abrir, Tab contenido
  // y retorno del foco al cerrar. Antes no tenía ninguna gestión de foco.
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <div
      ref={trapRef}
      className="rf-saga-modal"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      tabIndex={-1}
      onClick={onClose}
    >
      {/* Tarjeta del modal: detiene la propagación para que el clic DENTRO no cierre (solo el velo cierra). */}
      <div className="rf-saga-modal-card" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="rf-saga-modal-close"
          onClick={onClose}
          aria-label={ui.detail.lightboxClose}
        >
          <span aria-hidden="true">✕</span>
        </button>

        {/* Portada ancha (backdrop/póster) con velo inferior para que el texto se lea. */}
        <div className="rf-saga-modal-hero" style={coverStyleFor(heroUrl, seed)}>
          <div className="rf-saga-modal-hero-grad" aria-hidden="true" />
          {item.rating > 0 ? (
            <span className="rf-saga-modal-rating font-mono">
              <span aria-hidden="true">★ </span>
              {item.rating.toFixed(1)}
            </span>
          ) : null}
        </div>

        {/* Cuerpo: título, meta (año · extra), sinopsis y buscar. */}
        <div className="rf-saga-modal-body">
          <h4 className="rf-saga-modal-title font-display">{item.title}</h4>
          {item.year || item.extra ? (
            <div className="rf-saga-modal-meta font-mono">
              {[item.year, item.extra].filter(Boolean).join(" · ")}
            </div>
          ) : null}
          <p className="rf-saga-modal-synopsis">
            {item.overview ? item.overview : ui.detail.noSynopsis}
          </p>
          <a
            href={sagaSearchUrl(item.title, item.year)}
            target="_blank"
            rel="noopener noreferrer"
            className="rf-saga-modal-search font-mono"
          >
            {ui.detail.sagaSearchAria(item.title)}
            <span aria-hidden="true"> →</span>
          </a>
        </div>
      </div>
    </div>
  );
}
