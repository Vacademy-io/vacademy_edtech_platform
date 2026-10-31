package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.service.RecordingAutoLinkService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Fetches Google Meet recordings (via {@link GoogleConferenceService}) for a schedule and
 * persists them onto {@code session_schedules.provider_recordings_json}. Source of truth for the
 * recording polling job and (later) the Events-API webhook. Mirrors {@code ZoomRecordingService}.
 *
 * Unlike Zoom, Meet recordings live in the organizer's Drive and do NOT auto-delete, so no
 * {@code expiresAt} is set; storage is tagged {@code GOOGLE_DRIVE}. The MP4 itself is fetched
 * via {@code driveDestination.exportUri} (admin-facing in v1 — no S3 mirror, which would need the
 * restricted Drive scope + CASA). To get a recording into the library the admin downloads it from
 * Drive and uploads it back; {@link #attachUploadedFile} records that copy.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleRecordingService {

    private final GoogleConferenceService conferenceService;
    private final GoogleAccountStore googleAccountStore;
    private final SessionScheduleRepository scheduleRepository;
    private final ObjectMapper objectMapper;
    private final RecordingAutoLinkService recordingAutoLinkService;

    /**
     * Pulls recordings from the Meet REST API for a schedule and merges them into the stored list.
     * Idempotent (dedupe by recordingId). Returns the number of newly added recordings.
     */
    @Transactional
    public int syncFromApi(SessionSchedule schedule) {
        if (schedule.getProviderAccountId() == null || schedule.getProviderMeetingId() == null) {
            return 0;
        }
        GoogleAccount account = googleAccountStore.findById(schedule.getProviderAccountId()).orElse(null);
        if (account == null) {
            log.warn("google.recording.sync skipped — account {} missing for schedule {}",
                    schedule.getProviderAccountId(), schedule.getId());
            return 0;
        }

        List<MeetingRecordingDTO> fetched =
                conferenceService.fetchRecordings(account, schedule.getProviderMeetingId());

        int added = persist(schedule, fetched);
        schedule.setLastRecordingSyncAt(new Date());
        scheduleRepository.save(schedule);
        recordingAutoLinkService.processSchedule(schedule);
        return added;
    }

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
            MeetingRecordingDTO previous = byId.get(rec.getRecordingId());
            if (previous == null) {
                added++;
            } else {
                keepVacademyCopies(previous, rec);
            }
            if (rec.getRecordingStorage() == null) {
                rec.setRecordingStorage("GOOGLE_DRIVE");
            }
            byId.put(rec.getRecordingId(), rec); // upsert latest URLs/metadata
        }

        try {
            schedule.setProviderRecordingsJson(objectMapper.writeValueAsString(new ArrayList<>(byId.values())));
        } catch (Exception e) {
            log.error("google.recording.persist serialize failed for schedule {}: {}",
                    schedule.getId(), e.getMessage());
            return 0;
        }
        log.info("google.recording.persist scheduleId={} added={} total={}",
                schedule.getId(), added, byId.size());
        return added;
    }

    /**
     * The Meet API only ever returns the bare Drive recording. Carry over what Vacademy added on
     * top of it — the admin-uploaded library copy and the YouTube upload — or the next poll or
     * webhook would wipe them.
     */
    private static void keepVacademyCopies(MeetingRecordingDTO previous, MeetingRecordingDTO fetched) {
        if (StringUtils.hasText(previous.getFileId())) {
            fetched.setFileId(previous.getFileId());
            fetched.setRecordingStorage(previous.getRecordingStorage());
            fetched.setDownloadUrl(previous.getDownloadUrl());
            fetched.setPlaybackUrl(previous.getPlaybackUrl());
        }
        if (StringUtils.hasText(previous.getYoutubeVideoId())) {
            fetched.setYoutubeVideoId(previous.getYoutubeVideoId());
            fetched.setYoutubeVideoUrl(previous.getYoutubeVideoUrl());
        }
    }

    /**
     * Attaches an admin-uploaded copy of a Drive recording to the schedule. Meet recordings can't
     * be mirrored server-side (no Drive scope), so the admin downloads the MP4 from Drive and
     * uploads it through media-service; this stores that fileId exactly like the Zoom S3 mirror
     * does — {@code recordingStorage=S3}, Drive URLs cleared so playback resolves from the fileId.
     * Re-runs the auto-link hook, since the recording has only now become linkable.
     *
     * Deliberately not {@code @Transactional}: the save commits on its own first, so a failing
     * auto-link (its {@code linkContent} is transactional) can't mark this write rollback-only.
     */
    public List<MeetingRecordingDTO> attachUploadedFile(SessionSchedule schedule, String recordingId, String fileId) {
        if (!StringUtils.hasText(fileId) || fileId.startsWith("http")) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "A media file id is required");
        }
        List<MeetingRecordingDTO> recordings = parseExisting(schedule);
        MeetingRecordingDTO recording = recordings.stream()
                .filter(r -> recordingId.equals(r.getRecordingId()))
                .findFirst()
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Recording not found on this schedule"));

        recording.setFileId(fileId);
        recording.setRecordingStorage("S3");
        recording.setDownloadUrl(null);
        recording.setPlaybackUrl(null);
        try {
            schedule.setProviderRecordingsJson(objectMapper.writeValueAsString(recordings));
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not save the recording");
        }
        scheduleRepository.save(schedule);
        log.info("google.recording.attach-file scheduleId={} recordingId={} fileId={}",
                schedule.getId(), recordingId, fileId);
        recordingAutoLinkService.processSchedule(schedule);
        return recordings;
    }

    /** Recordings currently stored on the schedule (no API call). */
    public List<MeetingRecordingDTO> getStored(SessionSchedule schedule) {
        return parseExisting(schedule);
    }

    private List<MeetingRecordingDTO> parseExisting(SessionSchedule schedule) {
        if (schedule.getProviderRecordingsJson() == null || schedule.getProviderRecordingsJson().isBlank()) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(schedule.getProviderRecordingsJson(),
                    new TypeReference<List<MeetingRecordingDTO>>() {});
        } catch (Exception e) {
            log.warn("google.recording.persist could not parse existing JSON for schedule {}",
                    schedule.getId());
            return new ArrayList<>();
        }
    }
}
