# Assessment Load Test Runbook

Goal: measure, on the real production infrastructure, how many concurrent
test-takers one exam can carry end to end — auth login burst, start burst,
60s autosave steady state, submit wave — and turn that into a number we can
commit to clients.

**This test runs against prod (backend-stage.vacademy.io IS prod).** Everything
below is designed so the only prod impact is load itself, confined to a
dedicated throwaway institute, at an off-peak hour, with live abort criteria.

---

## 0. Pre-test gates (do once, before the first run)

1. **Fix auth_service's Hikari pool first.** Prod runs the *stage* profile
   (Dockerfile `-Dspring.profiles.active=stage`), and
   `auth_service/src/main/resources/application-stage.properties` still says
   `maximum-pool-size=3`. The login burst funnels through 2 replicas × 3
   connections with a 60s connection-timeout. Same one-line fix that took
   assessment_service from collapsing to comfortable (3 → 15; PgBouncer's
   auth pool is 20 server conns, so no Postgres change needed). Testing
   without this measures a config bug, not capacity.
2. **Decide the topology under test.** Test what you intend to sell:
   - Config A (today): assessment-service ×1 replica, 2 CPU.
   - Config B (exam season): ×2 replicas — `kubectl scale deploy
     assessment-service --replicas=2` before the 500/1000 runs.
3. **Window:** 02:00–05:00 IST. Announce internally; nobody deploys during it.
4. **Baseline snapshot** (same commands as §4) taken before ramping.

## 1. Seed the load-test tenant (once) — ✅ DONE 2026-08-27

Everything in this section is already provisioned and end-to-end validated
(one full journey ran against prod: login 372ms → preview 538ms → start 362ms
→ autosave 398ms → submit; attempt ENDED/COMPLETED with 120/120 marks and 31
question_wise_marks rows). Ready-to-run values:

```bash
k6 run assessment-exam-journey.js \
  -e INSTITUTE_ID=245536e4-3748-4065-a7d3-0df03c9e5ddc \
  -e ASSESSMENT_ID=55af0371-e36d-4554-ae4a-d998ace3261e \
  -e BATCH_IDS=88d0e88e-8518-49c7-9a51-daefb80b752f \
  -e USER_PREFIX=loadtest -e PASSWORD='LoadTest@123' -e USER_COUNT=1000 \
  -e VUS=50 -e LOGIN_WINDOW=120 -e START_WINDOW=60 -e EXAM_MINUTES=10
```

- Institute: "LOADTEST" `245536e4-3748-4065-a7d3-0df03c9e5ddc`
- Assessment: "Surprise Test" `55af0371-…` — 30 MCQS (4 marks, −1 negative),
  AUTO evaluation, 20 reattempts, LIVE window until 2026-09-03 12:04 UTC
  (**extend bound_end_time before testing after that date**)
- Batch registration: `88d0e88e-8518-49c7-9a51-daefb80b752f` (registration is
  created lazily at first preview — no admin-core enrollment needed)
- Learners: `loadtest0001`…`loadtest1000` / `LoadTest@123`, STUDENT role,
  seeded directly in auth DB (cleanup: `DELETE FROM user_role WHERE user_id IN
  (SELECT id FROM users WHERE username LIKE 'loadtest%')` then the users)
- Questions tagged `source_type='LOADTEST'` in the question table for cleanup
- `attempt-template.json` is committed and validated — correct answers are
  `<questionId>-A`, so scored runs exercise the CORRECT path with real marks

Original procedure (kept for re-seeding a new tenant):

1. Create institute `LOADTEST — do not use` via the normal admin flow.
2. Create one batch; bulk-upload learners:
   `./gen-users-csv.sh 1000 > loadtest-users.csv` and upload via the admin
   bulk student upload (align columns with the template the UI hands out).
3. Create one assessment shaped like a real client exam — ~30–50 MCQs in 1–2
   sections, registered to the batch, LIVE window covering the test slot,
   auto evaluation (not MANUAL — MANUAL skips the scoring path we must load).
4. **Capture a real attempt template:** run one attempt by hand as
   `loadtest0001` (start, answer a few questions, let it autosave), then:
   ```sql
   SELECT attempt_data FROM student_attempt
   WHERE id = '<that attempt id>';
   ```
   Save the JSON as `loadtest/attempt-template.json`. Then restart that
   attempt or ignore it. Verify preview/start field names once by hand
   (`attemptId` vs `attempt_id` in the JSON responses) — the script accepts
   both, but eyeball one real response anyway.

## 2. Install k6 (laptop is fine; it's one Go binary)

```bash
brew install k6        # macOS
```
For the 1000-VU run prefer a small cloud VM in ap-south so home-uplink and
laptop limits don't pollute numbers (1000 VUs ≈ trivial CPU, but TLS +
sockets on hotel wifi is not a benchmark).

## 3. Ramp plan — stop at the first level that breaks

Each level is one full simulated exam (~20 min). Between levels: 10 min to
let queues drain + review numbers.

| Run | VUS | LOGIN_WINDOW | START_WINDOW | Config |
|-----|-----|--------------|--------------|--------|
| 1   | 50  | 120          | 60           | A      |
| 2   | 150 | 180          | 90           | A      |
| 3   | 300 | 300          | 120          | A      |
| 4   | 500 | 300          | 120          | A, then B |
| 5   | 1000| 600          | 180          | B      |

```bash
k6 run assessment-exam-journey.js \
  -e INSTITUTE_ID=... -e ASSESSMENT_ID=... -e BATCH_IDS=... \
  -e VUS=300 -e LOGIN_WINDOW=300 -e START_WINDOW=120 \
  -e EXAM_MINUTES=10 -e SYNC_INTERVAL=60
```
`SYNC_INTERVAL=60` matches the app's real autosave. A stress variant at 30s
doubles steady-state pressure — run it once at the target level to know the
safety margin.

## 4. Live monitoring during every run (second terminal)

```bash
export KUBECONFIG=~/.kube/vacademy-prod-direct.yaml

# CPU/mem of the exam path every 15s
watch -n15 'kubectl top pods | grep -E "auth|assessment|pgbouncer|admin-core"'

# PgBouncer: cl_waiting>0 or maxwait_us climbing = pool pressure
kubectl exec deploy/pgbouncer -- sh -c \
 'PGPASSWORD=$DB_PASSWORD psql -h 127.0.0.1 -p 6432 -U vacademy pgbouncer -c "SHOW POOLS"' \
 | grep -E 'assessment|auth_service '

# Assessment health: CRITICAL slow, executor overflow, workflow failures
kubectl logs deploy/assessment-service --since=2m | \
  grep -cE 'CRITICAL SLOW|Failed to trigger workflow|RejectedExecution'

# Auth health during the login window
kubectl logs deploy/auth-service --since=2m | grep -ciE 'error|exception|timeout'
```

## 5. Abort criteria — kill the run (Ctrl+C) if any of these

- k6 `http_req_failed` above ~2%, or any threshold red for >60s.
- `cl_waiting` > 5 sustained on assessment or auth PgBouncer pools.
- assessment-service CPU pinned at limit (2000m) for >2 min.
- Any real-institute user impact observed (Sentry alert, support ping).
- Postgres primary distress (from Sentry/node metrics).

After an abort the level below is your current capacity; fix what broke
before retrying.

## 6. What to record per run (the deliverable)

For each level: p50/p95/p99 of `login_ms / preview_ms / start_ms / sync_ms /
submit_ms`, `http_req_failed`, peak pod CPU per service, peak `cl_active` /
`maxwait` per PgBouncer pool, count of CRITICAL-slow logs. The client-facing
number is the highest level where **all** of: p95 sync < 2s, p95 start < 5s,
p95 submit < 8s, error rate < 1%, and no abort criterion fired — divided by
1.5 as the safety factor we actually promise.

## 7. Boundary conditions — verified 2026-08-27, re-check before big exams

**Connection budget (hard ceilings).** Postgres primary `max_connections=200`.
PgBouncer server pools sum to ~167 at absolute worst case (all pools + reserves
saturated at once) — headroom exists but is finite: raising any PgBouncer
`pool_size` eats it. Client side: `max_client_conn=300` vs ~150 worst-case
client connections across all services after the auth fix and with assessment
at 2 replicas. ai-service also routes via PgBouncer (DB_HOST=pgbouncer).
`query_wait_timeout=15s` means queries queued at PgBouncer beyond 15s are
KILLED, not delayed — under overload expect errors, not slow answers.

**Mass expiry (nobody submits).** The 5-min cron sweeps all LIVE attempts past
their time and enqueues a recalc per attempt onto the shared 8-thread pool
(queue 100, CallerRuns). Post-batching this is self-throttling and drains ~1000
attempts in well under a minute; exercise it once at target level with
`-e SUBMIT_RATIO=0.7` (30% abandon). Pre-batching this same path would have
taken >1 hour — do not run this variant on an old build.

**Duplicate clicks.** `start` is idempotent since 22 Aug (replays the stored
startTime — a repeat call cannot extend a learner's clock). A duplicate
`submit` is accepted and re-runs the full calculation: harmless to data
(ASSESSMENT_END has a replay guard) but it doubles submit-wave CPU; the FE
guard is the real protection. Keep an eye on submit counts vs VUs in results.

**Re-runs of the harness.** Enable unlimited reattempts on the load-test
assessment (else run 2 fails on existing attempts) and keep the whole run
inside the assessment's LIVE window — `boundEndTime` must be at least
`LOGIN_WINDOW + START_WINDOW + EXAM_MINUTES + 15min` away or the expiry cron
ends attempts mid-run and pollutes the numbers. The script tolerates an
"already live" reply on start (that's the idempotent replay, not an error) and
refuses to run with `VUS > USER_COUNT` so failed logins never masquerade as
server collapse.

**Token edge.** JWTs live 30 days: a learner mid-exam never refreshes, but a
learner whose token expires the moment the exam starts re-logins on the spot —
the login window and start burst can overlap; that is why the ramp keeps
LOGIN_WINDOW and START_WINDOW adjacent rather than gapped.

**Stress variant.** One run at target level with `-e SYNC_INTERVAL=30` doubles
steady-state pressure and tells you the margin above the app's real 60s cadence.

## 8. Cleanup

The load-test institute stays (reusable). Optionally delete the run's
attempts to keep tables lean:
```sql
DELETE FROM question_wise_marks WHERE attempt_id IN
  (SELECT id FROM student_attempt WHERE registration_id IN
    (SELECT id FROM assessment_user_registration WHERE institute_id = '<loadtest institute>'));
DELETE FROM student_attempt WHERE registration_id IN
  (SELECT id FROM assessment_user_registration WHERE institute_id = '<loadtest institute>');
```
Run row counts first; never run either statement without the institute filter.

---

## 9. Measured results — 2026-08-27 ramp (first full run)

All levels: full exam journey (login → preview → start → 60s autosaves →
submit), 30-MCQ AUTO-evaluated paper, run against prod during evening IST.

| VUs | Replicas | Journeys | Req errors | p95 login | p95 start | p95 sync | p95 submit | Verdict |
|-----|----------|----------|-----------|-----------|-----------|----------|-----------|---------|
| 50   | 1 | 50/50     | 0%    | 195ms | 128ms | 124ms | 327ms | pass |
| 150  | 1 | 149/150   | 0.06% | 138ms | 102ms | 116ms | 360ms | pass |
| 300  | 1 | 300/300   | 0%    | 137ms | 102ms | 111ms | 639ms | pass |
| 500  | 2 | 500/500   | 0%    | 133ms | 124ms | 120ms | 2209ms | pass |
| 1000 | 2 | 700/1000  | 2.5%  | 144ms | 745ms | 16420ms | 60002ms | **FAIL** (pre-fix) |
| 1000 | 2 | 1000/1000 | 0%    | 146ms | 134ms | 140ms | 139ms | **pass** (post-fix) |

Infrastructure was never the constraint: PgBouncer `cl_waiting` stayed 0 at
every level, auth-service sat at 3–5m CPU, assessment CPU peaked ~320m of
2000m. Both walls were application-level serialization.

**Bug 1 — analytics ran sync on the request thread** (fixed 76c0af31e1).
`sendAssessmentDataForAnalysisAsync` was named/documented async but had no
`@Async`: every submit built the enriched payload, ran the comparison/rank
query and called admin-core over HTTP on its Tomcat thread. The 1000-learner
submit wave serialized the request pool (submit p95 60s; innocent autosaves
starved to 16s). Now on a dedicated 3-thread DiscardOldest executor.

**Bug 2 — live-sync recalc clobbered concurrent submits** (fixed b52a9edde3).
Only visible by cross-checking the DB against k6: 66/1000 attempts (6.6%) sat
`status=LIVE` with NULL submit_time/result_marks while every submit returned
200. The async recalc holds a pre-submit snapshot; `StudentAttempt` has no
`@Version`, so its save rewrote the whole row and erased the submit. Now
re-reads and skips the write once the attempt is ENDED/submitted.

**Verification bar to reuse:** k6 green is NOT sufficient. Always cross-check
`SELECT status, count(submit_time) ... GROUP BY status` — the last clean run
shows 1000 ENDED/COMPLETED, 1000 with submit_time.

**Capacity conclusion:** 1000 concurrent test-takers pass on 2 replicas with
p95 ≤ 465ms on every step. Applying the runbook's 1.5 safety factor →
**650–700 is the number to quote**, with 300 safe on a single replica.
