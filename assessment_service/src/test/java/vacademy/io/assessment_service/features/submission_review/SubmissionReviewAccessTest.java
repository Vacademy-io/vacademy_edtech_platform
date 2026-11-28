package vacademy.io.assessment_service.features.submission_review;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewAccess;
import vacademy.io.common.exceptions.ForbiddenException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.user;

/** Contract 8 permissions. */
class SubmissionReviewAccessTest {

    private final SubmissionReviewAccess access = new SubmissionReviewAccess();

    private StudentAttempt attempt(String evaluators) {
        StudentAttempt a = ReviewFixtures.attempt("att-1", ReviewFixtures.assessment("A", "AUTO", false), "ENDED");
        a.setCommaSeparatedEvaluatorUserIds(evaluators);
        return a;
    }

    @Test
    void evaluator_works_only_on_assigned_or_unassigned_attempts() {
        var ev = user("ev-1", "EVALUATOR");
        assertThatCode(() -> access.requireRead(ev, attempt(null))).doesNotThrowAnyException();
        assertThatCode(() -> access.requireRead(ev, attempt("x, ev-1"))).doesNotThrowAnyException();
        assertThatThrownBy(() -> access.requireRead(ev, attempt("other"))).isInstanceOf(ForbiddenException.class);
        assertThatCode(() -> access.requireEdit(ev, attempt("ev-1"), false)).doesNotThrowAnyException();
    }

    @Test
    void evaluator_cannot_edit_after_release_or_release() {
        var ev = user("ev-1", "EVALUATOR");
        assertThatThrownBy(() -> access.requireEdit(ev, attempt(null), true))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("EDIT_AFTER_RELEASE_NOT_ALLOWED");
                    assertThat(e.getStatus().value()).isEqualTo(403);
                });
        assertThatThrownBy(() -> access.requireRelease(ev)).isInstanceOf(ForbiddenException.class);
        assertThat(access.permissions(ev, attempt(null), true).canEdit()).isFalse();
        assertThat(access.permissions(ev, attempt(null), false).canEdit()).isTrue();
    }

    @Test
    void teacher_edits_after_release_but_only_admin_forces_the_answer_key() {
        var teacher = user("t-1", "TEACHER");
        assertThatCode(() -> access.requireEdit(teacher, attempt("someone"), true)).doesNotThrowAnyException();
        assertThatCode(() -> access.requireRelease(teacher)).doesNotThrowAnyException();
        assertThatThrownBy(() -> access.requireForce(teacher)).isInstanceOf(ForbiddenException.class);
        assertThatCode(() -> access.requireForce(user("a-1", "ADMIN"))).doesNotThrowAnyException();
        var p = access.permissions(user("a-1", "ADMIN"), attempt(null), true);
        assertThat(p.canEdit()).isTrue();
        assertThat(p.canForceAnswerKey()).isTrue();
    }

    /**
     * Pre-ship review R2: every staff role keeps the rights it had before 1a - edit after
     * release, release - like a teacher. Only force-re-marking stays ADMIN only.
     */
    @Test
    void every_other_staff_role_has_teacher_rights() {
        for (var staff : java.util.List.of(user("m-1", "MENTOR"), user("c-1", "ASSESSMENT CREATOR"),
                user("cc-1", "CONTENT CREATOR"), user("x-1", "EXAM COORDINATOR"),
                // an evaluator who also holds another staff role is not "evaluator only"
                user("e-1", "EVALUATOR", "ASSESSMENT CREATOR"), user("e-2", "EVALUATOR", "TEACHER"))) {
            assertThatCode(() -> access.requireRead(staff, attempt("someone"))).doesNotThrowAnyException();
            assertThatCode(() -> access.requireEdit(staff, attempt("someone"), true)).doesNotThrowAnyException();
            assertThatCode(() -> access.requireRelease(staff)).doesNotThrowAnyException();
            assertThatThrownBy(() -> access.requireForce(staff)).isInstanceOf(ForbiddenException.class);
            var p = access.permissions(staff, attempt("someone"), true);
            assertThat(p.canEdit()).isTrue();
            assertThat(p.canEditAfterRelease()).isTrue();
            assertThat(p.canRelease()).isTrue();
            assertThat(p.canForceAnswerKey()).isFalse();
        }
    }

    /** An evaluator who is also a learner (or a shop cashier) is still evaluator only. */
    @Test
    void evaluator_with_only_learner_or_commerce_roles_keeps_the_evaluator_rules() {
        for (var ev : java.util.List.of(user("ev-1", "EVALUATOR", "STUDENT"),
                user("ev-1", "EVALUATOR", "COMMERCE_POS_CASHIER"))) {
            assertThatThrownBy(() -> access.requireRelease(ev)).isInstanceOf(ForbiddenException.class);
            assertThatThrownBy(() -> access.requireRead(ev, attempt("other"))).isInstanceOf(ForbiddenException.class);
            assertThat(access.permissions(ev, attempt(null), true).canEdit()).isFalse();
        }
    }

    /** Non-staff never get rights here (they also fail requireStaffRole before this). */
    @Test
    void learner_and_commerce_only_have_no_rights() {
        for (var u : java.util.List.of(user("l-1", "STUDENT"), user("l-2", "STUDENT", "TEACHER"),
                user("s-1", "COMMERCE_STORE_MANAGER"))) {
            assertThatThrownBy(() -> access.requireEdit(u, attempt(null), false)).isInstanceOf(ForbiddenException.class);
            assertThatThrownBy(() -> access.requireRelease(u)).isInstanceOf(ForbiddenException.class);
            assertThat(access.permissions(u, attempt(null), false).canEdit()).isFalse();
        }
    }
}
