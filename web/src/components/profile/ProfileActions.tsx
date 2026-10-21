"use client";

// Archivo: profile/ProfileActions.tsx — Botones "Quiero ver" / "Vista" para añadir un estreno al perfil.
//
// En español: dos botones que alternan la pertenencia del estreno a las listas del perfil (watchlist y
// biblioteca de vistos), guardadas en localStorage vía useProfile. Se reutiliza en la PREVIA del modal y en
// la FICHA de detalle. Mientras el perfil no se hidrata desde localStorage, mostramos el estado por defecto
// (no marcado) sin romper nada. Botones reales (teclado, aria-pressed).

import { useProfile } from "@/lib/profile-context";
import { ui } from "@/lib/i18n";

type ProfileActionsProps = {
  // releaseId es el id del estreno a gestionar.
  releaseId: string;
};

export function ProfileActions({ releaseId }: ProfileActionsProps) {
  const { inWatchlist, inWatched, toggleWatchlist, toggleWatched } = useProfile();
  const wl = inWatchlist(releaseId);
  const wd = inWatched(releaseId);

  return (
    <div className="pf-actions font-hud">
      {/* Quiero ver (watchlist). */}
      <button
        type="button"
        className={`pf-act${wl ? " is-on" : ""}`}
        aria-pressed={wl}
        onClick={() => toggleWatchlist(releaseId)}
      >
        <span aria-hidden="true">{wl ? "✓" : "+"}</span>
        {wl ? ui.profile.inWatchlist : ui.profile.addToWatchlist}
      </button>
      {/* Vista (biblioteca). */}
      <button
        type="button"
        className={`pf-act${wd ? " is-on" : ""}`}
        aria-pressed={wd}
        onClick={() => toggleWatched(releaseId)}
      >
        <span aria-hidden="true">{wd ? "✓" : "◎"}</span>
        {wd ? ui.profile.watched : ui.profile.markWatched}
      </button>
    </div>
  );
}
