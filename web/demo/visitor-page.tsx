import Link from "next/link";

// La demo no tiene cuentas. Esta pantalla ocupa el lugar de inicio de sesión.
export default function VisitorPage() {
  return (
    <main className="font-ui mx-auto max-w-xl px-6 py-16">
      <h1 className="font-display text-3xl">Perfil de visitante</h1>
      <p className="my-6 leading-relaxed">
        Esta es una demo estática. Tu lista, reseñas y preferencias se guardan únicamente en este
        navegador. No hay cuentas, contraseñas ni sincronización.
      </p>
      <Link href="/perfil" className="text-gold">
        Abrir mi perfil local →
      </Link>
    </main>
  );
}
