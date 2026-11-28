package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.chapter.entity.Chapter;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterToSlides;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterToSlidesRepository;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexMarker;
import vacademy.io.admin_core_service.features.learner_offline.service.OfflineManifestVersionService;
import vacademy.io.admin_core_service.features.live_session.dto.*;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionContentLink;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionContentLinkRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.slide.dto.AddDocumentSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.AddVideoSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.DocumentSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.VideoSlideDTO;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.DocumentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.VideoSlideRepository;
import vacademy.io.admin_core_service.features.slide.service.SlideService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class LiveSessionContentLinkService {

    private static final String CONTENT_TYPE_RECORDING = "RECORDING";
    private static final String CONTENT_TYPE_MATERIAL_PDF = "MATERIAL_PDF";
    private static final String CONTENT_TYPE_MATERIAL_VIDEO = "MATERIAL_VIDEO";

    private static final String KIND_RECORDING = "RECORDING";
    private static final String KIND_UPLOAD_PDF = "UPLOAD_PDF";
    private static final String KIND_UPLOAD_VIDEO = "UPLOAD_VIDEO";
    private static final String KIND_YOUTUBE = "YOUTUBE";

    private static final String OUTCOME_CREATED = "CREATED";
    private static final String OUTCOME_ALREADY_LINKED = "ALREADY_LINKED";
    private static final String OUTCOME_SHARED_CHAPTER_DEDUPED = "SHARED_CHAPTER_DEDUPED";

    private final LiveSessionRepository liveSessionRepository;
    private final SessionScheduleRepository sessionScheduleRepository;
    private final ChapterRepository chapterRepository;
    private final ChapterToSlidesRepository chapterToSlidesRepository;
    private final LiveSessionContentLinkRepository liveSessionContentLinkRepository;
    private final SlideService slideService;
    private final SlideRepository slideRepository;
    private final DocumentSlideRepository documentSlideRepository;
    private final VideoSlideRepository videoSlideRepository;
    private final OfflineManifestVersionService offlineManifestVersionService;
    private final InstituteAccessValidator instituteAccessValidator;
    private final ObjectMapper objectMapper;
    private final ContentIndexMarker contentIndexMarker;

    @Transactional
    public List<ContentLinkOutcomeDTO> linkContent(LinkContentRequestDTO request, CustomUserDetails user) {
        return linkContent(request, user != null ? user.getUserId() : null);
    }

    /**
     * Overload for automated (non-authenticated-request) callers, e.g.
     * {@code RecordingAutoLinkService} triggered from a provider recording sync
     * — there is no {@link CustomUserDetails} principal in that path, so the
     * session's {@code createdByUserId} is passed directly.
     */
    @Transactional
    public List<ContentLinkOutcomeDTO> linkContent(LinkContentRequestDTO request, String userId) {
        if (request.getDestinations() == null || request.getDestinations().isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "At least one destination is required");
        }
        if (request.getSource() == null || !StringUtils.hasText(request.getSource().getKind())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "source.kind is required");
        }
        String status = StringUtils.hasText(request.getSlideStatus()) ? request.getSlideStatus()
                : SlideStatus.PUBLISHED.name();

        LiveSession liveSession = liveSessionRepository.findById(request.getSessionId())
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Live session not found"));
        String instituteId = liveSession.getInstituteId();

        MeetingRecordingDTO resolvedRecording = null;
        if (KIND_RECORDING.equals(request.getSource().getKind())) {
            resolvedRecording = resolveRecording(request);
        }

        String contentType = resolveContentType(request.getSource().getKind());
        String recordingId = KIND_RECORDING.equals(request.getSource().getKind())
                ? request.getSource().getRecordingId()
                : null;

        List<ContentLinkOutcomeDTO> outcomes = new ArrayList<>();
        // chapterId -> slideId already resolved within THIS request (dedupe across
        // destinations that share a chapter, e.g. reference-copy chapters shared
        // across package sessions).
        Map<String, String> chapterIdToSlideIdThisRequest = new LinkedHashMap<>();

        for (ContentLinkDestinationDTO destination : request.getDestinations()) {
            String chapterId = destination.getChapterId();
            if (!StringUtils.hasText(chapterId) || !StringUtils.hasText(destination.getPackageSessionId())) {
                throw new VacademyException(HttpStatus.BAD_REQUEST,
                        "destinations[].chapter_id and package_session_id are required");
            }

            if (chapterIdToSlideIdThisRequest.containsKey(chapterId)) {
                String slideId = chapterIdToSlideIdThisRequest.get(chapterId);
                outcomes.add(new ContentLinkOutcomeDTO(destination.getPackageSessionId(), chapterId,
                        OUTCOME_SHARED_CHAPTER_DEDUPED, slideId,
                        "This chapter is shared across batches — content added once"));
                continue;
            }

            Optional<LiveSessionContentLink> existingLink = StringUtils.hasText(recordingId)
                    ? liveSessionContentLinkRepository.findActiveByScheduleAndRecordingAndChapter(
                            request.getScheduleId(), recordingId, chapterId)
                    : Optional.empty();

            if (existingLink.isPresent()) {
                String slideId = existingLink.get().getSlideId();
                chapterIdToSlideIdThisRequest.put(chapterId, slideId);
                outcomes.add(new ContentLinkOutcomeDTO(destination.getPackageSessionId(), chapterId,
                        OUTCOME_ALREADY_LINKED, slideId, "Already linked to this chapter"));
                continue;
            }

            String slideId = createSlideForChapter(request, chapterId, instituteId, status, resolvedRecording);
            chapterIdToSlideIdThisRequest.put(chapterId, slideId);

            LiveSessionContentLink link = LiveSessionContentLink.builder()
                    .sessionId(request.getSessionId())
                    .scheduleId(request.getScheduleId())
                    .recordingId(recordingId)
                    .contentType(contentType)
                    .slideId(slideId)
                    .chapterId(chapterId)
                    .packageSessionId(destination.getPackageSessionId())
                    .createdByUserId(userId)
                    .status("ACTIVE")
                    .build();
            liveSessionContentLinkRepository.save(link);

            outcomes.add(new ContentLinkOutcomeDTO(destination.getPackageSessionId(), chapterId, OUTCOME_CREATED,
                    slideId, null));
        }

        return outcomes;
    }

    public List<LiveSessionContentLinkDTO> getLinksForSession(String sessionId) {
        List<LiveSessionContentLink> links = liveSessionContentLinkRepository.findActiveBySessionId(sessionId);
        if (links.isEmpty()) {
            return Collections.emptyList();
        }
        List<String> chapterIds = links.stream().map(LiveSessionContentLink::getChapterId).distinct()
                .collect(Collectors.toList());
        Map<String, String> chapterIdToName = chapterRepository.findAllById(chapterIds).stream()
                .collect(Collectors.toMap(Chapter::getId, c -> Optional.ofNullable(c.getChapterName()).orElse("")));
        List<String> slideIds = links.stream().map(LiveSessionContentLink::getSlideId).distinct()
                .collect(Collectors.toList());
        Map<String, String> slideIdToTitle = slideRepository.findAllById(slideIds).stream()
                .collect(Collectors.toMap(Slide::getId, s -> Optional.ofNullable(s.getTitle()).orElse("")));

        return links.stream().map(l -> new LiveSessionContentLinkDTO(
                l.getId(),
                l.getSessionId(),
                l.getScheduleId(),
                l.getRecordingId(),
                l.getContentType(),
                l.getSlideId(),
                slideIdToTitle.getOrDefault(l.getSlideId(), ""),
                l.getChapterId(),
                chapterIdToName.getOrDefault(l.getChapterId(), ""),
                l.getPackageSessionId(),
                l.getCreatedAt())).collect(Collectors.toList());
    }

    /**
     * Renames the slide a link created. The title lives on the slide row and is
     * mirrored on its document/video source row (the study-library editor writes
     * both), so both are updated to keep the two in step.
     */
    @Transactional
    public void renameLink(String linkId, String title, CustomUserDetails user) {
        if (!StringUtils.hasText(title)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "title is required");
        }
        String trimmed = title.trim();
        // slide.title / document_slide.title / video_slide.title are all varchar(255).
        if (trimmed.length() > 255) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Name must be 255 characters or fewer");
        }
        LiveSessionContentLink link = liveSessionContentLinkRepository.findById(linkId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Content link not found"));
        if ("DELETED".equals(link.getStatus())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Content link not found");
        }
        requireStaffOfSessionInstitute(link, user);

        Slide slide = slideRepository.findById(link.getSlideId())
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Slide not found"));
        slide.setTitle(trimmed);
        slideRepository.save(slide);

        if (StringUtils.hasText(slide.getSourceId())) {
            if (SlideTypeEnum.DOCUMENT.name().equals(slide.getSourceType())) {
                documentSlideRepository.findById(slide.getSourceId()).ifPresent(doc -> {
                    doc.setTitle(trimmed);
                    documentSlideRepository.save(doc);
                });
            } else if (SlideTypeEnum.VIDEO.name().equals(slide.getSourceType())) {
                videoSlideRepository.findById(slide.getSourceId()).ifPresent(video -> {
                    video.setTitle(trimmed);
                    videoSlideRepository.save(video);
                });
            }
        }

        // bump() (not bumpAll) so the call goes through the proxy and gets its own
        // REQUIRES_NEW transaction: a failed bump can never roll back the rename.
        offlineManifestVersionService.bump(link.getPackageSessionId(), "SLIDE_RENAMED");
        contentIndexMarker.mark(slide.getId(), link.getChapterId(), "SLIDE_RENAMED");
    }

    @Transactional
    public void deleteLink(String linkId, CustomUserDetails user) {
        LiveSessionContentLink link = liveSessionContentLinkRepository.findById(linkId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Content link not found"));
        if ("DELETED".equals(link.getStatus())) {
            return;
        }

        LiveSession liveSession = requireStaffOfSessionInstitute(link, user);

        // Reuses the same path as PUT /slide/v1/update-status — soft-deletes both
        // the chapter_to_slides mapping and the slide itself rather than a hard
        // delete, consistent with how slide removal works everywhere else.
        slideService.updateSlideStatus(liveSession.getInstituteId(), link.getChapterId(), link.getSlideId(),
                SlideStatus.DELETED.name());

        link.setStatus("DELETED");
        liveSessionContentLinkRepository.save(link);
    }

    // ── Admin activity log helpers ──────────────────────────────────────
    // Called from @Auditable SpEL on LiveSessionContentLinkController. They must
    // never throw: a failure here only costs the log sentence, never the action.

    /** Snapshot of a link before rename/delete; null when the link does not exist. */
    public ContentLinkAuditDTO auditSnapshot(String linkId) {
        try {
            LiveSessionContentLink link = liveSessionContentLinkRepository.findById(linkId).orElse(null);
            if (link == null) {
                return null;
            }
            String title = slideRepository.findById(link.getSlideId()).map(Slide::getTitle).orElse(null);
            String chapterName = chapterRepository.findById(link.getChapterId())
                    .map(Chapter::getChapterName).orElse(null);
            return new ContentLinkAuditDTO(link.getId(), link.getSessionId(), auditKind(link.getContentType()),
                    title, chapterName, !"DELETED".equals(link.getStatus()));
        } catch (Exception e) {
            log.warn("Content link audit snapshot failed for {}: {}", linkId, e.getMessage());
            return null;
        }
    }

    /** True when at least one destination got a new slide — a no-op re-link is not logged. */
    public boolean hasCreatedOutcome(List<ContentLinkOutcomeDTO> outcomes) {
        return outcomes != null && outcomes.stream().anyMatch(o -> OUTCOME_CREATED.equals(o.getOutcome()));
    }

    /** "added class material Revision Class to Lecture PDF, Notes". */
    public String describeLinkAdded(LinkContentRequestDTO request, List<ContentLinkOutcomeDTO> outcomes) {
        try {
            String kind = request != null && request.getSource() != null
                    && KIND_RECORDING.equals(request.getSource().getKind())
                    ? auditKind(CONTENT_TYPE_RECORDING) : auditKind(CONTENT_TYPE_MATERIAL_PDF);
            String title = request != null && StringUtils.hasText(request.getTitle())
                    ? request.getTitle().trim() : "untitled";
            List<String> chapterIds = outcomes == null ? List.of() : outcomes.stream()
                    .filter(o -> OUTCOME_CREATED.equals(o.getOutcome()))
                    .map(ContentLinkOutcomeDTO::getChapterId)
                    .filter(Objects::nonNull)
                    .distinct()
                    .collect(Collectors.toList());
            String chapters = chapterRepository.findAllById(chapterIds).stream()
                    .map(Chapter::getChapterName)
                    .filter(StringUtils::hasText)
                    .collect(Collectors.joining(", "));
            return "added " + kind + " " + title
                    + (StringUtils.hasText(chapters) ? " to " + chapters : "");
        } catch (Exception e) {
            log.warn("Content link add description failed: {}", e.getMessage());
            return null;
        }
    }

    /** "renamed class material Old name to New name". */
    public String describeLinkRenamed(ContentLinkAuditDTO before, String newTitle) {
        String kind = before != null && before.getKind() != null ? before.getKind() : auditKind(null);
        String oldTitle = before != null && StringUtils.hasText(before.getTitle()) ? before.getTitle() : "untitled";
        String title = newTitle != null ? newTitle.trim() : "";
        return "renamed " + kind + " " + oldTitle + " to " + title;
    }

    /** "removed class material Revision Class from Lecture PDF". */
    public String describeLinkRemoved(ContentLinkAuditDTO before) {
        if (before == null) {
            return null;
        }
        String title = StringUtils.hasText(before.getTitle()) ? before.getTitle() : "untitled";
        return "removed " + before.getKind() + " " + title
                + (StringUtils.hasText(before.getChapterName()) ? " from " + before.getChapterName() : "");
    }

    private String auditKind(String contentType) {
        return CONTENT_TYPE_RECORDING.equals(contentType) ? "recording" : "class material";
    }

    /**
     * Rename/delete act on a link by id alone, so the caller's institute is checked
     * against the session's. Any staff role passes (admin, teacher, custom roles);
     * learners and other institutes are refused.
     */
    private LiveSession requireStaffOfSessionInstitute(LiveSessionContentLink link, CustomUserDetails user) {
        LiveSession liveSession = liveSessionRepository.findById(link.getSessionId())
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Live session not found"));
        instituteAccessValidator.requireStaffAccess(user, liveSession.getInstituteId());
        return liveSession;
    }

    private String resolveContentType(String kind) {
        return switch (kind) {
            case KIND_RECORDING -> CONTENT_TYPE_RECORDING;
            case KIND_UPLOAD_PDF -> CONTENT_TYPE_MATERIAL_PDF;
            case KIND_UPLOAD_VIDEO, KIND_YOUTUBE -> CONTENT_TYPE_MATERIAL_VIDEO;
            default -> throw new VacademyException(HttpStatus.BAD_REQUEST, "Unsupported source.kind: " + kind);
        };
    }

    private MeetingRecordingDTO resolveRecording(LinkContentRequestDTO request) {
        if (!StringUtils.hasText(request.getScheduleId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "schedule_id is required for RECORDING source");
        }
        if (!StringUtils.hasText(request.getSource().getRecordingId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "source.recording_id is required for RECORDING source");
        }
        SessionSchedule schedule = sessionScheduleRepository.findById(request.getScheduleId())
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Session schedule not found"));

        List<MeetingRecordingDTO> recordings = parseRecordings(schedule.getProviderRecordingsJson());
        MeetingRecordingDTO recording = recordings.stream()
                .filter(r -> request.getSource().getRecordingId().equals(r.getRecordingId()))
                .findFirst()
                .orElse(null);

        boolean hasFileId = recording != null && StringUtils.hasText(recording.getFileId());
        boolean hasYoutube = recording != null && StringUtils.hasText(recording.getYoutubeVideoUrl());
        boolean hasFallbackUrl = StringUtils.hasText(request.getSource().getUrl());

        if (!hasFileId && !hasYoutube && !hasFallbackUrl) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Save recording to library first");
        }
        return recording;
    }

    private List<MeetingRecordingDTO> parseRecordings(String json) {
        if (!StringUtils.hasText(json)) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<MeetingRecordingDTO>>() {
            });
        } catch (Exception e) {
            log.error("Failed to parse provider_recordings_json", e);
            return Collections.emptyList();
        }
    }

    private String createSlideForChapter(LinkContentRequestDTO request, String chapterId, String instituteId,
            String status, MeetingRecordingDTO resolvedRecording) {
        int slideOrder = resolveSlideOrder(chapterId, request.getPosition());
        String kind = request.getSource().getKind();

        if (KIND_UPLOAD_PDF.equals(kind)) {
            String fileId = request.getSource().getFileId();
            if (!StringUtils.hasText(fileId)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "source.file_id is required for UPLOAD_PDF");
            }
            return createDocumentSlide(request, chapterId, instituteId, status, slideOrder, fileId);
        }

        // RECORDING | UPLOAD_VIDEO | YOUTUBE all create a VIDEO slide.
        // source_type must match the FRONTEND player contract, not VideoSlideSourceType:
        // "FILE_ID" = media-service file id resolved via get-public-url; "VIDEO" = YouTube URL.
        // Anything else falls into the learner app's default YouTube-embed branch and breaks.
        String url;
        String sourceType;
        if (KIND_YOUTUBE.equals(kind)) {
            url = request.getSource().getUrl();
            if (!StringUtils.hasText(url)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "source.url is required for YOUTUBE");
            }
            sourceType = "VIDEO";
        } else if (KIND_UPLOAD_VIDEO.equals(kind)) {
            url = request.getSource().getFileId();
            if (!StringUtils.hasText(url)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "source.file_id is required for UPLOAD_VIDEO");
            }
            sourceType = "FILE_ID";
        } else if (KIND_RECORDING.equals(kind)) {
            if (resolvedRecording != null && StringUtils.hasText(resolvedRecording.getFileId())) {
                url = resolvedRecording.getFileId();
                sourceType = "FILE_ID";
            } else if (resolvedRecording != null && StringUtils.hasText(resolvedRecording.getYoutubeVideoUrl())) {
                url = resolvedRecording.getYoutubeVideoUrl();
                sourceType = "VIDEO";
            } else if (isYoutubeUrl(request.getSource().getUrl())) {
                url = request.getSource().getUrl();
                sourceType = "VIDEO";
            } else {
                // A provider playback URL (expiring Zoom/BBB link) would render as a broken
                // player for learners — refuse and ask for an S3 copy instead.
                throw new VacademyException(HttpStatus.BAD_REQUEST, "Save recording to library first");
            }
        } else {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Unsupported source.kind: " + kind);
        }

        return createVideoSlide(request, chapterId, instituteId, status, slideOrder, url, sourceType);
    }

    private boolean isYoutubeUrl(String url) {
        return StringUtils.hasText(url)
                && url.matches("(?i)^https?://(www\\.)?(youtube\\.com|youtu\\.be)/.*");
    }

    private String createVideoSlide(LinkContentRequestDTO request, String chapterId, String instituteId,
            String status, int slideOrder, String url, String sourceType) {
        VideoSlideDTO videoSlideDTO = new VideoSlideDTO();
        videoSlideDTO.setId(UUID.randomUUID().toString());
        videoSlideDTO.setTitle(request.getTitle());
        videoSlideDTO.setDescription(request.getDescription());
        videoSlideDTO.setUrl(url);
        videoSlideDTO.setSourceType(sourceType);
        if (SlideStatus.PUBLISHED.name().equalsIgnoreCase(status)) {
            videoSlideDTO.setPublishedUrl(url);
        }

        AddVideoSlideDTO addVideoSlideDTO = new AddVideoSlideDTO();
        addVideoSlideDTO.setId(UUID.randomUUID().toString());
        addVideoSlideDTO.setTitle(request.getTitle());
        addVideoSlideDTO.setDescription(request.getDescription());
        addVideoSlideDTO.setSlideOrder(slideOrder);
        addVideoSlideDTO.setVideoSlide(videoSlideDTO);
        addVideoSlideDTO.setStatus(status);
        addVideoSlideDTO.setNewSlide(true);
        addVideoSlideDTO.setNotify(request.isNotify());

        return slideService.addVideoSlide(addVideoSlideDTO, chapterId, instituteId);
    }

    private String createDocumentSlide(LinkContentRequestDTO request, String chapterId, String instituteId,
            String status, int slideOrder, String fileId) {
        DocumentSlideDTO documentSlideDTO = new DocumentSlideDTO();
        documentSlideDTO.setId(UUID.randomUUID().toString());
        documentSlideDTO.setTitle(request.getTitle());
        documentSlideDTO.setType("PDF");
        documentSlideDTO.setData(fileId);

        AddDocumentSlideDTO addDocumentSlideDTO = new AddDocumentSlideDTO();
        addDocumentSlideDTO.setId(UUID.randomUUID().toString());
        addDocumentSlideDTO.setTitle(request.getTitle());
        addDocumentSlideDTO.setDescription(request.getDescription());
        addDocumentSlideDTO.setSlideOrder(slideOrder);
        addDocumentSlideDTO.setDocumentSlide(documentSlideDTO);
        addDocumentSlideDTO.setStatus(status);
        addDocumentSlideDTO.setNewSlide(true);
        addDocumentSlideDTO.setNotify(request.isNotify());

        return slideService.addDocumentSlide(addDocumentSlideDTO, chapterId, instituteId);
    }

    /**
     * BOTTOM (default): slide_order = max(existing) + 1.
     * TOP: shifts every existing non-deleted mapping's slide_order +1 (in this
     * same transaction) and returns 0 for the new slide. slide_order is normally
     * client-supplied (see SlideController); this is the one server-computed
     * exception, kept atomic here for the same reason described in the plan.
     */
    private int resolveSlideOrder(String chapterId, String position) {
        if ("TOP".equalsIgnoreCase(position)) {
            List<ChapterToSlides> existing = chapterToSlidesRepository.findByChapterId(chapterId);
            for (ChapterToSlides cts : existing) {
                Integer order = cts.getSlideOrder();
                cts.setSlideOrder((order == null ? 0 : order) + 1);
            }
            if (!existing.isEmpty()) {
                chapterToSlidesRepository.saveAll(existing);
            }
            return 0;
        }
        Integer max = chapterToSlidesRepository.findMaxSlideOrderByChapterId(chapterId);
        return (max == null ? -1 : max) + 1;
    }
}
