-- Migración 0001 — Esquema inicial de la base de datos de The Story Keeper.
--
-- En español: este archivo crea, desde cero, las cinco "libretas" donde el servidor apunta todo lo
-- que necesita recordar de las personas que usan la aplicación. Se ejecuta UNA sola vez: el propio
-- servidor lleva la cuenta de qué migraciones ya aplicó (tabla schema_migrations), así que arrancar
-- diez veces seguidas no vuelve a ejecutarla ni destruye nada.
--
-- Dos convenciones que se repiten en todas las tablas:
--   1) Los INSTANTES (fechas y horas) se guardan como NÚMERO: los segundos transcurridos desde el
--      1 de enero de 1970 en UTC. Se hace así porque comparar números ("¿esto ya caducó?") no tiene
--      ambigüedades, mientras que comparar textos de fecha depende del formato exacto y del huso.
--      La conversión a un texto legible se hace al salir hacia el frontend, no aquí.
--   2) Los TOKENS (sesión, restablecimiento, invitación) NUNCA se guardan tal cual: se guarda su
--      huella criptográfica. Si alguien robara una copia de esta base, no se llevaría ni una sola
--      credencial utilizable.
--
-- STRICT: le pide a SQLite que sea ESTRICTO con los tipos. Sin esta palabra, SQLite acepta meter
-- texto en una columna de números y luego los "¿esto ya caducó?" comparan mal en silencio.

-- users — las cuentas. Es la tabla raíz: todo lo demás cuelga de ella.
CREATE TABLE users (
    -- id es el identificador opaco y aleatorio de la cuenta (no revela nada del usuario).
    id TEXT PRIMARY KEY,
    -- email es el correo normalizado (minúsculas, sin espacios). UNIQUE impide dos cuentas iguales:
    -- la unicidad la garantiza la BASE DE DATOS, no el código, que es la única forma de que dos
    -- registros simultáneos con el mismo correo no puedan colarse los dos.
    email TEXT NOT NULL UNIQUE,
    -- display_name es el nombre visible elegido por la persona (puede repetirse entre cuentas).
    display_name TEXT NOT NULL,
    -- password_hash es la huella bcrypt de la contraseña. La contraseña en claro no existe en disco.
    password_hash TEXT NOT NULL,
    -- created_at es cuándo se creó la cuenta.
    created_at INTEGER NOT NULL,
    -- accepted_privacy_at es cuándo la persona aceptó el aviso de privacidad. NULL = todavía no
    -- consta su aceptación. Hoy queda NULL porque la pantalla de registro aún no pide ese
    -- consentimiento (es el entregable B7 de la fase); registrar una fecha inventada sería
    -- justamente lo contrario de lo que exige la ley, así que se deja vacío hasta que sea real.
    accepted_privacy_at INTEGER,
    -- deleted_at INHABILITA una cuenta sin borrarla. Tiene efecto REAL e inmediato: todas las
    -- búsquedas de usuario exigen que esté vacía, así que una cuenta marcada deja de poder entrar.
    -- Sirve para suspender a alguien durante la alpha (por ejemplo, una invitación usada de forma
    -- abusiva) conservando el rastro. Ojo: NO es lo que hace "borrar mi cuenta" — esa acción borra
    -- físicamente la fila, porque la ley de protección de datos exige una cancelación de verdad.
    deleted_at INTEGER
) STRICT;

-- sessions — las sesiones abiertas. Una fila por "inicio de sesión" vivo.
-- En español: aquí está la diferencia con el sistema anterior. Antes la sesión era un papel firmado
-- que el servidor no recordaba haber emitido, y por tanto no podía anular. Ahora cada sesión tiene
-- su fila: borrar la fila es cerrar la sesión de verdad, al instante, aunque alguien tenga copia
-- del token.
CREATE TABLE sessions (
    -- token_hash es la huella del token de sesión. Es la clave primaria porque la búsqueda siempre
    -- es "tengo este token, ¿de quién es?".
    token_hash TEXT PRIMARY KEY,
    -- user_id es la cuenta dueña de la sesión. ON DELETE CASCADE = si la cuenta se borra, sus
    -- sesiones desaparecen solas; es imposible que quede una sesión huérfana apuntando a nadie.
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- created_at es cuándo se abrió la sesión.
    created_at INTEGER NOT NULL,
    -- expires_at es cuándo deja de valer. Se va empujando hacia adelante mientras la persona use la
    -- aplicación (sesión "deslizante"), para no obligar a reentrar cada mes a quien entra a diario.
    expires_at INTEGER NOT NULL,
    -- last_seen_at es la última vez que se usó esta sesión. Sirve para decidir cuándo toca empujar
    -- la caducidad (no se escribe en cada petición: sería escribir en disco constantemente).
    last_seen_at INTEGER NOT NULL
) STRICT;

-- Índice por cuenta: lo usa "cerrar TODAS mis sesiones" (cambio de contraseña, restablecimiento).
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Índice por caducidad: lo usa la limpieza periódica de sesiones muertas.
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- invites — los códigos de invitación de la alpha cerrada (formato TSK-XXXX-XXXX).
CREATE TABLE invites (
    -- code_hash es la huella del código. El código en claro se enseña UNA vez, al generarlo, y
    -- nunca más: ni siquiera quien administra el servidor puede recuperarlo desde la base.
    code_hash TEXT PRIMARY KEY,
    -- note es una nota libre para acordarse de a quién se le dio ese código ("Ana, del trabajo").
    note TEXT NOT NULL,
    -- created_at es cuándo se generó.
    created_at INTEGER NOT NULL,
    -- expires_at es hasta cuándo sirve.
    expires_at INTEGER NOT NULL,
    -- used_by es la cuenta que lo canjeó. ON DELETE SET NULL: si esa cuenta se borra después, el
    -- código NO revive (used_at sigue puesto), simplemente se olvida quién lo usó.
    used_by TEXT REFERENCES users (id) ON DELETE SET NULL,
    -- used_at es cuándo se canjeó. NULL = todavía sin usar. Esta columna es la que hace que el
    -- código sea de UN SOLO USO.
    used_at INTEGER
) STRICT;

-- password_resets — los permisos temporales para poner una contraseña nueva sin saber la anterior.
CREATE TABLE password_resets (
    -- token_hash es la huella del token de restablecimiento.
    token_hash TEXT PRIMARY KEY,
    -- user_id es la cuenta a la que pertenece. Si la cuenta se borra, el permiso desaparece con ella.
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- created_at es cuándo se emitió.
    created_at INTEGER NOT NULL,
    -- expires_at es hasta cuándo sirve (vida corta a propósito: es una llave maestra temporal).
    expires_at INTEGER NOT NULL,
    -- used_at es cuándo se canjeó. NULL = sin usar. Hace que el permiso sea de UN SOLO USO.
    used_at INTEGER
) STRICT;

-- Índice por cuenta: lo usa la invalidación de permisos anteriores al emitir uno nuevo.
CREATE INDEX password_resets_user_id_idx ON password_resets (user_id);

-- profiles — el perfil de cada cuenta: su lista de "quiero ver", lo visto, reseñas, ajustes y
-- actividad. Se guarda como UN documento completo, no troceado en columnas, porque el frontend
-- ya lo maneja como una sola pieza y así el servidor no tiene que conocer su forma interna.
CREATE TABLE profiles (
    -- user_id es a la vez la clave primaria y la referencia a la cuenta: un perfil por cuenta.
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    -- doc es el documento del perfil en texto JSON.
    doc TEXT NOT NULL,
    -- revision es el número de versión del documento; sube de uno en uno con cada guardado. Es lo
    -- que permite detectar que dos dispositivos editaron a la vez y evitar que uno pise al otro.
    revision INTEGER NOT NULL,
    -- updated_at es cuándo se guardó por última vez.
    updated_at INTEGER NOT NULL
) STRICT;
