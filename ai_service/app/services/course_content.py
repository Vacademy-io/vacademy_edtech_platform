"""
Pure pieces of the course builder: the authoring contract the connected LLM
writes against, validation of what it sends, and the exact admin-core slide
payloads. No I/O, no model — unit-testable offline.

Slide specs (what the LLM sends, see ``SLIDE_CONTRACT``):

    {"type": "document",   "title": ..., "html": "<!DOCTYPE html>..."}
    {"type": "video",      "title": ..., "url": "https://www.youtube.com/watch?v=...", "description"?: ...}
    {"type": "pdf",        "title": ..., "file_id": "<from course_edit(import_pdf)>"}
    {"type": "quiz",       "title": ..., "questions": [QUESTION, ...], "settings"?: {...}}
    {"type": "question",   "title": ..., "question": QUESTION}
    {"type": "assignment", "title": ..., "instructions_html": ..., "live_date"?, "end_date"?, ...}
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

SLIDE_TYPES = ("document", "video", "pdf", "quiz", "question", "assignment")
#: DRAFT is the default — a slide is PUBLISHED only when the admin asks for it.
SLIDE_STATUSES = ("DRAFT", "PUBLISHED")
QUESTION_TYPES = ("MCQS", "MCQM", "TRUE_FALSE", "ONE_WORD", "LONG_ANSWER", "NUMERIC")
_OPTION_TYPES = ("MCQS", "MCQM", "TRUE_FALSE")

#: admin-core slide.source_type → the spec type the tools speak.
SOURCE_TYPE_TO_SPEC = {
    "DOCUMENT": "document", "VIDEO": "video", "QUIZ": "quiz", "QUESTION": "question",
    "ASSIGNMENT": "assignment", "HTML_VIDEO": "ai_video", "AUDIO": "audio",
    "ASSESSMENT": "assessment", "SCORM": "scorm",
}

MAX_HTML_BYTES = 400_000
MIN_DOCUMENT_WORDS = 120
MAX_QUESTIONS = 50
MAX_CHAPTERS = 60
MAX_SLIDES_PER_CHAPTER = 40
MAX_TITLE = 200


def new_id() -> str:
    return str(uuid.uuid4())


def clean_title(value: Any, fallback: str = "") -> str:
    title = re.sub(r"\s+", " ", str(value or "")).strip()
    return title[:MAX_TITLE] or fallback


# ── authoring contract (served by courses(action='schema')) ──────────────

DEPTH_CONTRACT = (
    "Course depth = how many levels the learner sees above a slide.\n"
    "  2: Course → Slide (one hidden chapter holds every slide; send ONE chapter)\n"
    "  3: Course → Chapter → Slide (the usual choice)\n"
    "  4: Course → Module → Chapter → Slide (group chapters into modules)\n"
    "  5: Course → Subject → Module → Chapter → Slide (group modules into subjects)\n"
    "Hidden levels are created automatically as DEFAULT and never shown to learners."
)

OUTLINE_CONTRACT = {
    "course": {
        "name": "string (required)",
        "depth": "2 | 3 | 4 | 5 (default 3)",
        "about_html": "HTML: what the course covers (shown on the course page)",
        "why_learn_html": "HTML: outcomes / benefits",
        "who_should_learn_html": "HTML: target audience",
        "tags": ["string"],
    },
    "structure (by depth)": {
        "depth 2/3": {"chapters": [{"name": "string", "slides": ["SLIDE (spec) or {type, title} placeholder"]}]},
        "depth 4": {"modules": [{"name": "string", "chapters": ["CHAPTER"]}]},
        "depth 5": {"subjects": [{"name": "string", "modules": ["MODULE"]}]},
    },
    "notes": [
        "Slides inside create_course may carry full content (saved immediately) or be {type, title} "
        "placeholders you fill later with add_slide — the placeholder is NOT saved, it only appears in the "
        "returned plan so you remember what to write.",
        "Keep each create_course call under ~150 KB: for long courses send the outline with placeholders, then "
        "add_slide per slide.",
    ],
}

QUESTION_CONTRACT = {
    "type": "MCQS (one correct) | MCQM (several correct) | TRUE_FALSE | ONE_WORD | LONG_ANSWER | NUMERIC",
    "question": "HTML of the question text (inline SVG allowed; images only from import_image)",
    "options": "MCQS/MCQM: 2-6 option strings (HTML ok). TRUE_FALSE: omit (True/False are added).",
    "correct": "MCQS/MCQM/TRUE_FALSE: list of 0-based option indexes (TRUE_FALSE: [0]=True, [1]=False)",
    "answer": "ONE_WORD/NUMERIC: the expected answer (NUMERIC: a number). LONG_ANSWER: a model answer (manually graded)",
    "explanation": "HTML shown after answering (recommended for every question)",
}

QUIZ_SETTINGS_CONTRACT = {
    "time_limit_minutes": "integer, optional",
    "marks_per_question": "number, default 1",
    "negative_marking": "number, default 0",
    "pass_percentage": "number 0-100, optional",
    "re_attempts": "integer, optional",
}


STATUS_CONTRACT = (
    "Every slide has a status: DRAFT (hidden from learners) or PUBLISHED (visible once the course is live). "
    "Use PUBLISHED only when the admin asks for published / public slides, DRAFT when they ask for drafts, and "
    "leave it out otherwise — it is then saved as DRAFT. Set it per slide (slide.status) or for a whole call "
    "(status). course_edit(publish_slides) publishes existing DRAFT slides when the admin approves them."
)


def slide_contract() -> Dict[str, Any]:
    from .content_prompts import _DESIGN_SAFETY_RULES, _DOC_CONTENT_TYPE_SPECS

    return {
        "status": STATUS_CONTRACT,
        "document": {
            "fields": {"title": "string", "html": "ONE complete self-contained HTML document"},
            "rules": [
                "Return a full document: <!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport ...>"
                "<style>…</style></head><body>…</body></html>. It renders in a sandboxed iframe (scripts run, no "
                "access to the learner app, cookies or storage) at full height with no internal scroll.",
                f"Real teaching content: roughly 300-600 words (at least {MIN_DOCUMENT_WORDS}), an intro (what + why), "
                "core sections with an example or analogy per idea, common misconceptions, and Key Takeaways.",
                "Teach visually: labelled inline-SVG diagrams, icon-led key-point cards, colour-coded callouts, "
                "comparisons, step strips — roughly one visual per screenful.",
                "Inline CSS and small vanilla JS are fine (tabs, flip cards, interactive diagrams). https Google "
                "Fonts and reputable CDN libraries may be loaded. No trackers, no cookies/localStorage, no parent access.",
                "Images: ONLY urls returned by course_edit(import_image). There is no image generator — "
                "<img data-img-prompt> placeholders and invented image URLs are removed.",
                "Code (programming topics only): <pre data-language=\"python\"><code class=\"language-python\">…</code></pre>, "
                "HTML-escaped.",
                "Interactive results: when the learner finishes an in-page quiz/game call "
                "window.parent.postMessage({type:'vacademy:complete', score:<n>, maxScore:<n>}, '*').",
                f"Limit {MAX_HTML_BYTES // 1000} KB per document.",
            ],
            "rendering_safety": _DESIGN_SAFETY_RULES,
            "optional_sections": _DOC_CONTENT_TYPE_SPECS,
        },
        "video": {
            "fields": {"title": "string", "url": "https://www.youtube.com/watch?v=… or https://youtu.be/…",
                       "description": "string, optional"},
            "rules": ["Use a real video you know exists and fits the topic; the server does not search YouTube."],
        },
        "pdf": {
            "fields": {"title": "string", "file_id": "from course_edit(action='import_pdf', url=…)"},
        },
        "quiz": {
            "fields": {"title": "string", "questions": [QUESTION_CONTRACT], "settings": QUIZ_SETTINGS_CONTRACT},
            "rules": ["1-50 questions; each needs a correct answer (except LONG_ANSWER) and an explanation.",
                      "Mix difficulty; test application, not only recall; never repeat a question stem."],
        },
        "question": {
            "fields": {"title": "string", "question": QUESTION_CONTRACT,
                       "points": "integer, optional", "re_attempts": "integer, optional"},
            "rules": ["A single standalone practice question (MCQS, MCQM, TRUE_FALSE, ONE_WORD, NUMERIC)."],
        },
        "assignment": {
            "fields": {
                "title": "string",
                "instructions_html": "HTML: the task, context, materials, expected output and grading criteria",
                "live_date": "ISO date-time, optional", "end_date": "ISO date-time, optional",
                "total_marks": "number, optional", "passing_marks": "number, optional",
                "re_attempts": "integer, optional",
            },
            "rules": ["Hands-on: something the learner DOES and submits (file upload), not recall Q&A."],
        },
    }


# ── validation ───────────────────────────────────────────────────────────

#: <img> tags only the in-house image generator could fill — never rendered here.
_PLACEHOLDER_IMG_RE = re.compile(
    r"<img\b(?=[^>]*(?:\bdata-img-prompt\s*=|\bsrc\s*=\s*['\"]?placeholder\.png))[^>]*>", re.I)
_WORD_RE = re.compile(r"[\wऀ-ॿ؀-ۿ]+", re.U)


def word_count(html: str) -> int:
    from .content_dedupe import extract_text
    return len(_WORD_RE.findall(extract_text(html or "")))


def clean_document_html(html: Any) -> Tuple[Optional[str], Dict[str, Any]]:
    """
    Normalise one document slide's HTML. Returns (html, report) — html None when
    unusable. Strips a wrapping ``` fence, normalises code blocks, removes
    image-generator placeholders and images that are not institute media.
    """
    report: Dict[str, Any] = {}
    if not isinstance(html, str) or not html.strip():
        return None, {"problem": "html is empty"}
    from .document_postprocess import normalize_code_blocks, strip_wrapping_fence

    out = strip_wrapping_fence(html.strip())
    if len(out.encode("utf-8")) > MAX_HTML_BYTES:
        return None, {"problem": f"html is larger than {MAX_HTML_BYTES // 1000} KB"}
    placeholders = len(_PLACEHOLDER_IMG_RE.findall(out))
    if placeholders:
        out = _PLACEHOLDER_IMG_RE.sub("", out)
        report["image_placeholders_removed"] = placeholders
    out = _strip_foreign_images(out, report)
    out = normalize_code_blocks(out)
    if not re.search(r"<html\b", out, re.I):
        out = (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>"
            f"<body>{out}</body></html>"
        )
        report["wrapped_in_document"] = True
    words = word_count(out)
    report["words"] = words
    if words < MIN_DOCUMENT_WORDS:
        report["warning"] = f"only {words} words of teaching text — aim for 300-600"
    return out, report


def _strip_foreign_images(html: str, report: Dict[str, Any]) -> str:
    from .assistant_tools_website_edit import _strip_foreign_images as strip
    return strip(html, report)


_YOUTUBE_RE = re.compile(
    r"^https://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def youtube_id(url: Any) -> Optional[str]:
    m = _YOUTUBE_RE.match(str(url or "").strip())
    return m.group(1) if m else None


def _rich(content: str) -> Dict[str, Any]:
    return {"id": new_id(), "type": "HTML", "content": content or ""}


def _num(value: Any) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> Optional[int]:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def normalize_question(q: Any, index: int) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Validated question dict, or (None, problem)."""
    if not isinstance(q, dict):
        return None, f"question {index + 1} is not an object"
    qtype = str(q.get("type") or "MCQS").upper().strip()
    if qtype not in QUESTION_TYPES:
        return None, f"question {index + 1}: type must be one of {', '.join(QUESTION_TYPES)}"
    text_html = str(q.get("question") or q.get("text") or "").strip()
    if not text_html:
        return None, f"question {index + 1}: question text is empty"
    options: List[str] = []
    correct: List[int] = []
    if qtype == "TRUE_FALSE":
        options = ["True", "False"]
    elif qtype in _OPTION_TYPES:
        options = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        if not 2 <= len(options) <= 6:
            return None, f"question {index + 1}: {qtype} needs 2-6 options"
    if qtype in _OPTION_TYPES:
        raw = q.get("correct")
        raw = raw if isinstance(raw, list) else [raw]
        correct = sorted({i for i in (_int(c) for c in raw) if i is not None and 0 <= i < len(options)})
        if not correct:
            return None, f"question {index + 1}: `correct` must list option indexes (0-based)"
        if qtype in ("MCQS", "TRUE_FALSE") and len(correct) != 1:
            return None, f"question {index + 1}: {qtype} has exactly one correct option"
    answer = q.get("answer")
    if qtype in ("ONE_WORD", "NUMERIC") and not str(answer if answer is not None else "").strip():
        return None, f"question {index + 1}: {qtype} needs `answer`"
    if qtype == "NUMERIC" and _num(answer) is None:
        return None, f"question {index + 1}: NUMERIC `answer` must be a number"
    return {
        "type": qtype,
        "question": text_html,
        "options": options,
        "correct": correct,
        "answer": answer,
        "explanation": str(q.get("explanation") or "").strip(),
    }, None


def _evaluation(qtype: str) -> Tuple[str, str]:
    """(question_response_type, evaluation_type) — mirrors the dashboard quiz editor."""
    if qtype == "NUMERIC":
        return "NUMERIC", "AUTO"
    if qtype == "LONG_ANSWER":
        return "TEXT", "MANUAL"
    if qtype == "ONE_WORD":
        return "TEXT", "AUTO"
    return "OPTION", "AUTO"


def _auto_evaluation_json(q: Dict[str, Any], option_ids: List[str]) -> str:
    import json
    if q["type"] in _OPTION_TYPES:
        return json.dumps({"correctAnswers": [option_ids[i] for i in q["correct"]]})
    if q["type"] == "LONG_ANSWER":
        return json.dumps({"data": {"answer": {"content": str(q.get("answer") or "")}}}) if q.get("answer") else ""
    if q["type"] == "ONE_WORD":
        return json.dumps({"data": {"answer": str(q["answer"]).strip()}})
    return json.dumps({"correctAnswers": [str(q["answer"]).strip()]})


def quiz_question_payload(q: Dict[str, Any], order: int) -> Dict[str, Any]:
    option_ids = [new_id() for _ in q["options"]]
    response_type, evaluation_type = _evaluation(q["type"])
    return {
        "id": new_id(),
        "parent_rich_text": _rich(""),
        "text": _rich(q["question"]),
        "explanation_text": _rich(q.get("explanation") or ""),
        "media_id": "",
        "status": "ACTIVE",
        "question_response_type": response_type,
        "question_type": q["type"],
        "access_level": "INSTITUTE",
        "auto_evaluation_json": _auto_evaluation_json(q, option_ids),
        "evaluation_type": evaluation_type,
        "question_order": order,
        "can_skip": False,
        "options": [
            {"id": oid, "quiz_slide_question_id": "", "text": _rich(text), "explanation_text": _rich(""), "media_id": ""}
            for oid, text in zip(option_ids, q["options"])
        ],
    }


# ── slide spec → admin-core request ──────────────────────────────────────

#: spec type → (admin-core path, body kind)
SLIDE_ENDPOINTS = {
    "document": "/admin-core-service/slide/v1/add-update-document-slide",
    "pdf": "/admin-core-service/slide/v1/add-update-document-slide",
    "video": "/admin-core-service/slide/video-slide/add-or-update",
    "quiz": "/admin-core-service/slide/quiz-slide/add-or-update",
    "question": "/admin-core-service/slide/question-slide/add-or-update",
    "assignment": "/admin-core-service/slide/assignment-slide/add-or-update",
}


def build_slide_request(
    spec: Any,
    *,
    slide_order: int,
    slide_id: Optional[str] = None,
    existing_source_id: Optional[str] = None,
    status: str = "DRAFT",
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """
    Validate a slide spec and build ``{"path", "body", "type", "title"}`` for
    admin-core. Returns (request, report); request is None when the spec is
    invalid and ``report["problem"]`` says why. ``slide_id`` + ``existing_source_id``
    turn the request into an in-place update (``new_slide: false``).

    ``status`` is DRAFT unless the admin asked for a published slide. A
    PUBLISHED document / video also carries its published copy
    (``published_data`` / ``published_url``) — exactly what the dashboard's
    Publish button sends — because learners read the published copy.
    """
    if status not in SLIDE_STATUSES:
        return None, {"problem": f"status must be one of {', '.join(SLIDE_STATUSES)}"}
    published = status == "PUBLISHED"
    if not isinstance(spec, dict):
        return None, {"problem": "slide must be an object"}
    stype = str(spec.get("type") or "").lower().strip()
    if stype not in SLIDE_TYPES:
        return None, {"problem": f"type must be one of {', '.join(SLIDE_TYPES)}"}
    title = clean_title(spec.get("title"))
    if not title:
        return None, {"problem": "title is required"}
    is_new = not slide_id
    sid = slide_id or new_id()
    src = existing_source_id or new_id()
    base = {
        "id": sid, "title": title, "description": "", "image_file_id": "",
        "status": status, "slide_order": slide_order, "new_slide": is_new,
    }
    report: Dict[str, Any] = {}

    if stype in ("document", "pdf"):
        if stype == "document":
            html, report = clean_document_html(spec.get("html"))
            if html is None:
                return None, report
            doc = {"type": "HTML", "data": html, "total_pages": 1}
        else:
            file_id = str(spec.get("file_id") or "").strip()
            if not file_id or file_id.startswith("http"):
                return None, {"problem": "pdf needs file_id from course_edit(action='import_pdf')"}
            doc = {"type": "PDF", "data": file_id, "total_pages": _int(spec.get("total_pages")) or 1}
        body = {
            **base, "notify": False,
            "document_slide": {
                "id": src, "title": title, "cover_file_id": "",
                "published_data": doc["data"] if published else None,
                "published_document_total_pages": doc["total_pages"] if published else None,
                "force_publish": False, "force_overwrite": True, **doc,
            },
        }
    elif stype == "video":
        url = str(spec.get("url") or "").strip()
        if not youtube_id(url):
            return None, {"problem": "video url must be a YouTube https link (watch / youtu.be / embed / shorts)"}
        body = {
            **base, "source_type": "VIDEO",
            "video_slide": {
                "id": src, "title": title, "description": str(spec.get("description") or "")[:2000],
                "url": url, "published_url": url if published else None, "video_length_in_millis": 0,
                "published_video_length_in_millis": 0, "source_type": "VIDEO",
                "embedded_type": "YOUTUBE", "embedded_data": None, "questions": [],
            },
        }
    elif stype == "quiz":
        raw = spec.get("questions")
        if not isinstance(raw, list) or not raw:
            return None, {"problem": "quiz needs a non-empty `questions` list"}
        if len(raw) > MAX_QUESTIONS:
            return None, {"problem": f"at most {MAX_QUESTIONS} questions per quiz"}
        questions = []
        for i, q in enumerate(raw):
            norm, problem = normalize_question(q, i)
            if problem:
                return None, {"problem": problem}
            questions.append(quiz_question_payload(norm, i + 1))
        missing_exp = sum(1 for q in raw if isinstance(q, dict) and not str(q.get("explanation") or "").strip())
        if missing_exp:
            report["warning"] = f"{missing_exp} question(s) have no explanation"
        settings = spec.get("settings") if isinstance(spec.get("settings"), dict) else {}
        body = {
            **base, "source_type": "QUIZ",
            "quiz_slide": {
                "id": src, "title": title, "description": _rich(str(spec.get("description") or "")),
                "time_limit_in_minutes": _int(settings.get("time_limit_minutes")),
                "marks_per_question": _num(settings.get("marks_per_question")) or 1.0,
                "negative_marking": _num(settings.get("negative_marking")) or 0.0,
                "pass_percentage": _num(settings.get("pass_percentage")),
                "re_attempt_count": _int(settings.get("re_attempts")),
                "questions": questions,
            },
        }
        report["questions"] = len(questions)
    elif stype == "question":
        norm, problem = normalize_question(spec.get("question"), 0)
        if problem:
            return None, {"problem": problem}
        if norm["type"] == "LONG_ANSWER":
            return None, {"problem": "a question slide must be auto-graded — use an assignment for long answers"}
        option_ids = [new_id() for _ in norm["options"]]
        response_type, evaluation_type = _evaluation(norm["type"])
        body = {
            **base, "source_type": "QUESTION",
            "question_slide": {
                "id": src,
                "parent_rich_text": _rich(""),
                "text_data": _rich(norm["question"]),
                "explanation_text_data": _rich(norm.get("explanation") or ""),
                "media_id": "",
                "question_response_type": response_type,
                "question_type": norm["type"],
                "access_level": "INSTITUTE",
                "auto_evaluation_json": _auto_evaluation_json(norm, option_ids),
                "evaluation_type": evaluation_type,
                "default_question_time_mins": _int(spec.get("time_minutes")) or 1,
                "re_attempt_count": _int(spec.get("re_attempts")) or 0,
                "points": _int(spec.get("points")) or 1,
                "source_type": "QUESTION",
                "options": [
                    {"id": oid, "question_slide_id": src, "text": _rich(text),
                     "explanation_text_data": _rich(""), "media_id": "", "preview_id": str(i + 1)}
                    for i, (oid, text) in enumerate(zip(option_ids, norm["options"]))
                ],
            },
        }
    else:  # assignment
        instructions = str(spec.get("instructions_html") or spec.get("html") or "").strip()
        if not instructions:
            return None, {"problem": "assignment needs instructions_html"}
        body = {
            **base, "source_type": "ASSIGNMENT",
            "assignment_slide": {
                "id": src,
                "parent_rich_text": _rich(""),
                "text_data": _rich(instructions),
                "live_date": _iso(spec.get("live_date")),
                "end_date": _iso(spec.get("end_date")),
                "re_attempt_count": _int(spec.get("re_attempts")) or 0,
                "comma_separated_media_ids": "types:",
                "total_marks": _num(spec.get("total_marks")),
                "passing_marks": _num(spec.get("passing_marks")),
                "questions": [],
            },
        }
    return {"path": SLIDE_ENDPOINTS[stype], "body": body, "type": stype, "title": title, "id": sid}, report


def _iso(value: Any) -> Optional[str]:
    """An ISO-8601 instant admin-core can parse (Instant), or None."""
    if not value:
        return None
    from datetime import datetime, timezone
    raw = str(value).strip()
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── outline → structure plan ─────────────────────────────────────────────

def normalize_outline(args: Dict[str, Any], *, allow_empty: bool = False) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    The LLM's outline as ``{"course": {...}, "depth": n, "subjects": [{name, modules:
    [{name, chapters: [{name, slides: [...]}]}]}]}`` with hidden levels filled
    in as DEFAULT — so persistence is one loop regardless of depth. Chapter
    names are made unique within their module, slide titles within their chapter.
    ``allow_empty`` (a course copied from another one): no structure is fine — ``subjects`` is then [].
    """
    course = args.get("course") if isinstance(args.get("course"), dict) else {}
    name = clean_title(course.get("name") or args.get("name"))
    if not name:
        return None, "course.name is required"
    try:
        depth = int(course.get("depth") or args.get("depth") or 3)
    except (TypeError, ValueError):
        return None, "depth must be 2, 3, 4 or 5"
    if depth not in (2, 3, 4, 5):
        return None, "depth must be 2, 3, 4 or 5"

    def _chapters(node: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [c for c in (node.get("chapters") or []) if isinstance(c, dict)]

    if depth == 5:
        subjects_in = [s for s in (args.get("subjects") or []) if isinstance(s, dict)]
        if not subjects_in and not allow_empty:
            return None, "depth 5 needs `subjects` → modules → chapters"
        subjects = [{"name": clean_title(s.get("name"), f"Subject {i + 1}"),
                     "modules": [{"name": clean_title(m.get("name"), f"Module {j + 1}"), "chapters": _chapters(m)}
                                 for j, m in enumerate(s.get("modules") or []) if isinstance(m, dict)]}
                    for i, s in enumerate(subjects_in)]
    elif depth == 4:
        modules_in = [m for m in (args.get("modules") or []) if isinstance(m, dict)]
        if not modules_in and not allow_empty:
            return None, "depth 4 needs `modules` → chapters"
        subjects = [{"name": DEFAULT_LEVEL, "modules": [
            {"name": clean_title(m.get("name"), f"Module {j + 1}"), "chapters": _chapters(m)}
            for j, m in enumerate(modules_in)]}] if modules_in else []
    else:
        chapters_in = [c for c in (args.get("chapters") or []) if isinstance(c, dict)]
        if depth == 2:
            slides = [s for c in chapters_in for s in (c.get("slides") or [])] or list(args.get("slides") or [])
            chapters_in = [{"name": DEFAULT_LEVEL, "slides": slides}] if slides or not allow_empty else []
        if not chapters_in and not allow_empty:
            return None, "depth 3 needs `chapters` (depth 2: `slides` or one chapter)"
        subjects = ([{"name": DEFAULT_LEVEL, "modules": [{"name": DEFAULT_LEVEL, "chapters": chapters_in}]}]
                    if chapters_in else [])

    total_chapters = 0
    for s in subjects:
        if not s["modules"]:
            return None, f"'{s['name']}' has no modules"
        for m in s["modules"]:
            if not m["chapters"]:
                return None, f"'{m['name']}' has no chapters"
            seen: set = set()
            cleaned = []
            for k, c in enumerate(m["chapters"]):
                cname = clean_title(c.get("name"), f"Chapter {k + 1}") if depth >= 3 else DEFAULT_LEVEL
                cname = _unique(cname, seen)
                slides = [x for x in (c.get("slides") or []) if isinstance(x, (dict, str))]
                if len(slides) > MAX_SLIDES_PER_CHAPTER:
                    return None, f"chapter '{cname}' has more than {MAX_SLIDES_PER_CHAPTER} slides"
                titles: set = set()
                norm_slides = []
                for x in slides:
                    x = {"type": "document", "title": x} if isinstance(x, str) else dict(x)
                    x["title"] = _unique(clean_title(x.get("title"), "Untitled"), titles)
                    norm_slides.append(x)
                cleaned.append({"name": cname, "slides": norm_slides})
                total_chapters += 1
            m["chapters"] = cleaned
    if total_chapters > MAX_CHAPTERS:
        return None, f"at most {MAX_CHAPTERS} chapters per course"

    tags = [clean_title(t)[:40] for t in (course.get("tags") or []) if clean_title(t)][:10]
    return {
        "course": {
            "name": name,
            "about_html": str(course.get("about_html") or "").strip(),
            "why_learn_html": str(course.get("why_learn_html") or "").strip(),
            "who_should_learn_html": str(course.get("who_should_learn_html") or "").strip(),
            "tags": tags,
        },
        "depth": depth,
        "subjects": subjects,
    }, None


DEFAULT_LEVEL = "DEFAULT"
MAX_BATCHES = 30

BATCHES_CONTRACT = (
    "A course is taught in one or more BATCHES = session × level. Most courses need none: leave out "
    "`sessions` / `levels` and the course gets one hidden default batch. Otherwise:\n"
    "  levels: ['Class 9', 'Class 10']                     → one batch per level (no session)\n"
    "  sessions: [{name: '2026-27', start_date?: 'YYYY-MM-DD', levels?: ['Class 9', …]}]\n"
    "                                                      → one batch per session × level (a session with no "
    "levels gets the default level; top-level `levels` apply to sessions that list none)\n"
    "Reuse the institute's existing ones (courses(action='sessions_levels')) by id: {id: '<session id>'} / "
    "{id: '<level id>'}; a NAME that already exists in the institute is reused automatically. All batches share "
    "the same chapters and slides; each batch gets its own invite link and enrolments."
)


def _level_payload(level: Any, index: int) -> Tuple[Optional[Dict[str, Any]], Optional[str], Optional[str]]:
    """(AddLevelWithSessionDTO, label, problem) — mirrors the dashboard's formatLevels()."""
    group = {"id": "", "group_name": "", "group_value": "", "new_group": True}
    common = {"duration_in_days": 0, "thumbnail_file_id": "", "package_id": "", "is_parent": False,
              "parent_id": None, "add_faculty_to_course": [], "group": group}
    if isinstance(level, dict) and level.get("id"):
        # Existing level: NO name — admin-core renames an existing level to whatever name is sent.
        return {"id": str(level["id"]), "new_level": False, "level_name": "", **common}, f"level:{level['id']}", None
    name = clean_title(level.get("name") if isinstance(level, dict) else level)
    if not name:
        return None, None, f"level {index + 1} needs a name or an id"
    if name.upper() == DEFAULT_LEVEL:
        return None, None, "'DEFAULT' is reserved — leave levels out for a course without levels"
    return {"id": "", "new_level": True, "level_name": name, **common}, name.casefold(), None


def _default_level() -> Dict[str, Any]:
    return {"id": DEFAULT_LEVEL, "new_level": True, "level_name": DEFAULT_LEVEL, "duration_in_days": 0,
            "thumbnail_file_id": "", "package_id": "", "is_parent": False, "parent_id": None,
            "add_faculty_to_course": [],
            "group": {"id": DEFAULT_LEVEL, "group_name": DEFAULT_LEVEL, "group_value": "", "new_group": True}}


def normalize_batches(args: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    The add-course ``contain_levels`` + ``sessions`` payload for the requested
    batches, built exactly like the dashboard's course wizard
    (components/common/study-library/-utils/helper.ts). Returns
    ({"contain_levels", "sessions", "batches": [labels]}, None) or (None, problem).
    No sessions and no levels → contain_levels false (one hidden default batch).
    """
    sessions_in = args.get("sessions")
    levels_in = args.get("levels")
    if sessions_in in (None, []) and levels_in in (None, []):
        return {"contain_levels": False, "sessions": [], "batches": []}, None
    if sessions_in is not None and not isinstance(sessions_in, list):
        return None, "sessions must be a list"
    if levels_in is not None and not isinstance(levels_in, list):
        return None, "levels must be a list"

    def levels_for(items: List[Any]) -> Tuple[Optional[List[Dict[str, Any]]], List[str], Optional[str]]:
        out, labels, seen = [], [], set()
        for i, lv in enumerate(items):
            payload, key, problem = _level_payload(lv, i)
            if problem:
                return None, [], problem
            if key in seen:
                continue
            seen.add(key)
            out.append(payload)
            labels.append(payload["level_name"] or f"level {payload['id']}")
        return out, labels, None

    top_levels, top_labels, problem = levels_for(levels_in or [])
    if problem:
        return None, problem

    sessions: List[Dict[str, Any]] = []
    batch_labels: List[str] = []
    if not sessions_in:
        sessions.append({"id": DEFAULT_LEVEL, "session_name": DEFAULT_LEVEL, "status": "ACTIVE", "start_date": "",
                         "new_session": True, "levels": top_levels})
        batch_labels = list(top_labels)
    else:
        seen_sessions = set()
        for i, sess in enumerate(sessions_in):
            if not isinstance(sess, (dict, str)):
                return None, f"session {i + 1} must be an object or a name"
            sess = {"name": sess} if isinstance(sess, str) else sess
            start = str(sess.get("start_date") or "").strip()
            if start:
                from datetime import date
                try:
                    start = date.fromisoformat(start[:10]).isoformat()
                except ValueError:
                    return None, f"session {i + 1}: start_date must be YYYY-MM-DD"
            if sess.get("id"):
                payload = {"id": str(sess["id"]), "session_name": "", "status": "ACTIVE", "start_date": start,
                           "new_session": False}
                key, label = f"session:{sess['id']}", f"session {sess['id']}"
            else:
                name = clean_title(sess.get("name"))
                if not name:
                    return None, f"session {i + 1} needs a name or an id"
                if name.upper() == DEFAULT_LEVEL:
                    return None, "'DEFAULT' is reserved — leave sessions out for a course without sessions"
                payload = {"id": "", "session_name": name, "status": "ACTIVE", "start_date": start,
                           "new_session": True}
                key, label = name.casefold(), name
            if key in seen_sessions:
                return None, f"session '{label}' is listed twice"
            seen_sessions.add(key)
            if sess.get("levels"):
                lv, lv_labels, problem = levels_for(sess["levels"])
                if problem:
                    return None, f"session '{label}': {problem}"
            elif top_levels:
                lv, lv_labels = [dict(x) for x in top_levels], top_labels
            else:
                lv, lv_labels = [_default_level()], [None]
            sessions.append({**payload, "levels": lv})
            batch_labels += [" · ".join(x for x in (label, l) if x) for l in lv_labels]
    if len(batch_labels) > MAX_BATCHES:
        return None, f"at most {MAX_BATCHES} batches (sessions × levels) per course"
    return {"contain_levels": True, "sessions": sessions, "batches": batch_labels}, None


def _unique(title: str, used: set) -> str:
    key = title.casefold()
    if key not in used:
        used.add(key)
        return title
    n = 2
    while f"{title} (part {n})".casefold() in used:
        n += 1
    out = f"{title} (part {n})"
    used.add(out.casefold())
    return out


def is_placeholder(spec: Dict[str, Any]) -> bool:
    """A slide entry with no content — listed in the plan, not saved."""
    stype = str(spec.get("type") or "document").lower()
    content_keys = {
        "document": ("html",), "video": ("url",), "pdf": ("file_id",), "quiz": ("questions",),
        "question": ("question",), "assignment": ("instructions_html", "html"),
    }.get(stype, ())
    return not any(spec.get(k) for k in content_keys)


# ── review (deterministic) ───────────────────────────────────────────────

def review_findings(chapters: List[Dict[str, Any]], depth: Optional[int]) -> List[Dict[str, Any]]:
    """
    Findings over a loaded course: [{severity: fix|warn, where, issue}]. ``chapters``
    are flattened chapters whose slides carry ``type`` and (for documents/quizzes)
    loaded ``html`` / ``questions`` content.
    """
    from . import content_dedupe

    findings: List[Dict[str, Any]] = []

    def add(sev: str, where: str, issue: str) -> None:
        findings.append({"severity": sev, "where": where, "issue": issue})

    if not chapters:
        add("fix", "course", "The course has no chapters.")
    if depth and depth >= 3 and len(chapters) == 1 and len(chapters[0].get("slides") or []) > 12:
        add("warn", "course", "One chapter holds every slide — split it into chapters.")
    dedupe_input = []
    for c in chapters:
        where_c = f"chapter '{c.get('name')}'"
        slides = c.get("slides") or []
        if not slides:
            add("fix", where_c, "Chapter has no slides.")
        types = {s.get("type") for s in slides}
        if len(slides) >= 4 and not types & {"QUIZ", "QUESTION", "ASSIGNMENT"}:
            add("warn", where_c, "No quiz, question or assignment — add a check for understanding.")
        for s in slides:
            where = f"{where_c} → '{s.get('title')}'"
            stype = s.get("type")
            if stype == "DOCUMENT":
                html = s.get("html")
                if s.get("document_type") == "HTML":
                    words = word_count(html or "")
                    if words < MIN_DOCUMENT_WORDS:
                        add("fix", where, f"Only {words} words of teaching text (aim for 300-600).")
                    if html and _PLACEHOLDER_IMG_RE.search(html):
                        add("fix", where, "Contains image placeholders that will never render.")
                    dedupe_input.append({"path": s.get("id"), "title": s.get("title"),
                                         "chapter": c.get("id"), "html": html or ""})
                elif not (s.get("html") or "").strip():
                    add("fix", where, "Document has no content.")
            elif stype == "QUIZ":
                n = s.get("question_count")
                if n is not None and n < 3:
                    add("warn", where, f"Only {n} question(s) — 5-10 makes a useful quiz.")
            if s.get("status") == "DRAFT":
                pass  # expected for MCP-built courses; publishing is the dashboard's job
    repeated = content_dedupe.find_repetition(dedupe_input)
    titles = {d["path"]: d["title"] for d in dedupe_input}
    for path, info in repeated.items():
        add("warn", f"'{titles.get(path)}'",
            f"Repeats material already taught in {', '.join(info['owner_titles'][:3])} — rewrite it with update_slide.")
    return findings


__all__ = [
    "SLIDE_TYPES", "SLIDE_STATUSES", "QUESTION_TYPES", "SOURCE_TYPE_TO_SPEC", "DEPTH_CONTRACT", "OUTLINE_CONTRACT",
    "slide_contract", "clean_document_html", "youtube_id", "normalize_question", "quiz_question_payload",
    "build_slide_request", "normalize_outline", "is_placeholder", "review_findings", "word_count", "new_id",
    "clean_title", "DEFAULT_LEVEL", "BATCHES_CONTRACT", "normalize_batches",
]
