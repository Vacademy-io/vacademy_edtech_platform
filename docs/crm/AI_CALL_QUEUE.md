# AI Call Queue — System Reference

**What this is:** the reference for how an AI call gets from "someone asked for it" to
"a phone is ringing" — the durable queue in front of every AI dial, the single drainer
that places them, how the fleet's capacity is decided, and how one institute is stopped
from starving another.

**Read from the code on 2026-08-27** (`feature/ai-call-queue`). File paths are given so
any claim here can be re-derived from source.

**Companion docs**
- [`AI_CALLING_SYSTEM.md`](./AI_CALLING_SYSTEM.md) — everything downstream of the dial:
  the agent, STT/LLM/TTS, the live pipeline, outcome → lead action. **Read that first;**
  this doc only covers what happens *before* `AiCallService.placeCall` and the machinery
  that decides *when* it runs.
- [`AAVTAAR_AI_CALLING.md`](./AAVTAAR_AI_CALLING.md) — the third-party AI provider, which
  the queue governs differently (see §5).

---

## Table of contents

1. [Why it exists](#1-why-it-exists)
2. [The map](#2-the-map)
3. [The tables](#3-the-tables)
4. [The drain loop](#4-the-drain-loop)
5. [Capacity — capability vs policy](#5-capacity--capability-vs-policy)
6. [Fairness](#6-fairness)
7. [Guards, windows and deferral](#7-guards-windows-and-deferral)
8. [The manual fast path](#8-the-manual-fast-path)
9. [APIs](#9-apis)
10. [The UI](#10-the-ui)
11. [Runbook](#11-runbook)
12. [Traps](#12-traps)
13. [Not done](#13-not-done)

---

## 1. Why it exists

Before this, three **uncoordinated in-memory pacers** decided when an AI call went out:

| Path | Pacer | Fleet-aware? |
|---|---|---|
| CALL_AI workflow node | single-thread executor, 300 ms pace | no |
| Bulk campaign | completion-aware sliding window, `MAX_PARALLEL = 3` **per campaign** | no |
| Manual click | straight to the provider | no |

None knew about the others. `MAX_PARALLEL` was per *campaign*, so two institutes running
campaigns put twice the intended number of calls on a voice box that carries a fixed few.
The overflow was absorbed by the bot's own admission control, which answers **"all lines
busy" to a real lead**. The queues also lived in one replica's heap, so a deploy mid-run
silently dropped whatever had not dialled.

All three now write to one durable queue, drained by one job. One dialler is what makes
the fleet-wide limit *exact* — there is no distributed counting to get wrong and no
per-replica share to rebalance when the deployment scales.

---

## 2. The map

```
 producers                         queue                      dialler
 ─────────                         ─────                      ───────
 CALL_AI node ─┐
 bulk campaign ├─► AiCallQueueService.enqueue ─► ai_call_queue ─► AiCallQueueDrainJob
 manual click ─┘        (durable INSERT)                            │  @Scheduled(2s)
                                                                    │  @SchedulerLock
                                                                    ▼
                                                    AiCallService.placeCall  (UNCHANGED)
                                                                    │
                                                                    ▼
                                                          provider → telephony_call_log
```

Key files, all under
`admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/`:

| File | Role |
|---|---|
| `queue/AiCallQueueService.java` | enqueue, dedupe, cancel, all read models |
| `queue/AiCallQueueDrainJob.java` | **the only thing that places an AI call** |
| `queue/AiCallCapacityService.java` | how many may run, and how many one institute may hold |
| `queue/AiCallQueueSnapshotService.java` | the whole queue in one consistent payload |
| `queue/AiCallQueueDirectory.java` | id → institute/agent names, live call state |
| `queue/AiVoiceBoxService.java` | the capacity pool and its runtime knobs |
| `queue/AiVoiceBoxHealthPoller.java` | polls each box's `/health` |
| `queue/AiCallQueueTxOps.java` | inserts on their own transaction (see §3) |
| `core/CallingWindowUtil.java` | calling shifts, shared with `CallAiNodeHandler` |

`AiCallService.placeCall` was **not modified**. The drainer is just another caller, so
every pre-dial guard it already enforced is inherited for free — see §7.

---

## 3. The tables

Created by `V472__ai_call_queue.sql`, corrected by `V473__ai_call_queue_id_varchar.sql`.

### `ai_call_queue`

One row per call waiting to go out. Carries everything `placeCall` needs, because the
dial can happen hours after the enqueue and nothing may be re-derived from state that has
since moved on.

**Lifecycle** (`AiCallQueueStatus`):

```
QUEUED ──► DISPATCHING ──► DIALED
   │            │
   │            └─► (failure) ──► QUEUED (backoff) ──► FAILED after 3 attempts
   ├─► EXPIRED    (waited past its TTL)
   └─► CANCELLED  (admin cancelled, lead deleted, lead assigned to a human)
```

> **`DIALED` never moves again.** It means "the provider accepted the dial", not "the call
> is happening" and not "the call finished". Whether a call is *live* lives in
> `telephony_call_log`, which is why the `LIVE` and `ACTIVE` filters are joins (§9). This
> is the single most misread thing in the schema.

**Idempotency.** A partial unique index on `dedupe_key` covering only `QUEUED` +
`DISPATCHING`:

```sql
CREATE UNIQUE INDEX ux_ai_call_queue_pending ON ai_call_queue (dedupe_key)
    WHERE status IN ('QUEUED', 'DISPATCHING');
```

Key is `institute|provider|subject`. This is load-bearing: **the workflow engine resumes a
run by RESTARTING it**, so a CALL_AI node re-enters many times for the same lead before
its first call ever goes out. Partial, so a legitimate later retry (after the first has
dialled) still enqueues.

Because a unique-index violation marks the *calling* transaction rollback-only, inserts go
through `AiCallQueueTxOps` on `REQUIRES_NEW` — otherwise one de-duplicated call would roll
back the entire workflow step that asked for it.

### `ai_call_lane`

Per-institute overrides, **sparse by design** — an institute with no row uses the dynamic
default. `max_concurrent` (null = dynamic), `paused`, `weight`, `last_dispatched_at`.

`last_dispatched_at` is written and never read. It is carried so that switching from FIFO
to a rotation (§6) is an `ORDER BY` change rather than a migration.

### `ai_voice_box`

The capacity pool — one row per voice box, with its own `max_concurrent`, `enabled`,
`health_status`, `active_calls`, `base_url`. Modelled on `bbb_server_pool` (V192).

> **This table does not route calls.** Dialling still resolves the bot address from
> `telephony.vacademy-ai.bot-base-url`. `base_url` here exists only so the health poller
> knows who to ask, so a bad row can never send a call to the wrong host — the worst it
> can do is mis-state capacity.

### `app_config` keys

| Key | Default | Meaning |
|---|---|---|
| `ai_call_fleet_limit` | *(absent)* | **ops ceiling** on simultaneous calls. Absent/blank = hardware decides. `0` = pause. No migration seeds it — an absent row reads as "no limit", and `PUT /capacity` creates it on first use |
| `ai_call_capacity_enabled` | `true` | ⚠️ `false` **BYPASSES** the limit (unlimited). Not an on/off switch — see §12 |
| `ai_call_aavtaar_max_concurrent` | `20` | Aavtaar's own ceiling (their infra, not ours) |
| `ai_call_stuck_grace_sec` | `720` | a non-terminal call older than this stops holding a slot |
| `ai_call_queue_ttl_hours` | `48` | past this an item is `EXPIRED`, not dialled |
| `ai_call_avg_secs` | `180` | assumed call length; **ETA display only** |
| `ai_call_reserved_interactive` | `0` | slots held back for manual clicks |
| `ai_call_drain_batch` | `200` | max rows examined per tick |

---

## 4. The drain loop

`AiCallQueueDrainJob.drain()` — `@Scheduled(fixedDelay = 2s)` + `@SchedulerLock`.

Per tick:

1. **Expire** items past their TTL; **release** claims left by a drainer that died mid-tick.
2. Take one **capacity snapshot** (`AiCallCapacityService.snapshot()`).
3. Fetch candidates: **each lane's head**, not the oldest N overall (see §6).
4. For each, in FIFO order — skip if the lane is paused, at its cap, or the provider is
   full; defer the whole lane if outside its calling window.
5. **CAS claim** `QUEUED → DISPATCHING`. Only the winner dials.
6. Call `placeCall`. On success: `DIALED` + `call_log_id`. Otherwise §7.

**Why one drainer is safe with 2–4 replicas.** ShedLock means one pod runs a tick. That
lock can still lapse (`lockAtMostFor`) and let two overlap, so send-once does **not** rest
on it — the conditional `UPDATE ... WHERE status='QUEUED'` is the real guarantee.

**Occupancy is derived, never counted.** In-flight comes from `telephony_call_log`
(`countAiCallsInFlight`), not a counter, for two reasons: a counter leaks — a call whose
webhook never lands would hold its slot forever, and lost AI webhooks are a documented
failure mode — and a counter is blind to calls placed outside the queue, which still
occupy the box.

---

## 5. Capacity — capability vs policy

Two different questions, deliberately two different knobs:

| | Question | Where | Changes when |
|---|---|---|---|
| **Capability** | "what can this box carry?" | `ai_voice_box.max_concurrent` | hardware changes |
| **Policy** | "how hard do we drive it *now*?" | `ai_call_fleet_limit` | an incident, a campaign, overnight |

```
effective capacity = MIN( Σ max_concurrent over enabled, non-DOWN boxes ,  fleet limit )
```

The limit only ever **caps**. A limit above the hardware is accepted and simply
non-binding, so this control can never promise capacity that does not exist. `0` means
dial nothing — and because the queue goes on accepting, **a pause defers calls rather than
losing them**, which is what makes it safe to reach for in a hurry.

**Per provider.** `VACADEMY_AI` draws on our boxes. `AAVTAAR` dials on Aavtaar's own
infrastructure, so counting it against our boxes would throttle it for no physical reason
— it gets its own number. `MOCK` never leaves the process and is unlimited.

**Health.** A box that fails its `/health` poll is marked `DOWN` and its slots leave the
fleet. A box that has never been polled successfully stays `UNKNOWN` and **still counts** —
an unconfigured poller must not be able to switch AI calling off.

**Propagation.** The drainer resolves capacity from the database every tick, so a change
is live on every replica within ~2 s with no restart. Lowering below the calls already in
flight never cuts a live call off; it stops new dials until in-flight falls under the
limit.

---

## 6. Fairness

**Ordering is strict FIFO** on `(priority DESC, created_at)`. There is no rotation.

What stops one institute's 500-lead upload from blocking another is the **per-lane
concurrency cap**: the scan steps over an item whose institute is already at its cap, so a
latecomer with five leads takes the next free line instead of waiting out the backlog.

Default cap is dynamic:

```
laneCap = max(1, ceil(fleetCapacity / lanesWithWork))
```

Ceiling, not floor — capacity 3 split two ways is 2+1, so the third slot is used, where
flooring would idle it at 1+1. One institute queuing alone gets the whole fleet.

Worked example — fleet 3, cap 2. A uploads 500 at 10:00; B arrives at 14:00 with 5:

| | strict FIFO, no cap | FIFO + cap |
|---|---|---|
| B's first call | after A's remaining 480 ≈ **8 h** | next free slot ≈ **3 min** |
| B's 5 calls done | ≈ 8 h | ≈ **15 min** |

**The candidate query is a `LATERAL`** for exactly this reason. A flat
`ORDER BY created_at LIMIT 200` over a queue holding A's 500 returns only A's rows — the
drainer would never *see* B, so skipping a capped lane could not help it. Taking each
lane's head first bounds the candidate set while guaranteeing every waiting institute
appears in it.

> **Known limit.** This holds while *simultaneously busy institutes ≤ fleet capacity*. At
> capacity 3 that is three institutes; a fourth starves, because FIFO always re-picks the
> earliest item and the earlier lanes are perpetually under cap. The fix at that point is a
> rotation — `ai_call_lane.last_dispatched_at` is already maintained for it. Raising fleet
> capacity also resolves it.

---

## 7. Guards, windows and deferral

**Every pre-dial guard is re-evaluated at DIAL time**, not enqueue time — an item can wait
hours, during which the lead may be assigned to a human or the institute may run out of
credits. This is free: the drainer calls `placeCall`, which owns them all.

| `placeCall` outcome | Queue result |
|---|---|
| dispatched | `DIALED` + `call_log_id` |
| `SKIPPED_ASSIGNED` | `CANCELLED` — a human owns the lead now |
| `SKIPPED_DUPLICATE` | `CANCELLED` — dialled by another path moments ago |
| `SKIPPED_DAILY_CAP` | lane deferred 1 h |
| `ConflictException` "deleted" | `CANCELLED` |
| `ConflictException` (credits) | lane deferred 15 min |
| anything else | backoff 1/5/15 min, `FAILED` after 3 attempts |

**Lane-wide, not per item.** Credits, the daily cap and calling windows are institute-wide
conditions, so they defer the *whole lane* (`deferLane`). Without that, an institute with
400 queued items and an empty wallet would make 400 credit checks working through its own
backlog before settling down.

**Calling windows now gate the queue.** `callingShifts` previously gated only the retry
re-dialer, which was safe while dialling was instant. With a queue, a 10:00 bulk upload
would otherwise still be dialling at 01:00. `MANUAL` is exempt — it never had a window and
must not gain one.

**Attempts.** The CAS claim increments `attempts` in the database, and the drainer mirrors
that onto its detached copy. Without that mirror every later `save()` writes the pre-claim
value back and the counter never advances — an item that keeps failing would retry for
ever. A *deferral* hands the attempt back; only a real failure consumes one.

---

## 8. The manual fast path

A counsellor's click enqueues like everything else, then immediately tries
`AiCallQueueDrainJob.dispatchNowIfLineFree`. With a free line and nothing of that
institute's already waiting, it dials **on the request thread** and returns exactly the
response it always did (`dispatched: true` + `callLogId`). Only on a busy fleet does it
come back `status: "QUEUED"` with a position and ETA.

It **cannot jump the line**: `countAheadInLane == 0` is required, the lane cap still
applies, and it takes the same CAS claim, so this and a concurrent tick can never both
dial it.

Conflicts are re-thrown on this path (`surfaceConflicts`) so "out of credits" and "lead
deleted" still reach a waiting human as the 409s they always were, rather than becoming a
silent deferral.

> Consequence worth knowing: **a manual call is almost never in `QUEUED`.** That is why the
> UI defaults to `ACTIVE` and not `QUEUED` — see §10.

---

## 9. APIs

### Institute-scoped — `/admin-core-service/v1/telephony/ai-queue`

Authenticated, `instituteAccessValidator` on every call.

| | |
|---|---|
| `GET /` | paged rows. `status=ACTIVE` (default) \| `QUEUED` \| `LIVE` \| `DIALED` \| `FAILED` \| `EXPIRED` \| `CANCELLED` \| `ALL` |
| `GET /summary` | depth, in-flight, ETA, paused |
| `GET /bulk-run?audienceId=` | queue-side counts for one campaign |
| `POST /cancel` | cancel everything waiting (optionally one run) |
| `DELETE /{id}` | cancel one |

> **No capacity figures.** `QueueSummary` deliberately carries no `fleetCapacity`,
> `laneCapacity` or `fleetInFlight`, and there is no institute-scoped `/lane` endpoint. How
> many lines exist and how many an institute may hold are internal operating facts; an
> institute seeing "2 of 3" learns it shares a small pool with other tenants, which is not
> its business. The wait is expressed as *time*, which is the part that concerns them.

`ACTIVE` and `LIVE` are not statuses — they are joins against `telephony_call_log`, because
`DIALED` never moves (§3). `ACTIVE` uses a **LEFT** join: a `QUEUED` row has no
`call_log_id` yet, and an inner join would drop exactly the rows the queue is named after.

### Super-admin — `/admin-core-service/super-admin/v1/ai-queue`

`SuperAdminAuthUtil.requireSuperAdmin` (caller's `users.id` must be on `SUPER_ADMIN_USER_IDS`). Cross-tenant, so it *does* carry the
real numbers. This is the feed for the **Vacademy Health** dashboard.

| | |
|---|---|
| `GET /overview?limit=&instituteId=` | fleet + boxes + every lane, one payload |
| `GET /items?instituteId=&status=&provider=&source=` | the calls, paged, with institute + agent names |
| `GET /capacity` | capacity, occupancy, boxes |
| **`PUT /capacity`** | `{"maxConcurrentCalls": N}` — throttle. `0` pauses, `null` clears |
| `GET\|POST\|PUT\|DELETE /boxes[/{id}]` | the capacity pool |
| `GET\|PUT /lanes[/{instituteId}]` | per-institute cap / pause |
| `PUT /settings/{key}` | the other runtime knobs (allow-listed) |

`/overview` is assembled from **one** capacity snapshot. Fetching capacity and lanes
separately lets a polling dashboard render occupancy from one instant beside lane shares
from another — which is how "these numbers do not add up" tickets are born.

On `PUT /capacity`, render **`vacademyAiCapacity`** (what is now enforced), not the number
submitted. Set 20 on a 3-call fleet and you get 3, honestly reported alongside
`physicalCapacity`.

> An earlier `/internal/ai-queue/snapshot` variant, authenticated by a static secret in
> `client_secret_key`, was removed. It returned this exact payload from this exact
> assembler; all it bought was a second auth path and a per-environment DB row to forget.

---

## 10. The UI

**CRM → Calling → Call Queue** (`/calling/call-queue`), its own route — Call Log is what
already happened, this is what has not happened yet.

**Hidden by default.** The sidebar sub-item `calling-call-queue` ships in
`SUB_ITEMS_HIDDEN_BY_DEFAULT`, so an institute opts in from Display Settings → Sidebar,
the same way it opts into Counsellors or Sales Dashboard. No bespoke toggle.

Cards: **Waiting · On a call now · Clears in**. No denominators and no fleet figures.

Filters default to **Active** (waiting + already dialling). Defaulting to `QUEUED` showed
an empty table exactly when calling was healthy, because of §8 — the page looked broken
while it was working.

The **Lead** column falls back to the call log's `to_number` when the queue row has no
phone of its own, which is usual: the manual click and the CALL_AI node pass only a lead
id and the number is resolved downstream at dial time.

---

## 11. Runbook

**Throttle / pause / restore**

```bash
# throttle to 2 simultaneous calls
curl -X PUT .../super-admin/v1/ai-queue/capacity -H "Authorization: Bearer $JWT" \
     -H 'Content-Type: application/json' -d '{"maxConcurrentCalls":2}'

# stop dialling (queue keeps accepting — nothing is lost)
... -d '{"maxConcurrentCalls":0}'

# back to whatever the hardware provides
... -d '{"maxConcurrentCalls":null}'
```

**Add a box** — `POST /boxes {"slug":"mumbai-2","baseUrl":"https://…","maxConcurrent":3}`.
Capacity rises on the next tick.

**Pause one institute** — `PUT /lanes/{instituteId} {"paused":true}`.

**"The queue will not move."** In order: is `vacademyAiCapacity` 0 (all boxes disabled or
`DOWN`)? Is `fleetLimit` 0? Is the lane paused? Is `not_before` in the future (calling
window, daily cap, no credits — `status_reason` says which)? Is the drainer running at all
(`grep "ai-call queue:"` in admin-core logs)?

**"Nothing shows in the tab."** Default filter is `ACTIVE`; a call that already ended is
`DIALED` with a terminal call log. Try `ALL`.

---

## 12. Traps

**`ai_call_capacity_enabled = false` BYPASSES the limit.** It returns `UNLIMITED`, not
zero. It is an escape hatch for a broken limiter, but it reads like an off switch for AI
calling — an operator wanting to *stop* calls would flip it and uncap the entire fleet
mid-incident. The API reports it as `concurrencyLimitBypassed` for that reason. **Do not
surface it in any dashboard.** To stop calling, set `fleetLimit` to 0.

**Primary keys are `VARCHAR(36)`, not `UUID`.** V472 declared them `UUID`; the entities map
`String` with `@UuidGenerator`, so Hibernate binds varchar and Postgres refuses the
implicit cast. Every enqueue failed until `V473` corrected it. Any new column that an
entity maps as `String` must be varchar.

**`DIALED` is not "in progress".** See §3. Judge liveness by joining `telephony_call_log`.

**The ETA is modelled, not measured.** It comes from `ai_call_avg_secs` (default 180) and
the lane's slot count. It is honest about *order of magnitude*, not minutes.

---

## 13. Not done

- **The drainer's dispatch path has never run in anger.** Everything exercised so far went
  through the manual fast path (§8), which dials inline. Nothing has yet sat in `QUEUED`
  and been picked up by a tick.
- **No tests.** None of this has unit or integration coverage.
- **`ai_voice_box.base_url` ships as `CONFIGURE_ME`**, so health polling is off until it is
  set. Capacity still counts the box (`UNKNOWN` counts by design).
- **No audit trail on capacity changes.** `PUT /capacity` logs at WARN; who changed it is
  not recorded in a queryable place.
- **Starvation beyond `fleetCapacity` busy institutes** — §6.
- **No global "pause all" separate from `fleetLimit: 0`**, which is adequate but overloads
  one control.
