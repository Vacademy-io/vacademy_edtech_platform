package vacademy.io.assessment_service.features.open_evaluation.submission;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ApiSubmissionFeedTest {

    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");

    @Test
    void engine_sync_follows_recent_process_changes_only_while_enabled() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        OpenApiProperties props = mock(OpenApiProperties.class);
        ApiSubmissionFeed feed = new ApiSubmissionFeed(jdbc, props, Clock.fixed(NOW, ZoneOffset.UTC));

        feed.syncFromEngine();
        verify(jdbc, never()).update(anyString(), any(SqlParameterSource.class));

        when(props.isEnabled()).thenReturn(true);
        feed.syncFromEngine();
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(sql.capture(), params.capture());
        assertThat(sql.getValue()).contains("p.updated_at > s.updated_at", "p.attempt_id = s.attempt_id");
        assertThat(params.getValue().getValue("since")).isEqualTo(Timestamp.from(NOW.minusSeconds(900)));
    }

    @Test
    void touch_never_fails_the_caller() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.update(anyString(), any(SqlParameterSource.class))).thenThrow(new RuntimeException("db down"));
        ApiSubmissionFeed feed = new ApiSubmissionFeed(jdbc, mock(OpenApiProperties.class), Clock.systemUTC());

        feed.touch(List.of("a1", "a2"));
        feed.touch((String) null);
        feed.touch(List.of());
        verify(jdbc).update(anyString(), any(MapSqlParameterSource.class));
    }
}
