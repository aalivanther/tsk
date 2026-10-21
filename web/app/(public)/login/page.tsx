// Archivo: (public)/login/page.tsx — La página de INICIAR SESIÓN / CREAR CUENTA.
//
// En español: el login es OPCIONAL en el producto. Esta página solo monta el componente cliente LoginView
// (formulario que habla con el AuthService del backend). No necesita datos del servidor, así que es una
// página mínima; toda la lógica (validación, llamadas, redirección) vive en el cliente.

import { LoginView } from "@/components/auth/LoginView";

export default function LoginPage() {
  return <LoginView />;
}
