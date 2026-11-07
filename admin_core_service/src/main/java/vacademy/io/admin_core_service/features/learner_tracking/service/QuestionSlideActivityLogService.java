package vacademy.io.admin_core_service.features.learner_tracking.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuestionSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuestionSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.entity.Option;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Optional;

@Service
@Slf4j
@RequiredArgsConstructor
public class QuestionSlideActivityLogService {

    private final QuestionSlideTrackedRepository questionSlideTrackedRepository;
    private final ActivityLogRepository activityLogRepository;
    private final ActivityLogService activityLogService;
    private final LearnerTrackingAsyncService learnerTrackingAsyncService;
    private final SlideRepository slideRepository;
    private final QuestionSlideRepository questionSlideRepository;
    private final AutoEvaluationScorer autoEvaluationScorer;
    private final AnswerKeyAccess answerKeyAccess;

    public void addQuestionSlideActivityLog(ActivityLog activityLog,
            List<QuestionSlideActivityLogDTO> questionSlideActivityLogDTOS) {
        questionSlideTrackedRepository.deleteByActivityId(activityLog.getId());
        List<QuestionSlideTracked> questionSlideTrackeds = questionSlideActivityLogDTOS
                .stream()
                .map(questionSlideActivityLogDTO -> new QuestionSlideTracked(questionSlideActivityLogDTO, activityLog))
                .toList();
        questionSlideTrackedRepository.saveAll(questionSlideTrackeds);
    }

    public String addOrUpdateQuestionSlideActivityLog(ActivityLogDTO activityLogDTO, String slideId, String chapterId,
            String packageSessionId, String moduleId, String subjectId, String userId, CustomUserDetails user) {
        // Identity comes from the token, never from the userId request param —
        // a learner could otherwise submit (or overwrite) as someone else.
        ActivityLog activityLog = null;
        if (activityLogDTO.isNewActivity()) {
            activityLog = activityLogService.saveActivityLog(activityLogDTO, user.getUserId(), slideId);
        } else {
            activityLog = activityLogService.updateActivityLog(activityLogDTO, user.getUserId());
        }
        // Grade before persisting: the learner app posts a placeholder status of
        // "SUBMITTED" with marks 0 for every question-slide answer, so without this the
        // tracked row records neither correctness nor a score.
        applyServerSideScoring(slideId, activityLogDTO.getQuestionSlides());
        addQuestionSlideActivityLog(activityLog, activityLogDTO.getQuestionSlides());
        learnerTrackingAsyncService.updateLearnerOperationsForQuestion(user.getUserId(), slideId, chapterId, moduleId,
                subjectId, packageSessionId, activityLogDTO);

        // Save raw data for LLM analytics (async, non-blocking)
        learnerTrackingAsyncService.saveLLMQuestionDataAsync(
                activityLog.getId(),
                slideId,
                chapterId,
                packageSessionId,
                subjectId,
                activityLogDTO);

        return activityLog.getId();
    }

    /**
     * Recompute {@code response_status} and {@code marks} for a question slide from the
     * stored answer key. See {@link AutoEvaluationScorer} for why the client's values
     * cannot be trusted; questions the scorer cannot grade keep what the client sent.
     */
    private void applyServerSideScoring(String slideId, List<QuestionSlideActivityLogDTO> questionSlides) {
        if (slideId == null || questionSlides == null || questionSlides.isEmpty()) {
            return;
        }
        try {
            Optional<Slide> slide = slideRepository.findById(slideId);
            if (slide.isEmpty() || slide.get().getSourceId() == null) {
                return;
            }
            Optional<QuestionSlide> questionOpt = questionSlideRepository.findByIdWithText(slide.get().getSourceId());
            if (questionOpt.isEmpty()) {
                return;
            }
            QuestionSlide question = questionOpt.get();
            List<String> optionIds = question.getOptions() == null
                    ? List.of()
                    : question.getOptions().stream().map(Option::getId).toList();
            double points = question.getPoints() == null ? 0.0 : question.getPoints();

            for (QuestionSlideActivityLogDTO attempt : questionSlides) {
                if (attempt == null) {
                    continue;
                }
                AutoEvaluationScorer.Verdict verdict = autoEvaluationScorer.evaluate(
                        question.getAutoEvaluationJson(), attempt.getResponseJson(), () -> optionIds);
                if (verdict == AutoEvaluationScorer.Verdict.UNKNOWN) {
                    continue;
                }
                attempt.setResponseStatus(verdict.name());
                attempt.setMarks(verdict == AutoEvaluationScorer.Verdict.CORRECT ? points : 0.0);
            }
        } catch (Exception e) {
            // Scoring must never cost a learner their submission.
            log.error("Server-side question-slide scoring failed for slide {}; "
                    + "falling back to client-reported status", slideId, e);
        }
    }

    public Page<ActivityLogDTO> getQuestionSlideActivityLogs(String userId, String slideId, Pageable pageable,
            CustomUserDetails userDetails) {
        Page<ActivityLog> activityLogs = activityLogRepository.findActivityLogsWithQuestionSlides(userId, slideId,
                pageable);
        return activityLogs.map(activityLog -> answerKeyAccess.withoutQuizSidesWhenStripping(activityLog.toActivityLogDTO()));
    }
}
