// Archivo: (public)/persona/[id]/page.tsx — La página de una persona (deep-link compartible).
//
// En español: se llega aquí pulsando el nombre de un actor o de un director en la ficha de un título.
// El identificador de la dirección es el NÚMERO DE IDENTIDAD de esa persona en TMDB, que el catálogo
// ya trae en cada crédito. Ese número es lo que hace que la página sea fiable: identificar a alguien
// por su nombre escrito fundía a dos personas homónimas en una y partía en dos a quien viniera
// escrito de dos maneras.
//
// POR QUÉ NO HACE FALTA NINGUNA OPERACIÓN NUEVA DEL SERVIDOR: toda la información que esta página
// enseña ya está dentro del catálogo que el producto pide de todas formas. Se recorre la ventana de
// meses vigente y se reúne lo de esa persona. Añadir un RPC habría sido inventar trabajo: el dato ya
// viaja. Lo que sí exigiría uno nuevo es la filmografía COMPLETA de la persona (fuera de estos
// meses), y por eso esa parte NO se hace y la página lo dice.
//
// Es un Server Component: pide los datos por el cargador compartido loadCatalogWindowDetails, que nunca
// lanza. Necesita las fichas COMPLETAS y no los resúmenes: de ellas salen el reparto y el equipo con su
// número de identidad, que no viaja en el resumen. Sin backend, el catálogo llega vacío y la página
// enseña su estado de "persona no encontrada".

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PersonDetail } from "@/components/PersonDetail";
import { loadCatalogWindowDetails } from "@/lib/connect/catalog";
import { collaboratorsOf, findPersonInCatalog, pickHighlightRelease } from "@/lib/people";
import { siteUrl } from "@/lib/site-url";
import { ui } from "@/lib/i18n";

// PageParams describe los parámetros dinámicos de esta ruta.
// En español: "[id]" en la carpeta significa que la dirección trae el número de la persona; Next 16
// lo entrega dentro de una promesa, por eso el tipo es Promise.
type PageParams = {
  params: Promise<{ id: string }>;
};

// Render dinámico: la página consulta el catálogo en cada visita, igual que la ficha de un título.
export const dynamic = "force-dynamic";

// Fichas COMPLETAS, no resúmenes: esta página se construye buscando a una persona dentro del reparto
// y del equipo de cada estreno, y esos créditos solo viajan en la ficha completa. El cargador vive en
// lib/connect/catalog y lo comparten las cuatro pantallas que recorren el catálogo entero.

// parsePersonId convierte el trozo de la dirección en un número de identidad utilizable.
// En español: cualquier cosa que no sea un número entero positivo se trata como "no encontrada". Es
// lo correcto: la dirección la puede escribir cualquiera a mano.
function parsePersonId(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

// generateMetadata arma lo que ven los buscadores y las redes al compartir esta dirección.
export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  const personId = parsePersonId(id);
  const catalog = (await loadCatalogWindowDetails()).items;
  const person = personId === 0 ? null : findPersonInCatalog(catalog, personId);

  if (person === null) {
    return {
      title: `${ui.person.notFoundTitle} · ${ui.brand.full}`,
      description: ui.person.notFoundHint,
      robots: { index: false, follow: true },
    };
  }

  const pageTitle = `${person.name} · ${ui.brand.full}`;
  const description = ui.person.inCatalogCount(person.credits.length);
  const canonicalUrl = `${siteUrl()}/persona/${person.personTmdbId}`;

  return {
    title: pageTitle,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "profile",
      title: pageTitle,
      description,
      url: canonicalUrl,
      siteName: ui.brand.full,
      locale: "es_MX",
      // La foto solo se declara si existe de verdad: una tarjeta sin imagen es mejor que una con una
      // imagen rota.
      images: person.photoUrl ? [{ url: person.photoUrl, alt: person.name }] : [],
    },
  };
}

export default async function PersonaPage({ params }: PageParams) {
  const { id } = await params;
  const personId = parsePersonId(id);
  const catalog = (await loadCatalogWindowDetails()).items;
  const person = personId === 0 ? null : findPersonInCatalog(catalog, personId);

  // No encontrada: es un desenlace NORMAL, no un error. El catálogo cubre unos meses y un enlace
  // viejo puede apuntar a alguien cuyos títulos ya salieron de la ventana.
  //
  // notFound() hace DOS cosas a la vez, y la segunda es la que faltaba: dibuja la pantalla de
  // "no encontrada" (el archivo not-found.tsx de al lado, con el mismo texto y el mismo camino de
  // vuelta) y hace que el servidor responda un 404 de verdad. Antes respondía "todo correcto"
  // mientras enseñaba que no había nada: para una persona daba igual, pero un buscador guardaba esa
  // dirección como si fuera una página buena y ningún revisor de enlaces rotos la detectaba.
  if (person === null) {
    notFound();
  }

  const collaborators = collaboratorsOf(catalog, person);
  const highlight = pickHighlightRelease(person);

  return (
    <main className="pd-main font-ui">
      <Link href="/" className="pd-back font-mono">
        <span aria-hidden="true">‹</span> {ui.person.back}
      </Link>
      <PersonDetail person={person} collaborators={collaborators} highlight={highlight} />
    </main>
  );
}
