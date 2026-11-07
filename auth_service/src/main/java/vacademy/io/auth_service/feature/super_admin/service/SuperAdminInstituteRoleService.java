package vacademy.io.auth_service.feature.super_admin.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.auth_service.feature.super_admin.dto.InstituteRoleDTO;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.repository.RoleRepository;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The staff roles of one institute for the super-admin portal (spec §12.3): built-in platform
 * roles (roles.institute_id IS NULL) plus the institute's custom roles (institute_id = id), with
 * the number of ACTIVE user_role rows each has in that institute. Learner-side roles and the
 * unused 2024 legacy rows are left out.
 */
@Service
public class SuperAdminInstituteRoleService {

    public static final String KIND_ADMIN = "ADMIN";
    public static final String KIND_TEACHER = "TEACHER";
    public static final String KIND_SYSTEM = "SYSTEM";
    public static final String KIND_CUSTOM = "CUSTOM";

    /** Learner-side role names (compared upper-cased). */
    static final Set<String> EXCLUDED_ROLE_NAMES = Set.of("STUDENT", "LEARNER", "PARENT", "GUARDIAN");
    /** Same legacy rows CustomRoleService hides from the role pickers (exact case). */
    static final Set<String> LEGACY_ROLE_NAMES = Set.of("Admin", "User", "Moderator", "Guest");

    private final RoleRepository roleRepository;

    @PersistenceContext
    private EntityManager entityManager;

    public SuperAdminInstituteRoleService(RoleRepository roleRepository) {
        this.roleRepository = roleRepository;
    }

    @Transactional(readOnly = true)
    public List<InstituteRoleDTO> getInstituteRoles(String instituteId) {
        Map<String, Long> counts = activeUserCountsByRole(instituteId);
        List<InstituteRoleDTO> out = new ArrayList<>();
        for (Role role : roleRepository.findAllByInstituteIdIsNull()) {
            if (role.getName() == null || LEGACY_ROLE_NAMES.contains(role.getName())
                    || EXCLUDED_ROLE_NAMES.contains(role.getName().trim().toUpperCase(Locale.ROOT))) {
                continue;
            }
            out.add(toDto(role, builtInKind(role.getName()), counts));
        }
        for (Role role : roleRepository.findAllByInstituteId(instituteId)) {
            if (role.getName() == null
                    || EXCLUDED_ROLE_NAMES.contains(role.getName().trim().toUpperCase(Locale.ROOT))) {
                continue;
            }
            out.add(toDto(role, KIND_CUSTOM, counts));
        }
        out.sort(Comparator.comparingInt((InstituteRoleDTO r) -> kindOrder(r.getKind()))
                .thenComparing(r -> r.getRoleName().toUpperCase(Locale.ROOT)));
        return out;
    }

    static String builtInKind(String roleName) {
        String upper = roleName.trim().toUpperCase(Locale.ROOT);
        if (upper.equals(KIND_ADMIN)) {
            return KIND_ADMIN;
        }
        if (upper.equals(KIND_TEACHER)) {
            return KIND_TEACHER;
        }
        // SYSTEM = the built-ins the admin app does NOT let an admin configure (they resolve to
        // the Teacher display settings; RoleDisplaySettingsMain SYSTEM_ROLE_NAMES). Every other
        // platform role (COUNSELLOR, MENTOR, HR_*, FRONT_DESK_EMPLOYEE...) is offered in the
        // admin app's custom-role list, keyed by its role id, so it is CUSTOM here too.
        return TEACHER_SETTINGS_ROLE_NAMES.contains(upper) ? KIND_SYSTEM : KIND_CUSTOM;
    }

    static final Set<String> TEACHER_SETTINGS_ROLE_NAMES =
            Set.of("EVALUATOR", "CONTENT CREATOR", "ASSESSMENT CREATOR");

    private static int kindOrder(String kind) {
        return switch (kind) {
            case KIND_ADMIN -> 0;
            case KIND_TEACHER -> 1;
            case KIND_SYSTEM -> 2;
            default -> 3;
        };
    }

    private static InstituteRoleDTO toDto(Role role, String kind, Map<String, Long> counts) {
        return InstituteRoleDTO.builder()
                .roleId(role.getId())
                .roleName(role.getName())
                .kind(kind)
                .userCount(counts.getOrDefault(role.getId(), 0L))
                .build();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Long> activeUserCountsByRole(String instituteId) {
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT ur.role_id, COUNT(DISTINCT ur.user_id)
                        FROM user_role ur
                        WHERE ur.institute_id = :instituteId
                          AND ur.status = 'ACTIVE'
                          AND ur.role_id IS NOT NULL
                        GROUP BY ur.role_id
                        """)
                .setParameter("instituteId", instituteId)
                .getResultList();
        Map<String, Long> out = new HashMap<>();
        for (Object[] row : rows) {
            out.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
        }
        return out;
    }
}
