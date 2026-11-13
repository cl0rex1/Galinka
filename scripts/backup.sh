#!/bin/sh
# Daily backup of the database and uploads, with a real restore check.
# Runs in the `backup` Compose service (postgres image: pg_dump, pg_restore, tar).
# Env: PGHOST PGUSER PGPASSWORD PGDATABASE, BACKUP_DIR, UPLOAD_DIR, KEEP_DAYS, ONCE=1.
set -eu
BACKUP_DIR=${BACKUP_DIR:-/backups}
UPLOAD_DIR=${UPLOAD_DIR:-/uploads}
KEEP_DAYS=${KEEP_DAYS:-14}
CHECK_DB=${PGDATABASE}_restore_check

backup() {
  stamp=$(date -u +%Y-%m-%dT%H%MZ)
  tmp="$BACKUP_DIR/.partial-$stamp"
  mkdir -p "$tmp"
  # Database first: every file it references already exists when the archive starts.
  pg_dump -Fc -f "$tmp/galinka.dump"
  tar czf "$tmp/uploads.tar.gz" -C "$UPLOAD_DIR" .

  # Restore check: the dump loads into a scratch database and the archive reads back.
  dropdb --if-exists "$CHECK_DB"
  createdb "$CHECK_DB"
  pg_restore --no-owner --exit-on-error -d "$CHECK_DB" "$tmp/galinka.dump"
  messages=$(psql -d "$CHECK_DB" -Atc 'SELECT count(*) FROM messages')
  dropdb "$CHECK_DB"
  tar tzf "$tmp/uploads.tar.gz" >/dev/null

  mv "$tmp" "$BACKUP_DIR/$stamp"
  echo "$(date -u +%FT%TZ) backup $stamp ok: $messages messages, $(du -sh "$BACKUP_DIR/$stamp" | cut -f1)"
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
while :; do
  # A plain subshell: `set -e` is ignored inside `if`/`||`, so status is read afterwards.
  set +e
  (set -e; backup)
  status=$?
  set -e
  if [ "$status" != 0 ]; then
    echo "$(date -u +%FT%TZ) backup FAILED" >&2
    rm -rf "$BACKUP_DIR"/.partial-*
  fi
  [ "${ONCE:-}" = 1 ] && exit "$status"
  sleep 86400
done
