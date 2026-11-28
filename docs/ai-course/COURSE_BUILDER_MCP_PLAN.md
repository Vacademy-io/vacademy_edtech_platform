# Course Builder over MCP — "Ask Claude to build my course"

> **Status:** IMPLEMENTED, not yet verified against a live stack (2026-10-03). In `ai_service`: `courses`, `course_edit`, `course_drip_edit`, `course_invites_edit` (`app/services/assistant_tools_course*.py`, `course_builder_data.py`, `course_content.py`); exposed in `app/mcp/constants.py`; tests in `tests/test_course_tools.py`.
> **Companion docs:** `docs/ai-page-builder/WEBSITE_BUILDER_MCP_PLAN.md` (same tool pattern), `ai_service/MCP_SERVER_GUIDE.md`, `docs/lms/LMS_COURSE_ARCHITECTURE.md`, `docs/ai-course/AI_COURSE_CREATION_AND_KNOWLEDGE_BASE.md`.

## 1. Goal

An institute admin, in Claude / ChatGPT / Cursor with the Vacademy MCP server connected, can in one conversation:

1. **Create a course**: be interviewed about the course, get an outline, and get every page written (documents, quizzes, questions, assignments, YouTube videos, PDFs).
2. **Create an invite link** for that course, with its landing-page copy and registration form.
3. **Create a payment plan** for that invite (one-time, subscription or free).
4. **Optionally apply drip conditions** (date, day N after enrollment, sequential, prerequisite, completion %).

## 2. The one rule: no in-house AI

The connected LLM is the intelligence. It interviews the admin, writes the outline, and writes every slide. The MCP tools only:

- publish the **contract** the LLM writes against (`courses(action='schema')`),
- **validate and sanitise** what it sends,
- **persist** it through admin-core with the caller's own JWT,
- **review** the result deterministically (no model).

No `generate_*` action exists. The AI course pipeline (`/course/ai/v1/generate`, `/course/content/v1/generate`), AI video, AI slides, storybooks and image generation are **not** reachable over MCP. **No AI credits are spent.** This mirrors `website_edit`.

What *is* reused from the in-house pipeline is knowledge, not inference:

- `content_prompts.py` quality and rendering-safety rules are returned as the `schema` contract.
- `document_postprocess.strip_wrapping_fence` / `normalize_code_blocks` clean submitted HTML.
- The outline post-processing rules (unique paths and titles per chapter) run inside `create_course`.
- `content_dedupe` (pure text) powers the repetition check in `courses(action='review')`.

## 3. Tools — four tools, four toggles

| Tool | Mode | Settings group / label | Default |
| :--- | :--- | :--- | :--- |
| `courses` | READ | `courses` — "Courses: view" | ADMIN |
| `course_edit` | WRITE | `course_edits` — "Courses: build drafts" | off |
| `course_drip_edit` | WRITE | `course_drip_edits` — "Courses: drip rules" | off |
| `course_invites_edit` | WRITE | `course_invite_edits` — "Courses: invite links & payment plans" | off |

Each tool takes an `action` argument. The schema is flat (`action` plus optional arguments), and the server validates each action, returning `{"error":"missing_argument","needs":[...]}`.

### 3.1 `courses` (READ)

| Action | Returns |
| :--- | :--- |
| `list` | Courses of the institute: id, name, status (DRAFT / IN_REVIEW / ACTIVE), depth, slide count, created by. |
| `get` | One course's tree (subjects → modules → chapters → slides, with ids, order, type and status), its batch id, and an editor link. |
| `get_slide` | One slide's full content (document HTML, video URL, quiz questions, assignment text). |
| `schema` | The authoring contract: depth meaning, the outline JSON for `create_course`, the content shape per slide type, the HTML document rules, and the quiz/question formats. |
| `brief_checklist` | What to ask the admin before building: audience, level, outcomes, depth, length, language, slide-type mix, assessments, source material, pricing and drip intent. |
| `review` | Deterministic check of a course: empty chapters/slides, too-thin documents, unsafe or broken HTML, invalid quizzes, repeated content between slides of a chapter, depth mismatches, and whether an invite / payment plan / drip exists. |
| `drip` | The course's drip rules in plain language, plus the institute switches (`enabled`, `applyConfiguredRules`). |
| `invites` | Every invite for the course: link, price, status, whether it is the default, enrollment count. |
| `get_invite` | One invite in full: landing copy, form fields, payment plans. |
| `payment_setup` | Active payment gateways (vendors) and the institute's existing payment plans. |
| `sessions_levels` | The institute's existing sessions (e.g. 2026-27) and levels (e.g. Class 9), to reuse by id. |

### 3.2 `course_edit` (WRITE, drafts only)

| Action | Effect |
| :--- | :--- |
| `create_course` | Takes the LLM's full outline (metadata + chapters + slide titles/types) and creates a **DRAFT** course, kept off the catalogue. Builds the hidden levels for its depth (`DEFAULT` subject/module for depth 3, and so on), real subjects/modules for depth 4–5, and the chapters. Slides may be included inline with content, or added later. Returns every id. |
| `add_chapter` | Adds a chapter to a DRAFT course. |
| `add_slide` | Adds one slide (`document`, `video`, `quiz`, `question`, `assignment`, `pdf`) after validation. Its `status` is **DRAFT** unless the admin asks for a published slide (`status: PUBLISHED`, per slide or per call). |
| `update_slide` | Replaces a slide's content or title inside a DRAFT course. Status again defaults to DRAFT unless the admin asks for PUBLISHED. |
| `reorder` | Changes the slide order in a chapter. |
| `import_image` | Copies a public https image into institute media, for use in documents. |
| `import_pdf` | Copies a public https PDF into institute media, for a `pdf` slide. |
| `discard_slide` | Marks a slide of a DRAFT course DELETED (the undo). |
| `publish_slides` | Publishes DRAFT slides of a course, one chapter, or listed slides, the admin's "approve slides". It sends the dashboard's Publish request (documents get `published_data`, videos `published_url`). Runs only when the admin asks; on a live course learners see the slides immediately. |
| `submit_for_review` | Moves the DRAFT course to IN_REVIEW. An admin approves it in the dashboard's approval page, and only then does it go live. |

**Why this is safe without a confirm card:** every course this tool creates is DRAFT and off the catalogue, and edits and discards are refused on courses that are not DRAFT. Slides are DRAFT unless the admin explicitly asks for published ones. `publish_slides` is the one action that can reach learners (on a live course), and only on the admin's request.

**Approval of a new course (verified):** `CourseApprovalService.approveCourse` treats a course with no `originalCourseId` as new: IN_REVIEW → ACTIVE in place, and it creates a default invite only if the batch has none, so the invite made default over MCP is kept. Covered by `admin_core_service/.../course/service/CourseApprovalServiceNewCourseTest`.

### 3.3 `course_drip_edit` (WRITE)

| Action | Effect |
| :--- | :--- |
| `set_rules` | Adds or replaces the rule on one item (course, chapter or slide) of a non-ACTIVE course. |
| `schedule` | Day-wise release: one `relative_date` rule per chapter (or slide), on day `start_day + i*interval_days`. |
| `remove_rules` | Removes the rules on items of a non-ACTIVE course. |

Drip lives in the institute `COURSE_SETTING` blob at `data.dripConditions`, and saving it **replaces the whole blob**. So every write is: GET `/institute/setting/v1/data?settingKey=COURSE_SETTING` → change only `dripConditions.conditions` → POST `/institute/setting/v1/save-setting`. Validation mirrors the dashboard's `validateDripCondition`.

The tool **never** flips `dripConditions.enabled` or `applyConfiguredRules`. They are institute-wide and would activate dormant rules on other courses. If they are off, the result says so and links to Settings → Course.

### 3.4 `course_invites_edit` (WRITE)

| Action | Effect |
| :--- | :--- |
| `create_invite` | A new invite for the course's batch, with name, dates, access days, landing copy (defaults to the course's own copy) and registration form (the institute's default fields first, then any extra ones). It **requires** an inline `payment` (FREE / ONE_TIME / SUBSCRIPTION) or an existing `payment_option_id`, so a price is never assumed. Paid plans need an active payment gateway. Returns `short_url`. |
| `create_payment_plan` | Creates a **new** payment option + plan, and optionally attaches it to an invite of a non-ACTIVE course (replacing that invite's current option). Existing plans are never edited, so a shared institute plan can never change under another course. |
| `make_default` | Makes an invite the course's default (catalogue / enroll flows use it). Allowed only while the course is not ACTIVE. |

Sequence (from admin-core):

1. `GET /open/v1/institute/payment-setting/vendors` (paid plans need ≥1 vendor).
2. `POST /v1/payment-option`.
3. `POST /v1/enroll-invite` with `package_session_to_payment_options=[{package_session_id, payment_option:{id}}]`; the tag stays empty.
4. Optionally `PUT /v1/enroll-invite/update-default-enroll-invite-config`.
5. `GET /v1/enroll-invite/{instituteId}/{id}` to fetch `short_url`.

## 3.5 Sessions, levels and batches

A course is taught in one or more **batches** (`package_session`), one per **session × level**. Most courses need none: without `sessions` / `levels`, `create_course` sends `contain_levels: false` and admin-core creates the single hidden DEFAULT × DEFAULT batch.

- `create_course(levels: ['Class 9', 'Class 10'])` → DEFAULT session, one batch per level.
- `create_course(sessions: [{name: '2026-27', start_date?, levels?}], levels?)` → one batch per session × level. A session without its own levels gets the top-level `levels`, else the DEFAULT level.
- **Reuse:** `{id}` for an existing session / level (validated against the institute's own, from `courses(sessions_levels)`); a new **name** that already exists in the institute is reused by admin-core. An existing level is sent **without** its name, because admin-core renames a level to whatever name accompanies its id.
- **The payload is the dashboard wizard's** (`components/common/study-library/-utils/helper.ts`): `contain_levels: true`, `sessions: [{id, session_name, new_session, start_date, levels: [{id, new_level, level_name, group, …}]}]`.
- **Content is shared** by all batches: subjects and chapters are created with every batch id in `commaSeparatedPackageSessionIds` (as the dashboard does), and `add_chapter` maps new chapters to every batch.
- **Invites are per batch:** `create_invite` needs `batch_ids` when a course has several (it refuses to guess the class / year), and several ids make one bundled invite. `make_default` and the `create_payment_plan` swap cover every batch the invite enrols into. `courses(get / invites)` list the batches, the invites' batches and the batches still without a default invite.

## 4. Persistence mapping (what `create_course` / `add_slide` call)

| Step | Endpoint |
| :--- | :--- |
| Course | `POST /admin-core-service/course/v1/add-course/{instituteId}`. Body: `new_course:true`, `force_new_course:true`, `contain_levels:false`, `status:"DRAFT"`, `is_course_published_to_catalaouge:false`, `course_depth`, copy fields. The response is the package id. |
| Batch | `GET /admin-core-service/course/v1/{courseId}/batches`: the ACTIVE `package_session` id. |
| Subject | `POST /admin-core-service/subject/v1/add-subject?commaSeparatedPackageSessionIds=` |
| Module | `POST /admin-core-service/subject/v1/add-module?subjectId=&packageSessionId=` |
| Chapter | `POST /admin-core-service/chapter/v1/add-chapter?subjectId=&moduleId=&commaSeparatedPackageSessionIds=` with `chapter_order` |
| Document / PDF | `POST /admin-core-service/slide/v1/add-update-document-slide`, `document_slide.type` = `HTML` / `PDF` |
| Video | `POST /admin-core-service/slide/video-slide/add-or-update`, `source_type:"VIDEO"`, `embedded_type:"YOUTUBE"` |
| Quiz | `POST /admin-core-service/slide/quiz-slide/add-or-update` (MCQS, MCQM, TRUE_FALSE, ONE_WORD, LONG_ANSWER, NUMERIC kept as-is, with correct answers as option ids) |
| Question | `POST /admin-core-service/slide/question-slide/add-or-update` |
| Assignment | `POST /admin-core-service/slide/assignment-slide/add-or-update` |
| Order / discard | `PUT /admin-core-service/slide/v1/update-slide-order`, `PUT /admin-core-service/slide/v1/update-status?status=DELETED` |

Every slide call passes `chapterId, moduleId, subjectId, packageSessionId, instituteId`, a client-generated UUID `id`, `new_slide:true` and `status:"DRAFT"`.

**Depth → hidden levels:**

| Depth | Subjects | Modules | Chapters |
| :--- | :--- | :--- | :--- |
| 2 | one `DEFAULT` | one `DEFAULT` | one `DEFAULT` |
| 3 | one `DEFAULT` | one `DEFAULT` | real |
| 4 | one `DEFAULT` | real | real |
| 5 | real | real | real |

`DEFAULT`-named levels are hidden by the learner app.

Reads (`list`, `get`, invites, enrollment counts) are SQL on the shared database, scoped to the pinned institute through `package_institute`, the same way `find_batch` reads. Single-entity content reads go through admin-core with the caller's JWT.

## 5. Content contract highlights (served by `schema`)

**Document slides** are one self-contained HTML document, rendered by the learner app in `sandbox="allow-scripts allow-popups"` (an opaque origin).

- Inline CSS/JS is allowed; https CDN fonts/scripts are allowed.
- Rendering-safety rules are copied from the in-house generator.
- `window.parent.postMessage({type:'vacademy:complete', score, maxScore}, '*')` reports interactive results.
- Images must be institute media URLs (`import_image`). `data-img-prompt` placeholders are rejected, because no image generator runs.
- Limit: 400 KB.

**Quiz:** questions of type `MCQS | MCQM | TRUE_FALSE | ONE_WORD | LONG_ANSWER | NUMERIC`, each with HTML text, options, correct answers by option index, an explanation, and quiz-level settings (time limit, marks, negative marking, pass %, re-attempts).

**Video:** a YouTube (or https video) URL. The LLM supplies it; the server does no search.

**PDF:** an https PDF imported into media.

**Assignment:** HTML instructions, optional live/end dates, re-attempt count, total/passing marks.

## 6. Safety summary

| Write | Why it is allowed without a confirm card |
| :--- | :--- |
| `course_edit` | Draft-only: creates DRAFT courses/slides and edits only DRAFT items. Publishing goes through the dashboard approval. |
| `course_drip_edit` | Only on courses that are not ACTIVE (no live learners). Never touches the institute switches. |
| `course_invites_edit` | Additive: new invites and new plans. Re-pointing an invite and making it default are only allowed while the course is not ACTIVE. |

Identity is pinned: `institute_id` and `user_id` come from the principal. Every course, chapter, slide and invite id is checked against the pinned institute before use. All calls are audited by the MCP adapter.

## 7. Not in v1

- Editing invites, payment plans or drip rules of ACTIVE courses (dashboard).
- Coupons, donation plans, CPO instalments, autopay and sub-org invite settings.
- AI video / AI slides / storybooks (in-house pipeline only).
- Assessment-service assessments (inline quiz/question/assignment slides instead).
- Knowledge-base retrieval as a tool action (open question: it costs one embedding call per lookup).
