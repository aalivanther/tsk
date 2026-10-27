// Archivo: BackToHomeLink.tsx — El enlace de "volver al inicio" de la ficha de un estreno.
//
// En español: vive en su propio archivo porque lo usan DOS pantallas —la ficha de un título y su
// estado de "no encontrado", que desde que la respuesta es un 404 de verdad son dos archivos
// distintos—. Escrito dos veces acabarían divergiendo, y este enlace es justo lo que impide que
// cualquiera de las dos sea un callejón sin salida: no es un detalle que se pueda dejar suelto.
//
// Es un enlace de verdad, navegable con el teclado y con el foco visible que aporta globals.css.

import Link from "next/link";

import { ui } from "@/lib/i18n";

// BackToHomeLink dibuja el enlace de regreso a la portada.
export function BackToHomeLink() {
  return (
    <Link
      href="/"
      prefetch={false}
      data-intent-prefetch="/"
      className="font-mono inline-flex w-fit items-center gap-2 text-xs tracking-[0.08em] text-gold no-underline transition-colors hover:text-gold-bright"
    >
      {/* La flecha "‹" es decorativa; el texto es el que comunica la acción de volver. */}
      <span aria-hidden="true">‹</span>
      {ui.detail.back}
    </Link>
  );
}
