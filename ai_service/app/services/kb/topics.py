"""The topic tree — what a knowledge base is ABOUT, across all its sources.

This is deliberately a different view from the V435 summary tree:

    summary tree   per source, page-ordered   book → chapter → section
    topic tree     per knowledge base         topic → subtopic

The summary tree answers "where does this come from" and drives coverage
planning inside one book. The topic tree answers "what can I set a test on",
which is the question a teacher is actually asking, and it is the one that has
to span sources: a knowledge base of ten past papers should offer
"Electrochemistry" ONCE, not ten times, and should never offer "pages 1-4" or
"Answer Keys" as if those were subjects.

Built from the section summaries and keywords the ingest already produced, so it
costs one extra LLM call per rebuild rather than a re-read of the corpus.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..llm_json import generate_json
from ..model_selection import resolve_models
from .repository import KbRepository, normalize_topic_title, stable_topic_ids_enabled

logger = logging.getLogger(__name__)

USE_CASE = "knowledge_base_summary"

# Section summaries fed to the topic pass. Bounded so a 20-book knowledge base
# still fits one call; sections are sampled evenly rather than truncated, so late
# material is represented too.
MAX_SECTIONS_IN_PROMPT = 220

MAX_TOPICS = 24
MAX_SUBTOPICS_PER_TOPIC = 12

# Sections that are not teachable material. A past-paper PDF is full of these,
# and without filtering they become "topics" a teacher is offered.
_NON_CONTENT_HINTS = (
    "answer key", "answer keys", "non-content", "front matter", "index",
    "table of contents", "contents", "blank", "cover page", "instructions to candidates",
    "syllabus overview", "acknowledgement", "preface", "copyright",
)


@dataclass
class TopicNode:
    title: str
    summary: Optional[str] = None
    keywords: List[str] = field(default_factory=list)
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    subtopics: List["TopicNode"] = field(default_factory=list)
    # Set by the AUTHORED builder: the one source (chapter) this node is about.
    # Page spans are only meaningful relative to a source, and every chapter
    # PDF starts at page 1.
    source_id: Optional[str] = None
    # AUTHORED trees mint deterministic ids (uuid5 of source + heading) so a
    # rebuild after the next chapter lands does not invalidate the node ids a
    # saved blueprint, a course plan or a question's provenance already holds.
    id: Optional[str] = None


# Knowledge bases whose topic tree is WRITTEN, not derived. Set in
# knowledge_base.meta_json by the curriculum loader (V517).
TOPIC_TREE_MODE_AUTHORED = "AUTHORED"


@dataclass
class TopicTreeResult:
    topics: List[TopicNode] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    model: Optional[str] = None

    @property
    def total_nodes(self) -> int:
        return len(self.topics) + sum(len(t.subtopics) for t in self.topics)


def _is_non_content(title: str, summary: str) -> bool:
    blob = f"{title} {summary}".lower()
    return any(hint in blob for hint in _NON_CONTENT_HINTS)


def _sample(items: List[Any], limit: int) -> List[Any]:
    """Evenly sample so the END of a corpus is represented, not just the start."""
    if len(items) <= limit:
        return items
    step = len(items) / limit
    return [items[int(i * step)] for i in range(limit)]


def _prompt(kb_name: str, sections: List[Dict[str, Any]], subject_hint: Optional[str]) -> str:
    listing = "\n".join(
        f"- [{s.get('source_title') or 'source'} p.{s.get('page_start') or '?'}] "
        f"{s.get('title') or 'Untitled'}: {(s.get('summary') or '')[:200]}"
        + (f" | concepts: {', '.join((s.get('keywords') or [])[:8])}" if s.get("keywords") else "")
        for s in sections
    )
    return f"""You are building the topic map for a teacher's knowledge base called "{kb_name}".
{f'The material is about: {subject_hint}.' if subject_hint else ''}

Below is every section of the material, with its summary and the concepts found in it. These
sections are how the FILE happened to be split — often just page ranges. Your job is to look past
that and produce the SUBJECT structure a teacher would recognise.

MATERIAL:
{listing}

Return STRICT JSON, no prose, no markdown fence:
{{
  "subject": "the overall subject, e.g. 'JEE Main Physics, Chemistry and Mathematics'",
  "topics": [
    {{
      "title": "a real topic a teacher would set a test on, e.g. 'Integral Calculus'",
      "summary": "one line on what this topic covers in THIS material",
      "keywords": ["specific concepts inside it"],
      "subtopics": [
        {{
          "title": "a narrower testable area, e.g. 'Definite integrals and properties'",
          "summary": "one line NAMING the specific tests, tables, named methods and concepts this subtopic covers in the material — e.g. 'Snellen chart, Ishihara plates, accommodation reflex, fundoscopy'. Course slides are generated from these names; a vague summary loses content.",
          "keywords": ["the concepts a question on this would use"]
        }}
      ]
    }}
  ]
}}

RULES THAT MATTER:
- Topics must be SUBJECTS, never page ranges, file names, shift numbers or dates.
  "Integral Calculus" — yes. "Questions p. 1-4", "23 Jan Shift 1", "Answer Keys" — never.
- MERGE across sources. If four different papers all cover electrochemistry, that is ONE topic,
  not four. This is the single most important rule: the whole point is a teacher sees each subject
  once for the entire knowledge base.
- Every topic needs 2-{MAX_SUBTOPICS_PER_TOPIC} subtopics. A topic with no subtopics is too vague
  to set questions from.
- Skip anything that is not teachable content: answer keys, indexes, instructions, blank or
  unreadable pages.
- At most {MAX_TOPICS} topics. If the material is broad, group at the level a syllabus would —
  prefer "Thermodynamics" over fifteen separate laws.
- Order topics the way a syllabus would, not the way the files happened to be uploaded.
- SINGLE COHERENT TEXT (one book/chapter rather than many mixed papers): keep the material's OWN
  section headings as subtopic titles, in the material's own order — teachers review these titles
  against their book, and re-themed names read as missing content. Re-theme titles only when
  merging genuinely overlapping sources.
- GRANULARITY for a single text: aim for roughly ONE subtopic per section heading of the material
  (each becomes one course page) — do NOT compress a chapter's sections into 2 broad subtopics;
  a reviewer comparing against the book reads merged subtopics as dropped content. Never merge
  two different nerves/organs/procedures into one subtopic when the material treats them
  separately.
"""




# ── Heading-derived tree (single-source KBs) ─────────────────────────────────
# Prompt guidance could not stop the model re-theming/merging a textbook's
# structure (three ingests of the same chapter produced 25, 12 and 8 subtopics).
# Same cure as the deterministic course outline: the LLM is demoted from
# ARCHITECT to QUOTER — it may only list the source's headings verbatim, every
# heading is verified as a literal substring of the corpus (invented or renamed
# ones are dropped), and the tree is assembled mechanically from the survivors.

MAX_HEADING_CORPUS_CHARS = 200_000
MIN_VALID_HEADINGS = 4


def _norm(text: str) -> str:
    return " ".join((text or "").split()).casefold()


def _heading_prompt(corpus: str) -> str:
    return f"""Below is a teaching document with [PAGE n] markers.

List its SECTION HEADINGS — the printed titles that divide the material into sections.

Return STRICT JSON, no prose, no markdown fence:
{{"headings": [{{"title": "the heading EXACTLY as printed", "page": 3, "level": 1}}]}}

RULES:
- COPY each heading VERBATIM, character for character, as it appears in the text. Never rename,
  merge, shorten, or invent. Headings that are not exact copies will be discarded.
- In document order.
- "level": 1 for a major section heading, 2 for a sub-heading inside a major section.
- SKIP: figure/table captions (Fig., Table), running page headers/footers, the document title,
  learning-objective bullets, and references.

DOCUMENT:
{corpus}
"""


def _corpus_for_chunks(chunks: List[Dict[str, Any]]) -> str:
    pages: Dict[int, List[str]] = {}
    for c in chunks:
        pages.setdefault(c.get("page_start") or 0, []).append(c.get("content_text") or "")
    return "\n\n".join(
        f"[PAGE {p}]\n" + "\n".join(texts) for p, texts in sorted(pages.items())
    )


def _page_windows(chunks: List[Dict[str, Any]], max_chars: int) -> List[str]:
    """The corpus as page-aligned windows of at most `max_chars` each.

    Splitting between pages (never inside one) keeps every [PAGE n] marker
    with its text, so headings quoted from a window carry the right page.
    """
    pages: Dict[int, List[str]] = {}
    for c in chunks:
        pages.setdefault(c.get("page_start") or 0, []).append(c.get("content_text") or "")
    windows: List[str] = []
    current: List[str] = []
    size = 0
    for p, texts in sorted(pages.items()):
        block = f"[PAGE {p}]\n" + "\n".join(texts)
        if current and size + len(block) > max_chars:
            windows.append("\n\n".join(current))
            current, size = [], 0
        current.append(block)
        size += len(block) + 2
    if current:
        windows.append("\n\n".join(current))
    return windows


async def _verbatim_headings(db: Session, corpus: str, *, label: str) -> List[Dict[str, Any]]:
    """The model lists the corpus's printed headings; only literal quotes survive.

    Returns [{title, page, level, page_end}] in document order (possibly empty).
    Raises on LLM failure — callers decide whether that is fatal.
    """
    primary, fallbacks = resolve_models(db, USE_CASE)
    raw, _model, _usage = await generate_json(
        _heading_prompt(corpus), [primary, *fallbacks], label="kb-headings"
    )
    parsed = json.loads(raw)

    corpus_norm = _norm(corpus)
    valid: List[Dict[str, Any]] = []
    seen = set()
    for h in parsed.get("headings") or []:
        title = str(h.get("title") or "").strip()
        key = _norm(title)
        # The verbatim gate: quoting is the ONLY power the model has here.
        if not (3 <= len(title) <= 120) or key in seen or key not in corpus_norm:
            continue
        seen.add(key)
        try:
            page = int(h.get("page")) or None
        except (TypeError, ValueError):
            page = None
        level = 1 if h.get("level") == 1 else 2
        valid.append({"title": title, "page": page, "level": level})

    # Page span: a heading's section runs to the next heading's page.
    for i, h in enumerate(valid):
        nxt = next((v["page"] for v in valid[i + 1:] if v["page"]), None)
        h["page_end"] = max(h["page"] or 0, (nxt or h["page"] or 0)) or None
    logger.info("Verbatim headings for %s: %d survived", label, len(valid))
    return valid


async def _heading_topics(
    db: Session, repo: KbRepository, kb: Dict[str, Any], kb_id: str
) -> Optional[List[TopicNode]]:
    """Verbatim-verified heading tree, or None to fall back to the LLM tree."""
    sources = [s for s in repo.list_sources(kb_id) if s.get("is_active")]
    if len(sources) != 1:
        return None  # multi-source KBs genuinely need the merging LLM view

    chunks = repo.get_all_chunk_summaries(
        kb_id=kb_id, institute_id=kb["institute_id"], limit=400
    )
    if not chunks:
        return None
    corpus = _corpus_for_chunks(chunks)
    if len(corpus) > MAX_HEADING_CORPUS_CHARS:
        return None  # windowing not implemented; the merge view handles big books

    valid = await _verbatim_headings(db, corpus, label=f"kb={kb_id}")
    if len(valid) < MIN_VALID_HEADINGS:
        logger.info(
            "Heading tree: only %d verbatim headings for kb=%s; falling back", len(valid), kb_id
        )
        return None

    topics: List[TopicNode] = []
    if not any(h["level"] == 1 for h in valid):
        for h in valid:
            h["level"] = 1  # flat document: every heading is a major section
    for h in valid:
        if h["level"] == 1 or not topics:
            topics.append(
                TopicNode(
                    title=h["title"][:300], page_start=h["page"], page_end=h["page_end"]
                )
            )
        else:
            topics[-1].subtopics.append(
                TopicNode(
                    title=h["title"][:300], page_start=h["page"], page_end=h["page_end"]
                )
            )
    # A major section with no sub-headings still teaches itself (the course
    # builder makes one slide from a childless topic), and topic spans widen to
    # cover their children.
    for t in topics:
        spans = [s for n in [t, *t.subtopics] for s in (n.page_start, n.page_end) if s]
        if spans:
            t.page_start, t.page_end = min(spans), max(spans)
    logger.info(
        "Heading tree for kb=%s: %d topics / %d headings, all verbatim-verified",
        kb_id, len(topics), len(valid),
    )
    return topics



# ── Authored tree (curriculum libraries) ─────────────────────────────────────
# One topic per chapter SOURCE, in chapter order, titled from the book's own
# table of contents (source.meta_json.chapter_no / chapter_title, written by the
# loader). Subtopics are the chapter's printed headings, quoted verbatim by the
# same gate the heading tree uses, and cached on the source so a rebuild after
# the fifteenth chapter lands does not re-read the first fourteen.
#
# Nothing here asks a model to decide structure. The LLM merge (below) is free
# to re-theme "Chapter 3: Classification of Elements" into "Periodic Trends";
# a teacher comparing the picker against the book they teach from reads that
# as the chapter being missing.

# Cached under source.meta_json so the LLM quoter runs once per chapter.
_HEADINGS_META_KEY = "headings"


def _chapter_sort_key(source: Dict[str, Any]) -> tuple:
    meta = source.get("meta") or {}
    try:
        no = int(meta.get("chapter_no"))
    except (TypeError, ValueError):
        no = 10_000  # untagged sources go last, in upload order
    return (no, source.get("created_at") or "")


# Headings supplied by hand (the loader's structure files, or an admin edit)
# live here on the source; they take precedence over the LLM quoter.
_MANUAL_HEADINGS_META_KEY = "headings_manual"


_LOOSE_MAP = str.maketrans({"\u2019": "'", "\u2018": "'", "\u201c": '"', "\u201d": '"',
                            "\u2013": "-", "\u2014": "-", "\u00a0": " "})


def _loose(text: str) -> str:
    """_norm plus typographic quotes/dashes folded — a hand-typed heading
    uses ' and -, the PDF text layer usually has ’ and –."""
    return _norm((text or "").translate(_LOOSE_MAP))


def locate_headings(titles: List[str], chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Give hand-written headings their page numbers by finding them in the text.

    Same idea as the quoter's verbatim gate, in reverse: the heading is
    trusted, the page is looked up. A heading that appears nowhere keeps
    page=None — it still becomes a subtopic (a teacher can pick it, and
    retrieval falls back to similarity), it just cannot own a page span.
    """
    pages: Dict[int, str] = {}
    for c in chunks:
        p = c.get("page_start") or 0
        pages[p] = pages.get(p, "") + "\n" + _loose(c.get("content_text") or "")
    ordered = sorted(pages.items())
    cleaned = [" ".join(str(raw).split()).strip() for raw in titles]
    keys = [_loose(t) for t in cleaned]
    # A chapter opener often carries a contents box listing every heading of
    # the chapter on page 1-2. A page where many headings co-occur is that
    # box, not the sections themselves — never locate a heading there.
    toc_pages = {
        pg for pg, txt in ordered[:3]
        if sum(1 for k in keys if k and k in txt) >= 3
    }
    out: List[Dict[str, Any]] = []
    cursor = 0  # headings are in book order; never look backwards
    for title, key in zip(cleaned, keys):
        if not (2 <= len(title) <= 200):
            continue
        page = None
        for idx in range(cursor, len(ordered)):
            pg, txt = ordered[idx]
            if pg in toc_pages:
                continue
            if key in txt:
                page = pg or None
                cursor = idx
                break
        out.append({"title": title, "page": page, "level": 1})
    # Page span: to the next located heading's page.
    for i, h in enumerate(out):
        nxt = next((v["page"] for v in out[i + 1:] if v["page"]), None)
        h["page_end"] = max(h["page"] or 0, (nxt or h["page"] or 0)) or None
    return out


async def _chapter_headings(
    db: Session, repo: KbRepository, kb: Dict[str, Any], source: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Headings for one chapter: hand-supplied (located in the text) beat the
    cached quoter result, which beats a fresh quoter call."""
    meta = source.get("meta") or {}
    manual = meta.get(_MANUAL_HEADINGS_META_KEY)
    if isinstance(manual, list) and manual:
        chunks = repo.get_all_chunk_summaries(
            kb_id=kb["id"], institute_id=kb["institute_id"], limit=400, source_id=source["id"]
        )
        return locate_headings([str(t) for t in manual], chunks)

    cached = meta.get(_HEADINGS_META_KEY)
    if isinstance(cached, list):
        return cached

    chunks = repo.get_all_chunk_summaries(
        kb_id=kb["id"], institute_id=kb["institute_id"], limit=400, source_id=source["id"]
    )
    headings: List[Dict[str, Any]] = []
    try:
        # A long chapter (NCERT Equilibrium is 53 pages, ~200k chars) is read
        # in page-aligned windows rather than skipped: page numbers stay
        # exact inside each window and the lists simply concatenate.
        for window in _page_windows(chunks, MAX_HEADING_CORPUS_CHARS):
            headings.extend(
                await _verbatim_headings(db, window, label=f"source={source['id']}")
            )
    except Exception:  # noqa: BLE001
        logger.warning(
            "Heading extraction failed for source %s; chapter stays childless",
            source["id"], exc_info=True,
        )
        return []  # not cached: a transient failure should be retried next rebuild
    # Cache even an empty result — a chapter with no printed headings (the new
    # NCF books, a poem) will not grow any on a second reading.
    repo.update_source_fields(
        source["id"], kb["institute_id"], meta={_HEADINGS_META_KEY: headings}
    )
    return headings


def _node_id(*parts: str) -> str:
    """Deterministic node id: the same chapter/heading always gets the same id."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "vacademy-kb-node:" + "|".join(parts)))


async def build_authored_tree(
    db: Session, repo: KbRepository, kb: Dict[str, Any], *,
    current_source_id: Optional[str] = None,
) -> List[TopicNode]:
    """Topic = chapter source, subtopic = its printed headings. Deterministic.

    Membership: finished chapters (READY/PARTIAL) plus `current_source_id`,
    the chapter whose ingest is rebuilding the tree right now — its chunks
    are all in, but its status flips only in the finalize step that follows.
    A SIBLING chapter still mid-embedding is deliberately left out: it has
    some chunks already, and quoting headings from a half-embedded corpus
    would cache a truncated heading list against it.
    """
    with_chunks = set(repo.sources_with_chunks(kb["id"]))
    sources = sorted(
        (
            s for s in repo.list_sources(kb["id"])
            if s.get("is_active") and s["id"] in with_chunks
            and (s.get("status") in ("READY", "PARTIAL") or s["id"] == current_source_id)
        ),
        key=_chapter_sort_key,
    )
    # kb.stable_topic_ids: a NEW subtopic id is keyed on the heading text, not
    # its position, so inserting a heading does not shift every id after it.
    # Ids already stored keep matching through replace_topic_tree's key match.
    stable_ids = stable_topic_ids_enabled()
    topics: List[TopicNode] = []
    for source in sources:
        meta = source.get("meta") or {}
        chapter_no = meta.get("chapter_no")
        chapter_title = (meta.get("chapter_title") or source.get("title") or "").strip()
        title = (
            f"Chapter {chapter_no}: {chapter_title}"
            if chapter_no is not None and chapter_title
            and not chapter_title.lower().startswith("chapter")
            else chapter_title or source["title"]
        )
        page_count = int(source.get("page_count") or 0) or None
        topic = TopicNode(
            id=_node_id(kb["id"], source["id"], "chapter"),
            title=title[:300],
            summary=meta.get("chapter_summary"),
            keywords=[str(k) for k in (meta.get("keywords") or [])][:20],
            page_start=1,
            page_end=page_count,
            source_id=source["id"],
        )
        headings = await _chapter_headings(db, repo, kb, source)
        # Only major headings become subtopics: NCERT's "1.2 Nature of Matter"
        # is the unit a teacher sets questions on; its "1.2.1 States" is not.
        majors = [h for h in headings if h.get("level") == 1] or headings
        majors = [h for h in majors if str(h.get("title") or "").strip()][:MAX_SUBTOPICS_PER_TOPIC * 2]
        # Spans are recomputed HERE, over the merged list: a major section runs
        # to the next MAJOR heading (not to its own first sub-heading, and not
        # to the end of the page window the quoter happened to read it in),
        # and the last one runs to the end of the chapter. A heading with no
        # page (hand-supplied, not found in the text) becomes a subtopic with
        # no span: pickable, retrieved by similarity, owning no chunks.
        seen_headings: Dict[str, int] = {}
        for i, h in enumerate(majors):
            page = h.get("page")
            end = None
            if page:
                nxt = next((m["page"] for m in majors[i + 1:] if m.get("page")), None)
                end = max(int(page), int(nxt) if nxt else (page_count or int(page)))
            heading = str(h.get("title") or "")
            if stable_ids:
                # Occurrence suffix only when two headings share a title.
                key = normalize_topic_title(heading)
                seen_headings[key] = seen_headings.get(key, 0) + 1
                occurrence = seen_headings[key]
                sub_id = (
                    _node_id(kb["id"], source["id"], "heading", key)
                    if occurrence == 1
                    else _node_id(kb["id"], source["id"], "heading", key, str(occurrence))
                )
            else:
                sub_id = _node_id(kb["id"], source["id"], str(i), heading)
            topic.subtopics.append(
                TopicNode(
                    id=sub_id,
                    title=str(h.get("title") or "")[:300],
                    page_start=int(page) if page else None,
                    page_end=end,
                    source_id=source["id"],
                )
            )
        topics.append(topic)
    return topics


def _relink_chunks(repo: KbRepository, kb_id: str) -> None:
    """Re-attach chunks now the topic tree exists.

    Ingest links chunks BEFORE this tree is built (subtopic nodes do not exist
    yet), so on first linking everything lands on summary-tree sections and
    node-scoped slide grounding starts blind. Best-effort: linkage failure must
    never fail a tree rebuild."""
    for src in repo.list_sources(kb_id):
        try:
            repo.link_chunks_to_nodes(src["id"])
        except Exception:  # noqa: BLE001
            logger.warning("Chunk relink failed for source %s", src.get("id"), exc_info=True)


async def build_topic_tree(
    db: Session,
    *,
    kb_id: str,
    institute_id: str,
    current_source_id: Optional[str] = None,
) -> TopicTreeResult:
    """Derive and PERSIST the topic tree for one knowledge base.

    Replaces any previous topic tree wholesale — it is a derived view, and
    rebuilding after each ingest is what keeps it describing everything in the KB
    rather than only what existed when the first source landed.
    """
    result = TopicTreeResult()
    repo = KbRepository(db)
    kb = repo.get_kb(kb_id, institute_id)
    if not kb:
        raise ValueError("Knowledge base not found")

    # Curriculum libraries: the tree IS the table of contents. No model ever
    # decides the structure; see build_authored_tree.
    if (kb.get("meta") or {}).get("topic_tree_mode") == TOPIC_TREE_MODE_AUTHORED:
        authored = await build_authored_tree(db, repo, kb, current_source_id=current_source_id)
        if authored:
            repo.replace_topic_tree(kb_id, institute_id, authored)
            _relink_chunks(repo, kb_id)
        result.topics = authored
        logger.info(
            "Authored topic tree for kb=%s: %d chapter(s), %d node(s)",
            kb_id, len(authored), result.total_nodes,
        )
        return result

    # Single-source KBs get the mechanical, verbatim-verified heading tree —
    # structure the reviewer can check against their own book. Any failure
    # falls through to the merging LLM view unchanged.
    try:
        heading_topics = await _heading_topics(db, repo, kb, kb_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Heading tree failed for kb=%s (%s); using LLM tree", kb_id, exc)
        heading_topics = None
    if heading_topics:
        repo.replace_topic_tree(kb_id, institute_id, heading_topics)
        _relink_chunks(repo, kb_id)
        result.topics = heading_topics
        return result

    sections = [
        node for node in repo.get_structure_outline(kb_id, max_nodes=1000)
        if node["level"] == "section" and (node.get("summary") or node.get("keywords"))
        and not _is_non_content(node.get("title") or "", node.get("summary") or "")
    ]
    if not sections:
        logger.info("No teachable sections in kb=%s; topic tree not built", kb_id)
        return result

    primary, fallbacks = resolve_models(db, USE_CASE)
    try:
        raw, model, usage = await generate_json(
            _prompt(kb["name"], _sample(sections, MAX_SECTIONS_IN_PROMPT), kb.get("language_hint")),
            [primary, *fallbacks],
            label="kb-topics",
        )
        parsed = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Topic tree generation failed for kb=%s: %s", kb_id, exc)
        return result

    result.prompt_tokens = int(usage.get("prompt_tokens") or 0)
    result.completion_tokens = int(usage.get("completion_tokens") or 0)
    result.model = model

    # Page span per topic, so a generated row still knows roughly where its
    # material lives even though topics are not page-ordered.
    keyword_pages: Dict[str, List[int]] = {}
    for section in sections:
        for kw in section.get("keywords") or []:
            if section.get("page_start"):
                keyword_pages.setdefault(str(kw).lower(), []).append(int(section["page_start"]))

    def span(keywords: List[str]) -> tuple[Optional[int], Optional[int]]:
        pages = [p for kw in keywords for p in keyword_pages.get(str(kw).lower(), [])]
        return (min(pages), max(pages)) if pages else (None, None)

    for topic_raw in (parsed.get("topics") or [])[:MAX_TOPICS]:
        title = str(topic_raw.get("title") or "").strip()
        if not title or _is_non_content(title, str(topic_raw.get("summary") or "")):
            continue
        keywords = [str(k).strip() for k in (topic_raw.get("keywords") or []) if str(k).strip()][:20]
        start, end = span(keywords)
        topic = TopicNode(
            title=title[:300],
            summary=(str(topic_raw.get("summary") or "").strip() or None),
            keywords=keywords,
            page_start=start,
            page_end=end,
        )
        for sub_raw in (topic_raw.get("subtopics") or [])[:MAX_SUBTOPICS_PER_TOPIC]:
            sub_title = str(sub_raw.get("title") or "").strip()
            if not sub_title or _is_non_content(sub_title, ""):
                continue
            sub_keywords = [
                str(k).strip() for k in (sub_raw.get("keywords") or []) if str(k).strip()
            ][:15]
            sub_start, sub_end = span(sub_keywords or keywords)
            topic.subtopics.append(
                TopicNode(
                    title=sub_title[:300],
                    summary=(str(sub_raw.get("summary") or "").strip() or None),
                    keywords=sub_keywords,
                    page_start=sub_start,
                    page_end=sub_end,
                )
            )
        result.topics.append(topic)

    repo.replace_topic_tree(kb_id, institute_id, result.topics)
    _relink_chunks(repo, kb_id)
    logger.info(
        "Topic tree for kb=%s: %s topic(s), %s node(s) total, %s prompt/%s completion tokens",
        kb_id, len(result.topics), result.total_nodes,
        result.prompt_tokens, result.completion_tokens,
    )
    return result


__all__ = [
    "build_topic_tree", "build_authored_tree", "TopicNode", "TopicTreeResult",
    "MAX_TOPICS", "TOPIC_TREE_MODE_AUTHORED",
]
