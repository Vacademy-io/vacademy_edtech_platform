"""Who wrote this copy? Read the name a student put at the top of the sheet.

A bulk upload of scanned copies arrives as files with no student attached.
Schools write the student's name, roll number and class on the first page
(sometimes the cover page, sometimes above the first answer), in pen or
pencil, in whatever hand the student has. The vision model that already
reads the copy for grading reads that header too - one downscaled image of
the first page (and the second, when the first carries no name), a strict
JSON reply, ~₹0.02 a copy.

The result is CANDIDATE data, never a decision: matching it against the
assessment's students - and deciding whether two "Aman Sharma"s are one - is
assessment_service's job, which knows the batches. This module only says
what is written and how sure it is.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import tempfile
from pathlib import Path
from typing import Any, Optional

from .mathpix_fallback import _download
from .vision_transcript import _encode_page

logger = logging.getLogger(__name__)

# The header lives near the top of the page. Reading the whole page costs
# more image tokens and invites the model to pick a name out of the answers
# ("Newton" is not the student). Only when the top strip carries nothing is
# the whole page tried.
HEADER_FRACTION = 0.42
RENDER_DPI = 110
PAGES_TO_TRY = 2

IDENTIFY_SYSTEM = """You read the identification header a student wrote by hand at the top of an exam answer sheet.

Return ONLY a JSON object of this exact shape:
{
  "student_name": "<the student's name exactly as written, or null>",
  "roll_number": "<roll no / registration no / admission no exactly as written, or null>",
  "class_section": "<class / grade / section exactly as written, or null>",
  "other_identifiers": ["<any other labelled identity value: school, subject, date, exam name>"],
  "confidence": <0.0-1.0 how sure you are that student_name is the student's own name>,
  "name_found": <true|false>
}

Rules:
- The name is usually next to a label like Name, Student, Candidate, Naam, नाम, or on the first ruled line, and is a PERSON's name.
- Do not invent a name. A subject ("Science"), a school, a teacher, a place, or a word from an answer is not the student's name: set student_name to null and name_found to false.
- Copy the spelling as written, even if it looks misspelt. Do not translate; transliterate Devanagari names to Latin letters only in a field named "student_name_latin" (add it) and keep the original in student_name.
- If two different names appear, put the one labelled as the student in student_name and the other in other_identifiers.
- confidence below 0.5 means you are guessing."""


def _render_header(pdf_path: Path, page_index: int, fraction: float) -> Optional[Any]:
    """PIL image of the top `fraction` of one page, or None past the last page."""
    import fitz  # PyMuPDF
    from PIL import Image

    doc = fitz.open(pdf_path)
    try:
        if page_index >= doc.page_count:
            return None
        page = doc[page_index]
        rect = page.rect
        clip = fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + rect.height * fraction)
        matrix = fitz.Matrix(RENDER_DPI / 72.0, RENDER_DPI / 72.0)
        pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
        if pix.n not in (1, 3):
            pix = fitz.Pixmap(fitz.csRGB, pix)
        mode = "L" if pix.n == 1 else "RGB"
        return Image.frombytes(mode, (pix.width, pix.height), pix.samples).convert("RGB")
    finally:
        doc.close()


def _page_count(pdf_path: Path) -> int:
    import fitz

    doc = fitz.open(pdf_path)
    try:
        return doc.page_count
    finally:
        doc.close()


def _parse(content: str) -> dict[str, Any]:
    content = (content or "").strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("identify returned no JSON object")
    data = json.loads(content[start : end + 1])
    if not isinstance(data, dict):
        raise RuntimeError("identify returned a non-object")
    return data


def _clean(value: Any) -> Optional[str]:
    """A header value as a trimmed string, or None for the model's ways of saying 'none'."""
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "n/a", "na", "not found", "not visible", "unknown", "-"}:
        return None
    return re.sub(r"\s+", " ", text)


def _confidence(value: Any) -> float:
    try:
        c = float(value)
    except (TypeError, ValueError):
        return 0.0
    if 1.0 < c <= 100.0:
        c /= 100.0
    return max(0.0, min(1.0, c))


async def _ask(llm: Any, model: str, image_b64: str, institute_id: Optional[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    messages = [
        {"role": "system", "content": IDENTIFY_SYSTEM},
        {
            "role": "user",
            "content": "This is the top of the first page of a scanned answer sheet. Read the student's identification header.",
            "attachments": [{"type": "image", "url": f"data:image/jpeg;base64,{image_b64}"}],
        },
    ]
    response = await llm.chat_completion(
        messages=messages,
        temperature=0.0,
        max_tokens=600,
        institute_id=institute_id,
        model=model,
    )
    return _parse(response.get("content") or ""), (response.get("usage") or {})


async def identify_student(
    pdf_url: str,
    llm: Any,
    model: str,
    institute_id: Optional[str] = None,
) -> dict[str, Any]:
    """Read the identification header of a copy.

    Returns {student_name, student_name_latin, roll_number, class_section,
    other_identifiers, confidence, name_found, page_count, pages_read,
    usage}. Never raises for a copy that simply has no name on it - that is
    a normal outcome (name_found False); it raises only when the file cannot
    be read at all.
    """
    result: dict[str, Any] = {
        "student_name": None,
        "student_name_latin": None,
        "roll_number": None,
        "class_section": None,
        "other_identifiers": [],
        "confidence": 0.0,
        "name_found": False,
        "page_count": 0,
        "pages_read": 0,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0},
    }
    with tempfile.TemporaryDirectory(prefix="copycheck-identify-") as tmp:
        pdf_path = Path(tmp) / "input.pdf"
        await _download(pdf_url, pdf_path)
        loop = asyncio.get_event_loop()
        result["page_count"] = await loop.run_in_executor(None, _page_count, pdf_path)
        if result["page_count"] == 0:
            raise RuntimeError("the file has no pages")

        # Header strip of page 1, then the whole of page 1, then page 2's
        # header: cover pages and "name on the back" happen, and a name that
        # sits lower than the strip must still be found before giving up.
        attempts = [(0, HEADER_FRACTION), (0, 1.0), (1, HEADER_FRACTION)][: 1 + PAGES_TO_TRY]
        best: dict[str, Any] = {}
        for page_index, fraction in attempts:
            img = await loop.run_in_executor(None, _render_header, pdf_path, page_index, fraction)
            if img is None:
                continue
            b64 = await loop.run_in_executor(None, _encode_page, img)
            data = None
            # The provider returns the odd 502 under load; one short retry
            # turned "no name found" back into the right name on a real copy.
            for attempt in range(2):
                try:
                    data, usage = await _ask(llm, model, b64, institute_id)
                    break
                except Exception as e:
                    logger.warning("identify: page %d (%.0f%%) attempt %d failed: %s",
                                   page_index + 1, fraction * 100, attempt + 1, e)
                    if attempt == 0:
                        await asyncio.sleep(1.5)
            if data is None:
                continue
            result["pages_read"] += 1
            result["usage"]["prompt_tokens"] += int(usage.get("prompt_tokens") or 0)
            result["usage"]["completion_tokens"] += int(usage.get("completion_tokens") or 0)
            name = _clean(data.get("student_name"))
            conf = _confidence(data.get("confidence")) if name else 0.0
            if name and conf > _confidence(best.get("confidence")):
                best = {
                    "student_name": name,
                    "student_name_latin": _clean(data.get("student_name_latin")),
                    "roll_number": _clean(data.get("roll_number")),
                    "class_section": _clean(data.get("class_section")),
                    "other_identifiers": [
                        _clean(x) for x in (data.get("other_identifiers") or []) if _clean(x)
                    ][:8],
                    "confidence": conf,
                    "name_found": True,
                }
            elif not best:
                # Keep the roll number / class even when the name is missing:
                # a roll number alone can identify the student.
                roll = _clean(data.get("roll_number"))
                if roll or _clean(data.get("class_section")):
                    result["roll_number"] = roll
                    result["class_section"] = _clean(data.get("class_section"))
            if best.get("confidence", 0.0) >= 0.75:
                break
        result.update(best)
    return result
