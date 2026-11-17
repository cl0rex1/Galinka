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
  for attempt in 1 2; do
    pg_dump -Fc -f "$tmp/galinka.dump"
    if tar czf "$tmp/uploads.tar.gz" -C "$UPLOAD_DIR" .; then
      dropdb --if-exists "$CHECK_DB"
      createdb "$CHECK_DB"
      pg_restore --no-owner --exit-on-error -d "$CHECK_DB" "$tmp/galinka.dump"
      messages=$(psql -d "$CHECK_DB" -Atc 'SELECT count(*) FROM messages')
      # Both old UUID paths and converted .mp4 paths must match the restored
      # rows. A file can change or disappear between pg_dump and tar.
      psql -d "$CHECK_DB" -Atc "SELECT './'||id||CASE WHEN to_jsonb(f)->>'converted_video'='true' THEN '.mp4' ELSE '' END FROM files f" > "$tmp/expected"
      dropdb "$CHECK_DB"
      tar tzf "$tmp/uploads.tar.gz" > "$tmp/archived"
      if awk '{sub(/\r$/, "")} FILENAME == ARGV[1] {want[$0]=1; next} {delete want[$0]} END {for (f in want) exit 1}' "$tmp/expected" "$tmp/archived"; then
        rm -f "$tmp/expected" "$tmp/archived"
        break
      fi
    fi
    [ "$attempt" = 1 ] || return 1
    echo "Upload files changed during backup; taking a fresh snapshot." >&2
  done

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
