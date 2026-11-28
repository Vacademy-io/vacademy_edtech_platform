package vacademy.io.assessment_service.features.submission_review.service;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * The store's SQL as sent: text blocks drop trailing spaces, so a "WHERE " + condition
 * glue would read "WHEREqwm..." and only fail on a real database (a past outage).
 */
class SubmissionReviewStoreSqlTest {

    @Test
    @SuppressWarnings("unchecked")
    void where_clauses_are_separated_from_their_conditions() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        SubmissionReviewStore store = new SubmissionReviewStore(jdbc);
        store.rows(List.of("a1"));
        store.rowsOfAssessment("A");
        store.runs(List.of("a1"));
        store.runsOfAssessment("A");
        store.submittedAttempts("A");
        store.allAttempts("A");
        store.attempts("A", List.of("a1"));
        store.attempt("a1");
        store.paper("A");

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, atLeastOnce()).query(sql.capture(), any(SqlParameterSource.class), any(RowMapper.class));
        ArgumentCaptor<String> sql2 = ArgumentCaptor.forClass(String.class);
        verify(jdbc, atLeastOnce()).query(sql2.capture(), any(SqlParameterSource.class), any(RowCallbackHandler.class));
        List<String> all = new java.util.ArrayList<>(sql.getAllValues());
        all.addAll(sql2.getAllValues());
        assertThat(all).hasSizeGreaterThanOrEqualTo(9);
        for (String s : all) {
            String flat = s.replaceAll("\\s+", " ");
            assertThat(flat).doesNotContainPattern("WHERE[a-z(]").doesNotContainPattern("[a-z_)]FROM ")
                    .doesNotContainPattern("[a-z_)]ORDER BY").doesNotContainPattern("\\)ORDER");
        }
        assertThat(all).anyMatch(s -> s.replaceAll("\\s+", " ").contains("WHERE qwm.attempt_id IN (:ids)"));
        assertThat(all).anyMatch(s -> s.replaceAll("\\s+", " ").contains("WHERE assessment_id = :a ORDER BY created_at DESC"));
        assertThat(all).anyMatch(s -> s.replaceAll("\\s+", " ").contains("sa.result_withheld_at FROM student_attempt sa"));
    }
}
