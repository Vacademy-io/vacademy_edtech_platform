package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.Comparator;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * New copy-check pipeline: ai_service (Python) owns the AI work, this class
 * just dispatches the grade request and stores the resulting job_id. The
 * pipeline finishes via callbacks into CopyCheckCallbackController.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CopyCheckOrchestratorService {

    private final AiEvaluationProcessRepository processRepository;
    private final QuestionWiseMarksRepository questionWiseMarksRepository;
    private final AiQuestionEvaluationService aiQuestionEvaluationService;
    private final EvaluationUtilityService evaluationUtilityService;
    private final AiServiceCopyCheckClient aiServiceClient;
    private final ObjectMapper objectMapper;
    private final OptionRepository optionRepository;
    private final QuestionAssessmentSectionMappingRepository questionMappingRepository;
    private final TypedAnswerEvaluation typedAnswerEvaluation;
    private final PlatformTransactionManager transactionManager;
    private final AiEvaluationCreditGate creditGate;
    private final CopyCheckGradeRequestEnricher gradeRequestEnricher;

    /** The institute's default checked-copy template; null in unit tests that do not need it. */
    @Autowired(required = false)
    private AdminCoreServiceClient adminCoreServiceClient;

    /**
     * How long a dispatch waits for the institute's template. The lookup shares
     * admin-core's 30 s client; a slow admin-core must cost a copy at most this,
     * never hold the dispatch executor. A lookup that overruns finishes in the
     * background and fills the cache for the next copy.
     */
    private static final long TEMPLATE_LOOKUP_WAIT_MS = 3000;
    private static final ExecutorService TEMPLATE_LOOKUP = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "copy-template-lookup");
        t.setDaemon(true);
        return t;
    });

    @Value("${media.service.baseurl}")
    private String mediaServiceUrl;

    /**
     * Partner API answer sheets live in media's private eval-api prefix, which the
     * anonymous get-public-url route refuses (G12); they are read through a short signed
     * GET instead. Optional so unit tests that build this class by hand keep working.
     */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private vacademy.io.assessment_service.features.assessment.client.EvalApiStorageClient evalApiStorageClient;

    /** Long enough for render_worker to fetch the sheet after a busy queue. */
    static final int EVAL_API_URL_SECONDS = 3600;

    @Value("${assessment.copy-check.callback-base-url:http://assessment-service:8074/assessment-service}")
    private String callbackBaseUrl;

    /**
     * Send one claimed evaluation to ai_service (gate G6).
     *
     * <ol>
     *   <li>A just-submitted online attempt whose marks rows are not written yet is
     *       handed back: DISPATCHED -> PENDING, claim cleared, under the claim guard,
     *       so the next tick takes it instead of the sweeper's stale timeout.</li>
     *   <li>Still DISPATCHED under our claim, nothing sent yet: a result released while
     *       the copy waited, or a balance that no longer covers the copy's quote (10.6),
     *       fails it here - unbilled. An API copy whose credit check cannot be made goes
     *       back to the queue.</li>
     *   <li>Guarded start, own transaction: DISPATCHED -> PROCESSING only while the
     *       row is still claimed by {@code claimToken}. 0 rows = another pod got
     *       there first, a teacher cancelled it, or the sweeper took it back: stop.</li>
     *   <li>Build the payload and the tracking rows in one short transaction.</li>
     *   <li>Call ai_service OUTSIDE any transaction - it used to pin a pooled
     *       connection for up to ~93 s - then record the job id with a one-row
     *       update. A 429 (every grading slot busy) puts the row back to PENDING for
     *       the next tick; any other failure fails the process as before.</li>
     * </ol>
     */
    public void dispatch(String processId, String attemptId, String preferredModel, String claimToken) {
        DispatchFacts facts = inNewTransaction(() -> {
            AiEvaluationProcess process = processRepository.findById(processId).orElse(null);
            if (process == null) {
                log.error("[copy-check] process {} not found", processId);
                return null;
            }
            boolean awaiting = awaitingSubmitMarks(process, attemptId);
            return new DispatchFacts(awaiting,
                    AiEvaluationService.isReleased(process.getStudentAttempt()),
                    extractInstituteId(process),
                    process.getQuotedCredits(),
                    process.getRateSnapshot(),
                    process.getApiKeyId() != null && !process.getApiKeyId().isBlank(),
                    awaiting || process.getQuotedCredits() != null ? null : dashboardCharge(process, attemptId));
        });
        if (facts == null) {
            return;
        }
        if (facts.awaitingMarks()) {
            // An online attempt's question rows are written by the async marks job
            // that runs on submit; the poller can get here first. Hand the job back
            // unclaimed (and PENDING - a DISPATCHED row nobody owns would wait for the
            // sweeper) and the next tick picks it up once the rows exist.
            int handedBack = inNewTransaction(() -> processRepository.handBackClaim(processId, claimToken, new Date()));
            log.info("[copy-check] attempt {} has no question rows yet; process {} requeued ({} row)",
                    attemptId, processId, handedBack);
            return;
        }
        if (facts.released()) {
            // The callback would refuse to write these marks anyway; refuse before the
            // run is paid for (G8).
            int failed = inNewTransaction(() -> processRepository.failClaimed(processId, claimToken, "RESULT_RELEASED",
                    "result_released: the attempt's result was released while this check waited; not run, not billed",
                    new Date()));
            log.info("[copy-check] attempt {} was released while process {} waited; not dispatched ({} row)",
                    attemptId, processId, failed);
            return;
        }
        if (!passesCreditCheck(processId, claimToken, facts)) {
            return;
        }

        int started = inNewTransaction(() -> processRepository.beginDispatch(processId, claimToken, new Date()));
        if (started == 0) {
            log.info("[copy-check] process {} is no longer DISPATCHED under claim {}; not dispatching it again",
                    processId, claimToken);
            return;
        }

        CopyCheckGradeRequestDto request = inNewTransaction(() -> prepareRequest(processId, attemptId, preferredModel));
        if (request == null) {
            return;
        }
        request.setCommentPlacement(commentPlacementFor(request, facts));
        applyCopyCheckSettings(request, facts);

        String jobId;
        try {
            jobId = aiServiceClient.submitGrade(request);
        } catch (AiServiceCopyCheckClient.AiServiceBusyException busy) {
            int requeued = inNewTransaction(() -> processRepository.requeueBusy(processId, claimToken, new Date()));
            log.info("[copy-check] ai_service busy (429) for process {}; back to the queue ({} row)", processId, requeued);
            return;
        } catch (Exception e) {
            log.error("[copy-check] failed to submit grade for process {}", processId, e);
            String message = truncate("ai_service submit failed: " + e.getMessage());
            inNewTransaction(() -> {
                processRepository.findById(processId).ifPresent(process -> failProcess(process, message));
                return null;
            });
            return;
        }
        inNewTransaction(() -> processRepository.recordSubmitted(processId, jobId, new Date()));
        log.info("[copy-check] dispatched process={} attempt={} → ai_service job_id={}",
                processId, attemptId, jobId);
    }

    /**
     * The grade request for a process that has just moved to PROCESSING, with its
     * tracking rows written; null (process failed or no longer ours) when there is
     * nothing to send. Runs inside the caller's transaction.
     */
    CopyCheckGradeRequestDto prepareRequest(String processId, String attemptId, String preferredModel) {
        AiEvaluationProcess process = processRepository.findById(processId).orElse(null);
        if (process == null) {
            log.error("[copy-check] process {} not found", processId);
            return null;
        }
        if (!AiEvaluationStatusEnum.PROCESSING.name().equals(process.getStatus())) {
            // Cancelled (or swept) between the guarded start and here.
            log.info("[copy-check] process {} is {} after dispatch started; not sending it", processId,
                    process.getStatus());
            return null;
        }

        String attemptData = process.getStudentAttempt() != null ? process.getStudentAttempt().getAttemptData() : null;
        if (attemptData == null) {
            failProcess(process, "attempt_data missing — nothing to grade");
            return null;
        }
        // No uploaded sheet = an online attempt: grade the typed written answers.
        boolean typed = typedAnswerEvaluation.isTypedAttempt(process.getStudentAttempt(), assessmentOf(process));
        String pdfUrl = null;
        if (!typed) {
            String fileId = evaluationUtilityService.extractFileId(attemptData);
            if (fileId == null || fileId.isEmpty()) {
                failProcess(process, "no file_id on attempt — nothing to grade");
                return null;
            }
            pdfUrl = answerSheetUrl(process, fileId);
            if (pdfUrl == null) {
                failProcess(process, "media-service did not return a URL for file_id=" + fileId);
                return null;
            }
        }

        List<QuestionWiseMarks> marksList = questionWiseMarksRepository
                .findByStudentAttemptIdWithQuestionDetails(attemptId);
        if (typed) {
            // Objective questions were scored exactly on submit; only the written
            // ones need reading, and only those are charged for.
            marksList = marksList.stream().filter(m -> TypedAnswerEvaluation.isAiGraded(m.getQuestion())).toList();
            if (marksList.isEmpty()) {
                failProcess(process, "no uploaded answer sheet and no written (long answer) question on attempt "
                        + attemptId + " — nothing for the AI to grade");
                return null;
            }
        }
        if (marksList.isEmpty()) {
            failProcess(process, "no questions found for attempt " + attemptId);
            return null;
        }
        marksList = inPaperOrder(marksList, process.getAssessment());

        // A re-dispatch (sweeper requeue, 429, stale claim) used to insert a second
        // set of tracking rows next to the first (T0.29). Clear this process's rows
        // first, except the ones a teacher already edited: those are kept, get no
        // new row, and count as settled - their callbacks are skipped anyway.
        java.util.Set<String> keptEdited = aiQuestionEvaluationService.resetForRedispatch(processId);
        int alreadySettled = (int) marksList.stream()
                .filter(m -> m.getQuestion() != null && keptEdited.contains(m.getQuestion().getId()))
                .count();
        process.setQuestionsTotal(marksList.size());
        process.setQuestionsCompleted(alreadySettled);
        processRepository.save(process);

        // Pre-create tracking rows so callbacks can update them by question_id.
        int qNum = 1;
        for (QuestionWiseMarks marks : marksList) {
            int number = qNum++;
            if (marks.getQuestion() != null && keptEdited.contains(marks.getQuestion().getId())) {
                continue;
            }
            aiQuestionEvaluationService.createQuestionEvaluation(process, marks.getQuestion(), number);
        }

        String subject = gradeRequestEnricher != null ? gradeRequestEnricher.subjectFor(process) : null;
        List<CopyCheckGradeRequestDto.QuestionInput> questionPayloads = new ArrayList<>(marksList.size());
        int position = 0;
        for (QuestionWiseMarks marks : marksList) {
            CopyCheckGradeRequestDto.QuestionInput input = buildQuestionInput(marks, ++position, subject);
            if (typed) {
                input.setStudentAnswer(typedAnswerEvaluation.typedAnswer(marks));
                input.setModelAnswer(referenceAnswerFor(marks.getQuestion()));
            }
            questionPayloads.add(input);
        }

        CopyCheckGradeRequestDto request = CopyCheckGradeRequestDto.builder()
                .processId(processId)
                .attemptId(attemptId)
                .assessmentId(process.getAssessment() != null ? process.getAssessment().getId() : null)
                .instituteId(extractInstituteId(process))
                .answerMode(typed ? "TYPED" : "COPY")
                .pdfUrl(pdfUrl)
                .preferredModel(preferredModel)
                .callbackBaseUrl(callbackBaseUrl)
                .questions(questionPayloads)
                // The assessment's own template choice; dispatch resolves it (with the
                // institute default) to OUTSIDE or nothing before sending.
                .commentPlacement(typed ? null : CopyCommentPlacement.chosenOn(assessmentOf(process)))
                .copyCheckSettings(CopyCheckConfig.on(assessmentOf(process)))
                .build();
        if (gradeRequestEnricher != null) {
            gradeRequestEnricher.enrich(process, request);
        }
        return request;
    }

    /**
     * The checked-copy template for this copy: OUTSIDE, or null for the usual copy
     * (the request is then exactly what it was before templates existed). Online
     * (typed) answers have no copy to lay out, and partner API traffic never takes
     * the dashboard's institute default. Read outside any transaction; a failed
     * lookup means the usual copy, never a failed check.
     */
    private String commentPlacementFor(CopyCheckGradeRequestDto request, DispatchFacts facts) {
        if (!"COPY".equals(request.getAnswerMode())) {
            return null;
        }
        AdminCoreServiceClient client = adminCoreServiceClient;
        Supplier<String> instituteDefault = facts.apiTraffic() || client == null
                ? null
                : () -> {
                    try {
                        return CompletableFuture
                                .supplyAsync(() -> client.getAiCopyCommentPlacement(facts.instituteId()),
                                        TEMPLATE_LOOKUP)
                                .get(TEMPLATE_LOOKUP_WAIT_MS, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return null;
                    } catch (Exception e) {
                        log.info("[copy-check] institute template lookup for {} not back in time; usual copy ({})",
                                facts.instituteId(), e.getClass().getSimpleName());
                        return null;
                    }
                };
        return CopyCommentPlacement.effective(request.getCommentPlacement(), instituteDefault);
    }

    /**
     * The assessment's AI checking settings, with the institute's instructions and
     * language choice where it has none, sent as exam_context. Partner API traffic
     * brings its own exam_context and is left as it is; nothing set anywhere leaves
     * the request exactly as before. A subject chosen here is the subject of every
     * question. Read outside any transaction; a failed lookup means the assessment's
     * own settings only, never a failed check.
     */
    void applyCopyCheckSettings(CopyCheckGradeRequestDto request, DispatchFacts facts) {
        if (facts.apiTraffic() || request.getExamContext() != null) {
            return;
        }
        AdminCoreServiceClient client = adminCoreServiceClient;
        Supplier<Map<String, Object>> instituteDefault = client == null
                ? null
                : () -> {
                    try {
                        return CompletableFuture
                                .supplyAsync(() -> client.getAiCopyCheckDefaults(facts.instituteId()), TEMPLATE_LOOKUP)
                                .get(TEMPLATE_LOOKUP_WAIT_MS, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return null;
                    } catch (Exception e) {
                        log.info("[copy-check] institute AI checking defaults for {} not back in time ({})",
                                facts.instituteId(), e.getClass().getSimpleName());
                        return null;
                    }
                };
        Map<String, Object> examContext = CopyCheckConfig.examContext(request.getCopyCheckSettings(), instituteDefault);
        if (examContext == null) {
            return;
        }
        request.setExamContext(examContext);
        Object subject = examContext.get("subject");
        if (subject != null && request.getQuestions() != null) {
            request.getQuestions().forEach(q -> q.setSubject(subject.toString()));
        }
    }

    /** What dispatch reads about a claimed row in its first, short transaction. */
    record DispatchFacts(boolean awaitingMarks, boolean released, String instituteId, java.math.BigDecimal quotedCredits,
                         String rateSnapshot, boolean apiTraffic, AiEvaluationCharge fallbackCharge) {
    }

    /**
     * The dispatch-time credit look (10.6.2), outside any transaction. False = the
     * row was failed (insufficient_credits, unbilled) or handed back to the queue
     * (API copy, credit service unreachable) and must not be sent.
     */
    private boolean passesCreditCheck(String processId, String claimToken, DispatchFacts facts) {
        if (creditGate == null) {
            return true;
        }
        AiEvaluationCreditGate.DispatchCheck check;
        try {
            check = creditGate.checkAtDispatch(facts.instituteId(), facts.quotedCredits(), facts.rateSnapshot(),
                    facts.fallbackCharge(), facts.apiTraffic());
        } catch (Exception e) {
            // Never let the second look itself stop a dashboard copy.
            log.warn("[copy-check] credit re-check failed for process {}: {}", processId, e.getMessage());
            return true;
        }
        if (check == null) {
            return true;
        }
        AiEvaluationCreditGate.Reservation newQuote = check.newQuote();
        if (newQuote != null && newQuote.quotedCredits() != null && newQuote.rateSnapshotJson() != null) {
            try {
                inNewTransaction(() -> processRepository.recordQuote(processId, newQuote.quotedCredits(),
                        newQuote.rateSnapshotJson(), new Date()));
            } catch (Exception e) {
                log.warn("[copy-check] could not store the quote for process {}: {}", processId, e.getMessage());
            }
        }
        switch (check.verdict()) {
            case INSUFFICIENT -> {
                String message = "insufficient_credits: this check needs " + plain(check.quoted())
                        + " AI credits and the institute has " + plain(check.balance())
                        + (check.creditLimit() != null && check.creditLimit().signum() > 0
                                ? " (+" + plain(check.creditLimit()) + " credit limit)" : "")
                        + ". Not run, not billed; top up AI credits and evaluate again.";
                int failed = inNewTransaction(() -> processRepository.failClaimed(processId, claimToken,
                        "INSUFFICIENT_CREDITS", message, new Date()));
                log.info("[copy-check] process {} not dispatched: insufficient credits ({} row)", processId, failed);
                return false;
            }
            case UNAVAILABLE -> {
                int handedBack = inNewTransaction(() -> processRepository.handBackClaim(processId, claimToken, new Date()));
                log.warn("[copy-check] process {} back to the queue: credit service unavailable ({} row)",
                        processId, handedBack);
                return false;
            }
            default -> {
                return true;
            }
        }
    }

    private static String plain(java.math.BigDecimal value) {
        return value == null ? "0" : value.stripTrailingZeros().toPlainString();
    }

    /**
     * How to price a row that was queued without a quote (a learner's submit, or a row
     * from before the credit check): the dashboard rate per question the AI will grade -
     * every question row on a copy, only the written ones on an online attempt.
     * Partner rows are always quoted at accept, so they never need this.
     */
    private AiEvaluationCharge dashboardCharge(AiEvaluationProcess process, String attemptId) {
        if (process.getApiKeyId() != null && !process.getApiKeyId().isBlank()) {
            return null;
        }
        try {
            boolean typed = typedAnswerEvaluation.isTypedAttempt(process.getStudentAttempt(), assessmentOf(process));
            List<QuestionWiseMarks> rows = questionWiseMarksRepository.findByStudentAttemptId(attemptId);
            long count = rows.stream()
                    .filter(m -> !typed || TypedAnswerEvaluation.isAiGraded(m.getQuestion()))
                    .count();
            return AiEvaluationCharge.dashboard((int) count);
        } catch (Exception e) {
            log.warn("[copy-check] could not price process {}: {}", process.getId(), e.getMessage());
            return null;
        }
    }

    /** Run {@code work} in a transaction of its own (dispatch has no outer one by design). */
    private <T> T inNewTransaction(java.util.function.Supplier<T> work) {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return template.execute(status -> work.get());
    }

    /**
     * What the grader is told about one question. The options and the key come
     * from where the platform actually stores them — the option rows and
     * auto_evaluation_json ({correctOptionIds} / {answer} / {validAnswers}) —
     * so an MCQ, true/false, one-word or numerical answer on a handwritten sheet
     * is marked against the paper's key, not against the model's own opinion.
     * The older auto_evaluation_json.options / correctAnswer shapes stay as the
     * fallback for questions created by other tools.
     */
    CopyCheckGradeRequestDto.QuestionInput buildQuestionInput(QuestionWiseMarks marks, int position, String subject) {
        Question q = marks.getQuestion();
        String[] printed = printedLabel(q);
        double maxMarks = evaluationUtilityService.extractMaxMarksFromSectionMapping(marks, q);
        String questionText = q.getTextData() != null ? q.getTextData().getContent() : "";
        List<Option> storedOptions = loadOptions(q);
        List<Map<String, Object>> options = storedOptions.isEmpty() ? parseOptions(q) : optionsPayload(storedOptions);
        String correctAnswer = correctAnswerFor(q, storedOptions);
        if (correctAnswer == null) {
            correctAnswer = parseCorrectAnswer(q);
        }
        return CopyCheckGradeRequestDto.QuestionInput.builder()
                .questionId(q.getId())
                .questionText(questionText)
                .questionType(q.getQuestionType())
                .maxMarks(maxMarks)
                .options(options)
                .correctAnswer(correctAnswer)
                .subject(subject)
                .questionNumber(position)
                .paperLabel(printed[0] != null ? printed[0] : String.valueOf(position))
                .section(printed[1] != null ? printed[1]
                        : marks.getSection() != null ? marks.getSection().getName() : null)
                .build();
    }

    /**
     * {printed number, section} from a digitised paper's provenance
     * ({@code source_meta.question_number} / {@code section}); {null, null} for
     * questions that did not come off a paper.
     */
    String[] printedLabel(Question q) {
        try {
            String meta = q.getSourceMeta();
            if (meta == null || meta.isBlank()) return new String[]{null, null};
            JsonNode node = objectMapper.readTree(meta);
            String number = node.path("question_number").isMissingNode() || node.path("question_number").isNull()
                    ? null : node.path("question_number").asText().trim();
            String section = node.path("section").isMissingNode() || node.path("section").isNull()
                    ? null : node.path("section").asText().trim();
            return new String[]{number != null && !number.isEmpty() ? number : null,
                    section != null && !section.isEmpty() ? section : null};
        } catch (Exception e) {
            return new String[]{null, null};
        }
    }

    /**
     * The question's option rows, in the order the platform shows them (insertion
     * order). findByStudentAttemptIdWithQuestionDetails already JOIN FETCHes them;
     * the repository is the fallback for a question loaded any other way.
     */
    private List<Option> loadOptions(Question q) {
        try {
            List<Option> fetched = q.getOptions();
            if (fetched != null && !fetched.isEmpty()) {
                return fetched;
            }
            List<Option> options = optionRepository.findByQuestionId(q.getId());
            return options != null ? options : List.of();
        } catch (Exception e) {
            log.warn("[copy-check] could not load options for question {}: {}", q.getId(), e.getMessage());
            return List.of();
        }
    }

    private List<Map<String, Object>> optionsPayload(List<Option> options) {
        List<Map<String, Object>> out = new ArrayList<>(options.size());
        for (Option option : options) {
            Map<String, Object> row = new HashMap<>();
            row.put("id", option.getId());
            row.put("text", plainText(option.getText() != null ? option.getText().getContent() : null));
            out.add(row);
        }
        return out;
    }

    /**
     * The key as a sentence the grader can compare a handwritten answer to:
     *  - choice types → "Option 2: (b) Himalayas" (position AND printed text, since a
     *    student writes either "b" or the words), several joined with "; " for MCQM;
     *  - ONE_WORD → the answer; NUMERIC → every accepted value;
     *  - LONG_ANSWER → null, always. Written answers were never graded against a
     *    stored reference before 2026-09-20 (the rubric alone carries the scheme),
     *    and that behaviour is kept exactly: only objective types gained a key.
     */
    String correctAnswerFor(Question q, List<Option> options) {
        try {
            String json = q.getAutoEvaluationJson();
            if (json == null || json.isEmpty()) return null;
            JsonNode data = objectMapper.readTree(json).path("data");
            if (data.isMissingNode()) return null;

            JsonNode ids = data.path("correctOptionIds");
            if (ids.isMissingNode() || !ids.isArray()) ids = data.path("correct_option_ids");
            if (ids.isArray() && ids.size() > 0) {
                List<String> parts = new ArrayList<>();
                for (JsonNode idNode : ids) {
                    String id = idNode.asText();
                    for (int i = 0; i < options.size(); i++) {
                        if (id.equals(options.get(i).getId())) {
                            String text = plainText(options.get(i).getText() != null
                                    ? options.get(i).getText().getContent() : null);
                            parts.add("Option " + (i + 1) + (text.isEmpty() ? "" : ": " + text));
                        }
                    }
                }
                return parts.isEmpty() ? null : String.join("; ", parts);
            }

            JsonNode valid = data.path("validAnswers");
            if (valid.isMissingNode() || !valid.isArray()) valid = data.path("valid_answers");
            if (valid.isArray() && valid.size() > 0) {
                List<String> values = new ArrayList<>();
                valid.forEach(v -> values.add(v.asText()));
                return String.join(" or ", values);
            }

            JsonNode answer = data.path("answer");
            if (answer.isTextual()) {
                String text = answer.asText().trim();
                return text.isEmpty() ? null : text;
            }
            // An object-shaped answer is a LONG_ANSWER's reference text: not a key.
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The "Answer" a teacher writes on a Long Answer question
     * ({data: {answer: {content}}}), for grading a typed answer. Copies still get
     * no reference from here (see correctAnswerFor); that behaviour is unchanged.
     */
    String referenceAnswerFor(Question q) {
        try {
            String json = q.getAutoEvaluationJson();
            if (json == null || json.isEmpty()) return null;
            JsonNode answer = objectMapper.readTree(json).path("data").path("answer");
            String html = answer.isTextual() ? answer.asText() : answer.path("content").asText(null);
            String text = plainText(html);
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            return null;
        }
    }

    private static String plainText(String html) {
        if (html == null) return "";
        return html.replaceAll("<[^>]+>", " ").replace("&nbsp;", " ").replaceAll("\\s+", " ").trim();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseOptions(Question q) {
        try {
            String json = q.getAutoEvaluationJson();
            if (json == null || json.isEmpty()) return null;
            JsonNode node = objectMapper.readTree(json).path("options");
            if (node.isMissingNode() || !node.isArray()) return null;
            return objectMapper.convertValue(node, List.class);
        } catch (Exception e) {
            return null;
        }
    }

    private String parseCorrectAnswer(Question q) {
        try {
            String json = q.getAutoEvaluationJson();
            if (json == null || json.isEmpty()) return null;
            JsonNode node = objectMapper.readTree(json);
            JsonNode correct = node.path("correctAnswer");
            if (!correct.isMissingNode() && !correct.isNull()) return correct.asText();
            JsonNode preview = node.path("data").path("correctOption");
            if (!preview.isMissingNode() && !preview.isNull()) return preview.asText();
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private String extractInstituteId(AiEvaluationProcess process) {
        if (process.getInstituteId() != null && !process.getInstituteId().isBlank()) return process.getInstituteId();
        if (process.getStudentAttempt() == null) return null;
        try {
            var registration = process.getStudentAttempt().getRegistration();
            return registration != null ? registration.getInstituteId() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The answer sheet's URL, chosen by where the FILE lives, not by who started the run.
     * A partner API run reads its sheet through the C3 signed URL. A dashboard run (re-check
     * from the AI review page, bulk AI check) keeps the public-url route; when that refuses
     * the file (an API-uploaded sheet in the private eval-api prefix, which media treats as
     * not found there) it falls back to the C3 signed URL, so teachers can still re-grade
     * API copies from the dashboard (spec 12).
     */
    String answerSheetUrl(AiEvaluationProcess process, String fileId) {
        if (isApiProcess(process)) {
            return getEvalApiFileUrl(fileId);
        }
        String url = getFileUrl(fileId);
        if (url != null || evalApiStorageClient == null) {
            return url;
        }
        log.info("[copy-check] public URL refused for fileId={}; trying the eval-api signed URL", fileId);
        return getEvalApiFileUrl(fileId);
    }

    private static boolean isApiProcess(AiEvaluationProcess process) {
        return process.getApiKeyId() != null && !process.getApiKeyId().isBlank();
    }

    /** Signed GET for a partner API upload (C3); null when media cannot give one. */
    private String getEvalApiFileUrl(String fileId) {
        if (evalApiStorageClient == null) {
            log.error("[copy-check] no eval-api storage client; cannot read API file {}", fileId);
            return null;
        }
        try {
            return evalApiStorageClient.signedUrl(fileId, EVAL_API_URL_SECONDS).url();
        } catch (Exception e) {
            log.error("[copy-check] media-service eval-api signed URL failed for fileId={}: {}", fileId, e.getMessage());
            return null;
        }
    }

    /** Media's anonymous public-url route; null on any failure. Package-private for tests. */
    String getFileUrl(String fileId) {
        try {
            return WebClient.builder()
                    .baseUrl(mediaServiceUrl)
                    .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .build()
                    .get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/media-service/public/get-public-url")
                            .queryParam("fileId", fileId)
                            .build())
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();
        } catch (Exception e) {
            log.error("[copy-check] media-service failed for fileId={}", fileId, e);
            return null;
        }
    }

    /**
     * Mark a process FAILED after dispatch blew up. Runs in its own transaction:
     * the dispatch transaction is already rolled back (and, on a constraint
     * violation, poisoned — every further statement gets 25P02), so a write
     * through it would be discarded. Without this a dispatch crash leaves the
     * process stuck at PENDING forever with nothing to retry it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markDispatchFailed(String processId, String message) {
        try {
            processRepository.findById(processId).ifPresent(process -> failProcess(process, truncate(message)));
        } catch (Exception e) {
            log.error("[copy-check] could not mark process {} as FAILED", processId, e);
        }
    }

    private String truncate(String message) {
        if (message == null) return "dispatch failed";
        return message.length() <= 2000 ? message : message.substring(0, 2000) + "…";
    }

    /**
     * The grader numbers questions in the order it receives them and the student
     * numbers answers as the paper does; when the two disagree (rows created from
     * an unordered mapping set — every staff-made attempt) the checker has to match
     * by content, mislabels callouts and loses answers. Section order, then
     * question order, is the paper's order. Rows without a mapping keep their
     * place at the end.
     */
    List<QuestionWiseMarks> inPaperOrder(List<QuestionWiseMarks> rows, Assessment assessment) {
        if (assessment == null || rows.size() < 2) {
            return rows;
        }
        Map<String, Long> rank = new HashMap<>();
        try {
            for (QuestionAssessmentSectionMapping m : questionMappingRepository
                    .getQuestionAssessmentSectionMappingByAssessmentId(assessment.getId())) {
                if (m.getQuestion() == null || "DELETED".equalsIgnoreCase(m.getStatus())) continue;
                long section = m.getSection() != null && m.getSection().getSectionOrder() != null
                        ? m.getSection().getSectionOrder() : Integer.MAX_VALUE;
                long question = m.getQuestionOrder() != null ? m.getQuestionOrder() : Integer.MAX_VALUE;
                rank.putIfAbsent(m.getQuestion().getId(), section * 1_000_000L + question);
            }
        } catch (Exception e) {
            log.warn("[copy-check] could not order questions for assessment {}: {}", assessment.getId(), e.getMessage());
            return rows;
        }
        List<QuestionWiseMarks> ordered = new ArrayList<>(rows);
        ordered.sort(Comparator.comparingLong(r -> r.getQuestion() == null ? Long.MAX_VALUE
                : rank.getOrDefault(r.getQuestion().getId(), Long.MAX_VALUE)));
        return ordered;
    }

    /** How long after submit a missing set of question rows means "not written yet". */
    static final long SUBMIT_MARKS_GRACE_MS = 10 * 60 * 1000L;

    boolean awaitingSubmitMarks(AiEvaluationProcess process, String attemptId) {
        var attempt = process.getStudentAttempt();
        if (attempt == null || !typedAnswerEvaluation.isTypedAttempt(attempt, assessmentOf(process))) return false;
        Date submitted = attempt.getSubmitTime();
        if (submitted == null || System.currentTimeMillis() - submitted.getTime() > SUBMIT_MARKS_GRACE_MS) return false;
        return questionWiseMarksRepository.findByStudentAttemptId(attemptId).isEmpty();
    }

    private static Assessment assessmentOf(AiEvaluationProcess process) {
        if (process.getAssessment() != null) return process.getAssessment();
        try {
            return process.getStudentAttempt().getRegistration().getAssessment();
        } catch (Exception e) {
            return null;
        }
    }

    private void failProcess(AiEvaluationProcess process, String message) {
        process.setStatus(AiEvaluationStatusEnum.FAILED.name());
        process.setErrorMessage(message);
        processRepository.save(process);
        log.error("[copy-check] process {} failed: {}", process.getId(), message);
    }
}
