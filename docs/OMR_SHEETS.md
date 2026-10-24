# OMR sheets (pen-and-paper MCQ exams)

Status: built on `feat/omr-sheets` (2026-10-16). Not deployed.

An assessment with **OMR mode** on is sat on paper. The admin prints, for each paper
set, the question paper, the answer key and a bubble sheet. Students fill the sheet.
The admin scans the filled sheets and uploads them per set. Each sheet is read with
[OMRChecker](https://github.com/Udayraj123/OMRChecker) (MIT), matched to a learner
by the bubbled roll number, and graded by the normal offline-entry marking. The
result is held until the admin releases it.

## Flow

1. **Create** the assessment with "OMR sheet mode" on (`assessment.omr_mode`).
   - Allowed questions: only single-correct MCQs (`MCQS`), each with 2 to 5 options.
   - At most 200 questions.
   - Publishing refuses anything else (`AssessmentBasicDetailsManager.publishAssessment`).
2. **Settings** (OMR & Sets tab), stored in `assessment.omr_config` (V60):
   - set count, 1 to 8;
   - shuffle questions;
   - shuffle options.
3. **Roll-number pre-check.**
   - A learner's roll number is their **institute enrollment number**, `student_session_institute_group_mapping.institute_enrollment_number` in admin_core. It is read through `POST /admin-core-service/internal/learner/v1/enrollment-numbers`.
   - When a learner has numbers in several batches, the number on a batch assigned to the assessment wins.
   - Downloads stay blocked while any participant's number is missing, not numeric, longer than 12 digits, duplicated, or conflicting.
   - The roll grid has as many digit columns as the longest number. A shorter number is padded with leading zeros, so "427" on a 6-digit grid is "000427". Students may fill it from the left or from the right.
4. **Generate sets.**
   - Each set is saved as a row in `assessment_set_mapping` whose `json` is `OmrSetJson` (`kind: "OMR"`). It holds the printed question order and, per question, the option ids in printed order (`[0]` is bubble A).
   - Set A keeps the authored order. The other sets shuffle questions within each section, and/or options, using a seed stored on the set.
   - Everything later works from this saved set: the paper, the key, the sheet, and the grading of every scan.
5. **Download** per set:
   - the question paper and the answer key, rendered by the dashboard export from `GET .../sets/{id}/paper`;
   - the OMR sheet PDF, rendered by the backend from `GET .../sets/{id}/sheet.pdf`.
6. **Upload filled sheets** per set.
   - Accepts one combined multi-page PDF and/or many PDF/JPG/PNG files.
   - The first upload **locks** the sets: they can no longer be regenerated, because a printed sheet's meaning must not change.
7. **Review and release.**
   - Sheets that could not be placed wait in NEEDS_REVIEW.
   - The admin can assign a sheet to a learner, skip it, or retry it.
   - Flagged questions on graded sheets can be corrected.
   - Results are released from the Submissions tab.

## Sheet and reader

`OmrSheetLayout` (assessment_service) is the single source of geometry. `OmrSheetPdfRenderer` draws it, and `toTemplate()` writes the OMRChecker `template.json` from the same numbers. Both are pinned in `OmrSheetLayoutTest` and in ai_service `tests/test_omr_reader.py`, which draws a filled sheet with the same numbers and reads it back.

The sheet:

- **Page and markers.** A4, with four corner markers centred 10 mm in from each edge. Each marker is an 8 mm black square with a white 5.2 mm square inside and a black 2.4 mm core. OMRChecker's `CropOnMarkers` finds them and warps the page so the marker centres become the template's corners (6 px/mm, 1140 x 1662).
- **Orientation bar.** A solid bar near the top-left corner. A sheet scanned upside down is detected by it and turned.
- **Name box.** Never machine-read. ai_service crops it, and the reviewer sees it next to the matched learner, which catches a mis-bubbled roll number that happens to match someone else.
- **Roll grid.** Digit columns of bubbles 0 to 9.
- **Set grid.** Only when the assessment has more than one set. Each set's sheet also prints its set code.
- **Question bubbles.** Up to 100 questions use 4.4 mm bubbles in 4 columns (LARGE). From 101 to 200 they use 3.4 mm bubbles in 5 columns (DENSE).

Bump `OmrSheetLayout.LAYOUT_VERSION` on any geometry change. Sets store the version they were printed with, and a scan of an older layout is refused instead of being misread.

### ai_service

`POST /ai-service/omr/v1/read` (`app/routers/omr.py`, `app/services/omr/`) is gated by `X-Internal-Service-Token`.

- **Requests.** With `pages: []` it counts a file's pages. Otherwise it reads up to 25 pages of the file, using the template, marker spec and layout that assessment_service sends.
- **Process pool.** The work runs in a pool of **spawned processes**. OMRChecker is a command-line program: it imports itself as `src`, keeps module-level state and calls `exit()`.
  - `OMR_WORKERS` sets the number of processes (default 2).
  - `OMR_MAX_CALLS` sets how many calls are admitted per pod (default 4); beyond that it answers 429.
- **Results.** It uploads the page (as a one-page PDF), the marked overlay and the name crop to media-service (`upload-file-v2`), and returns only file ids.
- **Vendored code.** OMRChecker lives at `app/vendor/omrchecker` (see `VENDORED.md` for the commit and the single headless patch). Its dependencies are in `requirements.txt`.

The confidence flags that OMRChecker does not report (`reader._suspect_fields`), calibrated on synthetic sheets:

- **borderline**: some bubble lies within `low_margin` (20 grey levels) of the threshold OMRChecker used for that field;
- **faint**: a bubble read as empty is `faint_delta` (15) darker than the other empty bubbles of the same row. On a row without a confident mark, OMRChecker falls back to the page-wide threshold, so a light pencil mark there otherwise reads as a confident blank.

## Matching and grading (`OmrScanService`)

The pipeline mirrors `CopyIntakeService`:

- FILE rows are counted and split into one SHEET row per page.
- Sheets are read in chunks of 20 per file.
- Every step is claimed with an atomic status change, and a sweep resumes RUNNING batches.
- Placing runs under a per-assessment Postgres advisory lock.

A sheet goes to **NEEDS_REVIEW**, with no attempt created, for any of these reasons:

| Reason | When |
|---|---|
| `ROLL_BLANK` / `ROLL_MULTI` | A digit is blank between filled digits, or a digit has two bubbles filled. |
| `ROLL_LOW_CONFIDENCE` | A roll bubble is faint. The matched learner is shown as a suggestion. |
| `ROLL_UNMATCHED` | No participant has that roll number. |
| `SET_BLANK` / `SET_MISMATCH` | The set bubble is empty, or differs from the set of the upload. |
| `DUPLICATE_IN_BATCH` | The learner already has a graded OMR sheet. |
| `ALREADY_HAS_ATTEMPT` | The learner already has an attempt, for example an online one. The admin assigning the sheet confirms it. |

A sheet that can be placed is graded:

1. Letters are mapped to option ids through the set's saved order.
2. The responses go through `AdminOfflineDataEntryManager.applyResponses`, so marks, negative marks and `question_wise_marks` are those of any other attempt.
3. The scanned page is attached as the attempt's sheet (`attempt_data.fileId`), and `student_attempt.set_id` is the set.
4. A question with two bubbles filled is sent as **not attempted**: 0 marks, no negative marks. It is flagged `MULTI`.

**Hold.** `StudentAttemptService` never auto-releases an OMR-mode assessment. The end-of-assessment auto-release cron skips `omr_mode` assessments too. Offline attempts start as `PENDING`.

## API (assessment_service)

The base path is `/assessment-service/assessment/omr/v1`. Every call takes `instituteId` and is staff-only and bound to the institute, the same way as the copy-intake endpoints.

| Method | Path | |
|---|---|---|
| GET | `/overview?assessmentId` | Settings, lock state, paper issues and sets. |
| PUT | `/config?assessmentId` | Set count and shuffle flags. Refused once the sets are locked. |
| POST | `/sets/generate?assessmentId` | Regenerates all OMR sets. |
| GET | `/sets/{id}/paper?assessmentId` | Printed order and answer key letters. |
| GET | `/sets/{id}/sheet.pdf?assessmentId` | The printable sheet. |
| GET | `/roll-check?assessmentId` | The roll-number pre-check. |
| GET | `/participants?assessmentId` | Learners to assign a sheet to. |
| POST | `/scan/start?assessmentId` | `{set_id, files: [{file_id, file_name}]}` |
| GET | `/scan/batches?assessmentId` | The uploads of the assessment. |
| GET | `/scan/batch/{id}` | One upload, with its sheets. |
| POST | `/scan/item/{id}/resolve` | `{user_id}` |
| POST | `/scan/item/{id}/skip` | |
| POST | `/scan/item/{id}/retry` | |
| POST | `/scan/item/{id}/fix-answers` | `{answers: {"7": "B" or ""}}`. Flagged questions only. |

## Limits and known gaps

- Single-correct MCQ only: no multi-correct, numeric or true/false bubbles yet.
- At most 200 questions (one A4 page per student), at most 8 sets, and at most 12 roll-number digits.
- At most 300 files per upload and 400 pages per PDF.
- The sheet title is drawn in Helvetica. A non-Latin assessment name is reduced to its Latin part, or to "OMR Answer Sheet". The question paper itself is rendered by the dashboard and is unaffected.
- The reader was tested on synthetic sheets: rotation up to 2 degrees, scale down to 80%, noise, a border, upside down, PDF and image input. A real-paper pilot is still needed: print 2 sets, fill sheets by pen and pencil, then scan them on a flatbed and photograph them with a phone.
- The local test ran on Python 3.13 with numpy 2. Production runs Python 3.11 with numpy below 2.
