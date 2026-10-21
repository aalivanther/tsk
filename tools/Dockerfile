# tools/Dockerfile — imagen del "taller" de desarrollo y generación de código (pinneada).
#
# En español: esta imagen NO ejecuta la aplicación. Es el taller reproducible donde viven, en
# versiones EXACTAS, las herramientas que generan código y revisan calidad (buf, gofumpt,
# golangci-lint) y el toolchain de JavaScript (Node + pnpm). Gracias a esto, NADIE necesita
# instalar nada en su máquina: los objetivos del Makefile (make gen / lint / test / fmt) corren
# DENTRO de este contenedor, dejando el host completamente limpio.
#
# Base: la imagen oficial de Go 1.26.3 (Debian "bookworm"), que ya trae el toolchain de Go que
# necesitan golangci-lint (analiza usando Go), go test y go mod tidy.
FROM golang:1.26.3-bookworm

# Versiones EXACTAS de cada herramienta. Deben coincidir con stack-verificado-2026-05-30.md.
# En español: fijarlas aquí hace que el taller sea idéntico en cualquier máquina y momento.
ARG BUF_VERSION=1.70.0
ARG GOLANGCI_LINT_VERSION=2.12.2
ARG GOFUMPT_VERSION=0.10.0
ARG NODE_MAJOR=24
ARG PNPM_VERSION=11.5.0

# Utilidades base para descargar e instalar lo demás (curl para descargas, certificados para
# HTTPS, gnupg para validar el repositorio de Node.js).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && rm -rf /var/lib/apt/lists/*

# buf: lo bajamos como binario de release (rápido y pinneado) y lo dejamos en /usr/local/bin.
# En español: "uname -s" da "Linux" y "uname -m" da "aarch64" (arm64) o "x86_64" (amd64), que es
# justo como buf nombra sus binarios de release; así funciona en Mac (Apple Silicon) y en PCs.
RUN curl -fsSL "https://github.com/bufbuild/buf/releases/download/v${BUF_VERSION}/buf-$(uname -s)-$(uname -m)" \
      -o /usr/local/bin/buf \
 && chmod +x /usr/local/bin/buf

# golangci-lint: usamos su instalador oficial, pinneado a la versión exacta, que coloca el
# binario en /usr/local/bin. En español: este script detecta la arquitectura y baja el binario.
RUN curl -sSfL "https://raw.githubusercontent.com/golangci/golangci-lint/v${GOLANGCI_LINT_VERSION}/install.sh" \
      | sh -s -- -b /usr/local/bin "v${GOLANGCI_LINT_VERSION}"

# gofumpt: es pequeño, así que lo compilamos con "go install" y lo movemos a /usr/local/bin.
RUN go install "mvdan.cc/gofumpt@v${GOFUMPT_VERSION}" \
 && cp "$(go env GOPATH)/bin/gofumpt" /usr/local/bin/gofumpt

# Node.js (Active LTS) + pnpm en la versión exacta, habilitado por corepack (que viene con Node).
# En español: instalamos el toolchain de JavaScript para poder correr el lint y el typecheck del
# frontend (eslint, tsc) dentro del mismo taller, sin depender del Node del host.
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare "pnpm@${PNPM_VERSION}" --activate

# Carpeta donde se montará el repositorio (vía volumen) al correr las herramientas.
WORKDIR /work

# Comando por defecto: una shell. Los objetivos del Makefile pasan el comando concreto a correr.
CMD ["bash"]
