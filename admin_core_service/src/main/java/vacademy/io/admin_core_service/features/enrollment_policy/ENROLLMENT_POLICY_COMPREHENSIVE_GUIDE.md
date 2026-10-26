# 📋 Enrollment Policy Testing Guide

## 🎯 Overview

This document provides comprehensive testing guidelines for the **UserPlan-Centric Enrollment Policy System**. It covers all test scenarios, expected behaviors, and step-by-step testing procedures.

> **Status note (verified against `FinalExpiryProcessor.java:303`):** final expiry marks the
> lapsed mapping **`DELETED`**, not `TERMINATED`. This document previously said TERMINATED in
> three places; the code has never produced that value on this path. `TERMINATED` is written by
> the de-assign / terminate flows instead — see `docs/ENROLLMENT_LIFECYCLE_STATUS_FLOWS.md`.

---

## 📐 System Architecture

### **Key Components**

1. **EnrollmentContext** - UserPlan-centric context carrying all data
2. **PackageSessionEnrolmentService** - Main scheduler (processes once per UserPlan)
3. **PreExpiryProcessor** - Handles pre-expiry notifications
4. **WaitingPeriodProcessor** - Handles expiry date & waiting period (2 payment attempts)
5. **FinalExpiryProcessor** - Moves to INVITED after waiting period
6. **RenewalPaymentService** - Handles payment webhook callbacks

---

## 🔄 Complete Lifecycle Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENROLLMENT POLICY LIFECYCLE                   │
└─────────────────────────────────────────────────────────────────┘

BEFORE EXPIRY (Day -N):
├─ PreExpiryProcessor
│  ├─ Send BEFORE_EXPIRY notifications (N days before)
│  └─ UserPlan: ACTIVE | Mappings: ACTIVE

DAY 0 (EXPIRY DATE):
├─ WaitingPeriodProcessor
│  ├─ 🔴 PAYMENT ATTEMPT #1
│  ├─ Send ON_EXPIRY_DATE_REACHED notifications
│  └─ UserPlan: ACTIVE | Mappings: ACTIVE (waiting period starts)

DAYS 1 TO N-1 (DURING WAITING PERIOD):
├─ WaitingPeriodProcessor
│  ├─ Send DURING_WAITING_PERIOD notifications (every N days)
│  └─ UserPlan: ACTIVE | Mappings: ACTIVE (grace period)

DAY N (LAST DAY OF WAITING PERIOD):
├─ WaitingPeriodProcessor
│  ├─ Check payment log for first attempt
│  │  ├─ If status = FAILED → 🔴 PAYMENT ATTEMPT #2 (RETRY)
│  │  ├─ If status = SUCCESS → Skip retry (already successful)
│  │  └─ If status = PENDING → Skip retry (waiting for webhook)
│  ├─ Send DURING_WAITING_PERIOD notifications
│  └─ UserPlan: ACTIVE | Mappings: ACTIVE

DAY N+1 (AFTER WAITING PERIOD):
├─ FinalExpiryProcessor
│  ├─ Check payment status (if failed/not done):
│  ├─ ❌ NO PAYMENT ATTEMPT (only in waiting period)
│  ├─ Move expired mappings to INVITED
│  │  ├─ Skip mappings with future expiryDate
│  │  ├─ Soft delete (mark as DELETED — not TERMINATED)
│  │  └─ Create/Update INVITED mapping
│  └─ UserPlan: ACTIVE → EXPIRED ✅

PAYMENT SUCCESS (Webhook):
├─ RenewalPaymentService
│  ├─ Extend UserPlan.endDate
│  ├─ Extend mappings (only if re-enrollment policy allows)
│  └─ UserPlan: → ACTIVE | Mappings: ACTIVE
```

---

## 📋 Comprehensive Test Cases Matrix

### **Test Case Categories:**
1. Payment Scenarios
2. Waiting Period Scenarios
3. Notification Scenarios
4. Mapping Lifecycle Scenarios
5. Edge Cases & Error Scenarios

---

## 1️⃣ Payment Scenarios

| Test Case ID | Scenario | Pre-Conditions | Test Steps | Expected Result | Status Field to Verify |
|--------------|----------|----------------|------------|-----------------|----------------------|
| **PAY-001** | Payment success on Day 0 | • UserPlan.endDate = TODAY<br>• PaymentOption = SUBSCRIPTION<br>• autoRenewal = true<br>• Waiting period = 7 days | 1. Set endDate to TODAY<br>2. Run scheduler<br>3. Simulate webhook success | • Payment initiated<br>• UserPlan.endDate extended<br>• Mappings.expiryDate extended<br>• UserPlan status = ACTIVE | `payment_log.status = SUCCESS`<br>`user_plan.end_date` extended |
| **PAY-002** | Payment fails on Day 0 | • UserPlan.endDate = TODAY<br>• PaymentOption = SUBSCRIPTION<br>• autoRenewal = true<br>• Mock payment service to fail | 1. Set endDate to TODAY<br>2. Run scheduler<br>3. Simulate payment failure | • Payment attempted<br>• payment_log.status = FAILED<br>• UserPlan stays ACTIVE<br>• No date extension | `payment_log.status = FAILED`<br>`user_plan.status = ACTIVE` |
| **PAY-003** | Payment retry on Day N (last day) | • Day 0 payment FAILED<br>• endDate = TODAY - 7 days<br>• Waiting period = 7 days | 1. Set endDate to TODAY - 7 days<br>2. Run scheduler<br>3. Verify retry attempt | • Checks payment_log status<br>• Finds FAILED status<br>• Retries payment<br>• New payment_log entry created | `payment_log.status = PENDING` (new entry)<br>`COUNT(payment_log) = 2` |
| **PAY-004** | No retry if Day 0 payment SUCCESS | • Day 0 payment SUCCESS<br>• endDate = TODAY - 7 days<br>• Waiting period = 7 days | 1. Set payment_log.status = SUCCESS<br>2. Set endDate to TODAY - 7 days<br>3. Run scheduler | • Checks payment_log status<br>• Finds SUCCESS status<br>• Skips retry<br>• Log: "no retry needed" | `COUNT(payment_log) = 1` (no new entry)<br>Log contains "First payment SUCCESS" |
| **PAY-005** | No retry if Day 0 payment PENDING | • Day 0 payment PENDING<br>• endDate = TODAY - 7 days<br>• Waiting period = 7 days | 1. Set payment_log.status = PENDING<br>2. Set endDate to TODAY - 7 days<br>3. Run scheduler | • Checks payment_log status<br>• Finds PENDING status<br>• Skips retry<br>• Waits for webhook | `COUNT(payment_log) = 1` (no new entry)<br>Log contains "waiting for webhook" |
| **PAY-006** | No payment for FREE plan | • PaymentOption = FREE<br>• endDate = TODAY | 1. Set endDate to TODAY<br>2. Run scheduler | • No payment attempted<br>• No payment_log entry<br>• UserPlan stays ACTIVE | `COUNT(payment_log) = 0`<br>`user_plan.status = ACTIVE` |
| **PAY-007** | No payment for DONATION plan | • PaymentOption = DONATION<br>• endDate = TODAY | 1. Set endDate to TODAY<br>2. Run scheduler | • No payment attempted<br>• No payment_log entry | `COUNT(payment_log) = 0` |
| **PAY-008** | No payment for ONE_TIME plan | • PaymentOption = ONE_TIME<br>• endDate = TODAY | 1. Set endDate to TODAY<br>2. Run scheduler | • No payment attempted<br>• No payment_log entry | `COUNT(payment_log) = 0` |
| **PAY-009** | Payment with auto-renewal disabled | • PaymentOption = SUBSCRIPTION<br>• autoRenewal = false<br>• endDate = TODAY | 1. Set autoRenewal to false<br>2. Set endDate to TODAY<br>3. Run scheduler | • No payment attempted<br>• Notification sent | `COUNT(payment_log) = 0`<br>Notification sent |
| **PAY-010** | Both payments fail, move to INVITED | • Day 0: FAILED<br>• Day 7: FAILED<br>• Day 8: after waiting period | 1. Simulate 2 failures<br>2. Set endDate to TODAY - 8 days<br>3. Run scheduler | • FinalExpiryProcessor runs<br>• Moves to INVITED<br>• UserPlan = EXPIRED | `user_plan.status = EXPIRED`<br>`mapping.status = DELETED`<br>`invited_mapping.status = INVITED` |

---

## 🧪 Test Scenarios

### **Scenario 1: Successful Payment on Day 0**

**Setup:**
- UserPlan: `endDate = TODAY`
- PaymentOption: `SUBSCRIPTION` with auto-renewal enabled
- Waiting Period: `7 days`

**Expected Behavior:**

| Day | Event | UserPlan Status | Mapping Status | Payment |
|-----|-------|----------------|----------------|---------|
| -3 | Pre-expiry notification | ACTIVE | ACTIVE | - |
| 0 | Expiry + Payment Attempt #1 | ACTIVE | ACTIVE | ✅ Initiated |
| 0 (webhook) | Payment success | ACTIVE | ACTIVE | ✅ Success |
| 0 (after webhook) | Dates extended | ACTIVE | ACTIVE | - |

**Test Steps:**
```sql
-- 1. Set expiry date to today
UPDATE user_plan 
SET end_date = CURRENT_DATE 
WHERE id = 'test-user-plan-id';

-- 2. Run scheduler
-- Expected: Payment initiated, webhook processes success

-- 3. Verify extension
SELECT end_date FROM user_plan WHERE id = 'test-user-plan-id';
-- Should be: CURRENT_DATE + validityInDays
```

---

### **Scenario 2: Payment Fails on Day 0, Succeeds on Day N (Last Day)**

**Setup:**
- UserPlan: `endDate = TODAY`
- PaymentOption: `SUBSCRIPTION` with auto-renewal enabled
- Waiting Period: `7 days`
- Simulate payment failure on Day 0

**Expected Behavior:**

| Day | Event | UserPlan Status | Mapping Status | Payment |
|-----|-------|----------------|----------------|---------|
| 0 | Expiry + Payment Attempt #1 | ACTIVE | ACTIVE | ❌ Failed |
| 1-6 | Waiting period notifications | ACTIVE | ACTIVE | - |
| 7 | Payment Retry (Attempt #2) | ACTIVE | ACTIVE | ✅ Initiated |
| 7 (webhook) | Payment success | ACTIVE | ACTIVE | ✅ Success |
| 7 (after webhook) | Dates extended | ACTIVE | ACTIVE | - |

**Test Steps:**
```sql
-- Day 0
UPDATE user_plan SET end_date = CURRENT_DATE WHERE id = 'test-id';
-- Simulate payment failure (mock payment service to return error)

-- Day 7 (last day of waiting period)
UPDATE user_plan SET end_date = CURRENT_DATE - INTERVAL '7 days' WHERE id = 'test-id';
-- Payment retry should succeed

-- Verify
SELECT status, end_date FROM user_plan WHERE id = 'test-id';
-- Expected: status = ACTIVE, end_date extended
```

---

### **Scenario 3: Both Payments Fail, Move to INVITED**

**Setup:**
- UserPlan: `endDate = TODAY - 8 days` (past waiting period)
- PaymentOption: `SUBSCRIPTION` with auto-renewal enabled
- Waiting Period: `7 days`
- Both payments failed

**Expected Behavior:**

| Day | Event | UserPlan Status | Mapping Status | Payment |
|-----|-------|----------------|----------------|---------|
| 0 | Expiry + Payment Attempt #1 | ACTIVE | ACTIVE | ❌ Failed |
| 1-6 | Waiting period | ACTIVE | ACTIVE | - |
| 7 | Payment Retry (Attempt #2) | ACTIVE | ACTIVE | ❌ Failed |
| 8 | FinalExpiryProcessor runs | EXPIRED ✅ | TERMINATED → INVITED | ❌ No attempt |

**Test Steps:**
```sql
-- Simulate Day 8 (after waiting period)
UPDATE user_plan 
SET end_date = CURRENT_DATE - INTERVAL '8 days' 
WHERE id = 'test-id';

-- Run scheduler
-- Expected: FinalExpiryProcessor moves to INVITED

-- Verify UserPlan
SELECT status FROM user_plan WHERE id = 'test-id';
-- Expected: EXPIRED

-- Verify ACTIVE mapping marked as TERMINATED
SELECT status FROM student_session_institute_group_mapping 
WHERE user_plan_id = 'test-id' AND status = 'TERMINATED';

-- Verify INVITED mapping created
SELECT * FROM student_session_institute_group_mapping 
WHERE user_plan_id = 'test-id' 
  AND status = 'INVITED' 
  AND source = 'EXPIRED';
-- Should find INVITED mapping pointing to INVITED package session
```

---

## 📊 Database Validation Queries

### **Check UserPlan Status**
```sql
SELECT id, user_id, status, start_date, end_date, source, sub_org_id 
FROM user_plan 
WHERE id = 'test-id';
```

### **Check Mappings Status**
```sql
SELECT id, user_id, package_session_id, status, expiry_date, source, type, type_id 
FROM student_session_institute_group_mapping 
WHERE user_plan_id = 'test-id' 
ORDER BY status, expiry_date;
```

### **Check INVITED Mappings**
```sql
SELECT ssigm.id, ssigm.status, ssigm.source, ssigm.type_id, 
       ps.name AS invited_package_name,
       dest_ps.name AS destination_package_name
FROM student_session_institute_group_mapping ssigm
JOIN package_session ps ON ssigm.package_session_id = ps.id
LEFT JOIN package_session dest_ps ON ssigm.destination_package_session_id = dest_ps.id
WHERE ssigm.user_plan_id = 'test-id' 
  AND ssigm.status = 'INVITED';
```

### **Check Payment Logs**
```sql
SELECT id, user_plan_id, status, created_at, order_id 
FROM payment_log 
WHERE user_plan_id = 'test-id' 
ORDER BY created_at DESC;
```

---

## 🚨 Edge Cases & Error Handling

### **Edge Case 1: UserPlan without endDate**
**Behavior:** PackageSessionEnrolmentService initializes from mappings
```sql
SELECT id, end_date FROM user_plan WHERE end_date IS NULL;
-- Should auto-initialize from max(mapping.expiryDate)
```

### **Edge Case 2: No INVITED Package Session Found**
**Behavior:** Throws exception, logs error, skips mapping
```sql
-- Verify INVITED package session exists
SELECT id, level_id, session_id, status 
FROM package_session 
WHERE level_id = 'INVITED' AND session_id = 'INVITED';
-- Must exist for each package
```

### **Edge Case 3: Payment Webhook Never Arrives**
**Behavior:** UserPlan stays in PENDING status until FinalExpiryProcessor runs
```sql
-- Check stuck payments
SELECT id, user_plan_id, status, created_at 
FROM payment_log 
WHERE status = 'PENDING' 
  AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 day';
```

---

## ✅ Checklist for Tester

- [ ] Verify payment attempt on Day 0
- [ ] Verify payment retry on last day of waiting period
- [ ] Verify NO payment attempt in FinalExpiryProcessor
- [ ] Verify UserPlan stays ACTIVE until after waiting period
- [ ] Verify mappings moved to INVITED after waiting period
- [ ] Verify INVITED mapping created/updated correctly
- [ ] Verify ACTIVE mapping marked as DELETED (soft delete)
- [ ] Verify mappings with future dates are skipped
- [ ] Verify re-enrollment policy respected
- [ ] Verify SUB_ORG processed once per UserPlan
- [ ] Verify notifications sent to ROOT_ADMIN (SUB_ORG) or user (individual)
- [ ] Verify payment webhook updates UserPlan and mappings correctly

---

## 📞 Support

For issues or questions, contact:
- **Backend Team:** backend@example.com
- **Database Team:** db@example.com

---

**Document Version:** 1.0  
**Last Updated:** 2024-12-08  
**Author:** GitHub Copilot
