// Archivo: credit-labels.ts — Cómo se escriben en español los oficios y las áreas de un equipo.
//
// POR QUÉ ESTO VIVE EN UN SITIO SOLO, en español: el catálogo entrega en INGLÉS tanto el área de
// trabajo de cada persona ("Directing", "Camera") como su puesto concreto ("Director of Photography",
// "Screenplay"). Ese texto se enseña en DOS pantallas distintas —la ficha de una persona y la ficha
// de un título—, y hasta ahora cada una decidía por su cuenta qué traducir: la de la persona traducía
// el área y dejaba el puesto en inglés, así que la misma pantalla decía "Qué hace: Dirección · Guion"
// y tres líneas más abajo listaba "Screenplay" y "Cinematography". La misma información, en dos
// idiomas, a dos centímetros. Con una sola función, eso deja de poder ocurrir.
//
// LA REGLA, que es la misma para los dos casos: si el término está en la tabla, se traduce; si no
// está, SE ENSEÑA TAL CUAL. Nunca se inventa una traducción. Un puesto raro escrito en inglés lo
// reconoce quien trabaja en cine; una traducción aproximada no la reconoce nadie y además afirma algo
// que quizá no sea cierto.

import { ui } from "@/lib/i18n";

// departmentLabel traduce el ÁREA de trabajo ("Directing" → "Dirección").
//
// En español: son las once áreas en las que el proveedor de datos reparte a todo el equipo. Es una
// lista cerrada y estable, así que se traduce entera.
export function departmentLabel(department: string): string {
  return ui.person.departmentLabels[department.trim()] ?? department;
}

// jobLabel traduce el PUESTO concreto ("Director of Photography" → "Dirección de fotografía").
//
// CUIDADO CON DÓNDE SE USA, porque es la única trampa de esta función: el mismo campo del catálogo
// guarda dos cosas distintas según de quién se hable. En el EQUIPO guarda el puesto ("Editor"); en el
// REPARTO guarda el nombre del PERSONAJE que interpreta ("Margarita", "Elle Woods"). Un nombre de
// personaje no se traduce jamás. Por eso esta función se aplica solo donde se sabe que lo que hay es
// un puesto, y quien la llama lo declara explícitamente en vez de dejarlo a la suerte.
export function jobLabel(job: string): string {
  return ui.credits.jobLabels[job.trim()] ?? job;
}
