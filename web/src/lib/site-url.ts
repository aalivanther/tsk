// Archivo: site-url.ts — De dónde sale la DIRECCIÓN PÚBLICA del sitio (la base de todos los enlaces).
//
// En español: hay tres sitios donde la app necesita saber su propia dirección completa ("https://…"),
// y no basta con una ruta relativa:
//   1) El mapa del sitio (sitemap.xml), que lista URLs absolutas para los buscadores.
//   2) El archivo robots.txt, que apunta a ese mapa.
//   3) Las tarjetas de vista previa al compartir un enlace (Open Graph), cuya imagen se resuelve
//      contra esta base.
//
// La dirección se toma de la variable de entorno SITE_URL. NO lleva el prefijo NEXT_PUBLIC_ a
// propósito: solo la usa el servidor, y todo lo que lleva ese prefijo se copia dentro del código que
// baja al navegador. Si la variable no está definida (desarrollo local), se usa la dirección local de
// siempre — así nada se rompe y no se inventa un dominio de producción que no existe.

// DEFAULT_SITE_URL es la dirección de desarrollo (el servidor de Next en la máquina de quien programa).
const DEFAULT_SITE_URL = "http://localhost:3000";

// siteUrl devuelve la dirección base del sitio, SIN la barra final (para poder concatenar rutas).
// En español: quita espacios sobrantes y una posible barra al final, de forma que unir la base con
// "/titulo/abc" nunca produzca una dirección con dos barras seguidas.
export function siteUrl(): string {
  const configured = (process.env.SITE_URL ?? "").trim();
  const base = configured !== "" ? configured : DEFAULT_SITE_URL;
  return base.replace(/\/+$/, "");
}
