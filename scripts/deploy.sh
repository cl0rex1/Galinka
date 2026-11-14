#!/bin/sh
# Automated deploy with pre-deploy PostgreSQL backup, health + version verification, and automatic rollback.
set -eu

GIT_CMD="${GIT_CMD:-git}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${APP_PORT:-3010}/api/health}"
VERSION_URL="${VERSION_URL:-http://127.0.0.1:${APP_PORT:-3010}/api/version}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
SKIP_PULL="${SKIP_PULL:-0}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

fetch_url() {
  url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- -T 5 "$url"
  elif command -v node >/dev/null 2>&1; then
    node -e "fetch(process.argv[1]).then(async r => { if (!r.ok) process.exit(1); process.stdout.write(await r.text()); }).catch(() => process.exit(1));" "$url"
  else
    echo "deploy: need curl, wget, or node to verify health endpoints" >&2
    return 1
  fi
}

check_health_once() {
  expected_sha="$1"
  health_json=$(fetch_url "$HEALTH_URL" 2>/dev/null || true)
  [ -n "$health_json" ] || return 1
  case "$(printf '%s' "$health_json" | tr -d ' \r\n\t')" in
    *'"ok":true'*) ;;
    *) return 1 ;;
  esac

  if [ -n "$VERSION_URL" ]; then
    version_json=$(fetch_url "$VERSION_URL" 2>/dev/null || true)
    [ -n "$version_json" ] || return 1
    actual_build=$(printf '%s' "$version_json" | tr -d ' \r\n\t' | sed -n 's/.*"build":"\([^"]*\)".*/\1/p')
    [ -n "$actual_build" ] || return 1
    short_sha=$(printf '%.7s' "$expected_sha")
    case "$actual_build" in
      "$expected_sha"|"$short_sha"*) ;;
      *)
        echo "deploy: version mismatch (expected $short_sha, got $actual_build)" >&2
        return 1
        ;;
    esac
  fi
  return 0
}

wait_for_healthy() {
  expected_sha="$1"
  attempt=1
  while [ "$attempt" -le "$HEALTH_RETRIES" ]; do
    if check_health_once "$expected_sha"; then
      return 0
    fi
    if [ "$attempt" -lt "$HEALTH_RETRIES" ]; then
      sleep "$HEALTH_INTERVAL"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

PREV_SHA=$($GIT_CMD rev-parse HEAD)
BACKUP_FILE=""

if [ "$SKIP_BACKUP" != "1" ]; then
  mkdir -p "$BACKUP_DIR"
  short_prev=$(printf '%.7s' "$PREV_SHA")
  BACKUP_FILE="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$short_prev.dump"
  echo "deploy: backing up database to $BACKUP_FILE..."
  if ! $COMPOSE_CMD exec -T db sh -c 'pg_dump -U "${POSTGRES_USER:-galinka}" -d "${POSTGRES_DB:-galinka}" -Fc' > "$BACKUP_FILE" || [ ! -s "$BACKUP_FILE" ]; then
    rm -f "$BACKUP_FILE"
    echo "deploy: pre-deploy database backup failed, aborting" >&2
    exit 1
  fi
fi

if [ "$SKIP_PULL" != "1" ]; then
  echo "deploy: updating repository from git..."
  $GIT_CMD pull --ff-only
fi

TARGET_SHA=$($GIT_CMD rev-parse HEAD)
echo "deploy: deploying $TARGET_SHA (previous: $PREV_SHA)..."

set +e
BUILD_SHA="$TARGET_SHA" $COMPOSE_CMD up -d --build
up_status=$?
verify_status=1
if [ "$up_status" -eq 0 ]; then
  echo "deploy: verifying $HEALTH_URL..."
  wait_for_healthy "$TARGET_SHA"
  verify_status=$?
fi
set -e

if [ "$up_status" -eq 0 ] && [ "$verify_status" -eq 0 ]; then
  echo "deploy: release $TARGET_SHA is healthy."
  exit 0
fi

echo "deploy: verification failed for $TARGET_SHA, rolling back to $PREV_SHA..." >&2
set +e
$GIT_CMD reset --hard "$PREV_SHA"
if [ -n "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
  echo "deploy: restoring database backup $BACKUP_FILE..." >&2
  $COMPOSE_CMD stop app >/dev/null 2>&1
  $COMPOSE_CMD exec -T db sh -c 'psql -U "${POSTGRES_USER:-galinka}" -d "${POSTGRES_DB:-galinka}" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" && pg_restore -U "${POSTGRES_USER:-galinka}" -d "${POSTGRES_DB:-galinka}" --no-owner --exit-on-error' < "$BACKUP_FILE"
fi
BUILD_SHA="$PREV_SHA" $COMPOSE_CMD up -d --build
wait_for_healthy "$PREV_SHA"
rb_status=$?
set -e

if [ "$rb_status" -eq 0 ]; then
  echo "deploy: rolled back cleanly to $PREV_SHA." >&2
else
  echo "deploy: rollback to $PREV_SHA finished, but health check failed!" >&2
fi
exit 1
