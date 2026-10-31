# AI Evaluation: End to End

How Vacademy grades subjective answers with AI. This covers handwritten answer copies
(scanned PDFs) and essays or emails typed in the online test player. It walks through
how a check starts, every step the AI takes, how results reach the teacher and the
student, what the institute is charged, and where it breaks.

**State as of 1 Oct 2026.** Code facts are read from `main`. The rate card is the live
`ai_tool_pricing` row on that date. Re-check prices before quoting them to a customer.

---

## Contents

1. [Summary](#1-summary)
2. [Two modes: handwritten copy and typed answer](#2-two-modes-handwritten-copy-and-typed-answer)
3. [Architecture](#3-architecture)
4. [Setting up an assessment](#4-setting-up-an-assessment)
5. [How a check starts](#5-how-a-check-starts)
6. [Queue, dispatch and self-healing](#6-queue-dispatch-and-self-healing)
7. [The handwritten copy pipeline, step by step](#7-the-handwritten-copy-pipeline-step-by-step)
8. [The typed answer pipeline](#8-the-typed-answer-pipeline)
9. [Results coming back: callbacks, totals, statuses](#9-results-coming-back-callbacks-totals-statuses)
10. [Teacher review, notifications and release](#10-teacher-review-notifications-and-release)
11. [What the student sees](#11-what-the-student-sees)
12. [Bulk AI check](#12-bulk-ai-check)
13. [Credits: what the institute pays](#13-credits-what-the-institute-pays)
14. [What drives the cost](#14-what-drives-the-cost)
15. [Models](#15-models)
16. [Data model](#16-data-model)
17. [API reference](#17-api-reference)
18. [Configuration](#18-configuration)
19. [Troubleshooting](#19-troubleshooting)
20. [Known issues and open items](#20-known-issues-and-open-items)
21. [Code map](#21-code-map)

---

## 1. Summary

- **Two modes.** *COPY* grades a scanned handwritten answer sheet (PDF). *TYPED* grades
  Long Answer questions a student typed in the online player.
- **One engine.** Both run in `ai_service` (Python). `assessment_service` (Java) owns the
  data, the queue, the callbacks and the release. Handwritten copies also go through
  `render_worker` for page images and line positions.
- **Default model: `z-ai/glm-5.3-flash`** on OpenRouter. It reads handwriting from the
  page images and grades each question against a rubric that is generated once per
  question and then reused for every student.
- **The AI never publishes a result.** Marks land as a draft. The teacher gets a bell
  alert and an email, reviews and overrides marks if needed, then presses **Release
  Result**. Only then does the student see marks and the checked copy.
- **Price: 1 credit per copy + 0.2 credit per question, rounded up.** It is charged per
  question, not per page. 1 credit = ₹0.93 to the institute. Failed and cancelled checks
  are free.
- **Timing.** A copy usually takes 1–8 minutes. A typed answer takes about 20 seconds.

---

## 2. Two modes: handwritten copy and typed answer

| | **COPY** (handwritten) | **TYPED** (online essay/email) |
|---|---|---|
| Input | Scanned PDF of the answer sheet | Text from the Long Answer box in the online player |
| Assessment setup | Result type **Manual** (evaluation type MANUAL), so the player becomes PDF upload | Result type **not** Manual (evaluation type AUTO) + "Evaluate submissions with AI" ON + at least one Long Answer question |
| Questions graded | Every question on the paper | Only `LONG_ANSWER` questions. MCQ and other objective questions keep their normal auto-marks. |
| Steps | OCR geometry → vision read → quality gate → Mathpix → locate → grade → enforce → annotate | Grade only |
| Output | Marks per question + a checked PDF with red-pen ticks, crosses, notes and the total | Marks and feedback per question. No PDF. |
| Model answer | Optional, from the ai_service rubric store | The Long Answer editor's **Answer** field is sent as the reference |
| Started by | Teacher (single or bulk), learner submit (if AI is ON) | Learner submit or test timeout (if AI is ON) |
| Typical time | 1–8 min | ~20 s |
| Live since | Sept 2026 (current engine from 9 Sep; locate pass from 21 Sep) | 26 Sep 2026 (PR #3016). First prod smoke test passed 30 Sep. |

---

## 3. Architecture

```
 Admin dashboard                Learner app
 (teacher)                      (student)
     │ trigger / bulk / review       │ submit (PDF or typed)
     ▼                               ▼
┌──────────────────────── assessment_service (Java) ────────────────────────┐
│ AiEvaluationService ── AiEvaluationSubmissionEnqueuer ── CopyIntakeService │
│        │                         │                          │             │
│        ▼                         ▼                          ▼             │
│   ai_evaluation_process (PENDING) ◄── AiEvaluationQueuePoller (15 s, cap 3)│
│        │                                                                  │
│   CopyCheckOrchestratorService.dispatch ──► POST /copy-check/grade ───────┼──┐
│                                                                           │  │
│   CopyCheckCallbackService ◄── progress / question / complete / failed ◄──┼──┤
│   AiEvaluationCompletionNotifier (bell + email + workflow event)          │  │
│   AssessmentParticipantsManager.releaseParticipantsResult (Release)       │  │
└───────────────────────────────────────────────────────────────────────────┘  │
                                                                               │
┌──────────────────────── ai_service (Python) ◄─────────────────────────────────┘
│ copy_check/orchestrator ── rubric ── render_client ──► render_worker (OCR geometry)
│        │                    vision_transcript ──► OpenRouter (GLM-5.3-flash)
│        │                    mathpix_fallback  ──► Mathpix
│        │                    locate / grader / validator / enforce / annotator
│        └── ai_billing.record_tool_billing ──► admin_core credits ledger
│        └── annotated PDF ──► media_service (S3)
└──────────────────────────────────────────────────────────────────────────────
```

Data lives in two databases:
- **assessment_service:** process, question rows, layout, intake batches.
- **admin_core_service:** credits ledger, token usage, pricing, model catalogue, and the
  rubric tables `copy_check_rubric` and `copy_check_question_answer`.

---

## 4. Setting up an assessment

### 4.1 Handwritten copies (COPY)

1. **Step 1, "Result & Evaluation Type"** has four options: `AUTO_AFTER_SUBMISSION`,
   `AUTO_AFTER_ASSESSMENT_END`, `NO_AUTO_RELEASE` and `MANUAL`.
   - Choose **Manual**. The payload then sends `evaluation_type = MANUAL`, which turns the
     learner player into PDF-upload mode.
   - A "Submission Type" select appears for Manual.
2. **The paper needs real questions.** A test that only contains the "Upload your answer
   sheet" placeholder cannot be AI-checked; `requireGradableQuestions` refuses it.
   - The **Enable AI checking** banner on the Submissions tab fixes this. It reads the
     attached question paper into questions (paper digitise). That is charged once, from a
     server estimate.
3. **Optional:** turn on **"Evaluate submissions with AI"** in Step 1
   (`assessment.ai_evaluation_enabled`). Every learner PDF upload is then queued for AI
   checking automatically. Without it, the teacher starts checks by hand.

### 4.2 Typed essays and emails (TYPED)

1. **Step 1:** pick any result type **except Manual**, and turn **"Evaluate submissions
   with AI" ON**.
   - Hint text: *"Grade each submission automatically when it is submitted. Uses institute
     credits per question graded; a teacher still reviews and releases the result."*
2. **Step 2:** Create Manually → question type picker → **Writing Skills → Long Answer**.
   It has three fields: Question, **Answer**, Explanation.
   - The **Answer** field is the model answer. It is stored in
     `auto_evaluation_json.data.answer.content` and sent to the grader as a reference, not
     as wording the student must match.
   - It is optional; without it the AI grades on the rubric alone.
   - The same picker is used in the Question Bank.
3. **On submit,** the attempt is held: `result_status = PENDING`,
   `report_release_status = PENDING`, no auto-release. The student sees "Results pending"
   until the teacher releases.

> **Nuance:** with `AUTO_AFTER_ASSESSMENT_END`, the end-of-exam cron releases COMPLETED
> attempts. AI-graded typed attempts therefore release at exam end without review. This
> behaviour pre-dates the AI feature for that result type.

---

## 5. How a check starts

| # | Trigger | Where | What happens |
|---|---|---|---|
| 1 | **Teacher, one copy** | Submissions tab → row ⋯ → Evaluate/Revaluate → **Evaluate with AI**. Shown only for Manual-evaluation tests. | Dialog with model picker (default GLM-5.3-flash), "Estimated cost: N credits" and balance. `POST …/evaluation-ai/trigger-evaluation`, then the teacher lands on the progress/review page. **Dispatched immediately** after commit; the row is stamped `claimed_by='direct'` so the poller does not dispatch it again. |
| 2 | **Auto on learner submit** | `AiEvaluationSubmissionEnqueuer`, called at the end of every learner submit | Queued (PENDING) only if all hold: global switch `on-submit-enabled` (default true), assessment `ai_evaluation_enabled = TRUE` (NULL = off), the attempt has an uploaded sheet **or** is a typed attempt awaiting AI, and no active run exists. Runs in its own transaction and never throws, so it cannot break a submit. |
| 3 | **Test timeout** | `AssessmentAttemptEndTaskExecutor` | Queues timed-out **typed** attempts only. |
| 4 | **Bulk: upload a pile** | Submissions → **Upload & check copies** | Reads each student's name from the copy, matches, queues. See §12. |
| 5 | **Bulk: student-submitted copies** | Submissions → **Check submitted copies with AI**, or select rows → Bulk actions → **Check with AI** | Queues the learners' own uploaded PDFs. See §12. |
| 6 | **Retry** | AI Evaluations list (`/assessment/evaluation-ai?assessmentId=`) → Retry on a FAILED row; bulk panel → Retry | Calls trigger again. A new run is allowed once the old one is terminal. |

**Idempotency.** `initiateEvaluationForAttempt` returns the existing run if the attempt
already has one in PENDING, STARTED, PROCESSING, EXTRACTING or EVALUATING. A double click
or a submit retry never pays twice.

**Stop.** `POST …/evaluation-ai/stop/{processId}` does four things:
- sets a cancel flag;
- forwards the cancel to ai_service;
- marks the run `CANCELLED` (step `STOPPED`);
- cancels every unfinished question.

ai_service checks the flag at every stage (rubric, OCR wait, each vision page, each
question, before annotating) and stops within seconds. **A cancelled run is not charged.**

---

## 6. Queue, dispatch and self-healing

### 6.1 Poller (`AiEvaluationQueuePoller`)

- Runs every **15 s** (first tick after 30 s).
- Claims up to `room = min(batch size, max-in-flight − in-flight)` rows with one atomic
  `UPDATE … FOR UPDATE SKIP LOCKED`, oldest first. Two pods never take the same row.
- A claim older than 15 min is offered again.
- Prod values: **`max-in-flight = 3`**, **`poller-batch-size = 3`**. The cap exists because
  there is one ai-service pod (1.5 CPU / 3 Gi) and one render worker. Three copies overlap
  well (one in OCR, two grading); more just fight for CPU.
- Teacher-triggered runs skip the queue but still count against the cap.
- The model sent is `assessment.ai_evaluation_model`, or the teacher's pick for a manual
  trigger.

### 6.2 Dispatch (`CopyCheckOrchestratorService.dispatch`)

1. **Typed attempt too young.** If it was submitted less than 10 min ago and its
   per-question rows are not written yet (the async submit job is still running), the run
   is unclaimed and retried on a later tick.
2. Status → `PROCESSING`, step `DISPATCHED`, `started_at = now`.
3. **COPY:** fetch a public URL for `attempt_data.fileId` from media service; failure →
   FAILED. **TYPED:** keep only LONG_ANSWER rows; none → FAILED.
4. Sort questions into **paper order** (section order, then question order). Set
   `questions_total`. Create one `ai_question_evaluation` row per question (PENDING).
5. Build the request:
   - top level: `process_id`, `attempt_id`, `assessment_id`, `institute_id`,
     `answer_mode` (COPY/TYPED), `pdf_url` (null for TYPED), `preferred_model`,
     `callback_base_url`;
   - per question: `question_id`, `question_text`, `question_type`, `max_marks`,
     `options`, `correct_answer`, `question_number`, `section`, and **`paper_label`** (the
     number as printed on the paper, from the digitised `source_meta.question_number`,
     else its position);
   - TYPED only: `student_answer` (from `question_wise_marks.response_json →
     responseData.answer`) and `model_answer` (the Answer field, HTML stripped);
   - `correct_answer` is the option key or text answer, and always null for Long Answer.
6. `POST {ai_service}/ai-service/copy-check/grade` with `X-Internal-Service-Token`.
   ai_service answers immediately with a `job_id` and runs the job in the background.
   The run gets `ai_service_job_id`, step `AI_SERVICE_SUBMITTED`.

### 6.3 Stale-job sweeper (`AiEvaluationStaleJobSweeper`)

- Every 5 min it looks at in-flight runs (never PENDING ones; waiting for the cap is not
  being stuck).
- A run whose `updated_at` is older than **20 min** (prod) goes back to PENDING, with step
  `REQUEUED`, `retry_count + 1`, and the claim and job id cleared.
- After **2** requeues it becomes FAILED with step `TIMED_OUT`.
- ai_service posts a **heartbeat every 60 s** (`COPY_CHECK_HEARTBEAT_SECONDS`) so a long
  vision read does not look dead.

### 6.4 render_worker capacity

`MAX_CONCURRENT_JOBS = 2` is shared by **every** render job kind: slide renders, KB
indexing, transcription and PDF OCR. When full it answers 429. ai_service then retries
every 10 s for up to 10 min, still honouring cancel, instead of failing the copy.

Throughput: about 3 copies in parallel. 100 copies take roughly 2–3 hours, and the first
results appear within about 10 minutes.

---

## 7. The handwritten copy pipeline, step by step

All in `ai_service/app/services/copy_check/orchestrator.py`. The step names in capitals
are the progress callbacks the teacher's progress bar shows.

```
0. Rubrics ──► 1. OCR geometry ──► 2. Vision read ──► 3. Quality gate ──► 4. Mathpix
   (once per      LAYOUT_OCR_STARTED   HANDWRITING_READ   (unreadable =        (≤ 4 crops)
    question)                                              fail, no guess)
                                                                LAYOUT_OCR_DONE
──► 5. Locate ──► 6. Grade each question ──► 7. Enforce ──► 8. Annotate ──► 9. Complete ──► 10. Bill
   (≥ 4 pages)     GRADING, one callback     (one score,     red-pen PDF     totals +       once per
                   per question              one note)       → media         file id        process
```

### Step 0: Rubrics (once per question, reused for every copy)

- **Resolution order:** per-question override → the assessment's fixed rubric → generate
  a new one.
- **Generated rubrics:**
  - are stored in `copy_check_rubric` (admin_core DB) with first-writer-wins, so two
    copies starting together cannot invent two different rubrics;
  - get 1 criterion for objective questions (has options, or max marks ≤ 1);
  - get 3–5 criteria for subjective questions;
  - have criterion marks rescaled to sum exactly to `max_marks`.
- **Guidance prose is qualitative only, with no mark figures.** Figures in prose once
  capped a 10-mark question at about 6.5, because they were written for a different total.
- If generation fails, a single "Correctness" criterion is used.
- **Model answers** come from `model_answers_json`, overridden per question by
  `copy_check_question_answer`. A stored model answer beats the one in the request.
- Each question callback carries the `rubric_version` used.
- Rubrics can be viewed and edited through `/assessment-service/copy-check/rubric/…`.

### Step 1: OCR geometry (render_worker)

- The PDF is rendered at **200 DPI**. Each page is deskewed, denoised and contrast-boosted
  (CLAHE).
- **RapidOCR** is the primary engine (since 12 Sep). **PaddleOCR** is a fallback when
  RapidOCR finds fewer than 3 lines on a page.
- The worker is polled every 3 s, with a 5 min job timeout.
- **Only the geometry is kept**, meaning where the lines are on the page. Printed-text
  OCR cannot read handwriting: before 9 Sep, its output had the grader inventing answers
  from garbage text.
- Lines with OCR confidence below 0.60 are flagged `needs_math_fallback`.

### Step 2: Vision read (the actual handwriting reading)

- Model fixed to **GLM-5.3-flash**, whatever model the teacher picked.
- **Per page:**
  - pages are rasterised at 200 DPI, resized to a 1600 px long edge, JPEG quality 80;
  - **3 pages at a time**, at most **40 pages** (later pages keep raw OCR text);
  - temperature 0.1, max 4,000 tokens.
- **Rows:**
  - OCR word boxes are merged into true visual rows by geometry alone;
  - the model rewrites each row's text verbatim, and may add up to 8 lines per page that
    OCR missed;
  - blank rows are dropped;
  - row ids stay stable, so the annotator can later put a tick on the right line.
- The prompt forbids inventing text. Pages that fall back to raw OCR are labelled
  unreliable for the grader.

### Step 3: Quality gate

- A page is legible if it has **≥ 120 characters** and was not marked illegible.
- The copy is gradeable only if legible pages ≥ half the pages.
- Otherwise the run **fails with a clear error and is not charged**. The AI never guesses
  marks for an unreadable copy.

### Step 4: Mathpix fallback

Up to **4 crops per copy**: the rows still flagged for math, weakest first. Mathpix
LaTeX replaces those rows' text. This needs `MATHPIX_APP_ID/KEY`.

### Step 5: Locate (which page holds which answer)

- **Skipped for copies under 4 pages.**
- One GLM call (temperature 0) gets every page's text (capped at 2,400 chars per page)
  plus the question list, and returns `{question_id: [pages]}`.
- If it placed fewer than a quarter of the questions, the result is ignored.
- Each question is then graded against **its located pages ±1**. An unplaced question
  gets the window between its placed neighbours in paper order.
- **Safety net:** if a narrowed grade says "unattempted" (and the locator did not
  explicitly say the question has no answer), the question is **re-graded against the
  whole copy**. A locator miss can never zero a student.
- **Why it exists:** before 21 Sep, every grading call carried the full transcript of
  every page. A 100-question / 40-page copy cost about ₹16; with locate it is about ₹4.6.

### Step 6: Grade each question

**One call per question:** temperature 0.1, max 8,000 tokens. Inputs are the question,
the printed paper label, the rubric, the model answer, and the transcript of that
question's pages.

**Key prompt rules:**
- Match the answer **by content**, not by the student's own numbering.
- `extracted_answer` must be the student's words verbatim, **never the printed question
  text**. Printed rows are tagged as such.
- **Never invent an answer.** If a page was not read properly, give low confidence.
- On narrowed pages: if the answer is not there, return "unattempted"; do not guess.
- Marks in **0.5 steps**, with exactly one score annotation and one deduction note.

**Retries and repairs:**
- Confidence below **0.60**: the question is re-asked, at most twice per copy.
- Unparseable JSON: one re-prompt at temperature 0.
- Criteria summing to 0 while marks are above 0: one re-ask.
- A question that errors out is retried once on the default model, then marked FAILED.

**Token budget:**
- warning at 80k tokens;
- hard cap of **max(250k, 7k × questions)** per copy, covering vision, locate, rubric and
  grading together.

**Validator** (`validator.py`):
- converts marks given as words, percentages or "2/3" into numbers;
- floors negative marks at 0 and caps marks at the maximum;
- rescales criteria to match the awarded mark and rounds to 0.5;
- strips mark figures from notes;
- anchors each annotation to a row, by id, then quoted text, then position.

Each verdict is posted straight away (`/callback/question`), so the teacher sees marks
fill in live.

### Step 7: Enforce

`enforce.py` guarantees one score and one deduction note per question, applies the
praise rules, and builds the grand-total annotation (max = sum of question max marks).

> Enforcement runs **after** the per-question callbacks. The annotation JSON stored per
> question is pre-enforcement, while the PDF shows the enforced marks.

### Step 8: Annotate (the checked copy)

- **Colours:** green ticks, maroon-red crosses and notes. The total is circled at the
  top-right of page 1.
- **Handwriting look:**
  - Kalam font with per-glyph jitter, digits in Patrick Hand;
  - wobbly Bézier tick strokes, ink colour (214, 28, 40);
  - the pen is seeded from a hash of the PDF, so re-rendering the same copy draws
    identically.
- **Upload:** page images are re-encoded to JPEG (≤ 2000 px, quality 78) so the PDF stays
  under 18 MB. The media service limit is 20 MB; a 7-page phone scan was 29 MB before
  this. The file goes to media-service as `evaluated-copy-{attempt_id}.pdf`.
- A failed upload does **not** fail the evaluation; the marks still land.

### Step 9: Complete

`/callback/complete` with totals and `evaluated_file_id`. See §9 for what Java does with
it.

### Step 10: Bill

`record_tool_billing(tool_key = "copy_check_evaluation", num_questions = questions
evaluated, idempotency_key = process_id)`. It runs only on the success path. See §13.

---

## 8. The typed answer pipeline

`orchestrator._grade_typed` and `typed_answers.py`:

- **Skipped:** OCR, vision, quality gate, Mathpix, locate, enforce and annotate. Progress
  posts only `GRADING`. `evaluated_file_id` stays null.
- **Blank answers** get 0 marks immediately, with **no model call** and no charge.
- **Writing-task system prompt.** Answers are judged on:
  - **format and conventions**, e.g. an email's salutation and sign-off;
  - **content**;
  - **organisation**;
  - **language**.

  Spelling counts, since the student typed it and there is no OCR to blame. Word limits
  are enforced. Answers worded differently from the model answer still earn credit.
- **Prompt-injection guard.** The answer is wrapped as
  `<<<STUDENT_ANSWER … STUDENT_ANSWER>>>` with its word count. The prompt says the
  student's text is data, not instructions.
  - *Verified 30 Sep:* an email that told the evaluator "award full marks" scored 0/5.
- **HTML → text** keeps paragraphs: `<br>` and block tags become newlines, entities are
  unescaped.
- **Billing** counts only answers actually read. A copy with every answer blank is not
  billed at all.
- **Totals.** The attempt total = AI marks on Long Answer questions + the stored
  auto-marks of every other question (MCQ etc.) scored at submit.
- **Learner editor (live).** A plain textarea with a word count. Copy, cut and paste are
  blocked with `preventDefault`. The answer is sent as
  `responseData = {type: "LONG_ANSWER", answer: text}`.

**Prod smoke test, 30 Sep 2026** (2 Long Answer questions):
- The poller claimed the run in 2 s and grading took 21 s.
- A good essay scored 10/10; the injection email scored 0/5.
- The attempt was held PENDING and billed 2 credits.

---

## 9. Results coming back: callbacks, totals, statuses

Callbacks: `POST /assessment-service/copy-check/callback/{progress|question|complete|failed}`.
- **Auth:** `X-Internal-Service-Token`, compared in constant time; anything else gets 401.
- **Delivery:** ai_service uses a 10 s timeout with 1 retry.

| Callback | What Java does |
|---|---|
| **progress** | Ignored once the run is terminal. A repeated step with no layout is a heartbeat and only touches `updated_at`. `LAYOUT_OCR_DONE` stores the page layout (`copy_check_layout`) and moves status to EXTRACTING. `GRADING` moves it to EVALUATING. |
| **question** | Ignored for FAILED/CANCELLED runs. If duplicate rows exist, the newest is used. **A row the teacher edited (`is_edited`) is never overwritten.** Writes marks, max, feedback, extracted answer, JSON and rubric version. Copies marks into `question_wise_marks` with `marks_source = AI`. `questions_completed` increments only on the first terminal write, so retries are safe. |
| **complete** | Ignored for reaped runs. Run → COMPLETED. **If the attempt is already RELEASED, it is not touched.** Otherwise the attempt total is recomputed from COMPLETED rows (the AI's own total is ignored) and written to `total_marks` and `result_marks`. **If any question is not COMPLETED, the attempt stays EVALUATING** with a partial total, so "23/100" never goes out when only 60 questions were graded. `evaluated_file_id` is set when present. |
| **failed** | Run → FAILED with the error (a CANCELLED run stays cancelled). |

**Statuses.** `ai_evaluation_process.status` runs PENDING → PROCESSING → EXTRACTING →
EVALUATING → **COMPLETED / FAILED / CANCELLED**.

`current_step` carries the detail: `DISPATCHED`, `AI_SERVICE_SUBMITTED`,
`LAYOUT_OCR_STARTED`, `HANDWRITING_READ`, `LAYOUT_OCR_DONE`, `GRADING`, `REQUEUED`,
`TIMED_OUT`, `STOPPED`. The progress bar is `questions_completed / questions_total`
(`GET …/evaluation-ai/progress/{processId}`).

---

## 10. Teacher review, notifications and release

### 10.1 Completion alert (`AiEvaluationCompletionNotifier`)

- Runs every 60 s and groups finished runs **per assessment**.
- Announces when the newest run settled 2+ minutes ago and nothing is still running for
  that assessment, or when the oldest has waited 30 minutes.
- **Claimed with `notified_at IS NULL`**, so each run is announced once even with
  several pods.
- **Recipients** (de-duplicated):
  - the teacher who triggered it (`triggered_by`);
  - the assessment's creator and evaluator;
  - the institute's ADMIN users.

  Named users get the email only if they are also admins.
- **Channels:**
  - bell alert;
  - email (source `AI_COPY_CHECK`): *"Review the marks, then press Release Result —
    learners see nothing until you do"*;
  - workflow event **`ASSESSMENT_AI_EVALUATION_COMPLETED`** with total, checked, failed
    and needs-review counts, mode `AUTO_ON_SUBMIT` or `TEACHER_TRIGGERED`, and a link to
    the submissions page.
- Bulk-intake runs are skipped here. Their batch sends one notice of its own (§12).

### 10.2 Review page (`/assessment/evaluation-ai/$attemptId/$processId`)

- **Live progress:** polls every 6 s. Shows status, a completed/total bar, a **Stop**
  button, and stat cards for total, percentage, completed and pending.
- **Answer Sheet panel:** the raw sheet while the run is going, then the **server-rendered
  checked PDF** once it completes.
- **Per question:**
  - marks, with "Edited" and "Needs review" badges;
  - the question, the correct answer, the student's extracted answer and the feedback;
  - a criteria breakdown table.
- **Override:** Edit / Grade manually → marks + feedback → **Save marks**. This calls
  `PUT …/evaluation-ai/review/{processId}/question/{questionId}`.
  - Marks are clamped to [0, max] and the row becomes `is_edited`, so later AI runs leave
    it alone.
  - `question_wise_marks.marks_source` becomes `AI_REVIEWED`.
  - The attempt total is recomputed. The attempt becomes COMPLETED once nothing is
    ungraded.
- **AI Evaluations list** (`/assessment/evaluation-ai?assessmentId=`): every run for the
  assessment, polling every 8 s while any is active, with **Retry** on FAILED rows.
- **There is no Release button on the review page.** Release happens on the Submissions
  tab.

### 10.3 Release

**Entry points:** Submissions tab →
- row ⋯ → **Release Result**;
- select rows → Bulk actions → **Release Result**;
- the global **Release result** button.

All three call `POST /assessment-service/admin/participants/release-result`
(`AssessmentParticipantsManager.releaseParticipantsResult`, async).

For each attempt:
- `report_release_status = RELEASED` and the release date are set.
- **Email:**
  - for **Manual** (copy) tests, the **checked copy PDF** is attached;
  - for **Auto** (typed) tests, a generated report PDF is attached;
  - an attempt with no checked copy is still released, just without the email.
- **Workflow event `ASSESSMENT_RESULT_RELEASED`**, once per learner. Admin → Automations →
  trigger "Assessment Result Released" → Send WhatsApp / Email / push node.
  - **Context keys:** `studentName`, `studentEmail`, `studentMobile`, `marks`,
    `totalMarks`, `percentage`, `rank`, `percentile`, `reportPdfFileId`,
    `checkedCopyFileId`, `attemptId`, `assessmentName`, `evaluationType`, `resultType`,
    and more.
  - Releasing again **re-sends**: the default idempotency is per emit. Use CONTEXT_BASED
    on `attemptId` for once per student.

---

## 11. What the student sees

What the student sees is decided by `student_attempt.report_release_status`. The AI never
changes it.

| Status | Assessment card | Reports tab | Admin "Result Status" |
|---|---|---|---|
| `PENDING` | Amber **"Results pending"** chip | **"Pending evaluation"**, marks hidden, report buttons disabled | "Not released" |
| `RELEASED` | Result shown | Marks, report, checked copy | "Released" |
| `NULL` (legacy) | "Results pending" | Row missing (list filters `IN (RELEASED, PENDING)`) | "Not available" |

The rules are enforced **server-side**, not only in the UI.
- `LearnerReportService.isHeldManualResult` refuses report detail, comparison, annotated
  copy and PDF ("Result has not been released yet") in two cases:
  - the status is PENDING, on any result type;
  - the result type is MANUAL and the attempt is not RELEASED.
- The list query also hides `total_marks` on held Manual rows.

Uploaded copies (single offline entry and bulk intake) and AI-held typed attempts are all
created as `PENDING`.

---

## 12. Bulk AI check

### 12.1 Upload a pile (source `UPLOAD`)

1. **Upload.** The teacher drops up to **200 PDFs** of at most 60 MB each (dialog limits;
   the server accepts up to 500).
   - The files go browser → S3, then `POST …/copy-intake/v1/start`.
   - The dialog shows: *"N copies · Q questions each · C credits"*, *"Rate: 1 + 0.2
     credits per question, per copy"*, the balance, and an "Email me when done" checkbox.
2. **Identify.** For each copy, ai_service `POST /copy-check/identify` reads the **top
   42% of page 1** at 110 DPI.
   - Falls back to all of page 1, then page 2's header. Stops at confidence ≥ 0.75.
   - Returns name (plus a Latin transliteration), roll number, class/section and
     confidence.
   - About 5 s per copy. **Not charged.**
3. **Match** (`StudentNameMatcher`) against registered participants and batch learners:

   | Situation | Result |
   |---|---|
   | Unique roll number | MATCHED |
   | Shared roll number | AMBIGUOUS |
   | No name read, or best score < 0.80 | UNMATCHED |
   | Runner-up within 0.08 of the best, or best < 0.88 | AMBIGUOUS |
   | Otherwise | MATCHED |

   A second copy for the same student is parked AMBIGUOUS. **The system never guesses a
   student.**
4. **Queue.** A matched copy becomes an offline attempt (status PENDING), the file is
   attached, and the check is queued. The poller paces the batch.
5. **Settle and notify once.** The batch becomes `COMPLETED` or `NEEDS_REVIEW`. The
   creator gets a bell alert, an email (if ticked) and the
   `ASSESSMENT_AI_EVALUATION_COMPLETED` event with counts.
6. **Resolve.** The teacher handles waiting copies in the **Bulk checks** panel: *Pick
   student* (with scored suggestions), *Skip* or *Retry*.

### 12.2 Check copies students already uploaded (source `SUBMITTED`)

- `POST …/copy-intake/v1/submitted/preview|start`. This uses `ENDED` attempts that have
  an uploaded file and no active run.
- Already-checked copies are skipped unless "re-check" is ticked. Re-checking overwrites
  marks.
- Nothing needs identifying: items start QUEUED, the poller paces them, and one batch
  notice goes out at the end.
- Entry points: **Check submitted copies with AI** (whole assessment), or select rows →
  **Check with AI**.
- Typed attempts are not included (no file). They are checked automatically on submit.

---

## 13. Credits: what the institute pays

### 13.1 Rate card

Live row in `admin_core_service.ai_tool_pricing`:

| tool_key | flat_base_credits | per_unit_credits | unit |
|---|---|---|---|
| `copy_check_evaluation` | **1** | **0.2** | questions |

**Quote per copy = ceil(1 + 0.2 × questions).** The same rate applies to TYPED.

- **It is per question, not per page.** A 20-question paper costs the same whether the
  student wrote 5 pages or 25. The price is known before the test, and every student pays
  the same.
- **To change it,** edit the DB row; no deploy is needed. `tool_cost_estimator.py`'s
  `DEFAULT_TOOL_PRICING` is only a fallback for an environment without the row. The admin
  UI caches the rate for 10 minutes.

| Questions on paper | Credits per copy | Institute pays (₹0.93/credit) |
|---|---|---|
| 1–5 | 2 | ₹1.86 |
| 10 | 3 | ₹2.79 |
| 15 | 4 | ₹3.72 |
| 20 | 5 | ₹4.65 |
| 30 | 7 | ₹6.51 |
| 43 | 10 | ₹9.30 |
| 50 | 11 | ₹10.23 |
| 64 | 14 | ₹13.02 |
| 100 | 21 | ₹19.53 |

### 13.2 The charging rule

```
charged = max( quote , actual )
quote   = ceil(1 + 0.2 × questions)
actual  = 0.10 + (real token cost in USD × 150)
150     = credit_rate_config: 100 credits per USD × (1 + 50% margin)
```

- **On the default GLM model the quote always wins;** the actual is well below it.
- **On an expensive model the actual wins.** A 1-question copy graded on GPT-5.4 was
  billed **18.58 credits** instead of the quote of 2.
- **Questions counted:**
  - **COPY:** every question sent, including ones the student skipped or that failed.
  - **TYPED:** only answered questions; an all-blank attempt is free.
- **Free:**
  - failed checks;
  - cancelled checks;
  - unreadable copies (the quality gate fails them);
  - name identification in bulk uploads.
- **Charged once per process** (idempotent on `process_id`), after completion. A billing
  error never fails a delivered evaluation.
- **No server-side balance check before grading.** The charge may take the balance
  negative (`allow_negative = True`). The UI warns when the quote exceeds the balance, but
  a bulk run can overdraw mid-batch.
- **Customer price:** 1 credit = $0.01 / ₹0.93 (packs from 500 credits = ₹465).

---

## 14. What drives the cost

The institute price is fixed per question (§13). The token spend behind a copy depends on:

| Factor | Effect |
|---|---|
| Model | **Biggest lever.** Ultra models (Gemini 3.1 Pro $2/$12, GPT-5.4 $2.5/$15, Claude Opus 4.5 $5/$25 per 1M tokens) cost 30–100× GLM-5.3-flash ($0.075/$0.25). On those models the actual cost beats the quote and the institute pays far more. Keep the GLM default. |
| Pages | The vision read runs once per page (about 1,600 tokens per page) whatever the question count. The locate pass keeps grading narrow: each question sees only its pages ±1. |
| Questions | One grading call per question. |
| Retries | Low-confidence escalation (max 2 per copy), JSON repair and requeues add calls. |

Outside the token count:
- **Mathpix:** at most 4 crops per copy, only for unsure math lines. Billed by Mathpix
  directly, not recorded in `ai_token_usage`.
- **render_worker OCR:** runs on our own pod, with no per-call charge.
- **Name identification (bulk):** about 1k tokens per copy. Not charged to the institute.
- **A requeued run** (sweeper, §6.3) can spend tokens twice, but is billed once.

Real spend per run is in `ai_token_usage` (`request_type = evaluation`, `total_price`).

---

## 15. Models

| Use | Model | Can the teacher change it? |
|---|---|---|
| Handwriting vision read | `z-ai/glm-5.3-flash` (fixed) | No |
| Locate pass | `z-ai/glm-5.3-flash` (`DEFAULT_MODEL`) | No |
| Rubric generation | `preferred_model`, else GLM | Yes (picker) |
| Grading | `preferred_model`, else GLM; escalation and retry on GLM | Yes (picker) |
| Typed grading | Same as grading | Via the assessment's `ai_evaluation_model` |
| Name identification | GLM (picker model as fallback) | No |

- **Picker:** the admin FE lists five models. The default is `DEFAULT_EVALUATION_MODEL =
  'z-ai/glm-5.3-flash'` (`ai-center/-types/ai-models.ts`). The single-copy picker, the
  trigger default and the retry button all use it.
- **GLM quirk (never remove):** `chat_llm_client.py` pre-seeds GLM with reasoning
  `{"enabled": true, "effort": "low"}`.
  - The endpoint refuses reasoning off.
  - With no reasoning key it spends the whole `max_tokens` thinking and returns an empty
    answer.
  - Reasoning calls also get extra token headroom.

---

## 16. Data model

**assessment_service DB**

| Table / column | Purpose | Migration |
|---|---|---|
| `ai_evaluation_process` | One AI run over one attempt: status, step, progress, error, `ai_service_job_id`, `claimed_by/at`, `retry_count`, `triggered_by`, `notified_at`, `updated_at` (heartbeat) | V2, V4, V10, V43, V48 |
| `ai_question_evaluation` | One row per question per run: marks, max, feedback, `extracted_answer`, `evaluation_result_json`, status, `rubric_version`, `is_edited/edited_by/edited_at` | V4, V10, V22 |
| `question_wise_marks` | `marks`, `marks_source` (`AI` / `AI_REVIEWED`), `ai_evaluated_at`, `ai_evaluation_details_json`, `evaluator_feedback` | V2, V22 |
| `copy_check_layout` | Page geometry and rows the annotator draws on | V10 |
| `assessment.ai_evaluation_enabled`, `ai_evaluation_model` | Auto-on-submit opt-in (NULL = off) and model | V43 |
| `ai_copy_intake_batch` / `ai_copy_intake_item` | Bulk batches and each file; `source` UPLOAD/SUBMITTED | V46, V49 |
| `student_attempt` | `attempt_data.fileId` (copy), `evaluated_file_id` (checked copy), `total_marks`, `result_marks`, `result_status`, `report_release_status` | — |

**admin_core_service DB**

| Table | Purpose |
|---|---|
| `copy_check_rubric`, `copy_check_question_answer` | Rubrics and model answers (V314) |
| `ai_tool_pricing` | Rate card (`copy_check_evaluation`) |
| `credit_rate_config` | USD → credits (100 + 50% margin = 150) |
| `ai_models` | Model catalogue, token prices, tier, active |
| `ai_token_usage` | Tokens and USD per run (`request_type = evaluation`) |
| `credit_transactions` | Ledger: `USAGE_DEDUCTION`, `reference_id`, `model_name` |
| `institute_credits` | Balance |

---

## 17. API reference

**assessment_service, teacher-facing** (prefix `/assessment-service/assessment/evaluation-ai`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/trigger-evaluation` | Start AI check for attempt id(s) with a model |
| POST | `/stop/{processId}` | Cancel a run |
| GET | `/processes` | Runs for an assessment |
| GET | `/progress/{processId}` | Status, step, completed/total, file id |
| GET | `/completed-questions/{processId}` | Per-question verdicts |
| PUT | `/review/{processId}/question/{questionId}` | Teacher override (marks + feedback) |
| GET | `/gradable` | Does this assessment have real questions? |
| POST | `/adopt-questions` | Retrofit digitised questions into a placeholder test |

**Bulk** (prefix `/assessment-service/assessment/copy-intake/v1`):
- `POST /start`
- `POST /submitted/preview`, `POST /submitted/start`
- `GET /batches`, `GET /batch/{id}`
- `POST /item/{id}/resolve`, `POST /item/{id}/skip`, `POST /item/{id}/retry`

**Release:** `POST /assessment-service/admin/participants/release-result`.

**Rubrics** (pass-through to ai_service): `/assessment-service/copy-check/rubric/{assessmentId}`
(GET/POST/DELETE) and `/rubric/{a}/question/{q}` (PUT/DELETE).

**Internal callbacks:** `/assessment-service/copy-check/callback/{progress,question,complete,failed}`.

**ai_service** (prefix `/ai-service/copy-check`, all require `X-Internal-Service-Token`):
- `POST /grade`
- `POST /identify`
- `POST /{job_id}/cancel`, `POST /by-process/{process_id}/cancel`
- `GET /{job_id}/status`
- rubric CRUD

---

## 18. Configuration

**assessment_service** (`application-prod.properties`; stage and dev match)

```
assessment.ai-evaluation.poller-enabled=true
assessment.ai-evaluation.max-in-flight=3
assessment.ai-evaluation.poller-batch-size=3
assessment.ai-evaluation.stale-timeout-minutes=20
assessment.ai-evaluation.max-requeues=2
# code defaults (not set in any profile):
# use-ai-service=true, on-submit-enabled=true, poller interval 15 s,
# claim-stale-minutes=15, copy-intake parallelism 2/2, identify-stale 10 min, sweep 120 s
```

**ai_service:**
- `INTERNAL_SERVICE_TOKEN`
- `RENDER_SERVER_URL` / `RENDER_SERVER_KEY`
- `COPY_CHECK_HEARTBEAT_SECONDS` (60)
- `MEDIA_SERVER_BASE_URL`
- `MATHPIX_APP_ID` / `MATHPIX_APP_KEY`
- `OPENROUTER_API_KEY`
- pen rendering: `COPY_CHECK_PEN_STROKES`, `COPY_CHECK_HAND_RENDER`,
  `COPY_CHECK_HANDWRITING_FONT`

**render_worker:** `MAX_CONCURRENT_JOBS` (2), `RENDER_KEY`.

**Deploys:**
- assessment_service: Flyway runs on boot.
- `Deploy AI Service` is path-filtered to `ai_service/**`.
- `Deploy Render Worker`.
- Admin FE via Cloudflare Pages from main.
- Learner app changes need an OTA push.

---

## 19. Troubleshooting

| Symptom | Look at | Usual cause |
|---|---|---|
| Nothing leaves PENDING | `kubectl logs deploy/assessment-service \| grep ai-eval-poller` | Poller disabled, cap full of stuck rows, or a tick crashing |
| FAILED "429" from render_worker | ai-service logs | All render slots busy (2, shared by every job kind). Client now waits up to 10 min. |
| FAILED, unreadable copy | process `error_message` | Quality gate: blurred or blank scan. Not charged. Ask for a re-scan. |
| FAILED `no file_id on attempt` | process error | Manual-evaluation attempt without an uploaded PDF |
| Run says "x/0" or has no job id while running | `ai_evaluation_process` | Dispatch/progress race (§20). Bookkeeping only; marks are fine. |
| Attempt stuck **EVALUATING** although all questions are graded | `ai_question_evaluation` rows per process vs distinct questions | Leftover PENDING duplicate rows after a requeue (§20). The total is correct. |
| Charged more than the quote | `credit_transactions.model_name` | A premium model was picked; the actual beat the quote |
| Marks look capped on one question | the rubric's guidance text | Mark figures in rubric prose after a re-weight. Re-author the rubric. |
| Learner sees "Upload Answer" on an MCQ test | `assessment.evaluation_type` | Result type saved as Manual |
| Checked copy missing but marks present | ai-service logs around the upload | Media upload failed; the evaluation still completes |
| Learner cannot see the result | `report_release_status` | Not released yet. Press Release Result. |

**Handy queries**

```sql
-- assessment_service: runs in flight
select status, current_step, count(*) from ai_evaluation_process group by 1,2;

-- assessment_service: duplicate question rows (rows <> distinct = duplicates)
select evaluation_process_id, count(*), count(distinct question_id)
from ai_question_evaluation group by 1 having count(*) <> count(distinct question_id);

-- admin_core_service: last 20 evaluation charges with real cost
select created_at, model, prompt_tokens, completion_tokens, total_price
from ai_token_usage where request_type = 'evaluation' order by created_at desc limit 20;

select created_at, -amount as credits, model_name, reference_id
from credit_transactions where request_type ilike '%eval%' order by created_at desc limit 20;

-- admin_core_service: live rate card
select * from ai_tool_pricing where tool_key = 'copy_check_evaluation';
```

---

## 20. Known issues and open items

| # | Issue | Impact | Status |
|---|---|---|---|
| 1 | **Requeue leaves duplicate question rows.** When the sweeper requeues a silent run, the re-dispatch creates a second set of question rows. One set completes and the other stays PENDING. Seen 1 Oct on a 43-question copy. | The total is correct, but the attempt shows **EVALUATING** instead of COMPLETED. Tokens may be spent twice; billed once. | Found 1 Oct; not fixed. Why the first run went silent is not yet known. |
| 2 | **Dispatch/progress race.** `onProgress` does a full-row save that can overwrite dispatch's fields (job id, started_at, questions_total). Seen in about half of the runs from 11–30 Sep. | Progress shows "x/0". In theory a copy running over 15 min could be dispatched twice. Marks are unaffected. | Decided 30 Sep: no fix unless a run exceeds 15 min |
| 3 | **Writing-integrity signals are not live.** PR #3017 was merged into its base branch, not into main. The signals are paste/drop blocking, typing counts, the fast-writing / similarity / AI-style flags, and the admin panel. | Typed answers have only basic copy/paste blocking. No integrity panel. | Needs a fresh PR from `feat/writing-integrity-signals` onto main |
| 4 | **No credit check before grading;** the balance can go negative. | A bulk run can overdraw an institute | Open |
| 5 | **Premium-model billing prices GLM vision and locate tokens at the premium rate** | Non-default model runs are billed slightly above their real token cost | Open |
| 6 | **COPY billing counts skipped and failed questions** | The institute pays for questions the AI could not grade | By design so far |
| 7 | **Enforcement runs after the per-question callbacks** | Stored annotation JSON can differ slightly from the PDF | Open |
| 8 | **The review override does not check RELEASED** (the complete callback does) | Editing marks after release changes released marks silently | Open |
| 9 | **"Enable AI checking" confirm text says "1 credit per question"** | Outdated copy; the real rate is 1 + 0.2/question | Fix the locale string |
| 10 | **Per-page pricing and "Edit copy & marks"** live only on `feat/copy-check-edit-and-per-page-credits` (14 Sep) | Not on main | Decide or close the branch |
| 11 | **Release email's "Download Report" button** has an empty link (the checked copy is attached) | Dead button in the email | Open |
| 12 | **Stale code comments:** grader token limits (says 20k/50k), "re-grade" in the Mathpix docstring, "PaddleOCR primary", "rubric cached via Java" | Misleading when reading code | Clean up |

---

## 21. Code map

**ai_service** (`vacademy_platform/ai_service/`)
- `app/routers/copy_check.py`: endpoints
- `app/schemas/copy_check.py`: request models (`answer_mode`, `GradeQuestionInput`)
- `app/services/copy_check/` contains:
  - `orchestrator.py`: the pipeline and the typed path
  - `vision_transcript.py`: handwriting read and quality gate
  - `locate.py`
  - `grader.py`, `prompt_builder.py`, `validator.py`
  - `rubric.py`
  - `mathpix_fallback.py`
  - `enforce.py`, `annotator.py`, `hand_render.py`
  - `identify.py`
  - `typed_answers.py`
  - `callbacks.py`, `cancellation.py`, `render_client.py`
- `app/services/tool_cost_estimator.py`, `ai_billing.py`, `credit_service.py`,
  `credit_rate_service.py`: pricing and billing
- `app/services/chat_llm_client.py`: OpenRouter client (GLM reasoning seed)
- `render_worker/pdf_ocr/`: rendering and OCR geometry

**assessment_service** (`…/features/assessment/`)
- `service/evaluation_ai/` contains:
  - `AiEvaluationService`
  - `AiEvaluationSubmissionEnqueuer`
  - `TypedAnswerEvaluation`
  - `CopyCheckOrchestratorService`
  - `AiEvaluationQueuePoller`, `AiEvaluationStaleJobSweeper`
  - `CopyCheckCallbackService`
  - `AiEvaluationCompletionNotifier`
  - `AiEvaluationReviewService`, `AiEvaluationProgressService`
- `controller/evaluation_ai/`: `AiEvaluationController`, `CopyCheckCallbackController`,
  `CopyCheckRubricController`
- `copy_intake/`: `CopyIntakeService`, `CopyIntakeRunner`, `StudentNameMatcher`,
  `CopyIntakeNotifier`
- `manager/AssessmentParticipantsManager.releaseParticipantsResult`: release
- `service/StudentAttemptService`: hold for AI
- `../learner_assessment/service/LearnerReportService`: learner gate

**Admin dashboard** (`frontend-admin-dashboard/src/`)
- `routes/assessment/create-assessment/…/Step1BasicInfo.tsx`: AI toggle and result type
- `routes/assessment/question-papers/…/LongAnswerType/`: Long Answer editor
- `…/$assessmentTab/-components/assessment-submissions-dropdown-individual/student-attempt-dropdown.tsx`:
  Evaluate with AI and Release
- `…/-components/copy-intake/BulkAiCheckDialog.tsx`, `CheckSubmittedCopiesDialog.tsx`:
  bulk checks
- `routes/assessment/evaluation-ai/`: list and review page
- `routes/ai-center/-types/ai-models.ts`: default model
- `components/common/ai-credits/useToolCostPreview.ts`: credit quote

**Learner app** (`frontend-learner-dashboard-app/src/`)
- `components/common/questionLiveTest/otherQuestionTypes/LongAnswerInput.tsx`
- `components/common/questionLiveTest/navbar.tsx`: submit, PDF upload mode
- `routes/assessment/examination/-utils/survey-card-state.ts`, `-components/AssessmentCard.tsx`:
  held results
- `routes/assessment/reports/-components/reportMain.tsx`: Reports tab
