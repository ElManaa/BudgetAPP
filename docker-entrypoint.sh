#!/bin/sh
# Hosted volumes (Railway, Fly, a plain `docker -v`) are attached owned by root.
# A container running as a normal user cannot write to one, so fix the ownership
# while we still have root, then drop to the unprivileged user to actually run.
set -e

DATA=/app/data

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DATA"
    # only touch it when it is not already ours - a big volume should not be
    # walked on every boot
    if [ "$(stat -c '%u' "$DATA")" != "10001" ]; then
        echo "entrypoint: taking ownership of $DATA"
        chown -R gm:gm "$DATA"
    fi
    exec setpriv --reuid=gm --regid=gm --init-groups "$@"
fi

# already unprivileged (e.g. `docker run --user`); just make sure we can write
if [ ! -w "$DATA" ]; then
    echo "entrypoint: WARNING - $DATA is not writable by $(id -un)." >&2
    echo "entrypoint: your budgets cannot be saved. Fix the volume's owner," >&2
    echo "entrypoint: or run the container as root and let it drop privileges." >&2
fi
exec "$@"
