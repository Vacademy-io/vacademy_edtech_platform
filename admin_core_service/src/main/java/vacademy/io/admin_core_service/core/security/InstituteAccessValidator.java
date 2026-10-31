package vacademy.io.admin_core_service.core.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.Set;

/**
 * Shared utility to validate that an authenticated user belongs to
 * the institute they are trying to access. Prevents cross-tenant data access.
 *
 * Usage in controllers:
 * <pre>
 *   &#64;Autowired
 *   private InstituteAccessValidator instituteAccessValidator;
 *
 *   // In any endpoint method:
 *   instituteAccessValidator.validateUserAccess(user, instituteId);
 * </pre>
 */
@Component
public class InstituteAccessValidator {

    /**
     * Validates that the given user has an active or invited role in the specified institute.
     * The User entity's roles set is filtered by {@code @Where(clause = "status IN ('ACTIVE', 'INVITED')")}
     * at the JPA level, so only valid roles are checked.
     *
     * @param user        The authenticated user (from @RequestAttribute)
     * @param instituteId The institute ID being accessed
     * @throws VacademyException if the user does not belong to the institute
     */
    public void validateUserAccess(CustomUserDetails user, String instituteId) {
        if (user == null) {
            throw new VacademyException("User authentication required");
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("Institute ID is required");
        }

        // Root users (platform superadmins) can act on behalf of any institute.
        // This mirrors SuperAdminAuthUtil.requireSuperAdmin and is the same
        // bypass used by SuperAdminCreditController for the credit-grant flow.
        // They may call without a clientId header, which leaves authorities
        // empty, so they must be exempted from the membership checks below.
        if (user.isRootUser()) {
            return;
        }

        Set<UserRole> roles = user.getRoles();
        if (roles != null && !roles.isEmpty()) {
            boolean hasAccess = roles.stream()
                    .anyMatch(role -> instituteId.equals(role.getInstituteId()));
            if (!hasAccess) {
                throw new VacademyException("Access denied: user does not belong to institute " + instituteId);
            }
            return;
        }

        // In this service the principal is rebuilt from auth_service's HTTP
        // payload (UserServiceDTO), which never carries the JPA roles set — so
        // for every non-root caller `roles` is null here. The institute-scoped
        // fact we do have is the authorities list: auth_service mints it by
        // filtering the user's roles to the clientId-header institute, so a
        // non-empty authorities list proves membership in exactly that
        // institute. Spoofing clientId to another institute yields an empty
        // authorities list, and a clientId/instituteId mismatch is rejected
        // below — cross-tenant access stays blocked.
        if (user.getAuthorities() == null || user.getAuthorities().isEmpty()) {
            throw new VacademyException("Access denied: user has no institute associations");
        }

        String clientInstituteId = currentClientIdHeader();
        if (!instituteId.equals(clientInstituteId)) {
            throw new VacademyException("Access denied: user does not belong to institute " + instituteId);
        }
    }

    /**
     * Validates institute membership (see {@link #validateUserAccess}) AND that the caller's
     * role in that institute is specifically ADMIN -- for endpoints that must be restricted to
     * institute admins (e.g. building/managing onboarding flows, completing a step as-admin),
     * not just any institute member (a student or teacher also "belongs" to the institute per
     * {@code validateUserAccess} alone). Root users bypass both checks, same as {@link #validateUserAccess}.
     */
    public void requireAdminAccess(CustomUserDetails user, String instituteId) {
        validateUserAccess(user, instituteId);
        if (!isInstituteAdmin(user)) {
            throw new ForbiddenException("Access denied: institute admin role required");
        }
    }

    /**
     * Institute ADMIN only, with NO root-user bypass -- for endpoints that mint credentials
     * or spend credits on the institute's behalf (e.g. AI-calling API keys). The root flag
     * cannot be trusted here: learners and invited staff are created as root users, so the
     * bypass in {@link #validateUserAccess} would let any learner act on any institute.
     *
     * <p>Membership is the non-root test of {@code validateUserAccess} (a non-empty
     * authorities list with the clientId header equal to {@code instituteId}); on top of
     * that the caller must hold the ADMIN role there (a STUDENT or TEACHER is refused). A
     * real institute admin always passes: the dashboard sends the clientId header and
     * auth_service puts the ADMIN role name into the authorities for that institute.
     */
    public void requireInstituteAdmin(CustomUserDetails user, String instituteId) {
        requireMemberWithoutRootBypass(user, instituteId);
        if (!hasAdminAuthority(user)) {
            throw new ForbiddenException("Access denied: institute admin role required");
        }
    }

    /**
     * Institute STAFF only, with NO root-user bypass -- for endpoints that spend the
     * institute's credits but that any staff member may use, not just admins (placing AI
     * calls from the leads UI, bulk AI campaigns, the AI call queue). Same staff test as
     * {@link #requireStaffAccess}; membership as in {@link #requireInstituteAdmin}.
     */
    public void requireInstituteStaff(CustomUserDetails user, String instituteId) {
        requireMemberWithoutRootBypass(user, instituteId);
        requireStaffAuthorities(user);
    }

    /**
     * The non-root membership test of {@link #validateUserAccess}, without its root bypass.
     * Only the authorities path is used: in this service the principal is rebuilt from
     * auth_service's payload and its JPA roles set is always null, and the authorities are
     * minted for the clientId-header institute only, so they prove membership of exactly that one.
     */
    private void requireMemberWithoutRootBypass(CustomUserDetails user, String instituteId) {
        if (user == null) {
            throw new VacademyException("User authentication required");
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("Institute ID is required");
        }
        if (user.getAuthorities() == null || user.getAuthorities().isEmpty()
                || !instituteId.equals(currentClientIdHeader())) {
            throw new ForbiddenException("Access denied: user does not belong to institute " + instituteId);
        }
    }

    /** Authority names that identify institute staff. */
    private static final Set<String> STAFF_ROLE_NAMES = Set.of("ADMIN", "TEACHER", "EVALUATOR", "MENTOR");

    /** Authority names that identify a learner-side principal. */
    private static final Set<String> LEARNER_ROLE_NAMES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    /**
     * Staff roles that outrank a learner role the same principal also holds. Only roles an
     * admin hands out belong here: TEACHER does not, because self-signup assigns
     * {@code [STUDENT, TEACHER]} to learners. COUNSELLOR is only ever assigned by an admin,
     * and CRM institutes (e.g. ShikshaNation) enrol their counsellors as STUDENT too.
     */
    private static final Set<String> LEARNER_OVERRIDING_ROLE_NAMES = Set.of("ADMIN", "COUNSELLOR");

    /**
     * Validates institute membership (see {@link #validateUserAccess}) AND that the caller is
     * institute STAFF -- for endpoints any staff member may use (award/revoke a learner badge,
     * read a learner's award list) but a learner or parent must not, even though they also
     * "belong" to the institute per {@code validateUserAccess} alone.
     *
     * <p>Why the ordered test instead of "has any authority": in this service the principal's
     * authorities list MIXES role names (ADMIN, TEACHER, STUDENT, ...) with permission names
     * (whatever the institute's role -> authority mapping grants). STUDENT and PARENT roles hold
     * zero permissions in prod today, so "non-empty authorities" happens to mean staff -- but that
     * is one admin click away from changing, and a learner carrying a stray permission name must
     * still be refused. A learner can ALSO carry TEACHER: auth_service's self-signup assigns
     * {@code [STUDENT, TEACHER]} to every learner when the institute enables
     * {@code allowLearnersToCreateCourses}, so "has TEACHER" alone does not prove staff either.
     * So, with A = the caller's authority names uppercased:
     * <ol>
     *   <li>root user -> allow (platform superadmin, same bypass as everywhere else);</li>
     *   <li>membership via {@link #validateUserAccess};</li>
     *   <li>A contains a learner role (STUDENT/PARENT/GUARDIAN) and neither ADMIN nor COUNSELLOR
     *       -> deny, whatever else it holds (an admin or counsellor who is also enrolled as a
     *       learner keeps their access);</li>
     *   <li>A contains a known staff role -> allow;</li>
     *   <li>else A non-empty -> allow (a custom institute role -- these are staff by construction,
     *       learners are always enrolled with the built-in STUDENT role);</li>
     *   <li>else deny (an empty A is already refused by {@code validateUserAccess} for non-root callers).</li>
     * </ol>
     */
    public void requireStaffAccess(CustomUserDetails user, String instituteId) {
        if (user != null && user.isRootUser()) {
            return;
        }
        validateUserAccess(user, instituteId);
        requireStaffAuthorities(user);
    }

    private static void requireStaffAuthorities(CustomUserDetails user) {
        Set<String> authorities = new HashSet<>();
        if (user.getAuthorities() != null) {
            for (GrantedAuthority authority : user.getAuthorities()) {
                if (authority != null && authority.getAuthority() != null) {
                    authorities.add(authority.getAuthority().trim().toUpperCase());
                }
            }
        }
        boolean learner = authorities.stream().anyMatch(LEARNER_ROLE_NAMES::contains);
        if (learner && authorities.stream().noneMatch(LEARNER_OVERRIDING_ROLE_NAMES::contains)) {
            // A learner principal stays a learner even when it also carries TEACHER
            // (self-signup with allowLearnersToCreateCourses) or stray permission names.
            throw new ForbiddenException("Access denied: staff role required");
        }
        if (authorities.stream().anyMatch(STAFF_ROLE_NAMES::contains)) {
            return;
        }
        if (!authorities.isEmpty()) {
            return;
        }
        throw new ForbiddenException("Access denied: staff role required");
    }

    /**
     * Non-throwing form of the ADMIN role test, for endpoints that DEGRADE rather than
     * reject -- e.g. the Call Log serves a health verdict to any viewer but withholds the
     * technical detail (which quotes verbatim caller speech) from non-admins.
     * Assumes membership was already validated by the caller.
     */
    public boolean isInstituteAdmin(CustomUserDetails user) {
        if (user == null) return false;
        if (user.isRootUser()) return true;
        return hasAdminAuthority(user);
    }

    private static boolean hasAdminAuthority(CustomUserDetails user) {
        return user.getAuthorities() != null && user.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority() != null && a.getAuthority().equalsIgnoreCase("ADMIN"));
    }

    private String currentClientIdHeader() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servletAttributes) {
            return servletAttributes.getRequest().getHeader("clientId");
        }
        return null;
    }
}
