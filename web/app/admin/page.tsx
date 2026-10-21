// Archivo: app/admin/page.tsx — Pantalla Admin (stub): la tabla de SOLO LECTURA del seed (S8).
//
// En español: esta es la pantalla interna que se abre en "/admin". Es un ADELANTO (placeholder) de la
// futura interfaz de ingesta de la Fase 1: el lugar donde, más adelante, se cargarán y curarán los
// estrenos. En la Fase 0 NO edita nada: solo MUESTRA, en una tabla de solo lectura, lo que trae el
// seed del backend (junio y julio de 2026, México). Su utilidad hoy es de inspección rápida —ver de un
// vistazo qué datos llegaron— y de "frontera de alcance" visible: deja claro qué gobernará la Fase 1.
//
// Es un Server Component (sin 'use client'): se renderiza en el servidor, donde es seguro hablar con el
// backend por Connect. Pide el catálogo por el cargador compartido "loadCatalogWindowDetails", que NUNCA lanza.
// Usa las fichas COMPLETAS —y no los resúmenes del listado— porque esta tabla enseña, entre otras
// cosas, cuánta gente hay en el reparto de cada título, y ese dato solo viaja en la ficha completa:
// si el backend no responde (por ejemplo durante "next build", que corre sin backend), devuelve listas
// vacías + un mensaje de error, y la página dibuja igual su estado de error o vacío. Así el build pasa
// sin backend levantado y, en ejecución con el api arriba, se ven los datos reales.
//
// Es una ruta INTERNA (no del grupo público): por eso NO usa el Topbar ni el Footer del shell público.
// Lleva un encabezado propio MINIMAL, suficiente para identificar la pantalla y explicar qué es.
//
// Reparto de responsabilidades de estados (regla §12, estados siempre cubiertos):
//   - ERROR de red de AMBOS meses -> bloque de error con explicación en es-MX.
//   - VACÍO (el seed no trajo estrenos) -> bloque "sin estrenos en el seed".
//   - DATOS -> la tabla semántica de solo lectura.

import type { JSX } from "react";

import { currentAdminDecision } from "@/lib/admin-decision";
import { deriveRarity, type Tier } from "@/lib/rarity";
import { loadCatalogWindowDetails, TitleType, type Release } from "@/lib/connect/catalog";
import { CATEGORY_META, categoryKeyFromEnum } from "@/lib/timeline";
import { ui } from "@/lib/i18n";

// metadata marca la ruta como NO indexable por buscadores (es una pantalla interna).
// En español: además del "X-Robots-Tag" que añade el middleware, la propia página lo declara en su
// <head>: doble cinturón para que /admin jamás aparezca en resultados de búsqueda.
export const metadata = {
  title: "Admin — The Story Keeper",
  robots: { index: false, follow: false },
};

// La pantalla de inspección pide EXACTAMENTE la misma ventana de meses que la home pública (derivada
// de HOY, no meses escritos a mano): lo que se audita aquí es lo que el público ve.

// dynamic = "force-dynamic" hace que la pantalla se renderice EN CADA PETICIÓN (no en el build).
// En español: así "next build" no intenta llamar al backend (que puede no estar arriba al compilar) y,
// en ejecución, la tabla siempre refleja el seed actual del catálogo.
export const dynamic = "force-dynamic";

// TIER_TOKEN_VAR mapea cada rareza a la VARIABLE CSS de su color de acento (token de @theme).
// En español: la columna TMDB pinta su valor con el color de la rareza derivada (oro para legendario,
// violeta para épico, teal para raro, gris atenuado para común). Usamos los tokens del proyecto (nada
// de colores sueltos), de forma que si se reajusta la paleta en globals.css, aquí cambia solo.
const TIER_TOKEN_VAR: Record<Tier, string> = {
  legendary: "var(--color-gold)",
  epic: "var(--color-violet)",
  rare: "var(--color-teal)",
  common: "var(--color-text-muted)",
};

// formatReleaseDateMx convierte una fecha ISO (AAAA-MM-DD) a texto legible es-MX, leído en UTC.
// En español: el backend manda "2026-06-15"; aquí lo mostramos como "15 jun 2026". Leemos en UTC (no en
// la zona del usuario) para que la fecha no se "corra un día" según dónde se mire. Si la fecha viniera
// vacía o mal formada, devolvemos el guion (—) para no mostrar un dato roto. Espeja la misma regla de
// formato que usa el detalle (ReleaseDetail), manteniendo coherencia en toda la app.
function formatReleaseDateMx(isoDate: string): string {
  if (!isoDate) {
    return ui.admin.dash;
  }
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return ui.admin.dash;
  }
  return parsed.toLocaleDateString("es-MX", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// typeLabel traduce el enum TitleType a su etiqueta legible en es-MX (Película / Serie).
// En español: el modelo trae el tipo como número (MOVIE=1, SERIES=2); aquí lo pasamos al texto que ve
// el usuario. Cualquier otro valor (UNSPECIFIED) no afirma un tipo real; asignarle "Película" o
// "Serie" sería inventar, así que devolvemos el guion (—) para no afirmar un tipo que el dato no trae.
function typeLabel(type: TitleType): string {
  if (type === TitleType.MOVIE) {
    return ui.admin.typeMovie;
  }
  if (type === TitleType.SERIES) {
    return ui.admin.typeSeries;
  }
  return ui.admin.dash;
}

// categoryLabel traduce la categoría del estreno a su etiqueta es-MX (Cine / Streaming / Cadenas).
// En español: reutilizamos CATEGORY_META (la tabla maestra de categorías de la timeline) para no
// duplicar los textos ni los colores. Si la categoría viene sin clasificar (UNSPECIFIED), devolvemos
// el guion en vez de inventar una categoría.
function categoryLabel(release: Release): string {
  const key = categoryKeyFromEnum(release.category);
  if (key === null) {
    return ui.admin.dash;
  }
  return CATEGORY_META[key].label;
}

// joinOrDash une una lista de textos con coma, o devuelve el guion (—) si la lista está vacía.
// En español: varias columnas (plataformas, cadenas) son listas. Cuando no hay
// nada, mostramos el guion para que la celda no quede vacía y se lea como "sin dato" de forma clara.
function joinOrDash(values: string[]): string {
  if (values.length === 0) {
    return ui.admin.dash;
  }
  return values.join(", ");
}

// textOrDash devuelve el texto recibido, o el guion (—) si viene vacío.
// En español: las calificaciones de OMDb (IMDb, RT) son texto opcional y pueden faltar; mostramos el
// guion en ese caso para indicar "sin dato" sin dejar la celda en blanco.
function textOrDash(value: string): string {
  if (!value) {
    return ui.admin.dash;
  }
  return value;
}

// sortByReleaseDateAsc compara dos estrenos para ordenarlos por FECHA ascendente (del más próximo al
// más lejano). En español: la tabla se lee mejor en orden cronológico. Comparamos las fechas ISO como
// texto, que para el formato "AAAA-MM-DD" coincide con el orden cronológico real (no hace falta parsear
// a Date). Es estable: ante misma fecha, conserva el orden de entrada.
function sortByReleaseDateAsc(left: Release, right: Release): number {
  if (left.releaseDate < right.releaseDate) {
    return -1;
  }
  if (left.releaseDate > right.releaseDate) {
    return 1;
  }
  return 0;
}

// PhaseBadge es el distintivo pequeño "Fase 1" que marca las columnas de CURADURÍA MANUAL.
// En español: la columna Cadenas NO viene de una API confiable; la gobernará
// la futura UI de ingesta de la Fase 1. Esta etiqueta lo señala en el propio encabezado. El "title" y
// el texto explicativo (aria-label vía title) aclaran el porqué para quien pase el cursor o use lector.
function PhaseBadge(): JSX.Element {
  return (
    <span
      className="font-mono ml-2 inline-flex items-center rounded-sm border px-[6px] py-[2px] text-[9px] tracking-[0.08em] whitespace-nowrap text-gold uppercase align-middle"
      title={ui.admin.phaseBadgeTitle}
      style={{
        // Cristal tenue con borde dorado profundo, en línea con el resto del shell (tokens de @theme).
        background: "var(--color-glass)",
        borderColor: "var(--color-gold-deep)",
      }}
    >
      {ui.admin.phaseBadge}
    </span>
  );
}

// HEADER_CELL_CLASS son las clases comunes a TODOS los encabezados de columna (<th scope="col">).
// En español: las extraemos a una constante para no repetir la misma cadena larga en cada encabezado
// (legibilidad y un solo lugar donde ajustar el estilo de los títulos de columna).
const HEADER_CELL_CLASS =
  "font-mono px-4 py-3 text-xs tracking-[0.06em] text-text-muted uppercase whitespace-nowrap";

// HeaderCell dibuja UN encabezado de columna (<th scope="col">) con el estilo común.
// En español: recibe el texto de la columna y, opcionalmente, marca si lleva el distintivo "Fase 1"
// (las columnas de curaduría manual). Centraliza el <th> para que la fila de encabezados se lea limpia.
function HeaderCell({
  label,
  phaseBadge = false,
}: {
  label: string;
  phaseBadge?: boolean;
}): JSX.Element {
  return (
    <th scope="col" className={HEADER_CELL_CLASS}>
      {label}
      {/* Solo las columnas de curaduría manual (hoy únicamente Cadenas) muestran el distintivo. */}
      {phaseBadge ? <PhaseBadge /> : null}
    </th>
  );
}

// AdminHeader es el encabezado propio MINIMAL de la pantalla interna.
// En español: como /admin no usa el Topbar del shell público, aquí va su propio <header> con el título
// de la pantalla y un párrafo en es-MX que explica que es de solo lectura y placeholder de la Fase 1.
function AdminHeader(): JSX.Element {
  return (
    <header className="flex flex-col gap-3">
      {/* Título de la pantalla en tipografía display. */}
      <h1 className="font-display text-2xl font-medium text-text sm:text-3xl">{ui.admin.title}</h1>
      {/* Explicación en es-MX: solo lectura + adelanto de la ingesta de Fase 1. Ancho de lectura cómodo. */}
      <p className="max-w-[680px] text-sm leading-relaxed text-text-muted">{ui.admin.intro}</p>
    </header>
  );
}

// AdminStatePanel dibuja un panel de estado (vacío o error) con su título y su pista en es-MX.
// En español: reutilizamos un mismo panel de "cristal" para los dos estados sin datos (vacío y error),
// cambiando solo los textos. role="status" hace que los lectores de pantalla anuncien el estado al
// renderizarse, cumpliendo la regla de accesibilidad de cubrir siempre los estados.
function AdminStatePanel({ title, hint }: { title: string; hint: string }): JSX.Element {
  return (
    <div
      role="status"
      className="rounded-base border p-6"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <p className="font-display text-lg text-text">{title}</p>
      <p className="mt-2 text-sm text-text-muted">{hint}</p>
    </div>
  );
}

// TmdbCell pinta la celda de la columna TMDB: una estrella, el número y, debajo, la rareza derivada.
// En español: la calificación de TMDB es la base de la "rareza" tipo videojuego. Aquí mostramos el
// valor con una estrella (★) y el nombre del nivel (Legendario/Épico/Raro/Común) pintado con el color
// de su token. Derivamos la rareza con deriveRarity (la misma fuente que usa el resto de la app), a
// partir de ratings.tmdb (0 si falta). El conjunto lleva una etiqueta accesible que une valor y rareza.
function TmdbCell({ release }: { release: Release }): JSX.Element {
  // Tomamos la calificación TMDB de forma segura (proto3 puede traer "ratings" indefinido -> 0).
  const score = release.ratings?.tmdb ?? 0;
  // Derivamos la rareza con la MISMA función canónica que usa la timeline y el detalle.
  const tier = deriveRarity(score);
  // Texto del nivel en es-MX (desde i18n) y color de su token de acento.
  const tierLabel = ui.tiers[tier];
  const tierColor = TIER_TOKEN_VAR[tier];
  // Formateamos el número a un decimal ("8.6"), como en el resto del producto.
  const scoreText = score.toFixed(1);

  return (
    <div
      className="flex flex-col gap-[2px]"
      role="img"
      aria-label={ui.admin.tmdbAria(scoreText, tierLabel)}
    >
      {/* Estrella decorativa + número. role="img" + aria-label hace que el lector anuncie el texto
          compuesto (★ + valor + rareza) en lugar del contenido suelto. La estrella va aria-hidden. */}
      <span className="font-mono whitespace-nowrap text-text">
        <span aria-hidden="true">★</span> {scoreText}
      </span>
      {/* Nombre de la rareza, pintado con el color de su token (oro/violeta/teal/atenuado). */}
      <span
        className="font-mono text-[10px] tracking-[0.06em] uppercase"
        style={{ color: tierColor }}
      >
        {tierLabel}
      </span>
    </div>
  );
}

// AdminTable dibuja la tabla SEMÁNTICA de solo lectura con una fila por estreno.
// En español: encierra la tabla en una región scrolleable horizontal (overflow-x) para que en pantallas
// estrechas no se rompa el layout y se pueda desplazar —incluso por teclado, gracias a tabIndex y al
// foco visible de globals.css—. La tabla usa <caption>, <thead> con <th scope="col"> y <tbody> con una
// fila por estreno, que es la estructura accesible correcta para datos tabulares.
function AdminTable({ releases }: { releases: Release[] }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {/*
        Región scrolleable: role="region" + aria-label la anuncian como zona navegable, y tabIndex={0}
        permite enfocarla y desplazarla con el teclado (flechas) cuando la tabla es más ancha que la
        pantalla. El foco visible lo aporta globals.css. El borde y el fondo de cristal vienen de los
        tokens del proyecto.
      */}
      <div
        role="region"
        aria-label={ui.admin.scrollRegionLabel}
        tabIndex={0}
        className="overflow-x-auto rounded-base border"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <table className="w-full border-collapse text-sm">
          {/* caption: describe la tabla para lectores de pantalla (visible y semántico). */}
          <caption className="px-4 pt-4 pb-3 text-left text-xs text-text-subtle">
            {ui.admin.tableCaption}
          </caption>

          {/* thead: encabezados de columna. scope="col" asocia cada <th> con su columna (accesibilidad).
              La columna de CURADURÍA MANUAL (Cadenas) lleva phaseBadge.

              Aquí había otras dos columnas, «Doblaje» y «Subtítulos», que se han retirado con los campos
              del contrato que las alimentaban. Enseñaban un guion en las 422 filas desde el primer día,
              porque nadie rellenaba esos datos y —comprobado— no hay ninguna fuente de la que sacarlos.
              Dos columnas que solo pueden estar vacías no informan de nada: estorban la lectura de la
              tabla y hacen creer que falta un proceso de carga que en realidad no puede existir. */}
          <thead>
            <tr className="text-left" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <HeaderCell label={ui.admin.columns.title} />
              <HeaderCell label={ui.admin.columns.type} />
              <HeaderCell label={ui.admin.columns.category} />
              <HeaderCell label={ui.admin.columns.date} />
              <HeaderCell label={ui.admin.columns.tmdb} />
              <HeaderCell label={ui.admin.columns.imdb} />
              <HeaderCell label={ui.admin.columns.rottenTomatoes} />
              <HeaderCell label={ui.admin.columns.platforms} />
              <HeaderCell label={ui.admin.columns.networks} phaseBadge />
              <HeaderCell label={ui.admin.columns.cast} />
            </tr>
          </thead>

          {/* tbody: una fila por estreno. Cada celda muestra un dato del modelo, degradando con — si falta. */}
          <tbody>
            {releases.map((release) => {
              // Listas de disponibilidad de forma segura (proto3 puede traer "availability" indefinido).
              const platforms = release.availability?.platforms ?? [];
              const networks = release.availability?.networks ?? [];
              // Calificaciones de OMDb (texto opcional).
              const imdb = release.ratings?.imdb ?? "";
              const rottenTomatoes = release.ratings?.rottenTomatoes ?? "";

              return (
                <tr
                  key={release.id}
                  className="align-top"
                  style={{ borderTop: "1px solid var(--color-border-soft)" }}
                >
                  {/* Título: el dato más prominente; tipografía de interfaz. scope="row" lo marca como
                      encabezado de la fila (accesibilidad: asocia el resto de celdas a este título). */}
                  <th scope="row" className="px-4 py-3 text-left font-medium text-text">
                    {release.title}
                  </th>
                  {/* Tipo: Película / Serie. */}
                  <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                    {typeLabel(release.type)}
                  </td>
                  {/* Categoría: Cine / Streaming / Cadenas (vía CATEGORY_META). */}
                  <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                    {categoryLabel(release)}
                  </td>
                  {/* Fecha: formateada es-MX en UTC ("15 jun 2026"). */}
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-text-muted">
                    {formatReleaseDateMx(release.releaseDate)}
                  </td>
                  {/* TMDB: estrella + número + rareza derivada con su color de token. */}
                  <td className="px-4 py-3">
                    <TmdbCell release={release} />
                  </td>
                  {/* IMDb (de OMDb, opcional). */}
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-text-muted">
                    {textOrDash(imdb)}
                  </td>
                  {/* Rotten Tomatoes (de OMDb, opcional). */}
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-text-muted">
                    {textOrDash(rottenTomatoes)}
                  </td>
                  {/* Plataformas de streaming (lista unida por coma). */}
                  <td className="px-4 py-3 text-text-muted">{joinOrDash(platforms)}</td>
                  {/* Cadenas (curaduría manual): lista unida por coma. */}
                  <td className="px-4 py-3 text-text-muted">{joinOrDash(networks)}</td>
                  {/* Reparto: solo el CONTEO de integrantes (la ficha completa vive en el detalle). */}
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-text-muted">
                    {/* role="img" + aria-label hace que el lector anuncie "N integrantes del reparto"
                        en lugar de un número suelto (el aria-label en el <td> no se anuncia fiable). */}
                    <span role="img" aria-label={ui.admin.castCountAria(release.cast.length)}>
                      {release.cast.length}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Leyenda corta bajo la tabla: explica qué significa el distintivo "Fase 1" de algunas columnas. */}
      <p className="max-w-[760px] text-xs leading-relaxed text-text-subtle">{ui.admin.legend}</p>
    </div>
  );
}

// AdminPage es el Server Component que orquesta los datos y decide qué estado mostrar.
// En español: pide TODOS los meses del seed en paralelo (Promise.all), combina lo que llegó, decide el
// estado (error / vacío / datos) y dibuja el encabezado propio + el contenido correspondiente. Todo
// dentro de un <main> con ancho amplio (la tabla es ancha) y espaciado generoso.
export default async function AdminPage(): Promise<JSX.Element | null> {
  // La comprobación va ANTES de pedir el catálogo: si el marco ya cerró el panel,
  // esta página no debe ir a buscar las fichas.
  if ((await currentAdminDecision()) !== "open") {
    return null;
  }

  // El catálogo de la ventana de meses vigente, por el cargador compartido (ver lib/connect/catalog):
  // pide todos los meses a la vez, nunca lanza, y dice cuántos de ellos no respondieron. Es la
  // consulta CARA (fichas completas), y aquí está justificada: esta pantalla interna de revisión
  // existe justamente para mirar el contenido entero de cada ficha.
  const catalog = await loadCatalogWindowDetails();

  // Tratamos como error "duro" solo cuando TODOS los meses fallaron (no hay absolutamente nada que
  // mostrar). Si al menos uno respondió, seguimos al render normal con los datos que sí llegaron.
  const everyMonthFailed = catalog.failedMonthCount === catalog.monthCount;

  // Los estrenos de todos los meses que respondieron, ordenados por fecha ascendente (cronológico).
  const releases: Release[] = [...catalog.items].sort(sortByReleaseDateAsc);

  return (
    // <main> de la pantalla interna: ancho amplio (la tabla es ancha) y espaciado cómodo.
    <main className="font-ui mx-auto flex max-w-[1280px] flex-col gap-8 px-4 py-10 sm:px-8 sm:py-14">
      {/* Encabezado propio (no usa el Topbar público): título + explicación de "solo lectura / Fase 1". */}
      <AdminHeader />

      {/*
        Estados, en orden de prioridad:
          1) ERROR duro (ambos meses fallaron): no hay nada que mostrar -> panel de error.
          2) VACÍO (el seed no trajo estrenos): el backend respondió pero sin datos -> panel vacío.
          3) DATOS: al menos un estreno -> la tabla de solo lectura.
      */}
      {everyMonthFailed ? (
        <AdminStatePanel title={ui.admin.errorTitle} hint={ui.admin.errorHint} />
      ) : releases.length === 0 ? (
        <AdminStatePanel title={ui.admin.emptyTitle} hint={ui.admin.emptyHint} />
      ) : (
        <AdminTable releases={releases} />
      )}
    </main>
  );
}
