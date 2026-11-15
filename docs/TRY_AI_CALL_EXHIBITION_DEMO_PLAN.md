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
POST /open/v1/audience/lead/submit  -> lead in demo audience (name, Organisation, Language; no phone)
     <- leadId
tap "Call now" -> tel:+918035614126
                                                                           Plivo -> /plivo/answer/inbound
                                                                           IVR -> AI_AGENT node -> bot /answer
                                         call-context(corr, agent=Vaani) <- bot
                                         row INBOUND + oldest unclaimed tryAiCall lead (5 min), claimed atomically
                                         -> attribute call log to the lead
                                         -> agent = audience tryAiCall.agentId, language/voice/opening
                                         -> leadName, leadFields from the lead
                                                                           bot speaks in chosen language
page polls GET /open/v1/ai-demo-call/lead/{leadId}/status -> PENDING -> CONNECTED -> ENDED ("Thanks for trying!")
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
- Window: the form waits 5 minutes for its call, so the page dials straight away.

**Edge cases shown to the visitor**
- Rate limited: "Too many tries. Please wait a minute."
- Demo switched off (`enabled=false`): "Live demo is paused right now". The form is hidden and the number is still shown.
- Backend unreachable: the number is still shown, with the text "call this number". The demo agent then answers in its default language.

**QR**: generate it for `https://telleo.ai/try-ai-call/?utm_source=exhibition&utm_medium=qr&utm_campaign=<event>`. UTM tags flow into `source` on the request row.

## 5. Backend changes (admin_core_service + voice_bot_service)

### 5.1 The demo audience is the only config (no table, no institute setting)

Created directly in the database on CRM `3f343028`:
- **Audience:** `1d7e7d4d-60b8-4865-aff9-4550d43d3ce5`, "Telleo – Try AI call (Exhibition)", ACTIVE.
- **Its `setting_json`:** `{"tryAiCall": {"agentId": "cb35411c-0ae6-4c46-a86c-f4c6c9167c99"}}`. The `tryAiCall` key marks the list as a demo list, and `agentId` is the agent that answers.
- **Fields:** Full Name, Email and Phone Number (CRM's existing fields), plus new Organisation and Language.
- **Off switch:** set the audience status to anything other than ACTIVE.
- **Caution:** editing this campaign's form appearance in the admin UI may rewrite `setting_json`. Check that the `tryAiCall` key survives any edit.

### 5.2 Submitting

The page posts to the existing open endpoint `POST /admin-core-service/open/v1/audience/lead/submit`. It sends the audience id and the field ids, and leaves email empty; the server makes up a placeholder address. Each visitor becomes a normal CRM lead (user, score, counsellor pool).

Accepted limits of the existing endpoint:
- 8 submissions per minute per IP. Visitors on venue Wi-Fi share one IP.
- A second submit from the same phone returns "already submitted", and the first organisation and language stay. The page tells the visitor so.

### 5.3 Language table

`AiDemoCallLanguages` holds 10 languages, each with a Navana voice and an opening line in that language. The lead's Language value can be either the label or the code.

### 5.4 Voice bot: own-script languages (done, tested)

`voice_bot_service/app/bot.py`: for languages written in their own script (Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Odia), the script rule now reads "Write every reply in {Language}, in the {Language} script; English words in English letters; never Latin-letter {Language}, never Devanagari". The "phone Hindi" register rule becomes "everyday spoken {Language}". The Rumik and speech-cache add-ons, which are about Devanagari, are skipped for these languages.

Marathi is deliberately left out: it is Devanagari, and its live agents keep their exact prompt.

Tests: `tests/test_own_script_language.py` (10 pass). The existing prompt suites fail the same 28 tests before and after the change, all from Windows `strftime("%-d")`, which works on Linux.

### 5.5 The hook in `VoiceBotInternalController.callContext`: matching by timing

The form asks for **no phone number**. On an unattributed INBOUND call, `AiDemoCallService.bindInbound` claims the **oldest form from the last 5 minutes that has no call yet**: `AudienceResponseRepository.claimOldestTryAiCallLead`, using `FOR UPDATE SKIP LOCKED`. In the same transaction it:
- attributes the call log to that lead with `attachLeadIfUnattributed`;
- writes the caller's number onto the lead with `fillParentMobileIfBlank`, so the CRM still gets the phone.

If the bot fetches call context again, it finds the lead through the attribution and does not claim a second form.

From the lead:
- the agent is the audience's `tryAiCall.agentId`;
- `language`, `voice`, `tts_model` and `openingLine` come from the lead's Language;
- name and Organisation fill `{{name}}` and `{{institute_name}}`.

A call already attributed to an ordinary lead is not a demo. Any exception skips the demo.

**Known risk (accepted):** if two visitors submit within seconds of each other and dial in the opposite order, each is greeted as the other. Two simultaneous calls can never claim the same form. The page dials automatically, and asks visitors to call within a few minutes.

Status for the page: `GET /admin-core-service/open/v1/ai-demo-call/lead/{leadId}/status` returns PENDING, CONNECTED, ENDED or EXPIRED (5 minutes with no call).

### 5.6 Files

- `features/telephony/demo/`: `AiDemoCallLanguages`, `AiDemoCallService`, `OpenAiDemoCallController`, plus the test.
- `AudienceResponseRepository.findLatestTryAiCallLead`.
- `TelephonyCallLogRepository.findFirstByResponseIdAndDirectionOrderByCreatedAtDesc` and `attachLeadIfUnattributed`.
- The hook in `VoiceBotInternalController.callContext`.
- No migration.

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
- Registered in `AI_CALLING_SETTING.campaigns` (the bridge step), and named as the agent in the demo audience's `setting_json` (`tryAiCall.agentId`).

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

- Instant: set the demo audience's status to anything other than ACTIVE. Callers then get Vaani as before.
- Code: the hook is a no-op without the setting. The bot change only affects own-script languages, and no live agent uses one yet (to be confirmed in DB step 1).
- Data: the demo audience and its leads are ordinary CRM rows and can be left in place.

## 10. Not in scope (possible follow-ups)

- Pushing each request into the Telleo CRM audience as a lead (one call to the existing lead-submit endpoint).
- An outbound "we call you" fallback, for phones that withhold caller ID.
- Playing the call recording back on the page afterwards.

## 11. Build log (2026-11-15)

**Decisions made while building**
- Voices: **Navana (Bodhi)**, not Edge. Every Navana voice speaks all ten languages, and Vaani on this line already runs on Navana/ipsita. Each language gets a regional female voice: ipsita (English, Hinglish, Hindi), kayal (Tamil), ammu (Malayalam), netra (Kannada), vanaja (Telugu), mukta (Marathi), jayita (Bengali), falguni (Gujarati). Voices live in `AiDemoCallLanguages`, so changing one is a code change.
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
- Registered in CRM's `AI_CALLING_SETTING.campaigns`.
- Demo audience `1d7e7d4d` with its Organisation and Language fields: script `C:/tmp/try_ai_call/create_demo_audience.py`.
- `AI_DEMO_CALL_SETTING`: written first, then **removed** when the design moved to the audience.
- Script: `C:/tmp/try_ai_call/create_demo_agent.py`. It dry-runs by default and is guarded on `setting_json`.
- Both writes are inert until the backend is deployed: no code reads the key yet, and no IVR points at the agent.
- Revert: delete the agent row and remove its campaigns entry, then set the demo audience to DELETED.

**Files**
- Backend (superseded by section 5.6; the table and the setting were dropped):
  - `AiDemoCallRequest`, `AiDemoCallRequestRepository`, `AiDemoCallSettings`, `AiDemoCallService`, `AiDemoCallRateLimiter`, `OpenAiDemoCallController`
  - the hook in `VoiceBotInternalController.callContext`
  - `AiDemoCallServiceTest`
- Bot: `app/bot.py` (own-script rules) and `tests/test_own_script_language.py`.
- Site: `src/app/try-ai-call/page.tsx`, `src/components/TryAiCall.tsx`, `src/lib/aiDemoCall.ts`.

**Remaining**
1. Compile admin_core and run `AiDemoCallServiceTest`. Typecheck and build the site.
2. Review, then open PRs and deploy admin_core, voice_bot and the site.
3. Make one test call per language from a staff phone, and get native-speaker review of the opening lines.
4. Scale voice-bot for the event, then print the QR code.

