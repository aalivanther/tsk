-- Migración 0002 — Tope ABSOLUTO de vida para las sesiones.
--
-- El problema que arregla: las sesiones eran "deslizantes". Cada vez que alguien usaba la
-- aplicación, su caducidad se empujaba treinta días más adelante. Para quien entra a diario eso
-- significaba que la caducidad NUNCA llegaba: una sesión abierta el primer día seguiría abierta
-- años después, empujada un poquito cada mañana. Y una sesión que no caduca jamás es exactamente
-- lo que quiere quien copia un token: un token robado a alguien que usa la aplicación a diario
-- valdría para siempre, sin que ni esa persona ni el servidor tuvieran motivo para notarlo.
--
-- La regla nueva: además de la caducidad que se empuja con el uso, cada sesión nace con una fecha
-- de muerte FIJA que no se mueve nunca. Pasada esa fecha, la sesión deja de valer aunque se haya
-- usado esa misma mañana, y hay que volver a escribir la contraseña una vez.
--
-- Por qué una columna nueva y no calcularlo con created_at: guardar la fecha límite de forma
-- explícita hace que cada sesión lleve encima la regla con la que nació. Si mañana se decidiera
-- acortar o alargar el tope, las sesiones ya abiertas conservarían el plazo que se les prometió en
-- vez de morir todas de golpe por un cambio de constante — y la fecha queda a la vista de quien
-- consulte la base, sin tener que reproducir ninguna cuenta mental.

-- Se añade la columna con DEFAULT 0 porque SQLite exige un valor por defecto para poder añadir una
-- columna NOT NULL a una tabla que ya tiene filas. El 0 (1 de enero de 1970) es un valor imposible
-- que significa "todavía sin rellenar", y la sentencia siguiente lo sustituye de inmediato.
ALTER TABLE sessions ADD COLUMN absolute_expires_at INTEGER NOT NULL DEFAULT 0;

-- Se rellena la columna en las sesiones que ya existían: su fecha límite se cuenta desde el día en
-- que se abrieron, igual que si la regla hubiera estado vigente desde el principio. 7776000 segundos
-- son 90 días (90 x 24 x 60 x 60), que es el valor de SessionAbsoluteTTL en internal/store/sessions.go.
-- Consecuencia buscada: una sesión abierta hace más de 90 días muere en cuanto se aplique esta
-- migración. Es justo lo que se pretende — son precisamente las sesiones eternas del problema.
UPDATE sessions SET absolute_expires_at = created_at + 7776000;

-- Índice por la fecha límite: lo usa la limpieza periódica, que ahora barre también las sesiones que
-- llegaron a su tope aunque su caducidad deslizante estuviera todavía lejos.
CREATE INDEX sessions_absolute_expires_at_idx ON sessions (absolute_expires_at);
