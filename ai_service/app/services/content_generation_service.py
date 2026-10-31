from __future__ import annotations

import json
import logging
import os
import asyncio
from typing import Any, AsyncGenerator, Optional
from uuid import uuid4

from ..ports.llm_client import OutlineLLMClient
from ..schemas.course_outline import Todo
from .youtube_service import YouTubeService
from .content_prompts import ContentGenerationPrompts
from .document_postprocess import (
    doc_image_model,
    illustrate_document,
    normalize_code_blocks,
    strip_wrapping_fence,
)
from ..core.exceptions import PaymentRequiredError
from .video_generation_service import VideoGenerationService
from ..repositories.ai_video_repository import AiVideoRepository
from .s3_service import S3Service
from .token_usage_service import TokenUsageService
from ..models.ai_token_usage import ApiProvider, RequestType
from sqlalchemy.orm import Session
from typing import Optional

logger = logging.getLogger(__name__)

# Illustrations per generated DOCUMENT slide. Lower than the module default
# (which serves the single-page HTML Document author) because a course run fans
# out across every slide at once. Override: COURSE_SLIDE_MAX_IMAGES.
_COURSE_SLIDE_MAX_IMAGES = int(os.getenv("COURSE_SLIDE_MAX_IMAGES") or 3)


class ContentGenerationService:
    """
    Service for generating slide content (documents, assessments, and videos) based on todos.
    Matches the pattern from media-service DocumentContentGenerationStrategy, AssignmentContentGeneration, and YoutubeContentGenerationStrategy.
    """

    def __init__(
        self, 
        llm_client: OutlineLLMClient, 
        youtube_service: Optional[YouTubeService] = None,
        video_gen_service: Optional[VideoGenerationService] = None,
        db_session: Optional[Session] = None,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        metering: Any = None,
    ) -> None:
        logger.info("[ContentGenService] Initializing ContentGenerationService")
        self._llm_client = llm_client
        # Usage-event attribution for this run's charges (never changes one).
        self._metering = metering
        self._youtube_service = youtube_service or YouTubeService()
        self._db_session = db_session
        self._institute_id = institute_id
        self._user_id = user_id
        # Set per generation run by the orchestrator; keys idempotent slide charges.
        self._request_id: Optional[str] = None
        # Real figures from uploaded reference PDFs, pre-assigned per slide path
        # (each figure → its single best-matching slide) so the same figure is
        # not embedded on every slide. Set by the orchestrator per run.
        self._document_figures_by_path: dict = {}
        # Per-slide passages retrieved from the institute's knowledge base,
        # keyed by todo path. Empty when the course is not KB-grounded.
        self._kb_grounding_by_path: dict = {}
        # {path: [{source_title, page_start, ...}]} — kept so a teacher can
        # verify any slide against the page it was written from.
        self._kb_citations_by_path: dict = {}
        # Slides the material could not support. Surfaced as a review list
        # rather than silently filled with model knowledge.
        self._kb_unsupported_paths: list = []
        
        logger.info("[ContentGenService] Creating VideoGenerationService...")
        try:
            self._video_gen_service = video_gen_service or VideoGenerationService(
                repository=AiVideoRepository(session=db_session),
                s3_service=S3Service()
            )
            logger.info("[ContentGenService] VideoGenerationService initialized successfully")
        except Exception as e:
            logger.error(f"[ContentGenService] FAILED to initialize VideoGenerationService: {e}")
            raise
        
        # Default content model + its failover chain: the 'content' use case
        # (ai_model_defaults, super-admin portal; GLM by default).
        self._content_model, self._content_fallbacks = self._resolve_use_case("content", db_session)
        # DOCUMENT slides are now creative, self-contained HTML (rendered in an
        # iframe) and benefit from a strong front-end model — same as the manual
        # "AI document" authoring: the 'html_document' use case. Overridable
        # per-slide via todo.metadata.model. Env override: HTML_DOC_MODEL.
        _html_env = (os.getenv("HTML_DOC_MODEL") or "").strip()
        _html_model, self._html_doc_fallbacks = self._resolve_use_case("html_document", db_session)
        self._html_doc_model = _html_env or _html_model
        # The model the user picked when creating the course. Set per run and
        # used by EVERY content leg; the hardcoded models above are only the
        # fallback when the user left it on "auto". Kept separate from
        # _content_model so that stays a known-good retry target.
        self._course_model: Optional[str] = None
        logger.info("[ContentGenService] ContentGenerationService fully initialized")

    @staticmethod
    def _resolve_use_case(use_case: str, db_session=None):
        """(primary, [fallbacks]) for a use case; never raises."""
        try:
            from .model_selection import resolve_model_sync, resolve_models
            if db_session is not None:
                return resolve_models(db_session, use_case)
            return resolve_model_sync(use_case)
        except Exception as exc:  # noqa: BLE001
            from ..constants.model_defaults import GLM_DEFAULT, NON_GLM_FALLBACK
            logger.warning(f"[ContentGenService] {use_case} model lookup failed ({exc}); using {GLM_DEFAULT}")
            return GLM_DEFAULT, [NON_GLM_FALLBACK]

    @staticmethod
    def _wizard_model(todo) -> Optional[str]:
        """The wizard's explicit per-family pick (todo.metadata.model). The
        LLM-authored todo.model is deliberately ignored: the outline prompt used
        to make the model write gemini-2.5-pro / a retired preview slug there."""
        if todo is None:
            return None
        return (getattr(todo, "metadata", None) or {}).get("model") or None

    def _model_for(self, todo=None, default: Optional[str] = None) -> str:
        """Which model generates this slide.

        Precedence: the wizard's per-family pick (todo.metadata.model) → the
        model the user chose for the course → the use-case default for this
        kind of content. So a user's pick is honoured everywhere.
        """
        picked = self._wizard_model(todo)
        if picked:
            return picked
        return self._course_model or default or self._content_model

    def _retry_models_for(self, model: str):
        """Failover targets after `model` failed: the chain of the use case it
        came from (html_document for documents, content otherwise)."""
        if model == self._html_doc_model:
            chain = [*self._html_doc_fallbacks, self._content_model, *self._content_fallbacks]
        else:
            chain = [self._content_model, *self._content_fallbacks]
        out = []
        for candidate in chain:
            if candidate and candidate != model and candidate not in out:
                out.append(candidate)
        return out

    @staticmethod
    def _video_voice_kwargs(todo: Todo) -> dict:
        """Voice + quality-tier settings for the video pipeline, read from
        todo.metadata (populated from the course wizard's AI-video settings via
        the request-level video_settings). Absent keys keep pipeline defaults."""
        metadata = todo.metadata or {}
        return {
            "voice_gender": metadata.get("voice_gender", "female"),
            "tts_provider": metadata.get("tts_provider", "standard"),
            "voice_id": metadata.get("voice_id"),
            "quality_tier": metadata.get("quality_tier", "ultra"),
        }

    def _meter(self) -> Any:
        """The router's verified metering context (JWT), else an UNVERIFIED
        one: the user id here comes from the request body, so it is kept only
        as usage_context.claimed_user_id and never becomes the event actor."""
        try:
            ctx = getattr(self, "_metering", None)
            if ctx is not None:
                return ctx
            from .ai_billing import metering_unverified
            return metering_unverified(getattr(self, "_user_id", None), surface="ADMIN_APP")
        except Exception:  # noqa: BLE001 - attribution must never cost a charge
            return None

    def _meter_kwargs(self, use_case: str, usage_context: Optional[dict] = None) -> dict:
        from .ai_billing import metering_kwargs
        return metering_kwargs(use_case, self._meter(), usage_context)

    def _bill_slide(self, *, tool_key: str, todo: Todo, model: str, usage_info: Optional[dict] = None) -> None:
        """Parametric per-slide charge = max(DB rate for tool_key, actual token
        cost). Best-effort on a fresh session; idempotent per request+slide so a
        retried/duplicated event never double-charges."""
        from .ai_billing import UC, record_tool_billing

        usage_info = usage_info or {}
        record_tool_billing(
            tool_key=tool_key,
            tool_params={},
            request_type=RequestType.CONTENT,
            model=model,
            prompt_tokens=usage_info.get("prompt_tokens", 0),
            completion_tokens=usage_info.get("completion_tokens", 0),
            institute_id=self._institute_id,
            user_id=self._user_id,
            request_id=self._request_id,
            idempotency_key=(
                f"course_slide:{self._request_id}:{todo.path}" if self._request_id else None
            ),
            use_case=UC.CONTENT,
            metering=self._meter(),
            usage_context={"slide_path": getattr(todo, "path", None),
                           "slide_title": getattr(todo, "title", None) or getattr(todo, "name", None),
                           "request_id": getattr(self, "_request_id", None)},
        )

    async def _generate_with_model_fallback(self, prompt: str, model: str):
        """Run one LLM generation, falling back through the use case's chain
        (row default, row fallback, non-GLM tail) when the chosen model fails —
        an explicit model gets no client-side fallback in the LLM client.

        Returns (generated_content, usage_info, used_model).
        """
        has_usage = hasattr(self._llm_client, 'generate_outline_with_usage')

        async def _call(use_model: str):
            if has_usage:
                return await self._llm_client.generate_outline_with_usage(
                    prompt=prompt, model=use_model
                )
            return await self._llm_client.generate_outline(prompt=prompt, model=use_model), {}

        def _is_empty(text) -> bool:
            return not (text or "").strip()

        try:
            content, usage = await _call(model)
            # An EMPTY completion is a failure, not a result — reasoning models
            # can spend their whole budget thinking and return nothing. Letting
            # it through produced assessment slides that crashed the JSON parser
            # ("argument of type 'NoneType' is not iterable") and shipped as
            # silently-empty quizzes.
            #
            # Retry the SAME model once first: an empty completion is usually
            # transient, and switching models is a worse outcome than simply
            # asking again (a different model writes in a different voice, and
            # for documents it is also the weaker fallback model).
            if _is_empty(content):
                logger.warning(
                    f"Model '{model}' returned empty content; retrying the same model once"
                )
                content, usage = await _call(model)
            if _is_empty(content):
                raise ValueError(f"'{model}' returned empty content twice")
            return content, usage, model
        except PaymentRequiredError:
            # Out-of-credits is fatal by design — no fallback model will help.
            raise
        except Exception as e:
            retry_models = self._retry_models_for(model)
            if not retry_models:
                # Nothing left to try (the chain is just this model, which has
                # had its same-model retry above).
                raise
            last_error: Exception = e
            for fallback in retry_models:
                logger.warning(
                    f"Model '{model}' failed ({last_error}); retrying with fallback '{fallback}'"
                )
                try:
                    content, usage = await _call(fallback)
                except PaymentRequiredError:
                    raise
                except Exception as e2:  # noqa: BLE001
                    last_error = e2
                    continue
                if not _is_empty(content):
                    return content, usage, fallback
                last_error = ValueError(f"fallback '{fallback}' returned empty content")
            # Every model in the chain failed or came back empty — fail loudly
            # so the slide is reported as an ERROR rather than saved blank.
            raise ValueError(
                f"'{model}' and fallbacks {retry_models} all failed or returned empty content: {last_error}"
            )

    async def generate_document_content(
        self, todo: Todo, prompt: str, homework_content: Optional[str] = None
    ) -> dict:
        """
        Generate document content for a DOCUMENT type todo.
        Returns content in the same format as media-service DocumentContentGenerationStrategy.
        
        Format: {
            "type": "SLIDE_CONTENT_UPDATE",
            "path": "<slidePath>",
            "status": true,
            "actionType": "<actionType>",
            "slideType": "DOCUMENT",
            "contentData": "<generated HTML or Markdown content>"
        }
        """
        try:
            logger.info(f"Generating document content for slide: {todo.path}")

            title = todo.title or todo.name or ""
            title_lower = title.lower()
            is_homework_questions = "homework questions" in title_lower or "assignment -" in title_lower
            is_homework_solutions = "homework solutions" in title_lower or "assignment solutions" in title_lower

            language = (todo.metadata or {}).get("language", "English")
            # Honor an explicitly-injected model (e.g. the wizard's pick); else
            # default DOCUMENT slides to the dedicated HTML model (see
            # _html_doc_model), matching the manual "AI document" craft — NOT
            # the fast content model.
            model = self._model_for(todo, default=self._html_doc_model)

            if is_homework_questions:
                logger.info(f"Using homework (coding/task-focused) prompt for slide: {todo.path}")
                document_prompt = ContentGenerationPrompts.build_homework_prompt(
                    text_prompt=prompt,
                    title=title,
                    language=language,
                )
            elif is_homework_solutions:
                logger.info(f"Using solution (hint then solution) prompt for slide: {todo.path}")
                document_prompt = ContentGenerationPrompts.build_solution_prompt(
                    text_prompt=prompt,
                    title=title,
                    homework_content=homework_content,
                    language=language,
                )
            else:
                # Check if diagrams should be included based on prompt
                diagram_keywords = ["include diagrams", "include diagram", "with diagrams", "with diagram",
                                   "add diagrams", "add diagram", "diagrams", "mermaid"]
                prompt_lower = prompt.lower()
                include_diagrams = any(keyword in prompt_lower for keyword in diagram_keywords)

                if include_diagrams:
                    logger.info(f"Detected diagram request in prompt for slide: {todo.path}, requiring Mermaid diagrams in HTML output")

                # Build document prompt (always HTML; Mermaid emitted as div.mermaid blocks).
                # Pass any real figures from uploaded reference PDFs so the model can
                # embed the ones relevant to THIS slide's topic verbatim.
                document_prompt = ContentGenerationPrompts.build_document_prompt(
                    text_prompt=prompt,
                    title=title,
                    include_diagrams=include_diagrams,
                    language=language,
                    reference_figures=self._document_figures_by_path.get(todo.path, []),
                    # Course-wide document content-type selection (Notes/Flashcards/
                    # Quiz/…), injected onto DOCUMENT todos from the wizard.
                    content_types=(todo.metadata or {}).get("content_types"),
                    # What the chapter's OTHER slides teach — repetition control.
                    sibling_titles=(todo.metadata or {}).get("sibling_titles"),
                    # Source-figure policy from the wizard (REQUIRE/PREFER/GENERATED_ONLY).
                    figures_policy=(todo.metadata or {}).get("figures_policy"),
                )
            
            # Generate content using the enhanced prompt and capture token usage
            generated_content, usage_info, used_model = await self._generate_with_model_fallback(
                document_prompt, model
            )

            # Parametric per-slide charge: max(course_slide_document DB rate,
            # actual token cost). Best-effort; idempotent per request+slide.
            if usage_info:
                self._bill_slide(
                    tool_key="course_slide_document",
                    todo=todo,
                    model=used_model,
                    usage_info=usage_info,
                )

            # Unwrap a whole-payload ```html fence (common model slip), then
            # normalize <pre><code> blocks into the editor's lossless form and
            # generate any requested illustrations. All best-effort.
            generated_content = strip_wrapping_fence(generated_content)
            generated_content = normalize_code_blocks(generated_content)
            # Bulk course generation fans out over every slide, so it keeps a
            # tighter picture budget than the single-page HTML Document author
            # (which is one deliberate page at a time, billed per image).
            generated_content, image_count = await illustrate_document(
                generated_content, slide_path=todo.path, max_images=_COURSE_SLIDE_MAX_IMAGES
            )
            if image_count and self._db_session:
                # billing.image_registry_pricing: off (default) = the flat
                # image rate as before; shadow adds would_be_credits to the
                # usage metadata; on charges the model's registry price.
                image_model = doc_image_model()
                try:
                    from .image_model_resolver import plan_image_charge
                    charge = plan_image_charge(image_model, 1, feature="document_illustration")
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Image pricing plan failed ({e}); billing illustrations as before")
                    charge = None
                try:
                    from .ai_billing import UC, supported_kwargs
                    token_service = TokenUsageService(self._db_session)
                    base_metadata = {"slide_path": todo.path, "feature": "document_illustration"}
                    _meter = supported_kwargs(
                        token_service.record_usage_and_deduct_credits,
                        self._meter_kwargs(UC.CONTENT_IMAGE, {"slide_path": todo.path,
                                                              "feature": "document_illustration"}),
                    )
                    for _ in range(image_count):
                        token_service.record_usage_and_deduct_credits(
                            api_provider=ApiProvider.OPENAI,  # via OpenRouter
                            prompt_tokens=0,
                            completion_tokens=0,
                            total_tokens=0,
                            request_type=RequestType.IMAGE,
                            institute_id=self._institute_id,
                            user_id=self._user_id,
                            model=image_model,
                            metadata=charge.metadata(dict(base_metadata)) if charge else dict(base_metadata),
                            precomputed_credits=charge.precomputed_credits if charge else None,
                            **_meter,
                        )
                except Exception as e:
                    logger.warning(f"Failed to record document illustration usage: {str(e)}")

            # Format response matching media-service DocumentContentGenerationStrategy
            return {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "actionType": todo.action_type,
                "slideType": "DOCUMENT",
                "contentData": generated_content,
            }
        except Exception as e:
            error_msg = str(e)
            # Try to extract more details from httpx errors
            if hasattr(e, 'response') and hasattr(e.response, 'text'):
                try:
                    error_detail = e.response.text
                    logger.error(f"Error generating document content for {todo.path}: {error_msg}. Response: {error_detail}")
                    error_msg = f"{error_msg}: {error_detail[:200]}"  # Limit error detail length
                except:
                    pass
            else:
                logger.error(f"Error generating document content for {todo.path}: {error_msg}")
            return {
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": "DOCUMENT",
                "errorMessage": f"Failed to generate content: {error_msg}",
                "contentData": "Error generating content for this slide. Please try again or contact support.",
            }

    async def generate_assessment_content(
        self, todo: Todo, prompt: str
    ) -> dict:
        """
        Generate assessment/quiz content for an ASSESSMENT type todo.
        Returns content in the same format as media-service AssignmentContentGeneration.
        
        Format: {
            "type": "SLIDE_CONTENT_UPDATE",
            "path": "<slidePath>",
            "status": true,
            "title": "<title>",
            "actionType": "<actionType>",
            "slideType": "ASSESSMENT",
            "contentData": <JSON object with questions>
        }
        """
        try:
            logger.info(f"Generating assessment content for slide: {todo.path}")
            
            language = (todo.metadata or {}).get("language", "English")
            # Honor the model chosen at outline time; fall back to the service default.
            model = self._model_for(todo)
            # Build assessment prompt using template similar to media-service PROMPT_TO_QUESTIONS
            assessment_prompt = ContentGenerationPrompts.build_assessment_prompt(
                text_prompt=prompt,
                title=todo.title or todo.name,
                language=language,
            )

            # Generate content and capture token usage
            generated_content, usage_info, used_model = await self._generate_with_model_fallback(
                assessment_prompt, model
            )

            # Parametric per-slide charge: max(course_slide_assessment DB rate,
            # actual token cost). Best-effort; idempotent per request+slide.
            if usage_info:
                self._bill_slide(
                    tool_key="course_slide_assessment",
                    todo=todo,
                    model=used_model,
                    usage_info=usage_info,
                )

            # Extract and parse JSON from the response
            content_json = self._extract_json_from_response(generated_content)
            
            # Format response matching media-service AssignmentContentGeneration
            return {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "title": todo.title or todo.name,
                "actionType": todo.action_type,
                "slideType": "ASSESSMENT",
                "contentData": content_json,
            }
        except Exception as e:
            error_msg = str(e)
            # Try to extract more details from httpx errors
            if hasattr(e, 'response') and hasattr(e.response, 'text'):
                try:
                    error_detail = e.response.text
                    logger.error(f"Error generating assessment content for {todo.path}: {error_msg}. Response: {error_detail}")
                    error_msg = f"{error_msg}: {error_detail[:200]}"  # Limit error detail length
                except:
                    pass
            else:
                logger.error(f"Error generating assessment content for {todo.path}: {error_msg}")
            return {
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": "ASSESSMENT",
                "errorMessage": f"Failed to generate content: {error_msg}",
                "contentData": "Error generating content for this slide. Please try again or contact support.",
            }

    async def generate_video_content(
        self, todo: Todo, bill: bool = True
    ) -> dict:
        """
        Generate video content for a VIDEO type todo by searching YouTube.
        Returns content in the same format as media-service YoutubeContentGenerationStrategy.
        
        Format: {
            "type": "SLIDE_CONTENT_UPDATE",
            "path": "<slidePath>",
            "status": true,
            "title": "<title>",
            "actionType": "<actionType>",
            "slideType": "VIDEO",
            "contentData": <JSON object with video details>
        }
        """
        try:
            logger.info(f"Generating video content for slide: {todo.path}")
            
            # Use keyword if available, otherwise use title or name
            search_query = todo.keyword or todo.title or todo.name

            if not search_query:
                raise ValueError("No search query available for YouTube search (keyword, title, or name required)")

            language = (todo.metadata or {}).get("language", "English")
            # Append language hint to search query for better localised results (only if not English)
            if language and language.lower() != "english":
                search_query = f"{search_query} {language}"

            # Search YouTube for the video
            video_id = await self._youtube_service.search_video(search_query)
            
            if not video_id:
                raise ValueError(f"No YouTube video found for query: {search_query}")
            
            # Format response matching media-service YoutubeContentGenerationStrategy
            youtube_details = self._youtube_service.format_youtube_response(
                video_id=video_id,
                title=todo.title or todo.name,
                description=f"Video related to: {search_query}"
            )

            # Parametric per-slide charge (flat course_slide_video DB rate; no
            # LLM call on this path). VIDEO_CODE reuses this method and bills
            # itself only after its code leg also succeeds.
            if bill:
                self._bill_slide(tool_key="course_slide_video", todo=todo, model="youtube-search")

            return {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "title": todo.title or todo.name,
                "actionType": todo.action_type,
                "slideType": "VIDEO",
                "contentData": youtube_details,
            }
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Error generating video content for {todo.path}: {error_msg}")
            return {
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": "VIDEO",
                "errorMessage": f"Failed to generate content: {error_msg}",
                "contentData": "Error generating video content for this slide. Please try again or contact support.",
            }

    async def generate_ai_video_content(
        self, todo: Todo
    ) -> AsyncGenerator[str, None]:
        """
        Generate AI video content for an AI_VIDEO type todo.
        Streams progress events and returns final video metadata.
        
        Yields SSE events during generation, final event contains video files.
        """
        try:
            logger.info(f"[AI_VIDEO] Starting generation for slide: {todo.path}")
            
            # Generate unique video ID from todo path
            video_id = f"video-{todo.path.replace('.', '-').replace('/', '-')}-{str(uuid4())[:8]}"
            logger.info(f"[AI_VIDEO] Generated video_id: {video_id}")
            
            # Use prompt from todo, or generate from title
            prompt = todo.prompt or f"Create an educational video explaining: {todo.title or todo.name}"
            logger.info(f"[AI_VIDEO] Using prompt: {prompt[:100]}...")
            
            # Send immediate "started" event so frontend knows generation has begun
            started_event = {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "actionType": todo.action_type,
                "slideType": "AI_VIDEO",
                "contentData": {
                    "videoId": video_id,
                    "status": "GENERATING",
                    "message": "AI video generation started. This may take 2-5 minutes...",
                    "currentStage": "INITIALIZING",
                    "progress": 0
                },
                "metadata": {
                    "isGenerating": True,
                    "videoId": video_id
                }
            }
            yield json.dumps(started_event)
            logger.info(f"[AI_VIDEO] Sent started event for {video_id}")
            
            # Generate till SCRIPT stage only (fast response)
            # HTML generation will continue in background
            logger.info(f"[AI_VIDEO] Generating video till SCRIPT stage for {video_id}")
            
            event_count = 0
            pipeline_error: Optional[str] = None

            # One kwargs set for both legs; recorded as the run request (final
            # target HTML) so a kill during leg 1, between the legs or during
            # the fire-and-forget leg 2 is auto-resumed (ai_video_resumer).
            _video_kwargs = dict(
                language=todo.metadata.get("language", "English"),
                captions_enabled=True,  # Default for course outline
                html_quality=todo.metadata.get("html_quality", "advanced"),
                model=self._wizard_model(todo),  # wizard pick only; None = video pipeline default
                target_audience=todo.metadata.get("target_audience", "General/Adult"),
                target_duration=todo.metadata.get("target_duration", "2-3 minutes"),
                **self._video_voice_kwargs(todo),
                institute_id=self._institute_id,
                user_id=self._user_id,
            )
            from .video_run_request import capture as _capture_run_request
            _run_request = _capture_run_request("course_builder", "HTML", _video_kwargs)

            async for event in self._video_gen_service.generate_till_stage(
                video_id=video_id,
                prompt=prompt,
                target_stage="SCRIPT",  # Stop at SCRIPT stage
                resume=False,
                db_session=self._db_session,
                run_request=_run_request,
                **_video_kwargs,
            ):
                event_count += 1
                logger.info(f"[AI_VIDEO] Received event #{event_count} for {video_id}: {event.get('type', 'unknown')}, stage={event.get('stage', 'N/A')}")

                # The pipeline reports failures as events, not exceptions —
                # never wrap them as a status-true progress update.
                if event.get("type") == "error":
                    pipeline_error = event.get("message") or "Video generation failed"
                    break

                # Wrap progress events inside a slide update envelope
                wrapped_event = {
                    "type": "SLIDE_CONTENT_UPDATE",
                    "path": todo.path,
                    "status": True,
                    "actionType": todo.action_type,
                    "slideType": "AI_VIDEO",
                    "contentData": {
                        "videoId": video_id,
                        "status": "GENERATING",
                        "currentStage": event.get("stage", "UNKNOWN"),
                        "progress": event.get("percentage", 0),
                        "message": f"Generating {event.get('stage', 'stage')}..."
                    },
                    "metadata": {
                        "isGenerating": True,
                        "videoId": video_id,
                        "internalEvent": event  # Include raw event for debugging
                    }
                }
                yield json.dumps(wrapped_event)
            
            logger.info(f"[AI_VIDEO] Script generation completed for {video_id}. Total events: {event_count}")

            # Get video status after script generation
            video_status = self._video_gen_service.get_video_status(video_id)

            if not video_status:
                raise ValueError(f"Video generation failed: no status found for {video_id}")

            # A failed/cancelled pipeline must surface as an error — never as a
            # "COMPLETED" slide pointing at a dead video (and never spawn the
            # background HTML leg for it).
            if pipeline_error or video_status.get("status") in ("FAILED", "CANCELLED"):
                error_msg = pipeline_error or f"Video generation {video_status.get('status', 'FAILED').lower()}"
                logger.error(f"[AI_VIDEO] Pipeline failed for {todo.path} ({video_id}): {error_msg}")
                yield json.dumps({
                    "type": "SLIDE_CONTENT_ERROR",
                    "path": todo.path,
                    "status": False,
                    "actionType": todo.action_type,
                    "slideType": "AI_VIDEO",
                    "errorMessage": f"Failed to generate AI video: {error_msg}",
                    "contentData": f"Error generating AI video: {error_msg}",
                })
                return

            logger.info(f"AI video script generated for {todo.path}. Status: {video_status['status']}, Stage: {video_status['current_stage']}")

            # Format response with script data (HTML generation will continue in background)
            ai_video_details = {
                "videoId": video_id,
                "status": "COMPLETED",  # Mark as completed for content generation
                "scriptFileId": video_status["file_ids"].get("script"),
                "scriptUrl": video_status["s3_urls"].get("script"),
                "language": video_status.get("language", "English"),
                "currentStage": "SCRIPT",  # Script is done
                "progress": 100,
                "backgroundGeneration": True,  # Indicate HTML is generating in background
                "message": "Script generated. HTML timeline and audio are being generated in the background. Use /video/urls/{videoId} to check status."
            }
            
            # Final content update event - mark as completed
            final_update = {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "actionType": todo.action_type,
                "slideType": "AI_VIDEO",
                "contentData": ai_video_details,
                "metadata": {
                    "isGenerating": False,  # Content generation is complete
                    "videoId": video_id,
                    "backgroundGeneration": True  # HTML still generating
                }
            }
            yield json.dumps(final_update)
            
            logger.info(f"Successfully sent final AI_VIDEO update for {todo.path}. Content generation marked as completed.")
            
            # Start background task to continue generation till HTML
            # This runs asynchronously and doesn't block the response
            async def continue_html_generation():
                """Background task to continue video generation till HTML stage."""
                try:
                    logger.info(f"[AI_VIDEO] Starting background HTML generation for {video_id}")
                    
                    # Small delay to ensure S3 uploads and DB updates are complete
                    import asyncio
                    await asyncio.sleep(1)
                    
                    # Verify script file is available in S3 before resuming
                    video_status_check = self._video_gen_service.get_video_status(video_id)
                    if video_status_check and video_status_check.get("s3_urls", {}).get("script"):
                        logger.info(f"[AI_VIDEO] Script file confirmed in S3: {video_status_check['s3_urls']['script']}")
                    else:
                        logger.warning(f"[AI_VIDEO] Script file not found in S3, but proceeding anyway (may fail)")
                    
                    # Resume from SCRIPT stage and continue till HTML. Leg 1
                    # ended with the run lease in `handoff` (its completed
                    # stages are short of the run request's final HTML); this
                    # leg acquires it — or, if a resumer on another pod already
                    # took the run over, yields LEASE_HELD and stops.
                    async for event in self._video_gen_service.generate_till_stage(
                        video_id=video_id,
                        prompt=prompt,
                        target_stage="HTML",  # Continue till HTML
                        resume=True,  # Resume from current stage (SCRIPT)
                        db_session=self._db_session,
                        **_video_kwargs,
                    ):
                        # Log background progress but don't send events to frontend
                        if event.get("type") == "completed":
                            logger.info(f"[AI_VIDEO] Background HTML generation completed for {video_id}")
                        elif event.get("type") == "error":
                            logger.error(f"[AI_VIDEO] Background HTML generation error for {video_id}: {event.get('message')}")
                    
                    # Verify final status
                    final_status = self._video_gen_service.get_video_status(video_id)
                    if final_status:
                        logger.info(f"[AI_VIDEO] Background generation finished. Final stage: {final_status.get('current_stage')}, Status: {final_status.get('status')}")
                        logger.info(f"[AI_VIDEO] Available files: {list(final_status.get('file_ids', {}).keys())}")
                    else:
                        logger.warning(f"[AI_VIDEO] Could not verify final status for {video_id}")
                        
                except Exception as bg_error:
                    import traceback
                    error_trace = traceback.format_exc()
                    logger.error(f"[AI_VIDEO] Background HTML generation failed for {video_id}: {str(bg_error)}")
                    logger.error(f"[AI_VIDEO] Background error traceback:\n{error_trace}")
            
            # Start background task (fire and forget)
            # Store task reference to prevent garbage collection
            try:
                loop = asyncio.get_event_loop()
                bg_task = loop.create_task(continue_html_generation())
                # Add done callback to log completion/errors
                def task_done_callback(task):
                    if task.cancelled():
                        logger.warning(f"[AI_VIDEO] Background task for {video_id} was cancelled")
                    elif task.exception():
                        logger.error(f"[AI_VIDEO] Background task for {video_id} raised exception: {task.exception()}")
                    else:
                        logger.info(f"[AI_VIDEO] Background task for {video_id} completed successfully")
                bg_task.add_done_callback(task_done_callback)
                logger.info(f"[AI_VIDEO] Background HTML generation task started for {video_id}")
            except Exception as task_error:
                logger.error(f"[AI_VIDEO] Failed to start background task for {video_id}: {str(task_error)}")
                # Don't fail the main request if background task fails to start
            
        except Exception as e:
            import traceback
            error_msg = str(e)
            error_trace = traceback.format_exc()
            logger.error(f"[AI_VIDEO] Error generating AI video content for {todo.path}: {error_msg}")
            logger.error(f"[AI_VIDEO] Full traceback:\n{error_trace}")
            
            error_response = {
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": "AI_VIDEO",
                "errorMessage": f"Failed to generate AI video: {error_msg}",
                "contentData": f"Error generating AI video: {error_msg}",
            }
            yield json.dumps(error_response)

    async def generate_ai_slides_content(
        self, todo: Todo
    ) -> AsyncGenerator[str, None]:
        """
        Generate AI Slides content for an AI_SLIDES type todo.
        Uses the SLIDES content_type in the video generation pipeline (no TTS stages).
        Targets HTML stage directly since SLIDES skip TTS/WORDS stages.
        """
        try:
            logger.info(f"[AI_SLIDES] Starting generation for slide: {todo.path}")

            video_id = f"slides-{todo.path.replace('.', '-').replace('/', '-')}-{str(uuid4())[:8]}"
            logger.info(f"[AI_SLIDES] Generated video_id: {video_id}")

            prompt = todo.prompt or f"Create an educational slide deck explaining: {todo.title or todo.name}"

            started_event = {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "actionType": todo.action_type,
                "slideType": "AI_SLIDES",
                "contentData": {
                    "videoId": video_id,
                    "status": "GENERATING",
                    "message": "AI Slides generation started...",
                    "currentStage": "INITIALIZING",
                    "progress": 0,
                },
                "metadata": {"isGenerating": True, "videoId": video_id},
            }
            yield json.dumps(started_event)

            pipeline_error: Optional[str] = None
            # SLIDES skips TTS/WORDS — target HTML directly
            async for event in self._video_gen_service.generate_till_stage(
                video_id=video_id,
                prompt=prompt,
                target_stage="HTML",
                content_type="SLIDES",
                language=todo.metadata.get("language", "English"),
                captions_enabled=False,  # SLIDES are visual-only
                html_quality=todo.metadata.get("html_quality", "advanced"),
                resume=False,
                model=self._wizard_model(todo),
                target_audience=todo.metadata.get("target_audience", "General/Adult"),
                target_duration=todo.metadata.get("target_duration", "2-3 minutes"),
                **self._video_voice_kwargs(todo),
                db_session=self._db_session,
                institute_id=self._institute_id,
                user_id=self._user_id,
            ):
                if event.get("type") == "error":
                    pipeline_error = event.get("message") or "Slides generation failed"
                    break
                wrapped_event = {
                    "type": "SLIDE_CONTENT_UPDATE",
                    "path": todo.path,
                    "status": True,
                    "actionType": todo.action_type,
                    "slideType": "AI_SLIDES",
                    "contentData": {
                        "videoId": video_id,
                        "status": "GENERATING",
                        "currentStage": event.get("stage", "UNKNOWN"),
                        "progress": event.get("percentage", 0),
                        "message": f"Generating slides: {event.get('stage', 'stage')}...",
                    },
                    "metadata": {"isGenerating": True, "videoId": video_id, "internalEvent": event},
                }
                yield json.dumps(wrapped_event)

            video_status = self._video_gen_service.get_video_status(video_id)
            if not video_status:
                raise ValueError(f"AI Slides generation failed: no status found for {video_id}")
            if pipeline_error or video_status.get("status") in ("FAILED", "CANCELLED"):
                raise ValueError(
                    pipeline_error
                    or f"AI Slides generation {video_status.get('status', 'FAILED').lower()}"
                )

            ai_slides_details = {
                "videoId": video_id,
                "status": "COMPLETED",
                "htmlFileId": video_status["file_ids"].get("html"),
                "htmlUrl": video_status["s3_urls"].get("html"),
                "language": video_status.get("language", "English"),
                "currentStage": "HTML",
                "progress": 100,
            }

            final_update = {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "actionType": todo.action_type,
                "slideType": "AI_SLIDES",
                "contentData": ai_slides_details,
                "metadata": {"isGenerating": False, "videoId": video_id},
            }
            yield json.dumps(final_update)
            logger.info(f"[AI_SLIDES] Successfully completed generation for {todo.path}")

        except Exception as e:
            import traceback
            error_msg = str(e)
            logger.error(f"[AI_SLIDES] Error generating AI slides content for {todo.path}: {error_msg}")
            logger.error(f"[AI_SLIDES] Traceback:\n{traceback.format_exc()}")
            yield json.dumps({
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": "AI_SLIDES",
                "errorMessage": f"Failed to generate AI slides: {error_msg}",
                "contentData": f"Error generating AI slides: {error_msg}",
            })

    async def generate_ai_storybook_content(
        self, todo: Todo
    ) -> AsyncGenerator[str, None]:
        """
        Generate AI Storybook content for an AI_STORYBOOK type todo.
        Uses the STORYBOOK content_type in the video generation pipeline.
        Stops at SCRIPT stage (fast response) and continues HTML in background.
        """
        try:
            logger.info(f"[AI_STORYBOOK] Starting generation for slide: {todo.path}")

            video_id = f"storybook-{todo.path.replace('.', '-').replace('/', '-')}-{str(uuid4())[:8]}"
            logger.info(f"[AI_STORYBOOK] Generated video_id: {video_id}")

            prompt = todo.prompt or f"Create an illustrated educational storybook about: {todo.title or todo.name}"

            started_event = {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "actionType": todo.action_type,
                "slideType": "AI_STORYBOOK",
                "contentData": {
                    "videoId": video_id,
                    "status": "GENERATING",
                    "message": "AI Storybook generation started. This may take 2-5 minutes...",
                    "currentStage": "INITIALIZING",
                    "progress": 0,
                },
                "metadata": {"isGenerating": True, "videoId": video_id},
            }
            yield json.dumps(started_event)

            pipeline_error: Optional[str] = None
            _story_kwargs = dict(
                content_type="STORYBOOK",
                language=todo.metadata.get("language", "English"),
                captions_enabled=True,
                html_quality=todo.metadata.get("html_quality", "advanced"),
                model=self._wizard_model(todo),
                target_audience=todo.metadata.get("target_audience", "General/Adult"),
                target_duration=todo.metadata.get("target_duration", "2-3 minutes"),
                **self._video_voice_kwargs(todo),
                institute_id=self._institute_id,
                user_id=self._user_id,
            )
            from .video_run_request import capture as _capture_run_request
            _story_run_request = _capture_run_request("storybook_builder", "HTML", _story_kwargs)
            async for event in self._video_gen_service.generate_till_stage(
                video_id=video_id,
                prompt=prompt,
                target_stage="SCRIPT",
                resume=False,
                db_session=self._db_session,
                run_request=_story_run_request,
                **_story_kwargs,
            ):
                if event.get("type") == "error":
                    pipeline_error = event.get("message") or "Storybook generation failed"
                    break
                wrapped_event = {
                    "type": "SLIDE_CONTENT_UPDATE",
                    "path": todo.path,
                    "status": True,
                    "actionType": todo.action_type,
                    "slideType": "AI_STORYBOOK",
                    "contentData": {
                        "videoId": video_id,
                        "status": "GENERATING",
                        "currentStage": event.get("stage", "UNKNOWN"),
                        "progress": event.get("percentage", 0),
                        "message": f"Generating storybook: {event.get('stage', 'stage')}...",
                    },
                    "metadata": {"isGenerating": True, "videoId": video_id, "internalEvent": event},
                }
                yield json.dumps(wrapped_event)

            video_status = self._video_gen_service.get_video_status(video_id)
            if not video_status:
                raise ValueError(f"AI Storybook generation failed: no status found for {video_id}")
            if pipeline_error or video_status.get("status") in ("FAILED", "CANCELLED"):
                raise ValueError(
                    pipeline_error
                    or f"AI Storybook generation {video_status.get('status', 'FAILED').lower()}"
                )

            ai_storybook_details = {
                "videoId": video_id,
                "status": "COMPLETED",
                "scriptFileId": video_status["file_ids"].get("script"),
                "scriptUrl": video_status["s3_urls"].get("script"),
                "language": video_status.get("language", "English"),
                "currentStage": "SCRIPT",
                "progress": 100,
                "backgroundGeneration": True,
                "message": "Storybook script generated. HTML is being generated in the background.",
            }

            final_update = {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "actionType": todo.action_type,
                "slideType": "AI_STORYBOOK",
                "contentData": ai_storybook_details,
                "metadata": {"isGenerating": False, "videoId": video_id, "backgroundGeneration": True},
            }
            yield json.dumps(final_update)

            # Background task to continue to HTML stage
            async def continue_storybook_html():
                try:
                    logger.info(f"[AI_STORYBOOK] Starting background HTML generation for {video_id}")
                    await asyncio.sleep(1)
                    async for event in self._video_gen_service.generate_till_stage(
                        video_id=video_id,
                        prompt=prompt,
                        target_stage="HTML",
                        resume=True,
                        db_session=self._db_session,
                        **_story_kwargs,
                    ):
                        if event.get("type") == "completed":
                            logger.info(f"[AI_STORYBOOK] Background HTML generation completed for {video_id}")
                        elif event.get("type") == "error":
                            logger.error(f"[AI_STORYBOOK] Background HTML error for {video_id}: {event.get('message')}")
                except Exception as bg_error:
                    logger.error(f"[AI_STORYBOOK] Background HTML generation failed for {video_id}: {str(bg_error)}")

            try:
                loop = asyncio.get_event_loop()
                bg_task = loop.create_task(continue_storybook_html())
                bg_task.add_done_callback(
                    lambda t: logger.warning(f"[AI_STORYBOOK] Background task cancelled for {video_id}")
                    if t.cancelled()
                    else (
                        logger.error(f"[AI_STORYBOOK] Background task error: {t.exception()}")
                        if t.exception()
                        else logger.info(f"[AI_STORYBOOK] Background task done for {video_id}")
                    )
                )
                logger.info(f"[AI_STORYBOOK] Background HTML task started for {video_id}")
            except Exception as task_error:
                logger.error(f"[AI_STORYBOOK] Failed to start background task for {video_id}: {str(task_error)}")

        except Exception as e:
            import traceback
            error_msg = str(e)
            logger.error(f"[AI_STORYBOOK] Error generating AI storybook content for {todo.path}: {error_msg}")
            logger.error(f"[AI_STORYBOOK] Traceback:\n{traceback.format_exc()}")
            yield json.dumps({
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": "AI_STORYBOOK",
                "errorMessage": f"Failed to generate AI storybook: {error_msg}",
                "contentData": f"Error generating AI storybook: {error_msg}",
            })

    async def generate_video_code_content(
        self, todo: Todo
    ) -> dict:
        """
        Generate video+code content for a VIDEO_CODE type todo.
        Combines YouTube video with code examples in a split-screen layout.
        
        Format: {
            "type": "SLIDE_CONTENT_UPDATE",
            "path": "<slidePath>",
            "status": true,
            "title": "<title>",
            "actionType": "<actionType>",
            "slideType": "VIDEO_CODE",
            "contentData": {
                "video": { ... YouTube video details ... },
                "code": { "content": "...", "language": "python" },
                "layout": "split-left" | "split-right" | "split-top" | "split-bottom"
            }
        }
        """
        try:
            logger.info(f"Generating video+code content for slide: {todo.path}")
            
            # Step 1: Generate YouTube video content (billed below, only after
            # the code leg also succeeds — a half-delivered slide isn't charged)
            video_content = await self.generate_video_content(todo, bill=False)
            if not video_content.get("status") or video_content.get("type") == "SLIDE_CONTENT_ERROR":
                raise ValueError(f"Failed to generate video: {video_content.get('errorMessage', 'Unknown error')}")
            
            video_data = video_content.get("contentData", {})
            
            # Step 2: Generate code content
            language = (todo.metadata or {}).get("language", "English")
            code_prompt = ContentGenerationPrompts.build_code_prompt(
                text_prompt=todo.prompt,
                title=todo.title or todo.name,
                video_topic=todo.title or todo.name,
                language=language,
            )

            code_content = await self._llm_client.generate_outline(
                prompt=code_prompt,
                model=self._model_for(todo),
            )

            # Extract code language from prompt or default to python
            code_language = self._extract_code_language(todo.prompt) or "python"

            # Step 3: Determine layout (default: split-left)
            layout = self._extract_layout_preference(todo.prompt) or "split-left"

            # Parametric per-slide charge, now that both legs succeeded.
            self._bill_slide(tool_key="course_slide_video", todo=todo, model=self._model_for(todo))

            # Format response
            return {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "title": todo.title or todo.name,
                "actionType": todo.action_type,
                "slideType": "VIDEO_CODE",
                "contentData": {
                    "video": video_data,
                    "code": {
                        "content": code_content,
                        "language": code_language
                    },
                    "layout": layout
                },
            }
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Error generating video+code content for {todo.path}: {error_msg}")
            return {
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": "VIDEO_CODE",
                "errorMessage": f"Failed to generate content: {error_msg}",
                "contentData": "Error generating video+code content for this slide. Please try again or contact support.",
            }

    async def generate_ai_video_code_content(
        self, todo: Todo
    ) -> AsyncGenerator[str, None]:
        """
        Generate AI video+code content for an AI_VIDEO_CODE type todo.
        Combines AI-generated video with code examples in a split-screen layout.
        Streams progress events and returns final combined content.
        """
        try:
            logger.info(f"[AI_VIDEO_CODE] Starting generation for slide: {todo.path}")
            
            # Step 1: Generate AI video (stream events)
            video_id = None
            video_status = None
            completed_found = False
            
            # CRITICAL: Consume ALL events from generate_ai_video_content to ensure the background task starts.
            # The background task is created AFTER the async generator completes in generate_ai_video_content.
            # If we break early, the generator never completes and the background task never starts.
            async for event_str in self.generate_ai_video_content(todo):
                event = json.loads(event_str)

                # A terminal pipeline error ends the video leg — surface the
                # real message (its contentData is a string, not a dict).
                if event.get("type") == "SLIDE_CONTENT_ERROR":
                    raise ValueError(event.get("errorMessage") or "AI video generation failed")

                # Extract video_id from events
                if event.get("slideType") == "AI_VIDEO":
                    content_data = event.get("contentData", {})
                    if content_data.get("videoId") and not video_id:
                        video_id = content_data.get("videoId")
                    
                    # If video generation is complete, capture status but DON'T break
                    # We must continue consuming to ensure the background task gets created
                    if content_data.get("status") == "COMPLETED" and not completed_found:
                        video_status = content_data
                        completed_found = True
                        logger.info(f"[AI_VIDEO_CODE] Video generation marked as COMPLETED, but continuing to consume events to start background task")
                    
                    # Forward progress events with updated slide type (only before completion)
                    # After completion, we still consume events but don't forward them
                    if not completed_found:
                        progress_event = {
                            "type": "SLIDE_CONTENT_UPDATE",
                            "path": todo.path,
                            "status": True,
                            "actionType": todo.action_type,
                            "slideType": "AI_VIDEO_CODE",
                            "contentData": {
                                "video": content_data,
                                "status": "GENERATING_VIDEO",
                                "message": f"Generating video: {content_data.get('currentStage', 'Processing')}...",
                                "progress": content_data.get("progress", 0)
                            }
                        }
                        yield json.dumps(progress_event)
            
            if not video_status or not video_id:
                raise ValueError(f"AI video generation failed for {todo.path}")
            
            # Step 2: Generate code content
            logger.info(f"[AI_VIDEO_CODE] Generating code content for {todo.path}")

            language = (todo.metadata or {}).get("language", "English")
            code_prompt = ContentGenerationPrompts.build_code_prompt(
                text_prompt=todo.prompt,
                title=todo.title or todo.name,
                video_topic=todo.title or todo.name,
                language=language,
            )
            
            # Generate code content and capture token usage
            usage_info = {}
            if hasattr(self._llm_client, 'generate_outline_with_usage'):
                code_content, usage_info = await self._llm_client.generate_outline_with_usage(
                    prompt=code_prompt,
                    model=self._model_for(todo),
                )
                
                # Record token usage for content generation
                if self._db_session and usage_info:
                    try:
                        from .ai_billing import UC, supported_kwargs
                        token_service = TokenUsageService(self._db_session)
                        # Determine provider based on model
                        api_provider = ApiProvider.GEMINI if "gemini" in self._model_for(todo).lower() else ApiProvider.OPENAI
                        token_service.record_usage_and_deduct_credits(
                            api_provider=api_provider,
                            prompt_tokens=usage_info.get("prompt_tokens", 0),
                            completion_tokens=usage_info.get("completion_tokens", 0),
                            total_tokens=usage_info.get("total_tokens", 0),
                            request_type=RequestType.CONTENT,
                            institute_id=self._institute_id,
                            user_id=self._user_id,
                            model=self._model_for(todo),
                            **supported_kwargs(
                                token_service.record_usage_and_deduct_credits,
                                self._meter_kwargs(UC.CONTENT, {"slide_path": todo.path,
                                                                "feature": "ai_video_code"}),
                            ),
                        )
                    except Exception as e:
                        logger.warning(f"Failed to record content generation token usage: {str(e)}")
            else:
                code_content = await self._llm_client.generate_outline(
                    prompt=code_prompt,
                    model=self._model_for(todo),
                )
            
            # Extract code language and layout
            code_language = self._extract_code_language(todo.prompt) or "python"
            layout = self._extract_layout_preference(todo.prompt) or "split-left"
            
            # Step 3: Combine and return final content
            final_content = {
                "type": "SLIDE_CONTENT_UPDATE",
                "path": todo.path,
                "status": True,
                "title": todo.title or todo.name,
                "actionType": todo.action_type,
                "slideType": "AI_VIDEO_CODE",
                "contentData": {
                    "video": video_status,
                    "code": {
                        "content": code_content,
                        "language": code_language
                    },
                    "layout": layout
                },
            }
            
            yield json.dumps(final_content)
            logger.info(f"[AI_VIDEO_CODE] Successfully completed generation for {todo.path}")
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"[AI_VIDEO_CODE] Error generating AI video+code content for {todo.path}: {error_msg}")
            error_response = {
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": "AI_VIDEO_CODE",
                "errorMessage": f"Failed to generate AI video+code: {error_msg}",
                "contentData": f"Error generating AI video+code: {error_msg}",
            }
            yield json.dumps(error_response)

    def _extract_code_language(self, prompt: str) -> Optional[str]:
        """Extract programming language from prompt if mentioned."""
        prompt_lower = prompt.lower()
        languages = {
            "python": ["python", "py"],
            "javascript": ["javascript", "js", "node"],
            "java": ["java"],
            "cpp": ["c++", "cpp", "c plus plus"],
            "c": [" c ", " c,"],
            "typescript": ["typescript", "ts"],
            "go": ["go", "golang"],
            "rust": ["rust"],
            "php": ["php"],
            "ruby": ["ruby"],
            "swift": ["swift"],
            "kotlin": ["kotlin"],
            "html": ["html"],
            "css": ["css"],
            "sql": ["sql", "database"],
        }
        
        for lang, keywords in languages.items():
            if any(keyword in prompt_lower for keyword in keywords):
                return lang
        return None

    def _extract_layout_preference(self, prompt: str) -> Optional[str]:
        """Extract layout preference from prompt if mentioned."""
        prompt_lower = prompt.lower()
        
        if "split-left" in prompt_lower or "video left" in prompt_lower or "code right" in prompt_lower:
            return "split-left"
        elif "split-right" in prompt_lower or "video right" in prompt_lower or "code left" in prompt_lower:
            return "split-right"
        elif "split-top" in prompt_lower or "video top" in prompt_lower or "code bottom" in prompt_lower:
            return "split-top"
        elif "split-bottom" in prompt_lower or "video bottom" in prompt_lower or "code top" in prompt_lower:
            return "split-bottom"
        
        return None

    def _extract_json_from_response(self, response: str) -> dict:
        """
        Extract JSON from LLM response, handling markdown code blocks and other formatting.
        Matches the pattern from media-service JsonUtils.extractAndSanitizeJson.
        """
        # Defensive: a None/empty completion used to raise TypeError here
        # ("argument of type 'NoneType' is not iterable"), which surfaced as an
        # unhelpful error on the slide. Callers now retry empties upstream; this
        # keeps the parser itself honest.
        if not response:
            raise ValueError("empty LLM response — nothing to parse")

        # Remove markdown code blocks if present
        if "```json" in response:
            start = response.find("```json") + 7
            end = response.find("```", start)
            if end != -1:
                response = response[start:end].strip()
        elif "```" in response:
            start = response.find("```") + 3
            end = response.find("```", start)
            if end != -1:
                response = response[start:end].strip()
        
        # Try to find JSON object boundaries
        start_idx = response.find("{")
        end_idx = response.rfind("}")
        
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            json_str = response[start_idx : end_idx + 1]
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse JSON, returning raw content")
                return {"raw_content": response}
        
        # Fallback: return as string wrapped in dict
        return {"raw_content": response}

    def _get_homework_path_for_solution(self, solution_path: str) -> Optional[str]:
        """Get the homework slide path for a solution slide (same chapter, previous SL number). E.g. C1.CH1.SL3 -> C1.CH1.SL2."""
        parts = solution_path.split(".")
        for i in range(len(parts) - 1, -1, -1):
            if parts[i].startswith("SL"):
                try:
                    num = int(parts[i][2:])
                    if num <= 1:
                        return None
                    parts[i] = f"SL{num - 1}"
                    return ".".join(parts)
                except ValueError:
                    return None
        return None

    async def generate_content_for_todo(
        self, todo: Todo, generated_content_by_path: Optional[dict] = None
    ) -> AsyncGenerator[str, None]:
        """
        Generate content for a single todo and yield the formatted JSON update.
        When generating a "Homework Solutions" slide, pass generated_content_by_path (path -> contentData)
        so the solution can use the actual homework content from the previous slide.
        """
        try:
            logger.info(
                f"Initiating content generation for slide: {todo.path} "
                f"(Type: {todo.type}, Action: {todo.action_type})"
            )
            generated_content_by_path = generated_content_by_path or {}

            # Ground EVERY slide type, not just documents. Every generator below
            # reads `todo.prompt or <fallback>`, so appending here reaches videos,
            # slide decks, storybooks and quizzes too — and quizzes are where it
            # matters most, because questions drawn from the institute's own
            # exercises are the thing teachers actually ask for.
            kb_block = self._kb_grounding_by_path.get(todo.path)
            # Idempotent: this mutates the Todo, and there are several dispatch
            # paths (parallel phase, sequential homework→solution pairs). They
            # are disjoint today, but appending 12k characters twice would be
            # silent and expensive, so key off a marker rather than that invariant.
            if kb_block and "===== COURSE MATERIAL" not in (todo.prompt or ""):
                # Seed from the title when a todo carries no prompt, so grounding
                # is never dropped just because the outline left it empty.
                base = todo.prompt or (todo.title or todo.name or "")
                todo.prompt = f"{base}{kb_block}"

            homework_content = None
            if todo.type == "DOCUMENT":
                title_lower = (todo.title or todo.name or "").lower()
                if "homework solutions" in title_lower or "assignment solutions" in title_lower:
                    homework_path = self._get_homework_path_for_solution(todo.path)
                    if homework_path:
                        homework_content = generated_content_by_path.get(homework_path)
                        if homework_content:
                            logger.info(f"Using homework content from {homework_path} for solution slide {todo.path}")
                        else:
                            logger.warning(f"No homework content found at {homework_path} for solution {todo.path}")
            # Generate content based on todo type
            if todo.type == "DOCUMENT":
                content_update = await self.generate_document_content(
                    todo=todo, prompt=todo.prompt, homework_content=homework_content
                )
                # Yield the content update as JSON string (matches media-service format)
                yield json.dumps(content_update)
            elif todo.type == "ASSESSMENT":
                content_update = await self.generate_assessment_content(
                    todo=todo, prompt=todo.prompt
                )
                # Yield the content update as JSON string
                yield json.dumps(content_update)
            elif todo.type == "VIDEO":
                content_update = await self.generate_video_content(todo=todo)
                # Yield the content update as JSON string
                yield json.dumps(content_update)
            elif todo.type == "VIDEO_CODE":
                content_update = await self.generate_video_code_content(todo=todo)
                # Yield the content update as JSON string
                yield json.dumps(content_update)
            elif todo.type == "AI_VIDEO":
                # AI_VIDEO generation streams multiple events
                async for event in self.generate_ai_video_content(todo=todo):
                    yield event
            elif todo.type == "AI_VIDEO_CODE":
                # AI_VIDEO_CODE generation streams multiple events
                async for event in self.generate_ai_video_code_content(todo=todo):
                    yield event
            elif todo.type == "AI_SLIDES":
                # AI_SLIDES generation streams multiple events
                async for event in self.generate_ai_slides_content(todo=todo):
                    yield event
            elif todo.type == "AI_STORYBOOK":
                # AI_STORYBOOK generation streams multiple events
                async for event in self.generate_ai_storybook_content(todo=todo):
                    yield event
            else:
                logger.warning(f"Unknown todo type: {todo.type}, skipping content generation")
                return
            
            logger.info(f"Successfully completed content generation for slide: {todo.path}")
            
        except Exception as e:
            logger.error(f"Failed content generation for slide {todo.path}: {str(e)}")
            # Yield error response
            error_response = {
                "type": "SLIDE_CONTENT_ERROR",
                "path": todo.path,
                "status": False,
                "actionType": todo.action_type,
                "slideType": todo.type,
                "errorMessage": f"Failed to generate content: {str(e)}",
                "contentData": "Error generating content for this slide. Please try again or contact support.",
            }
            yield json.dumps(error_response)


__all__ = ["ContentGenerationService"]

