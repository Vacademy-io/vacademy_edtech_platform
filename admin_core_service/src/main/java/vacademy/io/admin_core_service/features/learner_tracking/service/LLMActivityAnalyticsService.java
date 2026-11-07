package vacademy.io.admin_core_service.features.learner_tracking.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_tracking.dto.AssignmentSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizSideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.AssignmentSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.learner_tracking.util.RichTextForAI;
import vacademy.io.admin_core_service.features.slide.entity.AssignmentSlide;
import vacademy.io.admin_core_service.features.slide.entity.AssignmentSlideQuestion;
import vacademy.io.admin_core_service.features.slide.entity.Option;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlide;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestion;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestionOption;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.AssignmentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionOptionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

/**
 * Comprehensive service for LLM-based activity analytics lifecycle.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LLMActivityAnalyticsService {

        private final ActivityLogRepository activityLogRepository;
        private final QuizSlideQuestionRepository quizSlideQuestionRepository;
        private final QuizSlideQuestionOptionRepository quizSlideQuestionOptionRepository;
        private final QuestionSlideRepository questionSlideRepository;
        private final QuizSlideRepository quizSlideRepository;
        private final AssignmentSlideRepository assignmentSlideRepository;
        private final SlideRepository slideRepository;
        private final ObjectMapper objectMapper;
        private final AutoEvaluationScorer autoEvaluationScorer;

        /**
         * Correctness vocabulary used in the payload. Matches the wording the analysis
         * prompt asks the model to treat as the source of truth.
         */
        private static final String STATUS_CORRECT = "CORRECT";
        private static final String STATUS_INCORRECT = "INCORRECT";
        private static final String STATUS_SKIPPED = "SKIPPED";
        private static final String STATUS_PENDING = "PENDING";

        // ====================================================================================
        // PHASE 1: RAW DATA CAPTURE METHODS
        // ====================================================================================

        /**
         * Save raw quiz submission data for LLM analysis
         */
        public void saveQuizRawData(
                        ActivityLog originalActivityLog,
                        List<QuizSideActivityLogDTO> quizData,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId) {
                try {
                        log.info("[LLM] Saving quiz raw data for activity: {}, slide: {}",
                                        originalActivityLog.getId(), slideId);

                        Map<String, Object> rawJson = buildQuizRawJson(
                                        originalActivityLog,
                                        quizData,
                                        slideId,
                                        chapterId,
                                        packageSessionId,
                                        subjectId);

                        saveRawActivityLog("llm_quiz", originalActivityLog, rawJson);

                        log.info("[LLM] Successfully saved quiz raw data");
                } catch (Exception e) {
                        log.error("[LLM] Error saving quiz raw data for activity: {}",
                                        originalActivityLog.getId(), e);
                        // Don't throw - just log and continue
                }
        }

        /**
         * Save raw question submission data for LLM analysis
         */
        public void saveQuestionRawData(
                        ActivityLog originalActivityLog,
                        List<QuestionSlideActivityLogDTO> questionData,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId) {
                try {
                        log.info("[LLM] Saving question raw data for activity: {}, slide: {}, questionData size: {}",
                                        originalActivityLog.getId(), slideId,
                                        questionData != null ? questionData.size() : 0);

                        if (questionData != null && !questionData.isEmpty()) {
                                log.debug("[LLM] Question data details: {}", questionData);
                        }

                        Map<String, Object> rawJson = buildQuestionRawJson(
                                        originalActivityLog,
                                        questionData,
                                        slideId,
                                        chapterId,
                                        packageSessionId,
                                        subjectId);

                        saveRawActivityLog("llm_question", originalActivityLog, rawJson);

                        log.info("[LLM] Successfully saved question raw data");
                } catch (Exception e) {
                        log.error("[LLM] Error saving question raw data for activity: {}",
                                        originalActivityLog.getId(), e);
                }
        }

        /**
         * Save raw assignment submission data for LLM analysis
         */
        public void saveAssignmentRawData(
                        ActivityLog originalActivityLog,
                        List<AssignmentSlideActivityLogDTO> assignmentData,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId) {
                try {
                        log.info("[LLM] Saving assignment raw data for activity: {}, slide: {}",
                                        originalActivityLog.getId(), slideId);

                        Map<String, Object> rawJson = buildAssignmentRawJson(
                                        originalActivityLog,
                                        assignmentData,
                                        slideId,
                                        chapterId,
                                        packageSessionId,
                                        subjectId);

                        saveRawActivityLog("llm_assignment", originalActivityLog, rawJson);

                        log.info("[LLM] Successfully saved assignment raw data");
                } catch (Exception e) {
                        log.error("[LLM] Error saving assignment raw data for activity: {}",
                                        originalActivityLog.getId(), e);
                }
        }

        /**
         * Rebuild an assignment's LLM payload once a teacher has graded it, and re-queue
         * it for analysis.
         *
         * <p>Assignment raw data is captured at submission time, which is before anyone
         * has looked at the work: no marks, no feedback. That is the only point at which
         * an assignment carries anything qualitative, so a report generated purely from
         * the submission can say nothing about how the learner actually did. This
         * overwrites the existing raw payload in place and sets it back to 'raw' so the
         * scheduler regenerates the report from the graded picture.
         *
         * <p>In-place, deliberately: creating a second log would leave the learner with
         * two reports for one assignment, the older one written before it was marked.
         *
         * <p>Cost note: this is a second LLM call per assignment - one at submission, one
         * after grading. Drop the call site in AssignmentSlideActivityLogService if that
         * trade is not wanted; the submission-time report stays truthful without it, it
         * just never learns the outcome.
         */
        public void refreshAssignmentRawDataAfterGrading(AssignmentSlideTracked tracked) {
                try {
                        if (tracked == null || tracked.getActivityLog() == null) {
                                return;
                        }
                        ActivityLog originalActivityLog = tracked.getActivityLog();
                        String slideId = originalActivityLog.getSlideId();
                        String userId = originalActivityLog.getUserId();
                        if (slideId == null || userId == null) {
                                return;
                        }

                        Map<String, Object> rawJson = buildAssignmentRawJson(
                                        originalActivityLog,
                                        List.of(tracked.toAssignmentSlideActivityLog()),
                                        slideId, null, null, null);
                        String jsonString = objectMapper.writeValueAsString(rawJson);

                        Optional<ActivityLog> existing = activityLogRepository
                                        .findByUserIdAndSourceIdOrderByCreatedAtDesc(userId, slideId)
                                        .stream()
                                        .filter(log -> "llm_assignment".equals(log.getSourceType()))
                                        .findFirst();

                        if (existing.isPresent()) {
                                ActivityLog llmLog = existing.get();
                                llmLog.setRawJson(jsonString);
                                llmLog.setStatus("raw");
                                activityLogRepository.save(llmLog);
                                log.info("[LLM] Re-queued assignment activity log {} after grading", llmLog.getId());
                        } else {
                                saveRawActivityLog("llm_assignment", originalActivityLog, rawJson);
                                log.info("[LLM] No existing assignment log for slide {} user {} - captured now",
                                                slideId, userId);
                        }
                } catch (Exception e) {
                        // Grading must never fail because analytics could not be refreshed.
                        log.error("[LLM] Error refreshing assignment raw data after grading", e);
                }
        }

        /**
         * Save raw assessment submission data for LLM analysis
         * This version is called directly from assessment_service via REST API
         * 
         * @param assessmentData Complete assessment submission data from
         *                       assessment_service
         */
        public void saveAssessmentRawDataFromExternal(Map<String, Object> assessmentData) {
                saveAssessmentRawData(assessmentData);
        }

        /**
         * Save raw assessment submission data for LLM analysis
         * This version is called directly from assessment_service via REST API
         * The data is already enriched and formatted by assessment_service
         * 
         * @param assessmentData Complete enriched assessment submission data from
         *                       assessment_service
         */
        public void saveAssessmentRawData(Map<String, Object> assessmentData) {
                try {
                        log.info("[LLM] Saving assessment raw data from assessment_service");

                        // Data is already enriched and properly formatted by assessment_service
                        // Just extract what we need and save directly
                        saveRawActivityLogForAssessment(assessmentData, assessmentData);

                        log.info("[LLM] Successfully saved assessment raw data");
                } catch (Exception e) {
                        log.error("[LLM] Error saving assessment raw data from service", e);
                        throw new RuntimeException("Failed to save assessment raw data", e);
                }
        }

        // ====================================================================================
        // PRIVATE HELPER METHODS
        // ====================================================================================

        /**
         * Build the LLM payload for a quiz submission.
         *
         * <p>Shape deliberately mirrors what assessment_service sends for assessments
         * (see AssessmentDataEnrichmentService): plain-text question and option content,
         * the correct and chosen answers resolved to text, and a {@code status} per
         * question - the analysis prompt names that field as its source of truth for
         * correctness.
         *
         * <p>Identifiers are deliberately absent. Nothing in the insight schema refers to
         * a question by id, so slide/question/option UUIDs were pure prompt weight - and
         * worse than weight, because shipping the answer key as a list of option ids left
         * the model to join ids to option text itself before it could say anything about
         * what the learner actually got wrong.
         */
        private Map<String, Object> buildQuizRawJson(
                        ActivityLog activityLog,
                        List<QuizSideActivityLogDTO> quizData,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId) {
                Map<String, Object> json = new LinkedHashMap<>();

                json.put("activity_type", "quiz_submission");
                json.put("timestamp", Instant.now().toString());

                List<QuizSideActivityLogDTO> responses = quizData == null ? List.of() : quizData;

                // Content metadata
                Optional<Slide> slideOpt = slideRepository.findById(slideId);
                Map<String, Object> content = new LinkedHashMap<>();
                content.put("slide_type", "QUIZ");
                slideOpt.ifPresent(slide -> content.put("slide_name", slide.getTitle()));
                content.put("total_questions", responses.size());
                json.put("content", content);

                // Session timing
                Map<String, Object> session = new LinkedHashMap<>();
                if (activityLog.getStartTime() != null) {
                        session.put("start_time", activityLog.getStartTime().toInstant().toString());
                }
                if (activityLog.getEndTime() != null) {
                        session.put("end_time", activityLog.getEndTime().toInstant().toString());
                }
                if (activityLog.getStartTime() != null && activityLog.getEndTime() != null) {
                        long durationSeconds = (activityLog.getEndTime().getTime()
                                        - activityLog.getStartTime().getTime()) / 1000;
                        session.put("duration_seconds", durationSeconds);
                }
                json.put("session", session);

                // Per-question marks fall back to the quiz's defaults, the same way the
                // learner app scores them.
                QuizSlide quizSlide = slideOpt.map(Slide::getSourceId)
                                .flatMap(quizSlideRepository::findById)
                                .orElse(null);
                double defaultMarks = quizSlide != null && quizSlide.getMarksPerQuestion() != null
                                ? quizSlide.getMarksPerQuestion()
                                : 1.0;
                double defaultNegative = quizSlide != null && quizSlide.getNegativeMarking() != null
                                ? quizSlide.getNegativeMarking()
                                : 0.0;
                boolean partialMarking = quizSlide != null && Boolean.TRUE.equals(quizSlide.getPartialMarking());

                List<Map<String, Object>> questions = new ArrayList<>();
                double totalScore = 0.0;
                double maxScore = 0.0;
                int correct = 0;
                int incorrect = 0;
                int skipped = 0;

                for (int i = 0; i < responses.size(); i++) {
                        Map<String, Object> questionData = buildQuizQuestionData(responses.get(i), i + 1,
                                        defaultMarks, defaultNegative, partialMarking);
                        if (questionData.isEmpty()) {
                                continue;
                        }
                        questions.add(questionData);

                        String status = String.valueOf(questionData.get("status"));
                        if (STATUS_CORRECT.equals(status)) {
                                correct++;
                        } else if (STATUS_SKIPPED.equals(status)) {
                                skipped++;
                        } else if (STATUS_INCORRECT.equals(status)) {
                                incorrect++;
                        }

                        totalScore += toDouble(questionData.get("marks_obtained"));
                        maxScore += toDouble(questionData.get("marks"));
                }
                json.put("questions", questions);

                // Summary
                double awarded = Math.max(0.0, totalScore);
                Map<String, Object> summary = new LinkedHashMap<>();
                summary.put("total_score", round(awarded));
                summary.put("max_score", round(maxScore));
                summary.put("percentage", maxScore > 0 ? round(awarded * 100.0 / maxScore) : 0.0);
                summary.put("questions_attempted", questions.size() - skipped);
                summary.put("correct", correct);
                summary.put("incorrect", incorrect);
                summary.put("skipped", skipped);
                json.put("summary", summary);

                return json;
        }

        /**
         * Build one question entry for the quiz payload.
         *
         * <p>{@code status} comes from the persisted response status, which
         * {@link vacademy.io.admin_core_service.features.learner_tracking.service.QuizSlideActivityLogService}
         * now recomputes server-side. It used to be derived here as
         * {@code "CORRECT".equals(responseStatus)}, which read the learner app's
         * placeholder "SUBMITTED" as a wrong answer and reported a full-marks attempt to
         * the model as zero out of everything.
         *
         * @param defaultMarks    quiz-level marks per question, used when the question
         *                        carries no override
         * @param defaultNegative quiz-level negative marking, likewise
         * @param partialMarking  quiz-level partial marking for multiple-correct questions
         */
        private Map<String, Object> buildQuizQuestionData(QuizSideActivityLogDTO quizItem, int order,
                        double defaultMarks, double defaultNegative, boolean partialMarking) {
                Map<String, Object> questionData = new LinkedHashMap<>();

                try {
                        Optional<QuizSlideQuestion> questionOpt = quizSlideQuestionRepository
                                        .findById(quizItem.getQuestionId());

                        if (questionOpt.isEmpty()) {
                                log.warn("[LLM] Question not found: {}", quizItem.getQuestionId());
                                return questionData;
                        }

                        QuizSlideQuestion question = questionOpt.get();

                        questionData.put("order", order);
                        questionData.put("question_type", question.getQuestionType());

                        if (question.getParentRichText() != null) {
                                putIfPresent(questionData, "parent_text",
                                                RichTextForAI.toPlainText(question.getParentRichText().getContent()));
                        }
                        if (question.getText() != null) {
                                putIfPresent(questionData, "question_text",
                                                RichTextForAI.toPlainText(question.getText().getContent()));
                        }

                        List<QuizSlideQuestionOption> options = quizSlideQuestionOptionRepository
                                        .findByQuizSlideQuestionId(question.getId());
                        Map<String, String> optionTextById = new LinkedHashMap<>();
                        List<String> optionLabels = new ArrayList<>();
                        for (QuizSlideQuestionOption option : options) {
                                String label = option.getText() == null ? ""
                                                : RichTextForAI.toPlainText(option.getText().getContent());
                                optionTextById.put(option.getId(), label);
                                optionLabels.add(label);
                        }
                        if (!optionLabels.isEmpty()) {
                                questionData.put("options", optionLabels);
                        }

                        List<String> optionIdsInOrder = new ArrayList<>(optionTextById.keySet());
                        Set<String> correctIds = autoEvaluationScorer.correctAnswerIds(
                                        question.getAutoEvaluationJson(), () -> optionIdsInOrder);
                        Set<String> selectedIds = autoEvaluationScorer.selectedAnswerIds(quizItem.getResponseJson());
                        putIfPresent(questionData, "correct_answer", joinAsText(correctIds, optionTextById));
                        putIfPresent(questionData, "student_answer", joinAsText(selectedIds, optionTextById));

                        String status = normaliseStatus(quizItem.getResponseStatus());
                        questionData.put("status", status);
                        if (!STATUS_PENDING.equals(status)) {
                                questionData.put("is_correct", STATUS_CORRECT.equals(status));
                        }

                        double marks = question.getMarks() != null ? question.getMarks() : defaultMarks;
                        double negative = question.getNegativeMarking() != null ? question.getNegativeMarking()
                                        : defaultNegative;
                        questionData.put("marks", round(marks));
                        if (STATUS_CORRECT.equals(status)) {
                                questionData.put("marks_obtained", round(marks));
                        } else if (STATUS_INCORRECT.equals(status)) {
                                double partial = partialMarking
                                                && AutoEvaluationScorer.isMultiSelect(question.getQuestionType())
                                                && autoEvaluationScorer.isMarkedPartial(quizItem.getResponseJson())
                                                ? AutoEvaluationScorer.partialCreditFraction(correctIds, selectedIds)
                                                : 0.0;
                                questionData.put("marks_obtained", round(partial > 0 ? marks * partial : -negative));
                        } else {
                                questionData.put("marks_obtained", 0.0);
                        }

                        if (question.getExplanationText() != null) {
                                putIfPresent(questionData, "explanation",
                                                RichTextForAI.toPlainText(question.getExplanationText().getContent()));
                        }

                } catch (Exception e) {
                        log.error("[LLM] Error building question data for: {}", quizItem.getQuestionId(), e);
                }

                return questionData;
        }

        /**
         * Map a persisted response status onto the vocabulary the analysis prompt uses.
         * The learner app writes WRONG; the prompt (and the assessment payload it was
         * written against) says INCORRECT. Anything not auto-gradable - free text awaiting
         * a human, or an older row still carrying the "SUBMITTED" placeholder - becomes
         * PENDING rather than being silently counted as a wrong answer.
         */
        private String normaliseStatus(String responseStatus) {
                if (responseStatus == null) {
                        return STATUS_PENDING;
                }
                return switch (responseStatus.trim().toUpperCase()) {
                        case "CORRECT" -> STATUS_CORRECT;
                        case "WRONG", "INCORRECT" -> STATUS_INCORRECT;
                        case "PARTIAL_CORRECT" -> "PARTIAL_CORRECT";
                        case "SKIPPED" -> STATUS_SKIPPED;
                        default -> STATUS_PENDING;
                };
        }

        /** Render a set of option ids as readable text; ids with no known option are dropped. */
        private String joinAsText(Set<String> optionIds, Map<String, String> optionTextById) {
                if (optionIds == null || optionIds.isEmpty()) {
                        return "";
                }
                List<String> labels = new ArrayList<>();
                for (String id : optionIds) {
                        String label = optionTextById.get(id);
                        if (label != null && !label.isBlank()) {
                                labels.add(label);
                        } else if (optionTextById.isEmpty()) {
                                // Free-text / numeric answers have no options to resolve against.
                                labels.add(id);
                        }
                }
                return String.join(", ", labels);
        }

        private void putIfPresent(Map<String, Object> target, String key, String value) {
                if (value != null && !value.isBlank()) {
                        target.put(key, value);
                }
        }

        private double toDouble(Object value) {
                return value instanceof Number number ? number.doubleValue() : 0.0;
        }

        private double round(double value) {
                return Math.round(value * 100.0) / 100.0;
        }

        /**
         * Build the LLM payload for a question-slide submission.
         *
         * <p>Same shape and the same reasoning as {@link #buildQuizRawJson}: plain text,
         * answers resolved to text, no identifiers, and a {@code status} the prompt can
         * trust. A question slide records one question with one attempt per row, so
         * attempts are listed in order rather than aggregated.
         */
        private Map<String, Object> buildQuestionRawJson(
                        ActivityLog activityLog,
                        List<QuestionSlideActivityLogDTO> questionData,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId) {
                Map<String, Object> json = new LinkedHashMap<>();

                try {
                        json.put("activity_type", "question_submission");
                        json.put("timestamp", Instant.now().toString());

                        Map<String, Object> content = new LinkedHashMap<>();
                        content.put("slide_type", "QUESTION");
                        json.put("content", content);

                        Optional<Slide> slideOpt = slideRepository.findById(slideId);
                        if (slideOpt.isEmpty()) {
                                log.error("[LLM] Slide NOT FOUND for slideId: {}", slideId);
                                json.put("error", "Slide not found with ID: " + slideId);
                                return json;
                        }

                        Slide slide = slideOpt.get();
                        content.put("slide_name", slide.getTitle());
                        String actualQuestionId = slide.getSourceId();

                        if (actualQuestionId == null) {
                                log.error("[LLM] Slide has null sourceId for slideId: {}", slideId);
                                json.put("error", "Slide has null sourceId");
                                return json;
                        }

                        Optional<QuestionSlide> questionSlideOpt = questionSlideRepository
                                        .findByIdWithText(actualQuestionId);

                        if (questionSlideOpt.isEmpty()) {
                                log.error("[LLM] QuestionSlide NOT FOUND for slideId: {}, actualQuestionId: {}",
                                                slideId, actualQuestionId);
                                json.put("error", "QuestionSlide not found with ID: " + actualQuestionId);
                                return json;
                        }

                        QuestionSlide questionSlide = questionSlideOpt.get();

                        Map<String, Object> questionDetails = new LinkedHashMap<>();
                        questionDetails.put("question_type", questionSlide.getQuestionType());
                        double points = questionSlide.getPoints() == null ? 0.0 : questionSlide.getPoints();
                        questionDetails.put("marks", round(points));
                        if (questionSlide.getDefaultQuestionTimeMins() != null) {
                                questionDetails.put("time_limit_mins", questionSlide.getDefaultQuestionTimeMins());
                        }

                        if (questionSlide.getParentRichText() != null) {
                                putIfPresent(questionDetails, "parent_text",
                                                RichTextForAI.toPlainText(questionSlide.getParentRichText().getContent()));
                        }
                        if (questionSlide.getTextData() != null) {
                                putIfPresent(questionDetails, "question_text",
                                                RichTextForAI.toPlainText(questionSlide.getTextData().getContent()));
                        }

                        Map<String, String> optionTextById = new LinkedHashMap<>();
                        List<String> optionLabels = new ArrayList<>();
                        if (questionSlide.getOptions() != null) {
                                for (Option option : questionSlide.getOptions()) {
                                        String label = option.getText() == null ? ""
                                                        : RichTextForAI.toPlainText(option.getText().getContent());
                                        optionTextById.put(option.getId(), label);
                                        optionLabels.add(label);
                                }
                        }
                        if (!optionLabels.isEmpty()) {
                                questionDetails.put("options", optionLabels);
                        }

                        List<String> optionIdsInOrder = new ArrayList<>(optionTextById.keySet());
                        putIfPresent(questionDetails, "correct_answer", joinAsText(
                                        autoEvaluationScorer.correctAnswerIds(questionSlide.getAutoEvaluationJson(),
                                                        () -> optionIdsInOrder),
                                        optionTextById));

                        if (questionSlide.getExplanationTextData() != null) {
                                putIfPresent(questionDetails, "explanation", RichTextForAI
                                                .toPlainText(questionSlide.getExplanationTextData().getContent()));
                        }

                        json.put("question", questionDetails);

                        if (questionData != null && !questionData.isEmpty()) {
                                List<Map<String, Object>> attempts = new ArrayList<>();
                                for (QuestionSlideActivityLogDTO attempt : questionData) {
                                        Map<String, Object> attemptData = new LinkedHashMap<>();
                                        attemptData.put("attempt_number", attempt.getAttemptNumber());

                                        String status = normaliseStatus(attempt.getResponseStatus());
                                        attemptData.put("status", status);
                                        if (!STATUS_PENDING.equals(status)) {
                                                attemptData.put("is_correct", STATUS_CORRECT.equals(status));
                                        }

                                        putIfPresent(attemptData, "student_answer", joinAsText(
                                                        autoEvaluationScorer.selectedAnswerIds(attempt.getResponseJson()),
                                                        optionTextById));
                                        attemptData.put("marks_obtained",
                                                        round(attempt.getMarks() == null ? 0.0 : attempt.getMarks()));

                                        attempts.add(attemptData);
                                }
                                json.put("attempts", attempts);
                                json.put("total_attempts", attempts.size());
                        } else {
                                log.warn("[LLM] No question data/attempts provided");
                        }

                } catch (Exception e) {
                        log.error("[LLM] Error building question raw JSON for slideId: {}", slideId, e);
                        json.put("error", "Failed to build question JSON: " + e.getMessage());
                }

                return json;
        }

        /**
         * Build the LLM payload for an assignment submission.
         *
         * <p>This used to emit nothing but the slide name and a handful of UUIDs - no
         * prompt, no marks, no due date, no submission. The analysis prompt then asked the
         * model for a performance analysis, strengths, weaknesses, Bloom's breakdown and
         * flashcards, and the model had nothing to derive any of it from, so it produced a
         * confidently-worded report about an assignment it could not see.
         *
         * <p>The submitted work itself is a set of uploaded files, which the model cannot
         * read. What it can reason about is captured instead: the assignment prompt, what
         * the assignment is worth, when it was due, whether it was late, how many files
         * were handed in, and - once a teacher has graded it - the marks and their written
         * feedback. {@code grading_status} states plainly which of those are known, so an
         * ungraded submission is analysed as ungraded rather than as a zero.
         */
        private Map<String, Object> buildAssignmentRawJson(
                        ActivityLog activityLog,
                        List<AssignmentSlideActivityLogDTO> assignmentData,
                        String slideId,
                        String chapterId,
                        String packageSessionId,
                        String subjectId) {
                Map<String, Object> json = new LinkedHashMap<>();

                json.put("activity_type", "assignment_submission");
                json.put("timestamp", Instant.now().toString());

                Optional<Slide> slideOpt = slideRepository.findById(slideId);
                Map<String, Object> content = new LinkedHashMap<>();
                content.put("slide_type", "ASSIGNMENT");
                slideOpt.ifPresent(slide -> content.put("slide_name", slide.getTitle()));
                json.put("content", content);

                AssignmentSlide assignment = slideOpt.map(Slide::getSourceId)
                                .flatMap(assignmentSlideRepository::findById)
                                .orElse(null);

                Double totalMarks = null;
                if (assignment != null) {
                        Map<String, Object> details = new LinkedHashMap<>();
                        if (assignment.getParentRichText() != null) {
                                putIfPresent(details, "parent_text",
                                                RichTextForAI.toPlainText(assignment.getParentRichText().getContent()));
                        }
                        if (assignment.getTextData() != null) {
                                putIfPresent(details, "instructions",
                                                RichTextForAI.toPlainText(assignment.getTextData().getContent()));
                        }
                        totalMarks = assignment.getTotalMarks();
                        if (totalMarks != null) {
                                details.put("total_marks", round(totalMarks));
                        }
                        if (assignment.getPassingMarks() != null) {
                                details.put("passing_marks", round(assignment.getPassingMarks()));
                        }
                        if (assignment.getEndDate() != null) {
                                details.put("due_date", assignment.getEndDate().toString());
                        }

                        // The tasks set within the assignment, where the author broke it into
                        // questions - these are what a weakness or a next step can point at.
                        List<String> tasks = new ArrayList<>();
                        if (assignment.getAssignmentSlideQuestions() != null) {
                                assignment.getAssignmentSlideQuestions().stream()
                                                .sorted(Comparator.comparing(
                                                                AssignmentSlideQuestion::getQuestionOrder,
                                                                Comparator.nullsLast(Comparator.naturalOrder())))
                                                .forEach(question -> {
                                                        if (question.getTextData() != null) {
                                                                String text = RichTextForAI.toPlainText(
                                                                                question.getTextData().getContent());
                                                                if (!text.isBlank()) {
                                                                        tasks.add(text);
                                                                }
                                                        }
                                                });
                        }
                        if (!tasks.isEmpty()) {
                                details.put("tasks", tasks);
                        }

                        json.put("assignment", details);
                }

                // Session timing
                Map<String, Object> session = new LinkedHashMap<>();
                if (activityLog.getStartTime() != null) {
                        session.put("start_time", activityLog.getStartTime().toInstant().toString());
                }
                if (activityLog.getEndTime() != null) {
                        session.put("end_time", activityLog.getEndTime().toInstant().toString());
                }
                if (!session.isEmpty()) {
                        json.put("session", session);
                }

                List<AssignmentSlideActivityLogDTO> submissions = assignmentData == null ? List.of() : assignmentData;
                List<Map<String, Object>> enrichedSubmissions = new ArrayList<>();
                boolean anyGraded = false;

                for (AssignmentSlideActivityLogDTO submission : submissions) {
                        if (submission == null) {
                                continue;
                        }
                        Map<String, Object> entry = new LinkedHashMap<>();
                        if (submission.getDateSubmitted() != null) {
                                entry.put("submitted_at", submission.getDateSubmitted().toInstant().toString());
                        }
                        entry.put("late_submission", Boolean.TRUE.equals(submission.getLateSubmission()));
                        entry.put("files_submitted", countFiles(submission.getCommaSeparatedFileIds()));

                        if (submission.getMarks() != null) {
                                anyGraded = true;
                                entry.put("marks_obtained", round(submission.getMarks()));
                                if (totalMarks != null && totalMarks > 0) {
                                        entry.put("percentage", round(submission.getMarks() * 100.0 / totalMarks));
                                }
                        }
                        // Teacher feedback is the only qualitative signal about the work itself,
                        // since the submitted files are not readable here.
                        putIfPresent(entry, "instructor_feedback", submission.getFeedback());

                        enrichedSubmissions.add(entry);
                }

                if (!enrichedSubmissions.isEmpty()) {
                        json.put("submissions", enrichedSubmissions);
                }

                Map<String, Object> summary = new LinkedHashMap<>();
                summary.put("grading_status", anyGraded ? "GRADED" : "AWAITING_EVALUATION");
                summary.put("submission_count", enrichedSubmissions.size());
                summary.put("submitted_late", submissions.stream()
                                .anyMatch(s -> s != null && Boolean.TRUE.equals(s.getLateSubmission())));
                // Stated explicitly so the model does not write as though it had read the work.
                summary.put("submitted_work", "uploaded files - their contents are not available for analysis");
                json.put("summary", summary);

                return json;
        }

        /** How many files were handed in, from the stored comma-separated id list. */
        private int countFiles(String commaSeparatedFileIds) {
                if (commaSeparatedFileIds == null || commaSeparatedFileIds.isBlank()) {
                        return 0;
                }
                int count = 0;
                for (String id : commaSeparatedFileIds.split(",")) {
                        if (!id.isBlank()) {
                                count++;
                        }
                }
                return count;
        }

        /**
         * Save raw activity log specifically for assessment (no original activity log
         * reference)
         * For assessments: source_id = assessment_id
         * Data is already fully enriched by assessment_service
         */
        private void saveRawActivityLogForAssessment(
                        Map<String, Object> rawJson,
                        Map<String, Object> assessmentData) {
                try {
                        String jsonString = objectMapper.writeValueAsString(rawJson);

                        // Extract data from enriched structure
                        String userId = extractUserId(assessmentData);
                        String assessmentId = extractAssessmentId(assessmentData);
                        String attemptId = extractAttemptId(assessmentData);

                        ActivityLog llmActivityLog = new ActivityLog();
                        llmActivityLog.setId(UUID.randomUUID().toString());
                        llmActivityLog.setSourceId(assessmentId); // Link to assessment ID
                        llmActivityLog.setSourceType("llm_assessment");
                        llmActivityLog.setUserId(userId);
                        // No slide_id for assessments

                        // Set timestamps from assessment data
                        setTimestampsFromEnrichedData(llmActivityLog, assessmentData);

                        llmActivityLog.setStatus("raw");
                        llmActivityLog.setRawJson(jsonString);

                        activityLogRepository.save(llmActivityLog);

                        log.info("[LLM] Saved assessment activity log: id={}, assessmentId={}, attemptId={}, jsonLength={}",
                                        llmActivityLog.getId(), assessmentId, attemptId, jsonString.length());

                } catch (JsonProcessingException e) {
                        log.error("[LLM] Error serializing assessment raw JSON", e);
                        throw new RuntimeException("Failed to serialize assessment raw JSON", e);
                } catch (Exception e) {
                        log.error("[LLM] Error saving assessment activity log", e);
                        throw new RuntimeException("Failed to save assessment activity log", e);
                }
        }

        /**
         * Extract user ID from enriched assessment data
         */
        @SuppressWarnings("unchecked")
        private String extractUserId(Map<String, Object> assessmentData) {
                // Try new structure first (attempt.user_id)
                if (assessmentData.containsKey("attempt")) {
                        Map<String, Object> attempt = (Map<String, Object>) assessmentData.get("attempt");
                        if (attempt != null && attempt.containsKey("user_id")) {
                                return (String) attempt.get("user_id");
                        }
                }
                // Fallback to old structure
                return (String) assessmentData.get("userId");
        }

        /**
         * Extract assessment ID from enriched assessment data
         */
        @SuppressWarnings("unchecked")
        private String extractAssessmentId(Map<String, Object> assessmentData) {
                // Try new structure first (assessment.id)
                if (assessmentData.containsKey("assessment")) {
                        Map<String, Object> assessment = (Map<String, Object>) assessmentData.get("assessment");
                        if (assessment != null && assessment.containsKey("id")) {
                                return (String) assessment.get("id");
                        }
                }
                // Fallback to old structure
                return (String) assessmentData.get("assessmentId");
        }

        /**
         * Extract attempt ID from enriched assessment data
         */
        @SuppressWarnings("unchecked")
        private String extractAttemptId(Map<String, Object> assessmentData) {
                // Try new structure first (attempt.id)
                if (assessmentData.containsKey("attempt")) {
                        Map<String, Object> attempt = (Map<String, Object>) assessmentData.get("attempt");
                        if (attempt != null && attempt.containsKey("id")) {
                                return (String) attempt.get("id");
                        }
                }
                // Fallback to old structure
                return (String) assessmentData.get("attemptId");
        }

        /**
         * Set timestamps from enriched assessment data
         */
        @SuppressWarnings("unchecked")
        private void setTimestampsFromEnrichedData(ActivityLog log, Map<String, Object> assessmentData) {
                try {
                        // Try new structure first (attempt.start_time, attempt.end_time)
                        if (assessmentData.containsKey("attempt")) {
                                Map<String, Object> attempt = (Map<String, Object>) assessmentData.get("attempt");
                                if (attempt != null) {
                                        Object startTime = attempt.get("start_time");
                                        Object endTime = attempt.get("end_time");

                                        if (startTime != null) {
                                                log.setStartTime(Timestamp.from(Instant.parse(startTime.toString())));
                                        }
                                        if (endTime != null) {
                                                log.setEndTime(Timestamp.from(Instant.parse(endTime.toString())));
                                        }
                                        return;
                                }
                        }

                        // Fallback to old structure
                        Object startTime = assessmentData.get("startTime");
                        Object endTime = assessmentData.get("endTime");

                        if (startTime != null) {
                                log.setStartTime(Timestamp.from(Instant.parse(startTime.toString())));
                        }
                        if (endTime != null) {
                                log.setEndTime(Timestamp.from(Instant.parse(endTime.toString())));
                        }
                } catch (Exception e) {
                        this.log.warn("[LLM] Error parsing timestamps from assessment data", e);
                }
        }

        /**
         * Save raw activity log to database
         * For slides: source_id = slide_id
         */
        private void saveRawActivityLog(
                        String sourceType,
                        ActivityLog originalActivityLog,
                        Map<String, Object> rawJson) {
                try {
                        String jsonString = objectMapper.writeValueAsString(rawJson);

                        ActivityLog llmActivityLog = new ActivityLog();
                        llmActivityLog.setId(UUID.randomUUID().toString());
                        llmActivityLog.setSourceId(originalActivityLog.getSlideId()); // Link to slide ID (not activity
                                                                                      // log ID)
                        llmActivityLog.setSourceType(sourceType);
                        llmActivityLog.setUserId(originalActivityLog.getUserId());
                        llmActivityLog.setSlideId(originalActivityLog.getSlideId());
                        llmActivityLog.setStartTime(originalActivityLog.getStartTime());
                        llmActivityLog.setEndTime(originalActivityLog.getEndTime());
                        llmActivityLog.setStatus("raw");
                        llmActivityLog.setRawJson(jsonString);

                        activityLogRepository.save(llmActivityLog);

                        log.info("[LLM] Saved raw activity log: id={}, sourceType={}, sourceId={}, jsonLength={}",
                                        llmActivityLog.getId(), sourceType, llmActivityLog.getSourceId(),
                                        jsonString.length());

                } catch (JsonProcessingException e) {
                        log.error("[LLM] Error serializing raw JSON", e);
                        throw new RuntimeException("Failed to serialize raw JSON", e);
                }
        }
}
