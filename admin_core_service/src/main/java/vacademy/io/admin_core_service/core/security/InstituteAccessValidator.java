package vacademy.io.admin_core_service.core.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.Set;
import java.util.function.BiConsumer;
import java.util.function.Supplier;

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

    private static final Logger log = LoggerFactory.getLogger(InstituteAccessValidator.class);

    /**
     * security.institute-guards.enforce (env SECURITY_INSTITUTE_GUARDS_ENFORCE), default false.
     * Off: the routes that use {@link #guardStaff}, {@link #guardAdmin}, {@link #guardMember} or
     * {@link #guard} evaluate the "...OrSuperAdmin" check, log
     * {@code INSTITUTE_GUARD_WOULD_REFUSE} when it would refuse, and then apply the previous
     * check unchanged. On: the "...OrSuperAdmin" check decides.
     */
    @Value("${security.institute-guards.enforce:false}")
    private boolean instituteGuardsEnforced;

    public boolean isInstituteGuardsEnforced() {
        return instituteGuardsEnforced;
    }

    /**
     * Staff of the institute or an allowlisted super admin ({@link #requireInstituteStaffOrSuperAdmin});
     * the previous check is {@link #validateUserAccess}.
     */
    public void guardStaff(String route, CustomUserDetails user, String instituteId) {
        guard(route, user, () -> instituteId, this::requireInstituteStaffOrSuperAdmin,
                () -> validateUserAccess(user, instituteId));
    }

    /**
     * ADMIN of the institute or an allowlisted super admin ({@link #requireInstituteAdminOrSuperAdmin});
     * the previous check is {@link #requireAdminAccess}.
     */
    public void guardAdmin(String route, CustomUserDetails user, String instituteId) {
        guard(route, user, () -> instituteId, this::requireInstituteAdminOrSuperAdmin,
                () -> requireAdminAccess(user, instituteId));
    }

    /**
     * Member of the institute or an allowlisted super admin ({@link #requireInstituteMemberOrSuperAdmin});
     * the previous check is {@link #validateUserAccess}.
     */
    public void guardMember(String route, CustomUserDetails user, String instituteId) {
        guard(route, user, () -> instituteId, this::requireInstituteMemberOrSuperAdmin,
                () -> validateUserAccess(user, instituteId));
    }

    /**
     * Runs {@code check} against the institute from {@code instituteId} when enforcement is on.
     * When it is off, {@code check} (and the institute lookup) only decide whether to log
     * {@code INSTITUTE_GUARD_WOULD_REFUSE}; any error from them is swallowed and
     * {@code previousCheck} then runs exactly as before.
     */
    public void guard(String route, CustomUserDetails user, Supplier<String> instituteId,
                      BiConsumer<CustomUserDetails, String> check, Runnable previousCheck) {
        if (instituteGuardsEnforced) {
            check.accept(user, instituteId.get());
            return;
        }
        String institute = null;
        String reason = null;
        try {
            institute = instituteId.get();
            check.accept(user, institute);
        } catch (RuntimeException e) {
            reason = refusalReason(e);
        }
        if (reason == null) {
            previousCheck.run();
            return;
        }
        try {
            previousCheck.run();
        } catch (RuntimeException e) {
            logWouldRefuse(route, user, institute, reason, "refuse");
            throw e;
        }
        logWouldRefuse(route, user, institute, reason, "allow");
    }

    /** Logs a refusal the enforced check would have made; ids only. */
    public void logWouldRefuse(String route, CustomUserDetails user, String instituteId, String reason,
                               String previousOutcome) {
        log.warn("INSTITUTE_GUARD_WOULD_REFUSE route={} user={} institute={} reason={} previous={}",
                route, user != null ? user.getUserId() : null, instituteId, reason, previousOutcome);
    }

    private static String refusalReason(RuntimeException e) {
        String message = e.getMessage() == null ? "" : e.getMessage();
        if (message.contains("authentication required")) return "no_user";
        if (message.contains("Institute ID is required")) return "no_institute";
        if (message.contains("admin role required")) return "not_admin";
        if (message.contains("staff role required")) return "not_staff";
        if (message.contains("does not belong")) return "not_member";
        if (message.contains("not found")) return "not_found";
        return e.getClass().getSimpleName();
    }

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
     * is not consulted here.
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
     * Any member of the institute (learner or staff), with NO root-user bypass: a non-empty
     * authorities list and the clientId header equal to {@code instituteId}. For learner-facing
     * endpoints that act on the caller's own data in that institute (the learner home).
     */
    public void requireInstituteMember(CustomUserDetails user, String instituteId) {
        requireMemberWithoutRootBypass(user, instituteId);
    }

    /**
     * {@link #requireInstituteAdmin}, or a platform super admin on the SUPER_ADMIN_USER_IDS
     * allowlist (see {@link #isPlatformSuperAdmin}) so Vacademy operations keep access to every
     * institute. The root flag is not consulted.
     */
    public void requireInstituteAdminOrSuperAdmin(CustomUserDetails user, String instituteId) {
        requireInstituteId(instituteId);
        if (isPlatformSuperAdmin(user)) {
            return;
        }
        requireInstituteAdmin(user, instituteId);
    }

    /** {@link #requireInstituteStaff}, or a platform super admin on the allowlist. */
    public void requireInstituteStaffOrSuperAdmin(CustomUserDetails user, String instituteId) {
        requireInstituteId(instituteId);
        if (isPlatformSuperAdmin(user)) {
            return;
        }
        requireInstituteStaff(user, instituteId);
    }

    /** {@link #requireInstituteMember}, or a platform super admin on the allowlist. */
    public void requireInstituteMemberOrSuperAdmin(CustomUserDetails user, String instituteId) {
        requireInstituteId(instituteId);
        if (isPlatformSuperAdmin(user)) {
            return;
        }
        requireInstituteMember(user, instituteId);
    }

    /**
     * True when the caller's auth user id is on the SUPER_ADMIN_USER_IDS allowlist and, when the
     * token carried a signed user claim, that claim names the same id (the full
     * {@link SuperAdminAuthUtil#requireSuperAdmin} test). False when the list is unset. This is
     * an explicit allowlist, never the root flag.
     */
    public boolean isPlatformSuperAdmin(CustomUserDetails user) {
        if (user == null || !SuperAdminAuthUtil.isSuperAdminUserId(user.getUserId())) {
            return false;
        }
        try {
            SuperAdminAuthUtil.requireSuperAdmin(user);
            return true;
        } catch (VacademyException e) {
            return false;
        }
    }

    private static void requireInstituteId(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("Institute ID is required");
        }
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
        // Checked first: a shop-only account is never general staff, whatever flags it carries.
        if (isCommerceOnly(user)) {
            throw new ForbiddenException("Access denied: staff role required");
        }
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
        // A principal whose only names are commerce roles is shop staff, not general staff:
        // those roles are checked by CommerceAccessGuard on /commerce/v1 and open nothing else.
        // The seeded commerce roles carry no permission names, so "nothing left" means exactly that.
        authorities.removeAll(COMMERCE_ROLE_NAMES);
        if (!authorities.isEmpty()) {
            return;
        }
        throw new ForbiddenException("Access denied: staff role required");
    }

    /** Same names as CommerceRole.authority() in features/commerce/security. */
    private static final Set<String> COMMERCE_ROLE_NAMES = Set.of("COMMERCE_STORE_MANAGER",
            "COMMERCE_WAREHOUSE_STAFF", "COMMERCE_POS_CASHIER", "COMMERCE_ACCOUNTANT");

    /** For guards that sort authorities into "learner" and "everything else is staff". */
    public static boolean isCommerceRoleName(String authority) {
        return authority != null && COMMERCE_ROLE_NAMES.contains(authority.trim().toUpperCase());
    }

    /** At least one authority, and every one of them a commerce role name. */
    private static boolean isCommerceOnly(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null || user.getAuthorities().isEmpty()) {
            return false;
        }
        boolean any = false;
        for (GrantedAuthority authority : user.getAuthorities()) {
            if (authority == null || authority.getAuthority() == null || authority.getAuthority().isBlank()) {
                continue;
            }
            if (!isCommerceRoleName(authority.getAuthority())) {
                return false;
            }
            any = true;
        }
        return any;
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

    /**
     * Non-throwing ADMIN test with NO root-user bypass: the ADMIN authority (minted for the
     * clientId-header institute), or a platform super admin on the allowlist. For endpoints that
     * show admins more than other staff; call it after {@link #requireInstituteStaffOrSuperAdmin}
     * so membership of the institute is already proven. The root flag is not consulted (learners
     * and staff alike carry it).
     */
    public boolean isInstituteAdminOrSuperAdmin(CustomUserDetails user) {
        if (user == null) return false;
        return hasAdminAuthority(user) || isPlatformSuperAdmin(user);
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
