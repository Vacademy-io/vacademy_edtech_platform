"""The only learner-facing reader of course chunks: scoped search over the
lessons a learner may read (spec section 9).

search_course takes a ResolvedScope from access.py (OPEN and COMING_UP
lessons; HIDDEN lessons are simply absent) and:

  1. finds the institute's course KB (short session);
  2. embeds the query with NO session open;
  3. in ONE short session with statement_timeout 1500ms: candidate stats, the
     exact-scan set filled in tier order (current slide, current chapter,
     current batch, the rest) up to MAX_EXACT_CHUNKS, a centroid shortlist of
     the overflow lessons, the exact scan, and text for OPEN chunks only;
  4. ranks in Python: similarity x tier boost + 0.05 x lexical overlap, at
     most 2 hits per lesson, mode floor 0.35 (ambient) / 0.30;
  5. turns COMING_UP rows that rank inside the top k into signposts (title and
     unlock hint only; their text is never selected);
  6. post-checks every hit against scope.open_ids() and the institute, dropping
     and logging course_kb.leak_blocked (must stay at 0);
  7. adds REFERENCE MATERIAL from linked knowledge bases when links are on;
  8. on a statement timeout retries once with only the current slide and
     chapter, then gives up with an empty result.

It never raises for a data problem: any failure is logged and reads as "nothing
relevant", so a chat or voice turn is never broken by course search.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy import text

from ...db import db_session
from . import citations, embedding, flags, store
from .access import (
    STATE_COMING_UP,
    STATE_OPEN,
    TIER_CURRENT_BATCH,
    TIER_CURRENT_CHAPTER,
    TIER_CURRENT_SLIDE,
    ResolvedScope,
)

logger = logging.getLogger(__name__)

MODE_AMBIENT = "ambient"
MODE_TOOL = "tool"
MODE_VOICE = "voice"
MODE_PREVIEW = "preview"
MODES = (MODE_AMBIENT, MODE_TOOL, MODE_VOICE, MODE_PREVIEW)

MAX_EXACT_CHUNKS = 3000
CENTROID_SHORTLIST = 25
STATEMENT_TIMEOUT = "1500ms"
SCAN_FACTOR = 5
MAX_HITS_PER_LESSON = 2
MAX_SIGNPOSTS = 2
MAX_LINKED_KBS = 2
LINKED_HITS_PER_KB = 2
LEXICAL_WEIGHT = 0.05
MIN_TERM_CHARS = 3
# A budget remainder shorter than this is not worth a passage: drop the hit.
MIN_EXCERPT_CHARS = 60
MAX_QUERY_CHARS = 2000
LINK_USE_CHATBOT = "chatbot"

TIER_BOOSTS: Mapping[int, float] = {
    TIER_CURRENT_SLIDE: 1.5,
    TIER_CURRENT_CHAPTER: 1.2,
    TIER_CURRENT_BATCH: 1.1,
}

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
_TIMEOUT_SQLSTATE = "57014"  # query_canceled (statement_timeout)


@dataclass(frozen=True)
class Budget:
    top_k: int
    excerpt_chars: int
    total_chars: Optional[int]
    floor: float


# Tool mode: the model text is capped at TOOL_NOTE_MAX_CHARS (1500) by
# prompt_blocks.format_tool_text; excerpts are sized to leave room for titles.
BUDGETS: Mapping[str, Budget] = {
    MODE_AMBIENT: Budget(top_k=4, excerpt_chars=1200, total_chars=4000, floor=0.35),
    MODE_TOOL: Budget(top_k=6, excerpt_chars=400, total_chars=1200, floor=0.30),
    MODE_VOICE: Budget(top_k=3, excerpt_chars=300, total_chars=900, floor=0.30),
    MODE_PREVIEW: Budget(top_k=8, excerpt_chars=400, total_chars=None, floor=0.30),
}


@dataclass(frozen=True)
class CourseHit:
    """One OPEN passage the learner may read, with its citation."""
    slide_id: str
    chunk_id: str
    source_id: str
    title: str
    chapter_title: Optional[str]
    chapter_id: str
    package_id: Optional[str]
    package_session_id: str
    source_type: Optional[str]
    excerpt: str
    similarity: float
    score: float
    tier: int
    page_start: Optional[int]
    page_end: Optional[int]
    t_start_ms: Optional[int]
    href: str
    badge: Optional[str]
    icon: str
    label: str
    anchor_label: Optional[str] = None

    def preview_dict(self) -> Dict[str, Any]:
        """The staff preview-search hit shape (spec section 13)."""
        return {
            "slide_id": self.slide_id, "title": self.title, "chapter_name": self.chapter_title,
            "excerpt": self.excerpt,
            "page": self.page_start if self.page_start and self.page_start > 0 else None,
            "t_start_ms": self.t_start_ms, "score": round(self.score, 4), "href": self.href,
        }


@dataclass(frozen=True)
class Signpost:
    """A COMING UP lesson that matched: title and unlock hint only, never text."""
    slide_id: str
    title: str
    chapter_title: Optional[str]
    unlock_hint: Optional[str]
    package_id: Optional[str]
    package_session_id: str
    source_type: Optional[str]
    similarity: float

    def to_dict(self) -> Dict[str, Any]:
        return {"slide_id": self.slide_id, "title": self.title,
                "chapter_title": self.chapter_title, "unlock_hint": self.unlock_hint}


@dataclass(frozen=True)
class KbHit:
    """REFERENCE MATERIAL from a knowledge base linked to the learner's course.
    No learner deep link: it is not a lesson the learner can open."""
    knowledge_base_id: str
    kb_name: Optional[str]
    source_title: Optional[str]
    page_start: Optional[int]
    page_end: Optional[int]
    page_label: Optional[str]
    excerpt: str
    similarity: float


@dataclass(frozen=True)
class CourseSearchResult:
    hits: Tuple[CourseHit, ...] = ()
    signposts: Tuple[Signpost, ...] = ()
    kb_hits: Tuple[KbHit, ...] = ()
    latency_ms: int = 0
    truncated: bool = False
    mode: str = MODE_AMBIENT
    # Why the result is empty when it is: no_scope, disabled, no_kb,
    # no_vector, timeout, failed. None when the search ran.
    error: Optional[str] = None
    leak_blocked: int = 0

    @property
    def is_empty(self) -> bool:
        return not (self.hits or self.signposts or self.kb_hits)

    @property
    def top_similarity(self) -> Optional[float]:
        sims = [h.similarity for h in self.hits] + [s.similarity for s in self.signposts]
        return max(sims) if sims else None


@dataclass
class _Scanned:
    rows: List[store.ScanHit] = field(default_factory=list)
    texts: Dict[str, str] = field(default_factory=dict)
    leak_blocked: int = 0


# ── Text helpers ─────────────────────────────────────────────────────────────

def _fold(value: Optional[str]) -> str:
    return unicodedata.normalize("NFKC", value or "").lower()


def query_terms(query: Optional[str]) -> List[str]:
    """Distinct query words of 3+ characters, NFKC-lowercased, in order."""
    return list(dict.fromkeys(t for t in _TOKEN_RE.findall(_fold(query)) if len(t) >= MIN_TERM_CHARS))


def lexical_overlap(terms: Sequence[str], *haystacks: Optional[str]) -> float:
    """Fraction of `terms` found in the haystacks (title, chunk text)."""
    if not terms:
        return 0.0
    hay = " ".join(_fold(h) for h in haystacks if h)
    if not hay:
        return 0.0
    return sum(1 for t in terms if t in hay) / len(terms)


def excerpt(value: Optional[str], limit: int) -> Tuple[str, bool]:
    """Whitespace-folded text cut to `limit` characters at a word boundary
    (with an ellipsis). Returns (text, was_cut)."""
    clean = " ".join((value or "").split())
    if limit <= 0:
        return "", bool(clean)
    if len(clean) <= limit:
        return clean, False
    cut = clean[: max(1, limit - 1)]
    space = cut.rfind(" ")
    if space >= limit // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:-") + "…", True


def _is_timeout(exc: BaseException) -> bool:
    """A statement_timeout cancel, from psycopg 3 (sqlstate), psycopg2
    (pgcode) or anything that only says so in its message."""
    for err in (exc, getattr(exc, "orig", None), getattr(exc, "__cause__", None)):
        if err is None:
            continue
        if getattr(err, "sqlstate", None) == _TIMEOUT_SQLSTATE or getattr(err, "pgcode", None) == _TIMEOUT_SQLSTATE:
            return True
        if "statement timeout" in str(err).lower():
            return True
    return False


def _empty(mode: str, started: float, error: Optional[str]) -> CourseSearchResult:
    return CourseSearchResult(mode=mode, latency_ms=_elapsed_ms(started), error=error)


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


# ── Search ───────────────────────────────────────────────────────────────────

async def search_course(
    *,
    scope: Optional[ResolvedScope],
    query: str,
    mode: str,
    query_vec: Optional[Sequence[float]] = None,
    top_k: Optional[int] = None,
) -> CourseSearchResult:
    """Passages from the lessons `scope` lets the learner read. See the module
    docstring. Never holds a DB session across the embedding call."""
    if mode not in MODES:
        raise ValueError(f"unknown course search mode {mode!r}")
    started = time.perf_counter()
    budget = BUDGETS[mode]
    k = max(1, int(top_k)) if top_k else budget.top_k
    query = (query or "").strip()[:MAX_QUERY_CHARS]
    if scope is None or scope.is_empty or not scope.institute_id:
        return _empty(mode, started, "no_scope")
    if not flags.platform_enabled():
        return _empty(mode, started, "disabled")
    institute_id = scope.institute_id

    try:
        kb = await asyncio.to_thread(_load_kb, institute_id)
    except Exception as exc:  # noqa: BLE001 - course search never breaks a turn
        logger.error("course_kb.search: course KB lookup failed for %s: %s", institute_id, exc)
        return _empty(mode, started, "failed")
    if kb is None:
        return _empty(mode, started, "no_kb")
    if kb.institute_id != institute_id:
        logger.error("course_kb.leak_blocked: course KB %s is not institute %s's", kb.id, institute_id)
        return _empty(mode, started, "failed")

    qvec = list(query_vec) if query_vec else None
    if qvec is None:
        if not query:
            return _empty(mode, started, "no_vector")
        qvec = await embedding.embed_query(institute_id, kb.embedding_model, query)
    if not qvec or len(qvec) != kb.embedding_dim:
        if qvec:
            logger.warning("course_kb.search: query vector has %d dims, course KB %s has %d",
                           len(qvec), kb.id, kb.embedding_dim)
        return _empty(mode, started, "no_vector")

    candidates = _candidates(scope)
    if not candidates:
        return _empty(mode, started, None)

    scan_limit = k * SCAN_FACTOR
    try:
        scanned = await asyncio.to_thread(_scan, kb, scope, candidates, qvec, budget.floor, scan_limit)
    except Exception as exc:  # noqa: BLE001
        if not _is_timeout(exc):
            logger.error("course_kb.search failed for %s: %s", institute_id, exc)
            return _empty(mode, started, "failed")
        narrow = [s for s in candidates if scope.tier_of(s) <= TIER_CURRENT_CHAPTER]
        if not narrow:
            logger.error("course_kb.search timed out for %s with no current slide or chapter to retry",
                         institute_id)
            return _empty(mode, started, "timeout")
        logger.warning("course_kb.search timed out for %s over %d lessons; retrying with %d",
                       institute_id, len(candidates), len(narrow))
        try:
            scanned = await asyncio.to_thread(_scan, kb, scope, narrow, qvec, budget.floor, scan_limit)
        except Exception as retry_exc:  # noqa: BLE001
            logger.error("course_kb.search retry failed for %s: %s", institute_id, retry_exc)
            return _empty(mode, started, "timeout" if _is_timeout(retry_exc) else "failed")

    hits, signposts, truncated, ranked_leaks = _rank(scope, kb, scanned, query, budget, k)

    kb_hits: Tuple[KbHit, ...] = ()
    if flags.links_enabled():
        remaining = None
        if budget.total_chars is not None:
            remaining = max(0, budget.total_chars - sum(len(h.excerpt) for h in hits))
        try:
            linked, cut = await asyncio.to_thread(
                _linked_kb_hits, scope, kb.embedding_model, qvec, budget, remaining)
            kb_hits, truncated = tuple(linked), truncated or cut
        except Exception as exc:  # noqa: BLE001 - reference material is optional
            logger.warning("course_kb.search: linked knowledge bases skipped for %s: %s", institute_id, exc)

    return CourseSearchResult(
        hits=tuple(hits), signposts=tuple(signposts), kb_hits=kb_hits,
        latency_ms=_elapsed_ms(started), truncated=truncated, mode=mode,
        leak_blocked=scanned.leak_blocked + ranked_leaks,
    )


def _load_kb(institute_id: str) -> Optional[store.CourseKb]:
    with db_session() as db:
        return store.get_course_kb(db, institute_id)


def _candidates(scope: ResolvedScope) -> List[str]:
    """OPEN plus COMING_UP lessons, in tier order then course order."""
    ids = [s for s in scope.open_ids() + scope.coming_up_ids()
           if s in scope.entries and scope.entries[s].state in (STATE_OPEN, STATE_COMING_UP)]
    return sorted(dict.fromkeys(ids), key=lambda s: (scope.tier_of(s), scope.entries[s].order))


def fill_scan_set(
    candidates: Sequence[str], stats: Mapping[str, Tuple[str, int]], max_chunks: int = MAX_EXACT_CHUNKS,
) -> Tuple[List[str], List[str]]:
    """(lessons scanned exactly, overflow lessons). Walks `candidates` in their
    (tier) order and keeps every lesson whose chunks still fit the budget."""
    chosen: List[str] = []
    overflow: List[str] = []
    total = 0
    for slide_id in candidates:
        stat = stats.get(slide_id)
        if stat is None:
            continue
        count = int(stat[1])
        if total + count <= max_chunks:
            chosen.append(slide_id)
            total += count
        else:
            overflow.append(slide_id)
    return chosen, overflow


def _scan(kb: store.CourseKb, scope: ResolvedScope, candidates: Sequence[str],
          qvec: Sequence[float], floor: float, limit: int) -> _Scanned:
    """Every DB step of a search, in one short session with a statement timeout.
    Text is fetched only for chunks of OPEN lessons."""
    with db_session() as db:
        db.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"))
        stats = store.candidate_stats(db, kb.id, scope.institute_id, candidates)
        if not stats:
            return _Scanned()
        chosen, overflow = fill_scan_set(candidates, stats)
        if overflow:
            shortlisted = store.centroid_shortlist(
                db, kb.id, scope.institute_id, overflow, qvec, CENTROID_SHORTLIST)
            chosen.extend(s for s in shortlisted if s in stats and s not in chosen)
        source_to_slide = {stats[s][0]: s for s in chosen}
        rows = store.exact_scan(db, kb=kb, source_ids=list(source_to_slide), qvec=qvec,
                                floor=floor, limit=limit)
        kept: List[store.ScanHit] = []
        leaks = 0
        for row in rows:
            entry = scope.entries.get(row.slide_id)
            if entry is None or source_to_slide.get(row.source_id) != row.slide_id:
                leaks += 1
                logger.error(
                    "course_kb.leak_blocked: scan row chunk=%s slide=%s source=%s is outside the "
                    "scope of user %s in institute %s", row.chunk_id, row.slide_id, row.source_id,
                    scope.user_id, scope.institute_id)
                continue
            kept.append(row)
        open_chunk_ids = [r.chunk_id for r in kept if scope.is_open(r.slide_id)]
        texts = store.fetch_texts(db, open_chunk_ids) if open_chunk_ids else {}
    return _Scanned(rows=kept, texts=texts, leak_blocked=leaks)


def _rank(scope: ResolvedScope, kb: store.CourseKb, scanned: _Scanned, query: str,
          budget: Budget, k: int) -> Tuple[List[CourseHit], List[Signpost], bool, int]:
    terms = query_terms(query)
    scored: List[Tuple[float, int, store.ScanHit]] = []
    for row in scanned.rows:
        entry = scope.entries.get(row.slide_id)
        if entry is None or row.similarity <= budget.floor:
            continue
        is_open = entry.state == STATE_OPEN
        if is_open and row.chunk_id not in scanned.texts:
            continue  # the chunk was replaced between scan and fetch
        body = scanned.texts.get(row.chunk_id) if is_open else None
        boost = TIER_BOOSTS.get(scope.tier_of(row.slide_id), 1.0)
        score = row.similarity * boost + LEXICAL_WEIGHT * lexical_overlap(terms, entry.title, body)
        scored.append((score, entry.order, row))
    scored.sort(key=lambda t: (-t[0], t[1]))

    picked: List[Tuple[float, store.ScanHit]] = []
    signposts: List[Signpost] = []
    per_lesson: Dict[str, int] = {}
    position = 0
    for score, _order, row in scored:
        entry = scope.entries[row.slide_id]
        if per_lesson.get(row.slide_id, 0) >= MAX_HITS_PER_LESSON:
            continue
        if entry.state == STATE_COMING_UP:
            if per_lesson.get(row.slide_id):
                continue  # one signpost per lesson
            per_lesson[row.slide_id] = MAX_HITS_PER_LESSON
            if position < k and len(signposts) < MAX_SIGNPOSTS:
                signposts.append(Signpost(
                    slide_id=entry.slide_id, title=entry.title or "Lesson",
                    chapter_title=entry.chapter_title, unlock_hint=entry.unlock_hint,
                    package_id=entry.package_id, package_session_id=entry.package_session_id,
                    source_type=entry.source_type, similarity=row.similarity,
                ))
            position += 1
            continue
        per_lesson[row.slide_id] = per_lesson.get(row.slide_id, 0) + 1
        position += 1
        if len(picked) < k:
            picked.append((score, row))

    # Post-check: only lessons OPEN for this learner, in this institute.
    allowed = set(scope.open_ids()) if kb.institute_id == scope.institute_id else set()
    leaks = 0
    hits: List[CourseHit] = []
    truncated = False
    remaining = budget.total_chars
    for score, row in picked:
        if row.slide_id not in allowed:
            leaks += 1
            logger.error("course_kb.leak_blocked: hit chunk=%s slide=%s is not open for user %s in "
                         "institute %s", row.chunk_id, row.slide_id, scope.user_id, scope.institute_id)
            continue
        limit = budget.excerpt_chars if remaining is None else min(budget.excerpt_chars, remaining)
        if limit < MIN_EXCERPT_CHARS:
            truncated = True
            break
        passage, cut = excerpt(scanned.texts.get(row.chunk_id), limit)
        if not passage:
            continue
        truncated = truncated or cut
        if remaining is not None:
            remaining -= len(passage)
        entry = scope.entries[row.slide_id]
        cite = citations.cite(entry, row.page_start, row.page_end, row.meta)
        hits.append(CourseHit(
            slide_id=row.slide_id, chunk_id=row.chunk_id, source_id=row.source_id,
            title=entry.title or "Lesson", chapter_title=entry.chapter_title,
            chapter_id=entry.chapter_id, package_id=entry.package_id,
            package_session_id=entry.package_session_id, source_type=entry.source_type,
            excerpt=passage, similarity=row.similarity, score=score,
            tier=scope.tier_of(row.slide_id),
            page_start=cite.anchor.page, page_end=cite.anchor.page_end,
            t_start_ms=cite.anchor.t_start_ms, href=cite.href, badge=cite.badge,
            icon=cite.icon, label=cite.label, anchor_label=cite.anchor.label,
        ))
    return hits, signposts, truncated, leaks


# ── Linked knowledge bases (REFERENCE MATERIAL) ──────────────────────────────

def _link_kb_id(link: Any) -> Optional[str]:
    if isinstance(link, Mapping):
        value = link.get("knowledge_base_id")
    else:
        value = getattr(link, "knowledge_base_id", None)
    return str(value) if value else None


def _linked_kb_hits(scope: ResolvedScope, model: str, qvec: Sequence[float], budget: Budget,
                    remaining: Optional[int]) -> Tuple[List[KbHit], bool]:
    """Top passages from up to MAX_LINKED_KBS knowledge bases linked to the
    learner's courses for the chatbot. Same query vector, so a KB pinned to a
    different embedder is skipped. One short session, no network."""
    try:
        from .links import resolve_course_kb_links
    except ImportError:
        return [], False
    package_ids = sorted({e.package_id for e in scope.entries.values() if e.package_id})
    if not package_ids:
        return [], False
    from ..kb.repository import KbRepository

    out: List[KbHit] = []
    truncated = False
    with db_session() as db:
        db.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"))
        links = resolve_course_kb_links(db, scope.institute_id, package_ids, LINK_USE_CHATBOT) or []
        kb_ids = list(dict.fromkeys(i for i in (_link_kb_id(l) for l in links) if i))[:MAX_LINKED_KBS]
        repo = KbRepository(db)
        for kb_id in kb_ids:
            kb = repo.get_kb(kb_id, scope.institute_id)
            if not kb or not repo.is_usable(kb, scope.institute_id):
                continue
            if kb.get("embedding_model") != model or int(kb.get("embedding_dim") or 0) != len(qvec):
                continue
            rows = repo.search_chunks(
                kb_id=kb["id"], institute_id=kb["institute_id"], query_embedding=list(qvec),
                embedding_dim=int(kb["embedding_dim"]), top_k=LINKED_HITS_PER_KB,
                similarity_threshold=budget.floor,
            )
            for r in rows[:LINKED_HITS_PER_KB]:
                limit = budget.excerpt_chars if remaining is None else min(budget.excerpt_chars, remaining)
                if limit < MIN_EXCERPT_CHARS:
                    return out, True
                passage, cut = excerpt(r.get("content_text"), limit)
                if not passage:
                    continue
                truncated = truncated or cut
                if remaining is not None:
                    remaining -= len(passage)
                out.append(KbHit(
                    knowledge_base_id=kb["id"], kb_name=kb.get("name"),
                    source_title=r.get("source_title"), page_start=r.get("page_start"),
                    page_end=r.get("page_end"),
                    page_label=citations.page_label(r.get("page_start"), r.get("page_end")),
                    excerpt=passage, similarity=float(r.get("similarity_score") or 0.0),
                ))
    return out, truncated


__all__ = [
    "MODE_AMBIENT", "MODE_TOOL", "MODE_VOICE", "MODE_PREVIEW", "MODES", "MAX_EXACT_CHUNKS",
    "CENTROID_SHORTLIST", "STATEMENT_TIMEOUT", "MAX_HITS_PER_LESSON", "MAX_SIGNPOSTS",
    "TIER_BOOSTS", "BUDGETS", "Budget", "CourseHit", "Signpost", "KbHit", "CourseSearchResult",
    "search_course", "fill_scan_set", "query_terms", "lexical_overlap", "excerpt",
]
