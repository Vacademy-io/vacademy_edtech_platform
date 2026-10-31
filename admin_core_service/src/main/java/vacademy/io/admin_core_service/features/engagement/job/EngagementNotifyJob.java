package vacademy.io.admin_core_service.features.engagement.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAttempt;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementNotificationLog;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAttemptRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementItemRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementNotificationLogRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementSlotRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;

/**
 * Sends the "your task is live" push.
 *
 * Runs every 15 minutes rather than at a fixed hour because each plan carries its own
 * timezone and its own notify time — a single daily trigger could only ever be right
 * for one zone. Each tick asks every published plan "did one of your slots reach its
 * notify time in YOUR zone during the last 15 minutes".
 *
 * <p>Two layers stop duplicates, and both are needed: {@code @SchedulerLock} keeps the
 * four production replicas from running the same tick, and the unique index behind
 * {@code engagement_notification_log} keeps a restart or a clock adjustment from
 * replaying a window that already fired. A duplicate 6 AM push to a whole batch is how
 * an app gets muted.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementNotifyJob {

    /** Must match the @Scheduled interval below — it defines the "did it fire" window. */
    private static final int TICK_MINUTES = 15;

    private static final List<String> ACTIVE_STATUSES = List.of("ACTIVE");

    /**
     * Where a tap on the reveal push lands: the learner's answers tab. Paths are relative
     * to the learner app; the client falls back to the same URLs when a push carries none.
     */
    static final String REVEAL_ACTION_URL = "/engagement?tab=answers";

    private final EngagementPlanRepository planRepository;
    private final EngagementSlotRepository slotRepository;
    private final EngagementItemRepository itemRepository;
    private final EngagementAttemptRepository attemptRepository;
    private final EngagementNotificationLogRepository notificationLogRepository;
    private final EngagementScheduleResolver scheduleResolver;
    private final StudentSessionInstituteGroupMappingRepository enrollmentRepository;
    private final NotificationService notificationService;
    /** Plans scheduled in days after joining. Optional so hand-built tests need not wire it. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private vacademy.io.admin_core_service.features.engagement.service.EngagementRelativeSchedule relativeSchedule;

    @Scheduled(cron = "0 0/15 * * * ?")
    @SchedulerLock(name = "EngagementNotifyTick", lockAtMostFor = "PT14M", lockAtLeastFor = "PT30S")
    public void tick() {
        List<EngagementPlan> plans;
        try {
            plans = planRepository.findAllPublished();
        } catch (Exception e) {
            log.error("[engagement-notify] could not load published plans — tick aborted", e);
            return;
        }
        if (plans.isEmpty()) return;

        for (EngagementPlan plan : plans) {
            try {
                notifyForPlan(plan);
                revealForPlan(plan);
            } catch (Exception e) {
                // One bad plan must not stop the rest of the institutes' pushes.
                log.error("[engagement-notify] plan {} failed", plan.getId(), e);
            }
        }
    }

    private void notifyForPlan(EngagementPlan plan) {
        ZonedDateTime now = scheduleResolver.nowIn(plan);
        LocalDate today = now.toLocalDate();
        LocalTime windowEnd = now.toLocalTime();
        LocalTime windowStart = windowEnd.minusMinutes(TICK_MINUTES);

        // A window that wrapped past midnight would need the previous local day too;
        // skip it rather than mis-send. The next tick covers it correctly.
        if (windowStart.isAfter(windowEnd)) return;

        // Days-after-joining slots store virtual dates, so the date-bounded query never
        // returns them: take the plan's slots whose notify time falls in this window and
        // send each to the learners for whom it runs today.
        java.util.Map<String, LocalDate> dayOnes = plan.isRelative() && relativeSchedule != null
                ? relativeSchedule.dayOnesForBatch(plan) : null;
        List<EngagementSlot> slots = plan.isRelative()
                ? slotRepository.findActiveByPlan(plan.getId()).stream()
                    .filter(s -> s.getNotifyTime() != null
                            && !s.getNotifyTime().isBefore(windowStart) && s.getNotifyTime().isBefore(windowEnd))
                    .toList()
                : slotRepository.findDueForNotification(today, windowStart, windowEnd);
        if (slots.isEmpty()) return;
        if (plan.isRelative() && dayOnes == null) return;

        for (EngagementSlot slot : slots) {
            if (!plan.getId().equals(slot.getPlanId())) continue;
            if (!plan.isRelative() && !scheduleResolver.runsOn(slot, today)) continue;
            if (notificationLogRepository.existsBySlotIdAndRunDateAndKind(slot.getId(), today, "NOTIFY")) continue;

            List<EngagementItem> items = itemRepository.findActiveBySlot(slot.getId());
            if (items.isEmpty()) continue;

            List<String> userIds = plan.isRelative()
                    ? learnersOnToday(plan, slot, dayOnes, today)
                    : enrollmentRepository.findDistinctUserIdsByPackageSessionAndStatus(
                            plan.getPackageSessionId(), ACTIVE_STATUSES);
            if (userIds == null || userIds.isEmpty()) continue;

            // Claim the send BEFORE dispatching. If the push then fails, nobody gets a
            // duplicate on the next tick — the opposite order risks sending twice,
            // which is the worse failure for a daily notification.
            if (!claim(slot, plan, today, userIds.size(), "NOTIFY")) continue;

            String title = items.size() == 1
                    ? items.get(0).getTitle()
                    : items.size() + " tasks are live";
            String body = items.size() == 1
                    ? "Your task for today is ready — tap to start."
                    : "Your tasks for today are ready — tap to start.";

            try {
                notificationService.sendPushViaUnified(
                        plan.getInstituteId(), userIds, title, body,
                        Map.of("type", "ENGAGEMENT", "slotId", slot.getId(),
                                "actionUrl", taskActionUrl(slot.getId())));
                log.info("[engagement-notify] slot {} pushed to {} learners", slot.getId(), userIds.size());
            } catch (Exception e) {
                log.error("[engagement-notify] push failed for slot {}", slot.getId(), e);
            }
        }
    }

    /**
     * The reveal push: "the answer is out". Sent only to learners who completed at
     * least one task in the slot — a learner who never opened the question has no
     * answer to come back for, and a push about it would just be noise.
     */
    private void revealForPlan(EngagementPlan plan) {
        ZonedDateTime now = scheduleResolver.nowIn(plan);
        LocalDate today = now.toLocalDate();
        LocalTime windowEnd = now.toLocalTime();
        LocalTime windowStart = windowEnd.minusMinutes(TICK_MINUTES);
        if (windowStart.isAfter(windowEnd)) return;

        java.util.Map<String, LocalDate> dayOnes = plan.isRelative() && relativeSchedule != null
                ? relativeSchedule.dayOnesForBatch(plan) : null;
        if (plan.isRelative() && dayOnes == null) return;
        List<EngagementSlot> due = plan.isRelative()
                ? slotRepository.findActiveByPlan(plan.getId()).stream()
                    .filter(s -> !s.effectiveRevealTime().isBefore(windowStart)
                            && s.effectiveRevealTime().isBefore(windowEnd))
                    .toList()
                : slotRepository.findDueForReveal(today, windowStart, windowEnd);
        for (EngagementSlot slot : due) {
            if (!plan.getId().equals(slot.getPlanId())) continue;
            if (!plan.isRelative() && !scheduleResolver.runsOn(slot, today)) continue;
            java.util.Set<String> onToday = plan.isRelative()
                    ? new java.util.HashSet<>(learnersOnToday(plan, slot, dayOnes, today)) : null;
            if (onToday != null && onToday.isEmpty()) continue;
            if (notificationLogRepository.existsBySlotIdAndRunDateAndKind(slot.getId(), today, "REVEAL")) continue;

            List<EngagementItem> items = itemRepository.findActiveBySlot(slot.getId());
            // Only a graded question has something to reveal.
            boolean hasReveal = items.stream().anyMatch(i ->
                    EngagementEnums.ItemType.QUESTION_OF_DAY.name().equals(i.getItemType()));
            if (!hasReveal) continue;

            java.util.Set<String> recipients = new java.util.HashSet<>();
            for (EngagementItem item : items) {
                for (EngagementAttempt a : attemptRepository.findByItem(item.getId())) {
                    if (!"COMPLETED".equals(a.getStatus())) continue;
                    if (onToday != null && !onToday.contains(a.getUserId())) continue;
                    recipients.add(a.getUserId());
                }
            }
            if (recipients.isEmpty()) continue;
            if (!claim(slot, plan, today, recipients.size(), "REVEAL")) continue;

            String title = items.size() == 1 ? items.get(0).getTitle() : "Today's answers are out";
            try {
                notificationService.sendPushViaUnified(
                        plan.getInstituteId(), new java.util.ArrayList<>(recipients), title,
                        "The answer is revealed — see how you did and where you rank.",
                        Map.of("type", "ENGAGEMENT_REVEAL", "slotId", slot.getId(),
                                "actionUrl", REVEAL_ACTION_URL));
                log.info("[engagement-notify] reveal for slot {} pushed to {} learners", slot.getId(), recipients.size());
            } catch (Exception e) {
                log.error("[engagement-notify] reveal push failed for slot {}", slot.getId(), e);
            }
        }
    }

    /** Learners for whom a days-after-joining slot runs today, on their own days. */
    private List<String> learnersOnToday(EngagementPlan plan, EngagementSlot slot,
                                         java.util.Map<String, LocalDate> dayOnes, LocalDate today) {
        List<String> out = new java.util.ArrayList<>();
        for (java.util.Map.Entry<String, LocalDate> e : dayOnes.entrySet()) {
            EngagementSlot mine = relativeSchedule.localize(plan, slot, e.getValue());
            if (scheduleResolver.runsOn(mine, today)) out.add(e.getKey());
        }
        return out;
    }

    /** Where a tap on the task push lands: the engagement page, opened on that slot. */
    static String taskActionUrl(String slotId) {
        return "/engagement?slot=" + URLEncoder.encode(slotId, StandardCharsets.UTF_8);
    }

    /** Returns false when another replica or an earlier tick already claimed this send. */
    private boolean claim(EngagementSlot slot, EngagementPlan plan, LocalDate runDate, int recipients, String kind) {
        EngagementNotificationLog entry = new EngagementNotificationLog();
        entry.setSlotId(slot.getId());
        entry.setRunDate(runDate);
        entry.setKind(kind);
        entry.setInstituteId(plan.getInstituteId());
        entry.setRecipients(recipients);
        entry.setSentAt(new Timestamp(System.currentTimeMillis()));
        try {
            notificationLogRepository.saveAndFlush(entry);
            return true;
        } catch (DataIntegrityViolationException e) {
            return false;
        }
    }
}
