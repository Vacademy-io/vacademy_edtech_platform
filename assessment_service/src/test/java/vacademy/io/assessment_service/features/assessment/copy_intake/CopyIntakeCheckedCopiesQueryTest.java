package vacademy.io.assessment_service.features.assessment.copy_intake;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The two queries behind the checked-copy template and the bulk download, run
 * against a real Postgres: a JPQL mistake in a repository fails the service at
 * boot, which no mock would show.
 *
 * Needs a database carrying the assessment_service schema (baseline + V2..V55)
 * with student_attempt's foreign keys dropped, so an attempt row stands alone.
 * Skipped unless ASSESSMENT_TEST_DB_URL is set, so CI without a database stays green.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ContextConfiguration(classes = CopyIntakeCheckedCopiesQueryTest.OrmOnlyConfig.class)
@EnabledIfEnvironmentVariable(named = "ASSESSMENT_TEST_DB_URL", matches = ".+")
class CopyIntakeCheckedCopiesQueryTest {

    @Configuration
    @EntityScan(basePackages = "vacademy.io")
    @EnableJpaRepositories(basePackages = {
            "vacademy.io.assessment_service.features.assessment.repository",
            "vacademy.io.assessment_service.features.assessment.copy_intake.repository"})
    static class OrmOnlyConfig {
    }

    @Autowired
    private AiCopyIntakeItemRepository itemRepository;

    @Autowired
    private AssessmentRepository assessmentRepository;

    @Autowired
    private EntityManager entityManager;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("ASSESSMENT_TEST_DB_URL"));
        registry.add("spring.datasource.username", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_USER", ""));
        registry.add("spring.datasource.password", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_PASSWORD", ""));
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
    }

    private String id() {
        return UUID.randomUUID().toString();
    }

    private void sql(String statement, Object... params) {
        var q = entityManager.createNativeQuery(statement);
        for (int i = 0; i < params.length; i++) {
            q.setParameter(i + 1, params[i]);
        }
        q.executeUpdate();
    }

    private String attempt(String evaluatedFileId) {
        String attemptId = id();
        sql("INSERT INTO student_attempt (id, registration_id, status, attempt_number, max_time, start_time,"
                + " preview_start_time, evaluated_file_id) VALUES (?1, ?2, 'ENDED', 1, 60, now(), now(), ?3)",
                attemptId, id(), evaluatedFileId);
        return attemptId;
    }

    private void item(String batchId, String status, String attemptId, String name, String fileName) {
        sql("INSERT INTO ai_copy_intake_item (id, batch_id, file_id, file_name, status, matched_name, attempt_id,"
                + " created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, now(), now())",
                id(), batchId, id(), fileName, status, name, attemptId);
    }

    @Test
    void lists_only_completed_copies_that_have_a_checked_copy() {
        String batchId = id();
        sql("INSERT INTO ai_copy_intake_batch (id, assessment_id, institute_id, status, total_items, created_at)"
                + " VALUES (?1, ?2, ?3, 'COMPLETED', 4, now())", batchId, id(), id());

        item(batchId, AiCopyIntakeItem.COMPLETED, attempt("checked-1"), "Asha", "56.pdf");
        item(batchId, AiCopyIntakeItem.COMPLETED, attempt(null), "Ravi", "57.pdf");      // no checked copy rendered
        item(batchId, AiCopyIntakeItem.QUEUED, attempt("checked-2"), "Meena", "58.pdf"); // still being checked
        item(batchId, AiCopyIntakeItem.UNMATCHED, null, null, "59.pdf");                // never placed

        List<AiCopyIntakeItemRepository.CheckedCopyRow> rows =
                itemRepository.findCheckedCopies(batchId, AiCopyIntakeItem.COMPLETED);

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getEvaluatedFileId()).isEqualTo("checked-1");
        assertThat(rows.get(0).getStudentName()).isEqualTo("Asha");
        assertThat(rows.get(0).getFileName()).isEqualTo("56.pdf");
    }

    @Test
    void stores_the_template_on_the_assessment_alone() {
        String assessmentId = id();
        sql("INSERT INTO assessment (id, name, play_mode, evaluation_type, can_switch_section, assessment_visibility,"
                + " submission_type) VALUES (?1, 'Unit test', 'EXAM', 'MANUAL', false, 'PRIVATE', 'FILE')", assessmentId);

        assertThat(assessmentRepository.updateCopyCommentPlacement(assessmentId, "OUTSIDE")).isEqualTo(1);
        entityManager.clear();

        assertThat(assessmentRepository.findById(assessmentId))
                .get()
                .satisfies(a -> {
                    assertThat(a.getCopyCommentPlacement()).isEqualTo("OUTSIDE");
                    assertThat(a.getName()).isEqualTo("Unit test");
                });
    }
}
