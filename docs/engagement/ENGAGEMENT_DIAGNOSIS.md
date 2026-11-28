# Engagement diagnosis: short daily report, detailed weekly report

The engagement report (`/engagement/reports/daily`) says what happened. This adds where the
lead-to-demo chain is breaking and what to change, so a person can change the engine's approach and
compare the result.

- **Daily** is short: only what is clearly broken, at most 5 problems. Small numbers are enough to see
  that 40% of WhatsApp messages failed.
- **Weekly** is detailed: comparisons of sources, hours, templates, subjects and prompt versions. These
  need volume, so a row below the minimum says "not enough data" instead of a verdict.

**No AI runs for this and it spends no tokens.** Queries compute every number and rules decide what is
wrong. The advice per problem is written in advance. `call_intelligence` labels are read as stored; they
are produced per call elsewhere.

## API

`GET /admin-core-service/v1/engagement/reports/diagnosis`

| Param | Notes |
|---|---|
| `instituteId` | required |
| `engineId` | omit for all engines |
| `view` | `DAILY` (default) or `WEEKLY` |
| `to` | `YYYY-MM-DD`, the last day, institute time zone. Default today there. Same validation as `/reports/daily`: 400 for a bad format, a future day, or a day before today − 89 |
| `fresh` | optional boolean, as on `/reports/daily` |

The period is `to..to` for `DAILY` and `to−6..to` for `WEEKLY`. Institute admins only, same guard and
403 behaviour as `EngagementDailyReportController`. JSON is camelCase and nulls are written out. Rates
are fractions 0..1.

```jsonc
{
  "view": "DAILY",
  "from": "2026-11-04", "to": "2026-11-04", "days": 1,
  "timezone": "Asia/Kolkata",
  "engineId": null,
  "generatedAt": "2026-11-04T10:00:00Z",

  // Ranked: severity (critical, then warning), then `affected` descending, then stage order
  // LEADS, CALLING, WHATSAPP, EMAIL, ENGINE. At most 5 on DAILY, 10 on WEEKLY.
  "problems": [{
    "code": "WHATSAPP_FAILED_HIGH",
    "stage": "WHATSAPP",               // LEADS | CALLING | WHATSAPP | EMAIL | ENGINE
    "severity": "warning",             // critical | warning
    "affected": 40,                    // people or messages this touches; the ranking key
    "numbers": { "failed": 40, "tried": 120, "rate": 0.33 },   // per code, see the catalogue
    "breakdown": [{ "key": "NOT_ON_WHATSAPP", "count": 35 }],  // may be empty
    "names": [],                       // per code: agent names, a template, a subject, an objection
    "link": { "target": "OUTCOMES", "channel": "WHATSAPP", "outcome": "failed", "kind": null }  // or null
  }],
  "moreProblems": 0,                   // how many were cut by the cap

  // Exactly one row per stage, in stage order, so a quiet stage can say so.
  "stages": [{ "stage": "LEADS", "status": "OK" }],
  // PROBLEM: a problem fired. UNAVAILABLE: its data failed to load (also in errors); never OK.
  // NO_ACTIVITY: nothing happened in that channel. NOT_ENOUGH_DATA: activity below every rule's
  // minimum. OK: enough activity and nothing fired.

  // What the report cannot see, so a 0 isn't read as a real 0.
  "dataGaps": [{ "code": "EMAIL_REPLIES_NOT_TRACKED", "names": ["hello@example.com"] }],
  // EMAIL_REPLIES_NOT_TRACKED (names = sender addresses) | EMAIL_TRACKING_OFF |
  // WHATSAPP_TRACKING_OFF | CALL_ANALYSIS_EMPTY (calls connected, none analysed)

  "weekly": null,                      // filled for WEEKLY only, see below
  "errors": {}                         // section name → "unavailable", as on /reports/daily
}
```

`weekly`, each list sorted by its first count descending unless noted. A number that could not be read is
null and shows as a dash, never as 0: `contacted`, `responded`, `demosBooked`, `replied`, `replies`, every
`engineChecks` number and every rate. `responded` and `replies` are also null when nothing in that row could
show a response (only emails whose replies don't reach us), because "nobody responded" would be a false zero. A failed section's list is empty, its object null, and it is named
in `errors`. The same problem code can repeat, once per source, hour, template or subject.

```jsonc
{
  "minimums": { "leadsPerSource": 30, "callsPerHour": 20, "sendsPerRow": 100 },
  "leadSources": [{
    "source": "maps",                  // lead_candidate.source, or OTHER for leads the Lead Agent didn't deliver
    // responded: replied to a message or picked up a call, because this judges whether leads are real and reachable
    "leads": 40, "contacted": 30, "responded": 6, "demosBooked": 1,
    "contactRate": 0.75, "responseRate": 0.15, "enough": true
  }],
  "callHours": [{ "hour": 14, "placed": 25, "connected": 5, "connectRate": 0.2, "enough": true }],  // sorted by hour, only hours with calls
  "callLengths": { "connected": 50, "under20s": 22, "s20to60": 18, "over60": 10 },
  "callInsights": {
    "analysed": 30,
    "sentiment": { "POSITIVE": 5, "NEUTRAL": 20, "NEGATIVE": 5 },
    "outcomes": [{ "status": "NOT_INTERESTED", "count": 12 }],
    "highLikelihood": 3,
    "topObjections": [{ "text": "budget", "count": 8 }]   // at most 10, grouped case-insensitively
  },
  "whatsappFailures": [{ "reason": "NOT_ON_WHATSAPP", "code": "131026", "count": 35 }],
  "whatsappTemplates": [{ "name": "intro_v2", "sent": 120, "delivered": 110, "read": 80, "replied": 6, "replyRate": 0.05, "verdict": "WORST" }],
  "emailSubjects": [{ "name": "Quick question", "sent": 120, "delivered": 110, "clicked": 4, "bounced": 2, "replied": 3, "clickRate": 0.03, "replyRate": 0.02, "verdict": "OK" }],
  // verdict: BEST | WORST | OK | NOT_ENOUGH_DATA. BEST and WORST only among rows with enough sends,
  // and only when at least two rows have enough.
  "promptChanges": [{
    "engineId": "…", "engineName": "…", "version": 4,
    "createdAt": "2026-11-02T06:00:00Z", "source": "ADMIN",
    "change": "what the admin typed, cut to 300 characters",
    "sends": 80, "replies": 4, "replyRate": 0.05, "demosBooked": 1, "enough": false
  }],                                  // versions with sends in the period, newest first
  "engineChecks": { "doubleContact": 3, "sentAfterReply": 1, "stuckMembers": 12 }
}
```

`whatsappFailures.reason`, from Meta's error code (keep the raw code in the row):

| Reason | Codes |
|---|---|
| `NOT_ON_WHATSAPP` | 131026 |
| `MARKETING_LIMIT` | 131049 |
| `USER_STOPPED_MARKETING` | 131050 |
| `OUTSIDE_24H_WINDOW` | 131047 |
| `TEMPLATE_PROBLEM` | 132000 to 132999 |
| `PAYMENT_ISSUE` | 131042 |
| `RATE_LIMITED` | 130429, 131048, 131056 |
| `REJECTED_AT_SEND` | no code: the send failed before Meta |
| `OTHER` | anything else |

`EngagementDeliveryCheckJob` moves a send Meta refused to `status = FAILED` within minutes, so the code is
read from notification_service for failed rows too. A failed row's status alone doesn't say why it failed.

## Rule catalogue

Thresholds live in one class. Where the existing health banners already judge something, the rule uses
the same numbers, so the two surfaces can't disagree.

`view` says where a rule runs: **both**, or **weekly** only. Every "advice" line is the copy the dashboard
shows.

### LEADS

| Code | view | Fires when | Severity | `affected` | `numbers` / `names` | `link` | Advice |
|---|---|---|---|---|---|---|---|
| `LEADS_MISSING_CONTACT` | both | added ≥ 10, and neither/added ≥ 10% or noPhone/added ≥ 30% | critical on the neither test, else warning | neither, or noPhone | `added, noPhone, noEmail, neither` | ITEMS kind `LEADS_ADDED` | Tighten what the Lead Agent or source must collect before a lead is delivered. |
| `LEAD_AGENT_NOT_DELIVERING` | both | an active Lead Agent linked to the engine's lists delivered 0 in the period, and its delivery window (`window_json`) has closed on a working day of the period, so it isn't judged this morning or on a day off | warning | agents | `discovered, rejected, review`; `names` = agents | none | Check the agent's search and scoring: it found leads but delivered none, or found none. |
| `LEAD_SOURCE_WEAK` | weekly | a source with enough leads has responseRate < 50% of the overall rate | warning | that source's leads | `leads, responseRate, overallRate`; `names` = source | none | Review or pause this source and put the effort on better ones. |

### CALLING

| Code | view | Fires when | Severity | `affected` | `numbers` / `names` | `link` | Advice |
|---|---|---|---|---|---|---|---|
| `CALLS_NOT_GOING_OUT` | both | notDialled ≥ 5 and notDialled/(placed + notDialled) ≥ 20% | critical when placed = 0, else warning | notDialled | `placed, notDialled` | none | Check the AI calling setup and credits: calls are queued but not being dialled. |
| `CONNECT_RATE_LOW` | both | placed ≥ 20, the 7 days before the period had ≥ 50 placed, and rate < 50% of that rate | warning | placed − connected | `placed, connected, rate, baselineRate` | OUTCOMES channel `AI_CALL` outcome `no_answer` | Check the number's reputation, the list and the calling hours. |
| `SHORT_CALLS` | both | connected ≥ 20 and under20s/connected ≥ 40% | warning | under20s | `connected, under20s, share` | OUTCOMES channel `AI_CALL` outcome `connected` | People hang up early: change the opening line of the pitch and check the targeting. |
| `CALL_HOUR_WEAK` | weekly | an hour with enough calls has connectRate < 50% of the overall rate | warning | that hour's placed | `hour, placed, connectRate, overallRate, bestHour, bestRate` | none | Move calls out of this hour, towards the best one shown. |
| `OBJECTION_RECURRING` | weekly | analysed ≥ 10 and the top objection is in ≥ 20% of analysed calls | warning | that count | `analysed, count`; `names` = objection | none | Answer this objection in the pitch. |

### WHATSAPP

| Code | view | Fires when | Severity | `affected` | `numbers` / `names` | `link` | Advice |
|---|---|---|---|---|---|---|---|
| `WHATSAPP_FAILED_HIGH` | both | tried ≥ 20 and failed/tried ≥ 10% (as the health banner; tried = sent + rejected at dispatch) | critical from 30%, else warning | failed | `failed, tried, rate`; `breakdown` = reasons | OUTCOMES channel `WHATSAPP` outcome `failed` | Act on the biggest reason shown: fix the list, the template or the billing. |
| `TEMPLATE_UNDERPERFORMING` | weekly | a template with enough sends has replyRate < 50% of the channel's rate | warning | that template's sent | `sent, replyRate, channelRate`; `names` = template | OUTCOMES channel `WHATSAPP` | Rewrite this template's opening and call to action, or replace it with the best one. |

### EMAIL

| Code | view | Fires when | Severity | `affected` | `numbers` / `names` | `link` | Advice |
|---|---|---|---|---|---|---|---|
| `EMAIL_BOUNCE_HIGH` | both | as the health banner: tracked, sent ≥ 20, bounce rate ≥ 5% (critical ≥ 10%) | as banner | bounced | `bounced, sent, rate` | OUTCOMES channel `EMAIL` outcome `bounced` | Clean the list before sending more: high bounces damage the domain's reputation. |
| `EMAIL_COMPLAINTS` | both | as the health banner: any complaint (critical ≥ 0.1% of sent) | as banner | complained | `complained, sent` | OUTCOMES channel `EMAIL` outcome `complained` | People marked this as spam: check who is being emailed and how often. |
| `SUBJECT_UNDERPERFORMING` | weekly | a subject with enough sends has replyRate < 50% of the channel's rate, when replies are tracked for its sender | warning | that subject's sent | `sent, replyRate, channelRate`; `names` = subject | OUTCOMES channel `EMAIL` | Test a different subject line and opening for this email. |

### ENGINE

| Code | view | Fires when | Severity | `affected` | `numbers` / `names` | `link` | Advice |
|---|---|---|---|---|---|---|---|
| `ENGINE_ACTIONS_FAILING` | both | decisions ≥ 10 and failed/decisions ≥ 20% | critical from 50%, else warning | failed | `failed, decisions, rate`; `breakdown` = top errors (key = message) | none | Fix the top error shown: these leads got no message. |
| `DOUBLE_CONTACT` | both | people sent ≥ 2 SEND actions on one channel in one local day: ≥ 3 people, or ≥ 5% of those contacted | warning | those people | `people, contacted` | none | Check the cadence: these people were messaged twice in a day. |
| `SENT_AFTER_REPLY` | both | a SEND (not REPLY) on EMAIL or WHATSAPP went out after that person replied, within 72 hours of the reply | critical from 5, else warning | those sends | `sends` | none | The engine kept sending after a reply. Check how it handles replies. |
| `CREDITS_LOW` | both | as the health banner: runway < 7 days (critical < 2) | as banner | 0 | `runwayDays` | none | Top up credits: sends stop when they run out. |
| `MEMBERS_STUCK` | weekly | ≥ 5 ACTIVE members of running engines whose next action is over 48 hours late | warning | those members | `members` | none | These leads have no next step: check why the engine isn't picking them up. |

There is no rule for sends outside the engine's schedule. A send outside the window is normal (adaptive send
times, replies, first touches, resumed sends), none of that is recorded on the action, and the schedule keeps
no history, so a past send could only be judged against today's settings.

`link`: `OUTCOMES` opens the Task Inbox on that channel and outcome, the only page that filters by them.
`failed` opens its Failed tab. `ITEMS` opens that kind's tab on the outcomes page
(`/engagement-engines/dashboard/outcomes`). Both go through the helpers in `-utils/report-links.ts`. The engine
and period come from the page. A link opens the rows the evidence is about, not always exactly `affected`:
`SHORT_CALLS` opens every connected call, `CONNECT_RATE_LOW` the unanswered ones.

## Reply tracking per sender

A reply reaches us only when the sender domain's lowest-preference MX is SES inbound
(`inbound-smtp.*.amazonaws.com`); we set no Reply-To. `inboundEmailEnabled` is global, so today a sender on
any other domain reads as "tracked, 0 replies". `report-signals` now also returns the senders whose replies
can't reach us. They become the `EMAIL_REPLIES_NOT_TRACKED` gap, and the daily report's `repliesTracked` is
false when that covers every sender in the period. A failed DNS lookup keeps today's behaviour.

## Reading the numbers

- Per-subject and per-template email replies, and opens and clicks, are only reliable for mail sent after the
  reply-link fix (#3649) went live on 2026-11-04. Earlier events were matched to the latest email to that address.
- WhatsApp replies are credited to the latest send before them, and any inbound counts; there is no exact
  link. Treat a template comparison as a strong hint.
- AI-written email subjects are almost all different, so they rarely reach 100 sends and read "not enough
  data". Emails on a template are compared by template. For AI-written ones compare prompt versions instead.
- Objections are free-text sentences from call analysis and are only grouped when identical, so
  `OBJECTION_RECURRING` rarely fires and `topObjections` reads as examples. `callInsights.outcomes` is the
  grouped view.
- Prompt versions are the one change compared exactly (`engagement_action.prompt_version_id`). Calling hours
  and the call script have no history, so they can't be compared before and after.
- A lead calling back is not counted.
