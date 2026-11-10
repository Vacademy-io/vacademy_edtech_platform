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
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.CbeAttemptResponse;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.CbeSubmitRequest;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuestionSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuestionSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.admin_core_service.features.slide.cbe.CbeConfigSecrets;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Spreadsheet &amp; Written Response ({@code CBE_RESPONSE}) question slides: the learner
 * submits, ai_service grades synchronously, the learner gets marks, line feedback and the
 * model solution at once. docs/CBE_RESPONSE_QUESTION.md section 5.2.
 *
 * <p>An attempt is what a question-slide answer has always been: one activity_log row
 * (source_type QUESTION) and one question_slide_tracked row, whose response_json is
 * {@code {type, answer, evaluation}}. The tracked row is written first as EVALUATING, which
 * reserves the attempt under a per-learner lock so two tabs cannot pass the cap, and is
 * finished as EVALUATED or EVALUATION_FAILED after the call. No transaction is open during
 * the call.
 *
 * <p>Only an AI check that happened uses an attempt: an answer saved while the institute had
 * no credits, or when grading failed, can be submitted again.
 */
@Slf4j
@Service
public class CbeSlideSubmitService {

    public static final int DEFAULT_MAX_ATTEMPTS = 3;

    public static final String STATUS_EVALUATING = "EVALUATING";
    public static final String STATUS_EVALUATED = "EVALUATED";
    public static final String STATUS_FAILED = "EVALUATION_FAILED";

    public static final String ERROR_NO_CREDITS = "NO_CREDITS";
    public static final String ERROR_FAILED = "EVALUATION_FAILED";
    /** ai_service found nothing beyond the starting template: not graded, no attempt used. */
    public static final String ERROR_UNATTEMPTED = "UNATTEMPTED";

    /** The evaluation a learner may see (contract section 5.2); anything else ai_service adds stays out. */
    private static final List<String> EVALUATION_FIELDS =
            List.of("marks_awarded", "max_marks", "verdict", "feedback");
    private static final List<String> CRITERION_FIELDS = List.of("criteria_name", "marks", "max_marks", "reason");

    /** The outcome of a submit: the HTTP status to answer with and the body. */
    public record Outcome(int httpStatus, CbeAttemptResponse body) {
    }

    private record Prepared(LearnerQuizAccessService.Access access, int maxAttempts, Double maxMarks,
            JsonNode fullConfig, String questionText, String scenarioText, JsonNode solution) {
    }

    private record Reserved(String activityId, String trackedId, int attemptNumber, long checksUsedBefore) {
    }

    private final SlideRepository slideRepository;
    private final QuestionSlideRepository questionSlideRepository;
    private final QuestionSlideTrackedRepository trackedRepository;
    private final ActivityLogRepository activityLogRepository;
    private final LearnerQuizAttemptRepository lockRepository;
    private final LearnerQuizAccessService accessService;
    private final LearnerTrackingAsyncService asyncService;
    private final CbeGradingClient gradingClient;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public CbeSlideSubmitService(SlideRepository slideRepository,
            QuestionSlideRepository questionSlideRepository,
            QuestionSlideTrackedRepository trackedRepository,
            ActivityLogRepository activityLogRepository,
            LearnerQuizAttemptRepository lockRepository,
            LearnerQuizAccessService accessService,
            LearnerTrackingAsyncService asyncService,
            CbeGradingClient gradingClient,
            ObjectMapper objectMapper,
            PlatformTransactionManager transactionManager) {
        this.slideRepository = slideRepository;
        this.questionSlideRepository = questionSlideRepository;
        this.trackedRepository = trackedRepository;
        this.activityLogRepository = activityLogRepository;
        this.lockRepository = lockRepository;
        this.accessService = accessService;
        this.asyncService = asyncService;
        this.gradingClient = gradingClient;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    // ------------------------------------------------------------------ submit

    public Outcome submit(CbeSubmitRequest request, CustomUserDetails user, String clientInstituteId) {
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            throw new ForbiddenException("Sign in to submit");
        }
        if (request == null || !StringUtils.hasText(request.getSlideId())) {
            throw new InvalidRequestException("slide_id is required");
        }
        JsonNode answer = request.getAnswer();
        if (answer == null || !answer.isObject() || !answer.path("parts").isObject()) {
            throw new InvalidRequestException("answer.parts is required");
        }
        // Before an attempt is reserved: an empty answer is never an AI check (and so can
        // never unlock the model solution).
        if (!hasAnyContent(answer)) {
            throw new InvalidRequestException("Write an answer before submitting");
        }
        String userId = user.getUserId();
        String slideId = request.getSlideId();

        // Reads in a short transaction of their own, so no connection is held across the AI call.
        Prepared prepared = transactionTemplate.execute(tx -> prepare(request, user, clientInstituteId));
        LearnerQuizAccessService.Access access = prepared.access();
        int maxAttempts = prepared.maxAttempts();

        Reserved reserved = transactionTemplate.execute(status -> reserve(request, userId, slideId, maxAttempts));
        if (reserved == null) {
            throw new ConflictException("You have used all " + maxAttempts + " AI checks for this question");
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("institute_id", access.instituteId());
        body.put("user_id", userId);
        body.put("source_id", slideId);
        body.put("question_text", prepared.questionText());
        body.put("scenario_text", prepared.scenarioText());
        body.put("config", prepared.fullConfig());
        body.put("answer", answer);
        body.put("max_marks", prepared.maxMarks());

        JsonNode evaluation = null;
        String status;
        String errorCode = null;
        String message = null;
        Double marks = null;
        int httpStatus = 200;
        try {
            Map<String, Object> graded = gradingClient.grade(body);
            JsonNode reply = objectMapper.valueToTree(graded);
            if (ERROR_UNATTEMPTED.equalsIgnoreCase(reply.path("verdict").asText(""))) {
                // Nothing beyond the starting template: ai_service did not grade or charge.
                status = STATUS_FAILED;
                errorCode = ERROR_UNATTEMPTED;
                message = "Your answer is the same as the starting template. Add your work, then submit.";
            } else {
                evaluation = learnerEvaluation(reply);
                marks = number(evaluation.get("marks_awarded"));
                status = STATUS_EVALUATED;
            }
        } catch (CbeGradingClient.NoCreditsException e) {
            log.info("[cbe-submit] institute {} out of AI credits; answer saved ungraded (slide {}, user {})",
                    access.instituteId(), slideId, userId);
            status = STATUS_FAILED;
            errorCode = ERROR_NO_CREDITS;
            message = "Your answer is saved, but it could not be checked because the institute has run out of AI credits.";
            httpStatus = 402;
        } catch (RuntimeException e) {
            log.error("[cbe-submit] grading failed for slide {} user {}", slideId, userId, e);
            status = STATUS_FAILED;
            errorCode = ERROR_FAILED;
            message = "Your answer is saved, but the AI check did not finish. Please try again.";
        }

        String finalStatus = status;
        JsonNode finalEvaluation = evaluation;
        Double finalMarks = marks;
        String finalError = errorCode;
        // The stored row's created_at, as my-attempts and last_evaluated report it, so the submit
        // reply and a later reload show the same submission time.
        Long submittedAtMillis = transactionTemplate.execute(tx -> finish(reserved.trackedId(), answer,
                finalEvaluation, finalMarks, finalStatus, finalError));

        runCompletionCascade(userId, slideId, request, access, reserved, answer, finalStatus, finalMarks);

        int checksUsed = (int) reserved.checksUsedBefore() + (STATUS_EVALUATED.equals(finalStatus) ? 1 : 0);
        CbeAttemptResponse response = new CbeAttemptResponse();
        response.setSlideId(slideId);
        response.setActivityId(reserved.activityId());
        response.setAttemptNumber(reserved.attemptNumber());
        response.setMaxAttempts(maxAttempts);
        response.setAttemptsUsed(checksUsed);
        response.setAttemptsLeft(Math.max(0, maxAttempts - checksUsed));
        response.setSubmissions(reserved.attemptNumber());
        response.setResponseStatus(finalStatus);
        response.setMarks(finalMarks);
        response.setSubmittedAtMillis(submittedAtMillis != null ? submittedAtMillis : System.currentTimeMillis());
        response.setEvaluation(finalEvaluation);
        // The model solution is only revealed once the learner has had at least one graded AI
        // check; an answer saved during a credit refusal or grading failure must not unlock it.
        if (checksUsed > 0) {
            response.setSolution(prepared.solution());
        }
        response.setMessage(message);
        response.setErrorCode(finalError);
        if (!STATUS_EVALUATED.equals(finalStatus)) {
            response.setLastEvaluated(transactionTemplate.execute(tx -> lastEvaluated(userId, slideId)));
        }
        return new Outcome(httpStatus, response);
    }

    private Prepared prepare(CbeSubmitRequest request, CustomUserDetails user, String clientInstituteId) {
        String slideId = request.getSlideId();
        Slide slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("This question is no longer available"));
        if (!isLive(slide.getStatus())) {
            throw new ResourceNotFoundException("This question is no longer available");
        }
        QuestionSlide question = loadCbeQuestion(slide);
        LearnerQuizAccessService.Access access = accessService.requireAccess(user, slideId, clientInstituteId,
                request.getPackageSessionId(), request.getChapterId());
        String fullConfig = CbeConfigSecrets.merge(question.getAutoEvaluationJson(),
                question.getEvaluationSecretJson());
        // The requirement and scenario go to ai_service as the editor's HTML: its
        // cbe_render.html_to_text is the one HTML-to-text step (paragraphs, lists, TipTap
        // tables as "| a | b |" rows), so nothing is converted twice.
        return new Prepared(access, maxAttempts(question), maxMarks(fullConfig, question),
                readTree(fullConfig),
                htmlOrEmpty(question.getTextData() == null ? null : question.getTextData().getContent()),
                htmlOrEmpty(question.getParentRichText() == null ? null
                        : question.getParentRichText().getContent()),
                CbeConfigSecrets.solutionForLearner(question.getEvaluationSecretJson()));
    }

    /**
     * Inside one short transaction, under a lock on this learner and slide: refuses when the
     * AI checks are used up (returns null), otherwise writes the attempt as EVALUATING so a
     * second tab sees it counted.
     */
    private Reserved reserve(CbeSubmitRequest request, String userId, String slideId, int maxAttempts) {
        lockRepository.lockLearnerOnQuiz("cbe-attempt|" + userId + "|" + slideId);
        long checksUsed = trackedRepository.countCbeChecksUsed(userId, slideId);
        if (checksUsed >= maxAttempts) {
            return null;
        }
        long submissions = trackedRepository.countCbeSubmissions(userId, slideId);
        int attemptNumber = (int) submissions + 1;

        long now = System.currentTimeMillis();
        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setId(UUID.randomUUID().toString());
        dto.setSourceId(slideId);
        dto.setSourceType(SlideTypeEnum.QUESTION.name());
        dto.setUserId(userId);
        dto.setSlideId(slideId);
        dto.setStartTimeInMillis(request.getStartTimeInMillis() != null && request.getStartTimeInMillis() <= now
                ? request.getStartTimeInMillis() : Long.valueOf(now));
        dto.setEndTimeInMillis(now);
        dto.setPercentageWatched(100.0);
        dto.setNewActivity(true);
        ActivityLog activityLog = activityLogRepository.saveAndFlush(new ActivityLog(dto, userId, slideId));

        QuestionSlideTracked tracked = new QuestionSlideTracked();
        tracked.setId(UUID.randomUUID().toString());
        tracked.setActivityLog(activityLog);
        tracked.setAttemptNumber(attemptNumber);
        tracked.setResponseStatus(STATUS_EVALUATING);
        tracked.setResponseJson(responseJson(request.getAnswer(), null, null));
        trackedRepository.saveAndFlush(tracked);
        return new Reserved(activityLog.getId(), tracked.getId(), attemptNumber, checksUsed);
    }

    /**
     * Writes the outcome onto the reserved row and returns that row's created_at in millis, or
     * null when unknown. created_at is the database default and is read with a scalar query:
     * under open-in-view, findById here returns the entity reserve() saved, whose createdAt was
     * never loaded.
     */
    private Long finish(String trackedId, JsonNode answer, JsonNode evaluation, Double marks, String status,
            String errorCode) {
        QuestionSlideTracked tracked = trackedRepository.findById(trackedId)
                .orElseThrow(() -> new IllegalStateException("CBE attempt " + trackedId + " vanished"));
        tracked.setResponseJson(responseJson(answer, evaluation, errorCode));
        tracked.setMarks(marks);
        tracked.setResponseStatus(status);
        trackedRepository.save(tracked);
        return trackedRepository.findCreatedAtById(trackedId).map(Timestamp::getTime).orElse(null);
    }

    /**
     * Submitting is completion, as for every question slide: the slide goes to 100% and the
     * chapter, module, subject and course roll up, on the existing async path. The batch and
     * chapter come from the membership the access check chose, not only from the client.
     */
    private void runCompletionCascade(String userId, String slideId, CbeSubmitRequest request,
            LearnerQuizAccessService.Access access, Reserved reserved, JsonNode answer, String status, Double marks) {
        try {
            ActivityLogDTO hookDto = new ActivityLogDTO();
            hookDto.setId(reserved.activityId());
            hookDto.setSlideId(slideId);
            hookDto.setSourceId(slideId);
            hookDto.setSourceType(SlideTypeEnum.QUESTION.name());
            hookDto.setUserId(userId);
            hookDto.setPercentageWatched(100.0);
            QuestionSlideActivityLogDTO side = new QuestionSlideActivityLogDTO();
            side.setId(reserved.trackedId());
            side.setAttemptNumber(reserved.attemptNumber());
            side.setResponseStatus(status);
            side.setMarks(marks);
            List<QuestionSlideActivityLogDTO> sides = new ArrayList<>();
            sides.add(side);
            hookDto.setQuestionSlides(sides);

            String chapterId = firstText(access.chapterId(), request.getChapterId());
            String packageSessionId = firstText(access.packageSessionId(), request.getPackageSessionId());
            asyncService.updateLearnerOperationsForQuestion(userId, slideId, chapterId, request.getModuleId(),
                    request.getSubjectId(), packageSessionId, hookDto);
        } catch (RuntimeException e) {
            // The attempt is recorded; a rejected background task must not read as a failed submit.
            log.error("[cbe-submit] progress cascade failed for slide {} user {}", slideId, userId, e);
        }
    }

    // ------------------------------------------------------------------ read

    /** The learner's latest attempt, attempts used and left, and the solution once submitted. */
    public CbeAttemptResponse myAttempts(String slideId, CustomUserDetails user) {
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            throw new ForbiddenException("Sign in to see your attempts");
        }
        if (!StringUtils.hasText(slideId)) {
            throw new InvalidRequestException("slide_id is required");
        }
        String userId = user.getUserId();
        Slide slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("This question is no longer available"));
        QuestionSlide question = loadCbeQuestion(slide);
        int maxAttempts = maxAttempts(question);
        long checksUsed = trackedRepository.countCbeChecksUsed(userId, slideId);
        long submissions = trackedRepository.countCbeSubmissions(userId, slideId);

        CbeAttemptResponse response = new CbeAttemptResponse();
        response.setSlideId(slideId);
        response.setMaxAttempts(maxAttempts);
        response.setAttemptsUsed((int) checksUsed);
        response.setAttemptsLeft((int) Math.max(0, maxAttempts - checksUsed));
        response.setSubmissions(submissions);

        trackedRepository.findLatestCbeSubmission(userId, slideId).ifPresent(latest -> {
            JsonNode stored = readTree(latest.getResponseJson());
            response.setActivityId(latest.getActivityLog() == null ? null : latest.getActivityLog().getId());
            response.setAttemptNumber(latest.getAttemptNumber());
            response.setResponseStatus(latest.getResponseStatus());
            response.setMarks(latest.getMarks());
            response.setSubmittedAtMillis(latest.getCreatedAt() == null ? null : latest.getCreatedAt().getTime());
            if (stored != null) {
                response.setAnswer(nullIfMissing(stored.get("answer")));
                JsonNode evaluation = nullIfMissing(stored.get("evaluation"));
                response.setEvaluation(evaluation == null ? null : learnerEvaluation(evaluation));
                JsonNode error = stored.get("error");
                if (error != null && error.isTextual()) {
                    response.setErrorCode(error.asText());
                }
            }
            if (!STATUS_EVALUATED.equals(latest.getResponseStatus())) {
                response.setLastEvaluated(lastEvaluated(userId, slideId));
            }
        });
        if (checksUsed > 0) {
            response.setSolution(CbeConfigSecrets.solutionForLearner(question.getEvaluationSecretJson()));
        }
        return response;
    }

    // ------------------------------------------------------------------ helpers

    private QuestionSlide loadCbeQuestion(Slide slide) {
        if (!SlideTypeEnum.QUESTION.name().equalsIgnoreCase(slide.getSourceType())
                || !StringUtils.hasText(slide.getSourceId())) {
            throw new InvalidRequestException("This slide is not a spreadsheet & written response question");
        }
        QuestionSlide question = questionSlideRepository.findByIdWithText(slide.getSourceId())
                .orElseThrow(() -> new ResourceNotFoundException("This question is no longer available"));
        if (!CbeConfigSecrets.isCbe(question.getQuestionType(), question.getAutoEvaluationJson())) {
            throw new InvalidRequestException("This slide is not a spreadsheet & written response question");
        }
        return question;
    }

    static int maxAttempts(QuestionSlide question) {
        Integer configured = question.getReAttemptCount();
        return configured != null && configured > 0 ? configured : DEFAULT_MAX_ATTEMPTS;
    }

    static Double maxMarks(String fullConfig, QuestionSlide question) {
        Double fromParts = CbeConfigSecrets.totalPartMarks(fullConfig);
        if (fromParts != null) {
            return fromParts;
        }
        return question.getPoints() != null && question.getPoints() > 0 ? question.getPoints().doubleValue() : null;
    }

    private static boolean isLive(String slideStatus) {
        return "PUBLISHED".equals(slideStatus) || "UNSYNC".equals(slideStatus);
    }

    private String responseJson(JsonNode answer, JsonNode evaluation, String errorCode) {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("type", CbeConfigSecrets.QUESTION_TYPE);
        root.set("answer", answer);
        root.set("evaluation", evaluation);
        if (errorCode != null) {
            root.put("error", errorCode);
        }
        return root.toString();
    }

    private static String htmlOrEmpty(String html) {
        return StringUtils.hasText(html) ? html : "";
    }

    /**
     * True when at least one part has a non-empty cell (value or formula) or document text.
     * The template is not compared here; ai_service does that and answers UNATTEMPTED.
     */
    static boolean hasAnyContent(JsonNode answer) {
        JsonNode parts = answer == null ? null : answer.path("parts");
        if (parts == null || !parts.isObject()) {
            return false;
        }
        for (JsonNode part : parts) {
            JsonNode tabs = part.path("sheet").path("sheets");
            if (tabs.isArray()) {
                for (JsonNode tab : tabs) {
                    for (JsonNode cell : tab.path("cells")) {
                        if (hasText(cell.path("f")) || hasText(cell.path("v"))) {
                            return true;
                        }
                    }
                }
            }
            JsonNode html = part.path("html");
            if (html.isTextual() && StringUtils.hasText(html.asText()
                    .replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", " ")
                    .replaceAll("<[^>]*>", " ")
                    .replaceAll("(?i)&(nbsp|#160|#xa0);", " "))) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasText(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return false;
        }
        return !node.isTextual() || StringUtils.hasText(node.asText());
    }

    /**
     * Only what the contract (section 5.2) gives the learner: marks_awarded, max_marks,
     * verdict, feedback and criteria_breakdown[] (criteria_name, marks, max_marks, reason).
     * ai_service also returns its billing figure (credits_charged) and the model's
     * confidence, which are never stored on the attempt or shown to a learner.
     */
    ObjectNode learnerEvaluation(JsonNode reply) {
        ObjectNode out = objectMapper.createObjectNode();
        for (String field : EVALUATION_FIELDS) {
            if (reply.has(field)) {
                out.set(field, reply.get(field));
            }
        }
        if (reply.path("criteria_breakdown").isArray()) {
            var rows = out.putArray("criteria_breakdown");
            for (JsonNode criterion : reply.get("criteria_breakdown")) {
                ObjectNode row = rows.addObject();
                for (String field : CRITERION_FIELDS) {
                    if (criterion.has(field)) {
                        row.set(field, criterion.get(field));
                    }
                }
            }
        }
        return out;
    }

    /** The learner's latest graded check on this slide, or null when there is none. */
    private CbeAttemptResponse.LastEvaluated lastEvaluated(String userId, String slideId) {
        return trackedRepository.findLatestEvaluatedCbeSubmission(userId, slideId).map(row -> {
            JsonNode stored = readTree(row.getResponseJson());
            JsonNode evaluation = stored == null ? null : nullIfMissing(stored.get("evaluation"));
            if (evaluation == null) {
                return null;
            }
            CbeAttemptResponse.LastEvaluated last = new CbeAttemptResponse.LastEvaluated();
            last.setAttemptNumber(row.getAttemptNumber());
            last.setMarks(row.getMarks());
            last.setEvaluation(learnerEvaluation(evaluation));
            last.setSubmittedAtMillis(row.getCreatedAt() == null ? null : row.getCreatedAt().getTime());
            return last;
        }).orElse(null);
    }

    private JsonNode readTree(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static JsonNode nullIfMissing(JsonNode node) {
        return node == null || node.isNull() || node.isMissingNode() ? null : node;
    }

    private static Double number(JsonNode node) {
        if (node == null || node.isNull()) {
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

    private static String firstText(String preferred, String fallback) {
        return StringUtils.hasText(preferred) ? preferred : fallback;
    }
}
