"""Retrieval over a knowledge base, and grounded answers with citations.

Two surfaces:

  search()  — ranked chunks with page numbers and hydrated figures. This is the
              primitive Phase 2's course/quiz/paper generators will call.
  ask()     — one grounded, cited answer. This is the Phase 1 trust-builder: it
              is how an admin finds out whether a 600-page ingest actually
              worked, before anything is built on top of the corpus.

Two deliberate differences from the legacy `rag_service`:

  * Full chunk text is returned. rag_service truncates every hit to 1000 chars
    while chunking at 2000, so half of each retrieved chunk is silently
    discarded — which can cut a worked example in half.
  * Retrieval is scoped to ONE knowledge base and filtered by embedding
    dimension, so a KB pinned to one embedder can never be ranked against
    another's vectors.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..api_key_resolver import ApiKeyResolver
from ..embedding_service import EmbeddingService
from ..llm_json import generate_json
from ..model_selection import resolve_models
from .repository import KbRepository

logger = logging.getLogger(__name__)

QA_USE_CASE = "knowledge_base_qa"

DEFAULT_TOP_K = 8
DEFAULT_THRESHOLD = 0.25

# Characters of retrieved context handed to the answering model. Sized for a
# grounded answer, not an essay; Indic text tokenizes ~3x denser than English,
# so this is a character budget rather than a token count on purpose.
MAX_CONTEXT_CHARS = 24000


@dataclass
class Citation:
    source_id: str
    source_title: Optional[str]
    page_start: Optional[int]
    page_end: Optional[int]
    similarity: float
    figures: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def label(self) -> str:
        """Human-readable anchor, e.g. 'NCERT Class 9 Science, p. 214-215'."""
        title = self.source_title or "Source"
        if self.page_start and self.page_end and self.page_end != self.page_start:
            return f"{title}, p. {self.page_start}-{self.page_end}"
        if self.page_start:
            return f"{title}, p. {self.page_start}"
        return title


class KbRetrievalService:
    """Semantic search + grounded answers for one institute."""

    def __init__(self, db: Session):
        self.db = db
        self.repo = KbRepository(db)

    async def _embed_query(
        self, query: str, institute_id: str, model: Optional[str] = None
    ) -> Optional[List[float]]:
        """Embed a query WITH THE MODEL THE TARGET KB WAS INDEXED WITH."""
        embedder = EmbeddingService(ApiKeyResolver(self.db))
        try:
            return await embedder.embed_query(query, institute_id, model=model)
        finally:
            await embedder.close()

    async def search(
        self,
        *,
        kb_id: str,
        institute_id: str,
        query: str,
        top_k: int = DEFAULT_TOP_K,
        similarity_threshold: float = DEFAULT_THRESHOLD,
        source_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Ranked chunks from one KB, each with page anchors and real figures.

        `source_ids` pins the search to particular sources (the chapters a
        teacher ticked in a textbook library)."""
        kb = self.repo.get_kb(kb_id, institute_id)
        if not kb:
            return []

        embedding = await self._embed_query(query, institute_id, model=kb.get("embedding_model"))
        if not embedding:
            logger.warning("KB search: query embedding failed for kb=%s", kb_id)
            return []
        # A zero-norm vector makes pgvector's cosine distance NaN, and Postgres
        # sorts NaN ABOVE every number — so `similarity > threshold` admits every
        # chunk in the corpus and each one comes back looking like a confident
        # match. Refusing here is the difference between "no answer" and an
        # answer cited to arbitrary pages.
        if not any(embedding):
            logger.warning(
                "KB search: degenerate (all-zero) query embedding for kb=%s — "
                "refusing rather than matching everything", kb_id,
            )
            return []

        hits = self.repo.search_chunks(
            kb_id=kb_id,
            # A PLATFORM-owned KB stores rows under its OWN institute_id, not the
            # caller's, so scope the vector query by the KB's owner. Read access
            # was already authorized by get_kb above.
            institute_id=kb["institute_id"],
            query_embedding=embedding,
            embedding_dim=kb["embedding_dim"],
            top_k=top_k,
            similarity_threshold=similarity_threshold,
            source_ids=source_ids,
        )

        # Hydrate figures in one query rather than per hit.
        all_figure_ids = [fid for hit in hits for fid in hit.get("figure_ids", [])]
        figures = self.repo.get_figures_by_ids(all_figure_ids)
        for hit in hits:
            hit["figures"] = [
                figures[fid] for fid in hit.get("figure_ids", []) if fid in figures
            ]
        return hits

    async def search_institute(
        self,
        *,
        institute_id: str,
        query: str,
        top_k: int = 5,
        similarity_threshold: float = 0.35,
        purposes: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Search every active KB an institute owns.

        Backs the chatbot/assistant readers, which have a question but no
        particular KB in mind. Embedding dimension comes from the current default
        embedder: chunks written under a different one are skipped rather than
        cross-ranked, which is the correct failure mode.
        """
        spec = self.repo.get_default_embedding_model()
        embedding = await self._embed_query(query, institute_id, model=spec.model_id)
        # Same NaN trap as search(): a zero-norm vector would match every chunk
        # across every knowledge base the institute owns.
        if not embedding or not any(embedding):
            return []
        return self.repo.search_institute_wide(
            institute_id=institute_id,
            query_embedding=embedding,
            embedding_dim=spec.dim,
            top_k=top_k,
            similarity_threshold=similarity_threshold,
            purposes=purposes,
            embedding_model=spec.model_id,
        )

    # ------------------------------------------------------------------
    # Grounded answering
    # ------------------------------------------------------------------
    async def ask(
        self,
        *,
        kb_id: str,
        institute_id: str,
        question: str,
        history: Optional[List[Dict[str, str]]] = None,
        answer_language: Optional[str] = None,
        top_k: int = DEFAULT_TOP_K,
    ) -> Dict[str, Any]:
        """Answer a question strictly from the KB, with citations.

        Returns {answer, citations[], hits[], grounded, model, usage}.
        `grounded=False` means nothing relevant was retrieved — the answer then
        says so instead of inventing one, which is the whole point of building
        this on a corpus.
        """
        kb = self.repo.get_kb(kb_id, institute_id)
        if not kb:
            raise ValueError("Knowledge base not found")

        hits = await self.search(
            kb_id=kb_id, institute_id=institute_id, query=question, top_k=top_k
        )
        if not hits:
            return {
                "answer": (
                    "I could not find anything about that in this knowledge base. "
                    "Either it is not covered by the material added so far, or the "
                    "wording is far from how the source phrases it — try naming the "
                    "chapter or concept directly."
                ),
                "citations": [],
                "hits": [],
                "grounded": False,
                "model": None,
                "usage": {},
            }

        # Build the context block, budgeted by characters and ordered by rank so
        # the strongest evidence is never the part that gets cut.
        blocks: List[str] = []
        citations: List[Citation] = []
        used = 0
        for idx, hit in enumerate(hits, start=1):
            body = hit["content_text"]
            header = f"[{idx}] {hit.get('source_title') or 'Source'}"
            if hit.get("page_start"):
                header += f", page {hit['page_start']}"
                if hit.get("page_end") and hit["page_end"] != hit["page_start"]:
                    header += f"-{hit['page_end']}"
            figure_note = ""
            if hit.get("figures"):
                figure_note = "\nFigures on these pages: " + "; ".join(
                    f"{f.get('caption') or f.get('kind') or 'figure'}"
                    for f in hit["figures"][:4]
                )
            block = f"{header}\n{body}{figure_note}"
            if used + len(block) > MAX_CONTEXT_CHARS:
                break
            blocks.append(block)
            used += len(block)
            citations.append(
                Citation(
                    source_id=hit["source_id"],
                    source_title=hit.get("source_title"),
                    page_start=hit.get("page_start"),
                    page_end=hit.get("page_end"),
                    similarity=hit.get("similarity_score", 0.0),
                    figures=hit.get("figures", []),
                )
            )

        primary, fallbacks = resolve_models(self.db, QA_USE_CASE)
        history_block = ""
        if history:
            recent = history[-6:]
            history_block = "\n\nCONVERSATION SO FAR:\n" + "\n".join(
                f"{turn.get('role', 'user')}: {turn.get('content', '')[:600]}"
                for turn in recent
            )

        language_line = (
            f"Write the answer in {answer_language}."
            if answer_language
            else "Answer in the same language the question was asked in."
        )

        prompt = f"""You are answering a teacher's question using ONLY the excerpts below, taken from their own knowledge base "{kb['name']}".

{language_line}

RULES:
- Use ONLY the excerpts. If they do not contain the answer, say so plainly — never fill the gap from your own knowledge.
- Cite the excerpt numbers you used, e.g. [1], [3].
- If the excerpts disagree, say that instead of picking one silently.
- Be specific and useful to a teacher: name the concepts, give the actual definition/formula/steps rather than describing that they exist.
{history_block}

EXCERPTS:
{chr(10).join(blocks)}

QUESTION: {question}

Return STRICT JSON, no prose, no markdown fence:
{{
  "answer": "your answer, with [n] citation markers inline",
  "used_excerpts": [1, 3],
  "confident": true/false,
  "follow_up_questions": ["2-3 natural next questions a teacher might ask about this material"]
}}
"""

        try:
            raw, model, usage = await generate_json(
                prompt, [primary, *fallbacks], label="kb-ask"
            )
            parsed = json.loads(raw)
            answer = (parsed.get("answer") or "").strip()
            used_idx = [
                int(n) for n in (parsed.get("used_excerpts") or [])
                if str(n).isdigit() and 1 <= int(n) <= len(citations)
            ]
            follow_ups = [
                str(q).strip() for q in (parsed.get("follow_up_questions") or []) if str(q).strip()
            ][:3]
            confident = bool(parsed.get("confident", True))
        except Exception as exc:  # noqa: BLE001
            logger.error("KB ask failed for kb=%s: %s", kb_id, exc)
            raise RuntimeError("The answer could not be generated. Please try again.") from exc

        # Return only the citations actually used when the model reported them,
        # so the UI does not display sources that had no bearing on the answer.
        shown = [citations[i - 1] for i in used_idx] if used_idx else citations[:3]

        return {
            "answer": answer,
            "grounded": True,
            "confident": confident,
            "follow_up_questions": follow_ups,
            "citations": [
                {
                    "label": c.label,
                    "source_id": c.source_id,
                    "source_title": c.source_title,
                    "page_start": c.page_start,
                    "page_end": c.page_end,
                    "similarity": c.similarity,
                    "figures": c.figures,
                }
                for c in shown
            ],
            "hits": [
                {
                    "source_title": h.get("source_title"),
                    "page_start": h.get("page_start"),
                    "page_end": h.get("page_end"),
                    "similarity": h.get("similarity_score"),
                    "preview": (h.get("content_text") or "")[:280],
                }
                for h in hits
            ],
            "model": model,
            "usage": usage,
        }


__all__ = ["KbRetrievalService", "Citation"]
