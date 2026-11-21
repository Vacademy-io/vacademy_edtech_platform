"""Course knowledge retrieval (CK-08): scoped search, citations, the
search_my_course tool and the prompt blocks.

Most tests run offline against a fake course store patched into retrieval.py,
so they can assert exactly which ids each store call receives:
  * locked (COMING_UP) lessons' text is never fetched, and they come back only
    as signposts;
  * hidden lessons never reach the store as candidates;
  * tier boosts, the per-lesson cap and the mode budgets hold;
  * citations carry &page= / &t=;
  * the post-check drops a forged scan row (course_kb.leak_blocked);
  * a statement timeout retries with the current slide and chapter only;
  * voice text has at most 3 short snippets and no links.

The last tests run the real store, access scope and SQL on Postgres 16 +
pgvector (CK-01 helpers); they skip unless AI_LIMITS_PG_URL / AI_LIMITS_PGDATA
is set.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import types
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services import chat_cards  # noqa: E402
from app.services.course_knowledge import (  # noqa: E402
    access, citations, flags, learner_tool, prompt_blocks, retrieval, settings_store, store,
)
from app.services.course_knowledge.access import Entry, ResolvedScope  # noqa: E402

INST = "inst-1"
USER = "user-1"
DIM = 768
LINKS_MODULE = "app.services.course_knowledge.links"


def run(coro):
    return asyncio.run(coro)


def vec(i: int) -> List[float]:
    v = [0.01] * DIM
    v[i % DIM] = 1.0
    return v


# ── Scope builders ───────────────────────────────────────────────────────────

def entry(slide_id: str, order: int, *, state: str = access.STATE_OPEN, chapter: str = "ch-1",
          batch: str = "ps-1", title: Optional[str] = None, source_type: str = "DOCUMENT",
          hint: Optional[str] = None) -> Entry:
    return Entry(
        slide_id=slide_id, title=title or f"Lesson {slide_id}", source_type=source_type,
        package_id="pkg-1", package_session_id=batch, level_id="lvl-1", subject_id="sub-1",
        module_id="mod-1", chapter_id=chapter, chapter_title=f"Chapter {chapter}", order=order,
        state=state, unlock_hint=hint, chapter_ids=frozenset({chapter}), package_session_ids=frozenset({batch}),
    )


def scope_of(*entries: Entry, current_slide=None, current_chapter=None, current_batch=None,
             institute_id: str = INST) -> ResolvedScope:
    by_id = {e.slide_id: e for e in entries}
    opened = [e for e in entries if e.state == access.STATE_OPEN]
    return ResolvedScope(
        user_id=USER, institute_id=institute_id, tz=access.DEFAULT_TZ, drip_mode="time_exact",
        entries=by_id, current_slide_id=current_slide, current_chapter_id=current_chapter,
        current_package_session_id=current_batch,
        package_session_ids=tuple(dict.fromkeys(e.package_session_id for e in entries)),
        open_chapter_ids=frozenset(e.chapter_id for e in opened),
        open_package_session_ids=frozenset(e.package_session_id for e in opened),
    )


# ── Fake store and sessions ──────────────────────────────────────────────────

class FakeDb:
    def __init__(self, log: List[str]):
        self.log = log

    def execute(self, stmt, params=None):
        self.log.append(str(stmt))
        return None


class FakeStore:
    """Stands in for course_knowledge.store inside retrieval.py.

    `chunks` maps chunk id -> (slide_id, similarity, text, page_start, meta).
    Source id of a lesson is 'src-<slide_id>'."""

    def __init__(self, chunks: Dict[str, tuple], *, counts: Optional[Dict[str, int]] = None,
                 kb_institute: str = INST):
        self.chunks = chunks
        self.counts = counts
        self.kb = store.CourseKb(id="kb-1", institute_id=kb_institute,
                                 embedding_model="google/gemini-embedding-001", embedding_dim=DIM)
        self.stats_calls: List[List[str]] = []
        self.shortlist_calls: List[List[str]] = []
        self.scan_calls: List[List[str]] = []
        self.fetch_calls: List[List[str]] = []
        self.extra_rows: List[store.ScanHit] = []
        self.scan_errors: List[BaseException] = []
        self.open_ids: Optional[set] = None  # ids fetch_texts may receive

    def get_course_kb(self, db, institute_id):
        return self.kb

    def candidate_stats(self, db, kb_id, institute_id, slide_ids):
        self.stats_calls.append(list(slide_ids))
        out = {}
        for s in slide_ids:
            n = (self.counts or {}).get(s)
            if n is None:
                n = sum(1 for v in self.chunks.values() if v[0] == s)
            if n:
                out[s] = (f"src-{s}", n)
        return out

    def centroid_shortlist(self, db, kb_id, institute_id, slide_ids, qvec, limit):
        self.shortlist_calls.append(list(slide_ids))
        return list(slide_ids)[:limit]

    def exact_scan(self, db, *, kb, source_ids, qvec, floor, limit):
        self.scan_calls.append(list(source_ids))
        if self.scan_errors:
            raise self.scan_errors.pop(0)
        rows = [
            store.ScanHit(chunk_id=cid, source_id=f"src-{v[0]}", slide_id=v[0], similarity=v[1],
                          page_start=v[3], page_end=None, meta=v[4] or {})
            for cid, v in self.chunks.items() if f"src-{v[0]}" in source_ids and v[1] > floor
        ] + list(self.extra_rows)
        rows.sort(key=lambda r: -r.similarity)
        return rows[:limit]

    def fetch_texts(self, db, chunk_ids):
        ids = list(chunk_ids)
        self.fetch_calls.append(ids)
        if self.open_ids is not None:
            assert set(ids) <= self.open_ids, f"text fetched for non-OPEN chunks: {set(ids) - self.open_ids}"
        return {cid: self.chunks[cid][2] for cid in ids if cid in self.chunks}


class Timeout(Exception):
    """What psycopg 3 raises for a statement_timeout cancel."""
    sqlstate = "57014"


@pytest.fixture
def fake(monkeypatch):
    state = {"store": None, "sql": [], "open_sessions": 0}

    @contextmanager
    def fake_session():
        state["open_sessions"] += 1
        try:
            yield FakeDb(state["sql"])
        finally:
            state["open_sessions"] -= 1

    async def no_embed(*_a, **_k):
        raise AssertionError("tests pass query_vec unless they patch embed_query")

    monkeypatch.setattr(retrieval, "db_session", fake_session)
    monkeypatch.setattr(retrieval.embedding, "embed_query", no_embed)
    monkeypatch.setattr(flags, "platform_enabled", lambda: True)
    monkeypatch.setattr(flags, "links_enabled", lambda: False)

    def install(s: FakeStore) -> FakeStore:
        state["store"] = s
        for name in ("get_course_kb", "candidate_stats", "centroid_shortlist", "exact_scan", "fetch_texts"):
            monkeypatch.setattr(retrieval.store, name, getattr(s, name))
        return s

    state["install"] = install
    return state


def search(scope, query="heat engines", mode=retrieval.MODE_TOOL, **kw):
    kw.setdefault("query_vec", vec(1))
    return run(retrieval.search_course(scope=scope, query=query, mode=mode, **kw))


# ── Locked and hidden lessons ────────────────────────────────────────────────

def test_locked_lessons_text_is_never_fetched(fake):
    scope = scope_of(
        entry("a", 0), entry("b", 1),
        entry("c", 2, state=access.STATE_COMING_UP, hint="Unlocks on 12 Nov", title="Heat engines"),
    )
    s = fake["install"](FakeStore({
        "a1": ("a", 0.60, "Open text A", None, {}),
        "b1": ("b", 0.55, "Open text B", None, {}),
        "c1": ("c", 0.90, "SECRET locked text", None, {}),
        "c2": ("c", 0.85, "SECRET locked text 2", None, {}),
    }))
    s.open_ids = {"a1", "b1"}
    result = search(scope)
    assert [h.slide_id for h in result.hits] == ["a", "b"]
    assert [sp.to_dict() for sp in result.signposts] == [{
        "slide_id": "c", "title": "Heat engines", "chapter_title": "Chapter ch-1",
        "unlock_hint": "Unlocks on 12 Nov",
    }]
    fetched = {cid for call in s.fetch_calls for cid in call}
    assert fetched == {"a1", "b1"}
    block = prompt_blocks.format_course_block(result)
    assert "SECRET" not in block and "SECRET" not in prompt_blocks.format_tool_text(result, "q")
    assert result.leak_blocked == 0


def test_signposts_only_when_ranked_inside_top_k_and_at_most_two(fake):
    open_entries = [entry(f"o{i}", i) for i in range(4)]
    locked = [entry(f"l{i}", 10 + i, state=access.STATE_COMING_UP, hint="Not open yet") for i in range(4)]
    chunks = {f"o{i}c": (f"o{i}", 0.80 - i * 0.01, f"open {i}", None, {}) for i in range(4)}
    chunks.update({f"l{i}c": (f"l{i}", 0.95 - i * 0.01, "locked", None, {}) for i in range(3)})
    chunks["l3c"] = ("l3", 0.31, "locked", None, {})  # ranks far below the top k
    fake["install"](FakeStore(chunks))
    result = search(scope_of(*open_entries, *locked), top_k=4)
    assert [s.slide_id for s in result.signposts] == ["l0", "l1"]
    assert len(result.hits) == 4


def test_hidden_lessons_never_reach_the_store(fake):
    # 'h' is hidden for this learner: access.py leaves it out of the scope,
    # and an entry in any state other than OPEN / COMING_UP is ignored too.
    odd = entry("odd", 5, state="HIDDEN")
    scope = scope_of(entry("a", 0), entry("c", 1, state=access.STATE_COMING_UP), odd)
    s = fake["install"](FakeStore({
        "a1": ("a", 0.6, "A", None, {}),
        "h1": ("h", 0.99, "hidden", None, {}),
        "x1": ("odd", 0.99, "odd", None, {}),
    }))
    result = search(scope)
    asked = {sid for call in s.stats_calls + s.shortlist_calls for sid in call}
    assert asked == {"a", "c"}
    assert all("src-h" not in call and "src-odd" not in call for call in s.scan_calls)
    assert [h.slide_id for h in result.hits] == ["a"]


def test_scope_of_another_institute_or_disabled_platform_reads_nothing(fake, monkeypatch):
    s = fake["install"](FakeStore({"a1": ("a", 0.9, "A", None, {})}, kb_institute="inst-other"))
    result = search(scope_of(entry("a", 0)))
    assert result.is_empty and result.error == "failed"
    assert not s.scan_calls

    monkeypatch.setattr(flags, "platform_enabled", lambda: False)
    result = search(scope_of(entry("a", 0)))
    assert result.is_empty and result.error == "disabled"
    assert not fake["sql"]

    empty = ResolvedScope(user_id=USER, institute_id=INST, tz=access.DEFAULT_TZ, drip_mode="time_exact")
    assert search(empty).error == "no_scope"


def test_no_course_kb_returns_empty(fake, monkeypatch):
    s = fake["install"](FakeStore({}))
    monkeypatch.setattr(retrieval.store, "get_course_kb", lambda db, inst: None)
    result = search(scope_of(entry("a", 0)))
    assert result.is_empty and result.error == "no_kb"
    assert not s.stats_calls


# ── Ranking ──────────────────────────────────────────────────────────────────

def test_tier_boosts_are_applied(fake):
    scope = scope_of(
        entry("other", 0, chapter="ch-9", batch="ps-9"),
        entry("batch", 1, chapter="ch-8", batch="ps-1"),
        entry("chap", 2, chapter="ch-1"),
        entry("cur", 3, chapter="ch-1"),
        current_slide="cur", current_chapter="ch-1", current_batch="ps-1",
    )
    fake["install"](FakeStore({
        "o": ("other", 0.50, "zzz", None, {}),
        "b": ("batch", 0.50, "zzz", None, {}),
        "c": ("chap", 0.50, "zzz", None, {}),
        "s": ("cur", 0.50, "zzz", None, {}),
    }))
    result = search(scope, query="qqq")  # no lexical overlap: score = similarity x boost
    assert [h.slide_id for h in result.hits] == ["cur", "chap", "batch", "other"]
    scores = {h.slide_id: h.score for h in result.hits}
    assert scores == pytest.approx({"cur": 0.75, "chap": 0.60, "batch": 0.55, "other": 0.50})
    assert [h.tier for h in result.hits] == [0, 1, 2, 3]


def test_lexical_overlap_adds_at_most_point_zero_five(fake):
    fake["install"](FakeStore({
        "a1": ("a", 0.50, "nothing in common", None, {}),
        "b1": ("b", 0.49, "the carnot cycle of a heat engine", None, {}),
    }))
    result = search(scope_of(entry("a", 0), entry("b", 1)), query="Carnot heat engine")
    assert [h.slide_id for h in result.hits] == ["b", "a"]
    assert result.hits[0].score == pytest.approx(0.49 + 0.05)
    assert retrieval.query_terms("Ｃａｒｎｏｔ is a  heat-engine") == ["carnot", "heat", "engine"]


def test_per_lesson_cap_holds(fake):
    chunks = {f"a{i}": ("a", 0.9 - i * 0.01, f"a text {i}", None, {}) for i in range(5)}
    chunks.update({"b1": ("b", 0.4, "b text", None, {}), "c1": ("c", 0.39, "c text", None, {})})
    fake["install"](FakeStore(chunks))
    result = search(scope_of(entry("a", 0), entry("b", 1), entry("c", 2)))
    assert [h.slide_id for h in result.hits] == ["a", "a", "b", "c"]
    assert [h.chunk_id for h in result.hits][:2] == ["a0", "a1"]


def test_similarity_floor_by_mode(fake):
    fake["install"](FakeStore({"a1": ("a", 0.32, "close-ish", None, {})}))
    scope = scope_of(entry("a", 0))
    assert len(search(scope, mode=retrieval.MODE_TOOL).hits) == 1
    assert search(scope, mode=retrieval.MODE_AMBIENT).hits == ()


def test_scan_set_fills_in_tier_order_and_shortlists_the_overflow(fake):
    entries = [entry(f"s{i}", i, chapter="ch-1" if i >= 8 else "ch-2") for i in range(10)]
    counts = {f"s{i}": 400 for i in range(10)}
    s = fake["install"](FakeStore({f"s{i}c": (f"s{i}", 0.5, "t", None, {}) for i in range(10)}, counts=counts))
    search(scope_of(*entries, current_chapter="ch-1"))
    assert s.stats_calls[0][:2] == ["s8", "s9"]  # current chapter first
    scanned_first = s.scan_calls[0]
    assert "src-s8" in scanned_first and "src-s9" in scanned_first
    assert s.shortlist_calls == [["s5", "s6", "s7"]]  # 7 x 400 fit in 3000
    assert len(scanned_first) == 10  # the shortlist is added to the exact set
    assert any("SET LOCAL statement_timeout = '1500ms'" in q for q in fake["sql"])
    chosen, overflow = retrieval.fill_scan_set(["x", "y", "z"], {"x": ("1", 2000), "y": ("2", 1500), "z": ("3", 900)})
    assert chosen == ["x", "z"] and overflow == ["y"]


def test_query_is_embedded_with_no_session_open(fake, monkeypatch):
    fake["install"](FakeStore({"a1": ("a", 0.6, "A", None, {})}))
    seen = {}

    async def embed(inst, model, query):
        seen["open"] = fake["open_sessions"]
        seen["args"] = (inst, model, query)
        return vec(1)

    monkeypatch.setattr(retrieval.embedding, "embed_query", embed)
    result = run(retrieval.search_course(scope=scope_of(entry("a", 0)), query="what is entropy",
                                         mode=retrieval.MODE_AMBIENT))
    assert seen == {"open": 0, "args": (INST, "google/gemini-embedding-001", "what is entropy")}
    assert len(result.hits) == 1

    async def no_vector(*_a):
        return None

    monkeypatch.setattr(retrieval.embedding, "embed_query", no_vector)
    result = run(retrieval.search_course(scope=scope_of(entry("a", 0)), query="x", mode="tool"))
    assert result.is_empty and result.error == "no_vector"
    with pytest.raises(ValueError):
        run(retrieval.search_course(scope=scope_of(entry("a", 0)), query="x", mode="loud"))


# ── Budgets ──────────────────────────────────────────────────────────────────

def test_ambient_budget_truncates(fake):
    long = "word " * 600  # 3000 chars
    chunks = {f"c{i}": (f"s{i}", 0.9 - i * 0.01, long, None, {}) for i in range(6)}
    fake["install"](FakeStore(chunks))
    result = search(scope_of(*[entry(f"s{i}", i) for i in range(6)]), mode=retrieval.MODE_AMBIENT)
    assert len(result.hits) == 4
    assert all(len(h.excerpt) <= 1200 for h in result.hits)
    assert sum(len(h.excerpt) for h in result.hits) <= 4000
    assert result.truncated
    assert all(h.excerpt.endswith("…") for h in result.hits)


def test_tool_and_preview_budgets(fake):
    long = "alpha beta gamma " * 200
    chunks = {f"c{i}": (f"s{i}", 0.9 - i * 0.01, long, None, {}) for i in range(10)}
    fake["install"](FakeStore(chunks))
    scope = scope_of(*[entry(f"s{i}", i, title="T" * 150) for i in range(10)])
    tool = search(scope, mode=retrieval.MODE_TOOL)
    assert len(tool.hits) <= 6
    text = prompt_blocks.format_tool_text(tool, "alpha")
    assert len(text) <= prompt_blocks.TOOL_NOTE_MAX_CHARS
    assert text.startswith('Course passages for "alpha"')
    preview = search(scope, mode=retrieval.MODE_PREVIEW)
    assert len(preview.hits) == 8
    assert all(len(h.excerpt) <= 400 for h in preview.hits)
    d = preview.hits[0].preview_dict()
    assert set(d) == {"slide_id", "title", "chapter_name", "excerpt", "page", "t_start_ms", "score", "href"}


def test_tool_note_limit_matches_history_replay():
    from app.services.context_window_service import TOOL_NOTE_MAX_CHARS
    assert prompt_blocks.TOOL_NOTE_MAX_CHARS == TOOL_NOTE_MAX_CHARS


def test_voice_text_length(fake):
    long = "spoken words here " * 100
    chunks = {f"c{i}": (f"s{i}", 0.9 - i * 0.01, long, 4 if i == 0 else None, {}) for i in range(6)}
    fake["install"](FakeStore(chunks))
    scope = scope_of(*[entry(f"s{i}", i) for i in range(6)],
                     entry("lk", 9, state=access.STATE_COMING_UP, hint="Unlocks on 12 Nov"))
    fake["store"].chunks["lk1"] = ("lk", 0.95, "locked", None, {})
    result = search(scope, mode=retrieval.MODE_VOICE)
    assert len(result.hits) <= 3
    assert all(len(h.excerpt) <= 300 for h in result.hits)
    spoken = prompt_blocks.format_voice_text(result)
    snippets = [line for line in spoken.splitlines() if line.startswith("From ")]
    assert 1 <= len(snippets) <= 3
    for line in snippets:
        assert len(line.split(": ", 1)[1]) <= 300
    assert "http" not in spoken and "/study-library" not in spoken and "[" not in spoken
    assert 'Coming up, locked: "Lesson lk" — Unlocks on 12 Nov' in spoken
    assert "(p. 4)" in snippets[0]


# ── Citations ────────────────────────────────────────────────────────────────

def test_hrefs_carry_page_or_t(fake):
    fake["install"](FakeStore({
        "p": ("pdf", 0.9, "page text", 12, {"text_kind": "pdf"}),
        "v": ("vid", 0.8, "video text", None, {"t_start_ms": 271_500, "text_kind": "captions"}),
        "d": ("deck", 0.7, "deck text", None, {"step": 3}),
        "h": ("html", 0.6, "html text", None, {"label": "Intro"}),
        "q": ("quiz", 0.5, "question text", None, {"question_no": 2}),
    }))
    scope = scope_of(entry("pdf", 0), entry("vid", 1, source_type="VIDEO"), entry("deck", 2),
                     entry("html", 3), entry("quiz", 4, source_type="QUIZ"))
    hits = {h.slide_id: h for h in search(scope).hits}
    assert hits["pdf"].href.endswith("&page=12") and "slideId=pdf" in hits["pdf"].href
    assert hits["pdf"].href.startswith(
        "/study-library/courses/course-details/subjects/modules/chapters/slides?courseId=pkg-1")
    assert (hits["pdf"].badge, hits["pdf"].icon) == ("p. 12", "pdf")
    assert hits["pdf"].label == "Chapter ch-1 › Lesson pdf (p. 12)"
    assert hits["vid"].href.endswith("&t=271") and "&page=" not in hits["vid"].href
    assert (hits["vid"].badge, hits["vid"].icon, hits["vid"].t_start_ms) == ("04:31", "video", 271_500)
    assert (hits["deck"].badge, hits["deck"].icon) == ("Step 3", "slide")
    assert "&page=" not in hits["deck"].href and "&t=" not in hits["deck"].href
    assert hits["html"].badge is None and hits["html"].label == "Chapter ch-1 › Lesson html"
    assert hits["quiz"].icon == "quiz"
    for h in hits.values():
        assert h.icon in chat_cards.CARD_ICONS
        assert chat_cards.safe_href(h.href) == h.href
    block = prompt_blocks.format_course_block(search(scope))
    assert "[1] Lesson pdf — p. 12: page text" in block
    assert "[4] Lesson html — Intro: html text" in block


def test_citation_helpers():
    a = citations.anchor_of(None, None, {"t_start_ms": 0})
    assert citations.badge_for(a) == "00:00"
    assert citations.deep_link(entry("x", 0), a).endswith("slideId=x&sessionId=ps-1")  # no &t=0
    assert citations.clock(3725) == "1:02:05"
    assert citations.anchor_of(0, None, {}).kind == citations.ANCHOR_NONE  # page 0 is not a page
    assert citations.locked_badge("After you finish A; Unlocks on 3 Jan 2027") == "Locked · unlocks 3 Jan 2027"
    assert citations.locked_badge("After you finish A") == "Locked"
    assert citations.page_label(3, 5) == "pp. 3–5" and citations.page_label(None) is None
    assert citations.locked_link(entry("x", 0)) == "/study-library/courses/course-details?courseId=pkg-1&packageSessionId=ps-1"
    for icon in (citations.ICON_PDF, citations.ICON_VIDEO, citations.ICON_QUIZ, citations.ICON_SLIDE):
        assert icon in chat_cards.CARD_ICONS


# ── Post-check and timeouts ──────────────────────────────────────────────────

def test_post_check_drops_a_forged_hit(fake, caplog):
    s = fake["install"](FakeStore({"a1": ("a", 0.5, "A text", None, {})}))
    s.extra_rows = [
        # A lesson outside the scope, and an OPEN slide id on a source it does not own.
        store.ScanHit(chunk_id="z9", source_id="src-secret", slide_id="secret", similarity=0.99,
                      page_start=None, page_end=None, meta={}),
        store.ScanHit(chunk_id="z8", source_id="src-other", slide_id="a", similarity=0.98,
                      page_start=None, page_end=None, meta={}),
    ]
    s.open_ids = {"a1"}
    with caplog.at_level(logging.ERROR, logger=retrieval.__name__):
        result = search(scope_of(entry("a", 0)))
    assert [h.chunk_id for h in result.hits] == ["a1"]
    assert result.leak_blocked == 2
    assert sum("course_kb.leak_blocked" in r.getMessage() for r in caplog.records) == 2


def test_post_check_on_ranked_hits(fake, caplog, monkeypatch):
    """The final check against open_ids() holds even if an earlier step lets a
    row through."""
    fake["install"](FakeStore({"a1": ("a", 0.6, "A", None, {}), "b1": ("b", 0.5, "B", None, {})}))
    scope = scope_of(entry("a", 0), entry("b", 1))
    real_open_ids = ResolvedScope.open_ids
    calls = {"n": 0}

    def open_ids(self):
        calls["n"] += 1
        ids = real_open_ids(self)
        return ids if calls["n"] == 1 else [i for i in ids if i != "b"]  # 'b' vanishes at the end

    monkeypatch.setattr(ResolvedScope, "open_ids", open_ids)
    with caplog.at_level(logging.ERROR, logger=retrieval.__name__):
        result = search(scope)
    assert [h.slide_id for h in result.hits] == ["a"]
    assert result.leak_blocked == 1
    assert any("course_kb.leak_blocked" in r.getMessage() for r in caplog.records)


def test_timeout_falls_back_to_current_slide_and_chapter(fake):
    scope = access.apply_hints(  # the current slide supplies the current chapter
        scope_of(entry("cur", 0, chapter="ch-1"), entry("sib", 1, chapter="ch-1"), entry("far", 2, chapter="ch-2")),
        hint_slide_id="cur")
    assert scope.current_chapter_id == "ch-1"
    s = fake["install"](FakeStore({
        "c1": ("cur", 0.5, "current", None, {}),
        "s1": ("sib", 0.5, "sibling", None, {}),
        "f1": ("far", 0.9, "far away", None, {}),
    }))
    s.scan_errors = [Timeout("canceling statement due to statement timeout")]
    result = search(scope)
    assert sorted(s.stats_calls[1]) == ["cur", "sib"]
    assert [h.slide_id for h in result.hits] == ["cur", "sib"]
    assert result.error is None


def test_timeout_twice_or_without_current_gives_empty(fake, caplog):
    scope = scope_of(entry("cur", 0), entry("far", 1, chapter="ch-2"), current_slide="cur")
    s = fake["install"](FakeStore({"c1": ("cur", 0.5, "current", None, {})}))
    s.scan_errors = [Timeout("x"), Timeout("y")]
    with caplog.at_level(logging.ERROR, logger=retrieval.__name__):
        result = search(scope)
    assert result.is_empty and result.error == "timeout"
    assert len(s.scan_calls) == 2

    s.scan_errors = [RuntimeError("connection reset")]
    result = search(scope)
    assert result.is_empty and result.error == "failed"  # no retry for other errors
    assert len(s.scan_calls) == 3

    s = fake["install"](FakeStore({"a1": ("a", 0.5, "A", None, {}), "b1": ("b", 0.5, "B", None, {})}))
    s.scan_errors = [Timeout("x")]
    result = search(scope_of(entry("a", 0), entry("b", 1)))  # no current slide or chapter
    assert len(s.scan_calls) == 1
    assert result.is_empty and result.error == "timeout"



# ── Linked knowledge bases ───────────────────────────────────────────────────

class FakeRepo:
    kbs: Dict[str, dict] = {}
    searched: List[str] = []

    def __init__(self, db):
        pass

    def get_kb(self, kb_id, institute_id):
        return self.kbs.get(kb_id)

    def is_usable(self, kb, institute_id):
        return kb.get("usable", True)

    def search_chunks(self, *, kb_id, institute_id, query_embedding, embedding_dim, top_k, similarity_threshold):
        FakeRepo.searched.append(kb_id)
        return [{"content_text": f"{kb_id} passage {i}", "page_start": i + 1, "page_end": None,
                 "source_title": f"Book {kb_id}", "similarity_score": 0.8 - i * 0.1} for i in range(5)][:top_k]


def test_linked_kbs_only_when_links_enabled(fake, monkeypatch):
    fake["install"](FakeStore({"a1": ("a", 0.6, "A", None, {})}))
    model = "google/gemini-embedding-001"
    FakeRepo.kbs = {
        "k1": {"id": "k1", "institute_id": INST, "name": "Physics library", "embedding_model": model, "embedding_dim": DIM},
        "k2": {"id": "k2", "institute_id": INST, "name": "Other model", "embedding_model": "other", "embedding_dim": DIM},
        "k3": {"id": "k3", "institute_id": INST, "name": "Third", "embedding_model": model, "embedding_dim": DIM},
    }
    FakeRepo.searched = []
    asked = {}

    def resolve(db, institute_id, package_ids, use_in):
        asked.update(institute_id=institute_id, package_ids=package_ids, use_in=use_in)
        return [{"knowledge_base_id": "k1"}, types.SimpleNamespace(knowledge_base_id="k2"), {"knowledge_base_id": "k3"}]

    monkeypatch.setitem(sys.modules, LINKS_MODULE, types.SimpleNamespace(resolve_course_kb_links=resolve))
    import app.services.kb.repository as repo_mod
    monkeypatch.setattr(repo_mod, "KbRepository", FakeRepo)

    off = search(scope_of(entry("a", 0)))
    assert off.kb_hits == () and FakeRepo.searched == []

    monkeypatch.setattr(flags, "links_enabled", lambda: True)
    result = search(scope_of(entry("a", 0)))
    assert asked == {"institute_id": INST, "package_ids": ["pkg-1"], "use_in": "chatbot"}
    assert FakeRepo.searched == ["k1"]  # k2 has another embedder; k3 is past the 2-KB limit
    assert [(k.source_title, k.page_label) for k in result.kb_hits] == [("Book k1", "p. 1"), ("Book k1", "p. 2")]
    block = prompt_blocks.format_course_block(result)
    assert prompt_blocks.REFERENCE_HEADER in block
    assert "[2] Book k1 — p. 1: k1 passage 0" in block
    card = prompt_blocks.sources_card(result, {2})
    assert card["items"] == [{"title": "Book k1", "subtitle": "Physics library", "icon": "pdf", "badge": "p. 1"}]


def test_linked_kbs_skipped_when_links_module_missing(fake, monkeypatch):
    fake["install"](FakeStore({"a1": ("a", 0.6, "A", None, {})}))
    monkeypatch.setattr(flags, "links_enabled", lambda: True)
    monkeypatch.setitem(sys.modules, LINKS_MODULE, None)  # import raises ImportError
    result = search(scope_of(entry("a", 0)))
    assert len(result.hits) == 1 and result.kb_hits == ()


# ── Prompt blocks and cards ──────────────────────────────────────────────────

def _result_with_everything(fake):
    fake["install"](FakeStore({
        "a1": ("a", 0.9, "Entropy always increases.", 12, {"text_kind": "pdf"}),
        "b1": ("b", 0.8, "Heat flows from hot to cold.", None, {"t_start_ms": 60_000}),
        "c1": ("c", 0.85, "locked", None, {}),
        "d1": ("d", 0.84, "locked", None, {}),
    }))
    scope = scope_of(
        entry("a", 0), entry("b", 1, source_type="VIDEO"),
        entry("c", 2, state=access.STATE_COMING_UP, hint="Unlocks on 12 Nov", title="Heat engines"),
        entry("d", 3, state=access.STATE_COMING_UP, hint="After you finish Lesson b", title="Fridges"),
    )
    return search(scope, mode=retrieval.MODE_AMBIENT)


def test_course_block_order_and_rules(fake):
    result = _result_with_everything(fake)
    block = prompt_blocks.format_course_block(result)
    i_course = block.index("COURSE MATERIAL")
    i_coming = block.index("COMING UP")
    i_rules = block.index("Rules for course material")
    assert i_course < i_coming < i_rules
    assert block.count("Rules for course material") == 1
    assert "[1] Lesson a — p. 12: Entropy always increases." in block
    assert "[2] Lesson b — 01:00: Heat flows from hot to cold." in block
    assert "[3] Heat engines (Chapter ch-1) — Unlocks on 12 Nov" in block
    assert "[4] Fridges (Chapter ch-1) — After you finish Lesson b" in block
    assert "never reveal quiz answers" in block.lower()
    assert "not in the course material yet" in block
    assert prompt_blocks.format_course_block(retrieval.CourseSearchResult()) == ""


def test_sources_card_lists_only_cited_items(fake):
    result = _result_with_everything(fake)
    cited = prompt_blocks.parse_citations("Entropy rises [1]. Fridges come later [4], see [9].")
    assert cited == {1, 4, 9}
    card = prompt_blocks.sources_card(result, cited)
    assert card["kind"] == "link_list" and card["title"] == "Sources"
    first, locked = card["items"]
    assert first["title"] == "Lesson a" and first["href"].endswith("&page=12")
    assert first["badge"] == "p. 12" and first["icon"] == "pdf" and first["subtitle"] == "Chapter ch-1"
    assert locked["badge"] == "Locked"
    assert locked["href"] == "/study-library/courses/course-details?courseId=pkg-1&packageSessionId=ps-1"
    assert locked["subtitle"] == "Chapter ch-1 · After you finish Lesson b"
    dated = prompt_blocks.sources_card(result, [3])["items"][0]
    assert dated["badge"] == "Locked · unlocks 12 Nov"
    assert prompt_blocks.sources_card(result, set()) is None
    assert chat_cards.normalize_card(card) == card


def test_cards_obey_chat_card_limits(fake):
    chunks = {f"c{i}": (f"s{i}", 0.9 - i * 0.01, "t", None, {}) for i in range(12)}
    fake["install"](FakeStore(chunks))
    scope = scope_of(*[entry(f"s{i}", i, title="X" * 300) for i in range(12)])
    result = search(scope, mode=retrieval.MODE_PREVIEW, top_k=12)
    card = prompt_blocks.sources_card(result, range(1, 13))
    assert len(card["items"]) == 10
    assert all(len(i["title"]) <= 200 for i in card["items"])


def test_parse_citations_variants():
    assert prompt_blocks.parse_citations("a [1][2] b [3, 4] c [5](http://x) d [0] e") == {1, 2, 3, 4}
    assert prompt_blocks.parse_citations(None) == set()


def test_tool_text_without_hits_says_so():
    text = prompt_blocks.format_tool_text(retrieval.CourseSearchResult(), "photosynthesis")
    assert "not covered in their course material yet" in text


# ── search_my_course and the ambient context ─────────────────────────────────

@pytest.fixture
def tool_env(fake, monkeypatch):
    scope = scope_of(entry("a", 0), entry("c", 1, state=access.STATE_COMING_UP, hint="Unlocks on 12 Nov"))
    fake["install"](FakeStore({"a1": ("a", 0.7, "Open passage", 3, {}), "c1": ("c", 0.8, "locked", None, {})}))
    calls = {}

    def resolve(db, **kw):
        calls["db"] = db
        calls["kw"] = kw
        calls["open_sessions"] = fake["open_sessions"]
        return scope

    async def embed(inst, model, query):
        calls["query"] = query
        return vec(1)

    monkeypatch.setattr(access, "resolve_scope", resolve)
    monkeypatch.setattr(retrieval.embedding, "embed_query", embed)
    monkeypatch.setattr(settings_store, "learner_gate", lambda inst: settings_store.LearnerGate(active=True, mode="on"))
    return calls


META = {"slide_id": "a", "chapter_id": "ch-1", "package_session_id": "ps-1", "tz": "Europe/London", "name": "x"}


def test_search_my_course_tool_definition():
    fn = learner_tool.SEARCH_MY_COURSE_TOOL["function"]
    assert learner_tool.SEARCH_MY_COURSE_TOOL["type"] == "function"
    assert fn["name"] == "search_my_course"
    assert fn["parameters"]["required"] == ["query"]
    assert fn["parameters"]["properties"]["query"]["type"] == "string"
    assert "never explain them" in fn["description"]


def test_run_search_my_course_uses_its_own_sessions(tool_env):
    out = run(learner_tool.run_search_my_course(
        user_id=USER, institute_id=INST, args=json.dumps({"query": "entropy"}), context_meta=META))
    assert tool_env["db"] is None  # resolve_scope opens and closes its own session
    assert tool_env["kw"] == {"user_id": USER, "institute_id": INST, "tz": "Europe/London",
                              "hint_slide_id": "a", "hint_chapter_id": "ch-1", "hint_package_session_id": "ps-1"}
    assert tool_env["query"] == "entropy"
    assert out.text.startswith('Course passages for "entropy"')
    assert "1. Lesson a — p. 3: Open passage" in out.text
    assert "Lesson c" in out.text and "Unlocks on 12 Nov" in out.text and "locked" not in out.text.split("Coming up")[0][-10:]
    text_part, card = chat_cards.split_tool_output(out)
    assert card["title"] == "From your course"
    assert [i["title"] for i in card["items"]] == ["Lesson a", "Lesson c"]
    assert card["items"][1]["badge"] == "Locked · unlocks 12 Nov"


def test_run_search_my_course_voice_is_text_only(tool_env):
    out = run(learner_tool.run_search_my_course(
        user_id=USER, institute_id=INST, args={"query": "entropy"}, context_meta=None, mode="voice"))
    assert out.card is None
    assert out.text.startswith('From the lesson "Lesson a" (p. 3): Open passage')
    assert "/study-library" not in out.text


def test_run_search_my_course_refuses_without_gate_query_or_identity(tool_env, monkeypatch):
    out = run(learner_tool.run_search_my_course(user_id=USER, institute_id=INST, args={}, context_meta=None))
    assert out.text == learner_tool.NO_QUERY_TEXT
    out = run(learner_tool.run_search_my_course(user_id="", institute_id=INST, args={"query": "x"}, context_meta=None))
    assert out.text == learner_tool.NOT_AVAILABLE_TEXT
    monkeypatch.setattr(settings_store, "learner_gate", lambda inst: settings_store.LearnerGate(active=True, mode="shadow"))
    out = run(learner_tool.run_search_my_course(user_id=USER, institute_id=INST, args={"query": "x"}, context_meta=None))
    assert out.text == learner_tool.NOT_AVAILABLE_TEXT and "db" not in tool_env


def test_run_search_my_course_survives_failures(tool_env, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("db down")

    monkeypatch.setattr(access, "resolve_scope", boom)
    out = run(learner_tool.run_search_my_course(user_id=USER, institute_id=INST, args={"query": "x"}, context_meta=META))
    assert out.text == learner_tool.FAILED_TEXT and out.card is None


def test_course_context_for_turn(tool_env, monkeypatch):
    block, result = run(learner_tool.course_context_for_turn(USER, INST, "entropy", META))
    assert block.startswith("COURSE MATERIAL") and result.mode == retrieval.MODE_AMBIENT
    assert [h.slide_id for h in result.hits] == ["a"]

    # Shadow mode still computes (CK-10 logs it); an inactive gate does not.
    monkeypatch.setattr(settings_store, "learner_gate", lambda inst: settings_store.LearnerGate(active=True, mode="shadow"))
    assert run(learner_tool.course_context_for_turn(USER, INST, "entropy", META))[0] is not None
    monkeypatch.setattr(settings_store, "learner_gate", lambda inst: settings_store.LearnerGate(active=False, mode="off"))
    assert run(learner_tool.course_context_for_turn(USER, INST, "entropy", META)) == (None, None)


def test_course_context_for_turn_nothing_relevant(tool_env, fake):
    fake["install"](FakeStore({}))  # nothing indexed matches
    assert run(learner_tool.course_context_for_turn(USER, INST, "unrelated", META)) == (None, None)
    assert run(learner_tool.course_context_for_turn(USER, INST, "   ", META)) == (None, None)


# ── Real Postgres: store SQL, access scope, timeouts ─────────────────────────

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def Session():
    from course_knowledge_pg_helpers import pg_session_factory
    f = pg_session_factory()
    yield f
    f.close()


@pytest.fixture
def pg(Session, monkeypatch):
    @contextmanager
    def real_session():
        db = Session()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    monkeypatch.setattr(retrieval, "db_session", real_session)
    monkeypatch.setattr(flags, "platform_enabled", lambda: True)
    monkeypatch.setattr(flags, "links_enabled", lambda: False)
    access.invalidate_cache()
    yield Session
    access.invalidate_cache()


def _index(db, kb, slide_id, base, *, page=None, meta=None):
    store.write_slide_index(
        db, kb=kb, slide_id=slide_id, title=f"Lesson {base}", fields={"text_kind": "pdf", "content_hash": f"h{base}"},
        chunks=[store.CourseChunk(content_text=f"Body of lesson {base} about topic{base}", chunk_index=0,
                                  embedding=vec(base), page_start=page, meta_data=meta or {})],
        centroid=vec(base), index_state="READY", meta={},
    )


def test_pg_end_to_end_scope_search_and_signposts(pg, monkeypatch):
    from sqlalchemy import text
    from course_knowledge_pg_helpers import make_course, make_enrolment

    inst, user, outsider = f"inst-{uuid.uuid4().hex[:8]}", str(uuid.uuid4()), str(uuid.uuid4())
    with pg() as db:
        c = make_course(db, inst, 3)
        other = make_course(db, inst, 1)  # same institute, learner not enrolled
        make_enrolment(db, user, c.package_session_id, inst)
        cond = {"behavior": "lock", "rules": [{"type": "date_based", "params": {"unlock_date": "2026-11-12T12:00:00Z"}}]}
        drip_block = {"enabled": True, "applyConfiguredRules": False, "conditions": [
            {"id": "s2", "level": "slide", "level_id": c.slide_ids[2], "drip_condition": [cond]}]}
        db.execute(text("UPDATE institutes SET setting_json = :s WHERE id = :i"), {
            "s": json.dumps({"setting": {"COURSE_SETTING": {"key": "COURSE_SETTING",
                                                            "data": {"dripConditions": drip_block}}}}), "i": inst})
        db.commit()
        kb = store.ensure_course_kb(db, inst)
        _index(db, kb, c.slide_ids[0], 10, page=7)
        _index(db, kb, c.slide_ids[1], 11, meta={"t_start_ms": 95_000})
        _index(db, kb, c.slide_ids[2], 12)
        _index(db, kb, other.slide_ids[0], 13)
        scope = access.resolve_scope(db, user_id=user, institute_id=inst, now=NOW, drip_mode="time_exact",
                                     hint_slide_id=c.slide_ids[1])

    assert scope.open_ids() == c.slide_ids[:2] and scope.coming_up_ids() == [c.slide_ids[2]]

    fetched: List[List[str]] = []
    real_fetch = store.fetch_texts

    def spy(db, ids):
        fetched.append(list(ids))
        return real_fetch(db, ids)

    monkeypatch.setattr(retrieval.store, "fetch_texts", spy)

    page_hit = search(scope, query="topic10", query_vec=vec(10))
    assert [h.slide_id for h in page_hit.hits] == [c.slide_ids[0]]
    hit = page_hit.hits[0]
    assert hit.href.endswith("&page=7") and f"slideId={c.slide_ids[0]}" in hit.href
    assert f"sessionId={c.package_session_id}" in hit.href and hit.excerpt.startswith("Body of lesson 10")

    video_hit = search(scope, query="topic11", query_vec=vec(11)).hits[0]
    assert video_hit.href.endswith("&t=95") and video_hit.badge == "01:35" and video_hit.tier == 0

    locked = search(scope, query="topic12", query_vec=vec(12))
    assert locked.hits == () and [s.slide_id for s in locked.signposts] == [c.slide_ids[2]]
    assert locked.signposts[0].unlock_hint.startswith("Unlocks on 12 Nov")

    not_enrolled = search(scope, query="topic13", query_vec=vec(13))
    assert not_enrolled.is_empty

    with pg() as db:
        locked_chunk = db.execute(text(
            "SELECT c.id FROM kb_chunk c JOIN knowledge_base_source s ON s.id = c.source_id "
            "WHERE s.slide_id = :s"), {"s": c.slide_ids[2]}).scalar()
    assert locked_chunk and all(locked_chunk not in call for call in fetched)

    # Somebody else's scope in the same institute sees nothing of this course.
    with pg() as db:
        empty = access.resolve_scope(db, user_id=outsider, institute_id=inst, now=NOW, drip_mode="time_exact")
    assert search(empty, query_vec=vec(10)).error == "no_scope"


def test_pg_statement_timeout_is_recognised(pg):
    from sqlalchemy import text
    with pytest.raises(Exception) as info:
        with pg() as db:
            db.execute(text("SET LOCAL statement_timeout = '20ms'"))
            db.execute(text("SELECT pg_sleep(1)"))
    assert retrieval._is_timeout(info.value)
    assert not retrieval._is_timeout(RuntimeError("other"))
