"""
Quiz Service - Handles quiz generation and evaluation for practice mode.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Dict, Any, List, Optional
from uuid import uuid4

from ..schemas.chat_agent import (
    QuizData,
    QuizQuestion,
    QuizSubmission,
    QuizFeedback,
    QuestionFeedback,
)
from ..config import get_settings
from ..services.chat_llm_client import ChatLLMClient, reasoning_mode_for
from ..services.image_model_resolver import QUIZ_IMAGE, image_model_for

logger = logging.getLogger(__name__)

# Output budget for assessment-from-transcript. Non-reasoning models keep the
# historical 32k. Reasoning-mandatory models (GLM) get a cap: ChatLLMClient adds
# a thinking allowance on top (apply_reasoning_mode: +up to 12k), and the GLM
# registry row's max_tokens (1,048,576) is not a real output limit — 20,480 +
# 12,000 keeps the wire value (32,480) inside the 32k the endpoint has always
# been sent. 50 Indic-language MCQs is the worst case this must still fit.
_ASSESSMENT_MAX_TOKENS = 32768
_ASSESSMENT_MAX_TOKENS_REASONING = 20480


def _assessment_max_tokens(model: Optional[str]) -> int:
    if model and reasoning_mode_for(model):
        return _ASSESSMENT_MAX_TOKENS_REASONING
    return _ASSESSMENT_MAX_TOKENS

# Image generation for assessment questions goes through OpenRouter — the
# direct Gemini image key is free-tier with a zero image quota (429s every
# call). Same billed model the course-content and video pipelines use. The
# 'quiz_image' use case (super-admin portal) picks it; this literal is the
# default. Chat-completions image models only (the call sends `modalities`).
_IMAGE_MODEL = "google/gemini-3.1-flash-image"
_OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/chat/completions"


class QuizService:
    """
    Handles quiz generation and evaluation for practice mode.
    Uses LLM to generate contextually relevant questions and provide feedback.
    """
    
    def __init__(self, llm_client: ChatLLMClient):
        self.llm_client = llm_client
    
    async def generate_quiz(
        self,
        topic: str,
        context: Dict[str, Any],
        num_questions: int = 10,
        difficulty: str = "medium",
        institute_id: str = None,
        user_id: str = None,
    ) -> QuizData:
        """
        Generate quiz questions based on the topic and context.
        
        Args:
            topic: The topic to generate questions about
            context: Context information including slide/course content
            num_questions: Number of questions to generate (default 5)
            difficulty: Question difficulty (easy/medium/hard)
            institute_id: Institute ID for LLM tracking
            user_id: User ID for LLM tracking
            
        Returns:
            QuizData object with generated questions
        """
        # Extract relevant content from context
        context_data = context.get("context_data", {})
        content_text = context_data.get("content", "")
        # When the slide could not be read, `content` holds a bracketed note
        # addressed to the tutor ("you have NOT been shown them, do not
        # describe…"). That is guidance for the chat turn, not source material —
        # feeding it in as "Content Details" would have the quiz generator try to
        # follow it. Treat it as no content and fall back to the topic.
        if content_text.lstrip().startswith("["):
            content_text = ""
        slide_name = context_data.get("name", topic)
        chapter = context_data.get("chapter", "")
        subject = context_data.get("subject", "")
        
        # Build the quiz generation prompt
        prompt = f"""Generate exactly {num_questions} multiple choice questions for a quiz on the topic: "{topic}"

CONTEXT INFORMATION:
- Subject: {subject}
- Chapter: {chapter}
- Current Content: {slide_name}
- Content Details: {content_text[:2000] if content_text else 'General topic'}

DIFFICULTY LEVEL: {difficulty}

REQUIREMENTS:
1. Each question should have exactly 4 options (A, B, C, D)
2. Only one option should be correct
3. Questions should test understanding, not just memorization
4. Include a brief explanation for why the correct answer is correct
5. Make questions progressively harder if difficulty is "hard"

IMPORTANT - MARKDOWN FORMATTING:
- Questions and options MUST be in markdown format
- Use code blocks (```language) for code snippets
- Use **bold** and *italic* for emphasis
- Use LaTeX for math: $x^2$ or $$\\frac{{a}}{{b}}$$
- This allows rich content like code questions, formulas, etc.

Example question with code:
{{
    "question": "What will be the output of this Python code?\\n\\n```python\\nprint([x**2 for x in range(3)])\\n```",
    "options": ["`[0, 1, 4]`", "`[1, 4, 9]`", "`[0, 1, 2]`", "`[1, 2, 3]`"]
}}

Return your response as JSON in this exact format:
{{
    "title": "Quiz on [Topic]",
    "questions": [
        {{
            "id": "q1",
            "question": "Question text in **markdown** format?",
            "options": ["Option A (markdown)", "Option B (markdown)", "Option C (markdown)", "Option D (markdown)"],
            "correct_answer_index": 0,
            "explanation": "Brief explanation in markdown"
        }},
        ...more questions...
    ]
}}

IMPORTANT: Return ONLY valid JSON, no additional text or markdown code blocks around the JSON."""

        try:
            # Call LLM
            response = await self.llm_client.chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert quiz generator. Generate educational multiple choice questions based on the given context. Always respond with valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                tools=None,
                temperature=0.7,
                max_tokens=16384,
                institute_id=institute_id,
                user_id=user_id,
            )
            
            content = response.get("content", "")
            
            # Parse JSON from response (handle markdown code blocks)
            json_content = self._extract_json(content)
            # Sanitize control characters that LLMs sometimes emit inside JSON strings
            quiz_json = json.loads(json_content, strict=False)
            
            # Build quiz data
            questions = []
            for q in quiz_json.get("questions", []):
                questions.append(QuizQuestion(
                    id=q.get("id", f"q{len(questions)+1}"),
                    question=q.get("question", ""),
                    options=q.get("options", []),
                    correct_answer_index=q.get("correct_answer_index", 0),
                    explanation=q.get("explanation", ""),
                ))
            
            return QuizData(
                quiz_id=str(uuid4()),
                title=quiz_json.get("title", f"Quiz on {topic}"),
                topic=topic,
                questions=questions,
                total_questions=len(questions),
                time_limit_seconds=num_questions * 60,  # 1 minute per question
            )
            
        except Exception as e:
            logger.error(f"Failed to generate quiz: {e}", exc_info=True)
            # Return an empty fallback quiz — caller will ask user to specify topic
            return self._generate_fallback_quiz(topic, num_questions)
    
    # -----------------------------------------------------------------------
    # Layer 3 — assessment-from-transcript generation
    # -----------------------------------------------------------------------

    _LANGUAGE_NAMES = {
        "en": "English", "hi": "Hindi", "ta": "Tamil", "te": "Telugu",
        "bn": "Bengali", "mr": "Marathi", "gu": "Gujarati", "kn": "Kannada",
        "ml": "Malayalam", "pa": "Punjabi", "or": "Odia", "as": "Assamese",
    }

    async def generate_assessment_from_transcript(
        self,
        transcript_text: str,
        target_language: str = "en",
        num_questions: int = 20,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model: Optional[str] = None,
        include_images: bool = False,
        fallback_models: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Generate an assessment (title + N MCQs) from a long-form transcript.

        `model` is the model that actually runs (the router resolves it from
        the request override / 'agent' use case); `fallback_models` is the
        failover chain. The model that answered is returned as `model_used`.

        Unlike `generate_quiz`, this accepts the full transcript (no truncation),
        always generates a title, and emits questions in `target_language`
        (Whisper-detected source language).

        Returns: {"title": str, "questions": [{...}, ...]}
        Raises RuntimeError on LLM failure.
        """
        language_name = self._LANGUAGE_NAMES.get(
            (target_language or "en").lower(), target_language or "English"
        )

        approx_tokens = len(transcript_text) // 4
        if approx_tokens > 500_000:
            logger.warning(
                f"[assessment-gen] Transcript ~{approx_tokens} tokens — approaching context limit."
            )

        prompt = f"""You are an expert educator. The text below is the English transcript of a single class lecture.

Your job:
1. Read the transcript and identify the core topic.
2. Produce a concise lecture TITLE (5–10 words) that captures the topic.
3. Generate EXACTLY {num_questions} multiple-choice questions that test understanding of the lecture material.

LANGUAGE OUTPUT REQUIREMENT — CRITICAL:
The lecture audio was in {language_name}. The transcript you see is the English translation.
EMIT THE TITLE, ALL QUESTION TEXT, ALL FOUR OPTIONS, AND ALL EXPLANATIONS IN {language_name.upper()}.
Use the {language_name} script natively. Do not include English transliteration. If a technical term is universally English (e.g. "DNA", "HTML"), keep it as-is but everything else MUST be {language_name}.

QUESTION-WRITING RULES:
- Each question has EXACTLY 4 options. Exactly one is correct.
- Distractors must be plausible — use common student misconceptions when possible.
- Mix difficulty: ~40% recall, ~40% comprehension, ~20% application.
- Each explanation: 1–2 sentences justifying the correct answer.
- Avoid trick questions, negative phrasing, or "all/none of the above" options.
- Questions must be answerable from the transcript content — do NOT pull in external knowledge.

IMAGE HINTING (optional, important):
For questions where a single clean diagram or illustration would clearly help
a student understand the question (e.g. a labelled diagram, a process flow,
a physical setup, a graph, a real-world scene), set an `image_prompt` field
with a short English description (15–30 words) of the picture you'd want.
For purely verbal questions (definitions, terminology, recall) leave
`image_prompt` empty or omit it. Aim for **at most 3–5 questions out of
{num_questions}** to have an image_prompt — do NOT add one to every question.

LECTURE TRANSCRIPT (English):
\"\"\"
{transcript_text}
\"\"\"

OUTPUT — return ONLY this JSON object, no surrounding markdown / text:
{{
  "title": "Lecture title in {language_name}",
  "questions": [
    {{
      "id": "q1",
      "question": "Question text in {language_name}?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer_index": 0,
      "explanation": "Why this answer is correct, in {language_name}.",
      "image_prompt": "Optional — short English description of an illustration if it helps the question. Omit or leave empty for text-only questions."
    }}
  ]
}}
"""

        # The resolved model is passed through (it used to be dropped here, so
        # the call ran the env default while billing named the 'agent' model).
        # Without a model, ChatLLMClient's resolver picks one (platform default
        # or the institute/user ai_api_keys default).
        try:
            response = await self.llm_client.chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert assessment author for school and college classrooms. Always respond with valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                tools=None,
                temperature=0.4,
                max_tokens=_assessment_max_tokens(model),
                institute_id=institute_id,
                user_id=user_id,
                model=model,
                fallback_models=fallback_models,
            )
            model_used = (response.get("model") if isinstance(response, dict) else None) or model
            content = response.get("content", "") or ""
            # Capture token usage for credit billing (the overage leg of
            # max(parametric, actual)). Provider shapes differ: OpenRouter uses
            # prompt_tokens/completion_tokens; Gemini uses *TokenCount.
            _usage = response.get("usage") or {}
            _prompt_toks = int(_usage.get("prompt_tokens") or _usage.get("promptTokenCount") or 0)
            _completion_toks = int(_usage.get("completion_tokens") or _usage.get("candidatesTokenCount") or 0)
            json_content = self._extract_json(content)
            if not json_content or not json_content.strip():
                # Empty LLM output is the single most common cause of the
                # cryptic "Expecting value: line 1 column 1 (char 0)" we
                # used to bubble up. Surface a clear message instead — and
                # log enough of the raw response that an operator can tell
                # whether the LLM truly returned nothing or returned text
                # that _extract_json couldn't parse.
                logger.error(
                    "[assessment-gen] LLM returned empty content. response.keys=%s, content.len=%d, content.head=%r",
                    list(response.keys()) if isinstance(response, dict) else type(response).__name__,
                    len(content),
                    content[:200],
                )
                raise RuntimeError(
                    "LLM returned an empty response — likely rate-limited, "
                    "content-filtered, or an API key/model issue. Retry, "
                    "and if it persists check ai-service logs for the raw "
                    "LLM response."
                )
            data = json.loads(json_content, strict=False)
        except Exception as e:
            logger.error(f"[assessment-gen] LLM call/parse failed: {e}", exc_info=True)
            raise RuntimeError(f"Failed to generate assessment from transcript: {e}") from e

        title = (data.get("title") or "").strip() or "Untitled Assessment"
        raw_questions = data.get("questions") or []

        questions: List[Dict[str, Any]] = []
        for i, q in enumerate(raw_questions):
            options = q.get("options") or []
            correct = q.get("correct_answer_index")
            if (
                not isinstance(options, list) or len(options) != 4
                or not isinstance(correct, int) or not (0 <= correct < 4)
                or not q.get("question")
            ):
                logger.warning(f"[assessment-gen] dropping malformed question idx={i}")
                continue
            questions.append({
                "id": q.get("id") or f"q{len(questions) + 1}",
                "question": q.get("question", "").strip(),
                "options": [str(o).strip() for o in options],
                "correct_answer_index": correct,
                "explanation": (q.get("explanation") or "").strip(),
                # Preserved only when the LLM judged this question would
                # benefit from an illustration. Used by the optional
                # image-enrichment step downstream — text-only questions
                # leave this empty and skip the image-gen call entirely.
                "image_prompt": (q.get("image_prompt") or "").strip(),
            })

        if not questions:
            raise RuntimeError("LLM returned no valid questions — refusing to persist an empty assessment.")

        logger.info(
            f"[assessment-gen] generated title + {len(questions)} valid questions "
            f"(requested {num_questions}, target_language={target_language})"
        )

        # Optional image enrichment. Adds an <img> tag at the start of
        # every question and every option's text. Skipped by default —
        # ~5 image calls per question (1 for the stem + 4 for options)
        # adds 30-120s of latency and image-gen API spend. Caller must opt in.
        if include_images:
            try:
                await self._enrich_questions_with_images(questions)
            except Exception as e:
                # Don't fail the whole assessment over image gen — log and
                # ship the text-only questions. Each per-image failure is
                # already swallowed inside the helper; this catch is for
                # an unexpected outer error.
                logger.warning(
                    "[assessment-gen] image enrichment errored, returning text-only: %s",
                    e,
                )

        # Count images actually embedded (enrichment only appends <img> on
        # success, and only for LLM-tagged questions) so billing charges for
        # delivered images, not the requested upper bound.
        images_generated = sum(1 for q in questions if "<img" in (q.get("question") or ""))

        return {
            "title": title,
            "questions": questions,
            "usage": {"prompt_tokens": _prompt_toks, "completion_tokens": _completion_toks},
            "images_generated": images_generated,
            "model_used": model_used,
        }

    async def _enrich_questions_with_images(self, questions: List[Dict[str, Any]]) -> None:
        """
        Mutate `questions` in-place to attach an illustration only to the
        questions where the LLM tagged an `image_prompt`. Options are
        never image-enriched here — the existing AI-tools flow only puts
        images on question stems where a diagram genuinely helps, and we
        match that behaviour to avoid 100 wasted image calls on a
        20-question assessment.

        Failures fall through silently — the original text is preserved
        on a per-question basis, so a single image failing doesn't
        damage the rest of the assessment.
        """
        openrouter_key = get_settings().openrouter_api_key
        if not openrouter_key:
            logger.warning("[assessment-gen] include_images requested but no OPENROUTER_API_KEY available — skipping")
            return

        # Only the questions the LLM tagged as benefiting from an
        # illustration. Typically 0-5 out of 20 — far below the 100
        # image gens the old "always all questions + all options" path
        # ran. The image_prompt was preserved by the validation step
        # above; missing / empty means "text-only, no image".
        jobs: List[tuple[int, str]] = []
        for qi, q in enumerate(questions):
            ip = (q.get("image_prompt") or "").strip()
            if ip:
                jobs.append((qi, ip))

        if not jobs:
            logger.info("[assessment-gen] include_images on but no questions tagged image_prompt — text-only")
            return

        # Concurrency cap is now mostly academic (we'll have 0-5 jobs in
        # practice), but keep it for safety in case the LLM gets
        # exuberant and tags 20+ questions.
        semaphore = asyncio.Semaphore(8)

        async def _run_one(qi: int, prompt: str) -> None:
            async with semaphore:
                # Wrap the LLM's natural-language image description with
                # the platform-wide style guidance (flat, colourful,
                # white-bg, no text) before sending to the image model.
                public_url = await self._gen_image_s3_url(
                    self._build_image_prompt(prompt), openrouter_key
                )
                if not public_url:
                    return
                # Same shape as the existing AI-tools image embeds —
                # width:100% object-fit:contain — appended to the
                # question text so the wording reads first and the
                # diagram follows.
                img_tag = (
                    f'<img src="{public_url}" '
                    f'style="width:100%;object-fit:contain;" />'
                )
                questions[qi]["question"] = (questions[qi].get("question") or "") + img_tag

        logger.info(
            "[assessment-gen] enriching %d/%d questions with images (LLM-selected)",
            len(jobs),
            len(questions),
        )
        await asyncio.gather(*(_run_one(qi, pr) for qi, pr in jobs), return_exceptions=True)
        logger.info("[assessment-gen] image enrichment complete")

    @staticmethod
    def _build_image_prompt(source_text: str) -> str:
        """Wrap the LLM-provided image description with consistent style
        guidance so all generated images share a clean educational look
        — flat, colourful, white background, no in-image text — even
        though the LLM picks the subject per question."""
        return (
            "Create a single clean educational illustration described below. "
            "Style: flat, modern, colourful, white background, no text in "
            "the image, no labels, no captions.\n\n"
            f"Subject: {source_text.strip()}"
        )

    async def _gen_image_s3_url(self, prompt: str, openrouter_key: str) -> Optional[str]:
        """
        Single OpenRouter image-gen call → S3 upload → public URL.

        Returns None on any failure. We never raise: image gen is
        best-effort enrichment, so a single image failing should leave
        the rest of the question intact rather than fail the whole
        assessment.

        Matches the existing platform pattern — the URL we return looks
        like `https://vacademy-media-storage-public.s3.amazonaws.com/
        SERVICE_UPLOAD/<uuid>.png`, identical in shape to images
        produced by the AI-tools flow (which extracts them from PDFs).
        """
        try:
            import base64
            import httpx
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    _OPENROUTER_IMAGE_URL,
                    headers={
                        "Authorization": f"Bearer {openrouter_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": image_model_for(QUIZ_IMAGE, _IMAGE_MODEL),
                        "messages": [{"role": "user", "content": prompt}],
                        "modalities": ["image"],
                        "image_config": {"aspect_ratio": "16:9"},
                    },
                )
            if resp.status_code != 200:
                logger.warning("[assessment-gen] image gen %s: %s", resp.status_code, resp.text[:200])
                return None
            data = resp.json()
            # OpenRouter returns generated images as data URLs on
            # choices[].message.images[].image_url.url.
            data_url = ""
            for choice in data.get("choices") or []:
                for image in (choice.get("message") or {}).get("images", []) or []:
                    data_url = (image.get("image_url") or {}).get("url", "")
                    if data_url:
                        break
                if data_url:
                    break
            if not data_url:
                logger.warning("[assessment-gen] image gen returned no image")
                return None
            # data URL shape: data:image/png;base64,<...>
            mime = "image/png"
            if data_url.startswith("data:") and ";" in data_url:
                mime = data_url[5:data_url.index(";")] or mime
            data_b64 = data_url.split(",", 1)[1] if "," in data_url else data_url
            if not data_b64:
                return None
            try:
                image_bytes = base64.b64decode(data_b64)
            except Exception as decode_err:
                logger.warning("[assessment-gen] image base64 decode failed: %s", decode_err)
                return None

            # Map mime → extension.
            ext = "jpeg" if "jpeg" in mime or "jpg" in mime else "png"
            object_key = f"SERVICE_UPLOAD/{uuid4()}.{ext}"
            filename = object_key.rsplit("/", 1)[-1]

            # S3 upload is sync (boto3); run it off the event loop so we
            # don't block other in-flight image-gen calls.
            try:
                from .s3_service import S3Service
                svc = S3Service()
            except Exception as e:
                logger.warning("[assessment-gen] S3Service unavailable: %s", e)
                return None
            try:
                public_url = await asyncio.to_thread(
                    svc.upload_file_content,
                    image_bytes,
                    filename,
                    object_key,
                    mime,
                )
                return public_url
            except Exception as e:
                logger.warning("[assessment-gen] S3 upload failed: %s", e)
                return None
        except Exception as e:
            logger.warning("[assessment-gen] image gen exception: %s", e)
            return None

    def _extract_json(self, content: str) -> str:
        """Extract JSON from LLM response, handling markdown code blocks."""
        # Try to find JSON in code blocks
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
        if json_match:
            return json_match.group(1).strip()
        
        # Try to find raw JSON
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json_match.group(0)
        
        return content
    
    def _generate_fallback_quiz(self, topic: str, num_questions: int) -> QuizData:
        """Generate a fallback quiz if LLM generation fails. Returns empty quiz with error message."""
        logger.warning(f"Using fallback quiz for topic: {topic}")
        # Return an empty quiz — the frontend will show the title as feedback
        return QuizData(
            quiz_id=str(uuid4()),
            title=f"Could not generate quiz on {topic}",
            topic=topic,
            questions=[],
            total_questions=0,
        )
    
    def get_quiz_for_frontend(self, quiz_data: QuizData) -> Dict[str, Any]:
        """
        Prepare quiz data for frontend - strips correct answers.
        
        The frontend should not receive the correct answers to prevent cheating.
        """
        return {
            "quiz_id": quiz_data.quiz_id,
            "title": quiz_data.title,
            "topic": quiz_data.topic,
            "total_questions": quiz_data.total_questions,
            "time_limit_seconds": quiz_data.time_limit_seconds,
            "questions": [
                {
                    "id": q.id,
                    "question": q.question,
                    "options": q.options,
                    # Note: correct_answer_index and explanation are NOT included
                }
                for q in quiz_data.questions
            ]
        }
    
    async def evaluate_quiz(
        self,
        quiz_data: QuizData,
        submission: QuizSubmission,
        context: Dict[str, Any],
        institute_id: str = None,
        user_id: str = None,
    ) -> QuizFeedback:
        """
        Evaluate quiz submission and generate feedback.
        
        Args:
            quiz_data: The original quiz with correct answers
            submission: User's submitted answers
            context: Context for generating personalized feedback
            
        Returns:
            QuizFeedback with scores and recommendations
        """
        # Calculate scores
        correct_count = 0
        question_feedback_list: List[QuestionFeedback] = []
        
        for question in quiz_data.questions:
            user_answer = submission.answers.get(question.id)
            is_correct = user_answer == question.correct_answer_index
            
            if is_correct:
                correct_count += 1
            
            # Get answer texts
            user_answer_text = None
            if user_answer is not None and 0 <= user_answer < len(question.options):
                user_answer_text = question.options[user_answer]
            
            correct_answer_text = question.options[question.correct_answer_index]
            
            question_feedback_list.append(QuestionFeedback(
                question_id=question.id,
                question_text=question.question,
                correct=is_correct,
                user_answer_index=user_answer,
                correct_answer_index=question.correct_answer_index,
                user_answer_text=user_answer_text,
                correct_answer_text=correct_answer_text,
                explanation=question.explanation,
            ))
        
        total = len(quiz_data.questions)
        percentage = (correct_count / total * 100) if total > 0 else 0
        passed = percentage >= 60
        
        # Generate AI feedback
        overall_feedback, recommendations = await self._generate_ai_feedback(
            quiz_data=quiz_data,
            question_feedback=question_feedback_list,
            score=correct_count,
            total=total,
            percentage=percentage,
            context=context,
            institute_id=institute_id,
            user_id=user_id,
        )
        
        return QuizFeedback(
            quiz_id=quiz_data.quiz_id,
            score=correct_count,
            total=total,
            percentage=round(percentage, 1),
            passed=passed,
            question_feedback=question_feedback_list,
            overall_feedback=overall_feedback,
            recommendations=recommendations,
            time_taken_seconds=submission.time_taken_seconds,
        )
    
    async def _generate_ai_feedback(
        self,
        quiz_data: QuizData,
        question_feedback: List[QuestionFeedback],
        score: int,
        total: int,
        percentage: float,
        context: Dict[str, Any],
        institute_id: str = None,
        user_id: str = None,
    ) -> tuple[str, List[str]]:
        """Generate personalized AI feedback based on quiz performance."""
        
        # Analyze wrong answers
        wrong_questions = [qf for qf in question_feedback if not qf.correct]
        
        prompt = f"""A student just completed a quiz on "{quiz_data.topic}".

RESULTS:
- Score: {score}/{total} ({percentage:.1f}%)
- Status: {"PASSED ✅" if percentage >= 60 else "NEEDS IMPROVEMENT ⚠️"}

WRONG ANSWERS:
{self._format_wrong_answers(wrong_questions) if wrong_questions else "None! Perfect score! 🎉"}

Please provide:
1. A brief, encouraging overall feedback (2-3 sentences). Use emojis sparingly.
2. 2-3 specific, actionable recommendations for improvement (or praise if perfect score).

Return as JSON:
{{
    "overall_feedback": "Your feedback here...",
    "recommendations": ["Recommendation 1", "Recommendation 2"]
}}"""

        try:
            response = await self.llm_client.chat_completion(
                messages=[
                    {"role": "system", "content": "You are an encouraging educational tutor providing quiz feedback. Be supportive and constructive."},
                    {"role": "user", "content": prompt}
                ],
                tools=None,
                temperature=0.7,
                institute_id=institute_id,
                user_id=user_id,
            )
            
            content = (response.get("content") or "").strip()
            if not content:
                logger.warning("Failed to generate AI feedback: empty LLM response; using default feedback")
                return (self._get_default_feedback(percentage), [])
            json_content = self._extract_json(content)
            feedback_json = json.loads(json_content, strict=False)
            
            return (
                feedback_json.get("overall_feedback", self._get_default_feedback(percentage)),
                feedback_json.get("recommendations", [])
            )
            
        except Exception as e:
            logger.error(f"Failed to generate AI feedback: {e}")
            return (self._get_default_feedback(percentage), [])
    
    def _format_wrong_answers(self, wrong_questions: List[QuestionFeedback]) -> str:
        """Format wrong answers for the feedback prompt."""
        lines = []
        for qf in wrong_questions:
            lines.append(f"- Q: {qf.question_text}")
            lines.append(f"  User answered: {qf.user_answer_text or 'Not answered'}")
            lines.append(f"  Correct answer: {qf.correct_answer_text}")
        return "\n".join(lines)
    
    def _get_default_feedback(self, percentage: float) -> str:
        """Get default feedback based on score percentage."""
        if percentage >= 90:
            return "Excellent work! 🌟 You've demonstrated a strong understanding of this topic."
        elif percentage >= 70:
            return "Good job! 👍 You have a solid grasp of the concepts. Keep practicing to master them fully."
        elif percentage >= 60:
            return "Nice effort! You passed the quiz. Review the questions you missed to strengthen your understanding."
        else:
            return "Keep practicing! 💪 Review the material and try again. Every attempt helps you learn."


__all__ = ["QuizService"]
