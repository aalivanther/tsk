// Archivo: Footer.tsx — Pie de página con las atribuciones legales obligatorias.
//
// En español: este es el bloque inferior del sitio. Su trabajo principal NO es
// decorativo: es cumplir las reglas de uso de las fuentes de datos que el
// producto consume. Por contrato debemos mostrar, de forma visible:
//   - TMDB: el aviso EXACTO en inglés (no se traduce ni se altera una coma) y su
//     logo aprobado (menos prominente que nuestra propia marca).
//   - JustWatch: atribución cuando se muestran los datos de "dónde verlo".
//   - OMDb: atribución bajo licencia CC BY-NC 4.0, sin implicar afiliación con IMDb.
//   - La marca regional "MX · es-MX".
//
// El texto de TMDB es un requisito legal literal; por eso vive como constante y se
// renderiza tal cual. Las claves de API nunca tocan este componente (van por el
// proxy del backend), así que aquí solo hay texto y un logo de marcador.
//
// Es un componente de servidor: solo dibuja contenido estático.

import Link from "next/link";
import Image from "next/image";

import { attribution, footer } from "@/lib/i18n";

// TMDB_ATTRIBUTION es el aviso legal EXACTO exigido por TMDB (en inglés).
// En español: TMDB obliga a mostrar esta frase, palabra por palabra y en inglés,
// dondequiera que usemos sus datos. NO se traduce, NO se abrevia, NO se reordena.
// Cualquier cambio rompería el cumplimiento; por eso es una constante aislada.
const TMDB_ATTRIBUTION =
  "This product uses the TMDB API but is not endorsed or certified by TMDB.";

// Footer dibuja el pie con todas las atribuciones y la marca regional.
// En español: arma el bloque de avisos legales y el sello "MX · es-MX".
export function Footer() {
  return (
    // <footer> semántico con borde superior suave y tono de texto atenuado.
    // El espaciado y los colores salen del cascarón v3 (footer).
    <footer
      className="font-ui mt-8 flex flex-col justify-between gap-4 px-4 py-10 text-xs text-text-subtle sm:flex-row sm:px-10"
      style={{ borderTop: "1px solid var(--color-border-soft)" }}
    >
      {/*
        Columna de atribuciones: ocupa el lado izquierdo en pantallas anchas.
        max-w limita el ancho para que el texto sea cómodo de leer.
      */}
      <div className="flex max-w-[560px] flex-col gap-3 leading-relaxed" aria-label="Créditos">
        {/*
          Bloque TMDB: logo (marcador accesible) + el aviso legal EXACTO.
          El logo va como placeholder textual con rol e etiqueta ARIA hasta
          colocar el asset aprobado; NO inventamos un binario de imagen. Se
          comenta para el operador que aquí va el logo oficial cuando se tenga.
        */}
        <div className="flex items-start gap-3">
          {/*
            Marcador del logo TMDB: una "caja" con las siglas y su color de marca.
            role="img" + aria-label hacen que un lector de pantalla lo anuncie como
            el logo de TMDB. Frontera de alcance (no es deuda escondida): aquí va el
            logo aprobado de TMDB (asset oficial) cuando se incorpore al proyecto,
            manteniéndolo menos prominente que la marca propia, como exigen sus términos.
          */}
          <a href="https://www.themoviedb.org"><Image src="/tmdb.svg" width={77} height={10} alt={attribution.tmdbLogoAlt} unoptimized /></a>
          {/*
            El aviso legal va en <span lang="en"> porque es un texto en inglés
            obligatorio dentro de una página en español; el atributo lang ayuda a
            los lectores de pantalla a pronunciarlo correctamente.
          */}
          <span lang="en">{TMDB_ATTRIBUTION}</span>
        </div>

        {/*
          Atribución a JustWatch: la fuente de los datos de "dónde verlo".
          En español visible para el usuario (es-MX), tomado de i18n.
        */}
        <p>{attribution.justWatch}</p>

        {/*
          Atribución a OMDb: bajo licencia CC BY-NC 4.0 y SIN implicar afiliación
          con IMDb. El texto literal de licencia/afiliación vive en i18n.
        */}
        <p>{attribution.omdb}</p>
      </div>

      {/*
        Columna derecha: los enlaces legales y el sello regional. El aviso de privacidad es
        obligatorio por la ley mexicana de datos personales y debe ser fácil de encontrar desde
        cualquier pantalla; por eso vive en el pie, que acompaña a todas las páginas públicas.
      */}
      <div className="flex shrink-0 flex-col gap-3 self-start">
        <nav aria-label={footer.legalLabel} className="flex flex-col gap-2">
          <Link
            href="/configuracion"
            className="font-mono tracking-[0.08em] text-text-muted underline-offset-4 transition-colors hover:text-gold"
          >
            {footer.setupLink}
          </Link>
          <Link
            href="/privacidad"
            className="font-mono tracking-[0.08em] text-text-muted underline-offset-4 transition-colors hover:text-gold"
          >
            {footer.privacyLink}
          </Link>
        </nav>
        {/* Sello regional "MX · es-MX": indica país e idioma del contenido. */}
        <p className="font-mono tracking-[0.08em]">{attribution.region}</p>
      </div>
    </footer>
  );
}
