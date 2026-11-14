package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerDisplaySettingsFlags;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerPastSessionDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerPastSessionsResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerRecordingDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionInstructorDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionContentLink;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionLogs;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionContentLinkRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.slide.entity.DocumentSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.entity.VideoSlide;
import vacademy.io.admin_core_service.features.slide.repository.DocumentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.VideoSlideRepository;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Orchestrates the learner "Past Sessions" endpoint:
 * resolve institute -> read learnerDisplay flags -> (gate) -> paged past-session
 * query -> batched attendance/engagement enrichment -> per-flag sanitized DTOs.
 *
 * See docs/LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md sections A2/A3.
 * No caching for now — recordings land asynchronously and a stale "no
 * recording yet" response is a support headache; revisit once the FE refetch
 * cadence for the Past tab is settled.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerPastSessionService {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final List<String> ACTIVE_ENROLLMENT_STATUSES = List.of("ACTIVE");

    private final LiveSessionRepository liveSessionRepository;
    private final LiveSessionLogsRepository liveSessionLogsRepository;
    private final LiveSessionContentLinkRepository liveSessionContentLinkRepository;
    private final SlideRepository slideRepository;
    private final VideoSlideRepository videoSlideRepository;
    private final DocumentSlideRepository documentSlideRepository;
    private final LiveSessionLearnerDisplaySettingsService displaySettingsService;
    private final PackageSessionRepository packageSessionRepository;
    private final StudentSessionInstituteGroupMappingRepository studentSessionInstituteGroupMappingRepository;
    private final LiveSessionInstructorService instructorService;
    private final LearnerPublicSessionVisibilityService publicSessionVisibilityService;
    private final LiveSessionAttendanceOnlyModeService attendanceOnlyModeService;
    private final ObjectMapper objectMapper;

    public LearnerPastSessionsResponseDTO getPastSessions(String batchId, String userId, String instituteId,
            int page, Integer size, String startDate, String endDate) {

        int pageSize = (size == null || size <= 0) ? DEFAULT_PAGE_SIZE : size;
        int pageNumber = Math.max(page, 0);

        String resolvedInstituteId = resolveInstituteId(batchId, userId, instituteId);
        // Attendance-only institute: only classes marked show_to_learners are listed.
        boolean learnerVisibleOnly = attendanceOnlyModeService.isEnabled(resolvedInstituteId);
        LearnerDisplaySettingsFlags flags = displaySettingsService.getFlags(resolvedInstituteId);
        LearnerPastSessionsResponseDTO.DisplayFlagsDTO flagsDTO = LearnerPastSessionsResponseDTO.DisplayFlagsDTO
                .from(flags);

        if (!flags.showPastSessions()) {
            // Master switch off: never touch the sessions query — no data cost,
            // no URL-guessing leak, per plan A1/A2.
            return LearnerPastSessionsResponseDTO.empty(flagsDTO, pageNumber, pageSize);
        }

        Pageable pageable = PageRequest.of(pageNumber, pageSize);
        // Opted-in institutes also list their unassigned public classes to enrolled learners.
        boolean includeUnassignedPublic = flags.showUnassignedPublicSessions()
                && publicSessionVisibilityService.isEnrolledLearner(resolvedInstituteId, userId);
        Page<LiveSessionRepository.LearnerPastSessionProjection> pageResult = includeUnassignedPublic
                ? liveSessionRepository.findPastSessionsForUserAndBatchIncludingUnassignedPublic(
                        batchId, userId, resolvedInstituteId, startDate, endDate, learnerVisibleOnly, pageable)
                : liveSessionRepository.findPastSessionsForUserAndBatch(
                        batchId, userId, startDate, endDate, learnerVisibleOnly, pageable);

        if (learnerVisibleOnly && pageResult.getTotalElements() == 0
                && !StringUtils.hasText(startDate) && !StringUtils.hasText(endDate)) {
            // Attendance-only institute with no class shown to learners: all
            // flags off so the FE hides the Past section, as before the
            // per-class choice existed, rather than showing it empty.
            return LearnerPastSessionsResponseDTO.empty(
                    LearnerPastSessionsResponseDTO.DisplayFlagsDTO.from(LearnerDisplaySettingsFlags.allOff()),
                    pageNumber, pageSize);
        }

        List<LiveSessionRepository.LearnerPastSessionProjection> projections = pageResult.getContent();

        List<String> scheduleIds = projections.stream()
                .map(LiveSessionRepository.LearnerPastSessionProjection::getScheduleId)
                .distinct()
                .collect(Collectors.toList());

        Map<String, List<LiveSessionLogs>> logsByScheduleId = Collections.emptyMap();
        if ((flags.showAttendance() || flags.showActivityStats()) && StringUtils.hasText(userId)
                && !scheduleIds.isEmpty()) {
            List<LiveSessionLogs> logs = liveSessionLogsRepository
                    .findAttendanceLogsForScheduleIdsAndUser(scheduleIds, userId);
            logsByScheduleId = logs.stream().collect(Collectors.groupingBy(LiveSessionLogs::getScheduleId));
        }

        Map<String, List<LearnerPastSessionDTO.MaterialDTO>> materialsByScheduleId = Collections.emptyMap();
        if (flags.showClassMaterials() && StringUtils.hasText(batchId) && !scheduleIds.isEmpty()) {
            materialsByScheduleId = loadMaterials(scheduleIds, batchId);
        }

        // One batched instructor+directory resolution for the page, not per card.
        Map<String, List<LiveSessionInstructorDTO>> instructorsBySessionId =
                loadInstructors(projections);

        List<LearnerPastSessionDTO> content = new ArrayList<>();
        for (LiveSessionRepository.LearnerPastSessionProjection projection : projections) {
            content.add(buildDto(projection, flags, logsByScheduleId, materialsByScheduleId,
                    instructorsBySessionId));
        }

        return LearnerPastSessionsResponseDTO.builder()
                .displayFlags(flagsDTO)
                .content(content)
                .page(pageResult.getNumber())
                .size(pageResult.getSize())
                .totalPages(pageResult.getTotalPages())
                .totalElements(pageResult.getTotalElements())
                .last(pageResult.isLast())
                .build();
    }

    /**
     * instituteId param (explicit override, mirroring LearnerAttendanceReportController's
     * precedent) takes priority, then batchId -> package_session's owning institute,
     * then userId -> the learner's active enrollment institute. Returns null (never
     * throws) when none resolve — the settings lookup treats null as "flags off".
     */
    private String resolveInstituteId(String batchId, String userId, String instituteId) {
        if (StringUtils.hasText(instituteId)) {
            return instituteId;
        }
        if (StringUtils.hasText(batchId)) {
            Optional<String> resolved = packageSessionRepository.findInstituteIdByPackageSessionId(batchId);
            if (resolved.isPresent()) {
                return resolved.get();
            }
        }
        if (StringUtils.hasText(userId)) {
            Optional<String> resolved = studentSessionInstituteGroupMappingRepository
                    .findInstituteIdByUserIdAndStatus(userId, ACTIVE_ENROLLMENT_STATUSES);
            if (resolved.isPresent()) {
                return resolved.get();
            }
        }
        return null;
    }

    /**
     * Instructors for every session on this page, keyed by session id (V524).
     *
     * <p>Not gated behind a display flag: unlike recordings or attendance,
     * knowing who taught the class isn't sensitive learner data, and the
     * existing flags each govern a specific block the plan named.
     *
     * <p>Never throws — a page of past classes must not fail over a missing name.
     */
    private Map<String, List<LiveSessionInstructorDTO>> loadInstructors(
            List<LiveSessionRepository.LearnerPastSessionProjection> projections) {
        try {
            List<String> sessionIds = projections.stream()
                    .map(LiveSessionRepository.LearnerPastSessionProjection::getSessionId)
                    .filter(StringUtils::hasText)
                    .distinct()
                    .toList();
            if (sessionIds.isEmpty()) {
                return Collections.emptyMap();
            }
            Map<String, List<String>> idsBySession = instructorService
                    .getEffectiveInstructorUserIdsBySession(liveSessionRepository.findAllById(sessionIds));

            List<String> allUserIds = idsBySession.values().stream()
                    .flatMap(List::stream)
                    .distinct()
                    .toList();
            if (allUserIds.isEmpty()) {
                return Collections.emptyMap();
            }
            Map<String, LiveSessionInstructorDTO> detailsByUserId = instructorService
                    .toInstructorDetails(allUserIds).stream()
                    .collect(Collectors.toMap(LiveSessionInstructorDTO::getUserId, d -> d, (a, b) -> a));

            Map<String, List<LiveSessionInstructorDTO>> result = new HashMap<>();
            idsBySession.forEach((sessionId, userIds) -> result.put(sessionId, userIds.stream()
                    .map(detailsByUserId::get)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList())));
            return result;
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    private LearnerPastSessionDTO buildDto(LiveSessionRepository.LearnerPastSessionProjection projection,
            LearnerDisplaySettingsFlags flags, Map<String, List<LiveSessionLogs>> logsByScheduleId,
            Map<String, List<LearnerPastSessionDTO.MaterialDTO>> materialsByScheduleId,
            Map<String, List<LiveSessionInstructorDTO>> instructorsBySessionId) {

        LearnerPastSessionDTO.LearnerPastSessionDTOBuilder builder = LearnerPastSessionDTO.builder()
                .sessionId(projection.getSessionId())
                .scheduleId(projection.getScheduleId())
                .title(projection.getTitle())
                .subject(projection.getSubject())
                .meetingDate(projection.getMeetingDate())
                .startTime(projection.getStartTime())
                .lastEntryTime(projection.getLastEntryTime())
                .timezone(projection.getTimezone())
                .linkType(projection.getLinkType())
                .thumbnailFileId(projection.getThumbnailFileId());

        List<LiveSessionInstructorDTO> instructors = instructorsBySessionId.get(projection.getSessionId());
        if (instructors != null && !instructors.isEmpty()) {
            builder.instructors(instructors);
        }

        if (flags.showRecordings()) {
            builder.recordings(sanitizeRecordings(projection.getProviderRecordingsJson()));
        }

        List<LiveSessionLogs> logs = logsByScheduleId.get(projection.getScheduleId());

        if (flags.showAttendance()) {
            builder.attendanceStatus(resolveAttendanceStatus(logs));
        }

        if (flags.showActivityStats()) {
            builder.activity(resolveActivity(logs));
        }

        if (flags.showClassMaterials()) {
            builder.materials(
                    materialsByScheduleId.getOrDefault(projection.getScheduleId(), Collections.emptyList()));
        }

        return builder.build();
    }

    /**
     * Loads the Track B class materials (content_type MATERIAL_*) linked from
     * the page's schedules INTO THE LEARNER'S OWN BATCH, resolving each link's
     * slide to a learner-safe descriptor. Draft/unpublished slides are
     * excluded — learners only ever see published material. One batched query
     * per table (links, slides, video rows, document rows); no N+1.
     */
    private Map<String, List<LearnerPastSessionDTO.MaterialDTO>> loadMaterials(List<String> scheduleIds,
            String batchId) {
        List<LiveSessionContentLink> links = liveSessionContentLinkRepository
                .findActiveMaterialsForSchedulesAndBatch(scheduleIds, batchId);
        if (links.isEmpty()) {
            return Collections.emptyMap();
        }

        List<String> slideIds = links.stream().map(LiveSessionContentLink::getSlideId).distinct()
                .collect(Collectors.toList());
        Map<String, Slide> publishedSlides = slideRepository.findAllById(slideIds).stream()
                .filter(s -> "PUBLISHED".equalsIgnoreCase(s.getStatus()))
                .collect(Collectors.toMap(Slide::getId, s -> s));

        List<String> videoSourceIds = publishedSlides.values().stream()
                .filter(s -> "VIDEO".equalsIgnoreCase(s.getSourceType()))
                .map(Slide::getSourceId).distinct().collect(Collectors.toList());
        List<String> documentSourceIds = publishedSlides.values().stream()
                .filter(s -> "DOCUMENT".equalsIgnoreCase(s.getSourceType()))
                .map(Slide::getSourceId).distinct().collect(Collectors.toList());

        Map<String, VideoSlide> videosById = videoSourceIds.isEmpty() ? Collections.emptyMap()
                : videoSlideRepository.findAllById(videoSourceIds).stream()
                        .collect(Collectors.toMap(VideoSlide::getId, v -> v));
        Map<String, DocumentSlide> documentsById = documentSourceIds.isEmpty() ? Collections.emptyMap()
                : documentSlideRepository.findAllById(documentSourceIds).stream()
                        .collect(Collectors.toMap(DocumentSlide::getId, d -> d));

        Map<String, List<LearnerPastSessionDTO.MaterialDTO>> result = new LinkedHashMap<>();
        Map<String, Set<String>> seenSlidesPerSchedule = new LinkedHashMap<>();
        for (LiveSessionContentLink link : links) {
            if (link.getScheduleId() == null) {
                continue;
            }
            Slide slide = publishedSlides.get(link.getSlideId());
            if (slide == null) {
                continue;
            }
            // Same slide linked into multiple chapters of the same batch → one entry.
            if (!seenSlidesPerSchedule.computeIfAbsent(link.getScheduleId(), k -> new LinkedHashSet<>())
                    .add(slide.getId())) {
                continue;
            }
            LearnerPastSessionDTO.MaterialDTO material = toMaterial(slide, videosById, documentsById);
            if (material != null) {
                result.computeIfAbsent(link.getScheduleId(), k -> new ArrayList<>()).add(material);
            }
        }
        return result;
    }

    private LearnerPastSessionDTO.MaterialDTO toMaterial(Slide slide, Map<String, VideoSlide> videosById,
            Map<String, DocumentSlide> documentsById) {
        LearnerPastSessionDTO.MaterialDTO.MaterialDTOBuilder builder = LearnerPastSessionDTO.MaterialDTO.builder()
                .slideId(slide.getId())
                .title(slide.getTitle());

        if ("DOCUMENT".equalsIgnoreCase(slide.getSourceType())) {
            DocumentSlide document = documentsById.get(slide.getSourceId());
            if (document == null || !StringUtils.hasText(document.getPublishedData())) {
                return null;
            }
            return builder.kind("PDF").fileId(document.getPublishedData()).build();
        }

        if ("VIDEO".equalsIgnoreCase(slide.getSourceType())) {
            VideoSlide video = videosById.get(slide.getSourceId());
            if (video == null || !StringUtils.hasText(video.getPublishedUrl())) {
                return null;
            }
            // source_type follows the frontend player contract: FILE_ID = media
            // file id, VIDEO = YouTube URL (see LiveSessionContentLinkService).
            if ("FILE_ID".equalsIgnoreCase(video.getSourceType())) {
                return builder.kind("VIDEO").fileId(video.getPublishedUrl()).build();
            }
            return builder.kind("YOUTUBE").url(video.getPublishedUrl()).build();
        }

        return null;
    }

    private String resolveAttendanceStatus(List<LiveSessionLogs> logs) {
        if (logs == null || logs.isEmpty()) {
            return "UNMARKED";
        }
        // Most recent record wins (admin can re-mark attendance).
        LiveSessionLogs latest = logs.get(logs.size() - 1);
        String status = latest.getStatus();
        if (!StringUtils.hasText(status)) {
            return "UNMARKED";
        }
        return status.toUpperCase();
    }

    private LearnerPastSessionDTO.ActivityDTO resolveActivity(List<LiveSessionLogs> logs) {
        if (logs == null || logs.isEmpty()) {
            return LearnerPastSessionDTO.ActivityDTO.builder().build();
        }
        LiveSessionLogs latest = logs.get(logs.size() - 1);

        LearnerPastSessionDTO.ActivityDTO.ActivityDTOBuilder builder = LearnerPastSessionDTO.ActivityDTO.builder()
                .durationMinutes(latest.getProviderTotalDurationMinutes());

        if (StringUtils.hasText(latest.getEngagementData())) {
            try {
                Map<String, Object> engagement = objectMapper.readValue(latest.getEngagementData(),
                        new TypeReference<Map<String, Object>>() {
                        });
                builder.chats(asInteger(engagement.get("chats")));
                builder.talks(asInteger(engagement.get("talks")));
                builder.talkTime(asInteger(engagement.get("talkTime")));
                builder.raiseHand(asInteger(engagement.get("raisehand")));
                builder.emojis(asInteger(engagement.get("emojis")));
                builder.pollVotes(asInteger(engagement.get("pollVotes")));
            } catch (Exception e) {
                log.warn("Failed to parse engagement_data for log {}: {}", latest.getId(), e.getMessage());
            }
        }

        return builder.build();
    }

    private Integer asInteger(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.valueOf(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Maps raw provider_recordings_json (List<MeetingRecordingDTO>) to
     * sanitized LearnerRecordingDTOs. Per-recording playback type selection
     * priority: fileId (S3) > youtubeVideoUrl (YOUTUBE) > ZOOM_CLOUD playbackUrl
     * > any other playbackUrl (BBB). Never carries downloadUrl or provider host
     * URLs. See plan section A3.
     */
    private List<LearnerRecordingDTO> sanitizeRecordings(String providerRecordingsJson) {
        if (!StringUtils.hasText(providerRecordingsJson)) {
            return Collections.emptyList();
        }
        List<MeetingRecordingDTO> raw;
        try {
            raw = objectMapper.readValue(providerRecordingsJson, new TypeReference<List<MeetingRecordingDTO>>() {
            });
        } catch (Exception e) {
            log.warn("Failed to parse provider_recordings_json: {}", e.getMessage());
            return Collections.emptyList();
        }
        if (raw == null || raw.isEmpty()) {
            return Collections.emptyList();
        }

        List<LearnerRecordingDTO> sanitized = new ArrayList<>();
        for (MeetingRecordingDTO recording : raw) {
            LearnerRecordingDTO dto = sanitizeOneRecording(recording);
            if (dto != null) {
                sanitized.add(dto);
            }
        }
        return sanitized;
    }

    private LearnerRecordingDTO sanitizeOneRecording(MeetingRecordingDTO recording) {
        if (recording == null) {
            return null;
        }
        LearnerRecordingDTO.LearnerRecordingDTOBuilder builder = LearnerRecordingDTO.builder()
                .recordingId(recording.getRecordingId())
                .durationSeconds(recording.getDurationSeconds())
                .partLabel(recording.getType());

        if (StringUtils.hasText(recording.getFileId())) {
            return builder.playbackType("S3").fileId(recording.getFileId()).build();
        }

        if (StringUtils.hasText(recording.getYoutubeVideoUrl())) {
            return builder.playbackType("YOUTUBE").url(recording.getYoutubeVideoUrl()).build();
        }

        if ("ZOOM_CLOUD".equals(recording.getRecordingStorage()) && StringUtils.hasText(recording.getPlaybackUrl())) {
            builder.playbackType("ZOOM_CLOUD");
            if (isExpired(recording.getExpiresAt())) {
                // Omit url/passcode once expired — never hand out a dead/soon-invalid
                // provider link, just flag it so the FE can show "Recording expired".
                return builder.expired(true).build();
            }
            return builder
                    .url(recording.getPlaybackUrl())
                    .passcode(recording.getPasscode())
                    .expiresAt(recording.getExpiresAt())
                    .expired(false)
                    .build();
        }

        if (StringUtils.hasText(recording.getPlaybackUrl())) {
            return builder.playbackType("BBB").url(recording.getPlaybackUrl()).build();
        }

        // No usable playback source — omit this recording entirely; the FE's
        // "Recording not available" card is driven by an empty recordings list.
        return null;
    }

    private boolean isExpired(String expiresAtIso) {
        if (!StringUtils.hasText(expiresAtIso)) {
            return false;
        }
        try {
            return Instant.parse(expiresAtIso).isBefore(Instant.now());
        } catch (DateTimeParseException e) {
            return false;
        }
    }
}
