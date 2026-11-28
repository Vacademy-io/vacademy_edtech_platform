package vacademy.io.assessment_service.features.open_evaluation.submission;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ApiSubmissionStoreTest {

    @Test
    void every_public_status_has_a_clause_matching_spec_8_1() {
        assertThat(ApiSubmissionStore.statusClause("queued")).contains("'PENDING'", "'DISPATCHED'");
        assertThat(ApiSubmissionStore.statusClause("graded")).contains("v.process_status IS NULL", "NOT v.any_failed");
        assertThat(ApiSubmissionStore.statusClause("partially_graded")).contains("v.any_failed");
        assertThat(ApiSubmissionStore.statusClause("reading")).contains("'EXTRACTING'");
        assertThat(ApiSubmissionStore.statusClause("grading")).contains("'EVALUATING'", "'GRADING'", "'IN_PROGRESS'");
        assertThat(ApiSubmissionStore.statusClause("failed")).contains("'FAILED'");
        assertThat(ApiSubmissionStore.statusClause("cancelled")).contains("'CANCELLED'");
        assertThat(ApiSubmissionStore.statusClause("processing")).contains("'PROCESSING'");
        assertThat(ApiSubmissionStore.statusClause("bogus")).isNull();
    }

    @Test
    void the_needs_review_sql_mirrors_the_java_rule() {
        String sql = ApiSubmissionStore.VIEW_SQL;
        assertThat(sql).contains("q.status = 'FAILED'", "< 0.6", "\"review_reasons\":[", "approved_by",
                "NOT COALESCE(q.is_edited, FALSE)");
    }
}
