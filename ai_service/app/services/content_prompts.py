from __future__ import annotations


_DOC_CONTENT_TYPE_SPECS = {
    "notes": "SHORT NOTES: concise, scannable teaching notes with headings, tight bullets, and concrete examples.",
    "summary": "SUMMARY: a short, scannable recap / TL;DR of the key points as a compact card or bullet list — for quick revision.",
    "flashcards": (
        "FLASHCARDS: an INTERACTIVE flashcard deck — cards the learner clicks/taps to flip (question → answer), built with inline JS/CSS. Include the handful of most important cards. FLIP MECHANISM (mandatory): toggle a `.flipped` class that SWAPS FACE VISIBILITY with `display` — `.back{display:none}`, `.flipped .front{display:none}`, `.flipped .back{display:flex}`. Do NOT use 3D transforms (`rotateY`, `backface-visibility`, `transform-style:preserve-3d`) — some render contexts drop transforms, which leaves the rotated answer face permanently visible on top of the question (this has shipped). LAYOUT RULES: faces live in NORMAL FLOW (no `position:absolute`) so the card grows with its text; the card has `width:100%` and a `min-height` (≈170px); deck uses `grid-template-columns:repeat(auto-fit,minmax(240px,1fr))` — NEVER an `auto` track (collapses to zero width, one word per line); wrappers/faces must be block/flex elements, never bare `<span>`s (width is IGNORED on inline elements — text has shipped ONE LETTER PER LINE); any Question/Answer label sits in flow above the text, never absolutely positioned over it; prev/next controls on their OWN row; face text gets `overflow-wrap:break-word`."
    ),
    "practical_examples": "PRACTICAL EXAMPLES: worked, real-world examples/applications showing the concept in action, step by step.",
    "why_it_matters": "WHY IT MATTERS: a short opening hook — what this topic is and why the learner should care, grounded in the material's own framing (2-4 sentences, before the notes).",
    "high_yield": "HIGH-YIELD POINT: one visually prominent callout card with THE most exam-relevant fact/distinction of this topic, quoted faithfully from the material.",
    "visual_process": "VISUAL / PROCESS: one clear diagram of this topic's core process or relationships — inline SVG or styled HTML, adapted from the material's own figures/flow where they exist (never a decorative stock-style image).",
    "application": "APPLICATION: one short applied scenario or worked case that uses this topic's content (from the material; no invented statistics or named instruments).",
    "interactive_games": (
        "INTERACTIVE GAME (REQUIRED when listed — never omit it): one small, genuinely playable "
        "learning game built from THIS material's own terms. Pick the form that fits the content: "
        "match each term to its definition, put the steps of a process in the right order, sort "
        "items into their correct categories, or a click-to-reveal/timed recall challenge. "
        "Implement it in inline JS with real state, scoring and per-answer feedback (correct/"
        "incorrect + a short 'why'), and a Reset control. It must work with mouse AND touch — if "
        "you use drag-and-drop, also support tap-to-select-then-tap-to-place, or prefer "
        "click/tap-based interaction outright."
    ),
    "quiz": "QUIZ: an INTERACTIVE multiple-choice quiz — the learner selects answers and gets instant feedback + a score (inline JS), 3-5 questions each with a short explanation. When the learner finishes, report the result with `window.parent.postMessage({type:'vacademy:complete', score:<n>, maxScore:<n>, wrong:<n>, timesSec:[<seconds per question>]}, '*')`.",
}


def _doc_content_types_block(content_types: "list | None") -> str:
    if not content_types:
        return ""
    specs = [
        f"  {i}. {_DOC_CONTENT_TYPE_SPECS[t]}"
        for i, t in enumerate((c for c in content_types if c in _DOC_CONTENT_TYPE_SPECS), start=1)
    ]
    if not specs:
        return ""
    return (
        "\n\n**Also build these sections into the page** (part of ONE cohesive design, not "
        "disconnected blocks; any interactive part uses inline JS and must actually work; all "
        "content visible on load — no scroll-reveal):\n"
        + "\n".join(specs)
        + "\n\nIMPORTANT — these are PRESENTATION FORMATS, not new subject matter. Any "
        "source-fidelity rule above restricts the FACTS you may state; it does NOT excuse you "
        "from building these sections. Build every one of them USING the material's own "
        "content: the flashcards, quiz questions and game items must all be drawn from the "
        "definitions, lists, steps and classifications in the passages — inventing the "
        "interaction is required, inventing facts is not allowed. Do not skip a requested "
        "section because the material 'does not contain a game/quiz' — it never will; that is "
        "your job to construct from what the material says."
    )



_DESIGN_SAFETY_RULES = """**Rendering safety — every rule below exists because generated pages have ACTUALLY shipped broken this way**:
- CONTRAST, per surface: set the text colour explicitly on EVERY surface (hero, card, band) for ALL its descendants. Dark surfaces set light text — and a LIGHT panel nested inside a dark surface must re-set its own DARK text (white-on-pale-mint has shipped invisible). Never use muted/grey text on a coloured or gradient background — text there must be white/near-white. Inline emphasis (`strong`,`b`,`em`,`mark`,`span`) always INHERITS its container's colour — never give it a fixed colour; emphasise with weight or background instead.
- LAYOUT, no overlap: sections and cards stack in NORMAL document flow (block/flex/grid). NEVER absolutely position text, labels or footers over other content; never use negative margins to pull elements onto each other; never pin a caption with `position:absolute; bottom:0` inside a card whose content flows (labels have shipped printed across paragraphs). No fixed heights that clip or force overlap — cards grow with their content.
- VISIBILITY: the page renders at FULL height with NO internal scrolling — never hide content behind scroll-triggered reveals (IntersectionObserver / scroll listeners starting sections at opacity:0); everything is visible on load and entrance animations play on load. Any animation touching opacity must END at opacity:1 — text frozen at partial opacity has shipped as unreadable ghost text. Honor `@media (prefers-reduced-motion: reduce)`.
- SVG DIAGRAMS: `<text>` NEVER wraps — size every box to its LONGEST label plus padding, or split the label across multiple `<text>`/`<tspan>` lines; a label wider than its rect has shipped overflowing the diagram. Never write a global `svg text{fill:...}` rule — it OVERRIDES per-element `fill="..."` attributes (CSS beats presentation attributes) and has shipped dark text on dark boxes; set fill per element or per class.
- SURFACE-MATCHED CHILDREN: style a child card for the surface it ACTUALLY sits on — translucent-white backgrounds with near-white text belong only inside dark surfaces; placed in a white panel they have shipped INVISIBLE. Do not rely on transforms or 3D effects for showing/hiding content anywhere — some render contexts drop transforms; use `display`/class toggles."""


def _fig_field(fig, *names) -> str:
    """First non-empty of the named fields, whether the figure is an object
    (PDF-ingest path: .url/.caption) or a dict (KB path: image_url/alt_text).
    getattr on a dict silently returns the default — that bug dropped EVERY
    knowledge-base figure from the manifest, so no source figure was ever
    offered to a KB course's slides."""
    for name in names:
        value = getattr(fig, name, None)
        if value is None and isinstance(fig, dict):
            value = fig.get(name)
        if value:
            return str(value)
    return ""


class ContentGenerationPrompts:
    """
    Prompt templates for content generation (documents and assessments).
    Matches the pattern from media-service ConstantAiTemplate.
    """

    @staticmethod
    def build_document_prompt(
        text_prompt: str,
        title: str,
        include_diagrams: bool = False,
        language: str = "English",
        reference_figures: "list | None" = None,
        content_types: "list | None" = None,
        sibling_titles: "list | None" = None,
        figures_policy: "str | None" = None,
    ) -> str:
        """
        Build document generation prompt. Always produces HTML (the only format
        the slide editor round-trips losslessly); Mermaid diagrams are emitted
        as <div class="mermaid"> blocks inside the HTML.

        reference_figures: real figures extracted from an uploaded source PDF
        (objects with .fig_id, .url, .caption). When present, the model is told
        to embed the ones relevant to this slide verbatim using their exact URL,
        instead of an AI-generated illustration.
        """
        # Diagram-related keywords strengthen the diagram instruction from
        # "only where genuinely useful" to "include at least one".
        diagram_keywords = ["include diagrams", "include diagram", "with diagrams", "with diagram",
                           "add diagrams", "add diagram", "diagrams", "mermaid"]
        prompt_lower = text_prompt.lower()
        should_include_diagrams = include_diagrams or any(keyword in prompt_lower for keyword in diagram_keywords)

        diagram_emphasis = (
            "The course planner asked for diagrams — include at least ONE Mermaid diagram."
            if should_include_diagrams
            else "Include a Mermaid diagram ONLY where it genuinely aids understanding; skip it otherwise."
        )

        # figures_policy: REQUIRE = must embed every relevant source figure;
        # PREFER (default) = advisory; GENERATED_ONLY = ignore source figures.
        if figures_policy == "GENERATED_ONLY":
            reference_figures = None
        figures_block = ""
        if reference_figures:
            manifest = "\n".join(
                f"  - url={_fig_field(f, 'url', 'image_url')}"
                + (f" — {_fig_field(f, 'caption', 'alt_text')}" if _fig_field(f, 'caption', 'alt_text') else "")
                for f in reference_figures
                if _fig_field(f, "url", "image_url")
            )
            if manifest:
                figures_block = f"""**Source figures (from the uploaded document{" — you MUST embed every figure relevant to this slide" if figures_policy == "REQUIRE" else " — PREFER these over generated images"})**:
The uploaded source document provides these REAL figures/diagrams/tables. When this slide's topic matches one, embed it VERBATIM:
{manifest}
- Embed as: `<img src="EXACT_URL_FROM_THE_LIST_ABOVE" alt="short caption" style="max-width:100%;border-radius:8px;margin:12px 0;">`
- Use ONLY a url copied EXACTLY from the list above — never invent, guess, or alter a url.
- Embed ONLY the figures RELEVANT to THIS slide's topic (match by the caption text); skip the rest.
- Prefer a real source figure over a generated illustration whenever one fits the content.

"""

        content_types_block = _doc_content_types_block(content_types)

        # Repetition control: this slide's chapter siblings. Slides generate
        # independently, so without this the same definitions (and near-
        # identical quiz questions) repeat across a chapter.
        siblings_block = ""
        titles = [t for t in (sibling_titles or []) if t]
        if titles:
            listing = "\n".join(f"  - {t}" for t in titles)
            siblings_block = f"""

**This chapter's OTHER slides (do not re-teach their subjects)**:
{listing}
Stay strictly on THIS slide's own subject. Do not re-explain a sibling's topic — mention it in one clause at most ("covered in '{titles[0]}'"). Define each core term fully only on the slide named for it, and make flashcards/quiz questions test THIS slide's content, not a sibling's."""

        return f"""You are a world-class front-end designer AND an instructional designer. You craft ONE complete, self-contained, visually STUNNING HTML document that teaches its topic — a mini web page a student can learn from with no other material. It renders inside a sandboxed iframe, so it must be a full standalone document.

**Language**: Write ALL student-facing content in {language}. Do NOT use English if a different language is specified.

**Topic**: {title}

**Content Requirements** (from the course planner):
{text_prompt}
{content_types_block}{siblings_block}

**Depth & quality bar**:
- Real, substantive teaching content — roughly 300-600 words (more if the topic demands it). Never thin, never filler, never lorem ipsum.
- Explain step by step; for every important idea give a concrete example, analogy, or real-world application. Call out common misconceptions where relevant.
- Cover: an engaging hero/intro (what this is + why it matters), the core sections, and a "Key Takeaways" summary.

**Design & creativity (this is the point — make it beautiful and memorable)**:
- Return a SINGLE full document: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"> <style>…ALL your CSS…</style></head><body>…</body></html>`.
- Put ALL styling in one inline `<style>`. Design a cohesive visual system: a considered color palette, strong typography, generous spacing, cards/sections, clear hierarchy. Dark text on light surfaces by default; strong contrast.
- Use tasteful MOTION: CSS `@keyframes`/transitions, hover states, and small vanilla JS (one inline `<script>` at the end of `<body>`) for counters, tabs, interactive diagrams, or canvas/SVG. Motion must be smooth and purposeful — wrap non-essential motion in `@media (prefers-reduced-motion: reduce)` to disable it.
- Responsive (mobile → desktop) and accessible (semantic tags, alt text, keyboard-friendly).
- You MAY load Google Fonts via `<link>` and a reputable CDN library via `<script src>` if it genuinely elevates the page. Prefer inline SVG for diagrams. NEVER reference private/local URLs, analytics or trackers, and don't rely on cookies/localStorage/parent-window access.

{_DESIGN_SAFETY_RULES}

**Diagrams** — {diagram_emphasis} Prefer hand-crafted inline SVG or styled HTML/CSS diagrams (they always render and match your design). Use Mermaid ONLY if you also include the mermaid CDN `<script>` and initialize it; otherwise avoid it. Precede each diagram with a short sentence explaining what it shows.

**Teach visually (institutes told us our pages read as walls of text — students learn from pictures)** — every major idea must be carried by something the learner can SEE, the way a textbook does it. Alongside the prose, use: labelled inline-SVG diagrams and cross-sections, icon-led key-point cards, colour-coded callouts (definition / example / common mistake / remember), side-by-side comparisons, step-numbered process strips, and a visual summary at the end. Aim for a diagram, picture or visual-note block roughly every screenful — never two long prose sections in a row.

{figures_block}**Illustrations (real, generated images)** — include 2-4 real illustrations where a picture beats shapes (a realistic scene, an object, an organism, an apparatus, a historical setting):
- If a source figure above already illustrates this slide, embed it (verbatim URL) and you usually don't need a generated one.
- Otherwise emit a placeholder the pipeline fills with a real generated image, EXACTLY: `<img data-img-prompt="vivid, specific English description of an educational illustration for this topic" src="placeholder.png" data-img-aspect="16:9" alt="short description" style="max-width:100%;">` (`data-img-aspect` is optional — 16:9 | 4:3 | 1:1 | 3:4 | 9:16, default 16:9 — and you may style it further via your CSS/classes).
- The `data-img-prompt` MUST be in English (even when content language differs), describe subject/setting/style, and be unique per image. Never use external/fake image URLs for these. Don't use a generated image for something an SVG/table expresses better.
- Wrap each one in a `<figure>` with a short `<figcaption>` saying what to notice, so the page still teaches if an image fails to render.

**Code** — ONLY if the topic itself is about programming or a code-based skill (never for non-technical topics).
- Emit code as `<pre data-language="python"><code class="language-python">...code...</code></pre>` and style it in your CSS. Escape `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`; preserve real indentation; code must be complete and runnable.

**Output**: Return ONLY the raw HTML document. No markdown, no ``` fences, no commentary. Start with `<!DOCTYPE html>`.
"""

    @staticmethod
    def build_assessment_prompt(text_prompt: str, title: str, language: str = "English") -> str:
        """
        Build assessment generation prompt matching media-service PROMPT_TO_QUESTIONS template.
        """
        return f"""**Objective** : {text_prompt}
**Topic** : {title}
**Language**: Generate ALL questions, options, answers, and explanations in {language}. Do NOT use English if a different language is specified.
                
**Instructions**:
1. Continuation Handling:
   - Content Should be related to Topic
   - Strictly avoid duplicate content from existing questions
                
2. Content Requirements:
   - Generate all content from the text prompt
   - For questions that genuinely need a visual (diagrams, shapes, graphs, circuits, maps, experimental setups, etc.), you MAY include an image using ONLY this exact format:
     <!-- DS_TAG_IMG_START --><img data-img-prompt="VIVID_ENGLISH_DESCRIPTION" src="placeholder.png" alt="description" style="max-width:100%;border-radius:8px;margin:8px 0;"><!-- DS_TAG_IMG_END -->
   - The data-img-prompt must be a vivid, specific English description — the image pipeline will generate the actual image
   - NEVER use external URLs (https://example.com, https://..., etc.) as src — ALWAYS use src="placeholder.png"
   - For simple shapes, equations, or diagrams, prefer inline SVG over an img tag
   - Only add images when they are truly essential to understand or answer the question — do not add decorative images

3. Question Type Handling:
   - MCQS/MCQM: 4 options with clear single/multiple answers
   - ONE_WORD/LONG_ANSWER:
     * Omit 'options' field
     * Provide detailed 'ans' and 'exp'
   - Set difficulty based on cognitive complexity
                
4. Metadata Requirements:
   - Tags: 5 specific tags per question
   - Subjects: Minimum 1 relevant subject
   - Classes: Include secondary relevant classes if applicable
                
**Output Format**:
                
{{
    "questions": [
        {{
            "question_number": "number",
            "question": {{
                "type": "HTML",
                "content": "string" // Text, inline SVG, or img with data-img-prompt (NEVER external URLs)
            }},
            "options": [
                {{
                    "type": "HTML",
                    "preview_id": "string", // generate sequential id for each option like "1", "2", "3", "4"
                    "content": "string" // Plain text or inline SVG — no external URLs
                }}
            ],
            "correct_options": ["1"], // preview_id of correct option or list of correct options
            "ans": "string",
            "exp": "string",
            "question_type": "MCQS | MCQM | ONE_WORD | LONG_ANSWER",  //Strictly Include question_type
            "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
            "level": "easy | medium | hard"
        }}
    ],
    "title": "string", // Suitable title for the question paper
    "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"], // multiple chapter and topic names for question paper
    "difficulty": "easy | medium | hard",
    "is_process_completed": true,
    "subjects": ["subject1", "subject2", "subject3", "subject4", "subject5"], // multiple subject names for question paper
    "classes": ["class 1", "class 2"] // can be of multiple class
}}
                
**Critical Rules**:
- If textPrompt is insufficient for questions, generate at least 5 questions from the topic
- Strictly validate JSON syntax
- Ensure question numbers are sequential without gaps
- Never repeat question stems or options
- NEVER use external/real/fake image URLs — only src="placeholder.png" with data-img-prompt attribute
- Always wrap img tags in <!-- DS_TAG_IMG_START --> ... <!-- DS_TAG_IMG_END --> comments
"""


    @staticmethod
    def build_code_prompt(text_prompt: str, title: str, video_topic: str, language: str = "English") -> str:
        """
        Build code generation prompt for video+code slides.
        Generates code examples that complement the video content.
        """
        return f"""**Task**: Generate educational code examples as Markdown

**Language**: Generate ALL explanations and comments in {language}. Do NOT use English if a different language is specified.

**Topic**: {title}
**Video Topic**: {video_topic}

**Content Requirements**:
{text_prompt}

**Output Format**:
- Generate code examples in Markdown format
- Use proper code blocks with syntax highlighting: ` ```language `
- Include multiple code examples if the topic requires it
- Keep code examples SHORT, CLEAR, and PRACTICAL (aim for 20-50 lines per example)
- Structure with clear headings and explanations

**Code Requirements (CRITICAL — every code block MUST be runnable)**:
- Every code block must be **syntactically correct and complete** — a learner should be able to copy-paste it and run it without errors
- Include ALL necessary imports/includes at the top of each code block
- Do NOT use placeholder code like `pass`, `...`, `# TODO`, or `# your code here`
- Every function/class must have a real, working implementation
- Add a runnable entry point: `if __name__ == "__main__":` for Python, `main()` for Go/Java, top-level calls for JavaScript/TypeScript
- Include **sample output** as a comment at the end of each code block (e.g., `# Output: Hello, World!`)
- Use best practices, clean code principles, and proper error handling
- Include inline comments explaining key concepts
- Make code examples directly relevant to the video topic

**Code Block Format**:
````markdown
## Example Title

Brief explanation of what this code does.

```python
import math

def calculate_area(radius: float) -> float:
    \"\"\"Calculate the area of a circle.\"\"\"
    return math.pi * radius ** 2

if __name__ == "__main__":
    area = calculate_area(5.0)
    print(f"Area of circle with radius 5: {{area:.2f}}")
    # Output: Area of circle with radius 5: 78.54
```

Explanation of the code output or key concepts.
````

**Content Style**:
- Write in a clear, student-friendly tone
- Explain what the code does and why
- Connect code examples to the video content
- Use practical, real-world examples
- Keep explanations concise but informative

**Important**: Return ONLY the Markdown content with code blocks. No explanations outside the markdown, no code block wrappers around the entire response, just the markdown content with code examples.
"""

    @staticmethod
    def build_homework_prompt(text_prompt: str, title: str, language: str = "English") -> str:
        """Assignment (homework) slide as a creative, self-contained HTML document
        (rendered in a sandboxed iframe like the other HTML slides). Hands-on and
        applied — a real task the student DOES; adapts to the subject (coding ONLY
        for technical chapters)."""
        return f"""You are a world-class instructional designer AND front-end designer. Produce ONE complete, self-contained, visually polished HTML document presenting a single hands-on ASSIGNMENT for the chapter below. It renders inside a sandboxed iframe at full height with NO internal scroll.

**Language**: Write ALL student-facing content in {language}. Do NOT use English if a different language is specified.

**Chapter**: {title}

**Context (what the chapter covered)**:
{text_prompt}

**Design the assignment**:
- Choose the task type from the subject: ONLY if the chapter teaches programming / software / a code-based skill -> ONE coding task (mini-project, implementation, setup, or debugging). For EVERY other subject -> ONE practical non-coding task (analyze a realistic case/dataset embedded in the assignment, produce a deliverable, correct/classify provided examples, or solve a scenario step by step). NEVER force a coding task onto a non-technical topic.
- Exactly ONE CONCRETE task — never generic, never a template, never bracketed placeholders like [Topic] or "e.g.". Invent real specifics for THIS chapter: a real scenario, real sample materials embedded in the page, real numbers/names.
- Present clearly: an Objective, a Scenario / your-mission, numbered Steps, the materials to work on (embedded in the page), and the Deliverable + acceptance criteria. Doable using only what this chapter covered.

**HTML & design (CRITICAL)**:
- Return a SINGLE full document: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>...ALL your CSS...</style></head><body>...</body></html>`. Put ALL styling in one inline `<style>` — cohesive palette, strong typography, cards/sections, generous spacing, dark text on light surfaces, strong contrast, responsive.

{_DESIGN_SAFETY_RULES}
- Code (ONLY when the task is a coding task): `<pre data-language="python"><code class="language-python">...</code></pre>` (correct language); escape & as &amp;, < as &lt;, > as &gt;; preserve real indentation; starter code complete and valid with a clear `# TODO: implement this` for student sections.

**Important**: Return ONLY the raw HTML document. No markdown, no ``` fences, no commentary. Start with `<!DOCTYPE html>`."""

    @staticmethod
    def build_solution_prompt(text_prompt: str, title: str, homework_content: str | None = None, language: str = "English") -> str:
        """Solution slide as a creative, self-contained HTML document: HINT first,
        then the full worked SOLUTION for the previous slide's assignment."""
        if homework_content:
            context_block = f"""**The EXACT assignment from the previous slide (solve THIS, and only this)**:
{homework_content}

**Chapter context** (for reference): {text_prompt}"""
        else:
            context_block = f"""**Context** (the assignment was based on this): {text_prompt}"""
        return f"""You are a world-class instructional designer AND front-end designer. Produce ONE complete, self-contained, visually polished HTML document containing the SOLUTION to the previous slide's assignment. It renders inside a sandboxed iframe at full height with NO internal scroll.

**Language**: Write ALL student-facing content in {language}. Do NOT use English if a different language is specified.

**Chapter**: {title}

{context_block}

**Content — two clearly separated sections**:
1. **Hint** (first): a few short, actionable hints that guide the student without giving the full answer away.
2. **Solution** (after): the full, correct, CONCRETE solution to THAT exact task — complete runnable code (only if it was a coding task), or the finished deliverable / full step-by-step working for non-coding tasks (show the actual finished result the student should produce, not a description of it). No placeholders like `pass` or `...`.

**HTML & design (CRITICAL)**:
- Return a SINGLE full document: `<!DOCTYPE html><html><head>...<style>...ALL your CSS...</style></head><body>...</body></html>`. All CSS inline — cohesive palette, strong typography, cards/sections, dark text on light surfaces, responsive.

{_DESIGN_SAFETY_RULES}
- Use exactly two section headings: "Hint" (first), then "Solution" (second) — never "Exact Solution".
- Code (ONLY when the homework was a coding task): `<pre data-language="python"><code class="language-python">...</code></pre>`; escape & < >; preserve indentation; complete and runnable.

**Important**: Return ONLY the raw HTML document. Put the HINT before the Solution. No markdown, no ``` fences, no commentary. Start with `<!DOCTYPE html>`."""


__all__ = ["ContentGenerationPrompts"]
