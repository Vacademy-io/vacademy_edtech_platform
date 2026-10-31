package vacademy.io.assessment_service.features.open_evaluation.quota;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Daily quotas of the partner API (spec 11.5 layer 2), in Postgres so they hold across pods.
 *
 * <p>Every increment is one guarded statement,
 * {@code UPDATE … SET copies = copies + :n WHERE … AND copies + :n <= :limit RETURNING copies},
 * after an {@code INSERT … ON CONFLICT DO NOTHING} that makes sure today's row exists. No
 * read-then-write, so two pods cannot both take the last unit. When the per-key cap and the
 * institute quota both apply they move in one transaction: if the second refuses, the first
 * is rolled back.
 *
 * <p>The day is the UTC calendar day; quotas reset at 00:00 UTC.
 */
@Slf4j
@Service
public class ApiQuotaService {

    /** Defaults when admin_core sends no value (institute_api_access column defaults). */
    public static final int DEFAULT_DAILY_COPY_QUOTA = 2_000;
    public static final int DEFAULT_DAILY_IDENTIFY_PAGES = 5_000;
    public static final int DEFAULT_DAILY_RUBRIC_GENERATIONS = 200;

    private final NamedParameterJdbcTemplate jdbc;
    private final Clock clock;

    @Autowired
    public ApiQuotaService(JdbcTemplate jdbcTemplate) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), Clock.systemUTC());
    }

    ApiQuotaService(NamedParameterJdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** Today's counters of an institute (zeros when nothing was used yet). */
    public record Usage(LocalDate day, int copies, int typed, int pages, int identifyPages, int rubricGenerations) {
    }

    /**
     * Takes {@code copies} submissions from the key's daily cap (when it has one) and from
     * the institute's daily copy quota; {@code typed} of them were typed, {@code pages} pages
     * are counted for reporting. 429 {@code daily_quota_exceeded} when either would overflow;
     * nothing is consumed then.
     */
    @Transactional
    public void consumeCopies(ApiKeyPrincipal principal, int copies, int typed, int pages) {
        if (copies <= 0) {
            return;
        }
        LocalDate day = today();
        Integer keyCap = principal.getDailyCopyCap();
        if (keyCap != null) {
            ensureKeyRow(principal.getKeyId(), day);
            List<Integer> keyRow = jdbc.query(
                    "UPDATE api_key_quota_usage SET copies = copies + :n "
                            + "WHERE key_id = :keyId AND day = :day AND copies + :n <= :limit RETURNING copies",
                    new MapSqlParameterSource()
                            .addValue("n", copies)
                            .addValue("keyId", principal.getKeyId())
                            .addValue("day", day)
                            .addValue("limit", keyCap),
                    (rs, i) -> rs.getInt(1));
            if (keyRow.isEmpty()) {
                throw exceeded("daily_copy_cap", keyCap, "This API key has used its daily copy cap.");
            }
        }
        int limit = orDefault(principal.getDailyCopyQuota(), DEFAULT_DAILY_COPY_QUOTA);
        ensureInstituteRow(principal.getInstituteId(), day);
        List<Integer> row = jdbc.query(
                "UPDATE api_quota_usage SET copies = copies + :n, typed = typed + :typed, pages = pages + :pages "
                        + "WHERE institute_id = :instituteId AND day = :day AND copies + :n <= :limit RETURNING copies",
                new MapSqlParameterSource()
                        .addValue("n", copies)
                        .addValue("typed", Math.max(0, typed))
                        .addValue("pages", Math.max(0, pages))
                        .addValue("instituteId", principal.getInstituteId())
                        .addValue("day", day)
                        .addValue("limit", limit),
                (rs, i) -> rs.getInt(1));
        if (row.isEmpty()) {
            // Throwing rolls back the key-cap increment above (same transaction).
            throw exceeded("daily_copy_quota", limit, "This institute has used its daily copy quota.");
        }
    }

    /**
     * Gives back copies taken by {@link #consumeCopies} for a submission that was then not
     * accepted (e.g. it failed validation after the quota step). Never goes below zero.
     */
    @Transactional
    public void refundCopies(ApiKeyPrincipal principal, LocalDate day, int copies, int typed, int pages) {
        if (copies <= 0 || day == null) {
            return;
        }
        if (principal.getDailyCopyCap() != null) {
            jdbc.update("UPDATE api_key_quota_usage SET copies = GREATEST(0, copies - :n) "
                            + "WHERE key_id = :keyId AND day = :day",
                    new MapSqlParameterSource().addValue("n", copies).addValue("keyId", principal.getKeyId())
                            .addValue("day", day));
        }
        jdbc.update("UPDATE api_quota_usage SET copies = GREATEST(0, copies - :n), "
                        + "typed = GREATEST(0, typed - :typed), pages = GREATEST(0, pages - :pages) "
                        + "WHERE institute_id = :instituteId AND day = :day",
                new MapSqlParameterSource().addValue("n", copies).addValue("typed", Math.max(0, typed))
                        .addValue("pages", Math.max(0, pages)).addValue("instituteId", principal.getInstituteId())
                        .addValue("day", day));
    }

    /** Pages read by the free identify step (batches, Phase 2). */
    @Transactional
    public void consumeIdentifyPages(ApiKeyPrincipal principal, int pages) {
        consumeInstituteCounter(principal, "identify_pages", pages,
                orDefault(principal.getDailyIdentifyPages(), DEFAULT_DAILY_IDENTIFY_PAGES), "daily_identify_pages",
                "This institute has used its daily page allowance for reading names and roll numbers.");
    }

    /** Free rubric generations (Phase 2). */
    @Transactional
    public void consumeRubricGenerations(ApiKeyPrincipal principal, int generations) {
        consumeInstituteCounter(principal, "rubric_generations", generations,
                orDefault(principal.getDailyRubricGenerations(), DEFAULT_DAILY_RUBRIC_GENERATIONS),
                "daily_rubric_generations", "This institute has used its daily rubric generations.");
    }

    public Usage usageToday(String instituteId) {
        LocalDate day = today();
        List<Usage> rows = jdbc.query(
                "SELECT copies, typed, pages, identify_pages, rubric_generations FROM api_quota_usage "
                        + "WHERE institute_id = :instituteId AND day = :day",
                new MapSqlParameterSource().addValue("instituteId", instituteId).addValue("day", day),
                (rs, i) -> new Usage(day, rs.getInt(1), rs.getInt(2), rs.getInt(3), rs.getInt(4), rs.getInt(5)));
        return rows.isEmpty() ? new Usage(day, 0, 0, 0, 0, 0) : rows.get(0);
    }

    /** Next 00:00 UTC, when every daily counter starts again. */
    public Instant resetsAt() {
        return today().plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    public LocalDate today() {
        return LocalDate.now(clock.withZone(ZoneOffset.UTC));
    }

    // ------------------------------------------------------------------ internals

    /** column is one of a fixed set of names chosen in this class, never caller input. */
    private void consumeInstituteCounter(ApiKeyPrincipal principal, String column, int n, int limit,
            String quotaName, String message) {
        if (n <= 0) {
            return;
        }
        LocalDate day = today();
        ensureInstituteRow(principal.getInstituteId(), day);
        List<Integer> row = jdbc.query(
                "UPDATE api_quota_usage SET " + column + " = " + column + " + :n "
                        + "WHERE institute_id = :instituteId AND day = :day AND " + column + " + :n <= :limit "
                        + "RETURNING " + column,
                new MapSqlParameterSource()
                        .addValue("n", n)
                        .addValue("instituteId", principal.getInstituteId())
                        .addValue("day", day)
                        .addValue("limit", limit),
                (rs, i) -> rs.getInt(1));
        if (row.isEmpty()) {
            throw exceeded(quotaName, limit, message);
        }
    }

    private void ensureInstituteRow(String instituteId, LocalDate day) {
        jdbc.update("INSERT INTO api_quota_usage (institute_id, day) VALUES (:instituteId, :day) "
                        + "ON CONFLICT (institute_id, day) DO NOTHING",
                new MapSqlParameterSource().addValue("instituteId", instituteId).addValue("day", day));
    }

    private void ensureKeyRow(String keyId, LocalDate day) {
        jdbc.update("INSERT INTO api_key_quota_usage (key_id, day) VALUES (:keyId, :day) "
                        + "ON CONFLICT (key_id, day) DO NOTHING",
                new MapSqlParameterSource().addValue("keyId", keyId).addValue("day", day));
    }

    private OpenApiException exceeded(String quotaName, int limit, String message) {
        Instant resetsAt = resetsAt();
        long retryAfter = Math.max(1, Duration.between(clock.instant(), resetsAt).getSeconds());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("quota", quotaName);
        details.put("limit", limit);
        details.put("resets_at", resetsAt.toString());
        log.info("Partner API daily quota {} exhausted (limit {})", quotaName, limit);
        return new OpenApiException(HttpStatus.TOO_MANY_REQUESTS, ApiErrorCode.DAILY_QUOTA_EXCEEDED,
                message + " It resets at " + resetsAt + ".", details,
                Map.of("Retry-After", String.valueOf(retryAfter)));
    }

    private static int orDefault(Integer value, int fallback) {
        return value == null ? fallback : value;
    }
}
