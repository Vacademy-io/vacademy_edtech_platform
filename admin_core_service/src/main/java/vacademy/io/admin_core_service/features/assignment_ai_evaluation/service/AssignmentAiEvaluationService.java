package vacademy.io.admin_core_service.features.assignment_ai_evaluation.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.client.AssignmentCopyCheckClient;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.dto.AssignmentAiBulkDTO;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.dto.AssignmentAiEvaluationDTO;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluation;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluationBatch;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationBatchRepository;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationRepository;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationRepository.LatestSubmissionRow;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.AssignmentSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.AssignmentSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.RichTextForAI;
import vacademy.io.admin_core_service.features.live_session.provider.support.ByteArrayMultipartFile;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.slide.entity.AssignmentSlide;
import vacademy.io.admin_core_service.features.slide.entity.AssignmentSlideQuestion;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.AssignmentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * The AI Evaluator for assignment copies: the same ai_service grader assessments use
 * ({@code /copy-check/grade}), driven from here because the submission lives in this
 * service. The whole assignment is graded as ONE answer out of the assignment's total
 * marks, with the grader's default model. The outcome is only a suggestion - it pre-fills
 * the teacher's grade form and reaches the learner when the teacher saves the grade.
 *
 * <p>Two ways in: one submission ("Check with AI", sent at once) and "Check all with AI"
 * (every unchecked latest submission of the batch, queued and sent a few at a time by
 * {@link AssignmentAiEvaluationQueueJob}). Both end in a notice to the teacher who asked.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AssignmentAiEvaluationService {

    /** A run with no callback for this long is reported failed (heartbeats come every 60 s). */
    static final Duration STALE_AFTER = Duration.ofMinutes(20);

    private final AssignmentAiEvaluationRepository evaluationRepository;
    private final AssignmentAiEvaluationBatchRepository batchRepository;
    private final AssignmentSlideTrackedRepository trackedRepository;
    private final SlideRepository slideRepository;
    private final AssignmentSlideRepository assignmentSlideRepository;
    private final MediaService mediaService;
    private final CreditClient creditClient;
    private final InstituteAccessValidator instituteAccessValidator;
    private final AssignmentCopyPdfBuilder pdfBuilder;
    private final AssignmentCopyCheckClient copyCheckClient;
    private final ObjectMapper objectMapper;
    private final AssignmentAiEvaluationNotifier notifier;
    private final PlatformTransactionManager transactionManager;

    @Value("${assignment.ai-evaluation.callback-base-url:http://admin-core-service:8072/admin-core-service/assignment-ai-evaluation/hook}")
    private String callbackBaseUrl;

    // ------------------------------------------------------------- one submission

    public AssignmentAiEvaluationDTO trigger(String trackedId, String instituteId, CustomUserDetails user) {
        // Spends the institute's credits: staff only, no root bypass (learners are root users).
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        AssignmentSlideTracked tracked = loadTrackedInInstitute(trackedId, instituteId);
        ActivityLog activityLog = tracked.getActivityLog();

        Optional<AssignmentAiEvaluation> active = evaluationRepository
                .findFirstByTrackedIdOrderByCreatedAtDesc(trackedId)
                .map(this::expireIfStale)
                .filter(e -> !e.isTerminal());
        if (active.isPresent()) {
            return AssignmentAiEvaluationDTO.from(active.get());
        }

        AssignmentSlide assignment = loadAssignment(activityLog.getSlideId());
        requireTotalMarks(assignment);
        requireCredits(instituteId, user.getUserId());

        // Created already PROCESSING so the queue job never picks it up as well; sent at
        // once, and a busy grader puts it back in the queue for the job to retry.
        AssignmentAiEvaluation evaluation = newRun(trackedId, activityLog.getSlideId(), activityLog.getUserId(),
                instituteId, user.getUserId(), assignment.getTotalMarks(), null,
                AssignmentAiEvaluation.STATUS_PROCESSING);
        dispatch(evaluation);
        return AssignmentAiEvaluationDTO.from(evaluationRepository.findById(evaluation.getId()).orElse(evaluation));
    }

    /** The latest run for the submission, or null when it was never evaluated. */
    public AssignmentAiEvaluationDTO latest(String trackedId, String instituteId, CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        loadTrackedInInstitute(trackedId, instituteId);
        return evaluationRepository.findFirstByTrackedIdOrderByCreatedAtDesc(trackedId)
                .map(this::expireIfStale)
                .map(AssignmentAiEvaluationDTO::from)
                .orElse(null);
    }

    // ---------------------------------------------------------------- bulk

    /** What "Check all with AI" would do right now - nothing is queued. */
    public AssignmentAiBulkDTO bulkPreview(String slideId, String packageSessionId, boolean includeChecked,
                                          String instituteId, CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        requireSlideInInstitute(slideId, instituteId);
        AssignmentAiBulkDTO dto = classify(evaluationRepository.findLatestSubmissions(slideId, blankToNull(packageSessionId)),
                includeChecked);
        dto.setTotalMarksSet(hasTotalMarks(loadAssignment(slideId)));
        return withLatestBatch(dto, slideId, packageSessionId, instituteId);
    }

    /**
     * Queues an AI check for every learner's latest submission that no teacher has graded
     * and that has no AI check yet. Light work only - the job does the sending.
     */
    public AssignmentAiBulkDTO bulkTrigger(String slideId, String packageSessionId, boolean includeChecked,
                                          String instituteId, CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        requireSlideInInstitute(slideId, instituteId);
        AssignmentSlide assignment = loadAssignment(slideId);
        requireTotalMarks(assignment);

        List<LatestSubmissionRow> rows = evaluationRepository.findLatestSubmissions(slideId, blankToNull(packageSessionId));
        AssignmentAiBulkDTO dto = classify(rows, includeChecked);
        if (dto.getToCheck() == 0) {
            throw new VacademyException("Nothing to check - every submitted copy is graded, checked or in progress");
        }
        requireCredits(instituteId, user.getUserId());

        AssignmentAiEvaluationBatch batch = new AssignmentAiEvaluationBatch();
        batch.setId(UUID.randomUUID().toString());
        batch.setSlideId(slideId);
        batch.setPackageSessionId(blankToNull(packageSessionId));
        batch.setInstituteId(instituteId);
        batch.setTriggeredBy(user.getUserId());
        batch.setTotalCount(dto.getToCheck());
        batchRepository.save(batch);

        for (LatestSubmissionRow row : rows) {
            if (!isCheckable(row, includeChecked)) {
                continue;
            }
            AssignmentSlideTracked tracked = trackedRepository.findById(row.getTrackedId()).orElse(null);
            if (tracked == null) {
                continue;
            }
            newRun(row.getTrackedId(), slideId, tracked.getActivityLog().getUserId(), instituteId,
                    user.getUserId(), assignment.getTotalMarks(), batch.getId(), AssignmentAiEvaluation.STATUS_QUEUED);
        }
        dto.setTotalMarksSet(true);
        return withLatestBatch(dto, slideId, packageSessionId, instituteId);
    }

    // ------------------------------------------------------------ the queue (job)

    /** Sends queued runs while fewer than {@code maxActive} are with the grader. */
    public int dispatchQueued(int maxActive) {
        long active = evaluationRepository.countByStatus(AssignmentAiEvaluation.STATUS_PROCESSING);
        int free = (int) Math.max(0, maxActive - active);
        if (free == 0) {
            return 0;
        }
        List<AssignmentAiEvaluation> queued = evaluationRepository.findByStatusOrderByCreatedAtAsc(
                AssignmentAiEvaluation.STATUS_QUEUED, PageRequest.of(0, free));
        int sent = 0;
        for (AssignmentAiEvaluation evaluation : queued) {
            if (dispatch(evaluation)) {
                sent++;
            } else if (AssignmentAiEvaluation.STATUS_QUEUED.equals(evaluation.getStatus())) {
                break; // the grader is busy: try the rest on the next tick
            }
        }
        return sent;
    }

    /** Runs the grader stopped answering for are failed, so batches always finish. */
    public void failStale() {
        for (AssignmentAiEvaluation e : evaluationRepository.findByStatusAndUpdatedAtBefore(
                AssignmentAiEvaluation.STATUS_PROCESSING, Instant.now().minus(STALE_AFTER))) {
            fail(e, "No response from the AI Evaluator. Try again.");
            announce(e);
        }
    }

    /** Batch notices nobody claimed when their last two runs finished together. */
    public void announceFinishedBatches() {
        for (String batchId : batchRepository.findUnnotifiedFinished()) {
            notifier.notifyBatchFinished(batchId);
        }
    }

    /**
     * Builds the copy and starts the grader for one run. True when it reached the grader;
     * false when it failed (row FAILED) or the grader was busy (row back to QUEUED).
     */
    boolean dispatch(AssignmentAiEvaluation evaluation) {
        evaluation.setStatus(AssignmentAiEvaluation.STATUS_PROCESSING);
        evaluation.setCurrentStep("PREPARING");
        evaluationRepository.save(evaluation);
        try {
            Prepared prepared = new TransactionTemplate(transactionManager).execute(status -> prepare(evaluation));
            String pdfUrl = copyUrl(evaluation, prepared.fileIds());
            Map<String, Object> request = buildGradeRequest(evaluation, prepared.questionText(),
                    prepared.assignmentId(), pdfUrl);
            String jobId = copyCheckClient.submitGrade(request);
            // One column only: a fast callback may already have moved the row on.
            evaluationRepository.setAiJobId(evaluation.getId(), jobId);
            return true;
        } catch (AssignmentCopyCheckClient.AiServiceBusyException e) {
            evaluation.setStatus(AssignmentAiEvaluation.STATUS_QUEUED);
            evaluation.setCurrentStep("QUEUED");
            evaluationRepository.save(evaluation);
            return false;
        } catch (VacademyException e) {
            fail(evaluation, e.getMessage());
        } catch (Exception e) {
            log.error("[assignment-ai-eval] could not start run {} for tracked {}: {}",
                    evaluation.getId(), evaluation.getTrackedId(), e.getMessage());
            fail(evaluation, "Could not start the AI Evaluator: " + e.getMessage());
        }
        announce(evaluation);
        return false;
    }

    record Prepared(String assignmentId, String questionText, List<String> fileIds) {
    }

    /** Everything read from the database, inside one transaction (the job has no open session). */
    private Prepared prepare(AssignmentAiEvaluation evaluation) {
        AssignmentSlideTracked tracked = trackedRepository.findById(evaluation.getTrackedId())
                .orElseThrow(() -> new VacademyException("The submission was replaced or removed"));
        Slide slide = slideRepository.findById(evaluation.getSlideId())
                .orElseThrow(() -> new VacademyException("The assignment slide no longer exists"));
        AssignmentSlide assignment = assignmentSlideRepository.findById(slide.getSourceId())
                .orElseThrow(() -> new VacademyException("The assignment no longer exists"));
        List<String> fileIds = splitIds(tracked.toAssignmentSlideActivityLog().getCommaSeparatedFileIds());
        return new Prepared(assignment.getId(), assignmentAsOneQuestion(slide, assignment), fileIds);
    }

    /** The one PDF the grader reads: the upload itself, or the merged copy. Recorded on the run. */
    private String copyUrl(AssignmentAiEvaluation evaluation, List<String> fileIds) {
        List<AssignmentCopyPdfBuilder.SourceFile> files = resolveFiles(fileIds);
        String url;
        if (AssignmentCopyPdfBuilder.isSinglePdf(files)) {
            evaluation.setSourceFileId(fileIds.get(0));
            url = files.get(0).url();
        } else {
            evaluation.setSourceFileId(uploadMergedCopy(pdfBuilder.build(files), evaluation.getTrackedId()));
            url = mediaService.getFilePublicUrlById(evaluation.getSourceFileId());
        }
        evaluationRepository.save(evaluation);
        return url;
    }

    // ------------------------------------------------------------- ai_service callbacks

    public void onProgress(Map<String, Object> payload) {
        Object processId = payload == null ? null : payload.get("process_id");
        if (processId == null) {
            return;
        }
        Object step = payload.get("step");
        // A targeted update, not load-and-save: heartbeats run alongside the question
        // callback and a full-row save could put back the marks it just wrote. It also
        // touches updated_at, so a long run with the same step does not look stale.
        evaluationRepository.recordProgress(String.valueOf(processId),
                step == null ? null : String.valueOf(step), Instant.now());
    }

    public void onQuestion(Map<String, Object> payload) {
        findForCallback(payload).ifPresent(e -> {
            if (e.isTerminal()) {
                return;
            }
            if ("FAILED".equalsIgnoreCase(String.valueOf(payload.get("status")))) {
                Object detail = payload.get("error_detail");
                e.setErrorMessage(detail == null ? "The AI could not grade this copy" : String.valueOf(detail));
            } else {
                e.setMarksAwarded(toDouble(payload.get("marks_awarded")));
                Object feedback = payload.get("feedback");
                e.setFeedback(feedback == null ? null : String.valueOf(feedback));
            }
            e.setResultJson(toJson(payload));
            e.setCurrentStep("GRADING");
            evaluationRepository.save(e);
        });
    }

    public void onComplete(Map<String, Object> payload) {
        findForCallback(payload).ifPresent(e -> {
            if (e.isTerminal()) {
                return;
            }
            if (e.getMarksAwarded() == null && e.getErrorMessage() != null) {
                // The only question failed to grade: there is nothing to suggest.
                e.setStatus(AssignmentAiEvaluation.STATUS_FAILED);
                evaluationRepository.save(e);
                announce(e);
                return;
            }
            if (e.getMarksAwarded() == null) {
                e.setMarksAwarded(toDouble(payload.get("total_marks_awarded")));
            }
            Object evaluatedFileId = payload.get("evaluated_file_id");
            if (evaluatedFileId != null && !String.valueOf(evaluatedFileId).isBlank()) {
                e.setEvaluatedFileId(String.valueOf(evaluatedFileId));
            }
            e.setStatus(AssignmentAiEvaluation.STATUS_COMPLETED);
            e.setCurrentStep("COMPLETED");
            e.setErrorMessage(null);
            evaluationRepository.save(e);
            // The teacher who started it reviews it; the learner sees nothing until they save the grade.
            announce(e);
        });
    }

    public void onFailed(Map<String, Object> payload) {
        findForCallback(payload).ifPresent(e -> {
            if (e.isTerminal()) {
                return;
            }
            Object message = payload.get("error_message");
            fail(e, message == null ? "The AI Evaluator failed" : String.valueOf(message));
            announce(e);
        });
    }

    // ---------------------------------------------------------------------- helpers

    /** The submission, if its slide belongs to the institute. */
    public AssignmentSlideTracked loadTrackedInInstitute(String trackedId, String instituteId) {
        AssignmentSlideTracked tracked = trackedRepository.findById(trackedId)
                .orElseThrow(() -> new ResourceNotFoundException("Assignment submission not found"));
        requireSlideInInstitute(tracked.getActivityLog().getSlideId(), instituteId);
        return tracked;
    }

    private void requireSlideInInstitute(String slideId, String instituteId) {
        if (slideId == null || !evaluationRepository.isSlideInInstitute(slideId, instituteId)) {
            throw new ForbiddenException("Access denied: assignment does not belong to institute " + instituteId);
        }
    }

    private AssignmentSlide loadAssignment(String slideId) {
        Slide slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("Slide not found"));
        return assignmentSlideRepository.findById(slide.getSourceId())
                .orElseThrow(() -> new ResourceNotFoundException("Assignment not found for this slide"));
    }

    private static boolean hasTotalMarks(AssignmentSlide assignment) {
        return assignment.getTotalMarks() != null && assignment.getTotalMarks() > 0;
    }

    private static void requireTotalMarks(AssignmentSlide assignment) {
        if (!hasTotalMarks(assignment)) {
            throw new VacademyException("Set Total Marks on this assignment before using the AI Evaluator");
        }
    }

    /**
     * A known empty wallet refuses (an unreadable one does not), as before, unless the
     * institute's LIVE AI plan covers the copy check ({@link CreditClient#planCovers}: no
     * LIVE plan = no extra call, any failure = refused as today).
     */
    private void requireCredits(String instituteId, String teacherUserId) {
        Optional<Double> balance = creditClient.readBalance(instituteId);
        if (balance.isPresent() && balance.get() <= 0
                && !creditClient.planCovers(instituteId, PLAN_REQUEST_TYPE, null, PLAN_ESTIMATED_TOKENS,
                        teacherUserId, MeteringFields.user(PLAN_USE_CASE, MeteringFields.SURFACE_ADMIN_APP).build())) {
            throw new VacademyException("Not enough AI credits to run the AI Evaluator");
        }
    }

    /** The copy-check charge's request_type / catalog use case (ai_service copy check). */
    static final String PLAN_REQUEST_TYPE = "evaluation";
    static final String PLAN_USE_CASE = "evaluation";
    /** Rough estimate of one answer-sheet check, for the plan pre-check only. */
    static final int PLAN_ESTIMATED_TOKENS = 6000;

    private AssignmentAiEvaluation newRun(String trackedId, String slideId, String learnerId, String instituteId,
                                          String teacherId, Double maxMarks, String batchId, String status) {
        AssignmentAiEvaluation evaluation = new AssignmentAiEvaluation();
        evaluation.setId(UUID.randomUUID().toString());
        evaluation.setTrackedId(trackedId);
        evaluation.setSlideId(slideId);
        evaluation.setInstituteId(instituteId);
        evaluation.setUserId(learnerId);
        evaluation.setTriggeredBy(teacherId);
        evaluation.setBatchId(batchId);
        evaluation.setStatus(status);
        evaluation.setCurrentStep(AssignmentAiEvaluation.STATUS_QUEUED.equals(status) ? "QUEUED" : "PREPARING");
        evaluation.setMaxMarks(maxMarks);
        return evaluationRepository.save(evaluation);
    }

    private static boolean isInProgress(LatestSubmissionRow row) {
        return AssignmentAiEvaluation.STATUS_QUEUED.equals(row.getAiStatus())
                || AssignmentAiEvaluation.STATUS_PROCESSING.equals(row.getAiStatus());
    }

    /**
     * A copy is checked when no teacher graded it yet, it has files, it is not being
     * checked right now, and - unless the teacher asked to re-check - the AI never checked it.
     */
    private static boolean isCheckable(LatestSubmissionRow row, boolean includeChecked) {
        if (Boolean.TRUE.equals(row.getGraded()) || !Boolean.TRUE.equals(row.getHasFiles()) || isInProgress(row)) {
            return false;
        }
        return includeChecked || row.getAiStatus() == null;
    }

    static AssignmentAiBulkDTO classify(List<LatestSubmissionRow> rows, boolean includeChecked) {
        AssignmentAiBulkDTO dto = new AssignmentAiBulkDTO();
        for (LatestSubmissionRow row : rows) {
            dto.setSubmissions(dto.getSubmissions() + 1);
            if (Boolean.TRUE.equals(row.getGraded())) {
                dto.setAlreadyGraded(dto.getAlreadyGraded() + 1);
            } else if (!Boolean.TRUE.equals(row.getHasFiles())) {
                dto.setNoFiles(dto.getNoFiles() + 1);
            } else if (isInProgress(row)) {
                dto.setInProgress(dto.getInProgress() + 1);
            } else if (row.getAiStatus() != null) {
                dto.setAlreadyAiChecked(dto.getAlreadyAiChecked() + 1);
                if (includeChecked) {
                    dto.setToCheck(dto.getToCheck() + 1);
                }
            } else {
                dto.setToCheck(dto.getToCheck() + 1);
            }
        }
        return dto;
    }

    private AssignmentAiBulkDTO withLatestBatch(AssignmentAiBulkDTO dto, String slideId, String packageSessionId,
                                               String instituteId) {
        batchRepository.findLatest(slideId, blankToNull(packageSessionId), instituteId).ifPresent(batch -> {
            AssignmentAiBulkDTO.BatchProgress progress = new AssignmentAiBulkDTO.BatchProgress();
            progress.setBatchId(batch.getId());
            progress.setTotal(batch.getTotalCount());
            progress.setCreatedAt(batch.getCreatedAt());
            for (Object[] row : evaluationRepository.countByStatusForBatch(batch.getId())) {
                int count = ((Number) row[1]).intValue();
                switch (String.valueOf(row[0])) {
                    case AssignmentAiEvaluation.STATUS_COMPLETED -> progress.setCompleted(count);
                    case AssignmentAiEvaluation.STATUS_FAILED -> progress.setFailed(count);
                    default -> progress.setPending(progress.getPending() + count);
                }
            }
            progress.setDone(progress.getPending() == 0);
            dto.setLatestBatch(progress);
        });
        return dto;
    }

    /** Single runs notify on their own; bulk runs count toward one notice for the batch. */
    private void announce(AssignmentAiEvaluation e) {
        if (e.getBatchId() == null) {
            notifier.notifyFinished(e.getId());
        } else {
            notifier.notifyBatchFinished(e.getBatchId());
        }
    }

    Map<String, Object> buildGradeRequest(AssignmentAiEvaluation evaluation, String questionText,
                                          String assignmentId, String pdfUrl) {
        Map<String, Object> question = new LinkedHashMap<>();
        // The rubric ai_service generates is stored per (assessment_id, question_id) and
        // reused for every learner. Keying the question on its text and marks means an
        // edited assignment gets a fresh rubric instead of the stale one.
        question.put("question_id", "asg-" + shortHash(questionText + "|" + evaluation.getMaxMarks()));
        question.put("question_text", questionText);
        question.put("question_type", "LONG_ANSWER");
        question.put("max_marks", evaluation.getMaxMarks());
        question.put("question_number", 1);

        Map<String, Object> examContext = new LinkedHashMap<>();
        examContext.put("instructions", "This is a homework assignment, not an exam paper. Grade the whole "
                + "submission as ONE answer to the assignment: the learner may answer its parts in any "
                + "order across the pages, typed or handwritten.");

        Map<String, Object> request = new LinkedHashMap<>();
        request.put("process_id", evaluation.getId());
        request.put("attempt_id", evaluation.getTrackedId());
        request.put("assessment_id", assignmentId);
        request.put("institute_id", evaluation.getInstituteId());
        request.put("answer_mode", "COPY");
        request.put("pdf_url", pdfUrl);
        request.put("questions", List.of(question));
        // No preferred_model: the grader's own default model, same as assessments.
        request.put("callback_base_url", callbackBaseUrl);
        request.put("exam_context", examContext);
        // The whole copy is the answer: locating it per question could only hide pages.
        request.put("skip_answer_location", true);
        return request;
    }

    static String assignmentAsOneQuestion(Slide slide, AssignmentSlide assignment) {
        StringBuilder text = new StringBuilder();
        if (slide.getTitle() != null && !slide.getTitle().isBlank()) {
            text.append("Assignment: ").append(slide.getTitle().trim()).append("\n\n");
        }
        if (assignment.getParentRichText() != null) {
            appendBlock(text, RichTextForAI.toPlainText(assignment.getParentRichText().getContent()));
        }
        if (assignment.getTextData() != null) {
            appendBlock(text, RichTextForAI.toPlainText(assignment.getTextData().getContent()));
        }
        List<AssignmentSlideQuestion> questions = assignment.getAssignmentSlideQuestions() == null
                ? List.of()
                : assignment.getAssignmentSlideQuestions().stream()
                        .sorted(Comparator.comparing(AssignmentSlideQuestion::getQuestionOrder,
                                Comparator.nullsLast(Comparator.naturalOrder())))
                        .toList();
        int number = 1;
        StringBuilder tasks = new StringBuilder();
        for (AssignmentSlideQuestion q : questions) {
            if (q.getTextData() == null) {
                continue;
            }
            String task = RichTextForAI.toPlainText(q.getTextData().getContent());
            if (task != null && !task.isBlank()) {
                tasks.append(number++).append(". ").append(task.trim()).append("\n");
            }
        }
        if (!tasks.isEmpty()) {
            text.append("Questions:\n").append(tasks);
        }
        String result = text.toString().trim();
        if (result.isEmpty()) {
            throw new VacademyException("This assignment has no instructions or questions for the AI to grade against");
        }
        return result;
    }

    private static void appendBlock(StringBuilder text, String block) {
        if (block != null && !block.isBlank()) {
            text.append(block.trim()).append("\n\n");
        }
    }

    private List<AssignmentCopyPdfBuilder.SourceFile> resolveFiles(List<String> fileIds) {
        if (fileIds.isEmpty()) {
            throw new VacademyException("This submission has no uploaded files to evaluate");
        }
        Map<String, FileDetailsDTO> byId = new HashMap<>();
        for (FileDetailsDTO details : mediaService.getFilesByIds(fileIds)) {
            if (details != null && details.getId() != null) {
                byId.put(details.getId(), details);
            }
        }
        List<AssignmentCopyPdfBuilder.SourceFile> files = new ArrayList<>();
        for (String id : fileIds) {
            FileDetailsDTO details = byId.get(id);
            String url = details != null && details.getUrl() != null ? details.getUrl()
                    : mediaService.getFilePublicUrlById(id);
            String name = details != null && details.getFileName() != null ? details.getFileName() : id;
            String type = details != null ? details.getFileType() : null;
            files.add(new AssignmentCopyPdfBuilder.SourceFile(name, type, url));
        }
        return files;
    }

    private String uploadMergedCopy(byte[] pdf, String trackedId) {
        try {
            FileDetailsDTO uploaded = mediaService.uploadFileV2(new ByteArrayMultipartFile(
                    pdf, "assignment-copy-" + trackedId + ".pdf", "application/pdf"));
            if (uploaded == null || uploaded.getId() == null) {
                throw new VacademyException("Could not upload the combined copy for the AI Evaluator");
            }
            return uploaded.getId();
        } catch (java.io.IOException e) {
            throw new VacademyException("Could not upload the combined copy for the AI Evaluator: " + e.getMessage());
        }
    }

    private Optional<AssignmentAiEvaluation> findForCallback(Map<String, Object> payload) {
        Object processId = payload == null ? null : payload.get("process_id");
        if (processId == null) {
            return Optional.empty();
        }
        Optional<AssignmentAiEvaluation> found = evaluationRepository.findById(String.valueOf(processId));
        if (found.isEmpty()) {
            log.warn("[assignment-ai-eval] callback for unknown process {}", processId);
        }
        return found;
    }

    /** Only a run that is WITH the grader can go stale; a queued one is just waiting its turn. */
    private AssignmentAiEvaluation expireIfStale(AssignmentAiEvaluation e) {
        if (AssignmentAiEvaluation.STATUS_PROCESSING.equals(e.getStatus()) && e.getUpdatedAt() != null
                && e.getUpdatedAt().isBefore(Instant.now().minus(STALE_AFTER))) {
            fail(e, "No response from the AI Evaluator. Try again.");
            announce(e);
        }
        return e;
    }

    private void fail(AssignmentAiEvaluation e, String message) {
        e.setStatus(AssignmentAiEvaluation.STATUS_FAILED);
        e.setErrorMessage(message);
        evaluationRepository.save(e);
    }

    static List<String> splitIds(String commaSeparated) {
        if (commaSeparated == null || commaSeparated.isBlank()) {
            return List.of();
        }
        return Arrays.stream(commaSeparated.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static Double toDouble(Object value) {
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        if (value != null) {
            try {
                return Double.parseDouble(String.valueOf(value));
            } catch (NumberFormatException ignored) {
                // fall through
            }
        }
        return null;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return null;
        }
    }

    private static String shortHash(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest, 0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
