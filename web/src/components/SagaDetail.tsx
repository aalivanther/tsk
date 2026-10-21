"use client";

// Archivo: SagaDetail.tsx — La ficha de una SAGA (o de las temporadas de una serie).
//
// Qué arregla, en español: una saga solo existía como una tira de pósters dentro de la ficha de un
// título, y cada entrada abría una ventanita pequeña con casi nada dentro. No tenía dirección propia
// ni se podía compartir. Esta es la página: las entradas de la saga con su carátula y su sinopsis, y
// las que están en el catálogo enlazando a su ficha completa.
//
// LA REGLA QUE ORDENA TODA ESTA PANTALLA: una entrada que NO está en el catálogo se enseña con lo
// que se sabe de ella —póster, año, sinopsis— pero SIN enlace. Un enlace que lleva a una página vacía
// es peor que no tener enlace. Y se marca cuál sí está, para que la diferencia se vea.
//
// Es un componente de navegador porque el reproductor de tráiler necesita saber el idioma que la
// persona eligió en su perfil, y ese dato vive en este navegador.

import Link from "next/link";

import { YouTubeEmbed } from "@/components/YouTubeEmbed";
import { selectTrailer } from "@/lib/trailer-selection";
import { useProfile } from "@/lib/profile-context";
import { coverStyleFor, seedFromId } from "@/lib/timeline";
import { type SagaEntry, type SagaProfile } from "@/lib/saga";
import { ui } from "@/lib/i18n";
import { type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// SagaDetailProps son las propiedades de la ficha de una saga.
type SagaDetailProps = {
  // saga es la saga ya reunida a partir del catálogo (ver lib/saga).
  saga: SagaProfile;
  // highlight es el título del que se enseña el tráiler, o null si ninguno de la saga tiene video.
  highlight: Release | null;
  // origin es el título de ESTE catálogo al que devuelve la salida de la página, o null si no hay
  // ninguno (algo que hoy no puede ocurrir: una saga existe porque algún estreno la declara).
  //
  // Por qué es obligatorio pasarlo, en español: esta pantalla era un callejón sin salida. Se llegaba
  // desde la ficha de un título y, en la inmensa mayoría de los casos, ninguna de las entradas estaba
  // en el catálogo, así que no había ni un solo enlace que pulsar y la única forma de seguir era
  // volver al principio de todo. Que la salida sea un dato REQUERIDO —y no un añadido opcional que
  // algún día alguien olvide pasar— es lo que garantiza que eso no vuelva a pasar.
  origin: Release | null;
};

// SagaDetail dibuja la página completa de una saga.
export function SagaDetail({ saga, highlight, origin }: SagaDetailProps) {
  // Idioma preferido del perfil: decide qué tráiler se elige y en qué idioma van los subtítulos.
  const { profile } = useProfile();
  const preferredLanguage = profile.settings.language;

  // El tráiler del título destacado, elegido con la MISMA lógica que la ficha de un estreno.
  const trailerChoice =
    highlight !== null ? selectTrailer(highlight.videos, preferredLanguage) : undefined;

  return (
    <article className="sg-page font-ui">
      {/* ----- Cabecera: nombre de la saga y cuántas entradas tiene ----- */}
      <header className="sg-head glass-2">
        <h1 className="sg-name font-display">{saga.name}</h1>
        <p className="sg-count font-mono">{ui.saga.entriesCount(saga.entries.length)}</p>
        {/* El aviso de que esto son temporadas y no una saga. Mientras el catálogo siga metiendo las
            dos cosas en el mismo sitio, la página lo dice en vez de llamar "saga" a lo que no lo es. */}
        {saga.isSeasons ? <p className="sg-note">{ui.saga.seasonsNote}</p> : null}
        {/*
          LA SALIDA. Va en la cabecera, arriba del todo y en el orden de tabulación antes que
          cualquier otra cosa de la página: es lo primero que necesita quien acaba de llegar aquí y
          descubre que ninguna de las entradas de abajo lleva a ningún sitio.
        */}
        {origin !== null ? (
          <Link
            href={`/titulo/${origin.id}`}
            className="sg-origin font-mono"
            aria-label={ui.saga.backToOriginAria(origin.title)}
          >
            <span aria-hidden="true">‹</span> {ui.saga.backToOrigin(origin.title)}
          </Link>
        ) : null}
      </header>

      {/* ----- Tráiler del título destacado -----
          Una saga no tiene tráiler propio: se enseña el de una de sus entregas y se dice de cuál es.
          Si ninguna tiene video, la sección no se dibuja. */}
      {highlight !== null ? (
        <section className="sg-section">
          <h2 className="sg-section-label font-hud">{ui.saga.trailerLabel}</h2>
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
          <p className="sg-trailer-note">{ui.saga.trailerOf(highlight.title)}</p>
        </section>
      ) : null}

      {/* ----- Las entradas de la saga ----- */}
      <section className="sg-section">
        <h2 className="sg-section-label font-hud">{ui.saga.entriesLabel}</h2>
        <ul className="sg-entries">
          {saga.entries.map((entry, index) => (
            <li key={`${entry.item.title}-${index}`}>
              <SagaEntryCard entry={entry} seed={seedFromId(saga.slug) + index} />
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

// SagaEntryCard dibuja UNA entrada: carátula, título, año, nota y sinopsis.
//
// En español: la misma tarjeta sirve para los dos casos, y lo único que cambia es si es un enlace o
// no. Se hace así a propósito: si fueran dos componentes distintos, con el tiempo acabarían
// enseñando cosas distintas y la entrada "de fuera" se quedaría más pobre sin ningún motivo.
function SagaEntryCard({ entry, seed }: { entry: SagaEntry; seed: number }) {
  const { item, release } = entry;
  // La portada: la de la entrada si la trae; si no, la del estreno del catálogo cuando existe.
  const posterUrl = item.posterUrl || release?.posterUrl || "";
  // La sinopsis: la de la entrada, y si viene vacía —lo habitual en las temporadas— la del estreno
  // del catálogo. Solo se usa lo que existe de verdad; nunca se rellena con texto inventado.
  const overview = item.overview || release?.overview || "";

  // El cuerpo de la tarjeta es el mismo lleve enlace o no.
  const body = (
    <>
      <span aria-hidden="true" className="sg-entry-poster" style={coverStyleFor(posterUrl, seed)} />
      <span className="sg-entry-text">
        <span className="sg-entry-title font-display">{item.title}</span>
        <span className="sg-entry-meta font-mono">
          {[item.year, item.extra, item.rating > 0 ? `★ ${item.rating.toFixed(1)}` : ""]
            .filter((part) => part !== "")
            .join(" · ")}
        </span>
        {overview !== "" ? <span className="sg-entry-overview">{overview}</span> : null}
        {/* La marca de si está aquí o no. Es la información que decide si hay a dónde ir. */}
        <span className="sg-entry-badge font-mono" data-in-catalog={release !== null}>
          {release !== null ? ui.saga.inCatalogBadge : ui.saga.outsideCatalogNote}
        </span>
      </span>
    </>
  );

  // Está en el catálogo: la tarjeta entera es un enlace a su ficha completa.
  if (release !== null) {
    return (
      <Link
        href={`/titulo/${release.id}`}
        className="sg-entry is-linked"
        aria-label={ui.saga.openEntryAria(item.title)}
      >
        {body}
      </Link>
    );
  }

  // No está: se enseña igual de completa, pero sin enlace. Ver la regla de la cabecera.
  return <div className="sg-entry">{body}</div>;
}
