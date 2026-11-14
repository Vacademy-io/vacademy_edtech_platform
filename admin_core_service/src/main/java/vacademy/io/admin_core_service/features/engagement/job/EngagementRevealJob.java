package vacademy.io.admin_core_service.features.engagement.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAttempt;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAttemptRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementItemRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementSlotRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.List;

/**
 * Pays out the correctness bonuses that were held back from learners whose item hides
 * its result until the reveal.
 *
 * Those learners were awarded completion points only at submit — landing the bonus
 * immediately would have told them they answered correctly, which is the secret the
 * reveal time exists to keep. Once the reveal passes there is nothing left to protect,
 * so the bonus is paid and the attempt's recorded points catch up.
 *
 * <p>Runs every 15 minutes because reveal times are per-slot wall-clock in each
 * institute's own zone. Re-running is free: the ledger's idempotency key makes a
 * second pass a no-op, and the attempt update is idempotent by construction.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementRevealJob {

    /** How far back to look. A slot revealed days ago has long since been settled. */
    private static final int LOOKBACK_DAYS = 3;

    private final EngagementPlanRepository planRepository;
    private final EngagementSlotRepository slotRepository;
    private final EngagementItemRepository itemRepository;
    private final EngagementAttemptRepository attemptRepository;
    private final EngagementScheduleResolver scheduleResolver;
    private final PointsLedgerService pointsLedgerService;
    /** Plans scheduled in days after joining. Optional so hand-built tests need not wire it. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private vacademy.io.admin_core_service.features.engagement.service.EngagementRelativeSchedule relativeSchedule;

    @Scheduled(cron = "0 5/15 * * * ?")
    @SchedulerLock(name = "EngagementRevealTick", lockAtMostFor = "PT14M", lockAtLeastFor = "PT30S")
    public void tick() {
        List<EngagementPlan> plans;
        try {
            plans = planRepository.findAllPublished();
        } catch (Exception e) {
            log.error("[engagement-reveal] could not load published plans — tick aborted", e);
            return;
        }

        for (EngagementPlan plan : plans) {
            try {
                settleForPlan(plan);
            } catch (Exception e) {
                // One bad plan must not stop every other institute's payouts.
                log.error("[engagement-reveal] plan {} failed", plan.getId(), e);
            }
        }
    }

    private void settleForPlan(EngagementPlan plan) {
        if (plan.isRelative()) {
            if (relativeSchedule != null) settleRelativePlan(plan);
            return;
        }
        java.time.ZoneId zone = scheduleResolver.zoneOf(plan);
        LocalDate today = LocalDate.now(zone);

        for (EngagementSlot slot : slotRepository.findActiveByPlan(plan.getId())) {
            // Only a slot with a run revealed inside the look-back window has anything new.
            boolean recentReveal = false;
            for (int back = 0; back <= LOOKBACK_DAYS && !recentReveal; back++) {
                LocalDate runDate = today.minusDays(back);
                recentReveal = scheduleResolver.runsOn(slot, runDate)
                        && scheduleResolver.isRevealed(plan, slot, runDate);
            }
            if (!recentReveal) continue;

            for (EngagementItem item : itemRepository.findActiveBySlot(slot.getId())) {
                if (!Boolean.TRUE.equals(item.getHideResultUntilReveal())) continue;
                int bonus = item.getCorrectPoints() == null ? 0 : item.getCorrectPoints();
                if (bonus <= 0) continue;
                // Each answer against the reveal of the run it was given in. Checking it
                // against every run in the window paid an answer given after its own
                // run's reveal, because it was still "before" the next run's reveal.
                settleItem(plan, item, bonus, attempt -> revealOfRunAnswered(plan, slot, attempt, zone));
            }
        }
    }

    /**
     * Days-after-joining plans: every learner has their own reveal moment, so each
     * correct hidden answer is checked against the reveal of the learner's own run —
     * the one in effect when they answered.
     */
    private void settleRelativePlan(EngagementPlan plan) {
        java.time.ZoneId zone = scheduleResolver.zoneOf(plan);
        java.util.Map<String, LocalDate> dayOnes = relativeSchedule.dayOnesForBatch(plan);
        for (EngagementSlot stored : slotRepository.findActiveByPlan(plan.getId())) {
            for (EngagementItem item : itemRepository.findActiveBySlot(stored.getId())) {
                if (!Boolean.TRUE.equals(item.getHideResultUntilReveal())) continue;
                int bonus = item.getCorrectPoints() == null ? 0 : item.getCorrectPoints();
                if (bonus <= 0) continue;
                settleItem(plan, item, bonus, attempt -> {
                    LocalDate dayOne = dayOnes.get(attempt.getUserId());
                    if (dayOne == null) return null;
                    return revealOfRunAnswered(plan, relativeSchedule.localize(plan, stored, dayOne), attempt, zone);
                });
            }
        }
    }

    /**
     * The reveal instant of the run in effect when the attempt was completed, or null when
     * that run has not revealed yet (or the attempt has no completion time).
     */
    private java.time.Instant revealOfRunAnswered(EngagementPlan plan, EngagementSlot slot,
                                                  EngagementAttempt attempt, java.time.ZoneId zone) {
        if (attempt.getCompletedAt() == null) return null;
        LocalDate answered = attempt.getCompletedAt().toInstant().atZone(zone).toLocalDate();
        LocalDate run = scheduleResolver.mostRecentRunDate(slot, answered);
        if (run == null || !scheduleResolver.isRevealed(plan, slot, run)) return null;
        return java.time.LocalDateTime.of(run, slot.effectiveRevealTime()).atZone(zone).toInstant();
    }

    /** {@code revealAtFor} returns null when this attempt's reveal has not happened yet. */
    private void settleItem(EngagementPlan plan, EngagementItem item, int fullBonus,
                            java.util.function.Function<EngagementAttempt, java.time.Instant> revealAtFor) {
        for (EngagementAttempt attempt : attemptRepository.findByItem(item.getId())) {
            if (!EngagementEnums.AttemptStatus.COMPLETED.name().equals(attempt.getStatus())) continue;
            java.time.Instant revealAt = revealAtFor.apply(attempt);
            if (revealAt == null) continue;
            if (!Boolean.TRUE.equals(attempt.getIsCorrect())) continue;
            // Answered after the reveal: submit already paid completion only, and the
            // answer was public by then. Without this a learner answering in the gap
            // before this job's next tick still collected the bonus.
            if (attempt.getCompletedAt() != null
                    && !attempt.getCompletedAt().toInstant().isBefore(revealAt)) continue;
            // A late (catch-up) answer earns the bonus at the same reduced rate as the
            // completion points it was paid at submit.
            int bonus = Boolean.TRUE.equals(attempt.getIsLate())
                    ? (int) Math.floor(fullBonus * (scheduleResolver.resolveCatchUpPercent(plan, item) / 100.0))
                    : fullBonus;
            if (bonus <= 0) continue;

            boolean awarded = pointsLedgerService.award(
                    attempt.getUserId(),
                    attempt.getInstituteId(),
                    attempt.getPackageSessionId(),
                    PointsSourceType.ENGAGEMENT_ITEM,
                    item.getId(),
                    bonus,
                    "Correct answer — " + item.getTitle(),
                    // Distinct from the submit-time award for the same item, so both
                    // can exist and neither can be paid twice.
                    // Keyed on the version the learner ANSWERED, not the item's current
                    // one: an in-place edit bumps item.version, and keying on that would
                    // pay every correct learner a second time.
                    "ENGAGEMENT_BONUS:" + item.getId() + ":v"
                            + (attempt.getItemVersion() == null ? item.getVersion() : attempt.getItemVersion())
                            + ":" + attempt.getUserId()).isPresent();

            if (awarded) {
                // Keep the attempt's own figure honest for the tracking table.
                attempt.setPointsAwarded(
                        (attempt.getPointsAwarded() == null ? 0 : attempt.getPointsAwarded()) + bonus);
                attempt.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
                attemptRepository.save(attempt);
                log.info("[engagement-reveal] bonus {} paid to {} for item {}",
                        bonus, attempt.getUserId(), item.getId());
            }
        }
    }
}
