// Archivo: ics.ts — Generador PURO de archivos de calendario (.ics) para los estrenos.
//
// En español: un archivo ".ics" es el formato estándar (llamado iCalendar) que entienden Google
// Calendar, el Calendario de Apple y Outlook. Si a alguien le importa un estreno, puede descargarlo
// como evento y su propio calendario le avisará el día que llegue — aunque no vuelva a abrir la app.
//
// Aquí solo se ARMA EL TEXTO del archivo. No se toca el navegador, ni se descarga nada, ni se lee la
// hora del sistema: todo entra por parámetros y sale como una cadena. Eso lo hace una función pura
// (misma entrada, misma salida), fácil de probar y de reutilizar tanto en el servidor como en el
// navegador. Quien quiera descargarlo, convierte esta cadena en un archivo (eso vive en la interfaz).
//
// El formato lo define el estándar RFC 5545. Los puntos que respeta este archivo, y POR QUÉ importan:
//   - Estructura: un "sobre" VCALENDAR que contiene un VEVENT por estreno.
//   - Fechas de DÍA COMPLETO: se escriben como AAAAMMDD con la marca VALUE=DATE. Sin esa marca el
//     calendario las interpretaría como una hora concreta y el evento se correría de día según la
//     zona horaria de quien lo abre — justo el error que rompe este tipo de exportaciones.
//   - DTEND es el día SIGUIENTE al estreno: en el estándar, el final de un evento de día completo es
//     "exclusivo" (marca dónde termina, no el último día incluido). Con el mismo día, algunos
//     calendarios muestran el evento vacío o corrido.
//   - UID estable: el identificador único de cada evento se deriva del id del título, así que
//     reexportar el mismo estreno ACTUALIZA el evento existente en vez de duplicarlo.
//   - Escapado: comas, puntos y coma, barras invertidas y saltos de línea tienen significado propio
//     dentro del formato; si no se escaparan, un título como "Rápidos, furiosos; y más" partiría el
//     archivo en pedazos y el calendario lo rechazaría.
//   - Plegado de líneas: ninguna línea puede pasar de 75 octetos (bytes); las largas se cortan y
//     continúan en la línea siguiente empezando con un espacio.
//   - Fin de línea CRLF: el estándar exige "retorno de carro + salto de línea", no solo salto.

// ICS_PRODID identifica al programa que generó el archivo (obligatorio en el estándar).
// En español: es la "firma" de quién creó el calendario; los clientes la registran pero no la muestran.
const ICS_PRODID = "-//The Story Keeper//Catalogo de estrenos//ES";

// UID_DOMAIN es el dominio que cierra el identificador único de cada evento ("id@dominio").
// En español: el estándar pide que el UID parezca una dirección global e irrepetible. Al derivarlo del
// id del título (y no de la hora de generación), reexportar el mismo estreno actualiza su evento.
const UID_DOMAIN = "thestorykeeper.local";

// MAX_LINE_OCTETS es el largo máximo de una línea del archivo, en bytes, que fija el estándar.
const MAX_LINE_OCTETS = 75;

// MILLISECONDS_PER_DAY son los milisegundos de un día, para calcular el día siguiente (DTEND).
const MILLISECONDS_PER_DAY = 86_400_000;

// IcsEvent es UN evento listo para escribirse en el archivo de calendario.
// En español: es la forma mínima que necesita un evento de día completo. Se mantiene independiente
// del modelo del catálogo para que este archivo se pueda probar y reutilizar con cualquier dato.
export type IcsEvent = {
  // uid es el identificador ÚNICO y ESTABLE del evento (mismo título => mismo uid, siempre).
  uid: string;
  // date es el día del evento en formato ISO "AAAA-MM-DD" (sin hora: es un evento de día completo).
  date: string;
  // summary es el título del evento: lo que se lee en la casilla del calendario.
  summary: string;
  // description es el texto largo del evento (se ve al abrirlo). Puede ir vacío.
  description: string;
  // url es el enlace a la ficha del título dentro de la app. Cadena vacía si no aplica.
  url: string;
};

// escapeIcsText escapa los caracteres que tienen significado propio dentro del formato iCalendar.
// En español: dentro de un archivo .ics, la coma y el punto y coma SEPARAN valores, y la barra
// invertida es el carácter de escape. Si un título los trae de forma literal, hay que "protegerlos"
// poniéndoles una barra delante; los saltos de línea se escriben como la secuencia \n. El orden
// importa: la barra invertida se escapa PRIMERO, o si no se escaparían también las barras que
// nosotros mismos acabamos de añadir.
export function escapeIcsText(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      // Un salto de línea puede venir como "\r\n" (Windows), "\n" o "\r": los tres se normalizan a \n.
      .replace(/\r\n|\r|\n/g, "\\n")
  );
}

// toIcsDate convierte una fecha ISO "AAAA-MM-DD" al formato compacto del estándar "AAAAMMDD".
// En español: devuelve cadena vacía si la fecha no es válida, para que quien llame descarte ese
// evento en lugar de escribir una fecha rota en el archivo (nunca se inventa una fecha).
export function toIcsDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return "";
  }
  // Comprobamos además que la fecha EXISTA de verdad. Un "2026-02-31" cumple el patrón, pero febrero
  // no tiene 31 días: al interpretarlo, el navegador lo "corre" solo al 3 de marzo en vez de avisar
  // del error. Por eso volvemos a leer año, mes y día de la fecha ya interpretada y exigimos que
  // coincidan con lo que entró: si no coinciden, la fecha no existía y la descartamos.
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  const roundTripMatches =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day;
  if (!roundTripMatches) {
    return "";
  }
  return isoDate.replace(/-/g, "");
}

// nextDayIcsDate devuelve el DÍA SIGUIENTE de una fecha ISO, en formato "AAAAMMDD".
// En español: el final de un evento de día completo es exclusivo (ver la cabecera del archivo), así
// que el evento del 15 de junio termina el 16. Se calcula en UTC para que no dependa de la zona
// horaria de quien genera el archivo. Cadena vacía si la fecha de entrada no sirve.
function nextDayIcsDate(isoDate: string): string {
  if (toIcsDate(isoDate) === "") {
    return "";
  }
  const nextDay = new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + MILLISECONDS_PER_DAY);
  const year = nextDay.getUTCFullYear();
  const month = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
  const day = String(nextDay.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

// formatIcsTimestamp convierte un instante a la marca de tiempo UTC que pide el estándar (DTSTAMP),
// con la forma "AAAAMMDDTHHMMSSZ". En español: es "cuándo se generó este archivo"; la Z final indica
// que está en horario universal, sin ambigüedad de husos.
export function formatIcsTimestamp(instant: Date): string {
  const year = instant.getUTCFullYear();
  const month = String(instant.getUTCMonth() + 1).padStart(2, "0");
  const day = String(instant.getUTCDate()).padStart(2, "0");
  const hours = String(instant.getUTCHours()).padStart(2, "0");
  const minutes = String(instant.getUTCMinutes()).padStart(2, "0");
  const seconds = String(instant.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

// octetLength devuelve cuántos BYTES ocupa un texto codificado en UTF-8.
// En español: el estándar mide el largo de las líneas en bytes, no en letras, y en español una letra
// acentuada ("é") ocupa dos bytes. Contar letras dejaría líneas más largas de lo permitido.
function octetLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// foldIcsLine parte una línea larga en varias, como exige el estándar ("line folding").
// En español: ninguna línea puede pasar de 75 bytes. Las que se pasan se cortan y continúan en la
// siguiente empezando con UN ESPACIO, que es la señal de "esto sigue la línea anterior". El corte se
// hace por CARACTERES COMPLETOS (nunca a mitad de una letra ni de un emoji), midiendo su tamaño real
// en bytes: partir a mitad de un carácter produciría un archivo corrupto.
function foldIcsLine(line: string): string[] {
  if (octetLength(line) <= MAX_LINE_OCTETS) {
    return [line];
  }
  const folded: string[] = [];
  let current = "";
  let currentOctets = 0;
  // El primer trozo puede usar los 75 bytes; los siguientes gastan uno en el espacio de continuación.
  let limit = MAX_LINE_OCTETS;
  // Array.from recorre CARACTERES completos (respeta los que ocupan dos posiciones internas).
  for (const character of Array.from(line)) {
    const characterOctets = octetLength(character);
    if (currentOctets + characterOctets > limit) {
      folded.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += character;
    currentOctets += characterOctets;
  }
  if (current !== "") {
    folded.push(current);
  }
  // La primera línea va tal cual; el resto llevan delante el espacio que las marca como continuación.
  return folded.map((piece, index) => (index === 0 ? piece : ` ${piece}`));
}

// buildIcsCalendar arma el archivo de calendario COMPLETO a partir de una lista de eventos.
// En español: es la función principal de este archivo. Recibe los eventos y el instante en que se
// genera (que entra por parámetro, no se lee del reloj, para que la función siga siendo pura y
// comprobable). Devuelve el contenido del archivo .ics como una sola cadena de texto, con los saltos
// de línea CRLF que pide el estándar. Los eventos con fecha inválida se DESCARTAN en silencio (no se
// inventa una fecha): quien llama decide si merece la pena ofrecer la descarga, consultando antes
// cuántos eventos válidos hay.
export function buildIcsCalendar(events: IcsEvent[], generatedAt: Date): string {
  const timestamp = formatIcsTimestamp(generatedAt);

  // Cabecera del "sobre": versión del formato, quién lo generó, el calendario gregoriano y el método
  // PUBLISH (que significa "esto es información publicada", no una invitación que haya que contestar).
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const event of events) {
    const start = toIcsDate(event.date);
    const end = nextDayIcsDate(event.date);
    // Sin una fecha utilizable no hay evento posible: se descarta en vez de escribir algo roto.
    if (start === "" || end === "") {
      continue;
    }
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcsText(event.uid)}`);
    lines.push(`DTSTAMP:${timestamp}`);
    // VALUE=DATE marca que son fechas SIN hora (evento de día completo). Ver la cabecera del archivo.
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
    if (event.description !== "") {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    if (event.url !== "") {
      lines.push(`URL:${escapeIcsText(event.url)}`);
    }
    // TRANSP:TRANSPARENT indica que el estreno NO ocupa la agenda: quien lo vea seguirá "libre" ese
    // día. Sin esto, añadir varios estrenos haría que un compañero de trabajo te viera ocupado.
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // Plegamos cada línea al largo permitido y unimos todo con CRLF (el estándar no acepta solo "\n").
  // El archivo termina también en CRLF, como exige el formato.
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}

// icsUidForRelease construye el identificador único y ESTABLE del evento de un título del catálogo.
// En español: siempre el mismo id de título produce el mismo identificador, así que reexportar
// actualiza el evento existente del calendario en lugar de crear un duplicado.
export function icsUidForRelease(releaseId: string): string {
  return `${releaseId}@${UID_DOMAIN}`;
}

// icsEventsFromReleases traduce estrenos del catálogo a eventos de calendario listos para exportar.
// En español: toma cada estreno, usa su título como nombre del evento, su fecha de estreno como día y
// arma el enlace a su ficha. Los estrenos SIN fecha válida se descartan (no se inventa ninguna). El
// enlace se construye con la dirección base que recibe: en el navegador es el origen del sitio, y si
// no se conoce, los eventos salen sin enlace en vez de con una dirección falsa.
// CalendarizableRelease es lo MÍNIMO que hace falta de un estreno para ponerlo en un calendario.
//
// En español: un evento de calendario necesita tres cosas —cuándo, cómo se llama y a dónde enlaza— y
// nada más. Pidiendo solo eso, esta función sirve igual para la ficha completa de un título y para el
// resumen que viajan las listas, sin obligar a nadie a cargar datos que aquí no se usan. Es también
// lo que hace que estas funciones se puedan probar con objetos de tres campos, sin fabricar fichas.
export type CalendarizableRelease = {
  // id identifica el estreno; de él salen el identificador único del evento y su enlace.
  id: string;
  // title es lo que se lee en el calendario.
  title: string;
  // releaseDate es la fecha ISO (AAAA-MM-DD); si no es válida, el estreno se descarta.
  releaseDate: string;
};

export function icsEventsFromReleases(
  releases: readonly CalendarizableRelease[],
  baseUrl: string,
  describe: (title: string) => string,
): IcsEvent[] {
  const events: IcsEvent[] = [];
  for (const release of releases) {
    if (toIcsDate(release.releaseDate) === "") {
      continue;
    }
    events.push({
      uid: icsUidForRelease(release.id),
      date: release.releaseDate,
      summary: release.title,
      description: describe(release.title),
      url: baseUrl === "" ? "" : `${baseUrl}/titulo/${release.id}`,
    });
  }
  return events;
}
