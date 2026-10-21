# Makefile del monorepo (en español).
# Qué es: un "panel de botones" para el proyecto. En vez de recordar comandos largos, se escribe
# "make <objetivo>" (por ejemplo "make gen") y se ejecutan los pasos de adentro.
# Cómo leerlo: cada bloque que empieza con una palabra y dos puntos (ej. "gen:") es un objetivo;
# las líneas de abajo (con sangría de TAB real) son los comandos que corre.
#
# IMPORTANTE — TODO corre dentro de Docker: las herramientas de desarrollo y generación de código
# (buf, gofumpt, golangci-lint, Node, pnpm) viven en el contenedor "tools" (ver tools/Dockerfile),
# NO en tu máquina. Así el host queda limpio y el toolchain es 100% reproducible y pinneado.

# .PHONY declara que estos nombres son ACCIONES, no archivos, para que make siempre los ejecute.
.PHONY: tools-build install gen lint test verify up down fmt seed schedule seed-install \
        admin-invite admin-reset admin-list-users proto-baseline

# VERSION es la versión del proyecto, LEÍDA del archivo VERSION de la raíz.
#
# En español: se exporta para que docker compose la reciba y la grabe dentro del binario al compilar.
# Antes ese número vivía escrito a mano dentro del Dockerfile, con un aviso que pedía moverlo a la vez
# que el archivo. No se movió, y durante varias versiones toda imagen construida decía una versión que
# no era la suya. Leyéndolo de aquí, el número solo existe en un sitio y no puede desincronizarse.
VERSION := $(shell cat VERSION)
export VERSION

# TOOLS es el prefijo para correr cualquier comando DENTRO del taller dockerizado.
# --rm borra el contenedor al terminar (no deja basura). El repo se monta en /work (ver compose).
# Usamos "bash -c" (NO "bash -lc"): una shell de login resetea el PATH y perdería el toolchain de
# Go (/usr/local/go/bin); con "bash -c" se hereda el PATH del contenedor, que ya trae todo.
TOOLS := docker compose run --rm tools bash -c

# tools-build: construye (o reconstruye) la imagen del taller con el toolchain pinneado.
# En español: hazlo una vez al inicio (o cuando cambie tools/Dockerfile) antes de gen/lint/test.
tools-build:
	docker compose build tools

# install: instala las dependencias del frontend DENTRO del taller, en su volumen Linux propio.
# En español: respeta el lockfile (instalación reproducible); deja listo node_modules del contenedor.
install:
	$(TOOLS) 'cd web && pnpm install --frozen-lockfile'

# gen: genera el código desde los contratos .proto y deja ordenado el módulo Go.
# En español: convierte el "contrato" Protobuf en código Go y TypeScript de verdad, y luego pone
# al día las dependencias del backend (go mod tidy crea/actualiza go.sum). Todo dentro del taller.
gen:
	$(TOOLS) 'buf generate && cd backend && go mod tidy'

# lint: revisa que el código esté limpio y sin errores de estilo en backend y frontend.
# En español: "gofumpt -l" lista archivos Go mal formateados; "golangci-lint" caza problemas de
# calidad en Go; en el frontend "pnpm run lint" revisa TypeScript/React y "tsc --noEmit" comprueba
# que los tipos cuadren. Antes instala las dependencias del web (idempotente) en el volumen propio.
# NOTA sobre "prettier --check": el formateo del frontend NO estaba en esta puerta, solo el linter y
# los tipos. El resultado previsible fue que se acumularan veintitantos archivos con el formato
# torcido sin que nadie se enterara, porque nada lo miraba. Un formato inconsistente no rompe la
# aplicación, pero convierte cada revisión de cambios en una lectura de ruido: aparecen líneas movidas
# que nadie tocó y los cambios de verdad se esconden entre ellas. Ahora rompe la puerta, y "make fmt"
# lo arregla solo.
#
# LOS DOS CONTROLES DEL CONTRATO, que hasta ahora no estaban en ninguna puerta pese a que las reglas
# del proyecto (§11) los exigen y buf.yaml los tenía configurados:
#
#   - "buf lint" revisa que los .proto estén bien escritos. Estaba configurado y nadie lo ejecutaba:
#     había diez avisos acumulados. Ahora está limpio (las excepciones que se decidieron NO arreglar
#     están apuntadas una por una, con su motivo, en buf.yaml).
#   - "buf breaking" es el importante: avisa cuando un cambio del contrato ROMPERÍA a quien ya lo
#     usa. Nunca se había ejecutado, y el lote anterior hizo cuatro cambios rompientes sin que nada
#     los mirara. Compara contra la copia congelada de "proto-baseline" (ver el objetivo de abajo),
#     porque el proyecto no usa control de versiones y esa carpeta hace de "cómo estaba antes".
#
# Van los PRIMEROS a propósito: son los más rápidos y los que fallan por el motivo más caro de
# descubrir tarde (un contrato roto se lleva por delante al servidor y a la web a la vez).
lint:
	$(TOOLS) 'buf lint && buf breaking --against proto-baseline && gofumpt -l backend && (cd backend && golangci-lint run) && (cd web && pnpm install --frozen-lockfile && pnpm run lint && pnpm exec tsc --noEmit && pnpm exec prettier --check .)'

# proto-baseline: acepta el contrato ACTUAL como la nueva referencia de "buf breaking".
#
# Cuándo usarlo, en español: solo después de un cambio del contrato que rompa a propósito —retirar un
# campo y reservar su número, por ejemplo— y que ya se haya revisado y decidido. Correrlo hace que
# "make lint" deje de quejarse de ESE cambio y empiece a vigilar a partir de ahí.
#
# Cuándo NO usarlo: para "callar" un aviso que no se entiende. El aviso de "buf breaking" no dice que
# el cambio esté mal, dice que alguien que use la versión anterior dejará de funcionar; la pregunta
# que hay que contestar antes de tocar esto es si ese alguien existe y qué se hace con él.
proto-baseline:
	$(TOOLS) 'rm -rf proto-baseline && cp -R proto proto-baseline && buf breaking --against proto-baseline && echo "proto-baseline updated"'

# test: ejecuta TODAS las pruebas automáticas del proyecto dentro del taller: las del backend (Go) y
# las del frontend (Vitest, sobre la lógica pura de fechas, avisos, rareza y saneo de URLs).
# En español: antes este objetivo solo cubría el backend, así que las pruebas del frontend quedaban
# fuera de la "prueba de fuego" (make verify) y podían romperse sin que nadie se enterara.
#
# QUÉ ES "-race" y por qué es obligatorio aquí: es el DETECTOR DE CARRERAS de Go. El backend hace
# varias cosas a la vez (atiende peticiones en paralelo, releva el catálogo en caliente con un
# puntero atómico, lleva un contador de cuotas compartido entre todos los clientes y unas métricas
# que escriben todas las peticiones). Cuando dos de esas tareas tocan el mismo dato a la vez sin
# coordinarse, el programa no falla: devuelve un resultado incorrecto de vez en cuando, en producción
# y bajo carga, y es de los errores más difíciles de reproducir que existen. Con "-race", Go vigila
# cada acceso a memoria durante las pruebas y ROMPE la prueba señalando las dos líneas culpables. Las
# pruebas tardan unas tres veces más; a cambio, esa clase entera de errores no llega a producción.
test:
	$(TOOLS) 'cd backend && go test -race ./... && cd ../web && pnpm install --frozen-lockfile && pnpm run test'

# SEED_WINDOW_MONTHS es cuántos meses cubre el catálogo, y tiene que ser EL MISMO número de meses que
# pide la aplicación (CATALOG_WINDOW_BEFORE + 1 + CATALOG_WINDOW_AFTER en web/src/lib/timeline.ts).
#
# Por qué se anota aquí en grande: que estos dos números no coincidieran fue un fallo real y difícil de
# ver. El generador creaba seis meses y la aplicación solo pedía cuatro: los dos últimos existían en el
# servidor y NO había forma de llegar a ellos desde la interfaz. El calendario se acababa antes de
# tiempo, sin ningún aviso y sin que nada fallara. Hay una prueba que fija la relación
# (web/src/lib/timeline.test.ts), pero el número vive en dos sitios y conviene saberlo.
SEED_WINDOW_MONTHS := 6

# seed: genera el seed REAL de MÉXICO desde TMDB con la herramienta seedgen.
#
# LA VENTANA SE DERIVA DE HOY, no está escrita a mano. Empieza un mes ANTES del actual (para no perder
# de vista lo recién estrenado, que es lo que pinta la línea de tiempo a la izquierda) y cubre
# SEED_WINDOW_MONTHS meses en total, cruzando de año cuando toca.
#
# Antes los meses iban escritos a mano y pasó lo previsible: al avanzar el calendario, el catálogo se
# quedó corto por delante y sobrando por detrás. Quien abrió la aplicación un 29 de julio con un
# catálogo que empezaba en agosto vio un mes entero sin un solo estreno y concluyó, con toda la razón,
# que estaba desactualizada.
# En español: requiere tu TMDB_READ_TOKEN en el archivo .env de la raíz (el servicio "tools" lo carga
# automáticamente). Sin token, seedgen se detiene con un mensaje claro. Escribe en una ruta SCRATCH
# (backend/seed/seed.generated.json) que NO pisa el seed curado de producción; luego se revisa y se
# promueve a producción. Cubre PELÍCULAS (cine + digital) y SERIES (watch_region=MX), con su categoría
# real (CINE/STREAMING/CADENAS/INDIE), pósters, tráilers, ratings, reparto, saga, galería y "dónde verlo".
seed:
	$(TOOLS) 'cd backend && go run ./cmd/seedgen -out seed/seed.generated.json -window $(SEED_WINDOW_MONTHS) -window-before 1 -region MX'

# schedule: completa el seed CURADO con el calendario de emisión (fechas reales de episodios) de cada
# serie, consultando TMDB con la herramienta schedulegen. En español: requiere TMDB_READ_TOKEN en el
# .env de la raíz. Reescribe backend/seed/seed.json EN SITIO añadiendo el campo "schedule" a las
# series (las películas no se tocan). Es idempotente: correrlo de nuevo refresca los calendarios.
#
# La fecha de inicio TAMPOCO va escrita a mano: se calcula como el día 1 del mes ANTERIOR al actual,
# que es justo donde empieza la ventana del catálogo (ver SEED_WINDOW_MONTHS). Escrita a mano se
# quedaba atrás con cada mes que pasaba, y entonces el calendario de episodios cubría un periodo
# distinto al del catálogo: dos ventanas desalineadas que nadie nota hasta que faltan episodios.
schedule:
	$(TOOLS) 'cd backend && go run ./cmd/schedulegen -seed seed/seed.json -from "$$(date -u -d "$$(date -u +%Y-%m-01) -1 month" +%Y-%m-%d)" -region MX'

# --- Administración de la alpha cerrada (herramienta cmd/admintool) ---------------------------
# En español: estos tres objetivos son las únicas operaciones que hace a mano el dueño del servicio
# (repartir invitaciones, rescatar a quien olvidó su contraseña y ver quién hay dentro). Corren
# DENTRO del taller, igual que el resto de herramientas.
#
# SOBRE QUÉ BASE DE DATOS TRABAJAN: por defecto, sobre /data/tsk.db, que es EL MISMO archivo que usa
# el backend corriendo en Docker (el volumen de datos está montado también en el taller, ver
# compose.yaml). Eso es lo que hace que un código generado aquí lo reconozca el servidor de allá.
# Si se quiere administrar otra instalación, se pasa la ruta: make admin-list-users DB_PATH=otra.db
# El servidor debe haber arrancado al menos una vez (es quien crea el archivo).
#
# REQUISITO: SESSION_SIGNING_KEY en el archivo .env de la raíz, y tiene que ser EXACTAMENTE la misma
# que la del servidor: es la clave con la que se calculan las huellas de los tokens, así que con una
# clave distinta los códigos generados aquí no los reconocería nadie.

# ADMIN_DB es la ruta de base de datos que reciben los tres objetivos de administración.
ADMIN_DB := $(or $(DB_PATH),/data/tsk.db)

# admin-invite: genera un código de invitación e imprime el código EN CLARO una única vez.
# En español: úsalo así -> make admin-invite NOTE="Ana del trabajo" DAYS=30
# El código solo se puede leer en ese momento; después, en la base solo queda su huella.
admin-invite:
	$(TOOLS) 'cd backend && DB_PATH=$(ADMIN_DB) go run ./cmd/admintool invite -note "$(NOTE)" -days $(or $(DAYS),30)'

# admin-reset: emite un permiso de restablecimiento de contraseña para un correo concreto.
# En español: úsalo así -> make admin-reset EMAIL=persona@ejemplo.com
# Imprime un token de un solo uso y vida corta que hay que entregar a su dueño por un canal privado.
admin-reset:
	$(TOOLS) 'cd backend && DB_PATH=$(ADMIN_DB) go run ./cmd/admintool reset -email "$(EMAIL)" -hours $(or $(HOURS),1)'

# admin-list-users: enseña quién tiene cuenta, cuándo se dio de alta y cuántas sesiones tiene abiertas.
admin-list-users:
	$(TOOLS) 'cd backend && DB_PATH=$(ADMIN_DB) go run ./cmd/admintool list-users'

# WRITABLE_SEED es dónde vive el catálogo ACTUALIZABLE que lee el servidor. Por defecto es la ruta
# dentro del volumen de datos, que es EL MISMO archivo que ve el backend corriendo en Docker.
WRITABLE_SEED := $(or $(WRITABLE_SEED_PATH),/data/seed.json)

# seed-install: pone en servicio un catálogo nuevo SIN reconstruir la imagen ni reiniciar el servidor.
# En español: úsalo así -> make seed-install CANDIDATE=backend/seed/seed.json
# Primero VALIDA el archivo con las mismas reglas que aplica el servidor al arrancar; si algo no
# cuadra se detiene y no toca nada, así que el catálogo que está sirviendo nunca corre peligro. Si es
# correcto, lo copia a su sitio de forma atómica y el servidor lo recoge solo en su próxima revisión
# (como mucho UN MINUTO después; ver CATALOG_REFRESH_INTERVAL). Ese minuto importa: con la revisión
# cada hora que había antes, la herramienta decía "instalado" y el servidor seguía sirviendo el
# catálogo viejo durante un rato indeterminado, así que la reacción natural era pensar que no había
# funcionado y volver a intentarlo. No hace falta avisar a nadie ni parar nada. Comprobación de que
# surtió efecto: `curl -s http://127.0.0.1:8090/readyz`.
#
# Sobre el "../" del comando: la herramienta se ejecuta desde dentro de backend/ (es donde vive el
# módulo de Go), pero CANDIDATE se escribe relativo a la RAÍZ del repositorio, que es como se nombran
# los archivos en el resto de la documentación. El "../" hace la traducción entre ambos.
seed-install:
	$(TOOLS) 'cd backend && WRITABLE_SEED_PATH=$(WRITABLE_SEED) go run ./cmd/admintool install-seed -candidate "../$(CANDIDATE)"'

# verify: la "prueba de fuego" del sprint (Definition of Done ejecutable): generar + lint + test.
# En español: si los tres pasan, el código está sano. No incluye levantar la app (eso es "up").
verify: gen lint test

# fmt: formatea automáticamente el código (arregla el estilo en vez de solo avisar).
# En español: usamos "golangci-lint fmt" (NO "gofumpt -w" suelto) para que el formateo de Go aplique
# EXACTAMENTE la misma configuración que el lint (gofumpt con module-path y extra-rules); así nunca
# discrepan. "pnpm run format" hace lo mismo en el frontend con Prettier. Todo dentro del taller.
fmt:
	$(TOOLS) '(cd backend && golangci-lint fmt) && (cd web && pnpm install --frozen-lockfile && pnpm run format)'

# up: levanta la aplicación (backend + frontend) reconstruyendo imágenes. NO incluye el taller
# (tiene "profile: tools", así que solo se levanta bajo demanda con "docker compose run").
up:
	docker compose up --build

# down: detiene y elimina los contenedores de la aplicación.
down:
	docker compose down
