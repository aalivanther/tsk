"use client";

// Archivo: profile/ProfileView.tsx — La interfaz interactiva del PERFIL (lee localStorage vía useProfile).
//
// En español: es la sección "Mi Perfil" completa según la estructura del documento de investigación
// en cinco zonas:
//   1) CABECERA DEL GUARDIÁN: avatar con iniciales, nombre, "guardián desde <fecha>" y el SELLO DE
//      RAREZA PERSONAL (deriveRarity sobre la nota media de las reseñas propias, igual que los estrenos).
//   2) ESTADÍSTICAS: cuatro tarjetas (vistas, por ver, reseñas, nota media), todas derivadas del perfil.
//   3) COLECCIONES: las pestañas de siempre (Quiero ver / Vistas / Reseñas).
//   4) ACTIVIDAD: lo último que el usuario guardó/vio/reseñó (eventos con fecha, los más nuevos arriba).
//   5) AJUSTES Y DATOS: tema, idioma, gustos, plataformas + el bloque "Tus datos" (exportar JSON y
//      borrar datos locales con confirmación de dos pasos).
// Resuelve los ids guardados a sus estrenos usando el catálogo que le pasa la página (server). Todo
// cambia el perfil local (localStorage) en vivo. Estilo: glass/hextech/Cinzel/Orbitron del producto.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";

import { downloadIcsFile } from "@/components/AddToCalendarButton";
import { useProfile, type Theme, type ActivityEvent } from "@/lib/profile-context";
import { useAuth } from "@/lib/auth-context";
import { buildIcsCalendar, icsEventsFromReleases } from "@/lib/ics";
import { coverStyleFor, seedFromId } from "@/lib/timeline";
import { deriveRarity, type Tier } from "@/lib/rarity";
import { ui } from "@/lib/i18n";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// ProfileTab son las pestañas del perfil (colecciones + actividad + ajustes).
type ProfileTab = "watchlist" | "watched" | "reviews" | "activity" | "settings";

// SEAL_TIER_LABELS traduce el nivel del sello personal a su etiqueta es-MX (mismo origen que las fichas).
const SEAL_TIER_LABELS: Record<Tier, string> = {
  legendary: ui.tiers.legendary,
  epic: ui.tiers.epic,
  rare: ui.tiers.rare,
  common: ui.tiers.common,
};

// SEAL_TIER_TOKENS asigna al sello su color de acento (mismo criterio que el detalle de estrenos).
const SEAL_TIER_TOKENS: Record<Tier, string> = {
  legendary: "var(--color-gold-bright)",
  epic: "var(--color-violet)",
  rare: "var(--color-teal)",
  common: "var(--color-text-subtle)",
};

// initialsOf saca hasta dos iniciales del nombre para el avatar (ej. "Ana Ruiz" -> "AR").
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// formatIsoDateEsMx convierte "AAAA-MM-DD" a texto legible es-MX (ej. "12 jun 2026"), en UTC para que
// el día no se corra por zona horaria. Cadena vacía si la fecha no es válida (la línea se omite).
function formatIsoDateEsMx(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return "";
  }
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("es-MX", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type ProfileViewProps = {
  // catalog son TODOS los estrenos (may–jul), para resolver los ids del perfil a estrenos completos.
  catalog: ReleaseSummary[];
  // genres y platforms son los valores reales del catálogo, para los selectores de gustos/plataformas.
  genres: string[];
  platforms: string[];
};

// LANGUAGES son los idiomas ofrecidos para el video/audio preferido (etiquetas desde i18n).
const LANGUAGES: { value: string; label: string }[] = [
  { value: "es", label: ui.profile.languages.es },
  { value: "en", label: ui.profile.languages.en },
  { value: "fr", label: ui.profile.languages.fr },
  { value: "pt", label: ui.profile.languages.pt },
  { value: "ja", label: ui.profile.languages.ja },
];

// THEMES son los temas visuales ofrecidos (oscuro default, claro "relavado a blanco"; textos de i18n).
const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: ui.profile.themeDark },
  { value: "light", label: ui.profile.themeLight },
];

export function ProfileView({ catalog, genres, platforms }: ProfileViewProps) {
  const {
    profile,
    hydrated,
    toggleWatchlist,
    toggleWatched,
    removeReview,
    setLanguage,
    toggleGenre,
    togglePlatform,
    setTheme,
    exportProfile,
    clearLocalData,
  } = useProfile();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<ProfileTab>("watchlist");

  // Mapa id -> estreno para resolver rápido las listas del perfil.
  const byId = useMemo(() => new Map(catalog.map((release) => [release.id, release])), [catalog]);
  const resolve = (ids: string[]): ReleaseSummary[] =>
    ids
      .map((id) => byId.get(id))
      .filter((release): release is ReleaseSummary => release !== undefined);

  const watchlist = resolve(profile.watchlist);
  const watched = resolve(profile.watched);
  const reviewedIds = Object.keys(profile.reviews);

  // ----- Identidad del guardián: nombre, iniciales, fecha de alta y SELLO de rareza personal -----
  // El sello aplica la MISMA escala de los estrenos (deriveRarity) a la nota media de las reseñas
  // propias: cero datos nuevos, pura derivación. Sin reseñas no hay nota media: el sello no se muestra.
  const displayName = user !== null ? user.displayName || user.email : ui.profile.anonGuardian;
  const avatarInitials = initialsOf(displayName) || "G";
  const reviewScores = Object.values(profile.reviews);
  const averageScore =
    reviewScores.length > 0
      ? reviewScores.reduce((sum, score) => sum + score, 0) / reviewScores.length
      : null;
  const sealTier = averageScore !== null ? deriveRarity(averageScore) : null;
  const sinceDate = formatIsoDateEsMx(profile.createdAt);

  return (
    <main className="pf-page font-ui">
      <Link href="/" className="pf-back font-mono">
        <span aria-hidden="true">‹</span> {ui.profile.backToTimeline}
      </Link>

      {/* ----- Zona 1: CABECERA DEL GUARDIÁN (avatar con iniciales + identidad + sello + sesión) ----- */}
      <header className="pf-head glass-2" data-seal={sealTier ?? undefined}>
        {/* Avatar con las INICIALES del guardián; el aro toma el color del sello (si lo hay). */}
        <span
          className="pf-avatar font-display"
          aria-hidden="true"
          style={sealTier !== null ? { borderColor: SEAL_TIER_TOKENS[sealTier] } : undefined}
        >
          {avatarInitials}
        </span>
        <div className="pf-head-text">
          <h1 className="pf-title font-hud">{ui.profile.title}</h1>
          {/* Identidad: nombre (o «Guardián anónimo») + sello de rareza personal (si hay reseñas). */}
          <p className="pf-identity font-display">
            {displayName}
            {sealTier !== null ? (
              <span
                className="pf-seal font-mono"
                style={{ color: SEAL_TIER_TOKENS[sealTier] }}
                aria-label={ui.profile.sealAria(SEAL_TIER_LABELS[sealTier])}
              >
                <span aria-hidden="true">◆ </span>
                {SEAL_TIER_LABELS[sealTier]}
              </span>
            ) : null}
          </p>
          {/* "Guardián desde <fecha de alta>" (la fecha nace con el perfil v2; migrados: día de migración). */}
          {sinceDate !== "" ? (
            <p className="pf-since font-mono">{ui.profile.guardianSince(sinceDate)}</p>
          ) : null}
          {/* Cuenta: si hay sesión, el correo (el nombre ya está arriba). El login es OPCIONAL. */}
          {user !== null ? (
            <p className="pf-account font-mono">
              {ui.auth.signedInAs} <strong>{user.email}</strong>
            </p>
          ) : null}
        </div>
        {/* Acción de sesión: cerrar sesión (logueado) o iniciar sesión (anónimo). Justo encima va el
            camino a la constelación: es la lectura de la biblioteca que esta pantalla enumera, y sin
            un enlace desde aquí sería una pantalla que existe y a la que nadie llega. */}
        <div className="pf-head-auth font-hud">
          <Link href="/grafo" className="pf-auth-btn">
            {ui.graph.title}
          </Link>
          {user !== null ? (
            <button type="button" className="pf-auth-btn" onClick={logout}>
              {ui.auth.logout}
            </button>
          ) : (
            <Link href="/login" className="pf-auth-btn">
              {ui.auth.goToLogin}
            </Link>
          )}
        </div>
      </header>

      {/* ----- Zona 2: ESTADÍSTICAS (cuatro tarjetas derivadas del perfil; nada inventado) ----- */}
      <section className="pf-stats" aria-label={ui.profile.title}>
        <StatCard label={ui.profile.statsWatched} value={String(profile.watched.length)} />
        <StatCard label={ui.profile.statsWatchlist} value={String(profile.watchlist.length)} />
        <StatCard label={ui.profile.statsReviews} value={String(reviewedIds.length)} />
        <StatCard
          label={ui.profile.statsAverage}
          value={averageScore !== null ? `★ ${averageScore.toFixed(1)}` : "—"}
          accent={sealTier !== null ? SEAL_TIER_TOKENS[sealTier] : undefined}
        />
      </section>

      {/* Pestañas. */}
      <nav className="pf-tabs font-hud" aria-label={ui.profile.title}>
        <TabButton active={tab === "watchlist"} onClick={() => setTab("watchlist")}>
          {ui.profile.tabWatchlist} ({profile.watchlist.length})
        </TabButton>
        <TabButton active={tab === "watched"} onClick={() => setTab("watched")}>
          {ui.profile.tabLibrary} ({profile.watched.length})
        </TabButton>
        <TabButton active={tab === "reviews"} onClick={() => setTab("reviews")}>
          {ui.profile.tabReviews} ({reviewedIds.length})
        </TabButton>
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
          {ui.profile.tabActivity} ({profile.activity.length})
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
          {ui.profile.tabSettings}
        </TabButton>
      </nav>

      {/* Contenido de la pestaña. Mientras no hidratamos localStorage, mostramos un aviso breve. */}
      {!hydrated ? (
        <p className="pf-empty font-mono">{ui.profile.loading}</p>
      ) : tab === "watchlist" ? (
        <ReleaseGrid
          items={watchlist}
          emptyText={ui.profile.emptyWatchlist}
          onRemove={toggleWatchlist}
          removeLabel={ui.profile.removeFromWatchlist}
        />
      ) : tab === "watched" ? (
        <ReleaseGrid
          items={watched}
          emptyText={ui.profile.emptyLibrary}
          onRemove={toggleWatched}
          removeLabel={ui.profile.removeFromLibrary}
          reviews={profile.reviews}
        />
      ) : tab === "reviews" ? (
        <ReleaseGrid
          items={resolve(reviewedIds)}
          emptyText={ui.profile.emptyReviews}
          onRemove={removeReview}
          removeLabel={ui.profile.removeReview}
          reviews={profile.reviews}
        />
      ) : tab === "activity" ? (
        <ActivityList events={profile.activity} byId={byId} />
      ) : (
        <SettingsPanel
          language={profile.settings.language}
          genres={genres}
          platforms={platforms}
          selectedGenres={profile.settings.genres}
          selectedPlatforms={profile.settings.platforms}
          theme={profile.settings.theme}
          onLanguage={setLanguage}
          onToggleGenre={toggleGenre}
          onTogglePlatform={togglePlatform}
          onTheme={setTheme}
          onExport={exportProfile}
          onClearData={clearLocalData}
          watchlistReleases={watchlist}
        />
      )}
    </main>
  );
}

// TabButton es un botón de pestaña (activo resaltado en oro).
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`pf-tab${active ? " is-on" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// StatCard es UNA tarjeta de estadística del perfil (rótulo pequeño + valor grande).
// En español: las cuatro tarjetas de la zona 2 (vistas / por ver / reseñas / nota media). El acento
// opcional colorea el valor (la nota media toma el color del sello de rareza personal).
function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="pf-stat glass-2">
      <span className="pf-stat-label font-mono">{label}</span>
      <span className="pf-stat-value font-display" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
    </div>
  );
}

// ACTIVITY_LABELS traduce el tipo de evento a su verbo visible (la reseña se arma con su nota).
const ACTIVITY_LABELS: Record<Exclude<ActivityEvent["kind"], "review">, string> = {
  watchlist: ui.profile.activityWatchlist,
  watched: ui.profile.activityWatched,
};

// ActivityList pinta la ACTIVIDAD RECIENTE: una fila por evento (verbo + título + fecha), la más
// nueva arriba. Los títulos se resuelven contra el catálogo; si un id ya no está (catálogo rotó),
// se muestra un texto claro en su lugar (no se oculta el evento: la acción sí ocurrió).
function ActivityList({
  events,
  byId,
}: {
  events: ActivityEvent[];
  byId: Map<string, ReleaseSummary>;
}) {
  if (events.length === 0) {
    return <p className="pf-empty font-mono">{ui.profile.emptyActivity}</p>;
  }
  return (
    <ul className="pf-activity">
      {events.map((event, index) => {
        const release = byId.get(event.id);
        const verb =
          event.kind === "review"
            ? ui.profile.activityReview((event.score ?? 0).toFixed(1))
            : ACTIVITY_LABELS[event.kind];
        return (
          <li key={`${event.kind}-${event.id}-${event.at}-${index}`} className="pf-activity-item">
            <span className="pf-activity-verb font-mono" data-kind={event.kind}>
              {verb}
            </span>
            {release !== undefined ? (
              <Link href={`/titulo/${release.id}`} className="pf-activity-title">
                {release.title}
              </Link>
            ) : (
              <span className="pf-activity-title is-unknown">
                {ui.profile.activityUnknownTitle}
              </span>
            )}
            <span className="pf-activity-date font-mono">{formatIsoDateEsMx(event.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ReleaseGrid pinta una rejilla de cards de estrenos (con su poster, título, meta y botón de quitar).
function ReleaseGrid({
  items,
  emptyText,
  onRemove,
  removeLabel,
  reviews,
}: {
  items: ReleaseSummary[];
  emptyText: string;
  onRemove: (id: string) => void;
  removeLabel: string;
  reviews?: Record<string, number>;
}) {
  if (items.length === 0) {
    return <p className="pf-empty font-mono">{emptyText}</p>;
  }
  return (
    <div className="pf-grid">
      {items.map((release) => (
        <article key={release.id} className="pf-card">
          <Link href={`/titulo/${release.id}`} className="pf-card-link">
            {/* Semilla del degradado por ID (no por posición): el color de un título no debe cambiar
                cuando se quita otro elemento de la lista (misma receta que el resto de la app). */}
            <div
              className="pf-card-poster"
              style={coverStyleFor(
                release.posterUrl || release.backdropUrl,
                seedFromId(release.id),
              )}
            >
              {reviews?.[release.id] !== undefined ? (
                <span className="pf-card-score font-mono">★ {reviews[release.id].toFixed(1)}</span>
              ) : null}
            </div>
            <span className="pf-card-title font-display">{release.title}</span>
          </Link>
          <button
            type="button"
            className="pf-card-remove font-mono"
            aria-label={removeLabel}
            onClick={() => onRemove(release.id)}
          >
            ✕
          </button>
        </article>
      ))}
    </div>
  );
}

// MINIMUM_PASSWORD_LENGTH es el mínimo de caracteres que exige el servidor para una contraseña.
// En español: se comprueba también aquí para avisar al instante, en vez de esperar una respuesta de
// error que ya sabemos que va a llegar.
const MINIMUM_PASSWORD_LENGTH = 8;

// AccountForm indica qué formulario de cuenta está abierto. Solo puede haber uno a la vez: son
// acciones delicadas y tenerlas las dos desplegadas invita a equivocarse de botón.
type AccountForm = "none" | "password" | "delete";

// AccountOutcome es lo último que se completó con éxito, para poder explicarlo después.
// En español: hace falta guardarlo porque, tras cualquiera de las dos operaciones, la sesión deja de
// existir; si no se recordara, la pantalla se quedaría muda justo cuando más hay que explicar.
type AccountOutcome = "passwordChanged" | "accountDeleted";

// AccountPanel es la gestión de la CUENTA (servidor) dentro de los ajustes del perfil: cambiar la
// contraseña y borrar la cuenta.
//
// Por qué existe, en español: el aviso de privacidad promete que los derechos sobre tus datos se
// ejercen con controles dentro de la aplicación —en particular el de CANCELACIÓN, que es borrar la
// cuenta—. El backend sabía hacerlo desde el principio, pero no había ningún botón que lo pidiera:
// la promesa estaba escrita y no se podía cumplir. Esto es ese botón, más el de cambiar la
// contraseña, que es el control básico de seguridad de cualquier cuenta.
//
// Detalle importante del comportamiento: las DOS operaciones dejan la aplicación como anónima. Al
// cambiar la contraseña porque el servidor cierra todas las sesiones a propósito (incluida esta), y
// al borrar la cuenta porque ya no hay cuenta. Por eso el panel sigue en pantalla después, con el
// mensaje de lo que pasó: desaparecer sin decir nada sería lo peor que podría hacer.
function AccountPanel() {
  const { user, changePassword, deleteAccount } = useAuth();

  const [openForm, setOpenForm] = useState<AccountForm>("none");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmationWord, setConfirmationWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<AccountOutcome | null>(null);

  // firstFieldRef apunta al primer campo del formulario abierto (solo hay uno abierto a la vez).
  // Sirve para llevar el foco al abrirlo: quien navega con teclado no debería tener que buscarlo.
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // closeForms cierra lo que hubiera abierto y BORRA lo tecleado, incluidas las contraseñas.
  // En español: vaciar los campos no es cosmético. Son contraseñas en claro; cuanto menos tiempo
  // sigan escritas en un formulario abierto en una pantalla que alguien puede dejar desatendida,
  // mejor.
  const closeForms = useCallback(() => {
    setOpenForm("none");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setDeletePassword("");
    setConfirmationWord("");
    setError(null);
    setSubmitting(false);
  }, []);

  // openFormAndReset abre uno de los formularios partiendo siempre de cero (sin errores ni textos
  // heredados del intento anterior) y retira el mensaje de la operación pasada, que ya no viene a
  // cuento si la persona está empezando otra.
  const openFormAndReset = useCallback(
    (form: AccountForm) => {
      closeForms();
      setOutcome(null);
      setOpenForm(form);
    },
    [closeForms],
  );

  // Al abrir un formulario, el foco va a su primer campo.
  useEffect(() => {
    if (openForm === "none") {
      return;
    }
    firstFieldRef.current?.focus();
  }, [openForm]);

  // Esc cierra el formulario abierto, como en el resto del producto: es la salida que todo el mundo
  // intenta primero cuando se arrepiente de haber abierto algo.
  useEffect(() => {
    if (openForm === "none") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeForms();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openForm, closeForms]);

  // handleChangePassword valida en el cliente y pide el cambio al servidor.
  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
      setError(ui.auth.errorPassword);
      return;
    }
    if (newPassword !== confirmation) {
      setError(ui.auth.reset.errorMismatch);
      return;
    }

    setSubmitting(true);
    const failure = await changePassword(currentPassword, newPassword);
    setSubmitting(false);

    if (failure !== null) {
      setError(failure);
      return;
    }
    closeForms();
    setOutcome("passwordChanged");
  };

  // handleDeleteAccount exige DOS pruebas antes de borrar: la contraseña (que eres tú) y la palabra
  // de confirmación escrita a mano (que sabes lo que estás haciendo). Un botón "¿seguro?" se pulsa
  // sin leer; escribir una palabra obliga a detenerse.
  const handleDeleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (confirmationWord.trim() !== ui.auth.account.deleteConfirmWord) {
      setError(ui.auth.account.errorConfirmWord);
      return;
    }
    if (deletePassword.length < MINIMUM_PASSWORD_LENGTH) {
      setError(ui.auth.errorPassword);
      return;
    }

    setSubmitting(true);
    const failure = await deleteAccount(deletePassword);
    setSubmitting(false);

    if (failure !== null) {
      setError(failure);
      return;
    }
    closeForms();
    setOutcome("accountDeleted");
  };

  // outcomeMessage es la explicación de lo último que se completó (o nada, si no se ha hecho nada).
  const outcomeMessage =
    outcome === "passwordChanged"
      ? ui.auth.account.changeDone
      : outcome === "accountDeleted"
        ? ui.auth.account.deleteDone
        : null;

  return (
    <>
      {/* Bloque de encabezado: qué es esto y, si no hay sesión, qué se puede hacer al respecto. */}
      <section className="pf-set-block glass-2">
        <h2 className="pf-set-label font-hud">{ui.auth.account.label}</h2>
        <p className="pf-set-hint">{ui.auth.account.hint}</p>

        {/* Resultado de la última operación. role="status" lo anuncia sin interrumpir: es
            información, no una alarma. Aparece justo donde estaba el botón que se pulsó. */}
        {outcomeMessage !== null ? (
          <p className="pf-set-hint" role="status">
            {outcomeMessage}
          </p>
        ) : null}

        {user === null ? (
          <>
            {/* Sin sesión no hay cuenta que gestionar; se dice y se ofrece el camino para tenerla.
                Si se acaba de cambiar la contraseña o de borrar la cuenta, el mensaje de arriba ya
                explica por qué no hay sesión, y repetir "estás navegando sin cuenta" sobraría. */}
            {outcomeMessage === null ? (
              <p className="pf-set-hint">{ui.auth.account.signedOutHint}</p>
            ) : null}
            <div className="pf-data-actions">
              <Link href="/login" className="pf-chip">
                {ui.auth.account.goToLogin}
              </Link>
            </div>
          </>
        ) : null}
      </section>

      {/* ----- Cambiar la contraseña (solo con sesión iniciada) ----- */}
      {user !== null ? (
        <section className="pf-set-block glass-2">
          <h2 className="pf-set-label font-hud">{ui.auth.account.changeLabel}</h2>
          <p className="pf-set-hint">{ui.auth.account.changeHint}</p>

          {openForm === "password" ? (
            <form className="au-form" onSubmit={handleChangePassword} noValidate>
              <label className="au-field">
                <span className="au-label font-mono">{ui.auth.account.currentPasswordLabel}</span>
                <input
                  ref={firstFieldRef}
                  className="au-input"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              <label className="au-field">
                <span className="au-label font-mono">{ui.auth.account.newPasswordLabel}</span>
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
                <span className="au-label font-mono">{ui.auth.account.confirmPasswordLabel}</span>
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

              <div className="pf-data-actions">
                <button type="submit" className="pf-chip" disabled={submitting}>
                  {submitting ? ui.auth.submitting : ui.auth.account.changeSubmit}
                </button>
                <button type="button" className="pf-chip" onClick={closeForms}>
                  {ui.auth.account.changeCancel}
                </button>
              </div>
            </form>
          ) : (
            <div className="pf-data-actions">
              <button
                type="button"
                className="pf-chip"
                onClick={() => openFormAndReset("password")}
              >
                {ui.auth.account.changeOpen}
              </button>
            </div>
          )}
        </section>
      ) : null}

      {/* ----- Borrar la cuenta (solo con sesión iniciada) ----- */}
      {user !== null ? (
        <section className="pf-set-block glass-2">
          <h2 className="pf-set-label font-hud">{ui.auth.account.deleteLabel}</h2>
          {/* Las consecuencias se leen ANTES de desplegar nada: qué desaparece del servidor y qué
              no, para que nadie descubra después que sus datos de este navegador seguían ahí. */}
          <p className="pf-set-hint">{ui.auth.account.deleteHint}</p>
          <p className="pf-set-hint">{ui.auth.account.deleteLocalNote}</p>

          {openForm === "delete" ? (
            // role="alert" en el contenedor: al desplegarse, un lector de pantalla anuncia de
            // inmediato que se está a punto de hacer algo irreversible.
            <div className="pf-danger-confirm" role="alert">
              <form className="au-form" onSubmit={handleDeleteAccount} noValidate>
                <label className="au-field">
                  <span className="au-label font-mono">{ui.auth.account.deletePasswordLabel}</span>
                  <input
                    ref={firstFieldRef}
                    className="au-input"
                    type="password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>

                <label className="au-field">
                  <span className="au-label font-mono">{ui.auth.account.deleteConfirmLabel}</span>
                  <input
                    className="au-input"
                    type="text"
                    value={confirmationWord}
                    onChange={(event) => setConfirmationWord(event.target.value)}
                    placeholder={ui.auth.account.deleteConfirmPlaceholder}
                    autoComplete="off"
                    required
                  />
                </label>

                {error !== null ? <p className="au-error font-mono">{error}</p> : null}

                <div className="pf-data-actions">
                  <button type="submit" className="pf-chip pf-chip-danger" disabled={submitting}>
                    {submitting ? ui.auth.submitting : ui.auth.account.deleteSubmit}
                  </button>
                  <button type="button" className="pf-chip" onClick={closeForms}>
                    {ui.auth.account.deleteCancel}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="pf-data-actions">
              <button
                type="button"
                className="pf-chip pf-chip-danger"
                onClick={() => openFormAndReset("delete")}
              >
                {ui.auth.account.deleteOpen}
              </button>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

// SettingsPanel: tema + idioma + gustos + plataformas + el bloque "Tus datos" (exportar/borrar).
function SettingsPanel({
  language,
  genres,
  platforms,
  selectedGenres,
  selectedPlatforms,
  theme,
  onLanguage,
  onToggleGenre,
  onTogglePlatform,
  onTheme,
  onExport,
  onClearData,
  watchlistReleases,
}: {
  language: string;
  genres: string[];
  platforms: string[];
  selectedGenres: string[];
  selectedPlatforms: string[];
  theme: Theme;
  onLanguage: (language: string) => void;
  onToggleGenre: (genre: string) => void;
  onTogglePlatform: (platform: string) => void;
  onTheme: (theme: Theme) => void;
  // onExport devuelve el perfil como JSON (el botón lo convierte en descarga).
  onExport: () => string;
  // onClearData borra TODOS los datos locales del perfil (tras confirmación de dos pasos).
  onClearData: () => void;
  // watchlistReleases son los estrenos de «Quiero ver» YA resueltos contra el catálogo (con su título
  // y su fecha), para poder exportarlos como archivo de calendario.
  watchlistReleases: ReleaseSummary[];
}) {
  // confirmingDelete activa el SEGUNDO paso del borrado (aviso + confirmar/cancelar). El borrado es
  // destructivo e irreversible: nunca se ejecuta con un solo clic.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Eventos de calendario derivados de «Quiero ver»: solo entran los títulos con fecha de estreno
  // utilizable (los que aún no la tienen no pueden ser un evento y se descartan, sin inventar nada).
  // El enlace de cada evento apunta a la ficha en este mismo sitio, tomando la dirección del propio
  // navegador. Se recalcula solo cuando cambia la watchlist.
  const calendarEvents = useMemo(
    () =>
      icsEventsFromReleases(
        watchlistReleases,
        typeof window === "undefined" ? "" : window.location.origin,
        ui.calendar.eventDescription,
      ),
    [watchlistReleases],
  );

  // handleExportCalendar descarga toda la watchlist como un solo archivo .ics (un evento por título).
  const handleExportCalendar = useCallback(() => {
    // La hora de generación entra como dato (el generador es puro y no lee el reloj por su cuenta).
    downloadIcsFile(buildIcsCalendar(calendarEvents, new Date()), ui.calendar.fileNameWatchlist);
  }, [calendarEvents]);

  // handleExport descarga el perfil como archivo JSON ("the-story-keeper-perfil.json") vía Blob.
  const handleExport = useCallback(() => {
    const blob = new Blob([onExport()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "the-story-keeper-perfil.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [onExport]);

  // handleConfirmDelete ejecuta el borrado real y cierra el modo de confirmación.
  const handleConfirmDelete = useCallback(() => {
    onClearData();
    setConfirmingDelete(false);
  }, [onClearData]);

  return (
    <div className="pf-settings">
      {/* Tema visual (claro/oscuro). Conmuta data-theme en <html>; persiste por perfil. */}
      <section className="pf-set-block glass-2">
        <h2 className="pf-set-label font-hud">{ui.profile.themeLabel}</h2>
        <p className="pf-set-hint">{ui.profile.themeHint}</p>
        <div className="pf-chips">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`pf-chip${theme === option.value ? " is-on" : ""}`}
              aria-pressed={theme === option.value}
              onClick={() => onTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {/* Idioma preferido (para tráiler/audio/subtítulos). */}
      <section className="pf-set-block glass-2">
        <h2 className="pf-set-label font-hud">{ui.profile.languageLabel}</h2>
        <p className="pf-set-hint">{ui.profile.languageHint}</p>
        <div className="pf-chips">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.value}
              type="button"
              className={`pf-chip${language === lang.value ? " is-on" : ""}`}
              aria-pressed={language === lang.value}
              onClick={() => onLanguage(lang.value)}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </section>

      {/* Plataformas que tengo (resaltarán la timeline). */}
      <section className="pf-set-block glass-2">
        <h2 className="pf-set-label font-hud">{ui.profile.platformsLabel}</h2>
        <p className="pf-set-hint">{ui.profile.platformsHint}</p>
        <div className="pf-chips">
          {platforms.map((platform) => (
            <button
              key={platform}
              type="button"
              className={`pf-chip${selectedPlatforms.includes(platform) ? " is-on" : ""}`}
              aria-pressed={selectedPlatforms.includes(platform)}
              onClick={() => onTogglePlatform(platform)}
            >
              {platform}
            </button>
          ))}
        </div>
      </section>

      {/* Mis gustos (géneros favoritos). */}
      <section className="pf-set-block glass-2">
        <h2 className="pf-set-label font-hud">{ui.profile.tastesLabel}</h2>
        <p className="pf-set-hint">{ui.profile.tastesHint}</p>
        <div className="pf-chips">
          {genres.map((genre) => (
            <button
              key={genre}
              type="button"
              className={`pf-chip${selectedGenres.includes(genre) ? " is-on" : ""}`}
              aria-pressed={selectedGenres.includes(genre)}
              onClick={() => onToggleGenre(genre)}
            >
              {genre}
            </button>
          ))}
        </div>
      </section>

      {/* Tu calendario: exporta «Quiero ver» como archivo .ics para el calendario que ya usas. Así
          los estrenos que sigues aparecen en tu agenda y te avisa tu propio teléfono, sin depender de
          abrir esta app. Si no hay ningún título con fecha, se dice claramente en vez de ofrecer una
          descarga vacía. */}
      <section className="pf-set-block glass-2">
        <h2 className="pf-set-label font-hud">{ui.calendar.exportWatchlistLabel}</h2>
        <p className="pf-set-hint">{ui.calendar.exportWatchlistHint}</p>
        {calendarEvents.length > 0 ? (
          <div className="pf-data-actions">
            <button type="button" className="pf-chip" onClick={handleExportCalendar}>
              {ui.calendar.exportWatchlistButton}
            </button>
          </div>
        ) : (
          <p className="pf-empty font-mono">{ui.calendar.exportWatchlistEmpty}</p>
        )}
      </section>

      {/* Tu cuenta: cambiar la contraseña y borrar la cuenta del SERVIDOR. Va justo antes de «Tus
          datos» (que solo toca este navegador) para que la diferencia entre ambos quede a la vista. */}
      <AccountPanel />

      {/* Tus datos: exportar respaldo (JSON) y borrar datos locales (confirmación de DOS pasos). */}
      <section className="pf-set-block glass-2">
        <h2 className="pf-set-label font-hud">{ui.profile.dataLabel}</h2>
        <p className="pf-set-hint">{ui.profile.dataHint}</p>
        <div className="pf-data-actions">
          <button type="button" className="pf-chip" onClick={handleExport}>
            {ui.profile.exportButton}
          </button>
          {!confirmingDelete ? (
            <button
              type="button"
              className="pf-chip pf-chip-danger"
              onClick={() => setConfirmingDelete(true)}
            >
              {ui.profile.deleteButton}
            </button>
          ) : null}
        </div>
        {/* Segundo paso del borrado: aviso claro + confirmar/cancelar. role="alert" lo anuncia. */}
        {confirmingDelete ? (
          <div className="pf-danger-confirm" role="alert">
            <p className="pf-danger-text">{ui.profile.deleteConfirmHint}</p>
            <div className="pf-data-actions">
              <button
                type="button"
                className="pf-chip pf-chip-danger"
                onClick={handleConfirmDelete}
              >
                {ui.profile.deleteConfirm}
              </button>
              <button type="button" className="pf-chip" onClick={() => setConfirmingDelete(false)}>
                {ui.profile.deleteCancel}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
