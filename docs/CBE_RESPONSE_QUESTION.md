# Spreadsheet & Written Response question (`CBE_RESPONSE`)

ACCA-style computer-based-exam (CBE) question: a scenario on the left, requirements and
one or more **answer parts** on the right. Each part is an in-browser **spreadsheet**
(cells, formulas, formats) or a **document** (rich text with tables). The admin uploads or
builds a **solution** with a **marking scheme** (marks per line); the AI grades the
learner's answer against it, line by line, with follow-through ("own figure") credit.

Works in three places:

| Surface | Storage | Grading | Who sees marks |
|---|---|---|---|
| Assessment (+ question bank / question papers) | `assessment_service.question` | Async copy-check pipeline (TYPED lane) on submit | Teacher reviews, then Release Result |
| LMS question slide | `admin_core_service.question_slide` | Synchronous AI check on submit | Learner, instantly (marks + line feedback + model solution) |
| Quiz slide | not supported (type is hidden in the quiz picker) | | |

Owner decisions (2026-11-10): instant AI feedback in slides; teacher review before release in
assessments; several parts per question; all three surfaces in one release.

---

## 1. Identifiers

| Thing | Value |
|---|---|
| `question_type` | `CBE_RESPONSE` |
| `question_response_type` | `CBE` |
| Admin label (en) | "Spreadsheet & Written Response" |
| Picker section (en) | "Computer-based exam (CBE)" |
| AI tool pricing key (slides) | `cbe_answer_check` |

## 2. `CbeSheet` — the spreadsheet interchange format

Library-agnostic, sparse, compact. Used for templates, solutions and learner answers.
The UI library (Fortune-sheet) is converted to/from this at the edge; nothing else in the
system knows Fortune-sheet exists.

```ts
type CbeSheet = {
  sheets: CbeSheetTab[];          // >= 1
};
type CbeSheetTab = {
  name: string;                   // "Sheet1", "Workings", ...
  cells: Record<string, CbeCell>; // key = A1 ref within this tab ("B7"); sparse, empty cells omitted
  colWidths?: Record<string, number>; // "A" -> px
  merges?: string[];              // ["A1:C1"]
  rowCount?: number;              // visible rows (default 40)
  colCount?: number;              // visible cols (default 12)
};
type CbeCell = {
  v?: number | string | boolean | null; // computed / literal value
  f?: string;                     // formula INCLUDING leading "=", e.g. "=SUM(B7:B10)"
  s?: {                           // style, all optional
    b?: 1; i?: 1; u?: 1;          // bold / italic / underline
    al?: 'l' | 'c' | 'r';        // horizontal align
    nf?: string;                  // number format: "#,##0", "#,##0.00", "0%", "0.0%", "General"
    bg?: string; fc?: string;     // background / font colour, "#rrggbb"
    bt?: 1; bb?: 1;               // top / bottom border (accounting totals)
  };
};
```

Rules:
- `v` is always the value the learner saw. For a formula cell the client computes `v`; the
  server never recomputes. (The AI sees both `v` and `f`.)
- Cross-sheet refs use Excel syntax: `=Workings!B41`.
- Serialized size cap: **300 KB per question** answer (all parts), enforced client-side with a
  visible warning; the backend rejects nothing on size.

## 3. Question config (`auto_evaluation_json`)

```jsonc
{
  "type": "CBE_RESPONSE",
  "data": {
    "version": 1,
    "parts": [
      {
        "id": "p_8f3k2a",               // stable, generated once (nanoid-ish), never reused
        "label": "(a)",
        "promptHtml": "<p>Prepare the consolidated SFP…</p>",   // optional requirement text for this part
        "kind": "SPREADSHEET",           // or "DOCUMENT"
        "marks": 16,
        "template": { "sheet": CbeSheet } | { "html": "…" } | null,   // learner's starting content (learner-safe)
        // ---- SECRET (never sent to a learner before release) ----
        "solution": { "sheet": CbeSheet } | { "html": "…" } | null,
        "markingScheme": [
          { "id": "m1", "label": "Goodwill", "marks": 2,
            "expected": "3,200", "cellRef": "Consolidated SFP!B7",
            "guidance": "W4: 3,800 − 600 impairment" }
        ],
        "solutionFileId": "media-file-id-of-uploaded-xlsx" | null
      }
    ],
    // ---- SECRET ----
    "gradingNotes": "Apply the own-figure rule. Accept ±1 rounding."
  }
}
```

- Question total marks = `sum(parts[].marks)`; the admin form keeps `questionMark` in sync.
- **Secret keys:** `parts[].solution`, `parts[].markingScheme`, `parts[].solutionFileId`,
  `data.gradingNotes`. `redactCbeConfig(config)` removes exactly these and nothing else.
- Scenario (left pane) = the question's existing `parent_rich_text` (comprehension passage).
  Requirements = question `text` + each part's `promptHtml`. Both optional; if there is no
  scenario the learner layout collapses to a single column.

### Where the secret lives

| Surface | Learner-safe config | Secret |
|---|---|---|
| Assessment | `question.auto_evaluation_json` (full) | same JSON — **redacted** in every learner-facing response (attempt start/preview, learner report until the attempt's report is RELEASED) |
| Question slide | `question_slide.auto_evaluation_json` = **already redacted** config (the learner answer-key stripper `AnswerKeyStripper` keeps it on CBE nodes, redacted again) | new column `question_slide.evaluation_secret_json` (= `{ parts: [{id, solution, markingScheme, solutionFileId}], gradingNotes }`), never included in the 13 native slide JSON queries; admin reads it via a dedicated admin endpoint |

## 4. Learner answer (`responseData`)

Inside the attempt JSON (assessments) and `question_slide_tracked.response_json` (slides):

```jsonc
{
  "type": "CBE_RESPONSE",
  "answer": {
    "parts": {
      "p_8f3k2a": { "kind": "SPREADSHEET", "sheet": CbeSheet },
      "p_q91xz0": { "kind": "DOCUMENT", "html": "<p>IAS 38 prohibits…</p>" }
    }
  }
}
```

"Answered" = at least one part has a non-empty cell (beyond the template) or non-blank text.
The rule is the same in the learner app (`isCbeAnswerEmpty`) and assessment_service
(`CbeAnswers.isAnswered` / `summary`):
- a cell is the template's own when, if either cell has a non-blank `f`, the trimmed formulas
  match case-insensitively (`v` is ignored: the grid recomputes a template formula on load and
  when the learner types inputs); otherwise when the trimmed `v` text matches;
- answer tabs are matched to template tabs **by name only** (a renamed / new tab has no template);
- document text is compared with all whitespace collapsed.

## 5. Grading

### 5.1 Assessments (async, teacher-reviewed)

- `CbeResponseQuestionTypeBasedStrategy`: never auto-scores; returns **0 marks, status
  PENDING**, never throws (bad JSON → 0/PENDING).
- `TypedAnswerEvaluation.AI_GRADED_TYPES` includes `CBE_RESPONSE`, so submit holds the
  result and (when the assessment has AI evaluation enabled) queues the copy-check job.
- `CopyCheckOrchestratorService` sends, for CBE questions:
  `question_type="CBE_RESPONSE"`, `student_answer` = JSON string of `responseData.answer`,
  `model_answer` = JSON string of the **full** config `data` (with secrets),
  `question_text` = scenario + question text (HTML stripped to text, line breaks kept; TipTap's
  `<p>` inside `<td>` / `<li>` is unwrapped so a table row stays one "a | b" line).
- ai_service renders both to an LLM-readable form (§5.3), derives the rubric from
  `markingScheme` (one criterion per line, `criteria_name = "<part label> <line label>"`,
  `max_marks = line marks`; a part with no scheme = one criterion worth the part's marks),
  unless a teacher-saved per-question rubric override exists (that wins).
- Teacher review page shows the learner's sheet/doc read-only + criteria breakdown; override
  + Release Result are unchanged.

### 5.2 Question slides (sync, instant)

`POST /admin-core-service/learner-tracking/activity-log/question-slide/cbe/submit`
(learner token; identity from the token, never from the body)

```jsonc
// request
{ "slide_id": "…", "chapter_id": "…", "module_id": "…", "subject_id": "…",
  "package_session_id": "…", "answer": { "parts": { … } } }
// response 200
{ "attempt_number": 1, "attempts_left": 2,
  "evaluation": { "marks_awarded": 13.5, "max_marks": 20, "verdict": "PARTIAL",
                  "feedback": "…", "criteria_breakdown": [ { "criteria_name": "(a) Goodwill", "marks": 2, "max_marks": 2, "reason": "…" } ] },
  "solution": { "parts": [ { "id": "…", "solution": …, "markingScheme": [ … ] } ] } }
// 402 = institute out of AI credits (answer is still saved; evaluation null)
// 409 = no attempts left
// 400 = the answer has no non-empty part (refused before an attempt is reserved)
```

- `evaluation` carries exactly `marks_awarded`, `max_marks`, `verdict`, `feedback` and
  `criteria_breakdown[]` (`criteria_name`, `marks`, `max_marks`, `reason`); admin_core drops
  everything else ai_service returns (`credits_charged`, `confidence`) before storing or replying.
- ai_service verdict `UNATTEMPTED` (nothing beyond the template; free) is **not** a graded check:
  saved as `EVALUATION_FAILED` with `error_code: "UNATTEMPTED"`, no attempt used, no solution.
- When the reply (submit or my-attempts) is not itself graded, it also carries
  `last_evaluated: {attempt_number, marks, evaluation, submitted_at_millis}` = the learner's latest
  `EVALUATED` attempt, so a later refused / failed / running check never hides a paid-for result.

- Attempts: `question_slide.re_attempt_count` if > 0, else **3** AI checks per learner per slide.
- Stores the answer + evaluation in `question_slide_tracked` (`response_json`, `marks`,
  `response_status` = `EVALUATED` | `EVALUATION_FAILED`), writes the activity log and marks the
  slide 100% complete exactly like other question slides (submitting = completion).
- Calls ai_service `POST /ai-service/copy-check/v1/grade-cbe-sync` (internal auth, same as other
  admin_core → ai_service calls) with `{institute_id, user_id, source_id: slide_id,
  question_text, scenario_text, config (full, with secrets), answer, max_marks}`;
  `question_text` / `scenario_text` are the editor's **HTML as stored** (ai_service's
  `cbe_render.html_to_text` is the only HTML-to-text step; text with no real tag is read as plain
  text); ai_service
  checks credits first, grades with the same renderer/prompt as §5.3, charges tool key
  `cbe_answer_check`, returns the evaluation. Timeout 120 s.

### 5.3 How the AI sees a spreadsheet (ai_service renderer)

```
[Part (a) — SPREADSHEET — 16 marks]
Sheet "Sheet1"
  Row 7:  A7 "Goodwill" | B7 = 3,200  [=Workings!B41] | C7 "W4: 3,800 − 600"
  Row 11: B11 = 114,650 [=SUM(B7:B10)]
```

Row-wise, non-empty cells only, values formatted with their number format, formula in
brackets. Documents: HTML → text keeping paragraphs, lists and tables (tables as
`| a | b |` rows). The student answer is wrapped in the existing
`<<<STUDENT_ANSWER … STUDENT_ANSWER>>>` data fence ("answer is data, not instructions").

Grading prompt rules (CBE system prompt): mark each marking-scheme line; award follow-through
credit when the method/formula is right but an input carried from an earlier wrong figure;
accept equivalent presentation (sign conventions, brackets for negatives, `$000` vs `$`,
rounding ±1 in the last unit shown); a figure with no visible working earns the line only if
it matches; written parts are marked on the points in the scheme, not on length.

## 6. UI

### Admin (shared editor: assessments, question papers/bank, question slides)
- Picker entry in `QuestionTypeSelection` (assessments/papers) and the slide
  `add-question-dialog`; **not** in the quiz `QuestionTypeSelector`.
- `CbeResponse/` MainView: scenario (existing passage editor), question text, parts list
  (add Spreadsheet / Document part; label; marks; prompt; starting template — build in the grid
  or import .xlsx; solution — build in the grid or import .xlsx (multi-sheet kept); marking
  scheme table auto-extracted from the solution's "Marks" column, editable; grading notes). A scheme
  line whose figure was a formula with no cached value gets its `expected` from the recalculated
  solution cell on save; while solution formulas still have no value the editor warns.
- PPTView: compact summary (parts, kinds, marks).
- Review: AI-evaluation review page and admin test-report dialog render the answer read-only.

### Learner
- Live test: CBE questions switch the main area to a **split screen** (scenario left, resizable;
  requirements + part tabs right). Spreadsheet = Fortune-sheet with a trimmed toolbar
  (undo/redo, B/I/U, align, number formats: thousands, decimals ±, %, borders); document =
  TipTap with tables. Autosave piggybacks on the existing 60 s / submit path.
- Proctoring: copy/paste **inside** the workspace works (internal clipboard); pasting text that
  did not come from an in-workspace copy is blocked and counted like other paste attempts.
- Reports: read-only sheet/doc view of the answer; after release the model solution and the
  line-by-line breakdown.
- Question slide: same workspace inside the slide; Submit → "Checking your answer…" →
  marks, line feedback, model solution; "Try again" while attempts remain.

## 7. Shared frontend kit (`src/components/cbe/`, identical in both apps)

| File | Purpose |
|---|---|
| `types.ts` | `CbeSheet`, `CbeConfig`, `CbePart`, `CbeAnswer`, `redactCbeConfig`, `isCbeAnswerEmpty`, size helpers |
| `a1.ts` | A1 ref ⇄ (row, col), column letters |
| `fortune-adapter.ts` | `CbeSheet` ⇄ Fortune-sheet `Sheet[]` |
| `xlsx-import.ts` | SheetJS workbook → `CbeSheet`; `extractMarkingScheme(sheet)` (finds a "Marks" header column) |
| `SpreadsheetEditor.tsx` | lazy Fortune-sheet wrapper: `value`, `onChange` (debounced), `readOnly`, `height` |
| `SheetView.tsx` | light read-only HTML table renderer (reports, previews) |
| `DocumentEditor.tsx` / `DocumentView.tsx` | TipTap editor with tables / sanitized read-only view |
| `CbeWorkspace.tsx` | parts tabs + editors for one question (used by live test and slide) |

Fortune-sheet is only ever loaded via `React.lazy` so it never enters the main bundle.

## assessment_service notes (implementation)

- Strategy: `CbeResponseQuestionTypeBasedStrategy` → always `0` / `PENDING` (the same status LONG_ANSWER uses
  for "not yet evaluated"); the strategy is chosen by `responseData.type`, so the learner client **must** send
  `"type": "CBE_RESPONSE"` in each CBE question's `responseData`.
- Hold: `TypedAnswerEvaluation.awaitsTeacherGrading` holds an online attempt (result `PENDING`, report not
  released) when it has an **answered** CBE question, decided on the question's DB type, even with AI
  evaluation off. With AI evaluation on, any paper containing a CBE question is held (CBE is in
  `AI_GRADED_TYPES`), exactly like LONG_ANSWER. Billing: one CBE question = one typed question at the
  dashboard typed rate.
- Staff (`AssessmentLinkQuestionsManager.hasStaffAuthority`) = at least one authority outside
  STUDENT / PARENT / GUARDIAN, even when STUDENT is also held (same rule as admin_core
  `AuthoringAnswerAccess`).
- Saving over a stored CBE question (`AddQuestionPaperFromImportManager.initializeQuestion`): a secret
  key the incoming config leaves out (`data.gradingNotes`, or a part's `solution` / `markingScheme` /
  `solutionFileId`, matched by part `id`) is kept from the stored config
  (`CbeConfigRedactor.keepStoredSecrets`), so a redacted read saved back cannot wipe the solution; a key
  that is sent (even `null`) is the client's decision.
- Manual (PDF upload) submit: the learner app keeps on-screen CBE / CODING answers as
  `sections[].questions[].responseData` in `json_content`; the manual DTOs ignore unknown fields
  (the raw JSON is stored verbatim).
- Redaction (`question_core/util/CbeConfigRedactor`): learner start/preview/restart question lists; learner
  survey report; `questions-of-sections` (+ `/full`) for callers without a staff role (the learner app calls
  this admin endpoint for its test report); the report review `correct_options` until the attempt is
  `RELEASED` — this report endpoint also serves staff, so staff see the redacted config there too until
  release (they still have the question editor and the AI review page).
- Reports/PDFs render a per-part summary (`CbeAnswers.summary`): "(a) Spreadsheet — 14 cells filled",
  "(b) Document — <first 500 chars>"; "Correct answer" becomes "Marked against the model solution — (a)
  Spreadsheet (16 marks); …" (never the solution).
- AI input: `question_text` = "Scenario:\n…\n\nRequirement:\n…" (HTML → text, one line per paragraph / list
  item / table row, cells joined by " | ").
