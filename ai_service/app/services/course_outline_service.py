from __future__ import annotations

import json
import logging
import asyncio
from typing import Any, Optional, AsyncGenerator
from uuid import uuid4

from ..domain.course_metadata import CourseMetadata
from ..ports.course_metadata_port import CourseMetadataPort
from ..ports.llm_client import OutlineLLMClient
from ..schemas.course_outline import CourseOutlineRequest, CourseOutlineResponse, Todo
from .prompt_builder import CourseOutlinePromptBuilder
from .parser import CourseOutlineParser
from .image_service import ImageGenerationService
from .content_generation_service import ContentGenerationService
from .api_key_resolver import ApiKeyResolver
from .token_usage_service import TokenUsageService
from .institute_settings_service import InstituteSettingsService
from ..models.ai_token_usage import ApiProvider, RequestType
from ..core.exceptions import PaymentRequiredError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class CourseOutlineGenerationService:
    """
    High-level orchestration service for course outline generation.

    This class follows SRP by coordinating collaborators that each have
    a focused responsibility:
      - CourseMetadataPort: load metadata from admin-core
      - CourseOutlinePromptBuilder: construct the LLM prompt
      - OutlineLLMClient: call the LLM provider
      - CourseOutlineParser: turn raw output into a typed response
      - ImageGenerationService: generate and upload course images (optional)
    """

    def __init__(
        self,
        llm_client: OutlineLLMClient,
        metadata_port: CourseMetadataPort,
        prompt_builder: CourseOutlinePromptBuilder,
        parser: CourseOutlineParser,
        image_service: Optional[ImageGenerationService] = None,
        content_generation_service: Optional[ContentGenerationService] = None,
        db_session: Optional[Session] = None,
        institute_settings_service: Optional[InstituteSettingsService] = None,
        metering: Any = None,
    ) -> None:
        self._llm_client = llm_client
        # Usage-event attribution (MeteringContext.from_request from the
        # router when it has one); never changes a charge.
        self._metering = metering
        self._metadata_port = metadata_port
        self._prompt_builder = prompt_builder
        self._parser = parser
        self._image_service = image_service or ImageGenerationService()
        self._content_generation_service = content_generation_service
        self._db_session = db_session
        self._institute_settings_service = institute_settings_service
        self._llm_client = llm_client  # Store for content generation service
        # Note: content_generation_service will be initialized later in generate_content_from_coursetree if needed

    def _meter(self, user_id: Optional[str]) -> Any:
        """The router's verified metering context (JWT), else an UNVERIFIED
        one: these routes take user_id from the body/query, so it is kept only
        as usage_context.claimed_user_id and never becomes the event actor."""
        try:
            ctx = getattr(self, "_metering", None)
            if ctx is not None:
                return ctx
            from .ai_billing import metering_unverified
            return metering_unverified(user_id, surface="ADMIN_APP")
        except Exception:  # noqa: BLE001 - attribution must never cost a charge
            return None

    def _resolve_outline_llm(self, request: CourseOutlineRequest):
        """(openai_key, gemini_key, model, fallback_models) for an outline call.

        Model precedence: request.model (wizard pick; honoured when it is an
        active registry model) > institute/user ai_api_keys.default_model >
        the 'outline' use case row > GLM — with the use case chain behind it
        as failover. Keys keep the ApiKeyResolver waterfall (user > institute
        > env)."""
        from ..config import get_settings
        from .model_selection import resolve_models

        settings = get_settings()
        openai_key = settings.openrouter_api_key
        gemini_key = settings.gemini_api_key
        if not self._db_session:
            from .model_selection import resolve_model_sync
            primary, chain = resolve_model_sync("outline", request.model)
            return openai_key, gemini_key, primary, chain

        byo_model = None
        try:
            key_resolver = ApiKeyResolver(self._db_session)
            openai_key, gemini_key, _resolved = key_resolver.resolve_keys(
                institute_id=request.institute_id,
                user_id=request.user_id,
                request_model=request.model,
            )
            if not request.model:
                byo_model = key_resolver.byo_default_model(request.institute_id, request.user_id)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Failed to resolve API keys: {str(e)}, using environment defaults")

        primary, chain = resolve_models(self._db_session, "outline", request.model)
        if byo_model:
            return openai_key, gemini_key, byo_model, [m for m in [primary, *chain] if m != byo_model]
        return openai_key, gemini_key, primary, chain

    async def _outline_llm_call(self, prompt, model, api_key, fallback_models, with_usage: bool):
        """generate_outline[_with_usage] with the failover chain, tolerating
        OutlineLLMClient implementations that predate `fallback_models`."""
        method = (
            self._llm_client.generate_outline_with_usage if with_usage
            else self._llm_client.generate_outline
        )
        if fallback_models:
            try:
                return await method(prompt=prompt, model=model, api_key=api_key, fallback_models=fallback_models)
            except TypeError as exc:
                if "fallback_models" not in str(exc):
                    raise
        return await method(prompt=prompt, model=model, api_key=api_key)

    def _apply_kb_grounding(self, request: CourseOutlineRequest) -> bool:
        """Ground the outline in a knowledge base's topic tree.

        Returns True when it applied, so the caller can skip the PDF path: the
        topic tree describes the WHOLE corpus, while the PDF path can only fit
        the document's first 60k characters. Falling through to both would spend
        a MathPix conversion to make the prompt worse.
        """
        grounding = getattr(request, "kb_grounding", None)
        if not grounding:
            return False
        try:
            from ..db import db_session
            from .kb import course_grounding

            with db_session() as db:
                block = course_grounding.outline_grounding_block(
                    db,
                    kb_id=grounding.knowledge_base_id,
                    institute_id=request.institute_id,
                    node_ids=grounding.node_ids,
                    mode=grounding.mode,
                    # How closely the course must mirror the source, and whether
                    # every source section must become a slide. Chosen in the
                    # create-course UI; defaults replicate the material.
                    fidelity=getattr(grounding, "fidelity", None) or "REPLICATE",
                    coverage=getattr(grounding, "coverage", None) or "FULL",
                )
            if not block:
                return False
            request.user_prompt = f"{request.user_prompt}{block}"
            logger.info(
                "Grounded outline in knowledge base %s (%d topics selected, %s)",
                grounding.knowledge_base_id, len(grounding.node_ids or []), grounding.mode,
            )
            return True
        except Exception as e:  # noqa: BLE001
            logger.warning(f"KB outline grounding failed (continuing): {str(e)}")
            return False

    def _deterministic_outline_from_kb(self, request) -> Optional[CourseOutlineResponse]:
        """Build the outline DIRECTLY from the knowledge base's topic tree.

        For REPLICATE + FULL the client's requirement is "mirror the material":
        two feedback rounds showed that ASKING the LLM to follow the section
        list still lets it rename, re-theme and drop sections. So in that mode
        the outline is constructed deterministically — topics become chapters
        and subtopics become slides, verbatim and in source order — and no LLM
        is involved at outline time at all (the per-slide content pass still
        writes the actual teaching material from the section's own passages).

        Returns None whenever this mode does not apply (no KB grounding, ADAPT
        fidelity, HIGHLIGHTS coverage, no DB, or an unusable/tree-less KB) so
        the caller falls back to the existing LLM outline unchanged.
        """
        # NOTE: module-level `CourseMetadata` (line 9) is the DOMAIN class; the
        # outline response needs the SCHEMA one, so alias it locally.
        from ..schemas.course_outline import (
            CourseMetadata as OutlineCourseMetadata,
            CourseNode,
        )

        grounding = getattr(request, "kb_grounding", None)
        if not grounding or not self._db_session:
            return None
        if (getattr(grounding, "fidelity", None) or "REPLICATE") != "REPLICATE":
            return None
        if (getattr(grounding, "coverage", None) or "FULL") != "FULL":
            return None
        try:
            from ..db import db_session
            from .kb import course_grounding

            with db_session() as db:
                picked = course_grounding.deterministic_sections(
                    db,
                    kb_id=grounding.knowledge_base_id,
                    institute_id=request.institute_id,
                    node_ids=grounding.node_ids,
                )
                # Sections too large for one slide's grounding budget become
                # "Part i of n" slides, each owning a window of the section's
                # chunks — otherwise a big section is taught from its first
                # 28k characters and the rest silently disappears.
                parts_by_node = (
                    course_grounding.plan_section_parts(
                        db,
                        kb_id=grounding.knowledge_base_id,
                        institute_id=request.institute_id,
                        sections=picked["sections"],
                    )
                    if picked else {}
                )
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Deterministic KB outline unavailable ({e}); using LLM outline")
            return None
        if not picked:
            return None

        sections = picked["sections"]
        course_name = (
            sections[0]["title"] if len(sections) == 1 else picked["kb_name"]
        )

        tree_children: list = []
        todos: list = []
        for ci, topic in enumerate(sections, start=1):
            chapter_title = (topic.get("title") or "").strip() or f"Section {ci}"
            # A topic with no subtopics still becomes a chapter with one slide
            # teaching the topic itself.
            slides: list = []
            for node in (topic.get("subtopics") or [topic]):
                parts = parts_by_node.get(node.get("id") or "")
                if not parts:
                    slides.append(node)
                    continue
                base_title = (node.get("title") or "").strip() or chapter_title
                for part in parts:
                    slides.append({
                        **node,
                        "title": f"{base_title} (Part {part['index']} of {part['count']})",
                        "page_start": part.get("page_start") or node.get("page_start"),
                        "page_end": part.get("page_end") or node.get("page_end"),
                        "_part": part,
                        "_base_title": base_title,
                    })
            slide_nodes: list = []
            for si, node in enumerate(slides, start=1):
                title = (node.get("title") or "").strip() or f"{chapter_title} — part {si}"
                part = node.get("_part")
                pages = ""
                if node.get("page_start"):
                    pages = (
                        f" (pages {node['page_start']}-{node['page_end']})"
                        if node.get("page_end") and node["page_end"] != node["page_start"]
                        else f" (page {node['page_start']})"
                    )
                summary = (node.get("summary") or "").strip()
                slide_nodes.append(
                    CourseNode(
                        type="SLIDE",
                        title=title,
                        path=f"COURSE/chapter-{ci}/slide-{si}",
                        order=si,
                        chapter_name=chapter_title,
                    )
                )
                todos.append(
                    Todo(
                        name=f"Generate {title} slide content",
                        title=title,
                        type="DOCUMENT",
                        path=f"C1.CH{ci}.SL{si}",
                        keyword=title,
                        action_type="ADD",
                        prompt=(
                            f"Create a DOCUMENT slide titled exactly '{title}'. "
                            f"Teach this section of the institute's material{pages} "
                            "faithfully and completely — present its own definitions, "
                            "lists, steps and classifications in full, in the section's "
                            "own order and terminology, and do not add topics from "
                            "outside it."
                            + (f" Section overview: {summary}" if summary else "")
                            + (
                                f" This slide is part {part['index']} of {part['count']} of the "
                                f"section '{node.get('_base_title')}': teach only the passages "
                                "provided for this part, and do not summarise or repeat the "
                                "other parts."
                                if part else ""
                            )
                        ),
                        order=len(todos) + 1,
                        chapter_name=chapter_title,
                        metadata={
                            "node_id": node.get("id"),
                            "kb_page_start": node.get("page_start"),
                            "kb_page_end": node.get("page_end"),
                            **(
                                {
                                    "kb_chunk_from": part["chunk_from"],
                                    "kb_chunk_to": part["chunk_to"],
                                    "kb_part_index": part["index"],
                                    "kb_part_count": part["count"],
                                }
                                if part else {}
                            ),
                        },
                    )
                )
            tree_children.append(
                CourseNode(
                    type="CHAPTER",
                    title=chapter_title,
                    path=f"COURSE/chapter-{ci}",
                    order=ci,
                    children=slide_nodes,
                )
            )

        section_list_html = "".join(f"<li>{t['title']}</li>" for t in sections)
        response = CourseOutlineResponse(
            explanation=(
                f"Outline built directly from the material's own structure: "
                f"{len(sections)} section(s), {len(todos)} slide(s), in the "
                "source's order with its original titles."
                + (
                    f" {len(parts_by_node)} large section(s) were split into parts so "
                    "every slide fits its own material."
                    if parts_by_node else ""
                )
            ),
            tree=[
                CourseNode(
                    type="COURSE",
                    title=course_name,
                    path="COURSE",
                    order=1,
                    children=tree_children,
                )
            ],
            todos=todos,
            course_metadata=OutlineCourseMetadata(
                course_name=course_name,
                about_the_course_html=(
                    f"<p>Built from the institute's own material, section by "
                    f"section:</p><ul>{section_list_html}</ul>"
                ),
                why_learn_html=(
                    "<p>Every page is written from the institute's own material, "
                    "in its original order and terminology.</p>"
                ),
                who_should_learn_html=(
                    "<p>Learners following this institute's curriculum.</p>"
                ),
                course_banner_media_id="banner.png",
                course_preview_image_media_id="preview.png",
                tags=[],
                course_depth=3,
            ),
        )
        logger.info(
            "Deterministic KB outline: %d chapters / %d slides (%d sections split) from %s",
            len(sections), len(todos), len(parts_by_node), picked["kb_name"],
        )
        return response

    async def _ground_slides_from_kb(
        self,
        kb_grounding: dict,
        content_todos: list,
        institute_id: Optional[str],
    ) -> None:
        """Retrieve the knowledge base passages for every slide, concurrently.

        Each slide asks about its OWN subject, so a slide on rotational motion is
        written from the pages about rotational motion rather than from whatever
        fitted into the outline prompt. Bounded concurrency: this is one
        embedding call plus one vector query per slide, and a 25-slide course
        should not open 25 sessions at once.
        """
        kb_id = (kb_grounding or {}).get("knowledge_base_id")
        if not kb_id or not institute_id:
            return
        mode = (kb_grounding or {}).get("mode") or "STRICT"
        # Faithful runs retrieve more passages per slide so prescribed
        # sub-sections don't fall outside a narrow top-k and vanish.
        faithful = (
            ((kb_grounding or {}).get("coverage") or "FULL") == "FULL"
            or ((kb_grounding or {}).get("fidelity") or "REPLICATE") == "REPLICATE"
        )

        try:
            from ..db import db_session
            from .kb import course_grounding
        except Exception:  # noqa: BLE001
            logger.warning("KB grounding unavailable; continuing ungrounded")
            return

        semaphore = asyncio.Semaphore(4)
        service = self._content_generation_service
        # Grounding objects by path — the coverage sweep below diffs what the
        # slides retrieved against the KB's full chunk census.
        groundings: dict = {}

        async def one(todo) -> None:
            # Chapter + title: specific enough to retrieve the right pages,
            # short enough to embed cheaply.
            query = " ".join(
                p for p in [
                    getattr(todo, "chapter_name", None),
                    todo.title or todo.name or "",
                ] if p
            ).strip()
            if not query:
                return
            async with semaphore:
                try:
                    # EACH slide owns its session: these run under gather and a
                    # shared Session cannot serve concurrent queries.
                    with db_session() as db:
                        grounding = await course_grounding.ground_slide(
                            db, kb_id=kb_id, institute_id=institute_id,
                            query=query, mode=mode, faithful=faithful,
                            # Deterministic outlines stamp the section's tree id
                            # onto the todo → whole-section grounding; the page
                            # span is the fallback when that node has no linked
                            # chunks (section-only linkage shipped twice).
                            node_id=(todo.metadata or {}).get("node_id"),
                            page_start=(todo.metadata or {}).get("kb_page_start"),
                            page_end=(todo.metadata or {}).get("kb_page_end"),
                            # Split sections: only this part's chunk window.
                            chunk_from=(todo.metadata or {}).get("kb_chunk_from"),
                            chunk_to=(todo.metadata or {}).get("kb_chunk_to"),
                        )
                except Exception:  # noqa: BLE001
                    logger.warning("KB grounding failed for %s", todo.path, exc_info=True)
                    return

            groundings[todo.path] = grounding
            service._kb_grounding_by_path[todo.path] = (
                course_grounding.slide_prompt_block(grounding, mode)
            )
            if grounding.supported:
                service._kb_citations_by_path[todo.path] = grounding.citations
                if grounding.figures:
                    # Reuse the existing figure-embedding path, so KB figures land
                    # in slides through the same code the PDF path already uses.
                    service._document_figures_by_path.setdefault(todo.path, [])
                    service._document_figures_by_path[todo.path].extend(grounding.figures)
            else:
                service._kb_unsupported_paths.append(todo.path)

        await asyncio.gather(*(one(t) for t in content_todos), return_exceptions=True)

        # ── Coverage sweep (faithful runs): no chunk may be invisible to every
        # slide. Retrieval reaches only what node linkage / similarity ranking
        # offer it — the client's "Physical inactivity"/"People-like-me" audit
        # gaps were chunks NO slide retrieved. Diff the census, hand each
        # dropped chunk to the page-nearest slide as explicit extra material.
        if faithful and groundings:
            try:
                from .kb.repository import KbRepository

                with db_session() as db:
                    repo = KbRepository(db)
                    kb = repo.get_kb(kb_id, institute_id)
                    # A course built from a few chapters of a textbook library
                    # must only sweep THOSE chapters: every chapter is its own
                    # source restarting at page 1, and an unscoped census would
                    # hand other chapters' opening pages to these slides as
                    # "uncovered" material. Slides carry their node ids; nodes
                    # of an authored tree carry their source.
                    slide_nodes = [
                        (t.metadata or {}).get("node_id") for t in content_todos
                        if (t.metadata or {}).get("node_id")
                    ]
                    sweep_sources = (
                        repo.get_node_source_ids(kb_id, slide_nodes) if kb and slide_nodes else []
                    )
                    all_chunks = (
                        repo.get_all_chunk_summaries(
                            kb_id=kb_id,
                            institute_id=kb["institute_id"],
                            limit=course_grounding.MAX_SWEEP_CHUNKS,
                            source_ids=sweep_sources or None,
                        )
                        if kb
                        else []
                    )
                assignments = course_grounding.assign_uncovered_chunks(all_chunks, groundings)
                for path, chunks in assignments.items():
                    block = course_grounding.supplement_block(chunks)
                    if block:
                        service._kb_grounding_by_path[path] = (
                            service._kb_grounding_by_path.get(path, "") + block
                        )
                if assignments:
                    logger.info(
                        "Coverage sweep: %d uncovered chunk(s) supplemented onto %d slide(s)",
                        sum(len(c) for c in assignments.values()), len(assignments),
                    )
            except Exception:  # noqa: BLE001
                logger.warning("Coverage sweep failed (continuing without it)", exc_info=True)

        supported = len(content_todos) - len(service._kb_unsupported_paths)
        logger.info(
            "KB grounding: %d/%d slides supported by knowledge base %s (%s)",
            supported, len(content_todos), kb_id, mode,
        )

    async def _apply_reference_grounding(self, request: CourseOutlineRequest) -> None:
        """If reference PDFs were uploaded, ingest them and append their extracted
        text/tables to the user prompt so the outline is built from the actual
        document. Best-effort — a failure leaves the prompt unchanged."""
        # A selected knowledge base is the better source and is already indexed,
        # so it wins outright rather than being concatenated with a PDF dump.
        if self._apply_kb_grounding(request):
            return
        file_ids = getattr(request, "reference_document_file_ids", None)
        if not file_ids:
            return
        try:
            from .course_document_ingest import ingest_documents, MAX_GROUNDING_CHARS_OUTLINE
            # Bound the wait: MathPix polling can take minutes on a slow/large
            # PDF, and grounding must not block the outline stream indefinitely.
            # On timeout we proceed ungrounded — the conversion keeps caching, so
            # the content step still gets the figures (cache hit).
            # Outline only needs the text — skip figure re-hosting (the content
            # pass re-hosts them when it actually embeds them).
            ingest = await asyncio.wait_for(
                ingest_documents(file_ids, rehost_figures=False), timeout=150
            )
            if not ingest.grounding_text:
                return
            source = ingest.grounding_text[:MAX_GROUNDING_CHARS_OUTLINE]
            truncated = " (truncated)" if len(ingest.grounding_text) > len(source) else ""
            figure_note = (
                f"\n\nThe document also contains {len(ingest.figures)} figures/diagrams that will be "
                "embedded into the generated slides — structure the course so its slides follow the "
                "document's sections, so those figures land in the right context."
                if ingest.figures else ""
            )
            request.user_prompt = (
                f"{request.user_prompt}\n\n"
                f"===== SOURCE DOCUMENT{truncated} — build the ENTIRE course strictly from this uploaded "
                "material: use its real structure, section order, facts, terminology, definitions, tables, "
                "and examples. Do NOT pad with generic outside content. =====\n"
                f"{source}\n"
                "===== END SOURCE DOCUMENT ====="
                f"{figure_note}"
            )
            logger.info(
                f"Grounded outline in {len(file_ids)} reference document(s): "
                f"{len(source)} chars, {len(ingest.figures)} figures"
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Reference grounding failed (continuing without it): {str(e)}")

    async def generate_outline(
        self, request: CourseOutlineRequest
    ) -> CourseOutlineResponse:
        # Homework-slide injection keys off the user's OWN words — capture them
        # before grounding appends the document text (which almost always
        # contains "exercise"/"assignment" and would spuriously trigger it).
        original_user_prompt = request.user_prompt

        # REPLICATE+FULL KB courses: build the outline directly from the
        # material's own section tree — no LLM, so it cannot rename, reorder
        # or drop sections (both client feedback rounds hit exactly that).
        det_response = self._deterministic_outline_from_kb(request)
        if det_response is not None:
            det_response = self._add_homework_slides_if_needed(
                det_response, original_user_prompt, skip_llm_todo_filter=True,
                force_homework=getattr(request.generation_options, 'include_assignment', None) if request.generation_options else None,
            )
            return self._apply_structure_options(det_response, request)

        await self._apply_reference_grounding(request)
        metadata: Optional[CourseMetadata] = None

        if request.course_id:
            metadata = await self._metadata_port.load_course_metadata(
                course_id=request.course_id,
                institute_id=request.institute_id,
            )

        # Get institute AI course prompt
        ai_course_prompt = None
        if self._institute_settings_service and self._db_session:
            try:
                ai_settings = self._institute_settings_service.get_ai_course_settings(request.institute_id)
                ai_course_prompt = ai_settings.get("AI_COURSE_PROMPT")
            except Exception as e:
                logger.warning(f"Failed to fetch AI course prompt for institute {request.institute_id}: {str(e)}")

        prompt = self._prompt_builder.build_prompt(
            request=request,
            metadata=metadata,
            ai_course_prompt=ai_course_prompt
        )

        # Resolve API key + model: request model > institute/user default >
        # the 'outline' use case (super-admin portal; GLM by default).
        openai_key, gemini_key, model, fallback_models = self._resolve_outline_llm(request)

        # Generate outline and capture token usage
        if hasattr(self._llm_client, 'generate_outline_with_usage'):
            raw_output, usage_info = await self._outline_llm_call(
                prompt, model, openai_key, fallback_models, with_usage=True,
            )

            # Parametric course_outline charge: max(flat DB rate, actual tokens).
            # Best-effort on a fresh session; idempotent per request.
            if usage_info:
                from .ai_billing import UC, record_tool_billing
                request_id = str(uuid4())
                record_tool_billing(
                    tool_key="course_outline",
                    tool_params={},
                    request_type=RequestType.OUTLINE,
                    model=model,
                    prompt_tokens=usage_info.get("prompt_tokens", 0),
                    completion_tokens=usage_info.get("completion_tokens", 0),
                    institute_id=request.institute_id,
                    user_id=request.user_id,
                    request_id=request_id,
                    idempotency_key=f"course_outline:{request_id}",
                    use_case=UC.COURSE_OUTLINE,
                    metering=self._meter(request.user_id),
                    usage_context={"request_id": request_id},
                )
        else:
            # Fallback for clients that don't support usage tracking
            raw_output = await self._outline_llm_call(
                prompt, model, openai_key, fallback_models, with_usage=False,
            )

        outline_response = self._parser.parse(raw_output)

        # Check if practice problems/solutions are requested and add homework slides
        outline_response = self._add_homework_slides_if_needed(
            outline_response, original_user_prompt,
            force_homework=getattr(request.generation_options, 'include_assignment', None) if request.generation_options else None,
        )
        outline_response = self._apply_structure_options(outline_response, request)

        # Generate images if requested AND parsing was successful
        # Skip image generation if course_name is "Error" (indicates parsing failure)
        if (request.generation_options and 
            request.generation_options.generate_images and
            outline_response.course_metadata.course_name and
            outline_response.course_metadata.course_name.lower() != "error" and
            len(outline_response.course_metadata.course_name.strip()) > 0):
            try:
                banner_url, preview_url, media_url, image_usage = await self._image_service.generate_images(
                    course_name=outline_response.course_metadata.course_name,
                    about_course=outline_response.course_metadata.about_the_course_html,
                    course_depth=outline_response.course_metadata.course_depth,
                    image_style=request.generation_options.image_style or "professional",
                    gemini_key=gemini_key
                )
                
                # Record image generation token usage
                self._bill_outline_images(request, image_usage, [banner_url, preview_url, media_url])
                
                # Update metadata with image URLs if generation was successful
                if banner_url:
                    outline_response.course_metadata.banner_image_url = banner_url
                if preview_url:
                    outline_response.course_metadata.preview_image_url = preview_url
                if media_url:
                    outline_response.course_metadata.media_image_url = media_url
            except Exception as e:
                logger.error(f"Failed to generate course images: {str(e)}. Skipping image generation to save credits.")
                # Don't fail the entire request if image generation fails

        return outline_response

    async def stream_outline_events(
        self, request: CourseOutlineRequest, request_id: str
    ) -> AsyncGenerator[str, None]:
        """Generate outline using streaming and return SSE events (matches media-service pattern)."""
        # Emit the requestId first so the client gets a first byte before the
        # (possibly slow) document grounding — otherwise a proxy/EventSource
        # first-byte timeout could drop the connection during MathPix ingestion.
        yield f"```json {{\"requestId\": \"{request_id}\"}}```"
        # Capture the user's own words before grounding appends document text
        # (which would spuriously trigger homework-slide injection).
        original_user_prompt = request.user_prompt

        # REPLICATE+FULL KB courses: deterministic outline straight from the
        # material's section tree (no LLM — it cannot rename/reorder/drop
        # sections). Mirrors the exact final-emission format of the LLM path.
        det_response = self._deterministic_outline_from_kb(request)
        if det_response is not None:
            yield "[Generating...]\nBuilding the outline directly from the material's own structure..."
            det_response = self._add_homework_slides_if_needed(
                det_response, original_user_prompt, skip_llm_todo_filter=True,
                force_homework=getattr(request.generation_options, 'include_assignment', None) if request.generation_options else None,
            )
            det_response = self._apply_structure_options(det_response, request)
            det_meta = det_response.course_metadata.model_dump()
            det_meta.pop('banner_image_url', None)
            det_meta.pop('preview_image_url', None)
            det_meta.pop('media_image_url', None)
            det_meta["bannerImageUrl"] = None
            det_meta["previewImageUrl"] = None
            det_meta["mediaImageUrl"] = None
            yield json.dumps({
                "explanation": det_response.explanation,
                "tree": [node.model_dump() for node in det_response.tree],
                "todos": [todo.model_dump() for todo in det_response.todos],
                "courseMetadata": det_meta,
            })
            return

        await self._apply_reference_grounding(request)
        metadata: Optional[CourseMetadata] = None

        if request.course_id:
            metadata = await self._metadata_port.load_course_metadata(
                course_id=request.course_id,
                institute_id=request.institute_id,
            )

        # Get institute AI course prompt
        ai_course_prompt = None
        if self._institute_settings_service and self._db_session:
            try:
                ai_settings = self._institute_settings_service.get_ai_course_settings(request.institute_id)
                ai_course_prompt = ai_settings.get("AI_COURSE_PROMPT")
            except Exception as e:
                logger.warning(f"Failed to fetch AI course prompt for institute {request.institute_id}: {str(e)}")

        prompt = self._prompt_builder.build_prompt(
            request=request,
            metadata=metadata,
            ai_course_prompt=ai_course_prompt
        )

        # Resolve API key + model: request model > institute/user default >
        # the 'outline' use case (super-admin portal; GLM by default).
        openai_key, gemini_key, model, fallback_models = self._resolve_outline_llm(request)

        # (requestId already emitted at the top, before grounding)

        # For now, get the complete response and yield it as a single event
        # This simulates streaming but uses non-streaming API call
        try:
            # Generate outline and capture token usage
            if hasattr(self._llm_client, 'generate_outline_with_usage'):
                full_content, usage_info = await self._outline_llm_call(
                    prompt, model, openai_key, fallback_models, with_usage=True,
                )

                # Parametric course_outline charge: max(flat DB rate, actual
                # tokens). Best-effort on a fresh session; idempotent per request.
                if usage_info:
                    from .ai_billing import UC, record_tool_billing
                    record_tool_billing(
                        tool_key="course_outline",
                        tool_params={},
                        request_type=RequestType.OUTLINE,
                        model=model,
                        prompt_tokens=usage_info.get("prompt_tokens", 0),
                        completion_tokens=usage_info.get("completion_tokens", 0),
                        institute_id=request.institute_id,
                        user_id=request.user_id,
                        request_id=request_id,
                        idempotency_key=f"course_outline:{request_id}",
                        use_case=UC.COURSE_OUTLINE,
                        metering=self._meter(request.user_id),
                        usage_context={"request_id": request_id},
                    )
            else:
                # Fallback for clients that don't support usage tracking
                full_content = await self._outline_llm_call(
                    prompt, model, openai_key, fallback_models, with_usage=False,
                )

            # Yield some thinking-like events to simulate streaming
            yield "[Thinking...]\nPlanning the course structure based on your requirements..."

            yield "[Generating...]\nCreating the course outline with subjects, modules, and slides..."

            # Parse and yield the final result
            outline_response = self._parser.parse(full_content)

            # Check if practice problems/solutions are requested and add homework slides
            outline_response = self._add_homework_slides_if_needed(
                outline_response, original_user_prompt,
                force_homework=getattr(request.generation_options, 'include_assignment', None) if request.generation_options else None,
            )
            outline_response = self._apply_structure_options(outline_response, request)

            # Generate images if requested AND parsing was successful
            # Skip image generation if course_name is "Error" (indicates parsing failure)
            if (request.generation_options and 
                request.generation_options.generate_images and
                outline_response.course_metadata.course_name and
                outline_response.course_metadata.course_name.lower() != "error" and
                len(outline_response.course_metadata.course_name.strip()) > 0):
                yield "[Generating...]\nCreating course banner, preview, and media images..."

                try:
                    # Generate images (timeouts handled individually in image service)
                    banner_url, preview_url, media_url, image_usage = await self._image_service.generate_images(
                        course_name=outline_response.course_metadata.course_name,
                        about_course=outline_response.course_metadata.about_the_course_html,
                        course_depth=outline_response.course_metadata.course_depth,
                        image_style=request.generation_options.image_style or "professional",
                        gemini_key=gemini_key
                    )
                    
                    # Record image generation token usage
                    self._bill_outline_images(
                        request, image_usage, [banner_url, preview_url, media_url], request_id=request_id,
                    )

                    # Update metadata with image URLs if generation was successful
                    if banner_url:
                        outline_response.course_metadata.banner_image_url = banner_url
                    if preview_url:
                        outline_response.course_metadata.preview_image_url = preview_url
                    if media_url:
                        outline_response.course_metadata.media_image_url = media_url
                except Exception as e:
                    logger.error(f"Failed to generate course images: {str(e)}. Skipping image generation to save credits.")
                    # Don't fail the entire request if image generation fails
            else:
                # Log why images were skipped
                if not outline_response.course_metadata.course_name or outline_response.course_metadata.course_name.lower() == "error":
                    logger.warning("Skipping image generation: Course parsing failed (course_name is 'Error')")
                elif not request.generation_options or not request.generation_options.generate_images:
                    logger.debug("Skipping image generation: Not requested by user")

            # Yield the final processed outline as JSON (matches media-service pattern)
            try:
                # Build course metadata dict with S3 URLs included
                metadata_dict = outline_response.course_metadata.model_dump()

                # Remove snake_case image URL fields if they exist
                metadata_dict.pop('banner_image_url', None)
                metadata_dict.pop('preview_image_url', None)
                metadata_dict.pop('media_image_url', None)

                # Add camelCase versions for frontend compatibility
                metadata_dict["bannerImageUrl"] = getattr(outline_response.course_metadata, 'banner_image_url', None)
                metadata_dict["previewImageUrl"] = getattr(outline_response.course_metadata, 'preview_image_url', None)
                metadata_dict["mediaImageUrl"] = getattr(outline_response.course_metadata, 'media_image_url', None)

                # Create the final response
                final_response = {
                    "explanation": outline_response.explanation,
                    "tree": [node.model_dump() for node in outline_response.tree],
                    "todos": [todo.model_dump() for todo in outline_response.todos],
                    "courseMetadata": metadata_dict
                }

                response_json = json.dumps(final_response)
                yield response_json
                
                # Note: Content generation is handled by a separate endpoint (/content/v1/generate)
                # The frontend will call that endpoint after reviewing the outline

            except Exception as e:
                logger.error(f"Exception in final JSON creation: {str(e)}")
                # Still try to yield something
                yield json.dumps({
                    "error": f"Failed to create final response: {str(e)}",
                    "explanation": outline_response.explanation if 'outline_response' in locals() else "Error occurred"
                })

        except PaymentRequiredError:
            # Re-raise so the router can return a proper 402 response to the caller
            raise
        except Exception as e:
            yield f"[Error] Failed to generate outline: {str(e)}"

    async def generate_content_from_coursetree(
        self,
        course_tree: dict,
        request_id: str,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        language: Optional[str] = "English",
        model: Optional[str] = None,
        video_settings: Optional[dict] = None,
        document_settings: Optional[dict] = None,
        reference_document_file_ids: Optional[list] = None,
        kb_grounding: Optional[dict] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Generate content for todos in an existing coursetree.
        This endpoint is called by frontend with a coursetree from the outline API.
        
        Matches the pattern from media-service where content generation happens
        after the structural outline is received.
        """
        try:
            # Send initial metadata event (matches media-service)
            yield f"```json {{\"requestId\": \"{request_id}\"}}```"
            
            # Extract todos from the coursetree
            # Handle different formats:
            # 1. Full outline response: {explanation, tree, todos, courseMetadata}
            # 2. Object with todos: {todos: [...]}
            # 3. Direct array: [...]
            todos_data = None
            if isinstance(course_tree, list):
                # If it's a direct array, assume it's todos
                todos_data = course_tree
            elif isinstance(course_tree, dict):
                # Try to get todos from the dict
                todos_data = course_tree.get("todos", [])
                # If no "todos" key, check if the dict itself is a todo or if it's empty
                if not todos_data and not course_tree:
                    todos_data = []
            
            if not todos_data:
                logger.warning("No todos found in coursetree. Nothing to generate.")
                yield json.dumps({
                    "type": "INFO",
                    "message": "No todos found in coursetree. Nothing to generate."
                })
                return
            
            logger.info(
                f"Found {len(todos_data)} 'todo' items in coursetree. "
                "Initiating content generation."
            )
            
            # Parse todos into Todo objects
            todos = []
            for todo_dict in todos_data:
                try:
                    todo = Todo(**todo_dict)
                    todos.append(todo)
                except Exception as e:
                    logger.warning(f"Failed to parse todo: {str(e)}, skipping")
                    continue
            
            # Filter todos to only process content types (excludes structural types like CHAPTER, MODULE, etc.)
            content_todos = [
                todo for todo in todos
                if todo.type in ["DOCUMENT", "ASSESSMENT", "VIDEO", "VIDEO_CODE", "AI_VIDEO", "AI_VIDEO_CODE", "AI_SLIDES", "AI_STORYBOOK"]
            ]
            
            if not content_todos:
                logger.info("No content todos found. Content generation phase skipped.")
                yield json.dumps({
                    "type": "INFO",
                    "message": "No content generation todos found in coursetree."
                })
                return
            
            # Log the breakdown of todo types
            todo_types = {}
            for todo in content_todos:
                todo_types[todo.type] = todo_types.get(todo.type, 0) + 1
            logger.info(f"Processing {len(content_todos)} content generation tasks: {todo_types}")
            
            # Extract institute_id and user_id from course_tree if not provided
            extracted_institute_id = institute_id
            extracted_user_id = user_id
            if not extracted_institute_id and isinstance(course_tree, dict):
                # Try to get from courseMetadata or request metadata
                course_metadata = course_tree.get("courseMetadata", {})
                if isinstance(course_metadata, dict):
                    extracted_institute_id = extracted_institute_id or course_metadata.get("instituteId") or course_metadata.get("institute_id")
                    extracted_user_id = extracted_user_id or course_metadata.get("userId") or course_metadata.get("user_id")
            
            # Create or update content generation service with DB session and IDs
            if not self._content_generation_service:
                from .ai_billing import supported_kwargs
                from .content_generation_service import ContentGenerationService
                self._content_generation_service = ContentGenerationService(
                    llm_client=self._llm_client,
                    db_session=self._db_session,
                    institute_id=extracted_institute_id,
                    user_id=extracted_user_id,
                    **supported_kwargs(ContentGenerationService, {"metering": getattr(self, "_metering", None)}),
                )
            else:
                # Update existing service with IDs and DB session
                if getattr(self, "_metering", None) is not None:
                    self._content_generation_service._metering = self._metering
                self._content_generation_service._institute_id = extracted_institute_id or self._content_generation_service._institute_id
                self._content_generation_service._user_id = extracted_user_id or self._content_generation_service._user_id
                self._content_generation_service._db_session = self._db_session or self._content_generation_service._db_session
            # Keys idempotent per-slide charges for this generation run
            self._content_generation_service._request_id = request_id

            # Ingest reference PDFs once (cache hit from the outline pass) so
            # DOCUMENT slides can embed the document's real figures. Each figure
            # is assigned to the ONE slide it best matches (by caption↔title) so
            # the same figure doesn't get embedded on every slide. Best-effort.
            self._content_generation_service._document_figures_by_path = {}
            self._content_generation_service._kb_grounding_by_path = {}
            self._content_generation_service._kb_citations_by_path = {}
            self._content_generation_service._kb_unsupported_paths = []

            # Retrieve each slide's OWN pages. This is the step the uploaded-PDF
            # path never had: there, reference documents contribute figures only
            # and every slide's text is written from model knowledge.
            if kb_grounding:
                await self._ground_slides_from_kb(
                    kb_grounding, content_todos, institute_id
                )

            if reference_document_file_ids:
                try:
                    from .course_document_ingest import ingest_documents, assign_figures_to_slides
                    # Bounded like the outline pass: a slow/dead MathPix job must
                    # not stall content generation (no slides would stream).
                    ingest = await asyncio.wait_for(
                        ingest_documents(reference_document_file_ids), timeout=150
                    )
                    doc_slides = [
                        {"path": t.path, "title": t.title or t.name or ""}
                        for t in content_todos
                        if t.type == "DOCUMENT"
                        and "assignment" not in (t.title or "").lower()
                    ]
                    figures_by_path = assign_figures_to_slides(ingest.figures, doc_slides)
                    # MERGE, never assign: KB grounding has already put this
                    # course's knowledge-base figures in here, and a plain
                    # assignment silently threw all of them away whenever a
                    # teacher attached a reference PDF as well as picking a
                    # knowledge base.
                    existing = self._content_generation_service._document_figures_by_path
                    for path, figs in figures_by_path.items():
                        existing.setdefault(path, [])
                        existing[path].extend(figs)
                    logger.info(
                        f"Content generation: {len(ingest.figures)} reference figure(s) "
                        f"assigned across {len(figures_by_path)} slide(s)"
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Reference figure ingest failed (continuing): {str(e)}")
            
            # The model the user chose for this course drives every content leg.
            # Per-todo / per-family overrides (below) still win; when absent each
            # content type falls back to its own tuned default.
            if model and model != "auto":
                self._content_generation_service._course_model = model

            # Inject request-level language into todo metadata if not already set
            effective_language = language or "English"
            for todo in content_todos:
                if todo.metadata is None:
                    todo.metadata = {}
                if not todo.metadata.get("language"):
                    todo.metadata["language"] = effective_language

            # Repetition control: slides generate in parallel and independently,
            # so no slide knows what its siblings teach — which is how the same
            # definition (and near-identical MCQs) ended up on several slides of
            # one chapter. Cheapest counter with zero extra LLM calls: tell each
            # DOCUMENT slide what else its chapter covers.
            _titles_by_ch: dict = {}
            for todo in content_todos:
                if todo.type == "DOCUMENT":
                    _ck = (todo.path or "").rsplit(".SL", 1)[0]
                    _titles_by_ch.setdefault(_ck, []).append(todo.title or todo.name or "")
            for todo in content_todos:
                if todo.type != "DOCUMENT":
                    continue
                _ck = (todo.path or "").rsplit(".SL", 1)[0]
                _siblings = [
                    t for t in _titles_by_ch.get(_ck, [])
                    if t and t != (todo.title or todo.name or "")
                ]
                if _siblings:
                    todo.metadata["sibling_titles"] = _siblings[:12]

            # Inject course-level AI-video settings (from the wizard) into the
            # video-pipeline todos' metadata. These are the user's EXPLICIT
            # per-course choices for video pages, so they override the auto-
            # injected defaults (e.g. the "language" above) for video todos.
            # "language" here is the video-narration language (may differ from
            # the document language) and drives the TTS voice.
            if video_settings:
                _video_types = {"AI_VIDEO", "AI_VIDEO_CODE", "AI_SLIDES", "AI_STORYBOOK"}
                _video_setting_keys = (
                    "model", "voice_gender", "voice_id",
                    "tts_provider", "quality_tier", "target_duration", "language",
                )
                for todo in content_todos:
                    if todo.type not in _video_types:
                        continue
                    for key in _video_setting_keys:
                        value = video_settings.get(key)
                        if value:
                            todo.metadata[key] = value

            # Course-wide document content-type selection (from the wizard):
            # inject the chosen enrichments (Notes/Flashcards/Quiz/…) onto every
            # DOCUMENT todo so build_document_prompt weaves them into the page.
            if document_settings:
                _content_types = document_settings.get("content_types")
                _doc_model = document_settings.get("model")  # wizard's explicit pick
                _figures_policy = document_settings.get("figures_policy")  # REQUIRE | PREFER | GENERATED_ONLY
                for todo in content_todos:
                    if todo.type != "DOCUMENT":
                        continue
                    if _content_types:
                        todo.metadata["content_types"] = _content_types
                    if _doc_model:
                        todo.metadata["model"] = _doc_model
                    if _figures_policy:
                        todo.metadata["figures_policy"] = _figures_policy

            # ── Parallel content generation with dependency awareness ──
            # Separate independent todos from dependent homework→solution pairs.
            # Independent todos run concurrently (semaphore-limited); dependent pairs run sequentially.
            CONCURRENCY = 5  # Max parallel LLM calls (tune based on API rate limits)
            semaphore = asyncio.Semaphore(CONCURRENCY)

            independent_todos = []
            dependent_pairs = []  # list of (homework_todo, solution_todo)

            i = 0
            while i < len(content_todos):
                todo = content_todos[i]
                title_lower = (todo.title or todo.name or "").lower()

                # Check if this is a homework slide followed by its solution
                is_homework = (
                    "assignment -" in title_lower
                    or "homework questions" in title_lower
                )
                if is_homework and i + 1 < len(content_todos):
                    next_todo = content_todos[i + 1]
                    next_title_lower = (next_todo.title or next_todo.name or "").lower()
                    if "assignment solutions" in next_title_lower or "homework solutions" in next_title_lower:
                        dependent_pairs.append((todo, next_todo))
                        i += 2
                        continue

                independent_todos.append(todo)
                i += 1

            logger.info(
                f"Content generation plan: {len(independent_todos)} independent todos (concurrency={CONCURRENCY}), "
                f"{len(dependent_pairs)} dependent homework→solution pairs (sequential)"
            )

            generated_content_by_path = {}

            # ── Phase 1: Stream independent todos in parallel via queue ──
            # Using a queue so events are yielded to the SSE stream in real-time
            # as each slide completes, rather than buffering until all are done.
            if independent_todos:
                logger.info(f"Phase 1: Processing {len(independent_todos)} independent todos in parallel...")
                event_queue: asyncio.Queue = asyncio.Queue()
                _SENTINEL = object()  # Signals all tasks are done
                # Paths whose worker actually started generating (left the
                # semaphore queue) — see the disconnect handling below.
                started_paths: set = set()

                async def _process_todo_to_queue(todo: Todo):
                    """Generate content for one todo and push events to the queue."""
                    async with semaphore:
                        started_paths.add(todo.path)
                        try:
                            logger.info(f"Starting content generation for todo: {todo.path} (Type: {todo.type})")
                            async for content_update in self._content_generation_service.generate_content_for_todo(
                                todo, generated_content_by_path
                            ):
                                await event_queue.put(content_update)
                            logger.info(f"Completed content generation for todo: {todo.path}")
                        except Exception as e:
                            logger.error(f"Error processing todo {todo.path}: {str(e)}")
                            error_response = json.dumps({
                                "type": "SLIDE_CONTENT_ERROR",
                                "path": todo.path,
                                "status": False,
                                "actionType": todo.action_type,
                                "slideType": todo.type,
                                "errorMessage": f"Failed to generate content: {str(e)}",
                                "contentData": "Error generating content for this slide. Please try again or contact support.",
                            })
                            await event_queue.put(error_response)

                # Start all tasks
                task_todo_pairs = [
                    (asyncio.create_task(_process_todo_to_queue(todo)), todo)
                    for todo in independent_todos
                ]
                tasks = [task for task, _ in task_todo_pairs]

                # Watchdog: wait for all tasks, then push sentinel
                async def _signal_done():
                    await asyncio.gather(*tasks, return_exceptions=True)
                    await event_queue.put(_SENTINEL)

                asyncio.create_task(_signal_done())

                # Yield events in real-time as they arrive from any task.
                # If the client disconnects, the generator is closed here —
                # cancel the pure-LLM workers so orphaned generations (and
                # their credit charges) don't keep running for a stream nobody
                # receives. Video-pipeline workers must NOT be hard-cancelled:
                # a CancelledError inside generate_till_stage bypasses its
                # `except Exception` cleanup (row stuck IN_PROGRESS, no refund)
                # and unwinds a `with ThreadPoolExecutor()` whose shutdown
                # blocks the whole event loop until the stage thread finishes.
                # Those runs complete in the background instead (their DB rows
                # and S3 artifacts stay usable, billed as actual usage).
                _video_pipeline_types = {"AI_VIDEO", "AI_VIDEO_CODE", "AI_SLIDES", "AI_STORYBOOK"}
                try:
                    while True:
                        event = await event_queue.get()
                        if event is _SENTINEL:
                            break
                        yield event
                        # Accumulate generated content for potential downstream use
                        try:
                            data = json.loads(event)
                            if (
                                data.get("type") == "SLIDE_CONTENT_UPDATE"
                                and data.get("status")
                                and "contentData" in data
                            ):
                                generated_content_by_path[data["path"]] = data["contentData"]
                        except (json.JSONDecodeError, TypeError):
                            pass
                finally:
                    for task, todo in task_todo_pairs:
                        # Video-family workers that already entered the pipeline
                        # must finish (see comment above); ones still queued on
                        # the semaphore have no DB row/charges yet and are safe
                        # (and cheap) to cancel.
                        if (
                            todo.type not in _video_pipeline_types
                            or todo.path not in started_paths
                        ):
                            task.cancel()

            # ── Phase 2: Process dependent homework→solution pairs sequentially ──
            if dependent_pairs:
                logger.info(f"Phase 2: Processing {len(dependent_pairs)} homework→solution pairs sequentially...")
                for homework_todo, solution_todo in dependent_pairs:
                    # First generate homework questions
                    try:
                        logger.info(f"Starting content generation for homework todo: {homework_todo.path}")
                        async for event in self._content_generation_service.generate_content_for_todo(
                            homework_todo, generated_content_by_path
                        ):
                            yield event
                            try:
                                data = json.loads(event)
                                if (
                                    data.get("type") == "SLIDE_CONTENT_UPDATE"
                                    and data.get("status")
                                    and "contentData" in data
                                ):
                                    generated_content_by_path[data["path"]] = data["contentData"]
                            except (json.JSONDecodeError, TypeError):
                                pass
                    except Exception as e:
                        logger.error(f"Error processing homework todo {homework_todo.path}: {str(e)}")
                        yield json.dumps({
                            "type": "SLIDE_CONTENT_ERROR",
                            "path": homework_todo.path,
                            "status": False,
                            "actionType": homework_todo.action_type,
                            "slideType": homework_todo.type,
                            "errorMessage": f"Failed to generate content: {str(e)}",
                            "contentData": "Error generating content for this slide.",
                        })

                    # Then generate solutions (which can reference the homework content)
                    try:
                        logger.info(f"Starting content generation for solution todo: {solution_todo.path}")
                        async for event in self._content_generation_service.generate_content_for_todo(
                            solution_todo, generated_content_by_path
                        ):
                            yield event
                            try:
                                data = json.loads(event)
                                if (
                                    data.get("type") == "SLIDE_CONTENT_UPDATE"
                                    and data.get("status")
                                    and "contentData" in data
                                ):
                                    generated_content_by_path[data["path"]] = data["contentData"]
                            except (json.JSONDecodeError, TypeError):
                                pass
                    except Exception as e:
                        logger.error(f"Error processing solution todo {solution_todo.path}: {str(e)}")
                        yield json.dumps({
                            "type": "SLIDE_CONTENT_ERROR",
                            "path": solution_todo.path,
                            "status": False,
                            "actionType": solution_todo.action_type,
                            "slideType": solution_todo.type,
                            "errorMessage": f"Failed to generate content: {str(e)}",
                            "contentData": "Error generating content for this slide.",
                        })

            # ── Phase 3 (opt-in): repetition dedupe post-pass ──
            # Slides generate independently, so the same definition or MCQ can
            # appear on several slides of one chapter. Detection is pure text
            # processing (free); only flagged slides are regenerated, with an
            # explicit "already covered" block. Per-slide billing is idempotent
            # per run, so a regeneration does not re-charge the slide.
            if document_settings and document_settings.get("dedupe_repetition"):
                try:
                    from . import content_dedupe

                    slides = content_dedupe.group_document_slides(
                        content_todos, generated_content_by_path
                    )
                    flagged = content_dedupe.find_repetition(slides)
                    if len(flagged) > content_dedupe.MAX_REGENERATIONS_PER_COURSE:
                        logger.warning(
                            f"Dedupe pass: {len(flagged)} slides flagged, regenerating only the first "
                            f"{content_dedupe.MAX_REGENERATIONS_PER_COURSE}"
                        )
                    regen_paths = list(flagged)[: content_dedupe.MAX_REGENERATIONS_PER_COURSE]
                    todos_by_path = {t.path: t for t in content_todos}
                    regen_paths = [p for p in regen_paths if p in todos_by_path]
                    if regen_paths:
                        # Tell the FE the pass is running: by now every slide has
                        # completed, so without this the UI reads "done" and the
                        # user could persist the course before rewrites land.
                        # The FE flips these paths back to 'generating'; each
                        # rewrite (or the original re-emit on failure) completes
                        # them again through the normal update path.
                        yield json.dumps({
                            "type": "CONTENT_POSTPASS",
                            "status": "STARTED",
                            "paths": regen_paths,
                        })
                    for path in regen_paths:
                        todo = todos_by_path[path]
                        logger.info(
                            f"Dedupe pass: regenerating {path} (repeats material owned by "
                            f"{flagged[path]['owner_titles']})"
                        )
                        regen_todo = todo.model_copy(deep=True)
                        regen_todo.prompt = (regen_todo.prompt or "") + content_dedupe.dedupe_prompt_block(
                            flagged[path]
                        )
                        # A failed rewrite must never damage the slide: the
                        # original already streamed successfully, so both a
                        # raised exception AND a yielded SLIDE_CONTENT_ERROR
                        # (generate_content_for_todo reports failures as events,
                        # not exceptions) are replaced by re-emitting the
                        # ORIGINAL content — the FE flipped this path back to
                        # 'generating' and needs an update to complete it again.
                        regen_failed = False
                        try:
                            async for event in self._content_generation_service.generate_content_for_todo(
                                regen_todo, generated_content_by_path
                            ):
                                try:
                                    if json.loads(event).get("type") == "SLIDE_CONTENT_ERROR":
                                        regen_failed = True
                                        continue
                                except (json.JSONDecodeError, TypeError, AttributeError):
                                    pass
                                yield event
                        except Exception as regen_err:
                            logger.error(f"Dedupe regeneration failed for {path}: {regen_err}")
                            regen_failed = True
                        if regen_failed:
                            logger.warning(f"Dedupe pass: keeping original content for {path}")
                            yield json.dumps({
                                "type": "SLIDE_CONTENT_UPDATE",
                                "path": path,
                                "status": True,
                                "actionType": todo.action_type,
                                "slideType": todo.type,
                                "title": todo.title,
                                "contentData": generated_content_by_path.get(path, ""),
                            })
                    if regen_paths:
                        yield json.dumps({"type": "CONTENT_POSTPASS", "status": "DONE"})
                except Exception as dedupe_err:
                    logger.error(f"Dedupe post-pass skipped due to error: {dedupe_err}")

            logger.info("All 'todo' content generation tasks have completed.")

        except PaymentRequiredError:
            # Re-raise so the router can return a proper 402 response to the caller
            raise
        except Exception as e:
            logger.error(f"Exception in content generation from coursetree: {str(e)}")
            yield json.dumps({
                "type": "ERROR",
                "message": f"Failed to generate content: {str(e)}"
            })

    def _bill_outline_images(self, request, image_usage, urls, request_id: Optional[str] = None) -> None:
        """Charge the course banner / preview / media images.

        billing.image_registry_pricing off (default) and shadow: exactly as
        before — one IMAGE row under the historical gemini label, and only when
        the image calls reported tokens (dedicated image models report none, so
        those images went unbilled). Shadow also logs what registry pricing
        would charge. On: every image that came back is charged at the
        registry price of the model that drew it (`image.model`), tokens or not.
        """
        if not self._db_session:
            return
        usage = image_usage or {}
        count = sum(1 for u in (urls or []) if u)
        charge = None
        model = None
        if count:
            try:
                from .image_model_resolver import PRICING_OFF, image_pricing_mode, plan_image_charge
                from .image_service import resolve_image_model

                # Off (default): one cached settings read and nothing else, as before.
                if image_pricing_mode() != PRICING_OFF:
                    model = resolve_image_model()
                    charge = plan_image_charge(model, count, feature="course_outline_image")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Image pricing plan failed ({e}); billing outline images as before")
                charge = None
        from .ai_billing import UC, metering_kwargs, supported_kwargs
        meter = metering_kwargs(UC.CONTENT_IMAGE, self._meter(request.user_id),
                                {"feature": "course_outline_image", "image_count": count, "request_id": request_id})
        if charge is not None and charge.precomputed_credits is not None:
            try:
                _tus = TokenUsageService(self._db_session)
                _tus.record_usage_and_deduct_credits(
                    api_provider=ApiProvider.OPENAI,  # via OpenRouter
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                    request_type=RequestType.IMAGE,
                    institute_id=request.institute_id,
                    user_id=request.user_id,
                    model=model,
                    request_id=request_id,
                    metadata=charge.metadata({"feature": "course_outline_image", "image_count": count}),
                    precomputed_credits=charge.precomputed_credits,
                    **supported_kwargs(_tus.record_usage_and_deduct_credits, meter),
                )
            except Exception as e:
                logger.warning(f"Failed to record image token usage: {str(e)}")
            return
        if image_usage and usage.get("total_tokens", 0) > 0:
            try:
                token_service = TokenUsageService(self._db_session)
                token_service.record_usage_and_deduct_credits(
                    api_provider=ApiProvider.GEMINI,
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                    request_type=RequestType.IMAGE,
                    institute_id=request.institute_id,
                    user_id=request.user_id,
                    model="google/gemini-3.1-flash-image",
                    request_id=request_id,
                    metadata=charge.metadata(None) if charge is not None else None,
                    **supported_kwargs(token_service.record_usage_and_deduct_credits, meter),
                )
            except Exception as e:
                logger.warning(f"Failed to record image token usage: {str(e)}")

    def _apply_structure_options(self, outline_response: CourseOutlineResponse, request) -> CourseOutlineResponse:
        """Chapter-level deliverables chosen in the create-course UI.

        quiz_placement CHAPTER/BOTH appends ONE consolidated ASSESSMENT per
        chapter (the client asked for a proper chapter quiz instead of only
        per-slide minis); include_chapter_video appends one AI_VIDEO overview
        per chapter. Injected as TODOS with unique paths/titles — the FE builds
        its slide list from todos (the homework injection has always worked
        this way), so nothing else is needed for them to appear.
        """
        opts = getattr(request, "generation_options", None)
        if not opts:
            return outline_response
        quiz_placement = getattr(opts, "quiz_placement", None)
        include_video = bool(getattr(opts, "include_chapter_video", False))
        if quiz_placement not in ("CHAPTER", "BOTH") and not include_video:
            return outline_response

        chapters: dict = {}
        for t in outline_response.todos:
            ck = (t.path or "").rsplit(".SL", 1)[0]
            if ck:
                chapters.setdefault(ck, []).append(t)

        def _next_sl(ch_todos: list) -> int:
            mx = 0
            for t in ch_todos:
                try:
                    mx = max(mx, int((t.path or "").rsplit(".SL", 1)[1]))
                except Exception:  # noqa: BLE001
                    continue
            return mx + 1

        additions: list = []  # (chapter_key, todo)
        for ck, ch_todos in chapters.items():
            chapter_name = next((t.chapter_name for t in ch_todos if t.chapter_name), None) or ck
            refs = ", ".join(
                [x for x in ((t.title or t.name) for t in ch_todos if t.type == "DOCUMENT") if x][:12]
            )
            sl = _next_sl(ch_todos)
            max_order = max((t.order or 0) for t in ch_todos) if ch_todos else 0
            if quiz_placement in ("CHAPTER", "BOTH"):
                additions.append((ck, Todo(
                    name=f"Generate chapter quiz for {chapter_name}",
                    title=f"Chapter Quiz — {chapter_name}",
                    type="ASSESSMENT",
                    path=f"{ck}.SL{sl}",
                    keyword=chapter_name,
                    action_type="ADD",
                    prompt=(
                        f"Create ONE consolidated end-of-chapter quiz for '{chapter_name}', "
                        f"covering ALL of its topics: {refs}. 8-10 multiple-choice questions "
                        "spread across the topics (application over recall where possible), "
                        "four options each, one correct answer, a short explanation per "
                        "question, and difficulty labels. Use only the institute material; "
                        "do not repeat a question that a single topic's mini quiz would ask "
                        "verbatim."
                    ),
                    order=max_order + 1,
                    chapter_name=chapter_name,
                    metadata={},
                )))
                sl += 1
                max_order += 1
            if include_video:
                additions.append((ck, Todo(
                    name=f"Generate chapter video for {chapter_name}",
                    title=f"Chapter Video — {chapter_name}",
                    type="AI_VIDEO",
                    path=f"{ck}.SL{sl}",
                    keyword=chapter_name,
                    action_type="ADD",
                    prompt=(
                        f"Create a chapter overview video for '{chapter_name}' that walks "
                        f"through its topics in order: {refs}. Follow the material's own "
                        "flow and terminology; this is a recap the learner watches after "
                        "the chapter's pages."
                    ),
                    order=max_order + 1,
                    chapter_name=chapter_name,
                    metadata={},
                )))

        for ck, todo in additions:
            idxs = [
                i for i, t in enumerate(outline_response.todos)
                if (t.path or "").rsplit(".SL", 1)[0] == ck
            ]
            insert_at = (idxs[-1] + 1) if idxs else len(outline_response.todos)
            outline_response.todos.insert(insert_at, todo)
        if additions:
            logger.info("Structure options added %d chapter-level todos", len(additions))
        return outline_response

    def _add_homework_slides_if_needed(
        self, outline_response: CourseOutlineResponse, user_prompt: str,
        skip_llm_todo_filter: bool = False,
        force_homework: Optional[bool] = None,
    ) -> CourseOutlineResponse:
        """
        Check if user prompt mentions practice problems/solutions and add two homework slides 
        at the end of EACH chapter.
        Adds for each chapter:
        1. DOCUMENT slide with homework questions from that chapter's slides
        2. DOCUMENT slide with solutions to those homework questions
        """
        # Check for keywords indicating practice problems/solutions are needed
        prompt_lower = user_prompt.lower()
        keywords = [
            "practice problem",
            "practice problems",
            "include solutions",
            "include solution",
            "homework",
            "homework questions",
            "exercise",
            "exercises",
            "problem set",
            "problem sets",
            "assignment",
            "assignments"
        ]
        
        has_practice_keywords = any(keyword in prompt_lower for keyword in keywords)
        
        if force_homework is False:
            return outline_response
        if not (force_homework or has_practice_keywords):
            return outline_response
        
        logger.info("Detected practice problems/solutions keywords. Adding homework slides to each chapter.")
        
        # Remove any LLM-generated homework/solution slides (quiz or document). We add exactly one "Homework Questions -"
        # and one "Homework Solutions -" DOCUMENT per chapter; the user wants only those, not extra "X Homework" or
        # "X Homework Solution" slides from the outline.
        def _is_llm_homework_or_solution_todo(t: Todo) -> bool:
            title = (t.title or "").strip().lower()
            name = (t.name or "").strip().lower()
            # Our canonical slides we inject start with these prefixes
            if title.startswith("assignment -") or title.startswith("assignment solutions -"):
                return False
            if name.startswith("assignment -") or name.startswith("assignment solutions -"):
                return False

            # LLM-generated ones look like "Spark Data Processing Homework", "X Homework Solution", "Coding Assignment", etc.
            if "homework" in title or "homework" in name:
                return True
            if "assignment" in title or "assignment" in name:
                return True

            if ("solution" in title or "solution" in name) and ("homework" in title or "homework" in name):
                return True
            # LLM sometimes adds a standalone "Solution: [Topic]" slide (e.g. "Solution: Your First Spark Program");
            # we only want our single "Homework Solutions -" slide per chapter.
            if title.startswith("solution:") or title.startswith("solution -"):
                return True
            if name.startswith("solution:") or name.startswith("solution -"):
                return True
            # Quiz/assessment for practice
            if t.type == "ASSESSMENT" and any(k in title or k in name for k in ("practice", "exercise")):
                return True
            return False

        # Deterministic KB outlines take their titles from the SOURCE — a real
        # section named 'Student Assignment' is content the client wants, not an
        # LLM-invented homework slide, so the filter must not eat it.
        if not skip_llm_todo_filter:
            outline_response.todos = [t for t in outline_response.todos if not _is_llm_homework_or_solution_todo(t)]

        # Every slide is addressed by todo.path — the backend keys generated
        # content by it and the frontend maps content back onto slides by it.
        # The outline LLM sometimes emits the SAME path twice (e.g. a DOCUMENT
        # and an ASSESSMENT both at C1.CH5.SL5), and the second one then never
        # receives its content: that is how a course shipped with an empty
        # "No quiz questions available" slide that had even inherited the
        # document's title. Re-number duplicates onto free slots in their own
        # chapter so every todo is uniquely addressable.
        _seen_paths: set[str] = set()
        for _t in outline_response.todos:
            _path = _t.path or ""
            if _path and _path not in _seen_paths:
                _seen_paths.add(_path)
                continue
            _base = _path.rsplit(".SL", 1)[0] if ".SL" in _path else (_path or "C1.CH1")
            _n = 1
            while f"{_base}.SL{_n}" in _seen_paths:
                _n += 1
            _new_path = f"{_base}.SL{_n}"
            logger.warning(
                "Duplicate todo path %r (%s '%s') — reassigned to %r",
                _path, _t.type, _t.title or _t.name or "", _new_path,
            )
            _t.path = _new_path
            _seen_paths.add(_new_path)

        # Titles must ALSO be unique within a chapter. The frontend matches a
        # generated slide back to its outline slide by fuzzy TITLE match, so two
        # slides sharing a title collapse onto one map entry: the extra slides
        # never map, their todos are filtered out as "removed", and they spin
        # "generating" forever (seen live: a chapter whose 6 slides all carried
        # the parent chapter's heading generated only 1 of 6).
        _titles_by_chapter: dict = {}
        for _t in outline_response.todos:
            _chapter_key = (_t.path or "").rsplit(".SL", 1)[0]
            _title = (_t.title or _t.name or "").strip()
            if not _title:
                continue
            _used = _titles_by_chapter.setdefault(_chapter_key, set())
            if _title.casefold() not in _used:
                _used.add(_title.casefold())
                continue
            _part = 2
            while f"{_title} (part {_part})".casefold() in _used:
                _part += 1
            _unique = f"{_title} (part {_part})"
            logger.warning(
                "Duplicate slide title %r in chapter %s — renamed to %r",
                _title, _chapter_key or "?", _unique,
            )
            _t.title = _unique
            _used.add(_unique.casefold())

        # Group todos by chapter and find insertion points
        # We need to insert homework slides right after the last slide of each chapter
        chapter_groups = {}
        
        for idx, todo in enumerate(outline_response.todos):
            # Extract chapter path from todo path
            path_parts = todo.path.split(".")
            chapter_path = None
            
            # Find the chapter part (CH1, CH2, etc.) or use the base path if no chapters
            for i, part in enumerate(path_parts):
                if part.startswith("CH"):
                    # Chapter found, include everything up to and including the chapter
                    chapter_path = ".".join(path_parts[:i+1])
                    break
            
            # If no chapter found, check if it's depth 2 (direct slides under course)
            if not chapter_path:
                # For depth 2, group by course (C1)
                if path_parts and path_parts[0].startswith("C"):
                    chapter_path = path_parts[0]
                else:
                    chapter_path = "C1"  # Fallback
            
            if chapter_path not in chapter_groups:
                chapter_groups[chapter_path] = []
            chapter_groups[chapter_path].append((idx, todo))
        
        # Process chapters in reverse order to maintain correct indices when inserting
        # Sort chapters by the index of their last todo (so we process from end to beginning)
        sorted_chapters = sorted(
            chapter_groups.items(),
            key=lambda x: max([idx for idx, _ in x[1]]),
            reverse=True
        )
        
        # Insert homework slides right after each chapter's last slide
        for chapter_path, chapter_todos_with_idx in sorted_chapters:
            chapter_todos = [todo for _, todo in chapter_todos_with_idx]
            
            # Get only DOCUMENT slides from this chapter for reference
            chapter_document_slides = [
                todo for todo in chapter_todos 
                if todo.type == "DOCUMENT"
            ]
            
            # Skip if no document slides in this chapter
            if not chapter_document_slides:
                continue
            
            # Find the last todo in this chapter (by order or by index)
            last_chapter_todo = max(chapter_todos_with_idx, key=lambda x: x[0])[1]
            last_chapter_idx = max([idx for idx, _ in chapter_todos_with_idx])
            
            path_parts = last_chapter_todo.path.split(".")
            
            # Determine next slide number
            if path_parts:
                last_part = path_parts[-1]
                if last_part.startswith("SL"):
                    try:
                        last_slide_num = int(last_part[2:])
                        next_slide_num = last_slide_num + 1
                    except:
                        next_slide_num = len(chapter_todos) + 1
                else:
                    next_slide_num = len(chapter_todos) + 1
            else:
                next_slide_num = len(chapter_todos) + 1
            
            # Build paths for homework and solutions slides
            base_path = chapter_path
            homework_path = f"{base_path}.SL{next_slide_num}"
            solutions_path = f"{base_path}.SL{next_slide_num + 1}"
            
            # Get slide references for this chapter only
            slide_references = ", ".join([todo.title or todo.name for todo in chapter_document_slides])
            
            # Get chapter name for better context
            chapter_name = chapter_document_slides[0].chapter_name if chapter_document_slides[0].chapter_name else "this chapter"
            
            # Determine order based on last todo in chapter
            last_order = last_chapter_todo.order if last_chapter_todo.order else last_chapter_idx + 1
            
            # Create homework questions todo for this chapter (coding/task-focused, not simple Q&A)
            homework_todo = Todo(
                name=f"Assignment - {chapter_name}",
                title=f"Assignment - {chapter_name}",
                type="DOCUMENT",
                path=homework_path,
                action_type="ADD",
                model=chapter_document_slides[0].model,
                prompt=f"""Create the homework assignment based ONLY on the course content covered in {chapter_name} from the following slides in this chapter: {slide_references}.

IMPORTANT: The assignment should ONLY reference content from {chapter_name}. Do not include tasks from other chapters.

The homework must be hands-on and applied — something the student actively DOES, not recall-style question-answer. Choose the task type from the chapter's subject matter:
- ONLY if the chapter teaches programming or another code-based technical skill: one coding task (mini project, implementation, setup, or debugging task)
- For any other subject: one practical non-coding task (e.g. analyze a provided case or examples, create a deliverable like a properly formatted document or plan, correct provided flawed examples, or solve realistic scenario problems)
Never force a coding task onto a non-technical chapter.
Include exactly ONE task, with: clear title, brief context, concrete instructions, the materials to work on embedded in the assignment, and the expected outcome. Base it on THIS chapter only: {slide_references}.""",
                order=last_order + 1,
                chapter_name=chapter_document_slides[0].chapter_name,
                module_name=chapter_document_slides[0].module_name,
                subject_name=chapter_document_slides[0].subject_name
            )
            
            # Create solutions todo for this chapter (hint first, then exact solution per item)
            solutions_todo = Todo(
                name=f"Assignment Solutions - {chapter_name}",
                title=f"Assignment Solutions - {chapter_name}",
                type="DOCUMENT",
                path=solutions_path,
                action_type="ADD",
                model=chapter_document_slides[0].model,
                prompt=f"""Create solutions for the homework task from the previous slide in {chapter_name}. You MUST give: (1) HINT first, (2) then the full solution.

IMPORTANT: Solutions should ONLY reference content from {chapter_name}. The homework task is based on these slides: {slide_references}.

For the homework task:
- First provide one or more HINTs (short, actionable, without giving the full answer).
- Then provide the full solution matching the task type: complete runnable code ONLY if the homework was a coding task; otherwise the complete worked deliverable or step-by-step working (e.g. the corrected examples, the finished document, the full analysis).
- Reference concepts only from: {slide_references}.""",
                order=last_order + 2,
                chapter_name=chapter_document_slides[0].chapter_name,
                module_name=chapter_document_slides[0].module_name,
                subject_name=chapter_document_slides[0].subject_name
            )
            
            # Insert homework slides right after the last slide of this chapter
            insert_position = last_chapter_idx + 1
            outline_response.todos.insert(insert_position, solutions_todo)
            outline_response.todos.insert(insert_position, homework_todo)
            
            logger.info(f"Added homework slides for chapter {chapter_path} at position {insert_position}: {homework_path} and {solutions_path}")
        
        return outline_response


__all__ = ["CourseOutlineGenerationService"]


