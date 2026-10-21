"use client";

// Archivo: PersonDetail.tsx — La ficha de una PERSONA (actor, director, guionista…).
//
// Qué arregla, en español: hasta ahora, en la ficha de una película, el nombre de un actor era texto
// muerto. No se podía pulsar y el camino se acababa ahí. Esta es la página a la que ahora lleva ese
// nombre: quién es, su foto, todo lo que tiene dentro de este catálogo y con quién se cruza más de
// una vez.
//
// LO QUE ESTA PÁGINA NO PROMETE, dicho en la propia página y no escondido aquí: solo enseña su
// trabajo DENTRO de la ventana de meses que cubre el producto. Su filmografía completa exigiría una
// operación nueva del servidor que hoy no existe, así que se dice con todas las letras y se enlaza a
// TMDB. Es preferible a dejar que alguien crea que estos son todos los trabajos de esa persona.
//
// Es un componente de navegador porque el reproductor de tráiler necesita saber el idioma que la
// persona eligió en su perfil, y ese dato vive en este navegador.

import Link from "next/link";
import { type CSSProperties } from "react";

import { YouTubeEmbed } from "@/components/YouTubeEmbed";
import { selectTrailer } from "@/lib/trailer-selection";
import { useProfile } from "@/lib/profile-context";
import { coverStyleFor, cssUrl, gradientStyleFor, seedFromId } from "@/lib/timeline";
import {
  tmdbPersonUrl,
  type Collaborator,
  type PersonCredit,
  type PersonProfile,
} from "@/lib/people";
import { departmentLabel, jobLabel } from "@/lib/credit-labels";
import { ui } from "@/lib/i18n";
import { type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// PersonDetailProps son las propiedades de la ficha de una persona.
type PersonDetailProps = {
  // person es la persona ya reunida a partir del catálogo (ver lib/people).
  person: PersonProfile;
  // collaborators es la gente con la que coincide en más de un título.
  collaborators: Collaborator[];
  // highlight es el título del que se enseña el tráiler, o null si ninguno de los suyos tiene video.
  highlight: Release | null;
};

// AVATAR_SEED_OFFSET separa el degradado del avatar del de las carátulas, para que no se repita el
// mismo color en la misma pantalla.
const AVATAR_SEED_OFFSET = 5;

// initials saca hasta dos iniciales de un nombre, para el avatar cuando no hay foto.
// En español: TMDB no tiene foto de todo el mundo (falta en más de uno de cada diez). Las iniciales
// son un marcador amable, no un dato: por eso el círculo va marcado como decorativo.
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// PersonDetail dibuja la ficha completa de una persona.
export function PersonDetail({ person, collaborators, highlight }: PersonDetailProps) {
  // Idioma preferido del perfil: decide qué tráiler se elige y en qué idioma van los subtítulos.
  const { profile } = useProfile();
  const preferredLanguage = profile.settings.language;

  // El tráiler del título destacado, elegido con la MISMA lógica que la ficha de un estreno. No se
  // duplica nada: es la cadena de elección de lib/trailer-selection, probada por su cuenta.
  const trailerChoice =
    highlight !== null ? selectTrailer(highlight.videos, preferredLanguage) : undefined;

  return (
    <article className="pd-page font-ui">
      {/* ----- Cabecera: foto, nombre y qué hace ----- */}
      <header className="pd-head glass-2">
        {/* Avatar: la foto real si TMDB la tiene; si no, un círculo con sus iniciales. Decorativo:
            el nombre va como texto al lado, así que la identidad no depende de la imagen. */}
        <span
          aria-hidden="true"
          className="pd-avatar font-display"
          style={avatarStyle(person.photoUrl, seedFromId(String(person.personTmdbId)))}
        >
          {person.photoUrl ? "" : initials(person.name)}
        </span>
        <div className="pd-head-text">
          <h1 className="pd-name font-display">{person.name}</h1>
          {person.departments.length > 0 ? (
            <p className="pd-departments font-mono">
              <span className="pd-departments-label">{ui.person.rolesLabel}:</span>{" "}
              {person.departments.map(departmentLabel).join(" · ")}
            </p>
          ) : null}
          <p className="pd-count font-mono">{ui.person.inCatalogCount(person.credits.length)}</p>
        </div>
      </header>

      {/* ----- Tráiler del título destacado -----
          Una persona no tiene tráiler propio: lo que se enseña es el de uno de sus títulos, y se dice
          de cuál es. Si ninguno de sus títulos tiene video, la sección entera no se dibuja, en vez de
          dejar un recuadro anunciando algo que no existe. */}
      {highlight !== null ? (
        <section className="pd-section">
          <h2 className="pd-section-label font-hud">{ui.person.trailerLabel}</h2>
          {/* Sin rótulo encima del póster a propósito: se pintaría centrado sobre un fotograma que
              puede ser muy claro (se vio ilegible sobre una sala de cine iluminada) y además diría
              exactamente lo mismo que la línea de debajo. Una sola vez y donde se lee. */}
          <YouTubeEmbed
            video={trailerChoice?.video}
            notice={trailerChoice?.notice}
            title={highlight.title}
            posterUrl={highlight.backdropUrl}
            seed={seedFromId(highlight.id)}
            captionLang={preferredLanguage}
          />
          <p className="pd-trailer-note">{ui.person.trailerOf(highlight.title)}</p>
        </section>
      ) : null}

      {/* ----- En este catálogo: sus títulos, cada uno con su papel ----- */}
      <section className="pd-section">
        <h2 className="pd-section-label font-hud">{ui.person.inCatalogLabel}</h2>
        <ul className="pd-credits">
          {person.credits.map((credit, index) => (
            <li key={`${credit.release.id}-${index}`}>
              <CreditCard credit={credit} />
            </li>
          ))}
        </ul>
      </section>

      {/* ----- Coincide habitualmente con -----
          Es lo que hace que la red se sienta viva: dos nombres que se repiten juntos en tres de tus
          títulos cuentan una historia que ninguna ficha suelta cuenta. La explicación de abajo aclara
          qué significa exactamente, para que nadie lo lea como algo que no es. */}
      {collaborators.length > 0 ? (
        <section className="pd-section">
          <h2 className="pd-section-label font-hud">{ui.person.collaboratorsLabel}</h2>
          <p className="pd-section-hint">{ui.person.collaboratorsHint}</p>
          <ul className="pd-collaborators">
            {collaborators.map((collaborator) => (
              <li key={collaborator.personTmdbId}>
                <Link
                  href={`/persona/${collaborator.personTmdbId}`}
                  className="pd-collaborator"
                  aria-label={ui.detail.personLinkAria(collaborator.name)}
                >
                  <span
                    aria-hidden="true"
                    className="pd-collaborator-avatar font-display"
                    style={avatarStyle(
                      collaborator.photoUrl,
                      seedFromId(String(collaborator.personTmdbId)) + AVATAR_SEED_OFFSET,
                    )}
                  >
                    {collaborator.photoUrl ? "" : initials(collaborator.name)}
                  </span>
                  {/* Nombre y recuento en columna: en fila, un nombre escrito en japonés se quedaba
                      con una letra por línea porque el recuento le comía todo el ancho. */}
                  <span className="pd-collaborator-text">
                    <span className="pd-collaborator-name">{collaborator.name}</span>
                    <span className="pd-collaborator-count font-mono">
                      {ui.person.collaboratorShared(collaborator.sharedTitles)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ----- La frontera, declarada ----- */}
      <section className="pd-section">
        <h2 className="pd-section-label font-hud">{ui.person.outsideCatalogLabel}</h2>
        <p className="pd-section-hint">{ui.person.outsideCatalogHint}</p>
        <a
          href={tmdbPersonUrl(person.personTmdbId)}
          target="_blank"
          rel="noopener noreferrer"
          className="pd-external font-mono"
          aria-label={ui.person.searchOnTmdbAria(person.name)}
        >
          {ui.person.searchOnTmdb}
          <span aria-hidden="true"> →</span>
        </a>
      </section>
    </article>
  );
}

// avatarStyle calcula el fondo del círculo: la foto real, o el degradado de respaldo.
// En español: la foto se pinta como FONDO y no como una etiqueta de imagen porque el nombre de la
// persona ya está como texto al lado (la identidad no se pierde para un lector de pantalla) y así no
// hace falta declarar dominios remotos de imagen para fotos que a veces no llegan.
function avatarStyle(photoUrl: string, seed: number): CSSProperties {
  if (photoUrl) {
    return {
      backgroundImage: cssUrl(photoUrl),
      backgroundSize: "cover",
      backgroundPosition: "center",
      borderColor: "var(--color-border)",
    };
  }
  return { ...gradientStyleFor(seed), borderColor: "var(--color-border)" };
}

// CreditCard dibuja UNA participación: la carátula del título, su nombre y qué hizo la persona ahí.
function CreditCard({ credit }: { credit: PersonCredit }) {
  // Los papeles: el personaje si actúa, los oficios si es del equipo. Una misma persona puede firmar
  // varios oficios de la misma película —dirección, guion, montaje— y se enseñan todos juntos, que es
  // lo que de verdad ocurre. Si no hay ninguno anotado, no se enseña nada en vez de inventar relleno.
  //
  // Los OFICIOS se traducen al español; los nombres de PERSONAJE, jamás. La misma lista mezcla los dos
  // —quien dirige y además actúa aparece con "Director" y con el nombre de su personaje— así que la
  // traducción se hace por coincidencia EXACTA con la tabla de oficios: un puesto que está en la tabla
  // se traduce y cualquier otra cosa, nombres de personaje incluidos, sale tal cual (ver jobLabel).
  const role = credit.roles.map(jobLabel).join(" · ");
  // Las áreas traducidas sirven de respaldo cuando no hay ningún papel concreto ("Sonido", "Producción"…).
  const fallback = credit.departments.map(departmentLabel).join(" · ");
  return (
    <Link
      href={`/titulo/${credit.release.id}`}
      className="pd-credit"
      aria-label={ui.detail.connectionAria(credit.release.title)}
    >
      <span
        aria-hidden="true"
        className="pd-credit-poster"
        style={coverStyleFor(
          credit.release.posterUrl || credit.release.backdropUrl,
          seedFromId(credit.release.id),
        )}
      />
      <span className="pd-credit-text">
        <span className="pd-credit-title font-display">{credit.release.title}</span>
        {role !== "" || fallback !== "" ? (
          <span className="pd-credit-role">{role !== "" ? role : fallback}</span>
        ) : null}
        {/* En una serie, en cuántos episodios sale: es lo que distingue a un protagonista de alguien
            que pasó por un capítulo. Solo se enseña cuando el dato existe de verdad. */}
        {credit.episodeCount > 0 ? (
          <span className="pd-credit-episodes font-mono">
            {ui.person.episodes(credit.episodeCount)}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
