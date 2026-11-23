package vacademy.io.admin_core_service.features.engagement.planning;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Which batches a staff member teaches, from faculty_subject_package_session_mapping.
 *
 * <p>Used for the "My batches" filter on the plan list and to address the weekly
 * planning email. Sub-org rows (suborg_id set) are team/learner links, not teaching
 * assignments, so they are left out, matching findRealTeachersByPackageSessionId.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementTeacherScope {

    private final JdbcTemplate jdbcTemplate;

    private static final String COHORTS_SQL = """
            SELECT DISTINCT f.package_session_id
            FROM faculty_subject_package_session_mapping f
            JOIN package_session ps ON ps.id = f.package_session_id
            JOIN package_institute pi ON pi.package_id = ps.package_id
            WHERE f.user_id = ?
              AND f.status <> 'DELETED'
              AND f.suborg_id IS NULL
              AND pi.institute_id = ?
            """;

    /** Batches (package_session ids) this user teaches at this institute. Empty on failure. */
    public Set<String> cohortsOf(String userId, String instituteId) {
        if (userId == null || instituteId == null) return Set.of();
        try {
            List<String> rows = jdbcTemplate.queryForList(COHORTS_SQL, String.class, userId, instituteId);
            return new LinkedHashSet<>(rows);
        } catch (Exception e) {
            log.warn("[engagement] cohort lookup failed for user {} at institute {}", userId, instituteId, e);
            return Set.of();
        }
    }
}
