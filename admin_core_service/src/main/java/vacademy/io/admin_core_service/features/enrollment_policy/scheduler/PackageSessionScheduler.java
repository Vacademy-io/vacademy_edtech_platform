package vacademy.io.admin_core_service.features.enrollment_policy.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.enrollment_policy.service.PackageSessionEnrolmentService;
import vacademy.io.admin_core_service.features.enrollment_policy.service.RenewalChargeService;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class PackageSessionScheduler {

    private final PackageSessionEnrolmentService enrolmentService;
    private final UserPlanRepository userPlanRepository;
    private final WorkflowTriggerService workflowTriggerService;
    private final WorkflowExecutionRepository workflowExecutionRepository;
    private final RenewalChargeService renewalChargeService;
    private final PaymentSettingService paymentSettingService;

    /**
     * Pre-existing manual-trigger entry point for enrolment-policy actions
     * (expire / graduate active UserPlans). Currently invoked only from
     * {@code TestEnrollMentController} — intentionally not auto-scheduled
     * because it sweeps the WHOLE user_plan table. The scheduled path is
     * {@link #processPackageSessionRenewals()}, which scopes the sweep to
     * institutes that opted in via PAYMENT_SETTING.
     */
    public void processPackageSessionExpiries() {
        log.info("Starting PackageSessionScheduler job...");
        try {
            enrolmentService.processActiveEnrollments();
        } catch (Exception e) {
            log.error("Error during scheduled package session processing", e);
        }
        log.info("PackageSessionScheduler job finished.");
    }

    // ─── Institute-gated renewal/expiry scan ───────────────────────────────
    //
    // The enrolment-policy sweep (pre-expiry notifications → waiting period →
    // final expiry, per PackageSession policy JSON) is now scheduled — but ONLY
    // for institutes that opted in by saving
    // PAYMENT_SETTING.packageSessionRenewalSchedulerEnabled = true (default:
    // absent = off, so no institute is swept until an admin turns it on).
    // ShedLock guards the run because prod has 4 replicas and the processors
    // send notifications / flip plan statuses — running it 4x would duplicate
    // learner emails.

    /** Runs daily at 04:00, well before the 09:00 reminder and 11:00 charge scans. */
    @Scheduled(cron = "0 0 4 * * ?")
    @SchedulerLock(name = "PackageSessionRenewScheduler", lockAtMostFor = "PT55M", lockAtLeastFor = "PT1M")
    public void processPackageSessionRenewals() {
        List<String> instituteIds = paymentSettingService.getInstituteIdsWithRenewalSchedulerEnabled();
        if (instituteIds.isEmpty()) {
            log.info("[PackageSessionRenew] No institutes have enabled the renewal scheduler — nothing to do");
            return;
        }
        log.info("[PackageSessionRenew] Running enrolment-policy scan for {} opted-in institute(s)", instituteIds.size());
        try {
            enrolmentService.processActiveEnrollmentsForInstitutes(instituteIds);
        } catch (Exception e) {
            log.error("[PackageSessionRenew] Institute-gated enrolment-policy scan failed", e);
        }
        log.info("[PackageSessionRenew] Scan finished.");
    }

    // ─── Paid-but-not-enrolled integrity check ─────────────────────────────
    //
    // A learner whose plan is ACTIVE and who has paid must hold an enrolment. When that
    // stops being true, nothing visibly breaks on our side: the plan reads ACTIVE, the
    // payment reads PAID, finance reconciles — and the learner quietly sits in no batch,
    // receives no class links and shows in no member list. That is exactly how 2026-10-04
    // went unnoticed until the client reported it (one learner, Rs 7,200, 22 hours).
    //
    // The write-side holes are closed (enrolment, renewal and stacked-promotion paths all
    // ensure the enrolment now), so this is a net for the paths we have not thought of.
    // Deliberately report-only: it logs at ERROR so the condition surfaces the next morning
    // without a scheduler silently mutating learner access.

    /** Runs daily at 04:30, right after the enrolment-policy sweep. */
    @Scheduled(cron = "0 30 4 * * ?")
    @SchedulerLock(name = "PaidWithoutEnrollmentCheck", lockAtMostFor = "PT20M", lockAtLeastFor = "PT1M")
    public void reportPaidPlansWithoutEnrollment() {
        try {
            List<UserPlan> orphans = userPlanRepository.findPaidActivePlansWithoutEnrollment();
            if (orphans.isEmpty()) {
                log.info("[PaidWithoutEnrollment] Clean — every paid ACTIVE plan has an enrolment");
                return;
            }
            log.error("[PaidWithoutEnrollment] {} paid ACTIVE plan(s) hold NO enrolment — the learner "
                    + "paid and has no access: {}", orphans.size(),
                    orphans.stream()
                            .map(p -> p.getId() + " (user " + p.getUserId() + ")")
                            .collect(Collectors.joining(", ")));
        } catch (Exception e) {
            log.error("[PaidWithoutEnrollment] Integrity check failed", e);
        }
    }

    // ─── Membership-expiry workflow trigger ────────────────────────────────
    //
    // Daily scan that fires the MEMBERSHIP_EXPIRY workflow trigger once per
    // user plan that's about to expire — paired with the Settings →
    // Automations "Remind learners before their access expires" recipe.
    //
    // Hosted here (alongside the existing enrolment scheduler) instead of in a
    // dedicated Quartz job because (a) the work is a one-line repository
    // scan, (b) all other periodic work in this codebase uses Spring's
    // @Scheduled annotation, and (c) Quartz is reserved for the workflow
    // engine and the live-session processor.

    /** Reminder window: plans whose end_date is within this many days. */
    private static final int DAYS_BEFORE_EXPIRY = 7;

    /**
     * Dedup look-back for the {@code workflow_execution} idempotency-key
     * scan — large enough to cover the reminder window plus margin, small
     * enough that a re-purchased plan eventually re-qualifies.
     */
    private static final int DEDUP_WINDOW_DAYS = 30;

    /**
     * Fires MEMBERSHIP_EXPIRY for plans entering the reminder window.
     * Dedup is two-layer: (1) this method checks workflow_execution for a
     * prior emission for the same plan and skips if found, keeping logs
     * quiet; (2) the EVENT_BASED idempotency strategy on MEMBERSHIP_EXPIRY
     * triggers (see {@code WorkflowBuilderService.isPeriodicScanTrigger})
     * gives a stable idempotency key, so even if two replicas race, the
     * UNIQUE constraint on {@code workflow_execution.idempotency_key}
     * rejects the duplicate at the DB layer.
     * <p>
     * The institute is resolved off the joined EnrollInvite. Plans without
     * one (legacy direct subscriptions) are skipped with a debug log — they
     * need a separate path before we can route their trigger to an
     * institute's workflow.
     */
    @Scheduled(cron = "0 0 9 * * ?")  // 09:00 every day, server timezone
    public void emitMembershipExpiryReminders() {
        Date now = new Date();
        Date cutoff = Date.from(LocalDate.now().plusDays(DAYS_BEFORE_EXPIRY)
                .atStartOfDay(ZoneId.systemDefault()).toInstant());
        Instant dedupSince = Instant.now().minus(DEDUP_WINDOW_DAYS, ChronoUnit.DAYS);

        List<UserPlan> due = userPlanRepository.findActivePlansExpiringSoon(now, cutoff);
        if (due.isEmpty()) {
            log.info("[MembershipExpiry] No plans within {}-day reminder window", DAYS_BEFORE_EXPIRY);
            return;
        }
        log.info("[MembershipExpiry] Found {} plan(s) within reminder window", due.size());

        int fired = 0;
        int skippedAlreadyNotified = 0;
        int skippedNoInstitute = 0;

        for (UserPlan plan : due) {
            String instituteId = plan.getEnrollInvite() != null
                    ? plan.getEnrollInvite().getInstituteId()
                    : null;
            if (instituteId == null || instituteId.isBlank()) {
                skippedNoInstitute++;
                log.debug("[MembershipExpiry] Skipping plan {} — no institute resolvable", plan.getId());
                continue;
            }

            // Application-level dedup against the EVENT_BASED key format
            // produced by EventBasedKeyGenerator:
            //   trigger_<triggerId>_eventType_<eventName>_eventId_<eventId>
            String keyPattern = "%eventType_"
                    + WorkflowTriggerEvent.MEMBERSHIP_EXPIRY.name()
                    + "_eventId_" + plan.getId() + "%";
            if (workflowExecutionRepository.countByIdempotencyKeyLikeSince(keyPattern, dedupSince) > 0) {
                skippedAlreadyNotified++;
                log.debug("[MembershipExpiry] Skipping plan {} — already notified in last {} days",
                        plan.getId(), DEDUP_WINDOW_DAYS);
                continue;
            }

            try {
                long daysToExpiry = (plan.getEndDate().getTime() - now.getTime())
                        / (1000L * 60 * 60 * 24);
                Map<String, Object> ctx = new HashMap<>();
                ctx.put("userPlanId", plan.getId());
                ctx.put("userId", plan.getUserId());
                ctx.put("paymentPlanId", plan.getPaymentPlanId());
                ctx.put("enrollInviteId", plan.getEnrollInviteId());
                ctx.put("endDate", plan.getEndDate().toString());
                ctx.put("daysToExpiry", daysToExpiry);

                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.MEMBERSHIP_EXPIRY.name(),
                        plan.getId(),
                        instituteId,
                        ctx);
                fired++;
            } catch (Exception ex) {
                log.warn("[MembershipExpiry] Failed to fire trigger for plan {}: {}",
                        plan.getId(), ex.getMessage());
            }
        }

        log.info("[MembershipExpiry] Done — fired={} skippedAlreadyNotified={} skippedNoInstitute={}",
                fired, skippedAlreadyNotified, skippedNoInstitute);
    }

    // ─── Autopay auto-charge ────────────────────────────────────────────────
    //
    // Debits due autopay subscriptions on their next_charge_at. Runs a few
    // hours AFTER the reminder scan so the "expiring soon" nudge always precedes
    // the charge. Narrowly scoped to plans with auto_renewal_enabled = true
    // (see UserPlanRepository.findDueForRenewal), so it can never touch a
    // pre-existing / non-autopay plan — unlike processActiveEnrollments, which
    // stays manual to avoid activating dormant destructive expiry behaviour.
    //
    // ShedLock: the per-plan claim (claimForRenewal) protects a SUCCESSFUL charge
    // from being repeated, but a FAILED charge is re-armed for tomorrow at once,
    // which makes the plan claimable again by the next replica seconds later. With
    // 4 replicas and no lock, 22 due plans produced 52 Razorpay orders on
    // 2026-09-19 — every refused plan was presented up to four times in one
    // minute. One replica runs the sweep; the others find the lock and skip.

    /**
     * Runs daily at 15:00 IST (09:30 UTC, still after the 09:00 UTC reminder scan).
     * The hour is deliberate for UPI Autopay: the issuing bank sends the customer a
     * pre-debit notification and executes the debit roughly 24 h after we present
     * the charge, so presenting at 15:00 on the day BEFORE the due date (see
     * {@code AUTOPAY_SETTING.CHARGE_LEAD_DAYS}) lands the money on the due date itself.
     * Pinned to Asia/Kolkata so a pod timezone change cannot move it.
     */
    @Scheduled(cron = "0 0 15 * * ?", zone = "Asia/Kolkata")
    @SchedulerLock(name = "RenewalChargeSweep", lockAtMostFor = "PT50M", lockAtLeastFor = "PT2M")
    public void emitRenewalCharges() {
        // Institute-gated, like the 04:00 policy scan -- but on its OWN flag
        // (PAYMENT_SETTING.autopayChargeSchedulerEnabled), because this job presents money to
        // the gateway rather than sending notifications. Until an institute is explicitly
        // opted in, nothing here is charged for it, whatever its plans have armed.
        List<String> instituteIds = paymentSettingService.getInstituteIdsWithAutopayChargeEnabled();
        if (instituteIds.isEmpty()) {
            log.info("[RenewalCharge] No institutes have authorised the autopay charge sweep — skipping");
            return;
        }
        log.info("[RenewalCharge] Starting autopay charge scan for {} opted-in institute(s)...",
                instituteIds.size());
        try {
            renewalChargeService.processDueRenewals(instituteIds);
        } catch (Exception e) {
            log.error("[RenewalCharge] Autopay charge scan failed", e);
        }
    }
}
