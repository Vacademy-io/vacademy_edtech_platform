package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.RevaluateRequest;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.EvaluationLogsRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.submission_review.entity.MarkEvent;
import vacademy.io.assessment_service.features.submission_review.repository.MarkEventRepository;
import vacademy.io.assessment_service.features.submission_review.service.MarkHistory;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Acceptance 5: re-marking with the answer key keeps marks a person gave (MANUAL, and a
 * legacy row on a hand-marked test - only while re-marking), re-scores the rest, and
 * leaves SKIPPED_PROTECTED in the history.
 */
class StudentAttemptServiceProtectedRowsTest {

    private static final String MCQ_MARKING = "{\"type\":\"MCQS\",\"data\":{\"totalMark\":2,\"negativeMark\":0,\"negativeMarkingPercentage\":0}}";
    private static final String MCQ_KEY = "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"o1\"]}}";
    private static final String ATTEMPT_DATA = "{\"sections\":[{\"sectionId\":\"s1\",\"questions\":["
            + "{\"questionId\":\"q1\",\"responseData\":{\"type\":\"MCQS\",\"optionIds\":[\"o1\"]}},"
            + "{\"questionId\":\"q2\",\"responseData\":{\"type\":\"LONG_ANSWER\",\"answer\":\"photosynthesis\"}}]}]}";

    private StudentAttemptService service;
    private QuestionWiseMarksService marksService;
    private QuestionAssessmentSectionMappingRepository mappings;
    private StudentAttemptRepository attempts;
    private MarkEventRepository events;
    private EvaluationLogsRepository logs;
    private Assessment assessment;
    private StudentAttempt attempt;
    private Section section;
    private QuestionWiseMarks mcqRow;
    private QuestionWiseMarks longRow;
    private TypedAnswerEvaluation typed;
    private AssessmentWorkflowEventPublisher publisher;

    @BeforeEach
    void setUp() {
        service = new StudentAttemptService();
        marksService = mock(QuestionWiseMarksService.class);
        mappings = mock(QuestionAssessmentSectionMappingRepository.class);
        attempts = mock(StudentAttemptRepository.class);
        events = mock(MarkEventRepository.class);
        logs = mock(EvaluationLogsRepository.class);
        SectionRepository sections = mock(SectionRepository.class);
        typed = mock(TypedAnswerEvaluation.class);
        publisher = mock(AssessmentWorkflowEventPublisher.class);
        ReflectionTestUtils.setField(service, "questionWiseMarksService", marksService);
        ReflectionTestUtils.setField(service, "questionAssessmentSectionMappingRepository", mappings);
        ReflectionTestUtils.setField(service, "studentAttemptRepository", attempts);
        ReflectionTestUtils.setField(service, "sectionRepository", sections);
        ReflectionTestUtils.setField(service, "questionRepository", mock(QuestionRepository.class));
        ReflectionTestUtils.setField(service, "attemptDataParserService", new AttemptDataParserService());
        ReflectionTestUtils.setField(service, "typedAnswerEvaluation", typed);
        ReflectionTestUtils.setField(service, "assessmentWorkflowEventPublisher", publisher);
        ReflectionTestUtils.setField(service, "markHistory", new MarkHistory(events));
        ReflectionTestUtils.setField(service, "evaluationLogsRepository", logs);

        assessment = new Assessment();
        assessment.setId("A");
        assessment.setEvaluationType("AUTO");
        assessment.setResultType("MANUAL");
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(assessment);
        r.setInstituteId("inst-1");
        r.setStudentAttempts(new HashSet<>());
        attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setRegistration(r);
        attempt.setStatus("ENDED");
        attempt.setAttemptData(ATTEMPT_DATA);
        attempt.setTotalMarks(5.0);
        attempt.setReportReleaseStatus("RELEASED");

        section = new Section();
        section.setId("s1");
        when(sections.findAllById(anyList())).thenReturn(List.of(section));
        mcqRow = row("q1", 0, "INCORRECT", null);
        longRow = row("q2", 5, "PARTIAL_CORRECT", "MANUAL");
        when(marksService.getAllQuestionWiseMarksForAttemptId("att-1", "A")).thenReturn(List.of(mcqRow, longRow));
        when(attempts.save(any())).thenAnswer(i -> i.getArgument(0));
        when(attempts.findAllById(anyList())).thenReturn(List.of(attempt));

        List<QuestionAssessmentSectionMappingRepository.MarkingSchemeRow> schemes = new ArrayList<>();
        schemes.add(scheme("q1", MCQ_MARKING, MCQ_KEY));
        schemes.add(scheme("q2", "{\"type\":\"LONG_ANSWER\",\"data\":{\"totalMark\":8}}", "{\"type\":\"LONG_ANSWER\",\"data\":{\"keywords\":[]}}"));
        when(mappings.findMarkingSchemeRowsBySectionIds(anyList())).thenReturn(schemes);
    }

    private QuestionWiseMarks row(String questionId, double marks, String status, String source) {
        Question q = new Question();
        q.setId(questionId);
        QuestionWiseMarks m = QuestionWiseMarks.builder().id("r-" + questionId).question(q).section(section)
                .sectionId("s1").marks(marks).status(status).marksSource(source).studentAttempt(attempt)
                .assessment(assessment).build();
        return m;
    }

    private static QuestionAssessmentSectionMappingRepository.MarkingSchemeRow scheme(String q, String marking, String key) {
        return new QuestionAssessmentSectionMappingRepository.MarkingSchemeRow() {
            public String getQuestionId() { return q; }
            public String getSectionId() { return "s1"; }
            public String getMarkingJson() { return marking; }
            public String getAutoEvaluationJson() { return key; }
            public Date getCreatedAt() { return new Date(1); }
        };
    }

    private List<MarkEvent> savedEvents() {
        ArgumentCaptor<MarkEvent> c = ArgumentCaptor.forClass(MarkEvent.class);
        verify(events, atLeastOnce()).save(c.capture());
        return c.getAllValues();
    }

    @Test
    void entire_remark_keeps_the_teacher_mark_and_rescores_the_mcq() {
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");

        assertThat(longRow.getMarks()).isEqualTo(5.0);
        assertThat(mcqRow.getMarks()).isEqualTo(2.0);
        assertThat(mcqRow.getRevision()).isEqualTo(1);
        assertThat(attempt.getTotalMarks()).isEqualTo(7.0);
        MarkEvent e = savedEvents().get(0);
        assertThat(e.getEventType()).isEqualTo("SKIPPED_PROTECTED");
        assertThat(e.getQuestionId()).isNull();
        assertThat(e.getActorType()).isEqualTo("SYSTEM");
        assertThat(e.getActorUserId()).isEqualTo("admin-1");
        assertThat(e.getPayloadJson()).contains("s1:q2").contains("ENTIRE_ASSESSMENT");
        // a released total moved: "Released, changed"
        verify(attempts).bumpRevisionAfterRevaluate(eq("att-1"), any(Date.class));
    }

    @Test
    void legacy_row_on_a_hand_marked_test_is_protected_only_while_re_marking() {
        assessment.setEvaluationType("MANUAL");
        // Acceptance 5: the teacher marked the learner's uploaded sheet.
        attempt.setAttemptData(ATTEMPT_DATA.replaceFirst("\\{", "{\"fileId\":\"sheet-1\","));
        mcqRow.setMarks(1.0);
        mcqRow.setStatus("PARTIAL_CORRECT");
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(mcqRow.getMarks()).isEqualTo(1.0);
        assertThat(savedEvents().get(0).getPayloadJson()).contains("s1:q1").contains("s1:q2");

        // The submit path (no re-mark scope) still scores the same row with the key.
        service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt), null);
        assertThat(mcqRow.getMarks()).isEqualTo(2.0);
    }

    /**
     * Second review of F1: a MANUAL test answered on screen (no PDF; the learner app submits
     * it through the normal endpoint, which scores objective answers with the key and writes
     * no source). "Re-mark with answer key" re-scores the MCQ row after the key is fixed and
     * keeps the long answer a person marked.
     */
    @Test
    void manual_test_answered_on_screen_rescores_the_mcq_and_keeps_the_long_answer() {
        assessment.setEvaluationType("MANUAL");
        attempt.setReportReleaseStatus("PENDING");
        mcqRow.setMarks(0.0);          // scored with the old, wrong key
        longRow.setMarksSource(null);  // a teacher's mark from before marks_source existed
        longRow.setMarks(6.0);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(mcqRow.getMarks()).isEqualTo(2.0);
        assertThat(mcqRow.getStatus()).isEqualTo("CORRECT");
        assertThat(longRow.getMarks()).isEqualTo(6.0);
        assertThat(attempt.getTotalMarks()).isEqualTo(8.0);
        assertThat(savedEvents().get(0).getPayloadJson()).contains("s1:q2").doesNotContain("s1:q1");
    }

    /** Second review of F1, by question: the selected MCQ on an on-screen MANUAL attempt is re-scored. */
    @Test
    void manual_test_answered_on_screen_participants_and_questions_rescores_the_mcq() {
        assessment.setEvaluationType("MANUAL");
        longRow.setMarksSource(null);
        QuestionAssessmentSectionMapping mcqMapping = mapping("q1", MCQ_MARKING, MCQ_KEY, "MCQS");
        QuestionAssessmentSectionMapping longMapping = mapping("q2", "{}", "{}", "LONG_ANSWER");
        when(mappings.findByQuestionIdAndSectionId("q1", "s1")).thenReturn(Optional.of(mcqMapping));
        when(mappings.findByQuestionIdAndSectionId("q2", "s1")).thenReturn(Optional.of(longMapping));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q1"))
                .thenReturn(Optional.of(mcqRow));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q2"))
                .thenReturn(Optional.of(longRow));
        RevaluateRequest request = new RevaluateRequest();
        request.setAttemptIds(List.of("att-1"));
        RevaluateRequest.RevaluateQuestionDto q = new RevaluateRequest.RevaluateQuestionDto();
        q.setSectionId("s1");
        q.setQuestionIds(List.of("q1", "q2"));
        request.setQuestions(List.of(q));
        service.revaluateForCustomParticipantsAndQuestions(assessment, request, "admin-1");
        verify(marksService).updateQuestionWiseMarksForEveryQuestion(eq(assessment), eq(attempt),
                eq(mcqMapping.getQuestion()), anyString(), any(), eq("CORRECT"), eq(section), eq(2.0),
                org.mockito.ArgumentMatchers.isNull());
        verify(marksService, never()).updateQuestionWiseMarksForEveryQuestion(any(), any(),
                eq(longMapping.getQuestion()), any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyDouble(), any());
        assertThat(savedEvents()).extracting(MarkEvent::getQuestionId).containsExactly("q2");
    }

    /** Second review of F1: what counts as an uploaded sheet (MANUAL tests protect every legacy row). */
    @Test
    void uploaded_sheet_is_a_copy_check_a_file_id_or_an_evaluated_file() {
        StudentAttempt a = new StudentAttempt();
        a.setStatus("ENDED");
        a.setAttemptData(ATTEMPT_DATA);
        assertThat(StudentAttemptService.marksAnUploadedSheet(a)).isFalse();
        a.setAttemptData("{\"fileId\":\"  \",\"sections\":[]}");
        assertThat(StudentAttemptService.marksAnUploadedSheet(a)).isFalse();
        a.setAttemptData(null);
        assertThat(StudentAttemptService.marksAnUploadedSheet(a)).isFalse();
        a.setAttemptData("not json");
        assertThat(StudentAttemptService.marksAnUploadedSheet(a)).isFalse();
        a.setAttemptData("{\"fileId\":\"sheet-1\"}");
        assertThat(StudentAttemptService.marksAnUploadedSheet(a)).isTrue();
        a.setAttemptData(ATTEMPT_DATA);
        a.setEvaluatedFileId("annotated-1");
        assertThat(StudentAttemptService.marksAnUploadedSheet(a)).isTrue();
        a.setEvaluatedFileId(null);
        a.setStatus("COPY_CHECK");
        assertThat(StudentAttemptService.marksAnUploadedSheet(a)).isTrue();
    }

    /**
     * Pre-ship review R1: a MANUAL_EVALUATION log protects only legacy rows of questions a
     * person marks. An answer-key (MCQ) row with no source is the key's own mark and is
     * re-scored by "Re-mark with answer key".
     */
    @Test
    void manual_evaluation_log_protects_only_person_marked_legacy_rows() {
        when(logs.existsBySourceIdAndType("att-1", "MANUAL_EVALUATION")).thenReturn(true);
        mcqRow.setMarks(1.0);
        longRow.setMarksSource(null);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(mcqRow.getMarks()).isEqualTo(2.0);
        assertThat(longRow.getMarks()).isEqualTo(5.0);
        assertThat(savedEvents().get(0).getPayloadJson()).contains("s1:q2").doesNotContain("s1:q1");
    }

    /**
     * Pre-ship review R1, offline entry: the admin entered option choices and typed a direct
     * mark (MANUAL_EVALUATION log). After the MCQ key is fixed, the whole-test re-mark
     * re-scores the NULL-source MCQ row; the teacher's legacy LONG_ANSWER row is kept.
     */
    @Test
    void offline_entry_with_direct_marks_remark_rescores_the_mcq_and_keeps_the_long_answer() {
        when(logs.existsBySourceIdAndType("att-1", "MANUAL_EVALUATION")).thenReturn(true);
        attempt.setReportReleaseStatus("PENDING");
        mcqRow.setMarks(0.0);          // scored with the old, wrong key
        longRow.setMarksSource(null);  // the direct mark, written before marks_source existed
        longRow.setMarks(6.0);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(mcqRow.getMarks()).isEqualTo(2.0);
        assertThat(mcqRow.getStatus()).isEqualTo("CORRECT");
        assertThat(longRow.getMarks()).isEqualTo(6.0);
        assertThat(attempt.getTotalMarks()).isEqualTo(8.0);
        MarkEvent e = savedEvents().get(0);
        assertThat(e.getEventType()).isEqualTo("SKIPPED_PROTECTED");
        assertThat(e.getPayloadJson()).contains("s1:q2").doesNotContain("s1:q1");
    }

    /** Pre-ship review R1, by question: the explicitly selected MCQ is re-scored too. */
    @Test
    void offline_entry_participants_and_questions_rescores_the_selected_mcq() {
        when(logs.existsBySourceIdAndType("att-1", "MANUAL_EVALUATION")).thenReturn(true);
        longRow.setMarksSource(null);
        QuestionAssessmentSectionMapping mcqMapping = mapping("q1", MCQ_MARKING, MCQ_KEY, "MCQS");
        QuestionAssessmentSectionMapping longMapping = mapping("q2", "{}", "{}", "LONG_ANSWER");
        when(mappings.findByQuestionIdAndSectionId("q1", "s1")).thenReturn(Optional.of(mcqMapping));
        when(mappings.findByQuestionIdAndSectionId("q2", "s1")).thenReturn(Optional.of(longMapping));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q1"))
                .thenReturn(Optional.of(mcqRow));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q2"))
                .thenReturn(Optional.of(longRow));
        RevaluateRequest request = new RevaluateRequest();
        request.setAttemptIds(List.of("att-1"));
        RevaluateRequest.RevaluateQuestionDto q = new RevaluateRequest.RevaluateQuestionDto();
        q.setSectionId("s1");
        q.setQuestionIds(List.of("q1", "q2"));
        request.setQuestions(List.of(q));
        service.revaluateForCustomParticipantsAndQuestions(assessment, request, "admin-1");
        verify(marksService).updateQuestionWiseMarksForEveryQuestion(eq(assessment), eq(attempt),
                eq(mcqMapping.getQuestion()), anyString(), any(), eq("CORRECT"), eq(section), eq(2.0),
                org.mockito.ArgumentMatchers.isNull());
        verify(marksService, never()).updateQuestionWiseMarksForEveryQuestion(any(), any(),
                eq(longMapping.getQuestion()), any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyDouble(), any());
        assertThat(savedEvents()).extracting(MarkEvent::getQuestionId).containsExactly("q2");
    }

    @Test
    void scoring_type_falls_back_to_the_marking_scheme() {
        assertThat(StudentAttemptService.scoringType("MCQS", "{\"type\":\"NUMERIC\"}")).isEqualTo("MCQS");
        assertThat(StudentAttemptService.scoringType(null, MCQ_MARKING)).isEqualTo("MCQS");
        assertThat(StudentAttemptService.scoringType(null, "not json")).isNull();
        assertThat(StudentAttemptService.scoringType(null, null)).isNull();
    }

    @Test
    void participants_and_questions_skips_the_teacher_row_with_a_question_level_event() {
        QuestionAssessmentSectionMapping mcqMapping = mapping("q1", MCQ_MARKING, MCQ_KEY, "MCQS");
        QuestionAssessmentSectionMapping longMapping = mapping("q2", "{}", "{}", "LONG_ANSWER");
        when(mappings.findByQuestionIdAndSectionId("q1", "s1")).thenReturn(Optional.of(mcqMapping));
        when(mappings.findByQuestionIdAndSectionId("q2", "s1")).thenReturn(Optional.of(longMapping));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q1"))
                .thenReturn(Optional.of(mcqRow));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q2"))
                .thenReturn(Optional.of(longRow));

        RevaluateRequest request = new RevaluateRequest();
        request.setAttemptIds(List.of("att-1"));
        RevaluateRequest.RevaluateQuestionDto q = new RevaluateRequest.RevaluateQuestionDto();
        q.setSectionId("s1");
        q.setQuestionIds(List.of("q1", "q2"));
        request.setQuestions(List.of(q));
        service.revaluateForCustomParticipantsAndQuestions(assessment, request, "admin-1");

        verify(marksService).updateQuestionWiseMarksForEveryQuestion(eq(assessment), eq(attempt),
                eq(mcqMapping.getQuestion()), anyString(), any(), eq("CORRECT"), eq(section), eq(2.0),
                org.mockito.ArgumentMatchers.isNull());
        verify(marksService, never()).updateQuestionWiseMarksForEveryQuestion(any(), any(),
                eq(longMapping.getQuestion()), any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyDouble(), any());
        MarkEvent e = savedEvents().get(0);
        assertThat(e.getEventType()).isEqualTo("SKIPPED_PROTECTED");
        assertThat(e.getQuestionId()).isEqualTo("q2");
        assertThat(e.getSectionId()).isEqualTo("s1");
    }

    @Test
    void every_person_set_source_is_protected() {
        for (String s : List.of("AI", "AI_REVIEWED", "MANUAL", "OMR", "OFFLINE")) {
            assertThat(StudentAttemptService.isEvaluatorMarked(row("q", 0, "PENDING", s))).isTrue();
        }
        assertThat(StudentAttemptService.isEvaluatorMarked(row("q", 0, "PENDING", null))).isFalse();
        assertThat(StudentAttemptService.isEvaluatorMarked(row("q", 0, "PENDING", "AUTO"))).isFalse();
    }

    // ---------------------------------------------------------------- review fixes (2026-11-18)

    private StudentAttempt staleCopy() {
        StudentAttempt stale = new StudentAttempt();
        stale.setId("att-1");
        stale.setRegistration(attempt.getRegistration());
        stale.setStatus("ENDED");
        stale.setAttemptData(ATTEMPT_DATA);
        stale.setTotalMarks(5.0);
        stale.setReportReleaseStatus("PENDING");
        return stale;
    }

    private void withTransactions() {
        org.springframework.transaction.PlatformTransactionManager tm =
                mock(org.springframework.transaction.PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new org.springframework.transaction.support.SimpleTransactionStatus());
        ReflectionTestUtils.setField(service, "transactionManager", tm);
        when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
    }

    /** Review 1 #1: each attempt is re-marked under its lock, on a copy read after the lock. */
    @Test
    void remark_saves_the_copy_read_after_the_lock_not_the_stale_one() {
        withTransactions();
        StudentAttempt stale = staleCopy();
        service.revaluateAssessmentForAttempts(List.of(stale), "ENTIRE_ASSESSMENT", "admin-1");
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(attempts);
        order.verify(attempts).lockById("att-1");
        order.verify(attempts).findById("att-1");
        ArgumentCaptor<StudentAttempt> saved = ArgumentCaptor.forClass(StudentAttempt.class);
        verify(attempts, atLeastOnce()).save(saved.capture());
        assertThat(saved.getAllValues()).allSatisfy(a -> {
            assertThat(a).isSameAs(attempt);
            assertThat(a.getReportReleaseStatus()).isEqualTo("RELEASED");
        });
        assertThat(stale.getTotalMarks()).isEqualTo(5.0);
    }

    /** Review 1 #4: the newest of two duplicate rows is re-scored; an old one is never used. */
    @Test
    void remark_rescores_the_newest_duplicate_row() {
        QuestionWiseMarks older = row("q1", 0, "INCORRECT", null);
        older.setCreatedAt(new Date(1_000L));
        mcqRow.setCreatedAt(new Date(2_000L));
        when(marksService.getAllQuestionWiseMarksForAttemptId("att-1", "A")).thenReturn(List.of(older, longRow, mcqRow));
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(mcqRow.getMarks()).isEqualTo(2.0);
        assertThat(older.getMarks()).isEqualTo(0.0);
    }

    /** Review 1 #4: a question with a teacher's mark on any of its rows is not re-scored. */
    @Test
    void remark_keeps_a_question_whose_older_duplicate_a_teacher_marked() {
        QuestionWiseMarks olderTeacher = row("q1", 1, "PARTIAL_CORRECT", "MANUAL");
        olderTeacher.setCreatedAt(new Date(1_000L));
        mcqRow.setCreatedAt(new Date(2_000L));
        mcqRow.setMarks(1.0);
        when(marksService.getAllQuestionWiseMarksForAttemptId("att-1", "A"))
                .thenReturn(List.of(olderTeacher, longRow, mcqRow));
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(mcqRow.getMarks()).isEqualTo(1.0);
        assertThat(savedEvents().get(0).getPayloadJson()).contains("s1:q1");
    }

    /** Review 1 #4: the selected-questions re-mark writes the R6 total, not a sum of every row. */
    @Test
    void participants_and_questions_total_is_the_review_total() {
        var release = mock(vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService.class);
        var store = mock(vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore.class);
        ReflectionTestUtils.setField(service, "submissionReleaseService", release);
        ReflectionTestUtils.setField(service, "submissionReviewStore", store);
        var state = vacademy.io.assessment_service.features.submission_review.ReviewFixtures.state("att-1", "ENDED",
                true, 5.0, 0, 0);
        when(store.attempt("att-1")).thenReturn(state);
        when(release.snapshot(attempt, state)).thenReturn(
                new vacademy.io.assessment_service.features.submission_review.service.SubmissionSnapshots.Snapshot(
                        List.of(), new vacademy.io.assessment_service.features.submission_review.service
                        .SubmissionSnapshots.Counts(0, 0, 0, 2, 0, 0, 0), 7.0, 10.0, "COMPLETED", false, 0));
        QuestionAssessmentSectionMapping mcqMapping = mapping("q1", MCQ_MARKING, MCQ_KEY, "MCQS");
        when(mappings.findByQuestionIdAndSectionId("q1", "s1")).thenReturn(Optional.of(mcqMapping));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q1"))
                .thenReturn(Optional.of(mcqRow));
        // A stale duplicate row would have added 4 to a plain sum.
        when(marksService.getAllQuestionWiseMarksForAttemptId("att-1", "A"))
                .thenReturn(List.of(mcqRow, longRow, row("q2", 4, "PARTIAL_CORRECT", null)));
        RevaluateRequest request = new RevaluateRequest();
        request.setAttemptIds(List.of("att-1"));
        RevaluateRequest.RevaluateQuestionDto q = new RevaluateRequest.RevaluateQuestionDto();
        q.setSectionId("s1");
        q.setQuestionIds(List.of("q1"));
        request.setQuestions(List.of(q));
        service.revaluateForCustomParticipantsAndQuestions(assessment, request, "admin-1");
        assertThat(attempt.getTotalMarks()).isEqualTo(7.0);
        assertThat(attempt.getResultMarks()).isEqualTo(7.0);
    }

    /** Review 2 #1: a re-mark never re-releases a result a teacher hid. */
    @Test
    void remark_does_not_auto_release_a_hidden_result() {
        assessment.setResultType("AUTO_AFTER_SUBMISSION");
        attempt.setReportReleaseStatus("PENDING");
        ReflectionTestUtils.setField(attempt, "resultWithheldAt", new Date());
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(attempt.getReportReleaseStatus()).isEqualTo("PENDING");

        ReflectionTestUtils.setField(attempt, "resultWithheldAt", null);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(attempt.getReportReleaseStatus()).isEqualTo("RELEASED");
    }

    private QuestionAssessmentSectionMapping mapping(String questionId, String marking, String key, String type) {
        Question q = new Question();
        q.setId(questionId);
        q.setQuestionType(type);
        q.setAutoEvaluationJson(key);
        QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
        m.setQuestion(q);
        m.setMarkingJson(marking);
        m.setSection(section);
        m.setStatus("ACTIVE");
        return m;
    }

    /** PR #3814: a TEACHER mark (its first question-marks endpoint) is a hand mark like MANUAL. */
    @Test
    void entire_remark_keeps_a_legacy_teacher_mark_on_an_mcq() {
        mcqRow.setMarksSource("TEACHER");
        mcqRow.setMarks(1.5);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(mcqRow.getMarks()).isEqualTo(1.5);
        assertThat(savedEvents().get(0).getPayloadJson()).contains("s1:q1").contains("s1:q2");
    }

    /** PR #3814: by question, an older duplicate row a person marked keeps the question too. */
    @Test
    void question_remark_keeps_a_question_whose_older_duplicate_a_person_marked() {
        QuestionAssessmentSectionMapping mcqMapping = mapping("q1", MCQ_MARKING, MCQ_KEY, "MCQS");
        when(mappings.findByQuestionIdAndSectionId("q1", "s1")).thenReturn(Optional.of(mcqMapping));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q1"))
                .thenReturn(Optional.of(mcqRow));
        QuestionWiseMarks olderTeacherRow = row("q1", 2, "CORRECT", "TEACHER");
        when(marksService.getAllQuestionWiseMarksForQuestionIdsAndAttemptId("att-1", List.of("q1"), "s1"))
                .thenReturn(List.of(mcqRow, olderTeacherRow));
        RevaluateRequest request = new RevaluateRequest();
        request.setAttemptIds(List.of("att-1"));
        RevaluateRequest.RevaluateQuestionDto q = new RevaluateRequest.RevaluateQuestionDto();
        q.setSectionId("s1");
        q.setQuestionIds(List.of("q1"));
        request.setQuestions(List.of(q));
        service.revaluateForCustomParticipantsAndQuestions(assessment, request, "admin-1");
        verify(marksService, never()).updateQuestionWiseMarksForEveryQuestion(any(), any(), any(), any(), any(),
                any(), any(), org.mockito.ArgumentMatchers.anyDouble(), any());
        assertThat(savedEvents()).extracting(MarkEvent::getQuestionId).containsExactly("q1");
    }

    @Test
    void every_hand_or_ai_source_is_protected_from_the_answer_key() {
        for (String source : List.of("AI", "AI_REVIEWED", "MANUAL", "TEACHER", "OMR", "OFFLINE")) {
            assertThat(StudentAttemptService.isEvaluatorMarked(row("q1", 1, "CORRECT", source))).as(source).isTrue();
        }
        for (String source : java.util.Arrays.asList("AUTO", "KEYWORD", null)) {
            assertThat(StudentAttemptService.isEvaluatorMarked(row("q1", 1, "CORRECT", source))).as(source).isFalse();
        }
    }

    // ------------------------------------------- keyword-scored long answers (owner decision 2026-11-19)

    private static final String LONG_MARKING = "{\"type\":\"LONG_ANSWER\",\"data\":{\"totalMark\":8,\"negativeMark\":0}}";
    private static final String LONG_KEY = "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"content\":\"photosynthesis\"}}}";

    /** The paper's long answer (q2) gets a model answer, so the keyword match scores it. */
    private void longAnswerWithModelAnswer(String key) {
        when(mappings.findMarkingSchemeRowsBySectionIds(anyList()))
                .thenReturn(List.of(scheme("q1", MCQ_MARKING, MCQ_KEY), scheme("q2", LONG_MARKING, key)));
    }

    private void keywordRow(String source, double marks, String status) {
        longRow.setMarksSource(source);
        longRow.setMarks(marks);
        longRow.setStatus(status);
    }

    @Test
    void submit_writes_keyword_on_a_keyword_scored_long_answer_and_drops_it_when_unscored() {
        attempt.setReportReleaseStatus(null);
        keywordRow(null, 0, "PENDING");
        longAnswerWithModelAnswer(LONG_KEY);
        service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt), null);
        assertThat(longRow.getMarks()).isEqualTo(8.0);
        assertThat(longRow.getStatus()).isEqualTo("CORRECT");
        assertThat(longRow.getMarksSource()).isEqualTo("KEYWORD");
        assertThat(longRow.getRevision()).isEqualTo(1);
        assertThat(mcqRow.getMarksSource()).isNull();

        // INCORRECT is a keyword score too.
        longAnswerWithModelAnswer(LONG_KEY.replace("photosynthesis", "respiration of glucose"));
        service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt), null);
        assertThat(longRow.getStatus()).isEqualTo("INCORRECT");
        assertThat(longRow.getMarksSource()).isEqualTo("KEYWORD");
        assertThat(longRow.getRevision()).isEqualTo(2);

        // The model answer is removed: 0 / PENDING, no keyword source, revision bumped.
        longAnswerWithModelAnswer("{\"type\":\"LONG_ANSWER\",\"data\":{}}");
        service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt), null);
        assertThat(longRow.getStatus()).isEqualTo("PENDING");
        assertThat(longRow.getMarksSource()).isNull();
        assertThat(longRow.getRevision()).isEqualTo(3);

        // Nothing changed: no revision bump.
        service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt), null);
        assertThat(longRow.getRevision()).isEqualTo(3);
    }

    @Test
    void submit_creates_a_new_long_answer_row_with_the_keyword_source() {
        attempt.setReportReleaseStatus(null);
        when(marksService.getAllQuestionWiseMarksForAttemptId("att-1", "A")).thenReturn(List.of(mcqRow));
        when(marksService.createQuestionWiseMarks(anyList())).thenAnswer(i -> i.getArgument(0));
        longAnswerWithModelAnswer(LONG_KEY);
        service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt), null);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<QuestionWiseMarks>> saved = ArgumentCaptor.forClass(List.class);
        verify(marksService).createQuestionWiseMarks(saved.capture());
        QuestionWiseMarks created = saved.getValue().stream()
                .filter(m -> m != mcqRow).findFirst().orElseThrow();
        assertThat(created.getStatus()).isEqualTo("CORRECT");
        assertThat(created.getMarksSource()).isEqualTo("KEYWORD");
    }

    @Test
    void remark_rescores_an_unconfirmed_keyword_row_but_never_a_confirmed_one() {
        attempt.setReportReleaseStatus("PENDING");
        keywordRow("KEYWORD", 4, "CORRECT");
        longAnswerWithModelAnswer(LONG_KEY);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(longRow.getMarks()).isEqualTo(8.0);
        assertThat(longRow.getMarksSource()).isEqualTo("KEYWORD");

        // A teacher confirmed it (MARKED / MANUAL): the re-mark keeps it.
        keywordRow("MANUAL", 4, "PARTIAL_CORRECT");
        longRow.setMarkState("MARKED");
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(longRow.getMarks()).isEqualTo(4.0);
        assertThat(longRow.getMarksSource()).isEqualTo("MANUAL");
    }

    /** A re-mark of a released result leaves the source NULL: no "released with unmarked" on old results. */
    @Test
    void remark_of_a_released_result_never_adds_the_keyword_source() {
        keywordRow(null, 0, "INCORRECT");
        longAnswerWithModelAnswer(LONG_KEY);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(longRow.getMarks()).isEqualTo(8.0);
        assertThat(longRow.getStatus()).isEqualTo("CORRECT");
        assertThat(longRow.getMarksSource()).isNull();
    }

    private RevaluateRequest longQuestionRequest() {
        QuestionAssessmentSectionMapping longMapping = mapping("q2", LONG_MARKING, LONG_KEY, "LONG_ANSWER");
        when(mappings.findByQuestionIdAndSectionId("q2", "s1")).thenReturn(Optional.of(longMapping));
        when(marksService.getQuestionWiseMarkForAssessmentIdAndSectionIdAndQuestionIdAndAttemptId("A", "att-1", "s1", "q2"))
                .thenReturn(Optional.of(longRow));
        RevaluateRequest request = new RevaluateRequest();
        request.setAttemptIds(List.of("att-1"));
        RevaluateRequest.RevaluateQuestionDto q = new RevaluateRequest.RevaluateQuestionDto();
        q.setSectionId("s1");
        q.setQuestionIds(List.of("q2"));
        request.setQuestions(List.of(q));
        return request;
    }

    @Test
    void question_remark_passes_the_keyword_source_only_before_release() {
        keywordRow(null, 0, "PENDING");
        attempt.setReportReleaseStatus("PENDING");
        service.revaluateForCustomParticipantsAndQuestions(assessment, longQuestionRequest(), "admin-1");
        verify(marksService).updateQuestionWiseMarksForEveryQuestion(eq(assessment), eq(attempt), any(), anyString(),
                any(), eq("CORRECT"), eq(section), eq(8.0), eq("KEYWORD"));

        attempt.setReportReleaseStatus("RELEASED");
        service.revaluateForCustomParticipantsAndQuestions(assessment, longQuestionRequest(), "admin-1");
        verify(marksService).updateQuestionWiseMarksForEveryQuestion(eq(assessment), eq(attempt), any(), anyString(),
                any(), eq("CORRECT"), eq(section), eq(8.0), org.mockito.ArgumentMatchers.isNull());
    }

    @Test
    void question_wise_writer_sets_the_source_and_bumps_the_revision_on_a_change() {
        var repo = mock(vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository.class);
        QuestionWiseMarksService real = new QuestionWiseMarksService();
        ReflectionTestUtils.setField(real, "questionWiseMarksRepository", repo);
        keywordRow(null, 0, "PENDING");
        when(repo.findByAssessmentIdAndStudentAttemptIdAndQuestionIdAndSectionId("A", "att-1", "q2", "s1"))
                .thenReturn(Optional.of(longRow));
        Question q2 = longRow.getQuestion();
        real.updateQuestionWiseMarksForEveryQuestion(assessment, attempt, q2, "{}", null, "CORRECT", section, 8.0, "KEYWORD");
        assertThat(longRow.getMarksSource()).isEqualTo("KEYWORD");
        assertThat(longRow.getRevision()).isEqualTo(1);
        real.updateQuestionWiseMarksForEveryQuestion(assessment, attempt, q2, "{}", null, "CORRECT", section, 8.0, "KEYWORD");
        assertThat(longRow.getRevision()).isEqualTo(1);
        // Same marks and status, source dropped: still a change an open form must see.
        real.updateQuestionWiseMarksForEveryQuestion(assessment, attempt, q2, "{}", null, "CORRECT", section, 8.0, null);
        assertThat(longRow.getMarksSource()).isNull();
        assertThat(longRow.getRevision()).isEqualTo(2);
    }

    /** The submit hold: a keyword score is not auto-released; without one the result releases as before. */
    @Test
    void submit_holds_an_auto_release_attempt_with_a_keyword_score() {
        assessment.setResultType("AUTO_AFTER_SUBMISSION");
        attempt.setReportReleaseStatus(null);
        attempt.setResultStatus(null);
        when(typed.awaitsKeywordConfirmation(any(), any())).thenReturn(true);
        service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt), null);
        assertThat(attempt.getResultStatus()).isEqualTo("PENDING");
        assertThat(attempt.getReportReleaseStatus()).isEqualTo("PENDING");
        verify(publisher, never()).publishResultReleased(any(), any(), any());

        when(typed.awaitsKeywordConfirmation(any(), any())).thenReturn(false);
        attempt.setReportReleaseStatus(null);
        attempt.setResultStatus(null);
        service.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt), null);
        assertThat(attempt.getResultStatus()).isEqualTo("COMPLETED");
        assertThat(attempt.getReportReleaseStatus()).isEqualTo("RELEASED");
        verify(publisher).publishResultReleased(any(), any(), any());
    }

    /**
     * KW-1: a re-mark that leaves a keyword suggestion on an unreleased attempt already stored
     * COMPLETED (e.g. released after the test ends) reopens it as PENDING, so the after-end
     * cron (result_status = 'COMPLETED') does not publish the unconfirmed suggestion.
     */
    @Test
    void entire_remark_reopens_an_unreleased_completed_attempt_left_with_a_keyword_suggestion() {
        attempt.setReportReleaseStatus("PENDING");
        attempt.setResultStatus("COMPLETED");
        keywordRow(null, 0, "PENDING");
        longAnswerWithModelAnswer(LONG_KEY);
        when(typed.awaitsKeywordConfirmation(any(), any())).thenReturn(true);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(longRow.getMarksSource()).isEqualTo("KEYWORD");
        assertThat(attempt.getResultStatus()).isEqualTo("PENDING");
        assertThat(attempt.getReportReleaseStatus()).isEqualTo("PENDING");

        // No keyword suggestion left: a COMPLETED result stays COMPLETED.
        attempt.setResultStatus("COMPLETED");
        when(typed.awaitsKeywordConfirmation(any(), any())).thenReturn(false);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(attempt.getResultStatus()).isEqualTo("COMPLETED");
    }

    @Test
    void question_remark_reopens_an_unreleased_completed_attempt_left_with_a_keyword_suggestion() {
        attempt.setReportReleaseStatus(null);
        attempt.setResultStatus("COMPLETED");
        keywordRow(null, 0, "PENDING");
        when(typed.awaitsKeywordConfirmation(any(), any())).thenReturn(true);
        service.revaluateForCustomParticipantsAndQuestions(assessment, longQuestionRequest(), "admin-1");
        verify(marksService).updateQuestionWiseMarksForEveryQuestion(eq(assessment), eq(attempt), any(), anyString(),
                any(), eq("CORRECT"), eq(section), eq(8.0), eq("KEYWORD"));
        assertThat(attempt.getResultStatus()).isEqualTo("PENDING");
        assertThat(attempt.getReportReleaseStatus()).isEqualTo("PENDING");
        verify(attempts, atLeastOnce()).save(attempt);
    }

    /** A released result is never reopened by a re-mark, whatever its rows say. */
    @Test
    void remark_never_reopens_a_released_result() {
        attempt.setReportReleaseStatus("RELEASED");
        attempt.setResultStatus("COMPLETED");
        keywordRow(null, 0, "PENDING");
        longAnswerWithModelAnswer(LONG_KEY);
        when(typed.awaitsKeywordConfirmation(any(), any())).thenReturn(true);
        service.revaluateAssessmentForAttempts(List.of(attempt), "ENTIRE_ASSESSMENT", "admin-1");
        assertThat(attempt.getResultStatus()).isEqualTo("COMPLETED");
        assertThat(longRow.getMarksSource()).isNull();
        service.revaluateForCustomParticipantsAndQuestions(assessment, longQuestionRequest(), "admin-1");
        assertThat(attempt.getResultStatus()).isEqualTo("COMPLETED");
        assertThat(attempt.getReportReleaseStatus()).isEqualTo("RELEASED");
    }
}
