// Archivo: (public)/restablecer/page.tsx — La página a la que lleva el enlace de RESTABLECER CONTRASEÑA.
//
// En español: cuando alguien pide recuperar el acceso, el servidor genera un enlace personal con la
// forma "/restablecer?token=…" (ver backend/internal/auth/delivery.go). Esta es la página que abre ese
// enlace. Su único trabajo de servidor es sacar el token de la dirección y pasárselo al componente
// cliente, que es quien pide la contraseña nueva y habla con el backend.
//
// Por qué el token se lee AQUÍ y no en el navegador: leerlo en el servidor evita tener que envolver la
// pantalla en un límite de carga (Suspense) solo para consultar la dirección, y deja el componente
// cliente con una entrada sencilla —una cadena— que además es trivial de probar.
//
// La página es dinámica por naturaleza: depende de un parámetro distinto en cada visita, así que
// Next la dibuja en cada petición y nunca la guarda pre-generada.

import type { Metadata } from "next";

import { ResetPasswordView } from "@/components/auth/ResetPasswordView";
import { ui } from "@/lib/i18n";

// RESET_TOKEN_PARAMETER es el nombre del parámetro que lleva el token en el enlace. Tiene que
// coincidir EXACTAMENTE con el que compone el backend; por eso está escrito una sola vez y con nombre.
const RESET_TOKEN_PARAMETER = "token";

// metadata: título de pestaña y, sobre todo, la orden de NO indexar.
// En español: esta dirección lleva un permiso temporal para entrar en una cuenta. Que un buscador la
// guarde y la muestre sería regalar ese permiso a cualquiera que buscara.
export const metadata: Metadata = {
  title: `${ui.auth.reset.title} · ${ui.brand.full}`,
  robots: { index: false, follow: false },
};

// SearchParams es la forma en que Next entrega los parámetros de la dirección: una promesa, y cada
// valor puede venir repetido (por eso el tipo admite una lista).
type RestablecerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// resolveToken saca el token de los parámetros dejándolo siempre en una cadena.
// En español: si el parámetro no viene, se devuelve cadena vacía y la pantalla explicará qué falta.
// Si viniera repetido —cosa que solo pasa con una dirección manipulada a mano—, se toma el primero:
// es la única lectura posible que no inventa nada.
function resolveToken(searchParams: Record<string, string | string[] | undefined>): string {
  const rawValue = searchParams[RESET_TOKEN_PARAMETER];
  if (typeof rawValue === "string") {
    return rawValue.trim();
  }
  if (Array.isArray(rawValue) && rawValue.length > 0) {
    return rawValue[0].trim();
  }
  return "";
}

export default async function RestablecerPage({ searchParams }: RestablecerPageProps) {
  const resolvedSearchParams = await searchParams;
  return <ResetPasswordView resetToken={resolveToken(resolvedSearchParams)} />;
}
