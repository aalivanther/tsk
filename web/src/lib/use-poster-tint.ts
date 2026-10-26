"use client";

// Archivo: use-poster-tint.ts — Hook que EXTRAE el color dominante de un póster/backdrop con node-vibrant.
//
// En español: dada la URL de una imagen, usa la librería node-vibrant (probada, no inventada) para sacar su
// color más vívido y devolverlo como hex. La atmósfera del tema CLARO se tiñe con ese color, así el fondo
// DERIVA del póster visible (premium y coherente por estreno). Es client-side (canvas/WebWorker); fuera del
// navegador o si la imagen no es accesible (CORS/red) devuelve null y el CSS cae al azul cósmico por defecto.

import { useEffect, useState } from "react";
import { preload } from "react-dom";
import { Vibrant } from "node-vibrant/browser";

// tintCache es la memoria de tintes YA extraídos, por URL (a nivel de módulo: sobrevive re-renders y
// remontajes). En español: el fondo global ROTA cada ~6 segundos entre los mismos ~5 backdrops; sin
// caché, cada vuelta re-descargaba y re-decodificaba la imagen COMPLETA en canvas (CPU en bucle
// infinito). Con la caché, cada URL se analiza UNA vez por sesión; las siguientes son una lectura de
// mapa. Se cachean también los fallos (null) para no reintentar una imagen rota en cada rotación.
const tintCache = new Map<string, string | null>();

// preloadTintableImage reserva la imagen ANTES de que el CSS la pida, y la pide CON PERMISO de origen
// cruzado (crossOrigin "anonymous").
//
// EL PROBLEMA QUE RESUELVE, en cristiano: la misma imagen de fondo se estaba descargando DOS VECES.
// Una para verla (la pide la hoja de estilos, sin pedir permiso al servidor de imágenes) y otra para
// sacarle el color dominante (node-vibrant sí pide permiso, porque para leer los píxeles de una imagen
// de otro dominio el navegador lo exige). Como la primera copia llegó "sin permiso", el navegador la
// guarda marcada como intocable y no deja reutilizarla para leer píxeles: hacía falta una segunda
// descarga. Medido en la portada: 271.248 bytes tirados, tres fondos de hasta 135 KB duplicados.
//
// LA SOLUCIÓN: adelantarse. Si la PRIMERA descarga ya se pide con permiso, esa copia sirve para las dos
// cosas: el fondo la pinta y node-vibrant puede leerla. TMDB responde con `access-control-allow-origin: *`
// a todas sus imágenes, así que dar el permiso no cuesta nada. Esta llamada se hace durante el render
// (no en un efecto) a propósito: React la convierte en una etiqueta <link rel="preload"> en la cabecera
// del documento, que sale ANTES que el estilo de fondo, y así es la que gana la carrera.
//
// Medido después: aun así el fondo CSS volvía a pedirse sin permiso (la reserva y el fondo no
// comparten copia), así que quien pinta estas imágenes ahora lo hace con una <img crossOrigin> (ver
// BackdropImage en GlobalBackground). La reserva sigue sirviendo para adelantar la descarga;
// fetchPriority "high" se usa para la imagen que se ve al abrir la pantalla.
export function preloadTintableImage(imageUrl: string, fetchPriority?: "high" | "low"): void {
  if (imageUrl === "") {
    return;
  }
  preload(imageUrl, {
    as: "image",
    crossOrigin: "anonymous",
    ...(fetchPriority !== undefined ? { fetchPriority } : {}),
  });
}

// usePosterTint devuelve el color dominante (hex) de la imagen dada, o null mientras carga / si falla.
export function usePosterTint(imageUrl: string | undefined): string | null {
  const [tint, setTint] = useState<string | null>(null);

  useEffect(() => {
    if (imageUrl === undefined || imageUrl === "") {
      // Reset síncrono DELIBERADO: al quedarnos sin imagen, el tinte viejo no debe sobrevivir ni un
      // frame (pintaría el ambiente del póster anterior). La alternativa "pura" (useSyncExternalStore
      // sobre vibrant) no compensa aquí; se suprime la regla con causa.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset inmediato al perder la imagen
      setTint(null);
      return;
    }
    // ¿Ya analizamos esta URL? Respuesta inmediata desde la caché, sin red ni canvas.
    if (tintCache.has(imageUrl)) {
      setTint(tintCache.get(imageUrl) ?? null);
      return;
    }
    let cancelled = false;
    // Se pide la imagen TAL CUAL, sin ningún truco en la dirección. node-vibrant la carga con permiso de
    // origen cruzado y encuentra en la caché del navegador la copia que ya reservó preloadTintableImage,
    // que también vino con permiso: una sola descarga sirve para pintar el fondo y para sacarle el color.
    // (Antes se añadía "?vibrant=1" para forzar una descarga aparte, porque la copia del CSS llegaba sin
    // permiso y el navegador no dejaba leer sus píxeles. Ese truco costaba 271 KB en cada visita.)
    Vibrant.from(imageUrl)
      .getPalette()
      .then((palette) => {
        // Preferimos el swatch más vívido; caemos a alternativas si falta. Guardamos SIEMPRE en la
        // caché (aunque este efecto ya se haya cancelado: el resultado sirve para el siguiente uso).
        const swatch =
          palette.Vibrant ?? palette.LightVibrant ?? palette.Muted ?? palette.DarkVibrant ?? null;
        const hex = swatch?.hex ?? null;
        tintCache.set(imageUrl, hex);
        if (!cancelled) {
          setTint(hex);
        }
      })
      .catch(() => {
        // El fallo también se cachea: reintentar la misma imagen rota en cada rotación es desperdicio.
        tintCache.set(imageUrl, null);
        if (!cancelled) {
          setTint(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return tint;
}
