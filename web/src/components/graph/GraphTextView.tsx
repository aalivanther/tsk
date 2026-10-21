"use client";

// Archivo: GraphTextView.tsx — La misma constelación, escrita.
//
// Por qué existe, en español, y por qué no es un premio de consolación:
//
// Un mapa de puntos y líneas sencillamente NO EXISTE para quien navega con lector de pantalla. Es un
// rectángulo mudo. Así que la misma información tiene que estar disponible como texto recorrible, o
// la pantalla está a medio hacer y da igual lo bonito que quede el dibujo.
//
// Pero además —y esto es lo que la convierte en una vista de pleno derecho y no en una rampa de
// acceso— hay preguntas para las que la lista responde MEJOR que el dibujo, para todo el mundo. "¿En
// qué tres películas mías sale este actor?" se contesta aquí en dos segundos; en el mapa hay que
// encontrar el punto, pulsarlo y leer los nombres alrededor. Por eso las dos vistas están siempre
// disponibles, y en el teléfono esta es la que se abre por defecto.
//
// Cómo está montada: dos recorridos del mismo dato, en las dos direcciones.
//   · Por VÍNCULO: "Reparto → Ana Ruiz → estas tres películas tuyas".
//   · Por TÍTULO: "Duna 3 → está aquí por estas cuatro razones".
// Se usan elementos <details> normales del navegador, que ya saben abrirse y cerrarse con el teclado
// y anunciarse solos. Reimplementar eso a mano habría sido escribir peor lo que ya está resuelto.

import Link from "next/link";

import {
  attributesOfTitle,
  groupAttributesByKind,
  matchesSearch,
  titlesOfAttribute,
} from "@/lib/graph-view-model";
import { type GraphNodeKind, type PersonalGraph } from "@/lib/personal-graph";
import { ui } from "@/lib/i18n";

// KIND_LABELS traduce el tipo de vínculo al rótulo de su sección.
const KIND_LABELS: Record<GraphNodeKind, string> = {
  title: ui.graph.kindTitle,
  cast: ui.graph.kindCast,
  director: ui.graph.kindDirector,
  genre: ui.graph.kindGenre,
  platform: ui.graph.kindPlatform,
};

// GraphTextViewProps son las propiedades de la lista.
type GraphTextViewProps = {
  // graph es el mapa YA FILTRADO (los mismos datos exactos que dibuja el lienzo).
  graph: PersonalGraph;
  // searchQuery filtra lo que se enseña; vacío significa "todo".
  searchQuery: string;
};

// GraphTextView dibuja la constelación como listas navegables.
export function GraphTextView({ graph, searchQuery }: GraphTextViewProps) {
  // Las secciones de vínculos, ya ordenadas de fuerte a flojo y por cuánto une cada uno.
  const groups = groupAttributesByKind(graph)
    .map((group) => ({
      ...group,
      nodes: group.nodes.filter((node) => matchesSearch(node, searchQuery)),
    }))
    .filter((group) => group.nodes.length > 0);

  // Los títulos de la biblioteca que encajan con la búsqueda.
  const titles = graph.nodes
    .filter((node) => node.kind === "title" && matchesSearch(node, searchQuery))
    .sort((left, right) => left.label.localeCompare(right.label, "es-MX"));

  // Nada encaja con lo buscado: se dice, en vez de dejar la pantalla en blanco.
  if (groups.length === 0 && titles.length === 0) {
    return (
      <p className="pg-empty font-mono" role="status">
        {ui.graph.searchNoResults}
      </p>
    );
  }

  return (
    <div className="pg-list">
      <p className="pg-list-intro">{ui.graph.listIntro}</p>

      {/* ----- Recorrido por VÍNCULO: qué se repite y en qué títulos tuyos ----- */}
      {groups.map((group) => (
        <section key={group.kind} className="pg-list-group">
          <h3 className="pg-list-heading font-hud">
            {ui.graph.groupHeading(KIND_LABELS[group.kind], group.nodes.length)}
          </h3>
          <ul className="pg-list-items">
            {group.nodes.map((node) => {
              const linked = titlesOfAttribute(graph, node.id);
              return (
                <li key={node.id}>
                  <details className="pg-details">
                    <summary className="pg-detail-summary">
                      <span className="pg-detail-summary-label">{node.label}</span>
                      <span className="pg-detail-summary-count font-mono">
                        {ui.graph.sharedBy(node.degree)}
                      </span>
                    </summary>
                    {/* Los títulos que cuelgan de este vínculo: cada uno enlaza a su ficha. Aquí no
                        hay ningún enlace falso — todos son estrenos que están de verdad en el
                        catálogo, porque el mapa se construye a partir de él. */}
                    <ul className="pg-details-list">
                      {linked.map((title) => (
                        <li key={title.id}>
                          <Link
                            href={`/titulo/${title.releaseId ?? ""}`}
                            className="pg-title-link"
                            aria-label={ui.graph.openTitleAria(title.label)}
                          >
                            {title.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* ----- Recorrido por TÍTULO: por qué razones está cada cosa donde está ----- */}
      {titles.length > 0 ? (
        <section className="pg-list-group">
          <h3 className="pg-list-heading font-hud">
            {ui.graph.groupHeading(ui.graph.kindTitle, titles.length)}
          </h3>
          <ul className="pg-list-items">
            {titles.map((title) => {
              const reasons = attributesOfTitle(graph, title.id);
              return (
                <li key={title.id}>
                  <details className="pg-details">
                    <summary className="pg-detail-summary">
                      <span className="pg-detail-summary-label">{title.label}</span>
                      <span className="pg-detail-summary-count font-mono">
                        {ui.graph.linkedBy(reasons.length)}
                      </span>
                    </summary>
                    <div className="pg-details-body">
                      {/* El enlace a la ficha va PRIMERO: es lo que casi todo el mundo viene a hacer
                          al abrir un título, y tenerlo tras la lista de razones lo escondería. */}
                      <Link
                        href={`/titulo/${title.releaseId ?? ""}`}
                        className="pg-title-link"
                        aria-label={ui.graph.openTitleAria(title.label)}
                      >
                        {ui.graph.openTitleAria(title.label)}
                      </Link>
                      <ul className="pg-details-list">
                        {reasons.map((reason) => (
                          <li key={reason.id}>
                            <span className="pg-reason-kind font-mono">
                              {KIND_LABELS[reason.kind]}
                            </span>{" "}
                            {reason.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
