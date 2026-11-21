# 💳 Payments, Memberships & Enrollment Management System

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Database Schema](#database-schema)
3. [API Reference](#api-reference)
4. [Scheduler Jobs](#scheduler-jobs)
5. [Payment Gateway Integrations](#payment-gateway-integrations)
6. [Enrollment Policy Lifecycle](#enrollment-policy-lifecycle)
7. [Notification System](#notification-system)
8. [Security Considerations](#security-considerations)
9. [Bulk Assign / De-assign APIs](#bulk-assign--de-assign-apis)
10. [Coupon Code System](#coupon-code-system)
11. [Referral System Enhancement](#referral-system-enhancement)
12. [Additional API Endpoints](#additional-api-endpoints)
13. [Detailed Policy Configuration](#detailed-policy-configuration)
14. [Sub-Organization Settings](#sub-organization-settings)
15. [Renewal Payment Service](#renewal-payment-service)

---

## 🎯 System Overview

The Vacademy platform implements a comprehensive **payments, memberships, and enrollment management system** that handles:

- **Enrollment Invites**: Configurable enrollment links with payment options
- **Payment Processing**: Multi-gateway support (Razorpay, Stripe, PhonePe, eWay)
- **Subscription Management**: UserPlans with auto-renewal capabilities
- **Enrollment Policies**: Automated expiry handling with grace periods
- **Referral System**: Discount options for referrers and referees

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ENROLLMENT FLOW                               │
└─────────────────────────────────────────────────────────────────────┘

  EnrollInvite (Configuration)
        │
        ├── PaymentOption (Type: SUBSCRIPTION/ONE_TIME/FREE/DONATION)
        │       │
        │       └── PaymentPlan (Pricing, Duration)
        │               │
        │               └── ReferralOption (Discounts)
        │
        └── PackageSession (Course/Batch Access)
                │
                └── UserPlan (User's Subscription)
                        │
                        ├── PaymentLog (Transaction Records)
                        └── StudentSessionInstituteGroupMapping (Access Control)
```

---

## 🗄️ Database Schema

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CORE DATABASE ENTITIES                            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  enroll_invite  │────▶│ package_session │     │ payment_option  │
│─────────────────│     │_learner_invita- │     │─────────────────│
│ id (PK)         │     │tion_to_payment_ │◀────│ id (PK)         │
│ name            │     │ option          │     │ name            │
│ invite_code     │     │─────────────────│     │ type            │
│ institute_id    │     │ id (PK)         │     │ source          │
│ vendor          │     │ enroll_invite_id│     │ require_approval│
│ vendor_id       │     │ package_session │     └────────┬────────┘
│ currency        │     │ _id             │              │
│ tag             │     │ payment_option  │              │ 1:N
│ setting_json    │     │ _id             │              ▼
└────────┬────────┘     │ status          │     ┌─────────────────┐
         │              └─────────────────┘     │  payment_plan   │
         │                                      │─────────────────│
         ▼                                      │ id (PK)         │
┌─────────────────┐                             │ name            │
│   user_plan     │                             │ validity_in_days│
│─────────────────│                             │ actual_price    │
│ id (PK)         │                             │ elevated_price  │
│ user_id         │                             │ currency        │
│ enroll_invite_id│                             │ member_count    │
│ payment_plan_id │                             │ payment_option  │
│ payment_option  │                             │ _id (FK)        │
│ _id             │                             └─────────────────┘
│ status          │
│ source          │                             ┌─────────────────┐
│ sub_org_id      │                             │ referral_option │
│ start_date      │                             │─────────────────│
│ end_date        │                             │ id (PK)         │
└────────┬────────┘                             │ name            │
         │                                      │ source          │
         │ 1:N                                  │ referrer_discount│
         ▼                                      │ _json           │
┌─────────────────┐                             │ referee_discount│
│  payment_log    │                             │ _json           │
│─────────────────│                             │ referrer_vesting│
│ id (PK)         │                             │ _days           │
│ user_plan_id(FK)│                             └─────────────────┘
│ user_id         │
│ payment_status  │
│ payment_amount  │
│ vendor          │
│ vendor_id       │
│ currency        │
│ payment_specific│
│ _data (JSON)    │
└─────────────────┘
```

### Table Definitions

#### 1. `enroll_invite`

The main configuration entity for enrollment links.

| Column                    | Type      | Description                                     |
| ------------------------- | --------- | ----------------------------------------------- |
| `id`                      | UUID (PK) | Unique identifier                               |
| `name`                    | VARCHAR   | Human-readable name                             |
| `invite_code`             | VARCHAR   | Unique code for enrollment URL                  |
| `start_date`              | DATE      | When invite becomes active                      |
| `end_date`                | DATE      | When invite expires                             |
| `status`                  | VARCHAR   | ACTIVE, INACTIVE, DELETED                       |
| `institute_id`            | UUID (FK) | Associated institute                            |
| `vendor`                  | VARCHAR   | Payment gateway vendor (RAZORPAY, STRIPE, etc.) |
| `vendor_id`               | VARCHAR   | Payment gateway account ID                      |
| `currency`                | VARCHAR   | Default currency (INR, USD, etc.)               |
| `tag`                     | VARCHAR   | DEFAULT, CUSTOM                                 |
| `is_bundled`              | BOOLEAN   | Whether multiple package sessions are bundled   |
| `learner_access_days`     | INTEGER   | Default access duration                         |
| `setting_json`            | TEXT      | Additional configuration JSON                   |
| `web_page_meta_data_json` | TEXT      | Landing page configuration                      |

#### 2. `payment_option`

Defines payment types and configuration.

| Column                         | Type      | Description                                            |
| ------------------------------ | --------- | ------------------------------------------------------ |
| `id`                           | UUID (PK) | Unique identifier                                      |
| `name`                         | VARCHAR   | Display name                                           |
| `type`                         | VARCHAR   | **SUBSCRIPTION**, **ONE_TIME**, **FREE**, **DONATION** |
| `status`                       | VARCHAR   | ACTIVE, INACTIVE                                       |
| `source`                       | VARCHAR   | PACKAGE_SESSION, INSTITUTE                             |
| `source_id`                    | UUID      | Reference to source entity                             |
| `tag`                          | VARCHAR   | DEFAULT, CUSTOM                                        |
| `unit`                         | VARCHAR   | Billing unit (MONTH, YEAR)                             |
| `require_approval`             | BOOLEAN   | Whether admin approval is needed                       |
| `payment_option_metadata_json` | TEXT      | Additional metadata                                    |

**Payment Option Types:**

| Type           | Description              | Auto-Renewal        | Payment Attempts                       |
| -------------- | ------------------------ | ------------------- | -------------------------------------- |
| `SUBSCRIPTION` | Recurring payments       | ✅ Yes (if enabled) | 2 (Day 0 + Last day of waiting period) |
| `ONE_TIME`     | Single payment           | ❌ No               | 1                                      |
| `FREE`         | No payment required      | ❌ No               | 0                                      |
| `DONATION`     | Variable amount donation | ❌ No               | 1                                      |

#### 3. `payment_plan`

Defines pricing and validity for a payment option.

| Column              | Type      | Description                   |
| ------------------- | --------- | ----------------------------- |
| `id`                | UUID (PK) | Unique identifier             |
| `name`              | VARCHAR   | Plan name                     |
| `payment_option_id` | UUID (FK) | Parent payment option         |
| `status`            | VARCHAR   | ACTIVE, INACTIVE              |
| `validity_in_days`  | INTEGER   | Subscription duration         |
| `actual_price`      | DECIMAL   | Discounted/final price        |
| `elevated_price`    | DECIMAL   | Original/strike-through price |
| `currency`          | VARCHAR   | Currency code                 |
| `description`       | TEXT      | Plan description              |
| `tag`               | VARCHAR   | DEFAULT, FEATURED             |
| `feature_json`      | TEXT      | Features list (JSON)          |
| `member_count`      | INTEGER   | For organization plans        |

#### 4. `user_plan`

Represents a user's subscription/membership.

| Column                       | Type      | Description                                                                 |
| ---------------------------- | --------- | --------------------------------------------------------------------------- |
| `id`                         | UUID (PK) | Unique identifier                                                           |
| `user_id`                    | UUID      | User who owns this plan                                                     |
| `enroll_invite_id`           | UUID (FK) | Source enrollment invite                                                    |
| `plan_id`                    | UUID (FK) | Payment plan selected                                                       |
| `payment_option_id`          | UUID (FK) | Payment option selected                                                     |
| `status`                     | VARCHAR   | **PENDING_FOR_PAYMENT**, **ACTIVE**, **PENDING**, **CANCELED**, **EXPIRED** |
| `source`                     | VARCHAR   | **USER** (individual), **SUB_ORG** (organization)                           |
| `sub_org_id`                 | UUID      | Organization ID (if source=SUB_ORG)                                         |
| `start_date`                 | TIMESTAMP | Plan start date                                                             |
| `end_date`                   | TIMESTAMP | Plan end date (expiry)                                                      |
| `plan_json`                  | TEXT      | Snapshot of plan at purchase                                                |
| `payment_option_json`        | TEXT      | Snapshot of payment option at purchase                                      |
| `applied_coupon_discount_id` | UUID (FK) | Applied coupon                                                              |

**UserPlan Status Flow:**

```
PENDING_FOR_PAYMENT ──[Payment Success]──▶ ACTIVE
                                              │
ACTIVE ──[Expiry + Waiting Period]──▶ EXPIRED
ACTIVE ──[User Cancels]──▶ CANCELED
CANCELED ──[Waiting Period Ends]──▶ EXPIRED

PENDING ──[Stacked plan activated]──▶ ACTIVE
```

#### 5. `payment_log`

Transaction records for all payment attempts.

| Column                  | Type      | Description                                             |
| ----------------------- | --------- | ------------------------------------------------------- |
| `id`                    | UUID (PK) | Also serves as `orderId`                                |
| `user_plan_id`          | UUID (FK) | Associated user plan                                    |
| `user_id`               | UUID      | User who made payment                                   |
| `status`                | VARCHAR   | INITIATED, ACTIVE, COMPLETED                            |
| `payment_status`        | VARCHAR   | **PAYMENT_PENDING**, **PAID**, **FAILED**, **REFUNDED** |
| `payment_amount`        | DECIMAL   | Transaction amount                                      |
| `vendor`                | VARCHAR   | Payment gateway used                                    |
| `vendor_id`             | VARCHAR   | Payment gateway account                                 |
| `currency`              | VARCHAR   | Currency code                                           |
| `date`                  | TIMESTAMP | Transaction date                                        |
| `payment_specific_data` | TEXT      | Gateway-specific response data (JSON)                   |

**Payment Specific Data Structure:**

```json
{
  "response": {
    "order_id": "da463c03-...",
    "response_data": {
      "razorpayKeyId": "rzp_test_...",
      "razorpayOrderId": "order_RZc...",
      "amount": 100000,
      "currency": "INR",
      "customerId": "cust_RZa...",
      "paymentStatus": "PAYMENT_PENDING"
    }
  },
  "originalRequest": {
    "amount": 1000.0,
    "currency": "INR",
    "instituteId": "0e5fd21c-..."
  }
}
```

#### 6. `web_hook`

Stores incoming webhook events from payment gateways.

| Column          | Type      | Description                            |
| --------------- | --------- | -------------------------------------- |
| `id`            | UUID (PK) | Unique identifier                      |
| `event_type`    | VARCHAR   | payment.captured, payment.failed, etc. |
| `vendor`        | VARCHAR   | RAZORPAY, STRIPE, PHONEPE              |
| `payload`       | TEXT      | Raw webhook payload                    |
| `status`        | ENUM      | RECEIVED, PROCESSED, FAILED            |
| `order_id`      | VARCHAR   | Our payment_log ID                     |
| `processed_at`  | TIMESTAMP | When processing completed              |
| `error_message` | TEXT      | Error details if failed                |

#### 7. `package_session_learner_invitation_to_payment_option`

Links EnrollInvite → PackageSession → PaymentOption.

| Column               | Type      | Description                 |
| -------------------- | --------- | --------------------------- |
| `id`                 | UUID (PK) | Unique identifier           |
| `enroll_invite_id`   | UUID (FK) | Parent enrollment invite    |
| `package_session_id` | UUID (FK) | Course/batch being enrolled |
| `payment_option_id`  | UUID (FK) | Available payment option    |
| `status`             | VARCHAR   | ACTIVE, INACTIVE            |

#### 8. `package_session_enroll_invite_payment_plan_to_referral_option`

Links PaymentPlan → ReferralOption for discount eligibility.

| Column                                     | Type      | Description              |
| ------------------------------------------ | --------- | ------------------------ |
| `id`                                       | UUID (PK) | Unique identifier        |
| `payment_plan_id`                          | UUID (FK) | Payment plan             |
| `referral_option_id`                       | UUID (FK) | Referral discount option |
| `package_session_invite_payment_option_id` | UUID (FK) | Parent mapping           |
| `status`                                   | VARCHAR   | ACTIVE, INACTIVE         |

#### 9. `referral_option`

Defines referral discount configurations.

| Column                   | Type      | Description                       |
| ------------------------ | --------- | --------------------------------- |
| `id`                     | UUID (PK) | Unique identifier                 |
| `name`                   | VARCHAR   | Display name                      |
| `source`                 | VARCHAR   | CAMPAIGN, USER_REFERRAL           |
| `source_id`              | VARCHAR   | Campaign or user ID               |
| `status`                 | VARCHAR   | ACTIVE, INACTIVE, EXPIRED         |
| `referrer_discount_json` | TEXT      | Discount for referrer             |
| `referee_discount_json`  | TEXT      | Discount for new user             |
| `referrer_vesting_days`  | INTEGER   | Days before referrer gets benefit |
| `tag`                    | VARCHAR   | Category tag                      |
| `setting_json`           | TEXT      | Additional settings               |

#### 10. `user_institute_payment_gateway_mapping`

Stores user's payment gateway customer data for recurring payments.

| Column                                 | Type      | Description                         |
| -------------------------------------- | --------- | ----------------------------------- |
| `id`                                   | UUID (PK) | Unique identifier                   |
| `user_id`                              | UUID      | User ID                             |
| `institute_payment_gateway_mapping_id` | UUID (FK) | Institute's gateway config          |
| `payment_gateway_customer_id`          | VARCHAR   | Gateway's customer ID               |
| `payment_gateway_customer_data`        | TEXT      | Customer data JSON (includes token) |
| `status`                               | VARCHAR   | ACTIVE, INACTIVE                    |

**Customer Data Structure (with saved payment method):**

```json
{
  "id": "cust_RZaONpDjISFY1C",
  "entity": "customer",
  "email": "student@example.com",
  "name": "John Doe",
  "contact": "+919876543210",
  "paymentMethodId": "token_RZcDqwerty54321",
  "paymentMethodType": "card",
  "cardLast4": "1111",
  "cardBrand": "Visa",
  "paymentMethodUpdatedAt": "2025-11-01T14:30:00"
}
```

#### 11. `student_session_institute_group_mapping`

Controls user's access to courses/batches.

| Column                           | Type      | Description                                          |
| -------------------------------- | --------- | ---------------------------------------------------- |
| `id`                             | UUID (PK) | Unique identifier                                    |
| `user_id`                        | UUID      | User ID                                              |
| `user_plan_id`                   | UUID (FK) | Associated UserPlan                                  |
| `package_session_id`             | UUID (FK) | Course/batch                                         |
| `institute_id`                   | UUID (FK) | Institute                                            |
| `status`                         | VARCHAR   | **INVITED**, **ACTIVE**, **TERMINATED**, **DELETED** |
| `source`                         | VARCHAR   | ENROLLMENT, EXPIRED                                  |
| `type`                           | VARCHAR   | PACKAGE_SESSION                                      |
| `type_id`                        | VARCHAR   | Original package session ID (for expired mappings)   |
| `expiry_date`                    | TIMESTAMP | Access end date                                      |
| `enrolled_date`                  | TIMESTAMP | When enrollment happened                             |
| `destination_package_session_id` | UUID      | Where to redirect for re-enrollment                  |
| `sub_org_id`                     | UUID      | Organization ID                                      |

---

## 🔌 API Reference

### Payment APIs

#### 1. Open Payment API (Anonymous Users)

**Endpoint:** `POST /admin-core-service/open/payments/pay`

**Description:** Handles payments for anonymous users (donations).

**Request:**

```json
{
  "amount": 100.0,
  "currency": "USD",
  "description": "Donation to support education",
  "email": "donor@example.com",
  "vendor": "STRIPE",
  "vendorId": "stripe_vendor_id",
  "stripeRequest": {
    "customerId": "cus_xxx",
    "paymentMethodId": "pm_xxx"
  }
}
```

**Query Parameters:**

- `instituteId` (required): Institute receiving the payment

**Response:**

```json
{
  "order_id": "da463c03-...",
  "status": "INITIATED",
  "payment_url": "https://...",
  "response_data": {
    "razorpayKeyId": "rzp_test_...",
    "razorpayOrderId": "order_...",
    "amount": 10000,
    "currency": "USD"
  }
}
```

---

#### 2. User Plan Payment API

**Endpoint:** `POST /admin-core-service/payments/user-plan/user-plan-payment`

**Description:** Handles payments for existing user plans (requires authentication).

**Request:**

```json
{
  "amount": 99.99,
  "currency": "USD",
  "description": "Payment for premium plan",
  "vendor": "STRIPE",
  "vendorId": "stripe_vendor_id",
  "stripeRequest": {
    "customerId": "cus_xxx",
    "paymentMethodId": "pm_xxx"
  }
}
```

**Query Parameters:**

- `instituteId` (required)
- `userPlanId` (required)

---

#### 3. Payment Status Check

**Endpoint:** `GET /admin-core-service/open/payments/{vendor}/status/{orderId}`

**Legacy Endpoint:** `GET /admin-core-service/payments/user-plan/{vendor}/status/{orderId}`

**Description:** Checks payment status for a given order.

**Path Parameters:**

- `vendor`: RAZORPAY, STRIPE, PHONEPE, EWAY
- `orderId`: Payment log ID

**Query Parameters:**

- `instituteId` (optional, auto-resolved from payment log)

**Response:**

```json
{
  "status": "PAID",
  "order_id": "da463c03-...",
  "payment_gateway_order_id": "order_RZc...",
  "amount": 1000.0,
  "currency": "INR",
  "timestamp": "2025-01-14T10:30:00"
}
```

---

### Webhook APIs

#### 1. Stripe Webhook

**Endpoint:** `POST /admin-core-service/payments/webhook/callback/stripe`

**Headers:**

- `Stripe-Signature`: Webhook signature

---

#### 2. Razorpay Webhook

**Endpoint:** `POST /admin-core-service/payments/webhook/callback/razorpay`

**Headers:**

- `X-Razorpay-Signature`: HMAC SHA256 signature

**Supported Events:**

- `payment.captured` → Updates payment_status to PAID
- `payment.failed` → Updates payment_status to FAILED
- `refund.created` → Updates payment_status to REFUNDED

---

#### 3. PhonePe Webhook

**Endpoint:** `POST /admin-core-service/payments/webhook/callback/phonepe`

**Headers:**

- `Authorization`: Callback verification header

**Query Parameters:**

- `instituteId` (optional)

---

### Enrollment Invite APIs

#### 1. Create Enrollment Invite

**Endpoint:** `POST /admin-core-service/v1/enroll-invite`

**Request:**

```json
{
  "name": "January Batch Enrollment",
  "inviteCode": "JAN-2024",
  "instituteId": "0e5fd21c-...",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "status": "ACTIVE",
  "vendor": "RAZORPAY",
  "vendorId": "rzp_account_id",
  "currency": "INR",
  "tag": "DEFAULT",
  "isBundled": false,
  "packageSessionToPaymentOptions": [
    {
      "packageSessionId": "595f3ba0-...",
      "paymentOption": {
        "name": "Monthly Subscription",
        "type": "SUBSCRIPTION",
        "paymentPlans": [
          {
            "name": "Monthly Plan",
            "actualPrice": 999,
            "elevatedPrice": 1299,
            "validityInDays": 30,
            "currency": "INR"
          }
        ]
      }
    }
  ]
}
```

---

#### 2. Get Enrollment Invites

**Endpoint:** `POST /admin-core-service/v1/enroll-invite/get-enroll-invite`

**Query Parameters:**

- `instituteId` (required)
- `pageNo` (default: 0)
- `pageSize` (default: 10)

**Request Body (Filters):**

```json
{
  "packageSessionIds": ["..."],
  "name": "search term",
  "tags": ["DEFAULT"],
  "status": ["ACTIVE"]
}
```

---

#### 3. Get Enrollment Invite by ID

**Endpoint:** `GET /admin-core-service/v1/enroll-invite/{instituteId}/{enrollInviteId}`

---

#### 4. Get Default Enrollment Invite for Package Session

**Endpoint:** `GET /admin-core-service/v1/enroll-invite/default/{instituteId}/{packageSessionId}`

---

#### 5. Update Enrollment Invite

**Endpoint:** `PUT /admin-core-service/v1/enroll-invite/enroll-invite`

---

#### 6. Delete Enrollment Invites

**Endpoint:** `DELETE /admin-core-service/v1/enroll-invite/enroll-invites`

**Request Body:** Array of enrollment invite IDs

---

#### 7. Open Learner APIs (No Auth Required)

**Get by Invite Code:**
`GET /admin-core-service/open/learner/enroll-invite?instituteId=...&inviteCode=...`

**Get by ID:**
`GET /admin-core-service/open/learner/enroll-invite/{instituteId}/{enrollInviteId}`

---

### Membership/User Plan APIs

#### 1. Get Membership Details

**Endpoint:** `POST /admin-core-service/v1/user-plan/membership-details`

**Description:** Returns user plans with calculated policy details.

**Query Parameters:**

- `instituteId` (required)
- `pageNo`, `pageSize`

**Request Body (Filters):**

```json
{
  "userIds": ["..."],
  "statuses": ["ACTIVE"],
  "packageSessionIds": ["..."]
}
```

**Response:**

```json
{
  "content": [
    {
      "user_plan": {
        "id": "017bd614-...",
        "status": "ACTIVE",
        "start_date": "2025-01-01",
        "end_date": "2025-12-31",
        "policy_details": [...]
      },
      "user_details": {
        "id": "user-id",
        "full_name": "John Doe",
        "email": "john@example.com"
      },
      "membership_status": "ACTIVE",
      "calculated_end_date": "2025-12-31"
    }
  ],
  "totalElements": 1
}
```

---

#### 2. Get All User Plans

**Endpoint:** `POST /admin-core-service/v1/user-plan/all`

---

## ⏰ Scheduler Jobs

### PackageSessionScheduler

**Location:** `enrollment_policy/scheduler/PackageSessionScheduler.java`

**Schedule:** Daily at 04:00, ShedLock-guarded

**Purpose:** Processes ACTIVE and CANCELED UserPlans for enrollment policy actions, only for institutes that enabled `PAYMENT_SETTING.packageSessionRenewalSchedulerEnabled`.

```java
@Scheduled(cron = "0 0 4 * * ?")
@SchedulerLock(name = "PackageSessionRenewScheduler", lockAtMostFor = "PT55M", lockAtLeastFor = "PT1M")
public void processPackageSessionRenewals() {
    List<String> instituteIds = paymentSettingService.getInstituteIdsWithRenewalSchedulerEnabled();
    enrolmentService.processActiveEnrollmentsForInstitutes(instituteIds);
}
```

### Processing Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                   SCHEDULER PROCESSING FLOW                         │
└────────────────────────────────────────────────────────────────────┘

1. Fetch ACTIVE + CANCELED UserPlans
               │
2. Group by Source (USER vs SUB_ORG)
               │
3. For each UserPlan:
   │
   ├── Get ACTIVE mappings
   │
   ├── Parse enrollment policy settings
   │
   ├── Build EnrolmentContext
   │
   └── Select Processor based on timing:
       │
       ├── PreExpiryProcessor (Before expiry date)
       │   └── Send reminder notifications
       │
       ├── WaitingPeriodProcessor (Day 0 to Day N)
       │   ├── Day 0: Payment Attempt #1
       │   ├── Days 1 to N-1: Send notifications
       │   └── Day N (Last day): Payment Attempt #2 if first failed
       │
       └── FinalExpiryProcessor (After waiting period)
           ├── Check for stacked PENDING plan
           ├── Move mappings to INVITED status
           └── Mark UserPlan as EXPIRED
```

### Processor Selection Logic

| Condition                      | Days Past Expiry | Processor              |
| ------------------------------ | ---------------- | ---------------------- |
| Before expiry                  | < 0              | PreExpiryProcessor     |
| Expiry day to last waiting day | 0 to N           | WaitingPeriodProcessor |
| After waiting period           | > N              | FinalExpiryProcessor   |

---

## 💰 Payment Gateway Integrations

### Supported Gateways

| Gateway      | One-Time | Subscription | Auto-Renewal       | Webhook |
| ------------ | -------- | ------------ | ------------------ | ------- |
| **Razorpay** | ✅       | ✅           | ✅ (Token-based)   | ✅      |
| **Stripe**   | ✅       | ✅           | ✅ (PaymentMethod) | ✅      |
| **PhonePe**  | ✅       | ❌           | ❌                 | ✅      |
| **eWay**     | ✅       | ❌           | ❌                 | Polling |
| **PayPal**   | 🚧 Stub  | 🚧 Stub      | ❌                 | ❌      |

### Payment Factory Pattern

```java
@Component
public class PaymentServiceFactory {
    public PaymentServiceStrategy getPaymentService(String vendor) {
        return switch (vendor.toUpperCase()) {
            case "RAZORPAY" -> razorpayPaymentManager;
            case "STRIPE" -> stripePaymentManager;
            case "PHONEPE" -> phonePePaymentManager;
            case "EWAY" -> ewayPaymentManager;
            default -> throw new VacademyException("Unsupported vendor: " + vendor);
        };
    }
}
```

### Razorpay Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                    RAZORPAY PAYMENT FLOW                            │
└────────────────────────────────────────────────────────────────────┘

1. Backend creates Customer (if not exists)
   └── Returns: cust_RZaONpDjISFY1C

2. Backend creates Order
   └── Returns: order_RZcDQTwdEQ8s78
   └── Notes: { orderId: payment_log.id, instituteId: "..." }

3. Frontend receives: { razorpayKeyId, razorpayOrderId, amount, currency }

4. Frontend opens Razorpay Checkout
   └── Student enters card details

5. Razorpay processes payment

6. Razorpay sends webhook:
   └── Event: payment.captured
   └── Includes: token_id (for future recurring payments)

7. Backend webhook handler:
   ├── Verify signature
   ├── Extract orderId from notes
   ├── Save token_id to user_institute_payment_gateway_mapping
   ├── Update payment_log.payment_status = PAID
   ├── Activate UserPlan
   └── Send confirmation email
```

### Webhook Signature Verification

```java
// Razorpay
String expectedSignature = HmacSHA256(webhookSecret, payload);
boolean valid = MessageDigestEquals(expectedSignature, receivedSignature);

// Stripe
Event event = Webhook.constructEvent(payload, sigHeader, webhookSecret);
```

---

## 🔄 Enrollment Policy Lifecycle

### Policy Configuration Structure

```json
{
  "notifications": [
    {
      "trigger": "BEFORE_EXPIRY",
      "days_before": 7,
      "notifications": [
        { "channel": "EMAIL", "template_name": "EXPIRY_REMINDER" }
      ]
    },
    {
      "trigger": "ON_EXPIRY_DATE_REACHED",
      "notifications": [
        { "channel": "EMAIL", "template_name": "EXPIRY_NOTICE" }
      ]
    },
    {
      "trigger": "DURING_WAITING_PERIOD",
      "send_every_n_days": 2,
      "max_sends": 3,
      "notifications": [
        { "channel": "EMAIL", "template_name": "GRACE_PERIOD_REMINDER" }
      ]
    }
  ],
  "on_expiry": {
    "waiting_period_in_days": 7,
    "enable_auto_renewal": true
  },
  "re_enrollment": {
    "allow_re_enrollment_after_expiry": true,
    "gap_in_days": 0
  }
}
```

### Complete Lifecycle Timeline

```
Day -7: BEFORE_EXPIRY notification sent
        ↓
Day 0:  ON_EXPIRY_DATE_REACHED
        ├── Payment Attempt #1 (if SUBSCRIPTION + auto_renewal)
        └── Notification sent
        ↓
Day 2:  DURING_WAITING_PERIOD notification
        ↓
Day 4:  DURING_WAITING_PERIOD notification
        ↓
Day 6:  DURING_WAITING_PERIOD notification
        ↓
Day 7:  Last day of waiting period
        └── Payment Attempt #2 (if first attempt failed)
        ↓
Day 8:  AFTER_WAITING_PERIOD (FinalExpiryProcessor)
        ├── Check for stacked PENDING plan
        ├── If no stacked plan:
        │   ├── Move mappings to INVITED
        │   └── UserPlan → EXPIRED
        └── If stacked plan exists:
            ├── Activate stacked plan
            └── Current UserPlan → EXPIRED
```

### Status Transitions

```
┌─────────────────────────────────────────────────────────────────────┐
│               USER PLAN STATUS TRANSITIONS                           │
└─────────────────────────────────────────────────────────────────────┘

                  ┌───────────────────────┐
                  │ PENDING_FOR_PAYMENT   │
                  └───────────┬───────────┘
                              │ Payment Success
                              ▼
                  ┌───────────────────────┐
           ┌─────│       ACTIVE          │◀─────┐
           │     └───────────┬───────────┘      │
           │                 │                   │
      User │                 │ Expiry + Waiting │ Stacked Plan
   Cancels │                 │ Period Ends      │ Activated
           │                 │                   │
           ▼                 ▼                   │
  ┌────────────────┐  ┌───────────────────────┐ │
  │    CANCELED    │  │       EXPIRED         │─┘
  └───────┬────────┘  └───────────────────────┘
          │
          │ Waiting Period Ends
          ▼
  ┌────────────────┐
  │    EXPIRED     │
  └────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────┐
│           MAPPING STATUS TRANSITIONS                                 │
└─────────────────────────────────────────────────────────────────────┘

                  ┌───────────────────────┐
                  │       INVITED         │
                  └───────────┬───────────┘
                              │ Payment Success
                              ▼
                  ┌───────────────────────┐
                  │       ACTIVE          │
                  └───────────┬───────────┘
                              │ Waiting Period Ends
                              │ (No successful payment)
                              ▼
                  ┌───────────────────────┐
                  │  DELETED (Soft Delete)│
                  └───────────┬───────────┘
                              │
                              │ Create new INVITED mapping
                              │ with source=EXPIRED
                              ▼
                  ┌───────────────────────┐
                  │  INVITED (Re-enroll)  │
                  │  source=EXPIRED       │
                  │  typeId=original PS ID│
                  └───────────────────────┘
```

---

## 📧 Notification System

### Notification Channels

| Channel      | Implementation              | Status    |
| ------------ | --------------------------- | --------- |
| **EMAIL**    | EmailNotificationService    | ✅ Active |
| **WHATSAPP** | WhatsAppNotificationService | ✅ Active |
| **PUSH**     | PushNotificationService     | ✅ Active |

### Notification Factory

```java
@Component
public class NotificationServiceFactory {
    public INotificationService getService(NotificationType type) {
        return switch (type) {
            case EMAIL -> emailNotificationService;
            case WHATSAPP -> whatsAppNotificationService;
            case PUSH -> pushNotificationService;
        };
    }
}
```

### Notification Trigger Types

| Trigger                  | When Fired               | Typical Use                     |
| ------------------------ | ------------------------ | ------------------------------- |
| `BEFORE_EXPIRY`          | N days before end_date   | Expiry reminder                 |
| `ON_EXPIRY_DATE_REACHED` | Day 0 (end_date)         | Expiry notice + payment attempt |
| `DURING_WAITING_PERIOD`  | Between expiry and final | Grace period reminders          |
| `AFTER_WAITING_PERIOD`   | After grace period       | Final expiry notice             |
| `PAYMENT_SUCCESS`        | Webhook confirms payment | Receipt/confirmation            |
| `PAYMENT_FAILED`         | Webhook confirms failure | Retry prompt                    |

---

## 🔐 Security Considerations

1. **Webhook Signature Verification**: All payment webhooks are verified using HMAC signatures
2. **Customer Tokens**: Payment tokens are stored in `payment_gateway_customer_data` JSON for recurring payments
3. **Card Details**: Card info (last4, brand) stored for display; full details never touch our servers
4. **Institute Isolation**: Each institute has separate payment gateway credentials

---

## 🎟️ Coupon Code System

### Database Tables

#### `coupon_code`

| Column                | Type             | Description                         |
| --------------------- | ---------------- | ----------------------------------- |
| `id`                  | UUID (PK)        | Unique identifier                   |
| `code`                | VARCHAR (UNIQUE) | Actual coupon code shown to users   |
| `status`              | VARCHAR          | ACTIVE, EXPIRED, REDEEMED           |
| `source_type`         | VARCHAR          | USER, ADMIN, SYSTEM, CAMPAIGN       |
| `source_id`           | VARCHAR          | ID of source entity                 |
| `is_email_restricted` | BOOLEAN          | If true, only listed emails can use |
| `allowed_email_ids`   | TEXT (JSON)      | Array of allowed email addresses    |
| `tag`                 | VARCHAR          | Category tag                        |
| `generation_date`     | DATE             | When coupon was created             |
| `redeem_start_date`   | DATE             | When redemption period starts       |
| `redeem_end_date`     | DATE             | When redemption period ends         |
| `usage_limit`         | BIGINT           | Maximum number of uses              |
| `can_be_added`        | BOOLEAN          | Whether coupon is addable to plans  |

#### `applied_coupon_discount`

Records discounts actually applied to user plans.

| Column                 | Type      | Description                                |
| ---------------------- | --------- | ------------------------------------------ |
| `id`                   | UUID (PK) | Unique identifier                          |
| `name`                 | VARCHAR   | Discount name                              |
| `discount_type`        | VARCHAR   | **PERCENTAGE**, **AMOUNT**, **MEDIA**      |
| `discount_source`      | VARCHAR   | REFERRAL, COUPON_CODE                      |
| `discount_point`       | DECIMAL   | Discount value (% or amount)               |
| `max_discount_point`   | DECIMAL   | Maximum discount cap                       |
| `max_applicable_times` | INTEGER   | How many times can be applied              |
| `validity_in_days`     | INTEGER   | Validity period                            |
| `currency`             | VARCHAR   | Currency for amount discounts              |
| `media_ids`            | TEXT      | Comma-separated media IDs (for MEDIA type) |
| `coupon_code_id`       | UUID (FK) | Link to coupon_code                        |
| `redeem_start_date`    | DATE      | When discount becomes valid                |
| `redeem_end_date`      | DATE      | When discount expires                      |

### Coupon APIs

#### 1. Get Coupon by Code

**Endpoint:** `GET /admin-core-service/coupon/v1/by-code`

**Query Parameters:**

- `code`: The coupon code string

**Response:**

```json
{
  "id": "uuid",
  "code": "WELCOME2024",
  "status": "ACTIVE",
  "sourceType": "CAMPAIGN",
  "sourceId": "campaign-123",
  "emailRestricted": false,
  "usageLimit": 100,
  "redeemStartDate": "2024-01-01",
  "redeemEndDate": "2024-12-31"
}
```

#### 2. Get Coupons by Source

**Endpoint:** `GET /admin-core-service/coupon/v1/by-source`

**Query Parameters:**

- `sourceId`: Source entity ID
- `sourceType`: USER, ADMIN, SYSTEM, CAMPAIGN

#### 3. Update Coupon Status

**Endpoint:** `PUT /admin-core-service/coupon/v1/update-status`

**Query Parameters:**

- `code`: Coupon code
- `status`: New status (ACTIVE, EXPIRED, REDEEMED)

---

## 🎁 Referral System Enhancement

### Additional Database Tables

#### `referral_mapping`

Tracks referrer-referee relationships.

| Column               | Type      | Description                         |
| -------------------- | --------- | ----------------------------------- |
| `id`                 | UUID (PK) | Unique identifier                   |
| `referrer_user_id`   | UUID      | User who referred                   |
| `referee_user_id`    | UUID      | User who was referred               |
| `referral_code`      | VARCHAR   | Code used for referral              |
| `user_plan_id`       | UUID (FK) | UserPlan created from referral      |
| `referral_option_id` | UUID (FK) | ReferralOption used                 |
| `status`             | VARCHAR   | PENDING, ACTIVE, COMPLETED, EXPIRED |

#### `referral_benefit_logs`

Tracks benefits given to referrers/referees.

| Column                | Type      | Description                      |
| --------------------- | --------- | -------------------------------- |
| `id`                  | UUID (PK) | Unique identifier                |
| `user_plan_id`        | UUID (FK) | Associated UserPlan              |
| `referral_mapping_id` | UUID (FK) | Link to referral_mapping         |
| `user_id`             | UUID      | User receiving benefit           |
| `benefit_type`        | VARCHAR   | DISCOUNT, CREDIT, MEDIA_ACCESS   |
| `beneficiary`         | VARCHAR   | REFERRER, REFEREE                |
| `benefit_value`       | VARCHAR   | Value (percentage, amount, etc.) |
| `status`              | VARCHAR   | APPLIED, PENDING, EXPIRED        |

### Referral Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     REFERRAL BENEFIT FLOW                            │
└─────────────────────────────────────────────────────────────────────┘

1. Referee uses referral code during enrollment
   └── Creates referral_mapping entry

2. Referee completes payment
   └── Referee benefit (instant discount) applied
       └── Creates referral_benefit_logs entry (REFEREE, APPLIED)

3. After vesting period (referrer_vesting_days)
   └── Referrer benefit applied
       └── Creates referral_benefit_logs entry (REFERRER, APPLIED)
```

---

## 📋 Additional API Endpoints

### UserPlan Controller APIs

#### 1. Get UserPlan with Payment Logs

**Endpoint:** `GET /admin-core-service/v1/user-plan/{userPlanId}/with-payment-logs`

**Query Parameters:**

- `includePolicyDetails` (boolean, default: false)

**Response:**

```json
{
  "id": "user-plan-id",
  "status": "ACTIVE",
  "start_date": "2024-01-01",
  "end_date": "2024-12-31",
  "payment_logs": [
    {
      "id": "payment-log-id",
      "payment_status": "PAID",
      "payment_amount": 999.00,
      "currency": "INR",
      "transaction_id": "pay_xyz..."
    }
  ],
  "policy_details": [...]
}
```

#### 2. Get All User Plans

**Endpoint:** `POST /admin-core-service/v1/user-plan/all`

**Request Body:**

```json
{
  "userIds": ["user-id-1"],
  "instituteId": "institute-id",
  "statuses": ["ACTIVE"],
  "enrollInviteIds": ["invite-id"]
}
```

#### 3. Get Payment Logs

**Endpoint:** `POST /admin-core-service/v1/user-plan/payment-logs`

**Request Body:**

```json
{
  "instituteId": "institute-id",
  "userIds": ["user-id"],
  "paymentStatuses": ["PAID", "FAILED"],
  "startDate": "2024-01-01",
  "endDate": "2024-12-31"
}
```

#### 4. Update UserPlan Statuses (Bulk)

**Endpoint:** `PUT /admin-core-service/v1/user-plan/status`

**Request Body:**

```json
{
  "userPlanIds": ["plan-1", "plan-2"],
  "status": "ACTIVE"
}
```

#### 5. Cancel / Terminate UserPlan

**Endpoint:** `PUT /admin-core-service/v1/user-plan/{userPlanId}/cancel`

**Query Parameters:**

- `force` (boolean, default: false):
  - `false`: **Standard Cancellation**. Sets status to `CANCELED`. Access continues until grace period ends.
  - `true`: **Force Termination**. Immediately terminates plan and revokes access.

**Behavior:**

- **Standard (`force=false`)**:
  - Sets UserPlan status to `CANCELED`
  - Mappings remain `ACTIVE` until waiting period ends
  - Scheduler will eventually move to `EXPIRED`
- **Force (`force=true`)**:
  - Sets UserPlan status to `TERMINATED`/`EXPIRED`
  - Active session mappings are soft-deleted or marked `TERMINATED`
  - Immediate access revocation

---

## 🎛️ Detailed Policy Configuration

### Complete EnrollmentPolicySettingsDTO Structure

```json
{
  "onExpiry": {
    "waitingPeriodInDays": 7,
    "enableAutoRenewal": true
  },
  "notifications": [
    {
      "trigger": "BEFORE_EXPIRY",
      "daysBefore": 7,
      "sendEveryNDays": null,
      "maxSends": null,
      "notifications": [
        {
          "channel": "EMAIL",
          "templateName": "expiry_reminder_email"
        },
        {
          "channel": "WHATSAPP",
          "templateName": "expiry_reminder_whatsapp"
        }
      ]
    },
    {
      "trigger": "ON_EXPIRY_DATE_REACHED",
      "daysBefore": null,
      "notifications": [
        {
          "channel": "EMAIL",
          "templateName": "expiry_notice"
        }
      ]
    },
    {
      "trigger": "DURING_WAITING_PERIOD",
      "sendEveryNDays": 2,
      "maxSends": 3,
      "notifications": [
        {
          "channel": "EMAIL",
          "templateName": "grace_period_reminder"
        }
      ]
    }
  ],
  "reenrollmentPolicy": {
    "activeRepurchaseBehavior": "STACK",
    "allowReenrollmentAfterExpiry": true,
    "reenrollmentGapInDays": 0
  },
  "onEnrollment": {
    "autoActivate": true,
    "approvalRequired": false
  }
}
```

### Policy Enums

#### NotificationTriggerType

| Value                    | Description                     |
| ------------------------ | ------------------------------- |
| `BEFORE_EXPIRY`          | N days before expiry date       |
| `ON_EXPIRY_DATE_REACHED` | Exactly on expiry date (Day 0)  |
| `DURING_WAITING_PERIOD`  | Between expiry and final expiry |

#### ActiveRepurchaseBehavior

| Value       | Description                                               |
| ----------- | --------------------------------------------------------- |
| `STACK`     | New plan waits until current plan expires, then activates |
| `OVERWRITE` | New plan immediately replaces current plan                |

### Stacked Plan Behavior

When `activeRepurchaseBehavior = STACK`:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STACKED PLAN ACTIVATION                           │
└─────────────────────────────────────────────────────────────────────┘

Current Plan: ACTIVE (endDate: 2024-12-31)
         ↓
User purchases new plan
         ↓
New Plan: PENDING (waits in queue)
         ↓
Current Plan: EXPIRED (after waiting period)
         ↓
Stacked Plan: ACTIVE (automatically activated)
```

---

## 🏢 Sub-Organization Settings

### EnrollInvite Setting JSON Structure

For organization/B2B enrollments, the `setting_json` field contains:

```json
{
  "setting": {
    "SUB_ORG_SETTING": {
      "CUSTOM_FIELD_MAPPING": {
        "data": {
          "allCustomFields": [
            {
              "customFieldId": "field-uuid-1",
              "fieldName": "company_name"
            },
            {
              "customFieldId": "field-uuid-2",
              "fieldName": "department"
            }
          ]
        }
      },
      "ROLE_CONFIGURATION": {
        "roleFieldKey": "role_field"
      }
    }
  }
}
```

### Sub-Org Enrollment Flow

````
EnrollInvite (tag: SUB_ORG)
      │
      ├── ROOT_ADMIN enrolls organization
      │
      ├── Creates UserPlan (source: SUB_ORG, sub_org_id: org-uuid)
      │
      ├── Creates mappings for all learners in organization
      │
      └── Notifications sent to ROOT_ADMIN only (not individual learners)

### Sub-Organization Management APIs

#### 1. Terminate/Remove Members (Bulk)

**Endpoint:** `POST /admin-core-service/sub-org/v1/terminate-member`

**Description:**
Terminates access for multiple learners within a sub-organization for a specific package session.

**Request Body:**

```json
{
  "sub_org_id": "sub-org-uuid",
  "institute_id": "institute-uuid",
  "package_session_id": "package-session-uuid",
  "user_ids": [
    "user-uuid-1",
    "user-uuid-2"
  ]
}
````

````

---

## 🔄 Renewal Payment Service

### handleRenewalPaymentConfirmation

Called by webhook handlers when auto-renewal payment completes:

```java
// Workflow
1. Find PaymentLog by orderId
2. Get UserPlan from PaymentLog
3. If payment PAID:
   - Calculate new endDate (current endDate + validityInDays)
   - Update UserPlan.endDate
   - Update all ACTIVE mappings expiryDate
   - Send success notification
4. If payment FAILED:
   - Send failure notification
   - (UserPlan remains in current state, waiting for FinalExpiryProcessor)
````

### Date Extension Calculation

```java
private Date calculateNewEndDate(UserPlan userPlan) {
    Date currentEndDate = userPlan.getEndDate();
    int daysToAdd = userPlan.getPaymentPlan().getValidityInDays();

    Calendar calendar = Calendar.getInstance();
    calendar.setTime(currentEndDate);
    calendar.add(Calendar.DAY_OF_MONTH, daysToAdd);

    return calendar.getTime();
}
```

---

### PaymentOption Controller APIs

**Base Path:** `/admin-core-service/v1/payment-option`

#### 1. Create Payment Option

**Endpoint:** `POST /admin-core-service/v1/payment-option`

**Request Body:**

```json
{
  "name": "Monthly Subscription",
  "type": "SUBSCRIPTION",
  "source": "PACKAGE_SESSION",
  "sourceId": "package-session-uuid",
  "tag": "DEFAULT",
  "requireApproval": false,
  "unit": "MONTH",
  "paymentPlans": [
    {
      "name": "Basic Plan",
      "validityInDays": 30,
      "actualPrice": 999,
      "elevatedPrice": 1299,
      "currency": "INR"
    }
  ]
}
```

#### 2. Get Payment Options

**Endpoint:** `POST /admin-core-service/v1/payment-option/get-payment-options`

**Request Body:**

```json
{
  "source": "PACKAGE_SESSION",
  "sourceId": "package-session-uuid",
  "statuses": ["ACTIVE"],
  "types": ["SUBSCRIPTION", "ONE_TIME"]
}
```

#### 3. Set Default Payment Option

**Endpoint:** `POST /admin-core-service/v1/payment-option/make-default-payment-option`

**Query Parameters:**

- `source`: PACKAGE_SESSION, INSTITUTE
- `sourceId`: Entity ID
- `paymentOptionId`: ID to make default

#### 4. Get Default Payment Option

**Endpoint:** `GET /admin-core-service/v1/payment-option/default-payment-option`

**Query Parameters:**

- `source`: PACKAGE_SESSION, INSTITUTE
- `sourceId`: Entity ID

#### 5. Update Payment Option

**Endpoint:** `PUT /admin-core-service/v1/payment-option`

#### 6. Delete Payment Options

**Endpoint:** `DELETE /admin-core-service/v1/payment-option`

**Request Body:** Array of payment option IDs

---

### ReferralOption Controller APIs

**Base Path:** `/admin-core-service/v1/referral-option`

#### 1. Create Referral Option

**Endpoint:** `POST /admin-core-service/v1/referral-option`

**Request Body:**

```json
{
  "name": "Friend Referral Program",
  "source": "CAMPAIGN",
  "sourceId": "campaign-uuid",
  "status": "ACTIVE",
  "referrerDiscountJson": "{\"type\":\"PERCENTAGE\",\"value\":10}",
  "refereeDiscountJson": "{\"type\":\"AMOUNT\",\"value\":100,\"currency\":\"INR\"}",
  "referrerVestingDays": 30,
  "tag": "PREMIUM",
  "description": "Refer a friend and get 10% off your next renewal"
}
```

#### 2. Get Referral Options

**Endpoint:** `GET /admin-core-service/v1/referral-option`

**Query Parameters:**

- `source`: Where referral option originated
- `sourceId`: Source entity ID

#### 3. Update Referral Option

**Endpoint:** `PUT /admin-core-service/v1/referral-option/{referralOptionId}`

#### 4. Delete Referral Options

**Endpoint:** `DELETE /admin-core-service/v1/referral-option`

**Request Body:** Array of referral option IDs

---

### Coupon Verification API (Open/Public)

**Base Path:** `/admin-core-service/open/v1/user-subscription`

#### Verify Coupon Code

**Endpoint:** `POST /admin-core-service/open/v1/user-subscription/verify`

**Query Parameters:**

- `couponCode`: The coupon code to verify
- `referralOptionId`: Associated referral option ID

**Request Body:**

```json
{
  "userId": "user-uuid",
  "email": "user@example.com",
  "paymentPlanId": "plan-uuid"
}
```

**Response:**

```json
{
  "valid": true,
  "discountType": "PERCENTAGE",
  "discountValue": 15,
  "maxDiscountAmount": 500,
  "applicableAmount": 150,
  "message": "Coupon applied successfully",
  "expiresAt": "2024-12-31"
}
```

---

## 📊 Key Relationships Summary

```
EnrollInvite (1) ──────────▶ (N) PackageSessionLearnerInvitationToPaymentOption
                                         │
                                         ▼
                              PackageSession + PaymentOption
                                         │
                                         ▼
                              PaymentPlan (1) ──▶ (N) ReferralOption
                                         │
                                         ▼
                                   UserPlan (per user subscription)
                                         │
                                         ├──▶ PaymentLog (transaction records)
                                         │
                                         └──▶ StudentSessionInstituteGroupMapping (access control)
```

---

## 🔄 Bulk Assign / De-assign APIs

> **v3 APIs** for admin-initiated bulk learner enrollment and removal.  
> Base Path: `/admin-core-service/v3/learner-management`

### Overview

These APIs allow admins to assign or de-assign **N users × M package sessions** in a single call. They integrate with the existing enrollment infrastructure (EnrollInvite → PaymentOption → PaymentPlan → UserPlan → StudentSessionMapping) and support:

- **Default resolution**: Auto-find or auto-create enrollment invites, payment options, and plans
- **Dry-run mode**: Preview all operations without making changes
- **Inline user creation**: Create new learners on-the-fly during assignment
- **Filter-based selection**: Select users from another package session by status
- **Re-enrollment**: Re-enroll previously terminated/inactive users
- **Notifications**: Optionally send enrollment emails after assignment

### How It Relates to Existing Entities

```
Bulk Assign API
    │
    ├── Resolves EnrollInvite (existing or auto-created)
    │       └── via DefaultInviteResolver
    │           ├── Explicit ID → use as-is
    │           ├── DEFAULT tag → find via EnrollInviteRepository
    │           └── None found → auto-create free invite + payment option + plan
    │
    ├── Creates UserPlan (via UserPlanService.createUserPlan)
    │       └── Links to resolved PaymentPlan + PaymentOption + EnrollInvite
    │
    └── Creates StudentSessionInstituteGroupMapping
            └── Links user to package session with ACTIVE status

Bulk De-assign API
    │
    ├── Finds active StudentSessionInstituteGroupMapping
    │
    ├── SOFT mode → UserPlanService.cancelUserPlan(id, false)
    │       └── Status → CANCELED, access continues until expiry
    │
    └── HARD mode → UserPlanService.cancelUserPlan(id, true)
            └── Status → TERMINATED, immediate access revocation
```

---

### 1. Bulk Assign

**Endpoint:** `POST /admin-core-service/v3/learner-management/assign`

**Description:** Assigns multiple users to multiple package sessions with configurable enrollment options.

**Request Body:**

```json
{
  "institute_id": "inst-uuid",
  "user_ids": ["user-1", "user-2"],
  "new_users": [
    {
      "email": "newstudent@example.com",
      "full_name": "New Student",
      "mobile_number": "+919876543210",
      "username": null,
      "password": null,
      "roles": ["STUDENT"],
      "gender": "MALE"
    }
  ],
  "user_filter": {
    "source_package_session_id": "source-ps-uuid",
    "statuses": ["ACTIVE"]
  },
  "assignments": [
    {
      "package_session_id": "target-ps-uuid-1",
      "enroll_invite_id": null,
      "payment_option_id": null,
      "plan_id": null,
      "access_days": null
    },
    {
      "package_session_id": "target-ps-uuid-2",
      "enroll_invite_id": "explicit-invite-uuid",
      "payment_option_id": "explicit-option-uuid",
      "plan_id": "explicit-plan-uuid",
      "access_days": 365
    }
  ],
  "options": {
    "duplicate_handling": "SKIP",
    "notify_learners": true,
    "transaction_id": "external-ref-123",
    "dry_run": false
  }
}
```

#### Request Fields

| Field          | Type               | Required | Description                                             |
| -------------- | ------------------ | -------- | ------------------------------------------------------- |
| `institute_id` | `string`           | ✅       | Institute UUID                                          |
| `user_ids`     | `string[]`         | ⚡       | Existing user IDs to assign                             |
| `new_users`    | `NewUser[]`        | ⚡       | Users to create inline then assign                      |
| `user_filter`  | `UserFilter`       | ⚡       | Filter-based user selection                             |
| `assignments`  | `AssignmentItem[]` | ✅       | Per-package-session enrollment config                   |
| `options`      | `AssignOptions`    | ❌       | Controls for duplicate handling, notifications, dry-run |

> ⚡ At least one of `user_ids`, `new_users`, or `user_filter` is required. All three are additive (union).

#### NewUser Object

| Field           | Type       | Required | Description               |
| --------------- | ---------- | -------- | ------------------------- |
| `email`         | `string`   | ✅       | Email (unique identifier) |
| `full_name`     | `string`   | ✅       | Display name              |
| `mobile_number` | `string`   | ❌       | Phone number              |
| `username`      | `string`   | ❌       | Defaults to email         |
| `password`      | `string`   | ❌       | Auto-generated if omitted |
| `roles`         | `string[]` | ❌       | Defaults to `["STUDENT"]` |
| `gender`        | `string`   | ❌       | Optional                  |

> Users are created via `AuthService.createUserFromAuthServiceForLearnerEnrollment()`.
> If creation fails for one user, their failure is recorded but other users proceed normally.

#### UserFilter Object

| Field                       | Type       | Required | Description                                         |
| --------------------------- | ---------- | -------- | --------------------------------------------------- |
| `source_package_session_id` | `string`   | ✅       | Package session to pull users from                  |
| `statuses`                  | `string[]` | ❌       | Filter by enrollment status (default: `["ACTIVE"]`) |

> Uses `StudentSessionRepository.findDistinctUserIdsByPackageSessionAndStatus()` to resolve user IDs.

#### AssignmentItem Object

| Field                | Type      | Required | Description                                       |
| -------------------- | --------- | -------- | ------------------------------------------------- |
| `package_session_id` | `string`  | ✅       | Target package session                            |
| `enroll_invite_id`   | `string`  | ❌       | Explicit invite — `null` triggers auto-resolution |
| `payment_option_id`  | `string`  | ❌       | Explicit option — `null` triggers auto-resolution |
| `plan_id`            | `string`  | ❌       | Explicit plan — `null` triggers auto-resolution   |
| `access_days`        | `integer` | ❌       | Override access duration                          |

#### Default Resolution Logic (when IDs are null)

```
1. enroll_invite_id = null?
   ├── Find invite with tag="DEFAULT" for this package session
   │   └── Uses EnrollInviteRepository.findLatestForPackageSessionWithFilters()
   │       with statuses=["ACTIVE"], tags=["DEFAULT"], mappingStatuses=["ACTIVE"]
   │
   ├── Found → use it
   └── Not found → AUTO-CREATE:
       ├── Create free EnrollInvite (tag="DEFAULT", status="ACTIVE")
       ├── Create free PaymentOption (type="FREE", tag="DEFAULT")
       ├── Create free PaymentPlan (price=0, tag="DEFAULT")
       └── Link via PackageSessionLearnerInvitationToPaymentOption

2. payment_option_id = null?
   └── Find first ACTIVE payment option linked to the resolved invite
       for this specific package session

3. plan_id = null?
   └── Find first ACTIVE plan under the resolved payment option

4. access_days = null?
   └── Use invite.learnerAccessDays → plan.validityInDays → null
```

#### AssignOptions Object

| Field                | Type      | Default  | Description                                                                                    |
| -------------------- | --------- | -------- | ---------------------------------------------------------------------------------------------- |
| `duplicate_handling` | `string`  | `"SKIP"` | `SKIP` = silently skip, `ERROR` = report as failed, `RE_ENROLL` = re-activate terminated users |
| `notify_learners`    | `boolean` | `false`  | Send enrollment notification email via `LearnerEnrollmentNotificationService`                  |
| `transaction_id`     | `string`  | `null`   | External payment reference (for logging only)                                                  |
| `dry_run`            | `boolean` | `false`  | Preview mode — no database writes                                                              |

#### Duplicate Handling Behavior

| Mode        | User has ACTIVE enrollment | User has TERMINATED/INACTIVE | User has no enrollment |
| ----------- | -------------------------- | ---------------------------- | ---------------------- |
| `SKIP`      | ⏭ Skip (status=SKIPPED)   | ⏭ Skip                      | ✅ Create new          |
| `ERROR`     | ❌ Fail (status=FAILED)    | ❌ Fail                      | ✅ Create new          |
| `RE_ENROLL` | ⏭ Skip (already active)   | ✅ Create new mapping + plan | ✅ Create new          |

**Response:**

```json
{
  "dry_run": false,
  "summary": {
    "total_requested": 6,
    "successful": 5,
    "failed": 0,
    "skipped": 1,
    "re_enrolled": 1
  },
  "results": [
    {
      "user_id": "user-1",
      "user_email": "john@example.com",
      "package_session_id": "target-ps-uuid-1",
      "status": "SUCCESS",
      "action_taken": "CREATED",
      "mapping_id": "mapping-uuid-1",
      "user_plan_id": "user-plan-uuid-1",
      "enroll_invite_id_used": "auto-resolved-invite-uuid",
      "message": null
    },
    {
      "user_id": "user-2",
      "user_email": "jane@example.com",
      "package_session_id": "target-ps-uuid-1",
      "status": "SKIPPED",
      "action_taken": "NONE",
      "message": "Already enrolled (ACTIVE)"
    },
    {
      "user_id": null,
      "user_email": "failed-new@example.com",
      "package_session_id": "target-ps-uuid-1",
      "status": "FAILED",
      "action_taken": "NONE",
      "message": "User creation failed: Email already exists"
    }
  ]
}
```

#### Result Item Fields

| Field                   | Type      | Description                                          |
| ----------------------- | --------- | ---------------------------------------------------- |
| `user_id`               | `string?` | User UUID (null if new user creation failed)         |
| `user_email`            | `string?` | User email for display                               |
| `package_session_id`    | `string`  | Target package session                               |
| `status`                | `string`  | `SUCCESS`, `FAILED`, or `SKIPPED`                    |
| `action_taken`          | `string`  | `CREATED`, `RE_ENROLLED`, or `NONE`                  |
| `mapping_id`            | `string?` | Created StudentSessionInstituteGroupMapping ID       |
| `user_plan_id`          | `string?` | Created UserPlan ID                                  |
| `enroll_invite_id_used` | `string?` | The invite that was used (explicit or auto-resolved) |
| `message`               | `string?` | Human-readable detail (skip reason, error, etc.)     |

---

### 2. Bulk De-assign

**Endpoint:** `POST /admin-core-service/v3/learner-management/deassign`

**Description:** De-assigns multiple users from multiple package sessions with SOFT or HARD cancellation.

**Request Body:**

```json
{
  "institute_id": "inst-uuid",
  "user_ids": ["user-1", "user-2"],
  "user_filter": null,
  "package_session_ids": ["ps-uuid-1", "ps-uuid-2"],
  "options": {
    "mode": "SOFT",
    "notify_learners": false,
    "dry_run": true
  }
}
```

#### Request Fields

| Field                 | Type              | Required | Description                                  |
| --------------------- | ----------------- | -------- | -------------------------------------------- |
| `institute_id`        | `string`          | ✅       | Institute UUID                               |
| `user_ids`            | `string[]`        | ⚡       | User IDs to de-assign                        |
| `user_filter`         | `UserFilter`      | ⚡       | Filter-based user selection (same as assign) |
| `package_session_ids` | `string[]`        | ✅       | Package sessions to remove users from        |
| `options`             | `DeassignOptions` | ❌       | Mode, notifications, dry-run                 |

#### DeassignOptions Object

| Field             | Type      | Default  | Description                                                           |
| ----------------- | --------- | -------- | --------------------------------------------------------------------- |
| `mode`            | `string`  | `"SOFT"` | `SOFT` = cancel (access until expiry), `HARD` = terminate immediately |
| `notify_learners` | `boolean` | `false`  | Send de-enrollment notification                                       |
| `dry_run`         | `boolean` | `false`  | Preview mode                                                          |

#### Cancellation Modes

| Mode   | UserPlan Status | Mapping Status | Access Impact               | Reversible?                       |
| ------ | --------------- | -------------- | --------------------------- | --------------------------------- |
| `SOFT` | → CANCELED      | → INACTIVE     | Continues until plan expiry | ✅ Re-enrollment possible         |
| `HARD` | → TERMINATED    | → TERMINATED   | **Immediate revocation**    | ✅ Re-enrollment creates new plan |

#### Shared UserPlan Warning

If a user's `UserPlan` is shared across multiple package sessions, canceling the plan will affect **all** associated enrollments. The API detects this and returns a warning:

```json
{
  "warning": "UserPlan up-123 is shared across 2 package sessions. Canceling this plan will affect other enrollments."
}
```

When no `UserPlan` is linked to the mapping (direct enrollment without subscription), the de-assign API falls back to updating the mapping status directly.

**Response:**

```json
{
  "dry_run": true,
  "summary": {
    "total_requested": 4,
    "successful": 3,
    "failed": 0,
    "skipped": 1
  },
  "results": [
    {
      "user_id": "user-1",
      "user_email": "john@example.com",
      "package_session_id": "ps-uuid-1",
      "status": "SUCCESS",
      "action_taken": "SOFT_CANCELED",
      "user_plan_id": "up-shared-uuid",
      "message": "Would soft-cancel (access until expiry)",
      "warning": "UserPlan up-shared-uuid is shared across 2 package sessions. Canceling this plan will affect other enrollments."
    },
    {
      "user_id": "user-2",
      "user_email": "jane@example.com",
      "package_session_id": "ps-uuid-1",
      "status": "SKIPPED",
      "action_taken": "NONE",
      "message": "No active enrollment found"
    }
  ]
}
```

---

### 3. Processing Guarantees

| Property              | Behavior                                                          |
| --------------------- | ----------------------------------------------------------------- |
| **Atomicity**         | Per-item (not transactional across all items)                     |
| **Failure isolation** | One user's failure does not block others                          |
| **Idempotency**       | `SKIP` mode ensures safe re-runs                                  |
| **Ordering**          | Results returned in same order as input                           |
| **Concurrency**       | Not safe for concurrent calls on same (user, packageSession) pair |

### 4. Notifications

- **Trigger:** Only when `notify_learners = true` AND `dry_run = false`
- **Service:** `LearnerEnrollmentNotificationService.sendLearnerEnrollmentNotification()`
- **Scope:** Only for `SUCCESS` results with `CREATED` or `RE_ENROLLED` action
- **Execution:** Asynchronous (fire-and-forget) — notification failures do not affect API results
- **Channels:** Uses the existing dynamic notification system (`NotificationEventType.LEARNER_ENROLL`)

### 5. Backend Service Architecture

```
BulkLearnerManagementController
├── POST /assign  → BulkAssignmentService.bulkAssign()
│   ├── resolveUserIds()                    ← explicit + filter-based
│   ├── createNewUser() × N                 ← via AuthService
│   ├── DefaultInviteResolver.resolve()     ← per package session
│   │   ├── resolveInvite()                 ← explicit → DEFAULT → auto-create
│   │   ├── resolvePaymentOption()          ← from invite links
│   │   └── resolvePaymentPlan()            ← from option
│   ├── processAssignment() × (N users × M sessions)
│   │   ├── Check duplicates
│   │   ├── UserPlanService.createUserPlan()
│   │   └── Save StudentSessionInstituteGroupMapping
│   └── LearnerEnrollmentNotificationService (async)
│
└── POST /deassign → BulkDeassignmentService.bulkDeassign()
    ├── resolveUserIds()
    └── processDeassignment() × (N × M)
        ├── Find active mapping
        ├── Check shared UserPlan
        └── UserPlanService.cancelUserPlan(id, force)
```

### 6. Key Java Classes

| Class                             | Location      | Purpose                                    |
| --------------------------------- | ------------- | ------------------------------------------ |
| `BulkLearnerManagementController` | `controller/` | REST endpoints                             |
| `BulkAssignmentService`           | `service/`    | Assignment orchestration                   |
| `BulkDeassignmentService`         | `service/`    | De-assignment orchestration                |
| `DefaultInviteResolver`           | `service/`    | EnrollInvite/PaymentOption/Plan resolution |
| `BulkAssignRequestDTO`            | `dto/`        | Assign request                             |
| `BulkAssignResponseDTO`           | `dto/`        | Assign response with summary               |
| `BulkAssignResultItemDTO`         | `dto/`        | Per-item result                            |
| `BulkDeassignRequestDTO`          | `dto/`        | De-assign request                          |
| `BulkDeassignResponseDTO`         | `dto/`        | De-assign response with warnings           |
| `AssignmentItemDTO`               | `dto/`        | Per-package-session config                 |
| `NewUserDTO`                      | `dto/`        | Inline user creation                       |
| `UserFilterDTO`                   | `dto/`        | Filter-based selection                     |
| `BulkAssignOptionsDTO`            | `dto/`        | Assign options                             |
| `DeassignOptionsDTO`              | `dto/`        | De-assign options                          |

---

---

**Last Updated:** February 2026  
**Author:** Vacademy Platform Team
