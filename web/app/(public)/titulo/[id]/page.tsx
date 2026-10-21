// Archivo: (public)/titulo/[id]/page.tsx — Detalle de un estreno (deep-link).
//
// En español: esta es la página que se abre al entrar a una dirección como
// "/titulo/abc-123". Sirve para que cada estreno tenga su propia URL compartible
// (deep-link). Desde el S7 el camino feliz muestra el DETALLE RICO completo
// (tráiler, referencias, sinopsis, galería, dónde verlo, saga, reparto, doblaje,
// staff e idiomas) a través del componente compartido ReleaseDetail. Si el id no
// existe o el backend no responde, muestra un estado claro de "no encontrado".
//
// El detalle rico vive en UN solo componente (ReleaseDetail) que también usa el
// modal del flujo de 3 niveles: así la ficha se ve idéntica al abrirla por la
// línea de tiempo o por su enlace directo, sin duplicar código.
//
// Es un Server Component asíncrono. En Next.js 16, los parámetros de ruta llegan
// como una promesa: por eso se hace "await params" antes de usar el id. La
// llamada al backend va por el helper "getReleaseSafe", que NUNCA lanza: si algo
// falla o no hay datos, devuelve { release: null, error } y la página dibuja el
// estado "no encontrado" sin romperse (igual que la home, esto permite que
// "next build" pase sin backend levantado).

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackToHomeLink } from "@/components/BackToHomeLink";
import { DetailAmbient } from "@/components/DetailAmbient";
import { ReleaseDetail } from "@/components/ReleaseDetail";
import { getReleaseSafe, listReleasesSafe } from "@/lib/connect/catalog";
import { catalogWindow, findConnections, isUpcoming, resolveDemoToday } from "@/lib/timeline";
import { siteUrl } from "@/lib/site-url";
import { ui } from "@/lib/i18n";

// PageParams describe los parámetros dinámicos de esta ruta.
// En español: "[id]" en la carpeta significa que la URL trae un id; Next 16 lo
// entrega dentro de una promesa, por eso el tipo es Promise<{ id: string }>.
type PageParams = {
  params: Promise<{ id: string }>;
};

// MAX_SOCIAL_DESCRIPTION_CHARS es el largo máximo de la descripción de la tarjeta al compartir.
// En español: las redes sociales recortan las descripciones largas y dejan un corte feo a mitad de
// palabra. Recortando nosotros en un límite conocido (y en el último espacio antes del corte), la
// vista previa termina en una palabra completa seguida de puntos suspensivos.
const MAX_SOCIAL_DESCRIPTION_CHARS = 200;

// trimForSocial recorta un texto al largo máximo sin partir palabras por la mitad.
function trimForSocial(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= MAX_SOCIAL_DESCRIPTION_CHARS) {
    return clean;
  }
  const cut = clean.slice(0, MAX_SOCIAL_DESCRIPTION_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  // Si no hubiera ningún espacio (una sola palabra larguísima), se corta en seco: es preferible a
  // devolver el texto entero sin recortar.
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

// generateMetadata arma los datos que ven los BUSCADORES y las REDES SOCIALES de este título.
// En español: cuando alguien pega el enlace de un estreno en un chat o en una red, la plataforma no
// ejecuta la página: lee estas etiquetas para armar la tarjeta de vista previa (título, descripción e
// imagen). Sin ellas, el enlace aparece como una línea gris de texto y nadie lo abre. Aquí:
//   - El título es el del estreno, seguido del nombre del producto.
//   - La descripción es su sinopsis real (recortada); si no hay, se arma una con la fecha de estreno.
//     Nunca se inventa un texto: si no hay ningún dato, se usa una frase genérica del catálogo i18n.
//   - La imagen es el BACKDROP del título (la foto ancha de la película), que es la que mejor se ve
//     en una tarjeta apaisada. Si el título no trae imagen, sencillamente no se declara ninguna.
// Next.js llama a esta función en el servidor antes de renderizar la página. La consulta va por el
// mismo helper seguro que usa la página, así que un backend caído no rompe nada: se devuelve el
// título de "no encontrado" y se pide a los buscadores que no indexen esa dirección.
export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  const { release } = await getReleaseSafe(id);

  // Sin estreno (id inexistente o backend caído): título claro y "noindex", porque no hay contenido
  // real que ofrecer a un buscador en esa dirección.
  if (release === null) {
    return {
      title: ui.seo.notFoundTitle(),
      description: ui.detail.notFoundHint,
      robots: { index: false, follow: true },
    };
  }

  const pageTitle = ui.seo.detailTitle(release.title);
  // Descripción: la sinopsis real si existe; si no, una frase armada con la fecha; si tampoco hay
  // fecha, la frase genérica (siempre información verdadera, nunca inventada).
  const description =
    release.overview !== ""
      ? trimForSocial(release.overview)
      : release.releaseDate !== ""
        ? ui.seo.detailDescription(release.title, release.releaseDate, "")
        : ui.seo.detailDescriptionNoDate(release.title);

  const canonicalUrl = `${siteUrl()}/titulo/${release.id}`;

  return {
    title: pageTitle,
    description,
    // alternates.canonical declara cuál es la dirección "oficial" de esta ficha, para que un buscador
    // no trate como páginas distintas la misma ficha alcanzada por rutas o parámetros diferentes.
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "video.movie",
      title: pageTitle,
      description,
      url: canonicalUrl,
      siteName: ui.brand.full,
      locale: "es_MX",
      // La imagen solo se declara si el título trae backdrop REAL: una tarjeta sin imagen es mejor
      // que una tarjeta con una imagen rota.
      images: release.backdropUrl
        ? [{ url: release.backdropUrl, alt: ui.seo.imageAlt(release.title) }]
        : [],
    },
    twitter: {
      // "summary_large_image" es la tarjeta apaisada con imagen grande: la que luce un backdrop.
      card: release.backdropUrl ? "summary_large_image" : "summary",
      title: pageTitle,
      description,
      images: release.backdropUrl ? [release.backdropUrl] : [],
    },
  };
}

// Page es el Server Component que dibuja el detalle de un estreno.
// En español: recibe los parámetros de la ruta, espera (await) a obtener el id,
// pide el estreno al backend de forma segura y muestra su detalle mínimo o el
// estado de "no encontrado".
// dynamic = "force-dynamic": la ficha se construye en cada visita, con el mismo razonamiento que la
// home — el ahorro vive en la caché de datos, no en guardar la página hecha. Ver app/(public)/page.tsx.
export const dynamic = "force-dynamic";

export default async function Page({ params }: PageParams) {
  // En Next 16 los params son asíncronos: se resuelven con await antes de usar.
  const { id } = await params;

  // Pedimos el estreno por el helper seguro: devuelve { release, summary, error } y nunca lanza. Si
  // no existe o el backend falla, "release" viene en null. El "summary" es ese mismo estreno en su
  // forma ligera: lo trae el servidor ya calculado y de él salen los datos deducidos (nombre de la
  // saga, dirección y reparto principal) con los que se buscan las conexiones más abajo.
  const { release, summary } = await getReleaseSafe(id);

  // Si no hay estreno (id inexistente o backend caído), mostramos el estado "no encontrado" con un
  // camino claro de regreso a la portada.
  //
  // notFound() dibuja el archivo not-found.tsx de al lado —mismo texto, mismo enlace de vuelta— y
  // ADEMÁS hace que el servidor responda un 404 de verdad. Antes respondía "todo correcto" mientras
  // la pantalla decía justo lo contrario, así que un buscador guardaba la dirección como buena.
  if (release === null) {
    notFound();
  }

  // Marcador HOY (demo o fecha real): alimenta "Próximamente", el calendario de emisión y la VENTANA
  // de meses del catálogo que pedimos abajo.
  const today = resolveDemoToday(process.env.DEMO_TODAY);

  // Catálogo de la ventana vigente para derivar las CONEXIONES del estreno (misma saga / mismo director
  // / mismo reparto / por género) contra todo el catálogo, no solo contra él mismo. Cada mes va por el
  // helper seguro (nunca lanza); combinamos lo que llegue y calculamos las conexiones contra eso.
  //
  // Aquí se piden RESÚMENES, no fichas completas, y con eso basta: para emparejar títulos hacen falta
  // el nombre de la saga, los nombres de dirección y los del reparto principal, y el servidor ya los
  // manda deducidos dentro de cada resumen. Pedir las fichas enteras de tres meses para acabar usando
  // un puñado de nombres era justo el desperdicio que este trabajo eliminó.
  const monthResults = await Promise.all(
    catalogWindow(today).map((month) => listReleasesSafe(month.year, month.month)),
  );
  const catalog = monthResults.flatMap((result) => result.summaries);
  // Sin resumen no hay con qué emparejar (solo pasa si el backend no lo mandó): la ficha se enseña
  // igual y la sección de conexiones sencillamente no aparece, que es su degradado de siempre.
  const related = summary !== null ? findConnections(summary, catalog) : [];

  // Camino feliz: hay estreno. Mostramos el DETALLE RICO completo (ReleaseDetail),
  // el mismo componente que usa el modal del flujo de 3 niveles. La página solo
  // aporta el marco exterior: ancho de lectura, espaciado y el enlace de volver.
  return (
    <>
      {/*
        Ambiente de fondo: el backdrop del estreno, oscurecido y desenfocado, FIJO detrás de toda la ficha
        (como el fondo global del home). Convierte el vacío oscuro de los lados en la "atmósfera" de la
        película, dando cohesión cinematográfica. Decorativo (aria-hidden). Solo si hay backdrop real.
      */}
      {release.backdropUrl ? <DetailAmbient backdropUrl={release.backdropUrl} /> : null}

      {/* <main> con un ancho de lectura cómodo y espaciado generoso. */}
      <main className="td-main font-ui relative z-[1] mx-auto flex max-w-[620px] flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16">
        {/* Enlace de volver al inicio, primero en el orden de tabulación. */}
        <BackToHomeLink />

        {/*
        Detalle rico del estreno. Recibe el estreno completo y se encarga de TODAS
        las secciones (tráiler, referencias, sinopsis, galería, dónde verlo, saga,
        reparto, doblaje, staff e idiomas), degradando con elegancia las vacías.
      */}
        <ReleaseDetail
          release={release}
          related={related}
          upcoming={summary !== null ? isUpcoming(summary, today) : false}
          today={today}
          catalog={catalog}
          // Aquí la ficha OCUPA la pantalla, así que su título es el encabezado principal de la
          // página. Esta pantalla no tenía ninguno: quien navegaba escuchando aterrizaba en una
          // dirección sin nombre y sin forma de saltar al contenido. Dentro de una ventana sobre la
          // línea de tiempo NO se pasa, porque allí el encabezado principal ya es el de la portada.
          isPageHeading
        />
      </main>
    </>
  );
}
