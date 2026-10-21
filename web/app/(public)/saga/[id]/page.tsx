// Archivo: (public)/saga/[id]/page.tsx — La página de una saga (deep-link compartible).
//
// En español: se llega aquí desde el bloque de saga de la ficha de un título. El identificador de la
// dirección se deriva del nombre de la saga (ver lib/saga: por qué se hace así y qué se comprobó
// para que dos sagas distintas no compartan dirección).
//
// POR QUÉ NO HACE FALTA NINGUNA OPERACIÓN NUEVA DEL SERVIDOR: las entradas de una saga ya viajan
// dentro de la ficha de cada estreno. Se recorre la ventana de meses vigente, se junta la saga y se
// empareja cada entrada con su estreno del catálogo cuando existe. El dato ya estaba; solo faltaba
// una página que lo enseñara.
//
// Es un Server Component: pide los datos por el cargador compartido loadCatalogWindowDetails, que nunca
// lanza. Necesita las fichas COMPLETAS y no los resúmenes: las entradas de una saga —con su carátula,
// su año y su sinopsis— viven dentro de la ficha; el resumen solo lleva el NOMBRE de la saga.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SagaDetail } from "@/components/SagaDetail";
import { loadCatalogWindowDetails } from "@/lib/connect/catalog";
import { findSagaBySlug, pickSagaHighlight, pickSagaOrigin } from "@/lib/saga";
import { siteUrl } from "@/lib/site-url";
import { ui } from "@/lib/i18n";

// PageParams describe los parámetros dinámicos de esta ruta.
//
// "desde" no forma parte de la dirección de la saga: es una pista OPCIONAL que la ficha añade al
// enlace para decir de qué título se viene. Sirve para ofrecer la vuelta exacta a ese título. Si no
// llega —porque alguien compartió el enlace pelado— la página sigue funcionando igual y la vuelta
// lleva al título de este catálogo que declara pertenecer a la saga (ver pickSagaOrigin).
type PageParams = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ desde?: string }>;
};

// Render dinámico: la página consulta el catálogo en cada visita.
export const dynamic = "force-dynamic";

// generateMetadata arma lo que ven los buscadores y las redes al compartir esta dirección.
export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  const saga = findSagaBySlug((await loadCatalogWindowDetails()).items, id);

  if (saga === null) {
    return {
      title: `${ui.saga.notFoundTitle} · ${ui.brand.full}`,
      description: ui.saga.notFoundHint,
      robots: { index: false, follow: true },
    };
  }

  const pageTitle = `${saga.name} · ${ui.brand.full}`;
  const description = ui.saga.entriesCount(saga.entries.length);
  const canonicalUrl = `${siteUrl()}/saga/${saga.slug}`;
  // La imagen de la tarjeta: el fondo ancho del primer título de la saga que esté en el catálogo.
  // Si ninguno lo tiene, no se declara ninguna: mejor sin imagen que con una rota.
  const socialImage = saga.owners.find((release) => release.backdropUrl !== "")?.backdropUrl ?? "";

  return {
    title: pageTitle,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "website",
      title: pageTitle,
      description,
      url: canonicalUrl,
      siteName: ui.brand.full,
      locale: "es_MX",
      images: socialImage !== "" ? [{ url: socialImage, alt: saga.name }] : [],
    },
  };
}

export default async function SagaPage({ params, searchParams }: PageParams) {
  const { id } = await params;
  const { desde } = await searchParams;
  const catalog = (await loadCatalogWindowDetails()).items;
  const saga = findSagaBySlug(catalog, id);

  // No encontrada: desenlace NORMAL. El catálogo cubre unos meses y un enlace viejo puede apuntar a
  // una saga cuyo título ya salió de la ventana.
  //
  // notFound() dibuja la pantalla de al lado (not-found.tsx, mismo texto y mismo camino de vuelta) y
  // ADEMÁS hace que el servidor responda un 404 de verdad, en vez del "todo correcto" que respondía
  // antes mientras la pantalla decía justo lo contrario.
  if (saga === null) {
    notFound();
  }

  return (
    <main className="sg-main font-ui">
      <Link href="/" className="sg-back font-mono">
        <span aria-hidden="true">‹</span> {ui.saga.back}
      </Link>
      {/*
        origin es el título de este catálogo al que devuelve la salida de esta página: el que se
        indicó en el enlace si sigue existiendo, y si no, el que declara pertenecer a esta saga.
        Es lo que impide que esta pantalla sea un callejón sin salida (ver pickSagaOrigin).
      */}
      <SagaDetail
        saga={saga}
        highlight={pickSagaHighlight(saga)}
        origin={pickSagaOrigin(saga, desde ?? "")}
      />
    </main>
  );
}
