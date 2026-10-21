"use client";

// Archivo: auth/ResetPasswordView.tsx — Pantalla donde se ESCRIBE la contraseña nueva (/restablecer).
//
// En español: es el segundo paso de recuperar el acceso. Al primero se llega desde «¿Olvidaste tu
// contraseña?»; a partir de ahí se emite un código de un solo uso que hace de contraseña temporal.
// Por eso aquí NO se pide la contraseña anterior: quien la recuerda no necesita esta pantalla.
//
// El código puede llegar de dos maneras legítimas y las dos funcionan aquí:
//
//   - Dentro de un ENLACE completo ("/restablecer?token=…"), que es como lo compone el servidor. En
//     ese caso el código ya viene puesto y la persona solo elige su contraseña.
//   - ESCRITO A MANO por quien administra la beta cerrada. Hoy es la vía real: el token se emite con
//     una herramienta de administración y se entrega por un canal privado, precisamente para que no
//     quede escrito en ningún registro del servidor. Entonces esta pantalla pide el código.
//
// Tres cosas que hace a propósito:
//
//  1. Sin código NO se queda en blanco ni esconde el formulario: explica qué falta y ofrece el campo
//     para pegarlo. Una pantalla que solo dijera "falta el enlace" dejaría tirado justo a quien
//     recibió su código a mano, que es el caso más frecuente ahora mismo.
//  2. Pide la contraseña dos veces. Como no se puede leer lo que se teclea, una errata dejaría a la
//     persona fuera de su cuenta con una contraseña que ni ella conoce.
//  3. Al terminar dice explícitamente que se cerraron TODAS las sesiones abiertas. Es un efecto
//     importante —puede echar a la persona de su teléfono— y enterarse después sería desconcertante.

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { ui } from "@/lib/i18n";

// MINIMUM_PASSWORD_LENGTH es el mínimo que exige el servidor; se comprueba aquí para avisar al
// instante en vez de gastar un intento del código en una llamada que va a fallar seguro.
const MINIMUM_PASSWORD_LENGTH = 8;

type ResetPasswordViewProps = {
  // resetToken es el código que venía en la dirección del enlace (?token=…). Cadena vacía si no
  // venía ninguno: entonces se pide en pantalla.
  resetToken: string;
};

export function ResetPasswordView({ resetToken }: ResetPasswordViewProps) {
  const { resetPassword } = useAuth();

  // cameFromLink recuerda si el código llegó en la dirección. Se calcula UNA vez, de la propiedad
  // inicial: de ahí depende si el campo del código se enseña o no, y esa decisión no debe cambiar
  // mientras la persona escribe.
  const cameFromLink = resetToken !== "";

  const [token, setToken] = useState(resetToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedToken = token.trim();
    if (trimmedToken === "") {
      setError(ui.auth.reset.errorMissingToken);
      return;
    }
    if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
      setError(ui.auth.errorPassword);
      return;
    }
    if (newPassword !== confirmation) {
      setError(ui.auth.reset.errorMismatch);
      return;
    }

    setSubmitting(true);
    const failure = await resetPassword(trimmedToken, newPassword);
    setSubmitting(false);

    if (failure !== null) {
      setError(failure);
      return;
    }
    setDone(true);
  };

  return (
    <div className="au-shell">
      <section className="au-card glass-2 hex">
        {done ? (
          // ----- Éxito: qué acaba de pasar, incluido el cierre de todas las sesiones -----
          <>
            <header className="au-head">
              <h1 className="au-title font-hud">{ui.auth.reset.doneTitle}</h1>
            </header>
            <div role="status">
              <p className="au-sub">{ui.auth.reset.done}</p>
              <p className="au-note font-mono">{ui.auth.reset.doneSessions}</p>
            </div>
            <Link href="/login" className="au-tab">
              {ui.auth.reset.goToLogin}
            </Link>
          </>
        ) : (
          <>
            <header className="au-head">
              <h1 className="au-title font-hud">{ui.auth.reset.title}</h1>
              <p className="au-sub">{ui.auth.reset.subtitle}</p>
            </header>

            {/* Sin código en la dirección se explica de dónde sale, ANTES del formulario. role="note"
                no existe en HTML, así que se usa un párrafo normal: no es una alerta (nada ha fallado
                todavía) sino la instrucción de qué hay que hacer aquí. */}
            {!cameFromLink ? <p className="au-sub">{ui.auth.reset.missingToken}</p> : null}

            <form className="au-form" onSubmit={handleSubmit} noValidate>
              {/* El campo del código solo aparece cuando NO vino en el enlace: enseñarlo cuando ya
                  está puesto solo invita a estropearlo. */}
              {!cameFromLink ? (
                <label className="au-field">
                  <span className="au-label font-mono">{ui.auth.reset.tokenLabel}</span>
                  <input
                    className="au-input"
                    type="text"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={ui.auth.reset.tokenPlaceholder}
                    autoComplete="off"
                    required
                  />
                </label>
              ) : null}

              <label className="au-field">
                <span className="au-label font-mono">{ui.auth.reset.newPasswordLabel}</span>
                <input
                  className="au-input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={ui.auth.passwordPlaceholder}
                  autoComplete="new-password"
                  required
                />
              </label>

              <label className="au-field">
                <span className="au-label font-mono">{ui.auth.reset.confirmLabel}</span>
                <input
                  className="au-input"
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={ui.auth.passwordPlaceholder}
                  autoComplete="new-password"
                  required
                />
              </label>

              {error !== null ? (
                <p className="au-error font-mono" role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="au-submit font-hud" disabled={submitting}>
                {submitting ? ui.auth.submitting : ui.auth.reset.submit}
              </button>
            </form>

            {/* Salida siempre visible: nadie se queda atrapado en esta pantalla. */}
            <Link href="/login" className="au-tab">
              {ui.auth.reset.goToLogin}
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
