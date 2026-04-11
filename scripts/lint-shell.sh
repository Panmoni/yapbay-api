#!/usr/bin/env bash
# Run shellcheck against every shell script under scripts/.
#
# Prefers a locally-installed shellcheck; falls back to a container image
# (docker or podman) so devs without shellcheck on PATH still get coverage.

set -euo pipefail

cd "$(dirname "$0")/.."

# Collect targets. Null-delimited so filenames with spaces survive.
mapfile -d '' -t TARGETS < <(find scripts -type f -name '*.sh' -print0)

if [ "${#TARGETS[@]}" -eq 0 ]; then
    echo "lint-shell: no shell scripts found under scripts/"
    exit 0
fi

SC_ARGS=(-S warning)

if command -v shellcheck >/dev/null 2>&1; then
    exec shellcheck "${SC_ARGS[@]}" "${TARGETS[@]}"
fi

# Container fallback — prefer podman, then docker.
# `:ro,Z` — :ro prevents the container from modifying the mount; the :Z suffix
# relabels the bind mount for SELinux-enforcing hosts (Fedora, RHEL). It is a
# no-op on non-SELinux systems, so it is safe to use unconditionally.
for runtime in podman docker; do
    if command -v "$runtime" >/dev/null 2>&1; then
        exec "$runtime" run --rm -v "$PWD:/mnt:ro,Z" -w /mnt \
            koalaman/shellcheck:stable "${SC_ARGS[@]}" "${TARGETS[@]}"
    fi
done

echo "lint-shell: shellcheck not found and no container runtime available." >&2
echo "Install shellcheck (apt install shellcheck) or podman/docker." >&2
exit 1
