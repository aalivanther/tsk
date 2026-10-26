// Layout raíz de la app web "MDM 7mo".
//
// En español: este es el "marco" que envuelve a TODAS las páginas. Aquí se hace
// una sola vez lo que es común a todo el sitio:
//   - cargar las tres fuentes del producto (Fraunces, Geist y Geist Mono) y
//     exponerlas como variables CSS para que los tokens de globals.css las usen,
//   - importar los estilos globales (tokens de color, base y accesibilidad),
//   - declarar el idioma del documento (es-MX) y los datos de la pestaña
//     (título y descripción que ven el usuario y los buscadores),
//   - pintar el fondo orgánico (Background) detrás de todo,
//   - envolver el contenido con los Providers (estado compartido de datos del
//     cliente: TanStack Query y el transporte de Connect).
// En Next.js (App Router) todo lo que esté aquí aplica a cada ruta de la app.

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { JSX, ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
// Fondo orgánico (blobs + grano + viñeta). Es un componente de servidor.
import Background from "@/components/Background";
// Providers envuelve la app con el estado compartido del cliente (TanStack Query
// y el transporte de Connect).
import { Providers } from "@/components/Providers";
import { IntentPrefetch } from "@/components/IntentPrefetch";
import { setupPending } from "@/lib/local-setup";

// Fraunces: fuente DISPLAY del producto (serif de cartel de cine clásico) para los TÍTULOS de estrenos,
// hero y modales. Es una fuente VARIABLE: un solo archivo cubre todos los pesos y, además, trae el eje
// ÓPTICO (opsz), que ajusta el contraste del trazo al tamaño — dramática en un hero de 48px y legible en
// una tarjeta de 16px, sin cambiar de familia. Sustituye a Cinzel, que era SOLO MAYÚSCULAS: los títulos
// largos en español ("El Señor de los Anillos") salían en versalitas y perdían jerarquía y lectura.
// Se carga desde Google Fonts vía Next.js, que la optimiza y la sirve desde nuestro dominio.
const fraunces = localFont({ src: "../public/fonts/fraunces.woff2", variable: "--font-fraunces", display: "swap" });

// Space Grotesk: fuente HUD del producto (geométrica contemporánea) para kickers, etiquetas y datos de
// interfaz. Variable (un archivo). Da el aire "tech" que antes ponía Orbitron, pero sin su disfraz
// sci-fi, que en textos funcionales competía con la voz del display y costaba de leer.
const spaceGrotesk = localFont({ src: "../public/fonts/space-grotesk.woff2", variable: "--font-space-grotesk", display: "swap" });

// Orbitron: se conserva EXCLUSIVAMENTE como logotipo de la marca (un solo peso, un solo archivo). Es una
// excepción deliberada: la marca ya tiene esa forma reconocible, pero fuera del logotipo la interfaz
// habla con Space Grotesk.
const orbitron = localFont({ src: "../public/fonts/orbitron.woff2", variable: "--font-orbitron", display: "swap" });

// Inter: fuente de INTERFAZ/cuerpo (sans neutra, altísima legibilidad en oscuro) para textos normales.
// Sin lista de pesos: Next carga su versión VARIABLE (un archivo cubre todo el rango).
const inter = localFont({ src: "../public/fonts/inter.woff2", variable: "--font-inter", display: "swap" });

// JetBrains Mono: fuente MONOESPACIADA (tech) para chips, datos, timestamps y ratings. También variable.
const jetbrainsMono = localFont({ src: "../public/fonts/jetbrains-mono.woff2", variable: "--font-jetbrains", display: "swap" });

// metadata define lo que aparece en la pestaña del navegador y en buscadores.
// En español: el título y la descripción "oficiales" del producto, en es-MX.
// Next.js los inserta automáticamente en el <head> de cada página.
export const metadata: Metadata = {
  title: "The Story Keeper",
  description:
    "The Story Keeper: agregador de estrenos de cine, streaming y cadenas, con una línea de tiempo navegable de lo que viene.",
  // applicationName y appleWebApp hacen que, al instalarse en el teléfono, la app se llame y se
  // comporte como una aplicación: nombre corto bajo el icono y arranque a pantalla completa en iOS
  // (donde la instalación es manual: Compartir → Añadir a inicio).
  applicationName: "The Story Keeper",
  appleWebApp: {
    capable: true,
    title: "Story Keeper",
    // statusBarStyle "black-translucent": la barra de estado se funde con el fondo oscuro de la app,
    // que es lo que hace que se vea "a pantalla completa" de verdad en iOS.
    statusBarStyle: "black-translucent",
  },
  // Iconos: los del navegador (favicon), el de iOS al instalar, y los del manifiesto para Android.
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // formatDetection desactiva que iOS convierta números en enlaces de teléfono: en un catálogo de
  // estrenos, las fechas y las calificaciones NO son números de teléfono y se veían como enlaces azules.
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

// viewport configura el "lienzo" en móvil: ancho = ancho REAL del dispositivo y escala inicial 1 (sin
// zoom forzado). En Next 16 esto se exporta aparte de metadata. Sin él, los móviles asumen ~980px de
// ancho y la UI sale diminuta; con él, el diseño responsive de globals.css aplica de verdad. Permitimos
// el zoom del usuario (accesibilidad: no fijamos maximumScale) y cubrimos el notch (viewportFit cover).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // themeColor tiñe la barra del sistema (barra de estado en móvil, barra de título en escritorio)
  // con el color de la app, uno por tema. Es de los detalles que más "app nativa" hacen sentir una
  // web: el cromo del navegador deja de ser una franja ajena y pasa a formar parte de la interfaz.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070809" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
  ],
};

// TODAS las páginas se construyen en el momento de pedirlas. Nunca por adelantado.
//
// Esto NO es una preferencia de rendimiento: es un requisito de la protección contra scripts
// inyectados, y saltárselo rompe la aplicación de una forma que no da ningún aviso. Merece la pena
// entender por qué, porque es el fallo más silencioso que ha tenido este proyecto.
//
// La protección funciona así: en cada petición, el servidor inventa un número irrepetible y le dice
// al navegador "solo ejecuta los scripts que lleven ESTE número". Los scripts propios de la página lo
// llevan; uno inyectado por un atacante no puede llevarlo, porque no puede adivinarlo.
//
// El problema aparece si una página se construye POR ADELANTADO, al compilar. En ese momento no hay
// ninguna petición y, por tanto, no hay número que poner. La página se guarda con sus scripts sin
// marcar, y cuando alguien la visita el navegador los bloquea TODOS — incluidos los que hacen que la
// página funcione. El resultado es demoledor precisamente porque parece inofensivo: la pantalla se
// dibuja perfecta, con sus textos y sus botones, y no hace absolutamente nada al pulsarlos. Ni un
// error a la vista. Le ocurrió a la pantalla de inicio de sesión, que se veía impecable y era un
// dibujo: nadie podía entrar.
//
// Declararlo aquí, en la raíz, cubre TODA la aplicación de una vez, incluidas las pantallas que no
// tienen archivo propio donde ponerlo (la de "página no encontrada" y las de error). Ponerlo página
// por página fue justamente lo que dejó tres fuera.
export const dynamic = "force-dynamic";

// RootLayout es el componente que envuelve todas las páginas de la app.
// En español: recibe el contenido de cada página en "children" y lo coloca
// dentro de la estructura común (html y body) con las fuentes aplicadas, el
// fondo detrás y los providers de datos alrededor.
export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): Promise<JSX.Element> {
  // El número de un solo uso de ESTA petición, que puso el middleware.
  //
  // En español: la política de seguridad solo deja correr los scripts que lleven este número. El
  // framework marca los suyos automáticamente, pero el script del tema (unas líneas más abajo) lo
  // escribimos nosotros a mano, así que también hay que marcarlo a mano. Sin esto, el navegador lo
  // bloquea y la página arranca siempre en tema oscuro, dando un destello a quien usa el claro.
  const headerStore = await headers();
  const nonce = headerStore.get("x-nonce") ?? "";
  const pathname = headerStore.get("x-pathname") ?? "";
  // En preparación solo se abre la pantalla de configuración. El resto espera a que
  // el servicio reinicie con la clave de sesión ya guardada.
  if (
    setupPending() &&
    pathname !== "/configuracion" &&
    !pathname.startsWith("/configuracion/")
  ) {
    redirect("/configuracion");
  }

  return (
    // lang="es-MX" declara que el contenido está en español de México, lo que
    // ayuda a accesibilidad (lectores de pantalla) y a buscadores.
    // suppressHydrationWarning evita avisos por diferencias menores que pueden
    // introducir las clases de fuente entre servidor y navegador.
    <html
      lang="es-MX"
      suppressHydrationWarning
      // data-theme arranca en "dark" (default del producto). El script inline de abajo lo cambia a "light"
      // ANTES del primer paint si el usuario lo dejó así, evitando el parpadeo oscuro→claro al recargar.
      data-theme="dark"
      // CLAVE: las variables de next/font van en <html> (=:root), NO en <body>. Los tokens de globals.css
      // (--font-display/--font-ui/--font-mono) viven en :root y referencian estas variables; si estuvieran
      // en <body>, en :root saldrían indefinidas -> el token quedaba inválido/vacío y el texto caía a la
      // fuente del sistema. Con las fuentes en :root, los tokens resuelven y heredan a toda la app.
      className={`${fraunces.variable} ${spaceGrotesk.variable} ${orbitron.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/*
          NO-FLASH del tema: este script corre durante el parseo del <body>, antes de pintar el contenido.
          Lee la copia plana del tema en localStorage ("tsk-theme"; cae a la llave legada "mdm7mo-theme"
          de instalaciones previas) y fija <html data-theme> al instante.
          Si falta o falla, queda el default "dark" ya puesto en el atributo del <html>. Debe ir lo más
          arriba posible del body para minimizar cualquier destello.
        */}
        <script
          nonce={nonce}
          // El navegador quita el nonce después de aplicar la política. Sin este aviso,
          // React cree que el script cambió y en desarrollo tapa la página con un error.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('tsk-theme')||localStorage.getItem('mdm7mo-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}",
          }}
        />
        {/*
          Fondo orgánico: se pinta primero para que quede detrás (z-index 0) de
          todo el contenido. No interfiere con clics ni con lectores de pantalla.
        */}
        <Background />

        {/*
          Providers rodea al contenido con el estado compartido del
          cliente. La capa "app" lo eleva por encima del fondo (z-index 1) y
          establece el contexto de apilamiento, igual que en el cascarón v3.
        */}
        <Providers>
          {/*
            La COLUMNA de la aplicación: encima del fondo (z 1) y con la altura de la ventana como
            mínimo, para que el pie de página quede abajo del todo aunque la pantalla traiga poco
            contenido. Es la clase app-shell de globals.css, y ahí está explicado por qué esto se
            resuelve aquí, en un solo sitio, y no pantalla por pantalla.
          */}
          <div className="app-shell relative z-[1]">{children}</div>
          {/* Adelanta los enlaces de navegación marcados (data-intent-prefetch) solo cuando hay
              intención de abrirlos: ver IntentPrefetch. */}
          <IntentPrefetch />
        </Providers>
      </body>
    </html>
  );
}
