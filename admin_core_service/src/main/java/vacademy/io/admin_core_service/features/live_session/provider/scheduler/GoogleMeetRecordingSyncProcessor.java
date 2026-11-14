package vacademy.io.admin_core_service.features.live_session.provider.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleRecordingService;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;

import java.util.Date;
import java.util.List;

/**
 * Hourly fallback that pulls Google Meet recordings (conferenceRecords) for ended meetings whose
 * recordings haven't synced recently. When the Events API + Pub/Sub is configured this is a
 * latency optimization over the webhook; when it isn't (the default / local dev) this polling job
 * is the SOURCE OF TRUTH for recordings. Mirrors {@code ZoomRecordingSyncProcessor}.
 *
 * Matches by {@code live_session.link_type} — the wizard persists {@code "google meet"} (with a
 * space); {@code "GOOGLE_MEET"} is accepted as the alternate spelling.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class GoogleMeetRecordingSyncProcessor {

    private static final long STALE_MILLIS = 60 * 60 * 1000L; // 1 hour

    private final SessionScheduleRepository scheduleRepository;
    private final GoogleRecordingService googleRecordingService;

    /** Runs every hour at minute 27 (offset to avoid colliding with the Zoom/BBB jobs). */
    @SchedulerLock(name = "GoogleMeetRecordingSync", lockAtMostFor = "PT50M", lockAtLeastFor = "PT30S")
    @Scheduled(cron = "${google.recording.sync.cron:0 27 * * * ?}")
    public void syncGoogleRecordings() {
        Date before = new Date(System.currentTimeMillis() - STALE_MILLIS);
        List<SessionSchedule> due = scheduleRepository.findNeedingRecordingSync(
                "google meet", "GOOGLE_MEET", before);

        if (due.isEmpty()) {
            return;
        }
        log.info("GoogleRecordingSync: {} schedule(s) due", due.size());
        int totalAdded = 0;
        for (SessionSchedule schedule : due) {
            try {
                totalAdded += googleRecordingService.syncFromApi(schedule);
            } catch (Exception e) {
                log.error("GoogleRecordingSync: failed for scheduleId={}: {}",
                        schedule.getId(), e.getMessage());
            }
        }
        log.info("GoogleRecordingSync: completed, {} new recording(s) added", totalAdded);
    }
}
