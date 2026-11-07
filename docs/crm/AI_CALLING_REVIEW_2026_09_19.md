# AI calling review — 19 September 2026

Reviewed local commit `98f7c9f99f`, the four requested reference documents, current queue/outcome/voice code, existing test tools, and read-only production evidence. Mumbai was running voice image `d99bd2a5792488bd50e1e4d7e378a329f095f62a`. No calls were placed, messages sent, or production configuration/data changed.

Found **10 reproducible code defects: five P1 and five P2**. Production observations are labeled separately: an old red call, a vendor failure, or a replay assertion is not by itself proof of a current code bug.

## First implementation batch — call quality and speech caching

Implemented locally on 19 September; **not deployed**. This addresses findings 6–8 below and two additional defects found while implementing them:

* Smallest live synthesis, previews, and cache warming now share language selection. English uses `en`; Hindi/Hinglish retains `hi`. Language is carried from the Java agent warmer through Python and persisted in the cache ledger. Preview and speech-cache keys distinguish languages; old Smallest blobs are deliberately not reused because their language cannot be trusted. Other engines retain their existing keys. Smallest cache misses use live synthesis while the new namespace warms.
* Warm-on-save retains the agent's Smallest Pro/explicit model selection instead of dropping it to the default model. Live, preview, and warming share the model resolver. This prevents wrong-model rendering and enables matching warm audio to be reused by calls.
* Failed background renders back off for five minutes, then thirty minutes, and stop after three failed attempts. Retry state survives restarts and applies to both warm-on-save and the sweeper. Successful storage clears failures; the existing forget-by-key operation resets the budget. Changing a voice/model/language/text creates a new key. Concurrent warm/sweep requests render a key only once, and synthesis has a 90-second deadline. The rendering lock is never acquired by live playback.
* Overlapping speech is no longer counted as dead air. Actual quiet response gaps and caller thinking time retain their existing handling.
* **Additional metrics defect:** `SmallestTTSService` contains the substring `stt`, so the old classifier filed its TTS measurements under STT. Service-suffix matching now separates STT and TTS, including numbered Pipecat instances. Historical Smallest `stt_ttfb` values may therefore mix recognition and synthesis; they must not be used as pure STT measurements. Historical reports are not rewritten.

Validation: **570 unit tests passed** (20 existing warnings), including real cache-wrapper playback with stubbed synthesis, preview isolation, legacy SQLite migration, persistent retry limits, concurrent renders, timeout cleanup, metrics routing, and speech-overlap transitions. The changed Java warmer compiled against the existing backend classpath. Vendor requests in the added tests are mocked; no paid probes or outbound calls were made.

Timing validation was not clean on the first run: eight scenarios passed and five failed (unheard turn, fragmented turn, cached opener, answer over the tail, and mid-reply backchannel). That log contains long wall-clock discontinuities. All five failures passed on a targeted rerun with `caffeinate -i`, without changing turn-handling code between runs. This is a timing-sensitive check, not proof that all live call-quality issues are resolved. Evidence: `/private/tmp/ai-call-fixes-tests-final.log`, `/private/tmp/ai-call-fixes-timing.json`, and `/private/tmp/ai-call-fixes-timing-recheck.json`.

The latency benefit verified locally is reuse of matching pre-rendered speech without a vendor synthesis request. No reduction in live end-to-end milliseconds is claimed. Turn detection and interruption thresholds have not been changed in this batch.

After deployment, validate one English and one Hinglish test agent: compare preview/live pronunciation, confirm Smallest model and language match warmed entries, check cache-hit counts, and compare caller-stop-to-audio timing with separate LLM/STT/TTS measurements. Include an interrupted sentence and a short acknowledgment, and listen to the recording before lowering turn thresholds.

## Confirmed findings

### 1. P1 — Public bulk calling bypasses the queue and its limits

**Location:** `admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/controller/PublicAiCallingController.java:7`.

The public `BULK_CALL` endpoint invokes `AiCallService.placeCall(..., CallTrigger.MANUAL)` directly for each number. It never enqueues or checks fleet/lane capacity. A bulk request can therefore place calls while the queue's fleet limit is zero or its lane is paused, and can exceed the voice box's admission limit. Using `MANUAL` also disables the institute daily cap and automatic duplicate guards. The credit balance check still applies.

**Proof:** recompiled the current controller and ran it with four synthetic numbers and a mocked dial service. All four calls went straight to `placeCall` with `MANUAL`; there is no capacity collaborator on this path. No actual phone calls were made. This is a code reproduction, not a claim that production users have exploited the endpoint.

**Fix:** route the public API through the durable queue; use the bulk trigger for `BULK_CALL`, and the existing manual enqueue/fast path for `CLICK_TO_CALL`.

### 2. P1 — Webhook ingest can overwrite another institute's call result

**Location:** `.../telephony/core/AiVoiceWebhookService.java:83–98`; controller authentication is in `.../telephony/controller/AiVoiceWebhookController.java:97`.

Ingest finds an existing result by `(provider, call_uuid)` alone. It keeps the original institute ID but overwrites correlation, transcript, summary, disposition, and other report fields using the incoming institute's payload. The HTTP controller authenticates the institute named in the request; ingest does not verify that the existing result belongs to that institute. The later outcome ownership gate is too late to prevent the overwrite, and an already `PROCESSED` result is not reprocessed.

**Proof:** passed a synthetic institute-B report into the actual ingest service, targeting a synthetic institute-A result. The result remained owned by A and `PROCESSED`, but its summary, disposition, and correlation were overwritten by B. This requires knowledge of the target provider call UUID and authorization for the submitted institute, or that institute's configured no-secret behavior. No production mutation was attempted.

**Fix:** validate incoming institute ownership before mutating an existing result; bind the incoming correlation/provider call to that institute before accepting the report. Tenant scoping must also be consistent with the database uniqueness constraint.

### 3. P1 — Post-call send actions can report success without being persisted

**Location:** `.../telephony/core/AiCallOutcomeProcessor.java:457–481`; `.../telephony/core/AiCallActionService.java:330` and `:475`.

The outcome processor invokes post-call send rules synchronously from Spring's `afterCommit`. `applyPostCall` does not start a new transaction; its repository save uses the default `REQUIRED` propagation. The original transaction's resources are still attached during this callback, but its commit has already happened. An action can be saved into that persistence context and counted/logged as created without ever reaching the database. The outcome is already marked `PROCESSED`, so the usual retry path does not recreate the promised send.

**Proof:** actual action service, real Hibernate/JPA repository save, H2 database, and a Spring transaction synchronization. One matching post-call email rule returned `made=1` and logged success; a new entity manager read **zero rows**. The identical service invocation outside the callback persisted one row. Engine/member resolution was stubbed to existing IDs. This confirms loss for a configured matching post-call rule; it does not establish how many production promises were lost.

**Fix:** execute the post-call persistence in a separate proxied `REQUIRES_NEW` transaction, preserving the call/rule idempotency constraint. Test committed database state, not the returned action count. The adjacent booking callback also merits a transaction audit, but booking loss is not included as a confirmed finding here.

### 4. P1 — Concurrent queue deduplication throws instead of recovering

**Location:** `.../telephony/queue/AiCallQueueTxOps.java:45–67`; callers in `AiCallQueueService.java:140` and `:186`.

`insertOne` and `insertChunk` catch `DataIntegrityViolationException` inside their `REQUIRES_NEW` transaction and return null. The repository's participating transaction has already marked the transaction rollback-only. On leaving the proxied method, Spring throws `UnexpectedRollbackException`; the caller never receives the null it needs to recover. A concurrent duplicate can therefore fail enqueue, and a contended bulk chunk never reaches its per-item fallback.

**Proof:** actual transaction helper behind a Spring transactional proxy, with an actual H2 unique violation raised through a `REQUIRED` repository boundary. Both insertion methods threw `UnexpectedRollbackException`. This reproduces the transaction behavior independently of PostgreSQL-specific SQL.

**Fix:** let the constraint exception escape the inner transaction and catch it outside that proxy boundary, or use an atomic `INSERT ... ON CONFLICT DO NOTHING` path. Add a concurrency test for overlapping bulk/workflow enqueues.

### 5. P1 — Failed report persistence is acknowledged as successful delivery

**Location:** `.../telephony/controller/AiVoiceWebhookController.java:91–93`; `voice_bot_service/app/admin_core.py:89–97`; `app/report.py:895–900`.

If report ingest throws (for example, a transient database outage or commit failure), the controller catches it and returns HTTP 200 with `isSuccess=true`. The bot checks only the HTTP status and considers the report delivered. On the initial send, it never spools the report; on a spool retry, it deletes the saved report. Thus the durable retry mechanism cannot recover this class of failure. A later outcome reprocessor cannot recover a result that was never stored.

**Proof:** recompiled the actual controller and supplied an ingest service that throws a synthetic database exception. It returned HTTP 200 and `{isSuccess:true, message:"Received."}`. Fed that exact response body through the actual Python HTTP client using a fake transport and a real temporary report spool. The sweep reported `(posted=1, remaining=0)` and deleted the file despite the failed ingest. No production failures were injected.

**Fix:** acknowledge success only after durable acceptance. Return a retriable failure for the first-party voice bot, or durably land the raw payload before returning 2xx if third-party retry behavior requires that response. Validate application-level acceptance on the bot as well. Test that a transient ingest failure preserves the report until a later successful commit.

### 6. P2 — Health counts an interruption during bot speech as dead air

**Location:** `voice_bot_service/app/bot.py:3896–3930`.

When the caller starts speaking, `_silence_cause` correctly returns an empty string if the bot is already speaking. However, the caller-onset callback still adds the gap since the last stop timestamp to `dead_air`: it excludes only `caller_thinking`. That gap contains the bot's ongoing speech, not silence. `verdict()` then uses it to assign an amber/red health score.

**Proof:** executed the current callbacks with the bot speaking continuously and a caller interruption. There were **zero seconds of actual silence**, but diagnostics recorded **17 seconds** and a red `DEAD_AIR` verdict. The descriptive silence list stayed empty, explaining why a health maximum can have no matching silence explanation.

**Production relevance:** the latest connected call reports a 17.29-second maximum, while its recorded non-thinking silence explanations peak at 6.1 seconds. This is consistent with the measurement defect, but does not establish that every red flag on that call is false. Genuine pauses and other faults remain.

**Fix:** record silence only when neither participant is speaking, using actual quiet intervals. Cover both interruption directions in tests.

### 7. P2 — Smallest preview/cache synthesis hardcodes Hindi for English agents

**Location:** `voice_bot_service/app/main.py:551–574`; caller in `app/ttswarm.py:65`; live selection in `app/providers.py:841`.

Live TTS selects `en` for an English agent. Preview and off-call cache synthesis always send `language: hi`. Agent language is not carried through the warmer/candidate/cache identity, so the cached audio can differ from the live voice the caller would otherwise hear. Editing only the preview function is insufficient: language must reach the warmer and distinguish cache entries.

**Proof:** intercepted the actual preview function's outbound WebSocket payload with a fake socket: it sent `hi` for the same English text whose live language resolver returned `en`. No vendor request was required to establish the mismatch.

**Production relevance:** fresh logs repeatedly reject implausibly long renders of `Perfect.`. These corroborate a broken warming path; this review did not perform a new paid vendor A/B proving language is the sole cause of those renders. The existing live-language code documents an earlier vendor probe for this exact class of failure.

**Fix:** carry the agent language through preview, synthesis, candidate metadata, and cache keys; invalidate incompatible entries. Test payload parity between live and cached synthesis.

### 8. P2 — Rejected cache renders are retried indefinitely

**Location:** `voice_bot_service/app/ttscache.py:578–603`, `:719–750`; `app/ttswarm.py:216–229`.

`store()` rejects invalid audio without recording a failed attempt or retry time. `due()` selects any eligible candidate without a stored blob. The sweeper ignores the false return from `store`, so the same permanently invalid candidate remains due every pass. This spends vendor requests continuously and occupies the limited warm batch.

**Proof:** a real temporary speech-cache database, one eligible candidate, and three rejected 46-second PCM renders. After every rejection, the candidate was still immediately due.

**Production evidence:** **280 rejected renders of `Perfect.`** between 18 September 00:05 UTC and 19 September 00:31 UTC. Many recur about five minutes apart at roughly 46–49 seconds; the earliest captured example was 224.5 seconds. The rejected audio is not cached, which prevents those particular blobs from being replayed to callers, but the repeated generation continues.

**Fix:** persist attempts, last error, and next retry; back off and quarantine repeated invalid output. Apply equivalent handling to failed/empty synthesis, not just duration rejection.

### 9. P2 — A manual click can inherit automation rules and be cancelled

**Location:** `.../telephony/queue/AiCallQueueService.java:130–135`; `AiCallQueueDrainJob.java:291–296`.

When the lead already has a pending automated call, manual enqueue returns that existing row without promoting its trigger, priority, actor, or request details. The fast path subsequently dispatches it as `AUTOMATION`. In particular, if the lead has since been assigned to a counsellor, the automated guard cancels it even though a human explicitly requested a call and manual calls are exempt.

**Proof:** actual queue service and fast path, a pending automation row, and a manual enqueue. The request reused priority 100 and the old actor; `placeCall` received `AUTOMATION`, returned `SKIPPED_ASSIGNED`, and the item became `CANCELLED`.

**Fix:** define and implement an atomic promotion policy for a still-queued automated row when a manual request arrives. Do not reinterpret an item already being dispatched.

### 10. P2 — Lane deferrals also postpone exempt manual calls

**Location:** `.../telephony/queue/repository/AiCallQueueItemRepository.java:113–122`; callers in `AiCallQueueDrainJob`.

The calling-window and daily-cap branches defer the institute's entire queued lane. The SQL does not filter `call_trigger`. A manual item in that lane receives the same future `not_before`, even though manual calls explicitly bypass those two guards. A concrete trigger is a manual enqueue arriving after the drainer reads its candidates but before its automated call triggers `deferLane`; its higher priority cannot protect it from an update issued from that earlier snapshot. Both the normal candidate query and the fast path then honor the timestamp.

**Proof:** executed the repository's actual SQL against one manual and one automated queued row. Both were postponed by one hour for the daily cap, although `CallTrigger.MANUAL.enforcesDailyCap()` is false.

**Fix:** make deferral scope explicit: automation-only for calling windows and automatic daily caps; all applicable calls for insufficient credits or an explicit pause. Preserve longer unrelated holds.

## Production health snapshot

Database queried at **19 September 2026 00:33 UTC / 06:03 IST**, using a read-only transaction and statement timeout.

* Mumbai `/health`: `ok`, zero active calls, runtime maximum 10. Kubernetes application pods were running without restarts in the displayed snapshot.
* The queue's only registered box still has `base_url=CONFIGURE_ME`, health `UNKNOWN`, configured capacity 3, and no health-check timestamp. This is a confirmed configuration gap: health-based removal of that box cannot work. The queue's capacity of 3 versus runtime maximum 10 can be deliberate policy and is not itself a defect.
* Last seven days: **277 AI call-log rows** — 140 completed, 81 no-answer, 56 busy. Of the completed rows, 131 have an AI result and 129 have a stored recording. The nine missing results need call-specific investigation; this count alone does not prove lost webhooks.
* Queue rows in the query: 257 dialed and 23 failed after three attempts; no pending queued/dispatching rows. The available current admin pod logs do not establish the root cause of those historical failures.
* Call Intelligence: **79 completed, 17 failed**. Ten failures report OpenRouter 402, seven report transcription capacity 429. These are actual failed analyses; provider credit exhaustion and worker capacity should be investigated separately from the code defects above. Eleven completed rows retain a historical error string, so classify by status rather than the error field alone. Zero analysis credits for AI calls is intentional in current code.

Latest connected calls, all on 18 September:

| Call ID prefix | Created UTC (IST) | Duration | Report | Call Intelligence |
| --- | --- | --- | --- | --- |
| `0cfe1007` | 07:30 (13:00) | 328 s | RED: ANSWER_DELETED, DEAD_AIR | Completed |
| `0c42d3a6` | 07:12 (12:42) | 210 s | RED: DEAD_AIR, HANDBACK_LOOP | Completed |
| `3b5fb592` | 06:15 (11:45) | 67 s | RED: ANSWER_DELETED, DEAD_AIR, LIKELY_MACHINE | Completed |

The current voice code includes fixes made after these calls, including acoustic-length checks for false unheard-turn prompts and handling of requests to repeat. Historical flags are not automatically current regressions. LLM/STT median TTFB on these calls is generally subsecond; the evidence does not justify blaming all observed pauses on model generation or changing providers.

## Testing and evidence

* **543 unit tests passed**, 20 warnings, against the current voice code.
* Recompiled the relevant current Java classes and ran seven isolated reproductions: public bulk bypass, duplicate transaction failure, manual trigger reuse, lane deferral, cross-tenant ingest overwrite, post-commit action loss, and false success after failed webhook ingest. All reproduced. Java tests used mocks and/or in-memory H2, not production writes.
* Four offline Python checks reproduced the dead-air measurement, language mismatch, perpetual retry, and report-spool deletion defects.
* Read the existing production nightly summary for 17 September, generated using image `d99bd2a579`: **1 replay passed, 8 failed**. The associated TTS probes each tested 32 sentences and reported zero failures for the three configured voice/language combinations. This is useful coverage, but it did not include every cache candidate (notably the repeatedly rejected warming candidate).
* **All 13 scripted timing scenarios passed** against the current code, including interrupted openings, backchannels, forced close, unheard turns, cached speech, and voicemail handling.
* **None of the three latest-call replays passed every invariant.** `0c42d3a6` flagged repeated transcript sentences, talk-over, and a 5.47-second response gap; `0cfe1007` flagged repeats and gaps up to 9.69 seconds; `3b5fb592` flagged a repeated nudge and a 19.01-second gap. These are additional investigation signals, not extra confirmed bugs. Synthetic speech lengths, saved/current context, intentional resumed speech, and the invariant's definition of repetition/backchannel latency can affect the result.
* Replay records were compared with fresh production journal entries and matched exactly. Replay uses saved context, recorded text/timing, synthetic audio, and stub vendor services; it is not an acoustic replay of the original recording. The original recordings were not listened to in this review.

### How to use the existing test tools

Run from `voice_bot_service/` with its requirements installed:

```bash
python -m pytest tests/ -q
python -m sim.timing --ci --out /tmp/ai-call-timing.json
python -m sim.replay --dir /path/to/records --context /path/to/context.json --ci --out /tmp/ai-call-replay.json
python -m sim.run --model prod --agent AGENT_ID --ci
```

The first three can run without paid vendor calls when replay context is supplied locally. The last needs configured credentials, uses the real model, and costs tokens. `sim.timing --real-stt` can additionally test the saved speech clips against the STT provider. `sim.ttsprobe` and the nightly replay script test real TTS output. No new live-model, live-STT, or live-TTS paid probe was run during this review.

Use `--ci`: the simulator/replay CLIs can print failures and still return zero without it. Inspect the JSON assertions as well as the process exit code. Also verify the model under test: the deployment workflow currently forces `LLM_PROVIDER=vertex` for its conversation test, while the recent live call reports identify `sarvam/gemma4`. That workflow does not establish behavior of the model used in those calls. `--soft-errors` also permits credential/network failures to skip the conversation check.

The missing coverage is mainly Java control-plane behavior and metrics invariants. Add the ten regression cases above to maintained tests, run a small canary through queue → call → report → committed follow-up, and compare real recorded audio with timeline assertions before treating every replay failure as a customer-visible bug.

### Local evidence files

Sensitive raw transcripts/context remain outside the repository. Full local artifacts:

* `/private/tmp/ai-calling-review-db-current.json`
* `/private/tmp/ai-calling-review-voice-fresh.log`
* `/private/tmp/ai-calling-review-admin-current.log`
* `/private/tmp/ai-calling-review-tests-current.log`
* `/private/tmp/ai-review-sep19-java/QueueReviewRepro.log`
* `/private/tmp/ai-review-sep19-java/OutcomeReviewRepro.log`
* `/private/tmp/ai-calling-review-voice-repro-current.json`
* `/private/tmp/ai-review-sep19-java/WebhookAckRepro.log`
* `/private/tmp/ai-calling-review-ack-repro.log`
* `/private/tmp/ai-calling-review-nightly-current.txt`
* `/private/tmp/ai-calling-review-timing-current.log`
* `/private/tmp/ai-calling-review-timing-current.json`
* `/private/tmp/ai-calling-review-replay-current.json`

Reproduction sources are `/private/tmp/ai-calling-review-queue/QueueReviewRepro.java`, `/private/tmp/ai-calling-review-outcome/OutcomeReviewRepro.java`, and `/private/tmp/ai-calling-review-voice-repro.py`. Earlier scratch sources were reused only after inspection and fresh execution; their previous output was not treated as fresh verification.

The report-delivery reproduction sources are `/private/tmp/ai-review-sep19-java/WebhookAckRepro.java` and `/private/tmp/ai-calling-review-ack-repro.py`.
