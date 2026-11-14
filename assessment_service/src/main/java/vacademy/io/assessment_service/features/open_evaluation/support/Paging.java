package vacademy.io.assessment_service.features.open_evaluation.support;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.List;

/**
 * List conventions of the partner API (spec 7.0): {@code limit} 1–200 (default 50), an
 * opaque {@code cursor}, {@code updated_since}, rows ordered by {@code (updated_at, id)} so a
 * sync loop never misses or repeats a row, and the {@code {data, next_cursor, has_more}}
 * response.
 *
 * <p>The cursor is the last row's {@code (updated_at, id)} in base64url. It is opaque to the
 * partner; a cursor that does not decode is 400 {@code invalid_cursor}.
 *
 * <p>The timestamp keeps its full precision (epoch seconds and nanoseconds). Postgres stores
 * {@code now()} to the microsecond and every row written in one transaction shares it, so a
 * cursor cut to milliseconds would sort before its own row and a page of same-instant rows
 * would be served again forever. Bind {@link #timestamp(Cursor)} into the keyset predicate
 * {@code (updated_at, id) > (:after_ts, :after_id)}.
 */
public final class Paging {

    public static final int DEFAULT_LIMIT = 50;
    public static final int MAX_LIMIT = 200;

    private Paging() {
    }

    /** Position after which the next page starts. */
    public record Cursor(Instant updatedAt, String id) {
    }

    /** {@code {"data": […], "next_cursor": "…"|null, "has_more": bool}}. */
    public record Page<T>(@JsonProperty("data") List<T> data,
                          @JsonProperty("next_cursor") String nextCursor,
                          @JsonProperty("has_more") boolean hasMore) {
    }

    public static int limit(Integer requested) {
        if (requested == null) {
            return DEFAULT_LIMIT;
        }
        if (requested < 1 || requested > MAX_LIMIT) {
            throw OpenApiException.validation("limit", "out_of_range", "limit must be between 1 and " + MAX_LIMIT + ".");
        }
        return requested;
    }

    public static String encode(Cursor cursor) {
        if (cursor == null || cursor.updatedAt() == null || cursor.id() == null) {
            return null;
        }
        Instant at = cursor.updatedAt();
        String raw = at.getEpochSecond() + "." + String.format("%09d", at.getNano()) + "|" + cursor.id();
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    public static Cursor decode(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        try {
            String raw = new String(Base64.getUrlDecoder().decode(token.trim()), StandardCharsets.UTF_8);
            int bar = raw.indexOf('|');
            if (bar <= 0 || bar == raw.length() - 1) {
                throw new IllegalArgumentException("no separator");
            }
            String time = raw.substring(0, bar);
            int dot = time.indexOf('.');
            if (dot <= 0 || time.length() - dot - 1 != 9) {
                throw new IllegalArgumentException("bad time");
            }
            long seconds = Long.parseLong(time.substring(0, dot));
            int nanos = Integer.parseInt(time.substring(dot + 1));
            if (nanos < 0) {
                throw new IllegalArgumentException("bad nanos");
            }
            return new Cursor(Instant.ofEpochSecond(seconds, nanos), raw.substring(bar + 1));
        } catch (IllegalArgumentException | java.time.DateTimeException e) {
            throw new OpenApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_CURSOR,
                    "The cursor is not valid. Use next_cursor from the previous page as is.");
        }
    }

    /**
     * The cursor's position as a JDBC timestamp with its nanoseconds intact, for the keyset
     * predicate; null when there is no cursor.
     */
    public static java.sql.Timestamp timestamp(Cursor cursor) {
        return cursor == null || cursor.updatedAt() == null ? null : java.sql.Timestamp.from(cursor.updatedAt());
    }

    /** Parses {@code updated_since} (ISO 8601 instant); 422 when it is not one. */
    public static Instant updatedSince(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value.trim());
        } catch (DateTimeParseException e) {
            throw OpenApiException.validation("updated_since", "invalid",
                    "updated_since must be an ISO 8601 UTC time, e.g. 2026-10-01T09:00:00Z.");
        }
    }

    /**
     * Builds a page from {@code limit + 1} fetched rows: the extra row only says whether
     * there is more.
     */
    public static <T> Page<T> page(List<T> fetched, int limit, java.util.function.Function<T, Cursor> cursorOf) {
        boolean hasMore = fetched.size() > limit;
        List<T> data = hasMore ? List.copyOf(fetched.subList(0, limit)) : List.copyOf(fetched);
        String next = hasMore && !data.isEmpty() ? encode(cursorOf.apply(data.get(data.size() - 1))) : null;
        return new Page<>(data, next, hasMore);
    }
}
