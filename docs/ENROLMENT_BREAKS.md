# Breaks and holds (enrolment breaks)

Status: in build (Nov 2026). First institute: an online dance school whose students take
regular breaks. Off for every institute until an admin switches it on.

## Problem

A membership today is either running or over. Institutes with monthly fees need two more states:

- **Hold reminders.** The learner is still enrolled, still pays and can still attend, but asked
  not to be chased for a while (a short trip, exams, a payment promised for next week). Class
  reminders and/or fee reminders stop until a date. Nothing else changes.
- **Pause enrolment.** The learner stops for a while (a long break, a medical issue) and does
  not pay meanwhile. Access can be removed, billing and expiry stop, and when the learner comes
  back the dates move forward by the days paused.

## Guarantees for every other institute

1. Nothing happens without a break row. Every hook first asks "does this institute have a live
   break at all?", answered from a set cached for a minute (one indexed query). An institute
   with no breaks never runs a second query and gets byte-for-byte the old behaviour.
2. The admin UI is hidden until the institute switches on **Settings → Breaks and holds**.
   The create endpoints refuse while it is off.
3. New tables only. No existing table is altered, no existing status value is added, so no
   other code that switches over a status can be surprised.

## Model

`enrolment_break` (one row per break):

| Column | Meaning |
| --- | --- |
| institute_id, user_id | Whose break |
| package_session_id | The course/batch it applies to; null = all of the learner's courses |
| user_plan_id | The membership whose billing pauses (pause only) |
| kind | `HOLD` or `PAUSE` |
| stop_class_reminders, stop_fee_reminders | What stops (both kinds) |
| remove_access | Pause only: switch the course access off while paused |
| starts_on, ends_on | Dates (institute time zone); `ends_on` null = until resumed by hand |
| status | `SCHEDULED` → `ACTIVE` → `ENDED`, or `CANCELLED` |
| reason, note | Why (a short category) and free text |
| paused_access_ids | The access rows this break switched off, so resume restores exactly those |
| resume_mode, shifted_days | How dates moved on resume |
| plan_end_before / plan_end_after | Membership end date before and after the resume |

## Effects

| Effect | Hold | Pause | Where |
| --- | --- | --- | --- |
| Class reminders stop | optional | optional (default on) | live-class reminder recipients |
| Fee and renewal reminders stop | optional | optional (default on) | fee, instalment and membership reminder senders |
| Course access removed | no | optional (default on) | access rows set INACTIVE on start, restored on end |
| Charging, renewal and expiry stop | no | yes | autopay charge, renewal and expiry processors skip the plan |
| Dates move on resume | no | yes (choice) | membership end, next charge, course access expiry |

On resume the admin chooses: move the dates forward by the days paused (default), keep the
dates, or set a new next payment date.

## Lifecycle

- A break starting today becomes `ACTIVE` at once. One starting later stays `SCHEDULED`.
- A daily job (ShedLock) starts scheduled breaks whose day has come and ends breaks whose
  `ends_on` has passed. Ending a pause on schedule uses the default resume mode.
- Only one live (scheduled or active) break per learner and course.
- Every start, change and end is written to the learner's timeline and the admin activity log.

## API (admin, institute-scoped)

`/admin-core-service/v1/enrolment-breaks`

- `GET  /settings?instituteId=` and `PUT /settings?instituteId=`: the on/off switch
- `GET  /learner/{userId}?instituteId=`: the learner's breaks and the courses a break can apply to
- `POST /preview?instituteId=`: what a new break would do (dates, effects), saves nothing
- `POST /?instituteId=`: create
- `PUT  /{id}?instituteId=`: change the end date or note
- `POST /{id}/end/preview?instituteId=` and `POST /{id}/end?instituteId=`: resume now
- `POST /{id}/cancel?instituteId=`: cancel a scheduled break
