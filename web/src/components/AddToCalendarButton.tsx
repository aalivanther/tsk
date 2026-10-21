"use client";

// Archivo: AddToCalendarButton.tsx — El botón "Añadir a mi calendario" de la ficha de un estreno.
//
// En español: descarga el estreno como un archivo .ics, el formato estándar de calendario que abren
// Google Calendar, el Calendario de Apple y Outlook. Al abrirlo, el estreno queda como un evento de
// día completo en el calendario que la persona ya usa, así que se entera del estreno aunque no vuelva
// a abrir esta aplicación. No se conecta con ninguna cuenta ni se pide permiso a nadie: solo se
// genera un archivo en el propio navegador y se descarga.
//
// El TEXTO del archivo lo arma un ayudante puro (src/lib/ics.ts), que es donde vive el conocimiento
// del formato y donde están sus pruebas. Este componente solo se ocupa de la parte que necesita
// navegador: convertir ese texto en una descarga y limpiar después lo que se creó para lograrlo.
//
// Degradado elegante: si el estreno todavía no tiene fecha confirmada, no hay evento posible. En vez
// de un botón que no haría nada, se explica en una línea por qué no está disponible.

import { useCallback } from "react";

import {
  buildIcsCalendar,
  icsEventsFromReleases,
  toIcsDate,
  type CalendarizableRelease,
} from "@/lib/ics";
import { ui } from "@/lib/i18n";

// downloadIcsFile convierte el texto de un calendario en un archivo descargado por el navegador.
// En español: se crea un "objeto en memoria" con el contenido, se le cuelga un enlace invisible, se
// pulsa por programa y se libera la memoria enseguida. Es el mismo mecanismo que ya usa el perfil
// para exportar su respaldo JSON, así que la app descarga archivos de una sola forma.
export function downloadIcsFile(calendarText: string, fileName: string): void {
  // El tipo "text/calendar" es lo que hace que el sistema ofrezca abrirlo con la app de calendario.
  const blob = new Blob([calendarText], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileName}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// slugifyFileName convierte un título en un nombre de archivo seguro y legible.
// En español: quita acentos, pasa a minúsculas y sustituye por guiones todo lo que no sea una letra
// o un número, porque los espacios y los signos dan problemas en algunos sistemas de archivos. Si no
// queda nada aprovechable (un título en otro alfabeto, por ejemplo), se usa un nombre genérico.
function slugifyFileName(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? ui.calendar.fileNameSingle : slug;
}

// siteBaseUrl devuelve la dirección base del sitio tal como la ve el navegador (ej. "https://…").
// En español: sirve para meter en el evento el enlace a la ficha del título. Se toma del propio
// navegador en vez de escribirla a mano, así funciona igual en desarrollo y en producción.
function siteBaseUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.origin;
}

// AddToCalendarButtonProps son las props del botón: el estreno que se va a exportar.
type AddToCalendarButtonProps = {
  // release es la ficha del estreno (de ella salen el título, la fecha y el enlace del evento).
  // Basta con su id, su título y su fecha: es lo único que lleva un evento de calendario. Así el
  // botón sirve igual dentro de la ficha completa de un título y dentro de una lista de resúmenes.
  release: CalendarizableRelease;
};

// AddToCalendarButton dibuja el botón y se encarga de la descarga al pulsarlo.
export function AddToCalendarButton({ release }: AddToCalendarButtonProps) {
  // hasUsableDate indica si la fecha del estreno sirve para crear un evento (ver el ayudante puro).
  const hasUsableDate = toIcsDate(release.releaseDate) !== "";

  const handleDownload = useCallback(() => {
    const events = icsEventsFromReleases([release], siteBaseUrl(), ui.calendar.eventDescription);
    // La hora de generación se pasa como dato (el ayudante no lee el reloj): es la marca de "cuándo
    // se creó este archivo" que pide el formato.
    const calendarText = buildIcsCalendar(events, new Date());
    downloadIcsFile(calendarText, slugifyFileName(release.title));
  }, [release]);

  // Sin fecha utilizable no hay evento que crear: se explica en vez de ofrecer un botón inútil.
  if (!hasUsableDate) {
    return <p className="rf-cal-note font-mono">{ui.calendar.unavailable}</p>;
  }

  return (
    <button
      type="button"
      className="rf-cal-btn font-mono"
      aria-label={ui.calendar.addAria(release.title)}
      onClick={handleDownload}
    >
      {/* Icono de calendario (decorativo: el texto del botón ya dice qué hace). */}
      <svg className="rf-cal-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect
          x="3.5"
          y="5"
          width="17"
          height="15"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path
          d="M12 12.5v5M9.5 15h5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      {ui.calendar.addButton}
    </button>
  );
}
