#!/usr/bin/env python3
"""Load official SYLLABUS documents as free platform libraries.

Where no free textbook exists — ICSE/ISC (CISCE publishes no books), and the
competitive exams (JEE, NEET, CUET, CAT, UPSC…) — the board's own syllabus PDF
is public. Ingested as a knowledge base and stamped
`meta.curriculum.kind = "SYLLABUS"`, it drives the same paper wizard as a
textbook: the syllabus fixes the scope, the model supplies the content (see
paper.syllabus_scope). The listing lands in the Library under the board or
exam so the picker finds it beside the NCERT books.

    python3 load_syllabus.py --base-url http://localhost:8077/ai-service \\
        --internal-token "$TOKEN" [--manifest syllabus_manifest.json] \\
        [--only jee-main-physics …] [--dry-run] [--no-publish]

Manifest entries (see syllabus_manifest.json):

    {"key": "jee-main-physics", "exam": "JEE_MAIN", "subject": "Physics",
     "session": "2026", "medium": "English",
     "sources": [{"title": "Physics", "url": "https://…/syllabus.pdf", "pages": "3-6"}]}
    {"key": "icse-10-physics", "board": "ICSE", "class": "10", "subject": "Physics",
     "sources": [{"title": "Physics", "path": "downloads/icse-10-physics.pdf"}]}

A source with `pages` or `path` has to be uploaded (the server only fetches
public URLs): set S3_AWS_ACCESS_KEY / S3_AWS_ACCESS_SECRET / S3_AWS_REGION /
AWS_BUCKET_NAME (and optionally S3_CDN_BASE_URL) — the same variables the
ai-service pod has — and the slice goes to the public bucket under
curriculum/syllabus/. A plain `url` source is passed through untouched.

Idempotent: keyed on the knowledge base name; re-running adds only what is
missing and never publishes a base with a failed source.
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_ncert import (  # noqa: E402
    EMBEDDING_MODEL, LANGUAGE_HINT, Api, OutOfCredits, reindex_source, wait_for_source,
)

log = logging.getLogger("load_syllabus")

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "syllabus_manifest.json"

# Must match ai_service/app/services/kb/taxonomy.py — the listing's `board`
# column is the taxonomy key, and `level` for an exam is "UG".
EXAM_NAMES = {
    "CUET": "CUET (UG)", "JEE_MAIN": "JEE Main", "JEE_ADVANCED": "JEE Advanced",
    "NEET": "NEET (UG)", "CAT": "CAT", "UPSC": "UPSC CSE", "CLAT": "CLAT",
    "NDA": "NDA", "SSC": "SSC (CGL / CHSL)",
}
BOARD_NAMES = {"ICSE": "ICSE / ISC", "CBSE": "CBSE", "NCERT": "NCERT"}
EXAM_LEVEL = "UG"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


# ---------------------------------------------------------------------------
# Manifest → plan
# ---------------------------------------------------------------------------

class Entry:
    def __init__(self, raw: Dict[str, Any]):
        self.key: str = raw["key"]
        self.exam: Optional[str] = raw.get("exam")
        self.board: Optional[str] = raw.get("board")
        if bool(self.exam) == bool(self.board):
            raise ValueError(f"{self.key}: give exactly one of exam / board")
        self.cls: Optional[str] = str(raw["class"]) if raw.get("class") else None
        self.subject: str = raw["subject"]
        self.session: str = str(raw.get("session") or "")
        self.medium: str = raw.get("medium") or "English"
        self.title: Optional[str] = raw.get("title")
        self.sources: List[Dict[str, Any]] = raw["sources"]
        if not self.sources:
            raise ValueError(f"{self.key}: no sources")

    # -- naming ---------------------------------------------------------------
    @property
    def authority(self) -> str:
        """Human name: "JEE Main" / "ICSE / ISC"."""
        if self.exam:
            return EXAM_NAMES.get(self.exam, self.exam)
        return BOARD_NAMES.get(self.board or "", self.board or "")

    @property
    def listing_board(self) -> str:
        return self.exam or self.board or ""

    @property
    def level(self) -> str:
        return self.cls or EXAM_LEVEL

    @property
    def scope(self) -> str:
        cls = f" Class {self.cls}" if self.cls else ""
        return f"{self.authority}{cls} {self.subject}"

    @property
    def kb_name(self) -> str:
        return f"{self.scope} — Syllabus"

    @property
    def listing_title(self) -> str:
        return self.title or (f"{self.scope} syllabus" + (f" ({self.session})" if self.session else ""))

    def meta(self, urls: List[str]) -> Dict[str, Any]:
        cur: Dict[str, Any] = {
            "kind": "SYLLABUS",
            "board": self.listing_board, "class": self.level, "subject": self.subject,
            "medium": self.medium, "session": self.session, "source_urls": urls,
        }
        if self.exam:
            cur["exam"] = self.authority
        return {"topic_tree_mode": "AUTHORED", "curriculum": cur}


def _parse_pages(spec: str) -> List[int]:
    """"3-6" / "1,2,5-7" → zero-based page indexes."""
    out: List[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            out.extend(range(int(lo) - 1, int(hi)))
        elif part:
            out.append(int(part) - 1)
    return out


# ---------------------------------------------------------------------------
# Bytes → public URL
# ---------------------------------------------------------------------------

async def _download(url: str) -> bytes:
    async with httpx.AsyncClient(headers={"User-Agent": UA}, timeout=120.0, follow_redirects=True) as c:
        r = await c.get(url)
        r.raise_for_status()
        if not r.content.startswith(b"%PDF"):
            raise RuntimeError(f"{url} is not a PDF (got {r.headers.get('content-type')})")
        return r.content


def _slice(pdf: bytes, pages: List[int]) -> bytes:
    import pymupdf  # local dependency of the ai_service venv

    src = pymupdf.open(stream=pdf, filetype="pdf")
    out = pymupdf.open()
    for i in pages:
        out.insert_pdf(src, from_page=i, to_page=i)
    buf = io.BytesIO()
    out.save(buf)
    return buf.getvalue()


def _publish_bytes(data: bytes, key: str) -> str:
    """Put a PDF where the server can fetch it and return its URL.

    Production: the public S3 bucket, same env as the pod. A local stack has
    no bucket: set SYLLABUS_PUBLISH_DIR + SYLLABUS_PUBLISH_BASE_URL and serve
    the directory (`python3 -m http.server 8099`) — the server downloads from
    http://localhost:8099/… exactly as it would from S3."""
    local_dir = os.getenv("SYLLABUS_PUBLISH_DIR")
    if local_dir:
        target = Path(local_dir) / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return f"{os.getenv('SYLLABUS_PUBLISH_BASE_URL', 'http://localhost:8099').rstrip('/')}/{key}"

    import boto3  # noqa: WPS433 — only needed for sliced / local sources

    access = os.getenv("S3_AWS_ACCESS_KEY") or os.getenv("AWS_ACCESS_KEY")
    secret = os.getenv("S3_AWS_ACCESS_SECRET") or os.getenv("AWS_SECRET_KEY")
    region = os.getenv("S3_AWS_REGION") or os.getenv("AWS_REGION") or "ap-south-1"
    bucket = os.getenv("AWS_BUCKET_NAME") or os.getenv("AWS_S3_PUBLIC_BUCKET")
    if not (access and secret and bucket):
        raise SystemExit(
            "This source must be uploaded (it has `pages` or `path`); set S3_AWS_ACCESS_KEY, "
            "S3_AWS_ACCESS_SECRET, AWS_BUCKET_NAME (kubectl exec <ai-service pod> -- printenv)."
        )
    s3 = boto3.client("s3", aws_access_key_id=access, aws_secret_access_key=secret, region_name=region)
    s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType="application/pdf")
    cdn = (os.getenv("S3_CDN_BASE_URL") or "").rstrip("/")
    return f"{cdn}/{key}" if cdn else f"https://{bucket}.s3.{region}.amazonaws.com/{key}"


async def resolve_source_url(entry: Entry, src: Dict[str, Any], *, dry_run: bool) -> str:
    """A public URL the server can fetch, uploading a slice or a local file if needed."""
    pages = _parse_pages(src["pages"]) if src.get("pages") else None
    if src.get("url") and not pages:
        return src["url"]
    if dry_run:
        return f"<would upload {src.get('path') or src.get('url')} pages={src.get('pages') or 'all'}>"
    if src.get("path"):
        data = Path(src["path"]).expanduser().read_bytes()
    else:
        data = await _download(src["url"])
    if pages:
        data = _slice(data, pages)
    name = f"{entry.key}-{src.get('title', 'syllabus').lower().replace(' ', '-')}.pdf"
    return _publish_bytes(data, f"curriculum/syllabus/{entry.key}/{name}")


# ---------------------------------------------------------------------------
# Loading one entry
# ---------------------------------------------------------------------------

async def load_entry(api: Api, entry: Entry, *, dry_run: bool, publish: bool) -> Dict[str, Any]:
    summary = {"kb": entry.kb_name, "added": 0, "skipped": 0, "failed": 0,
               "sources": len(entry.sources), "published": False}
    log.info("== %s (%d source(s))", entry.kb_name, len(entry.sources))

    urls: List[str] = []
    for src in entry.sources:
        urls.append(await resolve_source_url(entry, src, dry_run=dry_run))
    if dry_run:
        for src, url in zip(entry.sources, urls):
            log.info("   would add '%s' ← %s", src.get("title") or entry.subject, url)
        return summary

    existing = {kb["name"]: kb for kb in await api.list_kbs() if kb["institute_id"] == api.institute_id}
    kb = existing.get(entry.kb_name)
    if not kb:
        kb = await api.create_kb({
            "name": entry.kb_name,
            "description": f"Official {entry.scope} syllabus{f', {entry.session}' if entry.session else ''}. "
                           "Defines what is examinable; questions are set from the standard curriculum "
                           "within this scope.",
            "purpose": "teaching",
            "language_hint": LANGUAGE_HINT.get(entry.medium),
            "meta": entry.meta(urls),
            "embedding_model": EMBEDDING_MODEL,
        })
        log.info("   created knowledge base %s", kb["id"])
    kb_id = kb["id"]

    detail = await api.get_kb(kb_id)
    present = {s.get("title"): s for s in (detail.get("sources") or []) if s.get("status") != "ARCHIVED"}
    for src, url in zip(entry.sources, urls):
        title = src.get("title") or entry.subject
        row = present.get(title)
        if row and row["status"] in ("READY", "PARTIAL", "PROCESSING", "PENDING"):
            summary["skipped"] += 1
            continue
        if row and row["status"] == "FAILED":
            try:
                await reindex_source(api, row["id"])
                done = await wait_for_source(api, row["id"], ignore_stale="FAILED")
                if done["status"] == "FAILED":
                    summary["failed"] += 1
                    log.error("   '%s' still FAILED: %s", title, done.get("error_message"))
                else:
                    summary["added"] += 1
            except Exception as exc:  # noqa: BLE001
                summary["failed"] += 1
                log.error("   '%s' re-index error: %s", title, exc)
            continue
        body = {
            "source_kind": "PDF",
            "title": title,
            "source_url": url,
            "meta": {
                "chapter_title": title, "syllabus": True,
                "board": entry.listing_board, "class": entry.level, "subject": entry.subject,
                "session": entry.session,
            },
        }
        try:
            res = await api.add_source(kb_id, body)
        except Exception as exc:  # noqa: BLE001
            if isinstance(exc, RuntimeError) and "402" in str(exc):
                raise OutOfCredits(f"{entry.kb_name}: {exc}") from exc
            summary["failed"] += 1
            log.error("   '%s' error: %r", title, exc)
            continue
        try:
            row = res["source"]
            if res.get("deduplicated"):
                await api.patch_source(row["id"], {"meta": body["meta"]})
                summary["skipped"] += 1
                continue
            row = await wait_for_source(api, row["id"])
            if row["status"] == "FAILED":
                summary["failed"] += 1
                log.error("   '%s' FAILED: %s", title, row.get("error_message"))
            else:
                summary["added"] += 1
                log.info("   '%s' → %s  pages=%s chunks=%s", title, row["status"],
                         row["page_count"], row["chunk_count"])
        except Exception as exc:  # noqa: BLE001
            summary["failed"] += 1
            log.error("   '%s' error: %s", title, exc)

    try:
        await api.rebuild_topics(kb_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("   topic rebuild failed: %s", exc)

    try:
        await api.upsert_listing(kb_id, {
            "title": entry.listing_title,
            "summary": f"The official {entry.scope} syllabus{f' ({entry.session})' if entry.session else ''}: "
                       "every unit and topic that can be examined. Papers set from it follow the "
                       "syllabus exactly; questions are not page-cited from a textbook.",
            "description": "Syllabus document, not a textbook. " + "; ".join(u for u in urls if u.startswith("http")),
            "subject": entry.subject,
            "level": entry.level,
            "board": entry.listing_board,
            "language": entry.medium,
            "tags": ["syllabus", entry.listing_board.lower(), entry.subject.lower()]
                    + ([f"class-{entry.cls}"] if entry.cls else []),
            "collection": "CURRICULUM",
        })
    except Exception as exc:  # noqa: BLE001
        log.error("   listing upsert failed: %s", exc)
        summary["failed"] += 1
        return summary
    complete = summary["failed"] == 0 and (summary["added"] + summary["skipped"]) == len(entry.sources)
    if publish and complete:
        await api.publish(kb_id)
        summary["published"] = True
        log.info("   published")
    elif publish:
        log.warning("   NOT published: %d source(s) failed", summary["failed"])
    return summary


# ---------------------------------------------------------------------------

async def main_async(args: argparse.Namespace) -> int:
    entries = [Entry(e) for e in json.loads(Path(args.manifest).read_text())]
    if args.only:
        wanted = set(args.only)
        entries = [e for e in entries if e.key in wanted]
        missing = wanted - {e.key for e in entries}
        if missing:
            raise SystemExit(f"unknown manifest keys: {', '.join(sorted(missing))}")
    api = Api(args.base_url, jwt=args.jwt, internal_token=args.internal_token,
              institute_id=args.institute_id, client_id=args.client_id)
    results: List[Dict[str, Any]] = []
    try:
        for entry in entries:
            results.append(await load_entry(api, entry, dry_run=args.dry_run, publish=not args.no_publish))
    except OutOfCredits as exc:
        log.error("STOPPED: %s", exc)
        return 2
    finally:
        await api.http.aclose()
    for r in results:
        log.info("%-48s added=%d skipped=%d failed=%d %s", r["kb"], r["added"], r["skipped"], r["failed"],
                 "PUBLISHED" if r["published"] else "")
    return 1 if any(r["failed"] for r in results) else 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--jwt")
    ap.add_argument("--client-id")
    ap.add_argument("--internal-token")
    ap.add_argument("--institute-id", default="6b600940-2134-40ec-93ed-b61e403c5a87",
                    help="publisher institute (KB_PUBLISHER_INSTITUTE_ID)")
    ap.add_argument("--manifest", default=str(MANIFEST))
    ap.add_argument("--only", nargs="*", help="manifest keys to load")
    ap.add_argument("--no-publish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
