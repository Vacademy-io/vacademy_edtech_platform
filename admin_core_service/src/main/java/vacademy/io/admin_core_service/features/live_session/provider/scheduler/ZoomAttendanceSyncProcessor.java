package vacademy.io.admin_core_service.features.live_session.provider.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.service.zoom.ZoomAttendanceService;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;

import java.time.LocalDate;
import java.util.Date;
import java.util.List;

/**
 * Polling fallback that pulls Zoom's post-meeting participant report for
 * recently-ended meetings whose attendance hasn't synced recently. Complements the
 * join-time {@code markPresent} (which misses raw-URL/guest joins and has no
 * duration) and the no-op participant webhooks. Mirrors
 * {@link ZoomRecordingSyncProcessor}; runs more frequently (15 min) since
 * attendance is more time-sensitive than recordings.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ZoomAttendanceSyncProcessor {

    private static final long STALE_MILLIS = 15 * 60 * 1000L; // 15 minutes
    private static final int LOOKBACK_DAYS = 2; // only poll meetings ended in the last ~48h

    private final SessionScheduleRepository scheduleRepository;
    private final ZoomAttendanceService zoomAttendanceService;

    /** Runs every 15 minutes (offset to minute :07 to avoid colliding with other jobs). */
    @SchedulerLock(name = "ZoomAttendanceSync", lockAtMostFor = "PT14M", lockAtLeastFor = "PT30S")
    @Scheduled(cron = "${zoom.attendance.sync.cron:0 7/15 * * * ?}")
    public void syncZoomAttendance() {
        Date before = new Date(System.currentTimeMillis() - STALE_MILLIS);
        java.sql.Date earliestDate = java.sql.Date.valueOf(LocalDate.now().minusDays(LOOKBACK_DAYS));
        List<SessionSchedule> due = scheduleRepository.findEndedSchedulesNeedingAttendanceSync(
                "zoom", "ZOOM_MEETING", before, earliestDate);

        if (due.isEmpty()) {
            return;
        }
        log.info("ZoomAttendanceSync: {} schedule(s) due", due.size());
        int totalUpserts = 0;
        for (SessionSchedule schedule : due) {
            try {
                totalUpserts += zoomAttendanceService.syncAttendance(schedule);
            } catch (Exception e) {
                log.error("ZoomAttendanceSync: failed for scheduleId={}: {}",
                        schedule.getId(), e.getMessage());
            }
        }
        log.info("ZoomAttendanceSync: completed, {} attendee record(s) upserted", totalUpserts);
    }
}
