"use client";

// Archivo: IntentPrefetch.tsx — Adelanta una página solo cuando hay intención de abrirla.
//
// En español: por defecto, cada <Link> visible en pantalla descarga por adelantado los datos de la
// página a la que apunta. Para los enlaces de navegación (inicio, perfil) eso significaba que casi
// cada pantalla de la app bajaba al cargar los datos de otra —la portada o el perfil, unos 145 KB
// comprimidos cada una— aunque nadie fuera a abrirla, compitiendo con lo que la pantalla sí
// necesitaba. Esos enlaces llevan ahora prefetch={false} y la marca data-intent-prefetch con su
// destino, y este componente (uno solo, en el layout raíz) los adelanta cuando el puntero se les
// acerca, el dedo los toca o reciben el foco: justo antes del clic, que es cuando sirve.
//
// Es un único oyente para toda la página, y no un envoltorio de <Link>, a propósito: así cada
// pantalla sigue usando <Link> tal cual, y no se cuela en ellas el JavaScript de otras.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// INTENT_ATTRIBUTE es la marca que llevan los enlaces a adelantar; su valor es el destino SIN el
// prefijo de la ruta base (lo que espera router.prefetch).
const INTENT_SELECTOR = "a[data-intent-prefetch]";

export function IntentPrefetch() {
  const router = useRouter();

  useEffect(() => {
    const onIntent = (event: Event) => {
      const link =
        event.target instanceof Element ? event.target.closest<HTMLElement>(INTENT_SELECTOR) : null;
      const href = link?.dataset.intentPrefetch;
      if (href !== undefined && href !== "") {
        router.prefetch(href);
      }
    };
    const options = { capture: true, passive: true } as const;
    document.addEventListener("pointerover", onIntent, options);
    document.addEventListener("touchstart", onIntent, options);
    document.addEventListener("focusin", onIntent, options);
    return () => {
      document.removeEventListener("pointerover", onIntent, options);
      document.removeEventListener("touchstart", onIntent, options);
      document.removeEventListener("focusin", onIntent, options);
    };
  }, [router]);

  return null;
}
