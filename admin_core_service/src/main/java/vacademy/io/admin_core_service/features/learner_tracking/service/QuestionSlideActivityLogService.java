package vacademy.io.admin_core_service.features.learner_tracking.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideResultDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuestionSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuestionSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.cbe.CbeConfigSecrets;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import org.springframework.util.StringUtils;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Objects;
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
    private final AnswerKeyAccess answerKeyAccess;
    private final QuestionSlideGrader grader;

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
        // CBE_RESPONSE answers are graded by AI and recorded only through /cbe/submit. Here
        // a client could otherwise write its own marks and status onto such a slide, or
        // replace the graded rows of an attempt. The activity row (time on the slide) stays.
        // Judged on the slide the activity really belongs to, not on the slideId parameter.
        String recordedSlideId = activityLog.getSlideId() != null ? activityLog.getSlideId() : slideId;
        if (isCbeSlide(recordedSlideId) || (!Objects.equals(recordedSlideId, slideId) && isCbeSlide(slideId))) {
            log.warn("Ignoring question-slide responses posted to the legacy endpoint for CBE slide {} "
                    + "(user {}, activity {})", recordedSlideId, user.getUserId(), activityLog.getId());
            return activityLog.getId();
        }
        // Grade before persisting: the learner app posts a placeholder status of
        // "SUBMITTED" with marks 0 for every question-slide answer, so without this the
        // tracked row records neither correctness nor a score.
        applyServerSideScoring(slideId, activityLogDTO.getQuestionSlides());
        numberAttempts(activityLog, user.getUserId(), recordedSlideId, activityLogDTO.getQuestionSlides());
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
            if (CbeConfigSecrets.isCbe(question.getQuestionType(), question.getAutoEvaluationJson())) {
                // AI-graded; nothing here may set its marks.
                return;
            }
            double points = question.getPoints() == null ? 0.0 : question.getPoints();

            for (QuestionSlideActivityLogDTO attempt : questionSlides) {
                if (attempt == null) {
                    continue;
                }
                // The slide editor stores data.correctOptionIds / data.validAnswers /
                // data.answer, which the quiz-shaped evaluate() never read, so every
                // question-slide answer used to stay SUBMITTED.
                AutoEvaluationScorer.Verdict verdict = grader.grade(question, attempt.getResponseJson());
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

    /**
     * The learner app sent the slide's attempt limit as every attempt's number, so all of a
     * learner's attempts looked like the same one. Numbered here instead: one more than the
     * learner's earlier submissions on the slide.
     */
    private void numberAttempts(ActivityLog activityLog, String userId, String slideId,
            List<QuestionSlideActivityLogDTO> questionSlides) {
        if (slideId == null || userId == null || questionSlides == null || questionSlides.isEmpty()) {
            return;
        }
        try {
            long earlier = questionSlideTrackedRepository.countSubmissionsOutsideActivity(userId, slideId,
                    activityLog.getId());
            int attemptNumber = (int) Math.min(Integer.MAX_VALUE, earlier + 1);
            for (QuestionSlideActivityLogDTO attempt : questionSlides) {
                if (attempt != null) {
                    attempt.setAttemptNumber(attemptNumber);
                }
            }
        } catch (RuntimeException e) {
            // Numbering must never cost a learner their submission.
            log.warn("Could not number question-slide attempts for slide {} (user {})", slideId, userId, e);
        }
    }

    /**
     * The signed-in learner's latest answer on a QUESTION slide: whether it was right and the
     * correct answer, when the author left "show answer after submit" on. Nothing about the
     * answer key is returned before the learner has submitted.
     */
    public QuestionSlideResultDTO getMyResult(String slideId, CustomUserDetails user) {
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            throw new VacademyException("Sign in to see your answer");
        }
        if (!StringUtils.hasText(slideId)) {
            throw new VacademyException("slide_id is required");
        }
        String userId = user.getUserId();
        QuestionSlideResultDTO result = new QuestionSlideResultDTO();
        result.setSlideId(slideId);

        Optional<Slide> slide = slideRepository.findById(slideId);
        if (slide.isEmpty() || slide.get().getSourceId() == null
                || !"QUESTION".equalsIgnoreCase(slide.get().getSourceType())) {
            return result;
        }
        Optional<QuestionSlide> questionOpt = questionSlideRepository.findByIdWithText(slide.get().getSourceId());
        if (questionOpt.isEmpty()) {
            return result;
        }
        QuestionSlide question = questionOpt.get();
        if (CbeConfigSecrets.isCbe(question.getQuestionType(), question.getAutoEvaluationJson())) {
            // Spreadsheet & Written Response has its own result: /cbe/my-attempts.
            return result;
        }
        result.setShowAnswer(question.showsAnswerAfterSubmit());

        Optional<QuestionSlideTracked> latest = questionSlideTrackedRepository.findLatestSubmission(userId, slideId);
        if (latest.isEmpty()) {
            return result;
        }
        result.setSubmitted(true);
        result.setAttempts(questionSlideTrackedRepository.countSubmissions(userId, slideId));
        result.setAttemptNumber(latest.get().getAttemptNumber());
        result.setResponseJson(latest.get().getResponseJson());
        if (question.getExplanationTextData() != null) {
            result.setExplanationHtml(question.getExplanationTextData().getContent());
        }
        if (!result.isShowAnswer()) {
            return result;
        }

        String stored = latest.get().getResponseStatus();
        AutoEvaluationScorer.Verdict verdict = isVerdict(stored)
                ? AutoEvaluationScorer.Verdict.valueOf(stored)
                // Answers saved before grading worked here carry SUBMITTED.
                : grader.grade(question, latest.get().getResponseJson());
        result.setVerdict(verdict == AutoEvaluationScorer.Verdict.UNKNOWN ? null : verdict.name());
        QuestionSlideGrader.AnswerKey key = grader.answerKey(question);
        result.setCorrectOptionIds(key.correctOptionIds());
        result.setCorrectAnswers(key.correctAnswers());
        return result;
    }

    private static boolean isVerdict(String status) {
        return "CORRECT".equals(status) || "WRONG".equals(status) || "SKIPPED".equals(status);
    }

    /** Whether this slide is a CBE_RESPONSE question slide. Unknown or unreadable: false. */
    private boolean isCbeSlide(String slideId) {
        if (slideId == null) {
            return false;
        }
        try {
            Optional<Slide> slide = slideRepository.findById(slideId);
            if (slide.isEmpty() || slide.get().getSourceId() == null
                    || !"QUESTION".equalsIgnoreCase(slide.get().getSourceType())) {
                return false;
            }
            return questionSlideRepository.findById(slide.get().getSourceId())
                    .map(q -> CbeConfigSecrets.isCbe(q.getQuestionType(), q.getAutoEvaluationJson()))
                    .orElse(false);
        } catch (RuntimeException e) {
            log.warn("Could not tell whether slide {} is a CBE question slide", slideId, e);
            return false;
        }
    }

    public Page<ActivityLogDTO> getQuestionSlideActivityLogs(String userId, String slideId, Pageable pageable,
            CustomUserDetails userDetails) {
        Page<ActivityLog> activityLogs = activityLogRepository.findActivityLogsWithQuestionSlides(userId, slideId,
                pageable);
        return activityLogs.map(activityLog -> answerKeyAccess.withoutQuizSidesWhenStripping(activityLog.toActivityLogDTO()));
    }
}
