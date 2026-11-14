# Email billing

Institutes pay credits for the emails Vacademy sends for them through our AWS SES.

## Pricing

- The first **1,000 emails each calendar month** (India time) are free for every institute.
- After that, **25 emails cost 1 credit** (0.04 credit each), from the same wallet as AI credits.
- One email = one recipient copy. TO, CC and BCC each count, because SES bills per recipient.
- Every full MB of attachments adds one more email per copy. A normal PDF receipt adds nothing.

## What is charged and what can be stopped

| Class | Examples | Counts against the free 1,000 / charged | Stopped when out of credits |
|---|---|---|---|
| FREE | Login codes (OTP), password reset, login details, invites, our own billing mail to the institute | No | Never |
| ESSENTIAL | Payment receipts, invoices, fee receipts | Yes | Never (wallet may go negative) |
| BILLABLE | Everything else: announcements, campaigns, workflows, reminders, inbox replies | Yes | Yes |
| EXCLUDED | Mail with no institute; Engagement Engine mail (already charged 1 credit per message) | No | Never |

Rules (notification-service `features/email_billing/EmailBillingClassifier`): an explicit
`options.billingClass` from the caller wins; then `options.source` (admin-core dynamic
notifications send `event:<EVENT>`); then a template containing `{{password}}`,
`{{user_password}}` or `{{reset_password_link}}` is FREE. Anything unrecognised is BILLABLE.
auth-service marks all its mail FREE.

## How it works

- `EmailService` (notification-service) is the only place email leaves the platform. Before each
  send, `EmailBillingGate` decides whether a BILLABLE email may go: free allowance left, or wallet
  balance minus usage not yet charged is above zero. After a successful send, `EmailUsageStore`
  counts it (`email_usage_daily`, `email_billing_month`).
- A blocked single email is kept in `email_blocked`; the admin can resend or discard it from
  Settings → Email usage. Nothing is sent later on its own.
- A multi-recipient send (bulk send, campaign, announcement) the institute cannot pay for in full
  is refused before anything goes out (`INSUFFICIENT_CREDITS`). Nothing is stored per recipient.
- `EmailBillingChargeJob` runs hourly: per institute and month, the units beyond the free 1,000 not
  yet charged become one ledger row through admin-core
  `POST /admin-core-service/internal/credits/v1/email/charge` (request_type `email`, use case
  `email_send`), keyed `email:<institute>:<month>:<from>-<to>` so a retry never charges twice.
- Notices to the institute's contact email: 80% and 100% of the free emails (once a month), and
  "emails paused" when something is blocked (at most every 6 hours).
- If the wallet cannot be read, mail goes out (fail open). If the settings cannot be read, billing
  is treated as off.

## Switches

All in notification-service's database, read with a one-minute cache:

```sql
-- what is on
SELECT * FROM email_billing_settings;
-- turn pieces on/off (enforce = block BILLABLE mail, charge = push charges, notify = notices)
UPDATE email_billing_settings SET enforce_enabled = true, charge_enabled = true, notify_enabled = true WHERE id = 1;
-- exempt an institute (counted, never charged or blocked); until_date NULL = until removed
INSERT INTO email_billing_exemption (institute_id, reason, until_date) VALUES ('<id>', 'deal', NULL);
```

Changing the free allowance or rate: update `email_billing_settings` AND the `email` row of
admin-core `credit_pricing` (record only) together.

## Checking it

```sql
-- this month per institute
SELECT institute_id, chargeable_units, charged_units, charged_credits FROM email_billing_month
WHERE period_month = to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') ORDER BY chargeable_units DESC;
-- charges not confirmed by the ledger (retried hourly)
SELECT * FROM email_billing_charge WHERE status = 'PENDING';
-- held-back emails
SELECT institute_id, count(*) FROM email_blocked WHERE status = 'BLOCKED' GROUP BY 1;
```

Reconcile daily: the sum of `email_usage_daily.units` should be within a few percent of SES's
`Send` metric (CloudWatch, ap-south-1) for the same day.
