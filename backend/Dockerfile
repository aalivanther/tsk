# Dockerfile del backend Go (servicio "api") — construcción multi-etapa.
# En español: este archivo describe cómo empaquetar el backend en una imagen de Docker.
# Usa dos etapas: primero una etapa "builder" con todas las herramientas de Go que
# compila el binario; luego una etapa final mínima ("runtime") que SOLO contiene el
# binario ya compilado. Así la imagen final es diminuta, segura y sin compiladores.

# ---------------------------------------------------------------------------
# Etapa 1: builder — compila el binario del servidor.
# ---------------------------------------------------------------------------
# Fijamos la versión exacta del toolchain de Go (1.26.3) para builds reproducibles.
FROM golang:1.26.3 AS builder

# VERSION es la etiqueta de versión del proyecto que se "graba" dentro del binario.
#
# AQUÍ NO HAY NINGÚN NÚMERO, y es a propósito. Antes había uno escrito a mano con un aviso encima que
# decía "ojo, esto es un espejo del archivo VERSION y hay que moverlo a la vez". Se quedó atrás igual:
# el proyecto iba por 0.1.73 y toda imagen construida seguía diciendo 0.1.63, porque este valor se
# inyecta al compilar y PISA el que trae el código. No fallaba nada — simplemente la aplicación mentía
# sobre qué versión estaba corriendo, que es justo el dato al que se recurre cuando algo va mal.
#
# Ahora el número llega desde fuera: el compose lo toma de la variable VERSION y el Makefile la rellena
# leyendo el archivo VERSION de la raíz, que es la única fuente de verdad. Si nadie la pasa, queda
# "dev" — una etiqueta honesta, que no engaña a nadie, en lugar de un número desactualizado que sí.
ARG VERSION=dev

# Carpeta de trabajo dentro de la imagen donde vivirá el código a compilar.
WORKDIR /src

# Primero copiamos solo go.mod (y go.sum si existe) y descargamos dependencias.
# En español: copiar estos archivos antes que el resto del código permite que Docker
# reutilice la capa de dependencias mientras no cambien, acelerando builds repetidos.
COPY go.mod go.sum* ./
RUN go mod download

# Ahora copiamos el resto del código fuente del backend.
COPY . .

# Compilamos el binario estático del servidor.
# En español: CGO_ENABLED=0 produce un binario sin dependencias del sistema (totalmente
# estático), apto para la imagen distroless. -ldflags "-s -w" quita información de
# depuración para reducir el tamaño, y -X inyecta la versión dentro del binario.
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w -X mdm7mo/internal/config.buildVersion=${VERSION}" \
    -o /out/api ./cmd/api

# Creamos un directorio /out/data VACÍO en el builder. Se copiará a /data en la imagen final con dueño
# nonroot. En español: aquí vivirán las CUENTAS (users.json), el primer dato ESCRIBIBLE del backend.
RUN mkdir -p /out/data

# ---------------------------------------------------------------------------
# Etapa 2: runtime — imagen final mínima que solo ejecuta el binario.
# ---------------------------------------------------------------------------
# distroless/static:nonroot no trae shell ni gestor de paquetes y corre como usuario
# sin privilegios. En español: es una imagen "pelada" que reduce la superficie de ataque;
# solo sabe ejecutar nuestro binario estático y nada más.
FROM gcr.io/distroless/static:nonroot AS runtime

# Copiamos únicamente el binario ya compilado desde la etapa builder.
COPY --from=builder /out/api /api

# Copiamos SOLO el catálogo semilla de producción (seed.json) que el binario lee al arrancar.
# En español: en Fase 0 el backend no usa base de datos; lee el catálogo desde un archivo en disco.
# Copiamos únicamente seed.json (NO la carpeta completa): los demás archivos de seed/ son backups y
# borradores de trabajo (seed.generated.json, seed.backup-*.json, curated.json) que no pintan nada en
# la imagen final. Ruta estable y absoluta en /seed.
COPY --from=builder /src/seed/seed.json /seed/seed.json

# Indicamos al binario dónde encontrar el seed dentro de la imagen.
# En español: SEED_PATH apunta a la ruta absoluta del catálogo copiado arriba, de modo que el
# proceso no dependa del directorio de trabajo para encontrarlo.
ENV SEED_PATH=/seed/seed.json

# Directorio ESCRIBIBLE para los datos de las personas usuarias. Copiamos el dir vacío del builder
# con dueño nonroot (uid 65532). Al montar un volumen con nombre en /data, Docker hereda estos
# permisos, así el proceso nonroot puede escribir.
COPY --from=builder --chown=65532:65532 /out/data /data

# DB_PATH es la BASE DE DATOS donde viven cuentas, sesiones, invitaciones, restablecimientos y
# perfiles. En español: es el archivo que hay que respaldar; todo lo que la gente crea en la
# aplicación está ahí. Vive en el mismo volumen escribible de siempre, así que no hace falta
# ningún montaje nuevo.
ENV DB_PATH=/data/tsk.db
ENV LOCAL_SETTINGS_PATH=/data/local-settings.json

# AUTH_DATA_PATH es el ANTIGUO archivo de cuentas. Ya no se escribe en él: al arrancar se lee una
# única vez para IMPORTAR a la base de datos las cuentas creadas por la versión anterior, y después
# se renombra a users.json.migrated (que queda ahí como copia de seguridad). En una instalación
# nueva el archivo no existe y no ocurre nada.
ENV AUTH_DATA_PATH=/data/users.json

# Documentamos el puerto en el que el servidor escucha (debe coincidir con PORT).
EXPOSE 8080

# El usuario "nonroot" viene predefinido en la imagen distroless:nonroot.
# En español: ejecutar como usuario sin privilegios es una buena práctica de seguridad;
# si el proceso se viera comprometido, tendría permisos muy limitados.
USER nonroot:nonroot

# Comando que se ejecuta al arrancar el contenedor: lanzar el servidor.
ENTRYPOINT ["/api"]
