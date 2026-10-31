# Daily Engagement Platform

Teacher-authored, time-scheduled daily tasks for learners — reading material, question of the day,
quizzes, games — tracked per learner, scored into a real points ledger, and ranked on leaderboards.

Status: **Phase 1 BUILT 2026-09-13 — not deployed, not runtime-verified.** Compiles clean
(backend `mvn compile`; both frontends add zero TypeScript errors over their baselines, ESLint and
the design gate pass). No service has been booted against a database, so the JPA queries and the
migrations are unproven at runtime. See §15 for exactly what is and isn't done.

> **Current state (2026-09-26):** Phases 1–4 are live on prod, and the September review → rebuild
> (commits `4b21c1ffca`..`c7814cd36b`) changed several contracts described in §7, §8 and §16.
> **§19 is authoritative** where it disagrees with an earlier section. The rebuild itself — what
> was wrong, what shipped per wave, what is deferred — is recorded in
> [`ENGAGEMENT_UI_REBUILD_2026-09.md`](./ENGAGEMENT_UI_REBUILD_2026-09.md).

Not to be confused with `ENGAGEMENT_ENGINES.md` in this folder, which is the *outbound* messaging
brain (WhatsApp/email/call). This document is the *in-app* daily engagement surface. They share
nothing but the word "engagement"; keep the packages separate.

---

## 1. Motive

Institutes want learners opening the app every day out of habit, not obligation. A teacher decides
what a batch sees on a given day, in a given window — "today 6 AM–8 PM, one question; answer and
leaderboard drop at 8 PM" — and can plan a day, a week, or a month ahead. Everything the learner
does is tracked, scored, and comparable.

Phase 4 replaces manual authoring with an AI planner. The schema below is designed so the AI writes
into the same tables a teacher does.

---

## 2. Verified current state

Checked against the repo on 2026-09-13. These findings drive most decisions below.

| Thing | Reality |
|---|---|
| Per-student points storage | **Does not exist.** No table holds a per-user point or XP total. Every `points` column in the schema (`rating.points`, `question.points`, `coding_submissions.max_points`) is unrelated. |
| Leaderboard `points` | Total focused-activity **minutes**, recomputed from `activity_log` per request — `LeaderboardService.buildFromActivityRows` / `LeaderboardEntryDTO.points`. All-time window, hardcoded from year 2000. |
| Learner XP pill / level / streak | Computed **in the browser** from activity logs, cached in `localStorage` — `frontend-learner-dashboard-app/src/services/play-gamification.ts`. The server never sees it. |
| Points & Scoring admin settings | Stored under `BADGES_REWARDS_SETTING.scoring`. Consumed **only by the browser** for the XP pill. The leaderboard never reads them. |
| Badges | `learner_badge` table — genuinely persisted (manual awards). Auto-unlock badges are client-evaluated. |
| Teacher planning | `teacher_planning_logs` (V49/V50/V52) — per `packageSession`, per interval bucket, `content_html`, `is_shared_with_student`. A **document**, not a task: no time window, no item type, no attempt record, no points. |
| HTML sandboxing | Already correct. `html-slide-iframe.tsx` renders with `sandbox="allow-scripts allow-popups"` and **no** `allow-same-origin` → opaque origin, plus a `postMessage` height protocol. |
| Scheduled jobs | `ReportSchedulerJob` + ShedLock (`ShedLockConfig`) already ticks hourly and resolves schedules against each institute's own timezone. Cluster-safe. |
| Push | Live — `notification_service` FCM, multi-tenant (`MultiTenantFirebaseManager`, `PushNotificationService`). |
| Institute timezone | `LANGUAGE_SETTING.timezone`, IANA string (e.g. `Asia/Kolkata`). Authored in Settings → Language. |

**Consequence:** the leaderboard ranks minutes, the XP pill shows a different number the server never
sees, and neither can express "20 points for answering today's question correctly." This is also why
the Institute-wide Leaderboard currently shows badge-holding learners at `0 pts`.

---

## 3. Decisions

Locked with the founder:

| # | Decision |
|---|---|
| 1 | Plan scope is **per batch** (`package_session`). |
| 2 | A learner can receive **multiple items in the same slot** — the Today card is a queue, not a single card. |
| 3 | A learner in **multiple batches** sees a merged feed, grouped and labelled by batch. |
| 4 | Timezone comes from the existing **institute** setting. Not learner-local. |
| 5 | **Missed-day policy is teacher-configurable**, per plan with per-item override. |
| 6 | Games are **teacher-uploaded HTML**. |
| 7 | Authoring approval workflow is **out of scope** — any authorised teacher publishes directly. |
| 8 | Learners **can see future items but cannot open them**. |

Assumed from my recommendations — reversible, but the plan is built on them:

| # | Assumption |
|---|---|
| A | **Option B**: introduce `points_ledger` rather than extending the minutes query. |
| B | **Daily item cap = 5** across all batches, institute-configurable. |
| C | **Catch-up recovers points but never repairs a broken streak.** |

---

## 4. Data model

New tables in `admin_core_service`. Next free Flyway number is **V512**, verified against
`git ls-tree HEAD` and `git log --all` rather than a working-tree listing — V512/V513/V514 exist on
no branch.

**Unrelated risk noticed while checking:** `V510__ai_call_follow_up_and_engagement.sql` exists in
git HEAD but is **deleted in the working tree** by uncommitted work that is not part of this
feature. If that deletion is committed and V510 has already been applied to an environment, Flyway
validation fails there and admin_core will not start. Not caused by this work, but it sits in the
same directory and would break a deploy carrying these migrations.

### 4.1 `points_ledger` — V512

The foundational piece. Append-only. Every point any subsystem ever awards lands here.

```sql
CREATE TABLE public.points_ledger (
    id              varchar(255) NOT NULL,
    user_id         varchar(255) NOT NULL,
    institute_id    varchar(255) NOT NULL,
    package_session_id varchar(255) NULL,   -- NULL = institute-wide award
    source_type     varchar(64)  NOT NULL,  -- ENGAGEMENT_ITEM | ENGAGEMENT_STREAK | ASSESSMENT | ACTIVITY | MANUAL
    source_id       varchar(255) NULL,      -- soft pointer (engagement_item.id, assessment id, ...)
    points          int4         NOT NULL,  -- signed; negative row = reversal
    reason          text         NULL,
    awarded_at      timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    idempotency_key varchar(255) NOT NULL,
    created_at      timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT points_ledger_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX idx_points_ledger_idem ON public.points_ledger (idempotency_key);
CREATE INDEX idx_points_ledger_user_inst ON public.points_ledger (institute_id, user_id);
CREATE INDEX idx_points_ledger_ps_time   ON public.points_ledger (package_session_id, awarded_at);
CREATE INDEX idx_points_ledger_source    ON public.points_ledger (source_type, source_id);
```

Rules:
- **Never update or delete a row.** A correction is a compensating negative row.
- `idempotency_key` is `{source_type}:{source_id}:{user_id}` for one-shot awards and carries the
  local date for repeatables (`ENGAGEMENT_STREAK:2026-09-13:{user_id}`). This is the at-most-once
  guarantee — a retried submit cannot double-award.
- Weekly/monthly leaderboards are a `WHERE awarded_at >=` on this table. That capability does not
  exist today at all.

### 4.2 `engagement_plan` — V513

```sql
CREATE TABLE public.engagement_plan (
    id                  varchar(255) NOT NULL,
    institute_id        varchar(255) NOT NULL,
    package_session_id  varchar(255) NOT NULL,
    title               varchar(500) NOT NULL,
    description         text NULL,
    subject_id          varchar(255) NULL,
    status              varchar(32) NOT NULL DEFAULT 'DRAFT',  -- DRAFT | PUBLISHED | ARCHIVED | DELETED
    timezone            varchar(64) NOT NULL,          -- snapshot of LANGUAGE_SETTING.timezone at create
    default_miss_policy varchar(32) NOT NULL DEFAULT 'EXPIRES',
    default_catch_up_days      int4 NULL,
    default_catch_up_percent   int4 NULL,
    created_by_user_id  varchar(255) NOT NULL,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_plan_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_engagement_plan_ps ON public.engagement_plan (package_session_id, status);
```

`timezone` is **snapshotted onto the plan**, not read live. If an institute changes its timezone
mid-term, already-published slots must not silently shift by hours under learners who already
attempted them.

### 4.3 `engagement_slot` — V513

The scheduled window.

```sql
CREATE TABLE public.engagement_slot (
    id            varchar(255) NOT NULL,
    plan_id       varchar(255) NOT NULL,
    title         varchar(500) NULL,
    -- Wall-clock + recurrence, resolved against plan.timezone at read time.
    start_date    date NOT NULL,
    end_date      date NULL,           -- NULL = single day (= start_date)
    start_time    time NOT NULL,       -- e.g. 06:00
    end_time      time NOT NULL,       -- e.g. 20:00
    dow_mask      int4 NULL,           -- bitmask Mon=1..Sun=64; NULL = every day in range
    reveal_time   time NULL,           -- answers + leaderboard drop; NULL = reveal at end_time
    notify_time   time NULL,           -- push; NULL = no push
    sort_order    int4 NOT NULL DEFAULT 0,
    status        varchar(32) NOT NULL DEFAULT 'ACTIVE',
    created_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_slot_pkey PRIMARY KEY (id),
    CONSTRAINT fk_engagement_slot_plan FOREIGN KEY (plan_id) REFERENCES public.engagement_plan(id)
);
CREATE INDEX idx_engagement_slot_plan_dates ON public.engagement_slot (plan_id, start_date, end_date);
```

**Store wall-clock + timezone, never UTC instants.** A recurring 6 AM slot stored as an instant
drifts an hour twice a year for any institute in a DST zone. India has no DST; a future customer
will. Resolution to instants happens at read time via `plan.timezone`.

`end_time < start_time` means the window crosses midnight — validate and reject at authoring time in
Phase 1 rather than supporting it; a 10 PM–2 AM engagement window is not a use case worth the bug
surface yet.

### 4.4 `engagement_item` — V513

```sql
CREATE TABLE public.engagement_item (
    id             varchar(255) NOT NULL,
    slot_id        varchar(255) NOT NULL,
    item_type      varchar(48) NOT NULL,
        -- READING_HTML | VISUAL_NOTE | QUESTION_OF_DAY | QUIZ | GAME | POLL
    title          varchar(500) NOT NULL,
    version        int4 NOT NULL DEFAULT 1,
    sort_order     int4 NOT NULL DEFAULT 0,
    is_required    boolean NOT NULL DEFAULT false,
    -- Content: exactly one of these is populated per item_type.
    content_html   text NULL,          -- READING_HTML, VISUAL_NOTE, GAME
    slide_id       varchar(255) NULL,  -- reuse an existing slide
    question_id    varchar(255) NULL,  -- QUESTION_OF_DAY
    assessment_id  varchar(255) NULL,  -- QUIZ
    payload_json   jsonb NULL,         -- POLL options, game config, per-type extras
    -- Scoring
    completion_points int4 NOT NULL DEFAULT 0,
    correct_points    int4 NOT NULL DEFAULT 0,
    max_score         int4 NULL,       -- GAME/QUIZ ceiling; server clamps to this
    is_verifiable     boolean NOT NULL DEFAULT false,  -- false => unverified, capped contribution
    -- Miss policy (NULL = inherit from plan)
    miss_policy       varchar(32) NULL,
    catch_up_days     int4 NULL,
    catch_up_percent  int4 NULL,
    status         varchar(32) NOT NULL DEFAULT 'ACTIVE',
    created_at     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_item_pkey PRIMARY KEY (id),
    CONSTRAINT fk_engagement_item_slot FOREIGN KEY (slot_id) REFERENCES public.engagement_slot(id)
);
CREATE INDEX idx_engagement_item_slot ON public.engagement_item (slot_id, sort_order);
```

**Immutability after open.** Once a slot has opened *and* any attempt exists, editing content or
scoring creates a new row with `version + 1` and retires the old one. Attempts pin to the version
they were made against. Without this, a teacher fixing a typo at noon silently invalidates every
morning score.

### 4.5 `engagement_attempt` — V513

```sql
CREATE TABLE public.engagement_attempt (
    id              varchar(255) NOT NULL,
    item_id         varchar(255) NOT NULL,
    item_version    int4 NOT NULL,
    user_id         varchar(255) NOT NULL,
    institute_id    varchar(255) NOT NULL,
    package_session_id varchar(255) NOT NULL,
    status          varchar(32) NOT NULL,   -- STARTED | COMPLETED | SKIPPED
    is_correct      boolean NULL,           -- NULL for non-gradable types
    score           numeric NULL,           -- raw reported/computed score
    max_score       numeric NULL,
    response_json   jsonb NULL,             -- chosen option, game payload, scroll depth
    time_spent_ms   int8 NULL,
    points_awarded  int4 NOT NULL DEFAULT 0,
    is_late         boolean NOT NULL DEFAULT false,  -- completed under catch-up
    is_verified     boolean NOT NULL DEFAULT false,  -- server checked the answer
    started_at      timestamp NULL,
    completed_at    timestamp NULL,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_attempt_pkey PRIMARY KEY (id),
    CONSTRAINT fk_engagement_attempt_item FOREIGN KEY (item_id) REFERENCES public.engagement_item(id)
);
CREATE UNIQUE INDEX idx_engagement_attempt_unique ON public.engagement_attempt (item_id, user_id);
CREATE INDEX idx_engagement_attempt_user ON public.engagement_attempt (user_id, completed_at);
CREATE INDEX idx_engagement_attempt_item_status ON public.engagement_attempt (item_id, status);
```

One attempt row per (item, user) — enforced by unique index, which is also the concurrency guard
against a double-tapped submit. Re-attempts, if ever wanted, become a separate child table rather
than a relaxed constraint.

The `(item_id, status)` index backs the "**70 people have attempted this**" counter.

---

## 5. Time semantics

All state is **derived from timestamps at read time**. No job decides whether an item is open.

```
now_local   = now() in plan.timezone
is_open     = now_local within [start_time, end_time] on a matching date
is_revealed = now_local >= (reveal_time ?? end_time) on that date
is_future   = slot date/time is ahead of now_local
is_catchable= !is_open && miss_policy != EXPIRES && now_local <= end + catch_up_days
```

Jobs exist only for things that genuinely must fire: the push notification and (later) leaderboard
snapshots. Reusing `ReportSchedulerJob`'s hourly + ShedLock pattern means no missed fires on deploy
and no double sends across replicas.

**Miss policies:**

| Policy | Behaviour |
|---|---|
| `EXPIRES` | Gone at `end_time`. Strongest hook. |
| `CATCH_UP_FULL` | Attemptable for `catch_up_days`, full points. |
| `CATCH_UP_REDUCED` | Attemptable for `catch_up_days`, `catch_up_percent` of points. |

In every catch-up case the attempt is flagged `is_late = true` and **the streak does not heal**
(assumption C). Streaks measure showing up on the day; points measure work done. Conflating them
makes the streak meaningless.

---

## 6. Multi-batch feed resolution

A learner in several batches could otherwise be hit with 12 tasks on a Monday. Resolution order:

1. Collect every `ACTIVE` enrollment → active `PUBLISHED` plans → currently-open slots.
2. Flatten to items, drop items with a `COMPLETED` attempt.
3. Sort: `is_required` desc → soonest `end_time` → `plan.package_session_id` enrollment order →
   `item.sort_order`.
4. Truncate to the institute's daily cap (**default 5**, assumption B).
5. Group by batch for display; every card carries its batch name.

Items dropped by the cap are **not** marked missed — they simply weren't shown. If they were, a
learner in four batches would accumulate phantom failures they were never offered.

Leaderboards stay **per batch**. Ranking learners across batches compares people doing different
work, which is noise dressed as competition.

---

## 7. Item types and tracking contracts

| Type | Content | Completion signal | Verifiable |
|---|---|---|---|
| `READING_HTML` | `content_html` or `slide_id` | dwell time ≥ threshold **and** scroll depth ≥ 80% | No — small points only |
| `VISUAL_NOTE` | same | same | No |
| `QUESTION_OF_DAY` | `payload_json` (options + key) | answer submitted | **Yes** — server holds the key |
| `QUIZ` | `assessment_id` | assessment submitted | **Yes** |
| `GAME` | `content_html` (teacher-uploaded) | `postMessage` score | **No** — clamped + capped |
| `POLL` | `payload_json.options` | option chosen | N/A — no correct answer |
| `COURSE_SLIDE` | `slide_id` | the slide's own progress reads as finished | No |
| `FLASHCARDS` | `payload_json` (`flashcards/v1` deck) | every card rated once, after a patience gate | No — completion points only (§19.4) |

Gates, redaction and scoring as they work today: §19.

**Reading must not outscore quizzes.** Dwell + scroll is a patience signal, gameable by leaving a tab
open. Keep `completion_points` for reading well below `correct_points` for a question, or the
leaderboard measures idling.

### Game score contract

Reuse `html-slide-iframe.tsx` verbatim — and no new message type was needed. It already gives the
document an opaque origin AND already speaks a result protocol:

```js
parent.postMessage({ type: 'vacademy:complete', score: 42, maxScore: 50 }, '*');
parent.postMessage({ type: 'vacademy:progress', percent: 80 }, '*');
```

A game written for an HTML slide therefore works as an engagement game unchanged.

Server-side, on receipt:
- clamp `score` to `item.max_score`;
- store `is_verified = false`;
- cap the ledger award for unverified items (institute-configurable, default: completion points only,
  no score-proportional bonus).

Teacher HTML is untrusted code running in the learner's browser. It cannot be trusted to report its
own score honestly — anyone with devtools can post any number. The sandbox protects the *session*;
the clamp protects the *leaderboard*.

---

## 8. API surface

**Admin/teacher** (`admin_core_service`, `/engagement/plan/v1/...`)

```
POST   /plan                       create plan
PUT    /plan/{id}                  update / publish / archive
GET    /plan/list                  filter by package_session, date range, status
POST   /plan/{id}/slot             add slot (+ items in one payload)
PUT    /slot/{id}                  update (versions items if already open)
DELETE /slot/{id}                  soft delete
GET    /plan/{id}/calendar         month view: slots + item summaries
GET    /item/{id}/tracking         per-learner attempt table + aggregate stats
POST   /plan/{id}/copy             copy plan to other batches (Phase 3)
```

**Learner** (`/engagement/learner/v1/...`)

```
GET    /feed                       today's open items + locked upcoming, in one response
GET    /item/{id}                  full payload; refused unless open or catchable
POST   /item/{id}/submit           complete, grade, award to ledger (idempotent)
```

`/upcoming` was folded into `/feed` (an `upcoming[]` array) — the home page needs both together and
a second round trip bought nothing. (Superseded, §19.2: `GET /item/{id}` now writes the STARTED
row, and every dwell gate is measured from it.) `/start` was dropped: the attempt row is created on submit, and
a STARTED row that nothing reads is just a write. `/item/{id}/stats` was folded in too, as
`completedCount` on each feed item. `/history` is Phase 2.

**Critical:** `/upcoming` returns title, date, type icon and nothing else. If tomorrow's payload
ships to the client and is hidden with CSS, tomorrow's answer is one devtools panel away — and in a
ranked batch, somebody will look.

**Points** (`/points/v1/...`)

```
GET    /me/summary                 total, this week, level, breakdown by source_type
GET    /leaderboard?scope=...&window=WEEK|ALL   ledger-backed ranking
```

---

## 9. Admin UX

Extends the existing `planning` module rather than starting a new one — it already has the HTML
editor, interval selector and batch scoping.

- **New route** `routes/engagement/` (plans list, calendar, composer, tracking).
- **Composer**: pick batch → pick date(s) → set window (start/end/reveal/notify) → add items → set
  points and miss policy → publish. Week and month views for planning ahead.
- **Tracking**: per item, a learner table (attempted / correct / score / time / late) with an
  aggregate header, plus a batch-level "who is slipping" view — learners with N consecutive misses.
- **Reuse**: `PlanningHTMLEditor.tsx` for authored HTML, the existing question picker for
  `QUESTION_OF_DAY`, the assessment picker for `QUIZ`.

## 10. Learner UX

- **Today card** at the top of the learner dashboard — a queue with progress ("2 of 3 done"), each
  card branded with its batch, a countdown to `end_time`, and the live attempt count as social proof.
- **Locked future strip** — the next few days visible but un-openable. Anticipation is a hook;
  ambiguity is not.
- **Reveal moment** — at `reveal_time`, the answer plus the batch leaderboard, as a celebratory
  state. Reuse `play-celebration.ts`.
- **Points surfaces** — the existing `XpDisplayWidget`, `StreakCounterWidget` and
  `AchievementBadgesWidget` get repointed at `/points/v1/me/summary` instead of `localStorage`.
- **Leaderboard framing** — top 10 by name, the learner's own row always visible, everyone else in
  bands ("Top 40%"), weekly window default. Rank 47 of 50 shown daily is a reason to stop opening the
  app, which is the opposite of the goal.

## 11. Jobs

| Job | Cadence | Work |
|---|---|---|
| `EngagementNotifyJob` | every 15 min, ShedLock | slots whose `notify_time` falls in this window → FCM push per enrolled learner |
| `EngagementStreakJob` | daily, per institute-midnight | close the day; award streak points to learners who completed a required item |

Both follow `ReportSchedulerJob`'s existing pattern.

---

## 12. Phases

### Phase 1 — Foundation (the only phase that unblocks everything else)
1. **V512** `points_ledger` + `PointsLedgerService` (award, reverse, summarise) with idempotency.
2. Repoint learner XP/streak/level at the server; keep `localStorage` purely as an offline cache.
3. Add a ledger-backed mode to `LeaderboardService` alongside the existing minutes mode — no
   breakage of the current leaderboard.
4. **V513** plan/slot/item/attempt tables + entities, repos, services.
5. Admin composer: create plan, slot, `READING_HTML` and `QUESTION_OF_DAY` items.
6. Learner Today card + feed + submit + tracking.

### Phase 2 — Depth
`QUIZ` and `GAME` types (with the clamp), reveal flow, weekly leaderboard, `EngagementNotifyJob`
pushes, the teacher tracking dashboard, `POLL`.

### Phase 3 — Scale for teachers
Reusable item library, copy-plan-across-batches, month calendar, templates, streak job.

### Phase 4 — AI planner
Teacher states intent, syllabus and timeline; the planner drafts plans/slots/items into these same
tables as `DRAFT` for review. Draft-and-approve, never autopilot — an AI publishing directly to 500
learners is one bad generation away from an incident.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Forged game scores | Clamp to `max_score`, mark unverified, cap leaderboard contribution |
| Teacher HTML XSS | Already solved — opaque-origin sandbox, no `allow-same-origin`. Do not "improve" this by adding it. |
| Future payload leak | `/upcoming` returns metadata only |
| Edited item invalidates scores | Item versioning; attempts pin to version |
| Timezone drift | Wall-clock + snapshotted IANA zone, never stored instants |
| Multi-batch overload | Daily cap, capped items never counted as missed |
| Double-award on retry | `idempotency_key` unique index + unique attempt index |
| Leaderboard demotivation | Bands below top 10, weekly reset, own row always shown |
| Ledger table growth | Append-only and indexed; archive/rollup strategy revisited past ~50M rows |

## 14. Open questions

1. Do reading-type items need a **minimum dwell threshold** per item, or one institute-wide default?
2. Should the daily cap be **per batch** or **global across batches**? Plan assumes global.
3. When a learner **enrolls mid-plan**, do they see past slots as catch-up or start clean? Plan
   assumes start clean.
4. Does the existing **minutes-based leaderboard get retired** once the ledger lands, or do both
   remain as selectable modes?

---

## 15. Build status — Phase 1, 2026-09-13

### Shipped into the working tree (NOT committed, NOT deployed)

**Migrations** (`admin_core_service/src/main/resources/db/migration/`)
- `V512__Create_points_ledger.sql`
- `V513__Create_daily_engagement.sql` — plan, slot, item, attempt
- `V514__Create_engagement_notification_log.sql` — at-most-once push

**Backend** (`admin_core_service/.../features/`)
- `points_ledger/` — entity, repository, `PointsLedgerService` (award / reverse / summary),
  `PointsController` (`/admin-core-service/points/v1/**`)
- `engagement/` — four entities, four repositories, `EngagementScheduleResolver`,
  `EngagementPlanService` (authoring + item versioning), `EngagementLearnerService`
  (feed, open, grade, submit, redaction), `EngagementTrackingService`,
  `EngagementSettingsService`, `EngagementNotifyJob`, admin + learner controllers
- `institute/service/InstituteTimezoneService` — reads `LANGUAGE_SETTING.timezone`
- `leaderboard/` — `Metric.POINTS` / `Window.WEEK` modes reading the ledger, alongside the
  untouched legacy minutes ranking
- `SettingKeyEnums` — `ENGAGEMENT_SETTING`
- `StudentSessionInstituteGroupMappingRepository` — batch recipient lookup

**Learner app**
- `services/engagement.ts`, `services/points.ts`
- `routes/dashboard/-components/engagement/` — `EngagementTodayCard`, `EngagementItemDialog`,
  `engagement-visuals`
- `routes/dashboard/index.tsx` — card mounted at the top of the main column; XP/level/points now
  overlaid from the server with the client computation as fallback

**Admin app**
- `routes/engagement/` — route, plans list, `PlanComposerDialog`, service, types
- `routeTree.gen.ts` regenerated

### Verified
- `mvn compile` clean (backend)
- **28 unit tests pass** — `EngagementScheduleResolverTest` covers day-of-week masks, window
  boundaries, catch-up expiry, reveal timing, percentage clamping and cross-timezone resolution;
  `PointsAccrualJobTest` covers streak length, including gaps, inactive days and measuring to the
  day asked about rather than the latest day
- Both frontends add **zero** TypeScript errors over their baselines (learner baseline 761 under
  plain `tsc`, admin baseline 1)
- ESLint clean on all new files; design gate clean (one permitted, commented inline style)

### Deployed and verified on PROD, 2026-09-13 19:17 UTC

Pushed as `1914a35f47`; backend deployed and confirmed via `~/.kube/vacademy-prod-direct.yaml`:

- Flyway applied V512 → V513 → V514 in 174ms; schema at v514.
- `Started AdminCoreServiceApplication in 42.649 seconds`; 4/4 replicas `1/1 Running`, 0 restarts.
- 54 engagement/points classes present in the running `/app/admin_core_service.jar`.
- No errors attributable to this feature (the one `ERROR` in logs is a pre-existing
  `Catalogue not found for tag`).

**A clean boot is the proof the JPA queries are valid** — Spring Data validates every `@Query` at
startup, so the risk flagged before deploy is retired.

### END-TO-END VERIFIED ON PROD, 2026-09-14

A real plan was authored, answered by a real learner, and scored — against production.

| Step | Result |
|---|---|
| `POST /engagement/admin/v1/plan` | 200; plan stored with `timezone: Asia/Kolkata` snapshotted |
| `GET /engagement/learner/v1/feed` | task served, `state: OPEN`, correct IST→UTC window |
| Answer-key redaction | options served; `correctOptionId` and `explanation` **stripped** pre-reveal |
| `POST .../item/{id}/submit` | 200, graded server-side, `isCorrect: true`, `isVerified: true`, **30 pts** (10 completion + 20 correct) |
| Points summary | `totalPoints: 30`, breakdown `ENGAGEMENT_ITEM → "Daily engagement"` — the first ledger rows in the platform |
| **Double submit, wrong answer** | returned the ORIGINAL attempt unchanged, still 30 pts — no double-award, no overwrite |
| Feed after completion | `items: 0`, `completedToday: 1` |
| `GET .../item/{id}/tracking` | `completedCount 1`, `correctCount 1`, full per-learner row |
| Leaderboard `metric=POINTS` | rank 1 Shreyash Jain **30 pts**, rank 2 Deepankar Dey 0 — roster-scoped, both members present |

**Accrual verified on prod too.** Predicted from the raw activity rows before running it —
12 learner-days, two consecutive pairs for the test learner — then confirmed: `rowsWritten: 14`,
learner total **80** (ACTIVITY 40 / ENGAGEMENT_ITEM 30 / ENGAGEMENT_STREAK 10). Re-running the same
window wrote **0**; widening to 60 days wrote only the 7 genuinely new days. Leaderboard `WEEK` now
reads 30 against `ALL` 90 — a real window, not a copy of all-time.

**Five defects this exposed, every one of which compiled, booted and passed unit tests:**

1-2. Authorization + feed scoping (`b2a6f2f9c1`), below.
3. `::bigint` rewritten by Hibernate to `:bigint` → Postgres syntax error at execution (`4aaf7be365`).
   The repo already used `CAST(... AS bigint)` everywhere for exactly this reason.
4. A named parameter used twice renders as two placeholders, so the `GROUP BY` expression no longer
   matched the `SELECT` expression (`53d13557a6`). The local date is now computed once in a subquery.
   **A psql check with the zone inlined as a literal passes and hides this** — verify native queries
   with `PREPARE`/`EXECUTE` and real placeholders.
5. Backfilled awards were stamped "now", so a 30-day backfill put the learner's whole history inside
   today and inside the current weekly leaderboard window (`463c97c6d0`). Awards now carry the end of
   the local day they were earned. Totals were correct throughout — only their distribution over time
   was wrong, so any check that only compared totals would have passed.

**The original two, fixed in `b2a6f2f9c1`:**

1. The engagement admin endpoints performed **no authorization at all** — `instituteId` was just a
   string the caller supplied, so any authenticated user could publish onto another institute's
   learner home pages, or read and delete their plans. Every handler now requires staff membership.
2. The learner feed queried plans **by batch alone**, with no institute predicate, so a
   cross-institute plan appeared in the feed with its payload. `getItem`/`submit` already checked —
   that asymmetry is exactly what made it readable but un-openable, and what made it visible at all.

Neither would have been found by reading the code or by the unit tests. They surfaced because a
plan was created while naming the wrong institute and the learner was still served it.
- Frontends deploy separately (Cloudflare Pages, not k8s) — confirm the admin and learner bundles
  carry this work before expecting anything on screen.
- The stored QA test accounts return `Bad credentials` as of 2026-09-13; fresh ones are needed for
  a live round trip.

### Known gaps (deliberate, Phase 2+)
- ~~No streak job~~ — **BUILT 2026-09-14** as part of `PointsAccrualJob` (see below).
- ~~No admin tracking UI~~ — **BUILT 2026-09-14.** `/engagement` plans expand to their slots and
  tasks; each task opens a tracking table (per-learner status, correct/wrong, points, time, late
  flag) with completed/correct/accuracy stats. Slots load only on expand.
- Editing an existing plan's slots/items from the UI: the composer creates only. The backend
  supports update and item versioning.
- No `ENGAGEMENT_SETTING` settings screen; defaults apply (cap 5, 80% scroll, 15s dwell,
  unverified score bonus off).
- **Sidebar entry added 2026-09-14**: LMS → Learning Engagement → "Daily Engagement" (`/engagement`),
  with en/hi/fr/ar strings. Before this the route was unreachable except by typing the URL.
### Points accrual — ACTIVITY and streak points enter the ledger (2026-09-14)

`PointsAccrualJob` (nightly 00:30, ShedLock) turns learning activity into ledger rows, so POINTS
becomes a SUPERSET of the legacy minutes ranking instead of a replacement for it.

- Reads a purpose-built lean query (`ActivityLogRepository.findDailyActivityForInstitute`) that
  groups by `(user, institute-local date)`. The existing per-day query joins slide/module/subject/
  session and is far too heavy to run institute-wide nightly. Grouping by user+date also means a
  learner in several batches earns one day's points, not one per batch.
- Award sizes come from `BADGES_REWARDS_SETTING.scoring` — the values already on the Badges &
  Rewards screen, which until now only the browser read. Defaults mirror the learner app's
  `DEFAULT_SCORING`; **keep them in lock-step** or an institute that never opened that screen would
  see its points shift the day accrual starts.
- Idempotency key is `{SOURCE}:{local date}:{userId}`, so re-running is free. Each run reconsiders
  the last 3 days (activity can arrive late) and never settles *today*, which is still in progress.
  Backfilling history is just `accrueForInstitute(instituteId, moreDays)`.
- Skips any institute that has not enabled badges/leaderboard — writing points for an institute
  that never opted into a points economy would surface numbers nobody asked for.

`POST /admin-core-service/points/v1/accrual/run?instituteId=…&days=30` (institute admin) runs the
same accrual on demand, bounded to 365 days. It works **even while the nightly job is disabled** —
deliberately, so accrual can be tried on one institute and inspected before being switched on for
everyone. It is also the backfill tool: awards are idempotent per day, so widening `days` simply
fills in the earlier days it has not written yet.

**OFF BY DEFAULT: `vacademy.points.accrual.enabled=false`.** The first run writes points for every
active learner in every enabled institute, which changes what learners see. That should be a
deliberate switch, not a side effect of a deploy. Set it to `true` when you want accrual to begin.

Batch leaderboards in POINTS mode now scope by the batch **roster** rather than by
`package_session_id` on the ledger rows: engagement points carry a batch, but learner-level awards
(ACTIVITY, streaks) carry none and a package-session filter would silently drop them.

Still NOT in the ledger: **assessment points**. Best-score data lives in assessment_service, so it
needs a cross-service read; until then the `ASSESSMENT` source type is defined but unused.

- The learner leaderboard UI still requests the default ACTIVITY metric. **Deliberately not
  flipped yet.** `points_ledger` is currently written by daily engagement ONLY — nothing writes
  `ACTIVITY`, `ASSESSMENT` or `ENGAGEMENT_STREAK` rows. Flipping today would rank every learner at
  0 and be a regression on the current minutes ranking, which at least separates active learners.
  (b) is now half-built: activity and streak points accrue once `PointsAccrualJob` is switched on.
  Flip the UI to `metric=POINTS` once accrual has run and the numbers look right — verify against a
  real batch before flipping, since that is the moment every learner's visible rank changes.
- ~~Strings in the new UI are not run through i18n.~~ Done 2026-09-21 (§18).

---

## 16. Phase 4 — AI planner (BUILT 2026-09-21)

**Flow:** Brief → one draft → review → publish. The AI never publishes; the draft comes back in the
composer's own request shape (`slots[].items[]`) and is saved through the normal engagement API
after the teacher has looked at every task. Entry points: "Plan with AI" on `/engagement` and on the
course page's Engagement tab.

**Brief** (`AiPlanWizard`): batches (multi, server-paged picker), topic in the teacher's words,
grounding chapters (subject → chapters, multi-select; slide HTML is collected client-side and sent as
`grounding_texts`), optional knowledge base, duration (1/7/14/30 days), tasks per day (1–3),
window/reveal times, difficulty, language, and which task kinds to use.

**Review:** day list → that day's tasks (retitle, remove) → live learner preview (reuses
`PlanPreview`). Readings arrive with `<img data-img-prompt>` placeholders; "Add pictures" upgrades
one reading to a `VISUAL_NOTE` on demand. A draft written from the topic alone (no grounding) is
flagged so facts get checked before publishing.

**Service** (`ai_service/app/routers/engagement_plan.py`, `services/engagement_plan_service.py`):
- `POST /ai-service/engagement/plan/draft` — one structured JSON call on **`z-ai/glm-5.3-flash`**
  (`ENGAGEMENT_PLAN_MODEL` overrides) produces every day's MCQs (4 options, key, explanation,
  `hideResultUntilReveal` on by default), written questions, polls, readings (200–350 words of
  semantic HTML) and **flashcard games** (rendered server-side from a card list into a self-contained
  HTML game that speaks `vacademy:complete`, so it also works as a slide). Grounding = teacher-picked
  slide text + `KbRetrievalService.search` hits on the topic, capped at 24k chars. Malformed items
  are DROPPED, never repaired into something wrong.
- `POST /ai-service/engagement/plan/illustrate` — runs `illustrate_document` (**`qwen/qwen-image-3`**)
  over one reading's placeholders, max 3 pictures.

**Credits — the cost plan:**

| Step | Tool key | Charge |
|---|---|---|
| Draft (whole plan, any length) | `engagement_plan` | flat **10**, charged as max(flat, tokens × 2) |
| Pictures for one reading | `html_document_image` | **2 per picture actually returned** |

The two are split on purpose. A fortnight of illustrated pages would cost 14 × (page + images)
before the teacher had seen anything; instead the draft is cheap and pictures are opt-in per task.
Both endpoints 402 on a pre-flight balance check before spending, and bill after success
(best-effort — a billing hiccup never takes a generated draft away). The wizard shows the price
before each spend.

**Not in this phase:** streaming per-day progress (the draft is one call), regenerate-one-task,
per-task type switching in review (remove + re-draft instead), and games beyond flashcards.

---

## 17. Deep review, 2026-09-21 — gaps found and closed (`bd2b47c239`)

| # | Gap | Fix |
|---|---|---|
| 1 | **Written/uploaded answers discarded at submit** — validated, graded, never stored | Learner response (option, text, file ids, score) serialised into `engagement_attempt.response_json`; shown in tracking + CSV; files open via signed URL |
| 2 | **No reveal surface** — the "8 PM answer + leaderboard" moment had nowhere to land | Feed returns `revealed[]` (completed tasks past reveal, last 2 days) with key/explanation/result; home card shows a "Revealed" section. The only place the key ever travels to a learner |
| 3 | **AI endpoints defaulted to ADMIN role** — a learner token could spend institute credits | Explicit teacher/admin authority required, 403 otherwise; JWT per-institute role map read correctly |
| 4 | Batch name never populated (decision 3) | `packageSessionName` resolved per plan; shown on cards and revealed entries |
| 5 | "Keep your streak alive" copy, no streak | `streakDays` = consecutive institute-local days with a completion, yesterday counting; 🔥 chip on the card |
| 6 | No unpublish/remove from the plan list | Eye / trash actions on `PlanCard` (attempts and points untouched by removal) |
| 7 | No batch-level view | `GET /plan/{id}/overview` — per-learner done/correct/missed/points, "slipping" = 3+ missed **closed** tasks (a learner who joined yesterday is not marked as missing a fortnight) |
| 8 | AI idempotency key minted per call → retry double-charged | Minted once per attempt, reused on retry, rotated on success |

**Still open after this pass:** push notification at reveal time; an `ENGAGEMENT_SETTING` screen
(cap / dwell / scroll thresholds); i18n for the new UI strings; `QUIZ` (assessment-backed) item type
has no authoring or learner path and is effectively unused; assessment points still outside the
ledger; AI wizard has no regenerate-one-task or streaming.

---

## 18. Follow-through, 2026-09-21 (`225ba8f314` + admin i18n commit)

Closed from the §17 list: reveal push (`V525`, `EngagementNotifyJob` REVEAL kind), Settings → Daily
Engagement screen, regenerate-one-task in the AI wizard (`engagement_item`, 2 credits), and i18n on
both apps.

**i18n.** Learner strings live in `dashboardEngagement` (learner app, en/hi/fr/ar). Admin strings
live in `frontend-admin-dashboard/public/locales/<lng>/engagement.json` (en/hi/fr/ar, ~275 keys)
under `page / card / composer / preview / batchPicker / slidePicker / tracking / overview / wizard /
settings`. Item-type, miss-policy and question-format labels are keyed by their enum value
(`composer.types.QUESTION_OF_DAY`, `composer.miss.CATCH_UP_REDUCED`, `composer.formats.TEXT`, each
with a `_hint` sibling) so the composer, plan card and live preview share one set of names — add a
new `ItemType` and the three surfaces pick up the label from one key. Namespaces resolve by file
name (`src/i18n.ts` lazy backend), so nothing was registered.

**Prod probe, 2026-09-21 14:30 IST** (riya_jain / shreyash777): settings save+get round-trip;
plan create with hidden-result MCQ + TEXT + reading; feed redacts key, names batch; hidden MCQ
paid 10 not 30 (bonus withheld); idempotent double submit; TEXT answer stored and shown in tracking
+ CSV; reading 510 under threshold, 5 pts over; overview counts; AI draft 200 for admin (glm-5.3-flash,
88 s for 1 day), 403 for learner. **Found + fixed live (`b6234bd4b6`):** `GET /item/{id}` and the
feed copied `attempt.isCorrect` through on hide-until-reveal questions, so a refresh leaked the
outcome the submit response had withheld. Trap: ai_service role checks need the `clientId` header
(auth service resolves `clientId@username`); without it every admin gets 403.

**Past tasks (2026-09-22, `1d6cab367e`).** `GET /engagement/learner/v1/history?instituteId&days=30`
(≤90) → `{from,to,items[],done,missed,pointsEarned}`; each item is the learner DTO plus
`historyStatus` DONE|MISSED|CATCH_UP, `isLate`, `completedAt`, and the answer key once revealed.
Because an attempt is per item, a completion is filed under the occurrence in effect when it
happened (a late one under the occurrence it caught up FOR); later occurrences of a recurring slot
are skipped, earlier closed ones are MISSED, today's OPEN ones stay on the card. Learner page
`/engagement/history` (7/30/90-day windows, grouped by day, catch-up entries open the normal
dialog); "See past tasks" link at the bottom of the home card.

**Still open:** `QUIZ` item type unused; assessment points outside the ledger; AI wizard streaming;
nightly accrual (`vacademy.points.accrual.enabled`) still OFF pending the POINTS-metric flip.

---

## 19. Integrity, contracts and flashcards after the September rebuild (2026-09-25/26)

A review of both UIs against prod data (learner D1–D55, admin A1–A22) found an answer-key leak,
forgeable gates, a save path that wiped completions, and two UIs that didn't match the product
bar. The fixes and the rebuild shipped as the commits in §19.12. This section is the contract as
it stands on `origin/main` after `c7814cd36b`; it overrides §7, §8 and §16 where they differ. The
narrative (what was wrong, what shipped per wave, what is deferred) is in
[`ENGAGEMENT_UI_REBUILD_2026-09.md`](./ENGAGEMENT_UI_REBUILD_2026-09.md).

Paths: `BE/` = `admin_core_service/.../features/engagement/`.

### 19.1 Redaction rule (answer key)

- `toLearnerDto` sends `correctOptionId` and `explanation` **only when the reveal time has passed
  AND the learner has finished the task or can no longer submit it** (closed, catch-up window
  over). "Reveal time passed" alone is not enough: before `4b21c1ffca` every catch-up question past
  its reveal, and any open question whose reveal came before its close, shipped the key to
  learners who could still answer.
- A hide-until-reveal question never carries `isCorrect` / the outcome before the reveal, on
  submit, on `GET /item/{id}` or in the feed (`b6234bd4b6`).
- History: an older run of a recurring question does not ship its key while today's run of the
  same item is still answerable.
- `revealed[]` in the feed carries **only `QUESTION_OF_DAY` and `POLL`**. Readings, notes, games,
  lessons and flashcards have nothing to reveal and never appear there.
- **No bonus after the reveal.** An answer submitted after the reveal time earns completion points
  only; the submit response says so with `answerAlreadyOut: true`. `EngagementRevealJob` skips
  answers given after the reveal and pays late (catch-up) answers at the catch-up percent, not in
  full. Its idempotency key is
  `ENGAGEMENT_BONUS:{itemId}:v{attempt.itemVersion}:{userId}`, so a version bump (§19.3) can't pay
  the same learner twice.

### 19.2 STARTED on GET, and server-time gates

- `GET /engagement/learner/v1/item/{id}` records a `STARTED` attempt the first time a learner opens
  the task (`insertStartedIfAbsent`, `ON CONFLICT DO NOTHING`). `startedAt` is the **first open
  ever** and is never reset. There is no `/start` endpoint; clients open a task by fetching it.
- Every count (feed progress, tracking, overview, history) filters `COMPLETED`; a STARTED row never
  counts as done. It does count as "Opened" in tracking.
- Submit measures dwell as `serverElapsedMs = now − startedAt`. The client's `timeSpentMs` is
  stored for reference and **never gates anything**. No `startedAt` (never opened through GET) is a
  rejection, not a pass.

| Type | Gate (server) | Setting (Settings → Daily Engagement, per institute) | Reject code |
|---|---|---|---|
| `READING_HTML`, `VISUAL_NOTE` | elapsed ≥ `minReadSeconds` **and** client `scrollPercent` ≥ `minScrollPercent` (advisory; the server can't see the page) | `minReadSeconds` default 15 (0–3600); `minScrollPercent` default 80 (0–100) | `READ_GATE` |
| `GAME` | elapsed ≥ `minGameSeconds`; reported score clamped to `maxScore`; score bonus only if verifiable or `allowUnverifiedScoreBonus` | `minGameSeconds` default 20 (0–3600) | `GAME_NOT_FINISHED` |
| `FLASHCARDS` | §19.4 | none (per-deck formula) | `FLASHCARDS_*` |
| `COURSE_SLIDE` | the slide's own progress reads as finished | — | `LESSON_NOT_FINISHED` |

The learner item DTO exposes `minReadMs`, `minScrollPercent` and `minGameMs` so the runner's gate
checklist mirrors the server rule exactly. Client side, a game's claim button stays disabled until
the page posts `vacademy:complete`, with a hand-claim after 60 s for games that never do. These
gates are **patience checks**, not proof of learning; keep completion points for readings and
games well below a question's correct points.

### 19.3 Item versioning in place, and the answer-key lock

The composer re-sends every task on every save (and must — `retireItemsNotIn` soft-deletes any
item a slot request leaves out). The old `upsertItem` retired and re-inserted any task with an
attempt under a new id, changed or not; combined with STARTED-on-GET, merely opening a task made
the next "Save changes" wipe completions, re-pay points and zero tracking. Now
(`BE/service/EngagementItemChangePolicy.java`):

1. **Normalise first.** FLASHCARDS payloads are validated and replaced by their canonical JSON, and
   the server-forced fields applied (§19.4), before any compare.
2. **No-op detection.** `isLearnerVisibleChange` compares type, title, content HTML, slide id,
   question id, completion/correct points, max score, required, hide-result and the payload
   **parsed as JSON** (jsonb reorders keys, so string compares are wrong). Unchanged → only order,
   schedule overrides and the slot (a task moved to another day, `9d320229e2`) are updated; id and
   version stay.
3. **Real change → versioned in place:** same id, `version + 1`. Attempts keep the `item_version`
   they were made against, so completions, points and tracking stay attached. There is no
   RETIRED-and-insert path and no `root_item_id`; no migration.
4. **Answer-key lock.** Once a task has COMPLETED attempts, a save that changes the item type
   (`TYPE_LOCKED`: "…its type can't change. Add a new task instead."), a question's format, its
   `correctOptionId` or its **set** of option ids is rejected ("Learners have already answered
   this question, so its answer key can't change. Add a new task instead."). Fixing option *text*
   is allowed. GAME → FLASHCARDS conversion counts as a type change.
5. **Write-time validation** (created or changed tasks only; stored rows are never re-validated):
   points are integers 0–1000; polls and MCQs need ≥ 2 options; an MCQ's correct option must exist;
   readings, notes and games need content; lessons need a slide; a task id from another plan can't
   be written through this one.

A mid-session learner holding an older version is handled per type: FLASHCARDS rejects with
`FLASHCARDS_STALE` (the client refetches and resumes); every other type grades against the current
version.

### 19.4 FLASHCARDS contract

A first-class item type (`EngagementEnums.ItemType.FLASHCARDS`). `item_type` is `varchar(48)` with
no CHECK, so no migration. Legacy AI decks stored as `GAME` HTML keep working as games.

**Payload `flashcards/v1`** (server authoritative; the admin zod schema matches it byte for byte):

```json
{"schema":"flashcards/v1",
 "cards":[{"id":"c_7k2m9q","front":"Impairment","back":"A problem in body function or structure","hint":"Body level"}],
 "settings":{"shuffle":true}}
```

| Rule | Limit |
|---|---|
| Cards | 1–50 ("Add at least 1 card", "…at most 50 cards") |
| `front` / `back` / `hint` | 1–200 / 1–500 / 0–150, counted in **UTF-16 units** after trimming (Java `String.length()` = JS `.length`) |
| Lines per face | ≤ 12; more is **rejected**, never truncated |
| Card id | `^[a-z0-9_-]{1,24}$`, unique in the deck. The client mints `c_` + 6 base36; the server mints only for a missing id and rejects duplicates ("Card 7: duplicate id"). Ids survive edits. |
| Text | plain text, **never HTML-stripped** on the server (breaks `2 < x > 1`, chemistry, code); trim, `\r\n`→`\n`, control chars removed, horizontal whitespace collapsed. Renderers treat it as text (`dir="auto"`). |
| Settings | only `shuffle` (default true); unknown keys dropped (`startWith`, `frontImageFileId` are deferred) |
| Task title | ≤ 200 |

**Server-forced fields** (request values ignored): `correctPoints = 0`, `hideResultUntilReveal =
false`, `maxScore = cards.size()`, `isVerifiable = false`. Duplicate fronts are a non-blocking
warning in the editor, import and AI de-duplication.

**Submit:** `EngagementSubmitRequest.cardOutcomes: [{cardId, result: KNOWN|LEARNING}]` (the first
rating of each card) plus `itemVersion`. Checked in order, first failure wins:

| # | Condition | `reasonCode` | Message |
|---|---|---|---|
| 1 | never opened through `GET item` (no `startedAt`) | `FLASHCARDS_STALE` | "Open the cards first" |
| 2 | `itemVersion` ≠ the item's current version | `FLASHCARDS_STALE` | "These cards were just updated. Reloading them now." |
| 3 | outcomes are not exactly the current card ids, once each, each KNOWN/LEARNING (also what an old app that sends no outcomes gets) | `FLASHCARDS_INCOMPLETE` | "Study every card to finish. If you don't see the cards, update the app." |
| 4 | `serverElapsedMs < max(5 s, min(n × 1.5 s, 60 s))` | `FLASHCARDS_TOO_FAST` | "Take a moment with each card before finishing" |

- **Time gate = patience check only.** `startedAt` is the first open ever and never resets, so a
  learner who reopens a deck later passes it immediately. It stops an instant tap-through on first
  open, nothing more.
- **Scoring is completion-only, in every setting.** Self-rating is effort, not a graded answer:
  `pointsAwarded = completionPoints` (catch-up percent and late rules apply as usual; there is no
  reveal), `score = known`, `maxScore = n`, `isCorrect = null`.
- **Stored response** is built on the server from the validated outcomes, before the generic
  `buildResponseJson`: `{"flashcards":{"version","total","known","outcomes":[{cardId,result}]}}`.
  Client `extra` and `score` are never stored.
- **Learner DTO:** no `cardCount` (read `maxScore`, sent in every state); `flashcardsResult
  {version, known, total, learningCardIds}` when a COMPLETED attempt exists. Past/history rows
  render "Flashcards · Knew 9 of 12" from `payloadJson` + `flashcardsResult` without calling
  `GET item` (which refuses closed tasks).
- **Learner client** (`E/flashcards/`): seeded shuffle (`hash(userId+itemId+version)`), flip by
  tap/Space/Enter/button, Got it / Still learning after the first flip, Undo, swipe > 80 px with
  `touch-action: pan-y`, RTL-mirrored arrows, keys 1/2, `motion-safe` rotateY with a 150 ms
  crossfade under reduced motion, sessionStorage resume keyed by `itemId:version` (every access in
  try/catch), stale-version refetch that keeps ratings for surviving card ids, and a summary with
  a local-only "Study N again". Estimated time: `max(1, ceil(n × 12 / 60))` minutes.
- **Tracking:** `GET item/{id}/tracking/cards` → `{cards:[{cardId, front, back, studied, gotIt,
  stillLearning, stillLearningRate}], removedOutcomes}`, aggregated over COMPLETED attempts of all
  versions (same id); outcomes for card ids no longer in the deck are summed into
  `removedOutcomes`. The item CSV adds Known (first pass), Cards and Still learning (fronts).
- **Rollout gate:** old native learner builds can't render the type and get
  `FLASHCARDS_INCOMPLETE`'s "update the app" message. The admin type chip sat behind
  `VITE_ENGAGEMENT_FLASHCARDS` until the learner web + OTA shipped; it is **on by default** since
  `2e6e6dda2c` (`=false` still hides it).

### 19.5 Learner feed contract (`GET /engagement/learner/v1/feed?instituteId=`)

Additive: every field added in the rebuild is optional to clients, and older fields keep their
meaning (`totalToday` is legacy = `items.length`).

| Field | Meaning |
|---|---|
| `items[]` | openable now, ordered required → soonest `closesAt` → `sortOrder`, capped by `dailyItemCap` (default 5, 1–50), followed by the catch-ups. Today's tasks = `items` minus the ids in `catchUp`. |
| `upcoming[]` | locked future items (7 days, incl. today's not-yet-open) — **metadata only**, never payloads |
| `scheduledToday` | every task scheduled today across the learner's batches in any state; **constant through the day**; a catch-up never enters it. The progress denominator. |
| `completedToday` | today's runs COMPLETED (STARTED never counts) |
| `catchUp[]` | still-doable earlier runs at the catch-up percent; **max 2** (`CATCH_UP_FEED_CAP`), soonest-closing first; never use the cap; each carries `catchUpClosesAt` and `effectivePoints` |
| `catchUpClosesAt` | earliest listed catch-up close (ISO instant) or null |
| `doneToday[]` | finished today with the outcome, newest first (catch-ups finished today included) |
| `hiddenByCap` | today's open tasks the cap is holding back; falls as the learner finishes; **never counted as missed** (`capApplied` legacy flag) |
| `revealed[]` | QOTD/POLL only, redacted per §19.1 |
| `today`, `serverTimeMs` | institute-local date and server clock, so countdowns correct device skew |
| `streakDays` | deprecated — the streak comes from the points summary (§19.8) |

Per item (`EngagementItemDTO`) additions: `earnablePoints`, `effectivePoints`, `pendingBonus`,
`scoreBonusEnabled`, `claimable` (COURSE_SLIDE whose slide is already finished; computed, never
creates an attempt), `excerpt` (160 UTF-16 units), `promptText`, `pollResults` + `responseCount`
and `correctRate` (percentages only from **5** responses up), `minReadMs` / `minScrollPercent` /
`minGameMs`, `flashcardsResult`. A pending reveal bonus settles on read in a `REQUIRES_NEW`
transaction, so the feed stays read-only and on the replica. QUIZ items are left out of the feed and
history (no learner path; a direct submit is `UNSUPPORTED_TYPE`).

**Submit response** additions: `alreadyCompleted` (idempotent re-submit; no second ledger row),
`answerAlreadyOut`, `pollResults`, `responseCount` (alongside the existing `resultPending` and
`newTotalPoints`).

**History** (`GET /history?instituteId&days=` ≤ 90): `missed` counts CLOSED occurrences only;
still-catchable ones are reported as `catchUp`.

**Pushes** carry `actionUrl`: `/engagement?slot={slotId}` for a task push,
`/engagement?tab=answers` for a reveal push. The learner `/engagement` page has Today · Answers ·
Past tabs; `/engagement/history` redirects to `?tab=past`.

### 19.6 Admin tracking contract

`GET /engagement/admin/v1/item/{id}/tracking?instituteId&status=ALL|DONE|NOT_DONE|STARTED|LATE&page&size`
(the no-`status` form is unchanged):

- Header: `completedCount`, `correctCount`, `enrolledCount`, `startedCount`, `notDoneCount`,
  `lateCount`, `gradedCount`, `maxScore`, `optionCounts[{optionId,count}]` (one grouped query on
  `response_json->>'selectedOptionId'`; MCQ and POLL distributions), paging fields.
- `NOT_DONE` synthesizes rows (status `NOT_STARTED`) for **enrolled learners who never opened** the
  task; `ALL` = every attempt followed by those rows.
- Row: learner, status, `isCorrect`, `score`/`maxScore`, points, late, `selectedOptionId`,
  `textAnswer`, `fileIds`, `startedAt`, `serverTimeMs` ("since first opened", computed on the
  server), `flashcardsKnown` / `flashcardsTotal` / `learningCardIds`.
- Accuracy is shown only for gradable tasks (QOTD + MCQ + `correctOptionId`); TEXT/UPLOAD show
  "answers to read n".
- `GET item/{id}/tracking/export`: CSV with a UTF-8 BOM (Hindi/Arabic names open in Excel); any
  learner-controlled cell starting with `= + - @`, TAB or CR is prefixed with `'` (OWASP formula
  injection). Adds selected option text and the flashcards columns.
- `GET item/{id}/tracking/cards`: §19.4.

### 19.7 Plan overview and plan list contracts

`GET /engagement/admin/v1/plan/{id}/overview?instituteId` with any of `page`, `size`, `q`,
`needsAttention` returns the new shape (no params = the legacy shape):

- One aggregate query (no N+1). Per learner (`LearnerProgress`): `available`, `done`, `overdue`,
  `missed`, points, last active, and `learnerClass` = `NOT_STARTED | BEHIND | ON_TRACK`; sorted
  most-at-risk first; server-side paging and search. Cap-hidden tasks are **excluded from missed**.
- Plan level: `notStarted` / `behind` / `onTrack` counts, `tasksOpened`, `tasksPastDue`,
  `tasksCapHidden`, `dailyItemCap`, `today`, `days[]` (completion by day: tasks, completed,
  available, rate) and `tasks[]` (per-task progress, `capHidden`, run date, state).
- `GET plan/{id}/overview/export`: learner × task CSV, BOM + the same escaping.

`GET /engagement/admin/v1/plan/list?instituteId` takes optional `packageSessionId`, `status`, `q`,
`sort`, `page`, `size`. **No `page`/`size` = the old plain array**; with them, a page object. Rows
carry `packageSessionLabel`, `firstDate`, `lastDate`, `dayCount`, `taskCount`, `todayState`
(DRAFT / UPCOMING / RUNNING / ENDED / ARCHIVED), `todayTaskCount`, `learnerCount`; slot items carry
`completedCount` so rows read "1 / 2 learners". Computed with a constant number of queries. Archive
is a status update (→ ARCHIVED) through the normal update path.

### 19.8 Points summary contract

`GET /admin-core-service/points/v1/me/summary` keeps `totalPoints`, `weekPoints`, `todayPoints`,
`level`, `pointsToNextLevel`, `breakdown`, and adds **one server-side streak**: `currentStreak`,
`longestStreak`, `keptToday`, `last7Days[{date, active}]`, `today`, `timezone` — computed over the
union of activity days and ledger days in the **institute timezone**. The 366-day scan is skipped
inside a write transaction, so a submit never runs it. Every learner streak display (play heroes,
`StreakCounterWidget`, the gamification panel, `AchievementsDialog`, the Today header) reads this
value; the points pill reads this summary itself on every page, and a submit's `newTotalPoints`
updates it once. Gamification-off institutes see no points, streaks or celebrations.

### 19.9 `reasonCode` list

Learner refusals throw `EngagementRejectedException` (a `VacademyException`, so status **510** and
`ex` are unchanged). `EngagementExceptionAdvice` — scoped to the engagement controller package,
ordered first, handling only this exception — returns the existing `ErrorInfo` body (`url`, `ex`,
`responseCode`, `date`) **plus** `reasonCode`. Clients act on the code, never on message text;
clients that ignore the field keep working.

| Code | When |
|---|---|
| `NOT_OPEN` | the occurrence hasn't opened yet |
| `TASK_CLOSED` | the occurrence closed and its catch-up window (if any) is over |
| `READ_GATE` | reading/note not opened, or the dwell/scroll gate isn't met |
| `GAME_NOT_FINISHED` | game not opened, or `minGameSeconds` hasn't passed |
| `ANSWER_REQUIRED` | question/poll submitted without an option, text or file |
| `LESSON_NOT_FINISHED` | COURSE_SLIDE whose slide progress isn't finished |
| `UNSUPPORTED_TYPE` | a type this server can't grade (QUIZ) |
| `FLASHCARDS_STALE` | deck never opened via GET, or an older version — refetch and resume |
| `FLASHCARDS_INCOMPLETE` | outcomes don't cover the current deck exactly once (or an old app) |
| `FLASHCARDS_TOO_FAST` | under the per-deck patience gate |

Admin authoring refusals (answer-key lock, `TYPE_LOCKED`, validation) stay plain
`VacademyException` messages; the composer maps them to i18n.

### 19.10 AI planner: job flow and native decks

Supersedes the "flashcard games" and "Not in this phase" parts of §16. `ai_service`,
`/ai-service/engagement/plan`:

- **Jobs** (modelled on `html_document`): `POST /draft/jobs` starts a draft that keeps running if
  the teacher closes the tab (auth, brief checks and the 402 credit pre-flight still fail fast);
  `GET /draft/jobs/{id}` polls (`status`, `progress {phase, days_done, days_total}`, result);
  `GET /draft/jobs/active?kind=plan|item|any` re-attaches the wizard to a running or unacknowledged
  job; `POST /draft/jobs/{id}/cancel` stops it (nothing charged); `POST /draft/jobs/{id}/ack`
  marks it picked up. A job with no heartbeat past the stale window reads `INTERRUPTED` ("…you
  weren't charged"). The same `idempotency_key` within the re-attach window returns the existing
  job instead of a second paid draft. **Billed once, only on success.** The synchronous
  `POST /draft` is unchanged and is the wizard's fallback. Plan-draft jobs are internal and stay out
  of the AI task list.
- **Brief:** `weekdays` and explicit `dates`; `single_item_type` (+ `avoid_title`) regenerates one
  task. The response reports `days_requested`/`items_requested` vs `days_planned`/`items_planned`,
  `missing_dates`, `short_dates` and `dropped_items`; the review warns when they differ.
- **Native decks:** `Mix.flashcards` (with `game` kept as a deprecated alias) makes the model emit
  `FLASHCARDS` items; `_norm_cards` strips tags (the **only** place tags are stripped), trims, drops
  over-length or one-sided cards, de-duplicates fronts case-insensitively, caps at **20**, requires
  **≥ 3** (else the item is dropped), mints ids, and emits the `flashcards/v1` payload with
  `correctPoints: 0`. `render_flashcards_html` is gone.
- **Regenerate** asks for only the requested type and returns **422 before billing** for anything of
  another type/format or empty ("…you weren't charged"); unknown types are a 400 before the
  pre-flight. The regenerated task keeps the teacher's point values; duplicate option ids are
  renumbered; invented `<img src>` URLs become picture placeholders; `brief.title` wins over the
  model's title; parse/normalise failures are 502/422, never a billed 500.
- **Pricing:** `engagement_plan` = 3 + 0.5 per task (2 a day for a week = 10; a month of 3 a day =
  50); `engagement_item` (regenerate one task, decks included) = flat 2. Pictures stay a separate
  opt-in `html_document_image` charge. `ENGAGEMENT_PLAN_REASONING_EFFORT` (default `low`).
- **Grounding** now actually works: the chapter picker read the wrong field of the modules API and
  could never select a chapter, so before `b02e7b513a` no AI plan was ever grounded.

### 19.11 Per-item attempt limitation (recurring slots)

`engagement_attempt` is `UNIQUE (item_id, user_id)` (V513) with no `run_date`: **an attempt is per
item, not per occurrence.** A recurring slot (weekday mask, multi-day window) is one item across all
its runs, so:

- a learner completes a recurring task **once**; later runs show it done and pay nothing more;
- the feed gives no catch-up for a recurring slot whose today-run exists (the D20 stopgap), so an
  older run can't be caught up while today's is open;
- history files a completion under the occurrence in effect when it happened (a late one under the
  run it caught up for); an older run is MISSED once a newer run exists;
- tracking and the plan list count a recurring task once, by its first completion. The admin UI
  does **not** yet say so on the tracking dialog (planned note: "recurring slot: counts first
  completion only").

Per-occurrence attempts need a product decision and a Flyway migration (a `run_date` column and a new
unique key). Deferred; if built, number it **V531 or higher** from `origin/main`'s migration
directory in the push worktree (V530 was the latest on 2026-09-25).

### 19.12 Commits (`origin/main`, oldest first)

| Commit | Wave | Summary |
|---|---|---|
| `4b21c1ffca` | 0 | Answer-key leak closed; no bonus after reveal; STARTED-on-GET + server-time reading/game gates (`minGameSeconds` 20); game claim waits for `vacademy:complete`; server reasons shown; missed = closed only; QUIZ out of feed |
| `370e2a22e9` | 1A | Plan save no longer re-issues tasks: no-op detection, versioning in place, answer-key lock, write-time validation, reveal-bonus key on the answered version |
| `ba26ac3cbe` | 1B | Tracking CSV formula-injection escaping + BOM; `revealed` is questions/polls only |
| `a2f4377840` | 1C | AI regenerate keeps type and points, 422 before billing, title/date/effort fixes |
| `306bd00f38` | 1D–1E | Admin stopgaps: multi-day warning + day-1 field preservation, composer reset/confirm/loading, error states with Retry, AlertDialog + StatusChip, AI draft close guard + resume, accuracy only for keyed MCQs, settings keep unknown keys + `minGameSeconds` field |
| `705f4bf944` | 2A–2C | Server contracts: FLASHCARDS type + validator + grading, plan list/detail fields, tracking/overview/cards insight, notification `actionUrl`, server streak, learner feed fields, `reasonCode` |
| `87d6b6eb0f` | 2D–2E | Learner data layer (React Query feed, optimistic submit, draft store), single points source, reasonCode mapping, tone/copy/visual primitives, phosphor icons for emoji |
| `95a0a3cd02` | 2F | Admin foundations: zod composer + flashcards schemas (round-trip every DTO field), institute-tz formatters, type metadata, service additions, `MyDialog footerLeft` |
| `9d320229e2` | 3F fix | Moving an unchanged task to another day keeps its id |
| `31dd33ef9f` | 3A–3E | Learner Today module, one task runner (sheet), native flashcards, one streak, `/engagement` page with Today · Answers · Past |
| `6efd34f1e8` | 3F–3H | Slot-aware composer (day rail, RHF + zod), per-type item editors, flashcards editor + import, learner-accurate preview + sandbox, batch picker by course, course picker fixed |
| `2e6e6dda2c` | 3 | Flashcards authoring on by default |
| `b02e7b513a` | 4A–4C, 4E | Tracking dialog, progress overview, AI planner rebuild (job flow, grounding fixed, review with real editors), plans list/card/lifecycle/duplicate |
| `c7814cd36b` | 4D | AI emits native flashcard decks; background drafting jobs; weekdays/dates; requested vs delivered; per-task pricing |

Wave 5 (i18n hi/fr/ar, the `design-lint` / `i18n-lint` rules below, this section) follows these.

**Lint rules added in Wave 5** (`scripts/design-lint.mjs`, `scripts/i18n-lint.mjs`):
- `learner-primary-out-of-scale` (**error**, learner app): `*-primary-600..950`. The learner
  Tailwind config defines primary 50–500 only, so those classes compile to nothing and text renders
  in the inherited colour.
- `raw-palette-family` (warn, both apps): `(sky|violet|amber|teal|emerald|rose|orange|indigo|fuchsia|cyan|pink)-<n>`
  colour utilities; use theme/semantic tokens, or annotate genuinely categorical colour with
  `design-lint-ignore`.
- `arbitrary-grid-template` (warn): `grid-cols-[…]` / `grid-rows-[…]`.
- `undefined-locale-toLocale` (i18n, added lines): `.toLocale{Date,Time,}String(undefined, …)` —
  the same browser-locale fallback as the no-arg call.

## 20. Days after joining (RELATIVE plans), 2026-09-26 (`fa2451d4c7`, `82719780ae`)

Clients asked for plans such as "a reading on days 1–3 after the student joins",
counted from each student's own start rather than from calendar dates.

**Model.** `engagement_plan.schedule_mode` is `CALENDAR` (the default; every older
plan) or `RELATIVE`. The mode is chosen when the plan is created and can't change
afterwards: the server answers "A plan's schedule type can't change. Create a new plan
instead."

- **Day 1 = the join day.** The join date is the student's batch enrolment:
  `MIN(COALESCE(enrolled_date, created_at))` over ACTIVE
  `student_session_institute_group_mapping` rows for the plan's package session.
- **Students already enrolled** start Day 1 on the plan's first publish date
  (`engagement_plan.published_at`, stamped the first time the plan is PUBLISHED;
  V532 backfills it with `created_at` for plans that were already published).
- Each student's Day 1 = `max(local join date, local publish date)`, in the plan's
  timezone.
- **Slots.** `engagement_slot.start_day` / `end_day` hold values from 1 to 366;
  `end_day` defaults to `start_day`. `dow_mask` is always null. `start_date` /
  `end_date` hold placeholder dates, Day N = `2000-01-01 + (N − 1)`, so
  date-bounded queries never match a relative slot by accident. The admin form keeps
  days as these placeholder dates, and requests carry `startDay` / `endDay`.

**Resolution.** `EngagementRelativeSchedule.localize(plan, slot, dayOne)` returns a
detached copy of the slot shifted to the student's own dates. The copy is never
saved. Every existing rule then runs unchanged: open window, catch-up, reveal,
history and the daily cap.
- Learner feed and history: `EngagementLearnerService.withRelativeSlots`.
- Item open and submit: `loadContext`.
- Tracking: `progressFor` works per student. Plan-wide figures follow the earliest
  student's Day 1.
- Notify job: picks relative slots by time of day, then the students whose day it is.
- Reveal job: `settleRelativePlan` uses a per-attempt reveal instant.

**Summaries.** A relative plan's list row carries:
- `scheduleMode: RELATIVE`
- `lastDay` (the last Day N)
- `firstDate` / `lastDate` = null
- `todayTaskCount` = null
- `todayState` = RUNNING while PUBLISHED

**Admin UI.**
- Composer: "Schedule by: Calendar dates / Days after joining" (new plans only;
  switching keeps the days' spacing).
- Day editor: Day, From day and To day number fields, with no weekday picker.
- Headers read "Day 3" or "Days 1–3".
- The publish summary, plan card ("Days 1–N after joining"), day list, duplicate
  dialog (copies day for day) and tracking (reveal "each day") never show
  placeholder dates.

**Known limits.**
- Item tracking's NOT_DONE list includes students whose day hasn't come yet.
- The AI planner creates calendar plans only.
