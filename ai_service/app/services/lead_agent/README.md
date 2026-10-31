# Lead Agent (ai_service)

Contract: `docs/crm/LEAD_AGENT_BUILD_SPEC.md` (why: `LEAD_AGENT_PLAN.md`). Tables are owned by
admin_core Flyway `V612__lead_agent.sql`; this package only reads and writes them (raw SQL, `store.py`).

## What runs where

| Piece | File | Runs |
|---|---|---|
| Admin + extension API | `app/routers/lead_agent.py` (`/ai-service/lead-agent/v1`) | every pod |
| Agent tick (plan, discover, deliver) | `scheduler._tick_loop` | every pod; agents leased one at a time (`tick_owner` / `tick_until`, SKIP LOCKED, renewed between steps), so an agent is never ticked twice at once |
| Research pool | `scheduler._research_loop` -> `research.py` | every pod, `lead_agent.max_concurrency` at once (READY claimed with SKIP LOCKED, 15-min lease, 3 attempts -> FAILED) |
| Server page fetcher | `scheduler._fetch_loop` -> `fetcher.py` | every pod; REMOTE tasks + AUTO tasks no extension took within 5 min; one task per site at a time |
| Chrome extension | `lead-agent-extension/` (repo root) | the institute's browser: LOCAL + AUTO tasks via `/ext/*` |
| Engine (pure research rules) | `engine/` | called through `engine_api.py` only |

What is sold comes from the brief's `offer` (any business: signals, fit points, competitors and the
education-only checks follow it, `engine/offer.py`); briefs from before 2026-10-26 with only Vacademy
product keys keep the education catalogue.

Flow: plan (`planner.py`, one LLM call, cached weekly in `plan_json`) -> discovery round while the pool of
sendable leads (plus those on their way) is short of 2 days of the quota (`scheduler.pool_need`;
`discovery.py`: Serper web + Maps, Parallel for buying signals, LLM picks own-site results; dedup by
registered domain; suppressed domains skipped) -> home-page fetch task in the agent's mode -> `choose_pages`
adds <= 3 pages (+ a course-portal "platform" page) -> READY -> research (free rejects first; LLM extraction;
build_lead; fingerprint + size; score; decision-maker lookup only for a lead the gate would not reject
once it has a contact, `contact_hunt.worth_searching`; gate: one bar, `send_score`) -> APPROVED / REVIEW /
REJECTED -> delivery inside the window while today's delivered < quota, best score first (today's slots reserved atomically in `lead_agent_day.delivered`; admin_core existing-contacts + bulk-intake, <= 10 rows per call, a failed call retried idempotently on `external_id`, 5 attempts then FAILED) -> one charge per delivered lead (`charged_at` marks it settled).
Each tick also judges the REVIEW queue again with the agent's current gate (no AI). See "Rank and fill" below.

## Validity: right organisation, right contact (2026-10-29)

Outreach after delivery is fully automated, so a delivered lead must reach the organisation it names.
Rules that cost nothing run at every level:

* **Contacts** (`engine/research/contacts.py`, `lead.py`): an address is judged by the sentence around it
  (resume/CV, security, grievance/complaint or conference addresses are avoided). Template leftovers are
  avoided (`contact@mysite.com`, `filler@godaddy.com`, "(888) 456-7890" on an Indian site). An email on
  another organisation's domain is avoided unless it carries the organisation's name, is a leader's mailbox
  or belongs to a named person. Every email gets an owner (own / sister / org-named Gmail / person / unnamed).
* **Google Maps phone** (`contact_hunt.py`): the Maps listing's number becomes a contact, and a website number
  it also lists is `maps_confirmed`. A Maps listing overrides sentence-based blocks, but never helpline,
  toll-free, fax or template numbers. A site whose home page can't be read but has a Maps phone is judged from
  the listing (fit by category/name) and goes to REVIEW (`maps_only`), never AUTO; below the send bar it is
  rejected (since 2026-10-30, see "Rank and fill").
* **What delivery sends** (`delivery.py`): phone by tier, then home country, then mobile, then Maps-confirmed.
  Email: a leader's own mailbox first, then by owner. The lead is named after the person the phone sent
  belongs to (else the email's, when no phone), otherwise the organisation; the decision maker goes to
  `la_ask_for` ("Ask for"). `la_contact_quality` describes the phone/email actually sent.
  The dashboard shows the same choice: the candidates API's `send` (and `best_contact`) come from
  `delivery.send_plan`, the helper `build_row` uses. SKIPPED leads list under the Rejected tab.
* **Same organisation twice** (`dedupe.py`, after research, under a per-agent advisory lock): a shared usable
  phone/email, or emails on the other's domain, means the later candidate is SKIPPED. Same name and city with
  nothing shared is flagged `possible_duplicate` and goes to REVIEW (rejected below the send bar). Discovery
  also skips a same-name organisation in the same city (both lanes).
* **Hiring proof** (`engine/discovery/pipeline.py`, `sources.py`): the website of a hiring organisation must
  mention the job's place (Indian city renamings are aliases) and match its whole name. A taken site ends
  the lookup. One job post backs one organisation (across rounds: `store.known_signal_urls`). Job-list pages
  never count. Signal searches rotate per round (`cursor_json.sig_turn`).
* **Unreadable home pages** (`fetcher.py`, `engine/pagefetch.py`): one targeted retry (www ↔ bare name,
  meta refresh, http where allowed, browser headers). A JS-only page nobody renders is stored as the text its
  HTML carries (title, description, JSON-LD, `tel:` links).

**Validation effort** (`effort.py`, `gate_json.effort`, set per agent in the dashboard) buys extra checking
for leads the gate would not reject once they have a contact (`contact_hunt.worth_searching`):

| Level | Pages per site | Maps lookup (non-Maps leads) | Read the job post | Contact-hunt searches | Extra cost per lead searched |
|---|---|---|---|---|---|
| BASIC | 3 | no | no | 0 | none |
| STANDARD (default) | 3 | yes | yes | 1 | up to ~$0.004 |
| DEEP | 6 | yes | yes | 3 (incl. social-page results) | up to ~$0.006 |

The price per delivered lead does not depend on the level yet (`ai_tool_pricing` rows unchanged).

Page cache: pages our server read are shared by every institute (`fetched_institute_id = ''`); pages an
institute's extension read are visible to that institute only.

## Rank and fill: one bar, a pool, best first (2026-10-30)

Prod, 2026-10-30: agents asked for 100-200 leads a day, but a lead went out on its own only at score >=
`auto_score` (70), which a lead without a buying signal can hardly reach (fit 35 + reach 35). Everything from
45 to 69 went to REVIEW, and nobody works on it (the funnel after delivery is automated): about 820
researched leads were parked (Voomsales: 14 delivered, 214 in REVIEW in 2 days), teams lowered `auto_score`
by hand, and the scheduler kept discovering because `quota - delivered` stayed large.

* **Gate** (`engine/scoring.py` `gate`, `gate_json`; defaults in `scoring.DEFAULT_GATE` only, which research
  and `store.DEFAULT_GATE_JSON` read): one bar, `send_score` (default 50, also for an agent saved before it),
  and `require_approval` (default off). In order: a hard-reject flag -> REJECT; score (after the risk penalty;
  `auto_competitor_users` drops the competitor's) below `send_score` -> REJECT, naming the risks ("Judged from
  its Google Maps listing only: score X is below the send bar (Y)" for a Maps-only lead; nobody reviews in this
  funnel, so REVIEW holds only leads worth a person's look); best contact below `min_contact`, or
  `require_intent` without a buying signal -> REVIEW with `require_approval`, else REJECT; `maps_only` or
  `possible_duplicate` -> REVIEW (validity first: a person decides); otherwise REVIEW ("waiting for your
  approval") with `require_approval`, else AUTO. The list's own rules come before the held flags since
  2026-10-31: a held lead failing them used to wait in REVIEW on a list that needs no approval, where
  approving it would send it. A competitor's user or a very large organisation is no longer held back: its
  penalty ranks it lower. `auto_score` / `review_score` are still accepted (old agents and dashboards send
  them) and ignored.
  What research may search for a lead follows the same gate (`contact_hunt.worth_searching`).
* **Delivery order** (`store.claim_approved`): APPROVED by score, best first (then oldest), up to the daily
  quota, so each day sends the best of the pool.
* **Pacing** (`scheduler.pool_need`): pool = APPROVED not delivered yet (+ REVIEW with `require_approval`),
  in flight = DISCOVERED / FETCHING / READY / RESEARCHING, target = `POOL_DAYS` (2) x daily quota. Discovery
  looks for `min(target - pool - in flight, MAX_CANDIDATES_PER_ROUND)` while that is above 0, also once
  today's quota is sent (the pool feeds the next days). The daily round limit (`discovery.round_limit`), the
  wallet check (the round's leads, at most one day's quota) and the monthly cap still apply.
* **The REVIEW queue judged again** (`scheduler.rejudge_waiting`, every tick, agents without
  `require_approval`): up to 200 REVIEW leads, best first, gated again from their stored `score_json` /
  `lead_json` with the current gate, no AI: AUTO -> APPROVED, REJECT -> REJECTED (`reject_reason`,
  `score_json.rejudged_at`). A Maps-only lead or a possible duplicate below the bar or failing the list's
  rules is REJECTED too; otherwise it stays for a person. A row that stays is stamped with the gate it was
  judged under (`score_json.rejudged_for` = `scoring.gate_fingerprint`: the settings as the gate reads them
  and `GATE_RULES`, bumped when the gate's rules change) and not read again until that changes, so kept rows
  never crowd new ones out of the batch (2026-10-31). Never a lead a person decided, or a row missing a
  field the gate reads (`store.GATE_INPUTS`); each move and each stamp expects REVIEW, so a reviewer deciding
  at the same moment wins. `lead_agent_day` counters keep what research decided that day. Saving a new gate runs the
  same judging at once (the router), instead of waiting for the next tick.

**Spend where it pays** (discovery and research). Prod, 2026-10-30, 5 agents, 2,548 researched leads: 24%
sent, 33% parked in REVIEW, 38% rejected, 4% skipped; "Leads for Vacademy" went from ~22 new organisations
per 10 searches to ~3 while its rounds kept running.

* **Already in your leads, before the AI step** (`research.py`): the organisation's usable phones and emails
  (website + Maps phone; helplines, toll-free, fax, template numbers and other organisations' contacts left
  out) go through admin_core existing-contacts. A match is SKIPPED "Already in your leads (same phone or
  email)" with no LLM call. On an error research carries on, and delivery checks again. 102 of the 118 prod
  skips had been found only at delivery, after full research. Any usable contact counts, as in `dedupe.py`
  (a shared usable phone or email is one organisation); delivery checks only the phone and email it sends
  because that is all its row holds. All three compare through `dedupe.keys_of` / `phone_key` / `email_key`.
* **Decision-maker lookup** (`contact_hunt.worth_a_lookup`): only for a lead whose own score reaches the bar
  and which the gate would pass with a direct contact; never for another segment, a competitor or an excluded
  kind.
* **Lanes stop for the day** (`cursor_json.lane_done` / `lane_dry`): organisation search, Maps and signals each
  stop after wrapping past MAX_PAGE (once that last search has run: a failed Maps search is searched again next
  round) or 2 rounds with nothing new, and come back the next day (new posts appear daily) or when their list
  changes. A new organisation counts for the lane whose search found it (`discovery.found_by_lane`: a keyword
  result chosen like a search result is the signal lane's). A round with every lane done spends nothing.
* **Signal budget**: once the organisation and Maps lanes are done for the day, signal and keyword searches
  double (`SIGNAL_BOOST`). New-centre searches (35 found, 8% sent, 40% "not the kind") run every third round,
  or every round when nothing else is left to search (a round without a search still uses up the round limit).
* **Kind checks at discovery**: the web selection lists every industry of the brief (any one is enough, read
  broadly, location never judged there); Maps listings whose category is clearly a kind the brief does not
  target are skipped (`engine/discovery/kinds.py`; an unknown category or a broad brief keeps them). Link
  shorteners, data sites, job boards, news portals and `.directory` domains are never an organisation's own
  site (`engine/discovery/domains.py`; 24 prod candidates, most of them "not the kind" rejects that were
  really another site).

**Judging the kind of organisation (2026-10-30 audit)** (research's extraction). Prod, 5 agents: of 179 "Not the
kind of organisation the brief targets" rejects, 42 were a kind the brief lists and 34 more were pages of another
organisation; 16 of 38 "Sells what you sell" flags were false.

* **Every industry** (`research.py`, `engine/research/extract.py` `kinds_block`): the prompt lists each of the
  brief's industries (`plan.industries_detail`, else `brief.industries`), one per line: a match with any one is
  enough, each read broadly. The plan's segment (the planner's rewording in at most 120 characters, which dropped
  Voomsales' edtech and hospitals, Telleo's brokers, Evalezy's colleges and exam bodies) follows as a hint only.
  A Maps-only lead is matched against the same list (`research.brief_industries`).
* **What is sold is not who buys**: the prompt says the offer and its description name what we sell, not which
  organisations may buy it ("LMS platform for institutes selling online courses": 50 of the 96 rejects of "Leads
  for Vacademy" said "not an institute selling online courses", schools and colleges among them).
* **The kind only** (`AccountExtraction.is_target_segment`): never where the organisation is (the score's location
  part and `outside_market` do that). Markets go one per line, from the agent's markets (`planning.market_names`): joined, "Rajasthan,
  India, delhi" made the model call Delhi colleges "outside the requested Rajasthan location".
* **Another country** (`engine/scoring.py` `outside_markets`): flag `outside_market`, a hard reject "Outside your
  markets: its phones are +1 (United States)", only on positive evidence: every usable phone from a country no
  market is in, or a country-code domain outside the markets (.uk; .in is India), with no phone from a market
  country and no market-country domain. Never for a city or state inside a market country, a generic domain, an
  unknown location, a market country the tables do not know, or an agent without markets.
* **None of your cities and states** (`engine/scoring.py` `outside_market_places`, 2026-10-31): the same flag,
  "Outside your markets: it is in Mumbai; your markets are Jaipur", only when the organisation's city is known
  (its pages or Maps listing; not a country or "online"), nothing about it (city, branches, listing address,
  description, evidence) names a market city or state, another name of one (Gurgaon / Gurugram: discovery's
  renamings table) or a place of the metro area a market city stands for (`pipeline.METRO_AREAS`, this rule
  only: Delhi takes in NCR (Noida, Gurugram, Ghaziabad, Faridabad), Mumbai takes in Thane and Navi Mumbai, and so on;
  "delhi" stored as a state, as on Evalezy, counts too; a market named after a suburb never takes in the city),
  and every market in its country names a city or state (with a country-wide market elsewhere,
  a phone or country-code domain must show the lead is in a city-only country). A state market with no city is
  ruled out only when the organisation's city or listing address names another state: a city rarely carries its
  state's name (Kota, Pune). Before it, a Mumbai institute that was hiring scored ~57 on a Jaipur-only agent and
  was sent: being elsewhere cost only `FIT_LOCATION` (3.5 points). The audit's Delhi colleges on "Rajasthan,
  India" + "delhi, India" name a market and stay.
* **Pages of another organisation** (`pages_match_organisation`, true when a reply lacks it): false -> flag
  `wrong_site`, a hard reject "The pages read belong to another organisation, not this one", instead of "not the
  kind". The lead keeps the name it was found under; no kind, city or seller verdict is read from those pages.
* **Sells what you sell** (`sells_the_offer`): only selling or reselling the offer, or a direct substitute, to other
  organisations. Its own app, LMS or CRM for its own students or customers makes it a buyer, and selling courses is
  not selling course software (Physics Wallah, Unacademy and BYJU'S were flagged for Vacademy). The brief's
  competitors and competitor kinds are in the prompt as examples of sellers. The flag needs a quote found on the
  page (`sells_the_offer_cite`), like any other claim: without one it counts as false.
* The gate is unchanged: these flags still reject (nobody reviews in this funnel); the judging is what changed.

## Flags (platform settings; JSON values are STRINGS)

| Key | Default | Meaning |
|---|---|---|
| `lead_agent.enabled` | `false` | Kill switch. Off = no loop does any DB work, every admin endpoint is 403 `not_available`, extensions are told `paused`. |
| `lead_agent.institutes` | `"[]"` | JSON string list of institute ids (or `["*"]`). Empty = nobody. |
| `lead_agent.model` | `z-ai/glm-5.3-flash` | First model; the `lead_agent` use-case chain follows it. |
| `lead_agent.max_concurrency` | `3` | Research workers per pod (1..10). |

The specs are registered by `flags.py` (imported by the router at app start), so they show on the
super-admin settings page.

### Enable for one institute safely

```python
import json
from app.services.platform_settings_service import set_platform_setting
set_platform_setting(db, "lead_agent.institutes", json.dumps(["<institute-id>"]), "<you>")  # a STRING
set_platform_setting(db, "lead_agent.enabled", "true", "<you>")
```

A Python list would be `str()`-ed (`"['id']"`, not JSON) and read as EMPTY: nothing runs. Read the value
back and check it parses before telling anyone it is on. Then, in the dashboard: create the agent on a
test lead list (it starts PAUSED), check the brief, pair an extension (or use REMOTE), set a small
quota (e.g. 3) and a monthly credit cap, ACTIVATE. Watch `GET /agents/{id}/stats` and the review queue.

Kill switch: `lead_agent.enabled = "false"` (30 s cache). PAUSE one agent with `POST /agents/{id}/status`.

## Keys

Environment only, never in files or logs: `SERPER_API_KEYS` (comma-separated, rotated; the existing
setting), `PARALLEL_API_KEY` (`settings.parallel_api_key`). The LLM goes through the platform router
(Isoquant / OpenRouter keys as for every feature).

On prod, `SERPER_API_KEYS` comes from the GitHub secret set by the deploy workflow, and `PARALLEL_API_KEY`
lives in the cluster's shared `vacademy-secrets` (envFrom; added 2026-10-26): the repository is at GitHub's
limit of 100 Actions secrets, so no new one can be added there. Without it, Parallel searches fall back to Serper.

## Costs and credits

* Our cost: Serper ~ $0.001 per credit (web 1, maps 3), Parallel "fast" $0.001 per search, GLM Flash
  ~ $0.0005-0.001 per researched organisation. Tracked per candidate (`lead_candidate.cost_usd`, LLM) and
  per day (`lead_agent_day.cost_usd`, LLM + search). Searches are cached 7 days (`lead_search_cache`).
  Dry run 2026-10-26 (8 Indore candidates, plan + discovery + fetch + research): about $0.016 total.
* The institute pays per DELIVERED lead only: `lead_agent_lead_local` (2 credits, any page read by its
  extension) / `lead_agent_lead_remote` (4 credits); provisional, edit the `ai_tool_pricing` rows.
  Idempotency key `lead_agent:{candidate_id}` (a UUID, unique ledger-wide); credits read back into
  `credits_charged`. LLM calls are recorded record-only (`usage_record_only`, behind
  `billing.record_unbilled_usage`), never charged.
* Discovery is skipped when the wallet cannot cover the leads a round looks for (at most one day's quota)
  at the agent's price, or the monthly cap is reached; delivery stops at the cap.

## Retention

Pages expire after 30 days (`lead_org_page.expires_at`); the scheduler deletes expired pages and search
cache rows older than 7 days once a day per pod.

## Tests and scripts

```
cd ai_service
AI_LIMITS_PGDATA=/tmp/la_pgdata python -m pytest tests/lead_agent -q   # pgserver Postgres + real V612
python scripts/lead_agent_smoke.py --query "JEE coaching institute" --city Indore --env-file <env>
python scripts/lead_agent_dry_run.py --env-file <env> --max 8      # real plan->research, no delivery
python scripts/lead_agent_dry_run.py --env-file <env> --brief-file brief.json   # {"brief": {...offer...}, "markets": [...]}
```
