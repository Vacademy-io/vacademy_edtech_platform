package vacademy.io.admin_core_service.features.live_session.provider.controller.google;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleRecordingS3Service;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleRecordingService;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * On-demand Google Meet recording sync — live-fetches {@code conferenceRecords.recordings} for a
 * schedule's space and persists them, bypassing the hourly poll (and its meeting-ended timing gate).
 * Lets an admin pull a recording into Vacademy the moment Google finishes processing it, rather than
 * waiting for the next scheduled sync.
 */
@RestController
@RequestMapping("/admin-core-service/live-sessions/provider/meeting")
@RequiredArgsConstructor
@Slf4j
public class GoogleRecordingController {

    private final SessionScheduleRepository scheduleRepository;
    private final GoogleRecordingService googleRecordingService;
    private final GoogleRecordingS3Service googleRecordingS3Service;
    private final InstituteAccessValidator instituteAccessValidator;

    @PostMapping("/google-recordings/sync")
    public ResponseEntity<Map<String, Object>> syncNow(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String scheduleId,
            @RequestParam(required = false) String instituteId) {

        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Schedule not found: " + scheduleId));

        String inst = instituteId != null ? instituteId
                : scheduleRepository.findInstituteIdByScheduleId(scheduleId).orElse(null);
        if (inst != null) {
            instituteAccessValidator.validateUserAccess(user, inst);
        }

        int synced = googleRecordingService.syncFromApi(schedule);
        List<MeetingRecordingDTO> recordings = googleRecordingService.getStored(schedule);

        log.info("google.recordings.sync-now scheduleId={} synced={} total={}",
                scheduleId, synced, recordings.size());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("synced", synced);
        body.put("recordings", recordings);
        return ResponseEntity.ok(body);
    }

    /**
     * Admin "Save to library" for a Meet recording: the server downloads the MP4 from the
     * organizer's Drive and stores it on S3. Synchronous like Zoom's sync-to-s3 (ingress allows
     * 30 min). 412 when the connected account hasn't granted Drive access — the UI then offers
     * "Allow Drive access" or the manual upload below.
     */
    @PostMapping("/google-recordings/save-to-library")
    public ResponseEntity<Map<String, Object>> saveToLibrary(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String scheduleId) {

        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Schedule not found: " + scheduleId));
        String inst = scheduleRepository.findInstituteIdByScheduleId(scheduleId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Institute not found for schedule: " + scheduleId));
        instituteAccessValidator.validateUserAccess(user, inst);

        int mirrored = googleRecordingS3Service.mirrorToS3(schedule);
        SessionSchedule fresh = scheduleRepository.findById(scheduleId).orElse(schedule);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("mirrored", mirrored);
        body.put("recordings", googleRecordingService.getStored(fresh));
        return ResponseEntity.ok(body);
    }

    /**
     * Admin "Upload to library" for a Meet recording: the admin downloaded the MP4 from Drive and
     * uploaded it via media-service; this attaches that fileId to the recording so it can be added
     * to a course / YouTube like any library recording. Returns the updated recording list.
     */
    @PostMapping("/google-recordings/attach-file")
    public ResponseEntity<Map<String, Object>> attachFile(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String scheduleId,
            @RequestParam String recordingId,
            @RequestParam String fileId) {

        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Schedule not found: " + scheduleId));
        String inst = scheduleRepository.findInstituteIdByScheduleId(scheduleId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Institute not found for schedule: " + scheduleId));
        instituteAccessValidator.validateUserAccess(user, inst);

        List<MeetingRecordingDTO> recordings =
                googleRecordingService.attachUploadedFile(schedule, recordingId, fileId);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("recordings", recordings);
        return ResponseEntity.ok(body);
    }
}
