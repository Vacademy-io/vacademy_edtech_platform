package vacademy.io.admin_core_service.features.learner_tracking.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizLoader;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizQuestionFeedbackDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizSideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuizSlideQuestionTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuizSlideQuestionTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestion;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestionOption;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionOptionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class QuizSlideActivityLogService {

    private final QuizSlideQuestionTrackedRepository quizSlideTrackedRepositry;
    private final ActivityLogRepository activityLogRepository;
    private final ActivityLogService activityLogService;
    private final LearnerTrackingAsyncService learnerTrackingAsyncService;
    private final QuizSlideQuestionRepository quizSlideQuestionRepository;
    private final QuizSlideQuestionOptionRepository quizSlideQuestionOptionRepository;
    private final AutoEvaluationScorer autoEvaluationScorer;
    private final QuizLoader quizLoader;
    private final QuizGrader quizGrader;

    public void addQuizSlideActivityLog(ActivityLog activityLog, List<QuizSideActivityLogDTO> quizSideActivityLogDTOS) {
        quizSlideTrackedRepositry.deleteByActivityId(activityLog.getId());
        List<QuizSlideQuestionTracked> questionSlideTrackeds = quizSideActivityLogDTOS
                .stream()
                .map(quizSideActivityLogDTO -> new QuizSlideQuestionTracked(quizSideActivityLogDTO, activityLog))
                .toList();
        quizSlideTrackedRepositry.saveAll(questionSlideTrackeds);
    }

    public String addOrUpdateQuizSlideActivityLog(ActivityLogDTO activityLogDTO,
            String slideId,
            String chapterId,
            String moduleId,
            String subjectId,
            String packageSessionId,
            String userId,
            CustomUserDetails user) {
        // Identity comes from the token, never from the userId request param —
        // a learner could otherwise submit (or overwrite) as someone else.
        ActivityLog activityLog = null;
        if (activityLogDTO.isNewActivity()) {
            activityLog = activityLogService.saveActivityLog(activityLogDTO, user.getUserId(), slideId);
        } else {
            activityLog = activityLogService.updateActivityLog(activityLogDTO, user.getUserId());
        }
        // Grade on the server before anything is persisted. The DTOs are mutated in
        // place, so the tracked rows, the learner-operation update and the LLM raw JSON
        // all see the same authoritative verdict.
        applyServerSideScoring(activityLogDTO.getQuizSides());
        regradeRecordedMarks(slideId, activityLogDTO.getQuizSides());
        addQuizSlideActivityLog(activityLog, activityLogDTO.getQuizSides());
        learnerTrackingAsyncService.updateLearnerOperationsForQuiz(user.getUserId(), slideId, chapterId, moduleId,
                subjectId, packageSessionId, activityLogDTO);

        // Save raw data for LLM analytics (async, non-blocking)
        learnerTrackingAsyncService.saveLLMQuizDataAsync(
                activityLog.getId(),
                slideId,
                chapterId,
                packageSessionId,
                subjectId,
                activityLogDTO);

        return activityLog.getId();
    }

    /**
     * Recompute {@code response_status} from the stored answer key.
     *
     * <p>The quiz viewer grades client-side (the key ships with the questions so feedback
     * is instant) and its main "Finish" path sent the placeholder {@code "SUBMITTED"} for
     * every question, so no quiz answer was ever recorded as CORRECT. Everything reading
     * the column downstream - LLM analytics, marks-by-subject, pulse - read that as a
     * score of zero. Grading here makes the server the source of truth and also closes
     * the hole where a learner could simply post {@code "CORRECT"} for every question.
     *
     * <p>Questions the scorer cannot grade (free text, manual evaluation, an unrecognised
     * key) keep whatever the client sent.
     */
    private void applyServerSideScoring(List<QuizSideActivityLogDTO> quizSides) {
        if (quizSides == null || quizSides.isEmpty()) {
            return;
        }
        try {
            List<String> questionIds = quizSides.stream()
                    .filter(q -> q != null && q.getQuestionId() != null)
                    .map(QuizSideActivityLogDTO::getQuestionId)
                    .distinct()
                    .toList();
            if (questionIds.isEmpty()) {
                return;
            }
            Map<String, QuizSlideQuestion> questions = quizSlideQuestionRepository.findAllById(questionIds)
                    .stream()
                    .collect(Collectors.toMap(QuizSlideQuestion::getId, q -> q, (a, b) -> a));

            // Option ids are only needed for the older index-based answer keys, and only
            // once per question even when a learner has several responses to it.
            Map<String, List<String>> optionIdCache = new HashMap<>();

            for (QuizSideActivityLogDTO side : quizSides) {
                if (side == null || side.getQuestionId() == null) {
                    continue;
                }
                QuizSlideQuestion question = questions.get(side.getQuestionId());
                if (question == null) {
                    continue;
                }
                AutoEvaluationScorer.Verdict verdict = autoEvaluationScorer.evaluate(
                        question.getAutoEvaluationJson(),
                        side.getResponseJson(),
                        () -> optionIdCache.computeIfAbsent(question.getId(), this::optionIdsInOrder));
                if (verdict != AutoEvaluationScorer.Verdict.UNKNOWN) {
                    side.setResponseStatus(verdict.name());
                }
            }
        } catch (Exception e) {
            // Scoring must never cost a learner their submission.
            log.error("Server-side quiz scoring failed; falling back to client-reported status", e);
        }
    }

    /**
     * The marks inside response_json, which the review screen and activity dialog read, get
     * the same treatment as the status above. Only clients that still grade locally post
     * here, and each row says so, which is how they are counted before this endpoint retires.
     * The AI tutor is the exception: see below.
     */
    private void regradeRecordedMarks(String slideId, List<QuizSideActivityLogDTO> quizSides) {
        if (slideId == null || quizSides == null || quizSides.isEmpty()) {
            return;
        }
        try {
            QuizLoader.LoadedQuiz quiz = quizLoader.load(slideId).orElse(null);
            if (quiz == null) {
                return;
            }
            Map<String, QuizGrader.Question> questions = quiz.questions().stream()
                    .collect(Collectors.toMap(QuizGrader.Question::id, q -> q, (a, b) -> a));
            for (QuizSideActivityLogDTO side : quizSides) {
                QuizGrader.Question question = side == null ? null : questions.get(side.getQuestionId());
                // The AI tutor posts here too, with its own judgement of spoken and typed
                // answers and the words the learner used. Nothing here can redo that.
                if (question == null || quizGrader.isTutorRecord(side.getResponseJson())) {
                    continue;
                }
                QuizGrader.Graded graded = quizGrader.regrade(question, quiz.rules(), side.getResponseJson(),
                        QuizGrader.GRADED_BY_LEGACY);
                if (graded != null) {
                    side.setResponseJson(graded.responseJson());
                    side.setResponseStatus(graded.responseStatus());
                }
            }
        } catch (Exception e) {
            // Marking must never cost a learner their submission.
            log.error("Server-side quiz marking failed for slide {}; keeping what the client recorded", slideId, e);
        }
    }

    private List<String> optionIdsInOrder(String questionId) {
        return quizSlideQuestionOptionRepository.findByQuizSlideQuestionId(questionId)
                .stream()
                .map(QuizSlideQuestionOption::getId)
                .toList();
    }

    public Page<ActivityLogDTO> getQuizSlideActivityLog(String userId, String slideId, Pageable pageable,
            CustomUserDetails userDetails) {
        Page<ActivityLog> activityLogs = activityLogRepository.findActivityLogsWithQuizSlide(userId, slideId, pageable);
        return activityLogs.map(activityLog -> activityLog.toActivityLogDTO());
    }

    public String saveQuizQuestionFeedback(QuizQuestionFeedbackDTO dto) {
        if (dto.getTrackedId() == null || dto.getTrackedId().isBlank()) {
            throw new VacademyException("trackedId is required");
        }
        QuizSlideQuestionTracked tracked = quizSlideTrackedRepositry.findById(dto.getTrackedId())
                .orElseThrow(() -> new VacademyException("Quiz response not found for tracked id " + dto.getTrackedId()));
        tracked.setInstructorFeedback(dto.getInstructorFeedback());
        tracked.setInstructorFeedbackFileId(dto.getInstructorFeedbackFileId());
        quizSlideTrackedRepositry.save(tracked);
        return tracked.getId();
    }
}
