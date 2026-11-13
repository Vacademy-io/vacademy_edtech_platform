package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Report profiles (V57): pages an institute adds before and after a student's report.
 * An assessment uses its linked profile, else the institute's default, else none.
 *
 * <p>Config shape (JSON, snake_case):
 * <pre>
 * { "before": [page...], "after": [page...],
 *   "assets": { "logo": "data:image/png;base64,..." },         // {{asset.logo}} in templates
 *   "variables": { "scholarship_percent": { "bands": [ {"from":0,"to":40,"value":0},
 *                                                       {"from":40,"to":100,"value":"percentage"} ],
 *                                           "round": "DOWN" } },
 *   "result_date": "17 October 2026",
 *   "qr_url": "https://...",
 *   "report_options": { "question_wise": "SHOW" | "HIDE",          // HIDE drops per-question pages/items
 *                       "show_your_answer": true, "show_correct_answer": true, "show_explanation": true } }
 *                                                                // institute default; an assessment's own
 *                                                                // assessment.report_options wins (see ReportOptions)
 * page = {"type":"TEMPLATE","html":"..."} | {"type":"PDF","file_id":"..."} | {"type":"IMAGE","file_id":"..."|"data_uri":"..."}
 * </pre>
 */
@Slf4j
@Service
public class ReportProfileService {

    public static final String NONE = "NONE";

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ReportProfileService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Profile(String id, String instituteId, String name, JsonNode config, boolean instituteDefault) {
        public JsonNode before() {
            return config.path("before");
        }

        public JsonNode after() {
            return config.path("after");
        }

        /** report_options.question_wise = HIDE: reports leave out every per-question item. */
        public boolean hideQuestionWise() {
            return "HIDE".equalsIgnoreCase(config.path("report_options").path("question_wise").asText(""));
        }

        public boolean hasPages() {
            return (before().isArray() && !before().isEmpty()) || (after().isArray() && !after().isEmpty());
        }
    }

    /** Whether reports for this assessment leave out per-question items. Never throws. */
    public boolean hideQuestionWise(String assessmentId, String instituteId) {
        return !reportOptions(assessmentId, instituteId).showQuestionWise();
    }

    /**
     * What this assessment's reports show per question: the assessment's own
     * report_options (V69), else the applicable profile's report_options, else
     * everything. Never throws - a lookup failure shows everything, as before.
     */
    /** Same as {@link #reportOptions(String, String)}, with the assessment's own institute. */
    public ReportOptions reportOptions(String assessmentId) {
        if (assessmentId == null || "null".equals(assessmentId)) return ReportOptions.ALL;
        String instituteId = null;
        try {
            List<String> ids = jdbc.queryForList(
                    "SELECT institute_id FROM assessment_institute_mapping WHERE assessment_id = ? LIMIT 1",
                    String.class, assessmentId);
            instituteId = ids.isEmpty() ? null : ids.get(0);
        } catch (Exception e) {
            log.warn("[report-options] could not find the institute of assessment {}: {}", assessmentId, e.getMessage());
        }
        return reportOptions(assessmentId, instituteId);
    }

    public ReportOptions reportOptions(String assessmentId, String instituteId) {
        ReportOptions own = ownReportOptions(assessmentId);
        if (own != null) return own;
        return fromProfile(resolve(assessmentId, instituteId));
    }

    /**
     * Same rule with the profile already chosen (the report-profile preview passes one
     * explicitly): the assessment's own options win, else that profile's.
     */
    public ReportOptions reportOptions(String assessmentId, Profile profile) {
        ReportOptions own = ownReportOptions(assessmentId);
        return own != null ? own : fromProfile(profile);
    }

    private static ReportOptions fromProfile(Profile p) {
        return p == null ? ReportOptions.ALL : ReportOptions.fromJson(p.config().path("report_options"));
    }

    /** assessment.report_options (V69), or null when unset or unreadable. */
    private ReportOptions ownReportOptions(String assessmentId) {
        if (assessmentId == null) return null;
        try {
            List<String> own = jdbc.queryForList(
                    "SELECT report_options::text FROM assessment WHERE id = ? AND report_options IS NOT NULL",
                    String.class, assessmentId);
            if (!own.isEmpty() && own.get(0) != null) {
                return ReportOptions.fromJson(objectMapper.readTree(own.get(0)));
            }
        } catch (Exception e) {
            log.warn("[report-options] could not read report_options of assessment {}: {}", assessmentId, e.getMessage());
        }
        return null;
    }

    /** The profile that applies to this assessment, or null for "no extra pages". Never throws. */
    public Profile resolve(String assessmentId, String instituteId) {
        try {
            List<String> linked = jdbc.queryForList(
                    "SELECT profile_id FROM assessment_report_profile_link WHERE assessment_id = ?", String.class, assessmentId);
            if (!linked.isEmpty()) {
                return NONE.equals(linked.get(0)) ? null : get(linked.get(0), instituteId);
            }
            List<Map<String, Object>> rows = jdbc.queryForList("""
                    SELECT id FROM assessment_report_profile
                    WHERE institute_id = ? AND is_institute_default AND status = 'ACTIVE'
                    ORDER BY updated_at DESC LIMIT 1
                    """, instituteId);
            return rows.isEmpty() ? null : get((String) rows.get(0).get("id"), instituteId);
        } catch (Exception e) {
            log.warn("[report-profile] could not resolve the profile for assessment {}: {}", assessmentId, e.getMessage());
            return null;
        }
    }

    private record Cached(Object version, Profile profile) {
    }

    /** Profiles can carry inline pages (several MB): parsed once, reloaded only when updated_at changes. */
    private final java.util.concurrent.ConcurrentHashMap<String, Cached> cache = new java.util.concurrent.ConcurrentHashMap<>();

    /** An ACTIVE profile of this institute, or null. */
    public Profile get(String profileId, String instituteId) {
        List<Map<String, Object>> meta = jdbc.queryForList("""
                SELECT updated_at FROM assessment_report_profile
                WHERE id = ? AND institute_id = ? AND status = 'ACTIVE'
                """, profileId, instituteId);
        if (meta.isEmpty()) return null;
        Object version = meta.get(0).get("updated_at");
        Cached hit = cache.get(profileId);
        if (hit != null && java.util.Objects.equals(hit.version(), version)) return hit.profile();

        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, institute_id, name, config_json, is_institute_default, updated_at FROM assessment_report_profile
                WHERE id = ? AND institute_id = ? AND status = 'ACTIVE'
                """, profileId, instituteId);
        if (rows.isEmpty()) return null;
        Map<String, Object> r = rows.get(0);
        try {
            Profile p = new Profile((String) r.get("id"), (String) r.get("institute_id"), (String) r.get("name"),
                    objectMapper.readTree((String) r.get("config_json")), Boolean.TRUE.equals(r.get("is_institute_default")));
            cache.put(profileId, new Cached(r.get("updated_at"), p));
            return p;
        } catch (Exception e) {
            log.warn("[report-profile] profile {} has unreadable config: {}", profileId, e.getMessage());
            return null;
        }
    }

    public List<Map<String, Object>> list(String instituteId) {
        return jdbc.queryForList("""
                SELECT id, name, is_institute_default, updated_at FROM assessment_report_profile
                WHERE institute_id = ? AND status = 'ACTIVE' ORDER BY name
                """, instituteId);
    }

    /** Creates (id null) or replaces a profile. Returns its id. */
    @Transactional
    public String save(String instituteId, String id, String name, JsonNode config, boolean instituteDefault) {
        validate(config);
        String json = config.toString();
        if (instituteDefault) {
            jdbc.update("UPDATE assessment_report_profile SET is_institute_default = FALSE, updated_at = now() WHERE institute_id = ?",
                    instituteId);
        }
        if (id == null || id.isBlank()) {
            id = UUID.randomUUID().toString();
            jdbc.update("""
                    INSERT INTO assessment_report_profile (id, institute_id, name, config_json, is_institute_default)
                    VALUES (?, ?, ?, ?, ?)
                    """, id, instituteId, name, json, instituteDefault);
            return id;
        }
        int n = jdbc.update("""
                UPDATE assessment_report_profile SET name = ?, config_json = ?, is_institute_default = ?, updated_at = now()
                WHERE id = ? AND institute_id = ? AND status = 'ACTIVE'
                """, name, json, instituteDefault, id, instituteId);
        if (n == 0) throw new IllegalArgumentException("Report profile not found");
        return id;
    }

    /** Links assessments to a profile id, NONE, or (null) back to the institute default. */
    @Transactional
    public void link(String instituteId, List<String> assessmentIds, String profileId) {
        if (profileId != null && !NONE.equals(profileId) && get(profileId, instituteId) == null) {
            throw new IllegalArgumentException("Report profile not found");
        }
        for (String assessmentId : assessmentIds) {
            Integer owned = jdbc.queryForObject("""
                    SELECT COUNT(*) FROM assessment_institute_mapping WHERE assessment_id = ? AND institute_id = ?
                    """, Integer.class, assessmentId, instituteId);
            if (owned == null || owned == 0) throw new IllegalArgumentException("Assessment " + assessmentId + " is not in this institute");
            if (profileId == null) {
                jdbc.update("DELETE FROM assessment_report_profile_link WHERE assessment_id = ?", assessmentId);
            } else {
                jdbc.update("""
                        INSERT INTO assessment_report_profile_link (assessment_id, profile_id) VALUES (?, ?)
                        ON CONFLICT (assessment_id) DO UPDATE SET profile_id = EXCLUDED.profile_id, updated_at = now()
                        """, assessmentId, profileId);
            }
        }
    }

    private static void validate(JsonNode config) {
        if (config == null || !config.isObject()) throw new IllegalArgumentException("config must be a JSON object");
        String qw = config.path("report_options").path("question_wise").asText("SHOW");
        if (!qw.equalsIgnoreCase("SHOW") && !qw.equalsIgnoreCase("HIDE")) {
            throw new IllegalArgumentException("report_options.question_wise must be SHOW or HIDE");
        }
        // Only an object is checked: profiles saved before V69 may carry anything here.
        if (config.path("report_options").isObject()) ReportOptions.validate(config.path("report_options"));
        for (String side : new String[]{"before", "after"}) {
            JsonNode pages = config.path(side);
            if (pages.isMissingNode()) continue;
            if (!pages.isArray()) throw new IllegalArgumentException(side + " must be a list of pages");
            for (JsonNode p : pages) {
                String type = p.path("type").asText("");
                switch (type) {
                    case "TEMPLATE" -> {
                        if (p.path("html").asText("").isBlank()) throw new IllegalArgumentException("TEMPLATE page needs html");
                    }
                    case "PDF" -> {
                        if (p.path("file_id").asText("").isBlank()
                                && !p.path("data_uri").asText("").startsWith("data:application/pdf;base64,")) {
                            throw new IllegalArgumentException("PDF page needs file_id or data_uri");
                        }
                    }
                    case "IMAGE" -> {
                        if (p.path("file_id").asText("").isBlank() && !p.path("data_uri").asText("").startsWith("data:image/")) {
                            throw new IllegalArgumentException("IMAGE page needs file_id or data_uri");
                        }
                    }
                    default -> throw new IllegalArgumentException("Unknown page type: " + type);
                }
            }
        }
    }
}
