package vacademy.io.admin_core_service.features.live_session.provider.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.service.zoom.ZoomRecordingS3Service;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;

import java.util.List;

/**
 * Near-expiry rescue: mirrors Zoom cloud recordings that are about to be
 * auto-deleted to Vacademy S3, so nothing is lost even if no admin clicked
 * "Sync to S3". Conservative by default (only recordings within
 * {@code zoom.recording.s3.rescue-within-days} of expiry) to avoid eagerly copying
 * recordings nobody watches; flip {@code zoom.recording.s3.rescue.enabled=false} to
 * disable, or widen the window to mirror everything.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ZoomRecordingS3SyncProcessor {

    private final SessionScheduleRepository scheduleRepository;
    private final ZoomRecordingS3Service zoomRecordingS3Service;

    @Value("${zoom.recording.s3.rescue.enabled:true}")
    private boolean enabled;

    @Value("${zoom.recording.s3.rescue-within-days:5}")
    private int rescueWithinDays;

    /** Runs every 6 hours (offset to minute :37). */
    @SchedulerLock(name = "ZoomRecordingS3Rescue", lockAtMostFor = "PT5H", lockAtLeastFor = "PT1M")
    @Scheduled(cron = "${zoom.recording.s3.rescue.cron:0 37 */6 * * ?}")
    public void rescueExpiringRecordings() {
        if (!enabled) {
            return;
        }
        List<SessionSchedule> candidates =
                scheduleRepository.findZoomSchedulesWithCloudRecordings("zoom", "ZOOM_MEETING");
        if (candidates.isEmpty()) {
            return;
        }
        int mirrored = 0;
        for (SessionSchedule schedule : candidates) {
            try {
                mirrored += zoomRecordingS3Service.mirrorToS3(schedule, true, rescueWithinDays);
            } catch (Exception e) {
                log.error("ZoomRecordingS3Rescue: failed for scheduleId={}: {}",
                        schedule.getId(), e.getMessage());
            }
        }
        if (mirrored > 0) {
            log.info("ZoomRecordingS3Rescue: mirrored {} near-expiry recording(s) to S3", mirrored);
        }
    }
}
