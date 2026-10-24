# Live AI Tutor (Personalized Teaching Mode) — Design

Status: design agreed 2026-09-03; WP0–WP3, WP6 and WP8 are on production (see `BUILD_PLAN.md` for
per-package status). A deep adversarial review on 2026-09-04 fixed 40-odd findings; §13 lists what
the code does differently from the earlier sections and what is still open.
Companion docs: `docs/lms/LMS_COURSE_ARCHITECTURE.md` (course model, tracking) and
`docs/ai-course/AI_COURSE_CREATION_AND_KNOWLEDGE_BASE.md` (copilot, KB, credits, auth).

## Table of contents

1. Goal and principles
2. Vocabulary
3. End-to-end picture
4. Creation time: the compile pipeline
5. Data model
6. Live runtime
7. Progress, tracking, and "next"
8. Voice: TTS, STT, languages
9. Side finding: knowledge-base courses are wrongly bounded by counts
10. Non-breaking guarantees
11. Security
12. Cost model and defaults
13. Phase plan
14. Decisions
15. File index

---

## 1. Goal and principles

An institute can flip a course into a **personalized teaching mode**. A learner opening such a
course is taught one to one by an AI teacher: a whiteboard fills in as the teacher speaks, the
teacher checks understanding after each concept, clears doubts, remembers what this learner is
weak at, and moves the learner forward through concepts, topics, slides, and chapters
automatically while the ordinary progress tracking is updated.

Principles agreed on 2026-09-03:

1. **Compile, do not improvise.** Every slide is compiled at course-creation time into a
   teaching plan (topics → concepts). The live session runs a state machine over that plan.
   The LLM is called only where judgment is needed: evaluating an answer, remediating,
   answering a doubt, adapting narration to the learner.
2. **Boards are operations, HTML is materialized.** Each concept's board is an ordered list of
   whitelisted board operations with stable element ids. The cumulative HTML is stored too.
   Highlighting, "writing something extra for this student", and entrance animations are all
   ops applied to ids. The live LLM never emits raw HTML.
3. **Default narration is compiled as well.** Each concept carries a default spoken text. The
   live model adapts it for the learner rather than writing from scratch. This also powers a
   teaching-off mode, a text-only mode with zero live LLM calls, and a future TTS cache.
4. **"Concept is clear" is a structured decision**, returned as JSON with a score against a
   rubric, capped remediation loops, and a weak flag. Never free text.
5. **Media is content, not decoration.** Every image, SVG, or video generated for a board
   carries a text description of what it shows and its labelled parts, so the live model can
   refer to it and highlight parts of it. Generated SVG diagrams are preferred for anything
   structural because they are addressable by id. Stock images and AI images are both allowed.
6. **Nothing existing changes.** New tables, a new ai_service router and socket, a new learner
   route, a new package setting key. The slide viewer, tracking, roll-ups, certificates, and the
   copilot's existing behaviour are untouched.
7. **Phase 1 covers courses created by our AI copilot only**, because their slides are HTML we
   authored, their quizzes are structured, and their AI videos carry a script. Existing AI
   courses do not need backfill (owner decision). Uploaded PDFs and YouTube videos inside such a
   course are taught from an admin-supplied description: the teacher asks the learner to watch
   or read, checks understanding against the description, and marks the slide complete when
   satisfied.

---

## 2. Vocabulary

| Term | Meaning |
|---|---|
| Teaching plan | The compiled artifact for one slide version: objectives, key terms, topics. |
| Topic | One whiteboard's worth of teaching. The board is cleared when the topic ends. |
| Concept | One phase of a topic's board. Has board ops, default narration, teaching notes, a check. |
| Board op | A whitelisted operation on the whiteboard: heading, bullet, formula, svg, image, highlight, note, clear… |
| Check | A question with type, expected answer, rubric, misconceptions with hints, pass threshold. |
| Learner state | Per learner per batch: position pointer, mastery per concept tag, misconceptions, rolling summary. |
| Tutor session | One sitting: transport, transcript, attempts, and the summary written at the end. |
| Decision | The JSON a live turn returns: action, say, board ops, assessment, state delta, next pointer. |

Slide → topics → concepts is strictly hierarchical. Concept ids are stable across plan
versions where the compiler can match by title, so learner mastery survives a recompile.

---

## 3. End-to-end picture

Creation time (extends the existing copilot flow; ai_service owns the plan tables the same way
it owns the knowledge-base tables inside the admin_core database):

```mermaid
sequenceDiagram
    participant A as Admin browser (copilot)
    participant C as admin_core
    participant S as ai_service
    A->>S: outline + content generation (unchanged)
    A->>C: persist course/subject/module/chapter/slides (unchanged)
    A->>S: POST /tutor/v1/compile {package_id, slide_ids[], language}
    S->>C: read published slide content (document_slide / quiz / AI video script / admin description for video and PDF)
    S->>S: compile plan per slide (strong model), generate media + descriptions, validate, sanitize
    S->>C: write teaching_plan / teaching_topic / teaching_concept / teaching_media
    S-->>A: SSE progress per slide; course page shows "ready for teaching"
```

Live (extends the learner voice-call socket shipped on 2026-09-03):

```mermaid
sequenceDiagram
    participant L as Learner browser
    participant S as ai_service (tutor socket)
    participant C as admin_core
    L->>S: WS auth + start {package_session_id, slide_id?}
    S->>C: load plan for slide, learner state, last summary
    S-->>L: state + board ops + greeting audio (resume or greet)
    loop per concept
        S-->>L: teach (board ops + say + audio)
        S-->>L: check (question)
        L->>S: answer (audio or text)
        S->>S: decision turn (LLM): score, remediate | advance, board ops
        S-->>L: board ops + say + audio + state
        S->>C: concept attempt + learner state
    end
    S->>C: slide done → learner_operation writes (existing keys)
    S-->>L: slide_done; browser resolves next slide through the existing drip and order rules
```

---

## 4. Creation time: the compile pipeline

### 4.1 Trigger and hook

- The copilot prompt page gets a **"Personalized teaching" toggle** (default on for new courses
  when the institute has the feature enabled). The choice is saved on the package as a course
  setting key (see §5.4).
- After the copilot has persisted all slides (the last step of the generating route), the
  browser calls `POST /ai-service/tutor/v1/compile` with the package id and the slide ids it just
  created. The call streams SSE progress (`PLAN_READY`, `PLAN_ERROR`, `INFO`) with the same
  transport conventions as content generation, including the 15 s keepalive.
- Compile failure never fails course creation. The course exists; the tutor entry shows
  "preparing" until every slide's plan is READY, and a "prepare for teaching" button on the
  course page retries the failed slides.
- Recompile is keyed on a content hash of the published slide body. A later slide edit marks the
  plan STALE; the same button recompiles only stale slides.

### 4.2 Inputs per slide type

| Slide type | Phase | Compiler input |
|---|---|---|
| DOCUMENT, type HTML (copilot documents) | 1 | published HTML body, slide title, chapter and course titles, KB chunks linked to the slide's node when the course is KB grounded |
| QUIZ (copilot quizzes) | 1 | question JSON; compiled into check-only concepts attached to a review topic |
| HTML_VIDEO with an AI-generated video | 1 | the video's script (shot list narration) plus the video as a media beat |
| VIDEO (YouTube, uploaded), DOCUMENT PDF | 1 | an admin-written description of what the video or file teaches (owner decision 2026-09-03); compiled into a **media task topic**: a watch-or-read beat that embeds the video or PDF on the board, then check concepts built from the description; the teacher marks the slide complete when it is satisfied |
| ASSIGNMENT, CODE, anything else | 2 | not compiled; the tutor hands over to the standard slide viewer and resumes after it |

Admin descriptions: the slide editor gets a "What this video / PDF teaches" field for VIDEO and
PDF slides, saved through `PUT /ai-service/tutor/v1/slides/{slide_id}/source-description` and
stored on the plan row (`source_description`). A video or PDF slide without a description sits
in plan status NEEDS_DETAILS; the course page lists those slides, and the course is "ready for
teaching" only when none remain. Until the description arrives the tutor falls back to the
ordinary slide viewer for that slide and resumes after it. The same fallback applies to slide
types the compiler does not handle at all.

### 4.3 Output: the teaching plan

```json
{
  "slide_id": "…", "version": 1, "content_hash": "sha256:…", "language": "en",
  "objectives": ["Define force as a push or pull", "…"],
  "key_terms": [{"term": "force", "meaning": "…"}],
  "topics": [
    {
      "id": "t1", "order": 1, "title": "What is a force?", "estimated_seconds": 240,
      "concepts": [
        {
          "id": "t1c1", "order": 1, "title": "Push and pull",
          "concept_tags": ["force.definition"],
          "prerequisites": [],
          "board_ops": [
            {"op": "heading", "id": "t1-h", "text": "What is Force?", "anim": "write"},
            {"op": "svg", "id": "t1c1-d1", "svg": "<svg …>", "description": "A ball being pushed to the right and a rope being pulled to the left", "parts": [{"id": "t1c1-d1-push", "label": "push"}, {"id": "t1c1-d1-pull", "label": "pull"}]},
            {"op": "bullet", "id": "t1c1-b1", "items": ["A push or a pull on an object"]}
          ],
          "board_html": "<materialized cumulative HTML for the teaching-off view>",
          "say": "A force is simply a push or a pull. Look at the ball on the board…",
          "say_i18n": {"hi": "Force ka matlab hai simple sa push ya pull. Board par ball ko dekho…"},
          "teach_notes": "Anchor on the two verbs. Use a bicycle and a football as examples. Do not introduce units yet.",
          "check": {
            "type": "open",
            "prompt": "If a football is lying still on the ground, what must you do to make it move?",
            "expected": "Apply a force: push or kick it",
            "rubric": "Full credit for push/pull/kick. Half for 'move it' without naming a force.",
            "misconceptions": [{"pattern": "says the ball moves on its own", "hint": "Ask what happens if nobody touches it."}],
            "pass_threshold": 0.7
          },
          "media": [{"media_id": "…", "kind": "svg", "description": "…"}]
        }
      ],
      "summary_ops": [{"op": "callout", "id": "t1-sum", "text": "Force = push or pull"}]
    }
  ]
}
```

Rules the compiler must obey (enforced by validation, not by trust) — in **two tiers**, since
2026-09-09. A rule is either *structural* (the runtime cannot serve the plan without it, so it is
fatal and the model must fix it) or *quality* (pedagogy: asked for once, then let go and recorded
on the plan as `quality_notes`). A structurally sound plan is never discarded for a quality
preference: that would leave the slide unteachable with the compile already paid for. Structural =
valid ops, unique ids, a check with an expected answer or rubric, non-empty `say`, `say_i18n`,
resolved media urls. Quality = the word budget, one heading per concept, one diagram per concept,
"the board shows something to look at" (a `formula` or a comparison `table` counts — a derivation
is visual), and the engagement rules (recap, example, predict, quick-check mix).


- Board fragments are small (quality). A concept adds at most one heading, one diagram or image,
  and about 40 words of text — formulas and diagram labels do not count toward the budget. A
  topic's cumulative board must fit one screen.
- Every concept has a `say` of 2 to 4 sentences and a `check`, except the first concept of a
  topic, which may have `check.type = "none"`.
- `say` is compiled in the course language and, in phase 1, also in the other supported
  language under `say_i18n`, so a learner's language override needs no live model call and
  stays cacheable. Board text stays in the course language.
- Every media op has a non-empty `description`; SVGs list their `parts` with ids.
- Concept and element ids are unique within the plan and follow `t{n}c{m}-…`.
- The number of topics and concepts is **unbounded**: it follows the material, not a count.

### 4.4 Board op vocabulary

Whitelisted ops, each with a stable `id` (or `target`) and an optional `anim` of
`write | fade | pop` and an optional `after` id for ordering:

| Op | Fields | Notes |
|---|---|---|
| heading | id, text, level | |
| text | id, text | short |
| bullet | id, items[] | |
| formula | id, latex | rendered with KaTeX in the learner app |
| svg | id, svg, description, parts[] | sanitized subset; parts are ids inside the svg |
| image | id, url or media_id, description, caption | |
| video | id, url or media_id, description, start, end, muted | stock clips, phase 2 |
| media_task | id, kind (video, pdf), url or file_id, description | embeds the slide's own video or PDF for a watch-or-read beat; phase 1 |
| table | id, rows[][] | |
| callout | id, text, kind | tip, warning, definition |
| annotate | id, target, text, position | teacher's side note next to an element |
| arrow | id, from, to, text | between two element ids |
| highlight | target, style | live only; reversible |
| unhighlight | target | |
| reveal | target | animation order only |
| clear | | topic boundary only |

Materialization: `board_html` for a concept is the render of all ops of its topic up to and
including that concept. The renderer is one shared TypeScript module used by the learner app
live and by the teaching-off view. The compile step runs the same renderer server side
(a small Python port, or Node in the compile worker) so stored HTML and live HTML never differ.

Student-specific ops emitted during a session (a highlight, an annotation written for one
learner) are session scoped and stored on the attempt row, never on the plan.

### 4.5 Media

- **SVG first** for anything structural: cells, circuits, force diagrams, graphs, timelines.
  Drawn by the compile model, sanitized, parts labelled. This is what makes "highlight the
  nucleus" possible.
- **Stock images** via the existing Unsplash keyword path in `image_service` for atmosphere.
- **AI images** via the existing OpenRouter image route when the compiler flags that a labelled,
  specific picture is needed and nothing else fits. Cost is recorded per media row.
- **Video** beats in phase 2: a muted short clip (stock via a Pexels style API, or a clip from
  the chapter's AI video). The description is written from the clip's script or search intent.
- Every media row stores `description` and `parts_json`. Both are passed to the live model as
  text, so the model can say "see the arrow on the left" and highlight it.
- Media files are uploaded through the existing media path so URLs are ours.

### 4.6 Compile prompt contract

One call per slide on a strong model, returning the plan JSON. The prompt blocks, in order:

1. Role and the hard rules from §4.3 (small boards, unbounded count, ids, descriptions).
2. Course context: course and chapter titles, objectives from the outline, the institute's AI
   course prompt if set, language.
3. The slide body (HTML stripped to text plus preserved lists, tables, formulas, images with alt).
4. KB material when grounded: the chunks linked to the slide's node, with the STRICT or BLENDED
   rule the course was created with.
5. The op vocabulary with one example per op.
6. Output schema, with a repair instruction: if the output does not validate, a second call
   receives the validation errors and the partial output and returns a fixed plan. Two repairs
   at most, then FAILED.

Validation is code: JSON schema, id uniqueness, board size limits, sanitizer pass over every
svg and text field, media descriptions present. Quiz slides skip the model entirely and are
compiled deterministically from the question JSON.

### 4.7 Versioning

`teaching_plan(slide_id, version)` with `content_hash` of the published slide body. States:
NEEDS_DETAILS, COMPILING, READY, FAILED, STALE, DELETED. A slide edit marks the current READY plan STALE
through a small admin_core hook on slide publish (a single status update, no other coupling).
When a learner resumes on a newer plan version, the pointer is remapped by topic and concept
order; mastery is keyed by concept tag so it survives.

### 4.8 Model choice and billing

- Compile: through OpenRouter, default `google/gemini-2.5-flash` (platform setting
  `tutor.compile.model`; institute keys still win). Pro was the plan, but a single failed Pro
  compile billed 35 credits under the platform's token pricing on 2026-09-03; the validator and
  repair loop carry the quality until the economics change.
- Live decision turns: a flash-class model (the chatbot's current default).
- Billing keys, added the same way as the copilot's keys (Python `DEFAULT_TOOL_PRICING`, the
  `ai_tool_pricing` seed, and the FE `computeToolCredits`; all three must change together):
  `tutor_compile_slide` (flat 2, `max(flat, actual)`, request type `content`),
  `tutor_media_image` (flat 1 per generated image, request type `image`), and a per-minute
  live meter `tutor_live_minute` modelled on `ai_call_out`. Existing request types are reused
  on purpose so the `ai_token_usage` CHECK never needs rewriting for this feature. Rates and caps are
  deferred by owner decision, but the meter itself is built from day one so the cost is visible.
- Idempotency: `tutor_compile:{plan_id}` and `tutor_live:{tutor_session_id}:{minute}` through
  `credit_transactions.external_reference_id`, as today.

### 4.9 Persistence ownership

ai_service writes the plan tables directly, as it does for the knowledge-base tables, which
also live in the admin_core database. admin_core reads them only for the admin preview and the
teaching-off view. Flyway migrations for the new tables live in admin_core as usual.

---

## 5. Data model

Next migration number: V494 at the time of writing. Before pushing, list the whole migration
directory, sort numerically, check for duplicates, and re-check origin/main (see the V200
collision note in memory).

### 5.1 Plan tables

```sql
CREATE TABLE teaching_plan (
    id VARCHAR(255) PRIMARY KEY,
    slide_id VARCHAR(255) NOT NULL,
    institute_id VARCHAR(255) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    content_hash VARCHAR(80) NOT NULL,
    language VARCHAR(20) NOT NULL DEFAULT 'en',
    status VARCHAR(20) NOT NULL,             -- NEEDS_DETAILS | COMPILING | READY | FAILED | STALE | DELETED
    source_description TEXT,                 -- admin-written "what this video / PDF teaches" for VIDEO and PDF slides
    model VARCHAR(120),
    objectives_json JSONB,
    key_terms_json JSONB,
    raw_plan_json JSONB,                     -- compiler output kept for debugging and repair
    error TEXT,
    created_by_user_id VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (slide_id, version)
);
CREATE INDEX idx_teaching_plan_slide_status ON teaching_plan(slide_id, status);

CREATE TABLE teaching_topic (
    id VARCHAR(255) PRIMARY KEY,
    plan_id VARCHAR(255) NOT NULL REFERENCES teaching_plan(id) ON DELETE CASCADE,
    slide_id VARCHAR(255) NOT NULL,
    topic_order INT NOT NULL,
    title TEXT NOT NULL,
    estimated_seconds INT,
    summary_ops_json JSONB,
    summary_html TEXT
);
CREATE INDEX idx_teaching_topic_plan ON teaching_topic(plan_id, topic_order);

CREATE TABLE teaching_concept (
    id VARCHAR(255) PRIMARY KEY,
    topic_id VARCHAR(255) NOT NULL REFERENCES teaching_topic(id) ON DELETE CASCADE,
    plan_id VARCHAR(255) NOT NULL,
    concept_order INT NOT NULL,
    title TEXT NOT NULL,
    concept_tags TEXT[] NOT NULL DEFAULT '{}',
    prerequisites_json JSONB,
    board_ops_json JSONB NOT NULL,
    board_html TEXT NOT NULL,
    say TEXT NOT NULL,
    say_i18n_json JSONB,                     -- {lang: say} for the other supported languages
    teach_notes TEXT,
    check_json JSONB
);
CREATE INDEX idx_teaching_concept_topic ON teaching_concept(topic_id, concept_order);

CREATE TABLE teaching_media (
    id VARCHAR(255) PRIMARY KEY,
    plan_id VARCHAR(255) NOT NULL REFERENCES teaching_plan(id) ON DELETE CASCADE,
    concept_id VARCHAR(255),
    kind VARCHAR(20) NOT NULL,               -- svg | image | video
    source VARCHAR(20) NOT NULL,             -- SVG | STOCK | AI_IMAGE | AI_VIDEO
    file_id VARCHAR(255),
    url TEXT,
    description TEXT NOT NULL,
    parts_json JSONB,
    cost_credits NUMERIC(10,3) DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Normalized topic and concept rows are the source of truth, because admins will edit concepts
(through AI, per owner) and analytics will aggregate attempts per concept. `raw_plan_json` is
kept only for debugging.

### 5.2 Learner tables

```sql
CREATE TABLE tutor_learner_state (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    institute_id VARCHAR(255) NOT NULL,
    current_slide_id VARCHAR(255),
    current_topic_id VARCHAR(255),
    current_concept_id VARCHAR(255),
    mastery_json JSONB NOT NULL DEFAULT '{}',        -- {concept_tag: {score, attempts, last_at}}
    misconceptions_json JSONB NOT NULL DEFAULT '[]', -- [{tag, note, seen_at}]
    weak_concepts_json JSONB NOT NULL DEFAULT '[]',  -- concept ids flagged WEAK, for chapter review
    rolling_summary TEXT,                            -- 150 to 250 words, rewritten at session end
    preferred_language VARCHAR(20),
    pace VARCHAR(10),                                -- slow | normal | fast
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, package_session_id)
);

CREATE TABLE tutor_session (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    institute_id VARCHAR(255) NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    chat_session_id VARCHAR(255),                    -- transcript lives in chat_sessions/chat_messages, context_type 'tutor'
    mode VARCHAR(10) NOT NULL,                       -- VOICE | TEXT
    tts_provider VARCHAR(20), tts_voice VARCHAR(80), language VARCHAR(20),
    started_slide_id VARCHAR(255),
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    minutes_billed INT NOT NULL DEFAULT 0,
    summary_json JSONB
);
CREATE INDEX idx_tutor_session_user ON tutor_session(user_id, started_at DESC);

CREATE TABLE tutor_concept_attempt (
    id VARCHAR(255) PRIMARY KEY,
    tutor_session_id VARCHAR(255) NOT NULL REFERENCES tutor_session(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    concept_id VARCHAR(255) NOT NULL,
    attempt_no INT NOT NULL,
    student_answer TEXT,
    score NUMERIC(4,3),
    misconception TEXT,
    action_taken VARCHAR(20),                        -- advance | remediate | advance_weak | skipped
    session_ops_json JSONB,                          -- student-specific board ops made in this attempt
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tutor_attempt_concept ON tutor_concept_attempt(concept_id, created_at DESC);
```

Transcripts reuse `chat_sessions` and `chat_messages` with a new `context_type` value `tutor`
and `context_meta` carrying package session, slide, topic, and concept ids. That keeps the
existing chatbot analysis screens able to list tutor conversations.

### 5.3 Institute and package settings (owner decision 2026-09-03)

Two levels, one shape, resolved as package overrides → institute defaults → platform defaults.

- **Institute defaults**: a new institute setting key `TUTOR_MODE_SETTING`, saved through the
  generic `POST /admin-core-service/institute/setting/v1/save-setting`, edited on the Settings →
  Course settings page as a "Tutor Mode defaults" card (the page that already holds the
  institute's course defaults; assumption: this is what the owner called "LMS settings").
- **Per-course settings**: the same key inside the per-package `course_setting` envelope,
  saved through `POST /admin-core-service/package/setting/v1/save-setting`, edited in a new
  **Tutor Mode** tab on the admin course page (beside Outline, Content Structure, Learner…) that
  also shows compile status per slide, the NEEDS_DETAILS list, "Prepare for teaching", and the
  plan preview.

Fields at both levels (any field absent at the package level falls through to the institute):

```json
{
  "enabled": true,
  "defaultOn": true,
  "teacherName": "Asha",
  "ttsProvider": "sarvam",
  "ttsVoice": "anushka",
  "languages": ["en", "hi"],
  "sessionLanguage": "course",
  "llmModel": "",
  "compileModel": "",
  "strictness": "normal",
  "generateImages": true,
  "kbGrounding": { "knowledge_base_id": "…", "mode": "STRICT" }
}
```

Shipped defaults differ from the first draft of this section: the runtime speaks with **Sarvam**
until Smallest.ai lands in the browser path (WP7; the admin UI lists it as "coming soon"), the
compile model defaults to the platform setting `tutor.compile.model` (**Gemini 2.5 Flash**, see
§4.8), and empty strings mean "inherit" (institute → platform). `kbGrounding` is written by the
copilot at creation so recompiles from the course page stay grounded; the compile router resolves
`compileModel`, `teacherName`, `generateImages` and `kbGrounding` from these settings whenever the
request leaves them at their defaults.

The learner app reads the resolved package value to decide whether to show the tutor entry and
whether teaching mode starts on. ai_service reads the same resolved value at compile time
(teacher name, compile model, languages) and at session start (voice, live model, language).

---

## 6. Live runtime

### 6.1 Entry and modes

- The learner opens a tutor-enabled course. The course page shows "Learn with your teacher"
  and, when `defaultOn` is set, opening a chapter goes straight into tutor mode at the learner's
  saved pointer. A switch turns teaching off; the same page then shows the **board deck**: each
  topic's final board and each concept's `say` as captions. That view costs nothing at runtime.
- Voice and text are one session. The mic is optional; the learner can type an answer or a
  doubt at any time. A session without microphone permission runs in TEXT mode and still plays
  the teacher's audio.

### 6.2 Transport

A new socket `/ai-service/tutor/ws/{tutor_session_id}` built on the learner voice-call socket's
message set. Reused as is: `auth`, `config`, `audio_chunk`, `audio_end`, `audio_discard`,
`interrupt`, `end_session`, `ping`; server side `ready`, `transcript_partial`,
`transcript_final`, `ai_text`, `audio_chunk`, `audio_segment_end`, `audio_end`, `summary`,
`error`. The voice-call code is reused by import; it is not modified.

Additions, client to server:

| Message | Fields | Purpose |
|---|---|---|
| start | package_session_id, slide_id (optional), mode | begin or resume |
| answer | text or option_id | text-mode answer to a check |
| control | intent: repeat, skip, slower, faster, doubt, pause, resume, done | recognized commands (also detected from speech); done ends a watch-or-read beat |
| next_slide | slide_id | the browser chose the next slide after the drip and order rules |

Additions, server to client:

| Message | Fields | Purpose |
|---|---|---|
| state | slide_id, topic_id, concept_id, phase, topic_progress, slide_progress | drives the sidebar and the step dots |
| board | ops[], topic_id, concept_id | apply ops; `clear` on a topic boundary |
| check | concept_id, type, prompt, options[] | show the question on the board and arm the mic |
| slide_done | slide_id, weak_concepts[] | the browser resolves the next slide |
| billing | minutes | keeps the learner-facing timer honest |

Authentication is required on this socket from the first message. The voice socket's
`VOICE_REQUIRE_AUTH` flag does not apply here.

### 6.3 State machine

```
START ─► RESUME_OR_GREET ─► TEACH(concept) ─► CHECK(concept) ─► EVALUATE
                                  ▲                                 │
                                  │      ┌──────── remediate ◄──────┤ score < threshold, loops < 2
                                  │      ▼                          │
                                  └── TEACH(hint) ─► CHECK          │ score ≥ threshold, or loops = 2 (WEAK)
                                                                    ▼
                                                     ADVANCE ─► next concept | TOPIC_SUMMARY ─► next topic | SLIDE_DONE
DOUBT can be raised from any state; it runs an ANSWER_DOUBT turn and returns to the state it interrupted.
MEDIA_TASK (video and PDF slides): TEACH says "watch this" or "read this" and the board embeds it; the learner
says done or playback ends ─► CHECK built from the admin description ─► EVALUATE as usual. The slide is marked
complete only when the teacher ADVANCEs past that check.
```

Phases visible to the learner: teaching, question, listening, thinking, summary.

### 6.4 The decision turn

TEACH of a concept makes no model call (owner decision 2026-09-03): the compiled `say` is
spoken, with the learner's name substituted, and the compiled ops are applied. The model is
called only for EVALUATE, remediate, topic and chapter summaries, and doubts. Narration
adaptation (a TEACH turn that rewrites `say` for the learner) stays behind a per-package flag,
off by default, and returns the same decision shape with `action = "teach"`.

Every model call returns exactly this JSON and nothing else:

```json
{
  "action": "teach | ask | remediate | advance | answer_doubt | wait",
  "say": "spoken text in the session language, 1 to 4 sentences",
  "board_ops": [{"op": "highlight", "target": "t1c1-d1-push"}, {"op": "annotate", "id": "s-1", "target": "t1c1-b1", "text": "like kicking the ball"}],
  "assessment": {"concept_id": "t1c1", "score": 0.4, "misconception": "thinks the ball moves by itself", "evidence": "student said it will roll"},
  "learner_state_delta": {"mastery": {"force.definition": 0.4}, "note": "confuses motion with force"},
  "next": {"topic_id": "t1", "concept_id": "t1c2"}
}
```

Validation: schema check, ops whitelisted, targets must exist on the current board, `say`
length capped, `next` must be a legal transition. An invalid decision is retried once with the
errors; a second failure falls back to the compiled `say` and the deterministic next step, so a
model outage degrades to playback, never to a stuck session.

### 6.5 Prompt assembly and budget

| Block | Content | Budget |
|---|---|---|
| System | teacher persona, language rule, the decision schema, the mastery policy, the op vocabulary | ~800 tokens |
| Learner state | name, pace, mastery of the tags in this slide, misconceptions, rolling summary | ≤ 600 |
| Script window | slide objectives, current concept in full (ops as text, media descriptions, say, teach notes, check), previous two concepts' titles and say, next concept title | ≤ 1,500 |
| Source material | KB chunks linked to this slide's node, only on remediate and answer_doubt turns | ≤ 1,500 |
| Transcript | last six turns of this session | ≤ 800 |

About 5k tokens per decision turn, which is why a flash-class model is enough live.

### 6.6 Mastery policy

- Score ≥ `pass_threshold` clears the concept. Mastery per tag is an exponential moving average.
- Below threshold: remediate with the matching misconception hint, at most two loops, then
  advance with the concept flagged WEAK. A learner is never trapped.
- Topic summary turn revisits the WEAK concepts of that topic with one fresh question each.
- Chapter end revisits up to three weakest concepts across the chapter.
- The rolling summary is rewritten at session end from the attempts, the same way the chatbot's
  context window service summarizes, and is the first thing the next session reads.

### 6.7 Pacing intents

Confirmed by owner on 2026-09-03; all deterministic and free of model calls:
`repeat` replays the current concept, `skip` advances with the concept marked skipped,
`slower` and `faster` change TTS pace and the learner's `pace`, `doubt` opens a doubt turn,
`pause` and `resume` stop and restart audio, and `done` ends a watch-or-read beat on a media
task. Spoken forms are matched by a short phrase list per language before the transcript ever
reaches the model.

### 6.8 Board rendering and animation

The learner app renders ops into the whiteboard with the handwritten style of the reference
screenshot: grid paper, marker font, elements appearing with `write`, `fade`, or `pop`.
Reveal is synced to `audio_segment_end`: the server tags each op with the sentence index of
`say` it belongs to, and the client reveals the op when that segment finishes. In text mode
ops reveal on a fixed cadence. Highlights pulse and are cleared on the next `unhighlight` or
concept change. Formulas render with KaTeX; SVGs are inlined so parts are addressable.

### 6.9 Resume

`tutor_learner_state` holds the pointer. `start` without a slide id resumes there. The greeting
turn is the only place the rolling summary is spoken back in one or two sentences, so a returning
learner hears where they left off and what was weak.

---

## 7. Progress, tracking, and "next"

Split of responsibility, chosen so drip logic stays single sourced:

- **The server owns progression inside a slide** (concepts and topics).
- **The browser owns progression between slides**, using the existing chapter sidebar and drip
  condition stores, which already know batch chapter order, slide order, and locked content.
  On `slide_done` the client picks the next unlocked slide and sends `next_slide`.

Tracking writes, all through the existing learner tracking endpoints used by the slide viewer,
so roll-ups and certificates are untouched:

- On slide done: `PERCENTAGE_DOCUMENT_COMPLETED = 100` for document slides (and the matching
  key for quiz and video slides), plus `LAST_SLIDE_VIEWED`. For video and PDF slides taught as
  media tasks the write happens only when the teacher advances past the description-based
  check, never on playback end alone (owner: mark complete when the tutor is satisfied).
- An `activity_log` row per tutor session per slide with a new `source_type` value `TUTOR`,
  `engaged_ms` from the socket, and the attempts in `processed_json`. Existing reports filter on
  known source types, so the new value is additive and invisible to them until wired.
- The regular chapter, module, subject, and batch percentages then update through the existing
  server-side roll-up.

---

## 8. Voice: TTS, STT, languages

- **TTS default: Smallest.ai — target, not yet shipped.** Until WP7 lands the browser path speaks
  with Sarvam (bulbul v3, voice `anushka`); the admin cards default to Sarvam and list Smallest.ai
  as coming soon so a saved setting never silently means something else. Today Smallest exists
  only in the phone bot (`voice_bot_service/app/providers.py`, `_build_smallest`, and the
  `_smallest_tts_wav` helper in its main module). The browser voice path switches only between
  Sarvam, Google, and Edge in `ai_service/app/services/voice_tts.py`; add a `smallest` engine
  there using the same websocket. Before relying on it: confirm the cloning API and consent
  flow, confirm the `SMALLEST_API_KEY` reaches the ai_service pods (as of early August it lived
  on the Mumbai box and the GitHub secret was not set), and audition Hindi at 24 kHz on the
  browser leg.
- **STT: Sarvam**, through the existing transcode, RIFF repair, and 29 s chunking helpers.
- **Languages: Hindi and English** in phase 1. Boards are compiled in the course language and
  the session speaks the course language by default. A learner may override the session
  language; because `say` is compiled in both phase-1 languages, the override switches to the
  other compiled narration with no live model call and the TTS cache still applies (owner
  decision 2026-09-03).
- **TTS cache from day one**: key `(provider, voice, language, pace, sha256(text))`. Shipped as
  an in-process LRU (300 entries) in `routers/tutor_ws.py`; it empties on every ai_service
  restart. Moving it under the media path is still open. Compiled `say` text is identical across
  learners, so even the in-process cache pays off within one deploy.
- **Pace**: "slower" / "faster" change the TTS speed (Sarvam `pace`, Edge `rate`; Google Chirp3-HD
  rejects a rate field, so it is ignored there) and are remembered per learner.
- Voice cloning later: institute uploads a teacher sample, we register a voice with the
  provider, store the voice id on the package setting, and re-render the cache lazily.

---

## 9. Side finding: knowledge-base courses are wrongly bounded by counts

Observed on 2026-09-03 while tracing the copilot:

- The KB grounding card computes a suggested structure: chapters = number of chosen topics,
  slides per chapter = average subtopics. The prompt page copies those into the chapter count
  and slides-per-chapter fields (`KbGroundingCard.onStructureSuggested` → `index.lazy.tsx`).
- The generating route then sends `generation_options.num_chapters` and
  `num_slides = chapters × slides per chapter` (`generating/index.tsx` and
  `utils/buildApiPayload.ts`).
- `prompt_builder.py` turns those into "EXACTLY N slides" and "EXACTLY N chapters".
- Only REPLICATE + FULL escapes this, because `_deterministic_outline_from_kb` builds the
  outline from the topic tree and ignores the counts. ADAPT or HIGHLIGHTS fight the material
  with a hard count, which matches the "lot of issues" reported.
- A second bound sits in the content phase: every document slide targets roughly 300 to 600
  words regardless of how much source material its section has, so a large section is squeezed.

Recommended fix, independent of the tutor work:

1. When `kb_grounding` is present, the browser omits `num_chapters` and `num_slides`, and the
   server ignores them if sent. The KB decides the shape.
2. In the deterministic path, split a subtopic whose linked chunk budget exceeds a threshold
   into "Part 1, Part 2" slides by page span, so coverage stays complete without squeezing.
3. Keep the count controls for prompt-only courses, where they are the only signal.

The teaching plan compile is unbounded per slide by design, so learners in tutor mode get the
full depth of each slide's material regardless of how the outline was bounded.

---

## 10. Non-breaking guarantees

- No ALTER on any existing table. New tables only, plus one additive `source_type` value.
- Slide viewer, tracking, roll-ups, certificates, copy-content, and enrollment untouched.
- Tutor mode is gated by the institute setting, the package setting, and READY plans; without
  all three the learner app renders exactly what it renders today.
- The copilot's outline and content calls are unchanged; compile is a new call after persist,
  and its failure does not affect the created course.
- The voice-call socket and chatbot are reused by import and not modified; the tutor socket is
  a new router.
- Chat analysis screens keep working because transcripts reuse `chat_sessions` with a new
  context type.
- The learner app's typecheck baseline (706 errors) and the admin build must stay where they
  are; new code is typed cleanly.

---

## 11. Security

- Tutor socket requires a valid learner token on the first message and checks that the tutor
  session belongs to that user and institute. Compile endpoint uses `get_pinned_principal` like
  the KB routes; the copilot's unauthenticated outline and content endpoints are not the model
  to follow here.
- Plan HTML and SVG are sanitized at compile time with an allowlist (no script, no event
  attributes, no external references except our media URLs), and the learner app renders them
  through the same sanitizer before `innerHTML`.
- The live model can only emit ops; ops are validated against the whitelist and against the
  current board's ids. No raw HTML reaches the DOM from a live turn.
- One active tutor session per user; a hard session cap (90 minutes) and an idle timeout
  (5 minutes without audio or text) end the session and write the summary.
- Cost telemetry per session (model tokens, TTS characters, STT seconds) is recorded on
  `tutor_session.summary_json` even while rates are undecided.

---

## 12. Cost model and defaults

Order-of-magnitude figures from the discussion; verify Sarvam STT and current OpenRouter rates
before quoting to a customer.

| Item | Estimate |
|---|---|
| Compile, one slide, strong model, no media | ₹1 to ₹4 |
| Compile, one AI image | ₹3 to ₹4 |
| Compile, 40-slide course with SVG-first media | under ₹200 |
| Live TTS, uncached, Google Chirp3-HD reference | about ₹2 per learner-minute |
| Live TTS with cached compiled narration | ₹0.5 to ₹1 per learner-minute |
| STT, Sarvam, learner speech only | about ₹0.5 per spoken minute |
| Live LLM, flash-class, 3 to 4 decision turns per minute | under ₹1 per learner-minute |
| All-in live, cached narration | ₹2 to ₹3 per learner-minute |
| 100 learners × 30 min × 22 days | ₹1.3 to ₹2 lakh per month |

Phase 1 defaults chosen so later optimization is a switch, not a rewrite: narration adaptation
off (compiled narration is played; owner decision 2026-09-03), TTS cache on, strong model for
compile, flash model live, SVG-first media, AI images allowed, stock video beats off until
phase 2, media tasks on for video and PDF slides.

---

## 13. Phase plan

**Phase 0, spike.** Compile one existing copilot slide into a plan with the real prompt and
validator; render its boards in a throwaway page with the animation and highlight ops; play the
compiled narration through Smallest from the browser path. Goal: prove the board contract and
the voice quality before any schema lands.

**Phase 1, ship.**
- Migrations V494+ for §5, ai_service ORM models, the compile router with SSE, the plan
  validator and sanitizer, the deterministic quiz compiler, the media-task compiler for video
  and PDF slides from admin descriptions, media generation with descriptions.
- Copilot: teaching toggle on the prompt page, compile call after persist, "preparing / ready"
  state and a retry button on the course page.
- Learner app: tutor route and whiteboard renderer, sidebar with topics and step dots, the
  tutor socket client on top of the voice hooks, text answers, pacing intents, board deck for
  teaching off.
- ai_service: tutor socket, state machine, decision turn with validation and fallback, learner
  state, attempts, summaries, tracking writes, session meter, TTS cache, Smallest engine.
- Admin: institute setting block, package setting key, read-only plan preview per slide, the
  "what this video / PDF teaches" field on VIDEO and PDF slides with the NEEDS_DETAILS list on
  the course page.

**Phase 2.** Stock video beats; assignment and code slides; concept editing through AI on the
admin preview; concept heatmap analytics per batch; the narration adaptation flag for
institutes that want it; the KB count fix from §9 if not done earlier.

**Phase 3.** Voice cloning per institute teacher; more languages in the compiled narration set;
cost controls and rates once usage data exists.

---

## 14. Decisions

Resolved with the owner on 2026-09-03:

1. **Session language.** Course language by default; the learner may override per session.
   Narration is compiled in both phase-1 languages, so an override costs no live model call.
2. **Narration adaptation.** Off in phase 1. Compiled narration is played; the model is called
   only for checks, remediation, summaries, and doubts. Adaptation stays behind a package flag.
3. **Video and PDF slides.** Admins add a description. The teacher asks the learner to watch or
   read inside the session, checks against the description, and marks the slide complete when
   satisfied. Slides without a description fall back to the slide viewer.
4. **Pacing intents.** repeat, skip, slower, faster, doubt, pause, resume, plus done for media
   tasks.
5. **Concept editing.** Through AI only, phase 2.

Still open:

- **Rates and caps.** Deferred by owner. The meter and telemetry are built regardless.

---

## 15. File index

Reuse and extend (read these first):

- `ai_service/app/routers/voice_agent.py`: socket message set to build on.
- `ai_service/app/services/voice_session_service.py`: opening turn, per-turn prompt build, summary.
- `ai_service/app/services/voice_tts.py`, `sarvam_service.py`, `audio_utils.py`: TTS switch, STT, transcode and chunking.
- `ai_service/app/services/context_window_service.py`: rolling summary pattern.
- `ai_service/app/services/image_service.py`: Unsplash keyword and AI image generation.
- `ai_service/app/services/kb/course_grounding.py`: chunks linked to a slide's node.
- `ai_service/app/services/course_outline_service.py`, `prompt_builder.py`, `content_prompts.py`: copilot outline and content contracts (and the count bound in §9).
- `ai_service/app/services/ai_billing.py`, `tool_cost_estimator.py`: parametric billing and idempotency.
- `ai_service/app/services/platform_settings_service.py`: platform model and TTS defaults.
- `ai_service/app/models/chat_session.py`: ORM pattern for tables in the admin_core database.
- `voice_bot_service/app/providers.py` (`_build_smallest`) and `voice_bot_service/app/main.py` (`_smallest_tts_wav`): Smallest client to port.
- `frontend-admin-dashboard/src/routes/study-library/ai-copilot/index.lazy.tsx`: prompt page (toggle; counts fed from the KB card).
- `frontend-admin-dashboard/src/routes/study-library/ai-copilot/course-outline/generating/index.tsx` and `utils/buildApiPayload.ts`: persist step (compile trigger) and count payload.
- `frontend-admin-dashboard/src/routes/study-library/ai-copilot/shared/components/KbGroundingCard.tsx`: structure suggestion.
- `frontend-learner-dashboard-app/src/routes/study-library/courses/course-details/subjects/modules/chapters/slides/index.tsx`: where the tutor entry attaches.
- `frontend-learner-dashboard-app/src/components/chatbot/VoiceModePanel.tsx`, `hooks/useVoiceWebSocket.ts`, `hooks/useVoiceRecorder.ts`: voice client to build on.
- `frontend-learner-dashboard-app/src/stores/study-library/drip-conditions-store.ts`, `chapter-sidebar-store.ts`, `utils/drip-conditions/parseDripCondition.ts`: next-slide resolution.
- `admin_core_service/.../features/course_settings/service/PackageSettingService.java`: package setting envelope.
- `admin_core_service/src/main/resources/db/migration/`: next number V494 at time of writing; verify before use.

---

## 13. Review 2026-09-04: what the code does, and what is still open

A seven-lens adversarial review (runtime socket, compiler, admin UI, learner UI, security,
billing, data/docs) ran over everything shipped since WP0. Fixed the same day, on main:

- **Tenancy.** A session teaches only slides that are visible members of its batch
  (`slide_in_package_session`); staff tokens are pinned to their institute for batch access; only
  `ACTIVE` enrolments (not pending / invited) can start sessions; `DRAFT` slides are never compiled
  or taught (`PUBLISHED` / `UNSYNC` only). Staff role names are normalised, so `CONTENT CREATOR`
  and `COURSE CREATOR` count as staff.
- **Socket.** The handler holds no pooled DB connection (every read/write is a short session);
  transitions are committed before the verdict is spoken, so a barge-in never leaves the pointer
  behind the database or grades "okay" as an answer; a second wrong answer is told to the model as
  the final attempt (no re-ask) and, if it re-asks anyway, the deterministic move-on line is spoken
  instead; questions asked during a topic summary or after slide-done are answered against the
  last concept taught; "continue / go on / chalo" continue, "pause" waits; resume replays the
  earlier concepts' board ops; idle is measured on real frames (pings do not count; 30 minutes
  while a media task is open); a per-session turn budget (20/minute, 400/session) bounds model
  spend; non-fatal errors carry `fatal: false` and `ended{reason}` closes idle / time-limit
  sessions; `lesson` follows `next_slide` with the new topics; later slides get a short "Now
  let's move on to …" instead of a second introduction; skips write an attempt row; learner state
  is reloaded after each attempt so later prompts see it.
- **Compiler.** Token counters, model id and generated images live on a per-slide run object
  (they were shared across the three concurrent slides, so slide B was billed A's tokens);
  images are billed only for a plan that was delivered; a `finish_reason == "length"` reply is
  never repaired into a partial plan (the repair round asks for a shorter one); post-media
  validation tolerates an image the system could not fill; a fallback to the institute's default
  model happens only on a provider rejection (400/404/422), never on a timeout; step 3 (store)
  failures mark the row FAILED and bill actual usage; compiles outlive the request that started
  them (closing the admin tab no longer cancels them); uploaded videos' file ids are `file_id`,
  not `url`; SVGs over 20,000 characters are rejected instead of truncated; `plan.language` is the
  requested language, not the model's echo.
- **Plans.** A `STALE` plan keeps serving learners until a READY successor exists (the publish
  hook flips READY→STALE in place, so this is what makes "the old plan keeps serving" true); a
  STALE plan whose content hash and description are unchanged is reinstated READY without a
  model call or a charge; the DELETED sweep runs only when the new version is READY; quiz and
  HTML-video edits go through the shared slide update path and mark plans STALE too.
- **Admin.** The copilot reads its own keys (`coursePersonalizedTeaching`, `courseLanguage`,
  `courseKbGrounding`) rather than the `courseConfig` the generating page deletes; respects the
  institute's `enabled` and `generateImages`; saves `kbGrounding` on the package; and shows compile
  failures. The Tutor Mode tab starts every field empty (institute defaults as placeholders),
  strips empties on save, shows "Institute default (…)" options, only lets live compile events
  override statuses while the stream is open, prefills the description editor, and blocks
  "Save and prepare" while a compile runs.
- **Learner.** Media tasks embed the video (YouTube / Vimeo / `<video>`) or the PDF (iframe, file
  ids resolved to signed urls); formulas are typeset with KaTeX; transient errors are a notice
  line, fatal ones the error card with "Try again"; connection loss and server-side endings show a
  banner with Reconnect (the server resumes from the saved pointer); the phase label follows the
  audio queue instead of the first `audio_end`; barge-in clears queued audio; highlights clear on
  the next concept; the sidebar's boards follow `next_slide`; a session opened during navigation
  is ended; the entry card is gated on availability alone.

Follow-ups shipped 2026-09-04 (owner QA round 1 and the next-batch request):

- **Audio.** Sarvam bulbul:v3 rejects the v2 speaker name; the tutor's default is now `priya`,
  unknown speakers fall back to it, and a failed Sarvam line retries with the default speaker.
- **Live metering.** Voice lessons are charged per started minute (`tutor_live_minute`, V496:
  3 credits/minute by default, edit the `ai_tool_pricing` row to change it; idempotency key
  `tutor_live:{session}:{minute}`). The first minute is charged when the socket opens, then one
  every 60 s; the REST start refuses a voice lesson with a 402 when the institute cannot afford
  five minutes, and a lesson whose institute runs dry mid-way is closed with `ended{reason:
  "credits"}` after the teacher says so. Text lessons stay per-turn (LLM only).
- **Quiz completion.** Quiz checks carry `question_id` / `option_ids`; `slide_done` carries
  `quiz_results` (answer, correctness, resolved option ids) and the learner app writes the same
  quiz activity log the quiz viewer writes, so quiz slides taught by the tutor complete and the
  tracking service re-grades them from the answer key. Availability / chapter slides now carry
  `module_id` / `subject_id` so completion writes land for every slide.
- **Resume after recompile.** `resolve_pointer` remaps a saved concept id through the old
  concept's title and position when the plan was recompiled.
- **Animated diagrams.** SVG parts take a `step`; the learner board draws strokes on, fades
  fills in, and reveals stepped parts one by one while the teacher speaks (shown at once when the
  narration ends). The compile prompt asks for steps on processes and build-ups.
- **Smallest.ai (WP7).** `smallest` engine in `voice_tts` (REST, lightning_v3.1, WAV 24 kHz,
  speed from pace), the platform default when `SMALLEST_API_KEY` is on ai-service (else Sarvam;
  a failing line falls back to Sarvam), and instant voice cloning: `POST /tutor/v1/voice/clone`
  (5-15 s sample, staff only) returns a Smallest voice id that Settings → Course settings saves
  as the institute's tutor voice. `GET /tutor/v1/voice/clones` lists them.
- **Layout.** The lesson page is viewport-tall with per-pane scrolling, folds the app sidebar,
  writes board elements in one at a time; answering by voice is an explicit "Tap to answer"
  button (no auto-listen), and the teacher's bubble fills sentence by sentence as she speaks.
- **Resume, per slide (V497).** `tutor_learner_state.progress_json` keeps one position per slide
  (topic, concept, phase, done) and `current_phase` the phase, so a session that ended on a topic
  summary or at slide-done resumes exactly there ("We had just finished X…" / "You already
  completed X…"), switching slides no longer loses the other slide's place, and a returning
  learner starting a new slide hears "Last time we worked on …". A compiled narration's own
  "Hi {name}, …" opener is dropped when the teacher greets, never the greeting.

- **Model choices in the super-admin portal (health.vacademy.io/ai-settings).** Platform settings
  `tutor.compile.model` (Gemini 2.5 Flash), `tutor.live.model` (blank = chatbot model),
  `tutor.image.model` (blank = platform image model), `tutor.voice.provider` (enum), and the new
  platform-wide `image.model` (default `qwen/qwen-image-3`) — each a dropdown over the
  `ai_models` registry filtered by category, validated server-side. The image service routes by
  model family: dedicated image models (Qwen, Seedream, FLUX) call OpenRouter's `/api/v1/images`
  (`data[0].b64_json`, PNG, 30-70 s), chat image models (Gemini, GPT) call chat completions with
  `modalities`. The page also edits `ai_model_defaults` (default / fallback per pipeline use case).

- **Batch 3 (2026-09-04).** Teacher insights (WP9): `GET /tutor/v1/packages/{id}/insights` and a
  card on the Tutor Mode tab — lessons, learners, minutes, the concepts learners get wrong most
  with the recorded misconceptions, and a per-learner table, filterable by batch and period.
  Phones: a compact teacher strip, the outline in a bottom sheet, board and chat splitting the
  screen. Admin preview plays boards (entrance, stroke-draw, stepped parts). Doubt and remediation
  turns carry passages from the course's knowledge base (`kb_source_block`, §6.5). Super-admin
  portal: Credits & pricing card editing `ai_tool_pricing` (tutor compile / image / live minute
  first), plus `tutor.live.preflight_minutes` and `tutor.live.max_minutes` as number settings.

Engagement build (2026-09-05, from the student-side review): the board writes itself with the
voice — every element op carries `say_index` and the socket sends sentence-level `segment_text`
frames with an index, so the learner app reveals elements and diagram steps as their sentence
plays and pulses the element being explained; a diagram quality gate (`svg_check.py`: viewBox,
label coordinates, font floor, overlaps, fills) with one repair round and an auto-layout
fallback built from the parts; soft engagement rules (`plan_validator.soft_errors`, one repair
round, never a failed plan): a recap bullet board + spoken `summary_say` per topic, an example
callout per topic, a `predict` question before the first concept of later topics, a third of
checks quick (mcq with 3 options / numeric), a `hint` per check, one-idea open questions; a
`columns` op, arrows drawn as lines, annotation positions honoured, Kalam loaded for the
handwriting face; verdict chips, "n of m so far" and a streak on the learner panel, a scorecard
at slide end; a 60-second nudge with the hint on a silent question before the idle exit; live
notes (one callout per remediation/doubt turn stays on the board; the right answer is written
when the teacher moves on); spoken rhythm rules, segments ≤200 chars, a beat before questions,
definitions slightly slower; predict-then-reveal turns (`run_predict`, never graded); and a
learner pace picker (slower / slow / medium / fast) persisted per learner. Learners can switch the
lesson language (English / हिंदी) from the panel; every SPOKEN line is compiled in both languages
(`say_i18n`, `summary_say_i18n`, `predict_i18n`, `check.prompt_i18n`, `check.hint_i18n`) and a
Hinglish check (`plan_validator.is_hinglish`, ≥15% Devanagari among letters) rejects English
passed off as Hindi; a line whose translation is missing falls back to a canned line in the
session language, never to the other language. Board text and MCQ options stay in the course
language. Teacher bubbles are tracked per turn so overlapping turns never merge.

Teacher avatar, premium (2026-09-07, owner picked Spatius over Simli): an animated likeness built
from the teacher's face photo (`POST /tutor/v1/avatar/create`, consent confirmed by the institute;
`GET /tutor/v1/avatar/jobs/{id}`; `services/spatius_service.py`, env `SPATIUS_API_KEY` /
`SPATIUS_APP_ID` / `SPATIUS_CONSOLE_HOST`). Setting `avatarProvider` + `avatarId` on the institute
or course. In a voice lesson the start response carries `avatar`, the learner app fetches a
session token (`POST /tutor/v1/sessions/{id}/avatar-token`), loads `@spatius/avatarkit` on demand,
renders the face on the device and feeds each spoken segment as 16 kHz PCM16 (`useSpatiusAvatar`,
AvatarKit plays the audio in sync); barge-in maps to `interrupt()`. Charged `tutor_avatar_minute`
(1 credit/min, vendor ≈ $0.0072/min) only while the device reports the avatar on (config frame
`avatar`); learners can hide it. Dark until the keys are set.

Still open (tracked, not silent):

- **Video and PDF slides now compile from their own words** (`services/tutor/source_text.py`):
  AI videos from the copilot's narration script (S3, free), YouTube videos from their caption
  track (free; parked with a reason when the video has no captions or YouTube blocks the
  datacenter IP), uploaded videos through Whisper on the render worker (`transcription` tool,
  per audio-minute, once per file — cached in `file_conversion`), PDFs from the PyMuPDF text
  layer (free; scanned PDFs are parked — no OCR). The plan keeps the media task first, then
  3–8 teaching concepts with checks drawn from the text. A description typed in the slide
  editor (`video.description`) now counts as details. `POST /tutor/v1/compile/estimate`
  prices a compile before it runs (compile + transcription minutes + image cap, from the
  estimator so portal overrides apply) and the admin confirms in a dialog; the 402 gate uses
  the same numbers. Uploaded lectures are transcribed through OpenRouter's audio endpoint
  (`openai/whisper-large-v3-turbo`, `services/openrouter_transcription.py`: ffmpeg extracts
  10-minute mono mp3 chunks, four in flight, joined in order; platform settings
  `tutor.transcription.provider` / `.model`; institute BYOK key else platform key; the render
  worker's resumable Whisper job is the fallback) — minutes for an 82-minute lecture; the
  institute pays the `transcription` tool per minute and the provider's USD cost is recorded
  in ai_token_usage. Scanned PDFs are read with MathPix OCR (`html_document_pdf`, per page,
  once per file) when the OCR switch is on. AI videos have no video file (an HTML animation),
  so they are taught from the script on the board like a document, without a media task.
  Verified 2026-09-04: YouTube refuses caption requests from the Hetzner nodes
  (`RequestBlocked`), so YouTube slides park with that reason until an egress proxy (the
  library supports Webshare/generic proxies) or a yt-dlp → Whisper path exists. Still open:
  that proxy, and AI-video slides whose script was never generated.
- **Weak-concept revisits** (§6.6) are per slide, not per chapter: a topic summary re-asks the
  weak concepts of that topic (fresh model-written question, one attempt, at most three), slide
  end re-asks up to three weakest weak-or-skipped concepts not yet revisited this session. A
  correct revisit clears the concept (`revisit_ok`); a wrong one keeps it weak (`revisit_weak`)
  and the teacher gives the answer and moves on. The revisit is never persisted: a session that
  ends mid-revisit resumes on the summary and revisits again. The rolling summary is rewritten
  by the model after every session (`runtime/summary.py`, background task on socket close):
  paragraph 1 is spoken in the next greeting, paragraph 2 feeds the decision prompt and the
  insights "note" column. Chapter-level revisits (across slides) remain open.
- **Stock images** (§4.5) do not exist; the compile prompt only offers generated images.
- **Fallback to the ordinary slide viewer** for non-teachable slides (§4.2) is not implemented:
  the sidebar skips them.
- Prepared voice (2026-09-07): every spoken line of a READY plan is synthesised once after the compile
  (`voice_cache.warm_plan`, charged `tutor_voice_prepare` per slide per language), stored as mp3 in S3 and
  indexed in `tutor_tts_cache`; the socket checks the in-process LRU, then this cache, then the vendor,
  and stores what it synthesises live. See COST_AND_CREDITS_REVIEW.md §6a.
- `teaching_media.cost_credits` / `file_id` are not populated for generated images.
- Teacher insights: `GET /tutor/v1/insights` (institute-wide, optional course / batch filter) and
  `GET /tutor/v1/insights/export.csv?sheet=learners|concepts|courses` (row caps 5000 / 2000 / 500);
  the admin card lives on Settings → Course settings (institute) and the course's Tutor Mode tab.

## 16. Teacher voices and avatars: the asset registry (7 September 2026)

**Problem.** Cloned voices were listed straight from the Smallest account with the platform key, so
every institute saw every other institute's clones, and any voice or avatar id could be pasted into
settings. Avatars had no stock gallery, no platform layer and a manual creation path.

**Registry.** `tutor_asset_registry` (created by ai_service at startup; `app/models/tutor_asset_registry.py`,
service `app/services/tutor/asset_registry.py`): one row per asset with `kind` (voice|avatar),
`provider`, `external_id` (vendor id), `display_name`, `institute_id` (NULL = platform stock),
`status` (requested → processing → ready | failed | disabled), consent, source photo, requester,
vendor job id, credits charged.

**Visibility.** `GET /tutor/v1/options` and `/assets` return platform stock plus the caller's own
rows only. `resolve_settings` drops an avatar that is not a ready visible row and a voice that is
registered to another institute (`_enforce_registry`).

**Flows.**
- Voice: `POST /tutor/v1/voice/clone` clones on Smallest, registers the row to the institute and
  charges `tutor_voice_clone` once.
- Avatar: `POST /tutor/v1/avatar/create` (photo file id + consent) registers a `requested` row. If
  the Spatius Open API is enabled it queues the vendor job and the row moves to `processing`; the
  admin card polls `GET /tutor/v1/avatar/assets/{id}` and the row becomes `ready` with the vendor
  id, charging `tutor_avatar_create`. Until the vendor enables the API, the request waits in the
  super-admin queue.
- Super admin (health portal → "Tutor Avatars & Voices", `/super-admin/v1/tutor-assets`):
  register stock avatars from app.spatius.ai/avatars/library (UUIDs) or institute-private assets,
  fulfil requests by pasting the Studio-built avatar id (charges the fee unless unticked), refuse
  with a reason, disable, delete.

**Admin UI.** `TeacherPresenceField`: photo upload, then "Photo only" (live minute) vs "Animated
avatar — Premium" (live + avatar minute, shown per learner-minute), a gallery of stock + own
avatars, and the request-my-avatar block with consent. Course tab can inherit the institute choice.

**Learner UI.** `TeacherPanel`: the avatar is a 4:3 card with the name, state and the stop / mute /
hide controls overlaid; language and pace are segmented dials that wrap; progress shows as "n/m right".

**Vendor notes.** AvatarKit fetches `/assets/avatar_core_wasm-<hash>.wasm`; the learner build copies
it from the package (`vite.config.ts`, copy-only — the SDK's own plugin overwrites `_headers`).
Spatius session tokens: `POST console.us-west.spatius.ai/v1/console/session-tokens`; avatars and
jobs: `console.spatius.ai/v1/open/...` with `X-App-ID` + `X-API-Key`; the account needs "Open API
access" enabled by Spatius before creation works (403 otherwise).

**Weak devices (23 October 2026).** `AvatarSDK.initialize` fetches a ~29 MB template on a first
visit (cached by the SDK afterwards) with no progress and no timeout, and the face is computed and
CPU-sorted (~70k splats) on the main thread 25 times a second; on WebGL it is also re-uploaded every
frame. So `useSpatiusAvatar` sizes the face to the device: a browser drawing in software
(`failIfMajorPerformanceCaveat`, SwiftShader / Basic Render Driver) gets no face; no WebGPU, ≤4
cores or ≤4 GB gets `high` quality and the compressed model; the rest `ultra`, drawn at 2× on
1x–1.5x screens (the canvas is sized from the card × devicePixelRatio, so a Windows laptop got a
quarter of a Retina Mac's pixels). Below 15 fps for 4 s it steps down a tier; past the last tier,
or with no frame for 3 s, it falls back to photo + speaker between lines. A load with no progress
for 60 s falls back the same way (the bar creeps through the silent init instead of sitting at
25%). Init starts at the course page's tap (`availability.avatar.app_id`), a hidden face stops
drawing, and each lesson's `summary_json.avatar_diag` records tier, renderer, GPU, timings and any
step-down or fallback.

