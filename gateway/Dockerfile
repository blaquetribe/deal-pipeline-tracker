# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f gateway/Dockerfile .

FROM caddy:2.11.7-builder-alpine@sha256:ef9b65adf9a224770c6d5f6d1ae1bf99bc3caaa78d8c4bae3ea949ee6984f301 AS caddy-build
RUN xcaddy build v2.11.7 \
      --replace github.com/go-jose/go-jose/v4=github.com/go-jose/go-jose/v4@v4.1.6 \
      --replace golang.org/x/net=golang.org/x/net@v0.60.0 \
      --output /tmp/caddy

FROM caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
ARG IMAGE_SOURCE=https://github.com/blaquetribe/deal-pipeline-tracker
LABEL org.opencontainers.image.source=${IMAGE_SOURCE} \
      org.opencontainers.image.title="dpt-gateway"
# Pull in Alpine security fixes published after the pinned base image was built.
RUN apk upgrade --no-cache
COPY gateway/Caddyfile /etc/caddy/Caddyfile
COPY --from=caddy-build /tmp/caddy /tmp/caddy
# The stock binary carries a cap_net_bind_service file capability, which the kernel
# refuses to exec once compose drops all capabilities. We bind 8080, so use a plain
# copy (cp does not preserve extended attributes) and remove the original.
RUN cp /tmp/caddy /usr/local/bin/caddy && rm /tmp/caddy /usr/bin/caddy
# Caddy needs writable state dirs; compose mounts a tmpfs at /tmp.
ENV XDG_DATA_HOME=/tmp/caddy-data \
    XDG_CONFIG_HOME=/tmp/caddy-config
USER 65532:65532
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
