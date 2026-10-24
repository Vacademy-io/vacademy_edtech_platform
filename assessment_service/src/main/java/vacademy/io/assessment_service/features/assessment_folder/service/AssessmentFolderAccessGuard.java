package vacademy.io.assessment_service.features.assessment_folder.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.HashSet;
import java.util.Set;

/**
 * Who may use the assessment folder API. The JWT filter scopes a caller's authorities to the
 * institute in the {@code clientId} header, so: the {@code instituteId} parameter must equal
 * clientId (else an admin of A could act on B with A's roles), and a non-empty authority set
 * proves membership. Managing folders additionally needs a staff role, using the same rule as
 * {@code EvaluationAccessValidator.requireStaffRole}: a learner role (STUDENT/PARENT/GUARDIAN)
 * without ADMIN or EVALUATOR is refused; any other non-empty set is staff.
 */
@Slf4j
@Component
public class AssessmentFolderAccessGuard {

    private static final Set<String> LEARNER_ROLE_NAMES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    /** Any member of the institute (learners included): reading the learner folder list. */
    public void requireMember(CustomUserDetails user, String clientId, String instituteId) {
        Set<String> authorities = authoritiesOf(user);
        requireActiveInstitute(clientId, instituteId);
        if (authorities.isEmpty()) {
            throw new ForbiddenException("You do not have a role in this institute");
        }
    }

    /** Institute staff only: listing for admins, creating, editing, deleting and moving. */
    public void requireStaff(CustomUserDetails user, String clientId, String instituteId) {
        Set<String> authorities = authoritiesOf(user);
        requireActiveInstitute(clientId, instituteId);
        boolean learner = authorities.stream().anyMatch(LEARNER_ROLE_NAMES::contains);
        if (authorities.isEmpty()
                || (learner && !authorities.contains("ADMIN") && !authorities.contains("EVALUATOR"))) {
            log.warn("Blocked non-staff assessment folder call: user={}", user == null ? null : user.getUserId());
            throw new ForbiddenException("Only institute staff can manage assessment folders");
        }
    }

    private static void requireActiveInstitute(String clientId, String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new ForbiddenException("Institute context is required");
        }
        if (!instituteId.equals(clientId)) {
            log.warn("Blocked assessment folder call for another institute: clientId={}, instituteId={}",
                    clientId, instituteId);
            throw new ForbiddenException("This institute is not your active institute");
        }
    }

    private static Set<String> authoritiesOf(CustomUserDetails user) {
        if (user == null || user.getUserId() == null) {
            throw new ForbiddenException("Authentication is required");
        }
        Set<String> authorities = new HashSet<>();
        if (user.getAuthorities() != null) {
            for (GrantedAuthority authority : user.getAuthorities()) {
                if (authority != null && authority.getAuthority() != null) {
                    authorities.add(authority.getAuthority().trim().toUpperCase());
                }
            }
        }
        return authorities;
    }
}
