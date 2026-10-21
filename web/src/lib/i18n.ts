// Archivo: i18n.ts — Textos en es-MX del "shell" (marca, filtros, atribuciones, estados).
// En español: centraliza en UN solo lugar todo el TEXTO VISIBLE de la cáscara de la app (topbar,
// footer, home y detalle). Así, para cambiar una palabra o traducir a otro idioma, se toca solo
// este archivo. En la Fase 0 hay un único idioma (español de México), por eso NO metemos una
// librería de i18n todavía: con estos objetos basta y el código queda "listo para i18n".
//
// IMPORTANTE: la atribución de TMDB tiene un TEXTO EXACTO EN INGLÉS exigido por sus términos (texto
// legal, no se traduce). Ese aviso vive literal en el componente Footer; aquí van los textos es-MX.

// LOCALE y REGION son el idioma/región activos del proyecto en Fase 0.
// En español: se exponen como constantes para reutilizarlos (atributo lang del HTML, sello del pie),
// sin escribir el valor a mano en varios sitios.
export const LOCALE = "es-MX" as const;
export const REGION = "MX" as const;

// BRAND_FULL y DETAIL_NOT_FOUND_TITLE son dos textos que se usan en DOS zonas distintas del catálogo
// (la marca en el topbar y en los títulos que ven los buscadores; el "no encontrado" en la pantalla de
// detalle y en el título de su pestaña). Viven como constantes SUELTAS, antes del objeto `ui`, porque
// una parte de `ui` no puede referirse a otra parte de `ui` mientras el objeto se está creando:
// TypeScript no puede deducir el tipo de algo que se usa a sí mismo. Con estas constantes, el mismo
// texto se escribe UNA sola vez y ambos lugares lo reutilizan sin ese problema.
const BRAND_FULL = "The Story Keeper";
const DETAIL_NOT_FOUND_TITLE = "Título no encontrado";

// ui agrupa el TEXTO de la interfaz por zona (marca, filtros, acciones, rareza, home, detalle).
// En español: cada subgrupo junta los textos de esa parte para encontrarlos fácil. Los valores ya
// están redactados como deben verse en pantalla (es-MX).
export const ui = {
  // brand: el nombre del producto. "The Story" + "Keeper" forman la marca; "Keeper" se pinta en oro
  // en el Topbar, por eso van separados.
  brand: {
    full: BRAND_FULL,
    prefix: "The Story",
    highlight: "Keeper",
    tagline: "«Toda historia merece un guardián»",
  },

  // filters: etiquetas de los dos selects de filtro de la barra (categoría + género), que SÍ funcionan.
  // El select "Categoría" acota por tipo/canal (Todas/Películas/Series/Streaming); el de "Género" exige
  // un género del catálogo. Cada select lleva su etiqueta accesible (aria) y su opción "Todas/Todos".
  filters: {
    groupLabel: "Filtros de la línea de tiempo",
    // Select de Categoría: su etiqueta a11y y sus cuatro opciones.
    categoryLabel: "Categoría",
    categoryAll: "Todas",
    // Resumen del botón multi cuando hay VARIAS categorías activas (ej. "2 categorías").
    categoryCount: (count: number): string => `${count} categorías`,
    movies: "Películas",
    series: "Series",
    streaming: "Streaming",
    indie: "Indie",
    // Filtro de Género: su etiqueta a11y, el resumen "todos" y el resumen de varios ("N géneros").
    genreLabel: "Género",
    genreAll: "Todos",
    genreCount: (count: number): string => `${count} géneros`,
  },

  // nav: textos de la barra de navegación INFERIOR de móvil (los tres destinos del producto).
  nav: {
    // mobileLabel es la etiqueta accesible de toda la barra (la anuncian los lectores de pantalla).
    mobileLabel: "Navegación principal",
    timeline: "Estrenos",
    alerts: "Avisos",
    profile: "Perfil",
  },

  // actions: textos de los botones de acción del shell.
  actions: {
    goToToday: "Ir a hoy",
    // profile: etiqueta accesible del avatar de perfil (placeholder; el perfil llega después).
    profile: "Perfil",
  },

  // types: etiquetas COMPARTIDAS del tipo de título. En español: antes vivían duplicadas y "a mano"
  // en ReleaseDetail y Stage (TYPE_LABELS locales); ahora hay una sola fuente para toda la app.
  types: {
    release: "Estreno",
    movie: "Película",
    series: "Serie",
  },

  // status: estados de estreno compartidos entre la timeline, el stage y el detalle.
  status: {
    // upcoming/upcomingShort: "por estrenar" en versión completa y compacta (chips pequeños).
    upcoming: "Próximamente",
    upcomingShort: "Próx.",
    // released: un título ya estrenado (lo usa la previa del Stage).
    released: "Estrenada",
    // dash: el guion de "sin dato" compartido (la tabla admin tiene el suyo propio con su doc).
    dash: "—",
  },

  // timeline: textos de la línea de tiempo (encabezado, leyenda, marcador HOY y los paquetes por día).
  // En español: junta todo el texto visible de la feature héroe del S6 para tenerlo en un solo lugar.
  timeline: {
    // headingTitle es el título de la sección "Línea de tiempo".
    headingTitle: "Línea de tiempo",
    // headingHint es la pista bajo el título que explica el comportamiento de los paquetes.
    headingHint: "Los paquetes crecen y brillan según la cantidad · marco según calificación",
    // legend: etiquetas de la leyenda de colores por categoría.
    legend: {
      cine: "Cine",
      streaming: "Streaming",
      tv: "Cadenas",
      indie: "Indie",
    },
    // nowLabel es el texto del marcador "HOY" (la fecha de hoy va concatenada por el componente).
    nowLabel: "HOY",
    // packageAriaLabel arma la etiqueta accesible de cada paquete por categoría de un día.
    // Ej. "Cine, 15 de junio: 3 estrenos, mejor calificación 8.6 en TMDB. Abrir.".
    packageAriaLabel: (
      categoryLabel: string,
      day: number,
      monthLabel: string,
      count: number,
      maxTmdb: string,
    ): string =>
      `${categoryLabel}, ${day} de ${monthLabel}: ${count} ${count === 1 ? "estreno" : "estrenos"}, ` +
      `mejor calificación ${maxTmdb} en TMDB. Abrir.`,
    // dayboxAriaLabel arma la etiqueta accesible de la CAJA DE DÍA (botón que expande/colapsa el día).
    // Ej. "Día 15, lun: 3 estrenos. Expandir." / "... Colapsar." según el estado actual.
    dayboxAriaLabel: (day: number, weekday: string, count: number, expanded: boolean): string =>
      `Día ${day}, ${weekday}: ${count} ${count === 1 ? "estreno" : "estrenos"}. ` +
      `${expanded ? "Colapsar" : "Expandir"}.`,
    // emptyTitle/emptyHint cubren el estado "sin estrenos en ningún mes".
    emptyTitle: "Sin estrenos por ahora",
    emptyHint: "No encontramos estrenos para los próximos meses. Vuelve a revisar más adelante.",
    // laneEmptyTitle arma el título del estado vacío de UN carril (ej. "Sin estrenos de cine por ahora").
    laneEmptyTitle: (laneLabel: string): string => `Sin ${laneLabel.toLowerCase()} por ahora`,
    // scrollRegionLabel etiqueta la región scrolleable horizontal para lectores de pantalla.
    scrollRegionLabel: "Línea de tiempo de estrenos, desplazable de forma horizontal",
    // dateRange: textos del FILTRO POR FECHA integrado en la espina (chips de rango rápido).
    dateRange: {
      // groupLabel etiqueta TODO el navegador de fecha para lectores de pantalla.
      groupLabel: "Navegador de fecha de la línea de tiempo",
      // granularityLabel etiqueta el toggle Mes/Semana.
      granularityLabel: "Granularidad: mes o semana",
      // month/week son las etiquetas del toggle de granularidad (cortas, no "Este mes"/"Esta semana").
      month: "Mes",
      week: "Semana",
      // prev/next*: etiquetas accesibles de las flechas ‹ › del stepper según la granularidad.
      prevWeek: "Semana anterior",
      nextWeek: "Semana siguiente",
      prevMonth: "Mes anterior",
      nextMonth: "Mes siguiente",
      // today/goToday: etiqueta visible y accesible del botón que vuelve al periodo actual.
      today: "Hoy",
      goToday: "Volver al periodo actual (hoy)",
    },
    // laneScrollRegionLabel etiqueta la región scrolleable de UN carril, nombrándolo para distinguir
    // las dos líneas de tiempo (cine / series y streaming) al navegar con lector de pantalla.
    laneScrollRegionLabel: (laneLabel: string): string =>
      `Línea de tiempo de ${laneLabel.toLowerCase()}, desplazable de forma horizontal`,
  },

  // notifications: textos del centro de avisos in-app (campana del topbar) de lo que el usuario sigue.
  notifications: {
    // bellAria arma la etiqueta accesible de la campana, indicando cuántos avisos sin leer hay.
    bellAria: (unread: number): string =>
      unread > 0 ? `Avisos: ${unread} sin leer` : "Avisos de lo que sigues",
    // panelTitle es el encabezado del panel desplegable.
    panelTitle: "Tus avisos",
    // empty es el estado sin avisos (no sigues nada que estrene/llegue pronto).
    empty: "Cuando sigas títulos, aquí te avisamos cuando estrenen y cuando lleguen a plataformas.",
    // releaseToday/releaseSoon/releasedAgo redactan el aviso de ESTRENO según los días a HOY.
    releaseToday: "¡Estrena hoy!",
    releaseTomorrow: "Estrena mañana",
    releaseSoon: (days: number): string => `Estrena en ${days} días`,
    releasedAgo: (days: number): string =>
      days === 1 ? "Estrenó ayer" : `Estrenó hace ${days} días`,
    // platformAvailable redacta el aviso de PLATAFORMAS (ya disponible en…).
    platformAvailable: (platforms: string): string => `Ya disponible en ${platforms}`,
    // kindRelease/kindPlatform etiquetan el TIPO del aviso (los "2 tiempos").
    kindRelease: "Estreno",
    kindPlatform: "En plataformas",
  },

  // search: textos del BUSCADOR de títulos del catálogo (campo + panel de resultados del topbar).
  // En español: el catálogo de la ventana vigente ronda el centenar y medio de títulos, así que la
  // búsqueda se resuelve EN EL NAVEGADOR filtrando la lista que la página ya trajo (sin pedirle nada
  // más al servidor). Estos textos cubren el botón que la abre, el campo, la ayuda y los dos estados
  // posibles: aún no escribiste nada (vacío) y escribiste algo que no coincide (sin resultados).
  search: {
    // openLabel es la etiqueta accesible del botón-lupa que abre el buscador.
    openLabel: "Buscar títulos",
    // panelLabel nombra el panel para los lectores de pantalla (es un diálogo pequeño).
    panelLabel: "Buscador de títulos",
    // inputLabel es la etiqueta accesible del campo de texto (la lupa sola no basta).
    inputLabel: "Buscar por título",
    // placeholder es la pista dentro del campo vacío.
    placeholder: "Escribe un título…",
    // close es la etiqueta accesible del botón de cerrar el panel.
    close: "Cerrar el buscador",
    // hint explica cuántos títulos hay disponibles para buscar (estado VACÍO: aún no se escribió nada).
    hint: (count: number): string =>
      count === 1
        ? "Hay 1 título en el catálogo cargado. Escribe para filtrarlo."
        : `Hay ${count} títulos en el catálogo cargado. Escribe para filtrarlos.`,
    // emptyCatalog cubre el caso en que la página no pudo traer catálogo: no hay nada donde buscar.
    emptyCatalog:
      "Todavía no hay títulos cargados donde buscar. Recarga la página para reintentar.",
    // noResults es el estado SIN RESULTADOS: se escribió algo que no coincide con ningún título.
    noResults: (query: string): string => `No encontramos títulos que coincidan con «${query}».`,
    // resultsLabel nombra la lista de resultados para los lectores de pantalla.
    resultsLabel: "Resultados de la búsqueda",
    // resultsCount se anuncia (sin ocupar espacio visible) cada vez que cambia el número de resultados.
    resultsCount: (count: number): string =>
      count === 1 ? "1 título encontrado" : `${count} títulos encontrados`,
    // resultAria arma la etiqueta accesible de cada resultado, ej. "Ver detalle de X. Película. 2026.".
    resultAria: (title: string, typeLabel: string, year: string): string =>
      year
        ? `Ver detalle de ${title}. ${typeLabel}. ${year}.`
        : `Ver detalle de ${title}. ${typeLabel}.`,
    // keyboardHint explica, en el propio panel, cómo moverse sin ratón (accesibilidad visible, no oculta).
    keyboardHint: "Flechas para moverte · Enter para abrir · Esc para cerrar",
  },

  // calendar: textos de la EXPORTACIÓN a calendario (.ics) de un estreno o de toda la watchlist.
  // En español: un archivo .ics es el formato estándar que entienden Google Calendar, Apple Calendario
  // y Outlook. Al descargarlo, el estreno queda como un evento de DÍA COMPLETO en el calendario del
  // usuario, así se entera aunque no abra la app. No se conecta con ninguna cuenta: solo se descarga
  // un archivo, que la persona abre con el calendario que ya usa.
  calendar: {
    // addButton es el botón de la ficha de detalle (añade ESE título al calendario).
    addButton: "Añadir a mi calendario",
    // addAria arma su etiqueta accesible, ej. "Añadir «X» a mi calendario (descarga un archivo .ics)".
    addAria: (title: string): string =>
      `Añadir «${title}» a mi calendario (descarga un archivo .ics)`,
    // unavailable explica por qué el botón no aparece: sin fecha de estreno no hay evento que crear.
    unavailable: "Este título aún no tiene fecha de estreno confirmada.",
    // exportWatchlistLabel/Hint/Button son el bloque del perfil que exporta TODA la watchlist.
    exportWatchlistLabel: "Tu calendario de estrenos",
    exportWatchlistHint:
      "Descarga los estrenos de «Quiero ver» como un archivo de calendario (.ics) y ábrelo con Google Calendar, Apple Calendario u Outlook.",
    exportWatchlistButton: "Exportar «Quiero ver» (.ics)",
    // exportWatchlistEmpty es el estado vacío: sin títulos guardados no hay nada que exportar.
    exportWatchlistEmpty:
      "Aún no tienes títulos en «Quiero ver» con fecha de estreno, así que no hay nada que exportar.",
    // eventDescription redacta el texto del evento del calendario (lo que se ve al abrirlo).
    eventDescription: (title: string): string =>
      `Estreno de ${title}. Ficha completa en The Story Keeper.`,
    // fileNameSingle/fileNameWatchlist son los nombres de archivo descargado (sin la extensión .ics).
    fileNameSingle: "estreno",
    fileNameWatchlist: "the-story-keeper-quiero-ver",
  },

  // seo: textos que ven los BUSCADORES y las redes sociales al compartir un enlace (no la interfaz).
  // En español: cuando alguien pega el enlace de un título en WhatsApp, X o Facebook, esas plataformas
  // leen estos textos para armar la tarjeta de vista previa (título, descripción e imagen).
  seo: {
    // detailTitle arma el título de la pestaña/tarjeta de un título, ej. "Las Horas Doradas · The Story Keeper".
    detailTitle: (title: string): string => `${title} · ${BRAND_FULL}`,
    // detailDescription arma la descripción cuando el título trae sinopsis (se recorta si es larga).
    detailDescription: (title: string, date: string, overview: string): string =>
      overview !== ""
        ? overview
        : `${title}. Estreno: ${date}. Todo lo que se sabe, en un solo lugar.`,
    // detailDescriptionNoDate: respaldo cuando no hay fecha ni sinopsis (nunca se inventa un dato).
    detailDescriptionNoDate: (title: string): string =>
      `${title}. Ficha completa: dónde verlo, reparto, tráiler y calificaciones.`,
    // notFoundTitle es el título de la pestaña cuando el enlace apunta a un título inexistente.
    notFoundTitle: (): string => `${DETAIL_NOT_FOUND_TITLE} · ${BRAND_FULL}`,
    // imageAlt arma el texto alternativo de la imagen de vista previa.
    imageAlt: (title: string): string => `Imagen de ${title}`,
  },

  // privacy: TODO el texto del aviso de privacidad (/privacidad), redactado para la Ley Federal de
  // Protección de Datos Personales en Posesión de los Particulares publicada en el Diario Oficial de la
  // Federación el 20 de marzo de 2025 y vigente desde el 21 de marzo de 2025 (la ley de 2010 quedó
  // abrogada). Con esa reforma desapareció el INAI: la vigilancia corresponde ahora a la Secretaría
  // Anticorrupción y Buen Gobierno. El texto vive aquí, como el resto de la interfaz, para que sea
  // traducible y para que se corrija en un solo lugar.
  privacy: {
    // pageTitle es el encabezado de la página y el título de la pestaña.
    pageTitle: "Aviso de privacidad",
    // back es el enlace de regreso a la línea de tiempo (primero en el orden de tabulación).
    back: "Volver a la línea de tiempo",
    // updatedLabel/updatedDate indican desde cuándo rige esta versión del aviso.
    updatedLabel: "Última actualización",
    updatedDate: "28 de julio de 2026",
    // intro resume, en lenguaje llano, de qué trata el documento.
    intro:
      "Este aviso explica qué datos personales trata The Story Keeper, para qué los usa y cómo puedes " +
      "controlarlos. Está redactado conforme a la Ley Federal de Protección de Datos Personales en Posesión " +
      "de los Particulares publicada en el Diario Oficial de la Federación el 20 de marzo de 2025 y vigente " +
      "desde el 21 de marzo de 2025.",
    // sections son los apartados del aviso, en el orden en que se leen. Cada uno tiene su título,
    // sus párrafos y (cuando aplica) una lista de puntos; las listas vacías simplemente no se dibujan.
    sections: [
      {
        heading: "1. Quién es el responsable",
        paragraphs: [
          "El responsable del tratamiento de tus datos personales es The Story Keeper, un proyecto NO comercial " +
            "de agregación de estrenos de cine, streaming y televisión para México. No vende publicidad, no cobra " +
            "suscripciones y no comercializa datos personales de ninguna forma.",
          "Al ser un proyecto sin actividad comercial, no opera un domicilio de atención al público: todos los " +
            "trámites sobre tus datos se resuelven dentro de la propia aplicación, con los controles que se " +
            "describen más abajo.",
        ],
        bullets: [],
      },
      {
        heading: "2. Qué datos recabamos",
        paragraphs: [
          "Solo tratamos los datos mínimos para que la aplicación funcione. En concreto:",
        ],
        bullets: [
          "Correo electrónico: identifica tu cuenta y es con lo que inicias sesión.",
          "Nombre visible: el nombre con el que te saludamos en la aplicación. Puedes escribir el que quieras; " +
            "no verificamos que sea tu nombre legal.",
          "Contraseña, guardada siempre como un «hash»: una huella irreversible calculada a partir de tu " +
            "contraseña. Nadie —tampoco quien opera el servicio— puede leer tu contraseña original.",
          "Tu actividad dentro de la aplicación: la lista «Quiero ver», los títulos marcados como vistos, tus " +
            "calificaciones y reseñas, y tus ajustes (tema, idioma, plataformas y géneros favoritos).",
          "Tu dirección IP, únicamente de forma temporal, para limitar los intentos de inicio de sesión y " +
            "frenar ataques automatizados contra las cuentas.",
        ],
      },
      {
        heading: "3. Qué datos NO recabamos",
        paragraphs: [
          "No recabamos datos personales sensibles: ni origen racial o étnico, ni estado de salud, ni información " +
            "genética o biométrica, ni creencias religiosas, filosóficas o morales, ni afiliación sindical, ni " +
            "opiniones políticas, ni preferencia sexual.",
          "Tampoco pedimos datos financieros o de pago (el proyecto no cobra nada), ni la ubicación de tu " +
            "dispositivo, ni acceso a tu cámara, micrófono, contactos o archivos.",
        ],
        bullets: [],
      },
      {
        heading: "4. Para qué usamos tus datos",
        paragraphs: ["Tratamos tus datos exclusivamente para estas finalidades:"],
        bullets: [
          "Crear tu cuenta, identificarte al iniciar sesión y mantener tu sesión abierta.",
          "Guardar y mostrarte tu perfil: «Quiero ver», títulos vistos, reseñas y ajustes, en cualquier " +
            "dispositivo donde entres con tu cuenta.",
          "Avisarte dentro de la aplicación cuando un título que sigues se estrena o llega a una plataforma.",
          "Proteger las cuentas: detectar y limitar intentos de acceso automatizados o abusivos.",
        ],
      },
      {
        heading: "5. Transferencias de datos",
        paragraphs: [
          "No vendemos, ni rentamos, ni compartimos tus datos personales con terceros para fines publicitarios " +
            "ni de mercadotecnia.",
          "Los únicos terceros que pueden llegar a almacenar o procesar tus datos son los proveedores de " +
            "infraestructura que hacen funcionar el servicio (alojamiento del servidor y de la base de datos). " +
            "Actúan como encargados: procesan los datos por cuenta nuestra, siguiendo nuestras instrucciones, " +
            "y no pueden usarlos para fines propios.",
          "Fuera de ese supuesto, solo divulgaríamos datos si una autoridad competente lo requiriera conforme " +
            "a la ley.",
        ],
        bullets: [],
      },
      {
        heading: "6. Tus derechos ARCO y cómo ejercerlos aquí",
        paragraphs: [
          "La ley te reconoce cuatro derechos sobre tus datos personales —Acceso, Rectificación, Cancelación y " +
            "Oposición, conocidos como derechos ARCO—. En The Story Keeper no necesitas mandar una solicitud ni " +
            "esperar respuesta: cada derecho se ejerce con un control dentro de la aplicación. Donde hoy no " +
            "existe un control directo —solo ocurre con el correo y el nombre visible de la cuenta— se dice " +
            "expresamente en el punto correspondiente, con la alternativa que sí está disponible.",
        ],
        bullets: [
          "ACCESO — saber qué datos tenemos de ti: en «Mi perfil» → «Ajustes» → «Tus datos», el botón «Exportar " +
            "perfil (JSON)» descarga un archivo con tu perfil completo (listas, reseñas y ajustes), legible por " +
            "cualquier editor de texto. Los demás datos de tu cuenta los conoces de sobra porque los escribiste " +
            "tú al registrarte: tu correo y tu nombre visible, que la aplicación te muestra en «Mi perfil». La " +
            "contraseña no se puede mostrar ni exportar: solo guardamos su huella irreversible.",
          "RECTIFICACIÓN — corregir lo que esté mal o desactualizado: tus listas, tus reseñas y tus ajustes se " +
            "editan en cualquier momento desde «Mi perfil» y el cambio se aplica de inmediato. Tu contraseña se " +
            "cambia en «Mi perfil» → «Ajustes» → «Tu cuenta» → «Cambiar la contraseña». El correo y el nombre " +
            "visible de la cuenta todavía NO se pueden editar dentro de la aplicación: mientras esa opción no " +
            "exista, la vía disponible es borrar la cuenta y crear otra con los datos correctos.",
          "CANCELACIÓN — eliminar tus datos: en «Mi perfil» → «Ajustes» → «Tu cuenta», el botón «Borrar mi " +
            "cuenta» elimina del servidor, de forma definitiva, tu correo, tu nombre visible, la huella de tu " +
            "contraseña, el perfil que tu cuenta tuviera guardado y todas tus sesiones abiertas. Aparte, en " +
            "«Tus datos», «Borrar datos locales» elimina el perfil guardado en ESTE navegador. Son dos " +
            "controles porque son dos sitios distintos donde viven tus datos.",
          "OPOSICIÓN — dejar de darnos datos: puedes usar la línea de tiempo sin crear cuenta; sin sesión no " +
            "tratamos ningún dato que te identifique.",
        ],
      },
      {
        heading: "7. Revocación del consentimiento",
        paragraphs: [
          "Puedes retirar en cualquier momento el consentimiento que diste para tratar tus datos: basta con " +
            "borrar tu cuenta y tus datos locales con los controles descritos en el punto anterior. A partir de " +
            "ese momento dejamos de tratarlos; el efecto es que pierdes tu perfil (listas, reseñas y ajustes), " +
            "porque justamente son esos datos los que lo forman.",
        ],
        bullets: [],
      },
      {
        heading: "8. Seguridad y conservación",
        paragraphs: [
          "Aplicamos medidas de seguridad razonables para proteger tus datos: las contraseñas se guardan solo " +
            "como hash, el tráfico viaja cifrado y las claves de los servicios externos nunca salen del servidor " +
            "(el navegador jamás las recibe).",
          "Conservamos tus datos mientras tu cuenta exista. Cuando la borras, se eliminan; las direcciones IP " +
            "usadas para limitar intentos de acceso se descartan poco después de registrarse, porque solo sirven " +
            "para esa ventana de tiempo.",
        ],
        bullets: [],
      },
      {
        heading: "9. Cambios a este aviso",
        paragraphs: [
          "Si cambiamos la forma en que tratamos tus datos, actualizaremos este aviso y su fecha de última " +
            "actualización. Esta página siempre muestra la versión vigente, así que puedes consultarla cuando " +
            "quieras desde el enlace del pie de página.",
        ],
        bullets: [],
      },
      {
        heading: "10. Autoridad en materia de datos personales",
        paragraphs: [
          "Si consideras que tus derechos no fueron atendidos, puedes acudir a la autoridad competente. Con la " +
            "reforma de 2025 desapareció el Instituto Nacional de Transparencia, Acceso a la Información y " +
            "Protección de Datos Personales (INAI); la vigilancia de la protección de datos en posesión de " +
            "particulares corresponde ahora a la Secretaría Anticorrupción y Buen Gobierno del Gobierno de México.",
        ],
        bullets: [],
      },
    ],
  },

  // appError: textos del "muro de contención" de errores de interfaz (error boundaries de Next).
  // En español: si un componente revienta en tiempo de ejecución, en vez de una pantalla en blanco
  // mostramos este aviso claro con un botón de reintentar (vuelve a montar el árbol que falló).
  appError: {
    title: "Algo se rompió en esta pantalla",
    hint: "No es tu culpa: un componente falló al dibujarse. Puedes reintentar; si persiste, recarga la página.",
    retry: "Reintentar",
  },

  // tiers: nombres en es-MX de los cuatro niveles de rareza (derivados de la calificación de TMDB).
  tiers: {
    legendary: "Legendario",
    epic: "Épico",
    rare: "Raro",
    common: "Común",
  },

  // stage: textos del FLUJO de 3 niveles (S7) — el overlay con el modal de categoría y el detalle.
  // En español: junta en un solo lugar TODO el texto visible del overlay "stage": los rótulos del
  // modal de categoría (encabezado, subtítulo, tarjetas), los botones de cerrar/retroceder y las
  // etiquetas accesibles de cada diálogo, para mantener es-MX consistente y "listo para i18n".
  stage: {
    // catDialogLabel arma la etiqueta accesible (aria-label) del DIÁLOGO de categoría (nivel 1).
    // Ej. "Estrenos de Cine · 15 de junio". Lo anuncia el lector de pantalla al abrir el modal.
    catDialogLabel: (categoryLabel: string, day: number, monthLabel: string): string =>
      `Estrenos de ${categoryLabel} · ${day} de ${monthLabel}`,
    // catSubtitle arma el subtítulo del modal de categoría, ej. "15 junio · 3 estrenos".
    catSubtitle: (day: number, monthLabel: string, count: number): string =>
      `${String(day).padStart(2, "0")} ${monthLabel} · ${count} ${count === 1 ? "estreno" : "estrenos"}`,
    // cardMeta arma el meta de cada tarjeta del carrusel: "Película · Drama" o solo el tipo si no hay género.
    cardMeta: (typeLabel: string, firstGenre: string): string =>
      firstGenre ? `${typeLabel} · ${firstGenre}` : typeLabel,
    // cardAriaLabel arma la etiqueta accesible del BOTÓN de cada tarjeta del carrusel.
    // Ej. "Ver detalle de Las Horas Doradas. Película. 8.6 en TMDB.".
    cardAriaLabel: (title: string, typeLabel: string, tmdb: string): string =>
      `Ver detalle de ${title}. ${typeLabel}. ${tmdb} en TMDB.`,
    // carouselLabel arma la etiqueta accesible del CARRUSEL vertical de títulos de la categoría.
    carouselLabel: (categoryLabel: string): string => `Títulos de ${categoryLabel}`,
    // openDetail es el texto del botón que expande la PREVIA al detalle completo del título activo.
    openDetail: "Ver detalle completo",
    // close es el texto accesible del botón de cerrar (la "✕" es decorativa).
    close: "Cerrar",
    // back es el texto del botón que vuelve del detalle a la PREVIA (dentro del mismo modal).
    back: "Volver",
    // emptyCategory cubre el caso (defensivo) de un modal de categoría sin estrenos que mostrar.
    emptyCategory: "No hay estrenos en esta categoría con el filtro activo.",

    // ----- Textos de la FICHA QUE SE ESTÁ TRAYENDO -----
    //
    // Por qué existen, en español: la lista de estrenos ya no carga la ficha completa de cada título
    // (era el 84 % del peso de la página). La ficha se pide al abrirla, y ese instante necesita
    // decirse con palabras: qué se está trayendo, qué pasó si no llegó y cómo volver a intentarlo.
    // Sin estos textos, la espera se vería como un hueco vacío y un fallo se vería como "esta
    // película no tiene tráiler", que es mentira.

    // detailLoading es el aviso mientras llega la ficha completa del título abierto.
    detailLoading: "Cargando la ficha…",
    // trailerLoading es el aviso, sobre la portada, mientras llega el tráiler del título abierto.
    trailerLoading: "Cargando el tráiler…",
    // detailErrorRetry es el texto del botón que vuelve a pedir la ficha que no llegó.
    detailErrorRetry: "Reintentar",
  },

  // home: textos de la página principal (estados de error y carga).
  home: {
    errorTitle: "No se pudieron cargar los estrenos",
    errorRetryHint:
      "Hubo un problema al conectarse con el servidor. Inténtalo de nuevo en un momento.",
    // errorRetry es el texto del botón/enlace accionable para reintentar la carga.
    errorRetry: "Reintentar",
    // partialWarning: aviso NO bloqueante cuando ALGÚN mes falló pero otros sí cargaron. En español:
    // sin este aviso, un mes caído se veía como "no hay estrenos en ese mes" (dato incompleto
    // silencioso, que engaña). El aviso aclara que faltan datos y que recargar puede completarlos.
    partialWarning:
      "Algunos datos no se pudieron cargar: la línea de tiempo puede verse incompleta. Recarga la página para reintentar.",
    // loading: texto del estado de carga de la home (skeleton).
    loading: "Cargando estrenos…",
    // pageHeading es el ENCABEZADO DE NIVEL 1 de la portada.
    //
    // Por qué existe y por qué no se ve, en español: toda pantalla necesita un encabezado principal
    // que diga de qué va. Es lo primero que anuncia un lector de pantalla y lo que permite saltar
    // directamente al contenido; sin él, quien navega escuchando aterriza en una página sin nombre.
    // La portada no tenía ninguno: la marca de la barra superior es un enlace, no un encabezado.
    // Aquí se escribe uno de verdad y se deja fuera de la vista (no oculto: los lectores de pantalla
    // sí lo leen), porque la portada ES la línea de tiempo a pantalla completa y un título encima le
    // robaría el sitio sin decirle nada nuevo a quien la está viendo.
    pageHeading: "Línea de tiempo de estrenos",
  },

  // admin: textos de la pantalla Admin (stub) — la tabla read-only del seed (S8).
  // En español: junta TODO el texto visible de la pantalla interna /admin, que es un PLACEHOLDER de la
  // futura UI de ingesta de Fase 1. En Fase 0 solo muestra, en una tabla de SOLO LECTURA, lo que trae
  // el seed (no se edita nada). Las columnas de CURADURÍA MANUAL (Cadenas, Doblaje, Subtítulos) llevan
  // un distintivo "Fase 1" porque esa futura UI será la que las gobierne. Mantener es-MX y listo para i18n.
  admin: {
    // title es el encabezado de la pantalla; "MDM 7mo" identifica el producto.
    title: "Admin · The Story Keeper",
    // intro explica, en es-MX, qué es esta pantalla: solo lectura y placeholder de la ingesta de Fase 1.
    intro:
      "Pantalla interna de SOLO LECTURA. Es un adelanto (placeholder) de la futura interfaz de ingesta de la Fase 1, " +
      "donde se podrán cargar y curar los estrenos. Por ahora únicamente muestra lo que trae el seed; aquí no se edita nada.",
    // tableCaption describe la tabla para lectores de pantalla (es la <caption> semántica).
    tableCaption: "Tabla de solo lectura con los estrenos de la ventana vigente, México.",
    // scrollRegionLabel etiqueta la región scrolleable horizontal de la tabla para lectores de pantalla.
    scrollRegionLabel: "Tabla de estrenos del seed, desplazable de forma horizontal",
    // phaseBadge es el distintivo pequeño que marca las columnas de curaduría manual (Fase 1).
    phaseBadge: "Fase 1",
    // phaseBadgeTitle es el texto descriptivo (tooltip/aria) del distintivo "Fase 1".
    phaseBadgeTitle: "Columna de curaduría manual: la gobernará la UI de ingesta de la Fase 1.",
    // legend es la leyenda corta bajo la tabla que explica el distintivo de las columnas de Fase 1.
    // En español: antes nombraba también «Doblaje» y «Subtítulos». Esas dos columnas se retiraron junto
    // con los campos del contrato que las alimentaban: llevaban toda su vida vacías y no existe ninguna
    // fuente de datos que pudiera llenarlas, así que anunciarlas como trabajo de una fase futura era
    // prometer algo que nadie iba a entregar.
    legend:
      "La columna marcada con «Fase 1» (Cadenas) es de curaduría manual: " +
      "la interfaz de ingesta de la Fase 1 será la encargada de gobernarla.",
    // columns son los encabezados (<th>) de cada columna de la tabla, en es-MX.
    columns: {
      title: "Título",
      type: "Tipo",
      category: "Categoría",
      date: "Fecha",
      tmdb: "TMDB",
      imdb: "IMDb",
      rottenTomatoes: "RT",
      platforms: "Plataformas",
      networks: "Cadenas",
      cast: "Reparto",
    },
    // typeMovie / typeSeries son las etiquetas legibles del tipo de título (película / serie).
    typeMovie: "Película",
    typeSeries: "Serie",
    // emptyTitle / emptyHint cubren el estado "el seed no trajo estrenos".
    emptyTitle: "Sin estrenos en el seed",
    emptyHint:
      "El seed no devolvió estrenos para la ventana vigente. Genera o revisa el seed y vuelve a intentarlo.",
    // errorTitle / errorHint cubren el estado de error duro (ambos meses fallaron al consultar el backend).
    errorTitle: "No se pudieron cargar los estrenos",
    errorHint:
      "Hubo un problema al conectarse con el servidor del catálogo. Verifica que el backend esté en marcha e inténtalo de nuevo.",
    // dash es el guion que mostramos cuando un dato no existe (calificación o lista vacía).
    dash: "—",
    // castCountAria arma la etiqueta accesible del conteo de reparto, ej. "3 integrantes en el reparto".
    castCountAria: (count: number): string =>
      `${count} ${count === 1 ? "integrante" : "integrantes"} en el reparto`,
    // tmdbAria arma la etiqueta accesible de la calificación TMDB con su rareza, ej. "8.6 en TMDB, rareza Legendario".
    tmdbAria: (score: string, tierLabel: string): string => `${score} en TMDB, rareza ${tierLabel}`,
  },

  // detail: textos de la pantalla de detalle (deep-link /titulo/[id]) y del DETALLE RICO (S7).
  // En español: junta el texto visible del detalle completo —el mismo que se reutiliza dentro del
  // modal del flujo de 3 niveles— para tenerlo en un solo lugar (es-MX). Cubre los rótulos de cada
  // sección, el estado "no encontrado" y los textos accesibles del tráiler y los enlaces de búsqueda.
  detail: {
    back: "Volver a estrenos",
    notFoundTitle: DETAIL_NOT_FOUND_TITLE,
    notFoundHint:
      "No encontramos el título que buscas. Es posible que el enlace esté roto o que ya no esté disponible.",
    synopsisLabel: "Sinopsis",
    noSynopsis: "Sin sinopsis disponible.",
    // synopsisForeignNotice: el aviso que acompaña a una sinopsis que NO está en español.
    //
    // En español: TMDB no tiene todas las fichas traducidas al español (uno de cada cuatro estrenos
    // llegaba sin una línea de texto). Cuando no existe ni la versión mexicana ni ninguna otra en
    // español, se muestra la que hay —normalmente en inglés— y se dice claramente de dónde salió. La
    // alternativa era dejar el hueco vacío o colar un párrafo en inglés como si fuera nuestro: lo
    // primero esconde información que existe y lo segundo parece un descuido de traducción.
    synopsisForeignNotice: "Sinopsis en su idioma original · aún no traducida al español",

    // Rótulos de las secciones del detalle rico (en el ORDEN en que aparecen en pantalla).
    referencesLabel: "Referencias",
    galleryLabel: "Verla en acción",
    complementaryLabel: "Video complementario",
    whereToWatchLabel: "Dónde verlo",
    sagaLabel: "De la saga",
    // seasonsLabel: el mismo bloque cuando lo que hay dentro son las TEMPORADAS de una serie.
    //
    // En español: el catálogo guarda las dos cosas en el mismo sitio —las otras entregas de una saga
    // y las temporadas de una serie— y hasta ahora la ficha llamaba "saga" a las dos. Llamar "saga"
    // a la lista de temporadas de una sola serie es sencillamente falso, y encima delante del propio
    // dato que lo desmiente ("Temporada 1", "Temporada 2"). Ver isSeasonCollection en lib/saga.
    seasonsLabel: "Temporadas",
    // connectionsLabel: rótulo de la sección de conexiones (otros títulos relacionados del catálogo).
    connectionsLabel: "Conexiones",
    // scheduleLabel: rótulo de la sección del CALENDARIO DE EMISIÓN (fechas reales de episodios).
    scheduleLabel: "Calendario de emisión",
    // scheduleUpcoming/scheduleLatest: título de la lista de entregas (próximas, o últimas si terminó).
    scheduleUpcoming: "Próximas entregas",
    scheduleLatest: "Últimas entregas",
    // scheduleUnnamedEpisode: respaldo cuando TMDB no trae el nombre del episodio.
    scheduleUnnamedEpisode: "Episodio",
    // scheduleDayAria: etiqueta accesible de un día CON entregas del mini-calendario.
    scheduleDayAria: (day: number, monthName: string, count: number): string =>
      `${day} de ${monthName}: ${count} ${count === 1 ? "entrega" : "entregas"}`,
    // scheduleMonthAria: etiqueta accesible de la cuadrícula de un mes del calendario.
    scheduleMonthAria: (monthName: string): string => `Calendario de ${monthName}`,
    // openFullPage: enlace del modal de detalle hacia la página completa del título (/titulo/[id]).
    openFullPage: "Ver página completa",
    // modalClose: etiqueta accesible del botón de cerrar el modal de detalle completo.
    modalClose: "Cerrar detalle",
    // Motivos de conexión (etiqueta en la tarjeta de cada relacionado).
    reasonSaga: "Misma saga",
    reasonDirector: "Mismo director",
    reasonCast: "Mismo reparto",
    reasonGenre: "Relacionado",
    // connectionAria: etiqueta accesible del enlace a un título relacionado.
    connectionAria: (title: string): string => `Ver detalle de ${title}`,
    // watchOnAria: etiqueta accesible del chip de plataforma clicable (abre búsqueda del título allí).
    watchOnAria: (title: string, platform: string): string => `Buscar ${title} en ${platform}`,
    // sagaSearchAria: etiqueta accesible del enlace de búsqueda de una entrada de saga (dentro del modal).
    sagaSearchAria: (title: string): string => `Buscar ${title}`,
    // sagaOpenAria: etiqueta accesible de la tarjeta de saga clicable (abre el modal de la entrada).
    sagaOpenAria: (title: string): string => `Ver información de ${title}`,
    // galleryOpenAria / lightboxClose: accesibilidad de la galería ampliable (lightbox).
    galleryOpenAria: (label: string): string => `Ampliar imagen: ${label}`,
    lightboxClose: "Cerrar imagen ampliada",
    castLabel: "Reparto",
    crewLabel: "Dirección y staff",
    languagesLabel: "Idiomas",

    // Etiquetas de las filas de "Dónde verlo" (cada canal por el que se puede ver el estreno).
    whereCine: "Cine",
    whereStreaming: "Streaming",
    whereTv: "Cadenas",
    // inTheaters: chip que se muestra cuando no hay plataformas ni cadenas (estreno solo en salas).
    inTheaters: "En salas",

    // languageOriginal arma el chip del idioma original, ej. "Original: Inglés".
    languageOriginal: (language: string): string => `Original: ${language}`,

    // Textos del tráiler/video (componente YouTubeEmbed): reproducir, caption y estado no disponible.
    trailerCaption: "Tráiler · YouTube",
    // playTrailerAria arma la etiqueta accesible del botón de reproducir, ej. "Reproducir tráiler de X".
    playTrailerAria: (title: string): string => `Reproducir ${title}`,
    // embedTitle arma el título accesible del iframe de YouTube, ej. "Reproductor de YouTube: X".
    embedTitle: (title: string): string => `Reproductor de YouTube: ${title}`,
    // trailerUnavailable: estado digno para cuando el estreno no tiene tráiler en ninguna parte.
    // En español: NO es un error ni un fallo del catálogo. Se midió: casi 4 de cada 10 títulos no
    // tienen ningún tráiler en TMDB porque no existe el video. Por eso el texto es informativo y
    // sereno, sin botón de reproducir y sin enlace a ningún lado: prometer un video que no existe
    // sería peor que decir la verdad.
    trailerUnavailable: "Tráiler no disponible",
    // trailerUnavailableHint: la explicación honesta que acompaña al estado anterior.
    trailerUnavailableHint: "Este título aún no tiene tráiler publicado.",
    // trailerFailed / trailerFailedHint: el TERCER estado del reproductor, y el que faltaba.
    //
    // Por qué existe, en español: "no hay tráiler" y "no pudimos averiguar si lo hay" son dos cosas
    // distintas, y hasta ahora se pintaban igual. Con el servidor caído, la ficha afirmaba a la vez
    // dos cosas contradictorias: arriba, "este título aún no tiene tráiler publicado" —falso, sí lo
    // tiene— y abajo, "no pudimos cargar la ficha". Como el 22,7 % del catálogo de verdad no tiene
    // tráiler, la persona no tenía forma de distinguir un caso del otro. Este texto sí distingue: no
    // afirma nada sobre el video, dice lo único que se sabe, que es que la ficha no llegó.
    trailerFailed: "No se pudo cargar el tráiler",
    trailerFailedHint:
      "No pudimos traer la ficha de este título, así que todavía no sabemos si tiene tráiler. Reintenta abajo.",
    // complementaryUnavailable: estado elegante cuando no hay video complementario.
    complementaryUnavailable: "Video complementario no disponible",

    // AVISOS del tráiler: qué se le dice a la persona cuando el video NO está en su idioma.
    //
    // En español: esta es la petición explícita del dueño llevada a la pantalla. Cuando la cadena de
    // respaldo acaba dando un video en otro idioma, la interfaz LO DICE. Nunca se cuela un tráiler en
    // inglés haciéndolo pasar por el que la persona pidió.
    //
    // Sobre "subtítulos automáticos": se le piden a YouTube los subtítulos en el idioma del perfil,
    // pero NO se puede comprobar que existan de verdad. El servicio público que listaba los
    // subtítulos de un video dejó de responder (devuelve vacío), y el único sitio donde queda ese
    // dato exige credenciales del dueño del canal. Así que se avisa sin prometer: es la diferencia
    // entre informar y mentir.
    trailerNoticeEnglish: "Tráiler en inglés · subtítulos automáticos",
    trailerNoticeOriginal: "Tráiler en su idioma original",

    // Textos accesibles de los enlaces de búsqueda externos (Referencias) y de la galería vacía.
    // searchOnAria arma la etiqueta del enlace, ej. "Buscar «X» en TMDB (se abre en otra pestaña)".
    searchOnAria: (title: string, source: string): string =>
      `Buscar «${title}» en ${source} (se abre en otra pestaña)`,
    // noGallery: mensaje cuando aún no hay imágenes de galería (Fase 0, sin imágenes reales).
    noGallery: "Galería no disponible todavía.",

    // Nombres de las fuentes de calificación (se muestran como rótulo de cada tarjeta de Referencias).
    sourceTmdb: "TMDB",
    sourceImdb: "IMDb",
    sourceRottenTomatoes: "Rotten Tomatoes",
    sourceMetacritic: "Metacritic",

    // ENLACES DE SALIDA de la ficha: las personas y la saga dejan de ser texto muerto.
    //
    // En español: hasta ahora, en la ficha de una película, el nombre de un actor era texto y nada
    // más. Se acababa el camino ahí. Estos textos acompañan a los enlaces que convierten a cada
    // persona y a cada saga en un sitio al que se puede ir.
    //
    // Importante: el enlace SOLO aparece cuando se sabe de quién se trata (cuando el catálogo trae su
    // número de identidad). Si no se sabe, se enseña el nombre sin enlace. Un enlace que lleva a una
    // página vacía es peor que no tener enlace.
    personLinkAria: (name: string): string => `Ver la ficha de ${name}`,
    // sagaPageLink: el enlace desde la ficha de un título a la página de su saga.
    sagaPageLink: "Ver la saga completa",
    sagaPageLinkAria: (sagaName: string): string => `Ver la página de la saga ${sagaName}`,
  },

  // person: textos de la página de una PERSONA (/persona/[id]).
  //
  // En español: la página que faltaba para que un actor o un director dejaran de ser un callejón sin
  // salida. Reúne todo lo que esa persona tiene DENTRO de este catálogo y con quién coincide.
  person: {
    back: "Volver a estrenos",
    notFoundTitle: "Persona no encontrada",
    notFoundHint:
      "No encontramos a esta persona en el catálogo. Es posible que el enlace esté roto o que sus títulos ya no estén en la ventana de meses que mostramos.",
    // inCatalogLabel: el rótulo de la sección con sus títulos DENTRO del catálogo.
    inCatalogLabel: "En este catálogo",
    // inCatalogCount describe cuántos títulos suyos hay aquí (singular y plural bien resueltos).
    inCatalogCount: (count: number): string =>
      count === 1 ? "1 título en el catálogo" : `${count} títulos en el catálogo`,
    // rolesLabel: el rótulo del bloque que resume qué hace esta persona (actuar, dirigir, escribir…).
    rolesLabel: "Qué hace",
    // collaboratorsLabel: el rótulo de la sección de gente con la que coincide más de una vez.
    collaboratorsLabel: "Coincide habitualmente con",
    // collaboratorsHint explica QUÉ significa esa lista, para que nadie la lea como algo que no es.
    collaboratorsHint:
      "Personas que aparecen con ella en más de un título de este catálogo. No implica que trabajen juntas fuera de aquí.",
    // collaboratorShared arma el pie de cada colaborador ("en 3 títulos").
    collaboratorShared: (count: number): string =>
      count === 1 ? "en 1 título" : `en ${count} títulos`,
    // episodes dice en cuántos episodios participa dentro de una serie.
    // En español: es lo que distingue a un protagonista ("en 73 episodios") de alguien que pasó por
    // un capítulo. Solo se enseña cuando el dato existe de verdad.
    episodes: (count: number): string => (count === 1 ? "en 1 episodio" : `en ${count} episodios`),
    // trailerLabel: el rótulo del tráiler que se enseña en la página (el de uno de sus títulos).
    trailerLabel: "Tráiler",
    // trailerOf explica DE QUÉ es el tráiler, porque una persona no tiene tráiler propio y fingir que
    // sí lo tiene sería confundir a quien lo ve.
    trailerOf: (title: string): string => `Tráiler de ${title}`,
    // outsideCatalogLabel / outsideCatalogHint: la frontera declarada de esta página.
    //
    // En español: el documento de diseño contemplaba enseñar además la filmografía COMPLETA de la
    // persona según TMDB. Eso exige una operación nueva del servidor que hoy no existe, así que la
    // página dice con todas las letras qué alcance tiene, en vez de dejar que alguien crea que estos
    // son todos los trabajos de esa persona. Prometer menos y cumplirlo.
    outsideCatalogLabel: "Fuera de este catálogo",
    outsideCatalogHint:
      "Aquí solo aparece su trabajo dentro de la ventana de meses que cubre The Story Keeper. Su filmografía completa vive en TMDB.",
    // searchOnTmdb: el enlace honesto a TMDB para ver el resto de su trabajo.
    searchOnTmdb: "Ver su ficha en TMDB",
    searchOnTmdbAria: (name: string): string =>
      `Ver la ficha de ${name} en TMDB (se abre en otra pestaña)`,
    // departmentLabels traduce el área de trabajo que TMDB entrega en inglés.
    //
    // En español: TMDB manda "Acting", "Directing", "Writing"… Es una lista cerrada y estable, así
    // que se traduce aquí en vez de enseñarle al usuario una palabra en inglés en un producto es-MX.
    // Lo que no esté en la lista se muestra tal cual: inventar una traducción sería peor.
    departmentLabels: {
      Acting: "Reparto",
      Directing: "Dirección",
      Writing: "Guion",
      Production: "Producción",
      Sound: "Sonido",
      Camera: "Fotografía",
      Editing: "Montaje",
      Art: "Dirección de arte",
      "Costume & Make-Up": "Vestuario y maquillaje",
      "Visual Effects": "Efectos visuales",
      Crew: "Equipo técnico",
      Lighting: "Iluminación",
      Actors: "Reparto",
    } as Record<string, string>,
  },

  // credits: los OFICIOS con los que se firma una película, traducidos al español.
  //
  // POR QUÉ ESTA TABLA EXISTE, en español: el catálogo entrega el puesto de cada persona del equipo
  // en INGLÉS, siempre, y hasta ahora se enseñaba tal cual. El resultado era una pantalla que decía
  // "Qué hace: Dirección · Guion" —traducido— y justo debajo listaba "Screenplay", "Cinematography",
  // "Art Direction" y "Camera Operator" en inglés. La misma información, en dos idiomas, a dos
  // centímetros de distancia. En la ficha de un título pasaba igual con "Director of Photography" y
  // "Costume Designer". El producto está en español de México y esto es texto que ve el usuario.
  //
  // QUÉ ENTRA Y QUÉ NO, que es la decisión importante: entran los oficios FRECUENTES, los que de
  // verdad aparecen en el catálogo (se contaron: hay 218 puestos distintos, y los ochenta de esta
  // tabla cubren la inmensa mayoría de las apariciones). Lo que NO esté aquí se enseña TAL CUAL, en
  // inglés. Es deliberado: entre enseñar "Draughtsman" —que quien trabaja en cine reconoce— y
  // enseñar una traducción inventada que no significa nada en ninguna parte, el original es mejor.
  // Traducir de más es una forma de mentir.
  //
  // La comparación se hace por el texto EXACTO del puesto, no por parecido, precisamente para que un
  // puesto que no esté en la tabla no acabe traducido por el de al lado.
  credits: {
    jobLabels: {
      Director: "Dirección",
      "Co-Director": "Codirección",
      "Series Director": "Dirección de la serie",
      "Animation Director": "Dirección de animación",
      "Second Unit Director": "Dirección de segunda unidad",
      "Assistant Director": "Asistencia de dirección",
      "First Assistant Director": "Primera asistencia de dirección",
      "Second Assistant Director": "Segunda asistencia de dirección",
      Creator: "Creación",
      "Original Series Creator": "Creación original de la serie",

      Writer: "Guion",
      Screenplay: "Guion",
      Script: "Guion",
      Story: "Historia",
      "Original Story": "Historia original",
      Screenstory: "Argumento",
      Characters: "Personajes",
      Novel: "Novela",
      Book: "Libro",
      "Comic Book": "Cómic",
      "Graphic Novel": "Novela gráfica",
      "Theatre Play": "Obra de teatro",
      Author: "Autoría",
      Adaptation: "Adaptación",
      "Original Film Writer": "Guion de la película original",
      "Series Composition": "Composición de la serie",

      Producer: "Producción",
      "Executive Producer": "Producción ejecutiva",
      "Co-Executive Producer": "Coproducción ejecutiva",
      "Co-Producer": "Coproducción",
      "Associate Producer": "Producción asociada",
      "Supervising Producer": "Supervisión de producción",
      "Consulting Producer": "Producción consultora",
      "Creative Producer": "Producción creativa",
      "Line Producer": "Jefatura de producción",
      "Production Manager": "Gerencia de producción",
      "Unit Production Manager": "Gerencia de producción de unidad",
      "Production Supervisor": "Supervisión de producción",
      "Production Coordinator": "Coordinación de producción",
      "Production Assistant": "Asistencia de producción",
      "Post Production Supervisor": "Supervisión de postproducción",

      "Director of Photography": "Dirección de fotografía",
      "Assistant Director of Photography": "Asistencia de dirección de fotografía",
      "Second Unit Director of Photography": "Dirección de fotografía de segunda unidad",
      "Aerial Director of Photography": "Dirección de fotografía aérea",
      "Additional Director of Photography": "Dirección de fotografía adicional",
      Cinematography: "Fotografía",
      "Camera Operator": "Operación de cámara",
      "Steadicam Operator": "Operación de cámara estabilizada",
      "Assistant Camera": "Asistencia de cámara",
      "First Assistant Camera": "Primera asistencia de cámara",
      "Second Assistant Camera": "Segunda asistencia de cámara",
      "Additional Camera": "Cámara adicional",
      "Additional Photography": "Fotografía adicional",
      "Still Photographer": "Fotografía fija",
      "Digital Imaging Technician": "Técnica de imagen digital",

      Editor: "Montaje",
      "Lead Editor": "Jefatura de montaje",
      "Co-Editor": "Comontaje",
      "Associate Editor": "Montaje asociado",
      "First Assistant Editor": "Primera asistencia de montaje",
      "Online Editor": "Montaje final",
      Colorist: "Colorización",
      "Digital Colorist": "Colorización digital",
      "Color Grading": "Etalonaje",
      "Color Designer": "Diseño de color",
      "Color Assistant": "Asistencia de color",

      "Art Direction": "Dirección de arte",
      "Art Designer": "Diseño de arte",
      "Assistant Art Director": "Asistencia de dirección de arte",
      "Supervising Art Director": "Supervisión de dirección de arte",
      "Standby Art Director": "Dirección de arte de apoyo",
      "Art Department Coordinator": "Coordinación del departamento de arte",
      "Art Department Manager": "Jefatura del departamento de arte",
      "Art Department Assistant": "Asistencia del departamento de arte",
      "Production Design": "Diseño de producción",
      "Set Decoration": "Ambientación",
      "Set Dresser": "Ambientación de set",
      "Assistant Decorator": "Asistencia de ambientación",
      "Set Designer": "Diseño de escenografía",
      "Assistant Set Designer": "Asistencia de diseño de escenografía",
      "Interior Designer": "Diseño de interiores",
      "Construction Coordinator": "Coordinación de construcción",
      "Property Master": "Jefatura de utilería",
      "Assistant Property Master": "Asistencia de jefatura de utilería",
      "Prop Designer": "Diseño de utilería",
      Props: "Utilería",
      "Special Props": "Utilería especial",
      "On Set Props": "Utilería en set",
      "Concept Artist": "Arte conceptual",
      "Conceptual Design": "Diseño conceptual",
      "Storyboard Artist": "Guion gráfico",
      "Background Designer": "Diseño de fondos",
      "Character Designer": "Diseño de personajes",
      "Original Series Design": "Diseño original de la serie",
      "Graphic Designer": "Diseño gráfico",
      "Title Designer": "Diseño de títulos",
      "Main Title Designer": "Diseño de títulos principales",
      "Production Artist": "Arte de producción",
      "Visual Development": "Desarrollo visual",

      "Original Music Composer": "Música original",
      Music: "Música",
      "Additional Music": "Música adicional",
      "Music Producer": "Producción musical",
      "Executive Music Producer": "Producción musical ejecutiva",
      "Music Director": "Dirección musical",
      "Music Arranger": "Arreglos musicales",
      "Main Title Theme Composer": "Composición del tema principal",
      "Theme Song Performance": "Interpretación del tema musical",
      Songs: "Canciones",
      Lyricist: "Letras",
      Musician: "Músicos",

      Sound: "Sonido",
      "Sound Director": "Dirección de sonido",
      "Sound Designer": "Diseño de sonido",
      "Sound Effects": "Efectos de sonido",
      "Sound Effects Editor": "Montaje de efectos de sonido",
      "Supervising Sound Editor": "Supervisión de montaje de sonido",
      "Sound Mixer": "Mezcla de sonido",
      "Production Sound Mixer": "Sonido directo",
      "Sound Re-Recording Mixer": "Remezcla de sonido",
      "Sound Engineer": "Ingeniería de sonido",
      "Sound Recordist": "Registro de sonido",
      "Sound Assistant": "Asistencia de sonido",
      "Boom Operator": "Operación de caña",

      "Costume Design": "Diseño de vestuario",
      "Costume Designer": "Diseño de vestuario",
      "Assistant Costume Designer": "Asistencia de diseño de vestuario",
      "Costume Assistant": "Asistencia de vestuario",
      Costumer: "Vestuario",
      "Makeup Artist": "Maquillaje",
      "Key Makeup Artist": "Jefatura de maquillaje",
      "First Assistant Makeup Artist": "Primera asistencia de maquillaje",
      "Makeup Department Head": "Jefatura de maquillaje",
      "Makeup Designer": "Diseño de maquillaje",
      "Makeup Effects": "Efectos de maquillaje",
      "Makeup & Hair": "Maquillaje y peinado",
      "Hair Department Head": "Jefatura de peinado",
      "Hair Designer": "Diseño de peinado",
      "Key Hair Stylist": "Jefatura de estilismo capilar",
      Hairstylist: "Estilismo capilar",

      "Visual Effects": "Efectos visuales",
      "Visual Effects Supervisor": "Supervisión de efectos visuales",
      "VFX Supervisor": "Supervisión de efectos visuales",
      "VFX Editor": "Montaje de efectos visuales",
      "Special Effects": "Efectos especiales",
      "Special Effects Supervisor": "Supervisión de efectos especiales",
      "Compositing Artist": "Composición digital",
      "Lighting Artist": "Iluminación digital",
      "Lighting Director": "Dirección de iluminación",
      "Senior Animator": "Animación sénior",
      Animation: "Animación",
      "Supervising Animation Director": "Supervisión de dirección de animación",

      Casting: "Casting",
      "Casting Director": "Dirección de casting",
      "Casting Associate": "Casting asociado",
      "Additional Casting": "Casting adicional",
      "Location Casting": "Casting local",

      Stunts: "Especialistas",
      "Stunt Coordinator": "Coordinación de especialistas",
      "Stunt Double": "Doble de acción",
      "Utility Stunts": "Especialistas de apoyo",
      "Fight Choreographer": "Coreografía de combate",
      "Martial Arts Choreographer": "Coreografía de artes marciales",
      Choreographer: "Coreografía",
      "Action Director": "Dirección de acción",

      Gaffer: "Jefatura de eléctricos",
      "Key Grip": "Jefatura de maquinistas",
      Grip: "Maquinistas",
      "Best Boy Grip": "Segunda jefatura de maquinistas",
      "Dolly Grip": "Maquinista de travelling",
      Leadman: "Jefatura de utileros",

      "Script Supervisor": "Continuidad",
      "Script Coordinator": "Coordinación de guion",
      "Writers' Assistant": "Asistencia de guion",
      "Additional Dialogue": "Diálogos adicionales",
      "Location Scout": "Localizaciones",
      "Location Assistant": "Asistencia de localizaciones",
      "Technical Advisor": "Asesoría técnica",
      "Technical Supervisor": "Supervisión técnica",
      "Supervising Technical Director": "Dirección técnica supervisora",
      Publicist: "Prensa",
      Presenter: "Presentación",
      "Stand In": "Doble de luces",
      Swing: "Personal de apoyo",
      Painter: "Pintura",
      Draughtsman: "Delineación",
      "Head Carpenter": "Jefatura de carpintería",
      "In Memory Of": "En memoria de",
      Thanks: "Agradecimientos",
      Other: "Otros",
    } as Record<string, string>,
  },

  // saga: textos de la página de una SAGA (/saga/[id]).
  //
  // En español: la otra página que faltaba. Hasta ahora una saga solo existía como una tira de
  // pósters dentro de la ficha de un título, y cada entrada abría una ventanita. Ahora tiene sitio
  // propio y dirección propia que se puede compartir.
  saga: {
    back: "Volver a estrenos",
    notFoundTitle: "Saga no encontrada",
    notFoundHint:
      "No encontramos esta saga en el catálogo. Es posible que el enlace esté roto o que su título ya no esté en la ventana de meses que mostramos.",
    // entriesLabel: el rótulo de la lista de entradas de la saga.
    entriesLabel: "Entradas de la saga",
    // entriesCount describe cuántas entradas tiene.
    entriesCount: (count: number): string => (count === 1 ? "1 entrada" : `${count} entradas`),
    // inCatalogBadge: la marca de la entrada que SÍ es un estreno de este catálogo (y por tanto
    // enlaza a su ficha completa).
    inCatalogBadge: "En el catálogo",
    // openEntryAria: la etiqueta accesible del enlace a la ficha de una entrada del catálogo.
    openEntryAria: (title: string): string => `Ver la ficha de ${title}`,
    // outsideCatalogNote: lo que se dice de una entrada que NO está en el catálogo.
    //
    // En español: la mayoría de las entradas de una saga son películas antiguas o temporadas que este
    // producto no cubre. Se muestran con lo que se sabe de ellas —póster, año, sinopsis— pero SIN
    // enlace, porque no hay ninguna ficha detrás. Fingir un enlace que lleva a una página vacía es
    // peor que no ponerlo.
    outsideCatalogNote: "No está en este catálogo",
    // trailerLabel / trailerOf: el tráiler que se enseña arriba (el del título de la saga que sí está
    // en el catálogo), nombrado para que se sepa de cuál es.
    trailerLabel: "Tráiler",
    trailerOf: (title: string): string => `Tráiler de ${title}`,
    // seasonsNote: el aviso que aparece cuando lo que se está viendo son TEMPORADAS y no una saga.
    //
    // En español: el catálogo mete en el mismo campo dos cosas distintas —las películas de una saga y
    // las temporadas de una serie—. Mientras sigan mezcladas, la página lo DICE en vez de llamar
    // "saga" a lo que es la lista de temporadas de una sola serie.
    seasonsNote: "Estas son las temporadas de la serie, no una saga de títulos distintos.",
    // backToOrigin / backToOriginAria: LA SALIDA de esta página hacia el título del que se vino.
    //
    // En español: sin esto, la página de una saga era un callejón sin salida. Se llegaba desde la
    // ficha de un título y, casi siempre, ninguna de las entradas estaba en el catálogo, así que no
    // había ni un enlace que pulsar: la única forma de continuar era volver al principio de todo. Este
    // enlace devuelve exactamente al título del que se venía.
    backToOrigin: (title: string): string => `Volver a ${title}`,
    backToOriginAria: (title: string): string => `Volver a la ficha de ${title}`,
  },

  // profile: textos de la pantalla de PERFIL (sin login; datos en localStorage).
  profile: {
    title: "Mi perfil",
    backToTimeline: "Volver a la línea de tiempo",
    tabWatchlist: "Por ver",
    tabLibrary: "Biblioteca",
    tabReviews: "Reseñas",
    tabSettings: "Ajustes",
    // tabActivity: la pestaña de ACTIVIDAD RECIENTE (lo último que guardó/vio/reseñó).
    tabActivity: "Actividad",
    // guardianSince arma la línea de identidad bajo el nombre (la fecha llega ya formateada).
    guardianSince: (date: string): string => `Guardián desde ${date}`,
    // anonGuardian: nombre mostrado cuando no hay sesión (el perfil local funciona sin cuenta).
    anonGuardian: "Guardián anónimo",
    // sealAria: etiqueta accesible del sello de rareza personal (derivado de la nota media propia).
    sealAria: (tierLabel: string): string => `Sello del guardián: ${tierLabel}`,
    // stats*: rótulos de las cuatro tarjetas de estadísticas del perfil.
    statsWatched: "Vistas",
    statsWatchlist: "Por ver",
    statsReviews: "Reseñas",
    statsAverage: "Nota media",
    // activity*: textos de la línea de actividad (verbo por tipo de evento + vacío).
    emptyActivity:
      "Tu actividad aparecerá aquí: lo que guardes en «Quiero ver», marques como visto o reseñes.",
    activityWatchlist: "Guardado en «Quiero ver»",
    activityWatched: "Marcado como visto",
    activityReview: (score: string): string => `Reseñado con ★ ${score}`,
    activityUnknownTitle: "Título fuera del catálogo actual",
    // data*: bloque "Tus datos" de Ajustes (exportar respaldo + borrado local con confirmación).
    dataLabel: "Tus datos",
    dataHint:
      "Tu perfil vive en este navegador. Descárgalo como respaldo (JSON) o bórralo por completo.",
    exportButton: "Exportar perfil (JSON)",
    deleteButton: "Borrar datos locales",
    deleteConfirmHint:
      "Esto borra tu watchlist, vistos, reseñas, actividad y ajustes de este navegador. No se puede deshacer.",
    deleteConfirm: "Sí, borrar todo",
    deleteCancel: "Cancelar",
    loading: "Cargando tu perfil…",
    emptyWatchlist: "Aún no agregas estrenos a «Quiero ver». Ábrelos y pulsa «➕ Quiero ver».",
    emptyLibrary: "Tu biblioteca está vacía. Marca como «Vista» los estrenos que ya viste.",
    emptyReviews: "Aún no reseñas nada. Califica un estreno del 1 al 10 en su ficha.",
    removeFromWatchlist: "Quitar de «Quiero ver»",
    removeFromLibrary: "Quitar de la biblioteca",
    removeReview: "Borrar reseña",
    // Acciones (botones en la ficha/modal).
    addToWatchlist: "Quiero ver",
    inWatchlist: "En «Quiero ver»",
    markWatched: "Marcar vista",
    watched: "Vista",
    // Ajustes.
    themeLabel: "Tema",
    themeHint: "Elige cómo se ve la app: oscuro (cine) o claro.",
    languageLabel: "Idioma",
    languageHint: "Idioma preferido para el tráiler, el audio y los subtítulos.",
    platformsLabel: "Mis plataformas",
    platformsHint: "Elige las que tienes: se resaltarán sus estrenos en la línea de tiempo.",
    tastesLabel: "Mis gustos",
    tastesHint: "Géneros favoritos: sus estrenos resaltarán en la línea de tiempo.",
    // Reseña (barra de calificación).
    reviewLabel: "Tu calificación",
    reviewHint: "Arrastra para calificar del 1 al 10 (con decimales).",
    reviewLockedHint: "Marca «Vista» arriba para poder calificar.",
    // reviewValueText arma el texto accesible del valor del slider, ej. "8.5 de 10".
    reviewValueText: (score: string): string => `${score} de 10`,
    // Etiquetas de los AJUSTES con opciones fijas (idiomas y temas). En español: antes vivían
    // hardcodeadas como literales en ProfileView; ahora son parte del catálogo de textos.
    languages: {
      es: "Español",
      en: "Inglés",
      fr: "Francés",
      pt: "Portugués",
      ja: "Japonés",
    },
    themeDark: "Oscuro",
    themeLight: "Claro",
  },

  // Textos de CUENTAS (login / registro / sesión).
  auth: {
    // Pantalla.
    loginTitle: "Tu cuenta",
    loginSubtitle: "Inicia sesión para llevar tu perfil contigo.",
    tabLogin: "Iniciar sesión",
    tabRegister: "Crear cuenta",
    // Campos.
    emailLabel: "Correo",
    emailPlaceholder: "tu@correo.com",
    passwordLabel: "Contraseña",
    passwordPlaceholder: "Mínimo 8 caracteres",
    displayNameLabel: "Nombre",
    displayNamePlaceholder: "Cómo te llamamos",
    // Código de invitación (beta cerrada). Se pide SIEMPRE al crear cuenta, pero solo es obligatorio
    // si el servidor lo exige: por eso el rótulo dice "si tienes uno" en vez de marcarlo requerido.
    // Prometer que es opcional cuando el servidor lo pide sería mentir; exigirlo cuando el servidor
    // no lo pide dejaría fuera a gente que sí puede entrar. La pista explica exactamente eso.
    inviteCodeLabel: "Código de invitación (si tienes uno)",
    inviteCodePlaceholder: "TSK-XXXX-XXXX",
    inviteCodeHint:
      "The Story Keeper está en beta cerrada. Si te invitaron, escribe aquí tu código; si la beta " +
      "ya está abierta, puedes dejarlo vacío.",
    // Botones / estados.
    submitLogin: "Entrar",
    submitRegister: "Crear cuenta",
    submitting: "Un momento…",
    // Avatar / sesión.
    signedInAs: "Sesión de",
    logout: "Cerrar sesión",
    goToLogin: "Iniciar sesión",
    // Errores de validación del cliente (antes de llamar al backend).
    errorEmail: "Escribe un correo válido.",
    errorPassword: "La contraseña debe tener al menos 8 caracteres.",
    // Aviso de que la sesión es opcional.
    optionalNote: "Puedes explorar sin cuenta; la sesión solo guarda tu perfil.",

    // forgot: la pantalla de "olvidé mi contraseña" (pide el correo y dispara el restablecimiento).
    forgot: {
      // link es el botón que se ve bajo el formulario de entrada.
      link: "¿Olvidaste tu contraseña?",
      title: "Recuperar el acceso",
      // subtitle explica qué va a pasar SIN prometer un correo: hoy la entrega es manual.
      subtitle:
        "Escribe el correo de tu cuenta y ponemos en marcha el restablecimiento de tu contraseña.",
      submit: "Enviar",
      // back devuelve a la pantalla de entrada (también funciona con la tecla Esc).
      back: "Volver a iniciar sesión",
      // done es la respuesta de éxito. Es DELIBERADAMENTE ambigua sobre si la cuenta existe: el
      // servidor contesta lo mismo en ambos casos para que nadie pueda usar esta pantalla como un
      // buscador de correos registrados. El texto lo dice en voz alta en vez de fingir certeza.
      done:
        "Listo. Si ese correo tiene una cuenta, su restablecimiento ya está en marcha. Te damos " +
        "esta misma respuesta exista o no la cuenta: así nadie puede usar esta pantalla para " +
        "averiguar qué correos están registrados.",
      // doneDelivery explica el canal real de entrega mientras la beta sea cerrada.
      // Ojo al detalle: quien administra NO recibe un enlace listo, sino que emite un código y lo
      // entrega en mano. Por eso el texto habla de un código y no promete un correo que no existe.
      doneDelivery:
        "Mientras la beta es cerrada no enviamos correos: quien administra la beta emite tu código " +
        "de restablecimiento y te lo entrega por el mismo medio por el que te invitó. El código " +
        "caduca en una hora y solo sirve una vez.",
    },

    // reset: la pantalla /restablecer, donde se escribe la contraseña nueva.
    reset: {
      title: "Nueva contraseña",
      subtitle: "Elige una contraseña nueva para tu cuenta. Nadie te pedirá la anterior.",
      newPasswordLabel: "Contraseña nueva",
      confirmLabel: "Repite la contraseña nueva",
      submit: "Guardar contraseña",
      // tokenLabel/tokenPlaceholder: el código de restablecimiento, que solo se pide cuando NO venía
      // en la dirección. Existe porque hay dos formas legítimas de recibirlo: dentro de un enlace
      // completo (y entonces ya está puesto) o escrito a mano por quien administra la beta.
      tokenLabel: "Código de restablecimiento",
      tokenPlaceholder: "Pega aquí el código que te entregaron",
      // missingToken: se llegó a la página sin código (a mano, o con un enlace que se cortó al copiar).
      missingToken:
        "Para cambiar tu contraseña hace falta el código de restablecimiento. Si te llegó un enlace " +
        "completo, ábrelo tal cual y el código se rellena solo; si te lo entregaron escrito, " +
        "pégalo aquí abajo. ¿No tienes ninguno? Pídelo desde «¿Olvidaste tu contraseña?» en la " +
        "pantalla de entrada.",
      // errorMissingToken: se intentó guardar sin escribir ningún código.
      errorMissingToken: "Escribe el código de restablecimiento que te entregaron.",
      // errorMismatch: las dos contraseñas escritas no coinciden (fallo del usuario, no del servidor).
      errorMismatch: "Las dos contraseñas no coinciden. Escríbelas otra vez.",
      // doneTitle/done/doneSessions: qué pasó exactamente tras el cambio.
      doneTitle: "Contraseña cambiada",
      done: "Tu contraseña nueva ya está activa. Puedes entrar con ella ahora mismo.",
      doneSessions:
        "Por seguridad se cerraron TODAS las sesiones abiertas de tu cuenta, en este y en " +
        "cualquier otro dispositivo. Si pediste el restablecimiento porque alguien más había " +
        "entrado, eso es lo que lo deja fuera.",
      goToLogin: "Ir a iniciar sesión",
    },

    // account: la gestión de la cuenta desde «Mi perfil» (cambiar contraseña y borrar la cuenta).
    // Vive aquí, junto al resto de textos de cuentas, porque habla de la MISMA cuenta que el login.
    account: {
      // Bloque completo.
      label: "Tu cuenta",
      hint: "Estos controles afectan a tu cuenta en el servidor, no solo a este navegador.",
      // signedOutHint se muestra a quien navega sin sesión: no hay cuenta que gestionar.
      signedOutHint:
        "Estás navegando sin cuenta. Inicia sesión para cambiar tu contraseña o borrar tu cuenta.",
      goToLogin: "Iniciar sesión",

      // ----- Cambiar contraseña -----
      changeLabel: "Cambiar la contraseña",
      changeHint:
        "Pedimos la contraseña actual para comprobar que eres tú. Al cambiarla se cierran todas " +
        "las sesiones abiertas —incluida esta—, así que tendrás que volver a entrar con la nueva.",
      changeOpen: "Cambiar contraseña",
      currentPasswordLabel: "Contraseña actual",
      newPasswordLabel: "Contraseña nueva",
      confirmPasswordLabel: "Repite la contraseña nueva",
      changeSubmit: "Guardar contraseña",
      changeCancel: "Cancelar",
      changeDone:
        "Tu contraseña cambió. Se cerraron todas las sesiones, incluida esta: vuelve a entrar con " +
        "la contraseña nueva.",

      // ----- Borrar la cuenta -----
      deleteLabel: "Borrar la cuenta",
      // deleteHint enumera SIN rodeos qué desaparece y qué no. El aviso de privacidad promete este
      // control como el derecho de cancelación, así que el texto tiene que coincidir con la realidad.
      deleteHint:
        "Borrar la cuenta es IRREVERSIBLE y no se puede deshacer. Desaparecen del servidor: tu " +
        "correo, tu nombre visible, la huella de tu contraseña, el perfil que tu cuenta tuviera " +
        "guardado ahí (listas, reseñas y ajustes) y todas tus sesiones abiertas. No queda copia " +
        "ni forma de recuperarlo.",
      // deleteLocalNote aclara la frontera entre la cuenta (servidor) y los datos de este navegador.
      deleteLocalNote:
        "Los datos guardados en ESTE navegador no se borran con esto: para eliminarlos usa «Borrar " +
        "datos locales», aquí mismo. Si quieres conservarlos, exporta antes tu perfil.",
      deleteOpen: "Borrar mi cuenta",
      deletePasswordLabel: "Tu contraseña",
      // deleteConfirmWord es la palabra EXACTA que hay que escribir para confirmar. Se pide teclearla
      // (en vez de un simple "¿seguro?") porque un clic de más se da sin leer; escribir una palabra
      // obliga a detenerse y a entender qué se está haciendo.
      deleteConfirmWord: "BORRAR",
      deleteConfirmLabel: "Escribe BORRAR para confirmar",
      deleteConfirmPlaceholder: "BORRAR",
      deleteSubmit: "Borrar mi cuenta para siempre",
      deleteCancel: "Cancelar",
      // errorConfirmWord: la palabra de confirmación no se escribió exactamente igual.
      errorConfirmWord: "Para confirmar, escribe exactamente BORRAR en mayúsculas.",
      deleteDone:
        "Tu cuenta se borró para siempre. Ya navegas como anónimo. Si quieres, también puedes " +
        "borrar los datos que quedan en este navegador.",
    },
  },

  // graph: textos del MAPA PERSONAL de la biblioteca (/grafo).
  //
  // En español: la pantalla que dibuja lo que has visto como una constelación —cada título es un
  // punto y cada actor, director, género o plataforma que se repite es otro punto que los une—. Es la
  // misma idea de una libreta de notas enlazadas: no te dicen los grupos, se ven.
  //
  // Casi la mitad de estos textos existen por accesibilidad, y no es casualidad: un mapa de puntos
  // sencillamente NO EXISTE para quien navega con lector de pantalla. Por eso la misma información
  // está también como lista recorrible, y por eso cada punto tiene su frase que se lee en voz alta.
  graph: {
    title: "Tu constelación",
    // subtitle explica en una línea qué se está mirando, sin jerga.
    subtitle: "Lo que has visto y lo que lo une entre sí",
    back: "Volver a estrenos",
    // Los dos modos de ver EXACTAMENTE los mismos datos. Ninguno es la versión buena y ninguno es el
    // premio de consolación: para "¿en qué películas mías sale este actor?" la lista gana siempre.
    viewMap: "Mapa",
    viewList: "Lista",
    viewSwitchLabel: "Cómo quieres ver tu constelación",

    // --- Estados honestos según cuánto has visto -------------------------------------------------
    // emptyTitle/emptyHint: cero títulos vistos. No se dibuja un lienzo vacío: se invita.
    emptyTitle: "Tu constelación está por empezar",
    emptyHint:
      "Marca como vistas las películas y series que ya viste y aquí aparecerán solas las conexiones entre ellas: los actores que se repiten, los directores, los géneros que dominan tu biblioteca.",
    emptyAction: "Ir a la línea de tiempo",
    // fewTitle/fewHint: entre uno y cuatro. Se dice cuántos faltan en vez de dibujar un mapa pobre.
    fewTitle: "Todavía faltan conexiones",
    fewHint: (missing: number): string =>
      missing === 1
        ? "Con un título más empezarán a aparecer los primeros hilos entre lo que has visto."
        : `Con ${missing} títulos más empezarán a aparecer los primeros hilos entre lo que has visto.`,
    // watchedListLabel: el rótulo de la lista de lo visto que se enseña mientras no hay mapa.
    watchedListLabel: "Lo que llevas visto",
    // noLinksTitle/noLinksHint: hay títulos suficientes pero NADA en común entre ellos. Pasa de
    // verdad con bibliotecas muy variadas, y decirlo es mejor que enseñar puntos sueltos sin explicar.
    noLinksTitle: "Sin conexiones todavía",
    noLinksHint:
      "Lo que has visto no comparte todavía ningún actor, director, género ni plataforma con el resto. En cuanto algo se repita, aparecerá aquí como un hilo.",

    // --- Controles ------------------------------------------------------------------------------
    // pause/resume: el botón de pausa VISIBLE. No es un extra.
    //
    // En español: respetar la preferencia del sistema («reducir movimiento») es obligatorio y ya se
    // hace, pero NO basta. La norma de accesibilidad exige un mecanismo EN LA PROPIA PÁGINA para
    // detener cualquier movimiento que dure más de cinco segundos, y un ajuste del sistema operativo
    // —que muchísima gente no tiene activado ni sabe que existe— no cuenta como tal. Hacen falta las
    // dos cosas.
    pause: "Pausar",
    resume: "Reanudar",
    pauseAria: "Pausar la colocación del mapa",
    resumeAria: "Reanudar la colocación del mapa",
    // settling: lo que se dice mientras el mapa se está acomodando.
    settling: "Acomodando…",
    // paused: lo que se dice cuando la persona lo detuvo.
    paused: "En pausa",
    // still: lo que se dice cuando ya se quedó quieto solo.
    still: "Quieto",
    // computing: el aviso mientras se calcula de golpe (quien pidió menos movimiento).
    computing: "Calculando tu constelación…",

    // filtersLabel + los cuatro tipos de vínculo, con su explicación de por qué unos pesan más.
    filtersLabel: "Qué vínculos mostrar",
    kindCast: "Reparto",
    kindDirector: "Dirección",
    kindPlatform: "Plataforma",
    kindGenre: "Género",
    kindTitle: "Título visto",
    // filtersHint explica por qué se pueden apagar unos y no otros.
    filtersHint:
      "Compartir reparto o dirección dice algo. Compartir «Drama» con otras cien películas, casi nada: por eso los vínculos flojos se pueden apagar.",

    // El interruptor del umbral, para bibliotecas grandes.
    thresholdLabel: "Solo lo que se repite mucho",
    thresholdHint: (min: number): string =>
      min === 2
        ? "Ahora se muestra todo lo que aparece en dos o más de tus títulos."
        : "Ahora solo se muestra lo que aparece en tres o más de tus títulos. Con una biblioteca grande, esto quita el ruido sin quitar información.",

    // El buscador para centrarse en algo concreto.
    searchLabel: "Buscar en tu constelación",
    searchPlaceholder: "Un actor, un género, un título…",
    searchNoResults: "Nada en tu constelación coincide con eso.",

    // --- Recuento y ayuda ------------------------------------------------------------------------
    // summary resume el tamaño de lo que se está viendo, en palabras y no en jerga de grafos.
    summary: (titles: number, links: number): string =>
      `${titles} ${titles === 1 ? "título" : "títulos"} · ${links} ${links === 1 ? "vínculo" : "vínculos"}`,
    // keyboardHint: las instrucciones de teclado, visibles para todo el mundo (no escondidas).
    keyboardHint:
      "Con el mapa enfocado: las flechas izquierda y derecha recorren los puntos, las de arriba y abajo saltan a lo que está conectado, Enter abre y Escape sale.",
    // canvasLabel: el nombre del lienzo para quien lo encuentra con el teclado o con voz.
    canvasLabel: "Mapa de tu constelación",
    // canvasEmptyForScreenReader: lo que se anuncia si el lienzo se enfoca sin ningún punto dentro.
    canvasEmptyForScreenReader: "El mapa no tiene ningún punto con los filtros actuales.",

    // --- Frases que se leen en voz alta ----------------------------------------------------------
    // announceTitle: al enfocar un título. Dice qué es, cómo se llama y con cuántas cosas conecta.
    announceTitle: (label: string, links: number): string =>
      `Título visto: ${label}. Conectado con ${links} ${links === 1 ? "vínculo" : "vínculos"}.`,
    // announceAttribute: al enfocar un vínculo. Dice de qué tipo es y qué títulos cuelgan de él.
    announceAttribute: (kindLabel: string, label: string, titles: number): string =>
      `${kindLabel}: ${label}. Aparece en ${titles} ${titles === 1 ? "título" : "títulos"} tuyos.`,

    // --- Lista (la alternativa en texto, que es una vista de pleno derecho) -----------------------
    listIntro:
      "La misma constelación, escrita. Cada vínculo se abre para ver qué títulos tuyos cuelgan de él.",
    // groupHeading arma el encabezado de cada sección de la lista.
    groupHeading: (kindLabel: string, count: number): string =>
      `${kindLabel} · ${count} ${count === 1 ? "vínculo" : "vínculos"}`,
    // sharedBy dice a cuántos títulos toca un vínculo, en el resumen plegado.
    sharedBy: (count: number): string => `en ${count} ${count === 1 ? "título" : "títulos"} tuyos`,
    // linkedBy dice cuántos vínculos salen de un título, en el resumen plegado.
    linkedBy: (count: number): string => (count === 1 ? "por 1 vínculo" : `por ${count} vínculos`),
    // openTitleAria: la etiqueta del enlace a la ficha de un título desde la lista o desde el mapa.
    openTitleAria: (title: string): string => `Ver la ficha de ${title}`,
    // selectedLabel: el encabezado del panel que aparece al pulsar un punto del mapa.
    selectedLabel: "Seleccionado",
    // clearSelection: el botón que quita el resaltado.
    clearSelection: "Quitar el resaltado",
    // Aquí vivían tres textos de TELEMETRÍA que se enseñaban al usuario junto al recuento del mapa:
    // cuántos milisegundos tardó la colocación y si la cuenta se hizo en segundo plano o en la propia
    // página. Son dos datos que hay que poder vigilar —el segundo se rompe en silencio al cambiar de
    // versión del framework— pero no son texto de producto: nadie que mire su constelación necesita
    // saber cuántos milisegundos costó dibujarla, y leerlo dentro de la misma frase que dice "295
    // títulos · 1086 vínculos" hace pensar que es parte de la información. Ahora el dato sigue
    // estando —viaja en los atributos data-layout-* del mapa, donde las pruebas automáticas y las
    // herramientas del navegador lo leen igual de bien— pero fuera de la vista. Ver GraphCanvas.
  },
};

// footer agrupa los textos NAVEGABLES del pie de página (los legales de atribución van más abajo).
// En español: hoy es un solo enlace —el aviso de privacidad—, pero vive aquí para que cualquier otro
// enlace legal que se añada en el futuro tenga su sitio natural.
export const footer = {
  // privacyLink es el enlace del pie hacia el aviso de privacidad (/privacidad).
  privacyLink: "Aviso de privacidad",
  // setupLink abre la página donde se enciende el servicio en esta computadora.
  setupLink: "Configuración local",
  // legalLabel etiqueta, para lectores de pantalla, el grupo de enlaces legales del pie.
  legalLabel: "Enlaces legales",
};

// setup agrupa el texto de /configuracion, la pantalla para encender el servicio local.
export const setup = {
  pageTitle: "Configuración local",
  intro:
    "Desde aquí se enciende The Story Keeper en esta computadora. Las llaves se quedan en el servicio: el navegador no las guarda.",
  back: "Volver al inicio",
  connection: "Servicio en esta computadora",
  up: "Responde",
  down: "No responde",
  retry: "Probar de nuevo",
  preparing:
    "El servicio está en preparación. Guarda las llaves que tengas y pulsa Encender. El resto de pantallas se abre cuando vuelva.",
  session: "Clave de sesión",
  sessionReady: "Lista. Se creó en esta computadora.",
  sessionEnv: "Lista. Viene del entorno.",
  sessionMissing: "Falta.",
  tmdbLabel: "Token de TMDB",
  tmdbHint:
    "Trae estrenos, pósters y tráilers. En themoviedb.org está en los ajustes de la API, como API Read Access Token.",
  omdbLabel: "Clave de OMDb",
  omdbHint: "Opcional. Al regenerar el catálogo llena IMDb, Rotten Tomatoes y Metacritic.",
  adminLabel: "Contraseña del panel",
  adminHint: "Abre la pantalla interna /admin. Si la dejas vacía, el panel sigue cerrado.",
  metricsLabel: "Clave de métricas",
  metricsHint: "Opcional. Permite consultar /metrics del servicio.",
  saved: "Guardada",
  missing: "Falta",
  fromEnv: "Definida en el entorno. Esta página no la cambia.",
  placeholder: "Pega la llave. Vacío conserva la que ya hay.",
  save: "Guardar llaves",
  clear: "Quitar",
  turnOn: "Encender",
  restart: "Reiniciar el servicio",
  restartHint:
    "Hace falta reiniciar para que el servicio use una clave de métricas recién guardada.",
  savedOk: "Listo. Las llaves quedaron en el servicio.",
  turnedOn: "Encendiendo. En unos segundos puedes volver al inicio.",
  home: "Ir al inicio",
  closed: "Esta pantalla solo se abre desde esta computadora.",
  gate: "El servicio aún no dejó lista la configuración local.",
  unread: "El servicio responde, pero la configuración no se pudo leer.",
  downDetail: "El servicio de esta computadora no responde.",
  working: "Trabajando…",
  checking: "Comprobando el servicio…",
  catalogGroup: "Catálogo",
  accessGroup: "Acceso",
  statusReady: "Guardada en esta computadora.",
  statusMissing: "Todavía no hay llave.",
  restartWarn:
    "Reiniciar detiene el servicio. Si esta computadora lo vuelve a levantar sola, las pantallas regresan. Si lo arrancaste a mano, hay que levantarlo otra vez.",
  ignoredNote: "Alguna llave ya viene del entorno. Esa no se cambió.",
  adminClosed: "El panel está cerrado. Guarda una contraseña en Configuración local para abrirlo.",
  adminPrompt: "Contraseña del panel",
  adminEnter: "Entrar",
  adminDenied: "Esa contraseña no coincide.",
};

// attribution agrupa los textos de atribución legal usados en el Footer (además del aviso EXACTO de
// TMDB, que por ser texto legal en inglés vive literal en el propio componente Footer).
export const attribution = {
  // tmdbLogoAlt: texto alternativo accesible del logo de TMDB (hasta colocar el asset aprobado).
  tmdbLogoAlt: "The Movie Database (TMDB)",
  // justWatch: atribución de los datos de "dónde verlo" (proveedores de streaming/cadenas).
  justWatch: "Información de disponibilidad («dónde verlo») proporcionada por JustWatch.",
  // omdb: atribución a OMDb (licencia CC BY-NC 4.0) aclarando que NO hay aval ni afiliación con IMDb.
  omdb: "Calificaciones provistas por OMDb (CC BY-NC 4.0). No avalado por IMDb.com ni afiliado a IMDb.",
  // region: sello de región e idioma del contenido ("MX · es-MX").
  region: `${REGION} · ${LOCALE}`,
};
