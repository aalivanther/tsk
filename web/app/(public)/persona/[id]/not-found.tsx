// Archivo: (public)/persona/[id]/not-found.tsx — Lo que se ve cuando esa persona no está en el catálogo.
//
// POR QUÉ ESTE ARCHIVO EXISTE, en español: antes esta pantalla se dibujaba desde dentro de la página,
// y eso tenía una consecuencia invisible pero seria — el servidor respondía "todo correcto" (un 200)
// mientras enseñaba un texto que decía justo lo contrario. Para una persona no cambia nada; para todo
// lo que lee la web sin ojos sí: un buscador la trata como una página válida y la guarda, y una
// herramienta que revisa enlaces rotos no ve ninguno. La intención ya estaba escrita —la página pedía
// no ser indexada—, pero el código de respuesta la desmentía.
//
// Ahora la página llama a notFound() y Next dibuja ESTE archivo devolviendo un 404 de verdad. El texto
// y el camino de vuelta son exactamente los mismos que antes: lo único que cambia es que ahora la
// respuesta y la pantalla dicen lo mismo.

import Link from "next/link";

import { ui } from "@/lib/i18n";

// PersonaNotFound dibuja el estado "no encontrada" con su camino de vuelta.
export default function PersonaNotFound() {
  return (
    <main className="pd-main is-centered font-ui">
      {/* El enlace de vuelta va primero en el orden de tabulación: nunca un callejón sin salida. */}
      <Link href="/" className="pd-back font-mono">
        <span aria-hidden="true">‹</span> {ui.person.back}
      </Link>
      <h1 className="pd-name font-display">{ui.person.notFoundTitle}</h1>
      <p className="pd-section-hint">{ui.person.notFoundHint}</p>
    </main>
  );
}
