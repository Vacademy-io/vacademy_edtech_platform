package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/** Small checks shared by the catalogue services. Every failure is the standard 400. */
final class CatalogueRules {

    static final int MAX_PAGE_SIZE = 100;
    /** Longest texts of one product in one language. The public shop keeps and serves them. */
    static final int MAX_SHORT_DESCRIPTION_CHARS = 2_000;
    static final int MAX_DESCRIPTION_HTML_CHARS = 100_000;
    static final int MAX_CONTENT_BLOCKS = 30;
    static final int MAX_CONTENT_BLOCKS_CHARS = 200_000;

    /** Refuses product text that is longer than a product page can reasonably hold. */
    static void requireTextSizes(String shortDescription, String descriptionHtml, Object contentBlocks) {
        require(shortDescription == null || shortDescription.length() <= MAX_SHORT_DESCRIPTION_CHARS,
                "a short description is at most " + MAX_SHORT_DESCRIPTION_CHARS + " characters");
        require(descriptionHtml == null || descriptionHtml.length() <= MAX_DESCRIPTION_HTML_CHARS,
                "a description is at most " + MAX_DESCRIPTION_HTML_CHARS + " characters");
        if (contentBlocks != null) {
            require(!(contentBlocks instanceof java.util.Collection<?> list) || list.size() <= MAX_CONTENT_BLOCKS,
                    "a product has at most " + MAX_CONTENT_BLOCKS + " content blocks per language");
            require(String.valueOf(contentBlocks).length() <= MAX_CONTENT_BLOCKS_CHARS,
                    "the content blocks of one language hold at most " + MAX_CONTENT_BLOCKS_CHARS + " characters");
        }
    }


    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Pattern SLUG = Pattern.compile("^[\\p{L}\\p{M}\\p{N}]+(-[\\p{L}\\p{M}\\p{N}]+)*$");
    private static final Pattern CODE = Pattern.compile("^[a-z0-9]+(_[a-z0-9]+)*$");
    private static final Pattern MEDIA_ID = Pattern.compile("^[A-Za-z0-9_-]{1,36}$");
    private static final Pattern LOCALE = Pattern.compile("^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$");

    private CatalogueRules() {
    }

    static void require(boolean condition, String message) {
        if (!condition) {
            throw new InvalidRequestException(message);
        }
    }

    static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** Null stays null (meaning "not sent"); anything else must be one of the enum names. */
    /**
     * A media-service file id, or null. Shape only here. Whether the file may be shown is
     * decided where a public copy would be made: the media service makes renditions only of a
     * file uploaded as a product image for this institute or this product, and the storefront
     * leaves out a gallery row whose file was refused there.
     */
    static String mediaId(String value) {
        String id = trimToNull(value);
        require(id == null || MEDIA_ID.matcher(id).matches(), "media_id is not a valid file id");
        return id;
    }

    static <E extends Enum<E>> String enumName(Class<E> type, String value, String field) {
        String trimmed = trimToNull(value);
        if (trimmed == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, trimmed.toUpperCase(Locale.ROOT)).name();
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException(field + " has an unknown value: " + trimmed);
        }
    }

    static void requireNotNegative(Integer value, String field) {
        require(value == null || value >= 0, field + " cannot be negative");
    }

    static String requireSlug(String value) {
        String slug = value.trim().toLowerCase(Locale.ROOT);
        require(slug.length() <= 200 && SLUG.matcher(slug).matches(),
                "slug may hold letters, digits and single hyphens only");
        return slug;
    }

    /** A slug from a name; empty when the name has no letter or digit. */
    static String slugFrom(String name) {
        if (name == null) {
            return "";
        }
        String slug = name.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[^\\p{L}\\p{M}\\p{N}]+", "-")
                .replaceAll("^-+|-+$", "");
        return slug.length() > 180 ? slug.substring(0, 180).replaceAll("-+$", "") : slug;
    }

    static String randomSuffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    static String requireCode(String value, String field) {
        String code = trimToNull(value);
        require(code != null, field + " is required");
        code = code.toLowerCase(Locale.ROOT);
        require(code.length() <= 64 && CODE.matcher(code).matches(),
                field + " may hold lower-case letters, digits and underscores only");
        return code;
    }

    static String requireLocale(String value) {
        String locale = trimToNull(value);
        require(locale != null && LOCALE.matcher(locale).matches(), "locale is missing or malformed");
        return locale;
    }

    /** A {locale: text} map with blank entries dropped; null when nothing is left. */
    static Map<String, String> cleanI18n(Map<String, String> input) {
        if (input == null) {
            return null;
        }
        Map<String, String> out = new LinkedHashMap<>();
        input.forEach((locale, text) -> {
            String cleaned = trimToNull(text);
            if (cleaned != null) {
                out.put(requireLocale(locale), cleaned);
            }
        });
        return out.isEmpty() ? null : out;
    }

    static Pageable page(int page, int size, Sort sort) {
        require(page >= 0, "page cannot be negative");
        require(size >= 1 && size <= MAX_PAGE_SIZE, "size must be between 1 and " + MAX_PAGE_SIZE);
        return PageRequest.of(page, size, sort);
    }

    static String json(Map<String, Object> detail) {
        try {
            return MAPPER.writeValueAsString(detail);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("commerce audit detail is not serialisable", e);
        }
    }
}
