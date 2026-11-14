package vacademy.io.admin_core_service.features.learner_tracking.service;

import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.chapter.enums.ChapterStatus;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner_operation.enums.LearnerOperationEnum;
import vacademy.io.admin_core_service.features.learner_operation.enums.LearnerOperationSourceEnum;
import vacademy.io.admin_core_service.features.learner_operation.service.LearnerOperationService;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.DocumentActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.VideoActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.module.enums.ModuleStatusEnum;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.VideoSlideRepository;
import vacademy.io.admin_core_service.features.slide.service.ScormTrackingService;
import vacademy.io.admin_core_service.features.subject.enums.SubjectStatusEnum;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Slf4j
@Service
public class LearnerTrackingAsyncService {

        @Autowired
        private StudentSessionRepository studentSessionRepository;
        @Autowired
        private ActivityLogRepository activityLogRepository;
        @Autowired
        private LearnerOperationService learnerOperationService;
        @Autowired
        private VideoSlideRepository videoSlideRepository;
        @Autowired
        private vacademy.io.admin_core_service.features.slide.repository.HtmlVideoSlideRepository htmlVideoSlideRepository;
        @Autowired
        private LLMActivityAnalyticsService llmActivityAnalyticsService;
        @Autowired
        private vacademy.io.admin_core_service.features.learner_tracking.repository.AssignmentSlideTrackedRepository assignmentSlideTrackedRepository;
        @Autowired
        private vacademy.io.admin_core_service.features.slide.repository.AudioSlideRepository audioSlideRepository;
        @Autowired
        private vacademy.io.admin_core_service.features.slide.repository.ScormLearnerProgressRepository scormLearnerProgressRepository;

        // ==== Document Slide Tracking ====

        @Async
        @Transactional // Added back to fix TransactionRequiredException
        public void updateLearnerOperationsForDocument(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId,
                        ActivityLogDTO activityLogDTO) {
                int highestPage = activityLogDTO.getDocuments().stream()
                                .map(DocumentActivityLogDTO::getPageNumber)
                                .max(Integer::compareTo)
                                .orElse(0);

                Double percentageWatched = activityLogRepository.getPercentageDocumentWatched(slideId, userId);

                // Use helper for percentage logic (cap at 100, skip if null)
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_DOCUMENT_COMPLETED.name(), percentageWatched);

                // DOCUMENT_LAST_PAGE is last-write-wins: an offline sync event whose
                // clientTs is older than what's already been accepted for this
                // device+slide (offline plan, Part A4 step 2) must not regress it,
                // so OfflineSyncEventProcessor sets suppressPositionOps in that case.
                if (!activityLogDTO.isSuppressPositionOps()) {
                        learnerOperationService.deleteLearnerOperationByUserIdSourceAndSourceIdAndOperation(userId,
                                        LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                        LearnerOperationEnum.DOCUMENT_LAST_PAGE.name());
                        learnerOperationService.addOrUpdateOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                        LearnerOperationEnum.DOCUMENT_LAST_PAGE.name(), String.valueOf(highestPage));
                }

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        // ==== LLM Analytics Methods ====

        /**
         * wrapper to save quiz raw data for LLM analytics
         * Called after quiz submission to capture data without blocking the main flow
         */
        @Async
        @Transactional
        public void saveLLMQuizDataAsync(
                        String activityLogId,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId,
                        ActivityLogDTO activityLogDTO) {
                try {
                        activityLogRepository.findById(activityLogId).ifPresent(activityLog -> {
                                llmActivityAnalyticsService.saveQuizRawData(
                                                activityLog,
                                                activityLogDTO.getQuizSides(),
                                                slideId,
                                                chapterId,
                                                packageSessionId,
                                                subjectId);
                        });
                } catch (Exception e) {
                        log.error("Error saving LLM quiz data for activityLogId: {}, slideId: {}", activityLogId,
                                        slideId, e);
                }
        }

        /**
         * Async wrapper to save question raw data for LLM analytics
         */
        @Async
        @Transactional
        public void saveLLMQuestionDataAsync(
                        String activityLogId,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId,
                        ActivityLogDTO activityLogDTO) {
                try {
                        activityLogRepository.findById(activityLogId).ifPresent(activityLog -> {
                                llmActivityAnalyticsService.saveQuestionRawData(
                                                activityLog,
                                                activityLogDTO.getQuestionSlides(),
                                                slideId,
                                                chapterId,
                                                packageSessionId,
                                                subjectId);
                        });
                } catch (Exception e) {
                        log.error("Error saving LLM question data for activityLogId: {}, slideId: {}", activityLogId,
                                        slideId, e);
                }
        }

        /**
         * Async wrapper to refresh assignment raw data once it has been graded, so the
         * report is regenerated from marks and feedback rather than from a bare
         * submission. See LLMActivityAnalyticsService#refreshAssignmentRawDataAfterGrading.
         */
        @Async
        @Transactional
        public void refreshLLMAssignmentDataAfterGradingAsync(String trackedId) {
                try {
                        assignmentSlideTrackedRepository.findById(trackedId)
                                        .ifPresent(llmActivityAnalyticsService::refreshAssignmentRawDataAfterGrading);
                } catch (Exception e) {
                        log.error("Error refreshing LLM assignment data for trackedId: {}", trackedId, e);
                }
        }

        /**
         * Async wrapper to save assignment raw data for LLM analytics
         */
        @Async
        @Transactional
        public void saveLLMAssignmentDataAsync(
                        String activityLogId,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId,
                        ActivityLogDTO activityLogDTO) {
                try {
                        activityLogRepository.findById(activityLogId).ifPresent(activityLog -> {
                                llmActivityAnalyticsService.saveAssignmentRawData(
                                                activityLog,
                                                activityLogDTO.getAssignmentSlides(),
                                                slideId,
                                                chapterId,
                                                packageSessionId,
                                                subjectId);
                        });
                } catch (Exception e) {
                        log.error("Error saving LLM assignment data for activityLogId: {}, slideId: {}", activityLogId,
                                        slideId, e);
                }
        }

        @Async
        @Transactional // Added back to fix TransactionRequiredException
        public void updateLearnerOperationsForQuestion(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId,
                        ActivityLogDTO activityLogDTO) {
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_QUESTION_COMPLETED.name(), 100.0);

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        @Async
        @Transactional // Added back to fix TransactionRequiredException
        public void updateLearnerOperationsForAssignment(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId,
                        ActivityLogDTO activityLogDTO) {
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_ASSIGNMENT_COMPLETED.name(), 100.0);

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        @Async
        @Transactional // Added back to fix TransactionRequiredException
        public void updateLearnerOperationsForQuiz(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId,
                        ActivityLogDTO activityLogDTO) {
                Double percentageCompleted = activityLogRepository.getQuizSlideCompletionPercentage(slideId,
                                List.of(StatusEnum.ACTIVE.name()), userId);

                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_QUIZ_COMPLETED.name(), percentageCompleted);

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        // ==== Assessment Slide Tracking ====
        //
        // ASSESSMENT slides are marked complete as soon as the learner has
        // attempted and submitted the assessment (mirrors the ASSIGNMENT
        // pattern: submission itself is the completion signal, not a
        // percentage derived from marks/evaluation, which stays in
        // assessment_service). chapterId/moduleId/subjectId/packageSessionId
        // are optional — older frontend builds that haven't been updated to
        // send them yet still get the slide-level 100% write (which is what
        // the drip/prerequisite check reads), just without the chapter/
        // module/subject/package_session rollup cascade.
        @Async
        @Transactional
        public void updateLearnerOperationsForAssessment(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId) {
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_ASSESSMENT_DONE.name(), 100.0);

                if (chapterId != null) {
                        updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
                }
        }

        // ==== SCORM Tracking ====
        //
        // SCORM packages POST to /scorm/tracking/v1/{slideId}/commit on every
        // LMSCommit / LMSFinish (1.2) or Commit / Terminate (2004) fired by the
        // content inside the iframe. ScormTrackingService persists the row in
        // scorm_learner_progress and then calls this method with a percentage
        // already derived per SCORM 2004 spec precedence (progress_measure >
        // score.scaled > score.raw/max > completion-status fallback).
        //
        // SCORM is its own SlideTypeEnum and gets its own operation enum
        // (PERCENTAGE_SCORM_COMPLETED). Both are added to the chapter cascade
        // lists below so the rollup actually picks SCORM slides up. Before
        // this fix, source_type=SCORM was excluded from the cascade's
        // sourceTypeList entirely — SCORM completion was invisible to chapter
        // / module / subject / course percentages (B1 in the ledger).
        //
        // Slide-level monotonic guard (B9) keeps the slide at its high-water
        // mark — once a fully-completed run produces 100%, partial restarts
        // can't lower it. Rollups still overwrite freely on each cascade run.
        @Async
        @Transactional
        public void updateLearnerOperationsForScorm(String userId, String slideId, Double percentage,
                        String chapterId, String moduleId, String subjectId, String packageSessionId) {
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_SCORM_COMPLETED.name(), percentage);

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        // ==== Coding Submission Tracking ====
        //
        // Code Editor slides are stored as source_type = DOCUMENT, so they live in
        // the cascade under PERCENTAGE_DOCUMENT_COMPLETED (no new enum / no change
        // to the cascade source-type list). Question Mode submissions don't go
        // through the normal /add-or-update-document-activity path — they POST to
        // /coding/submissions which has its own table (coding_submission). This
        // method is the bridge: after CodingSubmissionService saves the row, it
        // calls this so the slide gets a learner_operation entry and the cascade
        // updates the chapter / module / subject / package_session rollups.
        //
        // Completion bar: any submission = 100%. The verdict / score / passed
        // count still live on coding_submission for admin review and learner
        // history; here we only signal "the slide has been completed." Slide-level
        // monotonic guard (B9) makes re-submits a no-op at this layer.
        @Async
        @Transactional
        public void updateLearnerOperationsForCodingSubmission(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId) {
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_DOCUMENT_COMPLETED.name(), 100.0);

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        // ==== Video Slide Tracking ====

        @Async
        @Transactional // Added back to fix TransactionRequiredException
        public void updateLearnerOperationsForVideo(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId,
                        ActivityLogDTO activityLogDTO) {
                // STEP 1: Get endTime for timestamp metric
                Long maxEndTime = activityLogDTO.getVideos().stream()
                                .map(VideoActivityLogDTO::getEndTimeInMillis)
                                .max(Long::compareTo)
                                .orElse(null);

                // STEP 2: Fetch all start-end time intervals for this slide + user
                List<Object[]> trackedTimes = activityLogRepository.getVideoTrackedIntervals(slideId, userId);
                List<VideoInterval> intervals = trackedTimes.stream()
                                .filter(row -> row[0] != null && row[1] != null) // Skip rows with null timestamps
                                .map(row -> new VideoInterval(((Timestamp) row[0]).toInstant(),
                                                ((Timestamp) row[1]).toInstant()))
                                .collect(Collectors.toCollection(ArrayList::new));

                // STEP 3: Calculate actual watched milliseconds
                long actualWatchedMillis = getUniqueWatchedDurationMillis(intervals);

                // STEP 4: Fetch published video length
                Long publishedVideoLengthMillis = videoSlideRepository.getPublishedVideoLength(slideId);

                Double percentageWatched = null;
                if (publishedVideoLengthMillis != null && publishedVideoLengthMillis > 0) {
                        percentageWatched = (actualWatchedMillis * 100.0) / publishedVideoLengthMillis;
                }

                // STEP 5: Save learner operations
                // Use helper to handle > 100 and null check
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_VIDEO_WATCHED.name(), percentageWatched);

                // VIDEO_LAST_TIMESTAMP is last-write-wins; suppressed for stale offline
                // replay (offline plan, Part A4 step 2) -- see the DOCUMENT_LAST_PAGE
                // comment above.
                if (!activityLogDTO.isSuppressPositionOps()) {
                        learnerOperationService.deleteLearnerOperationByUserIdSourceAndSourceIdAndOperation(
                                        userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                        LearnerOperationEnum.VIDEO_LAST_TIMESTAMP.name());
                        learnerOperationService.addOrUpdateOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                        LearnerOperationEnum.VIDEO_LAST_TIMESTAMP.name(), String.valueOf(maxEndTime));
                }

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        // ==== HTML Video Slide Tracking ====

        @Async
        @Transactional
        public void updateLearnerOperationsForHtmlVideo(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId,
                        ActivityLogDTO activityLogDTO) {
                // STEP 1: Get endTime for timestamp metric
                Long maxEndTime = activityLogDTO.getVideos().stream()
                                .map(VideoActivityLogDTO::getEndTimeInMillis)
                                .max(Long::compareTo)
                                .orElse(null);

                // STEP 2: Fetch all start-end time intervals for this slide + user
                List<Object[]> trackedTimes = activityLogRepository.getVideoTrackedIntervals(slideId, userId);
                List<VideoInterval> intervals = trackedTimes.stream()
                                .filter(row -> row[0] != null && row[1] != null) // Skip rows with null timestamps
                                .map(row -> new VideoInterval(((Timestamp) row[0]).toInstant(),
                                                ((Timestamp) row[1]).toInstant()))
                                .collect(Collectors.toCollection(ArrayList::new));

                // STEP 3: Calculate actual watched milliseconds
                long actualWatchedMillis = getUniqueWatchedDurationMillis(intervals);

                // STEP 4: Fetch published video length
                Long videoLength = htmlVideoSlideRepository.getVideoLength(slideId);

                Double percentageWatched = null;
                if (videoLength != null && videoLength > 0) {
                        percentageWatched = (actualWatchedMillis * 100.0) / videoLength;
                }

                // STEP 5: Save learner operations
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_VIDEO_WATCHED.name(), percentageWatched);

                if (!activityLogDTO.isSuppressPositionOps()) {
                        learnerOperationService.deleteLearnerOperationByUserIdSourceAndSourceIdAndOperation(
                                        userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                        LearnerOperationEnum.VIDEO_LAST_TIMESTAMP.name());
                        learnerOperationService.addOrUpdateOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                        LearnerOperationEnum.VIDEO_LAST_TIMESTAMP.name(), String.valueOf(maxEndTime));
                }

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        public long getUniqueWatchedDurationMillis(List<VideoInterval> intervals) {
                // Inverted segments (end < start — seek races, clock skew) would form their
                // own merged island and contribute a NEGATIVE duration, dragging the total
                // (and the resulting percentage) below reality. The engaged_ms SQL filters
                // these; this in-memory merge must too.
                intervals = intervals.stream()
                                .filter(i -> !i.end().isBefore(i.start()))
                                .collect(Collectors.toCollection(ArrayList::new));
                if (intervals.isEmpty())
                        return 0;

                intervals.sort(Comparator.comparing(VideoInterval::start));
                List<VideoInterval> merged = new ArrayList<>();

                Instant start = intervals.get(0).start();
                Instant end = intervals.get(0).end();

                for (int i = 1; i < intervals.size(); i++) {
                        VideoInterval current = intervals.get(i);
                        if (!current.start().isAfter(end)) {
                                end = end.isAfter(current.end()) ? end : current.end();
                        } else {
                                merged.add(new VideoInterval(start, end));
                                start = current.start();
                                end = current.end();
                        }
                }
                merged.add(new VideoInterval(start, end));

                return merged.stream()
                                .mapToLong(i -> Duration.between(i.start(), i.end()).toMillis())
                                .sum();
        }

        // ==== Audio Slide Tracking ====

        @Async
        @Transactional
        public void updateLearnerOperationsForAudio(String userId, String slideId, String chapterId,
                        String moduleId, String subjectId, String packageSessionId,
                        ActivityLogDTO activityLogDTO) {
                learnerOperationService.deleteLearnerOperationByUserIdSourceAndSourceIdAndOperation(
                                userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.AUDIO_LAST_TIMESTAMP.name());

                // STEP 1: Get endTime for timestamp metric
                Long maxEndTime = activityLogDTO.getAudios() != null
                                ? activityLogDTO.getAudios().stream()
                                                .map(vacademy.io.admin_core_service.features.learner_tracking.dto.AudioActivityLogDTO::getEndTimeInMillis)
                                                .filter(java.util.Objects::nonNull)
                                                .max(Long::compareTo)
                                                .orElse(null)
                                : null;

                // STEP 2: Fetch all start-end time intervals for this slide + user
                List<Object[]> trackedTimes = activityLogRepository.getAudioTrackedIntervals(slideId, userId);
                List<VideoInterval> intervals = trackedTimes.stream()
                                .filter(row -> row[0] != null && row[1] != null)
                                .map(row -> new VideoInterval(((Timestamp) row[0]).toInstant(),
                                                ((Timestamp) row[1]).toInstant()))
                                .collect(Collectors.toCollection(ArrayList::new));

                // STEP 3: Calculate actual listened milliseconds
                long actualListenedMillis = getUniqueWatchedDurationMillis(intervals);

                // STEP 4: Fetch published audio length
                Long publishedAudioLengthMillis = audioSlideRepository.getPublishedAudioLength(slideId);

                Double percentageListened = null;
                if (publishedAudioLengthMillis != null && publishedAudioLengthMillis > 0) {
                        percentageListened = (actualListenedMillis * 100.0) / publishedAudioLengthMillis;
                }

                // STEP 5: Save learner operations
                addOrUpdatePercentageOperation(userId, LearnerOperationSourceEnum.SLIDE.name(), slideId,
                                LearnerOperationEnum.PERCENTAGE_AUDIO_LISTENED.name(), percentageListened);

                if (maxEndTime != null) {
                        learnerOperationService.addOrUpdateOperation(userId, LearnerOperationSourceEnum.SLIDE.name(),
                                        slideId,
                                        LearnerOperationEnum.AUDIO_LAST_TIMESTAMP.name(), String.valueOf(maxEndTime));
                }

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        // ==== Chapter-Level Tracking ====

        // Every id here arrives from the client request. A missing one used to
        // mean the corresponding rollup quietly computed null and was dropped,
        // so the learner's slide went to 100% while the chapter (and everything
        // above it) kept its old value — indistinguishable, in the data, from
        // "nothing has happened yet". The assignment submit path sent none of
        // them at all. Log what's missing so a stuck percentage is diagnosable
        // from the service logs instead of a database forensics session.
        public void updateLearnerOperationsForChapter(String userId, String chapterId, String moduleId,
                        String subjectId, String packageSessionId) {
                if (StringUtils.hasText(chapterId)) {
                        updateChapterCompletionPercentage(userId, chapterId);
                }

                // Resolve module -> subject -> enrolled package session(s) from the
                // chapter itself rather than trusting the client to send them. The
                // client historically omitted these ids intermittently, so the module,
                // subject and package-session rollups silently computed null and were
                // dropped — the chapter advanced while the course percentage on the
                // learner's home page froze for months. Server-side resolution
                // guarantees the cascade always reaches the top, for every batch the
                // learner is enrolled in.
                List<Object[]> targets = StringUtils.hasText(chapterId)
                                ? activityLogRepository.resolveChapterRollupTargets(
                                                userId, chapterId,
                                                List.of(ChapterStatus.ACTIVE.name()),
                                                List.of(LearnerSessionStatusEnum.ACTIVE.name(),
                                                                LearnerSessionStatusEnum.INACTIVE.name()))
                                : List.of();

                if (!targets.isEmpty()) {
                        Set<String> moduleIds = new LinkedHashSet<>();
                        Set<String> subjectIds = new LinkedHashSet<>();
                        Set<String> packageSessionIds = new LinkedHashSet<>();
                        for (Object[] row : targets) {
                                if (row[0] != null) {
                                        moduleIds.add((String) row[0]);
                                }
                                if (row[1] != null) {
                                        subjectIds.add((String) row[1]);
                                }
                                if (row[2] != null) {
                                        packageSessionIds.add((String) row[2]);
                                }
                        }
                        moduleIds.forEach(id -> updateModuleCompletionPercentage(userId, id));
                        subjectIds.forEach(id -> updateSubjectCompletionPercentage(userId, id));
                        packageSessionIds.forEach(id -> updatePackageSessionCompletionPercentage(userId, id));
                        return;
                }

                // Fallback: no chapterId, or the chapter/enrollment mapping resolved
                // nothing (e.g. content not yet mapped to the learner's batch). Use
                // whatever ids the caller supplied so we never regress the previous
                // behaviour; log when they're incomplete so a stuck percentage stays
                // diagnosable from the service logs instead of a database forensics
                // session.
                if (!StringUtils.hasText(chapterId) || !StringUtils.hasText(moduleId)
                                || !StringUtils.hasText(subjectId) || !StringUtils.hasText(packageSessionId)) {
                        log.warn("Progress rollup for user {} could not resolve parents from chapterId={} and is "
                                        + "missing client ids (moduleId={}, subjectId={}, packageSessionId={}). "
                                        + "Levels without an id keep their previous percentage.",
                                        userId, chapterId, moduleId, subjectId, packageSessionId);
                }
                updateModuleCompletionPercentage(userId, moduleId);
                updateSubjectCompletionPercentage(userId, subjectId);
                updatePackageSessionCompletionPercentage(userId, packageSessionId);
        }

        private void updateChapterCompletionPercentage(String userId, String chapterId) {
                learnerOperationService.deleteLearnerOperationByUserIdSourceAndSourceIdAndOperation(userId,
                                LearnerOperationSourceEnum.CHAPTER.name(), chapterId,
                                LearnerOperationEnum.LAST_SLIDE_VIEWED.name());
                List<String> operationList = List.of(
                                LearnerOperationEnum.PERCENTAGE_VIDEO_WATCHED.name(),
                                LearnerOperationEnum.PERCENTAGE_DOCUMENT_COMPLETED.name(),
                                LearnerOperationEnum.PERCENTAGE_ASSIGNMENT_COMPLETED.name(),
                                LearnerOperationEnum.PERCENTAGE_QUESTION_COMPLETED.name(),
                                LearnerOperationEnum.PERCENTAGE_QUIZ_COMPLETED.name(),
                                LearnerOperationEnum.PERCENTAGE_AUDIO_LISTENED.name(),
                                LearnerOperationEnum.PERCENTAGE_SCORM_COMPLETED.name(),
                                LearnerOperationEnum.PERCENTAGE_ASSESSMENT_DONE.name());
                List<String> slideStatusList = List.of(
                                SlideStatus.PUBLISHED.name(),
                                SlideStatus.UNSYNC.name());

                Double chapterPercentage = activityLogRepository.getChapterCompletionPercentage(
                                userId, chapterId, operationList, slideStatusList,
                                List.of(SlideTypeEnum.VIDEO.name(), SlideTypeEnum.DOCUMENT.name(),
                                                SlideTypeEnum.ASSIGNMENT.name(),
                                                SlideTypeEnum.QUESTION.name(), SlideTypeEnum.QUIZ.name(),
                                                SlideTypeEnum.HTML_VIDEO.name(), SlideTypeEnum.AUDIO.name(),
                                                SlideTypeEnum.SCORM.name(), SlideTypeEnum.ASSESSMENT.name()));

                addOrUpdatePercentageOperation(
                                userId,
                                LearnerOperationSourceEnum.CHAPTER.name(),
                                chapterId,
                                LearnerOperationEnum.PERCENTAGE_CHAPTER_COMPLETED.name(),
                                chapterPercentage);

                activityLogRepository
                                .findLatestWatchedSlideIdForChapter(userId, chapterId, slideStatusList, slideStatusList)
                                .ifPresent(slideId -> learnerOperationService.addOrUpdateOperation(
                                                userId,
                                                LearnerOperationSourceEnum.CHAPTER.name(),
                                                chapterId,
                                                LearnerOperationEnum.LAST_SLIDE_VIEWED.name(),
                                                slideId));
        }

        // ==== Module-Level Tracking ====

        public void updateModuleCompletionPercentage(String userId, String moduleId) {
                Double percentage = activityLogRepository.getModuleCompletionPercentage(
                                userId,
                                moduleId,
                                List.of(LearnerOperationEnum.PERCENTAGE_CHAPTER_COMPLETED.name()),
                                List.of(ChapterStatus.ACTIVE.name()));

                addOrUpdatePercentageOperation(
                                userId,
                                LearnerOperationSourceEnum.MODULE.name(),
                                moduleId,
                                LearnerOperationEnum.PERCENTAGE_MODULE_COMPLETED.name(),
                                percentage);
        }

        // ==== Subject-Level Tracking ====

        public void updateSubjectCompletionPercentage(String userId, String subjectId) {
                Double percentage = activityLogRepository.getSubjectCompletionPercentage(
                                userId,
                                subjectId,
                                List.of(LearnerOperationEnum.PERCENTAGE_MODULE_COMPLETED.name()),
                                List.of(ModuleStatusEnum.ACTIVE.name()),
                                List.of(ChapterStatus.ACTIVE.name()));

                addOrUpdatePercentageOperation(
                                userId,
                                LearnerOperationSourceEnum.SUBJECT.name(),
                                subjectId,
                                LearnerOperationEnum.PERCENTAGE_SUBJECT_COMPLETED.name(),
                                percentage);
        }

        // ==== Package Session-Level Tracking ====

        // This is the number the learner's home page shows for the course, so a
        // silent no-op here is the most visible failure in the whole cascade:
        // the chapter/module/subject percentages move, the course percentage
        // doesn't, and the learner reports "I finished the chapter but my
        // progress is stuck". Two ways that happened before the guards below:
        // a blank packageSessionId (client couldn't resolve the batch), or a
        // batch the learner isn't studying (multi-batch learners sent the one
        // id cached at login). Either way the query matches no subject_session
        // rows, returns null, and addOrUpdatePercentageOperation drops it —
        // leaving the previous value in place with nothing logged. Now it's
        // logged loudly enough to find in support triage.
        public void updatePackageSessionCompletionPercentage(String userId, String packageSessionId) {
                if (!StringUtils.hasText(packageSessionId)) {
                        log.warn("Skipping course-progress rollup for user {}: no packageSessionId supplied. "
                                        + "The course percentage on the learner home page will keep its previous value.",
                                        userId);
                        return;
                }

                Double percentage = activityLogRepository.getPackageSessionCompletionPercentage(
                                userId,
                                List.of(LearnerOperationEnum.PERCENTAGE_SUBJECT_COMPLETED.name()),
                                packageSessionId,
                                List.of(SubjectStatusEnum.ACTIVE.name()),
                                List.of(ModuleStatusEnum.ACTIVE.name()),
                                List.of(ChapterStatus.ACTIVE.name()));

                if (percentage == null) {
                        log.warn("Course-progress rollup produced no value for user {} / packageSession {} "
                                        + "(no active subject_session rows matched). Previous course percentage retained.",
                                        userId, packageSessionId);
                        return;
                }

                addOrUpdatePercentageOperation(
                                userId,
                                LearnerOperationSourceEnum.PACKAGE_SESSION.name(),
                                packageSessionId,
                                LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name(),
                                percentage);
        }

        // ==== Triggered Update from Slide ====

        public void updateLearnerOperationsForSlideTrigger(String userId, String slideId, String slideType,
                        String chapterId, String moduleId,
                        String subjectId, String packageSessionId) {
                Double percentageWatched;
                LearnerOperationEnum operation;
                if (SlideTypeEnum.VIDEO.name().equals(slideType)) {
                        percentageWatched = activityLogRepository.getPercentageVideoWatched(slideId, userId);
                        operation = LearnerOperationEnum.PERCENTAGE_VIDEO_WATCHED;
                } else if (SlideTypeEnum.HTML_VIDEO.name().equals(slideType)) {
                        percentageWatched = activityLogRepository.getPercentageHtmlVideoWatched(slideId, userId);
                        operation = LearnerOperationEnum.PERCENTAGE_VIDEO_WATCHED;
                } else if (SlideTypeEnum.AUDIO.name().equals(slideType)) {
                        percentageWatched = computeAudioPercentageFromBreadcrumbs(userId, slideId);
                        operation = LearnerOperationEnum.PERCENTAGE_AUDIO_LISTENED;
                } else if (SlideTypeEnum.SCORM.name().equals(slideType)) {
                        // What the package itself last reported; null (no row, or nothing
                        // derivable yet) leaves the slide without a percentage.
                        percentageWatched = scormLearnerProgressRepository
                                        .findTopByUserIdAndSlideIdOrderByAttemptNumberDesc(userId, slideId)
                                        .map(ScormTrackingService::computeScormCompletionPercentage)
                                        .orElse(null);
                        operation = LearnerOperationEnum.PERCENTAGE_SCORM_COMPLETED;
                } else {
                        // DOCUMENT and friends. (QUESTION/QUIZ/ASSIGNMENT/ASSESSMENT are
                        // recomputed by their own submit paths; a structural edit doesn't
                        // change their stored 100s.)
                        percentageWatched = activityLogRepository.getPercentageDocumentWatched(slideId, userId);
                        operation = LearnerOperationEnum.PERCENTAGE_DOCUMENT_COMPLETED;
                }

                addOrUpdatePercentageOperation(
                                userId,
                                LearnerOperationSourceEnum.SLIDE.name(),
                                slideId,
                                operation.name(),
                                percentageWatched);

                updateLearnerOperationsForChapter(userId, chapterId, moduleId, subjectId, packageSessionId);
        }

        // Same maths as the live audio path (merged breadcrumb union ÷ published
        // length); used by the structural-edit trigger, which has no fresh DTO.
        private Double computeAudioPercentageFromBreadcrumbs(String userId, String slideId) {
                List<Object[]> trackedTimes = activityLogRepository.getAudioTrackedIntervals(slideId, userId);
                List<VideoInterval> intervals = trackedTimes.stream()
                                .filter(row -> row[0] != null && row[1] != null)
                                .map(row -> new VideoInterval(((Timestamp) row[0]).toInstant(),
                                                ((Timestamp) row[1]).toInstant()))
                                .collect(Collectors.toCollection(ArrayList::new));
                long actualListenedMillis = getUniqueWatchedDurationMillis(intervals);
                Long publishedAudioLengthMillis = audioSlideRepository.getPublishedAudioLength(slideId);
                if (publishedAudioLengthMillis == null || publishedAudioLengthMillis <= 0) {
                        return null;
                }
                return (actualListenedMillis * 100.0) / publishedAudioLengthMillis;
        }

        // ==== Batch-Level Trigger ====

        @Async
        @Transactional // Added back to fix TransactionRequiredException
        public void updateLearnerOperationsForBatch(String source, String slideId, String slideType,
                        String chapterId, String moduleId,
                        String subjectId, String packageSessionId) {
                List<String> userIds = studentSessionRepository.findDistinctUserIdsByPackageSessionAndStatus(
                                packageSessionId,
                                List.of(
                                                LearnerSessionStatusEnum.ACTIVE.name(),
                                                LearnerSessionStatusEnum.INACTIVE.name()));

                switch (source) {
                        case "SLIDE":
                                userIds.forEach(userId -> updateLearnerOperationsForSlideTrigger(userId, slideId,
                                                slideType, chapterId,
                                                moduleId, subjectId, packageSessionId));
                                break;

                        // Each case must recompute the level that changed AND everything
                        // above it, up to the package session. The previous version
                        // skipped both ends: a chapter whose slide set changed was never
                        // itself recomputed (the module re-averaged stale chapter rows),
                        // and the course percentage on the learner home page was not
                        // refreshed at all for CHAPTER/MODULE edits.
                        case "CHAPTER":
                                userIds.forEach(userId -> {
                                        if (StringUtils.hasText(chapterId)) {
                                                updateChapterCompletionPercentage(userId, chapterId);
                                        }
                                        updateModuleCompletionPercentage(userId, moduleId);
                                        updateSubjectCompletionPercentage(userId, subjectId);
                                        updatePackageSessionCompletionPercentage(userId, packageSessionId);
                                });
                                break;

                        case "MODULE":
                                userIds.forEach(userId -> {
                                        updateModuleCompletionPercentage(userId, moduleId);
                                        updateSubjectCompletionPercentage(userId, subjectId);
                                        updatePackageSessionCompletionPercentage(userId, packageSessionId);
                                });
                                break;

                        case "SUBJECT":
                                userIds.forEach(userId -> {
                                        updateSubjectCompletionPercentage(userId, subjectId);
                                        updatePackageSessionCompletionPercentage(userId, packageSessionId);
                                });
                                break;

                        default:
                                throw new IllegalArgumentException("Unknown source type: " + source);
                }
        }

        // ==== Private Helper for Percentage Operations ====

        /**
         * Saves a percentage operation with these rules:
         * 1. If value is null, do nothing.
         * 2. If value > 100, save as 100.
         * 3. Monotonic guard at SLIDE level only: never lower a previously-recorded
         *    slide percentage. A learner re-opening a PDF (or scrubbing back in a
         *    video) must not see their per-slide progress drop because of a stale
         *    re-computation.
         *
         *    The guard is intentionally NOT applied at rollup levels (CHAPTER,
         *    MODULE, SUBJECT, PACKAGE_SESSION). Rollups are aggregates over
         *    potentially-changing structure (new slides added to a chapter, new
         *    chapters added to a module, etc.). If we kept rollups monotonic, any
         *    content edit that legitimately lowers an aggregate would permanently
         *    freeze the old higher value, and the displayed course % would diverge
         *    from the actual chapter/module math forever.
         */
        private void addOrUpdatePercentageOperation(String userId, String source, String sourceId, String operation,
                        Double value) {
                if (value == null) {
                        return;
                }
                if (value > 100.0) {
                        value = 100.0;
                }

                if (LearnerOperationSourceEnum.SLIDE.name().equals(source)) {
                        Double existing = learnerOperationService
                                        .findDoubleValueByUserIdSourceAndSourceIdAndOperation(userId, source, sourceId,
                                                        operation)
                                        .orElse(null);
                        if (existing != null && existing >= value) {
                                return;
                        }
                }

                learnerOperationService.addOrUpdateOperation(userId, source, sourceId, operation,
                                String.valueOf(value));
        }

        public record VideoInterval(Instant start, Instant end) {
        }
}
