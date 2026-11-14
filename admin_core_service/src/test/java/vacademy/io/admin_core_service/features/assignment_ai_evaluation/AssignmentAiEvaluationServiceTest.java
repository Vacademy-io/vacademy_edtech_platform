package vacademy.io.admin_core_service.features.assignment_ai_evaluation;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.client.AssignmentCopyCheckClient;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.dto.AssignmentAiEvaluationDTO;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluation;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationBatchRepository;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationRepository;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationRepository.LatestSubmissionRow;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.dto.AssignmentAiBulkDTO;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluationBatch;
import org.springframework.data.domain.Pageable;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.service.AssignmentAiEvaluationNotifier;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.service.AssignmentAiEvaluationService;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.service.AssignmentCopyPdfBuilder;
import vacademy.io.admin_core_service.features.common.entity.RichTextData;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.learner_tracking.dto.AssignmentSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.AssignmentSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.AssignmentSlideTrackedRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.slide.entity.AssignmentSlide;
import vacademy.io.admin_core_service.features.slide.entity.AssignmentSlideQuestion;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.AssignmentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

class AssignmentAiEvaluationServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String TRACKED = "tracked-1";
    private static final String SLIDE = "slide-1";

    private AssignmentAiEvaluationRepository evaluationRepository;
    private AssignmentSlideTrackedRepository trackedRepository;
    private SlideRepository slideRepository;
    private AssignmentSlideRepository assignmentSlideRepository;
    private MediaService mediaService;
    private CreditClient creditClient;
    private InstituteAccessValidator accessValidator;
    private AssignmentCopyPdfBuilder pdfBuilder;
    private AssignmentCopyCheckClient copyCheckClient;
    private AssignmentAiEvaluationNotifier notifier;
    private AssignmentAiEvaluationBatchRepository batchRepository;
    private AssignmentAiEvaluationService service;
    private CustomUserDetails teacher;
    private final Map<String, AssignmentAiEvaluation> rows = new HashMap<>();

    @BeforeEach
    void setUp() {
        evaluationRepository = mock(AssignmentAiEvaluationRepository.class);
        trackedRepository = mock(AssignmentSlideTrackedRepository.class);
        slideRepository = mock(SlideRepository.class);
        assignmentSlideRepository = mock(AssignmentSlideRepository.class);
        mediaService = mock(MediaService.class);
        creditClient = mock(CreditClient.class);
        accessValidator = mock(InstituteAccessValidator.class);
        pdfBuilder = mock(AssignmentCopyPdfBuilder.class);
        copyCheckClient = mock(AssignmentCopyCheckClient.class);
        notifier = mock(AssignmentAiEvaluationNotifier.class);
        batchRepository = mock(AssignmentAiEvaluationBatchRepository.class);
        service = new AssignmentAiEvaluationService(evaluationRepository, batchRepository, trackedRepository,
                slideRepository, assignmentSlideRepository, mediaService, creditClient, accessValidator, pdfBuilder,
                copyCheckClient, new ObjectMapper(), notifier, mock(PlatformTransactionManager.class));
        when(batchRepository.findLatest(any(), any(), any())).thenReturn(Optional.empty());
        // Queue reads served from the in-memory table.
        when(evaluationRepository.countByStatus(anyString())).thenAnswer(inv -> rows.values().stream()
                .filter(e -> e.getStatus().equals(inv.getArgument(0))).count());
        when(evaluationRepository.findByStatusOrderByCreatedAtAsc(anyString(), any(Pageable.class))).thenAnswer(inv -> rows.values().stream()
                .filter(e -> e.getStatus().equals(inv.getArgument(0)))
                .sorted(Comparator.comparing(AssignmentAiEvaluation::getCreatedAt))
                .limit(((Pageable) inv.getArgument(1)).getPageSize()).toList());
        when(evaluationRepository.countByStatusForBatch(anyString())).thenAnswer(inv -> {
            Map<String, Long> counts = new HashMap<>();
            rows.values().stream().filter(e -> inv.getArgument(0).equals(e.getBatchId()))
                    .forEach(e -> counts.merge(e.getStatus(), 1L, Long::sum));
            List<Object[]> out = new ArrayList<>();
            counts.forEach((k, v) -> out.add(new Object[]{k, v}));
            return out;
        });
        teacher = mock(CustomUserDetails.class);
        when(teacher.getUserId()).thenReturn("teacher-1");

        // In-memory table behind the repository.
        when(evaluationRepository.save(any())).thenAnswer(inv -> {
            AssignmentAiEvaluation e = inv.getArgument(0);
            if (e.getUpdatedAt() == null) {
                e.setCreatedAt(Instant.now());
                e.setUpdatedAt(Instant.now());
            }
            rows.put(e.getId(), e);
            return e;
        });
        when(evaluationRepository.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(rows.get(inv.getArgument(0))));
        when(evaluationRepository.findFirstByTrackedIdOrderByCreatedAtDesc(anyString())).thenAnswer(inv -> rows.values().stream()
                .filter(e -> e.getTrackedId().equals(inv.getArgument(0)))
                .max(Comparator.comparing(AssignmentAiEvaluation::getCreatedAt)));
        when(evaluationRepository.isSlideInInstitute(SLIDE, INSTITUTE)).thenReturn(true);

        ActivityLog log = new ActivityLog();
        log.setSlideId(SLIDE);
        log.setUserId("learner-1");
        AssignmentSlideActivityLogDTO dto = new AssignmentSlideActivityLogDTO();
        dto.setId(TRACKED);
        dto.setCommaSeparatedFileIds("f1");
        AssignmentSlideTracked tracked = new AssignmentSlideTracked(dto, log);
        when(trackedRepository.findById(TRACKED)).thenReturn(Optional.of(tracked));

        Slide slide = new Slide();
        slide.setId(SLIDE);
        slide.setSourceId("asg-1");
        slide.setTitle("Photosynthesis");
        when(slideRepository.findById(SLIDE)).thenReturn(Optional.of(slide));

        AssignmentSlide assignment = new AssignmentSlide();
        assignment.setId("asg-1");
        assignment.setTextData(richText("Explain photosynthesis."));
        AssignmentSlideQuestion q2 = question(2, "Draw the leaf.");
        AssignmentSlideQuestion q1 = question(1, "Name the pigment.");
        assignment.setAssignmentSlideQuestions(new ArrayList<>(List.of(q2, q1)));
        assignment.setTotalMarks(20.0);
        when(assignmentSlideRepository.findById("asg-1")).thenReturn(Optional.of(assignment));

        when(creditClient.readBalance(INSTITUTE)).thenReturn(Optional.of(100.0));
        FileDetailsDTO file = new FileDetailsDTO();
        file.setId("f1");
        file.setFileName("answer.pdf");
        file.setFileType("application/pdf");
        file.setUrl("https://cdn/answer.pdf");
        when(mediaService.getFilesByIds(List.of("f1"))).thenReturn(List.of(file));
        when(copyCheckClient.submitGrade(any())).thenReturn("job-1");
    }

    @Test
    void triggerSendsTheWholeAssignmentAsOneQuestionOutOfTotalMarks() {
        AssignmentAiEvaluationDTO result = service.trigger(TRACKED, INSTITUTE, teacher);

        verify(accessValidator).requireInstituteStaff(teacher, INSTITUTE);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> request = ArgumentCaptor.forClass(Map.class);
        verify(copyCheckClient).submitGrade(request.capture());
        Map<String, Object> body = request.getValue();
        assertEquals(result.getId(), body.get("process_id"));
        assertEquals("asg-1", body.get("assessment_id"));
        assertEquals(INSTITUTE, body.get("institute_id"));
        assertEquals("https://cdn/answer.pdf", body.get("pdf_url"));
        assertEquals("COPY", body.get("answer_mode"));
        assertEquals(true, body.get("skip_answer_location"));
        assertFalse(body.containsKey("preferred_model"), "the grader's default model is used");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> questions = (List<Map<String, Object>>) body.get("questions");
        assertEquals(1, questions.size());
        Map<String, Object> q = questions.get(0);
        assertEquals(20.0, q.get("max_marks"));
        String text = (String) q.get("question_text");
        assertTrue(text.contains("Explain photosynthesis."));
        assertTrue(text.indexOf("1. Name the pigment.") < text.indexOf("2. Draw the leaf."), text);
        assertTrue(((String) q.get("question_id")).startsWith("asg-"));
        // A single PDF is graded as it is - nothing merged or uploaded.
        verifyNoInteractions(pdfBuilder);
        verify(evaluationRepository).setAiJobId(result.getId(), "job-1");
        assertEquals(AssignmentAiEvaluation.STATUS_PROCESSING, result.getStatus());
    }

    @Test
    void imagesAreMergedIntoOnePdfBeforeGrading() throws Exception {
        FileDetailsDTO photo = new FileDetailsDTO();
        photo.setId("f1");
        photo.setFileName("page1.jpg");
        photo.setFileType("image/jpeg");
        photo.setUrl("https://cdn/page1.jpg");
        when(mediaService.getFilesByIds(List.of("f1"))).thenReturn(List.of(photo));
        when(pdfBuilder.build(any())).thenReturn(new byte[]{1, 2, 3});
        FileDetailsDTO merged = new FileDetailsDTO();
        merged.setId("merged-1");
        when(mediaService.uploadFileV2(any())).thenReturn(merged);
        when(mediaService.getFilePublicUrlById("merged-1")).thenReturn("https://cdn/merged.pdf");

        AssignmentAiEvaluationDTO result = service.trigger(TRACKED, INSTITUTE, teacher);

        assertEquals("merged-1", rows.get(result.getId()).getSourceFileId());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> request = ArgumentCaptor.forClass(Map.class);
        verify(copyCheckClient).submitGrade(request.capture());
        assertEquals("https://cdn/merged.pdf", request.getValue().get("pdf_url"));
    }

    @Test
    void aRunningEvaluationIsReturnedInsteadOfStartingAnother() {
        AssignmentAiEvaluationDTO first = service.trigger(TRACKED, INSTITUTE, teacher);
        AssignmentAiEvaluationDTO second = service.trigger(TRACKED, INSTITUTE, teacher);

        assertEquals(first.getId(), second.getId());
        verify(copyCheckClient, times(1)).submitGrade(any());
    }

    @Test
    void refusesWithoutTotalMarks() {
        assignmentSlideRepository.findById("asg-1").get().setTotalMarks(null);
        assertThrows(VacademyException.class, () -> service.trigger(TRACKED, INSTITUTE, teacher));
        verifyNoInteractions(copyCheckClient);
    }

    @Test
    void refusesWhenOutOfCredits() {
        when(creditClient.readBalance(INSTITUTE)).thenReturn(Optional.of(0.0));
        assertThrows(VacademyException.class, () -> service.trigger(TRACKED, INSTITUTE, teacher));
        verifyNoInteractions(copyCheckClient);
    }

    @Test
    void anEmptyWalletIsRefusedUnlessTheLivePlanCoversTheCopyCheck() {
        when(creditClient.readBalance(INSTITUTE)).thenReturn(Optional.of(0.0));
        when(creditClient.planCovers(eq(INSTITUTE), eq("evaluation"), isNull(), anyInt(), eq("teacher-1"),
                argThat((vacademy.io.admin_core_service.features.credits.client.MeteringFields m) ->
                        "evaluation".equals(m.useCase()) && "USER".equals(m.actorKind()))))
                .thenReturn(true);
        service.trigger(TRACKED, INSTITUTE, teacher);
        verify(copyCheckClient).submitGrade(any());
    }

    @Test
    void aFundedOrUnreadableWalletNeverAsksThePlan() {
        service.trigger(TRACKED, INSTITUTE, teacher); // balance 100 (setUp)
        when(creditClient.readBalance(INSTITUTE)).thenReturn(Optional.empty());
        rows.clear();
        service.trigger(TRACKED, INSTITUTE, teacher);
        verify(creditClient, org.mockito.Mockito.never()).planCovers(any(), any(), any(), anyInt(), any(), any());
    }

    @Test
    void refusesASubmissionFromAnotherInstitute() {
        assertThrows(ForbiddenException.class, () -> service.trigger(TRACKED, "other-inst", teacher));
        verifyNoInteractions(copyCheckClient);
    }

    @Test
    void aBusyGraderLeavesTheRunQueuedForTheJob() {
        when(copyCheckClient.submitGrade(any())).thenThrow(new AssignmentCopyCheckClient.AiServiceBusyException("429"));

        AssignmentAiEvaluationDTO result = service.trigger(TRACKED, INSTITUTE, teacher);

        assertEquals(AssignmentAiEvaluation.STATUS_QUEUED, result.getStatus());
        verifyNoInteractions(notifier);

        reset(copyCheckClient);
        when(copyCheckClient.submitGrade(any())).thenReturn("job-2");
        assertEquals(1, service.dispatchQueued(3));
        assertEquals(AssignmentAiEvaluation.STATUS_PROCESSING, rows.get(result.getId()).getStatus());
    }

    @Test
    void anUnreadableUploadFailsTheRunAndTellsTheTeacher() {
        FileDetailsDTO doc = new FileDetailsDTO();
        doc.setId("f1");
        doc.setFileName("essay.docx");
        doc.setFileType("application/msword");
        doc.setUrl("https://cdn/essay.docx");
        when(mediaService.getFilesByIds(List.of("f1"))).thenReturn(List.of(doc));
        when(pdfBuilder.build(any())).thenThrow(new VacademyException("The AI Evaluator reads PDF and image uploads only"));

        AssignmentAiEvaluationDTO result = service.trigger(TRACKED, INSTITUTE, teacher);

        assertEquals(AssignmentAiEvaluation.STATUS_FAILED, result.getStatus());
        assertTrue(result.getErrorMessage().contains("PDF and image"));
        verify(notifier).notifyFinished(result.getId());
    }

    // ------------------------------------------------------------------ bulk

    @Test
    void bulkQueuesOnlyUngradedUncheckedSubmissionsWithFiles() {
        stubLatest(row(TRACKED, false, true, null), row("graded", true, true, null),
                row("ai-done", false, true, "COMPLETED"), row("no-files", false, false, null),
                row("running", false, true, "PROCESSING"));

        AssignmentAiBulkDTO result = service.bulkTrigger(SLIDE, "ps-1", false, INSTITUTE, teacher);

        assertEquals(5, result.getSubmissions());
        assertEquals(1, result.getInProgress());
        assertEquals(1, result.getToCheck());
        assertEquals(1, result.getAlreadyGraded());
        assertEquals(1, result.getAlreadyAiChecked());
        assertEquals(1, result.getNoFiles());
        verify(accessValidator).requireInstituteStaff(teacher, INSTITUTE);
        verify(batchRepository).save(any(AssignmentAiEvaluationBatch.class));
        assertEquals(1, rows.size());
        AssignmentAiEvaluation queued = rows.values().iterator().next();
        assertEquals(TRACKED, queued.getTrackedId());
        assertEquals(AssignmentAiEvaluation.STATUS_QUEUED, queued.getStatus());
        assertNotNull(queued.getBatchId());
        // Nothing goes to the grader from the request - the job sends it.
        verifyNoInteractions(copyCheckClient);
    }

    @Test
    void reCheckIncludesAiCheckedButNeverInProgressOrGraded() {
        Optional<AssignmentSlideTracked> tracked = trackedRepository.findById(TRACKED);
        when(trackedRepository.findById("ai-done")).thenReturn(tracked);
        stubLatest(row("ai-done", false, true, "COMPLETED"), row("running", false, true, "PROCESSING"),
                row("graded", true, true, "COMPLETED"));

        AssignmentAiBulkDTO result = service.bulkTrigger(SLIDE, null, true, INSTITUTE, teacher);

        assertEquals(1, result.getToCheck());
        assertEquals(1, rows.size());
        assertEquals("ai-done", rows.values().iterator().next().getTrackedId());
    }

    @Test
    void bulkWithNothingToCheckIsRefused() {
        stubLatest(row("graded", true, true, null), row("running", false, true, "QUEUED"));
        assertThrows(VacademyException.class, () -> service.bulkTrigger(SLIDE, null, true, INSTITUTE, teacher));
        verify(batchRepository, never()).save(any());
    }

    @Test
    void bulkPreviewQueuesNothing() {
        stubLatest(row(TRACKED, false, true, null));

        AssignmentAiBulkDTO preview = service.bulkPreview(SLIDE, null, false, INSTITUTE, teacher);

        assertEquals(1, preview.getToCheck());
        assertTrue(preview.isTotalMarksSet());
        assertTrue(rows.isEmpty());
        verify(batchRepository, never()).save(any());
    }

    @Test
    void theJobNeverHasMoreThanMaxActiveCopiesWithTheGrader() {
        for (int i = 0; i < 5; i++) {
            AssignmentAiEvaluation e = new AssignmentAiEvaluation();
            e.setId("q" + i);
            e.setTrackedId(TRACKED);
            e.setSlideId(SLIDE);
            e.setInstituteId(INSTITUTE);
            e.setBatchId("batch-1");
            e.setStatus(AssignmentAiEvaluation.STATUS_QUEUED);
            e.setMaxMarks(20.0);
            e.setCreatedAt(Instant.now().plusMillis(i));
            e.setUpdatedAt(Instant.now());
            rows.put(e.getId(), e);
        }

        assertEquals(3, service.dispatchQueued(3));
        assertEquals(0, service.dispatchQueued(3), "all three slots are taken");
        verify(copyCheckClient, times(3)).submitGrade(any());
    }

    @Test
    void bulkRunsAnnounceTheBatchNotEachLearner() {
        AssignmentAiEvaluation e = new AssignmentAiEvaluation();
        e.setId("b1");
        e.setTrackedId(TRACKED);
        e.setSlideId(SLIDE);
        e.setInstituteId(INSTITUTE);
        e.setBatchId("batch-1");
        e.setStatus(AssignmentAiEvaluation.STATUS_PROCESSING);
        e.setCreatedAt(Instant.now());
        e.setUpdatedAt(Instant.now());
        rows.put("b1", e);

        service.onQuestion(Map.of("process_id", "b1", "marks_awarded", 12, "feedback", "ok", "status", "COMPLETED"));
        service.onComplete(Map.of("process_id", "b1", "total_marks_awarded", 12));

        verify(notifier).notifyBatchFinished("batch-1");
        verify(notifier, never()).notifyFinished(anyString());
        verify(trackedRepository, never()).save(any());
    }

    @Test
    void aQueuedRunIsNeverStaleOnlyOneWithTheGrader() {
        AssignmentAiEvaluation e = new AssignmentAiEvaluation();
        e.setId("old");
        e.setTrackedId(TRACKED);
        e.setStatus(AssignmentAiEvaluation.STATUS_QUEUED);
        e.setCreatedAt(Instant.now().minus(2, ChronoUnit.HOURS));
        e.setUpdatedAt(Instant.now().minus(2, ChronoUnit.HOURS));
        rows.put("old", e);

        assertEquals(AssignmentAiEvaluation.STATUS_QUEUED, service.latest(TRACKED, INSTITUTE, teacher).getStatus());
    }

    @Test
    void questionThenCompleteCallbacksLeaveASuggestion() {
        String id = service.trigger(TRACKED, INSTITUTE, teacher).getId();

        service.onQuestion(Map.of("process_id", id, "marks_awarded", 14.5, "feedback", "Good diagram",
                "status", "COMPLETED"));
        service.onComplete(Map.of("process_id", id, "total_marks_awarded", 14.5, "evaluated_file_id", "checked-1"));

        AssignmentAiEvaluation row = rows.get(id);
        assertEquals(AssignmentAiEvaluation.STATUS_COMPLETED, row.getStatus());
        assertEquals(14.5, row.getMarksAwarded());
        assertEquals("Good diagram", row.getFeedback());
        assertEquals("checked-1", row.getEvaluatedFileId());
        // The teacher who started it is told once; nothing is written to the learner's grade.
        verify(notifier, times(1)).notifyFinished(id);
        verify(trackedRepository, never()).save(any());
    }

    @Test
    void aRetriedCompleteCallbackDoesNotNotifyTwice() {
        String id = service.trigger(TRACKED, INSTITUTE, teacher).getId();
        service.onQuestion(Map.of("process_id", id, "marks_awarded", 10, "feedback", "ok", "status", "COMPLETED"));
        service.onComplete(Map.of("process_id", id, "total_marks_awarded", 10));
        service.onComplete(Map.of("process_id", id, "total_marks_awarded", 10));

        verify(notifier, times(1)).notifyFinished(id);
    }

    @Test
    void aFailedRunNotifiesTheTeacherToo() {
        String id = service.trigger(TRACKED, INSTITUTE, teacher).getId();
        service.onFailed(Map.of("process_id", id, "error_message", "unreadable copy"));

        verify(notifier, times(1)).notifyFinished(id);
        verify(trackedRepository, never()).save(any());
    }

    @Test
    void aFailedQuestionEndsTheRunFailedNotAsZero() {
        String id = service.trigger(TRACKED, INSTITUTE, teacher).getId();

        service.onQuestion(Map.of("process_id", id, "marks_awarded", 0, "feedback", "",
                "status", "FAILED", "error_detail", "TimeoutError"));
        service.onComplete(Map.of("process_id", id, "total_marks_awarded", 0));

        AssignmentAiEvaluation row = rows.get(id);
        assertEquals(AssignmentAiEvaluation.STATUS_FAILED, row.getStatus());
        assertNull(row.getMarksAwarded());
    }

    @Test
    void callbacksAfterTheEndAreIgnored() {
        String id = service.trigger(TRACKED, INSTITUTE, teacher).getId();
        service.onFailed(Map.of("process_id", id, "error_message", "unreadable"));
        service.onComplete(Map.of("process_id", id, "total_marks_awarded", 9));

        assertEquals(AssignmentAiEvaluation.STATUS_FAILED, rows.get(id).getStatus());
        assertNull(rows.get(id).getMarksAwarded());
    }

    @Test
    void aSilentRunIsReportedFailed() {
        String id = service.trigger(TRACKED, INSTITUTE, teacher).getId();
        rows.get(id).setUpdatedAt(Instant.now().minus(30, ChronoUnit.MINUTES));

        AssignmentAiEvaluationDTO latest = service.latest(TRACKED, INSTITUTE, teacher);

        assertEquals(AssignmentAiEvaluation.STATUS_FAILED, latest.getStatus());
    }

    private void stubLatest(LatestSubmissionRow... latest) {
        when(evaluationRepository.findLatestSubmissions(eq(SLIDE), any())).thenReturn(List.of(latest));
    }

    private static LatestSubmissionRow row(String trackedId, boolean graded, boolean hasFiles, String aiStatus) {
        return new LatestSubmissionRow() {
            public String getTrackedId() { return trackedId; }
            public Boolean getGraded() { return graded; }
            public Boolean getHasFiles() { return hasFiles; }
            public String getAiStatus() { return aiStatus; }
        };
    }

    private static RichTextData richText(String content) {
        RichTextData data = new RichTextData();
        data.setType("TEXT");
        data.setContent(content);
        return data;
    }

    private static AssignmentSlideQuestion question(int order, String text) {
        AssignmentSlideQuestion q = new AssignmentSlideQuestion();
        q.setQuestionOrder(order);
        q.setTextData(richText(text));
        return q;
    }
}
