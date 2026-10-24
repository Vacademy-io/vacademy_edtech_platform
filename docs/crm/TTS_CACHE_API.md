# TTS Speech Cache — API reference

Integration reference for the speech-cache analytics tab. Six endpoints, all under
`https://health.vacademy.io/admin-core-service/super-admin/v1/calls`.

Headers on every call:

```
-H 'authorization: Bearer <token>'
-H 'clientid: 00000000-0000-0000-0000-000000000001'
```

All six require a **super-admin** token (`SuperAdminAuthUtil.requireSuperAdmin`: the caller's
`users.id` must be on `SUPER_ADMIN_USER_IDS`); anything else
gets `403`. Field names are **snake_case**, matching the rest of the super-admin surface.

---

## Two things to know before you build against these

**Reads are a mirror, not live.** Screens 1–4 read `tts_cache_entry`, which the voice bot
pushes into Postgres **every 2 minutes**. That is deliberate: the cache itself is SQLite plus
audio files on one box's local disk, so proxying it would mean the tab dies whenever that box
restarts, can't join to agent names, can't filter by institute, and — worst — has no history
at all. Every row carries `reported_at`; **show it**, so the screen states its own staleness
instead of implying live.

**Writes are queued, not immediate.** Deleting cached audio means deleting a file on the bot's
disk. Both destructive endpoints return `status: "PENDING"` with a `command_id`, and the bot
acts on its next cycle. **The UI must say "queued", never "done"** — claiming otherwise is
wrong the first time the bot is mid-restart. Poll the flush log for the outcome.

---

## 1. Tab landing — every agent

```bash
curl --url 'https://health.vacademy.io/admin-core-service/super-admin/v1/calls/tts-cache/agents' \
  -H 'authorization: Bearer <token>' \
  -H 'clientid: 00000000-0000-0000-0000-000000000001'
```

| Param | | |
|---|---|---|
| `instituteId` | optional | filter to one institute |

```json
[
  {
    "agent_id": "b759218d-d626-4035-a4a4-38c40510f961",
    "agent_name": "shreya-v3",
    "institute_id": "ca3c4734-7913-48a8-b116-f8f7e0c60eba",
    "institute_name": "Vacademy Admin",
    "engine": "smallest_pro",
    "voice": "mrunal",
    "speech_cache_mode": "FULL",
    "entries": 13,
    "unrendered_entries": 43,
    "never_hit_entries": 4,
    "bytes": 1048576,
    "hits": 8,
    "sightings": 65,
    "hit_rate": 12.31,
    "chars_saved": 780,
    "inr_saved": 1.34,
    "last_hit_at": "2026-08-24T11:07:58.000+00:00",
    "reported_at": "2026-08-25T06:12:03.000+00:00"
  }
]
```

| Field | |
|---|---|
| `speech_cache_mode` | `OFF` \| `FIXED` \| `FULL` — **show it**; it explains an agent's zeroes |
| `entries` | sentences this agent has cached audio for |
| `unrendered_entries` | seen but not yet rendered — the population of screen 3 |
| `never_hit_entries` | cached and never once served. Dead weight: paid for, occupying disk, earning nothing. Your flush candidate |
| `hit_rate` | percentage 0–100 |
| `inr_saved` | rupees kept off the TTS bill |

> `hit_rate` and `inr_saved` are **nullable on purpose**. `null` means *not measured* — nothing
> was ever attempted, or the engine has no confirmed per-minute rate (`edge`, and `smallest`
> until its invoice lands, where a hit buys latency rather than money). Render `null` as "—",
> never as `0`: a cache that was never switched on is not a cache performing badly.

---

## 2. What one agent has cached

```bash
curl --url 'https://health.vacademy.io/admin-core-service/super-admin/v1/calls/tts-cache/agents/b759218d-d626-4035-a4a4-38c40510f961/entries?page=0&size=50' \
  -H 'authorization: Bearer <token>' \
  -H 'clientid: 00000000-0000-0000-0000-000000000001'
```

| Param | Default | |
|---|---|---|
| `q` | — | substring match on the sentence, case-insensitive |
| `page` | `0` | |
| `size` | `50` | clamped to 1–200 server-side |

```json
{
  "content": [
    {
      "cache_key": "a1b2c3d4e5f6…",
      "sentence": "नमस्ते जी, ये call record की जाएगी। मैं श्रेया बोल रही हूँ…",
      "chars": 191,
      "is_fixed": true,
      "engine": "smallest_pro",
      "voice": "mrunal",
      "sightings": 4,
      "hits": 3,
      "rendered": true,
      "bytes": 195520,
      "duration_ms": 12220,
      "first_seen_at": "2026-08-24T05:36:40.000+00:00",
      "last_seen_at": "2026-08-24T11:07:58.000+00:00",
      "last_hit_at": "2026-08-24T11:07:58.000+00:00",
      "audio_url": "/admin-core-service/super-admin/v1/calls/tts-cache/entries/a1b2c3d4e5f6…/audio",
      "reason": null,
      "inr_wasted": null
    }
  ],
  "total_elements": 13,
  "page": 0,
  "page_size": 50
}
```

Sorted by `hits` desc, then `chars` desc — most valuable first.

`is_fixed: true` marks a bot-authored line (opening, farewell, handback, filler) rather than
something the LLM produced. The two answer to **different admission rules**, so label them
differently in the UI; a user comparing a greeting against a pitch line otherwise draws the
wrong conclusion.

> ⚠️ `audio_url` is a path, and **the route that serves it is not built yet**. Treat the field
> as reserved — don't wire a play button to it this sprint.

---

## 3. What is NOT cached, and why

```bash
curl --url 'https://health.vacademy.io/admin-core-service/super-admin/v1/calls/tts-cache/agents/b759218d-d626-4035-a4a4-38c40510f961/misses?page=0&size=50' \
  -H 'authorization: Bearer <token>' \
  -H 'clientid: 00000000-0000-0000-0000-000000000001'
```

Params: `page` (0), `size` (50, clamped 1–200). Same envelope as #2, sorted by
`sightings × chars` desc — **what it is costing you**, not what is most numerous.

```json
{
  "content": [
    {
      "cache_key": "9f8e7d…",
      "sentence": "अगर रमन के अस्सी-बयासी परसेंट के आसपास marks हैं…",
      "chars": 88,
      "is_fixed": false,
      "sightings": 1,
      "hits": 0,
      "rendered": false,
      "reason": "seen once — an LLM sentence renders on its second qualifying sighting",
      "inr_wasted": 0.15
    }
  ],
  "total_elements": 43,
  "page": 0,
  "page_size": 50
}
```

`reason` is written for a human and separates cases that look identical in a bare list:

| Situation | `reason` |
|---|---|
| LLM sentence, `sightings < 2` | *seen once — an LLM sentence renders on its second qualifying sighting* |
| LLM sentence, `sightings ≥ 2`, still unrendered | *seen N times but not rendered — the render is failing, or the calls carrying it were dropped by the health gate* |
| Fixed line, unrendered | *authored line not yet rendered — the last render failed, or it has never been spoken on a call healthy enough to count* |

That last row matters: a **fixed line renders on its first** qualifying sighting, so one still
sitting here was actively refused — a different problem from "not seen enough yet".

`inr_wasted` is what re-synthesising it has cost so far (`sightings × chars` at the engine's
rate); `null` on unpriced engines.

---

## 4. Flush — queued, and dry-run by default

**Drop one sentence** (as written, shows what would go and deletes nothing):

```bash
curl -X DELETE \
  --url 'https://health.vacademy.io/admin-core-service/super-admin/v1/calls/tts-cache/entries/a1b2c3d4e5f6…?dryRun=true' \
  -H 'authorization: Bearer <token>' \
  -H 'clientid: 00000000-0000-0000-0000-000000000001'
```

**Drop everything one agent contributed:**

```bash
curl -X POST \
  --url 'https://health.vacademy.io/admin-core-service/super-admin/v1/calls/tts-cache/agents/<agentId>/flush?dryRun=true' \
  -H 'authorization: Bearer <token>' \
  -H 'clientid: 00000000-0000-0000-0000-000000000001'
```

Both return the same object:

```json
{
  "command_id": "3f2a…",
  "status": "PENDING",
  "dry_run": true,
  "kind": "FLUSH_AGENT",
  "agent_id": "b759218d-…",
  "cache_key": null,
  "entries_removed": null,
  "bytes_removed": null,
  "result": null,
  "created_at": "2026-08-25T06:20:00.000+00:00",
  "finished_at": null
}
```

**`dryRun` defaults to `true`** on both routes — omit it and nothing is deleted. Send
`?dryRun=false` to act, and make the UI require an explicit confirmation for that.

`entries_removed`, `bytes_removed`, `result` and `finished_at` stay `null` until the bot
reports back — up to ~2 minutes.

> **Audio shared with another agent is kept.** The cache key is global, so two agents on the
> same voice share one rendered blob. Flushing agent A never removes audio agent B is still
> serving, and `result` says so. A dry run's `result` is prefixed `DRY RUN — `, so the
> UI can tell a rehearsal from a deletion without re-reading `dry_run`.

**The flush log** — every command ever queued, and what it did:

```bash
curl --url 'https://health.vacademy.io/admin-core-service/super-admin/v1/calls/tts-cache/flush-log?limit=50' \
  -H 'authorization: Bearer <token>' \
  -H 'clientid: 00000000-0000-0000-0000-000000000001'
```

Params: `agentId` (optional), `limit` (50). Same object, now completed:

```json
[
  {
    "command_id": "3f2a…",
    "status": "DONE",
    "dry_run": false,
    "kind": "FLUSH_AGENT",
    "agent_id": "b759218d-…",
    "entries_removed": 3,
    "bytes_removed": 412800,
    "result": "3 entries, 2 shared with another agent and kept",
    "finished_at": "2026-08-25T06:21:44.000+00:00"
  }
]
```

`status`: `PENDING` → `CLAIMED` → `DONE` | `FAILED`. `kind`: `FLUSH_AGENT` | `DELETE_ENTRY`.

---

## 5. Monitoring — totals and a day series

```bash
curl --url 'https://health.vacademy.io/admin-core-service/super-admin/v1/calls/tts-cache/summary?from=2026-08-17' \
  -H 'authorization: Bearer <token>' \
  -H 'clientid: 00000000-0000-0000-0000-000000000001'
```

Params — all optional: `instituteId`, `from`, `to` (`yyyy-MM-dd`), `agentId`.

```json
{
  "measured_calls": 4,
  "unmeasured_calls": 89,
  "hits": 8,
  "misses": 150,
  "hit_rate": 5.06,
  "chars_saved": 780,
  "secs_saved": 57.36,
  "inr_saved": 1.34,
  "hits_by_engine": { "smallest_pro": 8 },
  "series": [
    { "day": "2026-08-24", "measured_calls": 4, "hits": 8, "misses": 150,
      "hit_rate": 5.06, "chars_saved": 780, "inr_saved": 1.34 }
  ]
}
```

Unlike 1–4, this reads `ai_call_result.diagnostics` — one row per call — which is why it can
show a **series**. The bot's ledger is a current-state snapshot and could never answer "what
was the hit rate last Tuesday".

`measured_calls` vs `unmeasured_calls` is your **coverage** figure: how much of the fleet has
the cache switched on at all. **Days with no measured call are omitted from `series`** rather
than plotted at 0% — a day nobody had the cache on is not a day it performed badly.

---

## 6. The Cache tile above the calls table

Already on the existing summary endpoint — no new call needed:

```bash
curl --url 'https://health.vacademy.io/admin-core-service/super-admin/v1/calls/summary?from=2026-08-17' \
  -H 'authorization: Bearer <token>' \
  -H 'clientid: 00000000-0000-0000-0000-000000000001'
```

Five added fields alongside the existing cost/margin ones:

```json
{
  "calls": 93, "minutes": 161.2, "cost_inr": 9.61, "billed_inr": 22.32,
  "tts_cache_hits": 8,
  "tts_cache_misses": 150,
  "tts_cache_hit_rate": 5.06,
  "tts_cache_chars_saved": 780,
  "tts_cache_saved_inr": 1.34
}
```

`GET /calls` (the table) carries the same five per row, same names.

---

## Known gaps — read before wiring the UI

| | |
|---|---|
| **`audio_url` has no route yet** | the field is populated; the endpoint that serves the WAV is not built. Reserved, not working |
| **`cost_inr` does not subtract the saving** | `tts_cache_saved_inr` sits *alongside* the cost, not deducted from it. `cost_is_modelled: true` admits that cost line is duration × rate |
| **Screens 1–4 are empty until the new bot build deploys** | they read a table only that build populates. `/summary` and the `/calls` fields work today |
| **`/tts-cache/summary` SQL is unverified against prod** | it compiles, but a Java text block is only parsed at execution — the same way the `::bigint` bug reached production. The ssh tunnel has been down; worth one run before relying on it |

## Appendix — operator routes on the voice bot

Separate surface from everything above: these live on the **bot**, not admin-core,
and are gated by the shared internal secret rather than a super-admin token.

```
-H 'x-voice-bot-token: <INTERNAL_CLIENT_SECRET>'
```

They exist because the ledger is SQLite plus audio files on **one box's local
disk**. Until now the only way to read or clear it was a shell on that box, which
made an empty analytics table impossible to diagnose remotely — a reporter that
never started and a ledger with nothing in it look identical from Postgres.

**Export the whole ledger** — the same payload the 120s reporter pushes:

```bash
curl -H 'x-voice-bot-token: <secret>'   'https://voice-bot-in.vacademy.io/voice-bot-service/internal/tts-cache/export?limit=2000'
```

```json
{ "ready": true, "blobs": 13, "count": 56, "truncated": false, "entries": [ … ] }
```

`ready` and `blobs` are returned *beside* the rows on purpose: a cache still
opening returns zero entries, which is not the same answer as an open cache that
genuinely holds nothing. Optional `agentId` filters; `limit` defaults 2000, caps
5000, and `truncated` tells you when you hit it.

**Push to admin-core now**, instead of waiting for the tick — this is the backfill:

```bash
curl -X POST -H 'x-voice-bot-token: <secret>'   'https://voice-bot-in.vacademy.io/voice-bot-service/internal/tts-cache/report-now'
```

```json
{ "ready": true, "pushed": 56, "ok": true }
```

An empty ledger returns `{"pushed": 0, "ok": null, "note": "ledger is empty — nothing to push"}`
rather than a bare 200 — "pushed nothing" and "pushed successfully" must not look
alike. Safe to repeat: admin-core upserts on `(cache_key, agent_id)`.

**Flush** — `dryRun` defaults **true**, and it refuses a request naming neither an
agent nor a key (that is not "flush everything"):

```bash
curl -X POST -H 'x-voice-bot-token: <secret>' -H 'content-type: application/json'   -d '{"agentId":"b759218d-…","dryRun":true}'   'https://voice-bot-in.vacademy.io/voice-bot-service/internal/tts-cache/flush'
```

```json
{ "dryRun": true, "entriesRemoved": 3, "bytesRemoved": 412800,
  "result": "DRY RUN — 3 entries, 2 shared with another agent and kept" }
```

Audio another agent still references is kept — the key is global, so agents on the
same voice share one blob.

> Point these at the box that actually serves calls. `voice-bot-in.vacademy.io`
> resolves to the Linode Mumbai host; the Hetzner `voice-bot-service` pods take no
> call traffic and declare no volumes, so their ledger is always empty.

## Conventions

- **`null` never means zero.** `hit_rate`, `inr_saved`, `inr_wasted` and the `tts_cache_*`
  fields are `null` when unmeasured. Render "—", not `0`.
- **Timestamps** are ISO-8601 UTC.
- **`reported_at`** is mirror freshness (~2 min). Show it.
- **`cache_key`** is a SHA-256 hex string, stable for a given sentence + voice + delivery
  params. Safe as a React key.
