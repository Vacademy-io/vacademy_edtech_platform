package vacademy.io.admin_core_service.features.learner_tracking.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_operation.enums.LearnerOperationEnum;
import vacademy.io.admin_core_service.features.learner_operation.enums.LearnerOperationSourceEnum;
import vacademy.io.admin_core_service.features.learner_operation.service.LearnerOperationService;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.DocumentActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.VideoActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.DocumentTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.VideoTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.AudioTrackedRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ActivityLogAccessDeniedException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.sql.Timestamp;
import java.util.Objects;

@Slf4j
@Service
public class LearnerTrackingService {

    private final ActivityLogRepository activityLogRepository;
    private final DocumentTrackedRepository documentTrackedRepository;
    private final VideoTrackedRepository videoTrackedRepository;
    private final AudioTrackedRepository audioTrackedRepository;
    private final LearnerOperationService learnerOperationService;
    private final LearnerTrackingAsyncService learnerTrackingAsyncService;
    private final ConcentrationScoreService concentrationScoreService;

    @Autowired
    public LearnerTrackingService(
            ActivityLogRepository activityLogRepository,
            DocumentTrackedRepository documentTrackedRepository,
            VideoTrackedRepository videoTrackedRepository,
            AudioTrackedRepository audioTrackedRepository,
            LearnerOperationService learnerOperationService,
            LearnerTrackingAsyncService learnerTrackingAsyncService,
            ConcentrationScoreService concentrationScoreService) {
        this.activityLogRepository = activityLogRepository;
        this.documentTrackedRepository = documentTrackedRepository;
        this.videoTrackedRepository = videoTrackedRepository;
        this.audioTrackedRepository = audioTrackedRepository;
        this.learnerOperationService = learnerOperationService;
        this.learnerTrackingAsyncService = learnerTrackingAsyncService;
        this.concentrationScoreService = concentrationScoreService;
    }

    /**
     * Defer a rollup until the current transaction has actually committed.
     *
     * The rollups in LearnerTrackingAsyncService are @Async: they re-read the
     * very breadcrumb rows this request just wrote (video_tracked /
     * document_tracked / audio_tracked) from a different thread, in their own
     * transaction. Called inline they start while this transaction is still
     * open, so those rows are invisible to them and the slide gets scored from
     * previously committed requests only — a learner's first viewing session
     * counted as 0% and only caught up when they watched again. Worst on Vimeo,
     * whose player sends a single POST per session, so nothing ever caught up.
     *
     * No transaction in progress (the audio path) means nothing to wait for,
     * so the rollup runs as before.
     */
    private void afterCommit(Runnable rollup) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            rollup.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                // An exception thrown here propagates to whoever called commit,
                // so the request would 500 even though the learner's activity is
                // already safely committed. Dispatching a rollup is best-effort
                // (it was fire-and-forget before this indirection); a rejected
                // async task must not turn a successful write into an error.
                try {
                    rollup.run();
                } catch (RuntimeException e) {
                    log.error("Failed to dispatch learner progress rollup after commit", e);
                }
            }
        });
    }

    @Transactional
    public ActivityLogDTO addOrUpdateDocumentActivityLog(ActivityLogDTO activityLogDTO, String slideId,
            String chapterId, String packageSessionId, String moduleId, String subjectId, CustomUserDetails user) {
        activityLogDTO.setUserId(user.getUserId());
        validateActivityLogDTO(activityLogDTO, true); // Validate for documents
        ActivityLog activityLog = activityLogDTO.isNewActivity()
                ? saveActivityLog(activityLogDTO, slideId, user.getUserId())
                // getId(), not getUserId() — the latter looked up an activity by
                // the user's id, which never matches, so every non-new document
                // update threw "Activity Log not found". Latent only because the
                // web viewer always sends new_activity=true; any client that
                // doesn't would lose its page tracking entirely.
                : updateActivityLog(activityLogDTO, activityLogDTO.getId(), user.getUserId());
        saveDocumentTracking(activityLogDTO, activityLog);
        recomputeEngagedMsFromBreadcrumbs(activityLog);
        afterCommit(() -> learnerTrackingAsyncService.updateLearnerOperationsForDocument(user.getUserId(), slideId,
                chapterId, moduleId, subjectId, packageSessionId, activityLogDTO));
        concentrationScoreService.addConcentrationScore(activityLogDTO.getConcentrationScore(), activityLog);
        return activityLog.toActivityLogDTO();
    }

    @Transactional
    public ActivityLogDTO addOrUpdateVideoActivityLog(ActivityLogDTO activityLogDTO, String slideId, String chapterId,
            String moduleId, String subjectId, String packageSessionId, CustomUserDetails user) {
        validateActivityLogDTO(activityLogDTO, false); // Validate for videos
        ActivityLog activityLog = activityLogDTO.isNewActivity()
                ? saveActivityLog(activityLogDTO, slideId, user.getUserId())
                : updateActivityLog(activityLogDTO, activityLogDTO.getId(), user.getUserId());

        saveVideoTracking(activityLogDTO, activityLog);
        recomputeEngagedMsFromBreadcrumbs(activityLog);
        afterCommit(() -> learnerTrackingAsyncService.updateLearnerOperationsForVideo(user.getUserId(), slideId,
                chapterId, moduleId, subjectId, packageSessionId, activityLogDTO));
        concentrationScoreService.addConcentrationScore(activityLogDTO.getConcentrationScore(), activityLog);
        return activityLog.toActivityLogDTO();
    }

    @Transactional
    public ActivityLogDTO addOrUpdateHtmlVideoActivityLog(ActivityLogDTO activityLogDTO, String slideId,
            String chapterId, String moduleId, String subjectId, String packageSessionId, CustomUserDetails user) {
        validateActivityLogDTO(activityLogDTO, false); // Reuse validation for videos
        ActivityLog activityLog = activityLogDTO.isNewActivity()
                ? saveActivityLog(activityLogDTO, slideId, user.getUserId())
                : updateActivityLog(activityLogDTO, activityLogDTO.getId(), user.getUserId());

        saveVideoTracking(activityLogDTO, activityLog); // Reuse VideoTracking entity
        recomputeEngagedMsFromBreadcrumbs(activityLog);
        afterCommit(() -> learnerTrackingAsyncService.updateLearnerOperationsForHtmlVideo(user.getUserId(), slideId,
                chapterId, moduleId, subjectId, packageSessionId, activityLogDTO));
        concentrationScoreService.addConcentrationScore(activityLogDTO.getConcentrationScore(), activityLog);
        return activityLog.toActivityLogDTO();
    }

    // Clients send new_activity=true with an id they generated, so this save()
    // is an upsert: an id that already exists is merged, not inserted. That is
    // intended (it lets a viewer extend one activity as the learner reads), but
    // it also means a request carrying the wrong slideId would silently move an
    // existing row to another slide — taking its document_tracked page views
    // with it, since those hang off activity_id. The victim slide is then left
    // with no evidence to recompute from while the receiving slide is credited
    // with pages it never had.
    //
    // An activity belongs to the slide it was opened on. If a later request
    // disagrees, keep the original binding rather than re-parenting the row.
    private ActivityLog saveActivityLog(ActivityLogDTO activityLogDTO, String slideId, String userId) {
        if (StringUtils.hasText(activityLogDTO.getId())) {
            ActivityLog existing = activityLogRepository.findById(activityLogDTO.getId()).orElse(null);
            // Same reasoning as updateActivityLog: because this save() merges on a
            // client-supplied id, an id belonging to another learner would be
            // rewritten here — and the merge would set user_id to the caller,
            // silently transferring ownership of the row.
            if (existing != null && !Objects.equals(existing.getUserId(), userId)) {
                log.warn("User {} attempted to write activity {} owned by {}", userId, existing.getId(),
                        existing.getUserId());
                throw new ActivityLogAccessDeniedException(existing.getId());
            }
            if (existing != null && StringUtils.hasText(existing.getSlideId())
                    && !existing.getSlideId().equals(slideId)) {
                log.warn("Refusing to re-parent activity {} from slide {} to slide {} (user {}). "
                        + "Keeping the original slide; the client sent a stale slideId.",
                        existing.getId(), existing.getSlideId(), slideId, userId);
                updateActivityFields(existing, activityLogDTO);
                return activityLogRepository.save(existing);
            }
        }
        return activityLogRepository.save(new ActivityLog(activityLogDTO, userId, slideId));
    }

    // activityId is client-supplied, so the row it resolves to must be checked
    // against the caller before it is mutated — otherwise any authenticated
    // learner can rewrite another learner's start/end time and percentage
    // watched (which feed engaged time and the leaderboard) just by sending
    // their activity id. The document path could not reach this before because
    // it passed the user id as the activity id and always threw; the video and
    // audio paths always could.
    private ActivityLog updateActivityLog(ActivityLogDTO activityLogDTO, String activityId, String userId) {
        ActivityLog activityLog = activityLogRepository.findById(activityId)
                .orElseThrow(() -> new ResourceNotFoundException("Activity log " + activityId + " not found"));
        if (!Objects.equals(activityLog.getUserId(), userId)) {
            log.warn("User {} attempted to update activity {} owned by {}", userId, activityId,
                    activityLog.getUserId());
            throw new ActivityLogAccessDeniedException(activityId);
        }
        updateActivityFields(activityLog, activityLogDTO);
        return activityLogRepository.save(activityLog);
    }

    /**
     * After breadcrumbs are saved, set engaged_ms to the merged (union) breadcrumb duration -- the
     * real engaged time, instead of the wall-clock (end_time - start_time) that counted tab-open time.
     * If the activity has no breadcrumbs yet, we leave the entity's wall-clock fallback in place.
     */
    private void recomputeEngagedMsFromBreadcrumbs(ActivityLog activityLog) {
        Long engagedMs = activityLogRepository.computeEngagedMsFromBreadcrumbs(activityLog.getId());
        if (engagedMs != null) {
            // 24h per-activity ceiling: guards against inflated breadcrumbs (client idle timer failing).
            activityLog.setEngagedMs(Math.min(86_400_000L, engagedMs));
            activityLogRepository.save(activityLog);
        }
    }

    private void saveDocumentTracking(ActivityLogDTO activityLogDTO, ActivityLog activityLog) {
        if (activityLogDTO.getDocuments() == null)
            return;
        for (DocumentActivityLogDTO dto : activityLogDTO.getDocuments()) {
            if (dto == null || dto.getId() == null)
                continue;
            documentTrackedRepository.upsert(
                    dto.getId(),
                    activityLog.getId(),
                    dto.getStartTimeInMillis() != null ? new Timestamp(dto.getStartTimeInMillis()) : null,
                    dto.getEndTimeInMillis() != null ? new Timestamp(dto.getEndTimeInMillis()) : null,
                    dto.getPageNumber());
        }
    }

    private void saveVideoTracking(ActivityLogDTO activityLogDTO, ActivityLog activityLog) {
        if (activityLogDTO.getVideos() == null)
            return;
        for (VideoActivityLogDTO dto : activityLogDTO.getVideos()) {
            if (dto == null || dto.getId() == null)
                continue;
            videoTrackedRepository.upsert(
                    dto.getId(),
                    activityLog.getId(),
                    dto.getStartTimeInMillis() != null ? new Timestamp(dto.getStartTimeInMillis()) : null,
                    dto.getEndTimeInMillis() != null ? new Timestamp(dto.getEndTimeInMillis()) : null);
        }
    }

    private void updateActivityFields(ActivityLog activityLog, ActivityLogDTO activityLogDTO) {
        if (activityLogDTO.getStartTimeInMillis() != null) {
            activityLog.setStartTime(new Timestamp(activityLogDTO.getStartTimeInMillis()));
        }
        if (activityLogDTO.getEndTimeInMillis() != null) {
            activityLog.setEndTime(new Timestamp(activityLogDTO.getEndTimeInMillis()));
        }
        if (activityLogDTO.getPercentageWatched() != null) {
            activityLog.setPercentageWatched(activityLogDTO.getPercentageWatched());
        }
        // Offline sync replay (offline plan, Part A4): this entity was loaded
        // fresh via findById, so the constructor's propagation never ran --
        // without this line, an offline-replayed update would still stamp
        // last_seen_at as if the learner were online right now.
        activityLog.setOfflineReplay(activityLogDTO.isOfflineReplay());
    }

    private void validateActivityLogDTO(ActivityLogDTO dto, boolean isDocument) {
        if (Objects.isNull(dto)) {
            throw new InvalidRequestException("Activity log payload cannot be null.");
        }
        if (isDocument && Objects.isNull(dto.getDocuments())) {
            throw new InvalidRequestException("Documents cannot be null for a document activity.");
        }
        if (!isDocument && Objects.isNull(dto.getVideos())) {
            throw new InvalidRequestException("Videos cannot be null for a video activity.");
        }
    }

    public Page<ActivityLogDTO> getDocumentActivityLogs(String userId, String slideId, Pageable pageable,
            CustomUserDetails userDetails) {
        Page<ActivityLog> activityLogs = activityLogRepository.findActivityLogsWithDocuments(userId, slideId, pageable);
        return activityLogs.map(ActivityLog::toActivityLogDTO);
    }

    public Page<ActivityLogDTO> getVideoActivityLogs(String userId, String slideId, Pageable pageable,
            CustomUserDetails userDetails) {
        Page<ActivityLog> activityLogs = activityLogRepository.findActivityLogsWithVideos(userId, slideId, pageable);
        return activityLogs.map(ActivityLog::toActivityLogDTO);
    }

    // ==== Audio Tracking Methods ====

    public ActivityLogDTO addOrUpdateAudioActivityLog(ActivityLogDTO activityLogDTO, String slideId,
            String chapterId, String moduleId, String subjectId, String packageSessionId, CustomUserDetails user) {
        validateAudioActivityLogDTO(activityLogDTO);
        ActivityLog activityLog = activityLogDTO.isNewActivity()
                ? saveActivityLog(activityLogDTO, slideId, user.getUserId())
                : updateActivityLog(activityLogDTO, activityLogDTO.getId(), user.getUserId());

        saveAudioTracking(activityLogDTO, activityLog);
        recomputeEngagedMsFromBreadcrumbs(activityLog);
        afterCommit(() -> learnerTrackingAsyncService.updateLearnerOperationsForAudio(user.getUserId(), slideId,
                chapterId, moduleId, subjectId, packageSessionId, activityLogDTO));
        concentrationScoreService.addConcentrationScore(activityLogDTO.getConcentrationScore(), activityLog);
        return activityLog.toActivityLogDTO();
    }

    // Upsert per row (same as documents/videos) instead of the historical
    // delete-then-insert, which let a second tab or a retried request delete
    // segments the first request had just written.
    private void saveAudioTracking(ActivityLogDTO activityLogDTO, ActivityLog activityLog) {
        if (activityLogDTO.getAudios() == null)
            return;
        for (var dto : activityLogDTO.getAudios()) {
            if (dto == null || dto.getId() == null)
                continue;
            audioTrackedRepository.upsert(
                    dto.getId(),
                    activityLog.getId(),
                    dto.getStartTimeInMillis() != null ? new Timestamp(dto.getStartTimeInMillis()) : null,
                    dto.getEndTimeInMillis() != null ? new Timestamp(dto.getEndTimeInMillis()) : null,
                    dto.getPlaybackSpeed());
        }
    }

    private void validateAudioActivityLogDTO(ActivityLogDTO dto) {
        if (Objects.isNull(dto)) {
            throw new InvalidRequestException("Activity log payload cannot be null.");
        }
        if (Objects.isNull(dto.getAudios())) {
            throw new InvalidRequestException("Audios cannot be null for an audio activity.");
        }
    }

    public Page<ActivityLogDTO> getAudioActivityLogs(String userId, String slideId, Pageable pageable,
            CustomUserDetails userDetails) {
        Page<ActivityLog> activityLogs = activityLogRepository.findActivityLogsWithAudios(userId, slideId, pageable);
        return activityLogs.map(ActivityLog::toActivityLogDTO);
    }

    /**
     * Explicit "mark as complete" for one slide — the checkbox every mainstream
     * course player (Udemy, Coursera, LinkedIn Learning) puts beside a lesson.
     *
     * Automatic tracking stays the primary signal. This is the manual override
     * for what the heuristics cannot see: a one-page PDF read at a glance, a
     * reading the learner did on paper, a video they had already watched before
     * enrolling. Writing it through learner_operation means it feeds the exact
     * same chapter / module / subject / package_session rollups as consumption,
     * so progress bars, drip unlocks and certificates all agree.
     *
     * MARKED_AS_WATCHED records that the 100 came from the learner rather than
     * from consumption. That is what makes un-marking correct rather than
     * destructive: on the way back out the stored percentage is recomputed from
     * the real activity logs instead of being left pinned at 100 or reset to 0.
     *
     * Deliberately does NOT reuse the async cascade's
     * addOrUpdatePercentageOperation helper: that one is monotonic for slides
     * (it refuses to lower an existing value), which is right for consumption
     * events and wrong for an explicit un-mark.
     */
    @Transactional
    public boolean markSlideCompletion(String slideId, String slideType, String chapterId, String moduleId,
            String subjectId, String packageSessionId, boolean completed, CustomUserDetails user) {
        if (!StringUtils.hasText(slideId)) {
            throw new InvalidRequestException("slideId is required to mark completion.");
        }
        if (!StringUtils.hasText(slideType)) {
            throw new InvalidRequestException("slideType is required to mark completion.");
        }

        String userId = user.getUserId();
        String source = LearnerOperationSourceEnum.SLIDE.name();
        String percentageOperation = percentageOperationForSlideType(slideType);

        if (completed) {
            learnerOperationService.addOrUpdateOperation(userId, source, slideId, percentageOperation, "100.0");
            learnerOperationService.addOrUpdateOperation(userId, source, slideId,
                    LearnerOperationEnum.MARKED_AS_WATCHED.name(), "true");
            learnerTrackingAsyncService.updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId,
                    packageSessionId);
            return true;
        }

        learnerOperationService.deleteLearnerOperationByUserIdSourceAndSourceIdAndOperation(userId, source, slideId,
                LearnerOperationEnum.MARKED_AS_WATCHED.name());
        learnerOperationService.deleteLearnerOperationByUserIdSourceAndSourceIdAndOperation(userId, source, slideId,
                percentageOperation);
        // Re-derive the honest percentage from the activity logs and re-run the
        // rollups, so un-marking a slide the learner HAS partly consumed drops
        // back to that real figure rather than to zero.
        learnerTrackingAsyncService.updateLearnerOperationsForSlideTrigger(userId, slideId, slideType, chapterId,
                moduleId, subjectId, packageSessionId);
        return false;
    }

    /**
     * Which learner_operation carries "how much of this slide is done" for a
     * given slide type.
     *
     * Every type reads a DIFFERENT operation (see SlideRepository's per-type
     * UNION branches), so this cannot fall back to a default the way the
     * structural-edit trigger does: writing PERCENTAGE_DOCUMENT_COMPLETED for,
     * say, a QUIZ would leave the slide showing incomplete — its branch never
     * reads that row — while still inflating the chapter rollup, which sums
     * across all of them.
     *
     * Graded and self-reporting types are refused outright rather than mapped.
     * Completion there is earned, not declared: a quiz, question, assignment or
     * assessment completes by submission and SCORM reports its own status, so a
     * "mark as complete" button would be claiming a score the learner has not
     * got. Mainstream players draw the same line — Udemy and Coursera let you
     * tick a lecture or a reading, never a graded item.
     */
    private String percentageOperationForSlideType(String slideType) {
        if (SlideTypeEnum.VIDEO.name().equals(slideType) || SlideTypeEnum.HTML_VIDEO.name().equals(slideType)) {
            return LearnerOperationEnum.PERCENTAGE_VIDEO_WATCHED.name();
        }
        if (SlideTypeEnum.AUDIO.name().equals(slideType)) {
            return LearnerOperationEnum.PERCENTAGE_AUDIO_LISTENED.name();
        }
        if (SlideTypeEnum.DOCUMENT.name().equals(slideType)) {
            return LearnerOperationEnum.PERCENTAGE_DOCUMENT_COMPLETED.name();
        }
        throw new InvalidRequestException(
                "Slide type " + slideType + " cannot be marked complete by hand; it completes on submission.");
    }

}
