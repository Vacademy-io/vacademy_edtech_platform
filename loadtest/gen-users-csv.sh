#!/usr/bin/env bash
# Generates the CSV for admin bulk-upload of load-test learners.
# Usage: ./gen-users-csv.sh <count> [prefix] [password] > loadtest-users.csv
# Upload via the admin dashboard's bulk student upload into the dedicated
# load-test institute/batch. Column names may need aligning with the current
# bulk-upload template — download a fresh template from the UI first.
set -euo pipefail
COUNT="${1:?usage: gen-users-csv.sh <count> [prefix] [password]}"
PREFIX="${2:-loadtest}"
PASSWORD="${3:-LoadTest@123}"

echo "FULL_NAME,USERNAME,PASSWORD,EMAIL,MOBILE_NUMBER"
for i in $(seq 1 "$COUNT"); do
  n=$(printf '%04d' "$i")
  # @vacademy.com is filtered by the notification layer — no real email goes out
  echo "Load Test ${n},${PREFIX}${n},${PASSWORD},${PREFIX}${n}@vacademy.com,99900${n}0"
done
