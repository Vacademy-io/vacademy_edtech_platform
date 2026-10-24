"""Catalog of every model use case (`ai_model_defaults.use_case`).

One entry per key that any service reads from `ai_model_defaults`. The
super-admin "Model defaults" page (GET /super-admin/v1/models/catalog) merges
this with the DB rows, so a super admin sees what each key drives and where in
the code it is read, and the bulk "set every chat feature" action knows which
keys to leave alone (`held_reason`) and which are not chat LLMs (`chat=False`).

Consumers are "file:line" pointers at the time of writing — a guide for a
human, not something code depends on; they drift as files change.

Adding a use case: add an entry here (and, for a fresh install, a seed row in
the admin_core Flyway migration). A DB row without a catalog entry still shows
on the page under group 'Other'.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

GROUP_LEARNER = "Learner AI"
GROUP_CONTENT = "Content & courses"
GROUP_ASSESSMENT = "Assessment & evaluation"
GROUP_VIDEO = "Video"
GROUP_ADMIN = "Admin & CRM"
GROUP_PLATFORM = "Platform"
GROUP_OTHER = "Other"

GROUPS: Tuple[str, ...] = (
    GROUP_LEARNER, GROUP_CONTENT, GROUP_ASSESSMENT, GROUP_VIDEO, GROUP_ADMIN, GROUP_PLATFORM,
)

KIND_CHAT = "chat"
KIND_VISION = "vision"
KIND_IMAGE = "image"  # an image-generation model (ai_models.category = image)

_AI = "ai_service/app/"
_AC = "admin_core_service: "
_AS = "assessment_service: "
_CS = "community_service: "
_NS = "notification_service: "


@dataclass(frozen=True)
class UseCase:
    use_case: str
    label: str
    group: str
    service: str
    kind: str                      # 'chat' | 'vision' (vision = reads images; needs a multimodal model)
    description: str
    consumers: Tuple[str, ...] = ()
    held_reason: Optional[str] = None  # set → bulk "set all" skips it
    chat: bool = True              # False → not a chat LLM (image gen, embeddings, TTS): never bulk-set
    seeded_in_release_2: bool = False  # a new key seeded GLM + gemini-2.5-flash by the R2 Flyway migration

    def to_dict(self) -> Dict[str, object]:
        return {
            "use_case": self.use_case,
            "label": self.label,
            "group": self.group,
            "service": self.service,
            "kind": self.kind,
            "description": self.description,
            "consumers": list(self.consumers),
            "held_reason": self.held_reason,
        }


STUDENT_REPORT_HELD = (
    "GLM timed out >170 s on comprehensive reports; flip after gateway routing + timed run"
)
REELS_SELECTION_HELD = (
    "Reels rerank still calls OpenRouter directly with a small max_tokens; GLM there returns "
    "empty replies. Flip after reels selection routes through llm_router (reasoning low + headroom)"
)
_NOT_CHAT = "Not a chat LLM ({what}); bulk chat changes never touch it — edit it on its own"


USE_CASES: Tuple[UseCase, ...] = (
    # ── Learner AI ────────────────────────────────────────────────────────────
    UseCase(
        "chat", "Chat with PDF & generic chat completion", GROUP_LEARNER, "ai_service", KIND_CHAT,
        "Learner chat-with-PDF answers, and /chat/v1/complete for callers that name no other use case.",
        (_AI + "services/chat_with_pdf_service.py:43", _AI + "adapters/openrouter_llm_client.py:39",
         _AI + "routers/chat_bot.py:/chat/v1/complete"),
    ),
    UseCase(
        "parent_assistant", "Parent portal assistant", GROUP_LEARNER, "admin_core_service", KIND_CHAT,
        "Answers parents' questions in the parent portal (admin_core → ai_service /chat/v1/complete).",
        (_AC + "ParentAssistantService.java:90", _AC + "AiServiceCompletionClient.java:40",
         _AI + "routers/chat_bot.py:/chat/v1/complete"),
        seeded_in_release_2=True,
    ),
    UseCase(
        "kb_companion", "KB Companions (lesson cards, ask, practice)", GROUP_LEARNER, "ai_service", KIND_CHAT,
        "Student visual tutor per knowledge base: lesson cards, answers and practice questions.",
        (_AI + "services/kb_companion/model_choice.py:26",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "site_assistant", "Website assistant (public site chatbot)", GROUP_LEARNER, "ai_service", KIND_CHAT,
        "Answers anonymous visitors on institute websites (hosted sites and the embed snippet) with catalogue, "
        "page, FAQ and live-class tools. 1 credit per answer.",
        (_AI + "site_assistant/engine.py:llm_stream", _AI + "site_assistant/settings.py:DEFAULT_MODEL"),
        held_reason=(
            "Public chat widget with a ~2 s first-answer budget: needs a model whose reasoning can be turned off "
            "(default Gemini 2.5 Flash, GLM as fallback). GLM-5.3-flash always reasons, so bulk 'all chat features "
            "to GLM' skips it"
        ),
    ),
    UseCase(
        "knowledge_base_qa", "Knowledge base Q&A + paper blueprint", GROUP_LEARNER, "ai_service", KIND_CHAT,
        "Grounded answers from an institute's knowledge base, and the KB question-paper blueprint.",
        (_AI + "services/kb/retrieval.py:37", _AI + "services/kb/paper.py:50"),
    ),
    UseCase(
        "live_session_summary", "Live class summary & action points", GROUP_LEARNER, "community_service", KIND_CHAT,
        "Summarises a live session transcript into notes and action points (via ai_service internal completion).",
        (_CS + "LiveSessionService.java:1228", _CS + "DeepSeekApiService.java:17",
         _AI + "routers/internal_llm.py:/internal/llm/v1/complete"),
        seeded_in_release_2=True,
    ),
    # ── Content & courses ────────────────────────────────────────────────────
    UseCase(
        "outline", "Course outline", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "AI course creation: the course outline (modules, chapters, slide plan).",
        (_AI + "routers/course_outline.py:124", _AI + "services/course_outline_service.py:558",
         _AI + "services/course_outline_service.py:740"),
    ),
    UseCase(
        "content", "Course content (per slide)", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "AI course creation: the text/HTML content of each slide after the outline.",
        (_AI + "services/content_generation_service.py:86",),
    ),
    UseCase(
        "html_document", "AI HTML documents", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Rich HTML documents/pages generated inside courses.",
        (_AI + "routers/html_document.py:51", _AI + "services/content_generation_service.py:93"),
        seeded_in_release_2=True,
    ),
    UseCase(
        "course_assist", "Course step-1 copywriting assist", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Writes the course title, description and highlights in the course-creation wizard.",
        (_AI + "routers/course_assist.py:51",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "transcript_notes", "Transcript → study notes", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Turns a lecture/video transcript into structured study notes.",
        (_AI + "routers/transcript_notes.py:88",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "lecture", "Lecture planner & feedback", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Lecture plans and lecture feedback for teachers.",
        (_AI + "services/lecture_planner_service.py:32", _AI + "services/retry_dispatch.py:42"),
    ),
    UseCase(
        "translation", "Translation", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Translates course content, slides and documents.",
        (_AI + "services/translation_service.py:715", _AI + "services/translation_service.py:959",
         _AI + "services/translation_service.py:1432"),
    ),
    UseCase(
        "knowledge_base_summary", "Knowledge base summaries & topics", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Summaries and topic maps built when a knowledge base is ingested.",
        (_AI + "services/kb/summary_index.py:43", _AI + "services/kb/topics.py:34"),
    ),
    UseCase(
        "knowledge_base_figure", "Knowledge base figures", GROUP_CONTENT, "ai_service", KIND_VISION,
        "Figure descriptions during knowledge-base ingestion (reserved; not read by code yet).",
        (_AI + "services/kb/parsing.py:22",),
    ),
    UseCase(
        "presentation", "AI presentations (Volt slides)", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Generates presentation decks.",
        (_AI + "services/presentation_service.py:24",),
    ),
    UseCase(
        "page_builder", "Website / page builder", GROUP_CONTENT, "ai_service", KIND_VISION,
        "Manage Pages AI: compose, repair, edit, variants, chrome, intake — including its vision passes on attachments.",
        (_AI + "routers/page_builder.py:777", _AI + "routers/page_builder.py:2698",
         _AI + "routers/page_builder.py:4902"),
    ),
    UseCase(
        "brand_kit", "Brand-kit scrape", GROUP_CONTENT, "ai_service", KIND_VISION,
        "Reads a website's screenshots to extract colours, fonts and logo for the page builder.",
        (_AI + "services/brand_kit_scrape_service.py:92",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "image_keyword", "Image-search keywords", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Turns slide/course text into stock-image search keywords (banners, docs, quiz images).",
        (_AI + "services/image_service.py:572",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "engagement_plan", "Engagement plans", GROUP_CONTENT, "ai_service", KIND_CHAT,
        "Daily engagement plans (draft + stream) and flashcards.",
        (_AI + "services/engagement_plan_service.py:47",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "copilot", "Instructor copilot", GROUP_CONTENT, "admin_core_service", KIND_CHAT,
        "Live-class instructor copilot suggestions.",
        (_AC + "InstructorCopilotLLMService.java:54",),
    ),
    # ── Assessment & evaluation ──────────────────────────────────────────────
    UseCase(
        "questions", "Question generation", GROUP_ASSESSMENT, "ai_service", KIND_VISION,
        "Questions from text, PDF, images, audio, paper digitise, retries, KB papers and coding questions.",
        (_AI + "services/question_gen_service.py:22", _AI + "routers/retry.py:115",
         _AI + "routers/coding_question_gen.py:140"),
    ),
    UseCase(
        "agent", "Assessment generation (transcript / topic)", GROUP_ASSESSMENT, "ai_service", KIND_CHAT,
        "Generates assessments from a transcript or topic, incl. live-class recording assessments.",
        (_AI + "routers/assessment_generation.py:166", _AI + "services/quiz_service.py:270"),
    ),
    UseCase(
        "evaluation", "Copy-check grading & criteria", GROUP_ASSESSMENT, "ai_service", KIND_VISION,
        "Grades handwritten answer sheets (vision transcript, maths re-read, rubric) and generates subjective criteria.",
        (_AI + "services/evaluation_service.py:40", _AI + "services/copy_check/grader.py:36",
         _AS + "AiCriteriaGenerationService.java:70"),
    ),
    UseCase(
        "copy_check_deduction", "Copy-check deduction re-check", GROUP_ASSESSMENT, "ai_service", KIND_VISION,
        "Re-reads cropped handwritten marks — affects student marks",
        (_AI + "services/copy_check/deduction_check.py:41",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "question_metadata", "Question metadata tagging", GROUP_ASSESSMENT, "ai_service", KIND_CHAT,
        "Tags questions with topic, difficulty and other metadata.",
        (_AI + "services/question_metadata_service.py:26",),
    ),
    UseCase(
        "class_report", "Class-level assessment narrative", GROUP_ASSESSMENT, "assessment_service", KIND_CHAT,
        "AI narrative for a class's assessment results (via ai_service internal completion).",
        (_AS + "ClassAiNarrativeService.java:62", _AI + "routers/internal_llm.py:/internal/llm/v1/complete"),
        seeded_in_release_2=True,
    ),
    UseCase(
        "student_report", "Comprehensive student report", GROUP_ASSESSMENT, "admin_core_service", KIND_CHAT,
        "Comprehensive student report narrative and clustering.",
        (_AC + "ComprehensiveReportLLMService.java:89", _AC + "ComprehensiveReportLLMService.java:120"),
        held_reason=STUDENT_REPORT_HELD,
    ),
    UseCase(
        "analytics", "Reports & learner analytics", GROUP_ASSESSMENT, "admin_core_service", KIND_CHAT,
        "Report narrator, student report v1, learner activity insights and the comprehensive-report fallback. "
        "Bulk changes touch its default only (its fallback is a deliberate pick).",
        (_AC + "ReportNarratorService.java:62", _AC + "StudentReportLLMService.java:82",
         _AC + "StudentAnalyticsLLMService.java:96", _AC + "ComprehensiveReportLLMService.java:92"),
    ),
    # ── Video ────────────────────────────────────────────────────────────────
    UseCase(
        "video", "AI video (default + stage fallback)", GROUP_VIDEO, "ai_service", KIND_VISION,
        "Default for the AI video pipeline and its helpers; the per-stage matrix (Video stages) wins per stage.",
        (_AI + "services/video_generation_service.py:1740", _AI + "ai-video-gen-main/automation_pipeline.py:1727",
         _AI + "routers/external_video_generation.py:2783"),
    ),
    UseCase(
        "video_regenerate", "Video single-shot regenerate", GROUP_VIDEO, "ai_service", KIND_CHAT,
        "Regenerates one shot of a finished video.",
        (_AI + "services/video_generation_service.py:5346",),
    ),
    UseCase(
        "reels_selection", "Reels scan selection", GROUP_VIDEO, "ai_service", KIND_CHAT,
        "Ranks candidate clips when scanning a long video for reels.",
        (_AI + "routers/reels.py:547", _AI + "services/reels_rerank_service.py:58"),
        # Routed through llm_router.chat_with_chain in this release (reasoning low
        # + headroom), so it is seeded GLM like the rest. If that rewire is ever
        # reverted, set held_reason=REELS_SELECTION_HELD and drop the seed.
        seeded_in_release_2=True,
    ),
    UseCase(
        "reels_preview", "Reels preview enrichment", GROUP_VIDEO, "ai_service", KIND_CHAT,
        "Titles, hooks and captions for reel previews.",
        (_AI + "services/reels_preview_service.py:63",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "reels_director", "Reels director", GROUP_VIDEO, "ai_service", KIND_CHAT,
        "Plans the edit (cuts, overlays) of a reel.",
        (_AI + "services/reels_llm_director_service.py:55",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "studio_plan", "Studio plan", GROUP_VIDEO, "ai_service", KIND_CHAT,
        "Plans a studio project from the user's brief.",
        (_AI + "services/studio_plan_service.py:41",),
        seeded_in_release_2=True,
    ),
    # ── Admin & CRM ──────────────────────────────────────────────────────────
    UseCase(
        "assistant", "Vacademy Assistant (admin)", GROUP_ADMIN, "ai_service", KIND_CHAT,
        "The admin dashboard's tool-calling assistant (streamed).",
        (_AI + "services/assistant_service.py:345",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "admin_agent", "Admin AI agent chat", GROUP_ADMIN, "admin_core_service", KIND_CHAT,
        "Admin AI agent with tool calls (LLMService.generateChatCompletion).",
        (_AC + "AgentChatRequest.java:30", _AC + "LLMService.java:58"),
        seeded_in_release_2=True,
    ),
    UseCase(
        "chatbot_flow", "WhatsApp chatbot-flow AI reply", GROUP_ADMIN, "admin_core_service", KIND_CHAT,
        "The AI Response node of WhatsApp chatbot flows (a node's own model still wins).",
        (_AC + "ChatbotAiService.java:33", _NS + "AiResponseNodeExecutor.java:124"),
        seeded_in_release_2=True,
    ),
    UseCase(
        "engagement", "Engagement brain", GROUP_ADMIN, "admin_core_service", KIND_CHAT,
        "CRM engagement: reply drafting, template advisor and next-best action.",
        (_AC + "EngagementReplyBrain.java:35", _AC + "EngagementTemplateAdvisor.java:36",
         _AC + "EngagementBrainClient.java:37"),
        seeded_in_release_2=True,
    ),
    UseCase(
        "workflow_draft", "Workflow builder AI draft", GROUP_ADMIN, "admin_core_service", KIND_CHAT,
        "Drafts and repairs automation workflows from a description.",
        (_AC + "WorkflowAiDraftService.java:50",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "agent_assist", "AI calling-agent prompt assistant", GROUP_ADMIN, "admin_core_service", KIND_CHAT,
        "Helps admins write and refine voice-agent prompts (not the live call LLM).",
        (_AC + "AiAgentAssistService.java:100", _AC + "AiAgentAssistService.java:104"),
        seeded_in_release_2=True,
    ),
    UseCase(
        "call_intelligence", "CRM call intelligence", GROUP_ADMIN, "ai_service", KIND_CHAT,
        "Analyses recorded CRM calls (summary, sentiment, next steps).",
        (_AI + "services/call_intelligence_service.py:543",),
        seeded_in_release_2=True,
    ),
    UseCase(
        "incident", "Incident reports", GROUP_ADMIN, "ai_service", KIND_CHAT,
        "Drafts incident reports.",
        (_AI + "services/incident_service.py:25",),
    ),
    # ── Platform ─────────────────────────────────────────────────────────────
    UseCase(
        "platform_default", "Platform default (model-less calls)", GROUP_PLATFORM, "ai_service", KIND_CHAT,
        "Base tier for any call that names no model and no use case: ApiKeyResolver, ChatLLMClient failover, "
        "the outline LLM client default. An institute/user's own default model still wins.",
        (_AI + "services/api_key_resolver.py:86", _AI + "services/chat_llm_client.py:226",
         _AI + "adapters/openrouter_llm_client.py:37"),
        seeded_in_release_2=True,
    ),
    UseCase(
        "image", "Image generation", GROUP_PLATFORM, "ai_service", KIND_CHAT,
        "Image generation model (course banners, page builder, quiz images). Not a chat LLM.",
        (_AI + "services/image_service.py:31",),
        held_reason=_NOT_CHAT.format(what="image generation"), chat=False,
    ),
    # Per-feature image models (services/image_model_resolver.py): only
    # default_model_id is read; a missing row = the literal in the code.
    UseCase(
        "page_builder_image", "Page builder images", GROUP_CONTENT, "ai_service", KIND_IMAGE,
        "Logos, hero art and illustrations the website builder generates. Chat-completions image "
        "models only (Gemini / GPT image). PAGE_IMAGE_MODEL env still wins. Default "
        "google/gemini-3.1-flash-image.",
        (_AI + "routers/page_builder.py:_image_model",),
        held_reason=_NOT_CHAT.format(what="image generation"), chat=False,
    ),
    UseCase(
        "course_assist_image", "Course step-1 image assist", GROUP_CONTENT, "ai_service", KIND_IMAGE,
        "Course preview / banner / media artwork in the course wizard. Chat-completions image models "
        "only. COURSE_ASSIST_IMAGE_MODEL env still wins. Default google/gemini-3.1-flash-image.",
        (_AI + "routers/course_assist.py:_image_model",),
        held_reason=_NOT_CHAT.format(what="image generation"), chat=False,
    ),
    UseCase(
        "quiz_image", "Assessment question images", GROUP_ASSESSMENT, "ai_service", KIND_IMAGE,
        "Illustrations generated for assessment questions. Chat-completions image models only. "
        "Default google/gemini-3.1-flash-image.",
        (_AI + "services/quiz_service.py:_gen_image_s3_url",),
        held_reason=_NOT_CHAT.format(what="image generation"), chat=False,
    ),
    UseCase(
        "document_image", "Document & slide illustrations", GROUP_CONTENT, "ai_service", KIND_IMAGE,
        "Pictures drawn into AI HTML documents and course DOCUMENT slides (either OpenRouter image API "
        "is routed automatically). DOC_IMAGE_MODEL env still wins. Default qwen/qwen-image-3.",
        (_AI + "services/document_postprocess.py:doc_image_model",),
        held_reason=_NOT_CHAT.format(what="image generation"), chat=False,
    ),
    UseCase(
        "video_image", "AI video images (default)", GROUP_VIDEO, "ai_service", KIND_IMAGE,
        "The AI video pipeline's default image model (shots without an explicit model). Billed per "
        "image at its ai_models price. Default recraft/recraft-v4.1.",
        (_AI + "ai-video-gen-main/automation_pipeline.py:_call_image_generation_llm",),
        held_reason=_NOT_CHAT.format(what="image generation"), chat=False,
    ),
    UseCase(
        "video_support_visual", "AI video support visuals", GROUP_VIDEO, "ai_service", KIND_IMAGE,
        "Supporting photos/diagrams beside the narration in AI videos. Host identity and cast sheets "
        "stay on Seedream regardless. Default bytedance-seed/seedream-4.5.",
        (_AI + "ai-video-gen-main/automation_pipeline.py:_sv_model",),
        held_reason=_NOT_CHAT.format(what="image generation"), chat=False,
    ),
    UseCase(
        "embedding", "Embeddings", GROUP_PLATFORM, "ai_service", KIND_CHAT,
        "Text embeddings for knowledge bases and search. Not a chat LLM.",
        (_AI + "services/embedding_service.py:37", _AI + "services/kb/repository.py:28"),
        held_reason=_NOT_CHAT.format(what="embeddings"), chat=False,
    ),
    UseCase(
        "tts", "Text-to-speech", GROUP_PLATFORM, "ai_service", KIND_CHAT,
        "Text-to-speech voice model. Not a chat LLM.",
        (_AI + "services/voice_tts.py",),
        held_reason=_NOT_CHAT.format(what="text-to-speech"), chat=False,
    ),
)

USE_CASE_CATALOG: Dict[str, UseCase] = {u.use_case: u for u in USE_CASES}

# Rows that are never chat LLMs, even when they are missing from the catalog.
NON_CHAT_USE_CASES = frozenset(u.use_case for u in USE_CASES if not u.chat)

# Bulk "set every chat feature" changes only the default of these, never the
# fallback (analytics' fallback openai/gpt-5.6-luna is a deliberate pick).
DEFAULT_ONLY_IN_BULK = frozenset({"analytics"})

# New keys the Release 2 Flyway migration seeds (GLM default, gemini-2.5-flash fallback).
SEEDED_IN_RELEASE_2: Tuple[str, ...] = tuple(u.use_case for u in USE_CASES if u.seeded_in_release_2)


def get_use_case(use_case: str) -> Optional[UseCase]:
    return USE_CASE_CATALOG.get(use_case)


def held_reason(use_case: str) -> Optional[str]:
    entry = USE_CASE_CATALOG.get(use_case)
    if entry is not None:
        return entry.held_reason
    if use_case in NON_CHAT_USE_CASES:
        return _NOT_CHAT.format(what=use_case)
    return None


def is_chat_use_case(use_case: str) -> bool:
    entry = USE_CASE_CATALOG.get(use_case)
    return entry.chat if entry is not None else use_case not in NON_CHAT_USE_CASES


def uncatalogued_entry(use_case: str) -> Dict[str, object]:
    """Catalog shape for a DB row the catalog does not know."""
    return {
        "use_case": use_case,
        "label": use_case.replace("_", " ").capitalize(),
        "group": GROUP_OTHER,
        "service": "unknown",
        "kind": KIND_CHAT,
        "description": "A row in ai_model_defaults that the code catalog does not describe.",
        "consumers": [],
        "held_reason": None,
    }


__all__: List[str] = [
    "UseCase", "USE_CASES", "USE_CASE_CATALOG", "NON_CHAT_USE_CASES", "DEFAULT_ONLY_IN_BULK",
    "SEEDED_IN_RELEASE_2", "GROUPS", "GROUP_OTHER", "KIND_CHAT", "KIND_VISION", "KIND_IMAGE",
    "STUDENT_REPORT_HELD", "REELS_SELECTION_HELD",
    "get_use_case", "held_reason", "is_chat_use_case", "uncatalogued_entry",
]
