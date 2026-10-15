# syntax=docker/dockerfile:1.7
# VaultDock server image: web UI + API in one static binary.

FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY pkg ./pkg
COPY web/embed.go ./web/embed.go
COPY --from=web /src/web/dist ./web/dist
ARG VERSION=dev
RUN go build -ldflags "-s -w -X github.com/vaultdock/vaultdock/internal/api.Version=${VERSION}" -o /out/vaultdock ./cmd/vaultdock \
 && mkdir -p /out/state /out/storage/default

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.title="VaultDock" \
      org.opencontainers.image.description="Self-hosted file storage and intelligent synchronisation"
COPY --from=build /out/vaultdock /usr/local/bin/vaultdock
COPY --from=build --chown=65532:65532 /out/state /state
COPY --from=build --chown=65532:65532 /out/storage /storage
ENV VAULTDOCK_STATE_DIR=/state \
    VAULTDOCK_DEFAULT_STORAGE=/storage/default \
    VAULTDOCK_STORAGE_ROOTS=/storage \
    VAULTDOCK_LISTEN=:8080
EXPOSE 8080
VOLUME ["/state", "/storage"]
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/usr/local/bin/vaultdock", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/vaultdock"]
CMD ["serve"]
