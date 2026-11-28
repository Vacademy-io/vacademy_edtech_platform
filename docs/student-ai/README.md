# Student AI Chatbot — End-to-End Reference

The "Student AI" is the learner-facing AI tutor. Admins configure it under
**Settings → AI → Student AI**; learners talk to it through the floating chat
launcher / side panel in the learner dashboard. The brain lives in the Python
`ai_service` (`/chat-agent/**`), the configuration lives in a single institute
setting row (`CHATBOT_SETTING`), and the conversation state lives in two
Postgres tables (`chat_sessions`, `chat_messages`).

> Not to be confused with:
> - **Course AI / AI Copilot** (`AI_COPILOT_SETTING`, `AI_settings.AI_COURSE_PROMPT`) — admin-side course generation.
> - **Vacademy Assistant** (`/assistant/**`) — the *admin* agent, separate router and tables.
> - **Doubts / Help & Queries** — human doubt resolution, unrelated pipeline.

> **Updated 2026-10-20.** Sections 4.4, 6, 7.1, 7.2, 9 and 12 describe the current
> code. Other changes since August, in short: the model comes from the super-admin
> platform setting `chatbot.text.model` (GLM-5.3-flash in production) unless an
> institute brings its own key; the knowledge-base auto-search reads `kb_chunk`
> (`purpose='institute_info'`), not `content_embeddings`; the admin form is
> [StudentAiSettingsSection.tsx](../../frontend-admin-dashboard/src/routes/settings/-components/StudentAiSettingsSection.tsx);
> desktop and mobile panels share `ChatMessageList` / `ChatComposer` / `MessageBubble`.

---

## 1. Component map

| Layer | Location |
|---|---|
| Admin config UI | [AiSettings.tsx](../../frontend-admin-dashboard/src/routes/settings/-components/AiSettings.tsx) — section `grp-student-ai` ("Student AI") |
| Admin Knowledge Base UI | [KnowledgeBase.tsx](../../frontend-admin-dashboard/src/routes/settings/-components/KnowledgeBase.tsx) |
| Config storage API | `POST/GET /admin-core-service/institute/setting/v1/{save-setting,get}?settingKey=CHATBOT_SETTING` → [InstituteSettingController.java](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/institute/controller/InstituteSettingController.java) |
| Config read (backend) | [institute_settings_service.py](../../ai_service/app/services/institute_settings_service.py) — `get_ai_settings()` reads `institutes.setting_json → setting.CHATBOT_SETTING.data` |
| Chat API | [chat_agent.py](../../ai_service/app/routers/chat_agent.py) — `prefix=/chat-agent`, mounted under `/ai-service` |
| Voice API | [voice_agent.py](../../ai_service/app/routers/voice_agent.py) — WebSocket `/chat-agent/session/{id}/voice` |
| Orchestrator | [ai_chat_agent_service.py](../../ai_service/app/services/ai_chat_agent_service.py) (~1.5k lines — the core) |
| Learner FE hook | [useChatbot.ts](../../frontend-learner-dashboard-app/src/components/chatbot/useChatbot.ts) |
| Learner FE UI | [components/chatbot/](../../frontend-learner-dashboard-app/src/components/chatbot/) — `ChatbotFloatingButton`, `ChatbotSidePanel`, `ChatbotPanel`, `QuizComponent`, `VoiceModePanel`, … |
| Learner FE API client | [chatbot-api.ts](../../frontend-learner-dashboard-app/src/services/chatbot-api.ts), settings cache in [chatbot-settings.ts](../../frontend-learner-dashboard-app/src/services/chatbot-settings.ts) |
| Route gating | [chatbot-routes.ts](../../frontend-learner-dashboard-app/src/config/chatbot-routes.ts) |

Mount points in the learner app:
- `ChatbotProvider` + `ChatbotFloatingButton` in [__root.tsx](../../frontend-learner-dashboard-app/src/routes/__root.tsx#L763-L771)
- `ChatbotSidePanel` in [layout-container.tsx](../../frontend-learner-dashboard-app/src/components/common/layout-container/layout-container.tsx#L138)

---

## 2. Database

All tables live in the single shared Postgres DB; the DDL ships as **admin_core_service
Flyway migrations** even though only `ai_service` reads/writes them (SQLAlchemy models
in `ai_service/app/models/` mirror the schema, no autogenerate).

### 2.1 `chat_sessions` — V78/V79, `session_mode` added in V171

| Column | Type | Notes |
|---|---|---|
| `id` | `VARCHAR(255)` PK | UUID4 string generated in Python |
| `user_id` | `VARCHAR(255)` NOT NULL | learner's user id (client-supplied at init) |
| `institute_id` | `VARCHAR(255)` NOT NULL | FK → `institutes(id)` |
| `context_type` | `VARCHAR(50)` NOT NULL | `slide` \| `course_details` \| `general` |
| `context_meta` | `JSONB` NOT NULL | full frontend snapshot (see §5) |
| `session_mode` | `VARCHAR(30)` NOT NULL default `text` | `text` \| `voice_interview` \| `voice_doubt` \| `voice_oral_test` |
| `status` | `VARCHAR(20)` default `ACTIVE` | `ACTIVE` \| `CLOSED` |
| `last_active`, `created_at`, `updated_at` | `TIMESTAMP` | `updated_at` maintained by trigger `update_chat_updated_at()` |

Indexes: `(user_id, status)`, `(status)`, `(last_active DESC)`, `(institute_id)`.

### 2.2 `chat_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL` PK | V79 fixed this from VARCHAR → BIGSERIAL; SSE/polling ordering depends on it being monotonic |
| `session_id` | `VARCHAR(255)` | FK → `chat_sessions(id)` `ON DELETE CASCADE` |
| `message_type` | `VARCHAR(20)` | `user`, `assistant`, `tool_call`, `tool_result`, `quiz`, `quiz_feedback`, `summary` |
| `content` | `TEXT` NOT NULL | markdown for assistant messages |
| `metadata` | `JSONB` | mapped in Python as `meta_data` (column name is `metadata`) |
| `created_at`, `updated_at` | `TIMESTAMP` | |

Indexes: `(session_id, id)`, `(created_at DESC)`, `(session_id, message_type)`.

`metadata` payloads by message type:
- `user` → `{intent, idempotency_key, quiz_submission, attachments[]}`
- `tool_call` → `{tool_name, tool_arguments, tool_call_id}`
- `tool_result` → `{tool_name, tool_call_id}`
- `quiz` → `{quiz_data}` (correct answers **stripped** before storing/sending)
- `quiz_feedback` → `{feedback}` (full `QuizFeedback`)
- voice scorecard → stored as `assistant` with `{type: "summary", mode}`

### 2.3 `learning_analytics` — V169

`id, user_id, institute_id, session_id, event_type, topic, score, total, meta_data, created_at`.
Written by [learning_analytics_service.py](../../ai_service/app/services/learning_analytics_service.py):
`event_type='doubt'` on every DOUBT-classified message, `event_type='quiz_score'` on quiz submission.
Read back by the `get_learning_analytics` tool and `GET /analytics/{user_id}/summary`.

### 2.4 `knowledge_base_items` — V170

`id, institute_id, title, content, category, tags TEXT[], is_active, created_at, updated_at`.
Institute-authored FAQ/policy/curriculum snippets. On create/update the item is
chunked + embedded into `content_embeddings` with `source_type='knowledge_base'`.

### 2.5 `content_embeddings` — V168 (pgvector)

`id, institute_id, source_type, source_id, content_text, chunk_index, embedding vector(768), meta_data, created_at, updated_at`
plus an HNSW cosine index (`m=16, ef_construction=64`). Backs both the auto-KB
injection and the `semantic_search_content` tool.

### 2.6 Tables read (never written) by the tutor

- `institutes.setting_json` — the `CHATBOT_SETTING` config
- `student` — learner `full_name`, `email` for personalisation
- `user_linked_data` — `type in ('strength','weakness')`, `data`, `percentage` → injected as `user_performance`
- `student_analysis_process` — recent analysis report summary (via `get_student_feedback`)
- `slide`, `quiz_slide_question` — keyword resource search
- `learner_operation` (via `LearningProgressService`) — progress / next-up
- `ai_api_keys` — per-user / per-institute OpenRouter key + default model
- `ai_token_usage` + credit ledger — usage & credit deduction

---

## 3. Settings (`CHATBOT_SETTING`)

One JSON blob per institute, stored at `institutes.setting_json → setting.CHATBOT_SETTING.data`
(the Java `SettingDto` wrapper: `{key, name, data}`).

```json
{
  "enable": true,
  "role": "Tutor",
  "assistant_name": "Shiksha Nation Chatbot",
  "institute_name": "Shiksha Nation",
  "core_instruction": "You are a helpful tutor assisting students with their doubts.",
  "hard_rules": [
    "Never provide the final answer directly.",
    "Keep responses short and concise unless explaining a complex topic."
  ],
  "adherence_settings": { "level": "strict", "temperature": 0.5 },
  "enabled_modes": ["general", "doubt", "practice"],
  "chatbot_pages": ["dashboard", "all_courses", "course_details", "study_material"],
  "voice_settings": { "default_language": "en-IN", "default_voice": "shubh" },
  "launcher_settings": {
    "draggable": true,
    "nudge_enabled": true,
    "nudge_interval_seconds": 120,
    "nudge_duration_seconds": 5,
    "bounce": true
  }
}
```

| Field | Consumed by | Effect |
|---|---|---|
| `enable` | learner FE only (`shouldShowChatbot()`) | hides the launcher. **Backend does not check it** — the `/chat-agent` endpoints still work if called directly. |
| `role`, `assistant_name`, `institute_name`, `core_instruction`, `hard_rules`, `adherence_settings.level` | `format_rules_for_prompt()` | rendered into the system-prompt preamble (`You are {assistant_name}, a {role} at {institute_name}` + core instruction + bulleted hard rules + adherence level) |
| `adherence_settings.temperature` | `get_temperature()` | LLM sampling temperature (backend default `0.3` when absent; UI default `0.5`) |
| `enabled_modes` | learner FE (quick actions / voice selector visibility) | `general`, `doubt`, `practice`, `voice_interview`, `voice_doubt`, `voice_oral_test`. Not enforced server-side. |
| `chatbot_pages` | learner FE `setChatbotPages()` | route categories: `dashboard`, `all_courses`, `course_details`, `study_material`, `catalogue` |
| `voice_settings` | voice WS `config` frame | Sarvam language code + voice id |
| `launcher_settings` | `ChatbotFloatingButton` | drag/snap, periodic nudge, bounce |
| `avatarUrl` | learner FE default only | not written by the admin UI; falls back to a hard-coded Cloudinary asset |

Backend fallback if the setting is missing/empty
([`DEFAULT_AI_SETTINGS`](../../ai_service/app/services/institute_settings_service.py)) uses
`assistant_name: "Savir"`, `institute_name: "Vacademy"` — note this differs from the
learner FE default (`"Vacademy Chatbot"`) and the admin UI default
(`"{institute_name} Chatbot"`), so the three defaults are not in sync.

**Caching:** the learner app caches settings in `localStorage` under
`CHATBOT_SETTING_cache_v1:{instituteId}` with a **5-minute TTL**, so admin changes
take up to 5 min to reach an already-loaded learner (`useChatbot` calls
`getChatbotSettings(true)` — force refresh — on mount, so a reload is immediate).

---

## 4. API surface

All `ai_service` routes are mounted under `api_base_path = /ai-service`, so the
public paths are `{BASE_URL}/ai-service/chat-agent/...`.

### 4.1 Chat (`/ai-service/chat-agent`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/session/init` | create session; body `{user_id, institute_id, user_name?, context_type?, context_meta?, session_mode?, initial_message?}` → `{session_id, status}` |
| `POST` | `/session/{id}/message` | queue a user message; body `{message, intent?, quiz_submission?, idempotency_key?, attachments?[]}` → `{message_id, status}` |
| `PUT` | `/session/{id}/context` | swap context on navigation without triggering a reply → `{session_id, context_type, success}` |
| `GET` | `/session/{id}/stream` | **SSE** — the actual response channel (see §6) |
| `GET` | `/session/{id}/updates?last_message_id=` | polling fallback for non-SSE clients |
| `POST` | `/session/{id}/close` | mark `CLOSED` → `{session_id, status, message_count}` |
| `POST` | `/session/{id}/audio-message` | multipart `file` + `language`; Sarvam STT (`saaras:v3`) → transcript → normal text message |
| `WS` | `/session/{id}/voice` | full-duplex voice (see §8) |
| `GET` | `/debug/active-streams` | active SSE listener counts per session |

Note the asymmetry: `POST /message` only *persists* the message and returns
`idle`. Nothing is generated until an SSE stream is open — the stream's polling
loop is what notices the unprocessed `user` row and runs the agent. A client that
sends a message without holding a stream gets no reply until it opens one.

### 4.2 Admin read APIs — Chatbot Analysis

Served by **admin_core_service** (not ai_service), in the existing AI-Usage feature
([CreditUsageController.java](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/ai_usage/controller/CreditUsageController.java)
+ `ConversationService` / `ConversationRepository`). Institute scope comes from the
`clientId` header, and every query joins `chat_sessions` on `institute_id`, so a
session id from another tenant returns nothing.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin-core-service/ai-usage/v1/chatbot/summary?startDate&endDate` | aggregate data points: sessions, students reached, message counts by type, doubts, quizzes + average score, mode/context breakdowns, top topics, zero-filled daily activity |
| `GET` | `/admin-core-service/ai-usage/v1/chatbot/sessions?search&status&sessionMode&startDate&endDate&onlyWithMessages&page&size` | paginated recent chats with the learner resolved from `student` (via `LATERAL`, so multiple enrolments don't duplicate rows) |
| `GET` | `/admin-core-service/ai-usage/v1/conversations/{sessionId}/messages` | full transcript, reused by both this screen and Settings → AI → Usage |

Consumed by **LMS → Student AI** in the admin app
([routes/study-library/student-ai/](../../frontend-admin-dashboard/src/routes/study-library/student-ai/)),
which has two sub-tabs:

- **Student AI settings** — the `CHATBOT_SETTING` form, shared component with
  Settings → AI → Student AI ([StudentAiSettingsSection.tsx](../../frontend-admin-dashboard/src/routes/settings/-components/StudentAiSettingsSection.tsx)), so there is one source of truth.
- **Chatbot Analysis** — KPI tiles, daily-activity strip, mode/context/topic
  breakdowns, and a searchable paginated recent-chats table whose rows open a
  read-only transcript.

Note the window semantics: `sessions` filters on `created_at` within the range but
orders by `last_active`, i.e. "chats *started* in this window."

### 4.3 Supporting routers

| Path | Purpose |
|---|---|
| `/ai-service/knowledge-base/v1/institute/{id}/items` (GET/POST/PUT/DELETE) | KB CRUD, auto re-embeds on write |
| `/ai-service/analytics/{user_id}/{summary,doubts,quiz-scores}` | learning analytics reads |
| `/ai-service/content/embed`, `/content/embed-batch` | ingest course content into `content_embeddings` |
| `/admin-core-service/institute/setting/v1/save-setting?settingKey=CHATBOT_SETTING` | admin writes config (audited via `@Auditable`) |
| `/admin-core-service/institute/setting/v1/get?settingKey=CHATBOT_SETTING` | learner + admin read config |

### 4.4 Auth on the learner endpoints (rollout)

[chat_auth.py](../../ai_service/app/core/chat_auth.py). The learner app sends its access
token on every call: REST through the authenticated axios client, the stream through a
fetch-based reader (`chatbotAPI.openStream`, because `EventSource` cannot send headers).
Tokens are verified locally (HS256); membership is the JWT's per-institute `authorities`
map, with **no** `is_root_user` bypass (ordinary learners carry that flag).

- A request is a *violation* when its token is missing or expired, when `init` names a
  different `user_id` or an institute not in the token, or when a session belongs to
  someone else.
- While the platform setting **`chatbot.text.require_auth`** (env `CHAT_REQUIRE_AUTH`) is
  off, violations are served and counted per reason. Staff can read the counters at
  `GET /chat-agent/debug/auth-stats`, and a `[chat-auth]` warning is logged at most once
  a minute. Switch the flag on once real clients stop producing them; violations then
  get 401/403.
- `GET /chat-agent/whoami` is a cheap authenticated call. The app makes it before opening
  the stream when its token has expired, so the shared client does the refresh.
- Rate limit: 12 messages per minute per learner on `message` and `audio-message` (429).
  It is in-process, so the limit is per pod.
- The voice socket has its own flag, `chatbot.voice.require_auth`; the app already sends
  `{type:"auth"}` first.
- Still open: `enable:false` and `enabled_modes` are enforced in the frontend only.

---

## 5. Context model

`context_type` is derived on the learner FE from `location.pathname`
(`useChatbot.getContextType()`): `/slides` → `slide`; `/course-details` (not
`/subjects`) → `course_details`; else `general`. `context_meta` is a snapshot built
client-side in `buildContextMeta()`:

- **slide** — `name`, `type` (`DOCUMENT`/`VIDEO`/`CODE`/`QUESTION`/`QUIZ`/`ASSIGNMENT`),
  `content` (published HTML), `questions[]`, `options[] | options[][]`, `order`,
  `chapter`, `module`, `subject`, `course`, `progress` ("45%")
- **course_details** — `name`, `total_length_in_minutes`, `about`, `why_learn`, `who_should_learn`
- **general** — `{}` (plus `courses_path` in the type)

Server-side [`ContextResolverService.resolve_context()`](../../ai_service/app/services/context_resolver_service.py)
then produces the object handed to the prompt builder:

```
{ context_type, context_data (HTML-stripped, content truncated to 4000 chars),
  user_performance {strengths[], weaknesses[]},   # user_linked_data
  user_details {name, email} }                    # student table
```

On navigation the FE calls `PUT /session/{id}/context` so one session follows the
learner across pages instead of re-initialising.

---

## 6. Request lifecycle (text mode)

```
learner opens panel
  └─ POST /session/init        (Accept-Language → context_meta.ui_language)
  └─ fetch GET /session/{id}/stream
        ├─ replays every chat_messages row as a `message` event
        ├─ no rows → templated greeting (no LLM; platform flag chatbot.text.llm_greeting
        │            turns the AI greeting back on)
        └─ every 2 s: new rows are relayed; the newest unanswered `user` row is answered
           by whichever open stream wins its CLAIM
```

**Exactly-once answering.** A stream answers a user message only after an atomic
`UPDATE … RETURNING` sets `metadata.claimed_at` on it. The claim is refreshed between
steps and becomes takeable after 75 s (the slowest single step, quiz generation, peaked
at 62 s). `metadata.answered_at` marks it done. As a result:
- two tabs or a racing reconnect never double-answer;
- a reconnect recovers a turn whose stream died, after up to 75 s;
- messages older than 15 minutes are never auto-answered on reconnect.

The poll cursor only advances through rows the stream read, so a message that lands
mid-reply is no longer skipped.

`_stream_agentic_processing(message_id)`:
1. Loads context, keys, history (see §9), institute rules, and knowledge-base snippets
   (`kb_chunk`, `institute_info`, top 3, ≥0.35).
2. Quiz submission → scored against the durable answer key in `chat_quiz_state`.
3. An *explicit* `intent=practice` from the app → quiz on the current topic. The regex
   classifier no longer routes; it only tags DOUBT for analytics.
4. Agent loop, up to 5 rounds, streamed. The 5th round is offered no tools, so it always
   answers. For each tool call:
   - the `tool_call` row is stored and emitted **before** the tool runs, so the app's
     indicator is live;
   - the tool runs, then `tool_result` is stored;
   - an optional `card` row follows.
   Text the model streams alongside a tool call is kept as its own message.

### SSE event types

| Event | Data |
|---|---|
| `message` | `{id, type, content, metadata, created_at}` |
| `token` | `{content}` — incremental assistant text |
| `status` | `{ai_status, session_status}`; `ai_status ∈ idle \| thinking \| tool_executing \| generating_quiz` |
| `error` | `{type: "ERROR", code, message}` |
| `comment` | `{message: "keepalive"}` |

Response headers include `X-Accel-Buffering: no` so nginx doesn't buffer the stream.

---

## 7. Capabilities

### 7.1 Tools

Defined in [tool_manager_service.py](../../ai_service/app/services/tool_manager_service.py).
Identity is server-side: no tool takes a `user_id` and the prompt carries no ids or email.

| Tool | What it does |
|---|---|
| `get_my_courses()` | Active enrolments (unpaid `ABANDONED_CART` rows excluded) with completion % (the `PACKAGE_SESSION` rollup the course cards show), the last slide opened (newest `activity_log` view) or the first slide for a course not started, as a `progress` card with Continue/Start links. ([learner_tools.py](../../ai_service/app/services/learner_tools.py)) |
| `get_my_live_classes(which)` | Mirrors the learner app's live-class list: participants by batch or user, unassigned public classes when the institute shows them, the `attendanceOnlyMode`/`showPastSessions`/`showRecordings`/`showAttendance` settings. Upcoming (7 days, IST, live/joinable now) and past (14 days, attendance, recording). The Join link is the app's own join page `/study-library/live-class/{username}` (payment, waiting room, attendance, personal BBB link), never the raw meeting URL. |
| `get_my_tests()` | Open and upcoming tests through assessment_service's internal `GET /assessment-service/internal/learner-chat/v1/assessments` (HMAC). It reuses the examination page's own query. Links to `/assessment/examination/{id}`. |
| `get_my_results()` | `GET …/learner-chat/v1/results`: the report list's own query, with **only RELEASED attempts carrying marks**, enriched with total, %, rank, percentile, class average and sections (latest 5). Unreleased attempts are listed as awaiting result. Links to `/assessment/reports/student-report?assessmentId&attemptId`. |
| `get_my_performance()` | Coaching data in one call: released results; the per-test AI analysis in `activity_log` (`llm_assessment`) for **released tests only**; `user_linked_data`; the latest `student_analysis_process` summary; study minutes, active days and streak; 30-day live attendance; doubt topics. |
| `get_learning_progress(source_filter?)` | `learner_operation` paths, %, next recommendation (detail inside a course) |
| `search_related_resources(topic, resource_type?)` | Searches the learner's **ACTIVE enrolments** only, per word with light plural folding, over slide title/description and chapter/module/subject names, ranked. Returns text for the model plus a `link_list` **card** whose links open each slide (`/study-library/courses/course-details/subjects/modules/chapters/slides?courseId&levelId&subjectId&moduleId&chapterId&slideId&sessionId`). |
| `create_practice_quiz(topic, num_questions 3-10 = 5, difficulty)` | Run by the orchestrator: posts a `quiz` message. The model gets a note saying the quiz is on screen. Offered once per turn. |

`get_student_feedback` and `get_learning_analytics` are no longer offered: `get_my_performance` includes their data.
`semantic_search_content` is **not offered**. Its corpus (`content_embeddings`) holds only
the platform's admin help articles, so it answered learners with admin docs. The executor
and `SEMANTIC_SEARCH_TOOL` stay for when a course corpus exists.

**Cards.** A tool may return `ToolOutput(text, card)`
([chat_cards.py](../../ai_service/app/services/chat_cards.py)). The card is validated
(kinds `link_list` / `progress`; links must be `/app-route` or `https://`; at most 10 items)
and stored as `message_type='card'` with `metadata.card`, plus a markdown fallback in
`content` for older apps and the admin transcript. The app renders cards in
`components/chatbot/cards/` and treats unknown kinds as markdown.

### 7.2 Practice quizzes

The model calls `create_practice_quiz` (vague "quiz me" on a lesson → that lesson's topic).
The quiz is a `quiz` message with answers stripped; the full answer key lives in
`chat_quiz_state`. Submission produces a `quiz_feedback` message (score, per-question
results) and a `learning_analytics` event. Both the quiz and its result are replayed into
history (§9), so the tutor can explain a question the learner got wrong.

### 7.3 Multimodal

`attachments[{type,url,mime_type,name}]` — images upload to S3 via
`UploadFileInS3(..., 'CHATBOT_IMAGES', 'LEARNER')`. On send, images go through
Mathpix OCR and the extracted LaTeX is appended to the stored message text; the raw
image URLs are additionally passed to the LLM as OpenAI-style `image_url` content
parts (`_convert_to_multimodal_messages`).

### 7.4 Knowledge base

Admin CRUD (title, content, category, tags, is_active) → chunk + embed →
`content_embeddings(source_type='knowledge_base')`. Every learner message auto-searches
it (top 3, cosine ≥ 0.35) and the hits are prepended to the system prompt as
`[CATEGORY] Title: text` lines. `is_active` is stored but the auto-search does not
filter on it.

---

## 8. Voice mode

Enabled by adding `voice_*` entries to `enabled_modes`. The FE opens a session with
`session_mode = voice_interview | voice_doubt | voice_oral_test`, then connects to
`wss://…/ai-service/chat-agent/session/{id}/voice`.

Protocol ([voice_agent.py](../../ai_service/app/routers/voice_agent.py)):

```
client → { type: "config", language: "en-IN", voice: "shubh" }
         { type: "audio_chunk", data: "<base64>" } …
         { type: "audio_end" }  |  { type: "end_session" }  |  { type: "ping" }
server → { type: "ready" } | "transcript_partial" | "transcript_final"
         | { type: "ai_text", text, message_id } | "audio_chunk" (~32 KB) | "audio_end"
         | { type: "summary", data: {...} } | "error" | "pong"
```

STT/TTS is **Sarvam AI** — `saaras:v3` for STT, `bulbul:v3` for TTS (REST today,
WebSocket streaming helpers exist). Per-mode system prompts in
[voice_session_service.py](../../ai_service/app/services/voice_session_service.py) all
carry `CRITICAL: Keep every response under 50 words … no markdown`:

- `voice_interview` — mock interview: one question at a time, brief feedback, then next
- `voice_doubt` — Socratic doubt discussion
- `voice_oral_test` — oral test: state correct/incorrect, track score internally

On session end `generate_session_summary()` produces a JSON scorecard
(`score, total_questions, strengths[], areas_to_improve[], feedback`), persisted as an
`assistant` message with `metadata.type = "summary"` and rendered by
`SessionScorecard.tsx`.

There is also a one-shot path for text mode: `POST /session/{id}/audio-message`
(record → Sarvam STT → normal message), used by the mic button.

---

## 9. Context-window management

[context_window_service.py](../../ai_service/app/services/context_window_service.py):
- History = latest `summary` + the last 10 conversational turns, built from `user`,
  `assistant`, `quiz`, `quiz_feedback`, `card` and `tool_result` rows. The non-chat rows
  become bracketed notes, e.g. `[Quiz I showed …]` (marked "until they submit, do not
  reveal answers"), `[Quiz result: 8/10 … Q2 WRONG …]`, `[Shown to the student as a card …]`
  and `[Earlier I looked this up with …]` (truncated to 1,500 chars).
- Legacy filler lines ("Let me check your progress! 🔍" …) are skipped. New turns no
  longer store them.
- A summary is generated after 20 user+assistant messages since the last one.
- System prompt order: fixed instructions → institute rules → today's date, learner name,
  page context. The fixed prefix is shared across learners, so providers can cache it.
  Reply language: mirror the learner (Hinglish stays in Latin letters, Devanagari stays
  Devanagari); otherwise use the app's language.

## 10. Models, keys and billing

- **Provider: OpenRouter only.** The direct-Gemini fallback was retired (free-tier key
  with zero image quota). If OpenRouter fails, the call raises.
- **Key/model resolution** ([api_key_resolver.py](../../ai_service/app/services/api_key_resolver.py)):
  user-level `ai_api_keys` row → institute-level row → env
  (`OPENROUTER_API_KEY`, `LLM_DEFAULT_MODEL` — config default
  `google/gemini-3.1-pro-preview`; the `_call_openrouter` signature default is a
  stale `xiaomi/mimo-v2-flash:free` that is never actually used).
  `model="auto"` forces the env default.
  Keys are resolved **once per turn** and reused via `_CachedKeyResolver` so no DB
  session is held during the LLM call.
- **Quiz images** use `google/gemini-3.1-flash-image` through OpenRouter.
- **Embeddings**: `google/gemini-embedding-001` via OpenRouter at 768 dims, matching
  `content_embeddings.embedding vector(768)` (a dimension mismatch drops the batch).
- **Billing**: every completion (including greeting, summaries, quiz gen/eval) calls
  `TokenUsageService.record_usage_and_deduct_credits(request_type=RequestType.AGENT)`,
  writing `ai_token_usage` and deducting institute credits. Failures to record are
  logged and swallowed — never blocking the reply. Admins see the rows under
  **Settings → AI → Usage**.

---

## 11. Learner-side visibility rules

`shouldShowChatbot()` in `useChatbot.ts`, all three must hold:

1. not a parent-portal session (`parentPortal.selectedChild` unset)
2. `chatbotSettings.enable === true`
3. `isChatbotVisibleOnRoute(pathname)` — route is in an enabled `chatbot_pages`
   category and not in `ALWAYS_HIDDEN_ROUTES` (login/signup/payment-result/etc.).
   `/` is hidden; anything unmatched is hidden by default.

The launcher is also suppressed during quizzes (`quiz-active-store`) and while the
doubt-resolution sidebar is open. Offline sends are queued (`offline-queue.ts`) and
flushed on `online`.

---

## 12. Known issues / follow-ups

| # | Issue | Status |
|---|---|---|
| 1 | `/chat-agent/**` unauthenticated, client-supplied identity | **Rollout** (§4.4): verified when present; enforced once `chatbot.text.require_auth` is on |
| 2 | No session-ownership check | Done, enforced with #1 |
| 3 | `enable:false` / `enabled_modes` frontend-only | Open |
| 4 | Quiz answer key lost on restart | Fixed (`chat_quiz_state`) |
| 5 | `get_student_feedback` interval bug | Fixed |
| 6 | `semantic_search_content` scope / admin-doc corpus | Not offered until a course corpus exists |
| 7 | `search_related_resources` cross-tenant + phrase-only | Fixed: enrolment-scoped, per word, linked card |
| 8 | Voice LLM turns and scorecard never billed | Open (pricing decision) |
| 9 | `voice_doubt` gets an oral-test scorecard; score shown as "80/5" | Open |
| 10 | SSE polls the DB every 2 s per open stream | Open |
| 11 | Three different default assistant names | Open |
| 12 | Public `/debug/active-streams` | Removed (staff-only `/debug/auth-stats`) |
| 13 | Chat DDL in admin_core Flyway, models in ai_service | Open |
| 14 | `cn()` (tailwind-merge) drops custom font sizes like `text-caption` next to a text colour, app-wide | Open; worked around in the chatbot chips |

---

*Written 2026-08-03, updated 2026-10-20. Line references may drift.*
