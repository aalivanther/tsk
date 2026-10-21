// Archivo: RatingReview.test.tsx — Pruebas de la barra de calificación (reseñar del 1 al 10).
//
// En español: esta es la pieza donde el usuario deja su opinión, así que un fallo aquí se traduce en
// datos perdidos o en una nota distinta de la que quiso poner. Se prueba como la usaría una persona:
// pulsando teclas y leyendo lo que la interfaz anuncia, no inspeccionando el estado interno.
//
// Lo que se protege:
//   - La REGLA DEL PRODUCTO: no se puede calificar un título sin haberlo marcado como visto. La barra
//     aparece bloqueada hasta entonces, y eso debe seguir siendo así.
//   - Que, una vez desbloqueada, se pueda calificar SOLO con el teclado (accesibilidad no negociable).
//   - Que el valor anunciado a los lectores de pantalla coincida con el visible y con su rango.
//   - Que la nota se guarde de verdad en el perfil y no se salga de los límites.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";

import { RatingReview } from "@/components/profile/RatingReview";
import { ProfileProvider, useProfile } from "@/lib/profile-context";
import { AuthProvider } from "@/lib/auth-context";

// ProfileProbe expone el estado del perfil y permite marcar el título como visto desde la prueba.
// En español: en vez de espiar el estado por dentro, se pinta en pantalla lo que interesa comprobar y
// se ofrece un botón para preparar el escenario. Así la prueba verifica el comportamiento observable.
function ProfileProbe({ releaseId }: { releaseId: string }) {
  const { profile, toggleWatched } = useProfile();
  return (
    <>
      <button type="button" onClick={() => toggleWatched(releaseId)}>
        marcar-vista
      </button>
      <span data-testid="nota">{String(profile.reviews[releaseId] ?? "sin-nota")}</span>
      <span data-testid="vista">{profile.watched.includes(releaseId) ? "si" : "no"}</span>
    </>
  );
}

// renderRating monta la barra con los contextos que necesita (sesión y perfil).
function renderRating(releaseId: string) {
  return render(
    <AuthProvider>
      <ProfileProvider>
        <RatingReview releaseId={releaseId} />
        <ProfileProbe releaseId={releaseId} />
      </ProfileProvider>
    </AuthProvider>,
  );
}

// unlockRating marca el título como visto, que es lo que habilita la barra de calificación.
async function unlockRating(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "marcar-vista" }));
  return screen.findByRole("slider");
}

describe("RatingReview", () => {
  beforeEach(() => {
    // Cada prueba parte de un perfil limpio: si no, la nota de la anterior se heredaría.
    window.localStorage.clear();
  });

  it("permanece BLOQUEADA hasta que el título se marca como visto", async () => {
    const user = userEvent.setup();
    renderRating("peli-0");

    // Antes de marcarlo como visto no hay barra que manipular: la regla del producto es que solo se
    // reseña lo que se ha visto, y la interfaz debe reflejarlo en vez de aceptar una nota huérfana.
    expect(screen.queryByRole("slider")).toBeNull();

    // Tras marcarlo como visto, la barra aparece.
    await unlockRating(user);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("se puede calificar SOLO con el teclado", async () => {
    const user = userEvent.setup();
    renderRating("peli-1");
    const slider = await unlockRating(user);

    slider.focus();
    const initial = Number(slider.getAttribute("aria-valuenow"));
    await user.keyboard("{ArrowRight}");
    const afterRight = Number(slider.getAttribute("aria-valuenow"));

    expect(afterRight).toBeGreaterThan(initial);

    // Y la flecha contraria debe poder deshacerlo: la navegación por teclado es bidireccional.
    await user.keyboard("{ArrowLeft}");
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(initial);
  });

  it("anuncia el valor a los lectores de pantalla en el formato correcto", async () => {
    const user = userEvent.setup();
    renderRating("peli-2");
    const slider = await unlockRating(user);

    // aria-valuetext debe leerse como "X de 10", no como un número suelto sin contexto.
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^\d+(\.\d)? de 10$/);
    // Y los límites deben estar declarados para que la persona sepa el rango en el que se mueve.
    expect(slider).toHaveAttribute("aria-valuemin");
    expect(slider).toHaveAttribute("aria-valuemax", "10");
  });

  it("guarda la nota en el perfil", async () => {
    const user = userEvent.setup();
    renderRating("peli-3");
    const slider = await unlockRating(user);

    slider.focus();
    await user.keyboard("{ArrowRight}");

    // La nota quedó registrada de verdad en el perfil, no solo en pantalla.
    expect(screen.getByTestId("nota").textContent).not.toBe("sin-nota");
    expect(screen.getByTestId("vista").textContent).toBe("si");
  });

  it("no se sale del rango 1–10 aunque se pulse muchas veces", async () => {
    const user = userEvent.setup();
    renderRating("peli-4");
    const slider = await unlockRating(user);

    slider.focus();
    // Muchas pulsaciones seguidas hacia arriba: debe topar en 10, nunca pasarse.
    await user.keyboard("{ArrowRight>120/}");
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(10);

    // Y hacia abajo debe topar en el mínimo declarado, nunca en cero ni en negativo.
    const minimum = Number(slider.getAttribute("aria-valuemin"));
    await user.keyboard("{ArrowLeft>200/}");
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(minimum);
  });
});
