package vacademy.io.assessment_service.features.open_evaluation.quota;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Daily quotas: one guarded UPDATE … RETURNING per counter, key cap before institute
 * quota, defaults when admin_core sends none, and a 429 with the reset time.
 */
@SuppressWarnings("unchecked")
class ApiQuotaServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-01T18:30:00Z");

    private NamedParameterJdbcTemplate jdbc;
    private ApiQuotaService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        service = new ApiQuotaService(jdbc, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static ApiKeyPrincipal key(Integer cap, Integer quota) {
        return ApiKeyPrincipal.builder().keyId("k1").instituteId("inst-1").dailyCopyCap(cap).dailyCopyQuota(quota)
                .build();
    }

    private void keyUpdateReturns(List<Integer> rows) {
        when(jdbc.query(contains("UPDATE api_key_quota_usage SET copies = copies + :n"), any(SqlParameterSource.class),
                any(RowMapper.class))).thenReturn(rows);
    }

    private void instituteUpdateReturns(List<Integer> rows) {
        when(jdbc.query(contains("UPDATE api_quota_usage SET copies = copies + :n"), any(SqlParameterSource.class),
                any(RowMapper.class))).thenReturn(rows);
    }

    @Test
    void consumes_from_key_cap_and_institute_quota_with_guarded_updates() {
        keyUpdateReturns(List.of(3));
        instituteUpdateReturns(List.of(41));

        service.consumeCopies(key(500, 3000), 1, 1, 0);

        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).query(argThat((String sql) -> sql.startsWith("UPDATE api_quota_usage")
                        && sql.contains("copies + :n <= :limit") && sql.contains("RETURNING copies")),
                params.capture(), any(RowMapper.class));
        MapSqlParameterSource p = (MapSqlParameterSource) params.getValue();
        assertThat(p.getValue("limit")).isEqualTo(3000);
        assertThat(p.getValue("typed")).isEqualTo(1);
        assertThat(p.getValue("day")).isEqualTo(LocalDate.of(2026, 10, 1));
        // today's rows are created first, idempotently
        verify(jdbc).update(contains("INSERT INTO api_key_quota_usage"), any(SqlParameterSource.class));
        verify(jdbc).update(contains("INSERT INTO api_quota_usage"), any(SqlParameterSource.class));
    }

    @Test
    void key_cap_exhausted_is_429_and_institute_quota_is_not_touched() {
        keyUpdateReturns(List.of());

        assertThatThrownBy(() -> service.consumeCopies(key(10, 3000), 1, 0, 12))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getStatus().value()).isEqualTo(429);
                    assertThat(e.getCode()).isEqualTo("daily_quota_exceeded");
                    assertThat(e.getDetails()).containsEntry("quota", "daily_copy_cap").containsEntry("limit", 10)
                            .containsEntry("resets_at", "2026-10-02T00:00:00Z");
                    assertThat(e.getHeaders()).containsEntry("Retry-After", String.valueOf(5 * 3600 + 30 * 60));
                });
        verify(jdbc, never()).query(contains("UPDATE api_quota_usage"), any(SqlParameterSource.class),
                any(RowMapper.class));
    }

    @Test
    void institute_quota_exhausted_is_429() {
        instituteUpdateReturns(List.of());

        assertThatThrownBy(() -> service.consumeCopies(key(null, 2), 1, 0, 0))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("daily_quota_exceeded");
                    assertThat(e.getDetails()).containsEntry("quota", "daily_copy_quota").containsEntry("limit", 2);
                });
        // no key cap → no key counter at all
        verify(jdbc, never()).query(contains("api_key_quota_usage"), any(SqlParameterSource.class), any(RowMapper.class));
    }

    @Test
    void missing_quota_falls_back_to_the_platform_default() {
        instituteUpdateReturns(List.of(1));
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);

        service.consumeCopies(key(null, null), 1, 0, 0);

        verify(jdbc).query(contains("UPDATE api_quota_usage"), params.capture(), any(RowMapper.class));
        assertThat(((MapSqlParameterSource) params.getValue()).getValue("limit"))
                .isEqualTo(ApiQuotaService.DEFAULT_DAILY_COPY_QUOTA);
    }

    @Test
    void zero_copies_is_a_no_op() {
        service.consumeCopies(key(1, 1), 0, 0, 0);
        verify(jdbc, never()).update(anyString(), any(SqlParameterSource.class));
    }

    @Test
    void rubric_generations_use_their_own_counter_and_default() {
        when(jdbc.query(contains("rubric_generations = rubric_generations + :n"), any(SqlParameterSource.class),
                any(RowMapper.class))).thenReturn(List.of());

        assertThatThrownBy(() -> service.consumeRubricGenerations(key(null, null), 1))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getDetails())
                        .containsEntry("quota", "daily_rubric_generations")
                        .containsEntry("limit", ApiQuotaService.DEFAULT_DAILY_RUBRIC_GENERATIONS));
    }

    @Test
    void refund_never_goes_below_zero() {
        service.refundCopies(key(5, 10), LocalDate.of(2026, 10, 1), 1, 0, 3);
        verify(jdbc).update(contains("GREATEST(0, copies - :n)"), argThat((SqlParameterSource s) ->
                s.hasValue("keyId")));
        verify(jdbc).update(argThat((String sql) -> sql.startsWith("UPDATE api_quota_usage")
                && sql.contains("pages = GREATEST(0, pages - :pages)")), any(SqlParameterSource.class));
    }

    @Test
    void usage_today_is_zero_without_a_row_and_resets_at_utc_midnight() {
        when(jdbc.query(contains("SELECT copies"), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of());
        ApiQuotaService.Usage usage = service.usageToday("inst-1");
        assertThat(usage.copies()).isZero();
        assertThat(usage.day()).isEqualTo(LocalDate.of(2026, 10, 1));
        assertThat(service.resetsAt()).isEqualTo(Instant.parse("2026-10-02T00:00:00Z"));
    }
}
