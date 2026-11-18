package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.QuestionMarksOverrideRequest;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.service.MarkWriter;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewAccess;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * PUT admin/participants/question-marks (PR #3814) after the Phase 1a merge: the same request
 * and response, written through MarkWriter (writer QUESTION_MARKS_PUT) with the Submission
 * page's edit rights. MarkWriter's own behaviour for this writer is in MarkWriterTest.
 */
class QuestionMarksOverrideServiceTest {

    private StudentAttemptRepository attempts;
    private MarkWriter markWriter;
    private SubmissionReviewStore store;
    private QuestionMarksOverrideService service;
    private StudentAttempt attempt;
    private CustomUserDetails teacher;

    @BeforeEach
    void setUp() {
        attempts = mock(StudentAttemptRepository.class);
        markWriter = mock(MarkWriter.class);
        store = mock(SubmissionReviewStore.class);
        service = new QuestionMarksOverrideService(attempts, markWriter, new SubmissionReviewAccess(), store);

        Assessment assessment = new Assessment();
        assessment.setId("a1");
        AssessmentUserRegistration registration = new AssessmentUserRegistration();
        registration.setAssessment(assessment);
        registration.setUserId("learner-1");
        registration.setStudentAttempts(new HashSet<>());
        attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setStatus("ENDED");
        attempt.setRegistration(registration);
        attempt.setCommaSeparatedEvaluatorUserIds("someone-else");
        when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
        released(false);

        teacher = user("teacher-1", "TEACHER");
        when(markWriter.apply(any())).thenReturn(result(1, 4.0, 3.0, "MANUAL"));
    }

    private static CustomUserDetails user(String id, String... roles) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn(id);
        List<SimpleGrantedAuthority> auths = java.util.Arrays.stream(roles).map(SimpleGrantedAuthority::new).toList();
        when(u.getAuthorities()).thenAnswer(i -> auths);
        return u;
    }

    private void released(boolean released) {
        when(store.attempt("att-1")).thenReturn(vacademy.io.assessment_service.features.submission_review.ReviewFixtures
                .state("att-1", "ENDED", released, 2.0, 3, released ? 3 : null));
    }

    private static MarkWriter.MarkResult result(int changed, double newMarks, double totalAfter, String source) {
        MarkWriter.RowResult row = new MarkWriter.RowResult("s1", "q1", 0.0, newMarks, "MARKED", "MARKED", "AUTO",
                source, 1, changed > 0, false);
        return new MarkWriter.MarkResult("att-1", 2.0, totalAfter, 10.0, null, List.of(row), false, null, 4, false,
                false, changed, vacademy.io.assessment_service.features.submission_review.ReviewFixtures.state("att-1",
                "ENDED", false, 2.0, 3, null), null);
    }

    private static QuestionMarksOverrideRequest body(Double marks) {
        return QuestionMarksOverrideRequest.builder().sectionId("s1").questionId("q1").marks(marks).build();
    }

    private MarkWriter.MarkChange sentChange() {
        ArgumentCaptor<MarkWriter.MarkChange> c = ArgumentCaptor.forClass(MarkWriter.MarkChange.class);
        verify(markWriter).apply(c.capture());
        return c.getValue();
    }

    @Test
    void writes_through_mark_writer_and_keeps_the_response_shape() {
        Map<String, Object> out = service.override(teacher, "a1", "att-1", body(4.0));

        MarkWriter.MarkChange change = sentChange();
        assertThat(change.writer()).isEqualTo(MarkWriter.Writer.QUESTION_MARKS_PUT);
        assertThat(change.marks()).isEqualTo(4.0);
        assertThat(change.actorUserId()).isEqualTo("teacher-1");
        assertThat(change.expectedRevision()).isNull();
        assertThat(change.expectedRelease()).isNull();
        assertThat(change.reason()).isNull();
        assertThat(change.notifyLearner()).isFalse();
        assertThat(change.feedback()).isNull();
        assertThat(out).containsOnlyKeys("question_id", "section_id", "marks", "max_marks", "marks_source",
                "attempt_total_marks");
        assertThat(out).containsEntry("marks", 4.0).containsEntry("marks_source", "MANUAL")
                .containsEntry("attempt_total_marks", 3.0);
    }

    @Test
    void after_release_a_default_reason_is_recorded_when_the_caller_sends_none() {
        released(true);
        service.override(teacher, "a1", "att-1", body(4.0));
        assertThat(sentChange().reason()).isEqualTo(QuestionMarksOverrideService.DEFAULT_REASON_AFTER_RELEASE);
    }

    @Test
    void optional_reason_notify_and_concurrency_tokens_are_passed_on() {
        released(true);
        QuestionMarksOverrideRequest req = body(4.0);
        req.setReason(" Bonus: wrong key ");
        req.setNotifyLearner(true);
        req.setExpectedRevision(2);
        req.setExpectedRelease("RELEASED|1762861800000");
        service.override(teacher, "a1", "att-1", req);
        MarkWriter.MarkChange change = sentChange();
        assertThat(change.reason()).isEqualTo("Bonus: wrong key");
        assertThat(change.notifyLearner()).isTrue();
        assertThat(change.expectedRevision()).isEqualTo(2);
        assertThat(change.expectedRelease()).isEqualTo("RELEASED|1762861800000");
    }

    @Test
    void blank_feedback_clears_the_remark_and_null_keeps_it() {
        QuestionMarksOverrideRequest req = body(4.0);
        req.setFeedback("   ");
        service.override(teacher, "a1", "att-1", req);
        assertThat(sentChange().feedback()).isEqualTo("");
    }

    @Test
    void unchanged_mark_reports_the_stored_total() {
        when(markWriter.apply(any())).thenReturn(result(0, 4.0, 9.0, "MANUAL"));
        assertThat(service.override(teacher, "a1", "att-1", body(4.0))).containsEntry("attempt_total_marks", 2.0);
    }

    @Test
    void legacy_teacher_source_is_reported_as_manual() {
        when(markWriter.apply(any())).thenReturn(result(1, 4.0, 3.0, "TEACHER"));
        assertThat(service.override(teacher, "a1", "att-1", body(4.0))).containsEntry("marks_source", "MANUAL");
    }

    @Test
    void bad_requests_and_other_assessments_are_refused_before_any_write() {
        assertThatThrownBy(() -> service.override(teacher, "a1", "att-1", body(null)))
                .isInstanceOfSatisfying(VacademyException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> service.override(teacher, "a1", "att-1", body(Double.NaN)))
                .isInstanceOf(VacademyException.class);
        QuestionMarksOverrideRequest noSection = body(1.0);
        noSection.setSectionId(" ");
        assertThatThrownBy(() -> service.override(teacher, "a1", "att-1", noSection))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.override(teacher, "other", "att-1", body(1.0)))
                .isInstanceOfSatisfying(VacademyException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
        verify(markWriter, never()).apply(any());
    }

    @Test
    void an_evaluator_only_user_gets_the_submission_page_rules() {
        CustomUserDetails evaluator = user("eval-1", "EVALUATOR");
        // Not assigned to this attempt.
        assertThatThrownBy(() -> service.override(evaluator, "a1", "att-1", body(1.0)))
                .isInstanceOf(ForbiddenException.class);
        // Assigned, but the result is released.
        attempt.setCommaSeparatedEvaluatorUserIds("eval-1");
        released(true);
        assertThatThrownBy(() -> service.override(evaluator, "a1", "att-1", body(1.0)))
                .isInstanceOfSatisfying(VacademyException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
        verify(markWriter, never()).apply(any());
        // Assigned and not released: allowed.
        released(false);
        service.override(evaluator, "a1", "att-1", body(1.0));
        verify(markWriter).apply(any());
    }

    @Test
    void mark_writer_refusals_keep_the_old_error_shape() {
        when(markWriter.apply(any())).thenThrow(SubmissionReviewException.conflict("AI_CHECKING",
                "AI is still checking this answer. Change its marks after it finishes.", null));
        assertThatThrownBy(() -> service.override(teacher, "a1", "att-1", body(1.0)))
                .isInstanceOfSatisfying(VacademyException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(e.getMessage()).contains("AI is still checking");
                });
    }
}
