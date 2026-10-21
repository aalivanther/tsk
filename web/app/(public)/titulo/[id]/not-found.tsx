// Archivo: (public)/titulo/[id]/not-found.tsx — Lo que se ve cuando ese estreno no existe.
//
// POR QUÉ ESTÁ AQUÍ Y NO DENTRO DE LA PÁGINA, en español: antes este estado se dibujaba desde dentro
// de la ficha, y el servidor respondía "todo correcto" (un 200) mientras la pantalla decía que no
// había encontrado nada. Para quien mira la pantalla no cambia nada; para todo lo que lee la web sin
// ojos, sí: un buscador guarda esa dirección como si fuera una página buena y ningún revisor de
// enlaces rotos la detecta. Ahora la ficha llama a notFound(), Next dibuja este archivo y la
// respuesta es un 404 de verdad.

import type { Metadata } from "next";

import { BackToHomeLink } from "@/components/BackToHomeLink";
import { ui } from "@/lib/i18n";

// metadata pide a los buscadores que no guarden esta dirección: no hay contenido que ofrecer en ella.
export const metadata: Metadata = {
  title: ui.seo.notFoundTitle(),
  description: ui.detail.notFoundHint,
  robots: { index: false, follow: true },
};

// TituloNotFound dibuja el estado "no encontrado" con su camino claro de regreso.
export default function TituloNotFound() {
  return (
    <main className="td-main font-ui mx-auto flex max-w-[680px] flex-col justify-center gap-5 px-6 py-16">
      {/* El enlace de vuelta va primero en el orden de tabulación. */}
      <BackToHomeLink />
      <h1 className="font-display text-2xl font-medium text-text">{ui.detail.notFoundTitle}</h1>
      <p className="text-sm text-text-muted">{ui.detail.notFoundHint}</p>
    </main>
  );
}
