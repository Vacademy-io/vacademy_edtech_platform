#!/usr/bin/env bash
# Every Java service compiles against common_service-0.0.2-SNAPSHOT from GitHub Packages, on the
# runner and again inside its Docker build. When a push to main changes common_service too, the
# "Common Library" workflow publishes the new snapshot at the same moment the service deploys
# start; a service that resolves its dependencies first gets the OLD jar and fails with
# "cannot find symbol" on whatever the push added to common (this is what broke the deploys of
# #3818). So: if this commit has a Common Library run, wait for it to publish before building.
#
# Needs GH_TOKEN (github.token with actions: read), GITHUB_REPOSITORY and GITHUB_SHA.
set -euo pipefail

workflow="maven-publish-common.yml"
api="repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?head_sha=${GITHUB_SHA}&per_page=1"

run_state() {
  gh api "$api" --jq '.workflow_runs[0] // empty | "\(.status)|\(.conclusion // "")|\(.html_url)"'
}

# The run is created with the push, but give the API a moment to list it.
state=""
for _ in $(seq 1 6); do
  state="$(run_state)"
  [ -n "$state" ] && break
  sleep 5
done

if [ -z "$state" ]; then
  echo "common_service did not change in ${GITHUB_SHA}; the published snapshot is current."
  exit 0
fi

# Publishing takes about a minute; allow 15.
for _ in $(seq 1 90); do
  IFS="|" read -r status conclusion url <<<"$state"
  if [ "$status" = "completed" ]; then
    if [ "$conclusion" = "success" ]; then
      echo "common_service for ${GITHUB_SHA} is published: ${url}"
      exit 0
    fi
    echo "::error::The Common Library run for this commit ended '${conclusion}', so this service would build against a stale common_service. Fix it first: ${url}"
    exit 1
  fi
  echo "Waiting for common_service to be published (${status}): ${url}"
  sleep 10
  state="$(run_state)"
done

echo "::error::Gave up waiting 15 minutes for the Common Library run: ${url}"
exit 1
