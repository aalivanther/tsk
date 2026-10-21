"use client";

// Archivo: error.tsx — MURO DE CONTENCIÓN de errores de la app (error boundary de Next App Router).
//
// En español: si cualquier componente de una ruta revienta en tiempo de ejecución, Next monta este
// componente EN LUGAR del árbol roto. Antes no existía: un error de render dejaba la pantalla en
// blanco sin explicación (pase de robustez del sprint de cierre). Aquí mostramos un aviso claro en
// es-MX y un botón "Reintentar" que vuelve a montar el árbol (la función reset que entrega Next).
// El error completo se reporta a la consola para diagnóstico (no se muestra al usuario: el detalle
// técnico no le sirve y podría confundir).

import { useEffect } from "react";

import { ui } from "@/lib/i18n";

// ErrorPageProps son las props que Next entrega a un error boundary de ruta.
type ErrorPageProps = {
  // error es el fallo capturado (con digest en producción para correlacionar con logs del servidor).
  error: Error & { digest?: string };
  // reset vuelve a montar el árbol de la ruta que falló (el "reintentar").
  reset: () => void;
};

// ErrorPage dibuja el aviso de error con su acción de reintento.
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  // Reportamos el fallo a la consola al montar (diagnóstico del desarrollador, no del usuario).
  useEffect(() => {
    console.error("route error boundary captured:", error);
  }, [error]);

  return (
    <main className="font-ui mx-auto flex min-h-screen max-w-[560px] flex-col justify-center gap-4 px-6 py-16">
      {/* role="alert" hace que los lectores de pantalla anuncien el problema de inmediato. */}
      <div
        role="alert"
        className="rounded-base border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h1 className="font-display text-xl text-text">{ui.appError.title}</h1>
        <p className="mt-2 text-sm leading-[1.6] text-text-muted">{ui.appError.hint}</p>
        <button
          type="button"
          onClick={reset}
          className="font-mono mt-4 inline-flex w-fit rounded-sm border border-gold-deep px-4 py-2 text-xs tracking-[0.08em] text-gold uppercase transition-colors hover:text-gold-bright"
          style={{ background: "var(--color-glass)" }}
        >
          {ui.appError.retry}
        </button>
      </div>
    </main>
  );
}
