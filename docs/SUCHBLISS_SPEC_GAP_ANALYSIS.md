# SuchBliss — Registration, Trial & Payment Spec: Gap Analysis

**Institute:** SuchBliss (`54d0a67f-8a13-4137-872d-f62d68ef7971`) · **Live batch:** `66b6da76-2958-4581-81f1-2d3babe98dd5` · **Holding batch:** `6b7960a6` (INVITED)
**Reviewed:** 2026-11-27 against the client spec *Registration, Trial, Payment & Member Dashboard*
**Companion:** [SUCHBLISS_AUTOMATION.md](SUCHBLISS_AUTOMATION.md) (runbook; stale since 2026-08-12)

Every figure below was measured against production on 2026-11-27, not inferred. Where a
claim could not be verified it says so.

---

## 0. Summary

| # | Spec requirement | State | Severity |
|---|---|---|---|
| 1 | One trial per learner, consumed only by a successful payment | **Broken both ways** | Revenue + trust |
| 2 | Three invites misconfigured | **Broken** | Revenue |
| 3 | Class access tied to valid payment | **Broken** | Revenue |
| 4 | Active member must not re-register | **Not enforced** | Duplicate charges |
| 5 | AutoPay created *and verified* | **Not verified** | Silent churn |
| 6 | Two-day grace, then access stops | **Half-wired** | Access leak |
| 7 | Pre-charge reminder without a stop link | **Violated** | Churn |
| 8 | No duplicate reminders | **Violated** | Trust |
| 9 | One user, one account | **Violated** | Eligibility |
| 10 | Idempotent payments/memberships | **Broken** | Ledger integrity |
| 11 | Audit trail | **Missing for cancellations** | Support |

Section 12 records what was changed on 2026-11-27 and what each change was measured to do.

---

## 1. Trial eligibility is wrong in both directions

**Spec:** consumed if and only if a successful trial payment exists. A failed or incomplete
payment must not consume it.

**Implementation** (`UserPlanRepository.hasConsumedTrialByPhone`, and the
`hasConsumedTrialAtInstitute` twin):

```
is_trial = true
AND end_date < now
AND (a mapping exists OR a PAID payment_log exists)
```

Two gates call it. `EnrollmentFormService.trialAvailableFor` decides what the form offers
(cosmetic, passes an empty currentPlanId). `UserPlanService.hasConsumedTrial` is the one
that decides the money: when it returns true, `trialDays` is forced to 0, so no trial
window is created, `is_trial` stays false, and `SubscriptionPaymentOptionOperation` charges
the plan price instead of the small mandate-authorisation amount.

**Defect A — the mapping arm.** An abandoned checkout leaves a mapping in the INVITED
holding batch, which satisfies `a mapping exists` and burns the trial. **19 phone numbers
are wrongly blocked**, among them Anshu Arora, Dinesh, Manshi jaiswar, Perminder, Priyanka
Sinha, Ramssh, Sweccha Verma, Umesh, vandana pandey, Vandana Pardasaney and Vandana singh.
Each would be refused the trial and quoted the full price. This is what happened to Ratula
Vig on 2026-11-20 and it is not a one-off.

**Defect B — the end_date clause.** Eligibility is not consumed until the trial *ends*, so a
learner who pays today is still eligible today and can take a second trial on another
invite (there are 8 live). Richa Arora sits in that window right now.

**Underneath:** there is no stored `trial_used`. Eligibility is re-derived on every check
from plan rows, keyed on `is_trial` — the same column that drifts across duplicate rows.
Spec section 8 asks for `trial_used`, `trial_payment_status` and `trial_payment_date` as
stored facts; none exist.

### Fix, measured

```
is_trial = true
AND a PAID payment_log exists
```

Dropping the mapping arm and the end_date clause. Effect across the 76 SuchBliss phone
numbers:

| outcome | numbers |
|---|---|
| unchanged, already consumed | 43 |
| unchanged, still available | 13 |
| regain a trial that was wrongly burned | **19** |
| newly blocked, closing defect B | **1** (Richa Arora) |

Enforcement is kept for 54 learners who hold a PAID payment on a trial plan. Of the 59 such
payments, 57 are the small trial charge; the two larger ones are Ratula (remediated by hand)
and a historical Vibhuti row. Keying on the flag plus a PAID log is therefore more robust
than matching the amount.

The end_date clause was originally added because a retrying learner creates several trial
rows minutes apart. That reasoning only applies to the mapping arm: a retry row has no PAID
log, so requiring one makes the date test unnecessary.

---

## 2. Three invites are half-configured and still live

`UserPlanService.applyAutopayFromInviteSetting` reads `AUTOPAY_SETTING` from each invite's
`setting_json`. If `ENABLED` is absent it short-circuits: **no trial window and no autopay
mandate**.

| invite | ENABLED | TRIAL_DAYS | plans |
|---|---|---|---|
| `xbat86`, `ey582o`, `yuk4fg`, `55n21f`, `zqkloy` | true | 14 | 178 |
| `3da9sr` | **absent** | **absent** | 2 |
| `0yoz9t` | **AUTOPAY_SETTING absent** | — | 2 |
| `fqmn0c` | **absent** | **absent** | 0 |

All four plans on the two used invites are broken:

```
0yoz9t  Jack Root     ACTIVE, never paid, 1-year plan Jul 2026 -> Jul 2027, no autopay
0yoz9t  Neeraj        ACTIVE, never paid, 1-year plan, no autopay
3da9sr  Reema Garg    PENDING_FOR_PAYMENT, no end_date, stuck
3da9sr  Vandana Singh PENDING_FOR_PAYMENT, no end_date, stuck
```

Both invites are still ACTIVE, so anyone handed those links today gets the same outcome.
This also explains two anomalies listed separately below: Jack Root and Neeraj are the only
active paid members with zero mandates, and they hold access with no payment.

The same three invites carry **no PAYMENT_SUCCESS trigger** on `suchbliss_welcome_wa_wf`,
so learners entering there receive no welcome message either.

This breaks the spec requirement that the trial rule apply identically across all entry
points — today the offer depends on which link the learner was sent.

---

## 3. Access granted without payment

Spec 9.10. Nine learners hold an ACTIVE mapping with zero PAID payment logs:

| learner | plan status | note |
|---|---|---|
| Jack Root, Neeraj | ACTIVE | never paid (see section 2) |
| Anshu Arora, Perminder, Piyush Srivastava, Ujjesha, Umesh | PENDING_FOR_PAYMENT | abandoned checkout |
| Anushree Mishra, Nitika Maheshwari | PAYMENT_FAILED | failed charge, access kept |

Piyush Srivastava is on the live class roster receiving daily links.

---

## 4. Nothing stops an active member re-registering

Spec 4C requires an active paid member to be routed to the dashboard, never offered
registration. **14 open checkout plans exist across 8 active members** — Ratula 4, Nitika 3,
Priyanka 3, plus Jyoti Diwan, Vandana singh, Vibhuti, test manshu. Each is independently
completable, which would charge them again and create a second membership.

---

## 5. AutoPay is never verified and failure is silent

Spec 2.5 and 9.4: create *and verify* the mandate; do not assume initiating means active.

- There is no verification step after signup.
- `RenewalChargeService` **skips silently** without an ACTIVE mandate — no charge, no
  message, no error row.
- **Jack Root and Neeraj hold ACTIVE paid plans with 0 mandates.** Their renewals will never
  fire and nothing will report it.
- **9 ACTIVE members have `auto_renewal_enabled = false` and `next_charge_at = null`**:
  Attika Jain, Manasvii Dutta, Nupur Sood, pallavi bedi, Ruchi Dhir, Shumaila faizi,
  Vandana singh, Jack Root, Neeraj. They lapse with no charge attempted. This is why
  Manasvii Dutta received *we could not renew your membership*.
- Sweccha Verma is inconsistent: autopay false but `next_charge_at = 2026-10-22` (past).

**How they get there** — checked per learner on 2026-11-27, not inferred. For pallavi bedi,
Shumaila faizi, Ruchi Dhir and Sweccha Verma the per-plan mandate reads **REVOKED**: they
cancelled autopay. `SubscriptionService.cancelSubscription` sets the plan CANCELED, turns
autopay off and revokes the mandate — correct. What follows is not: a later successful
payment runs `RenewalPaymentService.handleSuccessfulRenewal`, which sets the plan back to
**ACTIVE**, extends `end_date`, and at line 416 writes
`next_charge_at = autopayOn ? newEndDate : null`. With autopay off that is null, so the plan
leaves the charge sweep for good while still reading ACTIVE.

pallavi bedi and Shumaila faizi show the shape exactly: ₹1 on 13/10 Sep, ₹1,200 on 25 Sep,
₹1,200 on 26 Oct, then nothing on 26 Nov. Both plans ended 26 Nov 18:30 with
`renewal_attempt_count = 0` — not a failed charge, no charge at all.

The comment at that line names the intended compensating control: *the pre-expiry workflow
sends them the payment link each cycle instead of the sweep attempting a charge against a
dead mandate.* That part works. What was missing is the other half — nothing ends the
membership when the manual payment never comes. See section 6.

Spec 9.5 (one active mandate) **is** satisfied: no learner holds duplicates.

Mandates live in `user_institute_payment_gateway_mapping` joined via
`institute_payment_gateway_mapping` (SuchBliss: `df271ad1`, RAZORPAY). They are **not** in
`user_plan.json_payment_details`, which is null on every plan.

---

## 6. The two-day grace period is built, configured, and reachable by only half the plans

**Correction to an earlier draft of this document, which said the grace period did not
exist. It does, in both code and config.** `RenewalGracePolicy` implements it, anchored on
`end_date` in the invite billing timezone, and **all eight SuchBliss invites now carry
`AUTOPAY_SETTING.GRACE_PERIOD_DAYS = 2`**. `autopayChargeSchedulerEnabled` is true for the
institute, so the sweep that enforces it does run.

The defect is narrower and worse than a missing feature: **the deadline is only ever
evaluated inside the autopay charge sweep**, and that sweep selects armed plans only —

```
findDueForRenewalForInstitutes:  status = ACTIVE
                                 AND auto_renewal_enabled = true
                                 AND next_charge_at IS NOT NULL
```

A plan that falls out of that set is never charged **and never expired**. Status stays
ACTIVE, the mappings stay ACTIVE, the dashboard keeps showing a paying member, and class
access outlives the paid term with no end. Section 5 shows how plans land there.

Measured on 2026-11-27, SuchBliss had **6 ACTIVE plans already past their term with no
charge armed**, every one of them outside the sweep:

```
pallavi bedi     term ended 2026-11-26   autopay off, next_charge_at null, 3 payments
Shumaila faizi   term ended 2026-11-26   autopay off, next_charge_at null, 3 payments
Ruchi Dhir       term ended 2026-11-21   autopay off, next_charge_at null, 2 payments
Manasvii Dutta   term ended 2026-11-20   autopay off, next_charge_at null, 3 payments
Sweccha Verma    term ended 2026-10-21   autopay off, next_charge_at 2026-10-22 (past)
Rachna           term ended 2026-08-27   a trial plan left ACTIVE for three months
```

and **18 ACTIVE access rows** whose plan term had ended, 6 of them in the live class batch.
The spread that looked like a missing grace period is the same hole seen from the access
side: Nitika Maheshwari at +11 months is simply a plan nothing ever revisited.

`MAX_DAYS_PAST_EXPIRY_FOR_EMAIL = 2` governs **messaging only**, not access, and there is no
`GRACE_PERIOD` status — both still true.

Fixed in section 12.1.

---

## 7. Messaging defects

- **The pre-charge reminder carries a cancellation link**, which spec 3 forbids.
  `sb_d13_stop_notice_001` sends `suchbliss_renewal_notice_d12` including the
  stop-membership link, and its trigger exposes no `templateName`, so the client cannot
  change it.
- **Duplicate reminders:** `sb_abandoned_cart_wf` and `sb_payment_failed_wf` were both
  ACTIVE on the same 16:00 cron. Compared node by node they are identical, not merely
  similar: same `instituteId`, same `minAgeDays = 1` / `maxAgeDays = 3`,
  `planStatuses = null` on both so the query default applies to both, and the same
  `suchbliss_payment_incomplete_v2` template with the same two template vars. Every learner
  in the 1-to-3-day abandoned window was therefore messaged twice a day, up to 6 copies
  across the window. Fixed in section 12.3.
- **A one-off from 2026-10-05 is still ACTIVE:** `sb_oneoff_nitika_20261005`.
  Fixed in section 12.3.
- **Pay-to-continue** charges the full price, has **no mandate check**, and tells an audience
  whose autopay was never enabled that *we could not renew it automatically*.
- The attendance workflow is named weekly but runs daily at 21:30.

---

## 8. One user, one account

Spec 9.1 and 9.9. Four phone numbers hold more than one account, one of them **15**:

```
...9977  15 accounts   Manshu Jais | Manshu Jaiswat | Manshu Test | test manshu | testmanshu
...7707   4 accounts   919425677707 | Shreyash | Test Shreyash trial
...6839   4 accounts   Piyush Srivastava | testmanshu | Test Piyush Ji
...6839   2 accounts   Piyush Srivastava | Shuchita Srivastava
```

The phone-based trial check partly compensates by matching across accounts, but the
duplicate profiles are real.

**Open question for the client:** keying identity on the phone number means two family
members sharing a number get one trial between them. `...6839` already shows two distinct
names. The spec assumes one person per number.

---

## 9. Idempotency and the ledger

Spec 9.6. Every checkout tap inserts a new `user_plan` — Ratula produced four rows in six
minutes, all with identical `plan_id`, `payment_option_id`, invite and no coupon. The
accrual is not idempotent either, so SuchBliss carries **90 phantom `DEBIT_ACCRUAL` rows
totalling 268,344** against plans never paid; Ratula alone shows 4,800 of Due she does not
owe. `payment_log` **is** per-attempt and correct; the plan row and the accrual are not.

Spec 9.13: cancellations leave no database record at all.

Section 12.2 stops both halves recurring: the next payment supersedes the learner abandoned
siblings and reverses what they booked. It does **not** clean the existing 98 rows or the
90 standing accruals, which remain a separate data task.

---

## 10. Not verified

The three entry points and the dashboard redirect (spec 1 and 7) are frontend routing and
were not checked: whether `www.suchbliss.com`, the direct registration link and
`member.suchbliss.com` all converge on one account and redirect to the dashboard after
payment, and whether the logged-in purchase path re-checks eligibility the way the invite
form does. Class join links do point at `member.suchbliss.com`.

---

## 11. Recommended order

Sections 1, 2, 6, 7 and the forward half of 9 are done — see section 12. What is left:

1. **Section 5** — verify the mandate at signup. The alert half is done (12.4).
2. **Section 9, backward half** — clean the 98 existing abandoned rows and the 90 standing
   accruals (₹268,344), Ratula first since her 3 open ₹1,200 checkouts are still completable.
3. **Sections 3, 4, 8** — product decisions: what access an unpaid plan should grant, whether
   an active member may re-register, and whether two family members on one phone number get
   one trial or two.
4. **Section 7, first bullet** — the day-12 notice still carries the cancellation link. Needs
   a new Meta template, not a config change, and `sb_d13_trigger` exposes no `templateName`.

---

## 12. Changed on 2026-11-27

### 12.1 Lapsed memberships now end (code)

`RenewalChargeService.expireLapsedUnarmedPlans`, run daily at 15:30 IST by
`PackageSessionScheduler.expireLapsedMemberships` — half an hour after the charge sweep, so
a plan charged today is already re-armed and can never be read as lapsed. It selects ACTIVE
plans past `end_date` with no charge armed (`UserPlanRepository.findLapsedUnarmedPlansForInstitutes`)
and expires one only when **all** of these hold: not paused for an enrolment break, a
SUBSCRIPTION payment option, and `GRACE_PERIOD_DAYS` configured on the invite and elapsed.
Expiry is the existing `expirePlan`: status EXPIRED, `next_charge_at` cleared, mappings
INACTIVE.

The invite gate is what makes this safe. Replayed against production on 2026-11-27:

| | plans |
|---|---|
| candidates (ACTIVE, past term, no charge armed, opted-in institutes) | 7 |
| **expired** — grace already elapsed | **5** |
| held — still inside the 2-day grace (pallavi bedi, Shumaila faizi; they expire on the 29th) | 2 |
| for contrast: no invite gate, every institute, every plan type | **6,625** |

Those 6,625 are the FREE, DONATION, ONE_TIME and CPO enrolments every institute has always
left ACTIVE past their end date. Gating on a key the institute sets itself is the difference
between enforcing a stated policy and mass-revoking access.

**No learner message is emitted.** The grace-over branch of the charge sweep sends the
could-not-renew notice, which is untrue for everyone here — they either cancelled on purpose
or never had a mandate. What a lapsed member should be told is a client decision, and that
wrong notice has already gone out once (Manasvii Dutta).

### 12.2 Duplicate checkout plans are superseded for everyone (code)

`supersedeAbandonedSubOrgSiblings` became `supersedeAbandonedSiblings`: the SUB_ORG gate is
gone and siblings are matched on the paid plan source instead, so a SUB_ORG payment still
never touches a USER plan or the reverse. On payment, the learner earlier abandoned attempts
for the same (user, invite) have their ACTIVE mappings moved onto the paid plan, duplicates
by package session retired, and the sibling set CANCELED — as before, now for individual
learners too, who retry checkouts far more often than sub-org admins.

It also reverses what each abandoned attempt booked, via the new
`UserAccountLedgerService.reverseOutstandingDebitForSource`. That posts a DEBIT_REVERSAL for
the **current** net of the source, carrying the original accrual currency and due date so it
nets out of the past-due bucket as well as the total, and a second call reverses nothing. The
98 rows and ₹268,344 already standing are untouched; this stops the number growing.

### 12.3 Config, applied to production

- `3da9sr`, `0yoz9t` and `fqmn0c` now carry the same `AUTOPAY_SETTING` as the five working
  invites — `ENABLED`, `TRIAL_DAYS 14`, `GRACE_PERIOD_DAYS 2`, `CHARGE_LEAD_DAYS 1`,
  `AUTH_ENABLED`, `MONDAY` / `Asia/Kolkata`. All eight entry points are now identical, which
  is what the spec asks for. Existing keys on each invite were preserved and
  `postformfillConfiguration` was not touched. These are live doors, not dead ones — 3da9sr
  took a signup on 2026-10-04 and broke it — so they were repaired rather than deactivated.
- The same three invites gained the triggers the other five already had: PAYMENT_SUCCESS on
  `suchbliss_welcome_wa_wf` and on `sb_renewal_confirmation_001`, and SUBSCRIPTION_CANCELLED
  on `sb_cancel_winback_001`. Nine rows, cloned from the `xbat86` triggers with each clone
  pointed at its own invite.
- `sb_payment_failed_wf` and its schedule set INACTIVE (the duplicate of
  `sb_abandoned_cart_wf`, which stays ACTIVE).
- `sb_oneoff_nitika_20261005` set INACTIVE.

Rollback: `C:\tmp\suchbliss_config_rollback.sql`.

### 12.4 A silently skipped renewal is now loud (code)

`RenewalChargeService` logged the no-ACTIVE-mandate skip at WARN. It is now ERROR and names
the plan, the learner and the mandate status. This is a paying member whose renewal silently
does not happen: the plan reads ACTIVE, the payment history reads PAID, finance reconciles,
and the only trace was one warn line among thousands. Jack Root and Neeraj held paid ACTIVE
SuchBliss plans for months this way.

### 12.5 Trial eligibility (code, from the earlier pass)

Section 1, unchanged: the mapping arm and the `end_date` clause are gone from both
eligibility queries. 19 phone numbers regain a wrongly burned trial, 1 (Richa Arora) is
newly blocked, 56 are unaffected.
