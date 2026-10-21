// Archivo: (public)/page.tsx — Página de inicio (home): la LÍNEA DE TIEMPO de estrenos.
//
// En español: es la primera pantalla pública y, desde el S6, la casa de la feature héroe del
// producto: la línea de tiempo navegable de estrenos. Su trabajo aquí es de "orquestación de datos":
//   1) Pide al backend los estrenos de los dos meses de Fase 0 (junio y julio de 2026).
//   2) Combina los resultados y decide qué estado mostrar (error, vacío o la timeline con datos).
//   3) Envuelve el shell interactivo (Topbar + Timeline) en el FilterProvider, que coordina el
//      filtro por tipo y el botón "Ir a hoy" entre esos dos componentes.
//
// Es un Server Component (sin 'use client'): se renderiza en el servidor, donde es seguro hablar con
// el backend por Connect. Las llamadas van por el cargador compartido "loadCatalogWindowSummaries", que NUNCA lanza: si el
// backend no responde (por ejemplo durante "next build"), devuelve una lista vacía + un mensaje de
// error, y la página se dibuja igual con su estado de error o vacío. Así el build pasa sin backend
// levantado y, en runtime con el api arriba, se ven los datos reales.
//
// Reparto de responsabilidades de estados (regla §12, estados siempre cubiertos):
//   - ERROR de red de AMBOS meses -> lo maneja ESTA página (mensaje + reintento).
//   - VACÍO (sin estrenos) y VACÍO por filtro -> los maneja la Timeline (estado vacío).
//   - LOADING (carga de la ruta dinámica) -> lo maneja app/(public)/loading.tsx (skeletons).

import Link from "next/link";

import { BottomNav } from "@/components/BottomNav";
import { Topbar } from "@/components/Topbar";
import { TimelineStage } from "@/components/TimelineStage";
import { GlobalBackground } from "@/components/GlobalBackground";
import { SceneBackground } from "@/components/SceneBackground";
import { FilterProvider } from "@/lib/timeline-context";
import {
  collectGenres,
  firstAnchorWithContent,
  pickWeekBackdrops,
  resolveDemoToday,
} from "@/lib/timeline";
import { loadCatalogWindowSummaries, type ReleaseSummary } from "@/lib/connect/catalog";
import { ui } from "@/lib/i18n";

// GLOBAL_BACKGROUND_COUNT es cuántos estrenos "estrella" alimentan el FONDO GLOBAL rotativo de E2.
// En español: el rediseño usa los mejores ~5 estrenos (por calificación TMDB) como fondo de toda la
// página: sus backdrops se van mostrando uno tras otro con un desvanecido suave. Cinco es suficiente
// para dar variedad sin que la rotación se sienta interminable. Se nombra para no escribir el número suelto.
const GLOBAL_BACKGROUND_COUNT = 5;

// dynamic = "force-dynamic": la página se construye en CADA visita.
//
// En español: podría parecer un desperdicio, pero el ahorro está resuelto un nivel más abajo — las
// consultas al catálogo se reutilizan durante unos minutos (ver lib/connect/catalog-cache.ts), así
// que construir la página de nuevo no implica volver a preguntarle nada al backend.
//
// La diferencia importa: guardar la PÁGINA ya construida significaba guardar también la pantalla de
// error si el backend estaba caído en ese momento, y seguir mostrándola durante minutos aunque el
// servicio se hubiera recuperado. Guardando los DATOS y solo cuando son correctos, un fallo pasajero
// deja de contaminar lo que ve la gente: la siguiente visita ya se ve bien.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Resolvemos el marcador HOY ANTES de pedir datos: de él se deriva QUÉ meses pedir.
  // En español: DEMO_TODAY permite fijar un "hoy" concreto para capturas o demos; si no está, se usa
  // el día real (zona horaria de México). Se calcula en el servidor y se pasa como dato fijo, sin leer
  // la hora del navegador, para evitar desajustes de hidratación.
  const today = resolveDemoToday(process.env.DEMO_TODAY);

  // Pedimos los meses de la VENTANA DEL CATÁLOGO (mes anterior, actual y siguiente), derivada de HOY.
  // En español: antes los meses estaban escritos a mano (mayo/junio/julio de 2026), así que al pasar a
  // agosto la app seguía pidiendo meses viejos y se veía vacía aunque el catálogo tuviera datos nuevos.
  // Van en paralelo (Promise.all) porque son consultas independientes: así no se espera una tras otra.
  //
  // LO QUE LLEGA AQUÍ SON RESÚMENES, no fichas completas, y ese es el cambio que hizo ligera esta
  // página. Antes bajaban el reparto, la galería, el calendario de episodios, la saga y los videos de
  // los trescientos y pico estrenos de la ventana —3,6 MB de datos— para dibujar unas cajitas con el
  // día y el título. Ahora baja solo lo que se dibuja, y la ficha completa de un título se pide en el
  // momento en que alguien la abre (ver lib/connect/release-detail.ts). No se enseña ni un dato menos.
  const catalogWindowResult = await loadCatalogWindowSummaries();

  // Determinamos el estado de ERROR: solo lo tratamos como error "duro" cuando TODOS los meses
  // fallaron (no hay nada que mostrar). Si al menos uno respondió, seguimos al render normal.
  const everyMonthFailed = catalogWindowResult.failedMonthCount === catalogWindowResult.monthCount;

  // FALLO PARCIAL: al menos un mes falló pero otro sí respondió. En español: antes esto pasaba en
  // silencio y la línea de tiempo se veía "incompleta sin motivo" (el usuario creía que ese mes no
  // tenía estrenos). Ahora lo avisamos con un banner NO bloqueante (ver render más abajo).
  const someMonthFailed = !everyMonthFailed && catalogWindowResult.failedMonthCount > 0;

  // ----- Estado de ERROR (ambos meses fallaron) -----
  // En español: ni junio ni julio respondieron. Mostramos el shell (dentro del FilterProvider, para
  // que el Topbar interactivo tenga su contexto) y, en lugar de la timeline, un aviso con reintento.
  if (everyMonthFailed) {
    return (
      <FilterProvider>
        {/* Barra superior: aquí sus controles no tienen timeline a la que afectar, pero se mantiene
            el shell coherente y navegable; el FilterProvider le da el contexto que necesita. Sin datos
            (ambos meses fallaron), el select de género va vacío (solo "Todos"). */}
        <Topbar genres={[]} />
        <main className="font-ui px-4 py-10 sm:px-10 sm:py-16">
          <section className="mx-auto max-w-[1100px]">
            {/* role="alert" hace que los lectores de pantalla anuncien el problema de inmediato. */}
            <div
              role="alert"
              className="rounded-base border p-6"
              style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
            >
              <p className="font-display text-lg text-text">{ui.home.errorTitle}</p>
              <p className="mt-2 text-sm text-text-muted">{ui.home.errorRetryHint}</p>
              {/*
                Reintento accionable: al ser "force-dynamic", navegar de nuevo a "/" fuerza un render
                nuevo del Server Component y reintenta las consultas, sin recargar a mano.
              */}
              <Link
                href="/"
                className="font-mono mt-4 inline-flex w-fit rounded-sm border border-gold-deep px-4 py-2 text-xs tracking-[0.08em] text-gold uppercase no-underline transition-colors hover:text-gold-bright"
                style={{ background: "var(--color-glass)" }}
              >
                {ui.home.errorRetry}
              </Link>
            </div>
          </section>
        </main>
      </FilterProvider>
    );
  }

  // ----- Estado con DATOS (o vacío, que resuelve la propia Timeline) -----
  // En español: al menos un mes respondió. Envolvemos el shell en el FilterProvider para que el
  // Topbar (filtros + "Ir a hoy") y la línea de tiempo se coordinen. Desde el S7 ya no montamos la
  // Timeline directamente, sino el envoltorio TimelineStage: dibuja la misma Timeline (reenviándole los
  // estrenos de cada mes y el marcador HOY) y le añade el FLUJO de 3 niveles (el overlay que abre el
  // modal de categoría y el detalle al pulsar un paquete). El héroe, los estados vacío/filtro y la
  // navegación interna siguen siendo responsabilidad de la Timeline.
  // Combinamos los estrenos de todos los meses de la ventana, en orden cronológico de mes.
  // En español: ese orden define la "semilla" de color de cada estreno (su posición en la lista). Al
  // construir aquí el mismo mapa id -> posición, el color de respaldo del fondo global (cuando no hay
  // imagen) coincide exactamente con el de la timeline para el mismo estreno. Una sola receta de color.
  const allReleases: ReleaseSummary[] = catalogWindowResult.items;
  const seedByIndex = new Map<string, number>();
  allReleases.forEach((release, index) => {
    seedByIndex.set(release.id, index);
  });

  // Estrenos de la SEMANA actual (alrededor de hoy) con backdrop, para el fondo global rotativo: el fondo
  // muestra lo que SE ESTRENA AHORA, no los títulos viejos mejor calificados ni una imagen estática.
  const topReleases = pickWeekBackdrops(allReleases, today, GLOBAL_BACKGROUND_COUNT);

  // Géneros ÚNICOS del catálogo para poblar el select "Género" de la barra (datos reales, sin inventar).
  // Se calculan en el servidor y se pasan como dato serializable al Topbar (cliente).
  const availableGenres = collectGenres(allReleases);

  // ----- Render FULL-PAGE de E2: el fondo global rotativo detrás, el Topbar compacto encima y la
  // timeline-espina ocupando el resto. Ya NO hay sección/padding que empuje la timeline hacia abajo:
  // la página ES la timeline. El <main> se vuelve un contenedor que llena la altura restante de la
  // ventana (calc 100vh menos la barra) para centrar verticalmente la espina. -----
  return (
    // initialAnchor: el día donde de verdad hay algo que ver (ver firstAnchorWithContent). NO es
    // siempre HOY, y esa diferencia importa: si el catálogo aún no cubre hoy, abrir en hoy deja a la
    // persona mirando una franja de días vacíos con un mes anunciado en el que no hay nada — la
    // aplicación parece rota aunque tenga cientos de estrenos un poco más a la derecha.
    // El marcador de HOY sigue en su sitio y el botón "Ir a hoy" sigue llevando a hoy.
    // (Comentario original: la espina abre enfocada en el mes actual; el navegador de fecha arranca en
    // granularidad "mes" sobre este ancla), calculado en el servidor para no parpadear al hidratar.
    <FilterProvider initialAnchor={firstAnchorWithContent(today, allReleases)}>
      {/*
        Fondo global rotativo: detrás de TODO (z bajo), decorativo. Le pasamos los mejores estrenos y sus
        semillas de color YA CALCULADAS (un arreglo de números alineado por posición con topReleases). Es
        DATO, no función: este es un Server Component y React PROHÍBE pasar funciones a Client Components
        ("Functions cannot be passed directly to Client Components"). Por eso resolvemos seedByIndex aquí y
        mandamos el resultado serializable. onActivate llegará en E4 (clic-en-fondo); en E2 no se pasa
        porque el fondo aún no es interactivo.
      */}
      <GlobalBackground
        releases={topReleases}
        seeds={topReleases.map((release) => seedByIndex.get(release.id) ?? 0)}
      />
      {/* Partículas WebGL: HERMANO de GlobalBackground (no su hijo), para que NO se re-renderice con la
          rotación/selección del fondo (antes desaparecían al seleccionar). Lienzo transparente: deja ver y
          rotar los backdrops detrás. Se monta solo si procede (no móvil/reduced-motion). */}
      <SceneBackground />
      {/* La campana de avisos necesita el catálogo y HOY para derivar las notificaciones de la watchlist. */}
      <Topbar genres={availableGenres} catalog={allReleases} today={today} />
      {/*
        Banner de FALLO PARCIAL (no bloqueante): algún mes no respondió pero otros sí. role="status"
        (no "alert"): informa sin interrumpir. La página sigue siendo usable con los datos que llegaron.
      */}
      {someMonthFailed ? (
        <p
          role="status"
          className="font-mono mx-auto mt-2 w-fit rounded-sm border px-4 py-2 text-xs"
          style={{
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          {ui.home.partialWarning}
        </p>
      ) : null}
      {/*
        El <main> ocupa la altura restante bajo la barra superior fija. Así la timeline-espina se centra
        verticalmente y ocupa la pantalla, sin scroll vertical de página: el único scroll es el HORIZONTAL
        de la espina. La clase tlx-main calcula esa altura en globals.css.
      */}
      <main className="tlx-main font-ui">
        {/*
          Encabezado principal de la portada. Va fuera de la vista (sr-only) y NO oculto: los lectores
          de pantalla lo leen y sirve para saltar al contenido, pero no le roba espacio a la línea de
          tiempo, que ocupa la pantalla entera y ya se explica sola mirándola. Esta pantalla no tenía
          ningún encabezado de nivel 1: la marca de la barra superior es un enlace, no un encabezado.
        */}
        <h1 className="sr-only">{ui.home.pageHeading}</h1>
        <TimelineStage releases={allReleases} today={today} />
      </main>
      {/*
        Navegación INFERIOR (solo móvil; el CSS la oculta en pantallas grandes): da acceso permanente
        a los tres destinos del producto sin obligar a volver arriba, como en una app nativa.
      */}
      <BottomNav catalog={allReleases} today={today} />
    </FilterProvider>
  );
}
