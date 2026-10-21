"use client";

// Archivo: DetailAmbient.tsx — El AMBIENTE de fondo de la ficha de detalle (deep-link /titulo).
//
// En español: pinta el backdrop del estreno FIJO detrás de toda la ficha (.td-ambient). Es la versión
// cliente del antiguo div inline: además del backdrop, EXTRAE el color del póster con node-vibrant y lo
// expone como --poster-tint, para que el velo (en tema claro) se tiña con el color del póster (mismo
// tratamiento premium que el home). Decorativo (aria-hidden). Solo se usa si hay backdrop real.

import { type CSSProperties } from "react";

import { cssUrl } from "@/lib/timeline";
import { preloadTintableImage, usePosterTint } from "@/lib/use-poster-tint";

type DetailAmbientProps = {
  backdropUrl: string;
};

export function DetailAmbient({ backdropUrl }: DetailAmbientProps) {
  const tint = usePosterTint(backdropUrl);
  // RESERVA DE LA IMAGEN CON PERMISO: la misma descarga sirve para pintar el ambiente y para sacarle el
  // color. Sin esto el navegador se traía el backdrop dos veces. Ver preloadTintableImage.
  preloadTintableImage(backdropUrl);
  // cssUrl escapa/valida la URL (anti-inyección CSS); ver su doc en lib/timeline.
  const style: CSSProperties = { backgroundImage: cssUrl(backdropUrl) };
  if (tint !== null) {
    (style as Record<string, string>)["--poster-tint"] = tint;
  }
  return <div className="td-ambient" aria-hidden="true" style={style} />;
}
