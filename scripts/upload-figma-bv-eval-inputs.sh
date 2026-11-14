#!/bin/bash
#
# Upload the Brahm Varchas Figma eval inputs to the PRIVATE eval bucket.
#
# The inputs are client material (Brahm Varchas' Figma design, renders and
# assets). They are never committed; the CI job (.github/workflows/
# figma-bv-eval.yml) downloads them from this bucket. What goes where is
# described in ai_service/evals/figma_bv/README.md.
#
# Usage:
#   scripts/upload-figma-bv-eval-inputs.sh [--dry-run] s3://<bucket>/<prefix> <figma-dir> [<renders-dir>]
#
#   <figma-dir>    page1.xml, courses.tsx, paths.tsx, coming_soon.tsx,
#                  megamenu.notes.md, assets/ ... (synced to <prefix>/)
#   <renders-dir>  the frame renders c0-5.png, p0-6.png, m0-1.png
#                  (synced to <prefix>/fig/); optional
#
# Credentials come from the normal AWS CLI chain (AWS_PROFILE, env vars, SSO).
# Nothing secret is read from or written to this script.
#
# Environment:
#   FIGMA_BV_KMS_KEY_ID          encrypt with this KMS key (SSE-KMS) instead of SSE-S3 (AES256)
#   FIGMA_BV_SKIP_PUBLIC_CHECK=1 upload even when the bucket's public access block
#                                cannot be confirmed (e.g. no s3:GetBucketPublicAccessBlock permission)

set -euo pipefail

usage() {
	sed -n '10,19p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
}

DRY_RUN=()
if [ "${1:-}" = "--dry-run" ]; then
	DRY_RUN=(--dryrun)
	shift
fi
[ $# -ge 2 ] && [ $# -le 3 ] || usage

DEST="${1%/}"
FIGMA_DIR="${2%/}"
RENDERS_DIR="${3:-}"
RENDERS_DIR="${RENDERS_DIR%/}"

case "$DEST" in
s3://?*/?*) ;;
*)
	echo "error: destination must be s3://<bucket>/<prefix> (a prefix is required, never the bucket root)" >&2
	exit 2
	;;
esac
BUCKET="${DEST#s3://}"
BUCKET="${BUCKET%%/*}"

command -v aws >/dev/null 2>&1 || {
	echo "error: the aws CLI is not installed" >&2
	exit 1
}

# The tier-1 runner needs these three; refuse an upload that would leave CI red.
for f in page1.xml courses.tsx paths.tsx; do
	[ -s "$FIGMA_DIR/$f" ] || {
		echo "error: $FIGMA_DIR/$f is missing or empty (the tier-1 eval needs it)" >&2
		exit 1
	}
done
for f in coming_soon.tsx megamenu.notes.md assets; do
	[ -e "$FIGMA_DIR/$f" ] || echo "warning: $FIGMA_DIR/$f not found (tier 2 uses it)" >&2
done
if [ -n "$RENDERS_DIR" ]; then
	[ -d "$RENDERS_DIR" ] || {
		echo "error: renders dir $RENDERS_DIR does not exist" >&2
		exit 1
	}
	ls "$RENDERS_DIR"/*.png >/dev/null 2>&1 || {
		echo "error: no .png renders in $RENDERS_DIR" >&2
		exit 1
	}
fi

# Client files must never land in a bucket that can be made public.
if [ "${FIGMA_BV_SKIP_PUBLIC_CHECK:-}" != "1" ]; then
	if ! PAB="$(aws s3api get-public-access-block --bucket "$BUCKET" \
		--query 'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]' \
		--output text 2>/dev/null)"; then
		echo "error: could not read the public access block of s3://$BUCKET." >&2
		echo "       Turn on 'Block all public access' for the bucket, or set FIGMA_BV_SKIP_PUBLIC_CHECK=1" >&2
		echo "       if you have confirmed it some other way." >&2
		exit 1
	fi
	case "$PAB" in
	*False* | *false* | *None*)
		echo "error: s3://$BUCKET does not block all public access ($PAB); refusing to upload client files." >&2
		exit 1
		;;
	esac
fi

if [ -n "${FIGMA_BV_KMS_KEY_ID:-}" ]; then
	SSE=(--sse aws:kms --sse-kms-key-id "$FIGMA_BV_KMS_KEY_ID")
else
	SSE=(--sse AES256)
fi
# Every object private and encrypted at rest. A bucket with ACLs disabled
# (Object Ownership = BucketOwnerEnforced, the S3 default) is private by
# construction and rejects ACL headers, so --acl is only sent to older buckets.
OWNERSHIP="$(aws s3api get-bucket-ownership-controls --bucket "$BUCKET" \
	--query 'OwnershipControls.Rules[0].ObjectOwnership' --output text 2>/dev/null || true)"
if [ "$OWNERSHIP" = "BucketOwnerEnforced" ]; then
	ACL=()
else
	ACL=(--acl private)
fi
COMMON=(${ACL[@]+"${ACL[@]}"} "${SSE[@]}" --only-show-errors ${DRY_RUN[@]+"${DRY_RUN[@]}"})
# OS and editor junk stays local. The aws CLI applies the LAST matching
# filter, so these must come after any --include (else ._c0-5.png matches
# --include "*.png" and is uploaded).
JUNK=(--exclude ".DS_Store" --exclude "*/.DS_Store" --exclude "._*" --exclude "*/._*")

echo "Uploading $FIGMA_DIR -> $DEST/"
aws s3 sync "$FIGMA_DIR" "$DEST/" "${COMMON[@]}" "${JUNK[@]}"
if [ -n "$RENDERS_DIR" ]; then
	echo "Uploading $RENDERS_DIR/*.png -> $DEST/fig/"
	aws s3 sync "$RENDERS_DIR" "$DEST/fig/" "${COMMON[@]}" --exclude "*" --include "*.png" "${JUNK[@]}"
fi

if [ ${#DRY_RUN[@]} -eq 0 ]; then
	echo "Uploaded. Objects under $DEST/:"
	aws s3 ls "$DEST/" --recursive --summarize | tail -2
	echo "To run the eval in CI, set the ENVIRONMENT secret FIGMA_BV_S3_URI=$DEST in the"
	echo "figma-bv-eval GitHub environment (Settings > Environments; not a repository secret,"
	echo "the repo is at the 100-secret limit), plus FIGMA_BV_AWS_ACCESS_KEY / FIGMA_BV_AWS_SECRET_KEY"
	echo "for a read-only key (s3:GetObject on $DEST/*)."
fi
