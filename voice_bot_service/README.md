# Vacademy AI Voice Bot Service


The dedicated real-time voice-bot behind the **Vacademy AI Agent** provider
(`VACADEMY_AI`). Productionization of the validated POC
(<https://github.com/shreyash-jain/sales-poc-ai>): Plivo `<Stream>` WebSocket →
Pipecat pipeline (Silero VAD → Sarvam Saaras STT → Sarvam-M LLM → Sarvam Bulbul
TTS) → same socket back to the caller.

**Stateless by design** — no database. Per-call context comes from admin_core's
internal API; the end-of-call report goes to the generic AI-voice webhook, which
drives the entire existing outcome pipeline (disposition → assign/stop/retry →
workflow resume → Call Intelligence). Design doc:
`../docs/crm/VACADEMY_AI_AGENT.md`.

## Call flow

```
admin_core VacademyAiOutboundCaller ──► Plivo Call API (answer_url = /answer)
lead answers ──► Plivo GET /answer ──► XML: [<Record recordSession>] <Stream wss:/ws> <Redirect ai-next>
Plivo WS ──► /ws: parse handshake → fetch call-context (persona+lead+handoff+token)
          ──► Pipecat pipeline runs the conversation
LLM appends <<END_CALL>> / <<TRANSFER>> → SentinelGate strips it, stops after the last utterance
   transfer: POST /internal/voice-bot/handoff, close stream → Plivo <Redirect> → <Dial> team member
call ends ──► analysis LLM call → report JSON → POST /webhook/ai-voice/VACADEMY_AI
```

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill SARVAM_API_KEY etc.; export or use dotenv
uvicorn app.main:app --port 8090
ngrok http --region in 8090      # PUBLIC_HOST=<ngrok host>
```

Then set `VOICE_BOT_BASE_URL=https://<ngrok host>` on admin_core and place an AI
call (`POST /v1/telephony/ai-call/connect` with `"provider":"VACADEMY_AI"`).

## Room tone (office ambience)

Every call has a low-level office ambience loop mixed under the outbound audio
so silence between turns never sounds like a dead digital line. The asset is
`assets/call_center_ambience_8k_mono.wav` (8 kHz, mono, 16-bit PCM, 78.5 s
seamless loop, −32 dBFS RMS — converted from a 44.1 kHz stereo call-centre
ambience recording: anti-aliased downsample, mono downmix, 1.5 s crossfade at
the loop seam, normalised) — it must stay 8 kHz mono because pipecat's mixer does not
resample. It is mixed inside the output transport (`app/ambience.py`, pipecat
`SoundfileMixer`), so STT/LLM/TTS are untouched.

| Setting | Default | Meaning |
|---|---|---|
| `AMBIENCE_ENABLED` | `true` | `false` removes the mixer entirely — no code change needed |
| `AMBIENCE_VOLUME` | `0.15` | mixer gain on the file (0.15 × −32 dBFS ≈ −48 dBFS); ducked to 0.6× while the bot speaks |
| `AMBIENCE_DRIFT_DB` | `2.0` | slow ± level drift so the bed breathes like a room; `0` holds it flat |
| `AMBIENCE_DRIFT_PERIOD_SECS` | `40` | one drift cycle; the phase is randomised per call |

## Telephone-band EQ on the bot's voice

Measured on the production path: our TTS carries **30.8%** of its energy below
300 Hz against **15.3%** for a real recording through real microphones — a
caller's handset and the analog hybrid roll that band off, ours does not. The
result is one band-limited voice and one full-range, close-miked voice on the
same line, which is the strongest remaining "this is a recording" cue.
`app/voice_eq.py` puts the bot in the caller's band (300 Hz high-pass, gentle
3.4 kHz low-pass, small presence lift, makeup gain), as a processor between
`DuckGate` and `transport.output()` — so it also covers TTS-cache hits and
scripted lines, and cannot touch the ambience, which is mixed in afterwards.

| Setting | Default | Meaning |
|---|---|---|
| `VOICE_EQ_ENABLED` | `true` | `false` removes the processor entirely |
| `VOICE_EQ_HIGHPASS_HZ` | `300` | the telephone channel's low corner |
| `VOICE_EQ_PRESENCE_DB` | `2.5` | lift at 1.7 kHz, wins back what the high-pass costs |
| `VOICE_EQ_MAKEUP_DB` | `2.0` | returns the ~3 dB the high-pass removes (measured peak after: −4.5 dBFS) |

Measured effect on 13.3 s of production speech: sub-300 Hz energy 30.8% → 18.4%,
in-band 68.3% → 81.2% — i.e. it lands on the real-recording profile.

## Voice modulation (pitch-range expansion), any engine

Clients: "the tone is very simple and linear — bot like". The TTS engines expose
no usable prosody control (Smallest: speed only), so `app/prosody.py` reshapes
the **audio**: it tracks the pitch of each block and scales every excursion
around the voice's own running median by a factor, resynthesised with Praat's
PSOLA (`praat-parselmouth`). The voice keeps its identity; it just moves more.
Streamed in 200 ms blocks with 60 ms of context and a 20 ms cross-fade, so first
audio is delayed ~260 ms; the tail of a sentence is flushed on `TTSStoppedFrame`
or after 80 ms without audio; an interruption drops what is pending. Sits
between `DuckGate` and the EQ (shape full-band, then band-limit).

Measured on real Smallest/mrunal output (pitch spread, sd of F0 in semitones;
conversational speech is ~4–5 st): English 2.9 → 3.6 / 3.9 / 4.3 and Hindi
3.4 → 4.1 / 4.7 / 5.7 at ×1.3 / ×1.6 / ×2.0; every variant transcribed
word-for-word; ~0.013× realtime on one core.

| Setting | Default | Meaning |
|---|---|---|
| `PROSODY_EXPAND` | `1.0` (off) | box default and kill switch; `1.6` = conversational, `2.5` max |
| agent `voiceModulation` (dashboard, V504) | unset | per-agent override — the intended rollout path: one agent, one listening test, then widen |

If STT ever transcribes the ambience via handset echo, lower `AMBIENCE_VOLUME`
rather than adding filtering.

## Speech-to-text provider (`STT_PROVIDER`)

`sarvam` (code default) | `google` | `smallest`. The Mumbai box runs **smallest**
(Pulse) since 2026-09-12, chosen by a three-way bench that drove each engine through
its pipecat service exactly like a live call (8 kHz, VAD stop at 0.2 s) over four real
AI-call recordings and seven studio clips:

| | Sarvam saaras:v4 | Smallest Pulse | Gnani hi-IN |
|---|---|---|---|
| final after VAD stop, median / p90 | 0.14 / 1.86 s | 0.12 / 0.23 s | 0.65 / 0.80 s |
| turns slower than 1 s | 11 of 67 | 2 of 63 | 1 of 114 |
| word error vs reference | 0.99 | 0.74 | 1.06 |
| hears a lone "haan" | never | yes (~2.5 s late) | yes |
| English in the transcript | forced into Devanagari | Latin script | Devanagari |
| price | ₹30/hr | ~₹20/hr | n/a |

Smallest's "TTFT 64 ms" is time to the first *partial* on 16 kHz lab audio; the
pipeline waits for the *final* after the caller stops, and on 8 kHz line audio the
first partial arrived ~1.2 s after speech start. Running Pulse at 16 kHz was worse
(median 0.76 s) — keep the pipeline rate. `SMALLEST_STT_LANGUAGE` (default `hi`,
Pulse's code-switching mode; agents' `hi-IN`/`en-IN` pins are mapped) and
`SMALLEST_TTFS_P99` (0.5) are the knobs. Rollback: `STT_PROVIDER=sarvam` in `.env`,
restart.

## First-sentence latency lever

TTS starts the moment the model's first sentence is complete (NoRepeatGate splits on
sentence ends), so the first sentence's length IS the caller's wait after the LLM's
first token. Measured on the conversation simulator with the old soft rule: median 5
words, p90 11. `FAST_OPENER_ENABLED` (default `true`) makes the prompt ask for a
COMPLETE sentence of at most four words that carries the answer itself ("Haan, shivir
mein hi hai." / "No charge at all."), never a filler noise or a greeting, with the
detail and the one question after it. Prompt-only: no gate, splitter or TTS change;
`false` restores the previous wording verbatim without a deploy.

## Ops checklist

- Deploy in **ap-south-1** (Plivo India media anchoring), public **WSS** ingress.
- Register `voice_bot_service` in admin_core's `client_secret_key` table; set
  `VOICE_BOT_CLIENT_NAME`/`VOICE_BOT_CLIENT_SECRET` here.
- Set `VOICE_BOT_BASE_URL` on admin_core (else the provider refuses to dial).
- Institute prerequisites: Vacademy Voice (PLIVO) telephony config active, and
  `AI_CALLING_SETTING.provider = VACADEMY_AI`.

## Pipecat version note

`requirements.txt` pins **pipecat-ai 0.0.95** — every module path this service
imports was verified against that wheel (Sarvam STT first shipped in 0.0.93;
0.0.79 lacks it entirely; the 1.x line moved the transports package). If you
bump the pin, re-verify each import in `app/bot.py` / `app/main.py` /
`app/providers.py`, and re-check two constructor contracts: `SarvamTTSService`
(requires `aiohttp_session`) and `PlivoFrameSerializer.InputParams(auto_hang_up=
False)` — auto-hangup MUST stay off or the `<Redirect>` handoff can never fire.

## Security hardening (recommended before broad rollout)

- **Restrict `/ws` + `/answer` to Plivo's published source-IP ranges** at the
  ingress/load balancer — all legitimate traffic originates from Plivo; this
  blocks replay of leaked `corr` ids (which would otherwise drive real
  STT/LLM/TTS spend).
- Set a **webhook secret** (institute-level in the AI Calling config, or the
  global `AAVTAAR_WEBHOOK_SECRET`) so end-of-call report POSTs are
  authenticated; without one, the receiver accepts unauthenticated reports
  (same open-mode posture as Aavtaar today).

## Conversation simulator (`sim/`) — test calls without TTS or STT

Twelve scripted callers, each one a real caller we failed in the week of
2026-09-08 (the greeter who says "good morning" back, "cut the call", all-offline,
the permanent Meet link, the price-pusher, "day after tomorrow", the Hindi switcher,
wrong number, the bare "Yes", "just WhatsApp me", the busy teacher, the objector),
are played by a cheap LLM against the **real agent prompt** (`build_system_prompt`
on a saved call context), the **real production LLM**, and the **real text gates**
(SentinelGate marker/tool-call handling, NoRepeatGate). TTS and STT are replaced by
text, so a full run costs LLM tokens only (~₹6). What the caller would have heard is
graded by hard rules (re-greet, not ending when asked, spoken markup, full name,
invented price or time, wrong weekday, Hindi not kept, online pitch after "all
offline"…) plus a judge score for "did it listen".

```
docker compose exec voice-bot python -m sim.run                     # prod model, all personas
python -m sim.run --model sarvam:sarvam-105b --reps 3               # any model spec (see sim/llm.py)
python -m sim.run --agent <ai_agent id>                             # a live agent's real context
python -m sim.run --ci                                              # exit 1 on a hard fail
```

It runs in CI after the unit harness (`Run conversation simulator`) and blocks the
deploy on a hard fail; the JSON report is an artifact. **Run it before any model,
voice, prompt-rule or turn-taking change** — that is the whole point. Not covered:
how the voice sounds, real line acoustics, STT mishearings (listen to recordings).

### Timing simulator (`sim/timing.py`) — the real pipeline on a simulated line

The text simulator cannot see barge-in, ducking, a held question tail resuming, a
goodbye that never closes, or a nudge firing after it. `sim/timing.py` runs the real
`run_bot` pipeline (every gate, the aggregator with Silero VAD and Smart Turn, the
watchdog) on a simulated Plivo line: caller turns are real 8 kHz speech clips
(`sim/fixtures/caller/`, one TTS render each, complete utterances so Smart Turn
hears a natural ending), STT/LLM/TTS are stubs with vendor-like latency and the
Smallest service's frame shape, and the output transport paces in real time. Six
scenarios from this week's calls assert on what the line carried — bot audio
intervals, played transcript, LLM prompts, diagnostics. No credentials, no cost;
runs in CI on every push (`Run timing simulator`) and blocks the deploy.

```
docker compose exec voice-bot python -m sim.timing --verbose
python -m sim.timing --scenarios yes_over_tail,farewell_without_marker
```

Its first day found that the "Yes over the question tail" fix relied on DuckGate
holding audio, which it never does (TTS outruns real time; the tail sits in the
transport's queue), and reproduced the farewell dead-air hole before its fix.
