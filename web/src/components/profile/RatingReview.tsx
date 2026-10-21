"use client";

// Archivo: profile/RatingReview.tsx — BARRA de calificación 1–10 (con decimales) para reseñar un estreno.
//
// En español: una barra horizontal ARRASTRABLE (también navegable por teclado) para dar una nota del 1.0 al
// 10.0 en pasos de 0.1. Al soltar/cambiar se GUARDA la reseña en el perfil (localStorage) — reseñar implica
// marcar el estreno como "visto". Es un slider accesible (role="slider", aria-valuenow, flechas del teclado).
// Si ya hay reseña, muestra la nota actual y permite editarla o borrarla.

import { useCallback, useRef, useState } from "react";

import { useProfile } from "@/lib/profile-context";
import { ui } from "@/lib/i18n";

type RatingReviewProps = {
  releaseId: string;
};

// MIN/MAX/STEP definen el rango y el paso de la nota.
const MIN = 1;
const MAX = 10;

// clampStep redondea un valor al paso de 0.1 y lo acota a [1, 10].
function clampStep(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Math.min(MAX, Math.max(MIN, rounded));
}

export function RatingReview({ releaseId }: RatingReviewProps) {
  const { getReview, setReview, removeReview, inWatched } = useProfile();
  const existing = getReview(releaseId);

  // GATING: solo se puede calificar lo que ya marcaste como "Vista". El branch va en el RETURN (no early
  // return) para no romper la regla de hooks: todos los hooks de abajo se llaman siempre.
  const watched = inWatched(releaseId);

  // value es la nota MOSTRADA mientras se arrastra (estado local). Arranca en la reseña previa o en 5.0.
  const [value, setValue] = useState<number>(existing ?? 5);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Si la reseña previa cambia (p. ej. tras hidratar localStorage), sincronizamos el valor mostrado.
  // Patrón "estado derivado de una prop" de React: comparamos contra el último valor visto y ajustamos
  // DURANTE el render (re-render inmediato, sin pintar el valor viejo ni usar un efecto).
  const [lastExisting, setLastExisting] = useState<number | undefined>(existing);
  if (existing !== lastExisting) {
    setLastExisting(existing);
    if (existing !== undefined) {
      setValue(existing);
    }
  }

  // valueFromClientX traduce la posición horizontal del puntero a una nota 1.0–10.0 (paso 0.1).
  const valueFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (track === null) {
      return MIN;
    }
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return clampStep(MIN + ratio * (MAX - MIN));
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      trackRef.current?.setPointerCapture(event.pointerId);
      setValue(valueFromClientX(event.clientX));
    },
    [valueFromClientX],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (draggingRef.current) {
        setValue(valueFromClientX(event.clientX));
      }
    },
    [valueFromClientX],
  );

  // Al soltar, GUARDAMOS la reseña con el valor actual (auto-save).
  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    setValue((current) => {
      setReview(releaseId, current);
      return current;
    });
  }, [releaseId, setReview]);

  // Teclado: flechas ajustan ±0.1 (con Shift ±1) y guardan al instante (a11y de slider).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const big = event.shiftKey ? 1 : 0.1;
      let next = value;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        next = clampStep(value - big);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        next = clampStep(value + big);
      } else if (event.key === "Home") {
        next = MIN;
      } else if (event.key === "End") {
        next = MAX;
      } else {
        return;
      }
      event.preventDefault();
      setValue(next);
      setReview(releaseId, next);
    },
    [value, releaseId, setReview],
  );

  // Porcentaje de la barra (0–100) para posicionar el relleno y la perilla.
  const percent = ((value - MIN) / (MAX - MIN)) * 100;

  // Sin "Vista": aviso bloqueado en lugar de la barra (reseñar exige haber visto el estreno).
  if (!watched) {
    return (
      <div className="pf-rating pf-rating-locked">
        <span aria-hidden="true" className="pf-rating-lock-glyph">
          ✦
        </span>
        <p className="pf-rating-lock-text font-mono">{ui.profile.reviewLockedHint}</p>
      </div>
    );
  }

  return (
    <div className="pf-rating">
      <div className="pf-rating-head">
        <span className="pf-rating-cap font-hud">{ui.profile.reviewLabel}</span>
        <span className="pf-rating-value font-mono">
          {value.toFixed(1)}
          <small>/10</small>
        </span>
      </div>

      <div
        ref={trackRef}
        className="pf-rating-bar"
        role="slider"
        tabIndex={0}
        aria-label={ui.profile.reviewLabel}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-valuetext={ui.profile.reviewValueText(value.toFixed(1))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <span className="pf-rating-fill" style={{ width: `${percent}%` }} />
        <span className="pf-rating-knob" style={{ left: `${percent}%` }} />
      </div>

      <div className="pf-rating-foot">
        <span className="pf-rating-hint font-mono">{ui.profile.reviewHint}</span>
        {existing !== undefined ? (
          <button
            type="button"
            className="pf-rating-remove font-mono"
            onClick={() => removeReview(releaseId)}
          >
            {ui.profile.removeReview}
          </button>
        ) : null}
      </div>
    </div>
  );
}
