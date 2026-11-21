package vacademy.io.admin_core_service.features.engagement.planning;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.service.EngagementSettingsService;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

import java.time.ZonedDateTime;
import java.util.List;

/**
 * The weekly planning email's two ticks.
 *
 * <p>Hourly: every institute with the email on is asked "is it your send day, at or after
 * your send hour, in your timezone?". Sending is idempotent per (batch, teacher, week), so
 * a tick that comes late, or twice, emails nobody twice. Reminders go out on the same tick.
 *
 * <p>Every minute: submitted topics are drafted and the drafts saved as plans.
 *
 * <p>Both are ShedLocked: admin_core runs several replicas.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementPlanningJob {

    private static final String ENABLED_SQL =
            "SELECT id FROM institutes WHERE setting_json LIKE '%\"planningNudge\"%'";

    private final EngagementPlanningService planningService;
    private final EngagementSettingsService settingsService;
    private final InstituteTimezoneService timezoneService;
    private final JdbcTemplate jdbcTemplate;

    @Scheduled(cron = "0 5 * * * ?")
    @SchedulerLock(name = "EngagementPlanningSendTick", lockAtMostFor = "PT50M", lockAtLeastFor = "PT30S")
    public void sendTick() {
        List<String> ids;
        try {
            ids = jdbcTemplate.queryForList(ENABLED_SQL, String.class);
        } catch (Exception e) {
            log.error("[engagement-planning] could not list institutes", e);
            return;
        }
        for (String instituteId : ids) {
            try {
                PlanningNudgeSettings s = settingsService.planningNudge(instituteId);
                if (!s.enabled()) continue;
                ZonedDateTime now = ZonedDateTime.now(timezoneService.getZone(instituteId));
                if (now.getDayOfWeek().getValue() != s.sendDay() || now.getHour() < s.sendHour()) continue;
                planningService.sendWeek(instituteId,
                        PlanningNudgeSettings.weekToPlan(now.toLocalDate()), s.packageSessionIds());
            } catch (Exception e) {
                log.error("[engagement-planning] send failed for institute {}", instituteId, e);
            }
        }
        try {
            int reminded = planningService.sendReminders();
            if (reminded > 0) log.info("[engagement-planning] sent {} reminder(s)", reminded);
        } catch (Exception e) {
            log.error("[engagement-planning] reminders failed", e);
        }
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 90_000)
    @SchedulerLock(name = "EngagementPlanningDraftTick", lockAtMostFor = "PT10M", lockAtLeastFor = "PT20S")
    public void draftTick() {
        try {
            planningService.advanceDrafts();
        } catch (Exception e) {
            log.error("[engagement-planning] draft tick failed", e);
        }
    }
}
