package vacademy.io.admin_core_service.features.commerce.tax.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.Locale;
import java.util.Map;

/** Small checks shared by the tax and document services. Every failure is the standard 400. */
public final class CommerceInputRules {

    public static final int MAX_PAGE_SIZE = 100;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CommerceInputRules() {
    }

    public static void require(boolean condition, String message) {
        if (!condition) {
            throw new InvalidRequestException(message);
        }
    }

    public static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** Null stays null (meaning "not sent"); anything else must be one of the enum names. */
    public static <E extends Enum<E>> E enumValue(Class<E> type, String value, String field) {
        String trimmed = trimToNull(value);
        if (trimmed == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, trimmed.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException(field + " has an unknown value: " + trimmed);
        }
    }

    /** A page request with the size capped at {@link #MAX_PAGE_SIZE}. */
    public static Pageable page(int page, int size, Sort sort) {
        require(page >= 0, "page cannot be negative");
        require(size >= 1 && size <= MAX_PAGE_SIZE, "size must be between 1 and " + MAX_PAGE_SIZE);
        return PageRequest.of(page, size, sort);
    }

    public static String json(Map<String, Object> detail) {
        try {
            return MAPPER.writeValueAsString(detail);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("commerce audit detail is not serialisable", e);
        }
    }
}
