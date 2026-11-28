# Demo institute seed

Fills a fresh institute with curated, fictional data through the same HTTP APIs the admin dashboard uses,
so every screen the demo tours visit looks alive.

**`https://backend-stage.vacademy.io` is production.** This script has never been run against a live
server. It was written from reading the code; every endpoint and payload in it is listed below with how
sure we are. Expect the first real run to stop on a response the script did not expect. That is by design:
it stops on the first surprise, prints it, and can be run again once the cause is fixed.

## What is here

| File | What it is |
|---|---|
| `seed.py` | The script. Python 3.9+, standard library plus `requests`. |
| `data/vacademy.json` | The dataset: "Northlight Academy", a fictional NEET/JEE and Class 9 to 12 coaching institute in Bengaluru. Edit it freely; other products get their own file later. |
| `tests/test_seed.py` | Tests for the plan, the state file, the institute guard, the payload lint, and the executor against a fake server. |

## Running it

```sh
cd demo-stage/seed

# 1. Print the plan. No network, no state file. This is the default.
python3 seed.py --base https://backend-stage.vacademy.io --data data/vacademy.json
python3 seed.py --base ... --data data/vacademy.json --only leads --show-bodies   # one section, with bodies

# 2. Execute (only after the checklist below).
export SEED_TOKEN=<admin access token of the demo institute>      # or SEED_USER and SEED_PASS
python3 seed.py --base https://backend-stage.vacademy.io --data data/vacademy.json \
    --institute <institute id> --apply

# Tests
python3 -m unittest discover -s tests -v
```

Flags: `--only <section>`, `--skip <section>` (repeatable), `--limit N` (create at most N new leads in this
run), `--today YYYY-MM-DD`, `--show-bodies`, `--delay <seconds>`, `--allow-team`, `--allow-announcements`,
`--team-email-template`.

Prefer `SEED_TOKEN`. Signing in with `SEED_USER`/`SEED_PASS` goes through `login-root`, which deletes the
user's other refresh tokens, so it signs the demo admin out everywhere else.

### What stops the script from writing to the wrong place

1. Without `--apply` nothing is sent. The dry run does not open a socket (tested).
2. With `--apply` it first reads `GET /admin-core-service/institute/v1/details/{--institute}` and refuses unless
   the id matches, the institute's name is exactly the dataset's name ("Northlight Academy"), and the token
   has a role in that institute.
3. It refuses if the institute has any workflow. Workflows are how almost every email, WhatsApp message and
   AI call gets attached to a write, and a new institute has none.
4. Every planned request is linted before anything is sent: flags that send must be false
   (`send_credentials`, `notify_learners`, `notify`, `send_respondent_email`, `generate_invoice`, the
   assessment notify flags), lists that send must be empty (`added_notification_actions`, `mediums`,
   `to_notify`, `add_faculty_to_course`, `sendRules`), every email must be at `example.com`, every phone must
   match the dataset's invalid pattern, every institute id must be the target, and a list of endpoints is
   forbidden outright (test call, provider meeting creation, public lead forms, send reminder, release
   result, the old enrolment endpoints, signup).
5. The state file is tied to one institute id and one base URL.

### Idempotency

Created ids are kept in `~/vacademy-private/demo-agent/seed-state/vacademy-<institute id>.json` (mode 600),
saved after every step. A second run skips what is recorded there. Some steps also look on the server
first (courses by name, lead stages, AI agents by name), and learner enrolment is safe to repeat
(`duplicate_handling: SKIP`).

**Do not delete the state file and run again.** Without it, these would be created twice: subjects,
modules, chapters, fee plans, lead lists (the second create fails on the name, which is safe), question
papers, assessments, attempts, live classes. If a run dies between the server accepting a write and the
state being saved, that one item can also be created twice; check the last line printed before rerunning.

## Before the first real run

1. **Create the institute** (next section) and note its id.
2. Sign in once as its admin, open Workflows and confirm the list is empty.
3. Optional: put course thumbnails in `data/thumbnails/<course key>.png` (or `.jpg`, and change the path in
   the dataset). They are uploaded before the course is created; a missing file just means no thumbnail, and
   adding the file later has no effect.
4. Optional: replace the three `REPLACE_ME` YouTube links in the dataset. Video slides with a placeholder
   link are never sent.
5. Run the plan and read it.
6. Run `--apply --only settings` first, then the rest.

## Creating the institute (not done by this script)

| Path | Result | What it sends |
|---|---|---|
| **`POST /auth-service/v1/signup-root`** (what the admin signup page calls; public) | Normal institute: `lead_tag` defaults to `PROD`, no trial row, never expires | One email: "Welcome to Northlight Academy" with the username and password in plain text, to the admin email in the request. No WhatsApp, no Slack, no CRM lead. |
| `POST /auth-service/super-admin/v1/demo/provision` (super admin only) | `FREE_TRIAL` institute with a required expiry. `TrialAccessGuard` blocks sign-in after it. | The same welcome email. |
| `POST /auth-service/v1/self-signup/signup` and `/demo` | `FREE_TRIAL`, expires after the product's trial days | Email code, optionally a WhatsApp code, product welcome email, then a team alert and a lead in Vacademy's own CRM. |

**Use `signup-root`.** The operator must supply an admin email at a mailbox they control (the welcome mail
with the password cannot be switched off, and the request is refused with 409 if any account already uses
that email), a username nobody has taken, and a password. Do not use an `example.com` address here.

```json
POST /auth-service/v1/signup-root
{
  "full_name": "Demo Admin",
  "user_name": "<unique username>",
  "email": "<a mailbox you own that has no Vacademy account yet>",
  "password": "<strong password>",
  "user_roles": ["ADMIN"],
  "institute": {
    "institute_name": "Northlight Academy",
    "city": "Bengaluru", "state": "Karnataka", "country": "India",
    "type": "Coaching Institute",
    "module_request_ids": ["1", "2", "3", "4"]
  }
}
```

The institute name must be exactly `Northlight Academy`, or the seed will refuse to run. The id comes back
inside the token (`authorities`) and is shown in the dashboard URL bar / settings.

## Sections

On by default unless marked. "Read" means the endpoint, payload and side effects were read in the backend
code; "assumed" means a response shape or an optional field was not confirmed and the script will stop if
it is wrong. Nothing was tested against a server.

| Section | Endpoint(s) | What else the write does | Default |
|---|---|---|---|
| `settings` | `GET institute/setting/v1/all`, `POST institute/setting/v1/save-setting` for `LEARNER_ENROLLMENT_SETTING.sendCredentials=false` and `ASSESSMENT_SETTING.resultNotifications.roles.STUDENT/LEARNER=false` (merged into what is saved, read back afterwards) | Nothing outbound | on |
| `structure` | `POST course/v1/add-course/{id}` (course + session + levels + batches, catalogue flag), `GET institute/v1/details/{id}`; thumbnails: `POST media-service/get-signed-url`, `PUT` to storage, `POST media-service/acknowledge` | Per batch: a default enrol invite, a short link (internal call to media-service) and an invitation code, all database rows. `COURSE_CREATED` workflow event (nothing listens). | on |
| `content` | `subject/v1/add-subject`, `subject/v1/add-module`, `chapter/v1/add-chapter`, `slide/v1/add-update-document-slide`, `slide/video-slide/add-or-update` | Slides are created `PUBLISHED` with `notify:false`. The email to learners is only sent when `notify` is true, or when a slide is published later through `update-status` (never called here). | on |
| `fee_plans` | `POST v1/fee-management/cpo` with instalments and `package_session_links` | Nothing outbound. Past due dates are accepted. | on |
| `learners` | `POST v3/learner-management/assign` in groups of 20, `send_credentials:false`, `notify_learners:false` | Creates the account without the credentials email, an active plan, and the fee bills of the batch's fee plan. `LEARNER_BATCH_ENROLLMENT` workflow event (nothing listens). | on |
| `payments` | `GET v1/fee-management/user/{userId}/cpo-user-plans`, `POST v1/fee-management/user-plan/{id}/record-offline-payment` with a past `payment_date`, `generate_invoice:false` | Ledger entries only. No receipt, no invoice. The plan lookup response shape is **assumed**. | on |
| `team` | `POST auth-service/v1/user-invitation/invite` | **Always emails the invited address** (welcome mail with credentials). No flag turns it off. | **off**, `--allow-team` |
| `leads` | `GET/POST v1/lead-status`, `POST v1/audience/campaign` (`send_respondent_email:false`, `to_notify:""`), `POST v1/audience/lead/submit`, `POST v1/lead-status/lead/{id}`, `POST v1/lead-followup`, `POST v1/counsellor-workbench/assign` | Each lead creates an account without email. Stage changes and assignment raise workflow events (nothing listens). Follow-ups that are due or overdue put in-app bell alerts on the admin who ran the seed. Assignment puts one in-app alert on each counsellor. | on |
| `ai_agents` | `GET/POST v1/telephony/ai-agents` | Saves configuration and copies it into the institute's calling setting. No provider call, no credits, no dialling (`speechCacheMode: OFF`, no send rules, no handoff numbers). | on |
| `assessments` | `POST question-paper/manage/v1/add`, `GET question-paper/view/v1/get-by-id`, then `basic/create/v1/submit`, `add-questions/create/v1/submit`, `add-participants/create/v1/submit`, `publish/v1/` | Workflow events only (nothing listens). All notify flags are false or 0, so neither the "added to assessment" email nor the reminder job has anything to send. | on |
| `attempts` | `GET assessment/create/v1/status`, `POST assessment/offline-entry/create-and-submit` | Marks are calculated by the real engine. Three things keep the result email from going out: the registration is created with a blank email and phone, the learner result email is off for the institute (checked before the first attempt), and the assessments use `NO_AUTO_RELEASE`. Section lookup shape is **assumed**. | on |
| `live_classes` | `POST live-sessions/v1/create/step1`, `step2` with `added_notification_actions: []`, `GET get-sessions/by-session-id`, `POST live-session/admin-mark-attendance` | No meeting room is created: the link is pasted text and the provider endpoints are forbidden in the script. With no notification actions the reminder job has nothing to send. Workflow events only. | on |
| `announcements` | `POST notification-service/v1/announcements` with `mediums: []` | **Delivered the moment it is created**: in-app alert rows for every learner in the chosen batches, and a live event to anyone signed in. No email, WhatsApp or push, and no email credits, but it is a delivery and it cannot be created as a draft. | **off**, `--allow-announcements` |

### Why two sections are off

- **team**: the only endpoint that creates a staff account sends a welcome email with credentials, every
  time. To run it, pass `--allow-team --team-email-template 'you+{key}@yourdomain'` so the four mails go to
  a mailbox you own. Until it has run, leads stay unassigned (the assignment steps wait and report
  "waiting"); run `--only leads` again afterwards. Whether the `COUNSELLOR` role exists on the server was
  not confirmed from the repo; the script stops if the invited account cannot be found afterwards.
- **announcements**: creation and delivery are the same call. The recipients are only the fictional
  learners, so nobody real is reached, but it is still a send, so you opt in.

## The dataset

- Institute: Northlight Academy, Bengaluru. Six courses, ten batches, session 2026-27.
- 120 learners with fictional Indian names, three fee plans in INR with instalments, 165 offline payments,
  a spread of fully paid, overdue, part paid and unpaid.
- 200 leads in three lead lists with sources, seven stages, 74 follow-ups (overdue, due today, upcoming),
  four counsellors.
- Three AI calling agents, three question papers (30 questions), seven assessments (one open now for three
  weeks, three upcoming, three past with 46 attempts), eight live classes (three past with attendance),
  three announcements.
- **Dates** are relative to the day you seed: `{"days": -3, "time": "17:00"}` is three days ago at 5 pm India
  time. The "live" test is open from yesterday for 21 days; after that it moves to the past tab.
- **Emails** are all at the reserved domain `example.com`, with `.nla###` / `.nlq###` in the local part so
  they cannot match an existing account (accounts are matched by email across the whole platform). No seeded
  write sends mail to them; the lint enforces the domain.
- **Phones** are `91` + a ten-digit number starting with `10` (for example `911002010001`). Indian mobile
  numbers start with 6 to 9 and no landline area code starts with 10, so these cannot be delivered to. The
  backend runs no phone validation on these endpoints (the DTO annotations are not enforced, auth only strips
  non-digits). The dashboard's own manual forms use libphonenumber and would reject these numbers, which is
  fine because the seed does not go through the forms.

## What the API cannot do

- **Backdate created dates.** Lead `submitted_at`, user `created_at`, follow-up `created_at`, announcement
  and enrolment dates are set by the database. All leads land on the day they are seeded, so the 30-day
  charts show one spike. Work-around without SQL: `--only leads --limit 15` once a day. Otherwise it needs
  an SQL update of `audience_response.submitted_at` (and `user_lead_profile.converted_at`).
- **First response time** on the CRM dashboard reads `first_response_at`, which nothing in the API sets.
  Those tiles will read zero unless set by SQL.
- **Learner activity** (slide progress, time spent, learning reports) is only recorded with the learner's
  own token. Not seeded.
- **Backdated learner join dates**: only possible together with a paid payment record; not used.
- **Staff accounts without an email** being sent.
- **Call history** for the AI agents, **course thumbnails art**, **real video links**: need real calls or
  files someone supplies.
- **Draft or back-dated announcements.**
