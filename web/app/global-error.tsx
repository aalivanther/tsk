"use client";

// Archivo: global-error.tsx — Último muro de contención: errores del LAYOUT RAÍZ (error boundary global).
//
// En español: error.tsx cubre los fallos DENTRO de una ruta, pero si revienta el propio layout raíz
// (fuentes, providers), Next necesita este boundary GLOBAL, que debe dibujar su PROPIO <html> y <body>
// (el layout roto no está disponible). Es deliberadamente austero y autosuficiente: estilos en línea
// (globals.css podría no haberse cargado) y texto fijo es-MX. Caso extremo, pero cubierto.

import { useEffect } from "react";

// GlobalErrorProps son las props que Next entrega al error boundary global.
type GlobalErrorProps = {
  // error es el fallo capturado en el layout raíz.
  error: Error & { digest?: string };
  // reset vuelve a montar el árbol completo.
  reset: () => void;
};

// GlobalError dibuja un documento mínimo con el aviso y el reintento (sin depender de globals.css).
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("global error boundary captured:", error);
  }, [error]);

  return (
    <html lang="es-MX">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0b0f",
          color: "#e8e4da",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div role="alert" style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>La aplicación no pudo arrancar</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.75, marginTop: 10 }}>
            Ocurrió un error al cargar la pantalla. Puedes reintentar; si persiste, recarga la
            página.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "9px 18px",
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#c9a227",
              background: "transparent",
              border: "1px solid #8a6a1e",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
