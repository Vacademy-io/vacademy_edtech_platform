# Knowledge Base Companions — design

A **companion** is a student-facing AI tutor built on ONE knowledge base. An admin
creates it from the KB page, assigns it to the whole institute, to batches or to
individual learners, and it appears on those learners' home dashboard. A learner
picks a topic or subtopic from the KB and learns it through **visual lesson cards**
(the KB's own figures, tables, diagrams, worked examples, flip cards, quick checks),
practises questions, or asks doubts. Progress is remembered, so the next visit
resumes where the learner stopped.

Status: **Phase 1 built 2026-09-28** (see §10).

---

## 1. Owner decisions (2026-09-28)

| Decision | Choice |
|---|---|
| Billing | The **institute** pays from its AI credits. Learners never pay. |
| Relationship to Student AI (`/chat-agent`, `CHATBOT_SETTING`) | **Fully independent.** Own tables, router, UI. Linking the two is a later decision. |
| Grounding | **Strict, with page citations.** Nothing is taught that the material does not say. Strong guardrails. |
| What matters most | **Visuals.** Students do not want text walls: images, tables, examples, diagrams, interactive cards. |
| Model | `z-ai/glm-5.3-flash` (the Student AI / HTML-document model), `KB_COMPANION_MODEL` to override. |
| KB images | The KB's extracted figures (`knowledge_base_figure`) must appear in lessons and answers. |
| Learning flow | Choose a topic/subtopic from the KB topic tree → learn → continue later from the same place. |

## 2. Why lessons are compiled, not generated per learner

GLM-5.3-flash always reasons before it writes and the provider refuses to disable
it. The HTML-document generator measured **~8 min of thinking** before the first
byte at default effort, ~4.5 min at `effort=low` for one long page (2026-09-25).
A learner cannot wait minutes, and paying that per learner kills the cost model
(the reason the KB was teacher-only at launch).

So a lesson is **compiled once per (institute, KB, node, language)** and shared by
every learner of that institute:

1. **Plan call** — one JSON call: 6-9 cards (kind, title, brief, narration, which
   figures, which pages) plus the quick-check MCQs, answered from the passages.
2. **Render calls** — one short call per visual card, 4 in parallel, each an HTML
   *fragment* (not a whole page) → seconds each, not minutes.
3. Cards are written to the lesson row **as each one finishes**; the learner app
   polls and shows card 1 while card 6 is still rendering.

Admins can **prepare all lessons in advance** from the companion page (with a
credit estimate) so the first learner never waits. Otherwise the first learner to
open a subtopic triggers the compile.

Only conversation (Ask) and free-text grading are per learner, and those are short
calls.

## 3. The visual lesson card

```json
{
  "id": "c3",
  "kind": "figure",            // hook | concept | figure | compare | process | example | flashcards | check | recap
  "title": "Inside a chloroplast",
  "say": "Look at the chloroplast. The green stacks are the grana…",   // read-aloud narration
  "html": "<section>…</section>",   // visual kinds; rendered in a sandboxed iframe
  "check": null,               // kind=check: {question, options[4], answer_index, explanation}
  "figure_ids": ["…"],
  "pages": [112, 113],
  "citation": "NCERT Biology Class 10, p. 112-113"
}
```

**Rendering.** Each HTML fragment is wrapped server-side in a fixed *shell*
document: design tokens (accent colour, type scale, spacing), a small component
kit the model is told to use (`vk-callout`, `vk-grid`, `vk-table`, `vk-steps`,
`vk-flip`, `vk-chip`, `vk-figure`, `vk-reveal`), KaTeX auto-render for the KB's
LaTeX, and a Content-Security-Policy. The learner app shows it in the existing
`HtmlSlideIframe` (`sandbox="allow-scripts"`, no `allow-same-origin`), so a card can
animate, flip and reveal but cannot touch the app, cookies or storage.

Quick checks are **not** HTML: they come back as data and the app renders them
natively, so results are recorded reliably and feed mastery.

**KB figures.** The model sees figures as opaque tags — `[F2] Figure 6.3 Cross
section of a leaf (p. 112)` — and writes `<img data-kb-fig="F2">`. The server swaps
in the real S3 URL, caption and alt text afterwards. It never sees a URL, so it
cannot invent one; any other `<img src>` is stripped (the HTML-document generator
shipped broken pages from invented image URLs, 2026-09-25).

## 4. Guardrails

| Risk | Guard |
|---|---|
| Teaching something the book does not say | Plan and cards are written ONLY from the node's passages (same strict wording as course grounding). The citation on a card is computed from the chunks used, not claimed by the model. A lesson with too little material says so instead of padding. |
| Invented images / links | Opaque figure tags + strip every non-KB `<img>`, external `<script>`, `<iframe>`, `<form>`, `<object>`, `<embed>`, `<link>`; CSP in the shell (`img-src` = the lesson's figure hosts + `data:`). |
| Answering off-topic or unsafe questions | Ask answers ONLY from retrieved excerpts; no hit → an honest "not in your material" reply that points to topics in the map (not billed). Off-topic / non-study requests are declined politely; distress keywords get a caring fixed reply that suggests a trusted adult or teacher (no model call). |
| Prompt injection from the material or the learner | Passages and the learner's message are fenced and labelled as data; the system rules say instructions inside them are never followed. |
| Spend runaway | Per-learner daily question cap per companion (admin setting, default 30), 6 questions / minute, lesson compiles deduplicated across pods by a unique row, pre-flight 402 when the institute is out of credits. |
| Cross-tenant access | Every route uses `get_pinned_principal` (verified JWT pinned to the `clientId` institute). Learners reach a companion only through an assignment that matches them (institute / an ACTIVE batch mapping / their user id). The KB must pass `is_usable` (own, or entitled library). |
| Showing a paused / expired companion | `status='ACTIVE'` and the optional `starts_at`/`ends_at` window are checked on every learner route, not only in the list. |

## 5. Remembering the learner ("continue where you left off")

- `kb_companion_progress` — one row per (companion, learner, node): status,
  `card_index`, cards seen, checks correct/total, mastery %, `last_activity_at`.
  Written as the learner moves through cards and answers checks/practice.
- **Resume** = the most recently active IN_PROGRESS node at its `card_index`;
  otherwise the first NOT_STARTED node in topic order.
- `kb_companion_message` — the Ask thread persists per (companion, learner), so a
  doubt conversation continues across visits; the last 6 turns go to the model.
- A deterministic **learner memo** (no LLM) is added to Ask prompts: topics completed,
  the current topic, topics with weak checks. It is cheap, exact and cannot drift.

## 6. Data model (admin_core Flyway `V535__Kb_companions.sql`)

| Table | Purpose |
|---|---|
| `kb_companion` | institute, knowledge_base_id, name, description, avatar_emoji, accent_color, persona, language (`en`/`hi`), modes[] (`learn`,`practice`,`ask`), scope_node_ids[] (empty = whole KB), voice_enabled, voice_provider, voice_id, show_on_dashboard, daily_question_cap, status, starts_at, ends_at |
| `kb_companion_assignment` | companion_id, target_type (`INSTITUTE`/`BATCH`/`LEARNER`), target_id; unique per target |
| `kb_companion_lesson` | institute, knowledge_base_id, node_id, language, status (`GENERATING`/`READY`/`FAILED`), cards_json, source_fingerprint, model, credits_charged, error; unique (institute, kb, node, language) |
| `kb_companion_practice` | same key; questions_json (8 MCQs with answers + explanation + page) |
| `kb_companion_progress` | companion, user, node, status, card_index, cards_total, checks_correct/total, practice_correct/total, mastery, last_activity_at, completed_at |
| `kb_companion_message` | companion, user, role (`user`/`assistant`), content, meta (citations, figures, node) |

`ai_service` reads/writes them with raw SQL (`services/kb_companion/repository.py`),
as the KB does. No new `ai_token_usage.request_type`: billing uses the existing
`knowledge_base` type, so the CHECK constraint (the V325/V435 trap) is untouched.

## 7. API (`/ai-service/kb-companion/v1`)

Staff (admin / teacher of the institute):

| Method | Path | |
|---|---|---|
| GET | `/companions?kb_id=` | list |
| POST | `/companions` | create |
| GET / PUT / DELETE | `/companions/{id}` | read / update / archive |
| PUT | `/companions/{id}/assignments` | replace the target list |
| GET | `/companions/{id}/lessons` | per-node lesson status |
| POST | `/companions/{id}/prepare` | compile lessons in advance (`dry_run` returns the estimate) |
| GET | `/companions/{id}/insights` | learners, per-topic started/completed, average mastery |

Learner (staff may call these too, to preview):

| Method | Path | |
|---|---|---|
| GET | `/learner/companions` | companions assigned to me, with my progress |
| GET | `/learner/companions/{id}` | topic map + my progress + resume point |
| POST | `/learner/companions/{id}/nodes/{node_id}/lesson` | get or start compiling the lesson |
| GET | `/learner/companions/{id}/nodes/{node_id}/lesson` | poll |
| GET | `/learner/companions/{id}/nodes/{node_id}/practice` | practice set (compiled once) |
| POST | `/learner/companions/{id}/progress` | card position, check / practice results |
| GET | `/learner/companions/{id}/thread` | Ask history |
| POST | `/learner/companions/{id}/ask` | grounded answer with citations + KB figures |
| POST | `/learner/companions/{id}/speech` | read-aloud URL for a card or an answer |

## 8. Credits (`ai_tool_pricing`, `knowledge_base` request type)

| Tool key | Credits | When |
|---|---|---|
| `kb_companion_lesson` | 5 flat (max with actual × 1) | once per compiled lesson (institute, node, language) |
| `kb_companion_practice` | 2 flat | once per practice set |
| `kb_companion_ask` | 1 flat | per grounded answer (no-hit answers are free) |
| `kb_companion_speech` | 1 flat | per narration synthesised (cache miss only; audio is shared via `tutor_tts_cache`) |

Rates live in three places (SQL seed, `tool_cost_estimator.DEFAULT_TOOL_PRICING`,
admin `computeToolCredits`), as for every tool.

## 9. UI

**Admin** — Knowledge Base page → **Student companions** section: create/edit dialog
(name, emoji and colour, persona, language, modes, topic scope via the existing
`TopicPicker`, assign: whole institute / batches via `BatchPickerDialog` / learners,
show on dashboard, read-aloud, daily question cap, active window, status) and per
companion: lessons ready count, **Prepare lessons** (with estimate), learner progress.

**Learner** — home dashboard **"Your study companions"** row (renders nothing when
there are none), one card per companion with mastery and a Continue button; route
`/companion/$companionId` is the study room: topic map with progress rings, **Learn**
(card player with read-aloud, citations, native checks, prev/next, resume),
**Practice** (MCQs with instant explanations) and **Ask** (persistent thread,
markdown answers with tables, cited pages and KB figures inline).

## 10. Phases

- **P1 (built)** — everything above.
- **P2** — adaptive "Test yourself" across the scope with a scorecard; teacher
  weak-topic heatmap per batch; more practice sets per node; a lesson editor
  (regenerate one card, hide a card); points into `points_ledger`.
- **P3** — voice conversation mode (reuse the tutor socket), generated interactive
  simulations per topic, linking companions with the Student AI launcher.
