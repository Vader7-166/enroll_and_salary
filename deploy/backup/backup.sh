#!/bin/sh
# Hourly encrypted PostgreSQL backup (FR-X.4, RPO ≤ 1 h) for the `backup` compose service.
#   pg_dump -Fc | openssl AES-256-CBC (PBKDF2, 200k iterations) with BACKUP_ENCRYPTION_KEY, which is NOT HR_DATA_KEY and
#   never lives in the database. Each file gets a .sha256 sidecar. Connection comes from the standard PG* variables.
# Retention (names are UTC stamps, so string order is time order):
#   every backup younger than BACKUP_KEEP_HOURS (48), the first backup of each day younger than BACKUP_KEEP_DAYS (90),
#   the first backup of each month younger than BACKUP_KEEP_MONTHS (36 → the 3-year attendance/payroll retention).
# BACKUP_ONCE=true runs one backup and exits; BACKUP_RETENTION_ONLY=true only prunes.
set -eu
# `set` is a POSIX special builtin: an unknown option (dash before 0.5.13 has no pipefail, e.g. Ubuntu's /bin/sh)
# exits the whole shell even with `|| true`, so probe in a subshell first. backup() does not rely on it anyway.
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi
DIR=${BACKUP_DIR:-/backups}
INTERVAL=${BACKUP_INTERVAL_SECONDS:-3600}
KEEP_HOURS=${BACKUP_KEEP_HOURS:-48}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-90}
KEEP_MONTHS=${BACKUP_KEEP_MONTHS:-36}
mkdir -p "$DIR"
if [ "${BACKUP_RETENTION_ONLY:-false}" != true ] && [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "Set BACKUP_ENCRYPTION_KEY in .env for the backup profile (separate from HR_DATA_KEY)" >&2; exit 1
fi
umask 077

stamp_at() { date -u -d "@$1" +%Y%m%dT%H%M%SZ; }
newer() { awk 'BEGIN { exit !(ARGV[1] > ARGV[2]) }' "$1" "$2"; }

prune() {
  now=${BACKUP_NOW:-$(date -u +%s)}
  hour_cut=$(stamp_at $((now - KEEP_HOURS * 3600)))
  day_cut=$(stamp_at $((now - KEEP_DAYS * 86400)))
  month_cut=$(stamp_at $((now - KEEP_MONTHS * 2629746)))
  prev_day="" prev_month=""
  for file in $(ls "$DIR" | grep -E '^hrtp-[0-9]{8}T[0-9]{6}Z\.dump\.enc$' | sort); do
    stamp=${file#hrtp-}; stamp=${stamp%.dump.enc}
    day=$(echo "$stamp" | cut -c1-8); month=$(echo "$stamp" | cut -c1-6)
    keep=no
    if newer "$stamp" "$hour_cut"; then keep=yes; fi
    if [ "$day" != "$prev_day" ] && newer "$stamp" "$day_cut"; then keep=yes; fi
    if [ "$month" != "$prev_month" ] && newer "$stamp" "$month_cut"; then keep=yes; fi
    prev_day=$day prev_month=$month
    if [ "$keep" = no ]; then rm -f "$DIR/$file" "$DIR/$file.sha256"; echo "pruned $file"; fi
  done
}

backup() {
  : "${BACKUP_ENCRYPTION_KEY:?Set BACKUP_ENCRYPTION_KEY (separate from HR_DATA_KEY)}"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  target="$DIR/hrtp-$stamp.dump.enc"
  partial="$DIR/.hrtp-$stamp.partial"
  started=$(date -u +%s)
  # Portable pipeline status: a failed pg_dump leaves a marker, so an empty-but-encrypted dump is never published
  # even on shells without pipefail.
  rm -f "$partial.failed"
  if ! { pg_dump -Fc --no-owner --no-privileges || : > "$partial.failed"; } \
      | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY -out "$partial" \
      || [ -e "$partial.failed" ]; then
    rm -f "$partial" "$partial.failed"
    echo "backup failed: pg_dump or encryption error" >&2
    return 1
  fi
  mv "$partial" "$target"
  (cd "$DIR" && sha256sum "$(basename "$target")" > "$(basename "$target").sha256")
  echo "backup $(basename "$target") $(wc -c < "$target") bytes in $(( $(date -u +%s) - started )) s"
}

if [ "${BACKUP_RETENTION_ONLY:-false}" = true ]; then prune; exit 0; fi
if [ "${BACKUP_ONCE:-false}" = true ]; then backup; prune; exit 0; fi
while true; do
  backup || echo "backup failed" >&2
  prune || echo "prune failed" >&2
  sleep "$INTERVAL"
done
