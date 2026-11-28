"""Branding for a printed paper, and publishing it to a link anyone can open.

Two things a teacher does with a finished paper beyond downloading it:

  * print it under the institute's own name and logo — a paper handed to
    parents or a partner school is a piece of the institute's identity, not
    a generic sheet;
  * send it on. A WhatsApp message with a short link beats attaching a PDF
    to every chat, and it lets one link serve the whole staff room.

`institute_branding()` reads the institute row (name, logo, contact line) —
the logo file id is resolved through media_service, and a failure there just
means a paper without a logo, never a failed download.

`publish_paper()` renders the PDF, drops it in the PUBLIC media bucket under
an unguessable key, asks media_service for a short link (u.vacademy.io/s/…,
or the institute's own short-link domain) and remembers the result on the
generation so history can offer "Copy link" instead of publishing again.
Anyone holding the link can download: that is the point, and why the
answer-key variant is a separate link the UI labels as such.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Sequence

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...config import get_settings
from ..internal_auth import internal_auth_headers
from ..media_file_client import get_public_file_url
from . import generations as kb_generations
from . import paper_pdf
from .paper import Blueprint

logger = logging.getLogger(__name__)

VARIANT_QUESTION_PAPER = "question_paper"
VARIANT_WITH_KEY = "with_answer_key"

# Same alphabet and length as media_service's ShortCodeGenerator (RFC 4648
# base32, no ambiguous glyphs) so links look like every other Vacademy link.
_SHORT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
_SHORT_LENGTH = 8
_SHORT_LINK_SOURCE = "KB_PAPER"


@dataclass
class Branding:
    name: Optional[str] = None
    logo_url: Optional[str] = None
    contact: Optional[str] = None
    theme_code: Optional[str] = None


def variant_for(include_answer_key: bool) -> str:
    return VARIANT_WITH_KEY if include_answer_key else VARIANT_QUESTION_PAPER


async def institute_branding(db: Session, institute_id: str) -> Branding:
    """Name, logo URL and a 'website · email · phone' line for the header."""
    row = db.execute(
        text(
            "SELECT name, logo_file_id, website_url, email, mobile_number, institute_theme_code "
            "FROM institutes WHERE id = :id"
        ),
        {"id": institute_id},
    ).fetchone()
    if not row:
        return Branding()
    name, logo_file_id, website, email, phone, theme_code = row
    contact = " · ".join(
        str(v).strip() for v in (website, email, phone) if v and str(v).strip()
    ) or None
    logo_url: Optional[str] = None
    if logo_file_id:
        try:
            logo_url = await get_public_file_url(str(logo_file_id), expiry_days=1)
        except Exception:  # noqa: BLE001 — a paper without a logo beats no paper
            logger.warning("Could not resolve logo %s for institute %s", logo_file_id, institute_id)
    return Branding(
        name=(name or "").strip() or None, logo_url=logo_url, contact=contact,
        theme_code=(theme_code or "").strip() or None,
    )


def paper_subtitle(kb: Dict[str, Any]) -> Optional[str]:
    """'Class 10 · Science · NCERT' for a curriculum library; nothing otherwise."""
    curriculum = kb.get("curriculum") or {}
    if not curriculum:
        return None
    bits = []
    if curriculum.get("class"):
        cls = str(curriculum["class"])
        bits.append(f"Class {cls}" if cls.isdigit() else cls)
    if curriculum.get("subject"):
        bits.append(str(curriculum["subject"]))
    if curriculum.get("board"):
        bits.append(str(curriculum["board"]))
    return " · ".join(bits) or None


async def render_branded_pdf(
    db: Session,
    kb: Dict[str, Any],
    institute_id: str,
    blueprint: Blueprint,
    questions: Sequence[Dict[str, Any]],
    *,
    include_answer_key: bool,
    show_marks: bool,
    institute_name: Optional[str] = None,
    set_label: Optional[str] = None,
    logo_placement: str = "watermark",
    candidate_line: bool = False,
    theme: str = "classic",
    exam_date: Optional[str] = None,
    grade_line: Optional[str] = None,
) -> bytes:
    branding = await institute_branding(db, institute_id)
    curriculum = kb.get("curriculum") or {}
    if not grade_line and curriculum.get("class"):
        cls = str(curriculum["class"])
        grade_line = f"Class - {cls}th" if cls.isdigit() else cls
    return await paper_pdf.render_paper_pdf(
        blueprint,
        questions,
        institute_name=(institute_name or "").strip() or branding.name,
        logo_url=branding.logo_url,
        contact_line=branding.contact,
        subtitle=paper_subtitle(kb),
        include_answer_key=include_answer_key,
        show_marks=show_marks,
        set_label=(set_label or "").strip() or None,
        logo_placement=logo_placement,
        candidate_line=candidate_line,
        theme=theme,
        exam_date=(exam_date or "").strip() or None,
        grade_line=(grade_line or "").strip() or None,
        accent_color=branding.theme_code,
    )


# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------

def _upload_public(pdf: bytes, key: str) -> str:
    from ..s3_service import S3Service  # boto3 client; import only when publishing

    return S3Service().upload_file_content(
        pdf, key.rsplit("/", 1)[-1], s3_key=key, content_type="application/pdf"
    )


async def _short_link(destination_url: str, *, source_id: str, institute_id: str) -> Optional[str]:
    """A u.vacademy.io/s/… link for the PDF, or None if media_service says no.

    Retries once on a short-code collision (8 base32 characters — practically
    never), and gives up quietly on anything else: the long URL still works.
    """
    base = get_settings().media_server_base_url.rstrip("/")
    for _attempt in range(2):
        code = "".join(secrets.choice(_SHORT_ALPHABET) for _ in range(_SHORT_LENGTH))
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    f"{base}/media-service/internal/v1/short-link/create",
                    json={
                        "shortCode": code,
                        "destinationUrl": destination_url,
                        "source": _SHORT_LINK_SOURCE,
                        "sourceId": source_id,
                        "instituteId": institute_id,
                    },
                    headers=await internal_auth_headers(),
                )
            if resp.status_code == 200:
                absolute = (resp.json() or {}).get("absoluteUrl")
                if absolute:
                    return str(absolute)
                return None
            if "already exists" in resp.text:
                continue
            logger.warning("short-link create returned %s: %s", resp.status_code, resp.text[:200])
            return None
        except Exception:  # noqa: BLE001
            logger.warning("short-link create failed for %s", source_id, exc_info=True)
            return None
    return None


async def publish_paper(
    db: Session,
    kb: Dict[str, Any],
    institute_id: str,
    blueprint: Blueprint,
    questions: Sequence[Dict[str, Any]],
    *,
    include_answer_key: bool,
    show_marks: bool = True,
    set_label: Optional[str] = None,
    generation_id: Optional[str] = None,
    theme: str = "classic",
    exam_date: Optional[str] = None,
    grade_line: Optional[str] = None,
) -> Dict[str, Any]:
    """Render, upload, shorten, remember. Returns the link record."""
    pdf = await render_branded_pdf(
        db, kb, institute_id, blueprint, questions,
        include_answer_key=include_answer_key, show_marks=show_marks, set_label=set_label,
        theme=theme, exam_date=exam_date, grade_line=grade_line,
    )
    variant = variant_for(include_answer_key)
    filename = paper_pdf.paper_filename(blueprint.title, with_key=include_answer_key)
    # Unguessable path: the bucket is public, the key is the secret.
    key = f"kb-papers/{institute_id}/{generation_id or 'adhoc'}/{secrets.token_urlsafe(18)}/{filename}"
    file_url = await asyncio.to_thread(_upload_public, pdf, key)
    short_url = await _short_link(
        file_url,
        source_id=f"{generation_id or secrets.token_hex(8)}:{variant}",
        institute_id=institute_id,
    )
    link = {
        "variant": variant,
        "theme": theme,
        "title": blueprint.title,
        "file_url": file_url,
        "short_url": short_url,
        "url": short_url or file_url,
        "size_bytes": len(pdf),
        "published_at": datetime.now(timezone.utc).isoformat(),
    }
    if generation_id:
        kb_generations.record_published_link(db, generation_id, institute_id, variant, link)
    return link
