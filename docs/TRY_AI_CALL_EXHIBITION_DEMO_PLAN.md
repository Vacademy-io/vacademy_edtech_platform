# Try the AI Call: exhibition demo plan

Status (2026-11-15): code written on `feat/try-ai-call-demo` (backend + bot) and `feat/try-ai-call` in the telleo.ai repo. Not compiled, committed or deployed. The demo agent and setting **are** in the prod database (section 11).
Date: 2026-11-15.

## 1. Goal

At the exhibition we show a QR code. A visitor scans it and lands on a public page on the Telleo website (`telleo.ai/try-ai-call`). There they:

1. type their name, their organisation's name and their mobile number,
2. pick a language (English, Hindi, Hinglish, Malayalam, Kannada, Tamil, Telugu, Marathi, Bengali, Gujarati),
3. tap **Call now**.

Their phone dials our demo number. An AI **admission counsellor** answers in the language they picked and introduces itself as the admission counsellor of *their* organisation ("Namaste Anil ji, Sunrise Public School admissions mein aapka swagat hai..."). The visitor hears exactly what their own parents and students would hear.

If tap-to-call doesn't work on their phone, the page shows the number in large type with a **Copy** button so they can dial it by hand. Calling from the mobile number they typed still gives the personalised call.

## 2. Why it is built this way

These facts from the existing system shape the design:

| Fact | Consequence |
|---|---|
| An inbound call carries only the caller's number. Nothing typed on the website rides along with the call. | We link the website form to the call by **phone number**: the page saves `{phone, name, org, language}` and the inbound call from that phone picks it up. The page therefore has to ask for the mobile number. |
| Inbound AI works only over **Plivo**: number → `inbound_ivr_menu_id` → IVR node of type `AI_AGENT` → voice bot. | We reuse a number that already reaches an AI agent: CRM institute `3f343028` (ex-VOOM Sales), `+918035614126` → menu "Order enquiry" → node `7534dde7` → Vaani `302bec8f`. No new number and no IVR change. |
| An agent's `language` is fixed for the whole call. The engine never switches language mid-call. | The language is chosen **before** the call, per request, and applied when the call starts. |
| The bot calls `GET /internal/voice-bot/call-context` exactly once per call and uses the `agent` map it gets back (language, voice, TTS engine, prompt, opening line). The end-of-call report uses `agent.id` from that same map. | One hook in `callContext` is enough: swap in the demo agent, then set language, voice, opening line, `leadName` and `leadFields` for the request. No change to the bot's routing, the Plivo XML or the IVR. |
| `{{institute_name}}` in a prompt resolves from a lead field named `institute name` / `organisation`. `{{name}}` resolves from `leadName`. | The visitor's org and name personalise the script through placeholders the bot already supports. |
| Edge TTS (free, already proven on inbound with Vaani) picks its language from the voice name (`ta-IN-PallaviNeural`, `ml-IN-SobhanaNeural`, ...). | Choosing a language means choosing an edge voice. There is no new TTS vendor and no per-character cost. |
| The bot's non-English prompt rules were written for Hindi ("write Hindi words in DEVANAGARI", "speak phone Hindi"). | A Tamil call would be told to write Hindi. **Fixed** (section 5.4) for languages with their own script. Hindi, Hinglish, Marathi and English prompts are unchanged byte for byte. |
| The Telleo site is a Next.js static export (Cloudflare Pages) that already posts leads from the browser to `backend-stage.vacademy.io/admin-core-service/open/...`. | CORS from telleo.ai to `/open/**` already works. The page is client-side only. |

## 3. End-to-end flow

```
Visitor phone (browser)                 admin_core                         Plivo / voice bot
-----------------------                 ----------                         -----------------
GET  /open/v1/ai-demo-call/{inst}/config  -> languages, dial number
POST /open/v1/ai-demo-call/{inst}/request -> save PENDING row (phone, name, org, lang, expires +20 min)
     <- {requestId, dialNumber, telUri}
tap "Call now" -> tel:+918035614126
                                                                           Plivo -> /plivo/answer/inbound
                                                                           IVR -> AI_AGENT node -> bot /answer
                                         call-context(corr, agent=Vaani) <- bot
                                         row INBOUND + demo enabled + PENDING request for caller phone
                                         -> bind request (CONNECTED, call_log_id = corr)
                                         -> agent = demo counsellor, language/voice/opening for request
                                         -> leadName = visitor, leadFields = {institute name: org}
                                                                           bot speaks in chosen language
page polls GET .../request/{id}  -> PENDING -> CONNECTED -> ENDED ("Thanks for trying!")
```

A caller with no pending request (a normal Telleo sales enquiry) still gets Vaani exactly as today.

## 4. User experience (Telleo website)

Route: `https://telleo.ai/try-ai-call/`, mobile-first, built in the existing Telleo theme (ink and brand green, Jakarta font).

**Screen 1: Form**
- Header: "Hear your AI admission counsellor, live", with a short line under it: "Tell us your institute's name, pick a language, and call. Our AI will answer as *your* admission counsellor."
- Fields: Your name, Organisation / institute name, Mobile number (+91 prefix, 10 digits).
- Language: a grid of chips with the native-script label plus the English one (தமிழ் Tamil, മലയാളം Malayalam, ಕನ್ನಡ Kannada, हिन्दी Hindi, Hinglish, English, తెలుగు Telugu, मराठी Marathi, বাংলা Bengali, ગુજરાતી Gujarati). Only languages enabled in the backend config are shown.
- Button: **Call now**. It is disabled until the form is valid.
- Small print: "Calls are standard voice calls to a Bengaluru number. Please call from the mobile number above."

**Screen 2: Calling**
- Opens `tel:` right after the request is saved.
- Large display of the number, with **Copy number** and **Call again** buttons. Fallback text: "If your phone didn't start the call, dial this number from {their number}."
- A live status chip from polling: "Waiting for your call..." → "Connected. Listen to your AI counsellor!" → "Call ended. Thanks for trying Telleo."
- After the call ends: "Want this for {org}?" CTA → the existing `/demo` page with the org pre-filled. A **Try another language** button resets to Screen 1 with the fields kept.
- Expiry: after 20 minutes the request lapses and the page asks the visitor to tap again.

**Edge cases shown to the visitor**
- Rate limited: "Too many tries. Please wait a minute."
- Demo switched off (`enabled=false`): "Live demo is paused right now". The form is hidden and the number is still shown.
- Backend unreachable: the number is still shown, with the text "call this number". The demo agent then answers in its default language.

**QR**: generate it for `https://telleo.ai/try-ai-call/?utm_source=exhibition&utm_medium=qr&utm_campaign=<event>`. UTM tags flow into `source` on the request row.

## 5. Backend changes (admin_core_service + voice_bot_service)

### 5.1 Migration `V679__Ai_demo_call_request.sql` (renumber at merge if taken)

```sql
CREATE TABLE IF NOT EXISTS ai_demo_call_request (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    phone         VARCHAR(10)  NOT NULL,   -- last 10 digits, the inbound match key
    phone_raw     VARCHAR(32),
    visitor_name  VARCHAR(120),
    organisation  VARCHAR(160) NOT NULL,
    language      VARCHAR(30)  NOT NULL,   -- _STT_LANGS key: tamil, hinglish, ...
    status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING', -- PENDING | CONNECTED | SUPERSEDED
    call_log_id   VARCHAR(255),
    source        VARCHAR(120),
    client_ip     VARCHAR(64),
    created_at    TIMESTAMP    NOT NULL DEFAULT now(),
    expires_at    TIMESTAMP    NOT NULL,
    connected_at  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_demo_req_match
    ON ai_demo_call_request (institute_id, phone, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_demo_req_call_log
    ON ai_demo_call_request (call_log_id);
```

The table doubles as the exhibition lead list (name, org, phone, language, time).

### 5.2 Config: `AI_DEMO_CALL_SETTING` in the demo institute's `setting_json`

```json
{
  "enabled": true,
  "agentId": "<admission counsellor agent id>",
  "dialNumber": "+918035614126",
  "displayNumber": "+91 80356 14126",
  "ttlMinutes": 20,
  "languages": [
    {"code": "english",   "label": "English",   "nativeLabel": "English",  "voice": "en-IN-NeerjaNeural",  "ttsModel": "edge", "openingLine": "..."},
    {"code": "hinglish",  "label": "Hinglish",  "nativeLabel": "Hinglish", "voice": "hi-IN-SwaraNeural",   "ttsModel": "edge", "openingLine": "..."},
    {"code": "tamil",     "label": "Tamil",     "nativeLabel": "தமிழ்",     "voice": "ta-IN-PallaviNeural", "ttsModel": "edge", "openingLine": "..."}
  ]
}
```

- `languages` is optional. If it is absent, a built-in table is used, covering English, Hinglish, Hindi, Malayalam, Kannada, Tamil, Telugu, Marathi, Bengali and Gujarati, each with an edge female voice and an opening line in that language. The agent is "Vaani", a female persona, so every voice is female and the Hindi verb gender stays consistent.
- Each built-in opening line uses `{{name}}` and `{{institute_name}}`. Native speakers on the team should review them before the event.
- `enabled=false` turns the hook off at once. The page then shows "paused", and callers get the normal agent.

### 5.3 Public API: `/admin-core-service/open/v1/ai-demo-call/{instituteId}` (already `permitAll` under `/open/**`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/config` | `{enabled, dialNumber, displayNumber, languages:[{code,label,nativeLabel}]}`. Voices and prompts are not exposed. |
| POST | `/request` | Body `{name, organisation, phone, language, source?}`. Validates (org 2–120 chars, Indian mobile, language in config) and rate-limits. Marks older PENDING rows for the same phone as SUPERSEDED, inserts a new PENDING row and returns `{requestId, dialNumber, displayNumber, telUri, expiresAt}`. |
| GET | `/request/{requestId}` | `{status: PENDING, CONNECTED, ENDED or EXPIRED}`. ENDED comes from the bound call log's end status. It returns no personal data, and the id is an unguessable UUID. |

**Rate limits** (in memory, per pod): per phone, 5 requests per 10 minutes; per IP, 30 per minute and 300 per hour. The IP limit is deliberately loose because exhibition Wi-Fi and mobile carrier NAT put many visitors behind one IP. Per institute, a 2,000-per-hour safety ceiling.

### 5.4 Voice bot: own-script languages (done, tested)

`voice_bot_service/app/bot.py`: for languages written in their own script (Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Odia), the script rule now reads "Write every reply in {Language}, in the {Language} script; English words in English letters; never Latin-letter {Language}, never Devanagari". The "phone Hindi" register rule becomes "everyday spoken {Language}". The Rumik and speech-cache add-ons, which are about Devanagari, are skipped for these languages.

Marathi is deliberately left out: it is Devanagari, and its live agents keep their exact prompt.

Tests: `tests/test_own_script_language.py` (10 pass). The existing prompt suites fail the same 28 tests before and after the change, all from Windows `strftime("%-d")`, which works on Linux.

### 5.5 The hook in `VoiceBotInternalController.callContext`

At the start of `callContext`, when `row.direction == INBOUND`:

1. Read `AI_DEMO_CALL_SETTING`. If it is missing or disabled, do nothing; the call behaves exactly as today.
2. Find the request: first by `call_log_id = corr` (idempotent if the bot re-fetches), else the newest PENDING row with `phone = last10(row.fromNumber)`, `institute_id = row.instituteId` and `expires_at > now()`. Bind it with an UPDATE guarded on `status='PENDING'`.
3. If found:
   - `agentId` = the setting's `agentId`, falling back to the node's agent.
   - After the agent map is built, override `language`, `voice`, `tts_model` and `openingLine` from that language's entry.
   - `leadName` = the visitor's name. `leadGender` = `NameGender.of(name)`.
   - `leadFields` = `{"organisation": org, "institute name": org}`.
   - Strip send and booking keys, as test calls do: there is no CRM lead to message.
4. Any exception is logged and skipped. A demo bug must never break a real inbound call.

### 5.6 New Java files

- `features/telephony/demo/AiDemoCallRequest.java` (entity) and `AiDemoCallRequestRepository.java`
- `features/telephony/demo/AiDemoCallSettings.java` (POJO and built-in language table)
- `features/telephony/demo/AiDemoCallService.java` (config, create request, status, bind for inbound)
- `features/telephony/demo/AiDemoCallRateLimiter.java`
- `features/telephony/demo/OpenAiDemoCallController.java`
- `SettingKeyEnums.AI_DEMO_CALL_SETTING`
- Unit tests for phone normalisation, language validation, supersede-and-bind, the rate limiter and the `callContext` override.

## 6. The demo agent (admission counsellor)

A new `ai_agent` on CRM `3f343028`:

- Name: "Try AI call - Admission counsellor". Direction BOTH. Default language `hinglish`. Engine `edge`, voice `hi-IN-SwaraNeural`.
- `max_call_minutes` = 4, to cap credit spend per visitor.
- Persona: **Vaani, admission counsellor at {{institute_name}}**.
- Script outline. Each turn is two sentences or fewer and under 240 characters; that is the engine's reply cap.
  1. Greet the caller by name, as {{institute_name}}'s admission desk. Offer: "Shall I take you through it as if you were a parent or student enquiring?"
  2. Ask which class or course they are interested in, for whom, and the current class or score.
  3. Ask about city or location, preferred mode (campus or online), and when they want to start.
  4. Answer questions about fees, scholarships, hostel and transport using **clearly sample details** ("for this demo, a typical range would be...").
  5. Offer a campus visit or counselling session and confirm a day and time. This is the "wow" moment.
  6. Close: "This is how Telleo's AI counsellor would handle every enquiry for {{institute_name}}, in any language, 24x7. Our team at the stall can set it up for you."
- Guardrails: never claim real fees or seats for the named organisation. Stay polite and short. If asked whether it is a real person, say it is Telleo's AI counsellor.
- Dispositions: `Interested`, `Callback`, `Not_Interested`. Extraction: course of interest, class, city, visit slot agreed.
- Registered in `AI_CALLING_SETTING.campaigns` (the bridge step), and set as `AI_DEMO_CALL_SETTING.agentId`.

The prompt is authored in English with Hinglish examples. The bot's language rule (section 5.4) then makes the model speak the chosen language.

## 7. Website changes (`telleo.ai` repo, branch `feat/try-ai-call`)

- `src/app/try-ai-call/page.tsx`: metadata with `robots: noindex`, since it is an event page. It renders `<TryAiCall/>`.
- `src/components/TryAiCall.tsx`: client component (form, language chips, call screen, polling, copy button, `tel:` link). Handles missing clipboard API (iOS http fallback) by selecting the text.
- `src/lib/aiDemoCall.ts`: API client, sharing `backend-stage.vacademy.io` with `leadSubmit.ts`. The institute id is a constant.
- Not added to the nav or sitemap. It is reached by QR only.

## 8. Operational checklist before the event

Each item needs DB read access (tunnel) and an OK for writes:

1. **Inbound health:** confirm Plivo inbound still lands on `+918035614126` (recent `telephony_call_log` INBOUND rows for CRM). Plivo inbound stopped once before (2026-09-30).
2. **IVR node bridge prompt:** if node `7534dde7` has `prompt_text`, a Hindi line plays before every call, even Tamil ones. Clear it, or accept it.
3. **Credits:** CRM `institute_credits.current_balance`. Inbound AI is about 5–6 credits a minute, so 200 visitors × 3 minutes ≈ 3,600 credits. Top up with the ledger method (delta, not a flat target).
4. **Concurrency:** voice-bot `max_concurrent_calls` per pod × replicas, and Plivo channel limits on the DID. Callers over capacity hear "all lines busy". Scale voice-bot for the event day.
5. **Number collision:** `+918035614126` must be enabled on CRM only. Check that `findEnabledByPhoneNumber` returns one row.
6. **Create agent and setting:** run the script, which defaults to a dry run, then `--apply` once approved. Read the result back to confirm the other setting keys survived.
7. **Native review** of the 10 opening lines, then a test call in each language from a staff phone.
8. Print the QR code and test it on both an Android phone and an iPhone.

## 9. Rollback

- Instant: set `AI_DEMO_CALL_SETTING.enabled=false`. Callers then get Vaani as before.
- Code: the hook is a no-op without the setting. The bot change only affects own-script languages, and no live agent uses one yet (to be confirmed in DB step 1).
- Data: `ai_demo_call_request` is additive and can be left in place.

## 10. Not in scope (possible follow-ups)

- Pushing each request into the Telleo CRM audience as a lead (one call to the existing lead-submit endpoint).
- An outbound "we call you" fallback, for phones that withhold caller ID.
- Playing the call recording back on the page afterwards.

## 11. Build log (2026-11-15)

**Decisions made while building**
- Voices: **Navana (Bodhi)**, not Edge. Every Navana voice speaks all ten languages, and Vaani on this line already runs on Navana/ipsita. Each language gets a regional female voice: ipsita (English, Hinglish, Hindi), kayal (Tamil), ammu (Malayalam), netra (Kannada), vanaja (Telugu), mukta (Marathi), jayita (Bengali), falguni (Gujarati). Any entry can be switched to Edge in `AI_DEMO_CALL_SETTING.languages` without a deploy.
- Inbound: **keep `+918035614126` on Vaani and swap per caller** (confirmed by the product owner). Callers who did not fill the page still reach Telleo sales.
- The page opens the dialer automatically after saving. It also keeps a large Call button, because some browsers block automatic `tel:` navigation.

**Database checks (read-only)**
- Inbound AI is live: calls on 11-13 and 11-14 were answered and reported.
- IVR node `7534dde7` has no bridge prompt, so no Hindi line plays before the agent.
- CRM credits: 9,676.50, so no top-up is needed.
- The number is enabled only on CRM. A second row on `7438ea0b` is disabled.
- The only other own-script agent is "Anita" (Gujarati, Telleo.ai, one test call). The bot change gives it the correct Gujarati script rule.

**Database writes (applied)**
- `ai_agent` **`cb35411c-0ae6-4c46-a86c-f4c6c9167c99`** "Try AI call - Admission counsellor" on CRM: BOTH, hinglish, navana/ipsita, 4 minutes, prompt in `C:/tmp/try_ai_call/counsellor_prompt.md`.
- Registered in CRM's `AI_CALLING_SETTING.campaigns`. `AI_DEMO_CALL_SETTING` written with `enabled=true`, agent id `cb35411c`, dial number `+918035614126`, TTL 20 minutes.
- Script: `C:/tmp/try_ai_call/create_demo_agent.py`. It dry-runs by default and is guarded on `setting_json`.
- Both writes are inert until the backend is deployed: no code reads the key yet, and no IVR points at the agent.
- Revert: delete the agent row, then remove its campaigns entry and the `AI_DEMO_CALL_SETTING` key.

**Files**
- Backend: `V679__Ai_demo_call_request.sql` and `features/telephony/demo/*`:
  - `AiDemoCallRequest`, `AiDemoCallRequestRepository`, `AiDemoCallSettings`, `AiDemoCallService`, `AiDemoCallRateLimiter`, `OpenAiDemoCallController`
  - `SettingKeyEnums.AI_DEMO_CALL_SETTING`
  - the hook in `VoiceBotInternalController.callContext`
  - `AiDemoCallServiceTest`
- Bot: `app/bot.py` (own-script rules) and `tests/test_own_script_language.py`.
- Site: `src/app/try-ai-call/page.tsx`, `src/components/TryAiCall.tsx`, `src/lib/aiDemoCall.ts`.

**Remaining**
1. Compile admin_core and run `AiDemoCallServiceTest`. Typecheck and build the site.
2. Review, then open PRs and deploy admin_core, voice_bot and the site.
3. Make one test call per language from a staff phone, and get native-speaker review of the opening lines.
4. Scale voice-bot for the event, then print the QR code.

