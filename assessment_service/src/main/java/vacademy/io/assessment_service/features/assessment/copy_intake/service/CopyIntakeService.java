package vacademy.io.assessment_service.features.assessment.copy_intake.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.dto.CopyIntakeDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeBatchRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Candidate;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Scored;
import vacademy.io.assessment_service.features.assessment.dto.batch_pending.EnrolledLearnerDto;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttachmentsRequest;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttemptCreateRequest;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttemptCreateResponse;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentBatchRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationEnqueueContext;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckConfig;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCommentPlacement;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * Bulk AI copy-check: from a pile of scanned PDFs to graded attempts.
 *
 * <p>Start creates the batch and its items and returns at once; the runner
 * ({@link CopyIntakeRunner}) works through the items off the request thread.
 * Every item is isolated - one unreadable file fails alone - and every step
 * writes its state to the row, so a redeploy mid-batch loses nothing that
 * cannot be resumed from the database.
 *
 * <p>Two rules keep this honest under concurrency (two worker threads, two
 * pods, a sweep overlapping the first run, callbacks landing together):
 * <ul>
 *   <li>a copy is taken with an atomic status transition (PENDING to
 *       IDENTIFYING); whoever loses the race leaves it alone;</li>
 *   <li>the batch stores no counters. Everything shown is counted from the
 *       items on read, so nothing is ever lost to a read-modify-write.</li>
 * </ul>
 * The slow part - two network calls per copy - runs outside any transaction,
 * so a 200-copy batch never pins a pool connection for minutes at a time.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CopyIntakeService {

    private final AiCopyIntakeBatchRepository batchRepository;
    private final AiCopyIntakeItemRepository itemRepository;
    private final AssessmentRepository assessmentRepository;
    private final AiEvaluationProcessRepository processRepository;
    private final AssessmentUserRegistrationRepository registrationRepository;
    private final AssessmentBatchRegistrationRepository batchRegistrationRepository;
    private final AdminCoreServiceClient adminCoreServiceClient;
    private final AiServiceCopyCheckClient aiServiceCopyCheckClient;
    private final AdminOfflineDataEntryManager offlineDataEntryManager;
    private final AiEvaluationService aiEvaluationService;
    private final StudentAttemptService studentAttemptService;
    private final CopyIntakeNotifier notifier;
    private final AssessmentAuditClient auditClient;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate tx;
    private final AuthService authService;
    private final InstituteFileOwnership fileOwnership;

    @Value("${media.service.baseurl}")
    private String mediaServiceUrl;

    /** A copy stuck in IDENTIFYING this long belongs to a worker that died. */
    @Value("${assessment.copy-intake.identify-stale-minutes:10}")
    private long identifyStaleMinutes;

    public static final int MAX_FILES_PER_BATCH = 500;

    private static final List<String> ACTIVE_STATUSES = List.of("ACTIVE");

    /** Item states in which a copy is, or will be, on a student's record. */
    private static final List<String> PLACED = List.of(
            AiCopyIntakeItem.MATCHED, AiCopyIntakeItem.QUEUED, AiCopyIntakeItem.EVALUATING, AiCopyIntakeItem.COMPLETED);

    /** Per-status tally of a batch's copies, counted from the items. */
    public record Counts(int total, int pending, int identifying, int matched, int ambiguous, int unmatched,
                         int queued, int evaluating, int completed, int failed, int skipped) {
        public int identified() { return total - pending - identifying; }
        public int waiting() { return ambiguous + unmatched; }
        public int active() { return pending + identifying + matched + queued + evaluating; }
    }

    // ------------------------------------------------------------------ start

    @Transactional
    public AiCopyIntakeBatch start(CustomUserDetails user, String assessmentId, String instituteId,
                                   CopyIntakeDtos.StartRequest request) {
        if (request == null || request.getFiles() == null || request.getFiles().isEmpty()) {
            throw new VacademyException("Upload at least one copy");
        }
        if (request.getFiles().size() > MAX_FILES_PER_BATCH) {
            throw new VacademyException("At most " + MAX_FILES_PER_BATCH + " copies per batch; split the upload");
        }
        Assessment assessment = assessmentRepository.findById(assessmentId)
                .orElseThrow(() -> new VacademyException("Assessment not found"));
        // Before any file is touched: 200 copies graded against the "Upload your
        // answer sheet" placeholder would be 200 confident random scores.
        aiEvaluationService.requireGradableQuestions(assessment);

        // The same file twice in one upload is a double-click, not two copies.
        Set<String> seen = new HashSet<>();
        List<CopyIntakeDtos.UploadedFile> usable = new ArrayList<>();
        for (CopyIntakeDtos.UploadedFile f : request.getFiles()) {
            if (f != null && StringUtils.hasText(f.getFileId()) && seen.add(f.getFileId())) usable.add(f);
        }
        if (usable.isEmpty()) {
            throw new VacademyException("No usable files in the upload");
        }
        // Only the institute's own uploads (G12): a fileId is just a string, and this
        // pipeline reads the sheet and attaches it to one of this exam's students.
        List<String> foreign = fileOwnership.notOwnedBy(instituteId,
                usable.stream().map(CopyIntakeDtos.UploadedFile::getFileId).toList());
        if (!foreign.isEmpty()) {
            log.warn("[copy-intake] refused {} file(s) not recorded for institute {} on assessment {}: {}",
                    foreign.size(), instituteId, assessmentId, foreign);
            throw new VacademyException(foreign.size() == 1
                    ? "One of the files was not uploaded for this institute; upload it again from this page"
                    : foreign.size() + " of the files were not uploaded for this institute; upload them again from this page");
        }
        // Every copy must fit the institute's AI credits before any work starts (10.6);
        // each is checked again, under the institute lock, when it is queued.
        aiEvaluationService.requireCreditsForCopies(assessment, instituteId, usable.size());
        rememberCommentPlacement(assessment, request.getCommentPlacement());
        rememberCopyCheckConfig(assessment, request.getCopyCheckConfig());

        AiCopyIntakeBatch batch = batchRepository.save(AiCopyIntakeBatch.builder()
                .assessmentId(assessment.getId())
                .instituteId(instituteId)
                .createdBy(user.getUserId())
                .createdByName(user.getFullName())
                .createdByEmail(creatorEmail(user))
                .preferredModel(request.getPreferredModel())
                .status(AiCopyIntakeBatch.RUNNING)
                .source(AiCopyIntakeBatch.SOURCE_UPLOAD)
                .totalItems(usable.size())
                .notifyEmail(request.getNotifyEmail() == null || request.getNotifyEmail())
                .build());

        List<AiCopyIntakeItem> items = new ArrayList<>();
        for (CopyIntakeDtos.UploadedFile f : usable) {
            items.add(AiCopyIntakeItem.builder()
                    .batchId(batch.getId())
                    .fileId(f.getFileId())
                    .fileName(f.getFileName())
                    .pageCount(f.getPageCount())
                    .status(AiCopyIntakeItem.PENDING)
                    .build());
        }
        itemRepository.saveAll(items);

        auditClient.record(user, instituteId, "BULK_AI_CHECK", assessmentId,
                "started AI check of " + items.size() + " uploaded copies for assessment " + assessment.getName(),
                Map.of("batch_id", batch.getId(), "copies", items.size()));
        return batch;
    }

    /** Keep the checked-copy template chosen for this batch on the assessment; dispatch reads it there. */
    private void rememberCommentPlacement(Assessment assessment, String requested) {
        String placement = CopyCommentPlacement.changed(assessment, requested);
        if (placement != null) {
            assessmentRepository.updateCopyCommentPlacement(assessment.getId(), placement);
        }
    }

    /**
     * Keep the AI checking settings sent with this batch on the assessment; dispatch
     * reads them there. Settings sent empty clear the assessment's own, so the
     * institute default applies again; no settings sent leaves them as they are.
     */
    private void rememberCopyCheckConfig(Assessment assessment, CopyCheckConfig.Settings requested) {
        if (!CopyCheckConfig.differs(assessment, requested)) {
            return;
        }
        String json = CopyCheckConfig.write(requested);
        if (json == null) {
            assessmentRepository.clearCopyCheckConfig(assessment.getId());
        } else {
            assessmentRepository.updateCopyCheckConfig(assessment.getId(), json);
        }
    }

    /** Store the AI checking settings on their own; returns what is now kept. */
    @Transactional
    public CopyCheckConfig.Settings saveCopyCheckConfig(String assessmentId, CopyCheckConfig.Settings settings) {
        Assessment assessment = assessmentRepository.findById(assessmentId)
                .orElseThrow(() -> new VacademyException("Assessment not found"));
        rememberCopyCheckConfig(assessment, settings);
        return CopyCheckConfig.normalize(settings);
    }

    /** The AI checking settings kept on the assessment, for the dialog to start from. */
    @Transactional(readOnly = true)
    public CopyCheckConfig.Settings copyCheckConfig(String assessmentId) {
        return CopyCheckConfig.on(assessmentRepository.findById(assessmentId).orElse(null));
    }

    // ------------------------------------------------- submitted copies

    /**
     * Evaluation states that mean "the AI is on this copy now": the shared list
     * (queued, claimed, running), so a newly added state is never missed here.
     */
    private static final List<String> EVALUATION_ACTIVE =
            vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum.ACTIVE;

    /** One submitted attempt and where its AI check stands. */
    private record SubmittedCopy(StudentAttempt attempt, String fileId, boolean checked, boolean running) {
    }

    /**
     * Which of the learners' own submissions a check would touch. Answers the
     * dialog's "62 submitted, 12 already checked, 3 running - 47 will be
     * checked" before a credit is spent, and is the exact list
     * {@link #startFromSubmitted} queues, so the quote and the bill agree.
     *
     * <p>Only an ENDED attempt with an uploaded sheet counts: a LIVE one is
     * still being written, and one without a file (an online attempt) would be
     * dispatched only to fail with "nothing to grade".
     */
    @Transactional(readOnly = true)
    public CopyIntakeDtos.SubmittedPreviewDto previewSubmitted(String assessmentId, List<String> attemptIds,
                                                               boolean includeChecked) {
        List<SubmittedCopy> copies = submittedCopies(assessmentId, attemptIds);
        int withCopy = 0, checked = 0, running = 0, noCopy = 0;
        List<String> toCheck = new ArrayList<>();
        for (SubmittedCopy c : copies) {
            if (c.fileId() == null) {
                noCopy++;
                continue;
            }
            withCopy++;
            if (c.running()) {
                running++;
            } else if (c.checked()) {
                checked++;
                if (includeChecked) toCheck.add(c.attempt().getId());
            } else {
                toCheck.add(c.attempt().getId());
            }
        }
        return CopyIntakeDtos.SubmittedPreviewDto.builder()
                .considered(copies.size()).withCopy(withCopy).alreadyChecked(checked).inProgress(running)
                .noCopy(noCopy).toCheck(toCheck.size()).attemptIds(toCheck).build();
    }

    /**
     * Queue the AI check for copies the learners submitted themselves, as one
     * batch. Every item is born QUEUED on its own attempt - there is no file to
     * read or student to match - so the runner's pass finds nothing to
     * identify and only settles the batch as the checks come back. The
     * evaluation poller paces the dispatch under its in-flight cap exactly as
     * for an uploaded pile; one email and one bell announce the batch.
     */
    @Transactional
    public AiCopyIntakeBatch startFromSubmitted(CustomUserDetails user, String assessmentId, String instituteId,
                                                CopyIntakeDtos.SubmittedRequest request) {
        Assessment assessment = assessmentRepository.findById(assessmentId)
                .orElseThrow(() -> new VacademyException("Assessment not found"));
        aiEvaluationService.requireGradableQuestions(assessment);

        boolean includeChecked = request != null && Boolean.TRUE.equals(request.getIncludeChecked());
        List<String> wanted = request == null ? null : request.getAttemptIds();
        List<SubmittedCopy> copies = submittedCopies(assessmentId, wanted).stream()
                .filter(c -> c.fileId() != null && !c.running() && (includeChecked || !c.checked()))
                .toList();
        if (copies.isEmpty()) {
            throw new VacademyException(wanted == null || wanted.isEmpty()
                    ? "No submitted copies are waiting for a check on this assessment"
                    : "None of the selected students has a submitted copy waiting for a check");
        }
        if (copies.size() > MAX_FILES_PER_BATCH) {
            throw new VacademyException("At most " + MAX_FILES_PER_BATCH + " copies per batch; select fewer students");
        }

        // One credit check for the whole batch, held under the institute lock until this
        // transaction commits (10.6); a shortfall refuses the batch with the reason.
        Map<String, AiEvaluationCreditGate.Reservation> reserved = aiEvaluationService.reserveDashboardCredits(
                copies.stream().map(SubmittedCopy::attempt).toList());

        if (request != null) {
            rememberCommentPlacement(assessment, request.getCommentPlacement());
            rememberCopyCheckConfig(assessment, request.getCopyCheckConfig());
        }

        String model = request == null ? null : request.getPreferredModel();
        AiCopyIntakeBatch batch = batchRepository.save(AiCopyIntakeBatch.builder()
                .assessmentId(assessment.getId())
                .instituteId(instituteId)
                .createdBy(user.getUserId())
                .createdByName(user.getFullName())
                .createdByEmail(creatorEmail(user))
                .preferredModel(model)
                .status(AiCopyIntakeBatch.RUNNING)
                .source(AiCopyIntakeBatch.SOURCE_SUBMITTED)
                .totalItems(copies.size())
                .notifyEmail(request == null || request.getNotifyEmail() == null || request.getNotifyEmail())
                .build());

        List<AiCopyIntakeItem> items = new ArrayList<>();
        for (SubmittedCopy c : copies) {
            StudentAttempt attempt = c.attempt();
            AssessmentUserRegistration reg = attempt.getRegistration();
            String name = reg != null && StringUtils.hasText(reg.getParticipantName())
                    ? reg.getParticipantName() : "Student";
            // The teacher is recorded on the run so the evaluations page shows who
            // asked; the completion notice still comes from this batch, not per copy.
            AiEvaluationCreditGate.Reservation reservation = reserved == null ? null : reserved.get(attempt.getId());
            String processId = aiEvaluationService.initiateEvaluationForAttempt(attempt, model, true, user.getUserId(),
                    AiEvaluationEnqueueContext.dashboard().withReservation(
                            reservation != null ? reservation : AiEvaluationCreditGate.Reservation.NONE));
            items.add(AiCopyIntakeItem.builder()
                    .batchId(batch.getId())
                    .fileId(c.fileId())
                    .fileName(name)
                    .status(AiCopyIntakeItem.QUEUED)
                    .matchedUserId(reg == null ? null : reg.getUserId())
                    .matchedName(name)
                    .registrationId(reg == null ? null : reg.getId())
                    .attemptId(attempt.getId())
                    .processId(processId)
                    .build());
        }
        itemRepository.saveAll(items);

        auditClient.record(user, instituteId, "BULK_AI_CHECK", assessmentId,
                "started AI check of " + items.size() + " submitted copies for assessment " + assessment.getName(),
                Map.of("batch_id", batch.getId(), "copies", items.size(), "source", AiCopyIntakeBatch.SOURCE_SUBMITTED));
        return batch;
    }

    /**
     * The assessment's ENDED attempts (or the given ones, kept to this
     * assessment) with their submitted file and AI-check state. The evaluation
     * rows are fetched in one query for the whole set.
     */
    private List<SubmittedCopy> submittedCopies(String assessmentId, List<String> attemptIds) {
        List<StudentAttempt> attempts = attemptIds == null || attemptIds.isEmpty()
                ? studentAttemptService.getAllParticipantsAttemptForAssessment(assessmentId)
                : studentAttemptService.getStudentAttemptsByIds(attemptIds);
        List<StudentAttempt> ended = attempts.stream()
                .filter(a -> a != null && a.getRegistration() != null
                        && a.getRegistration().getAssessment() != null
                        && assessmentId.equals(a.getRegistration().getAssessment().getId())
                        && "ENDED".equalsIgnoreCase(a.getStatus()))
                // A released result is frozen (G8, T0.33): it is never offered for a check.
                .filter(a -> !ReleaseResultStatusEnum.RELEASED.name().equalsIgnoreCase(a.getReportReleaseStatus()))
                .toList();
        if (ended.isEmpty()) return List.of();

        Map<String, Boolean> checkedByAttempt = new HashMap<>();
        Map<String, Boolean> runningByAttempt = new HashMap<>();
        List<String> ids = ended.stream().map(StudentAttempt::getId).toList();
        for (AiEvaluationProcess p : processRepository.findByStudentAttempt_IdIn(ids)) {
            if (p.getStudentAttempt() == null || p.getStatus() == null) continue;
            String id = p.getStudentAttempt().getId();
            String status = p.getStatus().toUpperCase(Locale.ROOT);
            if (EVALUATION_ACTIVE.contains(status)) runningByAttempt.put(id, true);
            else if ("COMPLETED".equals(status)) checkedByAttempt.put(id, true);
        }
        List<SubmittedCopy> out = new ArrayList<>(ended.size());
        for (StudentAttempt a : ended) {
            out.add(new SubmittedCopy(a, submittedFileId(a.getAttemptData()),
                    checkedByAttempt.getOrDefault(a.getId(), false),
                    runningByAttempt.getOrDefault(a.getId(), false)));
        }
        return out;
    }

    /** The learner's uploaded sheet - the same key the checker grades from. */
    private String submittedFileId(String attemptData) {
        if (!StringUtils.hasText(attemptData)) return null;
        try {
            String fileId = objectMapper.readTree(attemptData).path("fileId").asText(null);
            return StringUtils.hasText(fileId) ? fileId : null;
        } catch (Exception e) {
            return null;
        }
    }

    // -------------------------------------------------------- identification

    /**
     * Read the name off one copy and place it. Called by the runner per item,
     * from a worker thread, NOT inside a transaction: the media and AI calls
     * take seconds and must not hold a connection. The writes around them are
     * short transactions of their own.
     */
    public void identifyAndPlace(String itemId, List<Candidate> candidates) {
        if (itemRepository.transition(itemId, AiCopyIntakeItem.PENDING, AiCopyIntakeItem.IDENTIFYING) == 0) {
            return;      // another worker / pod has this copy
        }
        AiCopyIntakeItem item = itemRepository.findById(itemId).orElse(null);
        if (item == null) return;
        AiCopyIntakeBatch batch = batchRepository.findById(item.getBatchId()).orElse(null);
        if (batch == null) return;

        String pdfUrl = fileUrl(item.getFileId());
        if (pdfUrl == null) {
            fail(itemId, "media service returned no URL for the uploaded file");
            return;
        }
        Map<String, Object> reading;
        try {
            reading = aiServiceCopyCheckClient.identify(pdfUrl, batch.getInstituteId(), batch.getPreferredModel());
        } catch (Exception e) {
            fail(itemId, "could not read the copy: " + rootMessage(e));
            return;
        }

        try {
            tx.executeWithoutResult(status -> place(itemId, batch, reading, candidates));
        } catch (Exception e) {
            // The placement transaction rolled back as a whole (no half-made
            // attempt); keep what was read and record why, so the admin can
            // see the name and retry or place the copy by hand.
            log.error("[copy-intake] item {} could not be placed: {}", itemId, e.getMessage(), e);
            fail(itemId, "could not create the attempt: " + rootMessage(e), reading);
        }
    }

    /** Copy the reader's output onto the item (no matching). */
    private static void storeReading(AiCopyIntakeItem item, Map<String, Object> reading) {
        item.setExtractedName(str(reading.get("student_name")));
        item.setExtractedRoll(str(reading.get("roll_number")));
        item.setExtractedClass(str(reading.get("class_section")));
        item.setExtractConfidence(num(reading.get("confidence")));
        if (item.getPageCount() == null && reading.get("page_count") instanceof Number pages) {
            item.setPageCount(pages.intValue());
        }
    }

    /** Store the reading, match it, and - when sure - queue the check. Runs in one transaction. */
    private void place(String itemId, AiCopyIntakeBatch batch, Map<String, Object> reading, List<Candidate> candidates) {
        AiCopyIntakeItem item = itemRepository.findById(itemId).orElse(null);
        if (item == null || !AiCopyIntakeItem.IDENTIFYING.equals(item.getStatus())) return;

        storeReading(item, reading);

        // A Devanagari name is matched through its transliteration when the
        // student list is in Latin letters (it always is).
        String latin = str(reading.get("student_name_latin"));
        String nameForMatch = StringUtils.hasText(latin) ? latin : item.getExtractedName();
        StudentNameMatcher.Result result = StudentNameMatcher.match(nameForMatch, item.getExtractedRoll(), candidates);
        item.setCandidatesJson(toJson(result.getShortlist()));
        item.setMatchScore(result.getBest() == null ? null : result.getBest().getScore());

        switch (result.getVerdict()) {
            case MATCHED -> {
                Candidate c = result.getBest().getCandidate();
                item.setMatchedUserId(c.getUserId());
                item.setMatchedName(c.getName());
                item.setStatus(AiCopyIntakeItem.MATCHED);
                item.setErrorMessage(null);
                itemRepository.save(item);
                attachAndQueue(item, batch, c, null);
            }
            case AMBIGUOUS -> {
                item.setStatus(AiCopyIntakeItem.AMBIGUOUS);
                item.setErrorMessage(result.getReason());
                itemRepository.save(item);
            }
            case UNMATCHED -> {
                item.setStatus(AiCopyIntakeItem.UNMATCHED);
                item.setErrorMessage(result.getReason());
                itemRepository.save(item);
            }
        }
    }

    /**
     * Turn a placed copy into an attempt with the file attached and queue it for
     * the AI check. Must run inside a transaction; throws to roll it back.
     *
     * <p>A copy the same student already has - an earlier submission with a
     * file, or another copy in this very upload - is NOT graded twice on its
     * own: it is flagged for the admin, who can confirm a second attempt.
     */
    private void attachAndQueue(AiCopyIntakeItem item, AiCopyIntakeBatch batch, Candidate c, CustomUserDetails resolver) {
        String registrationId = c.getRegistrationId();
        boolean automatic = resolver == null;

        // This copy already became an attempt earlier (the check failed and is
        // being retried, or the admin confirmed the same student): queue that
        // attempt again rather than growing a second one with the same file.
        if (StringUtils.hasText(item.getAttemptId()) && StringUtils.hasText(c.getUserId())) {
            Optional<StudentAttempt> prior = studentAttemptService.getStudentAttemptById(item.getAttemptId());
            if (prior.isPresent() && prior.get().getRegistration() != null
                    && c.getUserId().equals(prior.get().getRegistration().getUserId())) {
                queue(item, prior.get(), batch.getPreferredModel());
                return;
            }
        }

        if (automatic && StringUtils.hasText(c.getUserId())
                && itemRepository.countOthersOnStudent(batch.getId(), c.getUserId(), item.getId(), PLACED) > 0) {
            hold(item, c.getName() + " already has another copy in this upload; confirm if this is a second attempt");
            return;
        }
        Optional<AssessmentUserRegistration> existing = StringUtils.hasText(registrationId)
                ? registrationRepository.findById(registrationId)
                : registrationRepository.findTopByUserIdAndAssessmentId(c.getUserId(), batch.getAssessmentId());
        if (automatic && existing.isPresent() && existing.get().getStudentAttempts() != null) {
            boolean hasCopy = existing.get().getStudentAttempts().stream().anyMatch(a ->
                    a.getAttemptData() != null && a.getAttemptData().contains("\"fileId\""));
            if (hasCopy) {
                hold(item, c.getName() + " already has a submitted copy on this assessment; confirm to add another attempt");
                return;
            }
        }

        OfflineAttemptCreateRequest create = null;
        if (!StringUtils.hasText(registrationId)) {
            create = OfflineAttemptCreateRequest.builder()
                    .userId(c.getUserId()).fullName(c.getName()).email(c.getEmail())
                    .batchId(c.getBatchId()).build();
        }
        OfflineAttemptCreateResponse created = offlineDataEntryManager
                .createOfflineAttempt(resolver, batch.getAssessmentId(), registrationId, batch.getInstituteId(), create)
                .getBody();
        if (created == null || created.getAttemptId() == null) {
            throw new VacademyException("attempt was not created");
        }
        offlineDataEntryManager.attachOfflineFiles(resolver, batch.getAssessmentId(), created.getAttemptId(),
                batch.getInstituteId(), OfflineAttachmentsRequest.builder().studentFileId(item.getFileId()).build());

        StudentAttempt attempt = studentAttemptService.getStudentAttemptById(created.getAttemptId())
                .orElseThrow(() -> new VacademyException("attempt vanished after creation"));
        item.setRegistrationId(created.getRegistrationId());
        item.setAttemptId(created.getAttemptId());
        queue(item, attempt, batch.getPreferredModel());
    }

    /** Queue the AI check for an attempt and mark the copy QUEUED. */
    private void queue(AiCopyIntakeItem item, StudentAttempt attempt, String model) {
        String processId = aiEvaluationService.initiateEvaluationForAttempt(attempt, model, true);
        item.setProcessId(processId);
        item.setStatus(AiCopyIntakeItem.QUEUED);
        item.setErrorMessage(null);
        itemRepository.save(item);
    }

    /** Park a copy for the admin with a reason (a match the system will not act on alone). */
    private void hold(AiCopyIntakeItem item, String why) {
        item.setStatus(AiCopyIntakeItem.AMBIGUOUS);
        item.setErrorMessage(why);
        itemRepository.save(item);
    }

    // ----------------------------------------------------------- resolution

    /**
     * The admin chose the student for an ambiguous / unmatched / failed copy.
     * Anything that goes wrong rolls the whole decision back and reaches the
     * admin as an error - a copy is never silently marked failed by a click.
     */
    @Transactional
    public AiCopyIntakeItem resolve(CustomUserDetails user, String itemId, CopyIntakeDtos.ResolveRequest req) {
        AiCopyIntakeItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new VacademyException("Copy not found"));
        AiCopyIntakeBatch batch = batchRepository.findById(item.getBatchId())
                .orElseThrow(() -> new VacademyException("Batch not found"));
        if (!AiCopyIntakeItem.WAITING_FOR_ADMIN.contains(item.getStatus())
                && !AiCopyIntakeItem.FAILED.equals(item.getStatus())) {
            throw new VacademyException("This copy is not waiting for a decision (" + item.getStatus() + ")");
        }
        if (req == null || (!StringUtils.hasText(req.getRegistrationId()) && !StringUtils.hasText(req.getUserId()))) {
            throw new VacademyException("Pick a student");
        }
        Candidate chosen = Candidate.builder()
                .registrationId(req.getRegistrationId()).userId(req.getUserId())
                .name(req.getFullName()).email(req.getEmail()).batchId(req.getBatchId()).build();
        if (StringUtils.hasText(req.getRegistrationId())) {
            AssessmentUserRegistration reg = registrationRepository.findById(req.getRegistrationId())
                    .orElseThrow(() -> new VacademyException("Registration not found"));
            if (!batch.getAssessmentId().equals(reg.getAssessment().getId())) {
                throw new VacademyException("That student is not on this assessment");
            }
            chosen.setUserId(reg.getUserId());
            chosen.setName(reg.getParticipantName());
        }
        item.setMatchedUserId(chosen.getUserId());
        item.setMatchedName(chosen.getName());
        item.setResolvedBy(user.getUserId());
        item.setStatus(AiCopyIntakeItem.MATCHED);
        item.setErrorMessage(null);
        item.setProcessId(null);
        itemRepository.save(item);
        reopen(batch);
        attachAndQueue(item, batch, chosen, user);
        auditClient.record(user, batch.getInstituteId(), "BULK_AI_CHECK", batch.getAssessmentId(),
                "assigned an uploaded copy to " + chosen.getName(), Map.of("item_id", itemId));
        return item;
    }

    /** Leave this copy out (wrong upload, not a student of this test). */
    @Transactional
    public AiCopyIntakeItem skip(CustomUserDetails user, String itemId) {
        AiCopyIntakeItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new VacademyException("Copy not found"));
        if (!AiCopyIntakeItem.WAITING_FOR_ADMIN.contains(item.getStatus())
                && !AiCopyIntakeItem.FAILED.equals(item.getStatus())) {
            throw new VacademyException("Only a waiting or failed copy can be skipped");
        }
        item.setStatus(AiCopyIntakeItem.SKIPPED);
        item.setResolvedBy(user.getUserId());
        return itemRepository.save(item);
    }

    /**
     * Try a failed copy again. A copy that already sits on a student's attempt
     * (the AI check itself failed) is just queued again; one that never got
     * that far is read from scratch.
     */
    @Transactional
    public AiCopyIntakeItem retry(CustomUserDetails user, String itemId) {
        AiCopyIntakeItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new VacademyException("Copy not found"));
        AiCopyIntakeBatch batch = batchRepository.findById(item.getBatchId())
                .orElseThrow(() -> new VacademyException("Batch not found"));
        if (!AiCopyIntakeItem.FAILED.equals(item.getStatus())) {
            throw new VacademyException("Only a failed copy can be retried");
        }
        item.setErrorMessage(null);
        item.setProcessId(null);
        item.setResolvedBy(user.getUserId());
        reopen(batch);
        if (StringUtils.hasText(item.getAttemptId()) && StringUtils.hasText(item.getMatchedUserId())) {
            item.setStatus(AiCopyIntakeItem.MATCHED);
            itemRepository.save(item);
            attachAndQueue(item, batch, Candidate.builder().userId(item.getMatchedUserId())
                    .registrationId(item.getRegistrationId()).name(item.getMatchedName()).build(), user);
            return item;
        }
        item.setStatus(AiCopyIntakeItem.PENDING);
        return itemRepository.save(item);
    }

    /** A settled batch with new work goes back to RUNNING so it settles - and notifies - again. */
    private void reopen(AiCopyIntakeBatch batch) {
        if (!AiCopyIntakeBatch.RUNNING.equals(batch.getStatus())) {
            batch.setStatus(AiCopyIntakeBatch.RUNNING);
            batch.setCompletedAt(null);
            batchRepository.save(batch);
        }
    }

    // ------------------------------------------- evaluation lifecycle hooks

    /** The AI check for one attempt finished (either way). Called from the callback service. */
    @Transactional
    public void onEvaluationFinished(String processId, boolean succeeded, String error) {
        if (processId == null) return;
        AiCopyIntakeItem item = itemRepository.findFirstByProcessId(processId).orElse(null);
        if (item == null) return;
        if (!AiCopyIntakeItem.QUEUED.equals(item.getStatus()) && !AiCopyIntakeItem.MATCHED.equals(item.getStatus())) {
            return;      // a straggler callback for a copy already settled, retried or skipped
        }
        if (succeeded) {
            item.setStatus(AiCopyIntakeItem.COMPLETED);
            item.setErrorMessage(null);
        } else {
            item.setStatus(AiCopyIntakeItem.FAILED);
            item.setErrorMessage(StringUtils.hasText(error) ? error : "the AI check failed");
        }
        itemRepository.save(item);
    }

    /**
     * Settle the batch once nothing is moving on its own, or reopen one that
     * was settled and has work again. Safe to call from anywhere, any number
     * of times: the status change is a conditional update, so of two callers
     * arriving together exactly one sends the notification - and a status the
     * admin has already been told about is not announced again.
     */
    public void finalizeIfDone(String batchId) {
        AiCopyIntakeBatch batch = batchRepository.findById(batchId).orElse(null);
        if (batch == null || AiCopyIntakeBatch.FAILED.equals(batch.getStatus())) return;
        Counts counts = counts(batchId);
        String status = batch.getStatus();

        if (counts.active() > 0) {
            // Work in flight: a settled batch (the admin placed a copy) runs again.
            if (!AiCopyIntakeBatch.RUNNING.equals(status)) {
                batchRepository.transition(batchId, status, AiCopyIntakeBatch.RUNNING, null);
            }
            return;
        }
        String next = counts.waiting() > 0 ? AiCopyIntakeBatch.NEEDS_REVIEW : AiCopyIntakeBatch.COMPLETED;
        if (next.equals(status)) return;
        // RUNNING settles; NEEDS_REVIEW whose last waiting copy was skipped completes.
        if (batchRepository.transition(batchId, status, next, new Date()) == 0) return;
        AiCopyIntakeBatch settled = batchRepository.findById(batchId).orElse(null);
        if (settled == null || next.equals(settled.getNotifiedStatus())) return;
        try {
            notifier.batchSettled(settled, counts);
        } catch (Exception e) {
            log.error("[copy-intake] notification for batch {} failed: {}", batchId, e.getMessage(), e);
        }
    }

    /**
     * Queued copies whose evaluation ended without a callback reaching the
     * intake: a Java-side dispatch failure, the stale-job sweeper timing the
     * run out, a teacher cancelling it from the evaluations page. The process
     * row is the truth; read it so the batch can settle and the admin can
     * retry, instead of showing "checking" for ever.
     */
    @Transactional
    public int syncQueuedItems(String batchId) {
        List<AiCopyIntakeItem> queued = itemRepository.findByBatchIdAndStatusIn(batchId, List.of(AiCopyIntakeItem.QUEUED));
        Map<String, AiEvaluationProcess> processes = processesFor(queued);
        int changed = 0;
        for (AiCopyIntakeItem item : queued) {
            AiEvaluationProcess p = item.getProcessId() == null ? null : processes.get(item.getProcessId());
            if (p == null || p.getStatus() == null) continue;
            String status = p.getStatus().toUpperCase(Locale.ROOT);
            if ("COMPLETED".equals(status)) {
                item.setStatus(AiCopyIntakeItem.COMPLETED);
                item.setErrorMessage(null);
            } else if ("FAILED".equals(status) || "CANCELLED".equals(status)) {
                item.setStatus(AiCopyIntakeItem.FAILED);
                item.setErrorMessage(StringUtils.hasText(p.getErrorMessage()) ? p.getErrorMessage()
                        : "CANCELLED".equals(status) ? "the AI check was cancelled" : "the AI check failed");
            } else {
                continue;
            }
            itemRepository.save(item);
            changed++;
        }
        if (changed > 0) log.info("[copy-intake] batch {}: {} copies settled from their evaluation rows", batchId, changed);
        return changed;
    }

    /** The evaluation rows behind a set of items, in one query. */
    private Map<String, AiEvaluationProcess> processesFor(List<AiCopyIntakeItem> items) {
        List<String> ids = items.stream().map(AiCopyIntakeItem::getProcessId).filter(Objects::nonNull).distinct().toList();
        Map<String, AiEvaluationProcess> byId = new HashMap<>();
        if (!ids.isEmpty()) {
            for (AiEvaluationProcess p : processRepository.findAllById(ids)) byId.put(p.getId(), p);
        }
        return byId;
    }

    /** Copies a dead worker left in IDENTIFYING go back to the queue. */
    @Transactional
    public int recoverStaleIdentifying(String batchId) {
        Date before = new Date(System.currentTimeMillis() - identifyStaleMinutes * 60_000L);
        int n = 0;
        for (AiCopyIntakeItem stale : itemRepository
                .findByBatchIdAndStatusAndUpdatedAtBefore(batchId, AiCopyIntakeItem.IDENTIFYING, before)) {
            if (itemRepository.transition(stale.getId(), AiCopyIntakeItem.IDENTIFYING, AiCopyIntakeItem.PENDING) == 1) n++;
        }
        if (n > 0) log.warn("[copy-intake] batch {}: {} copies were stuck reading; requeued", batchId, n);
        return n;
    }

    /** A batch-level note the panel shows (a transient failure the sweep will retry, for instance). */
    @Transactional
    public void noteBatchError(String batchId, String message) {
        batchRepository.findById(batchId).ifPresent(b -> {
            b.setErrorMessage(message);
            batchRepository.save(b);
        });
    }

    // ------------------------------------------------------------- reading

    public Counts counts(String batchId) {
        Map<String, Integer> by = new HashMap<>();
        int total = 0;
        for (Object[] row : itemRepository.countByStatus(batchId)) {
            int n = ((Number) row[1]).intValue();
            by.put((String) row[0], n);
            total += n;
        }
        int queuedAll = by.getOrDefault(AiCopyIntakeItem.QUEUED, 0);
        int evaluating = queuedAll == 0 ? 0 : (int) itemRepository.countEvaluating(batchId);
        return new Counts(total,
                by.getOrDefault(AiCopyIntakeItem.PENDING, 0),
                by.getOrDefault(AiCopyIntakeItem.IDENTIFYING, 0),
                by.getOrDefault(AiCopyIntakeItem.MATCHED, 0),
                by.getOrDefault(AiCopyIntakeItem.AMBIGUOUS, 0),
                by.getOrDefault(AiCopyIntakeItem.UNMATCHED, 0),
                queuedAll - evaluating,
                evaluating,
                by.getOrDefault(AiCopyIntakeItem.COMPLETED, 0),
                by.getOrDefault(AiCopyIntakeItem.FAILED, 0),
                by.getOrDefault(AiCopyIntakeItem.SKIPPED, 0));
    }

    public CopyIntakeDtos.BatchDto toDto(AiCopyIntakeBatch batch, boolean withItems) {
        Counts c = counts(batch.getId());
        CopyIntakeDtos.BatchDto dto = CopyIntakeDtos.BatchDto.builder()
                .id(batch.getId()).assessmentId(batch.getAssessmentId()).status(batch.getStatus())
                .source(batch.getSource() == null ? AiCopyIntakeBatch.SOURCE_UPLOAD : batch.getSource())
                .totalItems(batch.getTotalItems()).identified(c.identified()).matched(c.matched())
                .ambiguous(c.ambiguous()).unmatched(c.unmatched()).queued(c.queued()).evaluating(c.evaluating())
                .evaluated(c.completed()).failed(c.failed()).skipped(c.skipped()).inProgress(c.active())
                .createdBy(batch.getCreatedBy()).createdByName(batch.getCreatedByName())
                .emailStatus(batch.getEmailStatus()).createdAt(batch.getCreatedAt()).completedAt(batch.getCompletedAt())
                .errorMessage(batch.getErrorMessage()).build();
        if (withItems) {
            List<AiCopyIntakeItem> rows = itemRepository.findByBatchIdOrderByCreatedAt(batch.getId());
            // One query for every queued copy's evaluation row, not one per copy:
            // the panel polls this every few seconds for a 200-copy batch.
            Map<String, AiEvaluationProcess> processes = processesFor(
                    rows.stream().filter(r -> AiCopyIntakeItem.QUEUED.equals(r.getStatus())).toList());
            List<CopyIntakeDtos.ItemDto> items = new ArrayList<>();
            for (AiCopyIntakeItem i : rows) {
                items.add(toDto(i, processes.get(i.getProcessId())));
            }
            dto.setItems(items);
        }
        return dto;
    }

    public CopyIntakeDtos.ItemDto toDto(AiCopyIntakeItem i) {
        AiEvaluationProcess p = AiCopyIntakeItem.QUEUED.equals(i.getStatus()) && i.getProcessId() != null
                ? processRepository.findById(i.getProcessId()).orElse(null) : null;
        return toDto(i, p);
    }

    private CopyIntakeDtos.ItemDto toDto(AiCopyIntakeItem i, AiEvaluationProcess process) {
        // QUEUED vs EVALUATING is the evaluation row's business; read it rather
        // than hook the dispatcher (which would close a bean cycle).
        String status = i.getStatus();
        if (AiCopyIntakeItem.QUEUED.equals(status) && process != null) {
            // DISPATCHED is a claimed row a few seconds from being sent: still queued.
            status = "PENDING".equals(process.getStatus()) || "DISPATCHED".equals(process.getStatus())
                    ? AiCopyIntakeItem.QUEUED : AiCopyIntakeItem.EVALUATING;
        }
        return CopyIntakeDtos.ItemDto.builder()
                .id(i.getId()).fileId(i.getFileId()).fileName(i.getFileName()).pageCount(i.getPageCount())
                .status(status).extractedName(i.getExtractedName()).extractedRoll(i.getExtractedRoll())
                .extractedClass(i.getExtractedClass()).extractConfidence(i.getExtractConfidence())
                .matchScore(i.getMatchScore()).matchedUserId(i.getMatchedUserId()).matchedName(i.getMatchedName())
                .registrationId(i.getRegistrationId()).attemptId(i.getAttemptId()).processId(i.getProcessId())
                .errorMessage(i.getErrorMessage()).candidates(candidatesFromJson(i.getCandidatesJson()))
                .updatedAt(i.getUpdatedAt()).build();
    }

    /** The batch's checked copies (AI check finished, checked copy rendered), in upload order. */
    public List<CopyIntakeDtos.CheckedCopyDto> checkedCopies(String batchId) {
        List<CopyIntakeDtos.CheckedCopyDto> out = new ArrayList<>();
        for (AiCopyIntakeItemRepository.CheckedCopyRow r
                : itemRepository.findCheckedCopies(batchId, AiCopyIntakeItem.COMPLETED)) {
            out.add(CopyIntakeDtos.CheckedCopyDto.builder()
                    .itemId(r.getItemId()).fileName(r.getFileName()).studentName(r.getStudentName())
                    .roll(r.getRoll()).evaluatedFileId(r.getEvaluatedFileId()).build());
        }
        return out;
    }

    public Optional<String> getBatchIdForProcess(String processId) {
        if (processId == null) return Optional.empty();
        return itemRepository.findFirstByProcessId(processId).map(AiCopyIntakeItem::getBatchId);
    }

    public Optional<AiCopyIntakeBatch> getBatch(String batchId) {
        return batchRepository.findById(batchId);
    }

    public Optional<AiCopyIntakeItem> getItem(String itemId) {
        return itemRepository.findById(itemId);
    }

    public List<AiCopyIntakeBatch> listBatches(String assessmentId, String instituteId) {
        return batchRepository.findByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(assessmentId, instituteId);
    }

    public List<AiCopyIntakeItem> pendingItems(String batchId) {
        return itemRepository.findByBatchIdAndStatusIn(batchId, List.of(AiCopyIntakeItem.PENDING));
    }

    // ------------------------------------------------------------ helpers

    /**
     * Everyone this copy could belong to: registered participants + learners
     * of the linked batches. Computed once per batch run, not per copy - the
     * batch learners come from admin-core over HTTP.
     */
    public List<Candidate> candidatesFor(String assessmentId, String instituteId) {
        Map<String, Candidate> byUser = new HashMap<>();
        for (AssessmentUserRegistration r : registrationRepository
                .findByInstituteIdAndAssessmentIdAndStatusIn(assessmentId, ACTIVE_STATUSES)) {
            byUser.put(r.getUserId(), Candidate.builder()
                    .userId(r.getUserId()).registrationId(r.getId()).name(r.getParticipantName())
                    .email(r.getUserEmail()).rollNumber(r.getUsername()).batchId(r.getSourceId()).build());
        }
        List<String> batchIds = batchRegistrationRepository
                .findBatchIdsByAssessmentAndInstitute(assessmentId, instituteId, ACTIVE_STATUSES);
        if (!batchIds.isEmpty()) {
            for (EnrolledLearnerDto l : adminCoreServiceClient.getEnrolledLearnersForBatches(instituteId, batchIds)) {
                if (l.getUserId() == null || byUser.containsKey(l.getUserId())) continue;
                byUser.put(l.getUserId(), Candidate.builder()
                        .userId(l.getUserId()).name(l.getFullName()).email(l.getEmail())
                        .rollNumber(l.getUsername()).batchId(l.getPackageSessionId()).build());
            }
        }
        return new ArrayList<>(byUser.values());
    }

    private void fail(String itemId, String why) {
        fail(itemId, why, null);
    }

    private void fail(String itemId, String why, Map<String, Object> reading) {
        tx.executeWithoutResult(status -> itemRepository.findById(itemId).ifPresent(item -> {
            if (reading != null) storeReading(item, reading);
            item.setStatus(AiCopyIntakeItem.FAILED);
            item.setErrorMessage(why);
            itemRepository.save(item);
        }));
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        String m = t.getMessage();
        return StringUtils.hasText(m) ? m : t.getClass().getSimpleName();
    }

    private String fileUrl(String fileId) {
        try {
            String url = WebClient.builder()
                    .baseUrl(mediaServiceUrl)
                    .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .build()
                    .get()
                    .uri(b -> b.path("/media-service/public/get-public-url").queryParam("fileId", fileId).build())
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();
            return StringUtils.hasText(url) ? url.replace("\"", "") : null;
        } catch (Exception e) {
            log.error("[copy-intake] media-service failed for fileId={}: {}", fileId, e.getMessage());
            return null;
        }
    }

    private String toJson(List<Scored> shortlist) {
        List<CopyIntakeDtos.CandidateDto> out = new ArrayList<>();
        for (Scored s : shortlist == null ? List.<Scored>of() : shortlist) {
            Candidate c = s.getCandidate();
            out.add(CopyIntakeDtos.CandidateDto.builder()
                    .userId(c.getUserId()).registrationId(c.getRegistrationId()).name(c.getName())
                    .rollNumber(c.getRollNumber()).email(c.getEmail()).batchId(c.getBatchId())
                    .score(Math.round(s.getScore() * 1000.0) / 1000.0).build());
        }
        try {
            return objectMapper.writeValueAsString(out);
        } catch (Exception e) {
            return "[]";
        }
    }

    private List<CopyIntakeDtos.CandidateDto> candidatesFromJson(String json) {
        if (!StringUtils.hasText(json)) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<List<CopyIntakeDtos.CandidateDto>>() { });
        } catch (Exception e) {
            return List.of();
        }
    }

    private static String str(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o).trim();
        return s.isEmpty() || "null".equalsIgnoreCase(s) ? null : s;
    }

    private static Double num(Object o) {
        if (o instanceof Number n) return n.doubleValue();
        try {
            return o == null ? null : Double.parseDouble(String.valueOf(o));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Where the completion email goes. The principal carries the username, which
     * is an email only for some institutes (Shiksha Nation logins are "custom11"
     * style), so the address is looked up; until 2026-09-20 the username was
     * stored here and the email step was skipped for every such batch.
     */
    private String creatorEmail(CustomUserDetails user) {
        String username = user.getUsername();
        try {
            for (UserDTO u : authService.getUsersByIds(List.of(user.getUserId()))) {
                if (u != null && StringUtils.hasText(u.getEmail()) && u.getEmail().contains("@")) {
                    return u.getEmail();
                }
            }
        } catch (Exception e) {
            log.warn("[copy-intake] could not resolve email for user {}: {}", user.getUserId(), e.getMessage());
        }
        return username != null && username.contains("@") ? username : null;
    }
}
