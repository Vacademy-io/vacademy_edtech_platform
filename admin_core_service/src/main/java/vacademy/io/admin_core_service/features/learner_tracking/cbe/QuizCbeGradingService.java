package vacademy.io.admin_core_service.features.learner_tracking.cbe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.AttemptStateRow;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.QuizMetaRow;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizReviewPolicy;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.QuizCbeGradingRepository.CbeQuizQuestionRow;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.QuizCbeGradingRepository.TrackedRow;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.QuizCbeGradeRequest;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.QuizCbeGradeResponse;
import vacademy.io.admin_core_service.features.slide.cbe.CbeConfigSecrets;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * AI check of the Spreadsheet &amp; Written Response ({@code CBE_RESPONSE}) answers in a quiz
 * attempt. The quiz submit records each CBE answer with 0 marks and state PENDING
 * ({@link QuizCbeRows}); the learner app then calls {@link #grade}, which sends each pending
 * answer to ai_service (same grader, prompt and pricing key as a CBE question slide,
 * docs/CBE_RESPONSE_QUESTION.md section 5.2) and records the marks on the attempt, where the
 * quiz review, Quiz Results and the activity dialog read them.
 *
 * <p>Grading is a separate call, not part of the submit, because an offline replay records
 * the submit inside its own transaction and the AI call takes up to two minutes. Calling it
 * again is safe: graded answers are returned as they are, a failed check (no credits, an
 * error) is tried again, and an answer is never graded twice.
 *
 * <p>AI checks per question per learner: the quiz attempt cap when it has one, else 3, the
 * question-slide default. No transaction is open during an AI call.
 */
@Slf4j
@Service
public class QuizCbeGradingService {

    static final int DEFAULT_MAX_CHECKS = CbeSlideSubmitService.DEFAULT_MAX_ATTEMPTS;
    /** A check still marked EVALUATING after this long died with its pod: it may be taken again. */
    static final long STALE_EVALUATING_MILLIS = 5 * 60 * 1000L;

    private static final ExecutorService GRADING_POOL = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "quiz-cbe-grade");
        thread.setDaemon(true);
        return thread;
    });

    private record Question(String id, double maxMarks, double gradingMaxMarks, JsonNode fullConfig,
            String questionText, String scenarioText, JsonNode solution) {
    }

    private record Prepared(Integer reAttemptCount, List<Question> questions, Map<String, TrackedRow> rows) {
    }

    /** What reserving a row found: {@code go} = this call grades it now. */
    private record Reservation(boolean go, ObjectNode stored, String status) {
    }

    private record Graded(String state, JsonNode evaluation, Double awarded, String errorCode) {
    }

    private final QuizCbeGradingRepository repository;
    private final LearnerQuizAttemptRepository quizRepository;
    private final LearnerQuizAccessService accessService;
    private final QuizReviewPolicy reviewPolicy;
    private final CbeGradingClient gradingClient;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public QuizCbeGradingService(QuizCbeGradingRepository repository,
            LearnerQuizAttemptRepository quizRepository,
            LearnerQuizAccessService accessService,
            QuizReviewPolicy reviewPolicy,
            CbeGradingClient gradingClient,
            ObjectMapper objectMapper,
            PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.quizRepository = quizRepository;
        this.accessService = accessService;
        this.reviewPolicy = reviewPolicy;
        this.gradingClient = gradingClient;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    // ------------------------------------------------------------------ grade

    public QuizCbeGradeResponse grade(QuizCbeGradeRequest request, CustomUserDetails user, String clientInstituteId) {
        String userId = requireUser(user);
        if (request == null || !StringUtils.hasText(request.getSlideId())
                || !StringUtils.hasText(request.getAttemptId())) {
            throw new InvalidRequestException("slide_id and attempt_id are required");
        }
        String slideId = request.getSlideId();
        String attemptId = request.getAttemptId();

        Prepared prepared = transactionTemplate.execute(tx -> prepare(slideId, attemptId, userId));
        if (prepared.questions().isEmpty()) {
            return emptyResponse(slideId, attemptId);
        }
        // The institute is charged for the check, so it has to be one the learner studies with now.
        LearnerQuizAccessService.Access access = accessService.requireAccess(user, slideId, clientInstituteId,
                request.getPackageSessionId(), request.getChapterId());
        int maxChecks = maxChecks(prepared.reAttemptCount());

        Map<String, ObjectNode> storedByQuestion = new HashMap<>();
        Map<String, String> statusByQuestion = new HashMap<>();
        Map<Question, ObjectNode> toGrade = new LinkedHashMap<>();
        for (Question question : prepared.questions()) {
            TrackedRow row = prepared.rows().get(question.id());
            if (row == null) {
                continue;
            }
            Reservation reservation = transactionTemplate.execute(tx ->
                    reserve(row, question, userId, slideId, maxChecks));
            if (reservation == null || reservation.stored() == null) {
                continue;
            }
            storedByQuestion.put(question.id(), reservation.stored());
            statusByQuestion.put(question.id(), reservation.status());
            if (reservation.go()) {
                toGrade.put(question, reservation.stored());
            }
        }

        // The AI calls, side by side and outside any transaction.
        Map<Question, CompletableFuture<Graded>> calls = new LinkedHashMap<>();
        toGrade.forEach((question, stored) -> calls.put(question, CompletableFuture.supplyAsync(
                () -> callAi(question, stored, access.instituteId(), userId, slideId), GRADING_POOL)));
        calls.forEach((question, call) -> {
            Graded graded = call.join();
            TrackedRow row = prepared.rows().get(question.id());
            ObjectNode stored = toGrade.get(question);
            String status = transactionTemplate.execute(tx -> finish(row.getId(), question, stored, graded));
            storedByQuestion.put(question.id(), stored);
            statusByQuestion.put(question.id(), status);
        });

        boolean showSolutions = showSolutions(reviewPolicy.settingsOf(access.instituteId()), userId, slideId,
                prepared.reAttemptCount());
        return response(slideId, attemptId, prepared, storedByQuestion, statusByQuestion, showSolutions, maxChecks,
                userId, false);
    }

    // ------------------------------------------------------------------ read

    /** Where each CBE answer of an attempt stands, without grading anything. */
    public QuizCbeGradeResponse results(String slideId, String attemptId, CustomUserDetails user,
            String clientInstituteId) {
        String userId = requireUser(user);
        if (!StringUtils.hasText(slideId) || !StringUtils.hasText(attemptId)) {
            throw new InvalidRequestException("slide_id and attempt_id are required");
        }
        Prepared prepared = transactionTemplate.execute(tx -> prepare(slideId, attemptId, userId));
        if (prepared.questions().isEmpty()) {
            return emptyResponse(slideId, attemptId);
        }
        Map<String, ObjectNode> storedByQuestion = new HashMap<>();
        Map<String, String> statusByQuestion = new HashMap<>();
        prepared.rows().forEach((questionId, row) -> {
            if (QuizCbeRows.read(row.getResponseJson()) instanceof ObjectNode stored) {
                storedByQuestion.put(questionId, stored);
                statusByQuestion.put(questionId, row.getResponseStatus());
            }
        });
        QuizReviewPolicy.QuizSettings settings;
        try {
            settings = reviewPolicy.settingsOf(
                    accessService.requireAccess(user, slideId, clientInstituteId, null, null).instituteId());
        } catch (ForbiddenException noLiveAccess) {
            // A learner whose access ended still reads back what was submitted, under the
            // strictest settings of the institutes owning the slide.
            settings = reviewPolicy.strictestOf(quizRepository.findInstitutesOfSlide(slideId));
        }
        boolean showSolutions = showSolutions(settings, userId, slideId, prepared.reAttemptCount());
        return response(slideId, attemptId, prepared, storedByQuestion, statusByQuestion, showSolutions,
                maxChecks(prepared.reAttemptCount()), userId, true);
    }

    // ------------------------------------------------------------------ steps

    private Prepared prepare(String slideId, String attemptId, String userId) {
        AttemptStateRow attempt = quizRepository.findAttemptState(attemptId)
                .orElseThrow(() -> new ResourceNotFoundException("This attempt was not found"));
        if (!userId.equals(attempt.getUserId())) {
            throw new ForbiddenException("Attempts can only be read by the learner who made them");
        }
        if (!slideId.equals(attempt.getSlideId()) || !"QUIZ".equals(attempt.getSourceType())) {
            throw new InvalidRequestException("This attempt belongs to another slide");
        }
        QuizMetaRow meta = quizRepository.findQuizBySlideId(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("This quiz is no longer available"));
        List<Question> questions = new ArrayList<>();
        for (CbeQuizQuestionRow row : repository.findCbeQuestions(meta.getQuizId())) {
            String fullConfig = CbeConfigSecrets.merge(row.getAutoEvaluationJson(), row.getEvaluationSecretJson());
            double maxMarks = QuizCbeRows.questionMaxMarks(row.getMarks(), fullConfig, meta.getMarksPerQuestion());
            Double partMarks = CbeConfigSecrets.totalPartMarks(fullConfig);
            questions.add(new Question(row.getQuestionId(), maxMarks, partMarks != null ? partMarks : maxMarks,
                    QuizCbeRows.read(fullConfig), htmlOrEmpty(row.getTextContent()),
                    htmlOrEmpty(row.getScenarioContent()),
                    CbeConfigSecrets.solutionForLearner(row.getEvaluationSecretJson())));
        }
        Map<String, TrackedRow> rows = new HashMap<>();
        if (!questions.isEmpty()) {
            for (TrackedRow row : repository.findRowsOfAttempt(attemptId)) {
                if (row.getQuestionId() != null) {
                    rows.putIfAbsent(row.getQuestionId(), row);
                }
            }
        }
        return new Prepared(meta.getReAttemptCount(), questions, rows);
    }

    /**
     * Inside one short transaction, under a lock on this learner and quiz: settles a row that
     * needs no check (graded, skipped, being graded, no checks left) or marks it EVALUATING so
     * a second tab or a repeated call does not grade it again.
     */
    private Reservation reserve(TrackedRow row, Question question, String userId, String slideId, int maxChecks) {
        quizRepository.lockLearnerOnQuiz("cbe-quiz|" + userId + "|" + slideId);
        String json = repository.findResponseJson(row.getId()).orElse(null);
        if (!(QuizCbeRows.read(json) instanceof ObjectNode stored)
                || !CbeConfigSecrets.QUESTION_TYPE.equals(stored.path("type").asText(null))) {
            // Not written by the quiz submit as a CBE answer: nothing here can grade it.
            return null;
        }
        String status = row.getResponseStatus();
        String state = QuizCbeRows.state(stored);
        switch (state) {
            case QuizCbeRows.STATE_EVALUATED, QuizCbeRows.STATE_SKIPPED, QuizCbeRows.STATE_UNATTEMPTED -> {
                return new Reservation(false, stored, status);
            }
            case QuizCbeRows.STATE_EVALUATING -> {
                long startedAt = stored.path("cbeStartedAt").asLong(0);
                if (System.currentTimeMillis() - startedAt < STALE_EVALUATING_MILLIS) {
                    return new Reservation(false, stored, status);
                }
            }
            default -> {
                // PENDING, FAILED, NO_CHECKS_LEFT and a stale EVALUATING are checked below.
            }
        }
        if (!QuizCbeRows.answered(stored.get("answer"))) {
            stored.put("cbeState", QuizCbeRows.STATE_SKIPPED);
            stored.remove("cbeStartedAt");
            repository.updateRow(row.getId(), stored.toString(), QuizCbeRows.STATUS_SKIPPED);
            return new Reservation(false, stored, QuizCbeRows.STATUS_SKIPPED);
        }
        long used = repository.countChecksUsed(userId, slideId, question.id(), row.getId());
        if (used >= maxChecks) {
            stored.put("cbeState", QuizCbeRows.STATE_NO_CHECKS_LEFT);
            stored.remove("cbeStartedAt");
            stored.remove("error");
            repository.updateRow(row.getId(), stored.toString(), QuizCbeRows.STATUS_SUBMITTED);
            return new Reservation(false, stored, QuizCbeRows.STATUS_SUBMITTED);
        }
        stored.put("cbeState", QuizCbeRows.STATE_EVALUATING);
        stored.put("cbeStartedAt", System.currentTimeMillis());
        stored.remove("error");
        repository.updateRow(row.getId(), stored.toString(), QuizCbeRows.STATUS_SUBMITTED);
        return new Reservation(true, stored, QuizCbeRows.STATUS_SUBMITTED);
    }

    /** One ai_service call. Never throws: a failure comes back as a FAILED outcome. */
    private Graded callAi(Question question, ObjectNode stored, String instituteId, String userId, String slideId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("institute_id", instituteId);
        body.put("user_id", userId);
        body.put("source_id", slideId);
        body.put("question_text", question.questionText());
        body.put("scenario_text", question.scenarioText());
        body.put("config", question.fullConfig());
        body.put("answer", stored.get("answer"));
        body.put("max_marks", question.gradingMaxMarks());
        try {
            JsonNode reply = objectMapper.valueToTree(gradingClient.grade(body));
            if (CbeSlideSubmitService.ERROR_UNATTEMPTED.equalsIgnoreCase(reply.path("verdict").asText(""))) {
                return new Graded(QuizCbeRows.STATE_UNATTEMPTED, null, null, null);
            }
            ObjectNode evaluation = CbeSlideSubmitService.learnerEvaluationOf(reply);
            return new Graded(QuizCbeRows.STATE_EVALUATED, evaluation, number(evaluation.get("marks_awarded")), null);
        } catch (CbeGradingClient.NoCreditsException e) {
            log.info("[quiz-cbe] institute {} out of AI credits; answer kept ungraded (slide {}, question {}, user {})",
                    instituteId, slideId, question.id(), userId);
            return new Graded(QuizCbeRows.STATE_FAILED, null, null, CbeSlideSubmitService.ERROR_NO_CREDITS);
        } catch (RuntimeException e) {
            log.error("[quiz-cbe] grading failed for slide {} question {} user {}", slideId, question.id(), userId, e);
            return new Graded(QuizCbeRows.STATE_FAILED, null, null, CbeSlideSubmitService.ERROR_FAILED);
        }
    }

    /** Writes the outcome onto the reserved row; returns its response_status. */
    private String finish(String rowId, Question question, ObjectNode stored, Graded graded) {
        stored.remove("cbeStartedAt");
        stored.remove("error");
        stored.put("cbeState", graded.state());
        stored.put("maxMarks", question.maxMarks());
        String status;
        switch (graded.state()) {
            case QuizCbeRows.STATE_EVALUATED -> {
                double marks = scaledMarks(graded.awarded(), question.gradingMaxMarks(), question.maxMarks());
                status = QuizCbeRows.gradedStatus(marks, question.maxMarks());
                stored.set("evaluation", graded.evaluation());
                stored.put("marks", marks);
                stored.put("isCorrect", "CORRECT".equals(status));
                stored.put("isPartial", !"CORRECT".equals(status) && marks > 0);
            }
            case QuizCbeRows.STATE_UNATTEMPTED -> {
                status = QuizCbeRows.STATUS_SKIPPED;
                stored.putNull("evaluation");
                stored.put("marks", 0.0);
                stored.put("isCorrect", false);
                stored.put("isPartial", false);
            }
            default -> {
                status = QuizCbeRows.STATUS_SUBMITTED;
                stored.put("marks", 0.0);
                stored.put("isCorrect", false);
                stored.put("isPartial", false);
                if (graded.errorCode() != null) {
                    stored.put("error", graded.errorCode());
                }
            }
        }
        repository.updateRow(rowId, stored.toString(), status);
        return status;
    }

    // ------------------------------------------------------------------ reply

    private QuizCbeGradeResponse response(String slideId, String attemptId, Prepared prepared,
            Map<String, ObjectNode> storedByQuestion, Map<String, String> statusByQuestion, boolean showSolutions,
            int maxChecks, String userId, boolean includeAnswer) {
        QuizCbeGradeResponse response = new QuizCbeGradeResponse();
        response.setSlideId(slideId);
        response.setAttemptId(attemptId);
        response.setShowSolutions(showSolutions);
        for (Question question : prepared.questions()) {
            ObjectNode stored = storedByQuestion.get(question.id());
            if (stored == null) {
                continue;
            }
            QuizCbeGradeResponse.Question out = new QuizCbeGradeResponse.Question();
            String state = QuizCbeRows.state(stored);
            out.setQuestionId(question.id());
            out.setState(state);
            out.setResponseStatus(statusByQuestion.get(question.id()));
            out.setMarks(number(stored.get("marks")));
            out.setMaxMarks(stored.path("maxMarks").isNumber() ? stored.get("maxMarks").asDouble()
                    : question.maxMarks());
            JsonNode evaluation = stored.get("evaluation");
            out.setEvaluation(evaluation != null && evaluation.isObject()
                    ? CbeSlideSubmitService.learnerEvaluationOf(evaluation) : null);
            String error = stored.path("error").asText(null);
            out.setErrorCode(QuizCbeRows.STATE_FAILED.equals(state) ? error : null);
            out.setMessage(message(state, error, maxChecks));
            out.setChecksUsed((int) repository.countChecksUsed(userId, slideId, question.id(), ""));
            out.setMaxChecks(maxChecks);
            if (showSolutions) {
                out.setSolution(question.solution());
            }
            if (includeAnswer) {
                JsonNode answer = stored.get("answer");
                out.setAnswer(answer != null && answer.isObject() ? answer : null);
            }
            response.getQuestions().add(out);
        }
        return response;
    }

    private QuizCbeGradeResponse emptyResponse(String slideId, String attemptId) {
        QuizCbeGradeResponse response = new QuizCbeGradeResponse();
        response.setSlideId(slideId);
        response.setAttemptId(attemptId);
        return response;
    }

    private static String message(String state, String errorCode, int maxChecks) {
        return switch (state) {
            case QuizCbeRows.STATE_FAILED -> CbeSlideSubmitService.ERROR_NO_CREDITS.equals(errorCode)
                    ? "Your answer is saved, but it could not be checked because the institute has run out of AI credits."
                    : "Your answer is saved, but the AI check did not finish. Please try again.";
            case QuizCbeRows.STATE_UNATTEMPTED -> "Your answer is the same as the starting template, so it was not marked.";
            case QuizCbeRows.STATE_NO_CHECKS_LEFT -> "You have used all " + maxChecks
                    + " AI checks for this question, so this answer was not marked.";
            case QuizCbeRows.STATE_EVALUATING, QuizCbeRows.STATE_PENDING -> "Your answer is being checked.";
            default -> null;
        };
    }

    private boolean showSolutions(QuizReviewPolicy.QuizSettings settings, String userId, String slideId,
            Integer reAttemptCount) {
        int used = (int) quizRepository.countQuizAttempts(userId, slideId);
        Integer left = reAttemptCount == null ? null : Integer.valueOf(Math.max(0, reAttemptCount - used));
        return reviewPolicy.mayShowAnswers(settings, used, left);
    }

    // ------------------------------------------------------------------ helpers

    static int maxChecks(Integer reAttemptCount) {
        return reAttemptCount != null && reAttemptCount > 0 ? reAttemptCount : DEFAULT_MAX_CHECKS;
    }

    /**
     * ai_service marks out of the parts' total; the quiz counts the question out of its own
     * marks. The two are equal for a question saved by the editor; otherwise scale, and keep
     * the result within 0 and the question's maximum.
     */
    static double scaledMarks(Double awarded, double gradingMaxMarks, double maxMarks) {
        if (awarded == null || awarded.isNaN()) {
            return 0;
        }
        double marks = gradingMaxMarks > 0 && Math.abs(gradingMaxMarks - maxMarks) > 1e-9
                ? awarded * maxMarks / gradingMaxMarks : awarded;
        return Math.max(0, Math.min(maxMarks, marks));
    }

    private static String requireUser(CustomUserDetails user) {
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            throw new ForbiddenException("Sign in to see your answers checked");
        }
        return user.getUserId();
    }

    private static String htmlOrEmpty(String html) {
        return StringUtils.hasText(html) ? html : "";
    }

    private static Double number(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        if (node.isNumber()) {
            return node.asDouble();
        }
        try {
            return Double.parseDouble(node.asText().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
