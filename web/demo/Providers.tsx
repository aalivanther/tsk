"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/auth-context";
import { ProfileProvider } from "@/lib/profile-context";

// La demo no abre el cable hacia el servidor. El perfil vive en este navegador.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ProfileProvider>{children}</ProfileProvider>
    </AuthProvider>
  );
}
