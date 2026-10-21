"use client";

// Archivo: SceneBackground.tsx — El "interruptor" del fondo de polvo flotante.
//
// En español: decide SI se monta el campo de motas y lo carga de forma PEREZOSA. Reglas:
//   - Solo en el navegador (next/dynamic con ssr:false) — el lienzo de dibujo no existe en el servidor.
//   - NO bajo `prefers-reduced-motion` (respeto a quien pidió menos movimiento) -> queda el fondo
//     estático de blobs/grano que ya pinta <Background/>.
//   - NO en pantallas pequeñas (móvil): en el teléfono priorizamos batería y fluidez, así que se
//     omite y queda el fondo estático.
//   - Menos motas en pantallas medianas que en grandes.
// Va envuelto en un contenedor fijo, detrás del contenido (z bajo) y sin capturar eventos (decorativo).
//
// Las clases se llaman "tlx-dust-*" (polvo) y dicen lo que son. Antes se llamaban "tlx-webgl-*" en
// recuerdo de la librería de gráficos 3D con la que se dibujó esto en su día; esa librería ya no está
// en el proyecto, así que el nombre solo servía para mandar a quien lo leyera a buscar algo inexistente.

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useProfile } from "@/lib/profile-context";

// Carga PEREZOSA del lienzo de motas: su código solo se descarga cuando de verdad se va a montar, y
// nunca en el servidor (ssr:false). Así no pesa en la carga inicial ni en quien no lo verá.
const ParticleCanvas = dynamic(() => import("./particles/ParticleCanvas"), {
  ssr: false,
});

export function SceneBackground() {
  // particleCount = 0 significa "no montar" (reduced-motion, móvil, o aún sin decidir en el primer render).
  const [particleCount, setParticleCount] = useState(0);

  // Paleta de las motas según el tema: AZUL METÁLICO en claro, ORO en oscuro.
  const { profile } = useProfile();
  const tone = profile.settings.theme === "light" ? "blue" : "gold";

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const isMobile = window.matchMedia("(max-width: 767px)");

    // decide calcula cuántas motas mostrar según las preferencias/tamaño actuales (0 = no mostrar).
    const decide = () => {
      if (reducedMotion.matches || isMobile.matches) {
        setParticleCount(0);
        return;
      }
      // Densidad ELEGANTE (polvo sutil, no enjambre): menos en pantallas medianas.
      setParticleCount(window.innerWidth >= 1280 ? 240 : 150);
    };

    decide();
    reducedMotion.addEventListener("change", decide);
    isMobile.addEventListener("change", decide);
    return () => {
      reducedMotion.removeEventListener("change", decide);
      isMobile.removeEventListener("change", decide);
    };
  }, []);

  if (particleCount === 0) {
    return null;
  }

  return (
    <div className="tlx-dust-layer" aria-hidden="true">
      <ParticleCanvas particleCount={particleCount} tone={tone} />
    </div>
  );
}
