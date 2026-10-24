package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AiEvaluationTriggerRequest;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class AiEvaluationService {

        // In-flight statuses for trigger idempotency: an attempt already in any of
        // these has a live run, so a re-trigger returns it instead of duplicating.
        // Queued (PENDING), claimed (DISPATCHED) and running alike.
        static final List<String> ACTIVE_STATUSES = AiEvaluationStatusEnum.ACTIVE;

        private final AiEvaluationProcessRepository aiEvaluationProcessRepository;
        private final AiEvaluationAsyncService aiEvaluationAsyncService;
        private final AiEvaluationCancellationService cancellationService;
        private final EvaluationAccessValidator accessValidator;
        private final QuestionAssessmentSectionMappingRepository questionMappingRepository;
        private final QuestionWiseMarksRepository questionWiseMarksRepository;
        private final TypedAnswerEvaluation typedAnswerEvaluation;
        private final AiEvaluationCreditGate creditGate;

        /** Finalized-result lock for partner-API exams; null in unit tests. */
        @org.springframework.beans.factory.annotation.Autowired(required = false)
        private ResultLockGuard resultLockGuard;

        /**
         * The question the slide-level "create assessment" form provisions when a
         * teacher attaches the paper as a PDF and grades by hand. It is a container
         * for the upload, not a question: grading a sheet against it would produce a
         * confident random score.
         */
        static final String PLACEHOLDER_QUESTION_TEXT = "Upload your answer sheet.";

        public static final String PLACEHOLDER_ONLY_MESSAGE =
                        "This test has no digitised questions - only the 'Upload your answer sheet' placeholder. "
                        + "Add the question paper's questions (recreate the test with AI checking on, or add "
                        + "them under Questions) before evaluating with AI.";

        @Transactional
        public List<String> triggerEvaluation(AiEvaluationTriggerRequest request, CustomUserDetails user,
                        String instituteId) {
                log.info("Triggering AI evaluation for {} attempts with model: {}", request.getAttemptIds().size(),
                                request.getPreferredModel());

                List<String> processIds = new ArrayList<>();
                // One attempt = the teacher's "Evaluate with AI" on a row: dispatched at
                // once so the page it opens shows progress immediately. A multi-select
                // goes through the fair queue like a bulk upload (11.2) - it used to
                // dispatch 50 copies at once past every cap.
                boolean queueOnly = request.getAttemptIds().size() > 1;

                // Pass 1 checks the whole request before anything is queued, so a refusal
                // fails it with the reason instead of being swallowed per attempt below.
                List<StudentAttempt> attempts = new ArrayList<>();
                for (String attemptId : request.getAttemptIds()) {
                        // Authorization: a request that references an attempt outside the
                        // caller's institute (or an unauthenticated caller) fails the whole
                        // batch rather than being silently skipped.
                        StudentAttempt attempt = accessValidator.requireAttemptAccess(user, instituteId, attemptId);
                        // A test the AI cannot grade fails the request with the reason. An
                        // attempt with no registration keeps its old fate (skipped below).
                        if (attempt.getRegistration() != null) {
                                requireGradableQuestions(attempt.getRegistration().getAssessment());
                        }
                        // A released result is frozen: the run would be billed, then discarded (G8).
                        requireNotReleased(attempt);
                        // A partner-API exam's released result is finalized (gate G8).
                        if (resultLockGuard != null) {
                                resultLockGuard.requireNotFinalizedForApiExam(attempt);
                        }
                        attempts.add(attempt);
                }
                // One credit check for every copy this request will actually queue, under
                // the institute's lock until this transaction commits (10.6).
                Map<String, AiEvaluationCreditGate.Reservation> reserved = reserveDashboardCredits(attempts);

                for (StudentAttempt attempt : attempts) {
                        String attemptId = attempt.getId();
                        try {
                                AiEvaluationCreditGate.Reservation reservation = reserved.getOrDefault(attemptId,
                                                AiEvaluationCreditGate.Reservation.NONE);
                                String processId = initiateEvaluationForAttempt(attempt, request.getPreferredModel(),
                                                queueOnly, user != null ? user.getUserId() : null,
                                                AiEvaluationEnqueueContext.dashboard().withReservation(reservation));
                                processIds.add(processId);
                                log.info("Successfully initiated evaluation for attempt: {} with processId: {}",
                                                attemptId, processId);
                        } catch (Exception e) {
                                log.error("Failed to initiate evaluation for attempt {}", attemptId, e);
                        }
                }

                log.info("Completed triggering evaluation for {} attempts, generated {} process IDs",
                                request.getAttemptIds().size(), processIds.size());
                return processIds;
        }

        // ------------------------------------------------------------ release lock (G8)

        static boolean isReleased(StudentAttempt attempt) {
                return attempt != null
                                && ReleaseResultStatusEnum.RELEASED.name().equalsIgnoreCase(attempt.getReportReleaseStatus());
        }

        /** Refuse an AI check on an attempt whose result is already released (T0.33). */
        public void requireNotReleased(StudentAttempt attempt) {
                if (isReleased(attempt)) {
                        throw new ResultReleasedException(RESULT_RELEASED_MESSAGE);
                }
        }

        public static final String RESULT_RELEASED_MESSAGE =
                        "This attempt's result has already been released, so AI evaluation cannot change its marks. "
                        + "Edit the marks by hand instead.";

        // ------------------------------------------------------------ credits (10.6)

        /**
         * One dashboard credit check for a set of attempts, inside the caller's
         * transaction: the copies that will actually be queued (an attempt already
         * being checked returns its running process instead) are priced per question
         * and must fit the institute's balance minus what is already committed.
         *
         * @return the reservation per attempt id, to be written on each new process row
         * @throws vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.InsufficientCreditsException
         *         when they do not fit
         */
        public Map<String, AiEvaluationCreditGate.Reservation> reserveDashboardCredits(List<StudentAttempt> attempts) {
                Map<String, List<StudentAttempt>> byInstitute = new LinkedHashMap<>();
                Map<String, AiEvaluationCharge> chargeCache = new HashMap<>();
                Map<String, AiEvaluationCharge> chargeByAttempt = new HashMap<>();
                for (StudentAttempt attempt : attempts) {
                        if (attempt == null || attempt.getRegistration() == null
                                        || attempt.getRegistration().getAssessment() == null) {
                                continue;
                        }
                        if (!aiEvaluationProcessRepository.findActiveByAttemptId(attempt.getId(), ACTIVE_STATUSES)
                                        .isEmpty()) {
                                continue;
                        }
                        chargeByAttempt.put(attempt.getId(), dashboardCharge(attempt, chargeCache));
                        byInstitute.computeIfAbsent(attempt.getRegistration().getInstituteId(), k -> new ArrayList<>())
                                        .add(attempt);
                }
                Map<String, AiEvaluationCreditGate.Reservation> out = new HashMap<>();
                for (Map.Entry<String, List<StudentAttempt>> group : byInstitute.entrySet()) {
                        List<AiEvaluationCharge> charges = group.getValue().stream()
                                        .map(a -> chargeByAttempt.get(a.getId())).toList();
                        List<AiEvaluationCreditGate.Reservation> reservations = creditGate.reserve(group.getKey(),
                                        charges, BigDecimal.ZERO, AiEvaluationCreditGate.Mode.DASHBOARD);
                        for (int i = 0; i < group.getValue().size() && i < reservations.size(); i++) {
                                out.put(group.getValue().get(i).getId(), reservations.get(i));
                        }
                }
                return out;
        }

        /**
         * Check that {@code copies} more copies of this paper fit the institute's credits
         * before a bulk upload starts (nothing is queued yet; each copy is checked again
         * when it is placed). Must run inside the caller's transaction.
         */
        public void requireCreditsForCopies(Assessment assessment, String instituteId, int copies) {
                if (assessment == null || copies <= 0) {
                        return;
                }
                AiEvaluationCharge charge = AiEvaluationCharge.dashboard(gradableQuestionCount(assessment, false));
                creditGate.reserve(instituteId, java.util.Collections.nCopies(copies, charge), BigDecimal.ZERO,
                                AiEvaluationCreditGate.Mode.DASHBOARD);
        }

        /** The dashboard price of one copy of this attempt: every question the AI will grade. */
        public AiEvaluationCharge dashboardCharge(StudentAttempt attempt) {
                return dashboardCharge(attempt, new HashMap<>());
        }

        private AiEvaluationCharge dashboardCharge(StudentAttempt attempt, Map<String, AiEvaluationCharge> cache) {
                Assessment assessment = attempt.getRegistration() != null ? attempt.getRegistration().getAssessment() : null;
                boolean typed = laneFor(attempt, assessment) == AiEvaluationLane.TYPED;
                String key = (assessment != null ? assessment.getId() : "") + ":" + typed;
                return cache.computeIfAbsent(key, k -> AiEvaluationCharge.dashboard(gradableQuestionCount(assessment, typed)));
        }

        /**
         * Questions the AI grades on this paper: every live question on a copy, only the
         * written (long-answer) ones on an online attempt - the objective ones were
         * scored exactly on submit and are not sent (the same rule the dispatcher uses).
         */
        int gradableQuestionCount(Assessment assessment, boolean typed) {
                if (assessment == null) {
                        return 0;
                }
                int count = 0;
                for (QuestionAssessmentSectionMapping mapping : questionMappingRepository
                                .getQuestionAssessmentSectionMappingByAssessmentId(assessment.getId())) {
                        if (mapping.getQuestion() == null || mapping.getSection() == null
                                        || "DELETED".equalsIgnoreCase(mapping.getStatus())
                                        || "DELETED".equalsIgnoreCase(mapping.getSection().getStatus())) {
                                continue;
                        }
                        if (typed && !TypedAnswerEvaluation.isAiGraded(mapping.getQuestion())) {
                                continue;
                        }
                        count++;
                }
                return count;
        }

        private String initiateEvaluationForAttempt(StudentAttempt attempt, String preferredModel) {
                return initiateEvaluationForAttempt(attempt, preferredModel, false);
        }

        /** True when the assessment's only live question is the manual-upload placeholder. */
        public boolean isPlaceholderOnly(Assessment assessment) {
                if (assessment == null) {
                        return false;
                }
                List<QuestionAssessmentSectionMapping> mappings = questionMappingRepository
                                .getQuestionAssessmentSectionMappingByAssessmentId(assessment.getId());
                List<QuestionAssessmentSectionMapping> live = mappings.stream()
                                .filter(m -> m.getStatus() == null || !"DELETED".equalsIgnoreCase(m.getStatus()))
                                .toList();
                if (live.size() != 1 || live.get(0).getQuestion() == null) {
                        return false;
                }
                var text = live.get(0).getQuestion().getTextData();
                String content = text != null && text.getContent() != null
                                ? text.getContent().replaceAll("<[^>]+>", "").trim()
                                : "";
                return PLACEHOLDER_QUESTION_TEXT.equalsIgnoreCase(content);
        }

        /**
         * The checker grades one {@code question_wise_marks} row per question, and a
         * learner's submit is what normally creates those rows. An attempt made by
         * staff — a single offline upload, a bulk-intake copy — never goes through a
         * submit, so it reached the checker with no rows and failed with "no
         * questions found for attempt" (every bulk copy, 2026-09-20). Give such an
         * attempt one PENDING zero-mark row per active question; an attempt that
         * already has rows (learner submit, retrofit backfill) is left exactly as is.
         */
        void ensureQuestionRows(StudentAttempt attempt) {
                if (attempt == null || attempt.getRegistration() == null
                                || attempt.getRegistration().getAssessment() == null) {
                        return;
                }
                if (!questionWiseMarksRepository.findByStudentAttemptId(attempt.getId()).isEmpty()) {
                        return;
                }
                Assessment assessment = attempt.getRegistration().getAssessment();
                List<QuestionWiseMarks> rows = new ArrayList<>();
                List<QuestionAssessmentSectionMapping> mappings = new ArrayList<>(questionMappingRepository
                                .getQuestionAssessmentSectionMappingByAssessmentId(assessment.getId()));
                // Paper order (section, then question): the checker numbers what it
                // gets in the order it gets it, and the student numbers as the paper does.
                mappings.sort(java.util.Comparator
                                .comparingInt((QuestionAssessmentSectionMapping m) -> m.getSection() != null
                                                && m.getSection().getSectionOrder() != null
                                                                ? m.getSection().getSectionOrder() : Integer.MAX_VALUE)
                                .thenComparingInt(m -> m.getQuestionOrder() != null ? m.getQuestionOrder() : Integer.MAX_VALUE));
                for (QuestionAssessmentSectionMapping mapping : mappings) {
                        if (mapping.getQuestion() == null || mapping.getSection() == null
                                        || "DELETED".equalsIgnoreCase(mapping.getStatus())
                                        || "DELETED".equalsIgnoreCase(mapping.getSection().getStatus())) {
                                continue;
                        }
                        rows.add(QuestionWiseMarks.builder()
                                        .assessment(assessment)
                                        .studentAttempt(attempt)
                                        .question(mapping.getQuestion())
                                        .section(mapping.getSection())
                                        .status("PENDING")
                                        .marks(0)
                                        .build());
                }
                if (!rows.isEmpty()) {
                        questionWiseMarksRepository.saveAll(rows);
                        log.info("Created {} pending question rows for attempt {} before its AI check",
                                        rows.size(), attempt.getId());
                }
        }

        /** Refuse to queue an AI check that has nothing real to grade against. */
        public void requireGradableQuestions(Assessment assessment) {
                if (isPlaceholderOnly(assessment)) {
                        throw new VacademyException(PLACEHOLDER_ONLY_MESSAGE);
                }
        }

        /**
         * @param queueOnly create the row as PENDING and let {@link AiEvaluationQueuePoller}
         *                  dispatch it under the in-flight cap, instead of starting it now.
         *                  Bulk runs must use this: dispatching 200 copies at once floods
         *                  the single AI pod. A teacher's one-off check keeps the
         *                  immediate path, so the page it opens shows progress at once.
         */
        public String initiateEvaluationForAttempt(StudentAttempt attempt, String preferredModel, boolean queueOnly) {
                return initiateEvaluationForAttempt(attempt, preferredModel, queueOnly, null);
        }

        /**
         * @param triggeredBy the teacher who asked for this check, so the completion
         *                    notice reaches them; null for automatic and bulk checks.
         */
        public String initiateEvaluationForAttempt(StudentAttempt attempt, String preferredModel, boolean queueOnly,
                        String triggeredBy) {
                return initiateEvaluationForAttempt(attempt, preferredModel, queueOnly, triggeredBy,
                                AiEvaluationEnqueueContext.dashboard());
        }

        /**
         * The one enqueue every channel goes through (dashboard trigger, bulk intake,
         * partner API).
         *
         * <ul>
         *   <li>A released result is refused (T0.33).</li>
         *   <li>An attempt already being checked returns that process (idempotent).</li>
         *   <li>Otherwise the copy is priced and checked against the institute's credits
         *       under the per-institute lock (10.6) - unless {@code context} carries a
         *       reservation the caller already made in this transaction - and the quote,
         *       rate snapshot, API key and page count are written on the new row.</li>
         * </ul>
         * Must run inside a transaction (the credit lock is transaction-scoped).
         */
        public String initiateEvaluationForAttempt(StudentAttempt attempt, String preferredModel, boolean queueOnly,
                        String triggeredBy, AiEvaluationEnqueueContext context) {
                String attemptId = attempt.getId();
                AiEvaluationEnqueueContext ctx = context != null ? context : AiEvaluationEnqueueContext.dashboard();

                requireNotReleased(attempt);

                // Idempotency: reuse an already-running evaluation for this attempt
                // instead of spawning a second concurrent (full-cost) run.
                List<AiEvaluationProcess> active = aiEvaluationProcessRepository
                                .findActiveByAttemptId(attemptId, ACTIVE_STATUSES);
                if (!active.isEmpty()) {
                        String existingId = active.get(0).getId();
                        log.info("Active evaluation {} already exists for attempt {}; returning it (idempotent)",
                                        existingId, attemptId);
                        return existingId;
                }

                ensureQuestionRows(attempt);

                AiEvaluationProcess process = new AiEvaluationProcess();
                // Remove manual ID setting - let @UuidGenerator handle it
                process.setStudentAttempt(attempt);
                // Get assessment from registration instead of assessmentSetMapping (which can
                // be null)
                Assessment assessment = attempt.getRegistration().getAssessment();
                process.setAssessment(assessment);
                process.setInstituteId(attempt.getRegistration().getInstituteId());
                process.setLane(laneFor(attempt, assessment).name());
                AiEvaluationCreditGate.Reservation reservation = ctx.reservation();
                if (reservation == null) {
                        AiEvaluationCharge charge = ctx.charge() != null ? ctx.charge() : dashboardCharge(attempt);
                        List<AiEvaluationCreditGate.Reservation> reserved = creditGate.reserve(process.getInstituteId(),
                                        List.of(charge), ctx.creditLimit(), ctx.creditMode());
                        reservation = reserved == null || reserved.isEmpty() ? null : reserved.get(0);
                }
                if (reservation != null) {
                        process.setQuotedCredits(reservation.quotedCredits());
                        process.setRateSnapshot(reservation.rateSnapshotJson());
                }
                process.setApiKeyId(ctx.apiKeyId());
                process.setPageCount(ctx.pageCount());
                process.setStatus(AiEvaluationStatusEnum.PENDING.name());
                process.setStartedAt(new Date());
                process.setTriggeredBy(triggeredBy);
                String claimToken = null;
                if (!queueOnly) {
                        // The direct path claims its own row, exactly like the poller does:
                        // DISPATCHED under a per-run token. The poller only takes PENDING
                        // rows, so it can never send this check a second time (2026-09-20:
                        // a teacher's check dispatched twice 12 s apart - duplicate tracking
                        // rows, every per-question callback failing with "2 results"), and
                        // the dispatch's guarded start only proceeds under this token. A
                        // dispatch that dies leaves a silent DISPATCHED row, which the
                        // sweeper puts back in the queue.
                        claimToken = "direct-" + UUID.randomUUID().toString().substring(0, 8);
                        process.setStatus(AiEvaluationStatusEnum.DISPATCHED.name());
                        process.setCurrentStep("CLAIMED");
                        process.setClaimedBy(claimToken);
                        process.setClaimedAt(new Date());
                }

                AiEvaluationProcess savedProcess = aiEvaluationProcessRepository.save(process);
                aiEvaluationProcessRepository.flush(); // Ensure the process is inserted before async call
                log.info("Created AI evaluation process with ID: {} for attempt: {}", savedProcess.getId(), attemptId);

                // Clear any stale cancellation flags from previous runs
                cancellationService.clearFlag(savedProcess.getId());

                if (queueOnly) {
                        log.info("Queued AI evaluation {} for attempt {} (poller will dispatch)", savedProcess.getId(), attemptId);
                        return savedProcess.getId();
                }

                // Defer the @Async dispatch until AFTER the parent transaction
                // commits. Without this, the async thread starts in parallel and
                // can call findById(processId) before the INSERT becomes visible
                // to other connections, surfacing as "Process not found" in logs.
                final String processId = savedProcess.getId();
                final String token = claimToken;
                if (TransactionSynchronizationManager.isSynchronizationActive()) {
                        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                                @Override
                                public void afterCommit() {
                                        dispatchNow(processId, attemptId, preferredModel, token);
                                }
                        });
                } else {
                        dispatchNow(processId, attemptId, preferredModel, token);
                }

                return processId;
        }

        /**
         * Hand a directly-triggered check to the dispatch executor. If the executor
         * cannot take it (queue full), the row goes back to the queue - PENDING,
         * claim cleared - and the poller sends it under the lane caps instead.
         */
        private void dispatchNow(String processId, String attemptId, String preferredModel, String claimToken) {
                try {
                        aiEvaluationAsyncService.evaluateAttemptAsync(processId, attemptId, preferredModel, claimToken);
                } catch (Exception e) {
                        log.warn("Could not start AI evaluation {} at once ({}); queueing it instead", processId,
                                        e.getMessage());
                        try {
                                aiEvaluationProcessRepository.handBackClaim(processId, claimToken, new Date());
                        } catch (Exception handBack) {
                                log.error("Could not queue AI evaluation {}: {}", processId, handBack.getMessage());
                        }
                }
        }

        /** COPY for an uploaded sheet, TYPED for an online attempt's written answers. */
        private AiEvaluationLane laneFor(StudentAttempt attempt, Assessment assessment) {
                try {
                        return AiEvaluationLane.of(typedAnswerEvaluation != null
                                        && typedAnswerEvaluation.isTypedAttempt(attempt, assessment));
                } catch (Exception e) {
                        return AiEvaluationLane.COPY;
                }
        }
}
