#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Deploy render worker to the k3s cluster — thin wrapper around
# the GitHub Actions workflow .github/workflows/docker-publish-render-worker.yml
#
# The actual build + push + rollout happens on a GitHub-hosted runner. This
# script just triggers it (and tails it so you can see live logs).
#
# Why a GH Action instead of a local script:
#   - There is no longer a dedicated build host (157.90.162.154 was removed).
#   - GH runners are linux/amd64 with docker preinstalled (fast, free).
#   - Audit trail of every deploy in Actions UI.
#   - No PATs / secrets sitting on engineers' laptops.
#
# Usage:
#   cd vacademy_platform/ai_service && bash render_worker/deploy.sh
#   bash render_worker/deploy.sh --main          # deploy main even when on a branch
#   bash render_worker/deploy.sh --no-watch      # fire and exit, don't tail logs
#
# Prereqs (one-time):
#   - `gh` CLI installed and authenticated (`gh auth status` should be green)
#   - The branch you deploy from must be pushed to origin (workflow_dispatch
#     resolves refs against the remote, not your local working tree)
#
# To roll back (any laptop with kubectl access to k3s):
#   kubectl -n default rollout undo deployment/render-worker         # one step back
#   kubectl -n default set image deployment/render-worker \
#     render-worker=ghcr.io/vacademy-io/render-worker:<OLD_TAG>      # specific tag
#   kubectl -n default rollout history deployment/render-worker      # see prior tags
# ──────────────────────────────────────────────────────────────
set -euo pipefail

WORKFLOW_FILE="docker-publish-render-worker.yml"
USE_MAIN=0
NO_WATCH=0

for arg in "$@"; do
    case "$arg" in
        --main)     USE_MAIN=1 ;;
        --no-watch) NO_WATCH=1 ;;
        -h|--help)
            # Print the leading banner only. The banner is bounded by long
            # horizontal rules (`# ──────...`, 6+ box-drawing chars). Section
            # dividers in the body use the shorter `# ── Name ──` form so
            # they won't match. awk stops after the second long rule.
            awk '
                /^# ──────/ {
                    print
                    c++
                    if (c == 2) exit
                    next
                }
                c == 1 { print }
            ' "$0"
            exit 0
            ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

# ── Pre-flight: gh CLI ──
if ! command -v gh >/dev/null 2>&1; then
    echo "✗ gh CLI not installed. Install: brew install gh   (or visit https://cli.github.com/)" >&2
    exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
    echo "✗ gh not authenticated. Run: gh auth login" >&2
    exit 1
fi

# ── Resolve the ref we will dispatch ──
if [ "$USE_MAIN" = "1" ]; then
    REF="main"
else
    CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
    if [ "$CUR_BRANCH" = "HEAD" ]; then
        echo "✗ Detached HEAD — workflow_dispatch needs a named ref." >&2
        echo "  Either checkout a branch (git checkout main) or pass --main." >&2
        exit 1
    fi
    REF="$CUR_BRANCH"
fi

# ── Confirm the ref exists on origin (workflow_dispatch resolves against remote) ──
if ! git ls-remote --exit-code --heads origin "$REF" >/dev/null 2>&1; then
    echo "✗ Branch '$REF' is not on origin. Push it first:" >&2
    echo "  git push -u origin $REF" >&2
    echo "  (or pass --main if you meant to deploy main)" >&2
    exit 1
fi

# ── Soft warning: working tree has uncommitted changes ──
if [ "$USE_MAIN" != "1" ]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "⚠ Working tree has uncommitted changes." >&2
        echo "  The GH runner checks out from origin — local edits will NOT be deployed." >&2
        echo "  Press Ctrl-C to abort, or wait 5s to continue with the pushed ref."  >&2
        sleep 5
    fi
    # Also warn if local branch is ahead of origin (--heads avoids matching a
    # similarly-named tag if one exists)
    LOCAL_SHA="$(git rev-parse HEAD)"
    REMOTE_SHA="$(git ls-remote --heads origin "$REF" 2>/dev/null | awk '{print $1}')"
    if [ -n "$REMOTE_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
        echo "⚠ Local '$REF' ($LOCAL_SHA) differs from origin/$REF ($REMOTE_SHA)." >&2
        echo "  Deploy will use origin/$REF — push your local commits first if needed." >&2
        echo "  Sleeping 5s; Ctrl-C to abort." >&2
        sleep 5
    fi
fi

echo "════════════════════════════════════════════════════════════"
echo "  Triggering: $WORKFLOW_FILE"
echo "  Ref:        $REF"
echo "════════════════════════════════════════════════════════════"

# ── Capture a timestamp BEFORE dispatch so we can find OUR new run, not a previous one ──
# GitHub registers the run within 5-30s; we poll for a run created after this timestamp.
# Subtract a 10s safety margin to absorb local-clock vs GH-server clock skew.
if date -u -d '-10 seconds' +"%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
    DISPATCH_TS="$(date -u -d '-10 seconds' +"%Y-%m-%dT%H:%M:%SZ")"     # GNU date (Linux)
else
    DISPATCH_TS="$(date -u -v-10S +"%Y-%m-%dT%H:%M:%SZ")"                # BSD date (macOS)
fi

gh workflow run "$WORKFLOW_FILE" --ref "$REF"

if [ "$NO_WATCH" = "1" ]; then
    echo "✓ Dispatched. Use the Actions UI or 'gh run watch' to follow."
    exit 0
fi

# ── Poll for the new run (createdAt > DISPATCH_TS) ──
echo ""
echo "Waiting for run to register on GitHub..."
RUN_ID=""
for attempt in $(seq 1 30); do
    sleep 2
    # createdAt is ISO-8601; lexical compare is correct
    RUN_ID="$(gh run list \
        --workflow="$WORKFLOW_FILE" \
        --limit=10 \
        --json databaseId,createdAt,event,status \
        -q ".[] | select(.event == \"workflow_dispatch\" and .createdAt > \"$DISPATCH_TS\") | .databaseId" \
        2>/dev/null | head -n1)"
    if [ -n "$RUN_ID" ]; then
        break
    fi
done

if [ -z "$RUN_ID" ]; then
    echo "✗ Could not find a workflow run created after $DISPATCH_TS." >&2
    echo "  Check Actions UI manually: https://github.com/Vacademy-io/vacademy_edtech_platform/actions" >&2
    exit 1
fi

echo "▶ Watching run $RUN_ID — Ctrl-C to detach (the run keeps going)."
echo ""

gh run watch "$RUN_ID" --exit-status

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✓ Deploy complete."
echo "    https://github.com/Vacademy-io/vacademy_edtech_platform/actions/runs/$RUN_ID"
echo "════════════════════════════════════════════════════════════"
