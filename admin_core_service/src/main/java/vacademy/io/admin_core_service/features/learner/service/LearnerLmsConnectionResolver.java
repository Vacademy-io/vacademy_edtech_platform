package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.course_settings.service.PackageSettingService;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Answers "which WordPress LMS, if any, is this learner's coursework actually on?".
 *
 * <p>Discovery mirrors what the enrolment workflow reads: each enrolled package's
 * {@code LMS_SETTING} (double-data envelope), falling back to the institute-level
 * setting only when no course-level config exists. Only WordPress-shaped
 * connections (apiUrl + apiKey + apiSecret) count - Moodle has no crm/v1 plugin
 * and no auto-login URL to hand a learner.
 *
 * <p>Extracted from {@link LearnerLmsUserSyncService}, which had this private, so the
 * post-password-change hand-off resolves the same connections by the same rules the
 * password sync pushes to. The two drifting apart would mean sending a learner to a
 * site their new password was never mirrored to.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerLmsConnectionResolver {

    private static final String LMS_SETTING_KEY = "LMS_SETTING";
    private static final List<String> ACTIVE_STATUSES = List.of("ACTIVE");

    private final StudentSessionRepository studentSessionRepository;
    private final PackageSettingService packageSettingService;
    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;

    /**
     * One entry per active enrolment whose package carries a WordPress LMS connection,
     * in enrolment order. Carries the package session because that is the unit a learner
     * is enrolled in, and the package because LMS_SETTING hangs off the package.
     */
    public record LmsAttachedCourse(String packageSessionId, String packageId, String instituteId,
                                    JsonNode connection) {
    }

    /**
     * Distinct WordPress connections across the learner's active courses, deduped by
     * (normalized apiUrl, apiKey) so one site is called once.
     */
    public Map<String, JsonNode> resolveWordpressConnections(String userId) {
        List<StudentSessionInstituteGroupMapping> mappings = activeMappings(userId);
        if (mappings.isEmpty()) {
            return Map.of();
        }

        Set<String> packageIds = new LinkedHashSet<>();
        Set<String> instituteIds = new LinkedHashSet<>();
        for (StudentSessionInstituteGroupMapping m : mappings) {
            String packageId = packageIdOf(m);
            if (StringUtils.hasText(packageId)) {
                packageIds.add(packageId);
            }
            String instituteId = instituteIdOf(m);
            if (StringUtils.hasText(instituteId)) {
                instituteIds.add(instituteId);
            }
        }

        Map<String, JsonNode> connections = new LinkedHashMap<>();
        for (String packageId : packageIds) {
            collectWordpressConnections(readPackageLmsSetting(packageId), connections);
        }
        if (connections.isEmpty()) {
            for (String instituteId : instituteIds) {
                collectWordpressConnections(readInstituteLmsSetting(instituteId), connections);
            }
        }
        return connections;
    }

    /**
     * The learner's LMS-attached enrolments, package-level config first.
     *
     * <p>The institute-level fallback only applies when NO enrolled package has its own
     * connection - same precedence as {@link #resolveWordpressConnections}. When it does
     * apply, every active enrolment is attributed to it, because that is what an
     * institute-wide connection means: all of this institute's coursework lives there.
     */
    public List<LmsAttachedCourse> resolveLmsAttachedCourses(String userId) {
        List<StudentSessionInstituteGroupMapping> mappings = activeMappings(userId);
        if (mappings.isEmpty()) {
            return List.of();
        }

        List<LmsAttachedCourse> courses = new ArrayList<>();
        Map<String, JsonNode> perPackage = new LinkedHashMap<>();
        for (StudentSessionInstituteGroupMapping m : mappings) {
            String packageId = packageIdOf(m);
            if (!StringUtils.hasText(packageId)) {
                continue;
            }
            JsonNode conn = perPackage.computeIfAbsent(packageId,
                    id -> firstWordpressConnection(readPackageLmsSetting(id)));
            if (conn != null) {
                courses.add(new LmsAttachedCourse(packageSessionIdOf(m), packageId, instituteIdOf(m), conn));
            }
        }
        if (!courses.isEmpty()) {
            return courses;
        }

        Map<String, JsonNode> perInstitute = new LinkedHashMap<>();
        for (StudentSessionInstituteGroupMapping m : mappings) {
            String instituteId = instituteIdOf(m);
            if (!StringUtils.hasText(instituteId)) {
                continue;
            }
            JsonNode conn = perInstitute.computeIfAbsent(instituteId,
                    id -> firstWordpressConnection(readInstituteLmsSetting(id)));
            if (conn != null) {
                courses.add(new LmsAttachedCourse(packageSessionIdOf(m), packageIdOf(m), instituteId, conn));
            }
        }
        return courses;
    }

    /**
     * The LMS site a learner should sign in to, for links in their credential emails.
     *
     * <p>Same precedence as the password sync (package-level connection before the
     * institute's), but a single answer: the most recently created active enrolment that
     * has a connection wins, so a learner on two sites is sent to the one they joined
     * last. {@code instituteId}, when given, limits the search to that institute's
     * enrolments and is also tried as the institute-level fallback even when the learner
     * has no active enrolment there. Null when nothing resolves - the caller falls back
     * to the learner portal.
     */
    public String resolveLoginSiteUrl(String userId, String instituteId) {
        List<StudentSessionInstituteGroupMapping> mappings = new ArrayList<>(activeMappings(userId));
        if (StringUtils.hasText(instituteId)) {
            mappings.removeIf(m -> !instituteId.equals(instituteIdOf(m)));
        }
        mappings.sort(Comparator.comparing(StudentSessionInstituteGroupMapping::getCreatedAt,
                Comparator.nullsLast(Comparator.reverseOrder())));

        Map<String, String> perPackage = new LinkedHashMap<>();
        for (StudentSessionInstituteGroupMapping m : mappings) {
            String packageId = packageIdOf(m);
            if (!StringUtils.hasText(packageId)) {
                continue;
            }
            String site = perPackage.computeIfAbsent(packageId,
                    id -> Objects.toString(siteRootOf(firstWordpressConnection(readPackageLmsSetting(id))), ""));
            if (!site.isEmpty()) {
                return site;
            }
        }

        Set<String> instituteIds = new LinkedHashSet<>();
        for (StudentSessionInstituteGroupMapping m : mappings) {
            String id = instituteIdOf(m);
            if (StringUtils.hasText(id)) {
                instituteIds.add(id);
            }
        }
        if (StringUtils.hasText(instituteId)) {
            instituteIds.add(instituteId);
        }
        for (String id : instituteIds) {
            String site = siteRootOf(firstWordpressConnection(readInstituteLmsSetting(id)));
            if (site != null) {
                return site;
            }
        }
        return null;
    }

    /**
     * The site root a learner can actually be sent to, derived from the stored REST
     * endpoint: apiUrl is usually {@code <site>/wp-json/wp/v2}, so cut everything from
     * {@code /wp-json} onwards. Returns null when the value is not an http(s) URL - a
     * malformed setting must never become a redirect target.
     */
    public String siteRootOf(JsonNode connection) {
        if (connection == null) {
            return null;
        }
        String url = connection.path("apiUrl").asText("").trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return null;
        }
        int wpJson = url.indexOf("/wp-json");
        if (wpJson >= 0) {
            url = url.substring(0, wpJson);
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return StringUtils.hasText(url) ? url : null;
    }

    private List<StudentSessionInstituteGroupMapping> activeMappings(String userId) {
        if (!StringUtils.hasText(userId)) {
            return List.of();
        }
        return studentSessionRepository.findAllByUserIdAndStatusIn(userId, ACTIVE_STATUSES);
    }

    private String packageIdOf(StudentSessionInstituteGroupMapping m) {
        if (m.getPackageSession() == null || m.getPackageSession().getPackageEntity() == null) {
            return null;
        }
        return m.getPackageSession().getPackageEntity().getId();
    }

    private String packageSessionIdOf(StudentSessionInstituteGroupMapping m) {
        return m.getPackageSession() == null ? null : m.getPackageSession().getId();
    }

    private String instituteIdOf(StudentSessionInstituteGroupMapping m) {
        return m.getInstitute() == null ? null : m.getInstitute().getId();
    }

    /** Adds every WordPress-shaped connection in a setting node (top-level fields or connections[]). */
    private void collectWordpressConnections(JsonNode inner, Map<String, JsonNode> out) {
        if (inner == null || !inner.isObject()) {
            return;
        }
        if (isWordpressConnection(inner)) {
            out.putIfAbsent(connectionKey(inner), inner);
        }
        JsonNode list = inner.path("connections");
        if (list.isArray()) {
            for (JsonNode conn : list) {
                if (isWordpressConnection(conn)) {
                    out.putIfAbsent(connectionKey(conn), conn);
                }
            }
        }
    }

    private JsonNode firstWordpressConnection(JsonNode inner) {
        Map<String, JsonNode> found = new LinkedHashMap<>();
        collectWordpressConnections(inner, found);
        return found.values().stream().findFirst().orElse(null);
    }

    private boolean isWordpressConnection(JsonNode node) {
        return StringUtils.hasText(node.path("apiUrl").asText(""))
                && StringUtils.hasText(node.path("apiKey").asText(""))
                && StringUtils.hasText(node.path("apiSecret").asText(""));
    }

    private String connectionKey(JsonNode node) {
        String url = node.path("apiUrl").asText("").trim().toLowerCase();
        if (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url + "|" + node.path("apiKey").asText("").trim().toLowerCase();
    }

    /** Unwraps the package's LMS_SETTING double-data envelope to its inner config node. */
    private JsonNode readPackageLmsSetting(String packageId) {
        try {
            return unwrap(packageSettingService.getSettingData(packageId, LMS_SETTING_KEY));
        } catch (Exception e) {
            return null;
        }
    }

    private JsonNode readInstituteLmsSetting(String instituteId) {
        try {
            return unwrap(instituteSettingService.getSettingByInstituteIdAndKey(instituteId, LMS_SETTING_KEY));
        } catch (Exception e) {
            return null;
        }
    }

    private JsonNode unwrap(Object data) {
        if (data == null) {
            return null;
        }
        JsonNode node = objectMapper.convertValue(data, JsonNode.class);
        JsonNode inner = node.path("data");
        if (inner.isObject()) {
            return inner;
        }
        return node.isObject() ? node : null;
    }
}
