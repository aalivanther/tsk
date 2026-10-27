"use client";

// Archivo: DetailAmbient.tsx — El AMBIENTE de fondo de la ficha de detalle (deep-link /titulo).
//
// En español: pinta el backdrop del estreno FIJO detrás de toda la ficha (.td-ambient). Es la versión
// cliente del antiguo div inline: además del backdrop, EXTRAE el color del póster con node-vibrant y lo
// expone como --poster-tint, para que el velo (en tema claro) se tiña con el color del póster (mismo
// tratamiento premium que el home). Decorativo (aria-hidden). Solo se usa si hay backdrop real.

import { type CSSProperties } from "react";

import { BackdropImage } from "@/components/BackdropImage";
import { preloadTintableImage, usePosterTint } from "@/lib/use-poster-tint";

type DetailAmbientProps = {
  backdropUrl: string;
};

export function DetailAmbient({ backdropUrl }: DetailAmbientProps) {
  const tint = usePosterTint(backdropUrl);
  // RESERVA DE LA IMAGEN CON PERMISO: la misma descarga sirve para pintar el ambiente y para sacarle el
  // color. Ver preloadTintableImage y BackdropImage (la imagen va como <img crossOrigin>, no como fondo
  // CSS, que se pedía otra vez sin permiso).
  preloadTintableImage(backdropUrl);
  const style: CSSProperties = {};
  if (tint !== null) {
    (style as Record<string, string>)["--poster-tint"] = tint;
  }
  return (
    <div className="td-ambient" aria-hidden="true" style={style}>
      <BackdropImage url={backdropUrl} priority="high" className="bg-cover-img td-ambient-img" />
    </div>
  );
}
