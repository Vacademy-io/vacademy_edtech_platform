# Live AI Tutor — what it costs us and what we charge

Reviewed 7 September 2026 from production data (credit ledger, `ai_token_usage`,
`tutor_session` telemetry of the last 7 days), the pricing rows in `ai_tool_pricing`
and `ai_models`, and vendor list prices. Figures are rounded; where a vendor price
is a list price rather than an invoice, it says so.

## 1. What a credit is worth

| Pack | Credits | Price | Per credit |
|---|---|---|---|
| Basic | 500 | ₹465 / $5 | ₹0.93 / $0.01 |
| Pro | 2,500 | ₹2,325 / $25 | ₹0.93 / $0.01 |
| Business | 6,100 | ₹5,700 / $61 | ₹0.93 / $0.01 |
| Enterprise | 10,000 | ₹9,300 / $100 | ₹0.93 / $0.01 |

`credit_rate_config`: 100 credits per USD, 50% target margin. **One credit is one US cent
(₹0.93).** Every figure below converts at that rate.

## 2. Rates we pay (actuals where recorded, list prices otherwise)

| Item | Provider / model | We pay | Source |
|---|---|---|---|
| Compile model (default) | `z-ai/glm-5.3-flash` | $0.075 / M input, $0.25 / M output | `ai_models`; **$0.0076 per slide observed** (9 compiles, 3 rounds avg) |
| Compile model (Luna) | `openai/gpt-5.6-luna` | $0.10 / $0.60 per M | $0.0084 per slide observed |
| Compile model (Gemini Flash) | `google/gemini-2.5-flash` | $0.30 / $2.50 per M | $0.024 per slide observed |
| Compile model (Gemini Pro) | `google/gemini-2.5-pro` | $1.25 / $10 per M | **$0.31 per slide observed** |
| Live teaching turn | `z-ai/glm-5.3-flash` (chatbot.text.model) | ~1,300 prompt + 120 completion tokens per learner turn | $0.00013 per turn |
| Board image | `qwen/qwen-image-3` | **$0.04 per image** (`ai_models.image_price_per_unit`) | not recorded on usage rows |
| Uploaded-video transcription | OpenRouter `openai/whisper-large-v3-turbo` | $0.0002 per audio minute ($0.012/h) | `usage.cost` on the transcription row |
| Scanned-PDF OCR | MathPix | ~$0.025 per page (list; confirm on the MathPix invoice) | not recorded |
| Teacher voice (default) | Smallest.ai Lightning v3.1 | ~$0.02 per minute of audio ≈ $0.025 per 1,000 characters (list) | 30,954 chars synthesised this week |
| Teacher voice (fallback) | Sarvam Bulbul v3 | ₹30 per 10,000 characters ≈ $0.036 per 1,000 characters (list) | 8,587 chars this week |
| Teacher voice (free) | Edge TTS | $0 | 2,250 chars this week |
| Learner speech-to-text | Sarvam Saaras v3 | ₹30 per audio hour ≈ $0.36/h (list) | 54 clips this week |

Vendor sources: Sarvam list prices per its 2026 pricing coverage
([productgrowth](https://productgrowth.in/tools/ai-llm/sarvam/), [autointerviewai](https://www.autointerviewai.com/blog/sarvam-ai-bulbul-saaras-indic-voice-models-review-2026)); Smallest.ai
Lightning per-minute / per-10k-character list price ([smallest.ai](https://smallest.ai/text-to-speech), [docs](https://docs.smallest.ai/models/documentation/text-to-speech-lightning/overview)).

## 3. What we charge (`ai_tool_pricing`, editable in the super-admin portal)

| Tool | Charge | In money |
|---|---|---|
| `tutor_compile_slide` | 2 credits per slide (flat; rises to the token cost × model multiplier when that is higher) | $0.02 |
| `tutor_media_image` | 1 credit per generated image | $0.01 |
| `transcription` | 0.5 credits per audio minute, minimum 2 | $0.005 / min |
| `html_document_pdf` (OCR) | 0.5 credits per page | $0.005 / page |
| `tutor_live_minute` | 3 credits per started minute of a voice lesson | $0.03 / min = **$1.80 / hour (₹167)** |
| Quiz slides, YouTube captions, AI-video scripts, PDF text | free apart from the compile | — |

The compile charge is `max(flat, actual token cost in credits × credit_multiplier)`. With
glm-5.3-flash (multiplier 1.0) the flat 2 credits applies; with Gemini Pro (multiplier 2.0)
a $0.31 compile bills about 62 credits, which is why Pro is not the default.

## 4. Scenario A — preparing a course

A realistic 20-slide course: 12 document slides, 3 PDFs (one scanned, 10 pages), 2 uploaded
lectures of 60 minutes, 2 YouTube videos (captions refused from our servers, so the admin
writes a description), 1 quiz. Images on, averaging 2 generated images per document slide
and 1 per PDF/video slide.

| Step | We charge | We pay | Note |
|---|---|---|---|
| Compile 19 slides (quiz free) | 38 credits ($0.38) | $0.15 | glm-5.3-flash, 3 rounds incl. the quality round |
| 30 generated images | 30 credits ($0.30) | **$1.20** | qwen-image-3 at $0.04 |
| Transcribe 120 min of lectures | 60 credits ($0.60) | $0.02 | OpenRouter Whisper |
| OCR 10 scanned pages | 5 credits ($0.05) | $0.25 | MathPix list price |
| Text extraction, captions, scripts | 0 | ~0 | free paths |
| **Total** | **133 credits ($1.33, ₹124)** | **$1.62** | **we lose ~$0.30 on this course** |

The loss comes entirely from images and OCR. Without images the same course charges 103
credits and costs $0.42 (a 59% margin).

By content type, per slide:

| Slide kind | Charge | Cost | Margin |
|---|---|---|---|
| Document / AI video / YouTube-with-captions / PDF with text layer | 2 cr | $0.008 | 60% |
| + each generated image | 1 cr | $0.04 | **−300%** |
| Uploaded video, 60 min | 2 + 30 cr | $0.008 + $0.012 | 94% |
| Scanned PDF, 10 pages | 2 + 5 cr | $0.008 + $0.25 | **−270%** |
| Quiz | 0 | 0 | — |

## 5. Scenario B — one learner, one hour of voice lesson

Observed on production this week (20 voice sessions, 6.8 min average, probe-heavy so the
speech density is low): 186 TTS characters synthesised per lesson minute plus 0.85 cache hits,
0.23 learner turns per minute, 344 prompt + 38 completion tokens per minute. A real learner
talks more, so the table uses a realistic lesson: the teacher speaks ~45% of the time
(~600 characters per minute), the learner answers ~1.5 times per minute (~12 minutes of
speech per hour).

| Component | We pay per hour | Basis |
|---|---|---|
| Teacher voice — Smallest Lightning | **$0.90** | 36,000 chars × $0.025 / 1k; a ~30% sentence-cache hit rate on a course other learners have taken brings it to ~$0.63 |
| Teacher voice — Sarvam Bulbul (fallback) | $1.30 | 36,000 chars × ₹0.003 |
| Teacher voice — Edge | $0 | |
| Learner speech-to-text — Sarvam Saaras | $0.07 | 12 min × ₹0.50 |
| Live turns — glm-5.3-flash | $0.01 | 90 turns × $0.00013 |
| Live turns — Gemini 2.5 Flash (if selected) | $0.06 | 90 turns × $0.0007 |
| Revisit questions, predict turns, session summary | $0.01 | ~8 small calls |
| Compute (pod, transcoding) | ~$0.02 | |
| **Total, Smallest voice (before prepared voice)** | **$1.00–1.10** | |
| **Total, Smallest voice, prepared (§6a)** | **$0.25–0.40** | |
| **Total, Edge voice** | **$0.10** | |

Charged: 180 credits = **$1.80 (₹167) per hour**.

Margin at 3 credits/min: about 40% with Smallest, about 95% with Edge. It is thin with
Smallest whenever a course is spoken densely (a teacher who talks 70% of the time costs
$1.40/h in voice alone) and it goes negative if Sarvam becomes the default voice.

## 6. Findings and recommendations

1. **Images lose money at 1 credit.** Every generated board image costs $0.04 and bills $0.01.
   Set `tutor_media_image` to **5 credits** (the copilot's image tools should match). The
   estimate dialog already shows images as "up to N", so admins see it before compiling.
2. **OCR loses money at 0.5 credit per page** (MathPix ≈ $0.025/page). Set `html_document_pdf`
   and `kb_ingest_page` to **3 credits per page**, or route scanned pages through a cheaper
   OCR before MathPix.
3. **Record provider cost on every usage row.** TTS, STT, image and OCR rows carry no
   `total_price`, so the margin above is computed from list prices. `ai_models` already holds
   the image price; add per-character and per-second rates for the voice vendors so the AI
   usage page shows real cost per institute.
4. **Live minute: keep 3 credits for now, protect the margin.** Two cheap levers: persist the
   TTS sentence cache under the media path (it empties on every deploy; compiled narration
   repeats across learners of the same course, so hit rates of 50%+ are realistic), and keep
   Smallest as the default voice — never Sarvam by default. If voice cost still runs above
   $1.10/h on real usage, raise to 4 credits/min ($2.40/h).
5. **Compile is healthy** at 2 credits with glm-5.3-flash or Luna (60%+ margin). Gemini
   Flash roughly breaks even; Pro is loss-making unless the multiplier rule kicks in, so keep
   it out of the platform default.
6. **Transcription is very healthy** with OpenRouter (0.5 credit/min billed, $0.0002/min paid).
   Do not lower it; it also covers the ffmpeg compute and the two-step long-lecture handling.

## 6a. Decisions taken on 7 September 2026

- `tutor_media_image` → **5 credits**; `html_document_pdf` and `kb_ingest_page` → **3 credits per
  page** (set in the portal; `ai_tool_pricing` rows are the source of truth).
- Every voice, speech-to-text, image, OCR and transcription usage row now carries the vendor's
  cost in `total_price` (`services/provider_rates.py` holds the list rates; update them from
  invoices).
- **Prepared voice.** Institutes pay once; per-learner per-minute voice was the recurring cost
  they dislike. Every spoken line of a compiled slide — narration, recap, questions, hints,
  predict questions and the fixed lines around them — is now synthesised once, right after the
  slide compiles, stored as mp3 in S3 (`tutor_tts_cache`, `services/tutor/voice_cache.py`) and
  played by every lesson. Only the model-written lines of a conversation (verdicts, doubt
  answers) and the greeting with the learner's name are synthesised live. The audio is
  identical — same engine, voice and pace — so there is no quality change.
  - Charged once: `tutor_voice_prepare`, **15 credits per slide per language**. Measured on the
    first prepared slide: 54 English and 49 Hindi segments, about 5,000 characters per language,
    $0.13 of Smallest audio per language (a 40% margin at 15 credits; 8 would have lost money).
    Shown in the estimate dialog as "to prepare the teacher's voice once".
  - Verified on prod (7 Sep): a lesson on the prepared slide played 6 prepared segments at $0 and
    synthesised 5 live ones (the greeting with the learner's name, the reaction to their guess,
    the remediation) for $0.017 — the split the model predicts.
  - Effect on a one-hour lesson (Smallest voice): live synthesis drops from ~36,000 characters
    to roughly 6,000–9,000 (verdicts and doubts), i.e. from ~$0.90 to **$0.15–0.25 per hour**;
    the whole hour costs us **$0.25–0.40** against $1.80 charged. That headroom is what allows
    the live minute to come down to **2 credits ($1.20/hour, ₹111)** while keeping a 65–75%
    margin — the recommended next step once a week of real lessons confirms the hit rate
    (`tutor_session.summary_json.tts_prepared_hits` vs `tts_chars`).
  - A learner's pace choice other than "Medium" and a switched language on a course prepared
    in one language fall back to live synthesis for those lines; the cache fills itself from
    those lessons too, so the second learner at that pace is served from the cache.

## 6b. Live minute and avatar add-on (7 September 2026)

- `tutor_live_minute` → **2 credits** ($1.20 / hour, ₹111), set in the portal.
- Premium teacher avatar (Spatius): `tutor_avatar_minute` **1 credit per lesson minute** while the
  learner shows it; vendor overage ≈ $0.0072 per minute ($0.43 / hour) against $0.60 charged.
  Custom avatar creation is $25 on the vendor's side per teacher (not yet passed on; decide whether
  to charge a one-time `tutor_avatar_create`).

## 6c. Custom teacher assets: one-time fees (7 September 2026)

Institutes may register their own teacher **voice** (Smallest.ai instant clone) and their own
animated **avatar** (Spatius, built from the teacher's photo). Both are charged **once**, on top of
the per-minute rates, and both are private to the institute that paid for them
(`tutor_asset_registry`; platform stock rows have no institute and are offered to everyone).

| Tool key | Charged when | Default | Vendor cost |
|---|---|---|---|
| `tutor_voice_clone` | the clone is created (`POST /tutor/v1/voice/clone`) | 200 credits | included in the Smallest plan |
| `tutor_avatar_create` | the avatar request is fulfilled (ready) — automatically when Spatius' API is enabled, otherwise when a super admin pastes the Studio-built avatar id | 1000 credits | Spatius plan allowance (Starter 2/month … Scale 40/month) |

Both rates are editable under AI Settings → pricing. The runtime refuses a saved avatar that is not
in the registry and a voice registered to another institute, so a pasted id from someone else's
settings no longer works.

## 7. Ledger snapshot (last 7 days, all institutes)

Credits deducted: conversation (tutor and chatbot) 14.1, content (compiles and copilot
slides) 21.2, images 17, transcription and OCR small. The tutor itself is still at test
volume; the numbers in §4–§5 are per-unit projections, not observed totals.
