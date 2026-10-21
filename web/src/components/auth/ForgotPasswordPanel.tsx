"use client";

// Archivo: auth/ForgotPasswordPanel.tsx — Pantalla de «¿Olvidaste tu contraseña?».
//
// En español: aquí solo se pide el correo de la cuenta. Con él, el servidor pone en marcha el
// restablecimiento y genera un enlace personal de un solo uso que lleva a /restablecer, donde se
// escribe la contraseña nueva.
//
// LO MÁS IMPORTANTE DE ESTA PANTALLA (y lo que hay que respetar si alguien la retoca):
//
// El servidor responde EXACTAMENTE LO MISMO exista o no la cuenta. No es un descuido, es una
// defensa: si respondiera "ese correo no está registrado", cualquiera podría ir probando correos
// ajenos desde aquí y averiguar cuáles tienen cuenta en el sitio. Por eso el mensaje de éxito dice
// "si ese correo tiene una cuenta…" y nunca "ya te enviamos el correo": afirmar eso sería mentirle
// a quien escribió un correo que no está registrado, y de paso delatar a los que sí lo están.
//
// El mensaje también aclara el canal real de entrega mientras la beta es cerrada: hoy no se envían
// correos automáticos (haría falta un dominio propio y un proveedor de pago), sino que quien
// administra la beta pasa el enlace por el mismo medio por el que invitó a la persona.

import { useEffect, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/lib/auth-context";
import { ui } from "@/lib/i18n";

// looksLikeEmail comprueba, sin pretensiones, que lo escrito tenga forma de correo (algo@algo.algo).
// En español: es una criba rápida para no gastar una llamada al servidor por una errata evidente.
// La comprobación de verdad la hace el servidor; aquí solo se evita el viaje inútil.
function looksLikeEmail(email: string): boolean {
  const at = email.indexOf("@");
  return at > 0 && email.indexOf(".", at) > at + 1;
}

type ForgotPasswordPanelProps = {
  // onBack devuelve a la pantalla de entrada. Lo dispara el botón «Volver» y también la tecla Esc.
  onBack: () => void;
};

export function ForgotPasswordPanel({ onBack }: ForgotPasswordPanelProps) {
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  // submitting cubre el estado de CARGA: mientras la llamada viaja, el botón se bloquea y lo dice.
  const [submitting, setSubmitting] = useState(false);
  // requested marca que la petición ya se hizo: entonces se sustituye el formulario por la
  // explicación de qué pasa ahora. Se deja de mostrar el campo para que nadie lo reenvíe sin querer.
  const [requested, setRequested] = useState(false);

  // La referencia al campo de correo sirve para llevarle el foco al abrir la pantalla: quien navega
  // con teclado o con lector de pantalla debe aterrizar donde hay que escribir, no al principio de
  // la página.
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    emailInputRef.current?.focus();
  }, []);

  // Esc devuelve a la pantalla de entrada, como en cualquier diálogo del producto: si alguien llegó
  // aquí por error, la tecla de escape es lo primero que va a pulsar.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!looksLikeEmail(trimmedEmail)) {
      setError(ui.auth.errorEmail);
      return;
    }

    setSubmitting(true);
    const failure = await requestPasswordReset(trimmedEmail);
    setSubmitting(false);

    if (failure !== null) {
      // Solo llega aquí si la llamada falló DE VERDAD (servidor caído, sin red, demasiados
      // intentos). "La cuenta no existe" nunca es un error: eso se responde como un éxito.
      setError(failure);
      return;
    }
    setRequested(true);
  };

  return (
    // Sin clase propia a propósito: esta pantalla vive DENTRO de la misma tarjeta de cristal del
    // login y reutiliza sus estilos (au-head, au-form, au-input…). Inventar una clase nueva obligaría
    // a tocar la hoja de estilos global para no ganar nada visualmente.
    <div>
      <header className="au-head">
        <h1 className="au-title font-hud">{ui.auth.forgot.title}</h1>
        <p className="au-sub">{ui.auth.forgot.subtitle}</p>
      </header>

      {requested ? (
        // Estado de ÉXITO: se explica qué acaba de pasar sin afirmar que la cuenta existe.
        // role="status" hace que un lector de pantalla lo anuncie sin interrumpir lo que estuviera
        // leyendo (es información, no una alarma).
        <div role="status">
          <p className="au-sub">{ui.auth.forgot.done}</p>
          <p className="au-note font-mono">{ui.auth.forgot.doneDelivery}</p>
        </div>
      ) : (
        <form className="au-form" onSubmit={handleSubmit} noValidate>
          <label className="au-field">
            <span className="au-label font-mono">{ui.auth.emailLabel}</span>
            <input
              ref={emailInputRef}
              className="au-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={ui.auth.emailPlaceholder}
              autoComplete="email"
              required
            />
          </label>

          {/* Estado de ERROR: role="alert" lo anuncia de inmediato porque interrumpe la tarea. */}
          {error !== null ? (
            <p className="au-error font-mono" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="au-submit font-hud" disabled={submitting}>
            {submitting ? ui.auth.submitting : ui.auth.forgot.submit}
          </button>
        </form>
      )}

      {/* Salida siempre visible: se pueda o no completar la operación, nunca se queda uno atrapado. */}
      <button type="button" className="au-tab" onClick={onBack}>
        {ui.auth.forgot.back}
      </button>
    </div>
  );
}
