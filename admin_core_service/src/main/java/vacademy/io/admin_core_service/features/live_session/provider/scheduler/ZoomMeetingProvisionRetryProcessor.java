package vacademy.io.admin_core_service.features.live_session.provider.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.provider.service.ProviderMeetingBatchService;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;

import java.time.LocalDate;
import java.util.Date;
import java.util.List;

/**
 * Safety net for Zoom / Google Meet meeting provisioning (the provider is read from the
 * session's stored account, despite the class name). Up-front provisioning runs in a
 * fire-and-forget @Async loop ({@code ProviderMeetingBatchService}); if that loop
 * is interrupted (process restart, partial failure) some occurrences are left with
 * no provider meeting and would otherwise stay un-joinable forever (HTTP 400 on
 * join). This job re-runs the idempotent batch from the session's stored config
 * for any such session.
 *
 * Bounded to schedules created more than {@code STALE_MINUTES} ago (so it never
 * races the in-flight async run) and within {@code LOOKBACK_DAYS} (so it doesn't
 * scan ancient sessions).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ZoomMeetingProvisionRetryProcessor {

    private static final long STALE_MILLIS = 10 * 60 * 1000L; // 10 minutes
    private static final int LOOKBACK_DAYS = 7;

    private final LiveSessionRepository liveSessionRepository;
    private final ProviderMeetingBatchService providerMeetingBatchService;

    /** Runs every 5 minutes (offset to minute :02). */
    @SchedulerLock(name = "ZoomProvisionRetry", lockAtMostFor = "PT4M", lockAtLeastFor = "PT20S")
    @Scheduled(cron = "${zoom.provision.retry.cron:0 2/5 * * * ?}")
    public void retryStuckProvisioning() {
        Date staleBefore = new Date(System.currentTimeMillis() - STALE_MILLIS);
        java.sql.Date earliestDate = java.sql.Date.valueOf(LocalDate.now().minusDays(LOOKBACK_DAYS));
        List<LiveSession> sessions =
                liveSessionRepository.findZoomSessionsNeedingProvisionRetry(staleBefore, earliestDate);
        if (sessions.isEmpty()) {
            return;
        }
        log.info("ZoomProvisionRetry: {} session(s) with un-provisioned occurrences", sessions.size());
        int totalCreated = 0;
        for (LiveSession session : sessions) {
            try {
                totalCreated += providerMeetingBatchService.reprovisionFromStoredConfig(session);
            } catch (Exception e) {
                log.error("ZoomProvisionRetry: failed for sessionId={}: {}", session.getId(), e.getMessage());
            }
        }
        if (totalCreated > 0) {
            log.info("ZoomProvisionRetry: provisioned {} previously-stuck occurrence(s)", totalCreated);
        }
    }
}
