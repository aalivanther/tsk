"use client";

// Archivo: auth/LoginView.tsx — Pantalla de INICIAR SESIÓN / CREAR CUENTA.
//
// En español: un formulario con dos pestañas (entrar / registrarse) que llama al AuthService vía
// useAuth. El login es OPCIONAL en el producto, así que la pantalla lo recuerda. Al autenticarse con
// éxito, redirige al perfil. Valida en el cliente lo mínimo (correo con forma válida, contraseña de 8+)
// antes de molestar al backend, y muestra los errores del backend de forma legible.
//
// La pantalla tiene además una tercera vista, la de recuperar el acceso («¿Olvidaste tu
// contraseña?»), que sustituye al formulario dentro de la misma tarjeta en vez de llevarse a la
// persona a otra página: quien está intentando entrar no debería perder el sitio donde estaba.
//
// Sobre el CÓDIGO DE INVITACIÓN: The Story Keeper está en beta cerrada. Quien decide si hace falta un
// código es el servidor (bandera REQUIRE_INVITE), no esta pantalla, así que el campo se muestra
// siempre al crear cuenta y su contenido viaja siempre en la llamada, incluso vacío. Si el servidor
// no exige invitación, lo ignora sin gastar el código; si la exige y falta o no sirve, responde
// "permiso denegado" y el mensaje que se ve explica qué hacer.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ForgotPasswordPanel } from "@/components/auth/ForgotPasswordPanel";
import { useAuth } from "@/lib/auth-context";
import { ui } from "@/lib/i18n";

// Mode es qué se está haciendo en la tarjeta: entrar, crear cuenta o recuperar el acceso.
type Mode = "login" | "register" | "forgot";

// MINIMUM_PASSWORD_LENGTH es el mínimo de caracteres que exige el servidor. Se comprueba también
// aquí para avisar al instante en vez de esperar un viaje de ida y vuelta que va a fallar seguro.
const MINIMUM_PASSWORD_LENGTH = 8;

// INVITE_HINT_ID es el identificador que une el campo del código con su explicación (aria-describedby).
// Tiene nombre propio para que los dos sitios que lo usan no puedan desincronizarse por una errata.
const INVITE_HINT_ID = "au-invite-hint";

function looksLikeEmail(email: string): boolean {
  const at = email.indexOf("@");
  return at > 0 && email.indexOf(".", at) > at + 1;
}

export function LoginView() {
  const { login, register } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    // Validación de cliente (rápida, antes de la red).
    if (!looksLikeEmail(email.trim())) {
      setError(ui.auth.errorEmail);
      return;
    }
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      setError(ui.auth.errorPassword);
      return;
    }

    setSubmitting(true);
    const result = isRegister
      ? // El código de invitación viaja SIEMPRE, aunque esté vacío: es el servidor quien sabe si su
        // instalación lo exige. Se manda sin espacios sobrantes porque un código copiado y pegado
        // desde un mensaje suele arrastrarlos, y ese detalle no debería tumbar un registro.
        await register(email.trim(), password, displayName.trim(), inviteCode.trim())
      : await login(email.trim(), password);
    setSubmitting(false);

    if (result === null) {
      // Éxito: vamos al perfil.
      router.push("/perfil");
      return;
    }
    setError(result);
  };

  return (
    <div className="au-shell">
      <section className="au-card glass-2 hex">
        {isForgot ? (
          // Recuperar el acceso: ocupa la tarjeta entera y vuelve a esta misma pantalla al terminar
          // (o al pulsar Esc), sin recargar nada ni perder lo que ya estaba escrito arriba.
          <ForgotPasswordPanel
            onBack={() => {
              setMode("login");
              setError(null);
            }}
          />
        ) : (
          <>
            <header className="au-head">
              <h1 className="au-title font-hud">{ui.auth.loginTitle}</h1>
              <p className="au-sub">{ui.auth.loginSubtitle}</p>
            </header>

            {/* Pestañas entrar / registrarse. */}
            <div className="au-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={!isRegister}
                className={`au-tab${!isRegister ? " is-on" : ""}`}
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                {ui.auth.tabLogin}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isRegister}
                className={`au-tab${isRegister ? " is-on" : ""}`}
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
              >
                {ui.auth.tabRegister}
              </button>
            </div>

            <form className="au-form" onSubmit={handleSubmit} noValidate>
              {isRegister ? (
                <label className="au-field">
                  <span className="au-label font-mono">{ui.auth.displayNameLabel}</span>
                  <input
                    className="au-input"
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder={ui.auth.displayNamePlaceholder}
                    autoComplete="nickname"
                  />
                </label>
              ) : null}

              <label className="au-field">
                <span className="au-label font-mono">{ui.auth.emailLabel}</span>
                <input
                  className="au-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={ui.auth.emailPlaceholder}
                  autoComplete="email"
                  required
                />
              </label>

              <label className="au-field">
                <span className="au-label font-mono">{ui.auth.passwordLabel}</span>
                <input
                  className="au-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={ui.auth.passwordPlaceholder}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  required
                />
              </label>

              {/* Código de invitación: solo al crear cuenta. No lleva `required` porque no siempre
                  hace falta (depende del servidor); la pista explica cuándo escribirlo. La pista va
                  FUERA de la etiqueta y enlazada con aria-describedby: dentro pasaría a formar parte
                  del nombre del campo y un lector de pantalla leería el párrafo entero cada vez que
                  el foco entrara ahí. */}
              {isRegister ? (
                <>
                  <label className="au-field">
                    <span className="au-label font-mono">{ui.auth.inviteCodeLabel}</span>
                    <input
                      className="au-input"
                      type="text"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value)}
                      placeholder={ui.auth.inviteCodePlaceholder}
                      autoComplete="off"
                      aria-describedby={INVITE_HINT_ID}
                    />
                  </label>
                  <p id={INVITE_HINT_ID} className="au-note font-mono">
                    {ui.auth.inviteCodeHint}
                  </p>
                </>
              ) : null}

              {error !== null ? (
                <p className="au-error font-mono" role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="au-submit font-hud" disabled={submitting}>
                {submitting
                  ? ui.auth.submitting
                  : isRegister
                    ? ui.auth.submitRegister
                    : ui.auth.submitLogin}
              </button>
            </form>

            {/* Recuperar el acceso: solo tiene sentido para quien YA tiene cuenta, así que se ofrece
                en la pestaña de entrar. Es un botón (no un enlace) porque no navega a otra dirección:
                cambia lo que muestra esta misma tarjeta. */}
            {!isRegister ? (
              <button
                type="button"
                className="au-tab"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                }}
              >
                {ui.auth.forgot.link}
              </button>
            ) : null}

            <p className="au-note font-mono">{ui.auth.optionalNote}</p>
          </>
        )}
      </section>
    </div>
  );
}
