"""One-off: copy the built-in background-music tracks (app/services/music_library.py)
from the Internet Archive into our public bucket, so videos stream them from S3.

Run from the ai_service directory with the app's S3 env configured (or inside an
ai-service pod):

    python scripts/upload_music_library.py            # upload what is missing
    python scripts/upload_music_library.py --dry-run  # list what it would do

Idempotent: a track already in the bucket at the same size is skipped. Until it
has run, the pipeline plays the archive.org originals (music_library.playable_url).
"""
from __future__ import annotations

import os
import sys
import urllib.request

# Make the `app` package importable when run as a plain script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.music_library import S3_BUCKET, TRACKS  # noqa: E402


def main(dry_run: bool = False) -> int:
    from app.services.s3_service import S3Service

    s3 = S3Service().s3_client
    failed = 0
    for track in TRACKS.values():
        try:
            with urllib.request.urlopen(track.source_url, timeout=120) as resp:  # noqa: S310 — fixed public host
                data = resp.read()
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL download {track.id}: {exc}")
            failed += 1
            continue
        if len(data) < 100_000:
            print(f"FAIL {track.id}: download is only {len(data)} bytes")
            failed += 1
            continue
        try:
            head = s3.head_object(Bucket=S3_BUCKET, Key=track.s3_key)
            if int(head.get("ContentLength", -1)) == len(data):
                print(f"skip {track.id}: already in s3://{S3_BUCKET}/{track.s3_key}")
                continue
        except Exception:  # noqa: BLE001 — not there yet
            pass
        if dry_run:
            print(f"would upload {track.id} ({len(data)} bytes) → {track.url}")
            continue
        s3.put_object(Bucket=S3_BUCKET, Key=track.s3_key, Body=data, ContentType="audio/mpeg",
                      CacheControl="public, max-age=31536000, immutable")
        print(f"uploaded {track.id} ({len(data)} bytes) → {track.url}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(dry_run="--dry-run" in sys.argv))
