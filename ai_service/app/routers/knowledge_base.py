"""Knowledge Base API — named corpora built from real documents (V435).

SECURITY NOTE — this router previously had NO AUTHENTICATION AT ALL. It took
`institute_id` straight from the URL path with no credential check while being
publicly mounted, so any caller could read, overwrite or delete any institute's
knowledge base. Every endpoint here now resolves the institute from a verified
credential (JWT pinned principal / institute API key / internal service token)
and the tenant scope is enforced inside the SQL, not by the caller.

Endpoint groups:
  /bases…              knowledge-base CRUD
  /bases/{id}/sources… add and monitor ingested documents
  /bases/{id}/ask      grounded, cited answers — the Phase 1 trust-builder
  /institute/…/items   DEPRECATED legacy surface, kept working (see bottom)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..core.security import get_pinned_principal
from ..db import db_dependency
from ..dependencies import get_institute_id_or_internal
from ..models.ai_task import AiTaskInputType, AiTaskType
from ..repositories.ai_task_repository import AiTaskRepository
from ..services import ai_task_service
from ..services.ai_billing import preflight_tool_credits
from ..services.ai_task_service import AiTaskService
from ..services.kb import ingest as kb_ingest
from ..services.kb.repository import KbRepository, is_curriculum_kb
from ..services.kb.retrieval import KbRetrievalService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge-base/v1", tags=["knowledge-base"])

VALID_PURPOSES = ("general", "teaching", "question_bank", "institute_info")
VALID_SOURCE_KINDS = ("PDF", "URL", "YOUTUBE", "TEXT")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class Caller:
    """The verified identity behind a request: institute + (optional) user."""

    def __init__(self, institute_id: Optional[str], mode: str, user_id: Optional[str] = None,
                 metering: Any = None):
        self.institute_id = institute_id
        self.mode = mode
        self.user_id = user_id
        # Usage-event attribution for this caller's charges (never changes one).
        self.metering = metering

    def require_institute(self, body_institute_id: Optional[str] = None) -> str:
        """The institute to act for.

        For JWT/API-key callers this is the credential's institute and a body
        value can never override it. Only INTERNAL service callers may name an
        institute in the request, because they have no institute of their own.
        """
        if self.institute_id:
            return self.institute_id
        if self.mode == "INTERNAL" and body_institute_id:
            return body_institute_id
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="institute_id is required for internal service calls",
        )


async def get_caller(
    request: Request,
    x_institute_key: Optional[str] = Header(None, description="Institute API key"),
    x_internal_service_token: Optional[str] = Header(None, description="Server-to-server token"),
    authorization: Optional[str] = Header(None, description="Bearer JWT (dashboard callers)"),
    settings: Settings = Depends(get_settings),
) -> Caller:
    """Triple-auth, additionally surfacing the acting user for credit attribution.

    Mirrors dependencies.get_institute_id_or_internal_or_user but keeps the
    principal's user_id, which that helper discards — without it every KB credit
    transaction would land with user_id NULL and "who ingested this book" would be
    unanswerable.

    The JWT branch goes through get_pinned_principal, NOT get_current_user:
    get_current_user trusts the clientId header verbatim, which would let a member
    of institute A pass clientId=B and spend B's credits on B's corpus.
    """
    from ..services.ai_billing import metering_from_request

    if x_institute_key or x_internal_service_token:
        institute_id, mode = get_institute_id_or_internal(x_institute_key, x_internal_service_token)
        return Caller(institute_id, mode, metering=metering_from_request(request, institute_id, auth_mode=mode))
    if authorization:
        principal = await get_pinned_principal(request, authorization, settings)
        return Caller(principal.institute_id, "INSTITUTE", principal.user_id,
                      metering=metering_from_request(request, principal.institute_id, user=principal))
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=(
            "Missing auth: provide Authorization: Bearer <jwt> with a clientId "
            "header, X-Institute-Key, or X-Internal-Service-Token"
        ),
    )


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class KbCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    purpose: str = "general"
    language_hint: Optional[str] = Field(None, max_length=20)
    institute_id: Optional[str] = None  # INTERNAL callers only
    # Free-form per-base metadata (V517). The curriculum loader sets
    # {topic_tree_mode: "AUTHORED", curriculum: {...}} here.
    meta: Optional[Dict[str, Any]] = None
    # A registered embedder id (kb_embedding_model). Default = the platform
    # default; the curriculum loader picks the in-process BAAI/bge-base-en-v1.5.
    embedding_model: Optional[str] = Field(None, max_length=100)


class KbUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    purpose: Optional[str] = None
    language_hint: Optional[str] = Field(None, max_length=20)
    status: Optional[str] = None


class SourceCreate(BaseModel):
    source_kind: str
    title: Optional[str] = Field(None, max_length=500)
    file_id: Optional[str] = None       # PDF (media_service fileId)
    source_url: Optional[str] = None    # URL / YOUTUBE — or a public PDF URL
    raw_text: Optional[str] = None      # TEXT
    # Client-side page count (pdfjs) used ONLY to pre-flight the credit check
    # fast. The charge is always computed from the server-parsed page count.
    expected_pages: Optional[int] = Field(None, ge=0)
    institute_id: Optional[str] = None  # INTERNAL callers only
    # Per-source metadata, merged into meta_json. The curriculum loader tags
    # chapters here ({chapter_no, chapter_title, book_code, ...}).
    meta: Optional[Dict[str, Any]] = None


class SourceUpdate(BaseModel):
    is_active: Optional[bool] = None
    title: Optional[str] = Field(None, max_length=500)
    meta: Optional[Dict[str, Any]] = None   # merged into meta_json


class EstimateRequest(BaseModel):
    source_kind: str
    num_pages: Optional[int] = Field(None, ge=0)
    file_id: Optional[str] = None
    institute_id: Optional[str] = None


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    history: Optional[List[Dict[str, str]]] = None
    answer_language: Optional[str] = None
    top_k: int = Field(8, ge=1, le=25)
    institute_id: Optional[str] = None


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(8, ge=1, le=50)
    similarity_threshold: float = Field(0.25, ge=0.0, le=1.0)
    institute_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_kb_or_404(repo: KbRepository, kb_id: str, institute_id: str) -> Dict[str, Any]:
    kb = repo.get_kb(kb_id, institute_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return kb


def _require_writable(repo: KbRepository, kb: Dict[str, Any], institute_id: str) -> None:
    if not repo.is_writable(kb, institute_id):
        raise HTTPException(
            status_code=403,
            detail="This is a shared library provided by Vacademy and cannot be edited",
        )


def require_usable(repo: KbRepository, kb: Dict[str, Any], institute_id: str) -> None:
    """Gate every path that reads passages out of the corpus or writes from it.

    Being able to READ a listing is not the right to USE the material: the
    catalogue is deliberately open so an institute can judge a library before
    paying for it. 402 rather than 403 because this is a price, not a
    prohibition — the client turns it into an unlock prompt.
    """
    if repo.is_usable(kb, institute_id):
        return
    raise HTTPException(
        status_code=402,
        detail={
            "message": "Unlock this library to use it",
            "knowledge_base_id": kb["id"],
            "reason": "LIBRARY_LOCKED",
        },
    )


def _preflight_or_402(
    db: Session, *, tool_key: str, tool_params: dict, institute_id: str
) -> dict:
    """Refuse up front when the institute cannot afford the operation.

    `sufficient is None` means the balance is unknown (no wallet row yet), which
    is treated as allow — a missing balance must never hard-block a tenant.
    """
    estimate = preflight_tool_credits(
        db, tool_key=tool_key, tool_params=tool_params, institute_id=institute_id
    )
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "message": (
                    f"This needs about {estimate['estimated_credits']:.0f} credits but "
                    f"only {estimate.get('current_balance', 0):.0f} are available. "
                    "Top up to continue."
                ),
                "estimate": estimate,
            },
        )
    return estimate


def _ingest_meter(caller: Any) -> dict:
    """{"metering": ...} for _start_ingest_task when it takes it (shim-safe)."""
    from ..services.ai_billing import supported_kwargs
    return supported_kwargs(_start_ingest_task, {"metering": getattr(caller, "metering", None)})


def _start_ingest_task(
    db: Session, *, source_id: str, institute_id: str, user_id: Optional[str], source_kind: str,
    metering: Any = None,
) -> str:
    """Create the durable ai_task row and fire the background job."""
    task = AiTaskService(AiTaskRepository(db)).create(
        task_type=AiTaskType.KB_INGEST_SOURCE,
        input_id=source_id,
        input_type=AiTaskInputType.PDF_ID if source_kind == "PDF" else AiTaskInputType.PROMPT_ID,
        task_name=f"KB ingest {source_kind}",
        institute_id=institute_id,
        dynamic_values={"source_id": source_id, "user_id": user_id},
    )
    KbRepository(db).update_source_progress(source_id, ai_task_id=str(task.id))

    async def work() -> str:
        from ..services.ai_billing import supported_kwargs
        return await kb_ingest.ingest_source(
            source_id=source_id, institute_id=institute_id, user_id=user_id,
            **supported_kwargs(kb_ingest.ingest_source, {"metering": metering}),
        )

    ai_task_service.schedule(str(task.id), work)
    return str(task.id)


# ---------------------------------------------------------------------------
# Knowledge bases
# ---------------------------------------------------------------------------

@router.get("/bases")
async def list_bases(
    include_archived: bool = Query(False),
    institute_id: Optional[str] = Query(None, description="INTERNAL callers only"),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Every knowledge base this institute can see (its own + shared libraries)."""
    resolved = caller.require_institute(institute_id)
    return {"knowledge_bases": KbRepository(db).list_kbs(resolved, include_archived)}


@router.post("/bases", status_code=201)
async def create_base(
    body: KbCreate,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    resolved = caller.require_institute(body.institute_id)
    if body.purpose not in VALID_PURPOSES:
        raise HTTPException(400, f"purpose must be one of {VALID_PURPOSES}")
    repo = KbRepository(db)
    # There is a partial unique index enforcing one institute_info KB per
    # institute; refuse here with a clear message rather than surfacing a
    # constraint violation as a 500.
    if body.purpose == "institute_info":
        for existing in repo.list_kbs(resolved, include_archived=True):
            if existing["purpose"] == "institute_info" and existing["institute_id"] == resolved:
                raise HTTPException(
                    409,
                    "An 'Institute Info' knowledge base already exists. Add sources to it instead.",
                )
    try:
        return repo.create_kb(
            institute_id=resolved,
            name=body.name.strip(),
            description=(body.description or "").strip() or None,
            purpose=body.purpose,
            language_hint=body.language_hint,
            created_by=caller.user_id,
            meta=body.meta,
            embedding_model=body.embedding_model,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Knowledge base creation failed")
        raise HTTPException(500, "Could not create the knowledge base") from exc


@router.get("/bases/{kb_id}")
async def get_base(
    kb_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    kb = _load_kb_or_404(repo, kb_id, resolved)
    kb["writable"] = repo.is_writable(kb, resolved)
    kb["sources"] = repo.list_sources(kb_id)
    return kb


@router.patch("/bases/{kb_id}")
async def update_base(
    kb_id: str,
    body: KbUpdate,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    kb = _load_kb_or_404(repo, kb_id, resolved)
    _require_writable(repo, kb, resolved)
    if body.purpose is not None and body.purpose not in VALID_PURPOSES:
        raise HTTPException(400, f"purpose must be one of {VALID_PURPOSES}")
    if body.status is not None and body.status not in ("ACTIVE", "ARCHIVED"):
        raise HTTPException(400, "status must be ACTIVE or ARCHIVED")
    repo.update_kb(
        kb_id, resolved,
        name=body.name, description=body.description, purpose=body.purpose,
        language_hint=body.language_hint, status=body.status,
    )
    return _load_kb_or_404(repo, kb_id, resolved)


@router.delete("/bases/{kb_id}")
async def delete_base(
    kb_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Delete a knowledge base and everything in it. Not reversible."""
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    kb = _load_kb_or_404(repo, kb_id, resolved)
    _require_writable(repo, kb, resolved)
    repo.delete_kb(kb_id, resolved)
    return {"deleted": True}


@router.get("/bases/{kb_id}/outline")
async def get_outline(
    kb_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """The hierarchical summary index — what this corpus actually covers.

    Also the entry point Phase 2's course and question-paper planners read, since
    top-k retrieval cannot see a whole book.
    """
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    kb = _load_kb_or_404(repo, kb_id, resolved)
    # Page-level section summaries of the actual book. Richer than the topic
    # tree the catalogue gives away as a preview, so it needs the unlock.
    require_usable(repo, kb, resolved)
    return {"nodes": repo.get_structure_outline(kb_id)}


@router.get("/bases/{kb_id}/topics")
async def get_topics(
    kb_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """The topic tree — what this knowledge base is about, across all sources.

    This is what the paper builder shows a teacher. Distinct from /outline, which
    is the per-source page-ordered summary tree used for provenance.
    """
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    _load_kb_or_404(repo, kb_id, resolved)
    return {"topics": repo.get_topic_tree(kb_id)}


@router.post("/bases/{kb_id}/topics/rebuild")
async def rebuild_topics(
    kb_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Re-derive the topic tree.

    Normally unnecessary — it rebuilds after every ingest — but useful for a
    knowledge base ingested before topics existed, or after deleting a source.
    """
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    kb = _load_kb_or_404(repo, kb_id, resolved)
    _require_writable(repo, kb, resolved)

    from ..services.kb.topics import build_topic_tree

    try:
        tree = await build_topic_tree(db, kb_id=kb_id, institute_id=resolved)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not tree.topics:
        raise HTTPException(
            422,
            "No topics could be derived yet. Add a document and wait for it to "
            "finish processing.",
        )
    return {"topics": repo.get_topic_tree(kb_id)}


@router.get("/bases/{kb_id}/review-pages")
async def list_review_pages(
    kb_id: str,
    limit: int = Query(100, ge=1, le=500),
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Pages the parser flagged as unreliable — the OCR quality gate."""
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    _load_kb_or_404(repo, kb_id, resolved)
    return {"pages": repo.list_review_pages(kb_id, limit)}


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

@router.get("/bases/{kb_id}/sources")
async def list_sources(
    kb_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    _load_kb_or_404(repo, kb_id, resolved)
    return {"sources": repo.list_sources(kb_id)}


@router.post("/bases/{kb_id}/sources/estimate")
async def estimate_source(
    kb_id: str,
    body: EstimateRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Credit estimate for adding a source, BEFORE committing to it.

    Page count comes from the client (pdfjs) when supplied so the number appears
    instantly, else from the server for an already-uploaded file. Either way this
    is only a preview — the charge is computed from the pages actually parsed.
    """
    resolved = caller.require_institute(body.institute_id)
    repo = KbRepository(db)
    _load_kb_or_404(repo, kb_id, resolved)

    if body.source_kind not in VALID_SOURCE_KINDS:
        raise HTTPException(400, f"source_kind must be one of {VALID_SOURCE_KINDS}")

    if body.source_kind == "PDF":
        pages = body.num_pages
        if pages is None and body.file_id:
            try:
                pages, _ = await kb_ingest.probe_pdf(body.file_id)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(400, f"Could not read that PDF: {exc}") from exc
        if pages is None:
            raise HTTPException(400, "num_pages or file_id is required for a PDF")
        if pages > kb_ingest.parsing.MAX_PAGES_PER_SOURCE:
            raise HTTPException(
                400,
                f"That document has {pages} pages; the limit per upload is "
                f"{kb_ingest.parsing.MAX_PAGES_PER_SOURCE}. Please split it.",
            )
        estimate = preflight_tool_credits(
            db, tool_key="kb_ingest_page", tool_params={"num_pages": pages},
            institute_id=resolved,
        )
        estimate["num_pages"] = pages
        return estimate

    return preflight_tool_credits(
        db, tool_key="kb_ingest_url", tool_params={}, institute_id=resolved
    )


@router.post("/bases/{kb_id}/sources", status_code=202)
async def add_source(
    kb_id: str,
    body: SourceCreate,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Add a source and start ingesting it in the background.

    Returns 202 with the source row; poll GET /sources/{id} for progress.
    """
    resolved = caller.require_institute(body.institute_id)
    repo = KbRepository(db)
    kb = _load_kb_or_404(repo, kb_id, resolved)
    _require_writable(repo, kb, resolved)

    kind = (body.source_kind or "").upper()
    if kind not in VALID_SOURCE_KINDS:
        raise HTTPException(400, f"source_kind must be one of {VALID_SOURCE_KINDS}")

    # --- Per-kind validation + title default ---
    title = (body.title or "").strip()
    content_hash: Optional[str] = None
    expected_pages = body.expected_pages or 0

    if kind == "PDF":
        if not body.file_id and not body.source_url:
            raise HTTPException(400, "file_id (upload) or source_url (public PDF) is required")
        # ONE download yields both the dedup hash and the page count. Fetching
        # them separately meant pulling a 100MB textbook twice per request.
        try:
            expected_pages, content_hash = await kb_ingest.probe_pdf(
                body.file_id, source_url=None if body.file_id else body.source_url
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not read that PDF: {exc}") from exc

        # Dedup on bytes: institutes re-upload the same textbook constantly and
        # re-parsing it is the most wasteful thing this pipeline can do.
        if content_hash:
            existing = repo.find_source_by_hash(kb_id, content_hash)
            if existing:
                return {
                    "source": existing,
                    "task_id": None,
                    "deduplicated": True,
                    "message": (
                        f"'{existing['title']}' is already in this knowledge base "
                        "(identical file), so nothing was re-processed or charged."
                    ),
                }
        # body.expected_pages is the FE's local pdf-lib count, used only to show
        # an instant estimate. The limit and the 402 are enforced on the
        # server-read count, so sending expected_pages=1 for a 900-page book
        # cannot slip past either guard.
        if expected_pages > kb_ingest.parsing.MAX_PAGES_PER_SOURCE:
            raise HTTPException(
                400,
                f"That document has {expected_pages} pages; the limit per upload is "
                f"{kb_ingest.parsing.MAX_PAGES_PER_SOURCE}. Please split it.",
            )
        title = title or "Untitled document"
        if not is_curriculum_kb(kb):
            _preflight_or_402(
                db, tool_key="kb_ingest_page",
                tool_params={"num_pages": expected_pages}, institute_id=resolved,
            )

    elif kind in ("URL", "YOUTUBE"):
        if not body.source_url:
            raise HTTPException(400, "source_url is required")
        if kind == "YOUTUBE" and not kb_ingest.parsing.youtube_video_id(body.source_url):
            raise HTTPException(400, "That does not look like a YouTube video URL")
        title = title or body.source_url[:200]
        if not is_curriculum_kb(kb):
            _preflight_or_402(db, tool_key="kb_ingest_url", tool_params={}, institute_id=resolved)

    else:  # TEXT
        if not (body.raw_text or "").strip():
            raise HTTPException(400, "raw_text is required for a text source")
        title = title or (body.raw_text or "").strip().splitlines()[0][:120]
        # Pasted text is not metered: it costs an embedding call and nothing more,
        # and charging for it would discourage the notes/FAQ use case the
        # institute-info corpus depends on.

    source_id = repo.create_source(
        kb_id=kb_id, institute_id=resolved, source_kind=kind, title=title,
        file_id=body.file_id, source_url=body.source_url, raw_text=body.raw_text,
        content_hash=content_hash, page_count=expected_pages, created_by=caller.user_id,
        meta=body.meta,
    )
    task_id = _start_ingest_task(
        db, source_id=source_id, institute_id=resolved,
        user_id=caller.user_id, source_kind=kind,
        **_ingest_meter(caller),
    )
    return {
        "source": repo.get_source(source_id, resolved),
        "task_id": task_id,
        "deduplicated": False,
    }


@router.get("/sources/{source_id}")
async def get_source(
    source_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Ingest status for one source. Poll this for progress."""
    resolved = caller.require_institute(institute_id)
    source = KbRepository(db).get_source(source_id, resolved)
    if not source:
        raise HTTPException(404, "Source not found")
    return source


@router.patch("/sources/{source_id}")
async def update_source(
    source_id: str,
    body: SourceUpdate,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Toggle a source in/out of retrieval, or rename it.

    Deactivating keeps the chunks (already paid for) and simply filters them out,
    so reactivating is free. The legacy code implemented "inactive" by DELETING
    the embeddings, which made every reactivation silently cost a re-embed.
    """
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    source = repo.get_source(source_id, resolved)
    if not source:
        raise HTTPException(404, "Source not found")
    kb = _load_kb_or_404(repo, source["knowledge_base_id"], resolved)
    _require_writable(repo, kb, resolved)

    if body.is_active is not None:
        repo.set_source_active(source_id, resolved, body.is_active)
        # Legacy items deactivated under the old behaviour had their embeddings
        # deleted, so re-activating one leaves it active with zero chunks and
        # invisible to search. Re-ingest instead of pretending it worked.
        refreshed = repo.get_source(source_id, resolved)
        if body.is_active and refreshed and refreshed["chunk_count"] == 0:
            _start_ingest_task(
                db, source_id=source_id, institute_id=resolved,
                user_id=caller.user_id, source_kind=source["source_kind"],
                **_ingest_meter(caller),
            )
    if body.title or body.meta:
        repo.update_source_fields(
            source_id, resolved,
            title=body.title.strip() if body.title else None, meta=body.meta,
        )
    return repo.get_source(source_id, resolved)


@router.post("/sources/{source_id}/reindex", status_code=202)
async def reindex_source(
    source_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Re-run ingestion for a source (e.g. after a failure).

    Not re-charged: the ingest charge is keyed on the source id, so a retry of an
    already-billed source is idempotent.
    """
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    source = repo.get_source(source_id, resolved)
    if not source:
        raise HTTPException(404, "Source not found")
    kb = _load_kb_or_404(repo, source["knowledge_base_id"], resolved)
    _require_writable(repo, kb, resolved)
    if source["status"] == "PROCESSING":
        raise HTTPException(409, "That source is already being processed")

    task_id = _start_ingest_task(
        db, source_id=source_id, institute_id=resolved,
        user_id=caller.user_id, source_kind=source["source_kind"],
        **_ingest_meter(caller),
    )
    return {"source": repo.get_source(source_id, resolved), "task_id": task_id}


@router.delete("/sources/{source_id}")
async def delete_source(
    source_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    resolved = caller.require_institute(institute_id)
    repo = KbRepository(db)
    source = repo.get_source(source_id, resolved)
    if not source:
        raise HTTPException(404, "Source not found")
    kb = _load_kb_or_404(repo, source["knowledge_base_id"], resolved)
    _require_writable(repo, kb, resolved)
    repo.delete_source(source_id, resolved)
    repo.refresh_stats(source["knowledge_base_id"])
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

@router.post("/bases/{kb_id}/search")
async def search_base(
    kb_id: str,
    body: SearchRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Raw ranked chunks with page anchors and figures. Not metered (no LLM)."""
    resolved = caller.require_institute(body.institute_id)
    repo = KbRepository(db)
    kb = _load_kb_or_404(repo, kb_id, resolved)
    # Returns passages verbatim, so this is squarely "using" the material.
    require_usable(repo, kb, resolved)
    hits = await KbRetrievalService(db).search(
        kb_id=kb_id, institute_id=resolved, query=body.query,
        top_k=body.top_k, similarity_threshold=body.similarity_threshold,
    )
    return {"results": hits, "count": len(hits)}


@router.post("/bases/{kb_id}/ask")
async def ask_base(
    kb_id: str,
    body: AskRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Answer a question strictly from this knowledge base, with citations.

    This is how an admin verifies a corpus is any good before Phase 2 builds
    courses and question papers on top of it.
    """
    resolved = caller.require_institute(body.institute_id)
    repo = KbRepository(db)
    kb = _load_kb_or_404(repo, kb_id, resolved)
    require_usable(repo, kb, resolved)
    _preflight_or_402(db, tool_key="kb_ask", tool_params={}, institute_id=resolved)

    try:
        result = await KbRetrievalService(db).ask(
            kb_id=kb_id, institute_id=resolved, question=body.question,
            history=body.history, answer_language=body.answer_language, top_k=body.top_k,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc

    # Only a real, grounded answer is billed — an "I could not find that" reply
    # made no LLM call and must not cost the institute a credit.
    if result.get("grounded"):
        from ..models.ai_token_usage import RequestType
        from ..services.ai_billing import UC, record_tool_billing

        usage = result.get("usage") or {}
        record_tool_billing(
            tool_key="kb_ask", tool_params={},
            request_type=RequestType.KNOWLEDGE_BASE,
            model=result.get("model") or "unknown",
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            institute_id=resolved, user_id=caller.user_id, user_role="ADMIN",
            use_case=UC.KNOWLEDGE_BASE, metering=getattr(caller, "metering", None),
            usage_context={"kb_id": kb_id, "feature": "kb_ask"},
        )
    result.pop("usage", None)
    return result


# ---------------------------------------------------------------------------
# DEPRECATED legacy surface
#
# The original API was a flat per-institute list of title+content "items", used
# by the AI-settings card and read by the chatbot. Those items now live as TEXT
# sources inside the auto-created "Institute Info" knowledge base (V435 §8), and
# these endpoints are a thin translation layer so existing clients keep working.
#
# They differ from the originals in one important way: they now REQUIRE
# authentication and ignore any institute in the path that the caller is not
# authorized for. That is a deliberate breaking change — the unauthenticated
# behaviour was a cross-tenant read/write hole.
# ---------------------------------------------------------------------------

class LegacyItemCreate(BaseModel):
    title: str
    content: str
    category: str = "general"
    tags: List[str] = []


class LegacyItemUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    is_active: Optional[bool] = None


def _authorize_path_institute(caller: Caller, path_institute_id: str) -> str:
    """Reject a path institute the caller has no claim to. THIS is the IDOR fix."""
    resolved = caller.require_institute(path_institute_id)
    if resolved != path_institute_id:
        raise HTTPException(status_code=403, detail="Not authorized for that institute")
    return resolved


def _institute_info_kb(repo: KbRepository, institute_id: str) -> Dict[str, Any]:
    """The institute's 'Institute Info' KB, created on demand."""
    for kb in repo.list_kbs(institute_id, include_archived=True):
        if kb["purpose"] == "institute_info" and kb["institute_id"] == institute_id:
            return kb
    return repo.create_kb(
        institute_id=institute_id, name="Institute Info",
        description=(
            "Events, policies, processes, FAQs and announcements the AI assistant "
            "answers from."
        ),
        purpose="institute_info", language_hint=None, created_by="legacy-api",
    )


def _legacy_shape(source: Dict[str, Any]) -> Dict[str, Any]:
    """Render a source in the old item shape so existing clients don't break.

    category/tags live in meta_json — V435 backfilled them off the legacy rows,
    so this surface stays lossless.
    """
    meta = source.get("meta") or {}
    tags = meta.get("tags") or []
    return {
        "id": source["id"],
        "title": source["title"],
        "content": source.get("raw_text") or "",
        "category": meta.get("category") or "general",
        "tags": tags if isinstance(tags, list) else [],
        "is_active": source["is_active"],
        "created_at": source.get("created_at") or "",
        "updated_at": source.get("updated_at") or "",
        "status": source["status"],
    }


@router.get("/institute/{institute_id}/items", deprecated=True)
async def legacy_list_items(
    institute_id: str,
    category: Optional[str] = None,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """DEPRECATED — use GET /bases/{kb_id}/sources."""
    resolved = _authorize_path_institute(caller, institute_id)
    repo = KbRepository(db)
    kb = _institute_info_kb(repo, resolved)
    # include_text=True: the legacy contract returns each note's body inline.
    items = [
        _legacy_shape(s)
        for s in repo.list_sources(kb["id"], include_text=True)
        if s["source_kind"] == "TEXT"
    ]
    if category:
        items = [i for i in items if i["category"] == category]
    return items


@router.post("/institute/{institute_id}/items", deprecated=True)
async def legacy_create_item(
    institute_id: str,
    body: LegacyItemCreate,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """DEPRECATED — use POST /bases/{kb_id}/sources with source_kind=TEXT."""
    resolved = _authorize_path_institute(caller, institute_id)
    repo = KbRepository(db)
    kb = _institute_info_kb(repo, resolved)
    if not body.content.strip():
        raise HTTPException(400, "content is required")
    source_id = repo.create_source(
        kb_id=kb["id"], institute_id=resolved, source_kind="TEXT",
        title=body.title.strip() or "Untitled", raw_text=body.content,
        created_by=caller.user_id,
        meta={"category": body.category, "tags": body.tags, "legacy_item": True},
    )
    _start_ingest_task(
        db, source_id=source_id, institute_id=resolved,
        user_id=caller.user_id, source_kind="TEXT",
        **_ingest_meter(caller),
    )
    return _legacy_shape(repo.get_source(source_id, resolved))


@router.put("/institute/{institute_id}/items/{item_id}", deprecated=True)
async def legacy_update_item(
    institute_id: str,
    item_id: str,
    body: LegacyItemUpdate,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """DEPRECATED — use PATCH /sources/{source_id}."""
    resolved = _authorize_path_institute(caller, institute_id)
    repo = KbRepository(db)
    source = repo.get_source(item_id, resolved)
    if not source:
        raise HTTPException(404, "Item not found")

    content_changed = body.content is not None and body.content != (source.get("raw_text") or "")
    meta_patch: Dict[str, Any] = {}
    if body.category is not None:
        meta_patch["category"] = body.category
    if body.tags is not None:
        meta_patch["tags"] = body.tags
    if body.title is not None or body.content is not None or meta_patch:
        repo.update_source_fields(
            item_id, resolved,
            title=body.title, raw_text=body.content,
            meta=meta_patch or None,
        )
    if body.is_active is not None:
        repo.set_source_active(item_id, resolved, body.is_active)

    # Re-embed only when the text actually changed and the item is live.
    still_active = body.is_active if body.is_active is not None else source["is_active"]
    if content_changed and still_active:
        _start_ingest_task(
            db, source_id=item_id, institute_id=resolved,
            user_id=caller.user_id, source_kind="TEXT",
            **_ingest_meter(caller),
        )
    return _legacy_shape(repo.get_source(item_id, resolved))


@router.delete("/institute/{institute_id}/items/{item_id}", deprecated=True)
async def legacy_delete_item(
    institute_id: str,
    item_id: str,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """DEPRECATED — use DELETE /sources/{source_id}."""
    resolved = _authorize_path_institute(caller, institute_id)
    repo = KbRepository(db)
    source = repo.get_source(item_id, resolved)
    if not source:
        raise HTTPException(404, "Item not found")
    repo.delete_source(item_id, resolved)
    repo.refresh_stats(source["knowledge_base_id"])
    return {"deleted": True}
