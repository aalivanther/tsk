"use client";

// Archivo: TitleSearch.tsx — El BUSCADOR de títulos del catálogo (vive en la barra superior).
//
// En español: la página ya trae a la memoria del navegador todos los estrenos de la ventana de meses
// vigente (del orden de un centenar y medio). Buscar entre ellos es, literalmente, recorrer una lista:
// no hace falta preguntarle nada al servidor, ni esperar respuesta, ni manejar estados de red. Por eso
// el buscador FILTRA EN EL NAVEGADOR y responde en el mismo momento en que se escribe.
//
// Detalles que lo hacen usable de verdad:
//   - Ignora acentos y mayúsculas: escribir "cronica" encuentra "Crónica"; "LAS" encuentra "Las".
//   - Prioriza los títulos que EMPIEZAN por lo escrito; después, los que lo contienen en medio.
//   - Cubre sus dos estados: aún no se escribió nada (se explica cuántos títulos hay) y lo escrito no
//     coincide con ninguno (se dice claramente, citando lo buscado).
//
// Accesibilidad (no negociable):
//   - Se abre con un botón real; el panel es un diálogo etiquetado y el foco entra en el campo.
//   - Teclado completo: flechas arriba/abajo recorren los resultados, Enter abre el resaltado, Escape
//     cierra y devuelve el foco al botón, Tab queda contenido dentro del panel mientras está abierto.
//   - El campo es un "combobox" con su lista asociada, y el resultado activo se anuncia con
//     aria-activedescendant, que es como los lectores de pantalla siguen la selección sin mover el foco.
//   - El número de resultados se anuncia por una región viva (aria-live), sin ocupar espacio visible.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";

import { useDialogEscape } from "@/lib/dialog-stack";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { ui } from "@/lib/i18n";
import { TitleType, type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// MAX_RESULTS es cuántos resultados se muestran como mucho.
// En español: una lista de veinte títulos en un panel pequeño no ayuda a nadie; con los ocho mejores
// se decide rápido y, si no aparece lo buscado, basta con escribir una letra más para afinar.
const MAX_RESULTS = 8;

// TYPE_LABELS traduce el tipo de título (película/serie) a su etiqueta es-MX, desde el catálogo i18n.
const TYPE_LABELS: Record<TitleType, string> = {
  [TitleType.TITLE_TYPE_UNSPECIFIED]: ui.types.release,
  [TitleType.MOVIE]: ui.types.movie,
  [TitleType.SERIES]: ui.types.series,
};

// normalizeForSearch deja un texto "plano" para poder compararlo sin sorpresas.
// En español: pasa todo a minúsculas, separa los acentos de sus letras (normalización NFD) y los
// borra, y colapsa los espacios de más. Así "Crónica  DEL Fin" y "cronica del fin" se vuelven el
// mismo texto y la búsqueda encuentra lo que la persona quiso escribir, no lo que escribió con tildes.
function normalizeForSearch(value: string): string {
  return (
    value
      .normalize("NFD")
      // El rango U+0300 a U+036F son las "marcas diacríticas" que la normalización NFD deja sueltas (la
      // tilde de la é, la virgulilla de la ñ…). Al borrarlas, "crónica" y "cronica" quedan idénticas.
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
  );
}

// yearOf extrae el año de una fecha ISO "AAAA-MM-DD" (cadena vacía si la fecha no sirve).
// En español: el año ayuda a distinguir dos títulos parecidos sin cargar el resultado de datos.
function yearOf(releaseDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate.slice(0, 4) : "";
}

// SearchMatch es UN resultado ya listo para pintar: el estreno y dónde apareció lo buscado.
type SearchMatch = {
  // release es el estreno encontrado (de él salen el título, el tipo y la fecha).
  release: ReleaseSummary;
  // startsWithQuery indica si el título EMPIEZA por lo escrito (esos van primero en la lista).
  startsWithQuery: boolean;
};

// findMatches filtra el catálogo por título y devuelve los mejores resultados, ya ordenados.
// En español: recorre los estrenos comparando textos normalizados (sin acentos ni mayúsculas). Los
// que empiezan por lo escrito se consideran mejores que los que solo lo contienen en medio; a
// igualdad, se ordenan alfabéticamente en es-MX para que el orden sea estable y predecible.
function findMatches(releases: ReleaseSummary[], query: string): SearchMatch[] {
  const normalizedQuery = normalizeForSearch(query);
  if (normalizedQuery === "") {
    return [];
  }
  const matches: SearchMatch[] = [];
  for (const release of releases) {
    const normalizedTitle = normalizeForSearch(release.title);
    const position = normalizedTitle.indexOf(normalizedQuery);
    if (position === -1) {
      continue;
    }
    matches.push({ release, startsWithQuery: position === 0 });
  }
  matches.sort((left, right) => {
    if (left.startsWithQuery !== right.startsWithQuery) {
      return left.startsWithQuery ? -1 : 1;
    }
    return left.release.title.localeCompare(right.release.title, "es-MX");
  });
  return matches.slice(0, MAX_RESULTS);
}

// TitleSearchProps son las props del buscador.
type TitleSearchProps = {
  // releases es el catálogo YA cargado por la página (la lista sobre la que se busca). Puede venir
  // vacío si el backend no respondió: en ese caso el panel lo dice, en vez de fingir que no hay nada.
  releases: ReleaseSummary[];
};

// TitleSearch dibuja el botón-lupa de la barra y, al pulsarlo, el panel con el campo y los resultados.
export function TitleSearch({ releases }: TitleSearchProps) {
  const router = useRouter();

  // open controla si el panel está desplegado; query es lo que la persona ha escrito.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // activeIndex es el resultado RESALTADO con el teclado (-1 = ninguno todavía).
  const [activeIndex, setActiveIndex] = useState(-1);

  // Referencias: la raíz (para detectar clics fuera) y el botón (para devolverle el foco al cerrar).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Identificadores únicos y estables para enlazar campo, lista y opciones (los pide la accesibilidad).
  const panelId = useId();
  const listId = useId();
  const optionIdPrefix = useId();

  // Trampa de foco: mientras el panel está abierto, el Tab no se escapa al resto de la página y el
  // foco entra en el campo de texto (es el primer elemento operable del panel).
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  // Resultados, recalculados SOLO cuando cambian el catálogo o lo escrito (no en cada render).
  const matches = useMemo(() => findMatches(releases, query), [releases, query]);

  // closeSearch cierra el panel, limpia lo escrito y devuelve el foco al botón que lo abrió (regla de
  // accesibilidad: el foco nunca debe quedarse "en el aire" cuando desaparece lo que lo contenía).
  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    buttonRef.current?.focus();
  }, []);

  // Escape cierra el buscador a través de la PILA compartida de diálogos: si hubiera otra capa
  // encima, una pulsación cierra solo la de arriba (nunca las dos a la vez).
  useDialogEscape(open, closeSearch);

  // Cierre al pulsar FUERA del componente, igual que los demás menús de la barra. Solo escucha
  // mientras el panel está abierto, para no dejar un vigilante permanente en la página.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        // Aquí NO devolvemos el foco al botón: la persona ya está pulsando en otro sitio y robarle
        // el foco sería desconcertante. Solo se cierra.
        setOpen(false);
        setQuery("");
        setActiveIndex(-1);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // openRelease navega a la ficha del título elegido y cierra el buscador.
  const openRelease = useCallback(
    (releaseId: string) => {
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
      router.push(`/titulo/${releaseId}`);
    },
    [router],
  );

  // handleKeyDown implementa la navegación por TECLADO dentro del campo:
  //   - Flecha abajo/arriba: mueven el resaltado por la lista, dando la vuelta en los extremos.
  //   - Enter: abre el resultado resaltado (o el primero, si aún no se movió el resaltado).
  //   - Escape lo maneja la pila de diálogos (arriba), así que aquí no se duplica.
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (matches.length === 0) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((previous) => (previous + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((previous) => (previous <= 0 ? matches.length - 1 : previous - 1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const chosen = matches[activeIndex >= 0 ? activeIndex : 0];
        openRelease(chosen.release.id);
      }
    },
    [matches, activeIndex, openRelease],
  );

  // Al cambiar lo escrito, el resaltado vuelve al principio: si no, podría quedar apuntando a una
  // posición que ya no existe en la nueva lista de resultados.
  const handleChange = useCallback((event: ReactChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActiveIndex(-1);
  }, []);

  // activeOptionId es el identificador del resultado resaltado, que el campo anuncia al lector de
  // pantalla (aria-activedescendant). Vacío mientras no hay ninguno resaltado.
  const activeOptionId =
    activeIndex >= 0 && activeIndex < matches.length
      ? `${optionIdPrefix}-${activeIndex}`
      : undefined;

  // hasResults dice si la lista de resultados EXISTE de verdad en la pantalla ahora mismo.
  //
  // Por qué importa, en español: el campo se anuncia como "combobox" y declaraba con aria-controls
  // que gobierna una lista concreta. Pero esa lista solo se dibuja cuando hay resultados: mientras el
  // campo estaba vacío, o cuando lo escrito no coincidía con nada, el campo seguía señalando a un
  // identificador que NO correspondía a ningún elemento de la página. Un lector de pantalla que
  // intenta seguir esa pista ("¿qué controla este campo?") no encuentra nada y anuncia el control de
  // forma incoherente, o directamente calla. Señalar a la lista SOLO cuando la lista está en pantalla
  // hace que la referencia sea siempre cierta.
  const hasResults = matches.length > 0;

  return (
    <div className="tlx-search" ref={rootRef}>
      {/* Botón-lupa: abre y cierra el panel. Es un botón real, alcanzable con Tab. */}
      <button
        ref={buttonRef}
        type="button"
        className="tlx-search-btn"
        aria-label={ui.search.openLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? closeSearch() : setOpen(true))}
      >
        {/* Lupa dibujada a mano (decorativa: la acción la comunica la etiqueta accesible). */}
        <svg className="tlx-search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M15.6 15.6 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          className="tlx-search-panel"
          role="dialog"
          aria-label={ui.search.panelLabel}
          tabIndex={-1}
        >
          {/* Campo de búsqueda: es un "combobox" enlazado con la lista de resultados de abajo. */}
          <label className="sr-only" htmlFor={`${panelId}-input`}>
            {ui.search.inputLabel}
          </label>
          <input
            id={`${panelId}-input`}
            className="tlx-search-input font-ui"
            type="text"
            role="combobox"
            autoComplete="off"
            placeholder={ui.search.placeholder}
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-expanded={hasResults}
            aria-controls={hasResults ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
          />

          {/* Región viva: anuncia cuántos resultados hay cada vez que cambia, sin ocupar espacio. */}
          <span className="sr-only" role="status" aria-live="polite">
            {query.trim() === "" ? "" : ui.search.resultsCount(matches.length)}
          </span>

          {releases.length === 0 ? (
            // Estado sin catálogo: la página no pudo traer datos, así que no hay dónde buscar.
            <p className="tlx-search-empty font-mono">{ui.search.emptyCatalog}</p>
          ) : query.trim() === "" ? (
            // Estado VACÍO: aún no se escribió nada. Se dice cuántos títulos hay disponibles.
            <p className="tlx-search-empty font-mono">{ui.search.hint(releases.length)}</p>
          ) : !hasResults ? (
            // Estado SIN RESULTADOS: lo escrito no coincide con ningún título del catálogo.
            <p className="tlx-search-empty font-mono">{ui.search.noResults(query.trim())}</p>
          ) : (
            <ul
              className="tlx-search-list"
              id={listId}
              role="listbox"
              aria-label={ui.search.resultsLabel}
            >
              {matches.map((match, index) => {
                const year = yearOf(match.release.releaseDate);
                const typeLabel = TYPE_LABELS[match.release.type];
                return (
                  <li key={match.release.id} role="presentation">
                    <button
                      id={`${optionIdPrefix}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`tlx-search-opt${index === activeIndex ? " is-active" : ""}`}
                      aria-label={ui.search.resultAria(match.release.title, typeLabel, year)}
                      // El ratón resalta lo que señala, para que teclado y puntero coincidan.
                      onPointerEnter={() => setActiveIndex(index)}
                      onClick={() => openRelease(match.release.id)}
                    >
                      <span className="tlx-search-opt-title">{match.release.title}</span>
                      <span className="tlx-search-opt-meta font-mono" aria-hidden="true">
                        {year !== "" ? `${typeLabel} · ${year}` : typeLabel}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Ayuda de teclado VISIBLE (no solo para lectores de pantalla): quien navega sin ratón ve
              de inmediato que las flechas y Enter funcionan aquí. */}
          <p className="tlx-search-keys font-mono">{ui.search.keyboardHint}</p>
        </div>
      ) : null}
    </div>
  );
}
