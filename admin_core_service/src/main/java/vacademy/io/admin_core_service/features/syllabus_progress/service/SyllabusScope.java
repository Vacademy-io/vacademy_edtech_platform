package vacademy.io.admin_core_service.features.syllabus_progress.service;

import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Which batches a staff member may see and mark on the syllabus progress screens.
 *
 * <p>An institute ADMIN (or a platform super admin on the allowlist) sees every batch. Any other
 * staff member (a TEACHER) sees only the batches they are assigned to teach
 * (faculty_subject_package_session_mapping, via EngagementTeacherScope.cohortsOf). The root flag
 * grants nothing here: learners and staff alike carry it. The teacher's batch list is loaded only
 * when needed.
 */
public record SyllabusScope(boolean all, Set<String> batches) {

    public static final String ALL = "ALL";
    public static final String ASSIGNED = "ASSIGNED";

    /**
     * Refuses anyone who is not staff of {@code instituteId} (no root bypass), then decides the
     * scope: ADMIN authority or platform super admin → every batch, else the assigned batches.
     */
    public static SyllabusScope resolve(InstituteAccessValidator validator, CustomUserDetails user, String instituteId,
                                        Supplier<Set<String>> assignedBatches) {
        validator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        return of(validator.isInstituteAdminOrSuperAdmin(user), assignedBatches);
    }

    public static SyllabusScope of(boolean admin, Supplier<Set<String>> assignedBatches) {
        if (admin) return new SyllabusScope(true, Set.of());
        Set<String> assigned = assignedBatches.get();
        return new SyllabusScope(false, assigned == null ? Set.of() : Set.copyOf(assigned));
    }

    public boolean allows(String packageSessionId) {
        return all || (packageSessionId != null && batches.contains(packageSessionId));
    }

    /** "ALL" or "ASSIGNED", so the screen can tell a teacher with no batches apart from an empty institute. */
    public String name() {
        return all ? ALL : ASSIGNED;
    }

    /** Rows whose package_session_id is in scope. */
    public List<Map<String, Object>> filter(List<Map<String, Object>> rows) {
        if (all) return rows;
        return rows.stream().filter(r -> allows((String) r.get("package_session_id"))).toList();
    }
}
