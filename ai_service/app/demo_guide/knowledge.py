"""What the guide may answer product questions from (SPEC 2.3 rule 5):

  (a) the product facts file (markdown at the product's ``knowledge_url``):
      cut into heading-scoped chunks and searched by keyword. No embedding
      key, no index and no database are needed, so it works on any pod.
  (b) the product-wide how-to help library: the ``help_knowledge`` corpus the
      Vacademy Assistant reads, stored under the ``__global_help__`` sentinel
      institute (services/assistant_tool_registry.py). This needs an embedding
      key; without one, or on any failure, it is simply skipped.

Facts come first; the help library fills the remaining slots.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

CHUNK_CHARS = 900
MAX_CHUNKS = 400
FACT_RESULTS = 4
HELP_RESULTS = 3
HELP_SOURCE_TYPE = "help_knowledge"

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_WORD_RE = re.compile(r"[\wऀ-ॿಀ-೿]{2,}", re.UNICODE)
_STOP = frozenset("""
the a an is are was were be do does did you your yours have has had of for to in on at by and or not no what which
who how can could would should i me my we our us it its this that these those any there with about tell please
from as if so than then also into out up more most much many some such will shall may might want need get got show
le la les un une des du de et ou est sont que qui quoi pour avec sur dans ce cette vous votre nous
kya hai hain ka ki ke ko se mein me par aur ya nahi kaise kitna kitne
""".split())


def words(text: str) -> List[str]:
    out: List[str] = []
    for w in _WORD_RE.findall((text or "").lower()):
        if w in _STOP or w in out:
            continue
        out.append(w)
    return out


def _stem(w: str) -> str:
    """A crude English plural/verb fold so 'fees' finds 'fee' and 'pricing' finds 'price'."""
    for suffix in ("ing", "es", "s"):
        if len(w) > len(suffix) + 3 and w.endswith(suffix):
            return w[:-len(suffix)]
    return w


def _matches(stem: str, bag: set) -> bool:
    """`stem` is in the bag, or shares a 4+ letter root with one of its words (price / pricing)."""
    if stem in bag:
        return True
    if len(stem) < 4:
        return False
    return any(len(b) >= 4 and (b.startswith(stem) or stem.startswith(b)) for b in bag)


def chunk_markdown(markdown: str, size: int = CHUNK_CHARS) -> List[Dict[str, str]]:
    """[{heading, text}]: paragraphs grouped under their heading path, at most `size` characters each."""
    chunks: List[Dict[str, str]] = []
    path: List[Tuple[int, str]] = []
    buf: List[str] = []

    def heading() -> str:
        return " > ".join(h for _lvl, h in path)

    def flush() -> None:
        body = "\n".join(buf).strip()
        buf.clear()
        if not body:
            return
        head = heading()
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        cur = ""
        for p in paragraphs:
            while len(p) > size:                      # one very long paragraph: cut on a sentence or a space
                cut = max(p.rfind(". ", 0, size), p.rfind("\n", 0, size), p.rfind(" ", 0, size))
                cut = cut + 1 if cut > size // 3 else size
                if cur:
                    chunks.append({"heading": head, "text": cur})
                    cur = ""
                chunks.append({"heading": head, "text": p[:cut].strip()})
                p = p[cut:].strip()
            if cur and len(cur) + len(p) + 2 > size:
                chunks.append({"heading": head, "text": cur})
                cur = ""
            cur = f"{cur}\n\n{p}" if cur else p
        if cur:
            chunks.append({"heading": head, "text": cur})

    for line in (markdown or "").replace("\r\n", "\n").split("\n"):
        m = _HEADING_RE.match(line)
        if m:
            flush()
            level = len(m.group(1))
            while path and path[-1][0] >= level:
                path.pop()
            path.append((level, m.group(2).strip("# ").strip()))
        else:
            buf.append(line)
    flush()
    return chunks[:MAX_CHUNKS]


def search_facts(markdown: str, query: str, top_k: int = FACT_RESULTS) -> List[Dict[str, Any]]:
    """Keyword search over the facts file: [{heading, text, score}] best first, [] when nothing matches."""
    q = words(query)
    if not q or not (markdown or "").strip():
        return []
    stems = {_stem(w) for w in q}
    scored: List[Tuple[float, int, Dict[str, str]]] = []
    for i, chunk in enumerate(_chunks_of(markdown)):
        head = chunk["heading"].lower()
        body = chunk["text"].lower()
        body_words = {_stem(w) for w in _WORD_RE.findall(body)}
        head_words = {_stem(w) for w in _WORD_RE.findall(head)}
        hits = sum(1 for s in stems if _matches(s, body_words))
        head_hits = sum(1 for s in stems if _matches(s, head_words))
        if not hits and not head_hits:
            continue
        score = (hits + 1.5 * head_hits) / len(stems)
        scored.append((score, -i, chunk))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [{"heading": c["heading"], "text": c["text"], "score": round(s, 3)} for s, _i, c in scored[:top_k]]


_chunk_cache: Dict[int, Tuple[str, List[Dict[str, str]]]] = {}


def _chunks_of(markdown: str) -> List[Dict[str, str]]:
    key = hash(markdown)
    hit = _chunk_cache.get(key)
    if hit and hit[0] == markdown:
        return hit[1]
    chunks = chunk_markdown(markdown)
    if len(_chunk_cache) > 8:
        _chunk_cache.clear()
    _chunk_cache[key] = (markdown, chunks)
    return chunks


async def search_help(query: str, institute_id: str, top_k: int = HELP_RESULTS) -> List[Dict[str, Any]]:
    """The global how-to library: [{task, steps, score}]. [] when there is no
    embedding key, no match or any failure (never raises)."""
    try:
        from ..db import db_session
        from ..services.api_key_resolver import ApiKeyResolver
        from ..services.assistant_tool_registry import HELP_KNOWLEDGE_INSTITUTE_ID
        from ..services.embedding_service import EmbeddingService
        from ..services.rag_service import RAGService

        with db_session() as db:
            embedder = EmbeddingService(ApiKeyResolver(db))
            try:
                rows = await RAGService(db, embedder).search(
                    query=query, institute_id=HELP_KNOWLEDGE_INSTITUTE_ID, top_k=top_k,
                    similarity_threshold=0.3, source_type=HELP_SOURCE_TYPE)
            finally:
                close = getattr(embedder, "close", None)
                if close is not None:
                    await close()
    except Exception as exc:  # noqa: BLE001 - no key / no corpus / DB down: facts only
        logger.info("demo-guide: help library search skipped (%s)", type(exc).__name__)
        return []
    out = []
    for r in rows or []:
        meta = r.get("metadata") or {}
        steps = str(r.get("content_text") or "").strip()
        if steps:
            out.append({"task": meta.get("task"), "steps": steps[:1500], "score": r.get("similarity_score")})
    return out


async def search(markdown: str, query: str, institute_id: str) -> Dict[str, List[Dict[str, Any]]]:
    """{facts, help}: the facts file first, then the how-to library."""
    facts = search_facts(markdown, query)
    helps = await search_help(query, institute_id, top_k=HELP_RESULTS)
    return {"facts": facts, "help": helps}


def render(found: Dict[str, List[Dict[str, Any]]]) -> Optional[str]:
    """The tool result text: fenced data blocks, or None when nothing was found."""
    from ..site_assistant.tools import fence
    blocks: List[str] = []
    for f in found.get("facts") or []:
        blocks.append(fence("product_facts", f["text"], section=f.get("heading")))
    for h in found.get("help") or []:
        blocks.append(fence("help_library", h["steps"], task=h.get("task")))
    return "\n".join(blocks) if blocks else None
