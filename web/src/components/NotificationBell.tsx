"use client";

// Archivo: NotificationBell.tsx — La CAMPANA de avisos in-app de lo que el usuario SIGUE.
//
// En español: vive en la barra superior. Deriva los avisos de la watchlist (buildNotifications) contra
// el catálogo y HOY, en DOS TIEMPOS por título (estreno + llegada a plataformas). Muestra un punto con
// el conteo de NO LEÍDOS; al abrir el panel, marca como vistos los avisos mostrados (dejan de contar).
// Cada aviso enlaza a la ficha del título. Cierra al pulsar fuera o con Escape (a11y de menús), igual
// que los filtros del topbar. El estado "leído" se guarda en el perfil (localStorage), por cuenta.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { ui } from "@/lib/i18n";
import { useAppBadge } from "@/lib/use-app-badge";
import { useProfile } from "@/lib/profile-context";
import { buildNotifications, type AppNotification } from "@/lib/notifications";
import { type TodayMarker } from "@/lib/timeline";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// NotificationBellProps son las props de la campana: el catálogo y el marcador HOY para derivar avisos.
type NotificationBellProps = {
  // catalog son todos los estrenos cargados (para resolver la watchlist a títulos con sus datos).
  catalog: ReleaseSummary[];
  // today es el marcador HOY (decide qué está por estrenar, recién estrenado o ya en plataformas).
  today: TodayMarker;
};

// describeNotification redacta el texto del aviso según su tipo y los días a HOY.
function describeNotification(notification: AppNotification): string {
  if (notification.kind === "platform") {
    return ui.notifications.platformAvailable(notification.platforms.join(", "));
  }
  const days = notification.daysFromToday;
  if (days === 0) {
    return ui.notifications.releaseToday;
  }
  if (days === 1) {
    return ui.notifications.releaseTomorrow;
  }
  if (days > 1) {
    return ui.notifications.releaseSoon(days);
  }
  // days < 0: ya estrenó hace |days| días.
  return ui.notifications.releasedAgo(-days);
}

// NotificationBell dibuja el botón-campana con su badge y el panel desplegable de avisos.
export function NotificationBell({ catalog, today }: NotificationBellProps) {
  const { profile, markNotificationsSeen } = useProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  // Avisos derivados de la watchlist, MEMOIZADOS: solo se recalculan cuando cambian la watchlist, el
  // catálogo o HOY. En español: antes se derivaban en cada render (aunque no cambiara nada), y con
  // ellos un Set nuevo cada vez; con useMemo el trabajo se hace solo cuando sus entradas cambian.
  const notifications = useMemo(
    () => buildNotifications(profile.watchlist, catalog, today),
    [profile.watchlist, catalog, today],
  );
  const unreadCount = useMemo(() => {
    const seen = new Set(profile.seenNotifications);
    return notifications.filter((notification) => !seen.has(notification.id)).length;
  }, [notifications, profile.seenNotifications]);

  // Contador sobre el ICONO de la app instalada: el mismo número que muestra el badge de la campana
  // aparece sobre el icono en la pantalla de inicio (como en el correo o la mensajería), así la
  // persona se entera de un estreno sin abrir la app. Donde el navegador no lo soporte, no pasa nada.
  useAppBadge(unreadCount);

  // Al ABRIR el panel, marcamos como vistos todos los avisos mostrados (dejan de contar como no leídos).
  // En español: el "marcar vistos" se hace FUERA del updater de setOpen — los updaters de estado deben
  // ser PUROS (React puede ejecutarlos dos veces en StrictMode); disparar otra acción dentro era el
  // patrón prohibido, aunque aquí fuera idempotente.
  const handleToggle = useCallback(() => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && notifications.length > 0) {
      markNotificationsSeen(notifications.map((notification) => notification.id));
    }
  }, [open, notifications, markNotificationsSeen]);

  // Cierre al pulsar FUERA del componente (a11y de menús), solo mientras está abierto.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="tlx-bell-root">
      <button
        type="button"
        className="tlx-bell"
        aria-label={ui.notifications.bellAria(unreadCount)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={handleToggle}
      >
        {/* Ícono de campana (decorativo: el aria-label comunica la acción y el conteo). */}
        <svg className="tlx-bell-icon" viewBox="0 0 24 24" aria-hidden="true">
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
        {/* Badge de NO LEÍDOS: solo si hay alguno. Decorativo (el aria-label ya lo dice). */}
        {unreadCount > 0 ? (
          <span className="tlx-bell-badge font-mono" aria-hidden="true">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          className="tlx-bell-panel"
          role="dialog"
          aria-label={ui.notifications.panelTitle}
        >
          <p className="tlx-bell-title font-hud">{ui.notifications.panelTitle}</p>
          {notifications.length === 0 ? (
            <p className="tlx-bell-empty font-mono">{ui.notifications.empty}</p>
          ) : (
            <ul className="tlx-bell-list">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <Link
                    href={`/titulo/${notification.releaseId}`}
                    className="tlx-bell-item"
                    onClick={() => setOpen(false)}
                  >
                    {/* Etiqueta del tipo (los 2 tiempos): Estreno / En plataformas, con su color. */}
                    <span className="tlx-bell-kind font-mono" data-kind={notification.kind}>
                      {notification.kind === "release"
                        ? ui.notifications.kindRelease
                        : ui.notifications.kindPlatform}
                    </span>
                    <span className="tlx-bell-name">{notification.title}</span>
                    <span className="tlx-bell-when font-mono">
                      {describeNotification(notification)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
