"""Environment configuration for the Vacademy AI voice-bot service.

The service is STATELESS: no database. Per-call context comes from admin_core's
internal API; the end-of-call report goes back through the public generic
AI-voice webhook. Everything here is env-driven so the same image runs in any
environment.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    # Public base URL of THIS service INCLUDING the ingress path prefix — used to
    # build the wss:// URL inside the /answer XML. The service rides the shared
    # cluster host under /voice-bot-service (same pattern as /ai-service), so:
    #   PUBLIC_BASE=https://backend-stage.vacademy.io/voice-bot-service
    public_base: str = field(default_factory=lambda: _env("PUBLIC_BASE").rstrip("/"))

    # admin_core base, e.g. https://backend-stage.vacademy.io
    admin_core_base: str = field(
        default_factory=lambda: _env("ADMIN_CORE_BASE", "https://backend-stage.vacademy.io")
    )
    # Internal client identity (row in admin_core's client_secret_key table).
    internal_client_name: str = field(
        default_factory=lambda: _env("VOICE_BOT_CLIENT_NAME", "voice_bot_service")
    )
    internal_client_secret: str = field(default_factory=lambda: _env("VOICE_BOT_CLIENT_SECRET"))

    # Sarvam (STT + LLM + TTS) — see providers.py
    sarvam_api_key: str = field(default_factory=lambda: _env("SARVAM_API_KEY"))
    # STT model. saaras:v4 (chosen 2026-08-03) is a speech-to-text-TRANSLATE model:
    # it AUTO-DETECTS the spoken language and returns ENGLISH. saarika:v2.5, the
    # previous default, transcribes in the language actually spoken.
    #
    # Why the switch: pinned to hi-IN, saarika transliterated ENGLISH callers into
    # Devanagari ("इफ यू रिकॉर्ड योर नेम..." for "if you record your name"), and on
    # 2026-08-03 it went deaf on a live call — the caller said "hybrid model" four
    # times and saarika returned ZERO finals for it (one final in a 50s window,
    # first final of the call took 6.08s to process, 4 socket reconnects).
    #
    # KNOWN RISK, recorded honestly: an OLDER saaras (v3) was abandoned precisely
    # because it garbled code-switched Hinglish into gibberish ("Myapolicil tme we
    # face"), which the LLM then could not act on. v4 is two versions on, but if
    # Hinglish garbling returns, roll back with SARVAM_STT_MODEL=saarika:v2.5 —
    # no deploy needed.
    #
    # SIDE EFFECTS of a translate model, both real:
    #  * SARVAM_STT_LANGUAGE and any per-agent language pin become INERT (pipecat
    #    raises if a language is passed to saaras — build_stt drops it).
    #  * A Hindi caller now reaches the LLM as ENGLISH text, so the prompt's
    #    "speak the caller's language" rule can no longer infer their language
    #    from the transcript. Watch Hindi-first agents.
    #  * The name bias (`prompt`) only works on saaras, so it now ENGAGES — the
    #    agent's own name should stop coming back as "Aayushi"/"Aarush".
    # ── STT provider A/B (pipecat 1.4 migration, founder-approved 2026-08-05) ──
    # "sarvam" (default) | "google". Google = streaming v2 on the SAME GCP
    # project/credentials as the Vertex LLM; it sends INTERIM results (Sarvam
    # never does), which Smart Turn and the turn-gate both benefit from. Flip
    # per test call via env; nothing else changes.
    stt_provider: str = field(default_factory=lambda: _env("STT_PROVIDER", "sarvam"))
    # Waterfall: a second STT vendor that takes over for the rest of the call
    # when the primary fails — its socket errors (pipecat's failover strategy)
    # or an audible caller utterance producing no transcript (the orphan
    # re-ask, our own signal). Empty = no failover. Founder 2026-09-15 after
    # call 28570ec0 (Smallest deaf for the last 70 s): "sarvam stt and have
    # waterfall if sarvam fails to smallest".
    stt_fallback_provider: str = field(default_factory=lambda: _env("STT_FALLBACK_PROVIDER", ""))
    # The STT vendor's socket I/O runs in its own task (providers.decoupled_stt_io)
    # and a send that has not completed in this many seconds is a stuck socket:
    # the queued caller audio goes to the fallback STT and the waterfall fails
    # over. Call 3e327e8a (2026-10-02): Sarvam closed the stream ("Credits
    # exhausted") and held the TCP open; every send waited 10 s, and so did the
    # opening and everything else queued behind the STT. A healthy socket
    # finishes a send in microseconds whether or not the caller is talking.
    # Kill switch: STT_STALL_SECS=0 (sends inline again, as pipecat does).
    stt_stall_secs: float = field(default_factory=lambda: float(_env("STT_STALL_SECS", "1.5")))
    google_stt_language: str = field(
        default_factory=lambda: _env("GOOGLE_STT_LANGUAGE", "hi-IN"))
    # Smallest Pulse STT (STT_PROVIDER=smallest). Chosen 2026-09-12 from a
    # three-way bench on 4 real AI-call recordings (63-114 turns) driven through
    # the pipecat services exactly like a live call: final-after-VAD-stop median
    # 0.12 s / p90 0.23 s vs Sarvam 0.14 / 1.86 (11 of 67 turns over 1 s, up to
    # 3.8 s) and Gnani 0.65 / 0.80; word error 0.74 vs Sarvam 0.99; hears the lone
    # "haan" Sarvam drops every time; clean mixed-script text instead of English
    # forced into Devanagari; ~₹20/hr vs ₹30. Known: a lone "haan" finalises ~2.5 s
    # late, two real turns took 5-7 s; 16 kHz was WORSE (median 0.76 s) — stay 8 kHz.
    # Pulse's "hi" covers Hindi-English code-switching; "multi" auto-detects.
    smallest_stt_language: str = field(
        default_factory=lambda: _env("SMALLEST_STT_LANGUAGE", "hi"))
    # Turn-stop hold for Pulse's final (see sarvam_ttfs_p99): measured p90 0.23 s
    # on real recordings; 0.5 keeps parity with Sarvam's hold, the slow outliers
    # are beyond any sane hold and Smart Turn's own cap covers them.
    smallest_ttfs_p99: float = field(
        default_factory=lambda: float(_env("SMALLEST_TTFS_P99", "0.5")))
    # Pulse decodes what it has when our VAD stop sends `finalize`. On a SHORT
    # answer that is ~0.3 s of audio, and it either answers ~2.5 s late or not
    # at all — bench: "haan" 2.50 s every run; live call a59696ed (2026-09-13):
    # the caller's "Yes" produced NO transcript, 5.6 s of silence, they said
    # "hello" and only that was heard. 2 of 13 closed turns in the day's logs
    # had no transcript within 2.5 s.
    # Asking AGAIN when nothing has come back fixes it at no cost to healthy
    # turns — measured on the same clips:
    #   finalize once (pipecat)  haan 2.50 s   yes 0.11 s
    #   hold finalize 0.5 s      haan 0.73 s   yes 0.72 s   <- taxes every turn
    #   ask again after 0.7 s    haan 0.81 s   yes 0.11 s   <- this
    # SMALLEST_FINALIZE_RETRY_SECS=0 restores pipecat's behaviour exactly.
    smallest_finalize_retry_secs: float = field(
        default_factory=lambda: float(_env("SMALLEST_FINALIZE_RETRY_SECS", "0.7")))
    smallest_finalize_retries: int = field(
        default_factory=lambda: int(_env("SMALLEST_FINALIZE_RETRIES", "3")))
    # A VAD stop inside the first `hold_below` s of a turn is usually a breath
    # ("Uh," … "I think mix"). Finalizing there made Pulse return an empty final
    # and drop the REST of the sentence: 5-6 s utterances with no transcript on
    # calls 82c1f95a (twice), 91d1541e, 15aadcdb. Hold the finalize `hold_secs`;
    # a new onset inside the hold cancels it. Costs that hold on a genuine
    # one-word answer only. SMALLEST_HOLD_BELOW_SECS=0 disables.
    # DEFAULT OFF: on the bench it cost +0.6 s on every one-word answer (yes
    # 0.11 -> 0.72 s; real-recording p90 0.19 -> 0.74 s) and the drops could
    # not be reproduced there to prove the benefit. The orphan re-ask is the
    # live mitigation; set SMALLEST_HOLD_BELOW_SECS=1.5 on the box to trial it.
    smallest_hold_below_secs: float = field(
        default_factory=lambda: float(_env("SMALLEST_HOLD_BELOW_SECS", "0")))
    smallest_hold_secs: float = field(
        default_factory=lambda: float(_env("SMALLEST_HOLD_SECS", "0.5")))
    # "telephony", NOT "latest_long": measured on the caller channel of real call
    # 31a1acf1 (8 kHz Hindi phone audio), latest_long dropped most of every
    # utterance ("क्या बात कर रहा है?" for a 15-word sentence) while telephony
    # transcribed it nearly in full. Shipping latest_long would have rigged the
    # A/B against Google. chirp_2 is comparable but only serves from
    # us-central1 — a cross-ocean hop per turn from Mumbai, so not for live calls.
    google_stt_model: str = field(
        default_factory=lambda: _env("GOOGLE_STT_MODEL", "telephony"))
    google_stt_location: str = field(
        default_factory=lambda: _env("GOOGLE_STT_LOCATION", "global"))
    # How long the 1.4 turn-stop strategy may hold a turn waiting for Sarvam's
    # final (Sarvam never flags finalized=True). pipecat default 1.17 = ~1s of
    # added dead air EVERY turn; the founder POC ships 0.5.
    sarvam_ttfs_p99: float = field(
        default_factory=lambda: float(_env("SARVAM_TTFS_P99", "0.5")))
    # Mark the final Sarvam sends in answer to our flush (after the VAD stop,
    # before the caller speaks again) as finalized, so the turn closes on it
    # instead of waiting out sarvam_ttfs_p99 - vad_stop_secs = 0.30 s. The 22
    # Sep batch: that 0.30 s sat between "Smart Turn: COMPLETE" and the model
    # starting on EVERY turn, while the final itself had arrived 0.08 s after
    # the voice stopped. Finals that arrive mid-utterance are left unflagged,
    # so they keep the safety wait. Kill switch.
    sarvam_final_on_flush: bool = field(
        default_factory=lambda: _env("SARVAM_FINAL_ON_FLUSH", "1") not in ("0", "false", "no"))
    # Smart Turn v3 semantic end-of-turn: max silence it may wait before forcing
    # the turn closed (the model usually decides much earlier).
    smart_turn_stop_secs: float = field(
        default_factory=lambda: float(_env("SMART_TURN_STOP_SECS", "1.5")))

    sarvam_stt_model: str = field(default_factory=lambda: _env("SARVAM_STT_MODEL", "saaras:v4"))
    # Pin STT to one language instead of auto-detect. Default "hi-IN": auto-detect
    # drifts a Hindi/Hinglish caller into a NEIGHBOURING Indic language — Punjabi or
    # Marathi (Marathi shares Devanagari, Punjabi is phonetically close) — and once one
    # turn is transcribed as Punjabi/Marathi the "speak the caller's language and stay
    # in it" rule makes the LLM reply, and the TTS speak, that language for the rest of
    # the call. Pinning hi-IN still transcribes the English words in a Hinglish sentence
    # (saarika is code-mixed aware) but never leaves Hindi. Set "" for auto-detect or
    # another BCP-47 tag (e.g. "en-IN") for an English-first agent. Read in build_stt.
    # saaras mode: transcribe | translate | verbatim | translit | codemix.
    # Only meaningful on saaras:v3/v4. "codemix" is the right default for
    # Hinglish agents — it keeps the caller's code-switched words instead of
    # forcing them into one script (saarika's hi-IN pin turned English callers
    # into Devanagari) or into English (translate mode).
    sarvam_stt_mode: str = field(default_factory=lambda: _env("SARVAM_STT_MODE", "transcribe"))
    sarvam_stt_language: str = field(default_factory=lambda: _env("SARVAM_STT_LANGUAGE", "hi-IN"))
    sarvam_llm_model: str = field(default_factory=lambda: _env("SARVAM_LLM_MODEL", "sarvam-105b"))
    # POC (2026-09-10): route ONLY these agent ids to the Sarvam LLM while every
    # other agent stays on LLM_PROVIDER. Measured from the box with the real
    # 25K-char yoga prompt: sarvam-105b TTFT 0.34s med vs gemini-2.5-flash 0.43s,
    # at ₹29.28/₹73.2 per 1M in/out (cached input ₹10.98) vs Gemini's ~3x dearer
    # output. Comma-separated; empty = off. Sarvam's open-source models
    # (deepseekv4-flash, gemma4, glm5.2) sit on /v2 which is beta-gated — the
    # account needs Sarvam support to enable it before they can be tried.
    sarvam_llm_agents: tuple = field(
        default_factory=lambda: tuple(
            a.strip() for a in _env("SARVAM_LLM_AGENTS").split(",") if a.strip()))
    # Same routing by INSTITUTE id — founder decision 2026-09-10 after the POC
    # ("move the sales agents to sarvam-105b"): every agent of a listed institute
    # (Vacademy's own outbound sales agents) uses Sarvam, so a new agent under
    # that institute cannot silently land back on Gemini. Customer institutes
    # stay on LLM_PROVIDER until they are listed here.
    sarvam_llm_institutes: tuple = field(
        default_factory=lambda: tuple(
            a.strip() for a in _env("SARVAM_LLM_INSTITUTES").split(",") if a.strip()))
    # ── Amazon Bedrock, Mumbai (ap-south-1) — LLM_PROVIDER="bedrock" ─────────
    # POC 2026-09-10 (founder: "models available in India region, more
    # intelligent than gemini 2.5 flash, up to 2x the cost"). Measured from the
    # box with the real 25K-char prompt and the 10-scenario call eval:
    #   moonshotai.kimi-k2.5   TTFT 0.48s, 10/10 + 9/9 repeats clean (never
    #                          invented a price or a time, right weekday 3/3,
    #                          on-script Hindi) — $0.72/$3.60 per 1M in Mumbai
    #                          ≈ 2.2x Gemini per call
    #   qwen.qwen3-235b-…      0.64s, invented a time 1/3, ≈1.7x
    #   zai.glm-4.7-flash      0.53s, ≈0.25x, but wrong weekday 2/3, answered a
    #                          Hindi caller in English 2/3, hung up on a
    #                          wrong-person turn — not for a sales agent
    #   deepseek/mistral/qwen3-32b invented prices; minimax 1.5s TTFT;
    #   Claude/Nova Pro only via global profiles (1-1.8s) and over budget.
    # Auth: a Bedrock API key in AWS_BEARER_TOKEN_BEDROCK (boto/aiobotocore
    # read it natively) — or the usual AWS_ACCESS_KEY_ID / SECRET.
    bedrock_model: str = field(
        default_factory=lambda: _env("BEDROCK_MODEL", "moonshotai.kimi-k2.5"))
    bedrock_region: str = field(default_factory=lambda: _env("BEDROCK_REGION", "ap-south-1"))
    # Model-specific request fields as JSON. Kimi/GLM/DeepSeek THINK by default
    # (seconds before the first spoken token) — off for a scripted sales call.
    bedrock_extra_json: str = field(
        default_factory=lambda: _env("BEDROCK_EXTRA_JSON", '{"thinking": {"type": "disabled"}}'))
    bedrock_llm_agents: tuple = field(
        default_factory=lambda: tuple(
            a.strip() for a in _env("BEDROCK_LLM_AGENTS").split(",") if a.strip()))
    bedrock_llm_institutes: tuple = field(
        default_factory=lambda: tuple(
            a.strip() for a in _env("BEDROCK_LLM_INSTITUTES").split(",") if a.strip()))
    sarvam_llm_base_url: str = field(
        default_factory=lambda: _env("SARVAM_LLM_BASE_URL", "https://api.sarvam.ai/v1")
    )
    # Sarvam's OPEN-SOURCE models (gemma4, deepseekv4-flash, glm5.x) live on
    # /v2 under a SEPARATE sk_… subscription from the account's SARVAM_API_KEY
    # — and that key also backs the Sarvam TTS fallback, so the LLM gets its
    # own. Falls back to SARVAM_API_KEY when unset (the /v1 sarvam-m path).
    # Benched 2026-09-14 from Mumbai on the real 18K-char agent prompt, 45 sim
    # runs each vs gemini-2.5-flash: gemma4 judge 7.2 vs 6.1, hard-fail runs
    # 1 vs 4, TTFT median 521 vs 528 ms, p90 639 vs 711 ms. glm5.x always
    # reason (no parameter turns it off; TTFT 1.7-6.7 s) — unusable for voice.
    #   LLM_PROVIDER=sarvam SARVAM_LLM_BASE_URL=https://api.sarvam.ai/v2
    #   SARVAM_LLM_MODEL=gemma4 SARVAM_LLM_API_KEY=sk_…
    sarvam_llm_api_key: str = field(
        default_factory=lambda: _env("SARVAM_LLM_API_KEY") or _env("SARVAM_API_KEY"))
    # Sarvam-side fast endpointing: server endpointing (~0.65-0.76s from end of speech)
    # is the measured binding constraint on reply latency — high VAD sensitivity asks
    # Sarvam to finalize sooner. Env-off if it starts clipping slow speakers.
    sarvam_stt_high_vad: bool = field(
        default_factory=lambda: _env("SARVAM_STT_HIGH_VAD", "true").lower() == "true")
    # ── TTS provider ────────────────────────────────────────────────────────
    # Per-agent selectable; this is the fallback when an agent has no preference.
    # "rumik" = Rumik Silk mulberry 1.5 (Rs 0.50/1k chars). "sarvam" = bulbul:v3
    # (Rs 3.00/1k) — 6x dearer and priced to the customer accordingly.
    # FALLBACK when an agent has no tts_model of its own — deliberately "sarvam",
    # even though Rumik is the default for NEW agents. Absence of config means an
    # agent predates the picker, and those institutes are billed at the Sarvam
    # rate and have approved a Sarvam voice; moving them by omission would change
    # both what they hear and what they pay. New agents get "rumik" stamped
    # EXPLICITLY by admin_core, so the default never has to carry that decision.
    tts_model: str = field(default_factory=lambda: _env("TTS_MODEL", "sarvam"))
    rumik_api_key: str = field(default_factory=lambda: _env("RUMIK_API_KEY"))
    # ── Google Cloud TTS (3rd engine, added 2026-08-05) ─────────────────────
    # Founder picked Chirp3-HD by ear over Sarvam, Rumik and Google's other
    # tiers. Economics measured from OUR OWN calls (779 chars per call-minute,
    # 13 prod calls): Chirp3-HD $30/1M chars = Rs 2.06/call-min vs Sarvam's
    # Rs 2.34 — CHEAPER than what we ship today, plus 1M chars/month free
    # (~1,280 call-minutes). Neural2/WaveNet ($16/1M = Rs 1.10) are the
    # fallback tiers if Chirp3-HD ever bites at scale.
    # Auth reuses the Vertex service account (VERTEX_CREDENTIALS_*) — no new
    # vendor, no new secret.
    google_tts_voice: str = field(
        default_factory=lambda: _env("GOOGLE_TTS_VOICE", "hi-IN-Chirp3-HD-Achird"))
    google_tts_language: str = field(
        default_factory=lambda: _env("GOOGLE_TTS_LANGUAGE", "hi-IN"))
    # 1.0 = native. Chirp3-HD is already brisk; 1.05 matches our Sarvam pace 1.1
    # without clipping consonants.
    google_tts_speaking_rate: float = field(
        default_factory=lambda: float(_env("GOOGLE_TTS_SPEAKING_RATE", "1.05")))
    # Chirp3-HD streams 24 kHz; the output transport resamples to the 8 kHz leg.
    google_tts_sample_rate: int = field(
        default_factory=lambda: int(_env("GOOGLE_TTS_SAMPLE_RATE", "24000")))

    # ── Smallest.ai Lightning (4th engine, added 2026-08-05) ────────────────
    # Indian-language specialist; 146 of its 234 lightning_v3.1 voices are
    # Hindi-capable. Key is env-only (NEVER in code): the one pasted in chat on
    # 2026-08-05 must be treated as compromised and rotated.
    smallest_api_key: str = field(default_factory=lambda: _env("SMALLEST_API_KEY"))
    # lightning_v3.1 | lightning_v3.1_pro. NOTE the palettes DIFFER per model —
    # the API rejects a cross-model voice outright ("Voice 'devansh' is not
    # available on the lightning_v3.1_pro model"), which means a mute call.
    smallest_model: str = field(
        default_factory=lambda: _env("SMALLEST_MODEL", "lightning_v3.1"))
    smallest_voice: str = field(
        default_factory=lambda: _env("SMALLEST_VOICE", "devansh"))
    # Lightning emits 24 kHz; transport resamples to 8 kHz for Plivo.
    smallest_sample_rate: int = field(
        default_factory=lambda: int(_env("SMALLEST_SAMPLE_RATE", "24000")))
    rumik_voice: str = field(default_factory=lambda: _env("RUMIK_VOICE", "ira"))

    # ── Deepgram Aura-2 ─────────────────────────────────────────────────────
    # ENGLISH-ONLY. Verified against the live /v1/models catalog on 2026-08-13:
    # 102 TTS models spanning en/es/de/fr/nl/it/ja and NO Hindi — not shipped,
    # not announced. So this engine is for English-speaking agents only; a
    # Hinglish agent (Shreya, Ameet) must never be pointed at it or the caller
    # hears Devanagari read as English letters.
    # Native pipecat WebsocketTTSService, so barge-in cancel comes for free.
    # Key is env-only (NEVER in code) — the one pasted in chat on 2026-08-13
    # must be treated as compromised and rotated, same as the Smallest key above.
    deepgram_api_key: str = field(default_factory=lambda: _env("DEEPGRAM_API_KEY"))
    # Navana (Bodhi) TTS — Indian-language voices, one voice id across ten
    # languages. Streams over wss://tts.navana.ai/v1 through their own Pipecat
    # service (bodhi-api-sdk). NOTE the account default of TWO concurrent
    # connections, and a live call holds one for its whole duration: ask Navana
    # to raise it before putting more than two concurrent calls on this engine.
    # Several keys (separate accounts) comma-separated — "k1,k2" — add 2 streams
    # each: providers.NAVANA_KEYS gives every connection the least-loaded key.
    navana_api_key: str = field(default_factory=lambda: _env("NAVANA_API_KEY") or _env("BODHI_API_KEY"))
    navana_tts_voice: str = field(default_factory=lambda: _env("NAVANA_TTS_VOICE", "bhavana"))
    deepgram_tts_voice: str = field(
        default_factory=lambda: _env("DEEPGRAM_TTS_VOICE", "aura-2-asteria-en"))
    # Aura-2 emits 24 kHz linear16; the transport resamples to 8 kHz for Plivo.
    deepgram_tts_sample_rate: int = field(
        default_factory=lambda: int(_env("DEEPGRAM_TTS_SAMPLE_RATE", "24000")))

    # Deterministic Devanagari→Latin term fixes applied to text entering Rumik.
    # Rumik reads Devanagari-transliterated English as gibberish ("लाइव क्लासेस"
    # spoken as "लव असेस" — founder calls 8e1e00ad + ae7d3069). A prompt rule
    # failed TWICE to stop the LLM transliterating (11k-char authored prompts
    # win over rules), so the fix is a replacement at the synthesis boundary —
    # deterministic, testable, and invisible to transcripts/context (which keep
    # the written form). Longest-first; extend via env: "देवनागरी=Latin;…".
    # Pronunciation fixes applied to EVERY engine at the synthesis boundary.
    #
    # rumik_term_map below solves one vendor's Devanagari problem and is applied only
    # on Rumik paths. This one exists because the same class of bug is not vendor-
    # specific: Shiksha Nation's agent runs on smallest_pro, which reads "शिक्षा नेशन"
    # as "shiksha-NAI-shan". Rewriting the prompt to spell the name in Latin did NOT
    # fix it — the model composes Hindi and transliterates the name back — which is the
    # third time in this codebase that a prompt rule has lost to the model on exactly
    # this problem ("Prompt rules failed to stop the transliteration twice").
    #
    # So the replacement happens where the model cannot reach it: on the text handed to
    # the vendor. Transcripts, the LLM context and the report all keep the written form.
    #
    # EMPTY by default — every existing agent is unaffected until an entry is added.
    # Format matches RUMIK_TERM_MAP: "from=to;from=to". Longest-first so a longer key
    # wins over a prefix of itself.
    speech_term_map: tuple = field(default_factory=lambda: tuple(sorted(
        ((p.split("=", 1)[0].strip(), p.split("=", 1)[1].strip())
         for p in _env("SPEECH_TERM_MAP", "").split(";") if "=" in p),
        key=lambda kv: -len(kv[0]))))

    rumik_term_map: tuple = field(default_factory=lambda: tuple(sorted(
        ((p.split("=", 1)[0].strip(), p.split("=", 1)[1].strip())
         for p in _env(
             "RUMIK_TERM_MAP",
             "लाइव क्लासेस=Live Classes;लाइव क्लास=Live Class;क्लासेस=classes;"
             "क्लास=class;लाइव=Live;असेसमेंट=assessment;व्हाट्सएप=WhatsApp;"
             "कॉन्सेप्ट्स=concepts;कॉन्सेप्ट=concept;सिलेबस=syllabus;"
             "डेमो=demo;ऑनलाइन=online;बैच=batch;इम्प्रूवमेंट=Improvement;"
             "प्रोग्राम=Program").split(";")
         if "=" in p and p.split("=", 1)[0].strip()),
        key=lambda kv: -len(kv[0]))))

    sarvam_tts_model: str = field(default_factory=lambda: _env("SARVAM_TTS_MODEL", "bulbul:v3"))
    sarvam_tts_voice: str = field(default_factory=lambda: _env("SARVAM_TTS_VOICE", "priya"))
    # Server-side chars Sarvam buffers before synthesizing the first audio (default 50).
    # DEFAULT 0 = DON'T SEND (server default 50): at 30 the smaller chunks produced
    # audible SEAMS — callers reported 'network-like' breaking on some sentences
    # (2026-07-20). And 20 is outright REJECTED by Sarvam's config validation, which
    # killed TTS on every call (silent-call outage same day; probe: 20 rejected,
    # 30/50 accepted). providers.build_tts clamps any override to >= 30. Smoothness
    # beats the ~0.1s first-audio win — leave at 0 unless re-testing deliberately.
    sarvam_tts_min_buffer: int = field(
        default_factory=lambda: int(_env("SARVAM_TTS_MIN_BUFFER", "0")))

    # LLM provider switch: "sarvam" (default) | "vertex" | "google" | "openrouter". Governs
    # BOTH the live conversation (providers.build_llm) and the end-of-call
    # analysis (report._llm_target) — they must never diverge.
    # sarvam = India-hosted sarvam-105b with reasoning_effort=null (the literal
    # JSON null via extra_body — the ONLY value that disables its hybrid
    # "thinking"): 0.14s median TTFT from the Mumbai anchor, ~5x faster than
    # Gemini's 0.75-0.85s. With thinking ON it is unusable live (6-14s, or
    # content=None when max_tokens dies mid-think) — never drop the null.
    # google = Gemini's OpenAI-compat endpoint hit directly (no proxy hop);
    # openrouter = proxy fallback (routing lottery spiked TTFT to 7.9s once).
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "sarvam"))
    # Second LLM for the rest of a call once the first one errors or stalls
    # (call f58ca825, 2026-09-22: Sarvam 34 s → 49 s → 403 with nothing to
    # catch it). Empty = no waterfall. Same values as LLM_PROVIDER.
    llm_fallback_provider: str = field(default_factory=lambda: _env("LLM_FALLBACK_PROVIDER", ""))
    # A reply whose first token has not arrived by then is a vendor failure,
    # not a slow reply: it errors, and the waterfall takes over. 0 = off.
    llm_first_token_timeout_secs: float = field(
        default_factory=lambda: float(_env("LLM_FIRST_TOKEN_TIMEOUT_SECS", "6.0")))
    # Vertex primary WITH a fallback: give up on Gemini after this long with no
    # first token and let the waterfall answer on the fallback. 23 Sep batch:
    # one 429 RESOURCE_EXHAUSTED (asia-south1 shared capacity) took 7.1 s to
    # surface, uncovered by the 6 s guard above (OpenAI-compatible services
    # only). Gemini's own first token: p50 0.49 s, p95 0.80 s. 0 = off.
    vertex_first_token_timeout_secs: float = field(
        default_factory=lambda: float(_env("VERTEX_FIRST_TOKEN_TIMEOUT_SECS", "3.0")))
    openrouter_api_key: str = field(default_factory=lambda: _env("OPENROUTER_API_KEY"))
    openrouter_base_url: str = field(
        default_factory=lambda: _env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    )
    openrouter_model: str = field(
        default_factory=lambda: _env("OPENROUTER_MODEL", "google/gemini-3.1-flash-lite")
    )
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY"))
    google_llm_base_url: str = field(
        default_factory=lambda: _env(
            "GOOGLE_LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"
        )
    )
    google_llm_model: str = field(
        default_factory=lambda: _env("GOOGLE_LLM_MODEL", "gemini-3.1-flash-lite")
    )

    # Vertex AI (Gemini) served from an IN-INDIA region — LLM_PROVIDER="vertex".
    # Unlike the "google" path (generativelanguage.googleapis.com, US/global, ~5x
    # the TTFT from Mumbai), Vertex runs the model in vertex_location, so pinning
    # asia-south1 (Mumbai) gives ~0.37s TTFT + near-zero network RTT AND better
    # instruction-following than sarvam-105b. Auth is a Google SERVICE ACCOUNT
    # (JSON), not an API key: set VERTEX_CREDENTIALS_JSON (the full SA JSON string)
    # or VERTEX_CREDENTIALS_PATH (path to the file), plus VERTEX_PROJECT_ID. The SA
    # needs role roles/aiplatform.user and the Vertex AI API enabled in the project.
    # Gemini "thinking" is auto-disabled by pipecat (thinking_budget=0) → fast path.
    vertex_project_id: str = field(default_factory=lambda: _env("VERTEX_PROJECT_ID", ""))
    vertex_location: str = field(default_factory=lambda: _env("VERTEX_LOCATION", "asia-south1"))
    vertex_credentials_json: str = field(
        default_factory=lambda: _env("VERTEX_CREDENTIALS_JSON", "")
    )
    vertex_credentials_path: str = field(
        default_factory=lambda: _env("VERTEX_CREDENTIALS_PATH", "")
    )
    # gemini-2.5-flash-lite is NOT served in asia-south1 (404 verified 2026-07-14) — only
    # gemini-2.5-flash is. Default to what the target region actually has; override per region.
    vertex_model: str = field(
        default_factory=lambda: _env("VERTEX_MODEL", "gemini-2.5-flash")
    )

    # Telephony audio is 8 kHz mu-law on Plivo <Stream>.
    sample_rate: int = 8000

    # ── How far ahead of real time we may push audio into Plivo ─────────────
    # THE root cause of "after I speak, it takes ages for the bot to stop"
    # (founder, three separate calls). pipecat's websocket transport sends each
    # chunk at TWICE real time (_send_interval = chunk_duration / 2), so Plivo
    # accumulates unplayed audio equal to ~half the reply — up to 10s on a 20s
    # pitch. Our barge-in duck can only hold what has NOT been sent yet, so on
    # live call d6e82def the interrupt logged "dropping 0 held frame(s)": the
    # whole reply was already inside Plivo and kept playing regardless.
    #
    # This caps the lead instead: burst until there is this much cushion, then
    # track real time. Plivo then holds ~this much, so ducking silences the line
    # within it, and BotStoppedSpeaking stops firing half a reply early (which
    # was also skewing every dead-air and idle measurement).
    # 0 disables the patch and restores pipecat's 2x behaviour.
    audio_max_lead_secs: float = field(
        default_factory=lambda: float(_env("AUDIO_MAX_LEAD_SECS", "0.3")))

    # Turn-taking latency knobs (pipecat defaults: 0.8 / 0.5 — a full 1.3s of
    # dead air before the LLM even starts). vad_stop_secs = silence needed to
    # decide the caller finished; too low clips slow speakers mid-sentence.
    # agg_timeout_secs = extra wait for a late-arriving final transcript.
    # 0.2 on pipecat 1.4 (was 0.5): end-of-turn is Smart Turn v3's job now — the
    # VAD stop only feeds the turn analyzer, and a long window here just delays
    # it. POC ships 0.15; 0.2 is one notch safer on noisy phone lines.
    # ⚠ REMOVE any VAD_STOP_SECS=0.5 override from box/k8s env on deploy.
    vad_stop_secs: float = field(default_factory=lambda: float(_env("VAD_STOP_SECS", "0.2")))
    # Silero gates on RMS volume BEFORE the model runs, default 0.6 — tuned for
    # headset/webrtc audio. On the founder's 2026-08-05 call (8e1e00ad) that gate
    # never passed for the CALLER's own voice (the loud call-screening robot DID
    # pass): zero VAD onsets during bot speech → the duck never engaged, the bot
    # talked through every interruption, and pipecat's emulated-VAD path deleted
    # the caller's words. 8 kHz telephony speech is simply quieter than 0.6.
    vad_min_volume: float = field(
        default_factory=lambda: float(_env("VAD_MIN_VOLUME", "0.35")))
    vad_confidence: float = field(
        default_factory=lambda: float(_env("VAD_CONFIDENCE", "0.6")))
    vad_start_secs: float = field(
        default_factory=lambda: float(_env("VAD_START_SECS", "0.2")))
    # Measured on live calls (48h, 141 turns): Sarvam's STT final trails local VAD stop in
    # 85% of turns, so this timeout is PURE additive delay on top of an already-final
    # transcript. 0.08 keeps a small merge window for split finals; saves ~0.12s/turn.
    agg_timeout_secs: float = field(default_factory=lambda: float(_env("AGG_TIMEOUT_SECS", "0.08")))

    # Bulbul speaking pace: 1.0 = native. Founder feedback on the live calls:
    # 0.95 sounded noticeably slow on the phone; 1.1 is brisk but natural.
    tts_pace: float = field(default_factory=lambda: float(_env("TTS_PACE", "1.1")))

    # Filler acknowledgment ("Hmm…", "Achha…") spoken the moment the caller's
    # words are transcribed, masking the LLM+TTS gap — the pipeline's hard floor
    # is ~1.5s (0.5 VAD + 0.36 STT final + 0.8 Gemini TTFT) and this cuts the
    # PERCEIVED dead air to ~1s, which is what human agents do. Probability 0
    # disables; phrases are comma-separated and spoken verbatim.
    # 0.25 (was 0.7): with Gemini's ~0.5s TTFT the filler often COLLIDES with the
    # real reply, and on live calls a reply-shaped filler ('Okay…') played right
    # before an interrupted response read as the bot answering then going silent.
    # 0.10 (was 0.25): live feedback — still "too much Hmm-ing". The filler is
    # only a latency mask; with Gemini at ~0.5s TTFT it is rarely needed.
    filler_probability: float = field(
        default_factory=lambda: float(_env("FILLER_PROBABILITY", "0.10"))
    )
    # 'Hmm…' only: clearly a thinking sound. 'Achha…'/'Ji…'/'Okay…' sound like
    # complete replies, which made stalls read as answers.
    # How recently the VAD must have reported voice for the caller to count as
    # STILL SPEAKING, suppressing the filler. Two missed ticks (they arrive every
    # 0.2s). A real end-of-turn final trails the last tick by ~0.65s, so it is
    # unaffected; a mid-utterance fragment final is not.
    filler_voice_live_secs: float = field(
        default_factory=lambda: float(_env("FILLER_VOICE_LIVE_SECS", "0.4"))
    )
    # Latency bridge: a reply has been composing this long with NO audio on the
    # line → say "Just a second." once (watchdog LLM_BRIDGE). Unlike the
    # probabilistic filler above this is deterministic and fires only when we
    # are already late. Call c130e39f (2026-09-09): Vertex 5.4s to first token,
    # then ~8s to finish a 3-sentence reply — 16s of dead air. 0 disables.
    llm_bridge_after_secs: float = field(
        default_factory=lambda: float(_env("LLM_BRIDGE_AFTER_SECS", "2.0"))
    )
    # ── Room tone ─────────────────────────────────────────────────────────
    # A low-level office ambience loop mixed under EVERY call's outbound audio
    # (assets/office_ambience_8k_mono.wav, 8 kHz mono PCM, ~88 s seamless loop,
    # −32 dBFS RMS). Pure digital silence between turns reads as a machine;
    # room tone reads as a person on a line. Mixed inside the output transport
    # (pipecat SoundfileMixer), so STT/LLM/TTS are untouched. AMBIENCE_VOLUME
    # is the mixer gain: 0.15 on the −32 dBFS file ≈ −48 dBFS RMS — well under
    # the voice. While the bot speaks it is ducked to 0.6x (app/ambience.py).
    ambience_enabled: bool = field(
        default_factory=lambda: _env("AMBIENCE_ENABLED", "true").lower() == "true")
    ambience_volume: float = field(
        default_factory=lambda: float(_env("AMBIENCE_VOLUME", "0.15")))
    # A room is never at exactly one level. Slow +/- drift (dB) over
    # AMBIENCE_DRIFT_PERIOD_SECS, phase randomised per call so two calls never
    # breathe in step. 0 disables and the bed sits at a fixed gain.
    ambience_drift_db: float = field(
        default_factory=lambda: float(_env("AMBIENCE_DRIFT_DB", "2.0")))
    ambience_drift_period_secs: float = field(
        default_factory=lambda: float(_env("AMBIENCE_DRIFT_PERIOD_SECS", "40")))
    # ── Telephone-band EQ on the bot's voice (app/voice_eq.py) ──────────────
    # Our TTS carries 30.8% of its energy below 300 Hz; a real recording
    # through real mics carries 15.3%, because handsets and analog hybrids roll
    # that band off. Matching the caller's band is the biggest remaining
    # "this is a recording" cue. Measured defaults — see the module docstring.
    voice_eq_enabled: bool = field(
        default_factory=lambda: _env("VOICE_EQ_ENABLED", "true").lower() == "true")
    voice_eq_highpass_hz: float = field(
        default_factory=lambda: float(_env("VOICE_EQ_HIGHPASS_HZ", "300")))
    voice_eq_presence_db: float = field(
        default_factory=lambda: float(_env("VOICE_EQ_PRESENCE_DB", "2.5")))
    # Puts back the ~3 dB the high-pass removes, so the bot does not merely get
    # quieter. Measured peak after makeup: -4.5 dBFS.
    voice_eq_makeup_db: float = field(
        default_factory=lambda: float(_env("VOICE_EQ_MAKEUP_DB", "2.0")))
    filler_phrases: tuple = field(
        default_factory=lambda: tuple(
            p.strip() for p in _env("FILLER_PHRASES", "Hmm…").split(",") if p.strip()
        )
    )

    # Call-open pacing: on OUTBOUND the callee already said "hello" on pickup, so the
    # bot SPEAKS FIRST after this short beat — long enough not to clip their "hello",
    # short enough to avoid dead air / the "double hello". Was 2.0s (the main cause of
    # the robotic-feeling start); ~0.8s is the production sweet spot (Vapi/Retell fire
    # the greeting ~0.3-0.8s after the human is on the line). If they say something
    # substantive in this window, their turn drives the reply and the bot doesn't open.
    greet_delay_secs: float = field(default_factory=lambda: float(_env("GREET_DELAY_SECS", "0.8")))

    # Idle handling: nudge once after this silence, then hang up on continued
    # silence. The clock only runs while the BOT is not speaking AND the caller is not
    # mid-utterance (VAD-armed — see bot.py). 10s: at 7s the nudge kept firing while a
    # slow-thinking caller was composing an answer (observed live).
    idle_timeout_secs: float = field(default_factory=lambda: float(_env("IDLE_TIMEOUT_SECS", "8.0")))
    # Audio-stall auto-recovery: ON (Wave 2 Stage E). The v1 false-fire (stale
    # pending-stamp → agents repeated 3x) is fixed — stamps arm only while the
    # bot is quiet and clear on BOTH speaking transitions — and the mechanism is
    # covered by the timeline harness (multi-clause replies produce ZERO stall
    # decisions; true stalls recover once, capped at 3). TTS connect/disconnect
    # is now lock-serialized so the forced reconnect can't race the pipeline's
    # own reconnects. Env kill-switch retained.
    stall_recovery_enabled: bool = field(
        default_factory=lambda: _env("STALL_RECOVERY_ENABLED", "true").lower() == "true")

    # ── Barge-in ducking (founder decision 2026-08-05: "absorb but never lose")
    # When the caller starts speaking over a reply, DuckGate holds the bot's
    # audio ~instantly instead of talking over them for the 2.5-4s the old
    # min-words strategy needed (caller utterance + VAD stop + STT final).
    # A backchannel ("haan", "theek hai") resumes the reply and is appended to
    # the LLM context without a generation; anything else commits a real
    # interruption. false = exact pre-duck behavior (rollback, no deploy).
    # Interrupt the bot the moment the caller's voice is detected, instead of
    # waiting for their words to be transcribed. MEASURED: with this off, the
    # bot kept talking 1.96s after the caller started (probe) because the reply
    # had already flowed past our duck into pipecat's output queue and Plivo's
    # buffer, and only a flush clears those. Cost: a cancelled reply cannot be
    # resumed, so a backchannel makes the bot pick up its sentence via a
    # regeneration cue (see TranscriptCollector). false = the duck-only
    # behaviour, if over-eager stopping on noisy lines ever outweighs this.
    # How long after a cancelled reply a bare acknowledgment still means "carry
    # on with what you were saying" rather than a new turn to answer.
    backchannel_carry_secs: float = field(
        default_factory=lambda: float(_env("BACKCHANNEL_CARRY_SECS", "3.0")))
    # How long into a call an operator/voicemail recording is still plausible.
    # Machine greetings run 10-20s (call 14029bd6's ran 10.4s), and after that a
    # phrase match is far more likely to be the caller than the network.
    machine_greeting_window_secs: float = field(
        default_factory=lambda: float(_env("MACHINE_GREETING_WINDOW_SECS", "22.0")))
    # Ceiling on how long a reply counts as "in flight" before its audio
    # starts. Covers LLM TTFB + TTS TTFB with headroom; capped so a generation
    # that dies pre-playout cannot swallow the caller's turns.
    # Gemini "thinking" tokens before the first reply token. 0 = off, which is
    # what a phone agent wants: measured 2.43s -> 0.51s TTFB on the Mumbai box.
    # Raise ONLY if a future agent genuinely needs reasoning, and re-measure.
    # Suppress a sentence the bot has already said in this call. Off = the old
    # behaviour, in case a deployment ever needs it back in a hurry.
    # Give an AUTHORED prompt the built-in safety rules too (`non_negotiable`).
    #
    # build_system_prompt branches at 600 characters: shorter prompts get the
    # seven rules, longer ones get none of them. 600 characters is about four
    # sentences, so every real agent takes the second branch — production prompts
    # measured 2026-08-14 were 2956, 3359, 3489, 5152 and 10078 characters. The
    # rules therefore reach only the built-in placeholder persona and never an
    # agent running real calls, even though each was added after a specific
    # live-call failure (frustration -> drop the script; conversation stops making
    # sense -> assume you mis-heard; a repeated question means your answer failed).
    #
    # OFF BY DEFAULT so this deploys as a no-op: every existing agent's prompt is
    # byte-identical until someone turns it on. Enable per deployment, watch
    # HANDBACK_LOOP and REPLY_LOOP, and be aware the prompt grows ~1.5k characters
    # — saturation is a known risk here (NoRepeatGate: four prompt-level fixes
    # failed at ~16k). A per-agent switch belongs in the agent editor later; this
    # is the env-level precursor.
    safety_rules_for_authored: bool = field(
        default_factory=lambda: _env("SAFETY_RULES_FOR_AUTHORED", "false").lower() == "true")
    no_repeat_enabled: bool = field(
        default_factory=lambda: _env("NO_REPEAT_ENABLED", "true").lower() == "true")
    # Drop the leading clause when a reply only parrots the caller's own answer
    # back ("ओके, सुबोध अभी आठवीं क्लास में है, तो …") — founder 2026-08-12, "there
    # is no need to reconfirm every time, it looks like an AI". Same reason this
    # is code and not a prompt rule as NO_REPEAT_ENABLED; same kill switch shape.
    no_echo_enabled: bool = field(
        default_factory=lambda: _env("NO_ECHO_ENABLED", "true").lower() == "true")
    # Block LLM generations that have nothing new to answer (last context
    # message not a fresh user message). Kills the reply-to-nothing class that
    # re-delivered the intro on calls 17be14f2/761decff — see bot.RunGuard.
    run_guard_enabled: bool = field(
        default_factory=lambda: _env("RUN_GUARD_ENABLED", "true").lower() == "true")
    # Short-answer grace (bot.RunGuard): a run whose new caller words are at
    # most SHORT_ANSWER_MAX_WORDS is held this long, and dropped if the caller's
    # voice resumes inside it — "Yes." + breath + the real answer must be
    # answered once, as one turn. 0 = off. Bare yes/haan replies pay the grace
    # (less the silence already elapsed when their final lands). 0.8 covers a
    # 0.45 s breath plus the VAD's 0.2 s onset; 0.6 lost the race once in three
    # real-STT sim runs (2026-09-15).
    # RESUMING AFTER A BACKCHANNEL. "हम्म" / "ठीक है" / "Okay" over a reply
    # cancels it at the VAD onset (INTERRUPT_ON_VAD, a measured decision). What
    # follows used to be a full LLM round trip to "carry on", which on call
    # 1e374b99 (2026-09-17) cost 1.7-5.9 s of silence FIFTEEN times and — worse
    # — let the no-echo trimmer delete the opening of the re-generated sentence,
    # so the parent heard "नाम क्या है…" without the clause before it and had to
    # ask "किसका नाम?". Instead: say the exact words that were cut, no model.
    backchannel_resume_verbatim: bool = field(
        default_factory=lambda: _env("BACKCHANNEL_RESUME_VERBATIM", "true").lower() == "true")
    # Do not wait for the transcript to know it was a backchannel: if the voice
    # lasted at most this long AND the bot was cut before finishing a question
    # (so they cannot be answering one), resume the moment the VAD says they
    # stopped. A real turn's final still interrupts, as any barge-in does.
    # 0 disables. The STT final is the whole remaining wait: 0.25-4.07 s on
    # Sarvam in that call.
    backchannel_resume_on_stop_secs: float = field(
        default_factory=lambda: float(_env("BACKCHANNEL_RESUME_ON_STOP_SECS", "1.0")))
    # pipecat clears the TTS queue and reconnects the vendor socket while it
    # handles an interruption, and anything pushed into that window is dropped
    # with no error — the resume was lost that way on 3 of its first 4 live
    # attempts. Wait this long after the cut before speaking the words.
    # Close the caller's turn in the aggregator when the turn-gate swallows a
    # final (backchannel, carrier line, scrap, repeat). Otherwise pipecat keeps
    # it open for user_turn_stop_timeout (5 s) and nothing we say in that
    # window is heard. Kill switch only.
    # A short voice burst with no transcript is judged "noise" only after the
    # STT has had this long to deliver a final for it (call bd9e6a0d).
    noise_reask_wait_secs: float = field(
        default_factory=lambda: float(_env("NOISE_REASK_WAIT_SECS", "1.0")))
    # Most body sentences one model reply may speak; the closing question is
    # still asked. 0 disables. (call bd9e6a0d: a 30 s, five-sentence pitch)
    max_sentences_per_reply: int = field(
        default_factory=lambda: int(_env("MAX_SENTENCES_PER_REPLY", "3")))
    # Length budget per reply, in characters: after the first sentence, no
    # sentence that would take the reply past this (closing question still
    # asked). 0 disables. Call 3c2f5b82 (2026-09-24): stacked pitch lines,
    # "समझ में नहीं आया", hang-up. Shreya p95 = 228 chars; 2 sentences max was
    # tried first and cut required content out of scripted turns (timing sim).
    max_reply_chars: int = field(
        default_factory=lambda: int(_env("MAX_REPLY_CHARS", "240")))
    turn_release_on_absorb: bool = field(
        default_factory=lambda: _env("TURN_RELEASE_ON_ABSORB", "1") not in ("0", "false", "no"))
    backchannel_resume_settle_secs: float = field(
        default_factory=lambda: float(_env("BACKCHANNEL_RESUME_SETTLE_SECS", "0.6")))
    backchannel_resume_max_chars: int = field(
        default_factory=lambda: int(_env("BACKCHANNEL_RESUME_MAX_CHARS", "600")))
    short_answer_grace_secs: float = field(
        default_factory=lambda: float(_env("SHORT_ANSWER_GRACE_SECS", "0.8")))
    short_answer_max_words: int = field(
        default_factory=lambda: int(_env("SHORT_ANSWER_MAX_WORDS", "3")))
    # A short answer's run waits for the caller's voice to go quiet — but not
    # forever: a noisy line keeps the VAD "on" (call 59888de8: the last answer
    # waited out the hang-up). Past this, the voice is noise; the run goes.
    # 3.0 -> 6.0 (2026-09-26): in production 5 of the 6 releases since 22 Sep
    # were a caller still TALKING ("हाँ जी" then a 4 s answer), not noise — the
    # bot answered the bare "हाँ" (re-asking the name and class) and then the
    # real answer, back to back (calls 23a3ffd9, 8b8533fc).
    short_answer_noise_cap_secs: float = field(
        default_factory=lambda: float(_env("SHORT_ANSWER_NOISE_CAP_SECS", "6.0")))
    # Cushion questions in context instead of firing them bare ("Do you take live
    # classes?") — founder 2026-09-08, "it's asking questions as if she is my
    # mother... humanize the prompt, inculcate this into AI calling in general".
    # Prompt rule, injected for every agent; kill switch keeps the same shape.
    warm_questions_enabled: bool = field(
        default_factory=lambda: _env("WARM_QUESTIONS_ENABLED", "true").lower() == "true")
    # Clients, 2026-09-11: "the tone is very simple, very linear — bot like". The
    # TTS (Smallest lightning_v3.1_pro) exposes no prosody control beyond speed;
    # the only steering it takes is the TEXT. Measured on the live engine, voice
    # mrunal, 3 runs each: plain prose 2.8 st of pitch spread; the same words
    # with an ellipsis before the key phrase, one '!' and a lead-in question
    # 3.2 st (+15%). Prompt rule, every agent; kill switch keeps the same shape.
    prosody_hints_enabled: bool = field(
        default_factory=lambda: _env("PROSODY_HINTS_ENABLED", "true").lower() == "true")
    # Latency lever, 2026-09-12. TTS starts at the first sentence boundary, so the
    # caller waits for however long the model's FIRST sentence is. Measured on the
    # simulator with today's soft rule: median 5 words, p90 11 (about 1 s of
    # generation before audio). This asks for a COMPLETE sentence of at most four
    # words — real substance, never a filler noise — then the detail. Prompt-only:
    # no gate, splitter or TTS change. `false` restores the previous rule text.
    fast_opener_enabled: bool = field(
        default_factory=lambda: _env("FAST_OPENER_ENABLED", "true").lower() == "true")
    # Voice modulation on the AUDIO (app/prosody.py) — the vendor-agnostic fix
    # for the same complaint: pitch excursions around the voice's median are
    # scaled by this factor. 1.0 = off; 1.6 = conversational. The dashboard's
    # per-agent voiceModulation (V504) overrides it; this is the default for
    # agents that have not set one, and the box-wide value ops can force.
    prosody_expand: float = field(
        default_factory=lambda: float(_env("PROSODY_EXPAND", "1.0")))
    # Edge read-aloud default voice. hi-IN-SwaraNeural (F) / hi-IN-MadhurNeural (M)
    # are the only Hindi ones; the en-IN trio is Neerja, NeerjaExpressive, Prabhat.
    edge_tts_voice: str = field(
        default_factory=lambda: _env("EDGE_TTS_VOICE", "hi-IN-SwaraNeural"))
    vertex_thinking_budget: int = field(
        default_factory=lambda: int(_env("VERTEX_THINKING_BUDGET", "0")))
    # Single-flight replies, step 3 (2026-10-01): "is a reply in progress?" also
    # counts a run that passed and is still composing (NoRepeatGate's run ledger)
    # and is measured from the reply's own audio START. 0 = the old test.
    reply_ledger: bool = field(default_factory=lambda: _env("REPLY_LEDGER", "1") == "1")
    # Single-flight step 4: while the caller's turn is still FORMING (words in
    # the user aggregator, not yet pushed) a run waits for it, and an absorb-
    # class "हाँ" joins it instead of firing a cue run of its own. The cap is
    # pipecat's 5 s user-turn stop timeout + 0.5 s.
    run_forming_hold: bool = field(default_factory=lambda: _env("RUN_FORMING_HOLD", "1") == "1")
    # Single-flight step 2: a waterfall primary retires on its first failed
    # request — a request queued behind the failure is dropped, not run beside
    # the fallback's re-run (providers.with_retire).
    llm_retire_primary: bool = field(default_factory=lambda: _env("LLM_RETIRE_PRIMARY", "1") == "1")
    # After a failover, the caller's next turn goes back to the PRIMARY (call
    # a4ce0279, 2026-10-13: one 3 s Vertex stall at 0:21 put the rest of the
    # call on the fallback, which repeated a pitch line verbatim and wrote Hindi
    # in Latin letters). Not before LLM_RETURN_AFTER_SECS — the failover re-run
    # itself must stay on the fallback — and not after LLM_MAX_FAILOVERS stalls
    # in one call: a primary that keeps stalling is left alone.
    llm_return_to_primary: bool = field(default_factory=lambda: _env("LLM_RETURN_TO_PRIMARY", "1") == "1")
    llm_return_after_secs: float = field(default_factory=lambda: float(_env("LLM_RETURN_AFTER_SECS", "5")))
    llm_max_failovers: int = field(default_factory=lambda: int(_env("LLM_MAX_FAILOVERS", "2")))
    # Single-flight step 5: the bot's OWN runs (next-step cues, the noise
    # re-ask, the lost-resume cue) pass one door — RunGuard drops them when a
    # reply is already on its way or the call is ending, holds them while the
    # caller's turn forms; the idle handler does not nudge over a pending reply.
    cue_one_door: bool = field(default_factory=lambda: _env("CUE_ONE_DOOR", "1") == "1")
    forming_hold_cap_secs: float = field(
        default_factory=lambda: float(_env("FORMING_HOLD_CAP_SECS", "5.5")))
    # Single-flight step 6 (2026-10-08): ONE reply per caller turn, however many
    # pieces it arrives in. A caller run supersedes an earlier run whose reply
    # has not put a sound on the line yet (RunGuard cancels it — the LLM's
    # queue too — before the newer run goes through), and a held short answer
    # is never released while the rest of the turn is still forming. Calls
    # 84e52d17, b51093dc, 0ae77e88, e11cc15b: two runs ~0.55 s apart, both
    # replies played back to back. Kill switch: RUN_SUPERSEDE=0.
    run_supersede: bool = field(default_factory=lambda: _env("RUN_SUPERSEDE", "1") == "1")
    reply_inflight_grace_secs: float = field(
        default_factory=lambda: float(_env("REPLY_INFLIGHT_GRACE_SECS", "6.0")))
    # FloorGate: a reply whose first audio is ready while the caller is talking
    # waits for them to stop instead of starting over them (call 358e5026: a
    # parent speaking in pieces got a stub of a reply to every piece). The
    # cap is for lines whose "voice" never stops. Kill switch: FLOOR_HOLD_ENABLED=0.
    floor_hold_enabled: bool = field(
        default_factory=lambda: _env("FLOOR_HOLD_ENABLED", "1") not in ("0", "false", "no"))
    floor_hold_cap_secs: float = field(
        default_factory=lambda: float(_env("FLOOR_HOLD_CAP_SECS", "3.0")))
    interrupt_on_vad: bool = field(
        default_factory=lambda: _env("INTERRUPT_ON_VAD", "true").lower() == "true")
    # WHEN the caller's voice stops the bot.
    #   "voice" — the bot keeps talking through a short sound; it stops when
    #             the words turn out to be a real interruption, or once the
    #             caller has talked for barge_in_voice_secs. "हाँ", "जी",
    #             "हम्म", "Hello" never stop it.
    #   "onset" — the old behaviour: any sound over 0.2 s stops the bot and the
    #             words are judged afterwards (then the cut words are resumed).
    # The 22 Sep paid batch (107 calls): 473 cuts, 54% of them acknowledgements
    # or noise, each followed by a median 0.8 s / p90 3.9 s stall; the opening
    # was cut by the pickup "Hello" in 18 calls. Acknowledgement bursts last
    # p90 0.60 s / p95 0.70 s, so at 0.7 s 95% of those stops disappear.
    # Rollback: BARGE_IN_MODE=onset.
    barge_in_mode: str = field(
        default_factory=lambda: _env("BARGE_IN_MODE", "voice").strip().lower())
    barge_in_voice_secs: float = field(
        default_factory=lambda: float(_env("BARGE_IN_VOICE_SECS", "0.7")))
    # An acknowledgement that began this close to the end of a reply that ended
    # on a question is the caller's ANSWER to it ("हाँ" over "…जुड़ना चाहेंगे?").
    ack_answer_window_secs: float = field(
        default_factory=lambda: float(_env("ACK_ANSWER_WINDOW_SECS", "3.0")))

    duck_enabled: bool = field(
        default_factory=lambda: _env("DUCK_ENABLED", "true").lower() == "true")
    # VAD heard a sound but STT produced no words (cough, horn): resume the held
    # reply this long after the sound ended.
    duck_no_words_resume_secs: float = field(
        default_factory=lambda: float(_env("DUCK_NO_WORDS_RESUME_SECS", "2.0")))
    # Absolute ceiling on one hold — a lost transcript must never mute the bot.
    duck_max_hold_secs: float = field(
        default_factory=lambda: float(_env("DUCK_MAX_HOLD_SECS", "12.0")))
    # Extra absorb-list words (comma-separated) on top of turntake.py's list —
    # per-deployment tuning without a rebuild.
    backchannel_extra: tuple = field(
        default_factory=lambda: tuple(
            w.strip().casefold() for w in _env("BACKCHANNEL_EXTRA", "").split(",")
            if w.strip()))

    # ── Watchdog thresholds ──────────────────────────────────────────────────
    # Every WatchdogConfig field is env-overridable. These ran on dataclass
    # defaults with NO knob, so tuning turn-taking on a service calling real
    # parents required a rebuild + redeploy. Defaults below are byte-identical to
    # the dataclass defaults, so plumbing them changed no behaviour.
    stall_after_secs: float = field(
        default_factory=lambda: float(_env("STALL_AFTER_SECS", "3.5")))
    stall_max_recoveries: int = field(
        default_factory=lambda: int(_env("STALL_MAX_RECOVERIES", "3")))
    stop_reissue_every_secs: float = field(
        default_factory=lambda: float(_env("STOP_REISSUE_EVERY_SECS", "3.0")))
    orphan_min_utterance_secs: float = field(
        default_factory=lambda: float(_env("ORPHAN_MIN_UTTERANCE_SECS", "0.4")))
    # 3.5 s: past the p90 of a Smallest final that needed the finalize retry
    # (2.26 s on 2026-09-15), so a late transcript is not mistaken for a lost one.
    orphan_window_lo_secs: float = field(
        default_factory=lambda: float(_env("ORPHAN_WINDOW_LO_SECS", "3.5")))
    orphan_window_hi_secs: float = field(
        default_factory=lambda: float(_env("ORPHAN_WINDOW_HI_SECS", "10.0")))
    orphan_bot_quiet_secs: float = field(
        default_factory=lambda: float(_env("ORPHAN_BOT_QUIET_SECS", "2.0")))
    orphan_connect_grace_secs: float = field(
        default_factory=lambda: float(_env("ORPHAN_CONNECT_GRACE_SECS", "6.0")))
    # Clock-skew guard: Sarvam's server-side final vs pipecat's local Silero
    # onset. 0.0 restores the old (broken) strict comparison — kill-switch only.
    orphan_transcript_lookback_secs: float = field(
        default_factory=lambda: float(_env("ORPHAN_TRANSCRIPT_LOOKBACK_SECS", "1.5")))
    max_nudges: int = field(default_factory=lambda: int(_env("MAX_NUDGES", "2")))
    no_words_timeout_secs: float = field(
        default_factory=lambda: float(_env("NO_WORDS_TIMEOUT_SECS", "30.0")))

    # How long silence must outlast an interrupted reply before we believe the
    # caller truly heard none of it. 95% of interrupted-while-quiet replies play
    # within ~0.2s anyway (pipecat keeps the TTS socket alive in that window).
    unplayed_confirm_secs: float = field(
        default_factory=lambda: float(_env("UNPLAYED_CONFIRM_SECS", "3.0")))

    # After this many consecutive unheard caller utterances, stop apologising and
    # close the call honestly. Live 393859bc: Sarvam STT never transcribed
    # "hybrid model" though the caller said it four times; the bot apologised
    # four times and re-asked the same question three times.
    max_deaf_streak: int = field(default_factory=lambda: int(_env("MAX_DEAF_STREAK", "2")))

    # How long the line stays open after the bot's farewell finishes playing. Any
    # real word from the caller in this window CANCELS the close. Live ee8e2168:
    # the caller answered "Yes, I can" after the goodbye, the bot asked for a
    # date and time, and the stale end-latch dropped the line before they could
    # reply — a demo booking lost to our own hangup.
    end_grace_secs: float = field(
        default_factory=lambda: float(_env("END_GRACE_SECS", "2.0")))

    # Refuse to derive a substantive disposition from a call with no caller turn
    # (voicemail/IVR pickups were booking demos onto real leads). Kill-switch.
    report_require_conversation: bool = field(
        default_factory=lambda: _env("REPORT_REQUIRE_CONVERSATION", "true").lower() == "true")

    # Stricter sibling of the above: refuse a substantive disposition when the caller
    # DID speak but said nothing beyond a greeting or a bare "yes"/"haan". A one-word
    # "Hello." satisfied report_require_conversation, reached the classifier, and came
    # back as a Demo_Booked with an invented name, member count and meeting time
    # (institute 3716991c, 2026-09-09 — 13 such calls got a decisive label).
    # Negations are exempt, so a bare "no" still classifies and still stops the retry.
    # Separate kill-switch: this gate is newer and strictly stricter than the
    # caller-turn test, so it can be reverted without disabling that one.
    report_require_substance: bool = field(
        default_factory=lambda: _env("REPORT_REQUIRE_SUBSTANCE", "true").lower() == "true")

    # Hard per-call ceiling when the agent config doesn't set maxCallMinutes —
    # bounds telephony + STT/LLM/TTS spend on a runaway conversation.
    max_call_minutes_default: float = 10.0

    # Max simultaneous live calls this bot process will run. Each call pins a
    # Silero VAD session + STT/LLM/TTS streams + a watchdog loop; past the box's
    # CPU ceiling ALL calls degrade (garbled audio, late turns) instead of new
    # ones being rejected. Over cap, /answer serves a "busy" hangup (no <Stream>)
    # and /ws closes immediately. Size to the box: ~10 for a 1 vCPU / 2 GB node.
    max_concurrent_calls: int = field(
        default_factory=lambda: int(_env("MAX_CONCURRENT_CALLS", "10"))
    )

    # Where /tts caches synthesized IVR-prompt audio. Backed by a Docker volume so
    # a prompt is synthesized ONCE (ever) and replayed free on every call — IVR
    # prompts are static, so there is no recurring TTS cost.
    tts_cache_dir: str = field(default_factory=lambda: _env("TTS_CACHE_DIR", "/tmp/tts-cache"))

    # IVR-prompt MP3 sample rate. MUST be 44100 (or 48000): at those rates Sarvam
    # emits MPEG-1 layer III, the ONLY MP3 profile Plivo's decoder plays. 8 kHz
    # forces MPEG-2.5, which Plivo renders as SILENCE (verified against Plivo's
    # published spec: "MPEG v1, 128 kbps, 44.1 kHz"). Distinct from sample_rate,
    # which is the 8 kHz telephony rate for the live-call audio stream.
    tts_prompt_sample_rate: int = field(
        default_factory=lambda: int(_env("TTS_PROMPT_SAMPLE_RATE", "44100"))
    )

    # /tts and /preview are PUBLIC endpoints (Plivo has to fetch them) that write
    # synthesized audio to disk — unbounded, an attacker filling the volume kills
    # deploys on this box (observed failure mode: disk-full → silent stale-image
    # deploys). Oldest-mtime .mp3 files are evicted past either bound.
    tts_cache_max_files: int = field(
        default_factory=lambda: int(_env("TTS_CACHE_MAX_FILES", "4000")))
    tts_cache_max_bytes: int = field(
        default_factory=lambda: int(_env("TTS_CACHE_MAX_BYTES", str(500 * 1024 * 1024))))

    # ── TTS speech cache (§ docs/crm/TTS_SPEECH_CACHE.md) ───────────────────
    # Replays previously-synthesized audio for a byte-identical sentence in the
    # same voice, so a scripted line is paid for once instead of once per call.
    # Matching is EXACT on a sha256 of (salt, engine, model, voice, pace,
    # temperature, rate, term-map, text): one differing character is a miss and
    # goes to the vendor. Quality is never traded for cost.
    #
    # KILL switches, not the on switch. What actually enables the cache for an
    # agent is ai_agent.speech_cache_mode (OFF | FIXED | FULL, V466), set in
    # per agent via the agent API or SQL (no UI control yet), reviewable and
    # needing no restart. These
    # default TRUE so a normal rollout never needs an ssh, and exist so ops can
    # stop the feature fleet-wide in one restart without editing anybody's
    # configuration. Two of them because the two paths carry different risk: the
    # fixed lines are standalone utterances, the LLM path has to reason about
    # mid-turn audio ordering and render parity.
    #
    # Nothing happens with these alone: every agent's mode defaults to OFF.
    tts_cache_speech_enabled: bool = field(
        default_factory=lambda: _env("TTS_CACHE_SPEECH_ENABLED", "true").lower() == "true")
    tts_cache_llm_enabled: bool = field(
        default_factory=lambda: _env("TTS_CACHE_LLM_ENABLED", "true").lower() == "true")

    # OPTIONAL extra ops restriction on top of the per-agent mode. Normally left
    # empty: rollout is done by setting an agent's speech_cache_mode in the UI.
    # This exists for the case where ops needs to pin the feature to named agents
    # regardless of what the DB says — e.g. debugging one agent on one box.
    # Empty = no restriction. Accepts ai_agent ids or names, case-insensitive.
    tts_cache_agents: tuple = field(default_factory=lambda: tuple(
        a.strip().lower() for a in _env("TTS_CACHE_AGENTS", "").split(",") if a.strip()))

    # Per-sentence MISS lines. OFF by default: an enabled agent produces one per
    # sentence, ~40 a call, and the bot's log retention is 20MB x 5 files — noise
    # here evicts the evidence for everything else. Turn it on for the rollout
    # window, when "why did THAT sentence not hit" is the whole question.
    tts_cache_debug: bool = field(
        default_factory=lambda: _env("TTS_CACHE_DEBUG", "false").lower() == "true")

    # Bump to invalidate EVERY entry at once (one restart, no deploy). The escape
    # hatch for a poisoned blob: a bad entry would otherwise be served to every
    # future call that matched it, forever.
    tts_cache_salt: str = field(default_factory=lambda: _env("TTS_CACHE_SALT", "v1"))

    # How many times a sentence must be seen — COMPLETE, uninterrupted, confirmed
    # played to the caller, on a call with a healthy verdict — before we spend one
    # off-call render on it.
    #
    # 1, because the arithmetic favours it. Counting vendor payments for a
    # sentence spoken N times: no cache costs N; at 2 it costs 3 (two live plus
    # the render) and is free from the third use; at 1 it costs 2 and is free
    # from the SECOND. So 1 wins whenever a sentence recurs at all, and loses
    # exactly one render for each that never does.
    #
    # Measured on shreya-v3's first day: 54 of 73 sentences sat at one sighting,
    # so 2 was holding back the entire backlog. Rendering all 54 speculatively
    # costs 4,237 chars — about Rs 7 — and happens off-call, where it buys no
    # latency penalty. The hedge was costing more than it saved.
    #
    # Raise it if the ledger ever shows a fat never-recurring tail; that is the
    # signal this trade has flipped.
    tts_cache_min_seen: int = field(
        default_factory=lambda: int(_env("TTS_CACHE_MIN_SEEN", "1")))

    # Own budget, because _evict_tts_cache only sweeps *.mp3 — this namespace
    # would otherwise grow until the volume is full. 8 kHz s16 = 16 KB/s, so
    # 2 GB is roughly 32k sentences. df the box before raising it.
    tts_speech_cache_max_bytes: int = field(
        default_factory=lambda: int(_env("TTS_SPEECH_CACHE_MAX_BYTES", str(2 * 1024 * 1024 * 1024))))

    # A blob shorter than this cannot be a real sentence — it is a silent stub or
    # a truncated render, and must never reach a caller (G5).
    tts_cache_min_blob_ms: int = field(
        default_factory=lambda: int(_env("TTS_CACHE_MIN_BLOB_MS", "200")))

    # Where the speech cache lives. Under the tts-cache dir on purpose: that is
    # the one mounted volume, so entries survive container restarts and CI rolls.
    @property
    def speech_cache_dir(self) -> str:
        return os.path.join(self.tts_cache_dir, "speech")

    # Failed end-of-call reports spool here and a background sweeper retries them.
    # Lives UNDER the tts-cache dir on purpose: that's the one mounted volume, so
    # spooled reports survive container restarts. A lost report strands the paused
    # CALL_AI workflow until its safety timeout and lies to the retry engine.
    @property
    def report_spool_dir(self) -> str:
        return os.path.join(self.tts_cache_dir, "_report_spool")

    def wss_url(self, query: str) -> str:
        base = self.public_base.replace("https://", "wss://").replace("http://", "ws://")
        return f"{base}/ws?{query}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
