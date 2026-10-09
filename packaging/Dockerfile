# Runtime image for an already-built alumia release — nothing is compiled here.
#
# The build context starts as an extracted release tarball (see
# build-tarball.sh), but its binary must be replaced with the output of
# build-container-binary.sh. That binary is built with no default features, so
# the image has the deployed gateway and never the managed-instance substrate.
# The Docker build verifies that boundary below instead of trusting its context.
# .github/workflows/release.yml wires this up; to do it by hand:
#
#   mkdir -p tmp/docker-context
#   tar -xzf alumia-0.0.145-linux-x86_64.tar.gz -C tmp/docker-context --strip-components=1
#   bash packaging/build-container-binary.sh tmp/docker-context/bin/alumia
#   docker build -f packaging/Dockerfile --build-arg VERSION=0.0.145 tmp/docker-context
#
# The base has to be at least as new as the builder: the release binaries are
# built on the ubuntu-24.04 runners (glibc 2.39), and trixie's 2.41 runs them
# fine — a base with an *older* glibc would not.
FROM debian:trixie-slim

LABEL org.opencontainers.image.source=https://github.com/aleonnet/alumia

# The RDP/VNC TLS paths accept self-signed server certificates, but rustls still
# wants a system trust store for anything conventionally signed.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The version is part of the on-disk layout, not decoration: alumia derives its
# config path from its own location — <prefix>/versions/<version>/bin/alumia
# resolves to <prefix>/etc/alumia.toml and keeps state in <prefix>/var (see
# src/config.rs). That layout is what makes bare `serve` find
# /opt/alumia/etc/alumia.toml.
ARG VERSION
RUN test -n "${VERSION}" || { echo "the VERSION build-arg is required" >&2; exit 1; }

COPY bin/alumia /opt/alumia/versions/${VERSION}/bin/alumia
# The example config only: the web client is compiled into the binary.
COPY share /opt/alumia/versions/${VERSION}/share

# `current` is the stable path the entrypoint uses; canonicalizing it is how the
# binary finds the versioned root.
RUN ln -s "versions/${VERSION}" /opt/alumia/current && mkdir -p /opt/alumia/etc

# A normal native release binary has the embedded gateway feature enabled. Fail
# closed if one is accidentally placed in this context: release CI also checks,
# but keeping the invariant here covers every manual or downstream image build.
RUN set -eu; \
    binary=/opt/alumia/current/bin/alumia; \
    "$binary" --version >/dev/null; \
    case "$("$binary" --help)" in \
      *"  tui "*) echo "container binary exposes tui" >&2; exit 1 ;; \
    esac; \
    case "$("$binary" --help)" in \
      *serve-embedded*) echo "container binary exposes serve-embedded" >&2; exit 1 ;; \
    esac; \
    case "$("$binary" check-config --help)" in \
      *--embedded*) echo "container binary exposes check-config --embedded" >&2; exit 1 ;; \
    esac

# The config is the one thing that has to come from outside — bind-mount it
# read-only, it holds credentials (no VOLUME here: an anonymous volume for a
# config directory just accumulates):
#
#   docker run -p 52380:52380 -v ./alumia.toml:/opt/alumia/etc/alumia.toml:ro ...
#
# It must set [server] listen = "0.0.0.0:52380" — or the run must pass
# -e ALUMIA_LISTEN=0.0.0.0:52380, which is the same setting from the one place a
# container has that is not the mounted file; the 127.0.0.1 default is
# unreachable from outside the container. A template ships at
# /opt/alumia/current/share/doc/alumia/alumia.example.toml.
EXPOSE 52380

# alumia installs its own SIGINT/SIGTERM handler (src/main.rs) and spawns no
# child processes, so it is fine as PID 1 — no init shim needed.
ENTRYPOINT ["/opt/alumia/current/bin/alumia"]
CMD ["serve"]
