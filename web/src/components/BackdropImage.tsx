"use client";

// Archivo: BackdropImage.tsx — Un fondo decorativo pintado como <img> con permiso de origen cruzado.
//
// En español: los fondos que además se analizan con node-vibrant (el fondo rotativo de la portada y el
// ambiente de la ficha) se pintaban como fondo CSS. Un fondo CSS se pide sin permiso de origen
// cruzado y node-vibrant necesita la copia con permiso para leer sus píxeles, así que cada imagen se
// descargaba dos veces. Pintándola con <img crossOrigin="anonymous"> la misma descarga sirve para
// las dos cosas. Ocupa toda su capa y se recorta exactamente como el fondo de antes (cover; ver
// .bg-cover-img en globals.css).

import type { JSX } from "react";

import { cssUrl } from "@/lib/timeline";

// BackdropImage pinta un fondo como <img> con permiso de origen cruzado (ver arriba por qué). Ocupa
// toda la capa y se recorta exactamente como el fondo CSS de antes (cover y centrado; .bg-cover-img en
// globals.css). Las mismas reglas de seguridad que cssUrl: solo direcciones http(s).
export function BackdropImage({
  url,
  priority,
  className = "bg-cover-img",
}: {
  url: string;
  priority: "high" | "low";
  className?: string;
}): JSX.Element | null {
  if (cssUrl(url) === "none") {
    return null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- fondo decorativo que también lee node-vibrant
    <img
      className={className}
      src={url}
      alt=""
      aria-hidden="true"
      crossOrigin="anonymous"
      decoding="async"
      fetchPriority={priority}
      draggable={false}
    />
  );
}
