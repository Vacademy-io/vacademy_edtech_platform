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
                JsonNode node = objectMapper.readTree(own.get(0));
                // Only student_fields saved: the switches follow the institute default.
                if (ReportOptions.followsInstituteDefault(node)) return null;
                return ReportOptions.fromJson(node);
            }
        } catch (Exception e) {
            log.warn("[report-options] could not read report_options of assessment {}: {}", assessmentId, e.getMessage());
        }
        return null;
    }

    /**
     * The registration answers this assessment prints under the student's name
     * ({@code report_options.student_fields}). Read from this assessment's own row only, never
     * from the institute profile, so it never spreads to other assessments. Empty when none are
     * chosen or the student did not fill them. Never throws.
     */
    public List<ReportStudentDetail> studentDetails(String assessmentId, String attemptId) {
        if (assessmentId == null || attemptId == null) return List.of();
        try {
            List<String> stored = jdbc.queryForList(
                    "SELECT report_options::text FROM assessment WHERE id = ? AND report_options IS NOT NULL",
                    String.class, assessmentId);
            if (stored.isEmpty() || stored.get(0) == null) return List.of();
            List<String> wanted = ReportOptions.studentFields(objectMapper.readTree(stored.get(0)));
            if (wanted.isEmpty()) return List.of();
            List<ReportStudentDetail.Answer> answers = jdbc.query(
                    "SELECT cf.field_name, cf.field_key, d.answer"
                            + " FROM student_attempt sa"
                            + " JOIN assessment_registration_custom_field_response_data d"
                            + "   ON d.assessment_registration_id = sa.registration_id"
                            + " JOIN assessment_custom_fields cf ON cf.id = d.custom_field_id"
                            + " WHERE sa.id = ? AND cf.assessment_id = ?"
                            + " ORDER BY cf.field_order",
                    (rs, i) -> new ReportStudentDetail.Answer(rs.getString(1), rs.getString(2), rs.getString(3)),
                    attemptId, assessmentId);
            return ReportStudentDetail.match(wanted, answers);
        } catch (Exception e) {
            log.warn("[report-options] could not read the student details of attempt {}: {}", attemptId, e.getMessage());
            return List.of();
        }
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

    // ── Step 1 "Report pages": one assessment's pages, edited from the assessment wizard ──

    public static final String MODE_DEFAULT = "DEFAULT";
    public static final String MODE_NONE = "NONE";
    public static final String MODE_CUSTOM = "CUSTOM";
    static final int MAX_PAGES = 30;
    static final int MAX_TEMPLATE_HTML = 300_000;
    static final int MAX_ASSETS = 12;
    static final int MAX_CONFIG_CHARS = 12_000_000;
    private static final java.util.regex.Pattern ASSET_KEY = java.util.regex.Pattern.compile("[a-z0-9_]{1,40}");

    /**
     * What Step 1 shows for an assessment (null assessmentId = a test not saved yet):
     * mode DEFAULT (institute default pages, if any), NONE (no extra pages) or CUSTOM (its own
     * linked pages, with the full config), how many other tests share those pages, the
     * institute default's name, and an attempt to preview with. Never throws.
     */
    public Map<String, Object> forAssessment(String assessmentId, String instituteId) {
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        String mode = MODE_DEFAULT;
        Profile linked = null;
        int sharedWith = 0;
        try {
            if (assessmentId != null) {
                List<String> link = jdbc.queryForList(
                        "SELECT profile_id FROM assessment_report_profile_link WHERE assessment_id = ?", String.class, assessmentId);
                if (!link.isEmpty()) {
                    linked = NONE.equals(link.get(0)) ? null : get(link.get(0), instituteId);
                    // A link to a deleted profile gives no pages today, the same as NONE.
                    mode = linked != null ? MODE_CUSTOM : MODE_NONE;
                    if (linked != null) {
                        Integer others = jdbc.queryForObject(
                                "SELECT COUNT(*) FROM assessment_report_profile_link WHERE profile_id = ? AND assessment_id <> ?",
                                Integer.class, linked.id(), assessmentId);
                        sharedWith = others == null ? 0 : others;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("[report-profile] could not read the pages of assessment {}: {}", assessmentId, e.getMessage());
        }
        out.put("mode", mode);
        if (linked != null) {
            Map<String, Object> p = new java.util.LinkedHashMap<>();
            p.put("id", linked.id());
            p.put("name", linked.name());
            p.put("institute_default", linked.instituteDefault());
            p.put("config", linked.config());
            out.put("profile", p);
        } else {
            out.put("profile", null);
        }
        out.put("shared_with", sharedWith);
        Profile def = instituteDefault(instituteId);
        out.put("institute_default", def == null ? null : Map.of("id", def.id(), "name", def.name(),
                "pages", def.before().size() + def.after().size()));
        out.put("sample_attempt_id", assessmentId == null ? null : sampleAttemptId(assessmentId));
        return out;
    }

    /** The institute's default profile, or null. Never throws. */
    public Profile instituteDefault(String instituteId) {
        try {
            List<Map<String, Object>> rows = jdbc.queryForList("""
                    SELECT id FROM assessment_report_profile
                    WHERE institute_id = ? AND is_institute_default AND status = 'ACTIVE'
                    ORDER BY updated_at DESC LIMIT 1
                    """, instituteId);
            return rows.isEmpty() ? null : get((String) rows.get(0).get("id"), instituteId);
        } catch (Exception e) {
            log.warn("[report-profile] could not read the default profile of institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    /** The newest submitted attempt (else the newest attempt) of an assessment, to preview with. */
    private String sampleAttemptId(String assessmentId) {
        try {
            List<String> ids = jdbc.queryForList("""
                    SELECT sa.id FROM student_attempt sa
                    JOIN assessment_user_registration r ON r.id = sa.registration_id
                    WHERE r.assessment_id = ?
                    ORDER BY (sa.submit_time IS NULL), sa.submit_time DESC, sa.created_at DESC
                    LIMIT 1
                    """, String.class, assessmentId);
            return ids.isEmpty() ? null : ids.get(0);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Refuses a malformed Step 1 report_pages value before anything is saved:
     * {"mode": "DEFAULT"|"NONE"|"CUSTOM", "profile_id": optional, "config": {...} for CUSTOM}.
     */
    public static void validatePagesRequest(JsonNode request) {
        if (request == null || !request.isObject()) throw new IllegalArgumentException("report_pages must be a JSON object");
        String mode = request.path("mode").asText("");
        if (!MODE_DEFAULT.equals(mode) && !MODE_NONE.equals(mode) && !MODE_CUSTOM.equals(mode)) {
            throw new IllegalArgumentException("report_pages.mode must be DEFAULT, NONE or CUSTOM");
        }
        if (!MODE_CUSTOM.equals(mode)) return;
        validateEditorConfig(request.get("config"));
    }

    /** The checks behind {@link #validatePagesRequest} for a config built in the wizard. */
    static void validateEditorConfig(JsonNode config) {
        validate(config);
        if (config.toString().length() > MAX_CONFIG_CHARS) throw new IllegalArgumentException("Report pages are too large");
        int pages = 0;
        for (String side : new String[]{"before", "after"}) {
            for (JsonNode p : iterate(config.path(side))) {
                pages++;
                if (p.path("name").asText("").length() > 200) throw new IllegalArgumentException("A page name is too long");
                if ("TEMPLATE".equals(p.path("type").asText()) && p.path("html").asText("").length() > MAX_TEMPLATE_HTML) {
                    throw new IllegalArgumentException("A written page is too long");
                }
            }
        }
        if (pages > MAX_PAGES) throw new IllegalArgumentException("At most " + MAX_PAGES + " extra pages");
        JsonNode assets = config.path("assets");
        if (!assets.isMissingNode() && !assets.isNull()) {
            if (!assets.isObject()) throw new IllegalArgumentException("assets must be an object");
            if (assets.size() > MAX_ASSETS) throw new IllegalArgumentException("At most " + MAX_ASSETS + " images for written pages");
            assets.fields().forEachRemaining(e -> {
                if (!ASSET_KEY.matcher(e.getKey()).matches()) throw new IllegalArgumentException("Bad image name: " + e.getKey());
                if (!e.getValue().asText("").startsWith("data:image/")) throw new IllegalArgumentException("Image " + e.getKey() + " must be an image");
            });
        }
        String qr = config.path("qr_url").asText("");
        if (!qr.isBlank() && (qr.length() > 500 || !(qr.startsWith("https://") || qr.startsWith("http://")))) {
            throw new IllegalArgumentException("QR code link must be a web address");
        }
        if (config.path("result_date").asText("").length() > 80) throw new IllegalArgumentException("Result date is too long");
        JsonNode vars = config.path("variables");
        if (!vars.isMissingNode() && !vars.isNull() && !vars.isObject()) throw new IllegalArgumentException("variables must be an object");
    }

    private static Iterable<JsonNode> iterate(JsonNode arr) {
        return arr != null && arr.isArray() ? arr : List.of();
    }

    /**
     * Saves an assessment's Step 1 report pages. DEFAULT drops its link (the institute default
     * applies), NONE links it to no pages, CUSTOM saves the config as this assessment's own
     * profile. The profile it started from is updated in place only when it belongs to this
     * assessment alone; pages shared with other tests, or the institute default, are copied
     * first, so saving here never changes another test's report. Returns the linked profile id
     * (null for DEFAULT).
     */
    @Transactional
    public String savePagesForAssessment(String instituteId, String assessmentId, String assessmentName, JsonNode request) {
        validatePagesRequest(request);
        String mode = request.path("mode").asText();
        if (MODE_DEFAULT.equals(mode)) {
            link(instituteId, List.of(assessmentId), null);
            return null;
        }
        if (MODE_NONE.equals(mode)) {
            link(instituteId, List.of(assessmentId), NONE);
            return NONE;
        }
        String startedFrom = request.path("profile_id").asText("");
        String target = !startedFrom.isBlank() && ownedOnlyBy(startedFrom, assessmentId, instituteId) ? startedFrom : null;
        String name = target != null ? get(target, instituteId).name() : pagesProfileName(assessmentName);
        String id = save(instituteId, target, name, request.get("config"), false);
        link(instituteId, List.of(assessmentId), id);
        return id;
    }

    /** True when the profile is this institute's, not its default, and linked to this assessment only. */
    private boolean ownedOnlyBy(String profileId, String assessmentId, String instituteId) {
        Profile p = get(profileId, instituteId);
        if (p == null || p.instituteDefault()) return false;
        Map<String, Object> counts = jdbc.queryForMap("""
                SELECT COUNT(*) FILTER (WHERE assessment_id = ?) AS mine,
                       COUNT(*) FILTER (WHERE assessment_id <> ?) AS others
                FROM assessment_report_profile_link WHERE profile_id = ?
                """, assessmentId, assessmentId, profileId);
        return ((Number) counts.get("mine")).intValue() == 1 && ((Number) counts.get("others")).intValue() == 0;
    }

    static String pagesProfileName(String assessmentName) {
        String base = assessmentName == null || assessmentName.isBlank() ? "Assessment" : assessmentName.trim();
        if (base.length() > 200) base = base.substring(0, 200);
        return base + " - report pages";
    }

    /**
     * The profile a Step 1 preview renders with, built from the unsaved request: the institute
     * default (DEFAULT), none (NONE) or the edited config (CUSTOM, never saved).
     */
    public Profile previewProfile(String instituteId, JsonNode request) {
        validatePagesRequest(request);
        String mode = request.path("mode").asText();
        if (MODE_DEFAULT.equals(mode)) return instituteDefault(instituteId);
        if (MODE_NONE.equals(mode)) return null;
        return new Profile(null, instituteId, "Preview", request.get("config"), false);
    }
}
