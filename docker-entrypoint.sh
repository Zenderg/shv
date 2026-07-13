#!/bin/sh
set -eu

runtime_user="node"
runtime_group="node"

require_runtime_directory() {
  directory="$1"
  if ! gosu "$runtime_user" test -d "$directory" \
    || ! gosu "$runtime_user" test -x "$directory" \
    || ! gosu "$runtime_user" test -w "$directory"; then
    echo "shv: $directory must be writable by $runtime_user after the ownership migration." >&2
    exit 1
  fi
}

require_runtime_file() {
  file="$1"
  if [ -e "$file" ]; then
    if ! gosu "$runtime_user" test -r "$file" \
      || ! gosu "$runtime_user" test -w "$file"; then
      echo "shv: $file must be readable and writable by $runtime_user." >&2
      exit 1
    fi
  fi
}

migrate_legacy_root_files() {
  root="$1"
  find "$root" -xdev -uid 0 -exec chown -h "$runtime_user:$runtime_group" {} +
}

if [ "$(id -u)" -eq 0 ]; then
  echo "shv: checking persistent data ownership"
  if ! migrate_legacy_root_files /data/app \
    || ! migrate_legacy_root_files /data/library \
    || ! migrate_legacy_root_files /work; then
    echo "shv: automatic ownership migration failed; verify that the mounted storage permits chown." >&2
    exit 1
  fi

  require_runtime_directory /data/app
  require_runtime_directory /data/library
  require_runtime_directory /work

  require_runtime_file /data/app/shv.sqlite
  require_runtime_file /data/app/shv.sqlite-wal
  require_runtime_file /data/app/shv.sqlite-shm
  require_runtime_file /data/app/shv.sqlite-journal

  exec gosu "$runtime_user" tini -- "$@"
fi

exec tini -- "$@"
