package vacademy.io.admin_core_service.features.enrollment_policy.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo;
import vacademy.io.admin_core_service.features.user_subscription.util.TrialStartResolver;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.UserInstitutePaymentGatewayMappingService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.payment.enums.PaymentType;

import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * Auto-charge engine for autopay subscriptions. Invoked daily by
 * {@code PackageSessionScheduler.emitRenewalCharges}. Only ACTIVE plans with
 * {@code auto_renewal_enabled = true} and {@code next_charge_at <= now} are
 * touched (see {@code UserPlanRepository.findDueForRenewal}), so no pre-existing
 * / non-autopay plan is ever charged.
 *
 * Per plan: charge the stored mandate off-session, then
 *  - synchronous gateways (eWay) → confirm + extend inline;
 *  - webhook gateways (Razorpay) → leave PENDING; the RENEWAL webhook extends.
 * On failure: dunning — retry daily up to maxAttempts, then expire.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RenewalChargeService {

    private final UserPlanRepository userPlanRepository;
    private final PaymentService paymentService;
    private final UserInstitutePaymentGatewayMappingService mandateService;
    private final RenewalPaymentService renewalPaymentService;
    private final vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService planChangeService;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final AuthService authService;
    private final RenewalGracePolicy gracePolicy;
    private final RenewalFailureRecorder renewalFailureRecorder;
    private final AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    private final vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService paymentLogService;

    /** Default dunning ceiling when the plan/policy doesn't specify one. */
    private static final int DEFAULT_MAX_ATTEMPTS = 3;

    /**
     * Upper bound on {@code AUTOPAY_SETTING.CHARGE_LEAD_DAYS}. The sweep fetches every
     * plan due within this many days and then applies each invite's own lead, so a
     * misconfigured invite can never pull a charge more than this far forward.
     */
    private static final int MAX_CHARGE_LEAD_DAYS = 3;

    /**
     * Charges every armed plan that is due, for the institutes that have authorised it.
     *
     * <p>{@code instituteIds} is required and must be non-empty: the caller resolves who has
     * opted in. There is deliberately no unscoped overload -- the sweep is one platform-wide
     * cron, so an unscoped call means "charge every institute at once", which is never what
     * anyone wants to be one refactor away from.
     */
    public void processDueRenewals(List<String> instituteIds) {
        if (instituteIds == null || instituteIds.isEmpty()) {
            log.info("[RenewalCharge] No institutes have authorised the autopay charge sweep — nothing to do");
            return;
        }
        Date now = new Date();
        // next_charge_at carries the enrollment's time-of-day, so a plan due "today" at
        // 15:00 would be missed by this morning's run and only charge tomorrow. Sweep the
        // whole day so a plan is always charged on the date it falls due.
        //
        // Fetch out to the widest lead any invite may configure, then let each plan's own
        // invite decide whether it is due yet (see isDueWithLead). Invites without
        // CHARGE_LEAD_DAYS keep the exact behaviour they had: due on the date itself.
        // The prefilter runs before any plan -- and so any invite timezone -- is known, so it
        // is cut a full day wide of the widest lead. End of day in one fixed zone would be
        // too early for any institute behind it (end of day in UTC-5 is 04:59 UTC the next
        // morning) and silently drop those plans from the sweep. isDueWithLead then decides
        // precisely, in each invite's own zone.
        List<UserPlan> due = userPlanRepository.findDueForRenewalForInstitutes(
                endOfDay(plusDays(now, MAX_CHARGE_LEAD_DAYS + 1), java.time.ZoneOffset.UTC),
                instituteIds);
        due = due.stream().filter(plan -> isDueWithLead(plan, now)).toList();
        if (due.isEmpty()) {
            log.info("[RenewalCharge] No autopay plans due");
            return;
        }
        log.info("[RenewalCharge] {} autopay plan(s) due", due.size());
        int charged = 0, failed = 0, skipped = 0;
        for (UserPlan plan : due) {
            try {
                // A plan still unpaid after its grace window is closed here, on the sweep,
                // not left to whenever the gateway's next failure webhook happens to
                // arrive — the async path adds a day per attempt, which would stretch a
                // 2-day grace into 4. No charge is presented for it.
                if (gracePolicy.isPastGrace(plan, now)) {
                    // isPastGrace is only ever true with an invite present (grace lives on it).
                    expirePlan(plan, "grace period over");
                    renewalPaymentService.emitRenewalPaymentFailed(plan, plan.getEnrollInvite().getInstituteId(), true);
                    failed++;
                    continue;
                }
                Outcome outcome = processOne(plan, now);
                switch (outcome) {
                    case CHARGED -> charged++;
                    case FAILED -> failed++;
                    default -> skipped++;
                }
            } catch (Exception e) {
                failed++;
                log.error("[RenewalCharge] Unexpected error for plan {}: {}", plan.getId(), e.getMessage(), e);
            }
        }
        log.info("[RenewalCharge] Done — charged={} failed={} skipped={}", charged, failed, skipped);
    }

    /**
     * TEST-ONLY: force a renewal charge for a single plan NOW, bypassing the
     * next_charge_at date filter, so autopay can be verified on demand instead of
     * waiting for the trial/cycle to elapse. Runs the exact same processOne path
     * the scheduler uses. Remove/secure the calling endpoint before prod.
     */
    public String chargeNow(String userPlanId) {
        java.util.List<UserPlan> plans = userPlanRepository.findByIdsWithoutPaymentLogs(java.util.List.of(userPlanId));
        if (plans.isEmpty()) {
            return "PLAN_NOT_FOUND: " + userPlanId;
        }
        UserPlan plan = plans.get(0);
        // processOne's atomic claim needs next_charge_at to be set; arm it to now
        // if the caller is testing a plan whose charge date hasn't arrived yet.
        if (plan.getNextChargeAt() == null) {
            plan.setNextChargeAt(new Date());
            userPlanRepository.save(plan);
        }
        try {
            Outcome o = processOne(plan, new Date());
            return "userPlan=" + userPlanId + " outcome=" + o;
        } catch (Exception e) {
            log.error("[RenewalCharge] chargeNow failed for {}: {}", userPlanId, e.getMessage(), e);
            return "ERROR: " + e.getMessage();
        }
    }

    /**
     * True when a fixed-term subscription has run its full duration. The term is
     * AUTOPAY_SETTING.TOTAL_DURATION_MONTHS on the invite, measured from the plan's
     * start_date. Open-ended (no/invalid setting) always returns false.
     */
    private boolean hasReachedSubscriptionTerm(UserPlan plan, EnrollInvite invite, Date now) {
        Integer months = readTotalDurationMonths(invite);
        if (months == null || months <= 0 || plan.getStartDate() == null) {
            return false;
        }
        // The invite's zone, not the pod's: an IST-midnight start_date read as the previous
        // day under UTC, moving the whole fixed term a day earlier.
        java.time.ZoneId zone = billingZone(plan.getEnrollInvite());
        java.time.LocalDate start = plan.getStartDate().toInstant().atZone(zone).toLocalDate();
        java.time.LocalDate termEnd = start.plusMonths(months);
        java.time.LocalDate today = now.toInstant().atZone(zone).toLocalDate();
        // On/after the term-end date the next cycle would fall outside the paid term.
        return !today.isBefore(termEnd);
    }

    private Integer readTotalDurationMonths(EnrollInvite invite) {
        return readAutopayInt(invite, "TOTAL_DURATION_MONTHS");
    }

    /** Reads an integer AUTOPAY_SETTING key off the invite's settingJson; null if absent. */
    private Integer readAutopayInt(EnrollInvite invite, String key) {
        if (invite == null || !StringUtils.hasText(invite.getSettingJson())) {
            return null;
        }
        try {
            com.fasterxml.jackson.databind.JsonNode ap = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(invite.getSettingJson()).path("setting").path("AUTOPAY_SETTING");
            if (ap.has(key) && !ap.get(key).isNull()) {
                return ap.get(key).asInt();
            }
        } catch (Exception e) {
            log.warn("[RenewalCharge] Could not read {} for invite {}: {}",
                    key, invite.getId(), e.getMessage());
        }
        return null;
    }

    /**
     * A plan is due for this run when the DATE ITS next_charge_at HOLDS, minus the invite's
     * {@code AUTOPAY_SETTING.CHARGE_LEAD_DAYS} (0 when unset, capped at
     * {@link #MAX_CHARGE_LEAD_DAYS}), has arrived. A lead of 1 presents the charge the day
     * before the due date — for UPI Autopay the bank then debits ~24 h later, ON the due
     * date, and the learner has had the pre-debit notification in between. The cycle does
     * not drift: a successful renewal extends from the plan's end_date, not from the charge
     * time (see RenewalPaymentService.calculateNewEndDate).
     *
     * <p><b>The time of day is deliberately ignored.</b> It used to decide the answer, via
     * {@code endOfDay(now + lead, billingZone)}: a next_charge_at of 10:00 UTC anchored to
     * its own date, while 18:30 UTC — midnight in Asia/Kolkata — anchored to the day AFTER
     * the one it reads as. Two plans both recorded "on the 27th" were therefore charged on
     * different days, and the anchor a lead is counted back from moved with a time nobody
     * chose: next_charge_at inherits its clock from whenever the member happened to enrol.
     * Six of SuchBliss's sixteen armed plans sit on the midnight boundary and ten do not,
     * which is precisely why the timing looked arbitrary instead of wrong.
     *
     * <p>So the anchor is the date the column holds and nothing else. "27th at any time" is
     * the 27th, a lead of 1 charges on the 26th, and an institute picks its billing day by
     * setting that date — no per-institute code, and no zone arithmetic between the date an
     * admin reads in the row and the day the money moves.
     */
    private boolean isDueWithLead(UserPlan plan, Date now) {
        if (plan.getNextChargeAt() == null) {
            return false;
        }
        int lead = resolveChargeLeadDays(plan.getEnrollInvite());
        return !storedDate(plan.getNextChargeAt()).minusDays(lead).isAfter(storedDate(now));
    }

    /**
     * The calendar date a timestamp column HOLDS, time of day discarded.
     *
     * <p>{@code next_charge_at} is {@code timestamp without time zone} and is read back at
     * UTC, so this is the date that appears if you select the column — which is the whole
     * point: it is the date an admin sees, a support query returns, and a reminder prints.
     */
    private static java.time.LocalDate storedDate(Date date) {
        return date.toInstant().atZone(java.time.ZoneOffset.UTC).toLocalDate();
    }

    private int resolveChargeLeadDays(EnrollInvite invite) {
        Integer lead = readAutopayInt(invite, "CHARGE_LEAD_DAYS");
        if (lead == null || lead < 0) {
            return 0;
        }
        return Math.min(lead, MAX_CHARGE_LEAD_DAYS);
    }

    private static Date plusDays(Date date, int days) {
        Calendar cal = Calendar.getInstance();
        cal.setTime(date);
        cal.add(Calendar.DAY_OF_MONTH, days);
        return cal.getTime();
    }

    /**
     * Last instant of the given day IN THE INVITE'S BILLING ZONE, so "due today" means due
     * by this run.
     *
     * <p>Built with Calendar.getInstance() this was the last instant of the day in the POD's
     * zone — 23:59:59 UTC, i.e. 05:29 the next morning in Asia/Kolkata. A charge stored at
     * IST midnight of the day after the lead window (18:30 UTC) therefore fell inside it and
     * got presented a day early. 20 SuchBliss plans hold exactly such a next_charge_at.
     */
    private static Date endOfDay(Date date, java.time.ZoneId zone) {
        return Date.from(date.toInstant().atZone(zone).toLocalDate()
                .atTime(java.time.LocalTime.MAX).atZone(zone).toInstant());
    }

    private static java.time.ZoneId billingZone(EnrollInvite invite) {
        return TrialStartResolver.zoneFromInvite(invite != null ? invite.getSettingJson() : null);
    }

    private enum Outcome { CHARGED, FAILED, SKIPPED }

    /**
     * One plan at a time. Each Spring-Data save commits independently and the
     * gateway charge (PaymentService) + confirmation (RenewalPaymentService) run
     * in their own transactions, so one plan's failure never affects another.
     * The attempt-bump + disarm is committed BEFORE the charge to make
     * double-charging on a duplicate scheduler run impossible.
     */
    private Outcome processOne(UserPlan plan, Date now) {
        EnrollInvite invite = plan.getEnrollInvite();
        if (invite == null || !StringUtils.hasText(invite.getInstituteId())) {
            log.warn("[RenewalCharge] Plan {} has no institute — skipping", plan.getId());
            return Outcome.SKIPPED;
        }
        String instituteId = invite.getInstituteId();
        String vendor = invite.getVendor();
        if (!StringUtils.hasText(vendor) || "MANUAL".equalsIgnoreCase(vendor)) {
            log.info("[RenewalCharge] Plan {} vendor={} not chargeable — skipping", plan.getId(), vendor);
            return Outcome.SKIPPED;
        }

        // Fixed-term subscription: once the configured total duration has elapsed, stop
        // charging and turn autopay off. The learner keeps access until the current
        // period's end_date, then it lapses naturally — we don't revoke here.
        if (hasReachedSubscriptionTerm(plan, invite, now)) {
            log.info("[RenewalCharge] Plan {} reached its total subscription term — stopping autopay", plan.getId());
            plan.setAutoRenewalEnabled(false);
            plan.setNextChargeAt(null);
            userPlanRepository.save(plan);
            return Outcome.SKIPPED;
        }

        MandateInfo mandate = mandateService.getMandateOrLegacyToken(plan.getUserId(), instituteId, vendor, plan.getId());
        if (mandate == null || !MandateInfo.STATUS_ACTIVE.equalsIgnoreCase(mandate.getStatus())) {
            log.warn("[RenewalCharge] Plan {} has no ACTIVE mandate/token — skipping (needs registration/backfill)",
                    plan.getId());
            return Outcome.SKIPPED;
        }

        double grossAmount = resolveAmount(plan);
        if (grossAmount <= 0) {
            log.warn("[RenewalCharge] Plan {} has non-positive amount — skipping", plan.getId());
            return Outcome.SKIPPED;
        }
        // Discount for this cycle: only an admin discount granted for N cycles (or every
        // cycle). Coupons never reach renewals, as before. A scheduled plan change ends it.
        AppliedCouponDiscount renewalDiscount = resolveRenewalDiscount(plan);
        // No discount: charge exactly what was charged before (no rounding introduced).
        double amount = renewalDiscount == null
                ? grossAmount
                : RegionalPriceLock.applyDiscount(plan, grossAmount, renewalDiscount);
        // A regionally priced membership renews in the currency it was bought in.
        String currency = RegionalPriceLock.currency(plan,
                StringUtils.hasText(invite.getCurrency()) ? invite.getCurrency()
                        : (mandate.getCurrency() != null ? mandate.getCurrency() : "INR"));

        UserDTO user = getUser(plan.getUserId());
        if (user == null) {
            log.warn("[RenewalCharge] Plan {} — user {} not found — skipping", plan.getId(), plan.getUserId());
            return Outcome.SKIPPED;
        }

        // Atomically CLAIM this plan for this cycle BEFORE calling the gateway.
        // The daily scheduler fires on every replica, so only the replica whose
        // UPDATE flips next_charge_at→null (rows-affected = 1) proceeds; the rest
        // skip. This is the multi-replica double-charge guard.
        if (userPlanRepository.claimForRenewal(plan.getId(), now) == 0) {
            log.info("[RenewalCharge] Plan {} already claimed by another replica — skipping", plan.getId());
            return Outcome.SKIPPED;
        }
        // Reflect the atomic claim in the in-memory entity for downstream logic.
        plan.setNextChargeAt(null);
        plan.setLastRenewalAttemptAt(now);
        plan.setRenewalAttemptCount((plan.getRenewalAttemptCount() == null ? 0 : plan.getRenewalAttemptCount()) + 1);

        PaymentInitiationRequestDTO request = new PaymentInitiationRequestDTO();
        request.setAmount(amount);
        request.setCurrency(currency);
        request.setVendor(vendor);
        request.setVendorId(invite.getVendorId());
        request.setEmail(user.getEmail());
        request.setInstituteId(instituteId);
        request.setPaymentType(PaymentType.RENEWAL);
        // Razorpay's recurring-payment API requires a contact, and it must be a real
        // phone number (digits and + only). It used to be filled from vendorId -- the
        // invite's gateway id, literally "RAZORPAY" -- so every auto-charge was rejected
        // with "Contact number contains invalid characters" before it ever reached the
        // mandate, and the failure took its own payment_log down with it (PaymentService
        // is @Transactional), leaving only a rising renewal_attempt_count as evidence.
        vacademy.io.common.payment.dto.RazorpayRequestDTO razorpayRequest =
                new vacademy.io.common.payment.dto.RazorpayRequestDTO();
        if (StringUtils.hasText(user.getMobileNumber())) {
            razorpayRequest.setContact(user.getMobileNumber().replaceAll("[^0-9+]", ""));
        }
        request.setRazorpayRequest(razorpayRequest);

        if (amount <= 0) {
            // Fully discounted cycle: nothing to present to the gateway (they reject
            // zero-amount charges), so settle it as PAID directly and extend the plan.
            String zeroLogId = paymentLogService.createPaymentLog(plan.getUserId(), 0.0, vendor,
                    invite.getVendorId(), currency, plan);
            paymentService.recordRenewalDiscountLineItem(zeroLogId, renewalDiscount, grossAmount, plan);
            renewalPaymentService.handleRenewalPaymentConfirmation(
                    zeroLogId, instituteId, PaymentStatusEnum.PAID, null);
            log.info("[RenewalCharge] Plan {} renewed without a charge — discount covers the full {}",
                    plan.getId(), grossAmount);
            return Outcome.CHARGED;
        }

        try {
            PaymentResponseDTO response = paymentService.handleRecurringCharge(
                    user, instituteId, vendor, request, plan, mandate);
            // Before the sync confirmation below: confirming PAID counts the discounted
            // cycle only when this log carries the discount line. Never let this
            // bookkeeping turn a successful charge into a dunning retry.
            if (renewalDiscount != null) {
                try {
                    paymentService.recordRenewalDiscountLineItem(response.getOrderId(), renewalDiscount,
                            grossAmount, plan);
                } catch (Exception lineItemError) {
                    log.error("[RenewalCharge] Plan {} charged but discount line not recorded: {}",
                            plan.getId(), lineItemError.getMessage());
                }
            }

            if (isSyncSuccess(response)) {
                // eWay / any gateway that confirms synchronously — extend now.
                renewalPaymentService.handleRenewalPaymentConfirmation(
                        response.getOrderId(), instituteId, PaymentStatusEnum.PAID, response);
                log.info("[RenewalCharge] Plan {} charged + confirmed (sync)", plan.getId());
                return Outcome.CHARGED;
            }
            // Webhook gateways (Razorpay): submitted, awaiting RENEWAL webhook to
            // extend. next_charge_at stays null so we don't re-charge meanwhile.
            log.info("[RenewalCharge] Plan {} charge submitted — awaiting webhook confirmation", plan.getId());
            return Outcome.CHARGED;
        } catch (Exception e) {
            // ERROR, not WARN: the pods log at DEBUG and rotate within minutes, so a WARN
            // is gone before anyone asks why a member was not charged; ERROR reaches
            // Sentry. The gateway's reason is also persisted on a FAILED payment_log --
            // handleRecurringCharge is @Transactional, so its own log rolled back with
            // the exception and the failure left no record at all.
            log.error("[RenewalCharge] Plan {} charge failed (attempt {}): {}",
                    plan.getId(), plan.getRenewalAttemptCount(), e.getMessage());
            renewalFailureRecorder.record(plan, amount, currency, vendor, invite.getVendorId(), e.getMessage());
            applyDunning(plan, now, instituteId);
            return Outcome.FAILED;
        }
    }

    /**
     * Failed charge: retry tomorrow up to maxAttempts, then expire the plan and
     * deactivate access. Reuses the same EXPIRED semantics as the enrolment
     * processor.
     */
    private void applyDunning(UserPlan plan, Date now, String instituteId) {
        int maxAttempts = resolveMaxAttempts(plan);
        // Access is retained while we retry. The grace period (AUTOPAY_SETTING.
        // GRACE_PERIOD_DAYS) extends that window: keep access and keep retrying until
        // end_date + grace has fully passed, THEN revoke — see RenewalGracePolicy. With
        // no grace configured we fall back to the attempt ceiling alone.
        boolean exhausted = gracePolicy.isExhausted(plan, now, plan.getRenewalAttemptCount(), maxAttempts);
        if (exhausted) {
            expirePlan(plan, "exhausted " + plan.getRenewalAttemptCount() + " attempts");
        } else {
            // Retry tomorrow.
            Calendar c = Calendar.getInstance();
            c.setTime(now);
            c.add(Calendar.DAY_OF_MONTH, 1);
            plan.setNextChargeAt(c.getTime());
            userPlanRepository.save(plan);
            log.info("[RenewalCharge] Plan {} will retry on {}", plan.getId(), c.getTime());
        }
        // Let workflows react (dunning WhatsApp/email, admin alerts). Never blocks the money path.
        renewalPaymentService.emitRenewalPaymentFailed(plan, instituteId, exhausted);
    }

    private void expirePlan(UserPlan plan, String reason) {
        plan.setStatus(UserPlanStatusEnum.EXPIRED.name());
        plan.setNextChargeAt(null);
        userPlanRepository.save(plan);
        deactivateMappings(plan);
        String vendor = plan.getEnrollInvite() != null ? plan.getEnrollInvite().getVendor() : null;
        log.warn("[RenewalCharge] Plan {} expired — {} (vendor={})", plan.getId(), reason, vendor);
    }

    private void deactivateMappings(UserPlan plan) {
        List<StudentSessionInstituteGroupMapping> mappings =
                mappingRepository.findByUserPlanIdAndStatus(plan.getId(), LearnerSessionStatusEnum.ACTIVE.name());
        for (StudentSessionInstituteGroupMapping m : mappings) {
            m.setStatus(LearnerSessionStatusEnum.INACTIVE.name());
            mappingRepository.save(m);
        }
    }

    private boolean isSyncSuccess(PaymentResponseDTO response) {
        if (response == null || response.getResponseData() == null) {
            return false;
        }
        Map<String, Object> d = response.getResponseData();
        Object paymentStatus = d.get("paymentStatus");
        if (paymentStatus != null && PaymentStatusEnum.PAID.name().equalsIgnoreCase(paymentStatus.toString())) {
            return true;
        }
        Object status = d.get("status");
        return status != null && ("succeeded".equalsIgnoreCase(status.toString())
                || "captured".equalsIgnoreCase(status.toString()));
    }

    /**
     * What to charge this cycle. A downgrade booked for the end of the cycle lands at
     * exactly this renewal, so the learner is billed the plan they are moving TO — charging
     * the old price here would take money for a plan they will not be on the moment the
     * charge settles.
     */
    private AppliedCouponDiscount resolveRenewalDiscount(UserPlan plan) {
        if (!StringUtils.hasText(plan.getAppliedCouponDiscountId())) {
            return null;
        }
        try {
            if (planChangeService.pendingTargetPlan(plan) != null) {
                return null;
            }
            AppliedCouponDiscount discount = appliedCouponDiscountRepository
                    .findById(plan.getAppliedCouponDiscountId()).orElse(null);
            return AdminDiscountService.discountForNextCharge(plan, discount);
        } catch (Exception e) {
            // Fall back to the full price rather than skipping the renewal.
            log.error("[RenewalCharge] Plan {} discount lookup failed — charging full price: {}",
                    plan.getId(), e.getMessage());
            return null;
        }
    }

    private double resolveAmount(UserPlan plan) {
        PaymentPlan pending = planChangeService.pendingTargetPlan(plan);
        if (pending != null) {
            log.info("[RenewalCharge] Plan {} has a scheduled change — charging target plan {} ({})",
                    plan.getId(), pending.getId(), pending.getActualPrice());
            return pending.getActualPrice();
        }
        // Locked regional price when the member bought under regional pricing, else the plan's.
        return RegionalPriceLock.listPrice(plan);
    }

    private int resolveMaxAttempts(UserPlan plan) {
        // Policy-driven override is read at enrollment time onto the plan snapshot;
        // fall back to the default ceiling here.
        return DEFAULT_MAX_ATTEMPTS;
    }

    private UserDTO getUser(String userId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            return users.isEmpty() ? null : users.get(0);
        } catch (Exception e) {
            log.error("[RenewalCharge] Failed to load user {}: {}", userId, e.getMessage());
            return null;
        }
    }
}
