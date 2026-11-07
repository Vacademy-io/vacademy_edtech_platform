"""The language a paper is answered in (exam_context.answer_language).

The teacher picks it in the dashboard's "Check submitted copies" dialog; a
partner sends it with the exam. It decides three things:

  - which model READS the handwriting. The grading model reads Latin scripts
    and Chinese well, but not Indian scripts or Arabic script: on a printed
    test page (2026-10-29) it read Hindi 42%, Marathi 22%, Sanskrit 2%, Urdu
    46%, Telugu 21% of the characters right and made up the rest. The
    language-check model read the same pages 96%, 96%, 98%, 94%, 83%. Those
    languages are read with it.
  - which languages are refused: Punjabi (Gurmukhi) and Gujarati were not read
    by either model (4% and 72% on PRINTED text; handwriting is harder), so a
    copy declared in them fails as language_not_supported instead of being
    graded on a made-up transcript.
  - how its language is judged when errors are highlighted (language_feedback).

Not set = the behaviour from before this field existed.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Language:
    code: str
    name: str
    script: str             # latin | devanagari | arabic | bengali | tamil | telugu | han | gurmukhi | gujarati
    supported: bool = True
    rtl: bool = False


_ALL = (
    Language("en", "English", "latin"),
    Language("hi", "Hindi", "devanagari"),
    Language("sa", "Sanskrit", "devanagari"),
    Language("mr", "Marathi", "devanagari"),
    Language("ur", "Urdu", "arabic", rtl=True),
    Language("bn", "Bengali", "bengali"),
    Language("ta", "Tamil", "tamil"),
    Language("te", "Telugu", "telugu"),
    Language("fr", "French", "latin"),
    Language("es", "Spanish", "latin"),
    Language("de", "German", "latin"),
    Language("ar", "Arabic", "arabic", rtl=True),
    Language("zh", "Chinese", "han"),
    Language("pa", "Punjabi", "gurmukhi", supported=False),
    Language("gu", "Gujarati", "gujarati", supported=False),
)
LANGUAGES = {lang.code: lang for lang in _ALL}

_ALIASES = {
    "eng": "en", "hin": "hi", "san": "sa", "mar": "mr", "urd": "ur", "ben": "bn", "bangla": "bn",
    "tam": "ta", "tel": "te", "fra": "fr", "fre": "fr", "spa": "es", "deu": "de", "ger": "de",
    "ara": "ar", "zho": "zh", "chi": "zh", "mandarin": "zh", "pan": "pa", "guj": "gu",
}
for _lang in _ALL:
    _ALIASES[_lang.name.lower()] = _lang.code

# Scripts the grading model reads well; every other script is read with the
# language-check model.
_WELL_READ_SCRIPTS = frozenset(("latin", "han"))


def raw(exam_context: Any) -> str:
    ctx = exam_context if isinstance(exam_context, dict) else {}
    return str(ctx.get("answer_language") or "").strip()


def code_of(value: Any) -> str:
    """"hi", "Hindi", "HIN" -> "hi"; "" for blank or a language not listed."""
    text = str(value or "").strip().lower().replace("_", "-")
    if not text:
        return ""
    if text in LANGUAGES:
        return text
    if text in _ALIASES:
        return _ALIASES[text]
    head = text.split("-")[0]          # "hi-IN", "en-GB"
    return head if head in LANGUAGES else _ALIASES.get(head, "")


def of(exam_context: Any) -> str:
    return code_of(raw(exam_context))


def get(exam_context: Any) -> Language | None:
    return LANGUAGES.get(of(exam_context))


def name(value: Any) -> str:
    """Display name for a code ("sa" -> "Sanskrit"); the value itself when it
    is not a listed language."""
    lang = LANGUAGES.get(code_of(value))
    return lang.name if lang else str(value or "").strip()


def unsupported(exam_context: Any) -> Language | None:
    """The declared language when the copy check cannot read it."""
    lang = get(exam_context)
    return lang if lang is not None and not lang.supported else None


def needs_strong_reader(exam_context: Any) -> bool:
    lang = get(exam_context)
    return lang is not None and lang.supported and lang.script not in _WELL_READ_SCRIPTS


def reading_model(exam_context: Any, default: str) -> str:
    """The model that reads the handwriting of this paper."""
    if not needs_strong_reader(exam_context):
        return default
    from .language_vision import language_model
    return language_model() or default


def is_latin(text: Any) -> bool:
    """No letter of a script the copy check reads with the stronger model:
    Arabic/Urdu, the Indian scripts, CJK, Hangul. Latin, Greek and Cyrillic
    (symbols on an English copy) count as Latin, as they always did."""
    for ch in str(text or ""):
        cp = ord(ch)
        if (0x0600 <= cp <= 0x06FF or 0x0750 <= cp <= 0x077F or 0x0900 <= cp <= 0x0DFF
                or 0xA8E0 <= cp <= 0xA8FF or 0x3000 <= cp <= 0x9FFF or 0xAC00 <= cp <= 0xD7AF
                or 0xFB50 <= cp <= 0xFDFF or 0xFE70 <= cp <= 0xFEFF):
            if unicodedata.category(ch)[0] in "LM":
                return False
    return True


# ------------------------------------------------------------------ detection
# The teacher never states the language: the copy and the question paper say
# it. One look at a few pages, before the handwriting is read, so a Hindi or
# Sanskrit copy is read by the model that can read it.

DETECT_SYSTEM = """You look at pages of a student's handwritten answer copy and say which
language(s) the HANDWRITTEN answers are written in. Ignore everything printed (headers, forms,
the question paper, page numbers). Use the question paper text only to tell close languages apart
(Hindi / Sanskrit / Marathi share one script; Urdu / Arabic share another).

Return STRICT JSON only:
{"languages": [{"language": "<English name, e.g. Hindi>", "share": <0-1, share of the handwriting>}]}"""

# A language must cover at least this share of the handwriting to steer the
# reading; a copy is refused only when an unsupported language is most of it.
DETECT_MIN_SHARE = 0.15
REFUSE_MIN_SHARE = 0.5
DETECT_MAX_PAGES = 3


@dataclass(frozen=True)
class Detected:
    code: str            # the main language that is not English ("" = English / unknown)
    share: float
    unsupported: Language | None = None


def detection_enabled() -> bool:
    import os
    return os.getenv("COPY_CHECK_LANGUAGE_DETECT", "1").strip().lower() not in ("0", "false", "no", "off")


def sample_pages(page_ids: list[str], limit: int = DETECT_MAX_PAGES) -> list[str]:
    """First, middle and last page: a translation copy is English on its
    first pages and Hindi on its last."""
    if len(page_ids) <= limit:
        return list(page_ids)
    picks = [page_ids[0], page_ids[len(page_ids) // 2], page_ids[-1]]
    return list(dict.fromkeys(picks))[:limit]


def parse_detection(content: str) -> Detected:
    import json
    import re

    text = (content or "").strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        data = json.loads(m.group(0)) if m else {}
    except ValueError:
        data = {}
    shares: dict[str, float] = {}
    for item in (data.get("languages") if isinstance(data, dict) else None) or []:
        if not isinstance(item, dict):
            continue
        code = code_of(item.get("language"))
        try:
            share = float(item.get("share"))
        except (TypeError, ValueError):
            share = 0.0
        if code:
            shares[code] = shares.get(code, 0.0) + max(0.0, min(1.0, share))
    others = sorted(((s, c) for c, s in shares.items() if c != "en"), reverse=True)
    if not others or others[0][0] < DETECT_MIN_SHARE:
        return Detected("", 0.0)
    share, code = others[0]
    lang = LANGUAGES[code]
    if not lang.supported:
        if share >= REFUSE_MIN_SHARE:
            return Detected(code, share, unsupported=lang)
        # A little of an unreadable language: read the rest as before.
        supported = [(s, c) for s, c in others if LANGUAGES[c].supported and s >= DETECT_MIN_SHARE]
        if not supported:
            return Detected("", 0.0)
        share, code = supported[0]
    return Detected(code, share)


async def sample_images(pdf_url: str, page_ids: list[str], dpi: int = 90) -> dict[str, Any]:
    """Only the sampled pages, small: detection must not hold a long copy's
    every page in memory (the language pass renders them later if it runs)."""
    import asyncio
    import tempfile
    from pathlib import Path
    from .mathpix_fallback import _download

    picks = sample_pages(page_ids)
    index = {pid: i for i, pid in enumerate(page_ids)}

    def render(path: Path) -> dict[str, Any]:
        import fitz
        from PIL import Image
        out = {}
        with fitz.open(str(path)) as doc:
            for pid in picks:
                i = index.get(pid)
                if i is None or i >= doc.page_count:
                    continue
                pix = doc[i].get_pixmap(dpi=dpi)
                out[pid] = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        return out

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "copy.pdf"
        await _download(pdf_url, path)
        return await asyncio.get_running_loop().run_in_executor(None, render, path)


async def detect(llm: Any, model: str, images: dict[str, Any] | None, page_ids: list[str],
                 paper_text: str = "", institute_id: Any = None, token_sink: Any = None) -> Detected:
    """The copy's main non-English language from a look at a few pages. Never
    raises: anything going wrong is Detected("") - the copy is read as before."""
    import logging
    from .language_vision import _encode

    log = logging.getLogger(__name__)
    try:
        picks = [p for p in sample_pages(page_ids) if images and images.get(p) is not None]
        if not picks:
            return Detected("", 0.0)
        attachments = [{"type": "image", "url": f"data:image/jpeg;base64,{_encode(images[p])}"} for p in picks]
        prompt = "Pages of the answer copy are attached."
        if paper_text:
            prompt += "\n\nQuestion paper (printed, for reference):\n" + paper_text[:1500]
        response = await llm.chat_completion(
            messages=[{"role": "system", "content": DETECT_SYSTEM},
                      {"role": "user", "content": prompt, "attachments": attachments}],
            temperature=0.0, max_tokens=300, institute_id=institute_id, model=model,
        )
        if token_sink is not None:
            try:
                token_sink.add_usage(response.get("usage"))
            except Exception:
                pass
        found = parse_detection(response.get("content") or "")
        log.info("Answer language detected: %s (%.0f%% of the handwriting)%s", found.code or "en/unknown",
                 found.share * 100, " - unsupported" if found.unsupported else "")
        return found
    except Exception:
        log.warning("Answer language detection failed; reading the copy as before", exc_info=True)
        return Detected("", 0.0)


def with_detected(exam_context: Any, detected: Detected) -> Any:
    """The exam_context the reading and language steps use: the declared
    language wins; else the detected one; else the context unchanged."""
    if of(exam_context) or not detected.code:
        return exam_context
    ctx = dict(exam_context) if isinstance(exam_context, dict) else {}
    ctx["answer_language"] = detected.code
    return ctx
