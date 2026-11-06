package vacademy.io.admin_core_service.features.learner_quiz.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAnswerCheckRequest;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAnswerCheckResponse;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse.AnswerKey;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse.AttemptSummary;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse.QuestionResult;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse.Status;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptSubmitRequest;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.CheckableQuestionRow;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.RecordedAnswerRow;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizLoader.LoadedQuiz;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizSideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuizSlideQuestionTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuizSlideQuestionTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.i18n.LocaleRegistry;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import org.springframework.context.i18n.LocaleContextHolder;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Grades a learner's quiz attempt on the server and reads it back.
 *
 * <p>An attempt is what it has always been: an activity_log row, whose id the client chooses
 * so a retry of the same attempt lands on the same row, and one quiz_slide_question_tracked
 * row per question. Quiz Results, the activity dialog, LLM analytics and progress therefore
 * read these exactly as they read older attempts, and response_json keeps its shape.
 */
@Slf4j
@Service
public class LearnerQuizAttemptService {

    private static final Pattern ATTEMPT_ID = Pattern.compile("^[0-9a-fA-F-]{36}$");
    private static final int MAX_TEXT_ANSWER_CHARS = 20_000;

    private final LearnerQuizAttemptRepository repository;
    private final ActivityLogRepository activityLogRepository;
    private final QuizSlideQuestionTrackedRepository trackedRepository;
    private final LearnerTrackingAsyncService asyncService;
    private final LearnerQuizAccessService accessService;
    private final QuizReviewPolicy reviewPolicy;
    private final QuizLoader quizLoader;
    private final QuizGrader grader;
    private final AutoEvaluationScorer scorer;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public LearnerQuizAttemptService(LearnerQuizAttemptRepository repository,
            ActivityLogRepository activityLogRepository,
            QuizSlideQuestionTrackedRepository trackedRepository,
            LearnerTrackingAsyncService asyncService,
            LearnerQuizAccessService accessService,
            QuizReviewPolicy reviewPolicy,
            QuizLoader quizLoader,
            QuizGrader grader,
            AutoEvaluationScorer scorer,
            ObjectMapper objectMapper,
            PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.activityLogRepository = activityLogRepository;
        this.trackedRepository = trackedRepository;
        this.asyncService = asyncService;
        this.accessService = accessService;
        this.reviewPolicy = reviewPolicy;
        this.quizLoader = quizLoader;
        this.grader = grader;
        this.objectMapper = objectMapper;
        this.scorer = scorer;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    // ---------------------------------------------------------------------- submit

    private record WriteOutcome(Status status, ActivityLogDTO dtoForHooks) {
    }

    public QuizAttemptResultResponse submit(QuizAttemptSubmitRequest request, CustomUserDetails user,
            String clientInstituteId) {
        validate(request);
        String slideId = request.getSlideId();
        LoadedQuiz quiz = quizLoader.load(slideId)
                .filter(q -> isLive(q.meta().getSlideStatus()))
                .orElseThrow(() -> new ResourceNotFoundException("This quiz is no longer available"));
        LearnerQuizAccessService.Access access = accessService.requireAccess(user, slideId, clientInstituteId,
                request.getPackageSessionId(), request.getChapterId());

        WriteOutcome outcome;
        try {
            outcome = transactionTemplate.execute(status -> write(request, user.getUserId(), quiz));
        } catch (DataIntegrityViolationException raced) {
            // Only reachable when an older path wrote this same id between the check and
            // the insert: that attempt is now recorded, so this retry reads it back.
            log.info("[quiz-attempt] attempt {} written concurrently: {}", request.getAttemptId(), raced.getMessage());
            outcome = new WriteOutcome(Status.ALREADY_GRADED, null);
        }

        if (outcome.dtoForHooks() != null) {
            runAfterCommitHooks(user.getUserId(), request, access, outcome.dtoForHooks());
        }
        return buildResult(outcome.status(), request.getAttemptId(), user.getUserId(), slideId, quiz,
                access.instituteId());
    }

    /** Runs inside one short transaction: no remote call belongs in here. */
    private WriteOutcome write(QuizAttemptSubmitRequest request, String userId, LoadedQuiz quiz) {
        String slideId = request.getSlideId();
        repository.lockLearnerOnQuiz("quiz-attempt|" + userId + "|" + slideId);

        ActivityLog existing = activityLogRepository.findById(request.getAttemptId()).orElse(null);
        if (existing != null) {
            if (!Objects.equals(existing.getUserId(), userId) || !Objects.equals(existing.getSlideId(), slideId)
                    || !"QUIZ".equals(existing.getSourceType())) {
                log.warn("[quiz-attempt] user {} sent attempt id {} that belongs elsewhere", userId, existing.getId());
                throw new ConflictException("This attempt id cannot be used");
            }
            if (trackedRepository.countByActivityLogId(existing.getId()) > 0) {
                return new WriteOutcome(Status.ALREADY_GRADED, null);
            }
            // A row with no answers: an earlier write stopped halfway. Finish it.
        } else {
            Integer cap = quiz.meta().getReAttemptCount();
            if (cap != null && repository.countQuizAttempts(userId, slideId) >= cap) {
                return new WriteOutcome(Status.ATTEMPTS_EXHAUSTED, null);
            }
        }

        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setId(request.getAttemptId());
        dto.setSourceId(slideId);
        dto.setSourceType("QUIZ");
        dto.setUserId(userId);
        dto.setSlideId(slideId);
        dto.setStartTimeInMillis(request.getStartTimeInMillis());
        dto.setEndTimeInMillis(request.getEndTimeInMillis() != null ? request.getEndTimeInMillis()
                : Long.valueOf(System.currentTimeMillis()));
        dto.setPercentageWatched(100.0);
        dto.setNewActivity(true);
        dto.setQuizSides(new ArrayList<>());

        ActivityLog activityLog = activityLogRepository.saveAndFlush(new ActivityLog(dto, userId, slideId));
        Map<String, QuizAttemptSubmitRequest.Answer> answers = answersByQuestion(request);
        List<QuizSlideQuestionTracked> rows = new ArrayList<>();
        for (QuizGrader.Question question : quiz.questions()) {
            QuizGrader.Graded graded = grader.grade(question, quiz.rules(), selection(answers.get(question.id())),
                    QuizGrader.GRADED_BY_SERVER);
            QuizSideActivityLogDTO side = new QuizSideActivityLogDTO();
            side.setId(UUID.nameUUIDFromBytes((request.getAttemptId() + "|" + question.id())
                    .getBytes(StandardCharsets.UTF_8)).toString());
            side.setActivityId(request.getAttemptId());
            side.setQuestionId(question.id());
            side.setResponseJson(graded.responseJson());
            side.setResponseStatus(graded.responseStatus());
            dto.getQuizSides().add(side);
            rows.add(new QuizSlideQuestionTracked(side, activityLog));
        }
        trackedRepository.saveAllAndFlush(rows);
        return new WriteOutcome(Status.GRADED, dto);
    }

    /** Progress and analytics, after commit so they see the rows just written. */
    private void runAfterCommitHooks(String userId, QuizAttemptSubmitRequest request,
            LearnerQuizAccessService.Access access, ActivityLogDTO dto) {
        try {
            asyncService.updateLearnerOperationsForQuiz(userId, request.getSlideId(), access.chapterId(),
                    request.getModuleId(), request.getSubjectId(), access.packageSessionId(), dto);
            asyncService.saveLLMQuizDataAsync(request.getAttemptId(), request.getSlideId(), access.chapterId(),
                    access.packageSessionId(), request.getSubjectId(), dto);
        } catch (RuntimeException e) {
            // The attempt is safely recorded; a rejected background task must not read as a failed submit.
            log.error("[quiz-attempt] after-commit work failed for attempt {}", request.getAttemptId(), e);
        }
    }

    private static boolean isLive(String slideStatus) {
        return "PUBLISHED".equals(slideStatus) || "UNSYNC".equals(slideStatus);
    }

    private static void validate(QuizAttemptSubmitRequest request) {
        if (request == null || !StringUtils.hasText(request.getSlideId())) {
            throw new InvalidRequestException("slide_id is required");
        }
        if (request.getAttemptId() == null || !ATTEMPT_ID.matcher(request.getAttemptId()).matches()) {
            throw new InvalidRequestException("attempt_id must be a UUID");
        }
        if (request.getAnswers() != null) {
            for (QuizAttemptSubmitRequest.Answer answer : request.getAnswers()) {
                if (answer != null && answer.getTextAnswer() != null
                        && answer.getTextAnswer().length() > MAX_TEXT_ANSWER_CHARS) {
                    throw new InvalidRequestException("An answer is too long");
                }
            }
        }
    }

    private static Map<String, QuizAttemptSubmitRequest.Answer> answersByQuestion(QuizAttemptSubmitRequest request) {
        Map<String, QuizAttemptSubmitRequest.Answer> answers = new HashMap<>();
        if (request.getAnswers() != null) {
            for (QuizAttemptSubmitRequest.Answer answer : request.getAnswers()) {
                if (answer != null && answer.getQuestionId() != null) {
                    answers.put(answer.getQuestionId(), answer);
                }
            }
        }
        return answers;
    }

    private static List<String> selection(QuizAttemptSubmitRequest.Answer answer) {
        if (answer == null) {
            return List.of();
        }
        if (answer.getSelectedOptionIds() != null && !answer.getSelectedOptionIds().isEmpty()) {
            return answer.getSelectedOptionIds();
        }
        return StringUtils.hasText(answer.getTextAnswer()) ? List.of(answer.getTextAnswer()) : List.of();
    }

    // ---------------------------------------------------------------------- read

    /**
     * The learner's standing on this quiz. Only ever their own attempts. Reads the primary
     * database, not a replica: this runs right after a submit and must see it.
     */
    public QuizAttemptResultResponse getResult(String slideId, CustomUserDetails user, String clientInstituteId) {
        if (!StringUtils.hasText(slideId)) {
            throw new InvalidRequestException("slideId is required");
        }
        LoadedQuiz quiz = quizLoader.load(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("This quiz is no longer available"));
        // A learner whose access has ended can still read back what they submitted.
        String instituteId = resolveInstituteForRead(slideId, user, clientInstituteId);
        return buildResult(Status.RESULT, null, user.getUserId(), slideId, quiz, instituteId);
    }

    private String resolveInstituteForRead(String slideId, CustomUserDetails user, String clientInstituteId) {
        try {
            return accessService.requireAccess(user, slideId, clientInstituteId, null, null).instituteId();
        } catch (ForbiddenException noLiveAccess) {
            List<String> institutes = repository.findInstitutesOfSlide(slideId);
            return institutes.contains(clientInstituteId) || institutes.isEmpty() ? clientInstituteId
                    : institutes.get(0);
        }
    }

    private QuizAttemptResultResponse buildResult(Status status, String attemptId, String userId, String slideId,
            LoadedQuiz quiz, String instituteId) {
        List<AttemptSummary> attempts = summarise(repository.findRecordedAnswers(userId, slideId), quiz);
        Integer cap = quiz.meta().getReAttemptCount();
        int used = attempts.size();
        Integer left = cap == null ? null : Integer.valueOf(Math.max(0, cap - used));
        QuizReviewPolicy.QuizSettings settings = reviewPolicy.settingsOf(instituteId);
        boolean showAnswers = reviewPolicy.mayShowAnswers(settings, used, left);
        return QuizAttemptResultResponse.builder()
                .status(status)
                .attemptId(attemptId != null ? attemptId : attempts.isEmpty() ? null : attempts.get(0).getAttemptId())
                .attemptsUsed(used)
                .maxAttempts(cap)
                .attemptsLeft(left)
                .canAttempt(cap == null || used < cap)
                .passPercentage(quiz.meta().getPassPercentage())
                .showAnswers(showAnswers)
                .attempts(attempts)
                .answerKeys(showAnswers ? answerKeys(quiz) : List.of())
                .build();
    }

    private List<AnswerKey> answerKeys(LoadedQuiz quiz) {
        List<AnswerKey> keys = new ArrayList<>();
        for (QuizGrader.Question question : quiz.questions()) {
            keys.add(AnswerKey.builder()
                    .questionId(question.id())
                    .correctOptionIds(new ArrayList<>(scorer.correctAnswerIdsForQuestionType(question.questionType(),
                            question.autoEvaluationJson(), question::optionIds)))
                    .correctAnswerText(scorer.modelAnswerText(question.autoEvaluationJson()))
                    .explanation(question.explanation())
                    .build());
        }
        return keys;
    }

    /**
     * Scores stored attempts the way the review screen always has: recorded marks win, and
     * older rows without them score 1 per correct answer against the current key.
     */
    private List<AttemptSummary> summarise(List<RecordedAnswerRow> rows, LoadedQuiz quiz) {
        Map<String, QuizGrader.Question> questions = new HashMap<>();
        quiz.questions().forEach(q -> questions.put(q.id(), q));

        Map<String, List<RecordedAnswerRow>> byAttempt = new LinkedHashMap<>();
        rows.forEach(row -> byAttempt.computeIfAbsent(row.getAttemptId(), k -> new ArrayList<>()).add(row));

        List<AttemptSummary> summaries = new ArrayList<>();
        for (Map.Entry<String, List<RecordedAnswerRow>> attempt : byAttempt.entrySet()) {
            double earned = 0;
            double total = 0;
            int correct = 0;
            int partial = 0;
            int wrong = 0;
            int skipped = 0;
            int pending = 0;
            List<QuestionResult> results = new ArrayList<>();
            Timestamp at = null;
            Set<String> seen = new LinkedHashSet<>();
            for (RecordedAnswerRow row : attempt.getValue()) {
                at = row.getEndTime() != null ? row.getEndTime() : row.getCreatedAt();
                if (row.getQuestionId() == null || !seen.add(row.getQuestionId())) {
                    continue;
                }
                QuestionResult result = resultOf(row, questions.get(row.getQuestionId()));
                results.add(result);
                earned += result.getMarks();
                total += result.getMaxMarks();
                switch (result.getOutcome()) {
                    case "CORRECT" -> correct++;
                    case "PARTIAL" -> partial++;
                    case "WRONG" -> wrong++;
                    case "SKIPPED" -> skipped++;
                    default -> pending++;
                }
            }
            double floored = Math.max(0, earned);
            summaries.add(AttemptSummary.builder()
                    .attemptId(attempt.getKey())
                    .submittedAtMillis(at == null ? null : at.getTime())
                    .earned(floored)
                    .totalMarks(total)
                    .correct(correct)
                    .partial(partial)
                    .wrong(wrong)
                    .skipped(skipped)
                    .pending(pending)
                    .passed(QuizGrader.passed(floored, total, pending, quiz.meta().getPassPercentage()))
                    .questions(results)
                    .build());
        }
        return summaries;
    }

    private QuestionResult resultOf(RecordedAnswerRow row, QuizGrader.Question question) {
        String status = row.getResponseStatus() == null ? "" : row.getResponseStatus().trim().toUpperCase();
        JsonNode stored = parse(row.getResponseJson());
        if (stored != null && stored.path("maxMarks").isNumber()) {
            double max = stored.path("maxMarks").asDouble();
            double marks = stored.path("marks").isNumber() ? stored.path("marks").asDouble()
                    : stored.path("isCorrect").asBoolean(false) ? max : 0;
            return QuestionResult.builder()
                    .questionId(row.getQuestionId())
                    .outcome(recordedOutcome(status, stored, question, row.getResponseJson()))
                    .marks(marks)
                    .maxMarks(max)
                    .build();
        }
        // Older rows: no marks recorded. One mark per correct answer, on the current key.
        AutoEvaluationScorer.Verdict verdict = question == null ? AutoEvaluationScorer.Verdict.UNKNOWN
                : scorer.evaluateForQuestionType(question.questionType(), question.autoEvaluationJson(),
                        row.getResponseJson(), question::optionIds);
        String outcome = switch (verdict) {
            case CORRECT -> "CORRECT";
            case WRONG -> "WRONG";
            case SKIPPED -> "SKIPPED";
            case UNKNOWN -> "PENDING";
        };
        return QuestionResult.builder()
                .questionId(row.getQuestionId())
                .outcome(outcome)
                .marks(verdict == AutoEvaluationScorer.Verdict.CORRECT ? 1 : 0)
                .maxMarks(1)
                .build();
    }

    private String recordedOutcome(String status, JsonNode stored, QuizGrader.Question question, String responseJson) {
        if ("CORRECT".equals(status) || stored.path("isCorrect").asBoolean(false)) {
            return "CORRECT";
        }
        if (stored.path("isPartial").asBoolean(false) && stored.path("marks").asDouble(0) > 0) {
            return "PARTIAL";
        }
        if ("SKIPPED".equals(status)) {
            return "SKIPPED";
        }
        if ("SUBMITTED".equals(status)
                || (question != null && AutoEvaluationScorer.isFreeText(question.questionType()))) {
            boolean answered = !scorer.selectedAnswerIds(responseJson).isEmpty();
            return answered ? "PENDING" : "SKIPPED";
        }
        return "WRONG";
    }

    private JsonNode parse(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------------------------------------------------------------- one-answer check

    /**
     * Whether one answer is right, without recording anything. Quiz questions answer only
     * while the institute uses "move on only after a correct answer", and say nothing past
     * the verdict. Question and video slides have always shown their guidance straight after
     * answering, so they get it here.
     */
    public QuizAnswerCheckResponse checkAnswer(QuizAnswerCheckRequest request, CustomUserDetails user,
            String clientInstituteId) {
        if (request == null || !StringUtils.hasText(request.getSlideId())
                || !StringUtils.hasText(request.getQuestionId())) {
            throw new InvalidRequestException("slide_id and question_id are required");
        }
        String slideId = request.getSlideId();
        LearnerQuizAccessService.Access access = accessService.requireAccess(user, slideId, clientInstituteId, null,
                null);
        String sourceType = repository.findSlideSourceType(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("Slide not found"));
        String responseJson = responseJsonOf(request);
        return switch (sourceType) {
            case "QUIZ" -> checkQuizAnswer(request, slideId, access, responseJson);
            case "QUESTION", "VIDEO" -> checkSlideAnswer(request, slideId, sourceType, responseJson);
            default -> throw new InvalidRequestException("This slide has no questions to check");
        };
    }

    private QuizAnswerCheckResponse checkQuizAnswer(QuizAnswerCheckRequest request, String slideId,
            LearnerQuizAccessService.Access access, String responseJson) {
        QuizReviewPolicy.QuizSettings settings = reviewPolicy.settingsOf(access.instituteId());
        if (settings.showReportAndCorrectAnswers() || !settings.moveOnlyOnCorrectAnswer()) {
            throw new ForbiddenException("Answers are checked when the quiz is submitted");
        }
        LoadedQuiz quiz = quizLoader.load(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("Slide not found"));
        QuizGrader.Question question = quiz.questions().stream()
                .filter(q -> q.id().equals(request.getQuestionId()))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Question not found"));
        AutoEvaluationScorer.Verdict verdict = scorer.evaluateForQuestionType(question.questionType(),
                question.autoEvaluationJson(), responseJson, question::optionIds);
        return QuizAnswerCheckResponse.builder().correct(verdictToBoolean(verdict)).build();
    }

    private QuizAnswerCheckResponse checkSlideAnswer(QuizAnswerCheckRequest request, String slideId, String sourceType,
            String responseJson) {
        String lang = LocaleRegistry.normalize(LocaleContextHolder.getLocale().toLanguageTag());
        CheckableQuestionRow question = ("QUESTION".equals(sourceType)
                ? repository.findQuestionSlideQuestion(slideId, request.getQuestionId(), lang)
                : repository.findVideoSlideQuestion(slideId, request.getQuestionId(), lang))
                .orElseThrow(() -> new ResourceNotFoundException("Question not found"));
        // Guidance is for someone who has answered: no answer, nothing back.
        if (!StringUtils.hasText(request.getTextAnswer())
                && (request.getSelectedOptionIds() == null || request.getSelectedOptionIds().isEmpty())) {
            return QuizAnswerCheckResponse.builder().correct(Boolean.FALSE).build();
        }
        // These keys store ids, never positions, so the option list is not consulted.
        AutoEvaluationScorer.Verdict verdict = scorer.evaluateForQuestionType(question.getQuestionType(),
                question.getAutoEvaluationJson(), responseJson, List::of);
        return QuizAnswerCheckResponse.builder()
                .correct(verdictToBoolean(verdict))
                .correctOptionIds(new ArrayList<>(scorer.correctAnswerIdsForQuestionType(question.getQuestionType(),
                        question.getAutoEvaluationJson(), List::of)))
                .correctAnswerText(scorer.modelAnswerText(question.getAutoEvaluationJson()))
                .explanation(question.getExplanationContent())
                .build();
    }

    private static Boolean verdictToBoolean(AutoEvaluationScorer.Verdict verdict) {
        return switch (verdict) {
            case CORRECT -> Boolean.TRUE;
            case WRONG, SKIPPED -> Boolean.FALSE;
            case UNKNOWN -> null;
        };
    }

    private String responseJsonOf(QuizAnswerCheckRequest request) {
        List<String> selected = request.getSelectedOptionIds() != null && !request.getSelectedOptionIds().isEmpty()
                ? request.getSelectedOptionIds()
                : StringUtils.hasText(request.getTextAnswer()) ? List.of(request.getTextAnswer()) : List.of();
        var root = objectMapper.createObjectNode();
        var ids = root.putArray("selected_option_ids");
        selected.forEach(ids::add);
        return root.toString();
    }
}
