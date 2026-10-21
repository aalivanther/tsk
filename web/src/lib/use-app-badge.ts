"use client";

// Archivo: use-app-badge.ts — Pone el CONTADOR de avisos sin leer sobre el icono de la app instalada.
//
// En español: cuando alguien instala The Story Keeper en su teléfono o escritorio (es una PWA, ver
// app/manifest.ts), su icono se comporta como el de cualquier app nativa. La "Badging API" del
// navegador permite pintar sobre ese icono el globito con un número — el mismo que se ve en el icono
// del correo o de la mensajería. Este hook lo mantiene sincronizado con los avisos sin leer, para que
// la persona se entere de que un estreno que sigue ya salió SIN necesidad de abrir la app.
//
// Tres decisiones deliberadas:
//   1) SOPORTE DETECTADO, no supuesto: la API no existe en todos los navegadores (a mediados de 2026
//      la traen los basados en Chromium y Safari en apps instaladas; Firefox no). Se comprueba antes
//      de llamarla; donde no exista, el hook simplemente no hace nada y la app funciona igual.
//   2) LIMPIEZA EN CERO: sin avisos pendientes se BORRA el globito, no se pinta un "0". Un cero
//      permanente sobre el icono es ruido visual que la gente aprende a ignorar.
//   3) NO SE BORRA AL DESMONTAR: el contador pertenece a la APLICACIÓN, no a un componente. Si se
//      limpiara al desmontar, cambiar de pantalla haría desaparecer el globito aunque siguiera
//      habiendo avisos sin leer. Por eso el hook solo escribe el valor y lo actualiza cuando cambia.
//
// Uso: useAppBadge(unreadCount) allí donde ya se calculan los avisos sin leer.

import { useEffect } from "react";

// BadgeCapableNavigator describe las DOS funciones de la Badging API que este hook usa.
// En español: TypeScript todavía no incluye estas funciones en la definición estándar de "navigator"
// (son relativamente nuevas), así que declaramos aquí su forma, marcándolas como OPCIONALES — que es
// exactamente lo que son en la práctica: puede que el navegador no las tenga.
type BadgeCapableNavigator = Navigator & {
  // setAppBadge pinta el globito con el número indicado sobre el icono de la app instalada.
  setAppBadge?: (count?: number) => Promise<void>;
  // clearAppBadge quita el globito del icono.
  clearAppBadge?: () => Promise<void>;
};

// useAppBadge mantiene el globito del icono de la app al día con el número de avisos sin leer.
// En español: recibe cuántos avisos hay sin leer y se encarga del resto. Si el número es cero (o
// negativo por algún cálculo raro), borra el globito; si es mayor que cero, lo pinta con ese número.
// Cuando el navegador no soporta la función, o la rechaza (pasa cuando la app NO está instalada:
// entonces no hay icono sobre el que pintar), no ocurre nada visible y la app sigue funcionando.
export function useAppBadge(unreadCount: number): void {
  useEffect(() => {
    // En el servidor no existe "navigator": este efecto solo corre en el navegador, pero la
    // comprobación deja el hook a salvo de cualquier ejecución fuera de él.
    if (typeof navigator === "undefined") {
      return;
    }
    const badgeNavigator = navigator as BadgeCapableNavigator;

    // Sin avisos pendientes: quitamos el globito (si el navegador sabe hacerlo).
    if (unreadCount <= 0) {
      if (typeof badgeNavigator.clearAppBadge !== "function") {
        return;
      }
      // La promesa se rechaza cuando la app NO está instalada (no hay icono que decorar). Es un caso
      // ESPERADO, no un fallo del programa: lo absorbemos a propósito para no ensuciar la consola con
      // un error por cada visita desde el navegador normal.
      void badgeNavigator.clearAppBadge().catch(() => {
        // Sin icono de app instalada no hay globito que borrar: no hay nada más que hacer.
      });
      return;
    }

    // Con avisos pendientes: pintamos el número sobre el icono.
    if (typeof badgeNavigator.setAppBadge !== "function") {
      return;
    }
    void badgeNavigator.setAppBadge(unreadCount).catch(() => {
      // Mismo caso esperado que arriba: sin app instalada, el navegador rechaza la petición.
    });
  }, [unreadCount]);
}
