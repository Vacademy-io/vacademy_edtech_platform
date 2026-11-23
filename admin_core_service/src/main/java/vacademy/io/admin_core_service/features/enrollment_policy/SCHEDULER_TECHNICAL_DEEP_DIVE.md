# PackageSessionScheduler — Technical Deep Dive

## What This Scheduler Does

`PackageSessionScheduler` is the **subscription lifecycle engine** for the Vacademy platform.
It runs once a day (1:00 AM server time) and drives every stage of a user's or sub-org's
subscription life: pre-expiry reminders, auto-renewal payment attempts, grace-period access,
and final access revocation.

It is **not** just a renewal job. It is a state machine that routes each `UserPlan` to the
correct processor based on where it sits in the subscription timeline.

---

## Trigger

```
Cron: 0 0 4 * * ?    →   Every day at 04:00 (server JVM timezone), ShedLock-guarded,
                         only for institutes with PAYMENT_SETTING.packageSessionRenewalSchedulerEnabled = true
```

Entry point:

```
PackageSessionScheduler.processPackageSessionRenewals()
  └─ PackageSessionEnrolmentService.processActiveEnrollmentsForInstitutes(instituteIds)
```

---

## Files Involved (Full Map)

```
enrollment_policy/
│
├── scheduler/
│   └── PackageSessionScheduler.java              ← CRON trigger
│
├── service/
│   ├── PackageSessionEnrolmentService.java       ← Main orchestrator
│   ├── PaymentRenewalCheckService.java           ← Should we attempt payment?
│   ├── SubOrgPaymentService.java                 ← Executes payment for sub-orgs
│   ├── SubOrgAdminService.java                   ← Fetches ROOT_ADMIN for sub-orgs
│   ├── RenewalPaymentService.java                ← Handles payment webhook callbacks
│   ├── EnrollmentTemplateService.java            ← Loads/renders email templates
│   └── ReenrollmentGapValidationService.java     ← Validates re-enrollment gap rules
│
├── processor/
│   ├── IEnrolmentPolicyProcessor.java            ← Processor interface
│   ├── EnrolmentProcessorFactory.java            ← Routes to correct processor
│   ├── EnrolmentContext.java                     ← Data bag for one UserPlan run
│   ├── PreExpiryProcessor.java                   ← Days before expiry
│   ├── WaitingPeriodProcessor.java               ← Day 0 through last grace day
│   ├── FinalExpiryProcessor.java                 ← After grace period ends
│   └── PaymentAttemptResult.java                 ← ThreadLocal payment cache
│
├── notification/
│   ├── INotificationService.java                 ← Notification interface
│   ├── NotificationServiceFactory.java           ← Routes to channel service
│   ├── EmailNotificationService.java             ← Sends emails
│   ├── WhatsAppNotificationService.java          ← Sends WhatsApp (partial)
│   └── PushNotificationService.java              ← Sends push (stub, not implemented)
│
├── dto/
│   ├── EnrollmentPolicySettingsDTO.java          ← Root policy config
│   ├── OnExpiryPolicyDTO.java                    ← Grace period + auto-renewal flag
│   ├── ReenrollmentPolicyDTO.java                ← Gap rules, upgrade options
│   ├── NotificationPolicyDTO.java                ← Trigger + frequency config
│   ├── ChannelNotificationDTO.java               ← Per-channel config
│   ├── NotificationConfigDTO.java                ← Base notification config
│   ├── EmailNotificationContentDTO.java          ← Email subject + body
│   ├── WhatsAppNotificationContentDTO.java       ← WhatsApp template + params
│   ├── WorkflowConfigDTO.java                    ← Workflow triggers + frontend actions
│   ├── UpgradeOptionDTO.java                     ← Upgrade button/link for frontend
│   └── FrontendActionDTO.java                    ← Generic frontend action
│
├── enums/
│   ├── NotificationTriggerType.java              ← BEFORE_EXPIRY | ON_EXPIRY_DATE_REACHED | DURING_WAITING_PERIOD
│   ├── NotificationType.java                     ← EMAIL | WHATSAPP | PUSH
│   └── ActiveRepurchaseBehavior.java             ← STACK | OVERWRITE | EXTEND
│
├── constants/
│   └── EnrollmentTemplateConstants.java          ← Default email template HTML + subject
│
├── controller/
│   └── EnrollmentPolicyController.java           ← GET policy by packageSessionId
│
└── ENROLLMENT_POLICY_COMPREHENSIVE_GUIDE.md      ← Existing test case matrix
```

---

## Lifecycle State Machine

```
UserPlan.endDate relative to TODAY
────────────────────────────────────────────────────────────────

  [endDate - N days]          [endDate]         [endDate + waitingPeriod]
        │                        │                        │
        ▼                        ▼                        ▼
  PRE-EXPIRY              WAITING PERIOD             FINAL EXPIRY
  PreExpiryProcessor      WaitingPeriodProcessor     FinalExpiryProcessor
        │                        │                        │
  Send BEFORE_EXPIRY       Day 0: Payment #1        Move mappings → INVITED
  notifications            Day N: Payment #2         Mark UserPlan → EXPIRED
                           Daily notifications       Activate stacked PENDING plan
                           (grace period)            (if any)
```

### Factory Routing Logic (`EnrolmentProcessorFactory.getProcessor`)

| Condition                                      | Processor Selected       |
|------------------------------------------------|--------------------------|
| `endDate == null`                              | No processor (skip)      |
| `daysPastExpiry > waitingPeriod`               | `FinalExpiryProcessor`   |
| `daysPastExpiry >= 0`                          | `WaitingPeriodProcessor` |
| `daysPastExpiry < 0` (i.e., days until expiry) | `PreExpiryProcessor`     |

---

## Method Call Chain

### Step 1 — Scheduler Entry

```
PackageSessionScheduler
  └── processPackageSessionRenewals()
        └── PackageSessionEnrolmentService.processActiveEnrollmentsForInstitutes(instituteIds)
```

### Step 2 — Load and Group Plans

```
PackageSessionEnrolmentService
  └── processActiveEnrollmentsForInstitutes(instituteIds)
        ├── userPlanRepository.findAllByStatusInAndInstituteIdIn(["ACTIVE", "CANCELED"], instituteIds)
        ├── Group by source → USER plans, SUB_ORG plans
        ├── processUserSourcePlans(userPlans)
        │     └── processUserPlan(userPlan)  [for each USER plan]
        └── processSubOrgSourcePlans(userPlans)
              └── processUserPlan(userPlan)  [for each SUB_ORG plan]
```

### Step 3 — Process Single UserPlan

```
processUserPlan(UserPlan userPlan)
  ├── initializeUserPlanDatesFromMappings(userPlan)
  │     ├── mappingRepository.findByUserPlanIdAndStatus(id, "ACTIVE")
  │     ├── startDate ← min(mapping.enrolledDate)
  │     └── endDate   ← max(mapping.expiryDate)
  │
  ├── mappingRepository.findByUserPlanIdAndStatus(id, "ACTIVE")   ← all active mappings
  │
  ├── getRepresentativeUser(userPlan, mappings, isSubOrg)
  │     ├── [USER]    → authServiceClient.getUserById(userId)
  │     └── [SUB_ORG] → SubOrgAdminService.getRootAdminForSubOrg(subOrgId, packageSessionId)
  │
  ├── Build Map<packageSessionId, EnrollmentPolicySettingsDTO>
  │     └── parsePolicy(mapping.packageSession.enrollmentPolicySettings)
  │
  ├── new EnrolmentContext(userPlan, mappings, policiesByPackageSessionId, user)
  │
  └── EnrolmentProcessorFactory.getProcessor(context)
        └── processor.process(context)
```

### Step 4a — PreExpiryProcessor

```
PreExpiryProcessor.process(context)
  ├── context.getDaysUntilExpiry()
  ├── findNotificationsToProcess(context, daysUntilExpiry)
  │     └── Filter policies where:
  │           trigger == BEFORE_EXPIRY
  │           AND effectiveDaysBefore == daysUntilExpiry  (or interval match)
  └── sendNotificationsToUser(context, notifications)
        └── sendChannelNotifications(context, policy)
              ├── NotificationServiceFactory.getService(NotificationType.EMAIL)
              └── emailService.sendNotification(context, policy)
```

### Step 4b — WaitingPeriodProcessor (the core)

```
WaitingPeriodProcessor.process(context)
  │
  ├── [If daysPastExpiry == 0 — EXPIRY DATE]
  │     ├── PaymentRenewalCheckService.shouldAttemptPayment(userPlan, policy)
  │     │     ├── Check vendor != MANUAL
  │     │     ├── Check paymentOption.type == SUBSCRIPTION
  │     │     └── Check policy.onExpiry.enableAutoRenewal == true
  │     │
  │     ├── [If should attempt] → processPaymentOnExpiry(...)
  │     │     └── SubOrgPaymentService.processSubOrgPaymentOnExpiry(context, userPlan)
  │     │           ├── extractPaymentRequest(userPlan)
  │     │           ├── getVendor / getVendorId / getCurrency / getPaymentAmount
  │     │           └── paymentService.handlePaymentWithUser(...)
  │     │
  │     └── [If auto-renewal disabled] → handleNonRenewableExpiry(...)
  │           └── Mark UserPlan as EXPIRED, notify admins
  │
  ├── [If daysPastExpiry == waitingPeriod — LAST GRACE DAY]
  │     ├── checkIfFirstPaymentFailed(userPlan)
  │     │     └── paymentLogRepository.findByUserPlanIdOrderByCreatedAtDesc(id)
  │     │           └── Returns true if latest log.status == "FAILED"
  │     │
  │     └── [If first payment failed] → processPaymentRetryOnLastDay(...)
  │           └── SubOrgPaymentService.processSubOrgPaymentOnExpiry(...)  [ATTEMPT #2]
  │
  ├── [If waiting period == 0 — no grace]
  │     └── moveAllMappingsToInvited(mappings, userPlan)
  │           ├── Mark UserPlan as EXPIRED first
  │           ├── For each mapping with expired expiryDate:
  │           │     └── createInvitedEntry(mapping)
  │           │           ├── getInvitedPackageSession(packageSession)
  │           │           │     └── packageSessionRepository.findInvitedPackageSession(...)
  │           │           └── Save new mapping with status=INVITED, source=EXPIRED
  │           └── Mark original mapping as TERMINATED
  │
  └── processNotifications(context, daysPastExpiry)
        ├── [SUB_ORG] → processSubOrgNotifications(context, daysPastExpiry)
        └── [USER]    → processIndividualNotifications(context, daysPastExpiry)
              └── shouldSendNotification(policy, daysPastExpiry)
                    ├── ON_EXPIRY_DATE_REACHED → daysPastExpiry == 0
                    └── DURING_WAITING_PERIOD  → sendEveryNDays interval, respects startAfterDay + maxSends
```

### Step 4c — FinalExpiryProcessor

```
FinalExpiryProcessor.process(context)
  │
  ├── [SUB_ORG] → handleSubOrgExpiry(context, userPlan)
  │     ├── Check for stacked PENDING plan → activate if found
  │     ├── Notify admins (SubOrgAdminService.getActiveAdminsForSubOrg)
  │     ├── moveAllMappingsToInvitedAndExpireUserPlan(mappings, userPlan)
  │     └── Deactivate scoped FREE invites
  │
  └── [USER] → handleIndividualUserExpiry(context, userPlan)
        ├── Check for stacked PENDING plan → activate if found
        ├── sendExpiryNotificationsToUser(context)
        └── moveAllMappingsToInvitedAndExpireUserPlan(mappings, userPlan)
              ├── Mark UserPlan as EXPIRED FIRST (prevents re-processing)
              ├── For each mapping where mapping.expiryDate <= TODAY:
              │     ├── findExistingInvitedMapping(originalMapping)
              │     │     └── Find by userId + packageSessionId=INVITED + source=EXPIRED
              │     ├── [Found] → updateInvitedMapping(invitedMapping, originalMapping)
              │     ├── [Not found] → createInvitedEntry(mapping)
              │     │     └── getInvitedPackageSession(packageSession)
              │     └── Mark original mapping as DELETED (only if INVITED entry saved)
              └── [Skip] mappings with future expiryDate
```

### Step 5 — Payment Webhook (Async)

```
RenewalPaymentService.handleRenewalPaymentConfirmation(orderId, instituteId, status, details)
  ├── Find PaymentLog by orderId → get UserPlan
  ├── [PAID/SUCCESS/CAPTURED] → handleSuccessfulRenewal(userPlan, instituteId)
  │     ├── calculateNewEndDate(userPlan)   ← currentEndDate + period (default 30 days, TODO: from plan)
  │     ├── Extend UserPlan.endDate
  │     ├── Extend all ACTIVE mappings' expiryDate
  │     └── sendRenewalSuccessNotification(...)   ← TODO: actual impl
  ├── [FAILED] → handleFailedRenewal(userPlan, instituteId)
  │     └── sendRenewalFailureNotification(...)   ← TODO: actual impl
  └── [PENDING] → log and wait for final webhook
```

---

## Key Domain Concepts

### UserPlan
Central subscription record.
- `status`: ACTIVE | EXPIRED | CANCELED | TERMINATED | PENDING
- `source`: USER | SUB_ORG
- `endDate`: expiry date (may be null initially — initialized from mappings)
- `subOrgId`: set only when source == SUB_ORG

### StudentSessionInstituteGroupMapping
Enrollment record connecting a user to a package session.
- `status`: ACTIVE | INVITED | TERMINATED | DELETED
- `expiryDate`: access cutoff for this specific mapping
- `source`: EXPIRED (when created during expiry flow)
- `typeId`: points back to the original mapping ID after expiry transition

### EnrollmentPolicySettings (JSON in PackageSession)
Policy stored as JSON on each PackageSession:
```json
{
  "onExpiry": {
    "waitingPeriodInDays": 7,
    "enableAutoRenewal": true
  },
  "notifications": [
    { "trigger": "BEFORE_EXPIRY", "daysBeforeExpiry": 7, "notificationConfig": {...} },
    { "trigger": "ON_EXPIRY_DATE_REACHED", "notificationConfig": {...} },
    { "trigger": "DURING_WAITING_PERIOD", "sendEveryNDays": 2, "maxSends": 3, "startAfterDay": 1, "notificationConfig": {...} }
  ],
  "reenrollmentPolicy": {
    "allowReenrollmentAfterExpiry": true,
    "reenrollmentGapInDays": 30,
    "activeRepurchaseBehavior": "STACK"
  }
}
```

### INVITED Package Session
Each course package must have a special entry with `levelId="INVITED"` and `sessionId="INVITED"`.
When a user loses access, their mapping is moved to point at this INVITED package session —
keeping a record that they used to have access, so they can be re-enrolled later.

---

## Payment Decision Logic

```
shouldAttemptPayment(userPlan, policy)
    │
    ├── vendor == MANUAL?          → NO payment (manual only)
    ├── paymentOption.type == FREE?      → NO payment
    ├── paymentOption.type == DONATION?  → NO payment
    ├── paymentOption.type == ONE_TIME?  → NO payment
    ├── policy.onExpiry.enableAutoRenewal == false? → NO payment
    └── All checks pass → YES, attempt payment
```

Two attempts maximum:
- **Attempt #1:** Day 0 (exact expiry date)
- **Attempt #2:** Last day of waiting period, only if Attempt #1 status is `FAILED`
  - If Attempt #1 is `PENDING` → skip retry (webhook still pending)
  - If Attempt #1 is `SUCCESS` → skip retry (already renewed)

---

## Notification Trigger Rules

| Trigger Type             | Fires When                                       | Config Fields Used                        |
|--------------------------|--------------------------------------------------|-------------------------------------------|
| `BEFORE_EXPIRY`          | `daysUntilExpiry == daysBeforeExpiry`            | `daysBeforeExpiry` (or legacy `daysBefore`) |
| `ON_EXPIRY_DATE_REACHED` | `daysPastExpiry == 0`                            | None (fires once)                         |
| `DURING_WAITING_PERIOD`  | `daysPastExpiry % sendEveryNDays == 0` AND `daysPastExpiry >= startAfterDay` AND `sendCount < maxSends` | `sendEveryNDays`, `startAfterDay`, `maxSends` |

Notification channels: `EMAIL`, `WHATSAPP` (partial), `PUSH` (not implemented).

---

## SUB_ORG vs Individual User Differences

| Behavior                          | Individual User                        | SUB_ORG                                 |
|-----------------------------------|----------------------------------------|-----------------------------------------|
| Representative user fetched       | The enrolled user                      | ROOT_ADMIN of the sub-org               |
| Notifications sent to             | Individual user                        | ROOT_ADMIN only                         |
| Payment initiated by              | N/A (individual side TBD)              | SubOrgPaymentService → ROOT_ADMIN       |
| On expiry: stacked PENDING plan   | Activated if exists                    | Activated if exists                     |
| On expiry: scoped FREE invites    | Not applicable                         | Deactivated                             |
| Processing unit                   | Per UserPlan                           | Per UserPlan (not per user)             |

---

## Known Issues

### 1. No Distributed Lock
**Severity: Critical**

The scheduler uses `@Scheduled` with no distributed coordination. In any multi-instance deployment
(Docker, Kubernetes, or even two JVM restarts within the same minute), all instances fire simultaneously
and process every `UserPlan` in parallel. This causes:
- Duplicate payment attempts for the same plan on the same day.
- Duplicate notifications.
- Race conditions on `UserPlan.status` updates (one instance marks EXPIRED while another is
  still mid-processing, causing inconsistent state).

**Fix needed:** A distributed lock using Redis (`Redisson`), a database advisory lock, or
a dedicated job-runner service (like Quartz with JDBC store, or ShedLock).

---

### 2. Full Table Scan Into Memory
**Severity: High**

```java
userPlanRepository.findAllByStatusIn(List.of("ACTIVE", "CANCELED"))
```

This loads every active/canceled plan across all institutes in a single query into the JVM heap.
At 10,000 plans this is manageable; at 100,000+ it causes OOM or GC pressure that degrades
other requests running on the same instance.

**Fix needed:** Paginate using `Pageable` with a page size of 100–500, or use a database
cursor/stream (`@QueryHints` with `HINT_FETCH_SIZE`).

---

### 3. No Per-Plan Idempotency Guard
**Severity: High**

If the scheduler crashes halfway through (e.g., OOM, deployment rollout), it restarts and
re-processes plans that were already partially handled. Plans at Day 0 could get a second
`PAYMENT ATTEMPT #1` before the webhook from the first attempt arrives.

**Fix needed:** A `lastProcessedDate` column on `UserPlan` — skip the plan if
`lastProcessedDate == TODAY`.

---

### 4. Unspecified Cron Timezone
**Severity: Medium**

```java
@Scheduled(cron = "0 0 1 * * ?")   // no zone attribute
```

This fires at 1:00 AM in whatever timezone the JVM is running in. If the server runs in UTC but
users are in IST (+5:30), "1 AM UTC" is 6:30 AM IST — mid-morning, not low-traffic.

**Fix needed:**
```java
@Scheduled(cron = "0 0 1 * * ?", zone = "Asia/Kolkata")
```

---

### 5. Silent Per-Plan Failure
**Severity: Medium**

`processActiveEnrollmentsForInstitutes()` iterates plans and catches exceptions inside each `processUserPlan()`.
A single plan with malformed policy JSON silently logs and continues. There is no:
- Dead-letter queue for failed plans.
- Alerting/metrics on per-plan failure rate.
- Retry for transiently failed plans (e.g., auth service was briefly down).

**Fix needed:** Track failed plan IDs in a table (`scheduler_failure_log`) with reason and
timestamp. Add a Prometheus counter for failures.

---

### 6. Policy JSON Has No Schema Validation at Write Time
**Severity: Medium**

`enrollmentPolicySettings` is stored as a raw JSON string in `PackageSession`. If a misconfigured
policy is saved (missing `waitingPeriodInDays`, wrong data types), it fails at runtime during
the nightly job — not at save time. There is no validation in the enrollment policy controller.

**Fix needed:** Validate `EnrollmentPolicySettingsDTO` in the save/update endpoint before
persisting to the database.

---

### 7. Renewal Period is Hardcoded to 30 Days
**Severity: Medium**

```java
// RenewalPaymentService.calculateNewEndDate()
// TODO: Extract actual period from paymentPlan or planJson
int daysToAdd = 30;  // hardcoded default
```

Subscriptions with 90-day or annual periods will be renewed incorrectly as 30-day extensions.
This also means a user who pays for a yearly plan gets only 30 days added after renewal.

**Fix needed:** Read the period from `PaymentPlan.validityInDays` or `jsonPaymentDetails`.

---

### 8. WhatsApp and Push Notifications Are Stubs
**Severity: Low (for now)**

`WhatsAppNotificationService` partially logs intent but does not actually send messages.
`PushNotificationService` is a full stub with a `// TODO` placeholder. Any policy
configured to send notifications via these channels silently does nothing.

**Fix needed:** Implement or clearly disable at the factory level so the channels are
not advertised as functional.

---

### 9. Two Payment Attempts May Not Be Enough
**Severity: Low (design concern)**

Real-world payment systems typically retry 3–5 times with exponential backoff over a grace
period (e.g., day 0, day 2, day 5, day 7 of a 7-day window). The current design fires exactly
twice — day 0 and last day. A transient card network failure on both days means the subscription
expires even though the user's card is valid.

**Fix needed:** Make the retry schedule configurable in `OnExpiryPolicyDTO`
(e.g., `retryOnDays: [0, 2, 5, 7]`).

---

## Summary Table

| Area                     | File                                  | Status          |
|--------------------------|---------------------------------------|-----------------|
| Cron trigger             | `PackageSessionScheduler.java`        | Works, missing timezone + distributed lock |
| Main orchestrator        | `PackageSessionEnrolmentService.java` | Works, missing pagination + idempotency |
| Processor routing        | `EnrolmentProcessorFactory.java`      | Works correctly |
| Pre-expiry notifications | `PreExpiryProcessor.java`             | Works (email only) |
| Payment attempt #1       | `WaitingPeriodProcessor.java`         | Works, idempotency risk |
| Payment retry #2         | `WaitingPeriodProcessor.java`         | Works |
| Mapping → INVITED        | `FinalExpiryProcessor.java`           | Works |
| Payment webhook          | `RenewalPaymentService.java`          | Works, renewal period hardcoded |
| Email notifications      | `EmailNotificationService.java`       | Works |
| WhatsApp notifications   | `WhatsAppNotificationService.java`    | Stub — not functional |
| Push notifications       | `PushNotificationService.java`        | Stub — not functional |
| Template rendering       | `EnrollmentTemplateService.java`      | Works |
| Re-enrollment gap check  | `ReenrollmentGapValidationService.java` | Works |
| Policy JSON validation   | None                                  | Missing — runtime risk |
| Distributed lock         | None                                  | Missing — critical risk |

---

*Last updated: 2026-05-01*
