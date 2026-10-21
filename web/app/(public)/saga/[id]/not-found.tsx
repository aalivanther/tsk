// Archivo: (public)/saga/[id]/not-found.tsx — Lo que se ve cuando esa saga no está en el catálogo.
//
// Mismo motivo que en la página de una persona: antes este estado se dibujaba desde dentro de la
// página y el servidor respondía "todo correcto" (un 200) mientras la pantalla decía que no había
// nada. Ahora la página llama a notFound(), Next dibuja este archivo y la respuesta es un 404 de
// verdad. El texto y el camino de vuelta no cambian.

import Link from "next/link";

import { ui } from "@/lib/i18n";

// SagaNotFound dibuja el estado "no encontrada" con su camino de vuelta.
export default function SagaNotFound() {
  return (
    <main className="sg-main is-centered font-ui">
      <Link href="/" className="sg-back font-mono">
        <span aria-hidden="true">‹</span> {ui.saga.back}
      </Link>
      <h1 className="sg-name font-display">{ui.saga.notFoundTitle}</h1>
      <p className="sg-section-hint">{ui.saga.notFoundHint}</p>
    </main>
  );
}
