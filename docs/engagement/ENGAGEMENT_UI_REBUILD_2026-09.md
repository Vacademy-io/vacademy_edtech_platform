# Daily Engagement: UI review and 5-wave rebuild (September 2026)

A record of why the Daily Engagement surfaces were rebuilt, what shipped in each wave, and what
was left out on purpose. The contracts themselves live in
[`DAILY_ENGAGEMENT_PLATFORM.md` §19](./DAILY_ENGAGEMENT_PLATFORM.md#19-integrity-contracts-and-flashcards-after-the-september-rebuild-2026-092526).

- **When:** review 2026-09-24/25, rebuild 2026-09-25/26, commits `4b21c1ffca`..`c7814cd36b` on
  `origin/main`, then Wave 5 (translations, lint, docs).
- **Inputs:** a learner UI review (issues D1–D55), an admin UI review (A1–A22) with a FLASHCARDS
  spec (B1–B7), and a combined roadmap that settled the conflicts between them.
- **Scope:** `admin_core_service` engagement + points ledger, `ai_service` engagement planner, the
  admin `/engagement` route, and the learner dashboard module plus `/engagement` page.

---

## 1. What was wrong

The review was done against prod data and screenshots at 390, 1280 and 1440 px. It found problems
in four groups.

**Integrity (P0).** These could cost learners work or give away answers.
- **Answer-key leak (D47).** Redaction checked only "reveal time passed". So every catch-up
  question past its reveal, and any open question whose reveal came before its close, sent
  `correctOptionId` and the explanation to learners who could still answer. Answering after the
  reveal still paid the correct-answer bonus, and the reveal job paid the full hidden bonus on late
  answers (D51).
- **Forgeable gates (D48, D1).** Reading and game gates trusted a `timeSpentMs` value made by the
  client. The inline question sent `1`. A game's "Mark complete" paid out without any play.
- **Saves wiped completions (A1).** The composer re-sends every task on every save. `upsertItem`
  retired and re-created, under a new id, any task that had an attempt, whether or not it had
  changed. After STARTED-on-GET shipped, opening a task was enough to trigger this. One no-op
  "Save changes" then did three things:
  - learners' completions vanished;
  - the same points could be earned again;
  - tracking reset to 0.
- **The editor lost data (A2).** It loaded only the first day of a multi-day plan. Saving dropped
  every field the form didn't show: `dowMask`, catch-up settings, `questionId`, and slot order.
- **Smaller integrity holes:**
  - tracking CSV formula injection (A11);
  - settings that silently saved defaults over real values (A12);
  - AI regenerate could return a different task type and still bill (A8);
  - points could be negative (A10);
  - QUIZ paid for nothing (D52).

**Numbers learners couldn't trust.**
- The points pill showed 177 on the dashboard and 2 on Past tasks, and never moved after a task (D2).
- Four streak displays read from three sources (D9).
- The progress total grew as the cap let in more tasks and as catch-ups arrived (D5).
- Point chips promised more than tasks paid (D22).
- Server rejection reasons were thrown away (D8).

**Learner experience.**
- **Layout.**
  - The card was hard-mounted above everything and reached about 2,300 px on desktop. Continue
    Learning sat about 3.5 screens down (D3).
  - The dialog broke on mobile (D13, D26).
  - Readings rendered in Times (D15).
- **Flow.**
  - Answering inline took one irreversible tap. The result lasted 1.6 s (D6, D7).
  - The reveal was buried, and its copy promised a leaderboard that didn't exist (D10, D11).
  - Tapping a notification went nowhere (D49).
- **Styling.**
  - Emoji served as the icon system (D16).
  - `primary-600..950` classes compile to nothing in the learner app, so points and links
    rendered black (D33).
  - Seven raw colour families each carried type, state and urgency (D14, D33).
  - The card looked the same in all five skins (D17).

**Admin experience.**
- Failed requests showed as empty states (A3).
- Plans couldn't be told apart: no batch name, no dates (A4).
- The list broke at 390 px (A5).
- The AI wizard threw away a paid draft on Escape (A6). Its review never showed the answer key
  (A7).
- Tracking had no poll or MCQ distribution (A9).
- Tables and dialogs were hand-rolled (A16), and the composer had no slot model (A17, A18).
- Flashcards existed only as opaque AI-generated HTML games:
  - the score was self-reported;
  - the 20 s game gate applied;
  - progress couldn't be tracked per card.

The design linter reported "clean" on every engagement file throughout. It didn't check for raw
palette colours, dead primary shades, emoji, or hand-rolled tables and dialogs. Wave 5 closes the
first two of those gaps.

## 2. Decisions that shaped the rebuild

1. **FLASHCARDS is a first-class item type**, not a GAME with `payloadJson.kind`. It is native
   React, graded per card, and pays completion points only. No migration is needed, because
   `item_type` is a varchar.
2. **Versioning in place** (keep the id, bump the version) instead of a `root_item_id` column. No
   migration.
3. **`reasonCode` is additive.** The error body stays the same `ErrorInfo`, with one extra field.
4. **Every new server field is optional.** The deployed frontends kept working between the backend
   push and the UI pushes.
5. **Per-occurrence attempts stay deferred.** The rebuild adds no migrations.
6. **Locale files are merged by the orchestrator.** Each package writes its keys separately, so no
   package owns a locale file. hi, fr and ar fall back to en until Wave 5.

## 3. What shipped, per wave

### Wave 0: already on main (`4b21c1ffca`)
- Redaction now requires "revealed AND (finished OR can no longer submit)". An answer after the
  reveal earns completion points only, and the reveal job skips it.
- STARTED-on-GET (`insertStartedIfAbsent`). Reading and game dwell are measured from the server's
  `startedAt`, with `minGameSeconds` defaulting to 20. The game claim unlocks only on
  `vacademy:complete`, with a hand-claim after 60 s.
- Server messages reach the learner. `missed` counts closed occurrences only. QUIZ is left out of
  the feed.

### Wave 1: live integrity (each package pushed alone)
- **1A `370e2a22e9`: saves stop wiping completions.**
  - no-op detection that compares the payload as parsed JSON;
  - versioning in place;
  - the answer-key and type lock once learners have answered;
  - write-time validation;
  - a reveal-bonus key built on the version the learner answered.
- **1B `ba26ac3cbe`: CSV and reveal fixes.**
  - CSV escaping plus a UTF-8 BOM;
  - `revealed[]` carries QOTD and POLL only.
- **1C `a2f4377840`: AI regenerate fixes.**
  - regenerate keeps the task's type and points, and returns 422 before billing;
  - `brief.title` wins over the model's title;
  - `start_date` is a real date;
  - reasoning effort defaults to low.
- **1D + 1E `306bd00f38`: admin stopgaps.**
  - multi-day plans: a "this editor changes day 1 only" warning, day 1's dates locked, and day 1's
    own title, order, weekday mask and saved catch-up defaults sent back (no more hardcoded 2/50);
  - the composer resets on open, shows loading/error states, confirms before discarding edits and
    toasts on save;
  - error states with Retry instead of "No plans yet" in the list, course tab and pickers;
  - plan card: toasted errors, AlertDialog, a translated StatusChip;
  - "Assign as task" from a slide seeds the batch and links to the plan;
  - the AI wizard asks before throwing away a paid draft, and the draft can be resumed;
  - tracking shows Correct/Accuracy only for MCQs with a key;
  - settings keep unknown keys on save, show loading/error states and gain "Minimum play time"
    (`minGameSeconds`) — A12 closed.
  Most of these files were then rebuilt again in Waves 3 and 4.

### Wave 2: contracts and foundations
- **Backend `705f4bf944` (2A–2C, one integration push).**
  - the FLASHCARDS payload validator and grading;
  - `reasonCode` through `EngagementRejectedException` and a scoped advice;
  - new feed fields: `scheduledToday`, `catchUp[]`, `doneToday[]`, `hiddenByCap`, earnable points,
    poll results;
  - plan list and detail fields, with filters and paging;
  - tracking status filters that include enrolled learners who never opened the task;
  - option distribution, per-card stats and the plan overview;
  - notification `actionUrl`;
  - one server-side streak in the institute timezone.
- **Learner `87d6b6eb0f` (2D, 2E).**
  - a React Query feed with optimistic submit and a draft store;
  - one points source;
  - `reasonCode` mapping to i18n;
  - a tone table of literal classes and copy helpers;
  - shared components: ChoiceOptions, EngagementResult, badges and TimeLeft;
  - phosphor icons replace emoji.
- **Admin `95a0a3cd02` (2F).**
  - zod composer and flashcards schemas, whose `dtoToForm → formToRequest` round-trip keeps every
    DTO field;
  - institute-timezone formatters and plural helpers;
  - type metadata;
  - service additions;
  - an additive `footerLeft` slot on MyDialog;
  - 45 vitest cases.

### Wave 3: UI rebuilds
- **Learner `31dd33ef9f` (3A–3E).**
  - **Today module.** Registered as the `todayTasks` widget:
    - first in the rail at `lg` and above, under the hero below that;
    - one inline "Up next" row whose result stays until "Next task";
    - two compact rows and a disclosure for the rest;
    - an answer ribbon, a coming-up line and an all-done state.
    Continue Learning is back above the fold.
  - **One task runner** (a side sheet, and a bottom sheet on phones) for every type. It shows the
    gate checklist and server reasons.
  - **Native flashcards.** Flip, rate and undo; swipe; resume; re-study; RTL and reduced-motion
    support.
  - **One streak and one points value everywhere.**
  - **`/engagement` page** with Today · Answers · Past tabs. `/engagement/history` redirects there,
    and pushes open their `actionUrl`.
- **Admin `6efd34f1e8` (3F–3H).**
  - **Slot-aware composer.**
    - a day rail to add, duplicate, delete and reorder days;
    - a per-day schedule;
    - a task accordion with reorder, move-to-day and undo;
    - RHF + zod validation, draft by default and a publish summary.
    Each changed day is saved separately and always sends all of its tasks.
  - **Per-type item editors**, including a flashcards editor with bulk import (tab, dash or CSV)
    and conversion of legacy AI decks.
  - **Course picker fixed.** It could never select a chapter before.
  - **Preview** that matches the learner UI, with a game and deck sandbox.
- **`9d320229e2`.** Moving an unchanged task to another day keeps its id.
- **`2e6e6dda2c`.** Flashcards authoring is on by default. `VITE_ENGAGEMENT_FLASHCARDS=false`
  still hides it. Learners on a native build older than the Wave 3 learner release can't render
  the type and get the "update the app" message (`FLASHCARDS_INCOMPLETE`), so the learner OTA must
  be out for decks to work everywhere.

### Wave 4: insight, AI loop, list
- **Admin `b02e7b513a` (4A, 4B, 4C, 4E).**
  - **Tracking dialog.**
    - per-type summaries: distribution with the correct option marked, "answers to read",
      average and median;
    - Done / Opened / Not done filters;
    - an answer review panel;
    - a Cards tab for flashcards.
  - **Progress overview.**
    - Not started / Behind / On track tiles;
    - completion by day;
    - a paged learner table with a Needs-attention filter;
    - the plan CSV.
  - **AI planner.**
    - background drafting with day-by-day progress and cancel;
    - grounding that works (the chapter picker never could select a chapter, so no AI plan had
      ever been grounded);
    - a review step that uses the composer's own editors.
  - **Plans list.**
    - batch filter, lifecycle tabs, search, sort and paging;
    - informative cards;
    - duplicate to other batches and a new start date;
    - archive.
- **AI `c7814cd36b` (4D).**
  - native FLASHCARDS decks (3–20 cleaned cards); `render_flashcards_html` removed;
  - a job flow billed once, on success only;
  - weekdays and explicit dates in the brief;
  - requested vs delivered counts;
  - per-task pricing.
  This shipped after 4C, because the old wizard still sent `game`.

### Wave 5: i18n, lint, docs (in progress when this was written)
- **5A and 5B:** hi, fr and ar translations for the new admin and learner keys, with Arabic checked
  in RTL.
- **5C: lint.**
  - `design-lint` errors on learner `primary-600..950`, and warns on raw palette families and
    `grid-cols-[…]`.
  - `i18n-lint` flags `toLocale*String(undefined, …)`.
- **5C: docs.** This record, and DAILY_ENGAGEMENT_PLATFORM.md §19.
- **Lint result at the time of writing.**
  - The engagement routes of both apps are clean (0 errors, 0 warnings).
  - The rest of the learner app has about 300 pre-existing `primary-600..950` uses across about
    108 files.
  - The pre-commit gate checks whole files, so touching one of those files now means fixing its
    dead shades or adding `design-lint-ignore`.

## 4. Deferred, and why

| Item | Why it waited |
|---|---|
| **Per-occurrence attempts** (`run_date`, D20 / P1-16) | Needs a product decision and a Flyway migration (V531 or higher, numbered from `origin/main`). The feed ships a stopgap: no catch-up for a recurring slot while today's run exists. Recurring tasks count their first completion only. |
| Written-answer grading, ledger award and feedback | Needs new columns, so a migration. The tracking dialog has a read-only review panel. |
| Reminder and nudge sending, and nudge logging (P2-5) | Needs notification wiring. The overview has no nudge action. |
| Plan insights route, learner × day heat grid, learner timeline | The overview's completion-by-day chart covers the first need. |
| Per-card analytics beyond the Cards tab; deck images (`frontImageFileId`, `startWith`) | The server drops those keys today. They need storage and editor work. |
| Knowledge-base grounding (`kb_id`) in the AI brief; 7-day chunked drafting | The job flow fixed the time-out and tab-close problem first. |
| `vacademy:progress` in AI-generated games | Generated flashcards are native now, so this only matters for hand-made games. |
| App-wide dialog fixes (`extendTailwindMerge` density keys, a 44 px close in `ui/dialog`) | They change every dialog in the app. The runner and MyDialog work around both. |
| Batch leaderboard at the reveal, bonus chest, social proof, poll-timing setting, full RTL mirroring (`RTL_READY=false`), the QUIZ type | Product or design decisions, or blocked until points are trustworthy. |
| "Add to existing plan / day" from a slide | The slide seam seeds the batch and shows a toast. The compact picker is large for its value. |
| Verify before prioritising | P2-13 draft-slide exposure (inferred, not seen); the claim that a month-long draft costs a multiple of the quote; the roughly 90 s generation time (seen once). |

## 5. Rules this rebuild leaves behind

- **The composer must send every task of every slot it saves.** `retireItemsNotIn` soft-deletes
  anything left out.
- **Change a task's answer key or type only when no learner has answered.** Otherwise, add a new
  task.
- **The server records when a task was opened** (STARTED-on-GET), and every dwell gate is measured
  from that. Never gate on client time.
- **Redact on "revealed AND (finished OR can't submit)",** never on reveal time alone.
- **Clients act on `reasonCode`,** never on message text.
- **The learner primary scale stops at 500.** Anything darker is a no-op, and `design-lint` now
  says so.
