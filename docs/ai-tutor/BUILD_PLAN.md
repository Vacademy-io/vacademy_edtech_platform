# Live AI Tutor — Build Plan

Companion to `LIVE_TUTOR_DESIGN.md` (the what). This is the how: work packages in build order,
files each one touches, how each is verified, and how it ships. Decisions from the owner on
2026-09-03: creation side first, then the tutor runtime; flagged increments on main verified on
a prod test institute; thin real slices, no throwaway spike; female default teacher voice
(name still to be given, placeholder **Asha**); the knowledge-base count fix goes first.

## 0. Ground rules for every package

- **Main only, dark by default.** Every slice lands behind the institute flag, the package
  setting, and plan status. Nothing changes for a course that has not opted in.
- **Batch ai_service pushes.** Each one takes the service down for about 3 minutes. Pair the
  ai_service commits of a package into one push, outside peak learner hours.
- **Docs commits do not deploy.** The workflows filter on `ai_service/**`,
  `admin_core_service/**`, `voice_bot_service/**`; the two dashboards deploy from Cloudflare
  Pages on push. So commit docs freely, code deliberately.
- **Commit locally as soon as a slice verifies.** Other sessions rebase this working tree.
  Stage explicitly, never `git add -A`.
- **Before any push**, in every repo: `git show HEAD:postcss.config.* | wc -c` must be under
  150 bytes (npm worm guard), and the Flyway directory is listed whole, sorted numerically,
  checked for duplicates, and re-checked against origin/main.
- **Verification commands that actually verify** (the sandbox has no pnpm or npx):
  - TypeScript: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  - ESLint per file: `node node_modules/eslint/bin/eslint.js <files>`
  - Design lint: `node ../scripts/design-lint.mjs <files>`
  - Java: `mvn -pl admin_core_service -am clean compile > out.txt 2>&1; echo EXIT $?` and
    the log must contain `Compiling NNNN source files`
  - Python: `python -m py_compile` on touched files, then `pytest tests/test_tutor_*.py`
- **Prod verification** is by probing, not by green tests: rows on the standby via the
  dev_analytics tunnel, live bundle hash for the dashboards, two blank polls before calling an
  ai_service deploy broken.

## 1. Prerequisites the owner supplies

| Item | Why | Status |
|---|---|---|
| Teacher name for the default female voice | appears in prompts, UI, and the compiled narration | placeholder "Asha" until given |
| An admin login in a non-client test institute with AI credits | course creation and compile are billed and visible; Shiksha Nation is a real client | received 2026-09-03 (kept in private notes, not in the repo); institute to be identified on first login |
| `SMALLEST_API_KEY` reaching the ai-service pods | verified 2026-09-03 with the prod kubeconfig: the secret exists and is on the voice-bot-service pods, but the ai-service deployment has only `OPENROUTER_API_KEY` and `SARVAM_API_KEY`; WP7 adds one line to the ai-service workflow's env block | no owner action; done in WP7 |
| Confirmation that Smallest voice cloning is on the account plan | phase 3 | later |

## 2. Build order at a glance

| # | Package | Repo(s) | Deploy | Rough size |
|---|---|---|---|---|
| WP0 | Knowledge-base count fix | admin FE, ai_service | 1 FE push, 1 ai_service push | 0.5 day |
| WP1 | Plan tables + pricing rows + request-type CHECK | admin_core | 1 admin_core push | 0.5 day |
| WP2 | Compiler: models, schema, board ops, validator, prompts, media, router | ai_service | 1 ai_service push (after WP1 is applied) | 3 to 4 days |
| WP3 | Admin creation flow: toggle, compile trigger, course status card, description field, plan preview, pricing | admin FE | 1 FE push | 2 to 3 days |
| WP4 | STALE hook on slide publish, institute setting block | admin_core, admin FE | with WP1 or WP3 | 0.5 day |
| — | **Creation milestone**: a course compiled and previewed in the test institute | | | end of week 2 |
| WP5 | Learner tables | admin_core | 1 admin_core push | 0.5 day |
| WP6 | Tutor socket, state machine, decision turn, learner state | ai_service | | 4 to 5 days |
| WP7 | Smallest engine in the browser TTS path + TTS cache + key plumbing | ai_service, devops | with WP6 | 1 day |
| WP8 | Learner app: tutor route, whiteboard renderer, socket client, text mode, intents, board deck | learner FE | 1 FE push | 5 to 6 days |
| WP9 | Institute and package settings UI, chat analysis context type | admin FE | | 1 day |
| WP10 | Prod verification: text session, then voice; cost readout | all | | 1 to 2 days |
| — | **Tutor milestone**: a learner is taught one compiled chapter end to end | | | end of week 5 |

## 3. Work packages, creation side

### WP0 — Knowledge-base courses stop being bounded by counts

**Status: shipped 2026-09-03** as 483725e541 and verified on production against the Spark
Education knowledge base "chapter_31_new" (3 topics, 8 sections, 35 chunks): REPLICATE+FULL
returned 3 chapters / 8 slides with node ids on every todo, and ADAPT+FULL returned 3 chapters /
11 slides, both while the request carried `num_chapters=1, num_slides=2`. No section in that
KB exceeds the split budget, so the part split is covered by unit tests only.

Why first: owner's complaint, small, independent, and it improves the slides the compiler will
read.

Files:
- `frontend-admin-dashboard/src/routes/study-library/ai-copilot/course-outline/generating/utils/buildApiPayload.ts` (line ~111) and `generating/index.tsx` (line ~875): do not send `num_chapters` or `num_slides` when `kb_grounding` is present.
- `frontend-admin-dashboard/src/routes/study-library/ai-copilot/index.lazy.tsx` (line ~1228): the KB card's suggested structure stays as a display hint; it no longer writes the count fields.
- `ai_service/app/services/prompt_builder.py` (lines ~33 to 45): ignore both counts when the request carries `kb_grounding` (belt and braces).
- `ai_service/app/services/kb/course_grounding.py` `deterministic_sections` (line 96) and `course_outline_service._deterministic_outline_from_kb` (line 102): split a subtopic whose linked chunk count exceeds a threshold into "Part n" slides by page span.

Verify: tsc + eslint on the three FE files; py_compile; a scripted call to the outline endpoint
(it is unauthenticated) with a KB in ADAPT mode on prod, confirming chapter count follows the
topic tree and a large subtopic yields parts. Deploy FE and ai_service in one batch each.

### WP1 — Migration V494: plan tables, pricing rows, request-type CHECK

Files: `admin_core_service/src/main/resources/db/migration/V494__Teaching_plan_tables.sql`
(re-verify the number is still free on origin/main at push time).

Contents (as built, 2026-09-03):
- `teaching_plan`, `teaching_topic`, `teaching_concept`, `teaching_media` exactly as in the
  design §5.1, including `source_description` and `say_i18n_json`.
- The learner tables from §5.2 (`tutor_learner_state`, `tutor_session`,
  `tutor_concept_attempt`) pulled forward from WP5 so the runtime needs no second admin_core
  deploy; they sit dormant until WP6.
- `ai_tool_pricing` rows: `tutor_compile_slide` (flat 2, request_type `content`) and
  `tutor_media_image` (flat 1, request_type `image`, charged once per generated image).
- **No change to the `ai_token_usage.request_type` CHECK**: both rows reuse existing request
  types (`content`, `image`) precisely to avoid the V325 and V365 trap, where a new request
  type without a rewritten CHECK silently dropped every charge. The `ai_tool_pricing.unit_field`
  CHECK is likewise untouched by charging images per row instead of per unit.
- Verified by executing the file twice on a throwaway local PostgreSQL 15 (second run is a
  no-op thanks to IF NOT EXISTS and ON CONFLICT).

Verify: `mvn clean compile` (migrations are SQL, but the build must still pass); after deploy,
on the standby: `\d teaching_plan` and `SELECT tool_key FROM ai_tool_pricing WHERE tool_key LIKE 'tutor_%'`.

### WP2 — The compiler (ai_service)

**Status: shipped 2026-09-03** (commits a858c4e9e6, b8aac3cc9f, c4028a478d, 984237a650 and the
Flash-default fix after them). Adversarially reviewed before the first deploy (57 agents, 22
confirmed findings, all fixed: staff-only auth, media-task validation order, quiz limits, stuck
compiles, sessions across model calls, idempotent billing, sanitized ops). Verified on production
with the Spark Education course "Chapter_1: Physical and Functional Assessment": a document slide
compiled to 4 boards / 10 concepts with SVG diagrams, English + Hindi narration and checks. Two
findings from the probes changed the design: model replies need a repairing JSON parser (SVG
inside JSON strings), and the default compile model is `google/gemini-2.5-flash`, because a
single failed Pro compile billed 35 credits under the platform's token pricing.

New files, all under `ai_service/app`:

| File | Contents |
|---|---|
| `models/teaching_plan.py` | four SQLAlchemy models on the shared `Base` from `models/ai_gen_video.py`; register in `models/__init__.py` |
| `schemas/tutor.py` | Pydantic: `BoardOp` discriminated union (design §4.4), `Check`, `Concept`, `Topic`, `TeachingPlan`, `CompileRequest {package_id, slide_ids[], language, teacher_name}`, `SourceDescriptionRequest`, SSE event models |
| `services/tutor/board_ops.py` | whitelist, id rules, `materialize(ops) -> html`, `nh3` allowlist for text and a guarded SVG subset |
| `services/tutor/plan_validator.py` | schema, id uniqueness, board size limits, media descriptions, `say` in both languages; returns an error list for the repair pass |
| `services/tutor/compile_prompts.py` | the six prompt blocks from design §4.6, teacher persona name injected, both-language narration |
| `services/tutor/plan_compiler.py` | load slide (document `published_data`, falling back to `data`; quiz JSON; AI video script; `source_description`), KB chunks through `course_grounding.ground_slide` for grounded courses, one `ChatLLMClient.chat_completion(model=compile_model, max_tokens=8000)` call, parse, validate, up to two repair calls, media generation, write rows, bill |
| `services/tutor/quiz_compiler.py` | deterministic: quiz questions to check-only concepts |
| `services/tutor/media_task_compiler.py` | video and PDF slides from `source_description` to a media-task topic |
| `services/tutor/media.py` | SVG from the model, stock via `image_service._get_image_search_keyword` path, AI images via the existing image route; every media row gets a description and parts |
| `routers/tutor.py` | `POST /tutor/v1/compile` (SSE, `get_pinned_principal`), `GET /tutor/v1/packages/{id}/plans`, `GET /tutor/v1/slides/{id}/plan`, `PUT /tutor/v1/slides/{id}/source-description`, `POST /tutor/v1/slides/{id}/recompile`; register in `app_factory.py` next to the KB routers |

Existing pieces reused, not modified: `ChatLLMClient` (institute key resolution and model
override), `ai_billing.preflight_tool_credits` and `record_tool_billing` with
`idempotency_key=f"tutor_compile:{plan_id}"`, the content-generation SSE frame format and
15 s keepalive, `platform_settings_service` for a new `tutor.compile.model` key (default a
strong OpenRouter model; institute key still wins).

Behaviour: `Semaphore(3)` slides in flight per request; workers cancelled when the SSE client
disconnects (same fix content generation needed); a slide's failure never fails the request;
status transitions NEEDS_DETAILS → COMPILING → READY | FAILED; recompile bumps `version` and
keeps the old plan until the new one is READY.

Tests (`ai_service/tests/`): `test_tutor_board_ops.py` (materialize, sanitize, id checks),
`test_tutor_plan_validator.py` (fixture plans: valid, oversized board, missing description,
duplicate id), `test_tutor_quiz_compiler.py`, `test_tutor_media_task_compiler.py`. Plus
`scripts/tutor_compile_probe.py`, a token-driven script that compiles one real slide against
the deployed service and prints the plan, the way `voice_probe.mjs` drives the voice socket.

Verify: py_compile, pytest, route registration smoke (`create_app()` and list routes),
then deploy and run the probe on one copilot slide in the test institute; inspect the rows on
the standby and the `credit_transactions` row with the `tutor_compile:` reference.

### WP3 — Admin creation flow

**Status: shipped 2026-09-03** as 6715e2bd6b: Tutor Mode tab (settings form, plan status,
Prepare for teaching, recompile, details editor, preview), the copilot "AI teacher" chip with
background compile after persist, the teaching-description card on VIDEO and PDF slides, and the
institute defaults card on Settings → Course settings. The extra card inside the package settings
panel was dropped as redundant with the tab. Browser QA by the owner is pending.

Files:
- `frontend-admin-dashboard/src/routes/study-library/ai-copilot/index.lazy.tsx`: a
  "Personalized teaching (AI teacher)" toggle beside `includeChapterVideo` and
  `quizPlacement` (state around line 275 to 280), saved into the `courseConfig` session
  storage object (line ~849) and shown with a `ToolCostBadge` for `tutor_compile_slide`.
- `frontend-admin-dashboard/src/routes/study-library/ai-copilot/course-outline/generating/hooks/useCourseCreation.ts`
  (line ~101): after `createCourseWithContent` resolves, when the toggle is on: save the
  package setting `TUTOR_MODE_SETTING` through
  `POST /admin-core-service/package/setting/v1/save-setting`, then open the compile SSE with
  the created slide ids and the bearer token from `getTokenFromCookie`. `CreateCourseResult`
  must expose the slide ids it created; add them if it does not. Compile failure shows a toast;
  the course is already created.
- A new **Tutor Mode** tab on the admin course page (owner ask 2026-09-03). Tabs are defined
  by the `TabType` enum (`course-details/subjects/-constants/constant.ts`), the `tabs` array
  consumed in `course-details/-components/course-structure-details.tsx` (`finalTabs`, line
  ~5196), the `CourseDetailsTabId` union (`src/types/display-settings.ts:84`) and the default
  visibility set in `src/constants/display-settings/course-details-tabs.ts`, so the new
  `TUTOR_MODE` id must be added to all four and to the settings screen that orders tabs. The tab holds: the per-course
  `TUTOR_MODE_SETTING` form (fields in design §5.3, each showing the inherited institute value
  until overridden), compile status counts, the NEEDS_DETAILS slide list linking into the slide
  editor, "Prepare for teaching" (recompile stale and failed), and the per-slide plan preview.
  The same form is also listed as a card in `package-settings/PackageSettingsPanel.tsx` so it is
  reachable from the existing settings panel.
- `.../chapters/slides/-components/slide-material.tsx`: for VIDEO and PDF slides, a "What this
  video / PDF teaches" textarea that PUTs the source description and triggers that slide's
  compile.
- A read-only plan preview dialog per slide rendering the stored `board_html` and `say` per
  concept. The admin app needs no ops renderer; it shows the server-materialized HTML.
- `frontend-admin-dashboard/src/services/ai-credits/get-ai-credits.ts` (lines ~89 and ~340):
  `ToolKey` union and `computeToolCredits` entries for `tutor_compile_slide` and
  `tutor_media_image`. Python `DEFAULT_TOOL_PRICING` and the V494 seed must carry the same
  numbers.

Verify: tsc, eslint per file, design-lint; no new route so no routeTree regeneration. Browser
QA in the test institute: create a three-chapter course with the toggle on, watch the compile
progress, open the preview, add a description to a video slide, watch it compile.

### WP4 — Small admin_core pieces

- `SlideService.addOrUpdateDocumentSlide` (line 71) and `updateVideoSlide` (line 285): after a
  successful publish, `UPDATE teaching_plan SET status='STALE' WHERE slide_id=? AND status='READY'`
  through a small native repository. No service call, no coupling.
- `PackageSettingService.saveGenericSetting` (line 101) already accepts any key, so
  `TUTOR_MODE_SETTING` needs no Java change. Confirm by reading, not assuming.
- Institute defaults: a "Tutor Mode defaults" card on the Settings → Course settings page
  (`routes/settings/-components/Course/CourseSettings.tsx`, alongside `CourseSettingsForm.tsx`)
  saving the new institute key `TUTOR_MODE_SETTING` through the generic
  `/admin-core-service/institute/setting/v1/save-setting`. No Java change: the institute
  setting endpoint is generic by key. (Assumption: this page is what the owner called "LMS
  settings"; the Settings → LMS page in this codebase is the LearnDash and Moodle connection
  library and would be the wrong home.)

Verify: `mvn clean compile` with the compiling line present.

## 4. Work packages, tutor runtime

### WP5 — Learner tables

Folded into V494 (see WP1); nothing left to do here.

### WP6 — Tutor socket and state machine (ai_service)

**Status: shipped 2026-09-04** (3081f6b1ea, 6ec82abd61 and follow-ups). Verified on production
with a text-mode probe (scratchpad/tutor_ws_probe.py): greeting and resume, board ops, check,
correct answer → praise and advance, wrong answer → live highlight, hint and remediation, session
end with telemetry (two decision turns cost ~2.6k tokens). Design change from the first probe: a
concept with a check flows explain → ask in one turn; the client is told `await answer`.

| File | Contents |
|---|---|
| `models/tutor_runtime.py` | three ORM models |
| `services/tutor/session_service.py` | start or resume, load plan and learner state, pointer remap on plan version change, session end summary through the context-window summarizer pattern |
| `services/tutor/state_machine.py` | states and transitions from design §6.3 including MEDIA_TASK; pure functions, unit tested |
| `services/tutor/decision.py` | prompt assembly with the budgets from §6.5, one `ChatLLMClient` call, decision JSON validation against the current board, one retry, deterministic fallback |
| `services/tutor/intents.py` | phrase lists per language for repeat, skip, slower, faster, doubt, pause, resume, done |
| `routers/tutor_ws.py` | `/tutor/ws/{tutor_session_id}`: auth required on the first message; reuses the voice socket's audio handling by import (`audio_utils`, `SarvamService.speech_to_text`, `_speak`-style segment streaming); adds `start`, `answer`, `control`, `next_slide`, `state`, `board`, `check`, `slide_done`, `billing` |
| `services/tutor/meter.py` | per-minute `tutor_live_minute` charge with `tutor_live:{session}:{minute}` idempotency; rates are placeholders |

Tracking stays in the browser: on `slide_done` the learner app posts the same completion
calls the slide viewer posts (`MARK_SLIDE_COMPLETION`, `ADD_UPDATE_DOCUMENT_ACTIVITY` and the
video equivalent from `src/constants/urls.ts`). The server never needs admin_core credentials
and the roll-ups stay untouched.

Tests: state machine transitions, decision validation and fallback, intent matching, prompt
budget trimming. A `scripts/tutor_ws_probe.mjs` drives a full text-mode session against prod.

### WP7 — Smallest in the browser TTS path, TTS cache, key plumbing

**Status: shipped 2026-09-04** — `smallest` engine (REST lightning_v3.1) in `voice_tts.py`, platform default when `SMALLEST_API_KEY` is set on ai-service (workflow `docker-publish-ai-service.yml`), Sarvam fallback per line, instant voice cloning endpoint + Settings card. TTS cache is in-process (media-path cache still open). Live metering (`tutor_live_minute`, V496) shipped the same day.

- `ai_service/app/config.py`: `smallest_api_key` beside `sarvam_api_key` (line 166).
- `.github/workflows/docker-publish-ai-service.yml` (the `kubectl set env` block, line ~104,
  where `SARVAM_API_KEY` is passed): add `SMALLEST_API_KEY=${{ secrets.SMALLEST_API_KEY }}`.
  The secret already exists (the voice-bot workflow uses it) and is already on the
  voice-bot-service pods; only ai-service lacks it. Pass it conditionally so an unset secret
  never deletes a key.
- `ai_service/app/services/voice_tts.py`: a `smallest` engine ported from
  `voice_bot_service/app/providers.py::_build_smallest` and the `_smallest_tts_wav` helper in its
  main module (`wss://api.smallest.ai/waves/v1/tts/live`, `lightning_v3.1`, real numeric speed).
  Female Hindi-capable voices already catalogued there: `imogen`, `nirupma`, `niharika` on
  v3.1 and `manasi`, `mrunal`, `ketaki`, `meher` on pro. Voice palettes are per model and a
  cross-model voice is rejected outright.
- TTS cache: key `(provider, voice, language, sha256(text))`, stored through the media path,
  checked before every synthesis of compiled narration.
- Platform settings: `chatbot.voice.tts_provider` already exists; add `tutor.voice.provider`
  and `tutor.voice.voice` with the female default.

Verify: audition three Hindi and three English sentences at 24 kHz through the browser path
before choosing the default voice; confirm the pods see the key (`list_tts_providers`).

### WP8 — Learner app

**Status: shipped 2026-09-04** as fad2a070a0 (text and voice modes; drip-condition gating on the
next slide is not applied yet — the tutor offers the next prepared slide in chapter order).
Owner browser QA pending. Regenerate `routeTree.gen.ts` with the router generator directly; a
short vite run does not pick up a new route.

- Route `src/routes/study-library/courses/course-details/tutor/index.tsx` with search params
  `courseId`, `packageSessionId`, `slideId?`; regenerate `routeTree.gen.ts` by starting vite
  for a few seconds (no standalone codegen).
- `src/components/tutor/boardRenderer.ts`: ops to DOM with `write | fade | pop`, highlight,
  annotate, clear; DOMPurify for text, KaTeX for formulas (both already dependencies); parity
  fixtures shared with the Python materializer.
- `src/components/tutor/Whiteboard.tsx`, `TutorSidebar.tsx` (topics and step dots),
  `TeacherPanel.tsx` (avatar, transcript, text input, mic), `BoardDeck.tsx` (teaching off).
- `src/hooks/useTutorSocket.ts` modelled on `useVoiceWebSocket.ts` (URL building, token from
  `getTokenFromCookie`, reconnect) plus the new messages; reuse `useVoiceRecorder` as is.
- Entry: on the course details page and the chapter view, "Learn with your teacher" when the
  package setting is enabled and plans are READY; `defaultOn` routes straight in.
- Next slide: on `slide_done`, pick the next unlocked slide using the chapter sidebar store and
  the drip store, post the completion calls, send `next_slide`.
- Style: the reference screenshot's paper grid and marker font, added as a font-face for the
  whiteboard only; everything else stays on the learner design tokens. The learner tsc
  baseline is 706 errors; new code must add none.

### WP9 — Settings UI and analysis

Runtime-facing polish of the two settings surfaces built in WP3 and WP4: voice audition
button on both forms (plays a sample through the chosen provider and voice), model dropdowns
fed from the `ai_models` registry, and the resolved "effective value" shown next to each
package field. Chat analysis lists `tutor` sessions because transcripts reuse `chat_sessions`.

### WP10 — Prod verification

Text-mode session first (no microphone variables), then voice. Check: resume after refresh,
media task on a video slide, remediation loop and WEAK flag, slide completion visible in the
normal course view, `tutor_session.summary_json` cost telemetry, and the per-minute meter rows.

## 4b. Deep review 2026-09-04

**Status: fixes shipped 2026-09-04.** A seven-lens adversarial review of WP0–WP8 produced 92
candidates; 32 were verified by two refuters each (29 confirmed), the rest were checked by hand
against the code. Everything confirmed as a blocker or major was fixed the same day (tenancy of
slides vs batch, ACTIVE-only enrolment, the socket's pinned DB connection, barge-in ordering,
final-attempt re-asks, per-slide billing counters, truncated-reply repair, STALE plans not
serving, dead compile-model / KB-grounding settings, the copilot reading a deleted storage key,
media tasks with no player, KaTeX, reconnect). `LIVE_TUTOR_DESIGN.md` §13 has the full list and
the open items (live metering, quiz completion, AI-video scripts, pointer remap, KB on doubts,
weak-concept revisits, Smallest TTS). Regression tests: `tests/test_tutor_review_fixes.py`.

## 5. Push sequence

1. Docs only (no deploy).
2. WP0: admin FE, then ai_service.
3. WP1 + WP4 Java: admin_core (Flyway applies on start; confirm tables before step 4).
4. WP2: ai_service, one push.
5. WP3 + WP4 FE: admin FE, one push. **Creation milestone.**
6. WP5: admin_core.
7. WP6 + WP7: ai_service, one push, off peak.
8. WP8 + WP9: learner FE and admin FE.
9. WP10, then rates once telemetry exists.

## 6. What could bite

- Forgetting the `ai_token_usage` CHECK in WP1 silently unbills every compile.
- The copilot's outline and content endpoints are unauthenticated; the tutor endpoints must not
  copy that. `get_pinned_principal` on compile, token on the socket's first message.
- ai_service ORM models do not create tables; deploying WP2 before V494 is applied means 500s
  on the compile router, not a crash. Sequence anyway.
- The admin build aborts on any syntax error, so a grep-filtered tsc run can read clean while
  broken. Look for actual output.
- Maven incremental compile on this external volume skips edited files; always `clean compile`.
- Node id for KB-grounded slides is not stored on the slide, so the compiler retrieves by
  slide title and text through `ground_slide`; a later change can persist the node id on the
  plan row at creation time.
