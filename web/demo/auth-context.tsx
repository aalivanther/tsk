"use client";

import type { ReactNode } from "react";

import type { User } from "@/gen/mdm7mo/auth/v1/auth_pb";

const unavailable = async (..._args: unknown[]): Promise<string> =>
  "Esta demo guarda el perfil solo en este navegador.";

const visitor = {
  user: null as User | null,
  loading: false,
  register: unavailable,
  login: unavailable,
  logout: async () => {},
  changePassword: unavailable,
  deleteAccount: unavailable,
  requestPasswordReset: unavailable,
  resetPassword: unavailable,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useAuth() {
  return visitor;
}
