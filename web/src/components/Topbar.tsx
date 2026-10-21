"use client";

// Archivo: Topbar.tsx — Barra superior fija (shell) de "MDM 7mo".
//
// En español: es la franja de arriba que se queda pegada al borde superior de la
// pantalla mientras el usuario hace scroll. Contiene tres cosas:
//   1) La marca "MDM 7mo" (con "7mo" en dorado) y la frase de Máximo debajo.
//   2) Unas "píldoras" de filtro (Todos / Películas / Series) que YA FUNCIONAN: al
//      pulsarlas cambian el filtro por tipo de la línea de tiempo (S6).
//   3) Un botón "Ir a hoy" que YA FUNCIONA: lleva la línea de tiempo hasta el
//      marcador HOY.
//
// Lleva 'use client' porque ahora SÍ tiene interacción de navegador: lee y escribe
// el estado de filtro compartido (useFilter) y dispara el desplazamiento "Ir a hoy".
// Ese estado lo provee FilterProvider, que la página coloca alrededor del Topbar y
// de la Timeline para que ambos se coordinen sin pasarse props por media app.
//
// El acabado es SLIM HEXTECH: una franja delgada de cristal (fondo translúcido + desenfoque,
// borde inferior suave) con las marquillas de filtro en el mismo lenguaje visual que los nodos de
// la espina, para que barra y timeline se sientan una sola pieza. Geometría/colores en globals.css.
//
// Accesibilidad: la barra es un <header> con un <nav> etiquetado; cada control es un
// <button> real navegable por teclado, con foco visible (lo aporta globals.css) y
// estados ARIA (aria-pressed) que comunican qué filtro está activo.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { ui } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useFilter } from "@/lib/timeline-context";
import { FILTER_CATEGORIES, type FilterCategory, type TodayMarker } from "@/lib/timeline";
import { NotificationBell } from "@/components/NotificationBell";
import { TitleSearch } from "@/components/TitleSearch";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// CATEGORY_OPTION_LABEL traduce cada opción de categoría a su etiqueta visible (es-MX).
const CATEGORY_OPTION_LABEL: Record<FilterCategory, string> = {
  movie: ui.filters.movies,
  series: ui.filters.series,
  streaming: ui.filters.streaming,
  indie: ui.filters.indie,
};

// MultiOption es UNA opción del multi-select: su valor interno y su etiqueta visible.
type MultiOption = { value: string; label: string };

// MultiSelect es un filtro con MULTI-selección: un botón hextech que abre un panel con las opciones como
// casillas; se pueden activar VARIAS (se combinan con "O"). Reemplaza al <select> de una sola opción para
// que el filtro luzca pulido y permita combinar. Cierra al pulsar fuera o con Escape (a11y de menús).
// Es genérico: lo usan tanto Categoría (4 opciones fijas) como Género (los géneros reales del catálogo).
function MultiSelect({
  cap,
  allLabel,
  countLabel,
  options,
  selected,
  onChange,
}: {
  cap: string;
  allLabel: string;
  countLabel: (count: number) => string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Cierre al pulsar fuera del componente o con Escape. Solo activo mientras el panel está abierto.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // toggle añade o quita un valor de la selección, conservando el ORDEN de `options` (lectura estable).
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange(
        options
          .map((option) => option.value)
          .filter((item) => item === value || selected.includes(item)),
      );
    }
  };

  // Resumen del botón: "todas/todos" si nada; la etiqueta si hay una; "N …" si hay varias.
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? selected[0])
        : countLabel(selected.length);

  return (
    <div className="tlx-multi" ref={rootRef}>
      <button
        type="button"
        className="tlx-multi-btn font-mono"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={cap}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="tlx-multi-cap">{cap}</span>
        <span className="tlx-multi-val">{summary}</span>
        <span className="tlx-multi-arrow" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="tlx-multi-panel" role="listbox" aria-label={cap}>
          {options.map((option) => {
            const isOn = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isOn}
                className={`tlx-multi-opt font-mono${isOn ? " is-on" : ""}`}
                onClick={() => toggle(option.value)}
              >
                <span className="tlx-multi-check" aria-hidden="true">
                  {isOn ? "✓" : ""}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// TopbarProps son las props de la barra superior.
// En español: recibe la lista de géneros ÚNICOS del catálogo para poblar el select "Género" con datos
// REALES (la calcula el servidor en la página y la pasa como dato; nunca se inventan opciones).
type TopbarProps = {
  // genres son los géneros únicos del catálogo, ya ordenados, para las opciones del select de género.
  genres: string[];
  // catalog son todos los estrenos cargados, para que la campana de avisos derive las notificaciones de
  // la watchlist. Opcional: en el estado de error de la página no hay catálogo y la campana no se monta.
  catalog?: ReleaseSummary[];
  // today es el marcador HOY (para los avisos). Opcional por el mismo motivo que catalog.
  today?: TodayMarker;
};

// Topbar dibuja la barra superior SLIM HEXTECH del shell y conecta sus controles al estado compartido.
// En español: arma la marca, las marquillas de filtro (que cambian el filtro de la timeline) y el botón
// "Ir a hoy" (que desplaza la timeline al marcador HOY), en una franja DELGADA de cristal. El estilo de
// las marquillas es el MISMO lenguaje hextech que los nodos de la espina (borde fino, mayúsculas mono,
// activo en oro), para que la barra y la timeline se sientan una sola pieza. La geometría/colores viven
// en globals.css (clases tlx-topbar/tlx-filter/tlx-hoy). Desde el sprint de cierre incluye además el
// BUSCADOR de títulos (TitleSearch): filtra en el navegador el catálogo que la página ya trajo.
export function Topbar({ genres, catalog, today }: TopbarProps) {
  // Tomamos del contexto el filtro activo, la función para cambiarlo y la de "Ir a hoy".
  const { filter, setFilter, goToToday } = useFilter();

  // Sesión: si hay usuario, el avatar muestra su INICIAL (señal de "sesión iniciada"); si no, el ícono
  // genérico. El avatar siempre lleva a /perfil (el hub del perfil, con login/logout dentro).
  const { user } = useAuth();
  const initial = user?.displayName?.trim()?.charAt(0)?.toUpperCase() ?? "";

  return (
    // <header> semántico fijo arriba (sticky, z alto). El alto fijo (--tlx-topbar-h) lo comparte la
    // página para calcular cuánto le queda al <main> y que la espina llene la ventana sin scroll vertical.
    <header className="tlx-topbar font-ui">
      {/*
        Marca: logo clicable a la home (navegable por teclado). "MDM" normal + "7mo" en oro. La frase de
        Máximo va al lado y se oculta en pantallas estrechas para mantener la barra delgada.
      */}
      <Link href="/" className="tlx-brand" aria-label={`${ui.brand.full} — ${ui.brand.tagline}`}>
        <span className="tlx-brand-name">
          {ui.brand.prefix}
          <span className="text-gold"> {ui.brand.highlight}</span>
        </span>
        <span className="tlx-brand-tag">{ui.brand.tagline}</span>
      </Link>

      {/*
        Grupo de filtros: DOS selects hextech (Categoría + Género) que combinan con "Y". Cada uno lleva su
        etiqueta accesible (aria-label) y una opción "Todas/Todos" que no filtra esa dimensión. Al cambiar
        un select, mandamos SOLO esa dimensión a setFilter (parche parcial); la otra se conserva.
      */}
      <div aria-label={ui.filters.groupLabel} role="group" className="tlx-filters">
        {/* CATEGORÍA: filtro MULTI-selección (combina varias con "O"). */}
        <MultiSelect
          cap={ui.filters.categoryLabel}
          allLabel={ui.filters.categoryAll}
          countLabel={ui.filters.categoryCount}
          options={FILTER_CATEGORIES.map((value) => ({
            value,
            label: CATEGORY_OPTION_LABEL[value],
          }))}
          selected={filter.categories}
          onChange={(next) => setFilter({ categories: next as FilterCategory[] })}
        />

        {/* GÉNERO: filtro MULTI-selección con los géneros REALES del catálogo (poblados desde el servidor). */}
        <MultiSelect
          cap={ui.filters.genreLabel}
          allLabel={ui.filters.genreAll}
          countLabel={ui.filters.genreCount}
          options={genres.map((genre) => ({ value: genre, label: genre }))}
          selected={filter.genres}
          onChange={(next) => setFilter({ genres: next })}
        />
      </div>

      {/* Separador flexible: empuja el botón "Ir a hoy" hacia la derecha. */}
      <span className="tlx-topbar-spacer" aria-hidden="true" />

      {/*
        BUSCADOR de títulos: un botón-lupa que despliega el campo y sus resultados. Filtra en el
        navegador la lista de estrenos que la página ya trajo (no pide nada al servidor). Si la página
        no aportó catálogo (estado de error), el panel lo dice en vez de fingir una búsqueda vacía.
      */}
      <TitleSearch releases={catalog ?? []} />

      {/*
        Botón "Ir a hoy": desplaza la línea de tiempo hasta el marcador HOY. Llama a goToToday() del
        contexto, que ejecuta el scroll que la Timeline registró. Marquilla hextech en oro.
      */}
      <button type="button" onClick={goToToday} className="tlx-hoy font-mono">
        {ui.actions.goToToday}
      </button>

      {/*
        Campana de AVISOS: solo si la página aportó catálogo + HOY (en el estado de error no hay datos
        para derivar avisos). Deriva las notificaciones de la watchlist en 2 tiempos (estreno + plataformas).
      */}
      {catalog !== undefined && today !== undefined ? (
        <NotificationBell catalog={catalog} today={today} />
      ) : null}

      {/*
        Avatar de PERFIL: enlace a la página /perfil (mi cuenta local). Marquilla hextech circular con un
        ícono de personaje. A la derecha de "Ir a hoy".
      */}
      <Link
        href="/perfil"
        className={`tlx-profile${initial !== "" ? " is-auth" : ""}`}
        aria-label={ui.actions.profile}
      >
        {initial !== "" ? (
          // Sesión iniciada: inicial del nombre en oro (en vez del ícono genérico).
          <span className="tlx-profile-initial font-hud" aria-hidden="true">
            {initial}
          </span>
        ) : (
          <svg className="tlx-profile-icon" viewBox="0 0 24 24" aria-hidden="true">
            {/* Cabeza + hombros: silueta de personaje, en oro (currentColor). */}
            <circle cx="12" cy="8.4" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M5.5 19.2c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        )}
      </Link>
    </header>
  );
}
