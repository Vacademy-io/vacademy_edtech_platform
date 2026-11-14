# Assessment Feature — Knowledge Base

End-to-end reference for the Assessment subsystem: backend (`assessment_service`), admin authoring UI (`frontend-admin-dashboard`), and learner attempt UI (`frontend-learner-dashboard-app`). Covers assessment creation, question linking, every supported question type, admin authoring flow, and learner attempt rendering/submission.

---

## 1. High-Level Architecture

```
┌─────────────────────────┐        ┌────────────────────────┐        ┌───────────────────────────┐
│   Admin Dashboard       │        │   assessment_service   │        │   Learner Dashboard       │
│   (4-step wizard)       │ ─────▶ │ (Spring Boot, JPA)     │ ◀───── │   (instructions → live    │
│   Authors assessment    │  REST  │ Stores assessments,    │  REST  │    test → submit → report)│
│   + sections + qns      │        │ sections, questions,   │        │                           │
│                         │        │ attempts, evaluation   │        │                           │
└─────────────────────────┘        └────────────────────────┘        └───────────────────────────┘
```

Key concept: **Questions live in a question bank** and are linked into an assessment's sections through a join entity. One question can be reused across many assessments/sections. Per-section metadata (order, time, marking) lives on the join, not on the question itself.

Core entity graph:

```
Assessment ──1:N──▶ Section ──1:N──▶ QuestionAssessmentSectionMapping ──N:1──▶ Question ──1:N──▶ Option
                                            (markingJson, order, time)              (textData, type, autoEvaluationJson)

Assessment ──1:N──▶ AssessmentUserRegistration ──1:N──▶ StudentAttempt
                                                            (attemptData JSON, status, marks)
```

---

## 2. Backend — `assessment_service`

Source root: `assessment_service/src/main/java/vacademy/io/assessment_service/features/`

### 2.1 Assessment entity

[Assessment.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/assessment/entity/Assessment.java)

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID String | PK |
| `name` | String | Assessment name |
| `about`, `instructions`, `registrationInstructions` | `AssessmentRichTextData` | Rich-text bodies |
| `playMode` | String | TEST / PRACTICE etc. |
| `evaluationType` | String | `AUTO` or `MANUAL` |
| `submissionType` | String | `AUTO_SUBMIT` / `MANUAL_SUBMIT` |
| `duration`, `previewTime` | Integer (mins) | Total / preview duration |
| `durationDistribution` | String | `ASSESSMENT` \| `SECTION` \| `QUESTION` |
| `canSwitchSection` | Boolean | Allow nav between sections |
| `canRequestReattempt`, `canRequestTimeIncrease` | Boolean | Learner asks for more |
| `assessmentVisibility` | String | `PUBLIC` / `PRIVATE` |
| `status` | String | `DRAFT` \| `PUBLISHED` \| `DELETED` |
| `boundStartTime`, `boundEndTime` | Date | Live window |
| `registrationOpenDate`, `registrationCloseDate` | Date | Registration window |
| `omrMode` | Boolean | OMR-style |
| `resultType` | String | `AUTO_AFTER_SUBMISSION` \| `AUTO_AFTER_ASSESSMENT_END` \| `MANUAL` |
| `reattemptCount` | Integer | Max reattempts |
| `assessmentType` | String | `EXAM` \| `MOCK` \| `PRACTICE` \| `SURVEY` \| `MANUAL_UPLOAD_EXAM` |
| `sections` | `Set<Section>` | Children |

Enums (in `assessment/enums/`):
- `AssessmentStatus`: DRAFT / PUBLISHED / DELETED
- `AssessmentTypeEnum`: EXAM / MOCK / PRACTICE / SURVEY / MANUAL_UPLOAD_EXAM
- `AssessmentVisibility`: PUBLIC / PRIVATE
- `ResultTypeEnum`: AUTO_AFTER_ASSESSMENT_END / AUTO_AFTER_SUBMISSION / MANUAL

### 2.2 Section entity

[Section.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/assessment/entity/Section.java)

| Field | Purpose |
|---|---|
| `name`, `description` (rich text), `sectionType` | Identity |
| `duration` | Section time (mins) |
| `marksPerQuestion`, `totalMarks`, `cutOffMarks` | Marking |
| `sectionOrder` | Display order |
| `problemRandomType` | `RANDOM` to shuffle questions |
| `assessment` | FK back to parent |
| `questionAssessmentSectionMappings` | Children |

### 2.3 Question ↔ Section join

[QuestionAssessmentSectionMapping.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/assessment/entity/QuestionAssessmentSectionMapping.java)

```
question (FK) | section (FK) | markingJson | questionOrder | questionDurationInMin | status
```

This is **the** linking table. Per-(section, question) data:
- `markingJson` — marking scheme (positive/negative/partial marks)
- `questionOrder` — order inside section
- `questionDurationInMin` — per-question time when `durationDistribution = QUESTION`

### 2.4 Question + Option entities

[Question.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/question_core/entity/Question.java) — fields:

| Field | Purpose |
|---|---|
| `parentRichText` | Comprehension/passage (only for C-prefixed types) |
| `textData` | Question body (rich text) |
| `mediaId` | Image/video reference |
| `questionType` | enum value (MCQS, MCQM, NUMERIC, …) |
| `questionResponseType` | response shape (OPTION, ONE_WORD, LONG_ANSWER, INTEGER, DECIMAL, …) |
| `accessLevel` | PUBLIC / PRIVATE |
| `autoEvaluationJson` | **Correct answer + grading rule** as JSON (see 2.6) |
| `optionsJson` | Options serialised inline (alongside the FK list) |
| `options` | `List<Option>` lazy-loaded |
| `evaluationType` | AUTO / MANUAL |
| `explanationTextData` | Solution rich text |
| `evaluationCriteriaJson`, `criteriaTemplateId` | AI/rubric-based evaluation |
| `difficulty`, `problemType`, `defaultQuestionTimeMins` | Metadata |

[Option.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/question_core/entity/Option.java) — `text` (rich), `mediaId`, `explanationTextData`, FK to question.

### 2.5 Question type enums

[QuestionTypes.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/question_core/enums/QuestionTypes.java):

```
MCQS, MCQM, ONE_WORD, LONG_ANSWER, TRUE_FALSE,
MATCH, FILL_IN_THE_BLANK, NUMERIC
```

The frontend additionally distinguishes **comprehension** variants (`CMCQS`, `CMCQM`, `CNUMERIC`) — backend stores them as the base type with a non-null `parentRichText`.

[QuestionResponseTypes.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/question_core/enums/QuestionResponseTypes.java):

```
OPTION, ONE_WORD, LONG_ANSWER,
SINGLE_DIGIT_NON_NEGATIVE_INTEGER, INTEGER, POSITIVE_INTEGER, DECIMAL
```

### 2.6 `autoEvaluationJson` shape — per type

All correct answers live in `Question.autoEvaluationJson`. Service: [QuestionEvaluationService.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/evaluation/service/QuestionEvaluationService.java).

| Type | DTO | JSON shape |
|---|---|---|
| MCQS / MCQM / TRUE_FALSE | `MCQEvaluationDTO` | `{ "type":"MCQ", "data":{ "correctOptionIds":[...] } }` |
| NUMERIC | `NumericalEvaluationDto` | `{ "type":"NUMERIC", "data":{ "validAnswers":[42.5, 42.0] } }` |
| ONE_WORD | `OneWordEvaluationDTO` | `{ "type":"ONE_WORD", "data":{ "answer":"photosynthesis" } }` |
| LONG_ANSWER | `LongAnswerEvaluationDTO` | `{ "type":"LONG_ANSWER", "data":{ "answer":{ "html":"…", "plainText":"…" } } }` |

> **Casing trap.** The nested `data` classes (`MCQData`, `NumericalData`) do **not**
> inherit the outer class's `SnakeCaseStrategy` — Jackson does not propagate
> `@JsonNaming` to nested static classes. A generator emitting `correct_option_ids`
> therefore bound to nothing and left the list `null`, which grading then dereferenced.
> Both now carry `@JsonAlias` for the snake_case spelling; **serialization is still
> camelCase**, so stored rows and the learner report renderer are unaffected.

Auto-graded: MCQS, MCQM, TRUE_FALSE, NUMERIC, ONE_WORD.
Manual-graded: LONG_ANSWER (and others when `evaluationType = MANUAL`).

### 2.7 Assessment creation API (4 steps)

Each step has its own controller and `submit` endpoint.

| Step | Endpoint | Manager |
|---|---|---|
| 1 — Basic details | `POST /assessment-service/assessment/basic/create/v1/submit` | `AssessmentBasicDetailsManager` |
| 2 — Add questions / sections | `POST /assessment-service/assessment/add-questions/create/v1/submit` | `AssessmentLinkQuestionsManager` |
| 3 — Add participants | `POST /assessment-service/assessment/add-participants/create/v1/submit` | (registration manager) |
| 4 — Access control | `POST /assessment-service/assessment/add-access/create/v1/submit` | (access manager) |
| Publish | `POST /assessment-service/assessment/publish/v1/{assessmentId}` | publish controller |

Step-2 payload uses [SectionAddEditRequestDto.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/assessment/dto/SectionAddEditRequestDto.java):

```
sectionName, sectionId, sectionDescriptionHtml,
sectionDuration, sectionOrder, totalMarks, cutoffMarks, problemRandomization,
questionAndMarking: [{ questionId, markingJson, questionDurationInMin,
                        questionOrder, isAdded, isDeleted, isUpdated }]
```

`AssessmentLinkQuestionsManager` classifies sections into **added / updated / deleted** and reconciles `QuestionAssessmentSectionMapping` rows accordingly.

### 2.8 Learner attempt — entities

[StudentAttempt.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/assessment/entity/StudentAttempt.java) — one row per attempt:

| Field | Purpose |
|---|---|
| `registration` | FK → `AssessmentUserRegistration` |
| `attemptNumber` | 1, 2, … |
| `previewStartTime`, `startTime`, `submitTime` | Timing |
| `maxTime` | Allowed seconds |
| `status` | `PREVIEW` \| `LIVE` \| `ENDED` |
| `attemptData`, `submitData` | **Answers JSON** (in-progress vs final) |
| `serverLastSync`, `clientLastSync` | Auto-save bookkeeping |
| `durationDistributionJson` | Per-section/question time spent |
| `totalMarks`, `totalTimeInSeconds`, `resultMarks`, `resultStatus` | Scoring |
| `reportReleaseStatus`, `reportLastReleaseDate` | Result release |
| `assessmentSetMapping` | Which set/variant the learner got |
| `commaSeparatedEvaluatorUserIds` | Manual graders |

[AssessmentUserRegistration.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/assessment/entity/AssessmentUserRegistration.java) — one per (user, assessment), holds `reattemptCount` quota and audit fields.

Enums: `AssessmentAttemptEnum` (PREVIEW/LIVE/ENDED), `AssessmentAttemptResultEnum` (PENDING/COMPLETED).

### 2.9 Learner attempt — API

[StudentAssessmentAttemptStartController.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/learner_assessment/controller/StudentAssessmentAttemptStartController.java)

| Endpoint | Purpose |
|---|---|
| `POST /assessment-service/assessment/learner/assessment-start-preview` | Begin preview (instructions + question list returned) |
| `POST /assessment-service/assessment/learner/assessment-start-assessment` | Transition PREVIEW → LIVE |

[StudentAssessmentStatusController.java](assessment_service/src/main/java/vacademy/io/assessment_service/features/learner_assessment/controller/StudentAssessmentStatusController.java)

| Endpoint | Purpose |
|---|---|
| `POST /assessment-service/assessment/learner/status/update` | Periodic auto-save of `attemptData` |
| `POST /assessment-service/assessment/learner/status/submit` | AUTO-evaluation final submit |
| `POST /assessment-service/assessment/learner/manual-status/submit` | MANUAL-evaluation submit |
| `POST /assessment-service/assessment/learner/status/restart` | Restart an ENDED attempt |

Auto-save / submit payload: `AssessmentAttemptUpdateRequest { jsonContent, setId }` where `jsonContent` is a stringified blob of section→question→answer.

### 2.10 Scoring pipeline

`StudentAttemptService` (`calculateTotalMarksForAttemptAndUpdateQuestionWiseMarks` etc.):

1. Parse `submitData` JSON.
2. For each question, fetch `Question.autoEvaluationJson` and grade based on type:
   - MCQ: set-equality / membership of `correctOptionIds`.
   - NUMERIC: match any of `validAnswers` (or range, depending on `numericType`).
   - ONE_WORD: case-insensitive match.
   - LONG_ANSWER: skip — flagged for manual grading.
3. Persist per-question marks to `QuestionWiseMarks`.
4. Aggregate into `StudentAttempt.totalMarks` / `resultMarks`.
5. Release report based on `Assessment.resultType`:
   - `AUTO_AFTER_SUBMISSION` → release immediately.
   - `AUTO_AFTER_ASSESSMENT_END` → release at `boundEndTime`.
   - `MANUAL` → wait for evaluator action.

Workflow events fire via `WorkflowTriggerClient` (e.g., `ASSESSMENT_CREATE`, submission, result release).

---

## 3. Admin Frontend — Authoring an Assessment

Source root: `frontend-admin-dashboard/src/routes/assessment/`

### 3.1 The 4-step wizard

Route: `/assessment/create-assessment/$assessmentId/$examtype` with `?currentStep=0..3`.

Wrapper: `create-assessment/$assessmentId/$examtype/-components/CreateAssessmentComponent.tsx` (sidebar + step router).

| Step | Component | What it captures |
|---|---|---|
| 0 — Basic Info | `Step1BasicInfo.tsx` | Name, subject, instructions (TipTap), live date range, preview toggle + duration, reattempt count, submission type, duration distribution, evaluation type, switch-section / reattempt-request / time-increase-request flags |
| 1 — Add Questions | `Step2AddingQuestions.tsx` + `Step2SectionInfo.tsx` | Sections (accordion); per section: name, description, duration, marks-per-question, negative/partial/cutoff marks, problem randomisation; question authoring per section |
| 2 — Add Participants | `Step3AddingParticipants.tsx` | Open registration form fields, batch + individual selection, notification settings, leaderboard visibility |
| 3 — Access Control | `Step4AccessControl.tsx` | Roles/users for: creation, live notification, submission/report, evaluation |

Schemas (Zod): `-utils/basic-info-form-schema.ts`, `section-details-schema.ts`, `add-participants-schema.ts`, `access-control-form-schema.ts`. State is per-step in Zustand stores under `-utils/zustand-global-states/`.

API wrappers: `-services/assessment-services.ts` (Step1–Step4 transformers + URLs).

### 3.2 Question authoring

Question authoring is **inline per section**, not via a centralised bank dialog.

In Step 2, each section offers three entry points:
1. **Create Manually** — opens `QuestionPaperUpload` (manual mode), then `QuestionPaperTemplate`.
2. **Choose Saved Paper** — pick a previously saved question paper.
3. **Generate from AI** — AI generation flow (`Step2GenerateQuestionsFromAI.tsx`).

Key files under `routes/assessment/question-papers/-components/`:

| File | Role |
|---|---|
| `QuestionPaperUpload.tsx` | DOCX/HTML import (with column-mapping pickers for question/options/answers/explanations) **or** manual creation toggle |
| `QuestionPaperTemplate.tsx` | The editable question list. Uses `useFieldArray`. Add/delete/reorder questions, switch types via popover, save via mutation |
| `QuestionTypeSelection.tsx` | Type picker shown when adding a question |
| `QuestionPaperTemplatesTypes/MainViewComponentFactory.tsx` | Routes the editor by `questionType` to the right `MainView` component |
| `QuestionPaperTemplatesTypes/PPTComponentFactory.tsx` | Same idea for the read-only/preview "PPT" view |
| `QuestionPaperTemplatesTypes/CollapsibleQuillEditor.tsx` | Used for Long Answer comprehension text |

Form-level question shape (kept on the React Hook Form node):

```
{
  questionId, questionName, explanation, questionType,
  questionMark, questionPenalty, questionDuration { hrs, min },
  singleChoiceOptions:   [{ name, isSelected }],   // MCQS
  multipleChoiceOptions: [{ name, isSelected }],   // MCQM
  trueFalseOptions:      [{ name: 'True'|'False', isSelected }],
  csingleChoiceOptions / cmultipleChoiceOptions,   // Comprehension variants
  validAnswers: number[],                          // NUMERIC
  subjectiveAnswerText: string,                    // ONE_WORD / LONG_ANSWER
  numericType: 'RANGE'|'EXACT', decimals,
  parentRichTextContent,                           // comprehension passage
  tags, level
}
```

Rich-text editor: **TipTap** via `components/editor/RichTextEditor.tsx`. Used for question body, options, explanation, comprehension passage, and section description.

### 3.3 Per-type authoring UI

Folder: `question-papers/-components/QuestionPaperTemplatesTypes/<Type>/`. Each has a `*MainView.tsx` (editor) and `*PPTView.tsx` (preview).

| Type | Folder | Inputs (admin sees) | Notes |
|---|---|---|---|
| **MCQS** — Single Correct | `MCQ(Single Correct)/` `SingleCorrectQuestionPaperTemplateMainView.tsx` | Question (RTE), 2–N options (RTE), green-check radio for the correct one, explanation (RTE), optional comprehension | If `examType === 'SURVEY'` correct-answer UI is hidden |
| **MCQM** — Multi Correct | `MCQ(Multiple Correct)/` | Same as MCQS but checkbox-style multi-select | |
| **TRUE_FALSE** | `TrueFalse/TrueFalseQuestionPaperTemplateMainView.tsx` | Question (RTE), fixed True/False options with isSelected, explanation | Modular helper subcomponents (`TrueFalseOption`, `ExplanationSection`, …) |
| **NUMERIC** | `NumericType/NumericQuestionPaperTemplateMainView.tsx` | Question, **multiple `validAnswers`**, numeric type (`RANGE` / `EXACT`), decimal precision, explanation | Re-validates on type switch; default `[0]` |
| **ONE_WORD** | `OneWordType/OneWordQuestionPaperTemplateMainView.tsx` | Question (RTE), single plain-text answer, explanation (RTE) | Single accepted answer (unlike NUMERIC) |
| **LONG_ANSWER** | `LongAnswerType/LongAnswerQuestionPaperTemplateMainView.tsx` | Question (RTE), sample answer (RTE — formatted), explanation, comprehension via `CollapsibleQuillEditor` | Manual evaluation downstream |
| **CMCQS** — Compr. Single Correct | `Comprehensive MCQ(Single Correct)/` | Mandatory passage (`parentRichTextContent`), question, options in `csingleChoiceOptions`, explanation | Backend stores as MCQS with non-null `parentRichText` |
| **CMCQM** — Compr. Multi Correct | `Comprehensive MCQ(Multiple Correct)/` | Same as CMCQS, multi-select via `cmultipleChoiceOptions` | |
| **CNUMERIC** | `ComprehensiveNumericType/` | Mandatory passage + NUMERIC answer config | |

### 3.4 Save flow

- **Step 1 → Step 4** each `POST` their slice to the matching `/v1/submit` endpoint via `assessment-services.ts` (Zod-validated, dates converted to UTC).
- **Section + questions** are persisted by Step 2's `add-questions/create/v1/submit`. `convertStep2Data()` + `classifySections()` diff old vs new to produce `added_sections`, `updated_sections`, `deleted_sections`.
- **Per-question persistence** (when QuestionPaperTemplate dialog is saved) goes through `question-paper-services.ts`:
  - `POST /assessment-service/question-paper/manage/v1/add`
  - `PATCH /assessment-service/question-paper/manage/v1/edit`
- After all 4 steps complete: `POST /assessment-service/assessment/publish/v1/{assessmentId}`.

---

## 4. Learner Frontend — Attempting an Assessment

Source root: `frontend-learner-dashboard-app/src/`

### 4.1 Flow

```
/assessment/examination/$assessmentId
    └─ InstructionPage (instructions + Start button)
        └─ StartAssessment dialog
            ├─ SURVEY  ─────────▶ /assessment/examination/$id/LearnerLiveTest
            └─ Regular ─────────▶ /assessment/examination/$id/assessmentPreview
                                    └─ countdown ends ─▶ Live Test (page.tsx)
                                                          ├─ navbar (timer, submit, tab-switch monitor)
                                                          ├─ section tabs
                                                          ├─ question-display
                                                          ├─ footer (prev/next, mark for review)
                                                          └─ sidebar / question-navigator (palette)
                                    └─ on submit ─▶ /assessment/reports/student-report
```

Key files:

| Concern | File |
|---|---|
| Instructions screen | `components/common/instructionPage/InstructionPage.tsx` |
| Start dialog (fullscreen + fetch preview) | `components/common/instructionPage/StartAssessment.tsx` |
| Preview countdown | `components/common/questionLiveTest/assessment-preview.tsx` |
| Live test container | `components/common/questionLiveTest/page.tsx` |
| Top bar / submit / tab-switch | `components/common/questionLiveTest/navbar.tsx` |
| Section tabs | `components/common/questionLiveTest/section-tabs.tsx` |
| Prev / next / mark-for-review | `components/common/questionLiveTest/footer.tsx` |
| Question palette (grid) | `components/common/questionLiveTest/question-navigator.tsx` |
| Sidebar | `components/common/questionLiveTest/sidebar.tsx` |

### 4.2 Per-type rendering

Switched in `components/common/questionLiveTest/question-display.tsx`:

| Type | Render | Capture |
|---|---|---|
| MCQS / TRUE_FALSE | Single-select radio styled as checkbox grid (lines ~249–300) | `optionIds: [singleId]` |
| MCQM | Multi-select checkbox grid | `optionIds: [...selected]` |
| NUMERIC | `otherQuestionTypes/numeric.tsx` — `NumericInputWithKeypad` | parsed `float` |
| ONE_WORD | `otherQuestionTypes/OneWordInput.tsx` — single-line input | `string`, copy/paste blocked |
| LONG_ANSWER | `otherQuestionTypes/LongAnswerInput.tsx` — textarea (rows=5) | `string`, copy/paste blocked |
| CMCQS / CMCQM | MCQS/MCQM grid wrapped in `ExpandableParagraph` (passage from `paragraph.tsx`) | same as MCQS/MCQM |
| Passage fetch | `otherQuestionTypes/paragraph.tsx` via `GET_TEXT_VIA_IDS` | n/a |

Anti-paste protections live in each input (`onCopy/onCut/onPaste preventDefault`).

### 4.3 State + persistence

Zustand store: `stores/assessment-store.ts`. Holds `answers`, `questionStates` (visited / answered / markedForReview), `sectionTimers`, `questionTimers`, `entireTestTimer`, `questionTimeSpent`.

Two-level persistence:
- **Local** every `LOCAL_SAVE_INTERVAL_MS` — Capacitor Storage key `ASSESSMENT_STATE_{assessmentId}_{attemptId}` (legacy fallback `ASSESSMENT_STATE_{attemptId}`).
- **Server** every `REMOTE_SAVE_INTERVAL_MS` — `POST /assessment-service/assessment/learner/status/update` with the formatted `jsonContent`.

`formatDataFromStore()` (in `page.tsx`) normalises answers per type before sending:
- NUMERIC → `parseFloat`
- ONE_WORD / LONG_ANSWER → `string`
- MCQS / MCQM → array of `optionIds`
- adds `questionTimeSpent` and `tabSwitchCount`

### 4.4 Anti-cheat / proctoring

Two layers. The first has always been there and is client-only; the second is the
per-assessment video proctoring added in V50 (see §4.4A).

`hooks/proctoring/useProctoring.ts` composes:
- `forceFullScreen`, `preventTabSwitch`, `preventContextMenu`, `preventUserSelection`, `preventCopy`
- `useCopyDisable`, `useFullScreenDetection`, `useTabFocusDetection`

Tab-switch handling in `navbar.tsx`:
- Increments `tabSwitchCount` on `visibilitychange`.
- Shows warning dialog.
- On 3rd violation (non-MANUAL evaluation) → auto-submit. The same effect also
  submits when the proctoring layer sets `proctorAutoSubmitRequested` (§4.4A).

### 4.4A Video proctoring (V50) — tier BASIC, "on-device AI, snapshots only"

Per-assessment, **off unless chosen**. `assessment.proctoring_config` is JSONB and
NULL for every assessment that predates V50 (and for any switched back to Off), so
nothing changes for an existing exam: no config → no camera prompt, no snapshots,
no events, and the `ProctorLayer` renders `null`.

```
{ "tier": "BASIC", "camera_required": true, "snapshot_interval_sec": 30,
  "face_check": true, "max_violations": 0, "show_self_view": true }
```

Tiers are an enum (`ProctoringTier`: NONE, BASIC). PRO / ULTRA are shown in the
wizard as "coming soon" and cannot be stored yet; adding one is a constant plus its
defaults in `ProctoringConfigDTO.defaultsFor`, not a schema change. Pricing text is
a translation key (`proctoring.tiers.<TIER>.price`).

**Why this tier is cheap.** Nothing streams. The learner's browser counts faces
locally (`lib/proctoring/face-detector.ts`: native `FaceDetector` → MediaPipe from
the CDN, loaded only when proctoring is on → none) and uploads a 320-px JPEG
(~15 KB) every N seconds plus one per flag. A 2-hour exam at 30 s is ~4 MB of S3.
The interval is clamped server-side to 10–600 s so a client cannot inflate it.

| Piece | Where |
|---|---|
| Config storage + defaults | `features/proctoring/dto/ProctoringConfigDTO`, `service/ProctoringConfigService` (only reader/writer; unreadable JSON = off, never throws) |
| Event log | `attempt_proctor_event` (append-only; evidence = media_service file id, never bytes). Not joined to `StudentAttempt` on purpose: grading and reports never load it |
| Learner API | `GET /assessment/learner/proctoring/config?assessmentId=` · `POST /assessment/learner/proctoring/events?attemptId=` (batch ≤50, owner-only, ignored once ENDED or when the assessment is unproctored) |
| Admin API | `GET /assessment/admin/proctoring/attempt/{attemptId}?instituteId=` (timeline + counts) · `POST …/proctoring/summaries` (flag/warn counts for a page of attempts) |
| Admin wizard | Step 1 → `ProctoringSettingsCard` (tier cards + knobs); `proctoring_config` is always sent whole, tier NONE clears |
| Admin review | Submissions table → row menu → **Proctoring** → `ProctoringReviewDialog` (flag/warn/snapshot chips, timeline, lazy snapshot thumbnails) |
| Learner check-in | `InstructionPage` → `ProctorCheckIn`: camera permission, live preview, waits for exactly one face, keeps a selfie; Start stays disabled while `camera_required` and the camera is refused |
| Learner runtime | `ProctorLayer` inside the live shell → `useCameraProctor`: camera, 2 fps face count with hysteresis (no face ≥6 s, >1 face ≥2.5 s, 30 s re-flag cooldown), snapshot timer, `ProctorEventQueue` (10 s batches, FLAG flushes immediately, retried, bounded), self-view PiP |

Event types: `CHECK_IN`, `SNAPSHOT` (INFO) · `TAB_SWITCH`, `FULLSCREEN_EXIT` (WARN —
logged for the timeline but not counted, since the navbar's own 3-strike rule already
enforces tab switches) · `CAMERA_DENIED`, `CAMERA_LOST`, `NO_FACE`, `MULTIPLE_FACES`
(FLAG) · `AUTO_SUBMITTED`.

`max_violations` is the admin's ceiling on FLAG events; 0 (the default) means
"record only, a teacher decides". When hit, the hook sets
`proctorAutoSubmitRequested` in the assessment store and the navbar's existing
auto-submit path runs.

Failure policy: every proctoring failure degrades to *record less* — camera refused,
no detector, CDN down, events endpoint down — never to *block the learner*. The only
thing that stops an exam is the admin's explicit ceiling.

Not in this tier (candidates for PRO / ULTRA): clips on flag (`MediaRecorder` ring
buffer), phone/object detection, gaze, identity match against a reference photo,
post-hoc AI review of flagged frames, answer-similarity across a batch, live proctor
room on BBB. Also still open: a retention/purge job for snapshots and a per-institute
consent text.

### 4.5 Submission

`navbar.handleSubmit()` (lines ~378–448):
1. Build payload with `formatDataFromStore()`.
2. POST to:
   - `…/learner/status/submit` if `evaluationType === 'AUTO'`
   - `…/learner/manual-status/submit` if `MANUAL`
3. Retry up to 3× with exponential backoff (3s base, 30s max).
4. On success: clear local storage, exit fullscreen, navigate to `/assessment/examination`.
5. **Submission is whole-attempt only**, not per-question.

### 4.6 Result / review

Wrapper: `routes/assessment/reports/student-report/`. Dialog: `test-report-dialog.tsx`. Renderer: `question-response-renderer.tsx`.

Per-type display:

| Type | Student response | Correct answer |
|---|---|---|
| ONE_WORD | `responseData.answer` | `correctData.data.answer` |
| LONG_ANSWER | `responseData.answer` | `correctData.data.answer.content` |
| NUMERIC | `responseData.validAnswer` | `correctData.data.validAnswers.join(' or ')` |
| MCQS / TRUE_FALSE | `responseData.optionIds[0]` | `correctData.data.correctOptionIds` |
| MCQM | `responseData.optionIds` (all) | `correctData.data.correctOptionIds` |

Also rendered: `ResponseBreakdownComponent`, `MarksBreakdownComponent`, section-wise breakdown, PDF export (`EXPORT_ASSESSMENT_REPORT`), optional AI report at `/assessment/reports/ai-report/`. Survey assessments use a separate `SurveyReportDialog`.

### 4.7 Student AI report PDF (redesign, 2026-10)

`GET /assessment-service/assessment/learner/report/ai-pdf` renders through
`features/assessment/service/aireport/` unless `assessment.ai-report.v2.enabled=false`;
on any render error it falls back to the previous `AiReportHtmlBuilder`.

| Piece | Role |
|---|---|
| `AiReportDataService` | All data in a few read-only queries. Max marks come from each question's `marking_json` (never `section.total_marks`, which is client-supplied and drifts). Class figures use each learner's latest ENDED attempt. Name from the registration; enrollment number and institute name from admin_core |
| `AiReportHtmlBuilderV2` | Up to six A4 pages: result, class, topics + Bloom's, how the test was taken, mistakes, plan. Headlines are computed from the numbers; AI text fills only the narrative parts. Sections without data are left out |
| `AiReportCharts` | Inline SVG charts (iText draws rect/line/polyline/polygon/path/circle/text) |
| `ReportPalette` | Shades derived from the institute's primary/secondary colours, with contrast checks |
| `AiReportFonts` | Bundled Baloo 2 + Mukta (`resources/fonts/report/`, see its README) |

The endpoint now checks the attempt belongs to the caller and that its result is released
(`validateOwnershipAndAccess`), like the other learner report endpoints. Other students
appear only as counts; no names. Enrollment number: admin_core
`GET /internal/learner/v1/enrollment-number`.

**One report per attempt.** Once admin_core has a processed AI report for (learner,
assessment), it replaces the normal report everywhere a single student's report is opened:

- `AiReportPdfService.renderIfAvailable` is asked first by the learner `report/pdf` and the
  admin `export/pdf/student-report` downloads; null means "serve the normal report".
- The AI report is a superset of the normal one: it adds the normal report's question-by-
  question detail (question, your answer, right answer, feedback, AI marking criteria,
  explanation, plus class % right and class time), section toppers, "Your expertise" and
  "Your potential". Only the named leaderboard is left out, on purpose.
- Learner app: one "View report" button (`services/student-report-routing.ts`) opens the AI
  report when it exists, else the normal report. The AI page has a "Questions & marks" tab
  that is the normal report (`ComparisonDashboard`).
- Admin: student menu → "Download AI Report" (`StudentAiReportDialog`) renders the same AI
  report; it warns before generating one, which spends AI credits.
- The release-results email now attaches the same one report (sent in batches of 25). The
  bulk ZIP still uses the normal report.

**Report profiles (V57).** Institutes add pages before/after the report: `TEMPLATE` (HTML
with `{{values}}`, see `ReportTemplateEngine`), `PDF` and `IMAGE` (media file ids). A profile
is the institute default (`is_institute_default`) or linked per assessment
(`assessment_report_profile_link`, `NONE` = no pages). Banded values such as a scholarship
(`variables.scholarship_percent.bands`) are computed in `ReportComposer.evaluate`; QR codes
come from `qr_url`. Values: student_name, first_name, enrollment_number, score, max_score,
percentage, rank, participants, correct/wrong/skipped/attempted, sections[name, questions,
attempted, correct, wrong, marks, max], marking_note, result_date, asset.*, qr_svg.
Admin API `/assessment-service/assessment/report-profile/v1`: list, get, save, link,
preview (the exact PDF for one attempt), `ai-reports/generate-missing` (dry run by default;
spends AI credits) and `ai-reports/job`.

---

## 5. End-to-End Lifecycle Cheat Sheet

```
Admin                                           Backend                                       Learner
─────                                           ───────                                       ───────
Step 1 submit ─────POST basic/v1/submit──────▶  Assessment row created (DRAFT)
Step 2 submit ─────POST add-questions/v1/────▶  Sections + QASMappings reconciled
   (per-question save)                          Question row(s) + Option rows persisted
Step 3 submit ─────POST add-participants/────▶  AssessmentUserRegistration / batch links
Step 4 submit ─────POST add-access/v1/───────▶  Access entries persisted
Publish      ─────POST publish/v1/{id}───────▶  Status → PUBLISHED, workflow event fired

                                                                         Open assessment URL ◀──── learner
                                                Preview start ◀──────────POST start-preview
                                                StudentAttempt(PREVIEW)
                                                Live start    ◀──────────POST start-assessment
                                                StudentAttempt(LIVE)

                                                Auto-save     ◀──────────POST status/update     (every ~30s)

                                                Submit        ◀──────────POST status/submit | manual-status/submit
                                                Score, write QuestionWiseMarks,
                                                update StudentAttempt(ENDED, marks),
                                                release report by resultType
                                                                                              View report ◀─── learner
```

---

## 6. Knowledge Base as a question source

Questions can be generated from an institute's own books and notes. The knowledge base
itself (ingestion, chunking, embedding, topic tree, marketplace) lives in **`ai_service`**
(`app/services/kb/`) with its schema in **admin_core_service** Flyway
(V435 / V441 / V443 / V445 / V446); there is no Java KB code. `assessment_service` only
sees the finished questions.

### 6.1 The three entry points in Step 2

| Where | Component | What it does |
|---|---|---|
| Beside **Add Section** | `Step2CreateAssessmentFromKnowledgeBase.tsx` | Plans and generates a **whole assessment**: blueprint → edit the plan → generate → review → each blueprint row becomes a section |
| Inside a section | `Step2CreateFromKnowledgeBase.tsx` | Fills **one section** with N questions of one type |
| Inside a section | `Step2PickFromQuestionBank.tsx` | **Reuses** questions already in the bank — no generation, no credits |

All three **append**. None replaces what the section already holds.

### 6.2 Generation pipeline

```
POST /ai-service/knowledge-base/v1/bases/{kb}/paper/blueprint   plan (cheap, iterate)
POST /ai-service/knowledge-base/v1/bases/{kb}/paper/generate    whole paper  (202, async)
POST /ai-service/knowledge-base/v1/bases/{kb}/paper/section     one section  (202, async)
GET  /ai-service/knowledge-base/v1/paper-jobs/{taskId}          poll
POST /ai-service/knowledge-base/v1/bases/{kb}/paper/regenerate  redo ONE question
POST /ai-service/knowledge-base/v1/bases/{kb}/paper/validate    structural checks
     -> POST /assessment-service/question-paper/manage/v1/add   save to the bank
```

Generated questions pass through `ai_service/app/services/question_format.py`, the shared
converter **every** AI question source uses (KB, vsmart-upload, -audio, -prompt, -extract,
-image). It emits the exact `QuestionDTO` shape the question bank consumes.

Supported types: `MCQS`, `MCQM`, `TRUE_FALSE`, `ONE_WORD`, `LONG_ANSWER`, `NUMERIC`.

> NUMERIC and TRUE_FALSE were previously **skipped outright** by `format_questions`, which
> is why `kb/paper.py` used to store numericals as `ONE_WORD` (`STORAGE_QUESTION_TYPE`).
> Both now have handlers and are stored as themselves. **Questions saved before that
> change remain `ONE_WORD` and grade exactly as they always did.**

### 6.3 Provenance (assessment_service V42)

`question` carries three columns, all nullable:

| Column | Meaning |
|---|---|
| `institute_id` | Owning institute, denormalised from `institute_question_paper`. Backfilled by V42. Lets a question be scoped without walking question → mapping → paper → institute |
| `source_type` | `MANUAL` \| `UPLOAD` \| `AI` \| `KNOWLEDGE_BASE` |
| `source_meta` | JSONB: `kb_id`, `generation_id`, `topic`, `section`, `node_ids`, `source_page`, `figures`, `planned_type` |

Written by `kb/paper.py::pair_with_formatted`, carried on `QuestionDTO.sourceType` /
`sourceMeta`, persisted in `AddQuestionPaperFromImportManager.initializeQuestion`.

### 6.4 Browsing individual questions

`POST /assessment-service/question-bank/v1/questions/filter?instituteId=&pageNo=&pageSize=`

Body (`QuestionBankFilter`, snake_case): `name`, `kb_ids`, `kb_node_ids`, `source_types`,
`question_types`, `difficulties`, `tag_ids`, `statuses`, `exclude_question_ids`.
Returns `Page<QuestionDTO>`.

This is the only question-**level** query in the service; `question-paper/view/v1/get-with-filters`
remains the paper-level one and is unchanged. KB filters use jsonb containment against the
GIN index on `source_meta`.

---

## 6A. Automatic AI evaluation on submit

AI evaluation (the "copy-check" pipeline in `docs/ai_tools/ai_evaluation.md`) already
existed end to end. What was missing was a trigger other than a teacher clicking
**Evaluate with AI** on the submissions table.

### 6A.1 Turning it on

Step 1 of the wizard has an **Evaluate submissions with AI** toggle, **off by default**.
It maps to two nullable columns added in `V43`:

| Column | Meaning |
|---|---|
| `assessment.ai_evaluation_enabled` | NULL/false = off. Every assessment created before V43 reads NULL, so none of them start spending on their own |
| `assessment.ai_evaluation_model` | Preferred model. NULL falls back to the ai_service default |

This is **independent of `evaluation_type`**. That field decides how the AUTO scorer treats
the paper; this one decides whether the AI grader is additionally queued on submit.

### 6A.2 Enqueue, then poll

```
learner submits
   -> AiEvaluationSubmissionEnqueuer.enqueueIfEnabled()   (REQUIRES_NEW, never throws)
        -> INSERT ai_evaluation_process (status = PENDING)
                                    |
   AiEvaluationQueuePoller (every 15s, on every replica)
        -> claimPendingJobs()  single atomic UPDATE ... FOR UPDATE SKIP LOCKED
        -> AiEvaluationAsyncService.evaluateAttemptAsync()   [same worker as the manual path]
                                    |
        -> callbacks -> teacher review -> Release Result -> learner sees marks
```

Why the split: the job belongs to a **row in the database**, not to whichever pod served
the submit. A deploy or crash right after submission does not lose anybody's grading.

**The claim is a single UPDATE, not a read-then-write.** Prod runs several replicas and
they all poll; with a SELECT followed by a separate UPDATE, two pods routinely read the
same PENDING row and both start grading — and since evaluation is metered per graded
question, that means **charging the institute twice for one submission**.

### 6A.3 Safety properties

- **Opt-in.** NULL means off; existing assessments are untouched.
- **Never breaks a submission.** `REQUIRES_NEW` plus a catch-all: a submission that
  succeeded is never reported as failed because grading could not be queued.
- **Idempotent per attempt.** The learner client retries submit 3x with backoff and submit
  is not idempotent, so an in-flight check stops a flaky network paying repeatedly.
- **Two kill switches.** `assessment.ai-evaluation.on-submit-enabled` (stop queueing) and
  `assessment.ai-evaluation.poller-enabled` (stop draining). Neither affects the
  teacher-triggered path.
- **Nothing reaches a learner automatically.** The existing review-and-release gates are
  unchanged: AI drafts, a teacher approves, a teacher releases.

### 6A.4 Settings

| Property | Default | Notes |
|---|---|---|
| `assessment.ai-evaluation.on-submit-enabled` | `true` | Queue on submit |
| `assessment.ai-evaluation.poller-enabled` | **`false`** | Drain the queue. Off so this can ship and be watched before it spends |
| `assessment.ai-evaluation.poller-interval-ms` | `15000` | |
| `assessment.ai-evaluation.poller-batch-size` | `5` | Small: each job is a multi-minute OCR+LLM pipeline on a shared pool |
| `assessment.ai-evaluation.claim-stale-minutes` | `15` | A claim older than this is re-claimable |

> Note: the existing `AiEvaluationStaleJobSweeper` treats `PENDING` as non-terminal and
> fails it after 30 minutes. With the poller enabled a job leaves PENDING within seconds,
> so this only bites when nothing is draining the queue — which is the correct signal.

---

## 7. Key File Index

### Backend
- `assessment_service/src/main/java/vacademy/io/assessment_service/features/assessment/entity/` — `Assessment`, `Section`, `QuestionAssessmentSectionMapping`, `StudentAttempt`, `AssessmentUserRegistration`
- `…/question_core/entity/` — `Question`, `Option`
- `…/question_core/enums/` — `QuestionTypes`, `QuestionResponseTypes`, `NumericQuestionTypes`
- `…/question_core/dto/` — `QuestionDTO`, `OptionDTO`, `MCQEvaluationDTO`, `NumericalEvaluationDto`, `OneWordEvaluationDTO`, `LongAnswerEvaluationDTO`
- `…/assessment/manager/` — `AssessmentBasicDetailsManager`, `AssessmentLinkQuestionsManager`
- `…/assessment/controller/assessment_steps/` — Step 1–4 controllers
- `…/learner_assessment/controller/` — `StudentAssessmentAttemptStartController`, `StudentAssessmentStatusController`
- `…/learner_assessment/manager/` — `LearnerAssessmentAttemptStartManager`, `LearnerAssessmentAttemptStatusManager`
- `…/evaluation/service/QuestionEvaluationService.java`
- `…/assessment/service/StudentAttemptService.java`
- `…/question_bank/controller/GetQuestionBankController.java`, `…/manager/GetQuestionBankManager.java`, `…/dto/QuestionBankFilter.java` — question-level browse
- `…/question_core/repository/QuestionRepository.findQuestionsByFilters`
- `src/main/resources/db/migration/V42__question_source_and_institute.sql`
- `…/proctoring/` — `ProctoringConfigDTO`, `ProctoringConfigService`, `ProctorEventService`, `AttemptProctorEvent`, `LearnerProctoringController`, `AdminProctoringController`; `V50__assessment_proctoring.sql`

### ai_service (knowledge base)
- `ai_service/app/services/kb/` — `paper.py` (blueprint + generation + validation), `repository.py`, `retrieval.py`, `topics.py`, `ingest.py`, `generations.py`
- `ai_service/app/routers/kb_paper.py`, `knowledge_base.py`, `kb_library.py`
- `ai_service/app/services/question_format.py` — shared converter for **all** AI question sources

### Admin frontend
- `frontend-admin-dashboard/src/routes/assessment/create-assessment/$assessmentId/$examtype/`
  - `-components/CreateAssessmentComponent.tsx`
  - `-components/StepComponents/Step1BasicInfo.tsx`
  - `-components/StepComponents/-components/ProctoringSettingsCard.tsx` — tier picker (V50); types in `src/types/assessments/proctoring.ts`; review dialog in `assessment-list/…/assessment-submissions-dropdown-individual/ProctoringReviewDialog.tsx`, service `src/services/proctoring-review.ts`
  - `-components/StepComponents/Step2AddingQuestions.tsx`, `Step2SectionInfo.tsx`
  - `-components/StepComponents/Step3AddingParticipants.tsx`
  - `-components/StepComponents/Step4AccessControl.tsx`
  - `-services/assessment-services.ts`, `-utils/*-schema.ts`, `-utils/zustand-global-states/*`
  - `-components/StepComponents/-components/Step2CreateAssessmentFromKnowledgeBase.tsx` — whole assessment from a KB
  - `-components/StepComponents/-components/Step2CreateFromKnowledgeBase.tsx` — one section from a KB
  - `-components/StepComponents/-components/Step2PickFromQuestionBank.tsx` — reuse existing questions
- `frontend-admin-dashboard/src/routes/knowledge-base/` — the KB module itself (`-components/paper/BlueprintTable.tsx`, `ReviewBoard.tsx`, `TopicPicker.tsx`, `-services/paper-service.ts`)
- `frontend-admin-dashboard/src/routes/assessment/question-papers/-utils/merge-section-questions.ts` — append-don't-replace helper shared by every question-insert path
- `frontend-admin-dashboard/src/routes/assessment/question-papers/-utils/question-bank-services.ts`
- `frontend-admin-dashboard/src/routes/assessment/question-papers/-components/`
  - `QuestionPaperUpload.tsx`, `QuestionPaperTemplate.tsx`
  - `QuestionPaperTemplatesTypes/MainViewComponentFactory.tsx`
  - One folder per type (`MCQ(Single Correct)/`, `MCQ(Multiple Correct)/`, `NumericType/`, `OneWordType/`, `LongAnswerType/`, `TrueFalse/`, `Comprehensive MCQ(Single Correct)/`, `Comprehensive MCQ(Multiple Correct)/`, `ComprehensiveNumericType/`)

### Learner frontend
- `frontend-learner-dashboard-app/src/components/common/instructionPage/InstructionPage.tsx`, `StartAssessment.tsx`
- `frontend-learner-dashboard-app/src/components/common/questionLiveTest/`
  - `page.tsx`, `navbar.tsx`, `footer.tsx`, `sidebar.tsx`
  - `section-tabs.tsx`, `question-navigator.tsx`, `question-display.tsx`
  - `otherQuestionTypes/numeric.tsx`, `OneWordInput.tsx`, `LongAnswerInput.tsx`, `paragraph.tsx`
- `frontend-learner-dashboard-app/src/stores/assessment-store.ts`
- `frontend-learner-dashboard-app/src/hooks/proctoring/useProctoring.ts`
- `frontend-learner-dashboard-app/src/hooks/proctoring/useCameraProctor.ts`, `lib/proctoring/face-detector.ts`, `lib/proctoring/capture.ts`, `services/proctoring.ts`, `components/common/proctoring/ProctorCheckIn.tsx`, `ProctorLayer.tsx` — video proctoring (V50)
- `frontend-learner-dashboard-app/src/routes/assessment/reports/student-report/`
- `frontend-learner-dashboard-app/src/components/common/student-test-records/test-report-dialog.tsx`
- `frontend-learner-dashboard-app/src/components/common/student-test-records/question-response-renderer.tsx`

---

## 8. Known issues, deliberately not fixed

An audit of `assessment_service` and both frontends (2026-08) found these. They are real,
and each was left alone because fixing it would change behaviour that currently works —
so each needs its own pass, with a read-only preflight query against prod first. Recorded
here so they are not rediscovered from scratch.

| # | Issue | Why it was deferred |
|---|---|---|
| 1 | `negativeMarkingPercentage` is read and discarded in MCQM/MCQS/ONE_WORD while NUMERIC applies it, so the same configured scheme penalises differently per type | Applying it changes live penalties for any institute that set a non-zero percentage |
| 2 | `NUMERICQuestionTypeBasedStrategy` compares with exact `Double` equality; no RANGE/tolerance despite `NumericQuestionTypes` existing | Changes scores, and the tolerance should be a per-question setting rather than a constant |
| 3 | Grading and preview queries in `QuestionAssessmentSectionMappingRepository` filter neither `qasm.status` nor `q.status`; the `activeSections` Hibernate filter is inert (enabled on a different session, and `Assessment` names a column that does not exist) | Adding a filter can only REMOVE questions from live papers, and legacy rows have NULL status — needs a prod count first, and must land with #7 |
| 4 | `StudentAttemptService.calculateTotalMarks` catches everything and returns 0 for the whole attempt, which is then written as `COMPLETED` and may be auto-released | The fix is right but changes what admins see (attempts held rather than released) and touches release/workflow side effects |
| 5 | The live grading path picks its marking strategy from `responseData.type` inside the learner's own submitted JSON; the revaluation path correctly uses `questionAsked.getQuestionType()` | Legacy attempts may depend on the submitted value where the stored type is null |
| 6 | Reattempt count is enforced nowhere — `registration.reattemptCount` is written but never gates a new attempt; submit is non-idempotent and enforces no time limit | Enforcing either would start blocking learners who can currently do it. The learner client retries submit 3x, so re-submit must return the existing result, not a 4xx |
| 7 | `AssessmentLinkQuestionsManager.softDeleteMappingsByQuestionIdsAndSectionId` runs a native hard `DELETE`; Hibernate-internal enums are used as domain status strings; `section.totalMarks` is trusted from the client | Hard-delete → soft-delete changes which rows the (unfiltered, #3) grading queries return |
| 8 | Publish validates nothing (`// Todo: Verify Assessment Details based on type`) — an assessment with no sections and no questions can be published and started | Any rule added could reject assessments that are already live; likely lands as warnings first |
| 9 | Editing a question paper orphans `option` and `assessment_rich_text_data` rows; `setQuestionMetadata` nulls media/explanation on a partial edit | Needs an `option.status` column plus a read filter on every option query |
| 10 | Deleting a question from one paper sets `question.status = DELETED` globally, across every other paper and assessment using it | Changes what admins currently experience as "delete" |
| 11 | Learner reports are readable before release, and the release filter on the list endpoint is client-supplied | Enforcing it hides results learners can currently see |
| 12 | `totalTimeInSeconds` is taken from the learner's own JSON and feeds leaderboards | Server-side timing changes existing leaderboard values |
| 13 | Restart grants a fresh full duration with no counter or cap | Capping it takes time away from learners mid-exam |
| 14 | Step-2 re-submit can duplicate sections (server ids are never written back into the form); Step-1 re-submit orphans the draft | The fixes flip create-vs-update decisions in the wizard |
| 15 | `sectionDetailsSchema` validates nothing, and the real submit gate is disabled entirely in edit mode | Turning validation on could block admins who currently save partial edits; pair with #8 |
| 16 | `AssessmentParticipantsManager` is not transactional; registration dates are dropped unless instructions HTML is also sent; removing participants hard-deletes rows `StudentAttempt` has FKs to | Its own area with its own blast radius |
| 17 | `AssessmentAccessManager.updateAccessToAssessment` ignores its current-access parameters; `deleteAccessToAssessment` is never called; a missing institute mapping returns 200 having done nothing | Access-control semantics need a product decision |
