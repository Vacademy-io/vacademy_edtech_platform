"""Knowledge-base courses must follow the material, not a chapter count.

Two bounds were squeezing KB-grounded courses (owner report, 2026-09-03):

1. The wizard copied the KB card's own structure suggestion into the chapter
   and slides-per-chapter fields, and the outline prompt turned those into
   "EXACTLY N chapters" — so ADAPT / HIGHLIGHTS outlines merged or padded
   sections to hit a number nobody chose.
2. Every deterministic slide got its WHOLE section as grounding, truncated to
   the 28k-character budget, so a large section was taught from its first
   third and the rest never appeared.

These tests pin the two fixes: counts are ignored whenever a request carries
kb_grounding, and a section larger than the budget is cut into consecutive,
balanced chunk windows that each fit one slide.
"""
from types import SimpleNamespace

from app.services.kb import course_grounding as cg
from app.services.prompt_builder import CourseOutlinePromptBuilder


# ── split_profile_by_budget ──────────────────────────────────────────────────

def _profile(n_chunks: int, chars: int, page_of=lambda i: 1 + i // 3):
    return [
        {"chunk_index": i, "chars": chars, "page_start": page_of(i), "page_end": page_of(i)}
        for i in range(n_chunks)
    ]


def test_section_that_fits_is_not_split():
    assert cg.split_profile_by_budget(_profile(10, 1_000), budget=28_000) == []


def test_empty_profile_is_not_split():
    assert cg.split_profile_by_budget([], budget=28_000) == []


def test_large_section_splits_into_consecutive_windows_that_fit():
    # 30 chunks × 1.7k = 51k chars → ceil(51/28) = 2 parts.
    parts = cg.split_profile_by_budget(_profile(30, 1_700), budget=28_000)
    assert [p["index"] for p in parts] == [1, 2]
    assert all(p["count"] == 2 for p in parts)
    # Windows are consecutive and cover every chunk exactly once.
    assert parts[0]["chunk_from"] == 0
    assert parts[-1]["chunk_to"] == 29
    assert parts[1]["chunk_from"] == parts[0]["chunk_to"] + 1
    # Balanced, not greedy: neither part is a two-paragraph remainder.
    assert all(p["chars"] <= 28_000 for p in parts)
    assert min(p["chars"] for p in parts) >= 20_000
    # Page spans follow the window.
    assert parts[0]["page_start"] == 1
    assert parts[1]["page_end"] == 10


def test_split_is_capped_at_max_parts():
    parts = cg.split_profile_by_budget(_profile(200, 1_700), budget=28_000, max_parts=8)
    assert len(parts) == 8
    assert parts[0]["chunk_from"] == 0 and parts[-1]["chunk_to"] == 199


def test_split_survives_missing_pages_and_chars():
    profile = [{"chunk_index": i, "chars": None if i % 2 else 20_000, "page_start": None, "page_end": None}
               for i in range(4)]
    parts = cg.split_profile_by_budget(profile, budget=28_000)
    assert len(parts) == 2
    assert parts[0]["page_start"] is None and parts[0]["page_end"] is None


# ── prompt_builder ignores counts when KB-grounded ───────────────────────────

def _request(kb: bool, num_chapters=5, num_slides=25):
    return SimpleNamespace(
        user_prompt="Teach forces",
        existing_course_tree=None,
        course_depth=3,
        generation_options=SimpleNamespace(
            num_slides=num_slides, num_chapters=num_chapters, course_timing=None,
            generate_images=False, language="English",
        ),
        kb_grounding=SimpleNamespace(knowledge_base_id="kb-1", node_ids=[]) if kb else None,
    )


def test_prompt_counts_apply_without_kb():
    prompt = CourseOutlinePromptBuilder().build_prompt(_request(kb=False), None)
    assert "EXACTLY 5 chapters" in prompt
    assert "EXACTLY 25 slides" in prompt


def test_prompt_counts_are_ignored_with_kb():
    prompt = CourseOutlinePromptBuilder().build_prompt(_request(kb=True), None)
    # (The template header itself says "FOLLOW EXACTLY"; the count lines are the target.)
    assert "EXACTLY 5 chapters" not in prompt
    assert "EXACTLY 25 slides" not in prompt
    assert "User specifies exact chapter count" not in prompt
    assert "User specifies exact slide count" not in prompt
    assert "Structure follows the knowledge base" in prompt
