"use client";

// Archivo: BottomNav.tsx — La barra de navegación INFERIOR, exclusiva de móvil.
//
// En español: en un teléfono, la parte alta de la pantalla es la más difícil de alcanzar con el pulgar
// y la más disputada (ahí viven el notch y la barra del navegador). Por eso las apps nativas ponen su
// navegación principal ABAJO. Esta barra hace lo mismo: da acceso permanente a los tres destinos del
// producto (la línea de tiempo, los avisos y el perfil) sin que el usuario tenga que volver arriba.
//
// Detalles que la hacen sentir nativa y no un menú web:
//   - Se aparta de la barra de gestos del sistema con el margen seguro inferior (safe-area).
//   - Cada destino es un área táctil de 56px de alto, muy por encima del mínimo fiable de 44px.
//   - El destino ACTIVO se marca con aria-current, no solo con color (accesibilidad real).
//   - Los avisos muestran su contador de no leídos, igual que la campana de escritorio.
//
// Solo se monta en móvil (lo decide quien la usa): en escritorio la navegación vive en el Topbar.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useDialogEscape } from "@/lib/dialog-stack";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAppBadge } from "@/lib/use-app-badge";
import { useProfile } from "@/lib/profile-context";
import { buildNotifications, type AppNotification } from "@/lib/notifications";
import { type TodayMarker } from "@/lib/timeline";
import { ui } from "@/lib/i18n";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// BottomNavProps: la barra necesita el catálogo y HOY para calcular los avisos sin leer.
type BottomNavProps = {
  // catalog es el catálogo cargado, para derivar los avisos de la watchlist.
  catalog: ReleaseSummary[];
  // today es el marcador HOY (decide qué avisos son relevantes).
  today: TodayMarker;
};

// BottomNav dibuja la barra fija inferior con sus destinos.
export function BottomNav({ catalog, today }: BottomNavProps) {
  const pathname = usePathname();
  const { profile, markNotificationsSeen } = useProfile();

  // sheetOpen controla la HOJA INFERIOR de avisos. En móvil, un panel colgando de una campana
  // arriba sería incómodo de alcanzar; la hoja sube desde abajo, que es de donde viene el gesto.
  const [sheetOpen, setSheetOpen] = useState(false);

  // Avisos derivados con la MISMA receta que la campana de escritorio (una sola fuente de verdad).
  const notifications = useMemo<AppNotification[]>(
    () => buildNotifications(profile.watchlist, catalog, today),
    [profile.watchlist, catalog, today],
  );
  const unreadCount = useMemo(() => {
    const seen = new Set(profile.seenNotifications);
    return notifications.filter((notification) => !seen.has(notification.id)).length;
  }, [notifications, profile.seenNotifications]);

  // Contador sobre el ICONO de la app instalada (Badging API). En móvil es donde más sentido tiene:
  // la app suele estar instalada en la pantalla de inicio y el globito avisa sin abrir nada. El hook
  // detecta si el navegador lo soporta; donde no, no ocurre nada y la barra funciona igual.
  useAppBadge(unreadCount);

  // Abrir la hoja marca los avisos mostrados como vistos (dejan de contar como no leídos).
  const openSheet = useCallback(() => {
    setSheetOpen(true);
    if (notifications.length > 0) {
      markNotificationsSeen(notifications.map((notification) => notification.id));
    }
  }, [notifications, markNotificationsSeen]);

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // Escape cierra la hoja respetando la pila de diálogos (si hay algo encima, cierra eso primero).
  useDialogEscape(sheetOpen, closeSheet);

  // TRAMPA DE FOCO de la hoja de avisos.
  //
  // En español: la hoja se declara a sí misma como un diálogo modal (role="dialog" + aria-modal),
  // que es una promesa concreta hacia quien navega con teclado o lector de pantalla: "mientras esto
  // esté abierto, lo de detrás NO existe". Sin trampa esa promesa era falsa — al pulsar Tab el foco
  // se escapaba a los enlaces del fondo, que el lector ya no anuncia por estar tapados por el velo,
  // así que la persona quedaba operando a ciegas una página que creía cerrada.
  //
  // El hook resuelve las tres partes de la promesa: mete el foco dentro al abrir, mantiene el Tab
  // dando la vuelta dentro de la hoja, y al cerrar devuelve el foco al botón de avisos que la abrió
  // (nunca al principio de la página). Es el MISMO hook que usan los demás diálogos de la app, para
  // que el comportamiento sea idéntico en todos y no haya una segunda versión que se desajuste.
  const sheetRef = useFocusTrap<HTMLDivElement>(sheetOpen);

  // isTimeline / isProfile deciden qué destino se marca como activo según la ruta actual.
  const isTimeline = pathname === "/";
  const isProfile = pathname.startsWith("/perfil");

  return (
    <nav className="bn-root" aria-label={ui.nav.mobileLabel}>
      {/* Destino 1: la línea de tiempo (la casa del producto). */}
      <Link
        href="/"
        className="bn-item"
        data-active={isTimeline ? "true" : undefined}
        aria-current={isTimeline ? "page" : undefined}
      >
        <svg className="bn-icon" viewBox="0 0 24 24" aria-hidden="true">
          {/* Espina con nodos: el mismo símbolo del producto, en miniatura. */}
          <path d="M12 3v18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="7.5" r="2.1" fill="currentColor" />
          <circle cx="12" cy="16.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="bn-label font-mono">{ui.nav.timeline}</span>
      </Link>

      {/* Destino 2: los avisos. No navega: abre la hoja de notificaciones sobre la vista actual. */}
      <button type="button" className="bn-item" onClick={openSheet} aria-expanded={sheetOpen}>
        <span className="bn-icon-wrap">
          <svg className="bn-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3.5a5 5 0 0 0-5 5v3.2l-1.5 3.1h13L17 11.7V8.5a5 5 0 0 0-5-5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M10 18.5a2 2 0 0 0 4 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          {unreadCount > 0 ? (
            <span className="bn-badge font-mono" aria-hidden="true">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </span>
        <span className="bn-label font-mono">{ui.nav.alerts}</span>
        {/* El conteo se comunica también por texto accesible (el badge es decorativo). */}
        <span className="sr-only">{ui.notifications.bellAria(unreadCount)}</span>
      </button>

      {/* Destino 3: el perfil (biblioteca, reseñas, ajustes). */}
      <Link
        href="/perfil"
        className="bn-item"
        data-active={isProfile ? "true" : undefined}
        aria-current={isProfile ? "page" : undefined}
      >
        <svg className="bn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8.5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span className="bn-label font-mono">{ui.nav.profile}</span>
      </Link>

      {/*
        HOJA INFERIOR de avisos: sube desde abajo (el gesto natural del pulgar), con un asa visible
        que comunica "esto se puede arrastrar/cerrar". El velo oscurece el fondo y también cierra.
      */}
      {sheetOpen ? (
        <>
          <div className="bn-sheet-scrim" onClick={closeSheet} aria-hidden="true" />
          {/* tabIndex={-1} es el respaldo de la trampa: cuando la lista está vacía no hay ningún
              enlace al que llevar el foco, así que se enfoca la hoja misma (si no, el foco se
              quedaría en el fondo y Tab saldría de la hoja en la primera pulsación). */}
          <div
            ref={sheetRef}
            className="bn-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={ui.notifications.panelTitle}
            tabIndex={-1}
          >
            <span className="bn-sheet-handle" aria-hidden="true" />
            <p className="bn-sheet-title font-hud">{ui.notifications.panelTitle}</p>
            {notifications.length === 0 ? (
              <p className="bn-sheet-empty font-mono">{ui.notifications.empty}</p>
            ) : (
              <ul className="bn-sheet-list">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <Link
                      href={`/titulo/${notification.releaseId}`}
                      className="bn-sheet-item"
                      onClick={closeSheet}
                    >
                      <span className="bn-sheet-kind font-mono" data-kind={notification.kind}>
                        {notification.kind === "release"
                          ? ui.notifications.kindRelease
                          : ui.notifications.kindPlatform}
                      </span>
                      <span className="bn-sheet-name">{notification.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </nav>
  );
}
