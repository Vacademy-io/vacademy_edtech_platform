#!/usr/bin/env python3
"""Load NCERT textbooks into the Knowledge Base as curriculum libraries (V517).

One knowledge base per class × subject (× medium), one SOURCE per chapter PDF,
straight from NCERT's own servers:

    https://ncert.nic.in/textbook/pdf/{book}{NN}.pdf     chapter NN of {book}
    https://ncert.nic.in/textbook/pdf/{book}ps.pdf       prelims (contents)

`ncert_inventory.json` next to this file is the catalogue parsed from
ncert.nic.in/textbook.php (book code, class, subject, title, chapter count).
Re-parse it each session with `--refresh-inventory`: NCERT replaces books
yearly (2026-27 brought new Class 1-9 books) and chapter counts move.

Everything goes through ai_service's public API, so the same script loads a
laptop, staging, or prod, and every step is idempotent:

  * a knowledge base is looked up by name before it is created;
  * a chapter is looked up by its NCERT code (source.meta.ncert_code) before it
    is added, and the server dedups identical bytes by sha256 anyway;
  * the listing upsert and publish are repeatable.

Usage (publisher institute credentials — see --jwt / --internal-token):

  python3 load_ncert.py --base-url http://localhost:8000 --jwt "$JWT" \
      --classes 11 --subjects Chemistry --dry-run
  python3 load_ncert.py --base-url http://localhost:8000 --jwt "$JWT" \
      --classes 11 --subjects Chemistry
  python3 load_ncert.py ... --classes 6-12            # the v1 core set

Needs: python3 with httpx and pymupdf (`pip install httpx pymupdf`).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

HERE = Path(__file__).resolve().parent
INVENTORY = HERE / "ncert_inventory.json"
OVERRIDES = HERE / "chapter_title_overrides.json"   # {"kech101": "Some Basic Concepts of Chemistry", ...}
# Hand-written tables of contents (one JSON per book, see structure_prompt()).
# When a book has one, its chapter titles and section headings come from here
# and no model is asked anything; the server locates each heading in the
# chapter text to give it a page.
STRUCTURES_DIR = HERE / "structures"

NCERT_PDF = "https://ncert.nic.in/textbook/pdf/{code}.pdf"
NCERT_TEXTBOOK_PAGE = "https://ncert.nic.in/textbook.php"

BOARD = "NCERT"
SESSION = "2026-27"
# In-process embedder (fastembed, ONNX on CPU) registered by V520: no
# per-token cost and no metered key behind every client's search.
EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"

# The v1 scope: the subjects a test is actually set on. Vocational, arts,
# PE, crafts and the Sanskrit/Urdu readers are left out on purpose — they
# are in the inventory and one --subjects flag brings any of them in.
CORE_SUBJECTS = {
    "Science", "Mathematics", "Social Science", "English", "Hindi",
    "Physics", "Chemistry", "Biology", "Accountancy", "Business Studies",
    "Economics", "History", "Geography", "Political Science", "Sociology",
    "Psychology", "Computer Science", "Informatics Practices", "Biotechnology",
    "Home Science", "Environmental Studies",
}

MEDIUM_BY_LETTER = {"e": "English", "h": "Hindi", "u": "Urdu"}
LANGUAGE_HINT = {"English": "en", "Hindi": "hi", "Urdu": "ur"}

# Titles that mean "Part N of the same book": these merge into one KB with
# continuous chapter numbers. Anything else with the same class+subject is a
# separate book (Class 10 Social Science has four) and gets its own KB.
_PART_RE = re.compile(
    r"\s*[-–(]?\s*(part|bhag|भाग)\s*[-]?\s*(i{1,3}|iv|v|\d)\s*[)]?\s*$|\s*[-–]\s*(i{1,3}|\d)\s*$",
    re.I,
)

# Part pairs the title rule cannot see. Class 11 Accountancy is "Financial
# Accounting-I" + "Accountancy-II" (chapters 8-9 continue Part I's numbering).
MERGE_INTO = {"keac2": "keac1"}
# Part pairs that must NOT merge: Class 12 Accountancy Part II prints its own
# Chapter 1-6, so it is a book in its own right.
NO_MERGE = {"leac1", "leac2"}

log = logging.getLogger("load_ncert")


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

@dataclass
class Book:
    cls: int
    subject: str
    title: str
    code: str        # e.g. kech1
    chapters: int
    medium: str

    @property
    def series_key(self) -> str:
        """Which KB this book belongs to: its own code, or the code of the Part I
        it continues."""
        if self.code in NO_MERGE or self.code in MERGE_INTO.values():
            return self.code
        if self.code in MERGE_INTO:
            return MERGE_INTO[self.code]
        return "series:" + _PART_RE.sub("", self.title).strip(" -–:").lower()

    @property
    def series_title(self) -> str:
        """Title with the 'Part I' suffix removed — the KB the book belongs to."""
        if self.code in NO_MERGE:
            return self.title
        return _PART_RE.sub("", self.title).strip(" -–:") or self.title

    @property
    def part_no(self) -> int:
        m = _PART_RE.search(self.title)
        if not m:
            return 1
        token = (m.group(2) or m.group(3) or "1").lower()
        romans = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}
        return romans.get(token) or int(token)


def refresh_inventory() -> List[Dict[str, Any]]:
    """Re-parse ncert.nic.in/textbook.php. The page embeds every book as
    `textbook.php?{code}=0-{N}` inside a JS dropdown; 0 is the prelims file
    and chapters run 1..N."""
    html = httpx.get(NCERT_TEXTBOOK_PAGE, timeout=60, follow_redirects=True,
                     headers={"User-Agent": "Mozilla/5.0"}).text
    rows: List[Dict[str, Any]] = []
    cls = subj = None
    titles: Dict[str, str] = {}
    for raw in html.split("\n"):
        s = raw.strip()
        if s.startswith("//"):
            continue  # retired books are commented out, not removed
        m = re.search(r'tclass\.value==(\d+)\)\s*&&\s*\(document\.test\.tsubject\.options\[sind\]\.text=="([^"]+)"', s)
        if m:
            cls, subj, titles = int(m.group(1)), m.group(2), {}
            continue
        m = re.search(r'tbook\.options\[(\d+)\]\.text="([^"]*)"', s)
        if m and cls:
            titles[m.group(1)] = m.group(2)
            continue
        m = re.search(r'tbook\.options\[(\d+)\]\.value="textbook\.php\?([a-z0-9]+)=(\d+)-(\d+)"', s)
        if m and cls:
            code, last = m.group(2), int(m.group(4))
            rows.append({
                "cls": cls, "subject": subj, "title": titles.get(m.group(1), "?"),
                "code": code, "chapters": last, "medium": MEDIUM_BY_LETTER.get(code[1], "?"),
            })
    return rows


def load_books(args: argparse.Namespace) -> Tuple[List[Book], List[Book]]:
    """(books to load this run, every book of the inventory in this medium).

    The full list matters for NAMING: whether "Class 11 Economics" needs the
    book title in its KB name depends on how many Economics books the class
    has in the inventory — not on how many this run happens to include. A
    --codes run must land in the same KB a full run would."""
    if args.refresh_inventory or not INVENTORY.exists():
        rows = refresh_inventory()
        INVENTORY.write_text(json.dumps(rows, indent=1, ensure_ascii=False))
        log.info("Inventory refreshed: %d books", len(rows))
    rows = json.loads(INVENTORY.read_text())
    classes = _parse_classes(args.classes)
    subjects = set(s.strip() for s in args.subjects.split(",")) if args.subjects else CORE_SUBJECTS
    universe = [Book(**r) for r in rows if r["medium"] == args.medium]
    books = [
        b for b in universe
        if b.cls in classes and b.subject in subjects and (not args.codes or b.code in args.codes)
    ]
    books.sort(key=lambda b: (b.cls, b.subject, b.series_title, b.part_no))
    return books, universe


def _parse_classes(spec: str) -> set:
    out: set = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            out.update(range(int(a), int(b) + 1))
        elif part:
            out.add(int(part))
    return out


# ---------------------------------------------------------------------------
# Chapter titles — from the chapter's own opening pages
# ---------------------------------------------------------------------------

_SKIP_LINE = re.compile(
    r"^(chapter|unit|अध्याय|इकाई)\s*[\divxlc]+$"
    r"|^(chapter|unit)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)$"
    r"|^\d{1,3}$|^reprint|^rationalised|^(science|mathematics|physics|chemistry|biology)$",
    re.I,
)


def _fix_small_caps(title: str) -> str:
    """'Q Uadratic E Quations' → 'Quadratic Equations' (drop-cap fonts split
    the first letter of every word into its own span)."""
    if re.fullmatch(r"(?:[A-Z] [A-Za-z]+\s*)+", title):
        return re.sub(r"\b([A-Z]) ([A-Za-z]+)", lambda m: m.group(1) + m.group(2).lower(), title)
    return title


_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
          "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
          "eighteen", "nineteen", "twenty"]
# A heading LINE: "CHAPTER 8", "Chapter Eight", "UNIT 3" on a line of its own.
# Deliberately line-anchored — "In chapter 8, you learnt…" inside a paragraph
# is a cross-reference, not the chapter number, and matched anywhere it
# renumbered chapters upward on real NCERT PDFs.
_PRINTED_NO = re.compile(
    r"^\s*(?:chapter|unit)\s+(\d{1,2}|" + "|".join(_WORDS) + r")\s*$", re.I | re.M
)


def printed_chapter_no(data: bytes, max_pages: int = 2) -> Optional[int]:
    """The chapter number the book prints as a heading on its opening pages."""
    import fitz

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        for pno in range(min(max_pages, len(doc))):
            m = _PRINTED_NO.search(doc[pno].get_text())
            if m:
                g = m.group(1).lower()
                return int(g) if g.isdigit() else _WORDS.index(g) + 1
    finally:
        doc.close()
    return None


def chapter_title_from_pdf(data: bytes, max_pages: int = 4) -> Optional[str]:
    """The largest-type real-word line(s) on the opening pages, or None."""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        best: Optional[tuple] = None
        for pno in range(min(max_pages, len(doc))):
            page = doc[pno]
            lines = []
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    spans = [s for s in line.get("spans", []) if s["text"].strip()]
                    if not spans:
                        continue
                    txt = " ".join(s["text"].strip() for s in spans)
                    lines.append((round(max(s["size"] for s in spans), 1), line["bbox"][1], txt))
            if not lines:
                continue
            body = Counter(round(sz) for sz, _, _ in lines).most_common(1)[0][0]
            cands = [
                (sz, y, t) for sz, y, t in lines
                if sz >= body + 3 and re.search(r"[A-Za-zऀ-ॿ]{3}", t)
                and not _SKIP_LINE.match(t.strip())
            ]
            if not cands:
                continue
            top = max(sz for sz, _, _ in cands)
            picked = sorted((y, t) for sz, y, t in cands if abs(sz - top) < 1.0)
            title = re.sub(r"\s+", " ", " ".join(t for _, t in picked)).strip(" :-–")
            if best is None or top > best[0]:
                best = (top, title)
        if not best:
            return None
        return normalise_title(_fix_small_caps(best[1]))[:200]
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# API client
# ---------------------------------------------------------------------------

class Api:
    def __init__(self, base_url: str, *, jwt: Optional[str], internal_token: Optional[str],
                 institute_id: str, client_id: Optional[str]):
        self.base = base_url.rstrip("/")
        self.institute_id = institute_id
        headers = {"Accept": "application/json"}
        if jwt:
            headers["Authorization"] = f"Bearer {jwt}"
            headers["clientId"] = client_id or institute_id
            self.body_institute = None   # the credential names the institute
        elif internal_token:
            headers["X-Internal-Service-Token"] = internal_token
            self.body_institute = institute_id
        else:
            raise SystemExit("Provide --jwt (publisher admin login) or --internal-token")
        self.http = httpx.AsyncClient(base_url=self.base, headers=headers, timeout=180.0)

    def _q(self) -> Dict[str, str]:
        return {"institute_id": self.body_institute} if self.body_institute else {}

    def _b(self, body: Dict[str, Any]) -> Dict[str, Any]:
        if self.body_institute:
            body = {**body, "institute_id": self.body_institute}
        return body

    async def list_kbs(self) -> List[Dict[str, Any]]:
        r = await self.http.get("/knowledge-base/v1/bases", params={**self._q(), "include_archived": "true"})
        r.raise_for_status()
        return r.json()["knowledge_bases"]

    async def create_kb(self, body: Dict[str, Any]) -> Dict[str, Any]:
        r = await self.http.post("/knowledge-base/v1/bases", json=self._b(body))
        r.raise_for_status()
        return r.json()

    async def get_kb(self, kb_id: str) -> Dict[str, Any]:
        r = await self.http.get(f"/knowledge-base/v1/bases/{kb_id}", params=self._q())
        r.raise_for_status()
        return r.json()

    async def add_source(self, kb_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        r = await self.http.post(f"/knowledge-base/v1/bases/{kb_id}/sources", json=self._b(body))
        if r.status_code >= 400:
            raise RuntimeError(f"add_source {r.status_code}: {r.text[:300]}")
        return r.json()

    async def patch_source(self, source_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        r = await self.http.patch(f"/knowledge-base/v1/sources/{source_id}", params=self._q(), json=body)
        r.raise_for_status()
        return r.json()

    async def get_source(self, source_id: str) -> Dict[str, Any]:
        r = await self.http.get(f"/knowledge-base/v1/sources/{source_id}", params=self._q())
        r.raise_for_status()
        return r.json()

    async def rebuild_topics(self, kb_id: str) -> None:
        r = await self.http.post(f"/knowledge-base/v1/bases/{kb_id}/topics/rebuild", params=self._q())
        if r.status_code >= 400:
            log.warning("topics/rebuild %s: %s", r.status_code, r.text[:200])

    async def upsert_listing(self, kb_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        r = await self.http.put(f"/knowledge-base/v1/library/{kb_id}/listing", json=self._b(body))
        r.raise_for_status()
        return r.json()

    async def publish(self, kb_id: str) -> None:
        r = await self.http.post(
            f"/knowledge-base/v1/library/{kb_id}/listing/status",
            json=self._b({"status": "PUBLISHED"}),
        )
        r.raise_for_status()


# ---------------------------------------------------------------------------
# Hand-written structures (optional)
# ---------------------------------------------------------------------------

def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def load_structures() -> List[Dict[str, Any]]:
    """Every structures/*.json that parses. Shape (from structure_prompt):
    {board, class, subject, book, chapters: [{no, title, topics: [..]}]}"""
    out: List[Dict[str, Any]] = []
    if not STRUCTURES_DIR.exists():
        return out
    for path in sorted(STRUCTURES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            if isinstance(data, dict) and data.get("chapters"):
                data["_file"] = path.name
                out.append(data)
        except Exception as exc:  # noqa: BLE001
            log.warning("structure file %s ignored: %s", path.name, exc)
    return out


def structure_for(plan: "Plan", structures: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The structure describing this plan's book, if any: same board, class and
    subject; and, when the subject has several books, a matching book title."""
    cands = [
        st for st in structures
        if _squash(st.get("board")) == _squash(BOARD)
        and str(st.get("class", "")).strip() == str(plan.cls)
        and _squash(st.get("subject")) == _squash(plan.subject)
    ]
    if not cands:
        return None
    if len(cands) == 1 and not plan.multi_book_subject:
        return cands[0]
    want = _squash(plan.series_title)
    for st in cands:
        book = _squash(st.get("book"))
        if book and (book in want or want in book):
            return st
    return None if plan.multi_book_subject else cands[0]


def structure_prompt(cls: int, subject: str, book_title: str) -> str:
    """The prompt to paste into any chat model to produce one structure file."""
    return f"""You are given the NCERT textbook: Class {cls} {subject} ({book_title}, {SESSION} edition).
List its official table of contents as JSON. Use the book's OWN chapter numbers and
printed section headings, verbatim - do not invent, merge, rename or summarise.
Skip exercises, summaries, "points to ponder" and appendices.

Output ONLY this JSON, nothing else:
{{
  "board": "{BOARD}",
  "class": "{cls}",
  "subject": "{subject}",
  "book": "{book_title}",
  "chapters": [
    {{"no": 1, "title": "<chapter title exactly as printed>",
      "topics": ["<section heading 1 exactly as printed>", "<section heading 2>", "..."]}}
  ]
}}"""


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

@dataclass
class Chapter:
    code: str          # kech101
    chapter_no: int    # continuous across parts
    part_no: int
    book_code: str     # kech1
    title: Optional[str] = None


@dataclass
class Plan:
    cls: int
    subject: str
    medium: str
    series_title: str
    books: List[Book]
    chapters: List[Chapter] = field(default_factory=list)
    multi_book_subject: bool = False

    @property
    def kb_name(self) -> str:
        base = f"{BOARD} Class {self.cls} {self.subject}"
        if self.multi_book_subject:
            base += f": {self.series_title}"
        if self.medium != "English":
            base += f" ({self.medium})"
        return base

    @property
    def listing_title(self) -> str:
        return self.series_title if self.multi_book_subject else f"Class {self.cls} {self.subject}"


def build_plans(books: Sequence[Book], universe: Optional[Sequence[Book]] = None) -> List[Plan]:
    universe = list(universe or books)
    by_series: Dict[tuple, List[Book]] = defaultdict(list)
    for b in books:
        by_series[(b.cls, b.subject, b.medium, b.series_key)].append(b)
    # Naming AND chapter numbering are decided against the whole inventory
    # (see load_books): a --codes keac2 run must still number its chapters
    # 8 and 9, after the 7 chapters of the Part I it continues.
    full_parts: Dict[tuple, List[Book]] = defaultdict(list)
    for b in universe:
        full_parts[(b.cls, b.subject, b.medium, b.series_key)].append(b)
    series_per_subject: Counter = Counter((k[0], k[1], k[2]) for k in full_parts)
    plans: List[Plan] = []
    for key, parts in sorted(by_series.items()):
        cls, subject, medium, _ = key
        parts.sort(key=lambda b: b.part_no)
        series_title = parts[0].series_title
        plan = Plan(cls, subject, medium, series_title, parts,
                    multi_book_subject=series_per_subject[(cls, subject, medium)] > 1)
        offset = 0
        for book in sorted(full_parts[key], key=lambda b: b.part_no):
            if book in parts:
                for i in range(1, book.chapters + 1):
                    plan.chapters.append(Chapter(
                        code=f"{book.code}{i:02d}", chapter_no=offset + i,
                        part_no=book.part_no, book_code=book.code,
                    ))
            offset += book.chapters
        plans.append(plan)
    return plans


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

TERMINAL = {"READY", "PARTIAL", "FAILED"}


async def _download(code: str, attempts: int = 4) -> bytes:
    """ncert.nic.in drops connections now and then; retry with backoff."""
    last: Optional[Exception] = None
    for i in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=180.0, follow_redirects=True,
                                         headers={"User-Agent": "Mozilla/5.0"}) as c:
                r = await c.get(NCERT_PDF.format(code=code))
                r.raise_for_status()
                return r.content
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            last = exc
            await asyncio.sleep(2 * (i + 1))
    raise RuntimeError(f"download failed after {attempts} attempts: {last!r}")


_SMALL_WORDS = {"of", "and", "in", "the", "for", "to", "a", "an", "on", "with", "by",
                "from", "its", "their", "or", "as", "at", "vs", "into", "our"}


def normalise_title(title: str) -> str:
    """Book-cover casing from whatever the text layer produced.

    'structure of atom' → 'Structure of Atom'; the small-caps font that yields
    'sOme Basic PrinciPles' → 'Some Basic Principles'; ALL CAPS → Title Case.
    Real acronyms (2-4 caps, e.g. 'DNA', 'IUPAC') are kept.
    """
    words = title.split()
    out = []
    for i, w in enumerate(words):
        core = re.sub(r"[^A-Za-z]", "", w)
        lw = w.lower()
        # Small words first: a small-caps font yields "Pair OF Linear
        # Equations IN Two Variables", and "OF"/"IN" are not acronyms.
        if lw in _SMALL_WORDS and i not in (0, len(words) - 1):
            out.append(lw)
        elif core.isupper() and 2 <= len(core) <= 5 and not title.isupper():
            out.append(w)  # acronym inside a normally cased title
        elif re.match(r"^[spdf]-[A-Za-z]", w):
            out.append(w[0] + "-" + w[2:3].upper() + w[3:].lower())  # p-Block, d-Block
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return " ".join(out)


async def resolve_title(ch: Chapter, overrides: Dict[str, str]) -> str:
    """Chapter title from overrides or the PDF. Also corrects ch.chapter_no to
    the number the book prints when that number is plausible (Part II of
    Class 11 Accountancy prints 8, 9 — not 1, 2)."""
    if ch.code in overrides:
        return overrides[ch.code]
    try:
        data = await _download(ch.code)
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not read %s for its title: %r", ch.code, exc)
        return f"Chapter {ch.chapter_no}"
    printed = printed_chapter_no(data)
    # Accept the printed number only when it is plausibly THIS chapter: a
    # continuation of a merged part can be a few ahead of the computed count
    # (dropped chapters keep their old numbers), never behind and never far.
    if printed and printed != ch.chapter_no and 0 < printed - ch.chapter_no <= 3:
        log.info("   %s prints Chapter %d (computed %d); using the printed number",
                 ch.code, printed, ch.chapter_no)
        ch.chapter_no = printed
    title = chapter_title_from_pdf(data)
    if not title:
        log.warning("   %s: no title found on the opening pages — add it to %s",
                    ch.code, OVERRIDES.name)
    return title or f"Chapter {ch.chapter_no}"


async def wait_for_source(api: Api, source_id: str, *, poll: float = 5.0, timeout: float = 1800,
                          ignore_stale: Optional[str] = None, grace: float = 120.0) -> Dict[str, Any]:
    """Poll until the source reaches a terminal status.

    `ignore_stale`: after POST /reindex the row still reads its OLD terminal
    status (FAILED) until the background job actually starts — the 202 does
    not wait for a worker slot. Treat that status as non-terminal for `grace`
    seconds, or until any other status has been seen."""
    started = time.monotonic()
    seen_other = False
    while True:
        src = await api.get_source(source_id)
        status = src["status"]
        if status != ignore_stale:
            seen_other = True
        stale = (status == ignore_stale and not seen_other
                 and time.monotonic() - started < grace)
        if status in TERMINAL and not stale:
            return src
        if time.monotonic() - started > timeout:
            raise TimeoutError(f"source {source_id} still {status} after {timeout}s")
        await asyncio.sleep(poll)


class OutOfCredits(RuntimeError):
    """The publisher wallet cannot cover the next chapter (HTTP 402)."""


async def reindex_source(api: Api, source_id: str) -> Dict[str, Any]:
    r = await api.http.post(f"/knowledge-base/v1/sources/{source_id}/reindex", params=api._q())
    if r.status_code >= 400:
        raise RuntimeError(f"reindex {r.status_code}: {r.text[:300]}")
    return r.json()


def _pick_present(sources: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """ncert_code → the row that represents that chapter. A READY/PARTIAL row
    beats a FAILED one for the same code (an earlier attempt left behind)."""
    rank = {"READY": 0, "PARTIAL": 0, "PROCESSING": 1, "PENDING": 1, "FAILED": 2}
    out: Dict[str, Dict[str, Any]] = {}
    for src in sources:
        code = (src.get("meta") or {}).get("ncert_code")
        if not code:
            continue
        if code not in out or rank.get(src["status"], 3) < rank.get(out[code]["status"], 3):
            out[code] = src
    return out


async def load_plan(api: Api, plan: Plan, *, overrides: Dict[str, str],
                    dry_run: bool, publish: bool, retitle: bool = False,
                    embedding_model: str = EMBEDDING_MODEL,
                    structures: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Load one knowledge base (one book). Chapters run SEQUENTIALLY on purpose:
    the server rebuilds the book's topic tree after every chapter, and two
    rebuilds of the same tree racing each other would duplicate its nodes."""
    summary = {"kb": plan.kb_name, "added": 0, "skipped": 0, "failed": 0,
               "chapters": len(plan.chapters), "published": False}
    log.info("== %s (%d chapters from %s)", plan.kb_name, len(plan.chapters),
             ", ".join(b.code for b in plan.books))
    structure = structure_for(plan, structures or [])
    by_no: Dict[int, Dict[str, Any]] = {}
    if structure:
        for chap in structure.get("chapters") or []:
            try:
                by_no[int(chap.get("no"))] = chap
            except (TypeError, ValueError):
                continue
        log.info("   using hand-written structure %s (%d chapters)", structure["_file"], len(by_no))

    def manual_for(ch: Chapter) -> Dict[str, Any]:
        """Extra source meta from the structure file: title + headings."""
        chap = by_no.get(ch.chapter_no)
        if not chap:
            return {}
        extra: Dict[str, Any] = {}
        topics = [str(t).strip() for t in (chap.get("topics") or []) if str(t).strip()]
        if topics:
            extra["headings_manual"] = topics
        if chap.get("title"):
            extra["chapter_title"] = str(chap["title"]).strip()
        return extra

    # 1. Knowledge base (by name, under the publisher institute)
    existing = {kb["name"]: kb for kb in await api.list_kbs() if kb["institute_id"] == api.institute_id}
    kb = existing.get(plan.kb_name)
    meta = {
        "topic_tree_mode": "AUTHORED",
        "curriculum": {
            "board": BOARD, "class": str(plan.cls), "subject": plan.subject,
            "medium": plan.medium, "session": SESSION,
            "book_codes": [b.code for b in plan.books],
            "book_titles": [b.title for b in plan.books],
        },
    }
    if dry_run:
        for ch in plan.chapters:
            log.info("   would add %s  (chapter %d)%s", ch.code, ch.chapter_no,
                     "" if not kb else "  [kb exists]")
        return summary
    if not kb:
        kb = await api.create_kb({
            "name": plan.kb_name,
            "description": f"{BOARD} {plan.medium}-medium textbook for Class {plan.cls} {plan.subject}"
                           f" ({', '.join(b.title for b in plan.books)}), {SESSION}. One source per chapter.",
            "purpose": "teaching",
            "language_hint": LANGUAGE_HINT.get(plan.medium),
            "meta": meta,
            "embedding_model": embedding_model,
        })
        log.info("   created knowledge base %s", kb["id"])
    kb_id = kb["id"]

    # 2. Chapters — one source each, in order
    detail = await api.get_kb(kb_id)
    present = _pick_present(detail.get("sources") or [])
    for ch in plan.chapters:
        src = present.get(ch.code)

        if src and src["status"] in ("READY", "PARTIAL", "PROCESSING", "PENDING"):
            if retitle:
                extra = manual_for(ch)
                title = extra.get("chapter_title") or await resolve_title(ch, overrides)
                wanted = f"Chapter {ch.chapter_no}: {title}" if not title.lower().startswith("chapter") else title
                patch_meta = {"chapter_title": title, "chapter_no": ch.chapter_no, **extra}
                if src["title"] != wanted or "headings_manual" in extra:
                    await api.patch_source(src["id"], {"title": wanted, "meta": patch_meta})
                    log.info("   %s retitled → '%s'%s", ch.code, wanted,
                             "  + manual headings" if "headings_manual" in extra else "")
            summary["skipped"] += 1
            continue

        if src and src["status"] == "FAILED":
            # Re-run the existing row rather than inserting a second one (the
            # server's byte-dedup only matches READY/PARTIAL rows, so a plain
            # add_source would leave the FAILED twin behind forever).
            try:
                await reindex_source(api, src["id"])
                done = await wait_for_source(api, src["id"], ignore_stale="FAILED")
                if done["status"] == "FAILED":
                    summary["failed"] += 1
                    log.error("   %s still FAILED after re-index: %s", ch.code, done.get("error_message"))
                else:
                    summary["added"] += 1
                    log.info("   %s re-indexed → %s  pages=%s chunks=%s", ch.code, done["status"],
                             done["page_count"], done["chunk_count"])
            except Exception as exc:  # noqa: BLE001
                summary["failed"] += 1
                log.error("   %s re-index error: %s", ch.code, exc)
            continue

        extra = manual_for(ch)
        title = extra.get("chapter_title") or await resolve_title(ch, overrides)
        body = {
            "source_kind": "PDF",
            "title": f"Chapter {ch.chapter_no}: {title}" if not title.lower().startswith("chapter") else title,
            "source_url": NCERT_PDF.format(code=ch.code),
            "meta": {
                "chapter_no": ch.chapter_no, "chapter_title": title,
                "ncert_code": ch.code, "book_code": ch.book_code, "part_no": ch.part_no,
                "board": BOARD, "class": str(plan.cls), "subject": plan.subject,
                "session": SESSION,
                **extra,
            },
        }
        try:
            res = await api.add_source(kb_id, body)
        except Exception as exc:  # noqa: BLE001 — one chapter, not the book
            if isinstance(exc, RuntimeError) and "402" in str(exc):
                # Stop the whole run: every further chapter would fail the same
                # way, and half-loaded books must not be published.
                raise OutOfCredits(f"{plan.kb_name} / {ch.code}: {exc}") from exc
            summary["failed"] += 1
            log.error("   %s error: %r", ch.code, exc)
            continue
        try:
            src = res["source"]
            if res.get("deduplicated"):
                # Same bytes already in this KB (e.g. re-run after a rename):
                # make sure the chapter metadata is on it.
                await api.patch_source(src["id"], {"meta": body["meta"]})
                summary["skipped"] += 1
                log.info("   %s already present (dedup) → %s", ch.code, src["id"])
                continue
            src = await wait_for_source(api, src["id"])
            if src["status"] == "FAILED":
                summary["failed"] += 1
                log.error("   %s FAILED: %s", ch.code, src.get("error_message"))
            else:
                summary["added"] += 1
                log.info("   %s → %s  %s  pages=%s chunks=%s  '%s'", ch.code, src["status"],
                         src["id"], src["page_count"], src["chunk_count"], title)
        except Exception as exc:  # noqa: BLE001
            summary["failed"] += 1
            log.error("   %s error: %s", ch.code, exc)

    # 3. Topic tree — ingest rebuilds it after every chapter; one final pass
    #    makes sure titles patched by --retitle are reflected. Best effort.
    try:
        await api.rebuild_topics(kb_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("   topic rebuild failed (tree from the last ingest stays): %s", exc)

    # 4. Listing (idempotent) + publish ONLY when the book is complete. A
    #    half-loaded book must not appear in every institute's picker.
    try:
        await api.upsert_listing(kb_id, {
            "title": plan.listing_title,
            "summary": f"{BOARD} Class {plan.cls} {plan.subject}, {plan.medium} medium, {SESSION}: "
                       f"{len(plan.chapters)} chapters, each searchable and citable by page.",
            "description": ", ".join(b.title for b in plan.books),
            "subject": plan.subject,
            "level": str(plan.cls),
            "board": BOARD,
            "language": plan.medium,
            "tags": ["curriculum", BOARD, f"class-{plan.cls}", plan.subject.lower()],
            "collection": "CURRICULUM",
        })
    except Exception as exc:  # noqa: BLE001
        log.error("   listing upsert failed: %s", exc)
        summary["failed"] += 1
        return summary
    complete = summary["failed"] == 0 and (summary["added"] + summary["skipped"]) == len(plan.chapters)
    if publish and complete:
        await api.publish(kb_id)
        summary["published"] = True
        log.info("   published")
    elif publish:
        log.warning("   NOT published: %d chapter(s) failed — fix and re-run", summary["failed"])
    return summary


async def main_async(args: argparse.Namespace) -> int:
    books, universe = load_books(args)
    plans = build_plans(books, universe)
    if args.limit_books:
        plans = plans[: args.limit_books]
    log.info("%d book(s) → %d knowledge base(s), %d chapters",
             len(books), len(plans), sum(len(p.chapters) for p in plans))
    overrides = json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
    structures = load_structures()
    if structures:
        log.info("%d hand-written structure file(s) in %s", len(structures), STRUCTURES_DIR)
    if args.print_prompts:
        for plan in plans:
            print(f"\n===== {plan.kb_name}  →  save as structures/{BOARD}_{plan.cls}_{plan.subject.replace(' ', '')}"
                  f"{'_' + re.sub(r'[^A-Za-z0-9]+', '', plan.series_title) if plan.multi_book_subject else ''}.json =====")
            print(structure_prompt(plan.cls, plan.subject, ", ".join(b.title for b in plan.books)))
        return 0

    api = Api(args.base_url, jwt=args.jwt, internal_token=args.internal_token,
              institute_id=args.institute_id, client_id=args.client_id)
    # --concurrency = BOOKS in flight. Chapters inside one book stay sequential
    # (see load_plan); different books have different topic trees and can run
    # side by side without racing each other.
    sem = asyncio.Semaphore(max(1, args.concurrency))
    stop = asyncio.Event()

    async def run_one(plan: Plan) -> Optional[Dict[str, Any]]:
        if stop.is_set():
            return None
        async with sem:
            if stop.is_set():
                return None
            try:
                return await load_plan(
                    api, plan, overrides=overrides,
                    dry_run=args.dry_run, publish=not args.no_publish, retitle=args.retitle,
                    embedding_model=args.embedding_model, structures=structures,
                )
            except OutOfCredits as exc:
                log.error("OUT OF CREDITS — stopping: %s", exc)
                stop.set()
                return {"kb": plan.kb_name, "added": 0, "skipped": 0, "failed": len(plan.chapters),
                        "chapters": len(plan.chapters), "published": False}
            except Exception as exc:  # noqa: BLE001
                log.error("%s: aborted — %s", plan.kb_name, exc)
                return {"kb": plan.kb_name, "added": 0, "skipped": 0, "failed": len(plan.chapters),
                        "chapters": len(plan.chapters), "published": False}

    try:
        results = [r for r in await asyncio.gather(*(run_one(p) for p in plans)) if r]
    finally:
        await api.http.aclose()

    log.info("---- summary ----")
    for r in results:
        log.info("%-60s added=%d skipped=%d failed=%d / %d  %s",
                 r["kb"], r["added"], r["skipped"], r["failed"], r["chapters"],
                 "PUBLISHED" if r.get("published") else "")
    if stop.is_set():
        log.error("Run stopped early: the publisher institute is out of credits. "
                  "Grant credits and re-run — loaded chapters are skipped automatically.")
        return 2
    return 1 if any(r["failed"] for r in results) else 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", required=True, help="ai_service root, e.g. http://localhost:8000 or https://backend-stage.vacademy.io/ai-service")
    ap.add_argument("--jwt", help="Bearer token of a publisher-institute admin")
    ap.add_argument("--client-id", help="clientId header for --jwt (defaults to --institute-id)")
    ap.add_argument("--internal-token", help="X-Internal-Service-Token (server-to-server)")
    ap.add_argument("--institute-id", default="6b600940-2134-40ec-93ed-b61e403c5a87",
                    help="publisher institute (KB_PUBLISHER_INSTITUTE_ID)")
    ap.add_argument("--classes", default="6-12", help="e.g. 11 or 9-12 or 6,8,10")
    ap.add_argument("--subjects", help="comma-separated; default = core academic subjects")
    ap.add_argument("--medium", default="English", choices=["English", "Hindi", "Urdu"])
    ap.add_argument("--codes", nargs="*", help="restrict to these book codes, e.g. kech1 kech2")
    ap.add_argument("--concurrency", type=int, default=2, help="books loading at once (chapters within a book are sequential)")
    ap.add_argument("--limit-books", type=int, help="stop after N knowledge bases (testing)")
    ap.add_argument("--no-publish", action="store_true", help="create + ingest but leave the listing DRAFT")
    ap.add_argument("--retitle", action="store_true", help="re-resolve titles of chapters already loaded")
    ap.add_argument("--embedding-model", default=EMBEDDING_MODEL,
                    help="registered embedder for NEW bases (existing bases keep theirs)")
    ap.add_argument("--print-prompts", action="store_true",
                    help="print the structure prompt for each selected book and exit (no API calls)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--refresh-inventory", action="store_true", help="re-parse ncert.nic.in first")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    sys.exit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
