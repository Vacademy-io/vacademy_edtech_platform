# Course details → Quiz Results tab

A tab on the admin course-details page showing **how a batch performed on the QUIZ slides
inside the course** — the quiz list with participation and score, then per quiz a learner
roster (including who has *not* attempted) and a per-question breakdown of what the class
got wrong and which wrong option pulled them there.

Quizzes previously had results only one learner and one slide at a time, through the
activity-log dialog. There was no way to ask "how did my class do on this quiz", let alone
"which quiz is the class failing".

---

## The problem this had to solve first

`quiz_slide_question_tracked.response_status` is **only sometimes a verdict**.

The quiz viewer grades client-side (the answer key ships with the questions so feedback is
instant), and its "Finish" path wrote the literal placeholder `"SUBMITTED"` for every
question until server-side scoring landed. On production today:

| response_status | rows |
|---|---|
| `SUBMITTED` (no verdict) | 28,293 |
| `CORRECT` | 2,422 |
| `WRONG` | 676 |
| `SKIPPED` | 22 |

**93% of stored responses carry no verdict.** The obvious implementation — `SUM(CASE WHEN
response_status = 'CORRECT' …)` in SQL — was built first and measured against a real batch:
it reported a 9-question quiz that 34 learners actually averaged **85.3%** on as **5.6%**,
with 2 of 34 passing instead of 28. That is the same bug the server-side scoring fix was
written for, re-introduced one layer up.

So the tab **grades on read**: when the stored status is a real verdict it is used, and
otherwise the verdict is re-derived from the question's stored answer key via the existing
`AutoEvaluationScorer` (which already knows every response/key shape the apps have
written, including positional answer keys from the AI-authoring path). Sampling 5,000
legacy rows, 4,995 carry a usable selection and ~53% grade to CORRECT.

Responses the scorer genuinely cannot grade — free text, manual evaluation, an
unrecognised key — are reported as **ungraded** and left out of the denominator rather
than silently counted wrong. The UI says so when the count is non-zero.

---

## Backend — `admin_core_service/features/quiz_results`

No migration. Read-only, three endpoints, all **batch-scoped** (`batchId` =
`package_session_id`): a quiz slide is shared across batches through
`chapter_package_session_mapping`, so filtering on `slideId` alone mixes other classes
into a teacher's numbers.

| Endpoint | Returns |
|---|---|
| `GET /admin-core-service/quiz-results/overview?batchId=` | every quiz in the batch + participation/score aggregates |
| `GET /admin-core-service/quiz-results/quiz?batchId=&slideId=` | quiz meta, score distribution, a row per **enrolled** learner |
| `GET /admin-core-service/quiz-results/questions?batchId=&slideId=` | per-question accuracy + option-by-option distribution |

`QuizResultsRepository` deliberately fetches **facts** (which quizzes, who attempted, what
they answered, what the key says) and leaves scoring to `QuizResultsService`. Two rules
hold across every query:

- **Latest attempt only** — `DISTINCT ON (slide_id, user_id) ORDER BY … created_at DESC`.
  Quizzes can be re-attemptable; summing every attempt credits a learner who retried until
  they passed with thirty answers on a ten-question quiz. `totalAttempts` is the one
  figure that counts them all.
- **Driven off the roster, not off activity** — the per-quiz learner list starts from
  `student_session_institute_group_mapping` and LEFT JOINs the attempts, so learners who
  never opened the quiz are rows with null marks. "Who hasn't done it yet" is the main
  question this screen answers and an activity-driven list can never show them.

Cost on the largest production batch (151 learners × 114 quizzes): 8.7k tracked rows, six
queries, each **under ~1.4s including the SSH tunnel** — versus 35s for the single
monolithic aggregate query the first draft used.

### Gotchas encoded in the code

- `getQuizSlides` wraps its `DISTINCT ON` in a subquery: `DISTINCT ON` forces the inner
  `ORDER BY` to lead with `s.id`, which would otherwise hand the tab a list sorted by
  slide UUID. The outer sort restores course order.
- `:includeText` is cast (`CAST(:includeText AS boolean)`) — Postgres cannot infer the
  type of a bare parameter in `CASE WHEN $n THEN`.
- Question/option bodies are flattened with `RichTextForAI.toPlainText` before leaving the
  server, so stored HTML + KaTeX never reaches the admin UI raw.
- A response whose question has since been deleted is skipped: it is not in the quiz total
  either, so it must not add to the score.

---

## Frontend — `frontend-admin-dashboard`

New tab `QUIZ_RESULTS` ("Quiz Results"), placed after Assessment. Registered in
`subjects/-constants/constant.ts`, `types/display-settings.ts`, the admin/teacher display
defaults and the three role display-settings screens, plus the `tabContent` maps
in both `course-structure-details.tsx` and `subjects/-components/subject-material.tsx` —
that second map is a `Record<TabType, ReactNode>`, so **a new TabType breaks the build
until it is added there too**.

### Why the tab's order is `5.5`

The tidy-looking version of this — insert at order 6 and renumber everything after it —
is wrong, and prod says so. `mergeArrayById` merges saved config over defaults as
`{...def, ...incoming}`, so **saved orders win**: renumbering the defaults changes nothing
for an institute that has already saved a config, and the new tab simply lands on an order
another tab already occupies. Two tabs sharing an order makes the Display Settings up/down
arrows a dead click, because `swapOrder` swaps the two `order` *values* and swapping equal
numbers is a no-op.

Replayed against all 94 production `courseDetails` configs through the real
`mergeArrayById` + `swapOrder`:

| QUIZ_RESULTS order | configs given a new duplicate order | configs with a dead reorder arrow |
|---|---|---|
| `6` (renumber everything after) | **34** | **94** |
| `5.5` (leave every other order alone) | 0 | 0 |

`5.5` also still lands the tab directly after Assessment in 93 of the 94 (the odd one out
saved Assessment at a different order). `order` is typed `number`, and both the sort and
`swapOrder` are plain numeric comparisons, so a fractional order is fully supported.


Components live in `course-details/-components/quiz-results/`:

| File | Screen |
|---|---|
| `QuizResultsTab.tsx` | shell; list ⇄ one quiz, local state (leaves the tab strip's URL alone) |
| `QuizResultsOverview.tsx` | KPI tiles + search/filter/sort + `MyTable` of quizzes |
| `QuizDetailView.tsx` | quiz header, KPIs, score spread, Learners ⇄ Question analysis |
| `QuizLearnersPanel.tsx` | roster table, filters, CSV export |
| `QuizQuestionsPanel.tsx` | per-question accuracy + option distribution, weakest first |
| `QuizScoreDistribution.tsx` | 10-band histogram with a pass-mark reference line |
| `quiz-results-shared.tsx` | formatters, tones, `StatTile`, `ScoreMeter`, chips |

Search, sort and paging on both tables run **client-side**: one batch's quizzes and one
quiz's roster each arrive whole, so re-sorting by score is instant and the CSV covers
everyone rather than one page. The server caps the roster
(`quiz-results.learner-row-limit`, default 2000) and sets `truncated` so the UI can say the
class shown is incomplete instead of quietly showing part of it.

### Colour decisions

No chart in this tab asks colour alone to carry meaning, because this design system's
status ramp cannot: validated with the dataviz palette checker, `danger` and `warning` sit
**5.5 ΔE apart under deuteranopia** (and 14.2 under normal vision) — indistinguishable. So:

- the score histogram is **one hue** with a labelled pass-mark reference line, not
  pass/fail-coloured bands;
- response mixes are **words and counts** ("8 correct · 1 wrong"), not stacked colour bars;
- the per-question accuracy bar takes the difficulty's tone only because the chip beside
  it spells the same thing out ("Needs re-teaching" / "Well understood") with an icon.

Every meter renders its number next to the bar for the same reason.

---

---

## Two sub-tabs: Learner-wise and Quiz-wise

The tab opens on a view switch, because the same graded data answers two different
questions and a teacher tends to live in one of them (the choice is remembered in
`localStorage`):

- **Learner-wise** — the roster is the row: quizzes done, running average, marks so far.
  Clicking a learner opens a right-hand side panel with their whole quiz history.
  Answers *"who is falling behind"*.
- **Quiz-wise** — the quiz is the row, opening into that quiz's learners and its
  question-by-question breakdown. Answers *"which quiz is landing badly"*.

### The learner side panel

Three levels, each loaded only when opened, so a learner with a hundred quizzes does not
pull every answer they have ever given just to show a summary:

1. **Header + quiz list** (`/quiz-results/learner`) — their totals (quizzes done, average,
   marks obtained out of the marks they were examined on, with the course total as
   context, attempts, quizzes passed) and every quiz in the course including the ones
   they have not touched.
2. **Attempts** (`/quiz-results/learner/answers`) — every attempt, newest first, each with
   its own score and date. The latest carries a **counted** badge, because that is the one
   every other screen reports.
3. **Answers** — per question: the verdict, the marks awarded out of the marks available,
   every option with the correct one ticked and the learner's own pick marked (red when it
   was wrong), plus the explanation. Free-text questions fall back to
   "Answered: … / Expected: …".

Attempts are numbered **oldest-first**, which is how a teacher refers to them. Showing all
of them is the point: on production, one learner's three tries at the same quiz score
55.6% → 44.4% → 22.2%, and reporting only the latest would hide that they are regressing.

### Endpoints added

| Endpoint | Returns |
|---|---|
| `GET /quiz-results/learners?batchId=` | a row per enrolled learner, totalled across every quiz |
| `GET /quiz-results/learner?batchId=&userId=` | one learner's per-quiz standing, attempted or not |
| `GET /quiz-results/learner/answers?batchId=&slideId=&userId=` | their answers on each attempt |

The learner-wise overview needs **no new SQL**: it is the quiz-wise grading pass pivoted
in Java. `getAttempts` and `getLatestAttemptResponses` gained an optional `userId` filter
(null = whole batch) so the side panel costs a fraction of the batch-wide load.

---

## Verified

- Both services compile; `tsc --noEmit` clean; eslint clean on the new files;
  `design-lint` reports 0 errors (only the documented dynamic-bar-width inline styles).
- All seven native queries run against production and return sane rows.
- Grading re-implemented independently and run over a real 34-learner batch: 85.3%
  average / 88.9% median / 28 passing, distribution skewed high — against 5.6% and 2
  passing for the naive status-only read.
- All three screens rendered headless at the true ~880px admin content width and
  eyeballed; that pass is what caught the pass-mark label striking through a bar count,
  a green participation meter reading as a grade, and "0 wrong" in red beside a perfect
  score.
