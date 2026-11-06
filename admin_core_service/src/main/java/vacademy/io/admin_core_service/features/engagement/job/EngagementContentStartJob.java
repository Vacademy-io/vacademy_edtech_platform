package vacademy.io.admin_core_service.features.engagement.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementRelativeSchedule;

import java.util.List;

/**
 * Freezes when learners complete the start content of "days after completing" plans.
 *
 * Reads (feed, tracking, pushes) already treat a learner whose completion row crossed the
 * threshold as started today. Progress rows keep no completion time (updated_at stays at
 * the first touch of the content), so this tick stamps the current time once into
 * engagement_plan_learner_start; from then on the frozen moment wins and Day 1 cannot
 * drift. Writes happen only here, never inside a read request (admin-core routes
 * read-only transactions to the replica).
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementContentStartJob {

    private final EngagementPlanRepository planRepository;
    private final EngagementRelativeSchedule relativeSchedule;

    @Scheduled(cron = "0 0/10 * * * ?")
    @SchedulerLock(name = "EngagementContentStartTick", lockAtMostFor = "PT9M", lockAtLeastFor = "PT30S")
    public void tick() {
        List<EngagementPlan> plans;
        try {
            plans = planRepository.findAllPublishedRelative();
        } catch (Exception e) {
            log.error("[engagement-content-start] could not load plans — tick aborted", e);
            return;
        }
        for (EngagementPlan plan : plans) {
            if (!plan.isContentStart()) continue;
            try {
                int frozen = relativeSchedule.freezeContentStarts(plan);
                if (frozen > 0) log.info("[engagement-content-start] plan {}: {} learner(s) started", plan.getId(), frozen);
            } catch (Exception e) {
                // One bad plan must not stop the others.
                log.error("[engagement-content-start] plan {} failed", plan.getId(), e);
            }
        }
    }
}
