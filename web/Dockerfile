# Dockerfile multi-stage de la app web "MDM 7mo" (frontend Next.js).
#
# En español: construir la imagen en varias etapas (multi-stage) nos permite
# usar herramientas pesadas para instalar y compilar, pero quedarnos al final
# solo con lo mínimo para correr. Resultado: una imagen final pequeña, rápida
# de arrancar y más segura (sin compiladores ni dependencias de desarrollo).
#
# Las tres etapas son:
#   1) deps    -> instala las dependencias de forma reproducible.
#   2) builder -> compila el frontend en modo producción (salida "standalone").
#   3) runner  -> imagen final que solo contiene lo necesario para servir.

# Fijamos la imagen base de Node en una sola variable para no repetirla y para
# que todas las etapas usen exactamente la misma versión verificada.
ARG NODE_IMAGE=node:24.16.0-slim

# ----------------------------------------------------------------------------
# Etapa 1: deps — instalar dependencias
# En español: aquí solo traemos node_modules. Lo aislamos en su propia etapa
# para que Docker pueda reutilizar (cachear) este paso mientras no cambien
# package.json ni el lockfile, acelerando reconstrucciones futuras.
# ----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# corepack es el gestor que viene con Node y nos permite usar la versión exacta
# de pnpm declarada en el campo "packageManager" de package.json.
# En español: con esto garantizamos que se use pnpm 11.5.0 y no otra versión.
RUN corepack enable

# Copiamos primero solo los archivos que definen las dependencias. Así, si el
# código cambia pero las dependencias no, Docker reutiliza la instalación.
# Incluimos pnpm-workspace.yaml porque pnpm 11 guarda ahí ajustes (como allowBuilds,
# la lista blanca de scripts nativos permitidos); sin él, el install fallaría o
# bloquearía la compilación de sharp/unrs-resolver dentro de la imagen.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# --frozen-lockfile obliga a respetar el lockfile tal cual: si algo no coincide,
# falla en vez de "arreglarlo" silenciosamente. Esto hace el build reproducible.
RUN pnpm install --frozen-lockfile

# ----------------------------------------------------------------------------
# Etapa 2: builder — compilar el frontend
# En español: con las dependencias ya listas, copiamos el código y generamos
# la versión optimizada de producción. La salida "standalone" (configurada en
# next.config.ts) crea un servidor autocontenido en .next/standalone.
# ----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN corepack enable

# Reutilizamos las dependencias ya instaladas en la etapa "deps".
COPY --from=deps /app/node_modules ./node_modules

# Copiamos el resto del proyecto (código, configs, estáticos).
COPY . .

# NODE_ENV=production activa las optimizaciones de Next.js (build más liviano y
# rápido, sin herramientas de desarrollo).
ENV NODE_ENV=production

# NOTA: aquí ya no se incrusta ninguna dirección de backend.
# En español: antes había que decirle a la compilación en qué dirección estaría el API, porque el
# navegador lo llamaba directamente. Eso ataba cada imagen a un despliegue concreto: cambiar de
# dominio o de puerto obligaba a RECOMPILAR. Desde que el navegador llama a "/rpc" —su propia
# dirección— y el servidor web reenvía, la misma imagen vale en cualquier sitio y la dirección del
# backend se lee al arrancar el contenedor.

# Compilamos. El resultado clave queda en .next/standalone y .next/static.
RUN pnpm build

# ----------------------------------------------------------------------------
# Etapa 3: runner — imagen final que sirve la app
# En español: esta es la imagen que realmente se ejecuta en producción. Solo
# contiene Node, el servidor autocontenido y los archivos estáticos. Sin código
# fuente extra, sin dependencias de desarrollo y corriendo como usuario sin
# privilegios para mayor seguridad.
# ----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# Producción también en la etapa final.
ENV NODE_ENV=production
# El servidor de Next.js escucha en el puerto 3000.
ENV PORT=3000

# HOSTNAME=0.0.0.0 hace que el servidor escuche en TODAS las interfaces del contenedor.
# En español: el servidor "standalone" de Next usa la variable HOSTNAME como dirección de escucha y,
# dentro de Docker, esa variable vale por defecto el ID del contenedor. El resultado es que el
# servidor solo respondía en la IP interna del contenedor: desde fuera funcionaba (Docker reenvía el
# puerto), pero cualquier comprobación DESDE DENTRO —como el healthcheck— fallaba, y el contenedor
# aparecía eternamente como "unhealthy" aunque estuviera sirviendo correctamente.
ENV HOSTNAME=0.0.0.0
ENV LOCAL_SETTINGS_PATH=/data/local-settings.json

# "node" es un usuario sin privilegios que ya viene en la imagen oficial.
# En español: ejecutar como usuario normal (no root) reduce el riesgo si algo
# saliera mal dentro del contenedor.
USER node

# Copiamos solo los tres ingredientes que el modo standalone necesita:
#   1) .next/standalone -> el servidor Node autocontenido (incluye server.js).
#   2) .next/static     -> los assets compilados (JS/CSS) que el servidor sirve.
#   3) public           -> los archivos estáticos públicos (imágenes, etc.).
# Asignamos la propiedad al usuario node con --chown para que pueda leerlos.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Documentamos que el contenedor escucha en el 3000 (no abre el puerto por sí
# solo; el mapeo real se hace en compose.yaml).
EXPOSE 3000

# Arrancamos el servidor autocontenido que generó el modo standalone.
# En español: server.js es el punto de entrada que sirve toda la app.
CMD ["node", "server.js"]
