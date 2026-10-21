// Archivo: (public)/privacidad/page.tsx — El AVISO DE PRIVACIDAD del producto.
//
// En español: es la página que explica, en lenguaje llano, qué datos personales trata The Story
// Keeper, para qué los usa, con quién puede compartirlos y cómo la persona controla los suyos. La ley
// mexicana obliga a que este aviso exista y sea fácil de encontrar; por eso está enlazado desde el pie
// de página de todo el sitio.
//
// El texto está redactado conforme a la Ley Federal de Protección de Datos Personales en Posesión de
// los Particulares publicada en el Diario Oficial de la Federación el 20 de marzo de 2025 y vigente
// desde el 21 de marzo de 2025 (la ley anterior, de 2010, quedó abrogada). Con esa reforma desapareció
// el INAI y la vigilancia pasó a la Secretaría Anticorrupción y Buen Gobierno.
//
// Todo el contenido vive en el catálogo de textos (src/lib/i18n.ts), igual que el resto de la
// interfaz: esta página solo lo estructura y lo presenta. Es un Server Component (no lleva 'use
// client') porque es contenido estático: no hay estado, ni datos del navegador, ni interacción.

import type { Metadata } from "next";
import type { JSX } from "react";
import Link from "next/link";

import { ui } from "@/lib/i18n";

// metadata da a la página su título de pestaña y su descripción para buscadores.
// En español: el aviso de privacidad SÍ conviene que esté indexado (es información pública que la
// gente busca), así que no se le pone ninguna restricción a los buscadores.
export const metadata: Metadata = {
  title: `${ui.privacy.pageTitle} · ${ui.brand.full}`,
  description: ui.privacy.intro,
};

// PrivacidadPage dibuja el aviso completo: encabezado, introducción y los apartados numerados.
export default function PrivacidadPage(): JSX.Element {
  return (
    // Ancho de lectura cómodo (un texto legal a todo lo ancho de la pantalla es ilegible) y
    // espaciado generoso entre apartados.
    <main className="font-ui mx-auto flex max-w-[760px] flex-col gap-6 px-5 py-12 sm:px-8 sm:py-16">
      {/* Enlace de regreso: va primero para que sea lo primero que encuentre quien navega con Tab. */}
      <Link
        href="/"
        className="font-mono inline-flex w-fit items-center gap-2 text-xs tracking-[0.08em] text-gold no-underline transition-colors hover:text-gold-bright"
      >
        {/* La flecha es decorativa; el texto comunica la acción. */}
        <span aria-hidden="true">‹</span>
        {ui.privacy.back}
      </Link>

      {/* Encabezado: título del documento y desde cuándo rige esta versión. */}
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-medium text-text sm:text-3xl">
          {ui.privacy.pageTitle}
        </h1>
        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-text-subtle">
          {ui.privacy.updatedLabel}: {ui.privacy.updatedDate}
        </p>
      </header>

      {/* Introducción: de qué trata el documento y bajo qué ley está redactado. */}
      <p className="text-sm leading-[1.7] text-text-muted">{ui.privacy.intro}</p>

      {/*
        Apartados del aviso. Cada uno lleva su encabezado de sección (h2), sus párrafos y, cuando
        corresponde, una lista de puntos. Las listas vacías no se dibujan: así el mismo componente
        sirve para los apartados con enumeración y para los que son solo prosa.
      */}
      {ui.privacy.sections.map((section) => (
        <section
          key={section.heading}
          className="flex flex-col gap-3 rounded-base border p-5"
          style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        >
          <h2 className="font-hud text-[12px] font-semibold tracking-[0.16em] uppercase text-gold-bright">
            {section.heading}
          </h2>

          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-sm leading-[1.7] text-text-muted">
              {paragraph}
            </p>
          ))}

          {section.bullets.length > 0 ? (
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-[1.7] text-text-muted">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </main>
  );
}
