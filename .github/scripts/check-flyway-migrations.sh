#!/usr/bin/env bash
# Fails when a Flyway migration folder holds something that would break or be skipped on deploy:
#   - two files with the same version: every new pod crash-loops ("Found more than one migration")
#   - a misnamed file: Flyway ignores it silently, so its change never reaches the database
# Usage: check-flyway-migrations.sh [migration-dir]
set -euo pipefail

DIR="${1:-admin_core_service/src/main/resources/db/migration}"

# Misnamed before this check existed and never applied. Renaming one makes it run on the next
# deploy, so that is a decision for its owner, not a side effect of this check.
KNOWN_MISNAMED=("V373_Omni_model_add.sql")

if [ ! -d "$DIR" ]; then
  echo "::error::Migration folder not found: $DIR"
  exit 1
fi

status=0
declare -A seen=()

while IFS= read -r path; do
  name="$(basename "$path")"
  [[ "$name" =~ ^R__.+\.sql$ ]] && continue

  if [[ ! "$name" =~ ^V([0-9]+([._][0-9]+)*)__.+\.sql$ ]]; then
    for known in "${KNOWN_MISNAMED[@]}"; do
      [ "$name" = "$known" ] && continue 2
    done
    echo "::error file=$path::$name is not a valid Flyway name (expected V<version>__<description>.sql), so Flyway would skip it"
    status=1
    continue
  fi

  # Flyway compares versions numerically: V640, V0640 and V640.0 are the same version.
  version="$(echo "${BASH_REMATCH[1]}" | tr '_' '.' | awk -F. '{
    n = NF; while (n > 1 && $n + 0 == 0) n--
    v = $1 + 0; for (i = 2; i <= n; i++) v = v "." ($i + 0); print v
  }')"

  if [ -n "${seen[$version]:-}" ]; then
    echo "::error file=$path::Version $version is used twice: ${seen[$version]} and $name. Renumber the newer one to the highest version on main + 1."
    status=1
  else
    seen[$version]="$name"
  fi
done < <(find "$DIR" -type f -name '*.sql' | sort)

if [ "$status" -eq 0 ]; then
  echo "Checked ${#seen[@]} versioned migrations in $DIR: no duplicates, no misnamed files."
fi
exit "$status"
