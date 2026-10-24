package vacademy.io.admin_core_service.features.slide.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.chapter.entity.Chapter;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterPackageSessionMapping;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterToSlides;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterToSlidesRepository;
import vacademy.io.admin_core_service.features.common.entity.RichTextData;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexMarker;
import vacademy.io.admin_core_service.features.learner_offline.service.OfflineManifestVersionService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.admin_core_service.features.common.constants.ValidStatusListConstants;
import vacademy.io.admin_core_service.features.slide.dto.*;
import vacademy.io.admin_core_service.features.slide.entity.*;
import vacademy.io.admin_core_service.features.slide.enums.QuestionStatusEnum;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.*;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import vacademy.io.admin_core_service.features.slide.repository.HtmlVideoSlideRepository;

@Service
@RequiredArgsConstructor
@Slf4j
public class SlideService {

    /** Copy/move destination placement; anything else means append to the end. */
    private static final String SLIDE_POSITION_TOP = "TOP";

    private final SlideRepository slideRepository;
    private final ChapterRepository chapterRepository;
    private final ChapterToSlidesRepository chapterToSlidesRepository;
    private final DocumentSlideRepository documentSlideRepository;
    private final VideoSlideRepository videoSlideRepository;
    private final QuestionSlideRepository questionSlideRepository;
    private final AssignmentSlideRepository assignmentSlideRepository;
    private final QuizSlideRepository quizSlideRepository;
    private final TeachingPlanStaleMarker teachingPlanStaleMarker;
    private final VideoSlideQuestionRepository videoSlideQuestionRepository;
    private final HtmlVideoSlideRepository htmlVideoSlideRepository;
    private final ScormSlideRepository scormSlideRepository;
    private final AudioSlideRepository audioSlideRepository;
    private final QuizSlideQuestionRepository quizSlideQuestionRepository;
    private final AssessmentSlideRepository assessmentSlideRepository;
    private final SlideNotificationService slideNotificationService;
    private final ObjectMapper objectMapper;
    private final LearnerTrackingAsyncService learnerTrackingAsyncService;
    private final AssessmentSlideBatchRegistrationService assessmentSlideBatchRegistrationService;
    private final CopiedSlideStatusResolver copiedSlideStatusResolver;
    private final ChapterPackageSessionMappingRepository chapterPackageSessionMappingRepository;
    private final OfflineManifestVersionService offlineManifestVersionService;
    private final ContentIndexMarker contentIndexMarker;

    @Transactional
    public String addOrUpdateDocumentSlide(AddDocumentSlideDTO addDocumentSlideDTO,
            String chapterId,
            String moduleId,
            String subjectId,
            String packageSessionId,
            String instituteId) {
        String slideId = addDocumentSlideDTO.getId();
        if (addDocumentSlideDTO.isNewSlide()) {
            return addDocumentSlide(addDocumentSlideDTO, chapterId, instituteId);
        } else {
            chapterToSlidesRepository.findByChapterIdAndSlideId(chapterId, addDocumentSlideDTO.getId())
                    .map(chapterToSlides -> {
                        updateChapterToSlides(addDocumentSlideDTO.getSlideOrder(), addDocumentSlideDTO.getStatus(),
                                chapterToSlides);
                        updateSlide(addDocumentSlideDTO.getDescription(), addDocumentSlideDTO.getTitle(),
                                addDocumentSlideDTO.getImageFileId(), addDocumentSlideDTO.getStatus(),
                                chapterToSlides.getSlide());
                        updateDocument(addDocumentSlideDTO.getDocumentSlide(), addDocumentSlideDTO.getStatus());
                        notifyIfPublished(addDocumentSlideDTO.getStatus(), addDocumentSlideDTO.isNotify(), instituteId,
                                chapterToSlides);
                        return "Slide updated successfully";
                    })
                    .orElseGet(() -> addDocumentSlide(addDocumentSlideDTO, chapterId, instituteId));
        }
        learnerTrackingAsyncService.updateLearnerOperationsForBatch("SLIDE", slideId, SlideTypeEnum.DOCUMENT.name(),
                chapterId, moduleId, subjectId, packageSessionId);
        teachingPlanStaleMarker.markStaleIfPublished(slideId, addDocumentSlideDTO.getStatus());
        contentIndexMarker.mark(slideId, chapterId, "SLIDE_UPDATED_DOCUMENT");
        bumpOfflineManifest(chapterId, addDocumentSlideDTO.getStatus(), "SLIDE_UPDATED_DOCUMENT");
        return slideId;
    }

    @Transactional
    public String addOrUpdateVideoSlide(AddVideoSlideDTO addVideoSlideDTO,
            String chapterId,
            String moduleId,
            String subjectId,
            String packageSessionId,
            String instituteId) {
        String slideId = addVideoSlideDTO.getId();
        if (addVideoSlideDTO.isNewSlide()) {
            return addVideoSlide(addVideoSlideDTO, chapterId, instituteId);
        } else {
            chapterToSlidesRepository.findByChapterIdAndSlideId(chapterId, addVideoSlideDTO.getId())
                    .map(chapterToSlides -> {
                        updateChapterToSlides(addVideoSlideDTO.getSlideOrder(), addVideoSlideDTO.getStatus(),
                                chapterToSlides);
                        updateSlide(addVideoSlideDTO.getDescription(), addVideoSlideDTO.getTitle(),
                                addVideoSlideDTO.getImageFileId(), addVideoSlideDTO.getStatus(),
                                chapterToSlides.getSlide());
                        updateVideoSlide(addVideoSlideDTO.getVideoSlide(), addVideoSlideDTO.getStatus());
                        notifyIfPublished(addVideoSlideDTO.getStatus(), addVideoSlideDTO.isNotify(), instituteId,
                                chapterToSlides);
                        return "Slide updated successfully";
                    })
                    .orElseGet(() -> addVideoSlide(addVideoSlideDTO, chapterId, instituteId));
        }
        learnerTrackingAsyncService.updateLearnerOperationsForBatch("SLIDE", slideId, SlideTypeEnum.VIDEO.name(),
                chapterId, moduleId, subjectId, packageSessionId);
        teachingPlanStaleMarker.markStaleIfPublished(slideId, addVideoSlideDTO.getStatus());
        contentIndexMarker.mark(slideId, chapterId, "SLIDE_UPDATED_VIDEO");
        bumpOfflineManifest(chapterId, addVideoSlideDTO.getStatus(), "SLIDE_UPDATED_VIDEO");
        return slideId;
    }

    /**
     * "Notify learners" is a side effect of publishing a slide, never a
     * precondition for it. Every caller runs inside a transaction, so letting a
     * notification failure propagate rolls back the slide, its chapter mapping
     * and (for the live-session flow) the content link — the teacher's material
     * silently disappears while the emails still go out. Swallow and log
     * instead: the send is queued asynchronously by NotificationService, so the
     * only exceptions reaching here are genuine delivery-side failures.
     */
    private void notifyIfPublished(String status, boolean notify, String instituteId, ChapterToSlides chapterToSlides) {
        if (SlideStatus.PUBLISHED.name().equals(status) && notify) {
            try {
                slideNotificationService.sendNotificationForAddingSlide(instituteId, chapterToSlides.getChapter(),
                        chapterToSlides.getSlide());
            } catch (Exception e) {
                log.error("Slide published but 'notify learners' email failed for slide {} in chapter {}: {}",
                        chapterToSlides.getSlide() != null ? chapterToSlides.getSlide().getId() : null,
                        chapterToSlides.getChapter() != null ? chapterToSlides.getChapter().getId() : null,
                        e.getMessage(), e);
            }
        }
    }

    private void updateChapterToSlides(Integer slideOrder, String status, ChapterToSlides chapterToSlides) {
        Optional.ofNullable(slideOrder).ifPresent(chapterToSlides::setSlideOrder);
        Optional.ofNullable(status).filter(s -> !s.trim().isEmpty()).ifPresent(chapterToSlides::setStatus);
        chapterToSlidesRepository.save(chapterToSlides);
    }

    private void updateSlide(String description, String title, String imageFileId, String status, Slide slide) {
        Optional.ofNullable(description).filter(d -> !d.isEmpty()).ifPresent(slide::setDescription);
        Optional.ofNullable(title).filter(t -> !t.isEmpty()).ifPresent(slide::setTitle);
        Optional.ofNullable(imageFileId).filter(i -> !i.isEmpty()).ifPresent(slide::setImageFileId);
        Optional.ofNullable(status).filter(s -> !s.isEmpty()).ifPresent(slide::setStatus);
        if (status.equalsIgnoreCase(SlideStatus.PUBLISHED.name())) {
            slide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
        }
        slideRepository.save(slide);
    }

    private void updateDocument(DocumentSlideDTO documentSlideDTO, String status) {
        DocumentSlide documentSlide = documentSlideRepository.findById(documentSlideDTO.getId())
                .orElseThrow(() -> new VacademyException("Document slide not found"));

        Optional.ofNullable(documentSlideDTO.getType()).filter(t -> !t.isEmpty()).ifPresent(documentSlide::setType);
        Optional.ofNullable(documentSlideDTO.getTitle()).filter(t -> !t.isEmpty()).ifPresent(documentSlide::setTitle);
        Optional.ofNullable(documentSlideDTO.getCoverFileId()).filter(c -> !c.isEmpty())
                .ifPresent(documentSlide::setCoverFileId);
        guardFileBackedDocumentReference(documentSlide.getType(), documentSlideDTO);
        if (status.equalsIgnoreCase(SlideStatus.PUBLISHED.name())) {
            handlePublishedDocumentSlide(documentSlide, documentSlideDTO);
        } else if (status.equalsIgnoreCase(SlideStatus.DRAFT.name())) {
            handleDraftDocumentSlide(documentSlide, documentSlideDTO);
        } else {
            handleUnsyncDocumentSlide(documentSlide, documentSlideDTO);
        }
        documentSlideRepository.save(documentSlide);
    }

    public String addDocumentSlide(AddDocumentSlideDTO addDocumentSlideDTO, String chapterId, String instituteId) {
        Chapter chapter = chapterRepository.findById(chapterId)
                .orElseThrow(() -> new VacademyException("Chapter not found"));
        DocumentSlide documentSlide = documentSlideRepository
                .save(new DocumentSlide(addDocumentSlideDTO.getDocumentSlide(), addDocumentSlideDTO.getStatus()));
        Slide slide = slideRepository.save(new Slide(addDocumentSlideDTO, documentSlide.getId(),
                SlideTypeEnum.DOCUMENT.name(), addDocumentSlideDTO.getStatus()));
        ChapterToSlides chapterToSlides = chapterToSlidesRepository.save(new ChapterToSlides(chapter, slide,
                addDocumentSlideDTO.getSlideOrder(), addDocumentSlideDTO.getStatus()));
        notifyIfPublished(addDocumentSlideDTO.getStatus(), addDocumentSlideDTO.isNotify(), instituteId,
                chapterToSlides);
        // Adds here persist straight through the repositories rather than saveSlide(),
        // so this path needs its own bump.
        bumpOfflineManifest(chapterId, addDocumentSlideDTO.getStatus(), "SLIDE_ADDED_DOCUMENT");
        contentIndexMarker.mark(slide.getId(), chapterId, "SLIDE_ADDED_DOCUMENT");
        return slide.getId();
    }

    public String addVideoSlide(AddVideoSlideDTO addVideoSlideDTO, String chapterId, String instituteId) {
        Chapter chapter = chapterRepository.findById(chapterId)
                .orElseThrow(() -> new VacademyException("Chapter not found"));
        VideoSlide videoSlide = videoSlideRepository
                .save(new VideoSlide(addVideoSlideDTO.getVideoSlide(), addVideoSlideDTO.getStatus()));
        Slide slide = slideRepository.save(new Slide(addVideoSlideDTO, videoSlide.getId(), SlideTypeEnum.VIDEO.name(),
                addVideoSlideDTO.getStatus()));
        ChapterToSlides chapterToSlides = chapterToSlidesRepository.save(
                new ChapterToSlides(chapter, slide, addVideoSlideDTO.getSlideOrder(), addVideoSlideDTO.getStatus()));
        notifyIfPublished(addVideoSlideDTO.getStatus(), addVideoSlideDTO.isNotify(), instituteId, chapterToSlides);
        bumpOfflineManifest(chapterId, addVideoSlideDTO.getStatus(), "SLIDE_ADDED_VIDEO");
        contentIndexMarker.mark(slide.getId(), chapterId, "SLIDE_ADDED_VIDEO");
        return slide.getId();
    }

    @Transactional
    public String addOrUpdateScormSlide(AddScormSlideDTO addScormSlideDTO,
            String chapterId,
            String moduleId,
            String subjectId,
            String packageSessionId,
            String instituteId) {
        String slideId = addScormSlideDTO.getId();
        if (addScormSlideDTO.isNewSlide()) {
            return addScormSlide(addScormSlideDTO, chapterId, instituteId);
        } else {
            chapterToSlidesRepository.findByChapterIdAndSlideId(chapterId, addScormSlideDTO.getId())
                    .map(chapterToSlides -> {
                        updateChapterToSlides(addScormSlideDTO.getSlideOrder(), addScormSlideDTO.getStatus(),
                                chapterToSlides);
                        updateSlide(addScormSlideDTO.getDescription(), addScormSlideDTO.getTitle(),
                                addScormSlideDTO.getImageFileId(), addScormSlideDTO.getStatus(),
                                chapterToSlides.getSlide());
                        // No specific update for ScormSlide details as they are immutable after upload
                        // usually,
                        // but if needed, we could implement
                        // updateScormSlide(addScormSlideDTO.getScormSlide(), ...)
                        notifyIfPublished(addScormSlideDTO.getStatus(), addScormSlideDTO.isNotify(), instituteId,
                                chapterToSlides);
                        return "Slide updated successfully";
                    })
                    .orElseGet(() -> addScormSlide(addScormSlideDTO, chapterId, instituteId));
        }
        learnerTrackingAsyncService.updateLearnerOperationsForBatch("SLIDE", slideId, SlideTypeEnum.SCORM.name(),
                chapterId, moduleId, subjectId, packageSessionId);
        contentIndexMarker.mark(slideId, chapterId, "SLIDE_UPDATED_SCORM");
        return slideId;
    }

    public String addScormSlide(AddScormSlideDTO addScormSlideDTO, String chapterId, String instituteId) {
        Chapter chapter = chapterRepository.findById(chapterId)
                .orElseThrow(() -> new VacademyException("Chapter not found"));

        // SCORM slide is already created via upload, so we just link it.
        // But wait, the upload API creates the ScormSlide entity.
        // Here we receive the ScormSlideDTO which should contain the ID of the created
        // ScormSlide.
        // Validation: Check if ScormSlide exists?

        if (addScormSlideDTO.getScormSlide() == null || addScormSlideDTO.getScormSlide().getId() == null) {
            throw new VacademyException("Scorm Slide ID is required");
        }

        // We assume the ScormSlide entity already exists from the upload step.
        // We link it to the generic Slide.

        Slide slide = slideRepository.save(new Slide(addScormSlideDTO, addScormSlideDTO.getScormSlide().getId(),
                SlideTypeEnum.SCORM.name(), addScormSlideDTO.getStatus()));

        ChapterToSlides chapterToSlides = chapterToSlidesRepository.save(
                new ChapterToSlides(chapter, slide, addScormSlideDTO.getSlideOrder(), addScormSlideDTO.getStatus()));
        notifyIfPublished(addScormSlideDTO.getStatus(), addScormSlideDTO.isNotify(), instituteId, chapterToSlides);
        contentIndexMarker.mark(slide.getId(), chapterId, "SLIDE_ADDED_SCORM");
        return slide.getId();
    }

    public List<SlideDetailProjection> getSlidesByChapterId(String chapterId, CustomUserDetails user) {
        return slideRepository.findSlideDetailsByChapterId(chapterId,
                List.of(SlideStatus.PUBLISHED.name(), SlideStatus.DRAFT.name(), SlideStatus.UNSYNC.name()));
    }

    public void updateVideoSlide(VideoSlideDTO videoSlideDTO, String status) {
        VideoSlide videoSlide = videoSlideRepository.findById(videoSlideDTO.getId())
                .orElseThrow(() -> new VacademyException("Video slide not found"));
        Optional.ofNullable(videoSlideDTO.getDescription()).filter(d -> !d.trim().isEmpty())
                .ifPresent(videoSlide::setDescription);
        Optional.ofNullable(videoSlideDTO.getTitle()).filter(t -> !t.trim().isEmpty()).ifPresent(videoSlide::setTitle);
        if (StringUtils.hasText(videoSlideDTO.getUrl())) {
            videoSlide.setUrl(videoSlideDTO.getUrl());
        }
        // published_url is written only by the publish path (handlePublishedVideoSlide),
        // never on a draft/unsync save, so a draft edit can't change what learners see.
        if (StringUtils.hasText(videoSlideDTO.getSourceType())) {
            videoSlide.setSourceType(videoSlideDTO.getSourceType());
        }
        if (status.equalsIgnoreCase(SlideStatus.PUBLISHED.name())) {
            handlePublishedVideoSlide(videoSlide, videoSlideDTO);
        } else if (status.equalsIgnoreCase(SlideStatus.DRAFT.name())) {
            handleDraftVideoSlide(videoSlide, videoSlideDTO);
        } else {
            handleUnsyncVideoSlide(videoSlide, videoSlideDTO);
        }
        videoSlideRepository.save(videoSlide);
    }

    public String updateSlideStatus(String instituteId, String chapterId, String slideId, String status) {
        ChapterToSlides chapterToSlides = chapterToSlidesRepository.findByChapterIdAndSlideId(chapterId, slideId)
                .orElseThrow(() -> new VacademyException("Slide not found for the given chapter"));
        chapterToSlides.setStatus(status);
        chapterToSlidesRepository.save(chapterToSlides);

        Slide slide = chapterToSlides.getSlide();
        slide.setStatus(status);
        slideRepository.save(slide);

        if (SlideStatus.PUBLISHED.name().equals(status)) {
            slideNotificationService.sendNotificationForAddingSlide(instituteId, chapterToSlides.getChapter(), slide);
        }

        // Offline plan Part A2 bump hook: PUBLISHED/DELETED transitions change
        // what a learner's offline manifest should contain for every package
        // session this chapter belongs to.
        bumpOfflineManifest(chapterId, status, "SLIDE_STATUS_" + status);
        // Publish, unpublish and delete all change what course knowledge may answer from.
        contentIndexMarker.mark(slideId, chapterId, "SLIDE_STATUS_" + status);
        return "Slide status updated successfully";
    }

    /**
     * Tells every offline learner of this chapter that their downloaded copy is stale.
     *
     * This originally only ran on PUBLISHED/DELETED *status transitions*, which missed the two
     * things authors actually do most: editing the content of an already-published slide, and
     * adding a new slide to a chapter. Both left the manifest version untouched, so the learner
     * app compared versions, saw no change, and never offered "Update" — the downloaded copy
     * silently drifted from what the teacher published.
     *
     * Called from the shared choke points every slide type routes through ({@link #saveSlide}
     * for adds, {@link #updateSlide} for edits) plus the document/video/scorm update paths that
     * use the private updateSlide overload. Keep new slide-mutating paths wired through those.
     *
     * Only PUBLISHED/DELETED work is announced: draft saves don't change what the manifest
     * contains, and bumping on them would show learners an update that downloads nothing.
     */
    private void bumpOfflineManifest(String chapterId, String status, String reason) {
        if (!StringUtils.hasText(chapterId) || !StringUtils.hasText(status)) {
            return;
        }
        if (!SlideStatus.PUBLISHED.name().equalsIgnoreCase(status)
                && !SlideStatus.DELETED.name().equalsIgnoreCase(status)) {
            return;
        }
        List<ChapterPackageSessionMapping> mappings =
                chapterPackageSessionMappingRepository.findByChapterIdAndStatusNotDeleted(chapterId);
        offlineManifestVersionService.bumpAll(
                mappings.stream().map(m -> m.getPackageSession().getId()).collect(Collectors.toList()),
                reason);
    }

    @Transactional
    public String updateSlideOrder(List<UpdateSlideOrderDTO> updateSlideOrderDTOs, String chapterId,
            CustomUserDetails user) {
        List<String> slideIds = extractDistinctSlideIds(updateSlideOrderDTOs);
        List<ChapterToSlides> chapterToSlides = fetchMappings(chapterId, slideIds);
        Map<String, UpdateSlideOrderDTO> updateMap = mapUpdates(updateSlideOrderDTOs);
        updateSlideOrders(chapterToSlides, updateMap);
        chapterToSlidesRepository.saveAll(chapterToSlides);
        return "Slide order updated successfully";
    }

    private List<String> extractDistinctSlideIds(List<UpdateSlideOrderDTO> updateSlideOrderDTOs) {
        return updateSlideOrderDTOs.stream()
                .map(UpdateSlideOrderDTO::getSlideId)
                .distinct()
                .collect(Collectors.toList());
    }

    private List<ChapterToSlides> fetchMappings(String chapterId, List<String> slideIds) {
        return chapterToSlidesRepository.findMappingsByChapterIdAndSlideIds(chapterId, slideIds);
    }

    private Map<String, UpdateSlideOrderDTO> mapUpdates(List<UpdateSlideOrderDTO> updateSlideOrderDTOs) {
        return updateSlideOrderDTOs.stream()
                .collect(Collectors.toMap(UpdateSlideOrderDTO::getSlideId, Function.identity()));
    }

    private void updateSlideOrders(List<ChapterToSlides> chapterToSlides, Map<String, UpdateSlideOrderDTO> updateMap) {
        chapterToSlides.forEach(cts -> Optional.ofNullable(updateMap.get(cts.getSlide().getId()))
                .ifPresent(update -> cts.setSlideOrder(update.getSlideOrder())));
    }

    @Transactional
    public String copySlide(String slideId,
            String oldChapterId,
            String oldModuleId,
            String oldSubjectId,
            String oldPackageSessionId,
            String newChapterId,
            String newModuleId,
            String newSubjectId,
            String newPackageSessionId,
            String requestedStatus,
            String position,
            CustomUserDetails user) {
        Slide slide = getSlideById(slideId);
        Chapter chapter = getChapterById(newChapterId);

        Slide newSlide = copySlideByType(slide);

        // Status of the copied slide: the caller's explicit choice wins (the
        // Copy-to dialog lets the admin pick Published/Draft per copy). With no
        // choice sent, fall back to the institute's
        // COURSE_SETTING.copiedSlideStatus (KEEP_DRAFT | INHERIT_SOURCE |
        // ALWAYS_PUBLISHED); default/unset = KEEP_DRAFT, i.e. the original
        // behaviour. copySlideByType creates the slide as DRAFT, so we only
        // override (and re-save) when the resolved status differs.
        String requested = normalizeRequestedSlideStatus(requestedStatus);
        String copiedStatus = requested != null
                ? requested
                : copiedSlideStatusResolver.resolveForCopy(newPackageSessionId, slide.getStatus());
        if (!copiedStatus.equalsIgnoreCase(newSlide.getStatus())) {
            newSlide.setStatus(copiedStatus);
            if (SlideStatus.PUBLISHED.name().equalsIgnoreCase(copiedStatus)) {
                newSlide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
            }
            slideRepository.save(newSlide);
        }

        chapterToSlidesRepository
                .save(new ChapterToSlides(chapter, newSlide, resolveSlideOrder(newChapterId, position), copiedStatus));
        contentIndexMarker.mark(newSlide.getId(), newChapterId, "SLIDE_COPIED");

        // A copied ASSESSMENT slide keeps the same assessmentId but lands in a new
        // batch. Register that assessment to the target batch so it shows up for
        // those learners / in that course's assessment list — not just the slide.
        // Best-effort: the registration service swallows its own failures.
        if (SlideTypeEnum.ASSESSMENT.name().equalsIgnoreCase(slide.getSourceType())) {
            assessmentSlideBatchRegistrationService
                    .registerChapterAssessmentsToBatches(newChapterId, List.of(newPackageSessionId));
        }

        // Update learner tracking for all slide types
        updateLearnerTrackingForSlide(slide, oldChapterId, oldModuleId, oldSubjectId, oldPackageSessionId,
                newChapterId, newModuleId, newSubjectId, newPackageSessionId);

        return "Slide copied successfully.";
    }

    /**
     * Only PUBLISHED/DRAFT may be forced by a copy/move caller. Anything else
     * (null, blank, DELETED, a typo) means "no explicit choice" and leaves the
     * existing institute-setting / preserve-status behaviour in charge.
     */
    private String normalizeRequestedSlideStatus(String requestedStatus) {
        if (!StringUtils.hasText(requestedStatus)) {
            return null;
        }
        String value = requestedStatus.trim();
        if (SlideStatus.PUBLISHED.name().equalsIgnoreCase(value)
                || SlideStatus.DRAFT.name().equalsIgnoreCase(value)) {
            return value.toUpperCase();
        }
        return null;
    }

    /**
     * Where a copied/moved slide lands inside the destination chapter.
     *
     * <p>{@code TOP} pushes every existing slide down one slot (normalising any
     * NULL orders on the way — those sort first today and would otherwise stay
     * above the slide the admin explicitly put at the top). Anything else,
     * including no value at all, appends to the end, which is the sane default:
     * before this, copies were written with a NULL order and silently jumped to
     * the top of the chapter.
     */
    private Integer resolveSlideOrder(String chapterId, String position) {
        if (StringUtils.hasText(position) && SLIDE_POSITION_TOP.equalsIgnoreCase(position.trim())) {
            List<ChapterToSlides> existing = chapterToSlidesRepository.findByChapterId(chapterId);
            existing.forEach(mapping -> mapping
                    .setSlideOrder(mapping.getSlideOrder() == null ? 1 : mapping.getSlideOrder() + 1));
            chapterToSlidesRepository.saveAll(existing);
            return 0;
        }
        Integer maxOrder = chapterToSlidesRepository.findMaxSlideOrderByChapterId(chapterId);
        return maxOrder == null ? 0 : maxOrder + 1;
    }

    /**
     * Copy slide based on its type using appropriate service methods
     */
    private Slide copySlideByType(Slide slide) {
        String sourceType = slide.getSourceType();

        if (sourceType.equalsIgnoreCase(SlideTypeEnum.DOCUMENT.name())) {
            String newSourceId = copyDocumentSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.VIDEO.name())) {
            String newSourceId = copyVideoSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.QUESTION.name())) {
            String newSourceId = copyQuestionSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.ASSIGNMENT.name())) {
            String newSourceId = copyAssignmentSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.QUIZ.name())) {
            String newSourceId = copyQuizSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.VIDEO_QUESTION.name())) {
            String newSourceId = copyVideoSlideQuestionSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.HTML_VIDEO.name())) {
            String newSourceId = copyHtmlVideoSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.SCORM.name())) {
            String newSourceId = copyScormSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.ASSESSMENT.name())) {
            String newSourceId = copyAssessmentSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.AUDIO.name())) {
            String newSourceId = copyAudioSlideSource(slide.getSourceId());
            return createNewSlide(slide, newSourceId);
        } else {
            throw new VacademyException("Unsupported slide type for copying: " + sourceType);
        }
    }

    /**
     * Update learner tracking for slide operations
     */
    private void updateLearnerTrackingForSlide(Slide slide, String oldChapterId, String oldModuleId,
            String oldSubjectId, String oldPackageSessionId, String newChapterId, String newModuleId,
            String newSubjectId, String newPackageSessionId) {

        String sourceType = slide.getSourceType();
        String slideId = slide.getId();

        // Every branch of the old if-else chain made the same two calls with the
        // slide's own type — and AUDIO had no branch at all, so moving an audio
        // slide left both chapters' percentages stale for every learner. Resolve
        // the canonical enum name and always fire both recomputes.
        SlideTypeEnum slideType;
        try {
            slideType = SlideTypeEnum.valueOf(sourceType.toUpperCase());
        } catch (IllegalArgumentException e) {
            log.warn("Skipping learner-tracking recompute for slide {}: unknown source type {}", slideId, sourceType);
            return;
        }
        learnerTrackingAsyncService.updateLearnerOperationsForBatch("SLIDE", slideId, slideType.name(),
                oldChapterId, oldModuleId, oldSubjectId, oldPackageSessionId);
        learnerTrackingAsyncService.updateLearnerOperationsForBatch("SLIDE", slideId, slideType.name(),
                newChapterId, newModuleId, newSubjectId, newPackageSessionId);
    }

    @Transactional
    public String moveSlide(String slideId,
            String oldChapterId,
            String oldModuleId,
            String oldSubjectId,
            String oldPackageSessionId,
            String newChapterId,
            String newModuleId,
            String newSubjectId,
            String newPackageSessionId,
            String requestedStatus,
            String position,
            CustomUserDetails user) {
        ChapterToSlides existingMapping = getChapterToSlides(oldChapterId, slideId);
        Chapter newChapter = getChapterById(newChapterId);

        // A move keeps the slide's own status unless the caller asks for one
        // (the Move-to dialog offers Published/Draft, same as Copy-to).
        String requested = normalizeRequestedSlideStatus(requestedStatus);
        String mappingStatus = requested != null ? requested : existingMapping.getStatus();
        Slide movedSlide = existingMapping.getSlide();
        if (requested != null && movedSlide != null && !requested.equalsIgnoreCase(movedSlide.getStatus())) {
            movedSlide.setStatus(requested);
            if (SlideStatus.PUBLISHED.name().equalsIgnoreCase(requested)) {
                movedSlide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
            }
            slideRepository.save(movedSlide);
        }

        ChapterToSlides newMapping = new ChapterToSlides(newChapter, existingMapping.getSlide(),
                resolveSlideOrder(newChapterId, position), mappingStatus);
        chapterToSlidesRepository.save(newMapping);

        deleteMapping(slideId, oldChapterId);
        // Both chapters: the new one may sit in another course, and the old mapping is DELETED now.
        contentIndexMarker.mark(slideId, newChapterId, "SLIDE_MOVED");
        contentIndexMarker.mark(slideId, oldChapterId, "SLIDE_MOVED");

        // A moved ASSESSMENT slide now lives in a new batch. Register its assessment
        // to the target batch so it appears for those learners / in that course's
        // assessment list. Best-effort (the registration service swallows failures).
        // We intentionally do not de-register the old batch here: the same
        // assessment may still be reachable there via another slide, and dropping a
        // live registration risks hiding an in-flight assessment.
        if (existingMapping.getSlide() != null
                && SlideTypeEnum.ASSESSMENT.name().equalsIgnoreCase(existingMapping.getSlide().getSourceType())) {
            assessmentSlideBatchRegistrationService
                    .registerChapterAssessmentsToBatches(newChapterId, List.of(newPackageSessionId));
        }

        // Update learner tracking for all slide types
        updateLearnerTrackingForSlide(existingMapping.getSlide(), oldChapterId, oldModuleId, oldSubjectId,
                oldPackageSessionId,
                newChapterId, newModuleId, newSubjectId, newPackageSessionId);

        return "Slide moved successfully.";
    }

    public String deleteMapping(String slideId, String chapterId) {
        ChapterToSlides chapterToSlides = getChapterToSlides(chapterId, slideId);
        chapterToSlides.setStatus(SlideStatus.DELETED.name());
        chapterToSlidesRepository.save(chapterToSlides);
        contentIndexMarker.mark(slideId, chapterId, "SLIDE_UNMAPPED");
        return "Slide deleted successfully.";
    }

    private Slide createNewSlide(Slide slide, String newSourceId) {
        Slide newSlide = new Slide();
        newSlide.setId(UUID.randomUUID().toString());
        newSlide.setStatus(SlideStatus.DRAFT.name());
        newSlide.setTitle(slide.getTitle());
        newSlide.setDescription(slide.getDescription());
        newSlide.setSourceType(slide.getSourceType());
        newSlide.setSourceId(newSourceId);
        newSlide.setImageFileId(slide.getImageFileId());
        return slideRepository.save(newSlide);
    }

    private Slide getSlideById(String slideId) {
        return slideRepository.findById(slideId)
                .orElseThrow(() -> new VacademyException("Slide not found!!!"));
    }

    private Chapter getChapterById(String chapterId) {
        return chapterRepository.findById(chapterId)
                .orElseThrow(() -> new VacademyException("Chapter not found!!!"));
    }

    private ChapterToSlides getChapterToSlides(String chapterId, String slideId) {
        return chapterToSlidesRepository.findByChapterIdAndSlideId(chapterId, slideId)
                .orElseThrow(() -> new VacademyException("Chapter to slide not found"));
    }

    // Publishing a substantial live document down to a near-empty fragment is almost
    // always an accidental editor wipe, not a real edit. Block it unless the caller
    // explicitly forces it (author confirmed the deletion in the UI). This is the
    // server-side backstop that would have prevented the silent slide-wipe incidents.
    private static final int PUBLISHED_SHRINK_GUARD_MIN_CHARS = 2000;
    private static final double PUBLISHED_SHRINK_GUARD_RATIO = 0.25;

    // PDF / PPT_ANIM slides store a file id / deck base URL, never HTML. An editor-based
    // save path that misses this sends editor HTML instead (the empty-document shell, or
    // the previous slide's text), and the wipe guards below can't see it: a URL is far
    // under their size floor and has no blocks to lose. Refuse it outright — and not as a
    // 409, which the publish dialog would offer to force through.
    private static final Set<String> FILE_BACKED_DOCUMENT_TYPES = Set.of("PDF", "PPT_ANIM");

    private void guardFileBackedDocumentReference(String type, DocumentSlideDTO documentSlideDTO) {
        if (type == null || !FILE_BACKED_DOCUMENT_TYPES.contains(type.toUpperCase())) {
            return;
        }
        if (looksLikeHtml(documentSlideDTO.getData()) || looksLikeHtml(documentSlideDTO.getPublishedData())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "A " + type + " slide must reference a file, not document content.");
        }
    }

    private static boolean looksLikeHtml(String value) {
        return value != null && value.stripLeading().startsWith("<");
    }

    public void handlePublishedDocumentSlide(DocumentSlide documentSlide, DocumentSlideDTO documentSlideDTO) {
        String newPublishedData;
        Integer newPublishedTotalPages;
        if (documentSlideDTO != null && documentSlideDTO.getPublishedData() != null
                && documentSlideDTO.getPublishedData().trim().length() > 0) {
            newPublishedData = documentSlideDTO.getPublishedData();
            newPublishedTotalPages = documentSlideDTO.getPublishedDocumentTotalPages();
        } else {
            newPublishedData = documentSlide.getData();
            newPublishedTotalPages = documentSlide.getTotalPages();
        }
        boolean force = documentSlideDTO != null && documentSlideDTO.isForcePublish();
        // Two guards on the LIVE (published) content: the coarse byte-ratio wipe guard
        // (catches a catastrophic text collapse) AND the precise structural-block guard
        // (catches a dropped table/image/video/custom block even when byte size barely
        // moves). Either one blocks with a 409 unless the author force-publishes.
        guardAgainstPublishedContentWipe(documentSlide.getPublishedData(), newPublishedData, force);
        guardAgainstStructuralBlockLoss(documentSlide.getPublishedData(), newPublishedData, force);
        documentSlide.setPublishedData(newPublishedData);
        documentSlide.setPublishedDocumentTotalPages(newPublishedTotalPages);
        // Keep the draft copy in sync with what we just published instead of nulling it.
        // A published slide must reopen in the editor with its real content, so an author
        // can never re-save over an empty editor and wipe published_data.
        documentSlide.setData(newPublishedData);
        documentSlide.setTotalPages(newPublishedTotalPages);
    }

    private void guardAgainstPublishedContentWipe(String currentPublished, String incomingPublished, boolean force) {
        if (force) {
            return;
        }
        int currentLen = currentPublished == null ? 0 : currentPublished.trim().length();
        int incomingLen = incomingPublished == null ? 0 : incomingPublished.trim().length();
        if (currentLen >= PUBLISHED_SHRINK_GUARD_MIN_CHARS
                && incomingLen < currentLen * PUBLISHED_SHRINK_GUARD_RATIO) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "This will replace the current slide content with a much shorter version.");
        }
    }

    // --- Structural-block integrity guard (client-agnostic content-loss backstop) ---
    // A save is rejected (409) when the incoming HTML drops a STRUCTURAL block — a custom
    // Yoopta block (data-yoopta-type), table, image, or video/embed — that the stored HTML
    // contained. These never disappear on a normal edit; their loss is the signature of an
    // editor round-trip bug or a truncated client payload (see
    // docs/SLIDE_CONTENT_LOSS_INVESTIGATION.md). Plain text/paragraph shrink is NOT guarded
    // here — authors delete text freely. The author overrides with force (confirmed in UI).
    private static final Pattern YOOPTA_BLOCK_MARKER = Pattern.compile("data-yoopta-type=\"([a-zA-Z]+)\"");

    private static int countOccurrences(String s, String sub) {
        int n = 0, i = 0;
        while ((i = s.indexOf(sub, i)) >= 0) {
            n++;
            i += sub.length();
        }
        return n;
    }

    private static Map<String, Integer> structuralMarkerCounts(String html) {
        Map<String, Integer> counts = new HashMap<>();
        if (html == null) {
            return counts;
        }
        Matcher m = YOOPTA_BLOCK_MARKER.matcher(html);
        while (m.find()) {
            counts.merge(m.group(1), 1, Integer::sum);
        }
        int tables = countOccurrences(html, "<table");
        if (tables > 0) counts.put("table", tables);
        int imgs = countOccurrences(html, "<img");
        if (imgs > 0) counts.put("image", imgs);
        int media = countOccurrences(html, "<video") + countOccurrences(html, "<iframe");
        if (media > 0) counts.put("video/embed", media);
        return counts;
    }

    /** Human description of structural blocks the new HTML dropped vs old, or "" if none. */
    static String describeStructuralLoss(String oldHtml, String newHtml) {
        Map<String, Integer> before = structuralMarkerCounts(oldHtml);
        Map<String, Integer> after = structuralMarkerCounts(newHtml);
        List<String> lost = new ArrayList<>();
        for (Map.Entry<String, Integer> e : before.entrySet()) {
            int drop = e.getValue() - after.getOrDefault(e.getKey(), 0);
            if (drop > 0) {
                lost.add(drop + " " + e.getKey() + (drop > 1 ? "s" : ""));
            }
        }
        return String.join(", ", lost);
    }

    private void guardAgainstStructuralBlockLoss(String oldHtml, String newHtml, boolean force) {
        if (force) {
            return;
        }
        // An empty/blank incoming payload is handled by the caller's own empty-guard; do
        // not 409 here (that path is a distinct "editor returned nothing" case).
        if (newHtml == null || newHtml.trim().isEmpty()) {
            return;
        }
        String dropped = describeStructuralLoss(oldHtml, newHtml);
        if (!dropped.isEmpty()) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "This will remove " + dropped + " from the slide.");
        }
    }

    public void handleDraftDocumentSlide(DocumentSlide documentSlide, DocumentSlideDTO documentSlideDTO) {
        if (documentSlideDTO.getData() != null && !documentSlideDTO.getData().isEmpty()) {
            // Server-side backstop (client-agnostic): reject a draft save that would drop a
            // structural block (table/image/video/custom block) present in the stored draft.
            guardAgainstStructuralBlockLoss(documentSlide.getData(), documentSlideDTO.getData(),
                    documentSlideDTO.isForceOverwrite());
            documentSlide.setData(documentSlideDTO.getData());
        }

        if (documentSlideDTO.getTotalPages() != null) {
            documentSlide.setTotalPages(documentSlideDTO.getTotalPages());
        }
    }

    public void handleUnsyncDocumentSlide(DocumentSlide documentSlide, DocumentSlideDTO documentSlideDTO) {
        // UNSYNC = a published slide with pending draft edits. Only the draft columns are
        // touched here; published_data is written exclusively by the publish path, so a
        // draft save can never mutate what learners currently see.
        if (documentSlideDTO.getData() != null && !documentSlideDTO.getData().isEmpty()) {
            guardAgainstStructuralBlockLoss(documentSlide.getData(), documentSlideDTO.getData(),
                    documentSlideDTO.isForceOverwrite());
            documentSlide.setData(documentSlideDTO.getData());
        }
        if (documentSlideDTO.getTotalPages() != null) {
            documentSlide.setTotalPages(documentSlideDTO.getTotalPages());
        }
    }

    public void handlePublishedVideoSlide(VideoSlide videoSlide, VideoSlideDTO videoSlideDTO) {
        String newPublishedUrl;
        Long newPublishedLength;
        if (videoSlide != null && videoSlideDTO.getPublishedUrl() != null
                && videoSlideDTO.getPublishedUrl().trim().length() > 0) {
            newPublishedUrl = videoSlideDTO.getPublishedUrl();
            newPublishedLength = videoSlide.getPublishedVideoLengthInMillis();
        } else {
            newPublishedUrl = videoSlide.getUrl();
            newPublishedLength = videoSlideDTO.getVideoLengthInMillis();
        }
        videoSlide.setPublishedUrl(newPublishedUrl);
        videoSlide.setPublishedVideoLengthInMillis(newPublishedLength);
        // Keep the draft url/length in sync with the just-published content instead of
        // nulling them, so a published video always reopens in the editor with its real
        // URL and a re-save over an empty editor can never wipe published_url.
        videoSlide.setUrl(newPublishedUrl);
        videoSlide.setVideoLengthInMillis(newPublishedLength);
    }

    public void handleDraftVideoSlide(VideoSlide videoSlide, VideoSlideDTO videoSlideDTO) {
        if (videoSlideDTO.getUrl() != null && !videoSlideDTO.getUrl().isEmpty()) {
            videoSlide.setUrl(videoSlideDTO.getUrl());
        }

        if (videoSlideDTO.getVideoLengthInMillis() != null) {
            videoSlide.setVideoLengthInMillis(videoSlideDTO.getVideoLengthInMillis());
        }
    }

    public void handleUnsyncVideoSlide(VideoSlide videoSlide, VideoSlideDTO videoSlideDTO) {
        if (videoSlideDTO.getUrl() != null && !videoSlideDTO.getUrl().isEmpty()) {
            videoSlide.setUrl(videoSlideDTO.getUrl());
        }

        if (videoSlideDTO.getVideoLengthInMillis() != null) {
            videoSlide.setVideoLengthInMillis(videoSlideDTO.getVideoLengthInMillis());
        }
    }

    /**
     * Orders chapter→slide links the way the learner/admin outline renders them:
     * slide_order NULLs first, then slide_order ascending, then the slide's
     * created_at DESC (newest first) as the tie-break. The copy paths use this to
     * re-stamp a fresh, unique, sequential slide_order on the clones so a copied
     * chapter keeps the source's visible order — even when the source slides all
     * share slide_order=0 and the clones share one batch-insert created_at (which
     * would otherwise leave the copy in an arbitrary, unstable order).
     */
    public static Comparator<ChapterToSlides> renderOrderComparator() {
        return (a, b) -> {
            boolean aNull = a.getSlideOrder() == null;
            boolean bNull = b.getSlideOrder() == null;
            if (aNull != bNull) return aNull ? -1 : 1;          // NULL slide_order first
            if (!aNull) {
                int c = Integer.compare(a.getSlideOrder(), b.getSlideOrder());
                if (c != 0) return c;                            // slide_order ascending
            }
            Timestamp at = a.getSlide() == null ? null : a.getSlide().getCreatedAt();
            Timestamp bt = b.getSlide() == null ? null : b.getSlide().getCreatedAt();
            if (at == null && bt == null) return 0;
            if (at == null) return 1;                            // nulls last
            if (bt == null) return -1;
            return bt.compareTo(at);                             // created_at DESC
        };
    }

    public void copySlidesOfChapter(Chapter oldChapter, Chapter newChapter) {
        // Sort into the rendered order, then stamp a fresh sequential slide_order
        // (below) so the copy preserves the source's visible slide order
        // deterministically instead of relying on the (tied) created_at tie-break.
        List<ChapterToSlides> chapterToSlides = new ArrayList<>(
                chapterToSlidesRepository.findByChapterId(oldChapter.getId()));
        chapterToSlides.sort(renderOrderComparator());
        List<Slide> newSlides = new ArrayList<>();
        List<ChapterToSlides> newChapterToSlides = new ArrayList<>();

        // First, create new Slide instances and persist them before using them in
        // ChapterToSlides
        for (ChapterToSlides chapterToSlide : chapterToSlides) {
            Slide slide = chapterToSlide.getSlide();
            Slide newSlide = createBasicSlideCopy(slide);
            newSlides.add(newSlide);
        }

        // Save slides to make sure they are managed entities
        List<Slide> persistedSlides = slideRepository.saveAll(newSlides);

        // Now, process dependent entities (DocumentSlide/VideoSlide/etc.) with proper
        // copying
        for (int i = 0; i < chapterToSlides.size(); i++) {
            Slide oldSlide = chapterToSlides.get(i).getSlide();
            Slide newSlide = persistedSlides.get(i);

            String newSourceId = copySlideSourceByType(oldSlide);
            newSlide.setSourceId(newSourceId);

            // Create ChapterToSlides mapping — slide_order = position in the sorted
            // (rendered) order, so the copy is deterministic and matches the source.
            newChapterToSlides.add(new ChapterToSlides(newChapter, newSlide, i,
                    chapterToSlides.get(i).getStatus()));
        }

        // Update slides with source IDs and save ChapterToSlides
        slideRepository.saveAll(persistedSlides);
        chapterToSlidesRepository.saveAll(newChapterToSlides);
        contentIndexMarker.markChapter(newChapter.getId(), "CHAPTER_COPIED");

        // log.info("Copied {} slides from chapter {} to chapter {}",
        // newSlides.size(), oldChapter.getId(), newChapter.getId());
    }

    /**
     * Create a basic copy of a slide without the source content
     */
    private Slide createBasicSlideCopy(Slide slide) {
        Slide newSlide = new Slide();
        newSlide.setTitle(slide.getTitle());
        newSlide.setStatus(slide.getStatus());
        newSlide.setImageFileId(slide.getImageFileId());
        newSlide.setSourceType(slide.getSourceType());
        newSlide.setDescription(slide.getDescription());
        newSlide.setId(UUID.randomUUID().toString());
        return newSlide;
    }

    /**
     * Public delegate around the type-aware slide-source copy. Used by content-copy
     * orchestrators that walk the tree themselves and need to deep-clone the
     * polymorphic source row (DocumentSlide / VideoSlide / QuizSlide / ...).
     * Returns the new source_id to assign on the new Slide row.
     */
    public String copySlideSourceForSlide(Slide oldSlide) {
        return copySlideSourceByType(oldSlide);
    }

    /**
     * Copy slide source content based on slide type
     */
    private String copySlideSourceByType(Slide oldSlide) {
        String sourceType = oldSlide.getSourceType();

        if (sourceType.equalsIgnoreCase(SlideTypeEnum.DOCUMENT.name())) {
            return copyDocumentSlideSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.VIDEO.name())) {
            return copyVideoSlideSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.QUESTION.name())) {
            return copyQuestionSlideSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.ASSIGNMENT.name())) {
            return copyAssignmentSlideSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.QUIZ.name())) {
            return copyQuizSlideSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.VIDEO_QUESTION.name())) {
            return copyVideoSlideQuestionSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.HTML_VIDEO.name())) {
            return copyHtmlVideoSlideSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.SCORM.name())) {
            return copyScormSlideSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.ASSESSMENT.name())) {
            return copyAssessmentSlideSource(oldSlide.getSourceId());
        } else if (sourceType.equalsIgnoreCase(SlideTypeEnum.AUDIO.name())) {
            return copyAudioSlideSource(oldSlide.getSourceId());
        } else {
            // Falling through SHARES the source row between the original and the
            // copy — edits to one then show up in the other. AUDIO used to land
            // here, which is why course/chapter clones produced audio slides
            // pointing at the source course's audio_slide row. Every
            // SlideTypeEnum value now has a branch; this stays only for junk
            // source types (legacy "QUESTION_SLIDE", blank) where sharing beats
            // failing the whole clone.
            log.warn("Unknown slide type: {}, copying source ID as-is", sourceType);
            return oldSlide.getSourceId();
        }
    }

    /**
     * Copy document slide source and return new source ID
     */
    private String copyDocumentSlideSource(String sourceId) {
        DocumentSlide documentSlide = documentSlideRepository.findById(sourceId).orElse(null);
        if (documentSlide != null) {
            DocumentSlide newDocumentSlide = new DocumentSlide();
            newDocumentSlide.setId(UUID.randomUUID().toString());
            // A PUBLISHED source slide keeps its content in published_data and has
            // data cleared to null (see handlePublishedDocumentSlide). The copy is
            // created as DRAFT, and the editor renders a DRAFT slide from `data`, so
            // fall back to published_data here — otherwise the copy opens empty.
            boolean hasDraftData = documentSlide.getData() != null
                    && documentSlide.getData().trim().length() > 0;
            newDocumentSlide.setData(hasDraftData ? documentSlide.getData() : documentSlide.getPublishedData());
            newDocumentSlide.setTotalPages(documentSlide.getTotalPages() != null
                    ? documentSlide.getTotalPages()
                    : documentSlide.getPublishedDocumentTotalPages());
            newDocumentSlide.setType(documentSlide.getType());
            newDocumentSlide.setTitle(documentSlide.getTitle());
            newDocumentSlide.setPublishedData(documentSlide.getPublishedData());
            newDocumentSlide.setCoverFileId(documentSlide.getCoverFileId());
            newDocumentSlide.setPublishedDocumentTotalPages(documentSlide.getPublishedDocumentTotalPages());
            newDocumentSlide = documentSlideRepository.save(newDocumentSlide);
            return newDocumentSlide.getId();
        }
        return sourceId;
    }

    /**
     * AUDIO was missing from {@link #copySlideByType}, so every "Copy to" on an
     * audio slide threw "Unsupported slide type for copying: AUDIO" and surfaced
     * as a bare "Failed to copy slide" (Move was unaffected — it re-points the
     * chapter link and never clones the source row).
     *
     * <p>Mirrors the video copy: a copy starts life as a DRAFT and renders from
     * the draft field, so fall back to the published file/length when a
     * published slide has its draft fields cleared.
     */
    private String copyAudioSlideSource(String sourceId) {
        AudioSlide audioSlide = audioSlideRepository.findById(sourceId).orElse(null);
        if (audioSlide == null) {
            return sourceId;
        }
        AudioSlide newAudioSlide = new AudioSlide();
        newAudioSlide.setId(UUID.randomUUID().toString());
        newAudioSlide.setTitle(audioSlide.getTitle());
        newAudioSlide.setDescription(audioSlide.getDescription());
        newAudioSlide.setAudioFileId(StringUtils.hasText(audioSlide.getAudioFileId())
                ? audioSlide.getAudioFileId()
                : audioSlide.getPublishedAudioFileId());
        newAudioSlide.setAudioLengthInMillis(audioSlide.getAudioLengthInMillis() != null
                ? audioSlide.getAudioLengthInMillis()
                : audioSlide.getPublishedAudioLengthInMillis());
        newAudioSlide.setPublishedAudioFileId(audioSlide.getPublishedAudioFileId());
        newAudioSlide.setPublishedAudioLengthInMillis(audioSlide.getPublishedAudioLengthInMillis());
        newAudioSlide.setThumbnailFileId(audioSlide.getThumbnailFileId());
        newAudioSlide.setSourceType(audioSlide.getSourceType());
        newAudioSlide.setExternalUrl(audioSlide.getExternalUrl());
        newAudioSlide.setTranscript(audioSlide.getTranscript());
        return audioSlideRepository.save(newAudioSlide).getId();
    }

    /**
     * Copy video slide source and return new source ID
     */
    private String copyVideoSlideSource(String sourceId) {
        VideoSlide videoSlide = videoSlideRepository.findById(sourceId).orElse(null);
        if (videoSlide != null) {
            VideoSlide newVideoSlide = new VideoSlide();
            newVideoSlide.setId(UUID.randomUUID().toString());
            newVideoSlide.setTitle(videoSlide.getTitle());
            // Like documents, a PUBLISHED video keeps its content in published_url
            // with url cleared to null (see handlePublishedVideoSlide). The copy is
            // a DRAFT that renders from `url`, so fall back to published_url.
            boolean hasDraftUrl = videoSlide.getUrl() != null && videoSlide.getUrl().trim().length() > 0;
            newVideoSlide.setUrl(hasDraftUrl ? videoSlide.getUrl() : videoSlide.getPublishedUrl());
            newVideoSlide.setDescription(videoSlide.getDescription());
            newVideoSlide.setVideoLengthInMillis(videoSlide.getVideoLengthInMillis() != null
                    ? videoSlide.getVideoLengthInMillis()
                    : videoSlide.getPublishedVideoLengthInMillis());
            newVideoSlide.setPublishedUrl(videoSlide.getPublishedUrl());
            newVideoSlide.setPublishedVideoLengthInMillis(videoSlide.getPublishedVideoLengthInMillis());
            // Used to be dropped, so every copied video lost the information the
            // players route on. A copied VIMEO or FILE_ID slide came back with a
            // null source_type and fell through to the YouTube player, which can
            // play neither — the learner got an empty frame. (YouTube copies
            // survived by luck, since YouTube is the fallback.)
            newVideoSlide.setSourceType(videoSlide.getSourceType());
            // embeddedType/embeddedData are deliberately NOT copied. The split
            // screen JSON embeds the SOURCE video row's own id (videoSlideId /
            // originalVideoData.id), and the admin editor writes back to that id
            // in preference to the slide's real video row — so a verbatim copy
            // would make edits to the copy corrupt the original course. Copying
            // them needs an id remap first (cf. DripConditionRemapper); until
            // then a copied split-screen slide stays a plain video, as before.
            newVideoSlide = videoSlideRepository.save(newVideoSlide);
            return newVideoSlide.getId();
        }
        return sourceId;
    }

    /**
     * Copy question slide source and return new source ID
     */
    private String copyQuestionSlideSource(String sourceId) {
        QuestionSlide questionSlide = questionSlideRepository.findById(sourceId).orElse(null);
        if (questionSlide != null) {
            QuestionSlide newQuestionSlide = new QuestionSlide();
            newQuestionSlide.setId(UUID.randomUUID().toString());
            newQuestionSlide.setMediaId(questionSlide.getMediaId());
            newQuestionSlide.setQuestionResponseType(questionSlide.getQuestionResponseType());
            newQuestionSlide.setQuestionType(questionSlide.getQuestionType());
            newQuestionSlide.setAccessLevel(questionSlide.getAccessLevel());
            newQuestionSlide.setAutoEvaluationJson(questionSlide.getAutoEvaluationJson());
            newQuestionSlide.setEvaluationType(questionSlide.getEvaluationType());
            newQuestionSlide.setDefaultQuestionTimeMins(questionSlide.getDefaultQuestionTimeMins());
            newQuestionSlide.setReAttemptCount(questionSlide.getReAttemptCount());
            newQuestionSlide.setPoints(questionSlide.getPoints());
            newQuestionSlide.setSourceType(questionSlide.getSourceType());
            // The question text and its options used to be dropped, so a copied
            // QUESTION slide opened blank with no answers to pick from. Same
            // treatment the QUIZ path already gives its questions.
            if (questionSlide.getParentRichText() != null) {
                newQuestionSlide.setParentRichText(copyRichText(questionSlide.getParentRichText()));
            }
            if (questionSlide.getTextData() != null) {
                newQuestionSlide.setTextData(copyRichText(questionSlide.getTextData()));
            }
            if (questionSlide.getExplanationTextData() != null) {
                newQuestionSlide.setExplanationTextData(copyRichText(questionSlide.getExplanationTextData()));
            }

            Map<String, String> optionIdMap = new HashMap<>();
            if (questionSlide.getOptions() != null) {
                List<Option> newOptions = new ArrayList<>();
                for (Option oldOption : questionSlide.getOptions()) {
                    String newOptionId = UUID.randomUUID().toString();
                    optionIdMap.put(oldOption.getId(), newOptionId);
                    Option newOption = new Option();
                    newOption.setId(newOptionId);
                    newOption.setQuestionSlide(newQuestionSlide);
                    newOption.setMediaId(oldOption.getMediaId());
                    if (oldOption.getText() != null) {
                        newOption.setText(copyRichText(oldOption.getText()));
                    }
                    if (oldOption.getExplanationTextData() != null) {
                        newOption.setExplanationTextData(copyRichText(oldOption.getExplanationTextData()));
                    }
                    newOptions.add(newOption);
                }
                newQuestionSlide.setOptions(newOptions);
            }
            // correctAnswers references option ids, which just changed.
            if (StringUtils.hasText(newQuestionSlide.getAutoEvaluationJson()) && !optionIdMap.isEmpty()) {
                newQuestionSlide
                        .setAutoEvaluationJson(remapOptionIdsInJson(newQuestionSlide.getAutoEvaluationJson(),
                                optionIdMap));
            }

            newQuestionSlide = questionSlideRepository.save(newQuestionSlide);
            return newQuestionSlide.getId();
        }
        return sourceId;
    }

    /**
     * Copy assignment slide source and return new source ID
     */
    private String copyAssignmentSlideSource(String sourceId) {
        AssignmentSlide assignmentSlide = assignmentSlideRepository.findById(sourceId).orElse(null);
        if (assignmentSlide != null) {
            AssignmentSlide newAssignmentSlide = new AssignmentSlide();
            newAssignmentSlide.setId(UUID.randomUUID().toString());
            newAssignmentSlide.setLiveDate(assignmentSlide.getLiveDate());
            newAssignmentSlide.setEndDate(assignmentSlide.getEndDate());
            newAssignmentSlide.setReAttemptCount(assignmentSlide.getReAttemptCount());
            newAssignmentSlide.setCommaSeparatedMediaIds(assignmentSlide.getCommaSeparatedMediaIds());
            // The brief, the marks and the questions used to be dropped, leaving
            // the copy an empty assignment with only its dates.
            newAssignmentSlide.setTotalMarks(assignmentSlide.getTotalMarks());
            newAssignmentSlide.setPassingMarks(assignmentSlide.getPassingMarks());
            if (assignmentSlide.getParentRichText() != null) {
                newAssignmentSlide.setParentRichText(copyRichText(assignmentSlide.getParentRichText()));
            }
            if (assignmentSlide.getTextData() != null) {
                newAssignmentSlide.setTextData(copyRichText(assignmentSlide.getTextData()));
            }

            if (assignmentSlide.getAssignmentSlideQuestions() != null) {
                List<AssignmentSlideQuestion> newQuestions = new ArrayList<>();
                for (AssignmentSlideQuestion oldQuestion : assignmentSlide.getAssignmentSlideQuestions()) {
                    AssignmentSlideQuestion newQuestion = new AssignmentSlideQuestion();
                    newQuestion.setId(UUID.randomUUID().toString());
                    newQuestion.setAssignmentSlide(newAssignmentSlide);
                    newQuestion.setQuestionType(oldQuestion.getQuestionType());
                    newQuestion.setQuestionOrder(oldQuestion.getQuestionOrder());
                    newQuestion.setStatus(oldQuestion.getStatus());
                    if (oldQuestion.getTextData() != null) {
                        newQuestion.setTextData(copyRichText(oldQuestion.getTextData()));
                    }
                    if (oldQuestion.getOptions() != null) {
                        List<AssignmentSlideQuestionOption> newOptions = new ArrayList<>();
                        for (AssignmentSlideQuestionOption oldOption : oldQuestion.getOptions()) {
                            AssignmentSlideQuestionOption newOption = new AssignmentSlideQuestionOption();
                            newOption.setId(UUID.randomUUID().toString());
                            newOption.setAssignmentSlideQuestion(newQuestion);
                            newOption.setMediaId(oldOption.getMediaId());
                            if (oldOption.getText() != null) {
                                newOption.setText(copyRichText(oldOption.getText()));
                            }
                            newOptions.add(newOption);
                        }
                        newQuestion.setOptions(newOptions);
                    }
                    newQuestions.add(newQuestion);
                }
                newAssignmentSlide.setAssignmentSlideQuestions(newQuestions);
            }

            newAssignmentSlide = assignmentSlideRepository.save(newAssignmentSlide);
            return newAssignmentSlide.getId();
        }
        return sourceId;
    }

    /**
     * Copy quiz slide source and return new source ID
     */
    private String copyQuizSlideSource(String sourceId) {
        QuizSlide quizSlide = quizSlideRepository.findById(sourceId).orElse(null);
        if (quizSlide != null) {
            QuizSlide newQuizSlide = new QuizSlide();
            newQuizSlide.setId(UUID.randomUUID().toString());
            newQuizSlide.setTitle(quizSlide.getTitle());
            newQuizSlide.setTimeLimitInMinutes(quizSlide.getTimeLimitInMinutes());
            newQuizSlide.setMarksPerQuestion(quizSlide.getMarksPerQuestion() != null ? quizSlide.getMarksPerQuestion() : 1.0);
            newQuizSlide.setNegativeMarking(quizSlide.getNegativeMarking() != null ? quizSlide.getNegativeMarking() : 0.0);
            newQuizSlide.setPassPercentage(quizSlide.getPassPercentage());
            newQuizSlide.setPartialMarking(Boolean.TRUE.equals(quizSlide.getPartialMarking()));
            newQuizSlide.setReAttemptCount(quizSlide.getReAttemptCount());
            if (quizSlide.getDescriptionRichText() != null) {
                newQuizSlide.setDescriptionRichText(copyRichText(quizSlide.getDescriptionRichText()));
            }

            // Deep-copy questions and their options
            List<QuizSlideQuestion> oldQuestions = quizSlideQuestionRepository.findByQuizSlideId(sourceId);
            if (oldQuestions != null && !oldQuestions.isEmpty()) {
                List<QuizSlideQuestion> newQuestions = new ArrayList<>();
                for (QuizSlideQuestion oldQ : oldQuestions) {
                    QuizSlideQuestion newQ = new QuizSlideQuestion();
                    newQ.setId(UUID.randomUUID().toString());
                    newQ.setQuizSlide(newQuizSlide);
                    newQ.setMediaId(oldQ.getMediaId());
                    newQ.setStatus(oldQ.getStatus());
                    newQ.setQuestionResponseType(oldQ.getQuestionResponseType());
                    newQ.setQuestionType(oldQ.getQuestionType());
                    newQ.setAccessLevel(oldQ.getAccessLevel());
                    newQ.setAutoEvaluationJson(oldQ.getAutoEvaluationJson());
                    newQ.setEvaluationType(oldQ.getEvaluationType());
                    newQ.setQuestionOrder(oldQ.getQuestionOrder());
                    newQ.setCanSkip(oldQ.getCanSkip());
                    newQ.setMarks(oldQ.getMarks());
                    newQ.setNegativeMarking(oldQ.getNegativeMarking());
                    if (oldQ.getParentRichText() != null) {
                        newQ.setParentRichText(copyRichText(oldQ.getParentRichText()));
                    }
                    if (oldQ.getText() != null) {
                        newQ.setText(copyRichText(oldQ.getText()));
                    }
                    if (oldQ.getExplanationText() != null) {
                        newQ.setExplanationText(copyRichText(oldQ.getExplanationText()));
                    }

                    // Deep-copy options and build old→new ID mapping
                    Map<String, String> optionIdMap = new HashMap<>();
                    if (oldQ.getQuizSlideQuestionOptions() != null) {
                        List<QuizSlideQuestionOption> newOptions = new ArrayList<>();
                        for (QuizSlideQuestionOption oldOpt : oldQ.getQuizSlideQuestionOptions()) {
                            String newOptId = UUID.randomUUID().toString();
                            optionIdMap.put(oldOpt.getId(), newOptId);
                            QuizSlideQuestionOption newOpt = new QuizSlideQuestionOption();
                            newOpt.setId(newOptId);
                            newOpt.setQuizSlideQuestion(newQ);
                            newOpt.setMediaId(oldOpt.getMediaId());
                            if (oldOpt.getText() != null) {
                                newOpt.setText(copyRichText(oldOpt.getText()));
                            }
                            if (oldOpt.getExplanationText() != null) {
                                newOpt.setExplanationText(copyRichText(oldOpt.getExplanationText()));
                            }
                            newOptions.add(newOpt);
                        }
                        newQ.setQuizSlideQuestionOptions(newOptions);
                    }

                    // Remap option IDs in autoEvaluationJson (correctAnswers references old option IDs)
                    if (StringUtils.hasText(newQ.getAutoEvaluationJson()) && !optionIdMap.isEmpty()) {
                        newQ.setAutoEvaluationJson(remapOptionIdsInJson(newQ.getAutoEvaluationJson(), optionIdMap));
                    }
                    newQuestions.add(newQ);
                }
                newQuizSlide.setQuestions(newQuestions);
            }

            newQuizSlide = quizSlideRepository.save(newQuizSlide);
            return newQuizSlide.getId();
        }
        return sourceId;
    }

    private RichTextData copyRichText(RichTextData source) {
        RichTextData copy = new RichTextData();
        copy.setType(source.getType());
        copy.setContent(source.getContent());
        return copy;
    }

    /**
     * Replaces old option IDs with new ones in autoEvaluationJson.
     * Expected format: {"correctAnswers":["old-uuid-1","old-uuid-2"]}
     */
    private String remapOptionIdsInJson(String json, Map<String, String> optionIdMap) {
        try {
            Map<String, Object> evalMap = objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
            Object correctAnswers = evalMap.get("correctAnswers");
            if (correctAnswers instanceof List<?>) {
                List<Object> remapped = new ArrayList<>();
                for (Object answer : (List<?>) correctAnswers) {
                    String answerStr = answer.toString();
                    remapped.add(optionIdMap.getOrDefault(answerStr, answerStr));
                }
                evalMap.put("correctAnswers", remapped);
            }
            return objectMapper.writeValueAsString(evalMap);
        } catch (Exception e) {
            log.warn("Failed to remap option IDs in autoEvaluationJson: {}", e.getMessage());
            return json;
        }
    }

    /**
     * Copy video slide question source and return new source ID
     */
    private String copyVideoSlideQuestionSource(String sourceId) {
        VideoSlideQuestion videoSlideQuestion = videoSlideQuestionRepository.findById(sourceId).orElse(null);
        if (videoSlideQuestion != null) {
            VideoSlideQuestion newVideoSlideQuestion = new VideoSlideQuestion();
            newVideoSlideQuestion.setId(UUID.randomUUID().toString());
            newVideoSlideQuestion.setMediaId(videoSlideQuestion.getMediaId());
            newVideoSlideQuestion.setCanSkip(videoSlideQuestion.isCanSkip());
            newVideoSlideQuestion.setQuestionResponseType(videoSlideQuestion.getQuestionResponseType());
            newVideoSlideQuestion.setQuestionType(videoSlideQuestion.getQuestionType());
            newVideoSlideQuestion.setAccessLevel(videoSlideQuestion.getAccessLevel());
            newVideoSlideQuestion.setAutoEvaluationJson(videoSlideQuestion.getAutoEvaluationJson());
            newVideoSlideQuestion.setEvaluationType(videoSlideQuestion.getEvaluationType());
            newVideoSlideQuestion.setQuestionOrder(videoSlideQuestion.getQuestionOrder());
            newVideoSlideQuestion.setQuestionTimeInMillis(videoSlideQuestion.getQuestionTimeInMillis());
            newVideoSlideQuestion.setStatus(videoSlideQuestion.getStatus());
            // Same omission as QUESTION: text and options were left behind.
            if (videoSlideQuestion.getParentRichText() != null) {
                newVideoSlideQuestion.setParentRichText(copyRichText(videoSlideQuestion.getParentRichText()));
            }
            if (videoSlideQuestion.getTextData() != null) {
                newVideoSlideQuestion.setTextData(copyRichText(videoSlideQuestion.getTextData()));
            }
            if (videoSlideQuestion.getExplanationTextData() != null) {
                newVideoSlideQuestion
                        .setExplanationTextData(copyRichText(videoSlideQuestion.getExplanationTextData()));
            }

            Map<String, String> optionIdMap = new HashMap<>();
            if (videoSlideQuestion.getOptions() != null) {
                List<VideoSlideQuestionOption> newOptions = new ArrayList<>();
                for (VideoSlideQuestionOption oldOption : videoSlideQuestion.getOptions()) {
                    String newOptionId = UUID.randomUUID().toString();
                    optionIdMap.put(oldOption.getId(), newOptionId);
                    VideoSlideQuestionOption newOption = new VideoSlideQuestionOption();
                    newOption.setId(newOptionId);
                    newOption.setVideoSlideQuestion(newVideoSlideQuestion);
                    newOption.setMediaId(oldOption.getMediaId());
                    if (oldOption.getText() != null) {
                        newOption.setText(copyRichText(oldOption.getText()));
                    }
                    if (oldOption.getExplanationTextData() != null) {
                        newOption.setExplanationTextData(copyRichText(oldOption.getExplanationTextData()));
                    }
                    newOptions.add(newOption);
                }
                newVideoSlideQuestion.setOptions(newOptions);
            }
            if (StringUtils.hasText(newVideoSlideQuestion.getAutoEvaluationJson()) && !optionIdMap.isEmpty()) {
                newVideoSlideQuestion.setAutoEvaluationJson(
                        remapOptionIdsInJson(newVideoSlideQuestion.getAutoEvaluationJson(), optionIdMap));
            }

            newVideoSlideQuestion = videoSlideQuestionRepository.save(newVideoSlideQuestion);
            return newVideoSlideQuestion.getId();
        }
        return sourceId;
    }

    /**
     * Copy html video slide source and return new source ID
     */
    private String copyHtmlVideoSlideSource(String sourceId) {
        HtmlVideoSlide htmlVideoSlide = htmlVideoSlideRepository.findById(sourceId).orElse(null);
        if (htmlVideoSlide != null) {
            HtmlVideoSlide newSlide = new HtmlVideoSlide();
            newSlide.setId(UUID.randomUUID().toString());
            newSlide.setAiGenVideoId(htmlVideoSlide.getAiGenVideoId());
            newSlide.setUrl(htmlVideoSlide.getUrl());
            newSlide.setVideoLengthInMillis(htmlVideoSlide.getVideoLengthInMillis());
            newSlide.setCodeEditorConfig(htmlVideoSlide.getCodeEditorConfig());
            newSlide = htmlVideoSlideRepository.save(newSlide);
            return newSlide.getId();
        }
        return sourceId;
    }

    /**
     * Copy scorm slide source and return new source ID
     */
    private String copyScormSlideSource(String sourceId) {
        ScormSlide scormSlide = scormSlideRepository.findById(sourceId).orElse(null);
        if (scormSlide != null) {
            ScormSlide newSlide = new ScormSlide();
            newSlide.setId(UUID.randomUUID().toString());
            newSlide.setOriginalFileId(scormSlide.getOriginalFileId());
            newSlide.setLaunchPath(scormSlide.getLaunchPath());
            newSlide.setLaunchUrl(scormSlide.getLaunchUrl());
            newSlide.setScormVersion(scormSlide.getScormVersion());
            newSlide = scormSlideRepository.save(newSlide);
            return newSlide.getId();
        }
        return sourceId;
    }

    private String copyAssessmentSlideSource(String sourceId) {
        AssessmentSlide existing = assessmentSlideRepository.findById(sourceId).orElse(null);
        if (existing != null) {
            AssessmentSlide newSlide = new AssessmentSlide();
            newSlide.setId(UUID.randomUUID().toString());
            newSlide.setAssessmentId(existing.getAssessmentId());
            newSlide.setAllowReattempt(existing.getAllowReattempt());
            newSlide.setShowResult(existing.getShowResult());
            newSlide = assessmentSlideRepository.save(newSlide);
            return newSlide.getId();
        }
        return sourceId;
    }

    public String saveSlide(String slideId, String sourceId, String sourceType, String status, String title,
            String description, String imageFileId, Integer slideOrder, String chapterId) {
        Slide slide = new Slide();
        slide.setId(slideId);
        slide.setSourceId(sourceId);
        slide.setSourceType(sourceType);
        slide.setStatus(status);
        slide.setTitle(title);
        slide.setDescription(description);
        slide.setImageFileId(imageFileId);
        if (status.equalsIgnoreCase(SlideStatus.PUBLISHED.name())) {
            slide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
        }
        slide = slideRepository.save(slide);
        saveChapterSlideMapping(chapterId, slide, slideOrder, status);
        // Every slide type's "add" path funnels through here — a new published slide
        // changes the offline manifest for this chapter.
        bumpOfflineManifest(chapterId, status, "SLIDE_ADDED");
        contentIndexMarker.mark(slide.getId(), chapterId, "SLIDE_ADDED");
        return slide.getId();
    }

    public void saveChapterSlideMapping(String chapterId, Slide slide, Integer slideOrder, String status) {
        Chapter chapter = chapterRepository.findById(chapterId)
                .orElseThrow(() -> new VacademyException("Chapter not found"));
        ChapterToSlides chapterToSlides = chapterToSlidesRepository
                .save(new ChapterToSlides(chapter, slide, slideOrder, status));
    }

    public void updateChapterToSlideMapping(String chapterId, String slideId, Integer slideOrder, String status) {
        ChapterToSlides chapterToSlides = chapterToSlidesRepository.findByChapterIdAndSlideId(chapterId, slideId)
                .orElseThrow(() -> new VacademyException("Chapter to slide mapping not found!!!"));
        if (slideOrder != null) {
            chapterToSlides.setSlideOrder(slideOrder);
        }
        if (StringUtils.hasText(status)) {
            chapterToSlides.setStatus(status);
        }
        chapterToSlidesRepository.save(chapterToSlides);
    }

    public Slide updateSlide(String slideId, String status, String title, String description, String imageFileId,
            Integer slideOrder, String chapterId, String packageSessionId, String moduleId, String subjectId) {

        Slide slide = slideRepository.findById(slideId).orElseThrow(() -> new VacademyException("Slide not found!!!"));

        if (StringUtils.hasText(slideId)) {
            slide.setId(slideId);
        }
        if (StringUtils.hasText(status)) {
            slide.setStatus(status);
            if (status.equalsIgnoreCase(SlideStatus.PUBLISHED.name())) {
                slide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
            }
        }
        if (StringUtils.hasText(title)) {
            slide.setTitle(title);
        }
        if (StringUtils.hasText(description)) {
            slide.setDescription(description);
        }
        if (StringUtils.hasText(imageFileId)) {
            slide.setImageFileId(imageFileId);
        }
        slide = slideRepository.save(slide);
        updateChapterToSlideMapping(chapterId, slide.getId(), slideOrder, status);
        learnerTrackingAsyncService.updateLearnerOperationsForBatch("SLIDE", slide.getId(), slide.getSourceType(),
                chapterId, moduleId, subjectId, packageSessionId);
        // Shared edit path for question/quiz/assignment/audio slides — the content a
        // learner already downloaded just changed.
        bumpOfflineManifest(chapterId, status, "SLIDE_UPDATED");
        // Quiz / HTML-video / question edits reach the tutor through this path:
        // the compiled teaching plan (and its answer key) is now behind.
        teachingPlanStaleMarker.markStaleIfPublished(slide.getId(), status);
        contentIndexMarker.mark(slide.getId(), chapterId, "SLIDE_UPDATED");
        return slide;
    }

    public List<SlideDTO> getSlides(String chapterId) {
        // Resolved request locale (?lang > Accept-Language > JWT claim > en, set by
        // LocaleResolutionFilter). For 'en' no translation rows match and the
        // COALESCEs fall back to canonical content — identical to pre-i18n output.
        String lang = vacademy.io.common.core.i18n.LocaleRegistry.normalize(
                org.springframework.context.i18n.LocaleContextHolder.getLocale().toLanguageTag());
        // Fetch JSON response from repository
        String jsonSlides = slideRepository.getSlidesByChapterId(
                chapterId,
                List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name(), SlideStatus.DRAFT.name()),
                List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name(), SlideStatus.DRAFT.name()),
                List.of(QuestionStatusEnum.ACTIVE.name()), // Added missing closing parenthesis here
                lang
        );

        // Map the JSON to List<SlideDTO>
        return mapToSlideDTOList(jsonSlides);
    }

    public SlideDTO getSlideDTOById(String slideId) {
        String jsonSlides = slideRepository.getSlideBySlideId(
                slideId,
                List.of(QuestionStatusEnum.ACTIVE.name())
        );
        List<SlideDTO> slides = mapToSlideDTOList(jsonSlides);
        if (slides.isEmpty()) {
            throw new VacademyException("Slide not found");
        }
        return slides.get(0);
    }

    public List<SlideDTO> mapToSlideDTOList(String jsonSlides) {
        if (!StringUtils.hasText(jsonSlides)) {
            return List.of();
        }
        try {
            return objectMapper.readValue(jsonSlides, new TypeReference<List<SlideDTO>>() {
            });
        } catch (Exception e) {
            throw new VacademyException("Unable to map to SlideDTO list: " + e.getMessage());
        }
    }

    public List<SlideTypeReadTimeProjection> getSlideCountsBySourceType(
            String sessionId) {
        return slideRepository.getSlideReadTimeSummaryBySourceType(
                sessionId,
                ValidStatusListConstants.ACTIVE_SUBJECTS,
                ValidStatusListConstants.ACTIVE_MODULES,
                ValidStatusListConstants.ACTIVE_CHAPTERS,
                ValidStatusListConstants.VALID_SLIDE_STATUSES,
                ValidStatusListConstants.ACTIVE_CHAPTERS,
                ValidStatusListConstants.VALID_QUESTION_STATUSES,
                ValidStatusListConstants.VALID_QUESTION_STATUSES);
    }

    public List<SlideTypeReadTimeProjection> getSlideCountsBySourceTypeForLearner(
            String sessionId) {
        return slideRepository.getSlideReadTimeSummaryBySourceTypeForLearner(
                sessionId,
                ValidStatusListConstants.ACTIVE_SUBJECTS,
                ValidStatusListConstants.ACTIVE_MODULES,
                ValidStatusListConstants.ACTIVE_CHAPTERS,
                ValidStatusListConstants.VALID_LEARNER_STATUSES,
                ValidStatusListConstants.ACTIVE_CHAPTERS,
                ValidStatusListConstants.VALID_SLIDE_STATUSES_FOR_LEARNER,
                ValidStatusListConstants.VALID_QUESTION_STATUSES);
    }

    public Double calculateTotalReadTimeInMinutes(String packageSessionId) {
        return slideRepository.calculateTotalReadTimeInMinutes(packageSessionId,
                List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()), List.of(StatusEnum.ACTIVE.name()),
                List.of(StatusEnum.ACTIVE.name()));
    }

    /**
     * Batch method to calculate read times for multiple package sessions at once.
     * This eliminates the N+1 query problem.
     * 
     * @param packageSessionIds List of package session IDs
     * @return Map of package session ID to read time in minutes
     */
    /**
     * Pure function of packageSessionIds (the three status lists below are
     * constants), which is why it is safe to cache without any user or institute
     * scoping. It is the expensive half of the institute-details payload: every
     * call re-aggregates slide read times across every batch, and the authenticated
     * /institute/v1/details endpoint is uncached and fires on each dashboard load.
     *
     * Keyed on the list's toString rather than the hashCode idiom used by the
     * caches in UserResolutionService: the key is longer, but a hash collision here
     * would serve one institute's read times for another, and a miss is cheap.
     * Order-sensitive, so a reordered list is a miss and never a wrong hit.
     *
     * Only ever called from other beans (InstituteInitManager), so the cache proxy
     * actually applies -- a self-invocation from inside SlideService would silently
     * bypass it.
     *
     * Guarded with condition rather than unless. Spring evaluates condition BEFORE
     * the key, so a null argument skips the cache entirely and reaches the method's
     * own null check; with only an unless clause the key expression would run first
     * and throw SpelEvaluationException on null.toString(), making that check dead.
     *
     * An EMPTY result is deliberately cacheable: an institute with batches but no
     * published slides legitimately aggregates to nothing, and excluding it via
     * unless would re-run this query on every dashboard load for exactly the
     * cold-start tenants the cache is meant to help.
     *
     * Staleness is bounded only by the 2m TTL -- there is no eviction hook on slide
     * publish, so a newly published slide can take up to 2 minutes to move a batch's
     * displayed duration.
     */
    @org.springframework.cache.annotation.Cacheable(value = "packageSessionReadTimes", key = "#packageSessionIds.toString()", condition = "#packageSessionIds != null && !#packageSessionIds.isEmpty()")
    public Map<String, Double> calculateReadTimesForPackageSessions(List<String> packageSessionIds) {
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return Map.of();
        }

        List<vacademy.io.admin_core_service.features.slide.dto.PackageSessionReadTimeProjection> results = slideRepository
                .calculateReadTimesForPackageSessions(
                        packageSessionIds,
                        List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name()),
                        List.of(StatusEnum.ACTIVE.name()),
                        List.of(StatusEnum.ACTIVE.name()));

        return results.stream()
                .collect(Collectors.toMap(
                        vacademy.io.admin_core_service.features.slide.dto.PackageSessionReadTimeProjection::getPackageSessionId,
                        vacademy.io.admin_core_service.features.slide.dto.PackageSessionReadTimeProjection::getReadTimeInMinutes));
    }
}