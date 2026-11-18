package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.EvaluationLogs;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.EvaluationLogsRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationReviewService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Staff marks a question from the submission view: any type, clamped, kept across re-evaluation. */
class QuestionMarksOverrideServiceTest {

    private StudentAttemptRepository attempts;
    private vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository marksRepo;
    private QuestionAssessmentSectionMappingRepository mappings;
    private AiEvaluationProcessRepository processes;
    private AiQuestionEvaluationRepository aiRows;
    private AiEvaluationReviewService aiReview;
    private TypedAnswerEvaluation typed;
    private StudentAttemptService studentAttemptService;
    private EvaluationLogsRepository logs;
    private QuestionMarksOverrideService service;

    private StudentAttempt attempt;
    private QuestionWiseMarks row;

    @BeforeEach
    void setUp() {
        attempts = mock(StudentAttemptRepository.class);
        marksRepo = mock(vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository.class);
        mappings = mock(QuestionAssessmentSectionMappingRepository.class);
        processes = mock(AiEvaluationProcessRepository.class);
        aiRows = mock(AiQuestionEvaluationRepository.class);
        aiReview = mock(AiEvaluationReviewService.class);
        typed = mock(TypedAnswerEvaluation.class);
        studentAttemptService = mock(StudentAttemptService.class);
        logs = mock(EvaluationLogsRepository.class);
        service = new QuestionMarksOverrideService(attempts, marksRepo, mappings, processes, aiRows, aiReview, typed,
                studentAttemptService, logs, new ResultLockGuard());

        Assessment assessment = new Assessment();
        assessment.setId("a1");
        assessment.setEvaluationType("AUTO");
        AssessmentUserRegistration registration = new AssessmentUserRegistration();
        registration.setAssessment(assessment);
        registration.setUserId("learner-1");
        registration.setStudentAttempts(new HashSet<>());
        attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setStatus("ENDED");
        attempt.setRegistration(registration);
        when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));

        Section section = new Section();
        section.setId("s1");
        Question question = new Question();
        question.setId("q1");
        QuestionAssessmentSectionMapping mapping = new QuestionAssessmentSectionMapping();
        mapping.setSection(section);
        mapping.setQuestion(question);
        mapping.setMarkingJson("{\"type\":\"MCQS\",\"data\":{\"totalMark\":\"4\",\"negativeMark\":\"1\"}}");
        when(mappings.findByQuestionIdAndSectionId("q1", "s1")).thenReturn(Optional.of(mapping));

        row = QuestionWiseMarks.builder().question(question).section(section).sectionId("s1")
                .marks(-1.0).status("INCORRECT").build();
        when(marksRepo.findAllByAttemptIdAndQuestionId("att-1", "q1")).thenReturn(List.of(row));
        when(processes.findByStudentAttempt_IdIn(List.of("att-1"))).thenReturn(List.of());
    }

    @Test
    void wrong_mcq_gets_full_marks_as_a_teacher_mark_and_the_total_is_recomputed() {
        Map<String, Object> out = service.override("a1", "att-1", "s1", "q1", 4.0, "Bonus: key was wrong", "admin-1");

        assertThat(row.getMarks()).isEqualTo(4.0);
        assertThat(row.getStatus()).isEqualTo("CORRECT");
        assertThat(row.getMarksSource()).isEqualTo(QuestionMarksOverrideService.TEACHER);
        assertThat(row.getEvaluatorFeedback()).isEqualTo("Bonus: key was wrong");
        verify(marksRepo).save(row);
        verify(studentAttemptService).updateMarksAfterRevaluation(attempt, "a1");
        assertThat(out.get("marks_source")).isEqualTo("TEACHER");
        assertThat(out.get("max_marks")).isEqualTo(4.0);

        ArgumentCaptor<EvaluationLogs> log = ArgumentCaptor.forClass(EvaluationLogs.class);
        verify(logs).save(log.capture());
        assertThat(log.getValue().getType()).isEqualTo("MARKS_OVERRIDE");
        assertThat(log.getValue().getDataJson()).contains("\"previous_marks\":-1.0").contains("\"marks\":4.0");
    }

    @Test
    void marks_stay_between_zero_and_full_marks() {
        service.override("a1", "att-1", "s1", "q1", 9.0, null, "admin-1");
        assertThat(row.getMarks()).isEqualTo(4.0);
        service.override("a1", "att-1", "s1", "q1", -3.0, null, "admin-1");
        assertThat(row.getMarks()).isEqualTo(0.0);
        assertThat(row.getStatus()).isEqualTo("INCORRECT");
    }

    @Test
    void partial_marks_are_partially_correct() {
        service.override("a1", "att-1", "s1", "q1", 2.5, null, "admin-1");
        assertThat(row.getStatus()).isEqualTo("PARTIAL_CORRECT");
    }

    @Test
    void question_marked_by_the_latest_ai_run_goes_through_the_ai_review_override() {
        AiEvaluationProcess older = new AiEvaluationProcess();
        older.setId("p-old");
        older.setCreatedAt(new Date(1_000));
        AiEvaluationProcess latest = new AiEvaluationProcess();
        latest.setId("p-new");
        latest.setCreatedAt(new Date(2_000));
        when(processes.findByStudentAttempt_IdIn(List.of("att-1"))).thenReturn(List.of(older, latest));
        when(aiRows.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("p-new", "q1"))
                .thenReturn(List.of(new AiQuestionEvaluation()));

        Map<String, Object> out = service.override("a1", "att-1", "s1", "q1", 5.0, "fair", "admin-1");

        verify(aiReview).overrideQuestion("p-new", "q1", 4.0, "fair", "admin-1");
        verify(marksRepo, never()).save(any());
        assertThat(out.get("marks_source")).isEqualTo("AI_REVIEWED");
    }

    @Test
    void online_attempt_after_an_ai_run_keeps_the_ai_total_rule_for_other_questions() {
        AiEvaluationProcess run = new AiEvaluationProcess();
        run.setId("p1");
        when(processes.findByStudentAttempt_IdIn(List.of("att-1"))).thenReturn(List.of(run));
        when(aiRows.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("p1", "q1")).thenReturn(List.of());
        when(aiRows.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of());
        when(typed.isTypedAttempt(eq(attempt), any())).thenReturn(true);
        when(typed.attemptTotal(eq(attempt), any())).thenReturn(17.0);

        service.override("a1", "att-1", "s1", "q1", 4.0, null, "admin-1");

        assertThat(attempt.getTotalMarks()).isEqualTo(17.0);
        assertThat(attempt.getResultMarks()).isEqualTo(17.0);
        verify(studentAttemptService, never()).updateMarksAfterRevaluation(any(), anyString());
    }

    @Test
    void a_question_without_a_marks_row_is_refused_and_nothing_is_written() {
        when(marksRepo.findAllByAttemptIdAndQuestionId("att-1", "q1")).thenReturn(List.of());
        assertThatThrownBy(() -> service.override("a1", "att-1", "s1", "q1", 2.0, null, "admin-1"))
                .isInstanceOf(VacademyException.class);
        verify(marksRepo, never()).save(any());
        verify(studentAttemptService, never()).updateMarksAfterRevaluation(any(), anyString());
        verify(logs, never()).save(any());
    }

    @Test
    void a_row_from_an_older_ai_run_stays_ai_reviewed() {
        row.setMarksSource("AI");
        Map<String, Object> out = service.override("a1", "att-1", "s1", "q1", 3.0, null, "admin-1");
        assertThat(row.getMarksSource()).isEqualTo("AI_REVIEWED");
        assertThat(out.get("marks_source")).isEqualTo("AI_REVIEWED");
    }

    @Test
    void a_row_of_another_section_is_not_touched() {
        Section other = new Section();
        other.setId("s2");
        QuestionWiseMarks otherRow = QuestionWiseMarks.builder().section(other).sectionId("s2").marks(1.0).build();
        when(marksRepo.findAllByAttemptIdAndQuestionId("att-1", "q1")).thenReturn(List.of(row, otherRow));
        service.override("a1", "att-1", "s1", "q1", 4.0, null, "admin-1");
        assertThat(otherRow.getMarks()).isEqualTo(1.0);
        assertThat(otherRow.getMarksSource()).isNull();
    }

    @Test
    void written_question_is_refused_while_an_ai_run_is_still_queued() {
        AiEvaluationProcess queued = new AiEvaluationProcess();
        queued.setId("p-q");
        queued.setStatus("PENDING");
        when(processes.findByStudentAttempt_IdIn(List.of("att-1"))).thenReturn(List.of(queued));
        mappings.findByQuestionIdAndSectionId("q1", "s1").get().getQuestion().setQuestionType("LONG_ANSWER");

        assertThatThrownBy(() -> service.override("a1", "att-1", "s1", "q1", 3.0, null, "admin-1"))
                .isInstanceOf(VacademyException.class);
        verify(marksRepo, never()).save(any());
        verify(aiReview, never()).overrideQuestion(anyString(), anyString(), any(), any(), anyString());
    }

    @Test
    void mcq_can_still_be_changed_while_an_ai_run_works_on_the_written_answers() {
        AiEvaluationProcess running = new AiEvaluationProcess();
        running.setId("p-r");
        running.setStatus("EVALUATING");
        when(processes.findByStudentAttempt_IdIn(List.of("att-1"))).thenReturn(List.of(running));
        mappings.findByQuestionIdAndSectionId("q1", "s1").get().getQuestion().setQuestionType("MCQS");

        service.override("a1", "att-1", "s1", "q1", 4.0, null, "admin-1");
        assertThat(row.getMarks()).isEqualTo(4.0);
        assertThat(row.getMarksSource()).isEqualTo("TEACHER");
    }

    @Test
    void response_reports_the_stored_marks() {
        Map<String, Object> out = service.override("a1", "att-1", "s1", "q1", 9.0, null, "admin-1");
        assertThat(out.get("marks")).isEqualTo(4.0);
    }

    @Test
    void live_attempt_and_other_assessment_are_refused() {
        assertThatThrownBy(() -> service.override("other", "att-1", "s1", "q1", 1.0, null, "admin-1"))
                .isInstanceOf(VacademyException.class);
        attempt.setStatus("LIVE");
        assertThatThrownBy(() -> service.override("a1", "att-1", "s1", "q1", 1.0, null, "admin-1"))
                .isInstanceOf(VacademyException.class);
        verify(marksRepo, never()).save(any());
    }

    @Test
    void zero_on_a_skipped_question_stays_skipped() {
        assertThat(QuestionMarksOverrideService.statusFor(0, 4.0, "PENDING")).isEqualTo("PENDING");
        assertThat(QuestionMarksOverrideService.statusFor(0, 4.0, null)).isEqualTo("PENDING");
        assertThat(QuestionMarksOverrideService.statusFor(0, 4.0, "CORRECT")).isEqualTo("INCORRECT");
    }
}
