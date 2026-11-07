package vacademy.io.admin_core_service.core.security;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Role + resource-ownership guard for every HR & Payroll endpoint, implementing
 * the access matrix from docs/erp/plan.md section G on top of
 * {@link InstituteAccessValidator} (which only proves institute MEMBERSHIP —
 * a student "belongs" to the institute too, so membership alone must never
 * gate an HR endpoint).
 *
 * Roles are authority strings minted by CustomUserDetails from the caller's
 * user_role rows for the clientId institute: ADMIN (institute admin, superset
 * of all HR access), HR_ADMIN (full HR & payroll), HR_MANAGER (team-scoped HR
 * operations). Seeded in auth_service V17__Seed_hr_roles.sql.
 *
 * Conventions this guard enforces across hr_* services:
 * - Admin/staff endpoints call {@link #requireHrAdmin} / {@link #requireHrStaff}.
 * - Self-service endpoints never trust an employeeId from the request body:
 *   {@link #requireSelfOrHrStaff} resolves the target employee, verifies it
 *   belongs to the validated institute, and only lets non-HR callers act on
 *   their OWN profile (profile.userId == jwt userId).
 * - Every entity loaded by id must be checked against the validated institute
 *   via {@link #requireInstituteMatch} (cross-tenant IDOR fix).
 */
@Component
public class HrAccessGuard {

    public static final String ROLE_ADMIN = "ADMIN";
    public static final String ROLE_HR_ADMIN = "HR_ADMIN";
    public static final String ROLE_HR_MANAGER = "HR_MANAGER";

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    /** Membership only — for endpoints any institute member may hit (rare in HR). */
    public void validateMember(CustomUserDetails user, String instituteId) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
    }

    /** Membership + ADMIN or HR_ADMIN. For payroll processing, salary admin, config. */
    public void requireHrAdmin(CustomUserDetails user, String instituteId) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        if (!isHrAdmin(user)) {
            throw new ForbiddenException("Access denied: HR admin role required");
        }
    }

    /** Membership + ADMIN, HR_ADMIN or HR_MANAGER. For team-scoped HR operations. */
    public void requireHrStaff(CustomUserDetails user, String instituteId) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        if (!isHrStaff(user)) {
            throw new ForbiddenException("Access denied: HR role required");
        }
    }

    public boolean isHrAdmin(CustomUserDetails user) {
        return hasAnyAuthority(user, ROLE_ADMIN, ROLE_HR_ADMIN);
    }

    public boolean isHrStaff(CustomUserDetails user) {
        return hasAnyAuthority(user, ROLE_ADMIN, ROLE_HR_ADMIN, ROLE_HR_MANAGER);
    }

    /**
     * Resource-ownership check: the loaded entity's institute must be the
     * validated one. Throws the same message for "wrong institute" as a plain
     * lookup miss would, so ids are not oracle-able across tenants.
     */
    public void requireInstituteMatch(String entityInstituteId, String validatedInstituteId, String entityName) {
        if (entityInstituteId == null || !entityInstituteId.equals(validatedInstituteId)) {
            throw new VacademyException(entityName + " not found");
        }
    }

    /**
     * Self-service resolution: membership + load the target employee, verify it
     * belongs to the validated institute, and require the caller to either hold
     * an HR role or BE that employee. Returns the employee so services never
     * re-fetch by unchecked id.
     */
    public EmployeeProfile requireSelfOrHrStaff(CustomUserDetails user, String instituteId, String employeeId) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        EmployeeProfile employee = employeeProfileRepository.findById(employeeId)
                .orElseThrow(() -> new VacademyException("Employee not found"));
        requireInstituteMatch(employee.getInstituteId(), instituteId, "Employee");
        if (isHrStaff(user)) {
            return employee;
        }
        if (user.getUserId() == null || !user.getUserId().equals(employee.getUserId())) {
            throw new ForbiddenException("Access denied: you can only act on your own employee record");
        }
        return employee;
    }

    /** The caller's own employee profile in this institute (self-service endpoints). */
    public EmployeeProfile resolveSelfEmployee(CustomUserDetails user, String instituteId) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return employeeProfileRepository.findByUserIdAndInstituteId(user.getUserId(), instituteId)
                .orElseThrow(() -> new VacademyException("No employee profile found for the current user"));
    }

    private boolean hasAnyAuthority(CustomUserDetails user, String... roles) {
        if (user == null) return false;
        if (user.isRootUser()) return true;
        if (user.getAuthorities() == null) return false;
        return user.getAuthorities().stream().anyMatch(a -> {
            String auth = a.getAuthority();
            if (auth == null) return false;
            for (String role : roles) {
                if (auth.equalsIgnoreCase(role)) return true;
            }
            return false;
        });
    }
}
