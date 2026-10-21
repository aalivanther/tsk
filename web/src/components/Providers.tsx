"use client";

// Archivo: Providers.tsx — Cableado de datos para el lado NAVEGADOR (cliente).
// En español: este componente envuelve toda la app con dos "proveedores" que el resto de la
// interfaz necesita cuando pide datos DESDE EL NAVEGADOR del usuario (a diferencia del servidor,
// que tiene su propio cable en src/lib/connect/transport.ts):
//   1) QueryClientProvider (TanStack Query): la "memoria" que guarda en caché las respuestas y
//      coordina cargas, reintentos y refrescos, para no pedir lo mismo dos veces.
//   2) TransportProvider (connect-query): comparte el "cable" hacia el backend con todos los hooks
//      de datos del árbol, para que cualquier pantalla pueda preguntar sin reconfigurar la conexión.
// En esta fase la home obtiene sus datos en el servidor; estos proveedores quedan listos para los
// hooks de connect-query que las pantallas interactivas usarán en sprints siguientes (S6/S7).

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransportProvider } from "@connectrpc/connect-query";
import { AuthProvider } from "@/lib/auth-context";
import { createBrowserTransport } from "@/lib/connect/browser-transport";
import { ProfileProvider } from "@/lib/profile-context";

// Props son las propiedades que recibe Providers: únicamente los hijos a los que envolverá.
// En español: "children" es todo el contenido de la app que vivirá dentro de estos proveedores.
type Props = {
  children: ReactNode;
};

// Providers envuelve la app con la caché de datos (TanStack) y el cable hacia el backend (Connect).
// En español: se coloca una sola vez, alto en el árbol (en el layout), y a partir de ahí cualquier
// componente cliente del proyecto puede consumir datos del backend con caché y reintentos.
export function Providers({ children }: Props) {
  // Creamos el QueryClient UNA sola vez por montaje del componente, con useState.
  // En español: si lo creáramos en cada render, se reiniciaría la caché en cada actualización de la
  // interfaz (perdiendo todo lo guardado). Con useState y una función inicializadora, React lo crea
  // la primera vez y conserva esa misma instancia estable durante toda la vida del componente.
  const [queryClient] = useState(() => new QueryClient());

  // Creamos el transport del navegador, estable con useState.
  // En español: es el "cable" que los hooks de datos usarán desde el navegador. Lo creamos una vez y
  // lo reutilizamos, para no rearmar la conexión en cada render. Apunta al puente "/rpc" de nuestra
  // propia web (ver lib/connect/browser-transport.ts).
  const [transport] = useState(() => createBrowserTransport());

  // Anidamos los proveedores: el transport por fuera y la caché por dentro.
  // En español: así, todo "children" tiene disponibles tanto el cable hacia el backend como la
  // memoria de TanStack Query.
  // ProfileProvider (perfil local en localStorage) va POR DENTRO, disponible para toda la app cliente.
  return (
    <TransportProvider transport={transport}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ProfileProvider>{children}</ProfileProvider>
        </AuthProvider>
      </QueryClientProvider>
    </TransportProvider>
  );
}
