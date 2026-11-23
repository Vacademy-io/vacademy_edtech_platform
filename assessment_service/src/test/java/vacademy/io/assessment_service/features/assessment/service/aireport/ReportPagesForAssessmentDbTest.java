package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Step 1 report pages against a real Postgres, in a throwaway schema with just the tables
 * involved: saving pages from one test never changes another test's pages. Skipped unless
 * ASSESSMENT_TEST_DB_URL is set.
 */
@EnabledIfEnvironmentVariable(named = "ASSESSMENT_TEST_DB_URL", matches = ".+")
class ReportPagesForAssessmentDbTest {

    private static final ObjectMapper OM = new ObjectMapper();
    private static final String INST = "inst-1";

    private SingleConnectionDataSource ds;
    private JdbcTemplate jdbc;
    private ReportProfileService service;
    private String schema;

    @BeforeEach
    void setUp() {
        ds = new SingleConnectionDataSource(System.getenv("ASSESSMENT_TEST_DB_URL"),
                System.getenv().getOrDefault("ASSESSMENT_TEST_DB_USER", ""),
                System.getenv().getOrDefault("ASSESSMENT_TEST_DB_PASSWORD", ""), true);
        jdbc = new JdbcTemplate(ds);
        schema = "report_pages_test_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.execute("CREATE SCHEMA " + schema);
        jdbc.execute("SET search_path TO " + schema);
        jdbc.execute("""
                CREATE TABLE assessment_report_profile (id VARCHAR(255) PRIMARY KEY, institute_id VARCHAR(255) NOT NULL,
                  name VARCHAR(255) NOT NULL, config_json TEXT NOT NULL, is_institute_default BOOLEAN NOT NULL DEFAULT FALSE,
                  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', created_at TIMESTAMP NOT NULL DEFAULT now(),
                  updated_at TIMESTAMP NOT NULL DEFAULT now());
                CREATE TABLE assessment_report_profile_link (assessment_id VARCHAR(255) PRIMARY KEY, profile_id VARCHAR(255) NOT NULL,
                  created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now());
                CREATE TABLE assessment_institute_mapping (assessment_id VARCHAR(255), institute_id VARCHAR(255));
                CREATE TABLE assessment_user_registration (id VARCHAR(255) PRIMARY KEY, assessment_id VARCHAR(255));
                CREATE TABLE student_attempt (id VARCHAR(255) PRIMARY KEY, registration_id VARCHAR(255),
                  submit_time TIMESTAMP, created_at TIMESTAMP DEFAULT now());
                """);
        for (String a : new String[]{"A", "B", "C"}) {
            jdbc.update("INSERT INTO assessment_institute_mapping VALUES (?, ?)", a, INST);
        }
        service = new ReportProfileService(jdbc);
    }

    @AfterEach
    void tearDown() {
        jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        ds.destroy();
    }

    private static JsonNode custom(String profileId, String letter) throws Exception {
        return OM.readTree("{\"mode\":\"CUSTOM\"" + (profileId == null ? "" : ",\"profile_id\":\"" + profileId + "\"")
                + ",\"config\":{\"before\":[{\"type\":\"TEMPLATE\",\"name\":\"Letter\",\"html\":\"<p>" + letter + "</p>\"}],"
                + "\"report_options\":{\"question_wise\":\"HIDE\"}}}");
    }

    private String linkOf(String assessmentId) {
        return jdbc.queryForList("SELECT profile_id FROM assessment_report_profile_link WHERE assessment_id = ?",
                String.class, assessmentId).stream().findFirst().orElse(null);
    }

    private String letterOf(String profileId) throws Exception {
        String json = jdbc.queryForObject("SELECT config_json FROM assessment_report_profile WHERE id = ?", String.class, profileId);
        return OM.readTree(json).path("before").get(0).path("html").asText();
    }

    private int profiles() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM assessment_report_profile", Integer.class);
    }

    @Test
    void aTestsOwnPagesAreCreatedThenEditedInPlace() throws Exception {
        String id = service.savePagesForAssessment(INST, "A", "Class 9 Mock", custom(null, "v1"));
        assertThat(linkOf("A")).isEqualTo(id);
        assertThat(jdbc.queryForObject("SELECT name FROM assessment_report_profile WHERE id = ?", String.class, id))
                .isEqualTo("Class 9 Mock - report pages");

        String again = service.savePagesForAssessment(INST, "A", "Class 9 Mock", custom(id, "v2"));
        assertThat(again).isEqualTo(id);
        assertThat(profiles()).isEqualTo(1);
        assertThat(letterOf(id)).isEqualTo("<p>v2</p>");
        assertThat(linkOf("B")).isNull();
    }

    @Test
    void sharedPagesAreCopiedSoTheOtherTestsKeepTheirs() throws Exception {
        String shared = service.save(INST, null, "Scholarship pages", custom(null, "shared").get("config"), false);
        service.link(INST, java.util.List.of("A", "B"), shared);

        String mine = service.savePagesForAssessment(INST, "A", "Class 5", custom(shared, "edited for A"));

        assertThat(mine).isNotEqualTo(shared);
        assertThat(linkOf("A")).isEqualTo(mine);
        assertThat(linkOf("B")).isEqualTo(shared);
        assertThat(letterOf(shared)).isEqualTo("<p>shared</p>");
        assertThat(letterOf(mine)).isEqualTo("<p>edited for A</p>");
    }

    @Test
    void theInstituteDefaultIsCopiedNeverEdited() throws Exception {
        String def = service.save(INST, null, "Default pages", custom(null, "default").get("config"), true);

        String mine = service.savePagesForAssessment(INST, "A", "Class 5", custom(def, "edited"));

        assertThat(mine).isNotEqualTo(def);
        assertThat(letterOf(def)).isEqualTo("<p>default</p>");
        assertThat(jdbc.queryForObject("SELECT is_institute_default FROM assessment_report_profile WHERE id = ?", Boolean.class, def))
                .isTrue();
        assertThat(jdbc.queryForObject("SELECT is_institute_default FROM assessment_report_profile WHERE id = ?", Boolean.class, mine))
                .isFalse();
        // C was never touched: it still gets the institute default.
        assertThat(service.resolve("C", INST).id()).isEqualTo(def);
    }

    @Test
    void noneAndDefaultOnlyChangeThisTestsLink() throws Exception {
        String id = service.savePagesForAssessment(INST, "A", "Class 5", custom(null, "x"));
        service.link(INST, java.util.List.of("B"), id);

        service.savePagesForAssessment(INST, "A", "Class 5", OM.readTree("{\"mode\":\"NONE\"}"));
        assertThat(linkOf("A")).isEqualTo(ReportProfileService.NONE);
        assertThat(service.resolve("A", INST)).isNull();
        assertThat(linkOf("B")).isEqualTo(id);

        service.savePagesForAssessment(INST, "A", "Class 5", OM.readTree("{\"mode\":\"DEFAULT\"}"));
        assertThat(linkOf("A")).isNull();
        assertThat(linkOf("B")).isEqualTo(id);
    }

    @Test
    void step1ReadsTheModeTheSharingAndAnAttemptToPreview() throws Exception {
        assertThat(service.forAssessment(null, INST)).containsEntry("mode", "DEFAULT").containsEntry("profile", null)
                .containsEntry("institute_default", null);

        String shared = service.save(INST, null, "Scholarship pages", custom(null, "shared").get("config"), false);
        service.link(INST, java.util.List.of("A", "B", "C"), shared);
        jdbc.update("INSERT INTO assessment_user_registration VALUES ('r1', 'A'), ('r2', 'A')");
        jdbc.update("INSERT INTO student_attempt (id, registration_id, submit_time) VALUES ('t-open', 'r1', NULL), ('t-done', 'r2', now())");

        Map<String, Object> a = service.forAssessment("A", INST);
        assertThat(a).containsEntry("mode", "CUSTOM").containsEntry("shared_with", 2).containsEntry("sample_attempt_id", "t-done");
        assertThat(((Map<?, ?>) a.get("profile")).get("id")).isEqualTo(shared);

        service.savePagesForAssessment(INST, "B", "B", OM.readTree("{\"mode\":\"NONE\"}"));
        assertThat(service.forAssessment("B", INST)).containsEntry("mode", "NONE").containsEntry("profile", null);
    }
}
