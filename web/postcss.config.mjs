// Configuración de PostCSS para la app web "MDM 7mo".
// En español: PostCSS es el procesador de estilos por el que pasa el CSS antes
// de llegar al navegador. Aquí solo activamos el plugin de Tailwind v4, que es
// quien lee las clases utilitarias y el bloque @theme de globals.css y produce
// el CSS final. Tailwind v4 ya no necesita autoprefixer aparte: lo trae dentro.

// config describe qué plugins de PostCSS se aplican y en qué orden.
// En español: es la lista de "ayudantes" que transforman nuestro CSS.
const config = {
  plugins: {
    // Plugin oficial de Tailwind v4 para PostCSS.
    // En español: es el motor que convierte clases como "bg-bg" o "text-gold"
    // y nuestros tokens de color en CSS real que el navegador entiende.
    "@tailwindcss/postcss": {},
  },
};

export default config;
