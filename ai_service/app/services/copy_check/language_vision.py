"""Language errors found by looking at the handwriting, not at the transcript.

The text-only pass (language_feedback.find_errors) checks the transcript rows,
and the transcript is the reader's best guess at what the student MEANT: on a
4-page essay checked 2026-10-28 the reader had already turned "Narsimha" into
"Narasimha", "Sigh" into "Singh" and "democratic" into "dramatic", so the
language pass found 4 of the ~20 slips a teacher marked. A model shown the ink
itself finds them. Probe on that essay's page 2 (8 real slips):

  text-only over the transcript ................ 1 found
  vision, one call per band .................... 3-8 found, plus misreadings
  vision spot + verify + confusable filter ..... most found, misreadings mostly gone

So, per page, three overlapping bands (a full page read in one go comes back
partly invented) and per band:
  1. spot   - mark every error as the ink shows it, classified into the
              paper's deduction scheme when it has one;
  2. verify - the same model re-reads each quoted word letter by letter and
              keeps only the marks the ink bears out;
  3. filter - corrections a handwriting misreading explains (J/f, u/n, a
              hyphen-split word's second half) are dropped without a call.
Kept errors are tied to a transcript row (fuzzy, since the row may hold the
reader's corrected spelling) so the renderer places them as before; an error
no row carries stays in the feedback only.

GLM only: the model is the 'language_check' use case with no failover chain.
Returns None when the pages cannot be had, so the caller falls back to the
text-only pass.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import tempfile
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable, Optional

from . import answer_language, deduction_scheme as ds

logger = logging.getLogger(__name__)

HARD_FALLBACK_MODEL = "z-ai/glm-5.3-flashx"
# (top, bottom) of each band as a share of the page height. Overlapping, so a
# line cut by one band is whole in the next; two views of every line, because
# one look finds a different half of the slips each time (probe: the three
# thirds alone found 4 of a page's 8, the halves another 3).
BANDS = ((0.0, 0.40), (0.30, 0.70), (0.60, 1.0), (0.0, 0.55), (0.45, 1.0))
_CONCURRENCY = 4
_MAX_EDGE = 1800          # px, long edge of a band image
MAX_ERRORS_PER_BAND = 25
# A transcript row must read at least this much like the quoted words.
_ROW_MATCH = 0.72
# Hindi handwriting is misread far more often (probe 2026-10-28: two runs on
# the same 4 Hindi pages disagreed on a third of their marks, and a "wrong
# translation" was a misreading of a correct sentence). A Hindi mark is kept
# only when the transcript - a second, independent reading of the page - read
# the same words there.
_ROW_MATCH_STRICT = 0.85


def enabled() -> bool:
    """COPY_CHECK_LANGUAGE_VISION=0 turns the vision pass off (text-only pass)."""
    return os.getenv("COPY_CHECK_LANGUAGE_VISION", "1").strip().lower() not in ("0", "false", "off", "no")


def language_model() -> str:
    """The 'language_check' use-case model (super-admin portal), or the GLM
    hard fallback."""
    try:
        from ..model_selection import resolve_model_sync
        primary, _fallbacks = resolve_model_sync("language_check", hard_fallback=HARD_FALLBACK_MODEL)
        return primary or HARD_FALLBACK_MODEL
    except Exception:
        return HARD_FALLBACK_MODEL


# ----------------------------------------------------------------- prompts

SPOT_ENGLISH = """You are a strict examiner marking a student's handwritten answer, red pen in hand.
Look at the handwriting itself, word by word, letter by letter. Your reading must NOT fix the
student's mistakes: report the letters actually on the page, even when the intended word is obvious.

Mark EVERY language error a strict examiner would mark:
- spelling, including misspelt names of real people, places, schemes and acts;
- a wrong word that does not fit the sentence (a similar-looking word used for the right one);
- grammar: articles (a/an/the missing or wrong, e.g. before an institution's name), singular/plural,
  verb form and tense, prepositions, subject-verb agreement;
- punctuation: missing capital at a sentence start, a compound adjective that needs a hyphen;
- an incomplete or broken sentence.
Go through it line by line and check, on every line: each name and long word letter by letter;
each noun phrase for a missing or wrong article; each sentence start for a capital; each verb.
Do NOT mark: words the student has struck out, content or facts, British/Indian spellings, style
choices, printed text (headings, instructions, the question)."""

SPOT_HINDI = """You are a strict examiner of Hindi and English marking a student's handwritten answer.
Look at the handwriting itself, word by word. Report what the ink shows; do not fix the student's
mistakes while reading. Rows in Devanagari are judged as standard Hindi, rows in English as English.

Mark only errors you are SURE of from clearly written letters:
- Hindi: लिंग / वचन agreement, कारक (ने, को, से, में, पर), verb tense and agreement, a clearly
  wrong or missing word, a sentence that does not make sense;
- English: spelling, grammar, articles, prepositions, punctuation, broken sentences.
Hindi handwriting is easy to misread: do NOT mark a मात्रा, nukta, anusvara or conjunct you are
not certain of, accepted spelling variants, names, or words the student struck out."""

# Any other declared language. Sanskrit and Marathi are written in Devanagari
# but judged in their own grammar, never as Hindi.
SPOT_GENERIC = """You are a strict examiner of {language} marking a student's handwritten answer.
Look at the handwriting itself, word by word. Report what the ink shows; do not fix the student's
mistakes while reading. Text in {language} is judged as standard {language}, text in English as English.

Mark only errors you are SURE of from clearly written letters: spelling, agreement (gender, number,
person), case endings and postpositions, verb form and tense, articles, a clearly wrong or missing
word, a sentence that does not make sense.
Handwriting is easy to misread: do NOT mark a letter, vowel sign or diacritic you are not certain of,
accepted spelling variants, names, or words the student struck out. `why` is written in English."""

SPOT_FORMAT = """
For each error give:
- wrong: the student's words exactly as the ink shows them (1-8 words, enough to find the spot);
- correct: what should be written instead (for a whole wrong sentence: the correct sentence);
- kind: spelling | grammar | punctuation | word | article | repetition | omission | sentence;
- why: the rule in at most 6 words.{scheme_fields}
At most {cap} errors, most important first. No errors -> an empty list.
Return STRICT JSON only: {{"errors": [{{"wrong": "...", "correct": "...", "kind": "...", "why": "..."{scheme_example}}}]}}"""

SCHEME_INTRO = """
The paper marks by this printed deduction scheme; put every error in exactly one entry:
{block}
A sentence-level entry is for a whole sentence wrongly translated, or left out, judged against the
question below; then `wrong` is the first words of that sentence as written.
"""

VERIFY = """You are checking another examiner's red-pen marks on a student's handwritten page.
For each numbered mark you get the words the examiner says the student wrote ("wrong") and the correction.
First find the quoted words on the page and spell what the ink shows letter by letter - judge each
letter by its shape in THIS student's handwriting (compare it with the same letter elsewhere on the
page). Only then decide:
- keep: the ink really shows those words as quoted (same letters, not a misreading of the handwriting,
  not a word the student struck out, not the second half of a word broken across two lines), AND it is
  a real error, AND the correction is right.
- drop: anything else, including corrections that change nothing or only restate the same words.
Return STRICT JSON only: {"checks": [{"n": 1, "ink": "<letters you see>"}], "keep": [<numbers to keep>]}"""


def spot_prompt(hindi: bool, scheme: list[ds.Entry], question_text: str = "", language: str = "") -> str:
    code = answer_language.code_of(language)
    if code and code not in ("en", "hi"):
        head = SPOT_GENERIC.format(language=answer_language.name(code))
    else:
        head = SPOT_HINDI if hindi else SPOT_ENGLISH
    fields, example, intro = "", "", ""
    if scheme:
        intro = SCHEME_INTRO.format(block=ds.prompt_block(scheme))
        if question_text:
            intro += "\nTHE QUESTION (printed, for judging translations):\n" + question_text[:6000] + "\n"
        fields = ("\n- symbol: the scheme symbol for this error"
                  "\n- count: how many of that symbol it costs (1 unless it is several mistakes)")
        example = ', "symbol": "' + scheme[0].symbol + '", "count": 1'
    return head + "\n" + intro + SPOT_FORMAT.format(scheme_fields=fields, cap=MAX_ERRORS_PER_BAND,
                                                    scheme_example=example)


# ----------------------------------------------------------------- parsing

def _json(content: str, key: str) -> list:
    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", (content or "").strip())
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return []
    items = data.get(key) if isinstance(data, dict) else None
    return items if isinstance(items, list) else []


def _nfc(text: Any) -> str:
    return unicodedata.normalize("NFC", " ".join(str(text or "").split()))


def norm(text: Any) -> str:
    """Lower-case words only, for comparing a quote with a correction or a row.
    Letters, digits and combining marks: `\\w` alone drops an Indic vowel sign,
    which made "कि" -> "की" or "खरीदा" -> "खरीदे" compare equal and be thrown
    away as a correction that changes nothing."""
    kept = "".join(ch if unicodedata.category(ch)[0] in "LMN" else " " for ch in _nfc(text).lower())
    return " ".join(kept.split())


def _devanagari(text: str) -> bool:
    return any(0x0900 <= ord(ch) <= 0x097F for ch in text or "")


# ----------------------------------------------------- misreading filter

# A student misspells by sound: a vowel for a vowel, c for k, a doubled or a
# dropped letter. A reader misreads by shape: n for x, u for m, r for n, J for
# f, l for t. So a "spelling error" that needs a swap no speller would make -
# two consonants of different sound, a vowel for a consonant - is the model
# misreading the hand, not the student misspelling the word (probe 2026-10-28:
# "enchange"/exchange, "econouy"/economy, "Jake"/fake, "privalt"/private,
# "Manmohau"/Manmohan, "gines"/gives were all correct on the page).
_VOWELS = set("aeiouy")
_SOUND_ALIKE = ("ckqs", "sz", "fv", "gj", "dt", "bp")


def _sound_alike(a: str, b: str) -> bool:
    if a == b:
        return True
    if a in _VOWELS and b in _VOWELS:
        return True
    return any(a in g and b in g for g in _SOUND_ALIKE)


def _misread(w: str, c: str) -> bool:
    """`w` read for the word `c`: every changed letter is a shape swap, or the
    reading cut the word (the second half of "accoun-/tability", or its last
    letters off the band)."""
    if len(w) >= 3 and c.endswith(w) and len(c) - len(w) <= 4:
        return True
    if len(w) >= 3 and c.startswith(w) and len(c) - len(w) <= 2 and c[len(w):] not in ("s", "es", "d", "ed"):
        return True
    if SequenceMatcher(None, w, c).ratio() < 0.6:
        return False          # a different word, not a misread one
    shape_swap = False
    dropped, added = "", ""
    doubled = False

    def doubles(word: str, i: int) -> bool:
        return (i > 0 and word[i - 1] == word[i]) or (i + 1 < len(word) and word[i + 1] == word[i])

    for op, i1, i2, j1, j2 in SequenceMatcher(None, w, c).get_opcodes():
        if op == "delete":
            dropped += w[i1:i2]
            doubled = doubled or any(doubles(w, i) for i in range(i1, i2))
        elif op == "insert":
            added += c[j1:j2]
            doubled = doubled or any(doubles(c, j) for j in range(j1, j2))
        elif op == "replace":
            for x, y in zip(w[i1:i2], c[j1:j2]):
                if not _sound_alike(x, y):
                    shape_swap = True
    # A letter read where another stands, a little further along ("privalt"
    # for "private"): one dropped and one added letter are a swap too.
    # A doubled letter written single, or a single one doubled ("preffered"),
    # is how people misspell, not how a reader misreads.
    if len(dropped) == 1 and len(added) == 1 and not doubled and not _sound_alike(dropped, added):
        shape_swap = True
    return shape_swap


def reading_slip(wrong: str, correct: str, kind: str = "") -> bool:
    """A correction that changes nothing, or a "spelling error" that the
    handwriting being misread explains. Only spelling is judged: an added
    article, a hyphen or a wrong word is never a reading slip."""
    nw, nc = norm(wrong), norm(correct)
    if not nw or nw == nc:
        return True
    if not answer_language.is_latin(wrong):
        # The shape/sound tables below are Latin letters; any other script
        # is guarded by the strict transcript match in to_error instead.
        return False
    if str(kind or "").strip().lower() not in ("spelling", ""):
        return False
    ww, cw = nw.split(), nc.split()
    if len(ww) != len(cw):
        return False
    diffs = [(w, c) for w, c in zip(ww, cw) if w != c]
    return bool(diffs) and all(_misread(w, c) for w, c in diffs)


# ----------------------------------------------------- rows and bands

def _rows(page: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for line in page.get("lines") or []:
        text = str(line.get("text") or "").strip()
        box = line.get("box")
        if (not text or line.get("printed") or line.get("illegible") or text == "[illegible]"
                or not line.get("line_id") or not isinstance(box, (list, tuple)) or len(box) != 4):
            continue
        out.append(line)
    return out


def band_rows(page: dict[str, Any], top: float, bottom: float) -> list[dict[str, Any]]:
    """Student rows whose vertical centre lies in the band (shares of the page height)."""
    h = float(page.get("height") or 0)
    if h <= 0:
        return []
    out = []
    for r in _rows(page):
        y = float(r["box"][1]) + float(r["box"][3]) / 2.0
        if top * h - 0.02 * h <= y <= bottom * h + 0.02 * h:
            out.append(r)
    return out


def _windows(text: str, n: int):
    """(start, end) character spans of every run of n consecutive words."""
    words = [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]
    n = max(1, min(n, len(words)))
    for i in range(0, len(words) - n + 1):
        yield words[i][0], words[i + n - 1][1]


def match_row(wrong: str, correct: str, rows: list[dict[str, Any]],
              strict: bool = False) -> Optional[tuple[dict, int, int, float]]:
    """(row, start, end, score) of the row text that best carries `wrong` - or
    its corrected form, since the reader often already corrected it there.
    `strict`: only `wrong` itself, read near-identically by the transcript."""
    from .language_feedback import _locate

    best: Optional[tuple[dict, int, int, float]] = None
    threshold = _ROW_MATCH_STRICT if strict else _ROW_MATCH
    for row in rows:
        text = _nfc(row.get("text"))
        for quote in ((wrong,) if strict else (wrong, correct)):
            quote = _nfc(quote)
            if not quote:
                continue
            hit = _locate(quote, text)
            if hit:
                cand = (row, hit[0], hit[1], 1.0 if quote == _nfc(wrong) else 0.97)
                if best is None or cand[3] > best[3]:
                    best = cand
                continue
            nq = norm(quote)
            n = max(1, len(quote.split()))
            for size in {max(1, n - 1), n, n + 1}:
                for a, b in _windows(text, size):
                    score = SequenceMatcher(None, nq, norm(text[a:b])).ratio()
                    if score >= threshold and (best is None or score > best[3]):
                        best = (row, a, b, score)
    return best


def to_error(item: dict[str, Any], page_id: str, rows: list[dict[str, Any]],
             scheme: list[ds.Entry]) -> Optional[dict[str, Any]]:
    """A verified mark as a language-feedback error tied to a row, or None
    when no row carries it."""
    from .language_feedback import KINDS, _visual_fraction, _word_range

    wrong, correct = _nfc(item.get("wrong")), _nfc(item.get("correct"))
    if not wrong or not correct:
        return None
    hit = match_row(wrong, correct, rows, strict=not answer_language.is_latin(wrong))
    if hit is None:
        return None
    row, start, end, _score = hit
    text = _nfc(row.get("text"))
    kind = str(item.get("kind") or "").strip().lower()
    err = {
        "row": str(row["line_id"]),
        "page_id": page_id,
        # The words as the ink shows them: what the feedback quotes.
        "wrong": wrong[:80],
        "correct": correct[:200],
        "kind": kind if kind in KINDS else ("sentence" if kind == "sentence" else "grammar"),
        "why": " ".join(str(item.get("why") or "").split())[:60],
        "span": [round(_visual_fraction(text, start), 4), round(_visual_fraction(text, end), 4)],
        "words": _word_range(text, start, end),
    }
    entry = ds.entry_for(scheme, item.get("symbol"), kind) if scheme else None
    if entry is not None:
        err["symbol"] = entry.symbol
        err["count"] = ds.count_of(item.get("symbol"), entry, item.get("count"))
        if entry.scope == "sentence":
            err["kind"] = "sentence"
            err["count"] = 1
    return err


def dedupe(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One error per spot: the overlapping bands see the same line twice."""
    out: list[dict[str, Any]] = []
    for e in errors:
        dup = False
        for o in out:
            if o["row"] != e["row"]:
                continue
            same_words = norm(o["wrong"]) == norm(e["wrong"]) or norm(o["correct"]) == norm(e["correct"])
            a0, a1 = o["span"]
            b0, b1 = e["span"]
            overlap = min(a1, b1) - max(a0, b0) > 0.5 * min(a1 - a0, b1 - b0)
            if same_words or overlap:
                dup = True
                break
        if not dup:
            out.append(e)
    return out


# ----------------------------------------------------- images

def _encode(img: Any) -> str:
    img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, _MAX_EDGE / float(max(w, h)))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii")


async def page_images(pdf_url: str) -> Optional[dict[str, Any]]:
    from .mathpix_fallback import _download, _rasterize_pages

    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "copy.pdf"
            await _download(pdf_url, path)
            return await asyncio.get_running_loop().run_in_executor(None, _rasterize_pages, path)
    except Exception:
        logger.warning("Language check: could not render the copy's pages; using the transcript",
                       exc_info=True)
        return None


def paper_text(questions: list[dict[str, Any]], limit: int = 6000) -> str:
    """The written questions' printed text (and model answers), for judging a
    translation sentence by sentence."""
    parts = []
    for q in questions or []:
        text = " ".join(str(q.get("question_text") or "").split())
        if not text:
            continue
        label = q.get("question_number") or q.get("paper_label") or ""
        model_answer = " ".join(str(q.get("model_answer") or "").split())
        parts.append(f"Q{label}: {text}" + (f"\nModel answer: {model_answer}" if model_answer else ""))
    return "\n\n".join(parts)[:limit]


# ----------------------------------------------------- the pass

async def _ask(llm: Any, model: str, system: str, text: str, image_b64: str, max_tokens: int,
               institute_id: Optional[str], token_sink: Any) -> str:
    # One retry: a provider hiccup (a 520 on one band, 2026-10-28 probe) would
    # otherwise leave a page unread, and an unread page keeps its answer out
    # of the deduction scheme.
    try:
        return await _ask_once(llm, model, system, text, image_b64, max_tokens, institute_id, token_sink)
    except Exception:
        logger.warning("Language check call failed; retrying once", exc_info=True)
        await asyncio.sleep(2.0)
        return await _ask_once(llm, model, system, text, image_b64, max_tokens, institute_id, token_sink)


async def _ask_once(llm: Any, model: str, system: str, text: str, image_b64: str, max_tokens: int,
                    institute_id: Optional[str], token_sink: Any) -> str:
    response = await llm.chat_completion(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": text,
             "attachments": [{"type": "image", "url": f"data:image/jpeg;base64,{image_b64}"}]},
        ],
        temperature=0.0,
        max_tokens=max_tokens,
        institute_id=institute_id,
        model=model,
        # GLM only: a failed call costs this band its notes, never another
        # provider's tokens.
        fallback_models=[],
    )
    if token_sink is not None:
        try:
            token_sink.add_usage(response.get("usage"))
        except Exception:
            logger.debug("token sink rejected language-check usage", exc_info=True)
    return response.get("content") or ""


async def check_band(llm: Any, model: str, image_b64: str, page: dict[str, Any], top: float, bottom: float,
                     scheme: list[ds.Entry], question_text: str, allow_hindi: bool,
                     institute_id: Optional[str] = None, token_sink: Any = None,
                     language: str = "") -> list[dict[str, Any]]:
    """Spot, verify and filter one band; the kept errors tied to rows."""
    rows = band_rows(page, top, bottom)
    if not rows:
        return []
    hindi = allow_hindi and any(_devanagari(str(r.get("text") or "")) for r in rows)
    spot = await _ask(llm, model, spot_prompt(hindi, scheme, question_text, language), "The page section:",
                      image_b64, 6000, institute_id, token_sink)
    cands = [c for c in _json(spot, "errors")[:MAX_ERRORS_PER_BAND]
             if isinstance(c, dict)
             and not reading_slip(c.get("wrong") or "", c.get("correct") or "", c.get("kind") or "")]
    if not cands:
        return []
    listing = "\n".join(f'{i + 1}. wrong: "{_nfc(c.get("wrong"))}" -> correct: "{_nfc(c.get("correct"))}"'
                        f' ({_nfc(c.get("why"))})' for i, c in enumerate(cands))
    verdict = await _ask(llm, model, VERIFY, "Marks:\n" + listing, image_b64, 5000, institute_id, token_sink)
    keep = {int(k) for k in _json(verdict, "keep") if str(k).strip().isdigit()}
    out = []
    for i, c in enumerate(cands):
        if i + 1 not in keep:
            continue
        err = to_error(c, page.get("page_id"), rows, scheme)
        if err is not None:
            out.append(err)
    return out


async def find_errors(llm: Any, layout_map: dict[str, Any], pdf_url: Optional[str], model: Optional[str] = None,
                      scheme: Optional[list[ds.Entry]] = None, question_text: str = "",
                      allow_hindi: bool = False, institute_id: Optional[str] = None, token_sink: Any = None,
                      cancellation_check: Optional[Callable[[], bool]] = None,
                      images: Optional[dict[str, Any]] = None, language: str = "",
                      ) -> Optional[tuple[dict[str, list[dict[str, Any]]], set[str]]]:
    """(row id -> errors, ids of the pages every band of which was checked),
    or None when the page images cannot be had (the caller then runs the
    text-only pass). Never raises."""
    scheme = scheme or []
    model = model or language_model()
    if images is None:
        if not pdf_url:
            return None
        images = await page_images(pdf_url)
    if not images:
        return None
    gate = asyncio.Semaphore(_CONCURRENCY)
    jobs = []
    for page in layout_map.get("pages") or []:
        pid = page.get("page_id")
        img = images.get(pid)
        if img is None or not _rows(page):
            continue
        w, h = img.size
        for top, bottom in BANDS:
            if not band_rows(page, top, bottom):
                continue
            jobs.append((pid, page, img.crop((0, int(h * top), w, int(h * bottom))), top, bottom))

    failed_pages: set[str] = set()

    async def one(pid: str, page: dict, crop: Any, top: float, bottom: float) -> list[dict[str, Any]]:
        async with gate:
            if cancellation_check is not None and cancellation_check():
                failed_pages.add(pid)
                return []
            try:
                b64 = await asyncio.get_running_loop().run_in_executor(None, _encode, crop)
                return await check_band(llm, model, b64, page, top, bottom, scheme, question_text,
                                        allow_hindi, institute_id, token_sink, language)
            except Exception:
                logger.exception("Language check failed on %s band %.0f-%.0f%%", pid, top * 100, bottom * 100)
                failed_pages.add(pid)
                return []

    try:
        results = await asyncio.gather(*(one(*j) for j in jobs))
    except Exception:
        logger.exception("Language check (vision) failed; using the transcript")
        return None
    by_row: dict[str, list[dict[str, Any]]] = {}
    for e in dedupe([e for errs in results for e in errs]):
        by_row.setdefault(e["row"], []).append(e)
    checked = {j[0] for j in jobs} - failed_pages
    checked |= {p.get("page_id") for p in layout_map.get("pages") or [] if not _rows(p)}
    logger.info("Language check (vision, %s): %d error(s) on %d row(s); %d band call(s), %d page(s) incomplete",
                model, sum(len(v) for v in by_row.values()), len(by_row), len(jobs), len(failed_pages))
    return by_row, checked
