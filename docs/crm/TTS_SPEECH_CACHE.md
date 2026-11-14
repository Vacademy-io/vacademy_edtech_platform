# TTS Speech Cache — replaying audio we have already paid for

**Status:** implemented 2026-08-22, **both switches OFF by default**. Nothing changes on any
call until `TTS_CACHE_SPEECH_ENABLED=true` is set on the box.

**What it is:** when the bot is about to speak a sentence it has spoken before — same words,
same engine, same voice, same delivery params — it replays the stored audio instead of paying
the vendor to synthesize it again.

**What it is not:** an approximation. Matching is equality on a SHA-256. There is no
similarity search, no prefix match, no nearest neighbour. One differing character is a
different digest and therefore a vendor call. Quality is never traded for cost.

Companion docs: [`AI_CALLING_SYSTEM.md`](./AI_CALLING_SYSTEM.md) §6 (the five engines),
§10 (billing), §11 (diagnostics).

---

## 1. Why

V421's own migration comment: **"TTS is ~65% of an AI call's marginal cost."** A scripted
agent says the same opening line, the same farewells, the same handbacks and much of the same
pitch on every call, and Sarvam bills ₹3.00/1k characters for each one, every time. At the
measured **779 chars/call-min**, a 5-minute Sarvam call is roughly ₹11.70 of TTS.

The latency win rides along and is not small: Sarvam's TTS TTFB is 0.20 s median but
**4.5 s p95** (`SLOW_TTS` fires above 3 s). A cache hit is ~0 ms. The opening line is the most
latency-sensitive utterance on the call — the runbook ties a greet later than ~2 s to the
caller's "hello?" cancelling it.

**Customer bills do not change.** Billing is per-minute against the agent's *configured*
engine by design (§10.2). This moves COGS only.

---

## 2. The one invariant

> A bad entry is not a one-call bug. It is served to every future call that matches it,
> forever.

Everything below follows from that. The bar for **writing** an entry is much higher than the
bar for reading one.

---

## 3. The key

SHA-256 over a `\x1f`-joined tuple (`ttscache.cache_key`):

```
TTS_CACHE_SALT | engine | model | voice | pace | temperature
               | sample_rate | rumik_term_map_version | text
```

- `text` is the exact string the **vendor** would receive — Rumik's Devanagari→Latin
  normalisation applied, outer whitespace stripped. No case-folding, no whitespace collapsing.
- `engine` is the engine **actually constructed**, read from `providers.engine_of(tts)`, not
  `ai_agent.tts_model`. `build_tts` silently falls back to Sarvam on a missing key, so the
  configured value would file Sarvam audio under a `google` key and serve the wrong voice.
  `_tag_engine` stamps it at each construction site for exactly this reason.
- Gender variants and lead names need no special handling — `sir`/`ma'am`, `rahi`/`raha`,
  `kaise`/`kaisi`, `Rohan`/`Aarav` are different strings, so different keys.
- **The key is global.** No institute id: identical text in the same voice is identical audio,
  so generic script lines hit across tenants.
- `TTS_CACHE_SALT` invalidates everything at once — the escape hatch if a bad blob lands.

---

## 4. The six gates

| Gate | When | What it requires |
|---|---|---|
| **G1** complete | before hashing **and again at `CallCandidates.add`** | the text ends in terminal punctuation (`.` `!` `?` `।` `…`), or is a registered fixed line. Re-checked at the counter on purpose: the count means "this WHOLE sentence was delivered N times", and that meaning must not depend on a caller remembering to filter |
| **G2** uninterrupted | during dispatch | no interruption between dispatch and completion of that sentence |
| **G3** actually heard | at call end | the sentence appears in the **played** transcript |
| **G4** healthy enough | at call end | **Two standards, both NAMED faults.** A *fixed line* is vetoed only by faults implicating the AUDIO — `CRASH`, `BOT_SILENT`, `TTS_WEDGE`, `REPLY_UNPLAYED`. An *LLM sentence* adds `STT_DEAF` and `REPLY_LOOP`. **The RED verdict itself never vetoes either.** |
| **G5** sound render | at render | whole number of samples, ≥ 200 ms, written `tmp` + `os.replace` |
| **G6** verified | at serve | the stored text equals the key's text, else it is a **miss** |

### G1 is load-bearing, not theoretical

pipecat's default aggregation is by sentence — but on `LLMFullResponseEndFrame` it **flushes
the aggregator's remainder straight into TTS** (`tts_service.py:705-719`):

```python
remaining = await self._text_aggregator.flush()
if remaining:
    await self._push_tts_frames(AggregatedTextFrame(remaining.text, ...))
```

That remainder is a partial clause whenever the response did not end on a sentence boundary,
and it happens routinely. Caching one would render half a sentence and then play it, whole and
standalone, to every future caller who matched it.

### G3 reuses a mechanism that already exists

`PlayedTranscriptRecorder` (`bot.py:449`) sits **after `transport.output()`** and records the
`TTSTextFrame`s the transport releases at playout position — text the caller actually **heard**.
`NoRepeatGate` already runs this exact containment test to un-record never-played sentences
(`bot.py:918-922`), added after live call `4b1a44b9`. Its comment states the principle
verbatim: **"'Already said' has to mean 'already HEARD'."**

The confirmation is whitespace-tolerant (`turntake.normalize_spoken`) because the recorder
space-joins per-word text frames. **The key itself stays byte-exact** — the two comparisons
answer different questions.

### Why G4 has two standards

It started as one strict rule for both, and live agent `shreya-v3` showed that was a stall
rather than caution: **15 of its 22 calls are RED**, so its opening line could only be learned
from roughly one call in three. Worse, the faults doing the blocking were `DEAD_AIR`,
`SLOW_LLM`, `ANSWER_DELETED` and `REPLY_LOOP` — none of which say anything about whether the
opening was *rendered correctly*. It demonstrably was; it is the first line of the transcript.
Letting overall call health veto a per-sentence question was the error.

The two candidates make different claims, so they answer to different bars:

- A **fixed line** claims only *"this authored string is worth rendering"*. Its audio comes
  from an off-call one-shot synthesis of a string an admin wrote, so nothing about how the
  conversation went bears on it. Only audio faults can veto it.
- An **LLM sentence** claims *"the model said this and will plausibly say it again"*. That does
  lean on the conversation having worked — but on **named** faults, not a verdict: `STT_DEAF`
  (the reply may be answering something we never heard) and `REPLY_LOOP` (the model was
  repeating itself).

**The RED verdict does not veto anything.** That took two rounds to get right. Narrowing it for
fixed lines was not enough: on `shreya-v3` at `FULL`, **62 and 46 LLM sentences were discarded on
two consecutive calls whose only fault was `DEAD_AIR`**. Long silences say nothing about whether
*"exact fees तीन चीज़ों पर depend करती है"* is worth keeping — it is near-verbatim on every call.
That agent is RED on essentially every call, so the blanket veto meant `FULL` could never learn
anything at all, and would have sat at a ~2% hit rate forever.

The narrowing is not a free pass: `CRASH`, `BOT_SILENT`, `TTS_WEDGE` and `REPLY_UNPLAYED` still
veto a fixed line, because each of those genuinely implicates the audio.

### Fixed lines are exempt from G3

The opening, farewells, nudge, handbacks, fillers and transfer-fail closing are *authored by an
admin*, not learned from a call. There is no call to have heard them on. They still face G1,
G5 and G6, which are about the audio rather than its provenance.

---

## 5. Live audio is never stored

A call contributes a **candidate key**, never bytes. Every blob is rendered off-call by
`ttswarm.synthesize`, through the same one-shot paths the `/preview.mp3` audition uses.

This is not fastidiousness. On `sarvam`, `smallest` and `rumik`, `run_tts` yields **no audio at
all** — it enqueues text and the audio arrives later on a receive loop, with no per-sentence
attribution, and a barge-in truncates the stream mid-sentence. A live capture on exactly the
engines worth caching would be a coin-flip between the whole sentence and the first 40% of it.
Rendering off-call makes truncation impossible **by construction** rather than by a check.

### When recording actually happens

Three distinct moments, none of them during a call:

| Moment | What is rendered | Latency to first hit |
|---|---|---|
| **Agent save** | the opening line, via `AiAgentSpeechWarmer` | **before call #1** |
| **Seconds after a call ends** | anything that just became due — `report.py` kicks the sweeper the moment it ladders | the **next** call |
| **Every 5 min** | backstop tick, plus eviction | — |

The kick is why the sweeper is event-driven rather than a plain 5-minute loop: a sentence that
qualified on call N should be available on call N+1, not five minutes of calls later. The
sweeper defers when the box is at half its concurrent-call cap or above — synthesis is mostly
network but the decode is real CPU on a 1 vCPU node, and background work must never be why a
live caller hears a glitch. The periodic tick then catches up during a lull.

**Admission:** an LLM sentence is rendered after `TTS_CACHE_MIN_SEEN` (default 1) qualifying
sightings, so it first hits on its third. Break-even is 3 uses.

**A fixed line is rendered after ONE sighting.** The threshold exists because an LLM sentence
might be a one-off — a name that never recurs — and a second sighting is how we learn it was
worth rendering. A fixed line carries no such doubt: it is authored, and it is spoken on every
call by construction. Making it wait would delay the only lines guaranteed to pay off, which is
the opposite of what the threshold is for. So the bot's own lines are cached from **call 1 and
hit from call 2**, with or without warm-on-save. This is also what makes caching
name-bearing sentences affordable: a one-off personalised sentence costs zero disk and zero
extra vendor spend, while a first name that recurs across a lead list is picked up
automatically.

### Barge-in is unchanged

The absorb-vs-interrupt decision (`turntake.mid_reply_action`) reads the **caller's words** and
knows nothing about where the bot's audio came from. A cached utterance ducks, absorbs and
cancels exactly as a synthesized one does — a bare "haan"/"achha" resumes the reply mid-sentence,
a question or anything unrecognised cancels it.

One thing the cache had to be careful about: a cached blob is available *all at once*, and
emitting it in a single burst would push the whole utterance past `DuckGate` into the output
queue before the caller had drawn breath — reproducing the condition that made barge-in feel
slow before `AUDIO_MAX_LEAD_SECS` (live call `d6e82def`: *"dropping 0 held frame(s)"* on an
interrupt, 1.96 s of measured talk-over). So the cached path emits at **~2× real time**, the
same rate pipecat's own websocket output uses, keeping frames in `DuckGate`'s reach for the
whole utterance. It costs nothing in playback latency — the transport paces the line either way.

A sentence the caller barged over is **not** laddered (G2), so an interrupted utterance never
counts toward the render threshold.

---

## 6. Ordering — the hazard, and the guard

pipecat 1.4 orders audio through a `_serialization_queue` of audio contexts drained in
creation order (`tts_service.py:1430`). But **`reuse_context_id_within_turn` defaults to
`True`** (`tts_service.py:184`), so `create_context_id()` returns the *same* `_turn_context_id`
for every sentence of a turn. `_refresh_audio_context` only pushes a keepalive sentinel; it
does **not** create a new ordering slot.

⇒ On the async-arrival engines, all sentences of a turn share **one FIFO drained in append
order**. Cached audio appends instantly; vendor audio appends 200–400 ms later. So a cached
sentence served mid-turn would be heard **before** a vendor sentence requested earlier —
intermittently, only on partial-hit turns, which is the worst failure shape there is.

Worse, `TTSStoppedFrame` + `remove_audio_context` are owned by the vendor's receive loop
(`sarvam/tts.py:1180`). A cached path emitting its own would close the turn's context early and
later vendor audio would be dropped with *"unable to append audio to context"* — lost speech.

**The guard (`TtsTurnWatcher`):** one boolean, set when a sentence is dispatched to an
async-arrival engine and cleared when a `TTSStoppedFrame` / interruption / cancel passes.
**On those engines, serve from cache only when it is clear.** Cannot reorder by construction,
touches no pipecat internals, changes nothing for existing agents.

It costs less than it sounds: the **first sentence of every turn** always has it clear (and
that is the sentence gating TTFB), every standalone `TTSSpeakFrame` has it clear, and a later
sentence is cacheable exactly when every preceding one also hit.

| Engine | `run_tts` shape | Mid-turn caching |
|---|---|---|
| `google`, `edge`, `deepgram` | HTTP generator, own start/stop **per sentence** | unrestricted |
| `sarvam`, `smallest`, `rumik` | enqueue; audio arrives out-of-band, **turn-level** brackets | only when `vendor_inflight` is clear |

> **Considered and deferred:** setting `reuse_context_id_within_turn=False` would give
> per-sentence contexts and therefore unrestricted mid-turn caching on every engine — and
> `google` already behaves that way in production, so the pipeline handles the shape. It was
> not taken because it changes `BotStartedSpeaking`/`BotStoppedSpeaking` to fire per sentence
> for the paying legacy Sarvam agents, touching `DuckGate`, the watchdog and dead-air
> measurement. Worth trialling on one agent once the ledger shows what the degradation costs.

---

## 7. Where it lives

```
/tmp/tts-cache/                     ← Docker volume tts_cache; survives restarts and CI rolls
└── speech/                         ← NEW namespace, its own budget
    ├── {sha256}.pcm                ← the audio: raw s16le mono @ 8 kHz
    ├── {sha256}.json               ← sidecar: engine, voice, params, text, chars, ms
    └── ledger.db                   ← SQLite WAL: `seen` (candidates) + `blob` (index source)
```

Three stores, three jobs:

| Store | Job |
|---|---|
| **blob store** | the audio. The hash **is** the filename — content-addressed, no lookup table |
| **RAM index** | `dict[key] → Entry`, rebuilt at startup from ONE query. The hot-path lookup is a dict get: no syscall, nothing that can block the event loop |
| **ledger** | candidate keys not yet rendered, plus the blob metadata the index is built from |

Blob metadata is in SQLite rather than re-read from sidecars so startup is one query instead of
tens of thousands of file opens. The sidecars remain as a debug artefact and a rebuild source.

**Eviction** is by **(hits ASC, last-served ASC)**, not plain LRU: a line hit 500 times is the
whole point and must outlive write-once junk — the same reasoning that already protects warmed
IVR prompts in `_evict_tts_cache`. That existing sweep only matches `*.mp3`, which is precisely
why this namespace needs its own.

Sizing: 8 kHz s16 = 16 KB/s, so a 4-second sentence ≈ 64 KB and 2 GB ≈ ~32,000 sentences.
Storing at the Plivo leg's own rate rather than the engine's 24 kHz is 3× smaller and removes a
resample from the hot path.

> ⚠️ **The Singapore fallback gets no cache.** `voice-bot-service-deployment.yaml` declares no
> `volumes:` and `values.yaml` sets `replicaCount: 2`. If `VOICE_BOT_BASE_URL` is ever cut over
> there, the cache is ephemeral, unshared between the two replicas, and the ledger splits (a
> sentence would need ~4 sightings, not 2). Nothing breaks — every miss is today's behaviour —
> it just silently stops saving money.

---

## 8. Warm-on-save

`AiAgentSpeechWarmer` (admin core) posts an agent's fixed lines to
`POST /voice-bot-service/internal/tts-cache/warm` when the agent is saved, so they hit from
call #1 rather than being learned slowly. Fire-and-forget, modelled on `IvrPromptWarmer`: it
spends money and crosses an ocean, and an admin pressing Save must never see either.

Gated by `X-Voice-Bot-Token` = `VOICE_BOT_CLIENT_SECRET`, the secret admin core already holds
for minting `/ws` tokens. Not public: each warm is a vendor synthesis.

**An opening containing `{{leadName}}` is deliberately not warmed** — it is filled per call, so
the audio would never be reused. It is picked up by the learn path once a given name recurs.

---

## 9. Reporting

**Per call, no migration.** `diagnostics.tts` gains `cacheHits`, `cacheMisses`,
`cacheCharsSaved`, `cacheSecsSaved`, `cacheHitRate`. The blob is posted verbatim, stored in
`ai_call_result.diagnostics` (jsonb) and rendered by `CallHealthSheet` under **Speech cache**.

**Honesty discipline (§11.3):** cache off or unreadable ⇒ `null`, **never 0**. A zero must mean
"measured, nothing hit". Both counters arm together on the first observation, so
"hits 0, misses 12" is a real reading.

**The panel is hidden unless the cache actually ran on that call.** `CallDetailService` derives
`ttsCacheActive` from the blob (`tts.cacheHits != null`) and the sheet renders the section only
when it is true. The decision is the backend's, not the UI's: every agent is `OFF` by default,
and a grid of "not measured" on every call would advertise a feature the institute has not
enabled while pushing the rows that matter off the screen. It is also the *honest* answer per
call — a call placed before the agent was switched on genuinely had no cache, whatever the
agent's mode says today, which is why this reads the recorded blob rather than joining
`ai_agent.speech_cache_mode`.

Note `cacheHits: 0` still shows the panel: the cache ran and served nothing, which is a real
reading. That distinction is the entire reason the bot writes `null` rather than `0`, and a
plain truthiness test in the UI would have thrown it away.

**Rupees** are derived in admin core, which is where the rates are:

```
₹ saved = charsSaved / 779 × voice_call_rate_card["tts_<engine>"]
```

779 chars/call-min is the rate card's **own** documented basis (`tts_google` 2.06 and
`tts_sarvam` 2.34 are both that figure × the vendor price, per V428), so the savings number
cannot drift from the cost number. Null on `edge` (free) and `smallest` (no confirmed invoice
rate) — there a hit buys latency, not rupees.

**The ledger readout** — `GET /voice-bot-service/internal/tts-cache/stats` — reports distinct
sentences, total sightings and how many ever repeated. That is the number that says whether the
LLM-sentence half earns its complexity.

---

## 10. Configuration

| Env | Default | Meaning |
|---|---|---|
| **`ai_agent.speech_cache_mode`** | `OFF` | **the actual on switch** — per agent, in the UI. OFF / FIXED / FULL |
| `TTS_CACHE_SPEECH_ENABLED` | `true` | ops KILL switch for the fixed-line path |
| `TTS_CACHE_LLM_ENABLED` | `true` | ops KILL switch for the LLM-sentence path |
| `TTS_CACHE_AGENTS` | *(empty)* | optional extra ops restriction. Empty = no restriction |
| `TTS_CACHE_SALT` | `v1` | bump to invalidate everything |
| `TTS_CACHE_MIN_SEEN` | `1` | qualifying sightings before one render is spent. 1 makes a line free from its SECOND use rather than its third |
| `TTS_SPEECH_CACHE_MAX_BYTES` | 2 GB | own eviction budget |
| `TTS_CACHE_MIN_BLOB_MS` | `200` | G5 floor |

---

## 10.1 Rollout — per agent, from the backend

**What turns the cache on is `ai_agent.speech_cache_mode` (V466), set per agent.** Not an env
var: the bot's env switches are process-wide, and
rolling out to one agent, watching a batch, then widening is the shape this needs. No ssh, no
container restart, and the decision is visible to whoever later asks why one agent sounds
different from another.

| Mode | Serves from cache | When to use it |
|---|---|---|
| `OFF` | nothing | **the default for every existing agent** — the feature is inert |
| `FIXED` | the bot's authored lines only — opening, farewells, handbacks, fillers | first tier. Each is a standalone utterance with no join to a neighbouring sentence, so §11 cannot bite. Safe on every engine |
| `FULL` | the above **plus** the LLM's own sentences | only after the §11 render-parity listen for that engine |

> **There is no UI control for this yet.** `AiAgentDTO.speechCacheMode` is accepted, persisted
> and returned by `POST /v1/telephony/ai-agents`, so the agent API can set it — but the AI
> Agents page has no dropdown. Until one is added, enabling an agent means SQL (or a PUT
> carrying the field). That is deliberate for now: a rollout control nobody can click by
> accident is the right shape for a feature in its first week.

```sql
-- one agent, fixed lines only
UPDATE ai_agent SET speech_cache_mode = 'FIXED' WHERE id = '<agent-id>' RETURNING id, name, speech_cache_mode;
-- later, once the parity listen passes for its engine
UPDATE ai_agent SET speech_cache_mode = 'FULL'  WHERE id = '<agent-id>' RETURNING id, name, speech_cache_mode;
-- roll back instantly
UPDATE ai_agent SET speech_cache_mode = 'OFF'   WHERE id = '<agent-id>' RETURNING id, name, speech_cache_mode;
```

Rolling back takes effect on the **next call** — the mode rides the call context, which is
fetched per call. Calls already in progress are unaffected.

### The env switches are KILL switches

`TTS_CACHE_SPEECH_ENABLED` and `TTS_CACHE_LLM_ENABLED` default **true** and exist so ops can
stop the feature fleet-wide in one restart without editing any institute's configuration.
They enable nothing on their own: every agent's mode defaults to `OFF`.

`TTS_CACHE_AGENTS` is an optional extra ops restriction (pin to named agents regardless of the
DB), normally left empty.

### Nothing changes until an agent is switched on

The strong form of this claim is not "my code decides to do nothing" — it is **"my code never
runs"**. For an agent nobody has enabled:

1. V466 stamps `OFF` on **every existing row**, and the column defaults `OFF`.
2. The call context **always** emits `speech_cache_mode`, never conditionally — a dropped key
   would otherwise fall back to a bot default, and the only safe default here is `OFF`.
3. **`install_tts_cache` returns `None` without touching `tts.run_tts`.** The engine's own
   method stays bound, so there is no wrapper, no extra async-generator layer and no
   normalise call on the hot path.
4. **The `TtsTurnWatcher` processor is absent from the pipeline**, so the frame chain is
   byte-identical to today.
5. **`outcome.tts_candidates` is left `None`**, so `report.py` returns immediately instead of
   spawning a thread per call to flush an empty list.
6. `AiAgentSpeechWarmer` returns before any I/O for an `OFF` agent, so saving an agent does
   not spend a vendor render either.

Points 3, 4 and 5 are asserted by `test_a_disabled_agent_gets_no_wrapper_at_all`, which checks
`tts.run_tts is` the engine's original function — identity, not behaviour. Its counterpart
`test_an_enabled_agent_does_get_the_wrapper` exists because otherwise the feature could go
silently dead and every other test would still pass.

An `OFF` agent also writes nothing to the ledger — so switching an agent to `FULL` starts its
learning from zero, by design: we do not pay to render audio for agents that may never use it.

### Confirming which gates are open

The first log line of every call:

```
tts-cache: installed engine=sarvam voice=priya agent=Aarushi mode=FIXED rollout=in
           kill_speech=True kill_llm=True async_arrival=True entries=14
```

`mode=OFF` is the answer to "why did this call not hit the cache" nine times out of ten.

---

## 11. Before setting an agent to FULL: the render-parity check

**This is the one real quality risk and no test can settle it.**

Cached audio comes from the **one-shot HTTP** path; live audio from the **streaming websocket**
path. For the same text, voice and pace these are probably near-identical — but Sarvam's
`min_buffer_size` and `enable_preprocessing` apply to streaming only, and **`temperature` makes
bulbul non-deterministic**, so two renders of one sentence differ in prosody by design.

Neither produces wrong *words*. The risk is an audible seam where a cached sentence joins a
live one inside a turn.

**Per engine, before enabling:** synthesize one sentence both ways, listen back to back, then
listen to a spliced pair. An engine that shows an audible seam stays on fixed lines only —
those are whole standalone utterances, so no join exists. **Do `sarvam` first**: it is the
priciest engine and the one whose renders are non-deterministic.

---

## 12. Expectations

| | |
|---|---|
| Fixed lines | ~10–15% of TTS chars on a 5-min call. **Only the opening is pre-warmed**, and only if it has no `{{placeholder}}`; the farewells, handbacks, fillers and nudge reach the cache the same way an LLM sentence does — see the row below |
| LLM sentences | **Unknown until the ledger runs.** `NoRepeatGate` needed *fuzzy* matching at 0.80 precisely because exact repeats were not frequent enough, and paraphrases of one question score ~0.6. Plan for 15–35%, not 60% |
| **What hits on call 1** | Only a pre-warmed, placeholder-free opening. Everything else needs `TTS_CACHE_MIN_SEEN` sightings first — at the default of 1 that means its first hit is call 2. A `hits=0` first call is the expected reading, not a broken cache — read `misses=N` and `laddered N` to confirm the plumbing works |
| Ramp | starts near zero and climbs. G3/G4 make "qualifying" stricter than "spoken", so it climbs slower than a naive model predicts |
| Where money is at stake | `sarvam` (₹2.34/min) and high-volume `google` (₹2.06/min past its 1M chars/month free tier ≈ 1,284 call-min). `edge` is free, `rumik` ₹0.45/min |
| **The bigger lever** | not the cache — script determinism. `AI_CALL_ACTIONS.md` §10 flags the prompt at ~19k chars with the two-sentence turn cap not holding. A tighter script fixes that bug **and** raises the exact-match rate from the same edit |
