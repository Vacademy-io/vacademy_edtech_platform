package vacademy.io.admin_core_service.features.reporting.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.reporting.dto.ReportScheduleConfig;
import vacademy.io.admin_core_service.features.reporting.dto.ReportSettingConfig;
import vacademy.io.admin_core_service.features.reporting.service.ReportRunService;
import vacademy.io.admin_core_service.features.reporting.service.ReportSettingService;
import vacademy.io.admin_core_service.features.reporting.service.ReportWindowResolver;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

/**
 * The reporting tick.
 *
 * Runs hourly rather than at a fixed time because schedules carry their own local
 * hour and institutes carry their own timezone — a single daily trigger could only
 * ever be correct for one zone. Each tick asks every enabled schedule "are you due
 * in YOUR zone right now"; the idempotency row makes asking often free.
 *
 * <p>{@code @SchedulerLock} is not optional here. admin_core runs 4 replicas in
 * production, and without the lock every institute would receive four copies of
 * every report. Unlike the engagement sweep — where a per-row lease is the real
 * protection and the lock only reduces waste — the correctness guarantee for this
 * job is split between this lock and the unique index on report_run. Removing
 * either one produces duplicate emails.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class ReportSchedulerJob {

    private final ReportSettingService settingService;
    private final ReportWindowResolver windowResolver;
    private final ReportRunService runService;
    private final InstituteRepository instituteRepository;

    /** Hourly, on the hour. Cheap when nothing is due: one indexed scan and a parse. */
    @Scheduled(cron = "0 0 * * * ?")
    @SchedulerLock(name = "ScheduledReportTick", lockAtMostFor = "PT50M", lockAtLeastFor = "PT30S")
    public void tick() {
        Map<String, ReportSettingConfig> configs;
        try {
            configs = settingService.loadEnabledConfigs();
        } catch (Exception e) {
            log.error("[reporting] could not load report settings — tick aborted", e);
            return;
        }

        if (configs.isEmpty()) {
            log.debug("[reporting] no institute has scheduled reports enabled");
            return;
        }

        Instant now = Instant.now();
        int due = 0;

        for (Map.Entry<String, ReportSettingConfig> entry : configs.entrySet()) {
            String instituteId = entry.getKey();
            ReportSettingConfig cfg = entry.getValue();

            String instituteName = resolveName(instituteId);

            for (ReportScheduleConfig schedule : cfg.getSchedules()) {
                try {
                    Optional<ReportWindowResolver.Window> window =
                            windowResolver.resolveIfDue(schedule, cfg.getTimezone(), now);
                    if (window.isEmpty()) continue;

                    due++;
                    runService.execute(instituteId, instituteName, schedule, window.get());

                } catch (Exception e) {
                    // One institute's bad schedule must never stop the others.
                    log.error("[reporting] schedule {} for institute {} threw during tick",
                            schedule.getId(), instituteId, e);
                }
            }
        }

        if (due > 0) {
            log.info("[reporting] tick processed {} due schedule(s) across {} institute(s)", due, configs.size());
        }
    }

    private String resolveName(String instituteId) {
        try {
            return instituteRepository.findById(instituteId)
                    .map(i -> i.getInstituteName() == null ? "" : i.getInstituteName())
                    .orElse("");
        } catch (Exception e) {
            return "";
        }
    }
}
