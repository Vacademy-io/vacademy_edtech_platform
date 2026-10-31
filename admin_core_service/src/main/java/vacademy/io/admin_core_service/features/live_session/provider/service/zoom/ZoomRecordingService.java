package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccount;
import vacademy.io.admin_core_service.features.live_session.provider.manager.ZoomMeetingManager;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.service.RecordingAutoLinkService;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.time.Instant;
import java.time.ZoneId;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Fetches Zoom cloud recordings for a schedule and persists them onto
 * session_schedules.provider_recordings_json. Single source of truth shared by the
 * webhook (recording.completed) and the hourly polling fallback.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZoomRecordingService {

    /** Zoom's default cloud-recording retention before auto-deletion. */
    private static final int DEFAULT_RETENTION_DAYS = 30;

    private final ZoomMeetingManager zoomMeetingManager;
    private final ZoomAccountStore zoomAccountStore;
    private final SessionScheduleRepository scheduleRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final ObjectMapper objectMapper;
    private final RecordingAutoLinkService recordingAutoLinkService;

    /**
     * Pulls recordings from the Zoom API for a schedule and merges them into the
     * stored list. Idempotent — re-running won't duplicate recordings. Returns the
     * number of newly added recordings.
     */
    @Transactional
    public int syncFromApi(SessionSchedule schedule) {
        return syncFromApi(schedule, false);
    }

    /**
     * @param allInstances true to sweep EVERY past instance of a recurring meeting (the hourly
     *        job, which is catching up on anything missed), false for just the latest (the
     *        recording.completed webhook, which already knows which meeting finished and must
     *        answer Zoom promptly).
     */
    public int syncFromApi(SessionSchedule schedule, boolean allInstances) {
        if (schedule.getProviderAccountId() == null || schedule.getProviderMeetingId() == null) {
            return 0;
        }
        ZoomAccount account = zoomAccountStore.findById(schedule.getProviderAccountId())
                .orElse(null);
        if (account == null) {
            log.warn("zoom.recording.sync skipped — account {} missing for schedule {}",
                    schedule.getProviderAccountId(), schedule.getId());
            return 0;
        }

        List<MeetingRecordingDTO> fetched;
        if (allInstances) {
            List<MeetingRecordingDTO> everyInstance =
                    zoomMeetingManager.fetchAllInstanceRecordings(account, schedule.getProviderMeetingId());
            fetched = onlyThisOccurrence(everyInstance, schedule);
            if (fetched.isEmpty() && !everyInstance.isEmpty()) {
                // The meeting ran, but not on this row's date — another occurrence owns those
                // files. Take nothing rather than guess, so a row cannot inherit a sibling's class.
                log.debug("zoom.recording.sync scheduleId={} date={} — {} instance recording(s) all "
                        + "belong to other dates, skipping", schedule.getId(), schedule.getMeetingDate(),
                        everyInstance.size());
                fetched = List.of();
            }
        } else {
            fetched = zoomMeetingManager.fetchRecordings(account, schedule.getProviderMeetingId());
        }

        int added = persist(schedule, fetched);
        schedule.setLastRecordingSyncAt(new Date());
        scheduleRepository.save(schedule);
        recordingAutoLinkService.processSchedule(schedule);
        return added;
    }

    /**
     * Merges new recordings into the schedule's stored JSON (dedupe by recordingId),
     * keeps recordingStorage = ZOOM if unset, and sets an approximate expiry so the
     * admin UI can warn before Zoom auto-deletes.
     */
    private int persist(SessionSchedule schedule, List<MeetingRecordingDTO> fetched) {
        if (fetched == null || fetched.isEmpty()) {
            return 0;
        }
        Map<String, MeetingRecordingDTO> byId = new LinkedHashMap<>();
        for (MeetingRecordingDTO existing : parseExisting(schedule)) {
            if (existing.getRecordingId() != null) {
                byId.put(existing.getRecordingId(), existing);
            }
        }
        int added = 0;
        for (MeetingRecordingDTO rec : fetched) {
            if (rec.getRecordingId() == null) continue;
            if (!byId.containsKey(rec.getRecordingId())) {
                added++;
            }
            // Per-recording expiry — Zoom auto-deletes cloud recordings after
            // ~30 days. Only set when the recording hasn't been mirrored to S3
            // (fileId present → recording lives on S3 now, no provider expiry).
            if (rec.getFileId() == null && rec.getExpiresAt() == null) {
                rec.setExpiresAt(expiryFor(rec));
            }
            // Tag storage so the admin UI can show a "Zoom Cloud (expires in N days)"
            // vs "Library/S3" badge. The S3 mirror flips this to "S3" once uploaded.
            if (rec.getRecordingStorage() == null) {
                rec.setRecordingStorage(rec.getFileId() != null ? "S3" : "ZOOM_CLOUD");
            }
            // Always upsert latest URLs/metadata (download tokens rotate).
            byId.put(rec.getRecordingId(), rec);
        }

        try {
            schedule.setProviderRecordingsJson(objectMapper.writeValueAsString(new ArrayList<>(byId.values())));
        } catch (Exception e) {
            log.error("zoom.recording.persist serialize failed for schedule {}: {}",
                    schedule.getId(), e.getMessage());
            return 0;
        }

        log.info("zoom.recording.persist scheduleId={} added={} total={}",
                schedule.getId(), added, byId.size());
        return added;
    }


    /**
     * Keeps only the recordings that belong to THIS occurrence's date.
     *
     * <p>One Zoom meeting is routinely reused for every session in a recurring series, so asking
     * for all of its instances returns several days at once. A schedule row is a single
     * occurrence: merging the whole history into it would stack other days' classes onto one
     * date and duplicate files already held correctly by their own rows. Dates are compared in
     * the session's own timezone — {@code meeting_date} is local while a recording's
     * {@code startTime} is UTC, so a 9:30 IST class carries a 04:00Z stamp.
     */
    private List<MeetingRecordingDTO> onlyThisOccurrence(
            List<MeetingRecordingDTO> recordings, SessionSchedule schedule) {
        LocalDate occurrence = toLocalDate(schedule.getMeetingDate());
        if (occurrence == null) {
            return recordings;
        }
        ZoneId zone = sessionZone(schedule.getSessionId());
        List<MeetingRecordingDTO> kept = new ArrayList<>();
        for (MeetingRecordingDTO rec : recordings) {
            if (rec.getStartTime() == null || rec.getStartTime().isBlank()) {
                continue;
            }
            try {
                if (Instant.parse(rec.getStartTime()).atZone(zone).toLocalDate().equals(occurrence)) {
                    kept.add(rec);
                }
            } catch (Exception e) {
                log.debug("zoom.recording.sync unparseable startTime={} — dropped", rec.getStartTime());
            }
        }
        return kept;
    }

    private ZoneId sessionZone(String sessionId) {
        try {
            String tz = sessionId == null ? null : liveSessionRepository.findById(sessionId)
                    .map(ls -> ls.getTimezone()).orElse(null);
            if (tz != null && !tz.isBlank()) {
                return ZoneId.of(tz);
            }
        } catch (Exception e) {
            log.debug("zoom.recording.sync unusable session timezone for {} — defaulting", sessionId);
        }
        return ZoneId.of("Asia/Kolkata");
    }

    private static LocalDate toLocalDate(java.util.Date d) {
        if (d == null) return null;
        return (d instanceof java.sql.Date sql) ? sql.toLocalDate()
                : d.toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
    }

    /** Public read of the stored recordings (used by the S3 mirror service). */
    public List<MeetingRecordingDTO> getStoredRecordings(SessionSchedule schedule) {
        return parseExisting(schedule);
    }

    /** Serializes and saves the recordings list back onto the schedule. */
    @Transactional
    public void replaceRecordings(SessionSchedule schedule, List<MeetingRecordingDTO> recordings) {
        try {
            schedule.setProviderRecordingsJson(objectMapper.writeValueAsString(recordings));
            scheduleRepository.save(schedule);
            recordingAutoLinkService.processSchedule(schedule);
        } catch (Exception e) {
            log.error("zoom.recording.replace serialize failed for schedule {}: {}",
                    schedule.getId(), e.getMessage());
        }
    }

    private List<MeetingRecordingDTO> parseExisting(SessionSchedule schedule) {
        if (schedule.getProviderRecordingsJson() == null
                || schedule.getProviderRecordingsJson().isBlank()) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(schedule.getProviderRecordingsJson(),
                    new TypeReference<List<MeetingRecordingDTO>>() {});
        } catch (Exception e) {
            log.warn("zoom.recording.persist could not parse existing JSON for schedule {}",
                    schedule.getId());
            return new ArrayList<>();
        }
    }

    /** Approximate ISO-8601 expiry — Zoom's default cloud retention is 30 days. */
    private static String defaultExpiryIso() {
        return Instant.now().plus(DEFAULT_RETENTION_DAYS, ChronoUnit.DAYS).toString();
    }

    /**
     * Expiry counted from when the recording was MADE, not from when we noticed it.
     *
     * <p>Zoom deletes a cloud recording ~30 days after it was created. Stamping
     * {@code now + 30d} was close enough while the sync only ever saw the meeting's latest
     * instance, but the sweep surfaces instances up to 30 days old — for those, now-based
     * expiry overstates the deadline by weeks. The near-expiry S3 rescue only mirrors
     * recordings due within a few days, so an overstated date means it never fires and Zoom
     * deletes the file before it is ever copied to our storage. Falls back to the
     * conservative now-based value when the recording carries no usable start time.
     */
    private static String expiryFor(MeetingRecordingDTO rec) {
        String start = rec.getStartTime();
        if (start != null && !start.isBlank()) {
            try {
                return Instant.parse(start).plus(DEFAULT_RETENTION_DAYS, ChronoUnit.DAYS).toString();
            } catch (Exception e) {
                log.debug("zoom.recording.expiry unparseable startTime={} — using now+{}d",
                        start, DEFAULT_RETENTION_DAYS);
            }
        }
        return defaultExpiryIso();
    }
}
