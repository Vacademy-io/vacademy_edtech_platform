# Lead Agent — plan

Status: **plan, nothing built** (2026-10-25). Starting point: Himang's lead engine
(`himangkalal/vacademy-lead-engine`, reviewed 2026-10-25), which becomes part of the platform.

The Lead Agent is a long-running agent attached to a lead list. It reads a saved brief (what we sell, who buys it,
where), finds organisations on the open web, reads their websites, works out which ones are worth selling to, and
puts the good ones into the lead list every day. From there the list's existing automations (WhatsApp, AI call,
email, counsellor assignment) take over unchanged. Vacademy uses it first for its own sales; institutes on the
platform get it next.

The hard part is not finding organisations, it is **lead quality**: a lead that enters the list is called and
messaged automatically, so a bad lead costs a call, a WhatsApp number's reputation and the client's trust.

## 1. Decisions taken (2026-10-25)

| Question | Decision |
|---|---|
| Where it runs | The **platform is the brain** (briefs, AI, scoring, credits, delivery). Workers only search and fetch pages, and can run anywhere. |
| Code home | **Everything in `vacademy_platform`.** Himang's research code is ported into `ai_service`; his Supabase project, web app and Excel export are retired. |
| Local mode | A **Chrome extension** that uses the client's own browser to search and read websites (cheaper). |
| Remote mode | Our servers read the websites too (charged at a higher rate). Search runs through a search API (Serper / OpenRouter web plugin) from our servers **in both modes** — never by scraping result pages in a browser. |
| Ships first | **The Chrome extension.** |
| Lead type | **B2B only** (organisations and their decision makers). Keep the data model open for B2C later. |
| Entry to the list | **Score threshold + review queue.** High scores go straight in, the middle band waits for one click, the rest are kept but not delivered. |
| Pacing | **Daily quota per brief** (e.g. 25 leads a day), within a monthly credit cap. |
| Billing | **Credits per lead delivered** into the list. Local is cheaper than remote; rejected leads are free. |
| Learning signal | **Demo/meeting booked, call connected + interested, replied** on WhatsApp/email. |
| First touch | **Each list chooses**, safe default: email + AI call. WhatsApp only after a warning and from a separate number. |
| Paid data | **Yes, opt-in add-on** (verified emails, LinkedIn people), mainly for GCC / AU / UK, charged extra. |
| First markets | **Indian coaching / test-prep** and **international (GCC, AU, UK)**. |

## 2. How it works

```
 Admin dashboard                      ai_service (the brain)                         Workers (fetch only)
 ---------------                      ----------------------                         --------------------
 Lead Agent on a lead list  ───────▶  planner: brief → search plan
 (brief, quota, mode, gate)           task queue: "search X", "fetch URL Y"  ◀─────▶  Chrome extension (local)
                                      fingerprint (no AI) → extract (AI)             or server fetcher (remote:
                                      → verify quotes → rate contacts                    Serper + safe_fetch +
                                      → score → gate                                     Playwright pool)
 Review queue  ◀───── middle band ─── gate
                                      │ auto band / approved
                                      ▼
 admin_core: lead list  ◀──────────── delivery (internal bulk intake)
 → existing automations (WhatsApp, AI call, email, counsellor)
 → outcomes (demo, connected, replied, wrong number…) ──────▶ learning loop → scoring weights
```

Principles:

1. **Workers are dumb.** A worker only runs "search this" and "fetch this URL" tasks and returns raw results.
   The AI, the scoring rules, the API keys and the billing never leave our servers. Both modes therefore produce
   the same quality; the mode only changes who fetches and what it costs.
2. **Cheapest filter first.** Dedup and suppression, then the free website checks (platform fingerprint, size,
   dead site, no contact), then the AI, then paid enrichment **only** for leads that already pass the gate.
3. **Every claim has a source.** Kept from Himang's engine: a signal or contact counts only if its quote is on the
   page it cites, and every contact keeps the URL it was found on.
4. **Nothing reaches an automation without passing the gate**, and the gate is measured against real outcomes.

## 3. Components

### 3.1 Lead Agent (configuration, admin dashboard)

One agent per lead list (a list may have none). It stores:

- **Brief:** products, a short description of the product, the ideal customer (industries, size, must-haves,
  deal-breakers), buyer roles, hiring roles and need phrases (the engine's product analysis fills these).
- **Markets:** up to 5 locations; organisation kinds to leave out.
- **Pacing:** daily quota of delivered leads, delivery window (business hours in the list's time zone, so calls
  and messages go out in working hours, not at 3 a.m.), monthly credit cap, end date.
- **Mode:** local (extension), remote (Serper), or auto (local when an extension is online, else remote, if the
  institute allows remote spend).
- **Gate:** auto-deliver score, review score, minimum contact quality (e.g. no "general"-only leads), whether at
  least one buying signal is required.
- **First touch:** which channels the list's automations may use for these leads (see §7).

### 3.2 Control plane (`ai_service/app/lead_agent/`)

- **Scheduler loop:** one replica runs the agent tick (`pg_try_advisory_xact_lock`, as in
  `copy_check/billing_reconciliation.py`). Each tick, for each active agent: is today's quota met, is the credit
  cap reached, is it inside the delivery window; if work is due, plan more tasks.
- **Task queue:** a `lead_fetch_task` table claimed with `FOR UPDATE SKIP LOCKED`, with leases, an attempts
  counter and back-off. Template: `services/call_intelligence_poller.py`. A task that keeps failing stops after
  N attempts (the engine has no such limit today).
- **Research pipeline:** ported from the engine (§8): discovery filters, page reading rules, AI extraction with
  quote verification, contact extraction and rating, decision-maker lookup.
- **Scoring + gate** (§5, §6).
- **Delivery** to admin_core (§6.2).
- **LLM:** through `llm_router` / `model_selection` with a use case `lead_agent_extract`, GLM Flash first
  (as in the engine) with a fallback chain, structured output via `llm_json.generate_json`.

### 3.3 Chrome extension (local mode, ships first)

- **Login:** the staff member signs in through the dashboard; the extension holds the auth_service JWT +
  `clientId` and calls ai_service with `get_pinned_principal`. A per-institute "extension token" (like
  `X-Institute-Key`) can come later for always-on office machines.
- **Long-running in Manifest V3:** the background service worker is stopped when idle, so the extension keeps
  working with `chrome.alarms` (pull tasks every minute) plus an offscreen document for longer fetches. It only
  works while Chrome is open; the daily quota tolerates that (it catches up when the browser is back).
- **Fetching:** `fetch()` with host permissions for plain pages; a background tab with a content script for
  JavaScript-built sites (many coaching sites are Next.js/React). Same politeness as the engine: robots.txt,
  one request per site at a time, delays, block-page detection, a hard cap per hour.
- **No searching in the browser.** Search always goes through a search API from our servers (§3.4), in both
  modes. Scraping Google, Bing or DuckDuckGo result pages is against their terms and gets throttled (Himang's
  engine has a Bing-in-browser fallback that stops at the first captcha; its default is a paid search API).
  Search is cheap (about $0.001 a query); local mode saves on **reading the organisations' websites**, which is
  most of the traffic and time and runs from the client's own connection.
- **What the user sees:** a small panel with status (running / paused / offline), today's progress, and pause.
  Nothing is hidden from the person whose browser it is.
- **Store review:** asking to read any website ("<all_urls>") gets strict Chrome Web Store review. Ship
  **unlisted** to our team first, request site access at runtime, and write the permission justification
  before submitting.
- **Trust:** the extension's results are raw page text. The server re-checks everything it can (quotes against
  the returned text, phone formats, MX records). An extension can only hurt its own institute's leads.

### 3.4 Server fetcher (remote mode)

- **Search (used by both modes):** a search API behind one interface: Serper (Google web and maps) and
  OpenRouter's web plugin (Parallel / Exa, about $1 per 1,000, the engine's default). A Serper client already
  exists (`ai-video-gen-main/serper_service.py`, `config.serper_api_keys`); move it to a shared service. Search
  results are cached for 7 days (as in the engine). Compare the two on result quality for coaching
  institutes in Phase 0.
- **Pages:** `safe_http.safe_fetch` (SSRF-safe) first; a small **Playwright pool in its own deployment** for
  JavaScript sites. Not inside the ai_service web pods: browsers are memory-heavy and those pods also serve chat
  and voice traffic.
- **Maps:** a Google Maps lane (Serper `/maps`), which the engine lacks. Indian coaching institutes' listings often
  carry the owner's mobile, and the review count is a size signal.

Even though the extension ships first, the server fetcher speaks the same task protocol and is small; build a
minimal internal one in Phase 1 for automated tests and for running Vacademy's own agent when no browser is open.

## 4. Data model (Flyway in admin_core, next free number at the time; ai_service owns the tables)

| Table | What | Notes |
|---|---|---|
| `lead_agent` | One agent per lead list: brief, markets, quota, window, mode, gate, first-touch policy, status | `institute_id`, `audience_id` |
| `lead_org` | An organisation found on the public web: domain (unique), name, country, city, platform fingerprint, size signals, last read | **Shared across institutes** (public data only), so an organisation read for one client is not re-read for the next (§9) |
| `lead_org_page` | Cached page text used as evidence | `expires_at` 30 days and a **deletion job that actually runs** (missing in the engine) |
| `lead_person` | Named people: name, role, quote, source URL | Public business roles only |
| `lead_contact` | Phone / email / WhatsApp / form: value, quality tier + reason, person, source URL, found by, MX result | |
| `lead_fetch_task` | Queue: type, payload, mode, status, lease owner/until, attempts, result | |
| `lead_candidate` | An organisation **for one agent**: score parts, decision (auto / review / rejected) and reasons, reviewer, delivered `audience_response_id`, credits charged | unique `(agent_id, org_id)` |
| `lead_outcome` | What happened after delivery: demo booked, connected + interested, replied, not interested, wrong number, bounced, opted out | Fed from CRM events (§5.3) |
| `lead_suppression` | Per institute: domains / phones / emails never to deliver (customers, competitors, opted out, manual) | Checked before any research is spent |

The tenant-specific data (scores, decisions, outcomes, suppression) is always per institute; only public
facts about organisations are shared.

## 5. Lead quality

### 5.1 The score has four parts

| Part | What it measures | Examples |
|---|---|---|
| **Fit** | Matches the brief | Right kind of organisation, location, offers online courses, test series |
| **Intent** | Is acting now | Hiring telecallers/counsellors, asking for software, new centre, admissions just opened (with a date) |
| **Reach** | Can we reach a decision maker | Contact tier: direct > likely (desk mobile + name to ask for) > general > none |
| **Risk** | Reasons not to sell | Already on a competitor platform, too large to switch, a single tutor, dead or parked site, already our lead or customer, outside the market |

v1 is fixed rules, as in the engine, but rewritten with sales:

- **Negative points exist** (the engine has none). Example: Appx/Classplus/Teachmint customer → different pitch
  ("switch") and lower auto-deliver priority; 6M YouTube subscribers → enterprise, not self-serve.
- **Platform fingerprint without the AI:** script sources, subdomains and HTML markers for Appx, Classplus,
  Teachmint, Graphy, Edmingle, Spayee, LeadSquared, Meritto/NPF, ExtraaEdge, Zoho, HubSpot, WATI, Interakt, AiSensy.
  The AI only reads visible text and misses these (WiNNERS runs on Appx; the engine did not see it).
- **"Qualified" needs more than being a coaching institute.** Today admissions open + enquiry form + "call us"
  (on nearly every coaching site) already scores CRM 62, above the bar of 40. v1 requires at least one intent
  signal or a strong fit + reach combination for auto-delivery.
- **Complete Vacademy gets real weights.** Today a typical coaching site scores 12 for it; it is the product we
  sell most.

### 5.2 Contact quality fixes carried over from the review

- A number the website itself labels as a desk line ("admissions team", "call us") or shows on most pages stays
  **likely** even when a search result prints the founder's name next to it; the name becomes "ask for …".
  (Today one Instagram snippet turns it into **direct**: reproduced with WiNNERS.)
- Test case: the WiNNERS pages, which must rate the number `likely`.

### 5.3 Learning from outcomes

- **Labels** (by strength): demo/meeting booked; call connected + interested; replied on WhatsApp/email.
  Negative: not interested, wrong number, number not reachable, email bounced, opted out, reviewer rejected (with a
  reason).
- **Where they come from:** meetings booked on the delivered lead, call outcomes and Call Intelligence results,
  WhatsApp/email replies, lead status changes. Match on `audience_response_id` → `lead_candidate`.
- **Model:** start with the rules; once there are a few hundred labelled leads, fit a simple, explainable model
  (logistic regression over the score features) per market, run it **in shadow** next to the rules for two weeks,
  and switch when it ranks better. Retrain weekly. Per-institute adjustment later, when an institute has enough
  outcomes.
- **Quality report** (per agent, per week): of leads delivered in each score band, how many connected, replied,
  booked a demo; contact-tier precision from a weekly sample audit (a person checks 20 contacts against the source
  page); which sources (search, hiring, maps, keyword) produce demos.

## 6. Gate and delivery

### 6.1 Gate

| Band | Condition | What happens |
|---|---|---|
| Auto | Score ≥ auto bar, contact at or above the list's minimum, not suppressed, not a duplicate | Delivered within the day's quota and window |
| Review | Between the review and auto bars, or any rule flags it (e.g. competitor platform) | Waits in the review queue: approve / reject with a reason (bulk actions). Approved → delivered |
| Rejected | Below the review bar | Kept with reasons, free, used for learning; never delivered |

The quota counts delivered leads, so a day with many rejects keeps searching (within the credit cap) until the
quota is met or the day's research budget is spent.

### 6.2 Delivery to the lead list

- **New internal endpoint in admin_core** (the existing MCP intake uses the user's JWT, which a background agent
  does not have): `POST /admin-core-service/internal/audience/v1/lead-agent/bulk-intake`, authenticated with
  `internal_auth_headers()`. It calls `AudienceService.submitLead` per lead, so the list's automations fire as for any
  other lead.
- **Lead row:** decision maker (or the organisation when no person is named) as the person; best contact as
  mobile/email; `source_type = LEAD_AGENT`, `source_id = domain`; organisation, website, city, role, other
  contacts with their quality, opening question and score as custom fields (created on the list when the agent is
  set up, so values are never orphaned); evidence as a timeline note.
- **Dedup before delivery:** institute-wide by phone (last 10 digits), email and domain, plus `lead_suppression`;
  re-deliveries are impossible because `lead_candidate` is unique per agent and organisation. Do not rely on the
  list's own dedup setting, which is off by default.
- **Workflows can tell these leads apart:** expose `source_type = LEAD_AGENT` to workflow conditions so a list can
  use a cold-outreach branch (§7).

## 7. First touch and compliance

These leads did not ask to hear from us, and their numbers come from public pages.

- **Default first touch: email + AI call.** WhatsApp is off for Lead Agent leads until the list owner turns it on
  after a warning: Meta can lower the rating of or block a number that messages people who did not opt in. Use a
  **separate WhatsApp number** for cold outreach, never the institute's main number.
- **AI calls:** follow TRAI commercial-call rules (registered caller IDs / headers, calling hours, DND scrubbing
  where it applies) — confirm with the telephony provider before enabling it for clients.
- **Opt-outs feed suppression:** "stop", "not interested", unsubscribe and do-not-call outcomes add the phone /
  email / domain to `lead_suppression` for that institute.
- **Every email** carries an unsubscribe link and who we are; every delivered lead keeps the source URL of its
  contacts (provenance).
- **Markets:** India (DPDP Act 2023), UK (UK GDPR + PECR), Australia (Spam Act), UAE (PDPL) treat business
  contact data and cold outreach differently. Get a short legal note per market before opening it to clients.
- **B2B only.** Individual consumers (B2C) would be a separate product with consent requirements; the data
  model leaves room for it.

## 8. Porting Himang's engine

Bring (with its tests): `research/contacts.py`, `research/contact_search.py`, `research/evidence.py`,
`research/extract.py` + prompts, `research/lead.py` (stages, ranking), `research/social.py`,
`discovery/` (organisation filters, domain rules), `research/fetch.py` page rules, `jobs/planning.py` (search plan
and cost estimate), the product-analysis prompt. Rewrite `research/catalogue.py` with sales (§5.1).

Drop: Supabase RPCs, RLS and Realtime, the Next.js web app, Excel/CSV export, the Windows keystore and
Edge-specific browser code, the laptop worker CLI.

Fix while porting (from the 2026-10-25 review): desk numbers upgraded to "direct" (§5.2); no retry limit on
jobs; budget holds never released after a crash; actual costs can overshoot caps; `start_research` accepted a
request without industries; 30-day retention not implemented; re-research changed lead ids (use the domain as
the key everywhere).

Ask Himang to pair on the port: he knows why each rule exists.

## 9. Cost

- **Billing:** `credit_pricing` rows `lead_agent_local`, `lead_agent_remote`, `lead_agent_paid_enrichment`
  (per delivered lead), charged with `idempotency_key = lead_agent:{candidate_id}` so a lead is never charged twice.
  Before a day's run, `check_credits` against quota × rate; stop the agent for the day if credits run out.
- **Our cost per lead is tracked** per candidate (AI tokens, Serper calls, paid enrichment), so the margin per
  mode is visible.
- **Levers:**
  - Shared `lead_org` cache: an organisation read in the last N days is not re-read; a second client targeting it
    costs us almost nothing (we still charge the delivered-lead price).
  - Free checks before the AI (fingerprint, dead site, no contact, suppression) drop most rejects cheaply.
  - Read at most 4 pages per site; GLM Flash for extraction; cached searches.
  - Paid enrichment only for leads that already pass the gate.
- **Engine baseline:** about $0.002–0.003 of AI per researched organisation with GLM Flash (engine figures);
  remote adds Serper per search. Set prices once Phase 1 measures cost per *delivered* lead (rejects included).

## 10. Robustness

- Task claims with `SKIP LOCKED`, leases and an attempts cap; the scheduler on one replica via advisory lock.
- Idempotent delivery and billing (unique candidate, idempotency key).
- Hard caps per agent (day, month) and a **kill switch** per institute and platform-wide (platform setting).
- Alerts when OpenRouter or Serper credit runs out, when an agent delivers nothing for a day, or when the
  reject rate jumps (a sign that search or a site layout changed).
- Playwright in its own deployment; ai_service pods stay light.
- The retention job deletes expired page text; a nightly check reports anything older than allowed.

## 11. Phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Foundation** | Port the research core with fixes and tests into `ai_service/app/lead_agent/`; tables; internal bulk-intake endpoint; credit pricing rows; Lead Agent settings on a list | Engine's tests pass in ai_service; WiNNERS case rates `likely`; a manual run delivers to a test list |
| **1. Local mode for Vacademy** | Chrome extension (unlisted), task queue, extraction and scoring on the server, review queue, daily delivery to Vacademy's lead list; minimal internal server fetcher for tests; India coaching only | Two weeks of daily delivery; weekly audit ≥ 90% of contact tiers correct; connect / demo rate per score band measured |
| **2. Remote mode + clients** | Serper search + maps, Playwright pool, per-lead billing, extension for clients, 2–3 pilot institutes | Pilots receive leads daily within budget; margin per lead known |
| **3. Learning and reach** | Outcome feedback, quality report, learned scoring in shadow then live, shared organisation cache, GCC / AU / UK, paid enrichment add-on | Learned score beats the rules on demo rate; international legal notes done |
| **4. Scale** | Chrome Web Store listing, office "always-on" extension token, B2C decision | — |

## 12. Open questions

1. Scoring weights and deal-breakers for Complete Vacademy, CRM, LMS and AI calling — needs a session with sales.
2. Credit price per delivered lead, local vs remote vs paid enrichment.
3. Who works the review queue for Vacademy (sales ops? each counsellor?).
4. A separate WhatsApp number for cold outreach — available?
5. Which paid enrichment provider (Apollo, Lusha, Prospeo…) — pick after a 50-lead trial on GCC / UK leads.
6. Himang's time for the port.
