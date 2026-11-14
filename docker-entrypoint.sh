#!/bin/sh
set -e

# The app runs as the unprivileged "node" user. Volumes created by earlier
# versions (which ran as root) contain root-owned files, so fix ownership of
# the data directory first, then drop privileges.
if [ "$(id -u)" = "0" ]; then
  DATA_DIR="${DATA_DIR:-/data}"
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi

exec "$@"
