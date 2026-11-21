package vacademy.io.assessment_service.features.submission_review.service;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Who may read, edit and release a submission (contract 8, widened by the pre-ship review
 * R2). Authorities are already scoped to the clientId institute by the JWT filter; learners
 * fail requireStaffRole before this.
 * <ul>
 *   <li>Staff (anyone who passes requireStaffRole: ADMIN, TEACHER, ASSESSMENT CREATOR,
 *   CONTENT CREATOR, custom roles...): everything a teacher can do - edit, release, hide,
 *   send updates - as they could before 1a. Force-re-marking with the answer key stays
 *   ADMIN only;</li>
 *   <li>EVALUATOR as the only staff role: attempts assigned to them (or unassigned), edits
 *   before release only, no release.</li>
 * </ul>
 */
@Component
public class SubmissionReviewAccess {

    public record Permissions(boolean canEdit, boolean canEditAfterRelease, boolean canRelease,
                              boolean canForceAnswerKey) {
    }

    public static Set<String> roles(CustomUserDetails user) {
        Set<String> out = new HashSet<>();
        if (user == null || user.getAuthorities() == null) return out;
        for (GrantedAuthority a : user.getAuthorities()) {
            if (a != null && a.getAuthority() != null) out.add(a.getAuthority().trim().toUpperCase(Locale.ROOT));
        }
        return out;
    }

    /** Teacher rights: any staff member whose role is not EVALUATOR alone. */
    static boolean fullStaff(Set<String> roles) {
        return EvaluationAccessValidator.isStaff(roles) && !evaluatorOnly(roles);
    }

    static boolean evaluatorOnly(Set<String> roles) {
        return EvaluationAccessValidator.evaluatorOnly(roles);
    }

    /** An evaluator works on the attempts assigned to them; an unassigned attempt is open to all. */
    static boolean assigned(CustomUserDetails user, String evaluatorIds) {
        if (evaluatorIds == null || evaluatorIds.isBlank()) return true;
        String me = user.getUserId();
        return me != null && Arrays.stream(evaluatorIds.split(",")).map(String::trim).anyMatch(me::equals);
    }

    public void requireRead(CustomUserDetails user, StudentAttempt attempt) {
        Set<String> roles = roles(user);
        if (evaluatorOnly(roles) && !assigned(user, attempt.getCommaSeparatedEvaluatorUserIds())) {
            throw new ForbiddenException("This submission is assigned to another evaluator");
        }
    }

    public Permissions permissions(CustomUserDetails user, StudentAttempt attempt, boolean released) {
        Set<String> roles = roles(user);
        boolean full = fullStaff(roles);
        boolean evaluator = evaluatorOnly(roles) && assigned(user, attempt.getCommaSeparatedEvaluatorUserIds());
        boolean canEdit = full || (evaluator && !released);
        return new Permissions(canEdit, full, full, roles.contains("ADMIN"));
    }

    /** A3, A3b, A3p, A4, A6. */
    public void requireEdit(CustomUserDetails user, StudentAttempt attempt, boolean released) {
        Set<String> roles = roles(user);
        if (fullStaff(roles)) return;
        if (evaluatorOnly(roles)) {
            if (!assigned(user, attempt.getCommaSeparatedEvaluatorUserIds())) {
                throw new ForbiddenException("This submission is assigned to another evaluator");
            }
            if (released) {
                throw new SubmissionReviewException(HttpStatus.FORBIDDEN, "EDIT_AFTER_RELEASE_NOT_ALLOWED",
                        "An evaluator cannot change marks after the result is released");
            }
            return;
        }
        throw new ForbiddenException("Only institute staff can change marks");
    }

    /** A8, A9, A9b. */
    public void requireRelease(CustomUserDetails user) {
        if (!fullStaff(roles(user))) {
            throw new ForbiddenException("An evaluator cannot release or hide a result");
        }
    }

    /** A6 with force. */
    public void requireForce(CustomUserDetails user) {
        if (!roles(user).contains("ADMIN")) {
            throw new ForbiddenException("Only an admin can replace a teacher's mark with the answer key");
        }
    }

    /** Manual submit (the PDF tool): staff, and an evaluator only on their own attempts. */
    public void requireManualSubmit(CustomUserDetails user, StudentAttempt attempt) {
        Set<String> roles = roles(user);
        if (evaluatorOnly(roles) && !assigned(user, attempt.getCommaSeparatedEvaluatorUserIds())) {
            throw new ForbiddenException("This submission is assigned to another evaluator");
        }
    }
}
