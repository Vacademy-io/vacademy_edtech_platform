package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import org.springframework.security.core.GrantedAuthority;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.HashSet;
import java.util.Set;

/**
 * Authorization guard for the AI-evaluation endpoints.
 *
 * <p>These endpoints used to be {@code permitAll} (anyone on the internet could
 * trigger paid grading runs on arbitrary attempt IDs, stop other tenants' runs,
 * and read student PII from progress). They now require a valid JWT, and this
 * validator additionally enforces that the caller is acting within the institute
 * that owns the resource.
 *
 * <p>The JWT filter scopes a principal's authorities to the institute in the
 * {@code clientId} header (see AssessmentJwtAuthFilter): a user only receives
 * roles for that institute, so a non-empty authority set proves genuine
 * membership. We therefore require: the resource's institute equals the caller's
 * active institute ({@code clientId}), and the caller actually holds a role
 * there. This blocks the cross-tenant IDOR without new infrastructure.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EvaluationAccessValidator {

    private final StudentAttemptRepository studentAttemptRepository;
    private final AiEvaluationProcessRepository aiEvaluationProcessRepository;
    private final AssessmentInstituteMappingRepository assessmentInstituteMappingRepository;

    /** Learner-side role names (same set as admin_core InstituteAccessValidator). */
    private static final Set<String> LEARNER_ROLE_NAMES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    /** Load an attempt and assert the caller may act on it, returning the attempt. */
    public StudentAttempt requireAttemptAccess(CustomUserDetails user, String instituteId, String attemptId) {
        StudentAttempt attempt = studentAttemptRepository.findById(attemptId)
                .orElseThrow(() -> new ResourceNotFoundException("Student Attempt not found: " + attemptId));
        assertCallerOwnsAttempt(user, instituteId, attempt);
        return attempt;
    }

    /** Assert the caller may act on the attempt behind an evaluation process. */
    public void requireProcessAccess(CustomUserDetails user, String instituteId, String processId) {
        AiEvaluationProcess process = aiEvaluationProcessRepository.findById(processId)
                .orElseThrow(() -> new ResourceNotFoundException("Evaluation process not found: " + processId));
        assertCallerOwnsAttempt(user, instituteId, process.getStudentAttempt());
    }

    /**
     * Assert the caller is an authenticated member of {@code instituteId}. Used
     * for list endpoints where the resource is scoped by an institute filter in
     * the query itself (so there is no single attempt to bind to).
     */
    public void requireInstituteMembership(CustomUserDetails user, String instituteId) {
        if (user == null || user.getUserId() == null) {
            throw new ForbiddenException("Authentication is required for AI evaluation");
        }
        if (user.getAuthorities() == null || user.getAuthorities().isEmpty()) {
            throw new ForbiddenException("You do not have a role in this institute");
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new ForbiddenException("Institute context is required");
        }
    }

    /**
     * Assert an {@code instituteId} request parameter names the institute the
     * caller authenticated against (the {@code clientId} header). Authorities are
     * scoped to clientId, so without this an admin of institute A could send
     * clientId=A with instituteId=B and pass every role check on B's data with A's
     * roles. The admin dashboard always sends both with the same value.
     */
    public void requireActiveInstitute(String clientId, String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new ForbiddenException("Institute context is required");
        }
        if (!instituteId.equals(clientId)) {
            log.warn("Blocked request for an institute other than the caller's: clientId={}, instituteId={}",
                    clientId, instituteId);
            throw new ForbiddenException("This institute is not your active institute");
        }
    }

    /**
     * Assert the assessment belongs to {@code instituteId} and the caller is a
     * member there. Same check as CopyIntakeController's tenant binding.
     */
    public void requireAssessmentInInstitute(CustomUserDetails user, String instituteId, String assessmentId) {
        requireInstituteMembership(user, instituteId);
        if (assessmentId == null
                || assessmentInstituteMappingRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId).isEmpty()) {
            throw new ForbiddenException("This assessment does not belong to your institute");
        }
    }

    /**
     * Assert the caller is institute staff, for AI-evaluation mutations (trigger,
     * stop, review override, rubric writes, copy intake). Membership alone lets a
     * STUDENT of the institute through. Call after the membership/ownership check;
     * authorities are already scoped to the request's institute.
     *
     * <p>Mirrors admin_core {@code InstituteAccessValidator.requireStaffAccess}, minus
     * its root-user bypass (learners can be root users, and this validator has never
     * honoured it). The authority set mixes role names with permission names, so:
     * a learner role (STUDENT/PARENT/GUARDIAN) without ADMIN or EVALUATOR is refused
     * even when it also carries TEACHER, which self-signup grants learners when
     * {@code allowLearnersToCreateCourses} is on. Any other non-empty set is staff:
     * ADMIN, TEACHER, EVALUATOR, MENTOR, COUNSELLOR, COURSE CREATOR, custom roles.
     */
    public void requireStaffRole(CustomUserDetails user) {
        if (user == null || user.getUserId() == null) {
            throw new ForbiddenException("Authentication is required for AI evaluation");
        }
        Set<String> authorities = new HashSet<>();
        if (user.getAuthorities() != null) {
            for (GrantedAuthority authority : user.getAuthorities()) {
                if (authority != null && authority.getAuthority() != null) {
                    authorities.add(authority.getAuthority().trim().toUpperCase());
                }
            }
        }
        boolean learner = authorities.stream().anyMatch(LEARNER_ROLE_NAMES::contains);
        if (authorities.isEmpty()
                || (learner && !authorities.contains("ADMIN") && !authorities.contains("EVALUATOR"))) {
            log.warn("Blocked non-staff AI-evaluation mutation: user={}", user.getUserId());
            throw new ForbiddenException("Only institute staff can do this");
        }
    }

    private void assertCallerOwnsAttempt(CustomUserDetails user, String instituteId, StudentAttempt attempt) {
        if (user == null || user.getUserId() == null) {
            throw new ForbiddenException("Authentication is required for AI evaluation");
        }
        if (user.getAuthorities() == null || user.getAuthorities().isEmpty()) {
            // Authorities are filtered to the clientId institute by the JWT filter,
            // so an empty set means the caller has no role in the institute they
            // are authenticating against.
            throw new ForbiddenException("You do not have a role in this institute");
        }
        String attemptInstituteId = (attempt != null && attempt.getRegistration() != null)
                ? attempt.getRegistration().getInstituteId()
                : null;
        if (instituteId == null || attemptInstituteId == null || !instituteId.equals(attemptInstituteId)) {
            log.warn("Blocked cross-institute AI-evaluation access: caller institute={}, attempt institute={}",
                    instituteId, attemptInstituteId);
            throw new ForbiddenException("You do not have access to this attempt");
        }
    }
}
