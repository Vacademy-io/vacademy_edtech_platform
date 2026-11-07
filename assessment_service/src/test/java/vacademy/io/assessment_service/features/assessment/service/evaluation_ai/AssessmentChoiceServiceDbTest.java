package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Setting "answer any 2 of these 3" on an existing dashboard test, against a real
 * Postgres: what the paper is out of, every unreleased result, and nothing else.
 * Skipped unless ASSESSMENT_TEST_DB_URL is set.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ContextConfiguration(classes = AssessmentChoiceServiceDbTest.OrmOnlyConfig.class)
@EnabledIfEnvironmentVariable(named = "ASSESSMENT_TEST_DB_URL", matches = ".+")
class AssessmentChoiceServiceDbTest {

    @Configuration
    @EntityScan(basePackages = "vacademy.io")
    @EnableJpaRepositories(basePackages = {
            "vacademy.io.assessment_service.features.assessment.repository",
            "vacademy.io.assessment_service.features.learner_assessment.repository"})
    static class OrmOnlyConfig {
    }

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("ASSESSMENT_TEST_DB_URL"));
        registry.add("spring.datasource.username", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_USER", ""));
        registry.add("spring.datasource.password", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_PASSWORD", ""));
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
    }

    @Autowired AssessmentRepository assessments;
    @Autowired SectionRepository sections;
    @Autowired QuestionAssessmentSectionMappingRepository mappings;
    @Autowired StudentAttemptRepository attempts;
    @Autowired QuestionWiseMarksRepository marks;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager em;

    private AssessmentChoiceService service;
    private final String a = "A-" + UUID.randomUUID();
    private final String inst = "inst-" + UUID.randomUUID();
    private final String sec = "sec-" + UUID.randomUUID();

    private void sql(String s, Object... args) {
        jdbc.update(s, args);
    }

    private String question(String label, double max) {
        String q = "q-" + label + "-" + UUID.randomUUID();
        sql("INSERT INTO assessment_rich_text_data (id, type, content) VALUES (?, 'HTML', ?)", "t" + q, "Question " + label);
        sql("INSERT INTO question (id, text_id, question_response_type, question_type, access_level) VALUES (?, ?, 'LONG_ANSWER', 'LONG_ANSWER', 'PRIVATE')", q, "t" + q);
        sql("INSERT INTO question_assessment_section_mapping (id, question_id, section_id, question_order, marking_json, status) VALUES (?, ?, ?, 1, ?, 'ACTIVE')",
                UUID.randomUUID().toString(), q, sec, "{\"type\":\"LONG_ANSWER\",\"data\":{\"totalMark\":\"" + max + "\"}}");
        return q;
    }

    private String attempt(String status, String release, Map<String, Double> byQuestion) {
        String reg = "reg-" + UUID.randomUUID();
        String att = "att-" + UUID.randomUUID();
        sql("INSERT INTO assessment_user_registration (id, assessment_id, user_id, status, registration_time) VALUES (?, ?, ?, 'ACTIVE', now())", reg, a, "u-" + reg);
        sql("INSERT INTO student_attempt (id, registration_id, status, attempt_number, max_time, start_time, preview_start_time, total_marks, result_marks, report_release_status) VALUES (?, ?, ?, 1, 60, now(), now(), 99, 99, ?)",
                att, reg, status, release);
        byQuestion.forEach((q, m) -> sql("INSERT INTO question_wise_marks (id, assessment_id, attempt_id, question_id, section_id, marks, status) VALUES (?, ?, ?, ?, ?, ?, 'CORRECT')",
                UUID.randomUUID().toString(), a, att, q, sec, m));
        return att;
    }

    String x, q1, q2, q3, open, released;

    @BeforeEach
    void seed() {
        service = new AssessmentChoiceService(assessments, sections, mappings, attempts, marks,
                new DashboardChoiceGroups(new ChoiceGroupStore(jdbc, new ObjectMapper()), mappings, new ObjectMapper()));
        sql("INSERT INTO assessment (id, name, play_mode, evaluation_type, can_switch_section, assessment_visibility, submission_type, status, can_request_reattempt, can_request_time_increase) VALUES (?, 'Choice', 'EXAM', 'MANUAL', false, 'PRIVATE', 'PDF', 'PUBLISHED', false, false)", a);
        sql("INSERT INTO assessment_institute_mapping (id, assessment_id, institute_id, assessment_url) VALUES (?, ?, ?, 'u')", "aim-" + a, a, inst);
        sql("INSERT INTO section (id, assessment_id, name, section_order, status, total_marks) VALUES (?, ?, 'Section 1', 1, 'ACTIVE', 15)", sec, a);
        x = question("X", 6);
        q1 = question("IX-1", 3);
        q2 = question("IX-2", 3);
        q3 = question("IX-3", 3);
        open = attempt("ENDED", "PENDING", Map.of(x, 5.0, q1, 3.0, q2, 1.0, q3, 2.5));
        released = attempt("ENDED", "RELEASED", Map.of(x, 6.0, q1, 3.0, q2, 3.0, q3, 3.0));
        em.flush();
        em.clear();
    }

    private double sectionTotal() {
        return jdbc.queryForObject("SELECT total_marks FROM section WHERE id = ?", Double.class, sec);
    }

    private double total(String att) {
        return jdbc.queryForObject("SELECT result_marks FROM student_attempt WHERE id = ?", Double.class, att);
    }

    @Test
    void setting_the_choice_moves_the_maximum_and_the_unreleased_results_only() {
        Map<String, Object> out = service.replace(inst, a,
                List.of(new DashboardChoiceGroups.GroupInput("IX", List.of(q1, q2, q3), 2, "best")));
        em.flush();
        em.clear();

        assertThat(out).containsEntry("paper_max", 12.0).containsEntry("results_updated", 1)
                .containsEntry("released_results_unchanged", 1);
        assertThat(sectionTotal()).isEqualTo(12.0);              // 6 + any two of 3
        assertThat(total(open)).isEqualTo(10.5);                 // 5 + 3 + 2.5, the 1-mark answer left out
        assertThat(total(released)).isEqualTo(99.0);             // released: never rewritten
        // Every answer keeps its own marks.
        assertThat(jdbc.queryForObject("SELECT marks FROM question_wise_marks WHERE attempt_id = ? AND question_id = ?",
                Double.class, open, q2)).isEqualTo(1.0);
        assertThat(service.view(inst, a)).containsEntry("paper_max", 12.0).containsEntry("total_marks", 15.0);
    }

    @Test
    void clearing_the_choice_puts_everything_back() {
        service.replace(inst, a, List.of(new DashboardChoiceGroups.GroupInput("IX", List.of(q1, q2, q3), 2, "best")));
        service.replace(inst, a, List.of());
        em.flush();
        em.clear();
        assertThat(sectionTotal()).isEqualTo(15.0);
        assertThat(total(open)).isEqualTo(11.5);
    }
}
