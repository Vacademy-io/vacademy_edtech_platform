package vacademy.io.admin_core_service.features.live_session.provider.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.service.zoom.ZoomRecordingService;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;

import java.util.Date;
import java.util.List;

/**
 * Hourly fallback that pulls Zoom cloud recordings for ended meetings whose
 * recordings haven't been synced recently. The webhook (recording.completed) is
 * the primary path; this job catches anything the webhook missed (endpoint down,
 * validation lapsed, event dropped).
 *
 * Reuses SessionScheduleRepository.findNeedingRecordingSync, the same query the
 * BBB/Zoho sync uses, scoped to the Zoom provider.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ZoomRecordingSyncProcessor {

    private static final long STALE_MILLIS = 60 * 60 * 1000L; // 1 hour

    private final SessionScheduleRepository scheduleRepository;
    private final ZoomRecordingService zoomRecordingService;

    /** Runs every hour at minute 17 (offset to avoid colliding with other jobs). */
    @SchedulerLock(name = "ZoomRecordingSync", lockAtMostFor = "PT50M", lockAtLeastFor = "PT30S")
    @Scheduled(cron = "${zoom.recording.sync.cron:0 17 * * * ?}")
    public void syncZoomRecordings() {
        Date before = new Date(System.currentTimeMillis() - STALE_MILLIS);
        List<SessionSchedule> due = scheduleRepository.findNeedingRecordingSync(
                "zoom", "ZOOM_MEETING", before);

        if (due.isEmpty()) {
            return;
        }
        log.info("ZoomRecordingSync: {} schedule(s) due", due.size());
        int totalAdded = 0;
        for (SessionSchedule schedule : due) {
            try {
                // true: sweep every past instance — this job exists to catch what the webhook missed,
                // and a day skipped here is unrecoverable once Zoom's ~30-day retention lapses.
                totalAdded += zoomRecordingService.syncFromApi(schedule, true);
            } catch (Exception e) {
                log.error("ZoomRecordingSync: failed for scheduleId={}: {}",
                        schedule.getId(), e.getMessage());
            }
        }
        log.info("ZoomRecordingSync: completed, {} new recording(s) added", totalAdded);
    }
}
