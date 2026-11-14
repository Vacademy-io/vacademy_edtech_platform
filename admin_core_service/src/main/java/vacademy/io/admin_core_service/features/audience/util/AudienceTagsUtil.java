package vacademy.io.admin_core_service.features.audience.util;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Shape and validation of the key -> value tags on a lead list ({@code audience.tags_json}).
 *
 * <p>Tags are a flat JSON object of string -> string, one value per key, e.g.
 * {@code {"channel":"WhatsApp","course":"MBA","state":"Maharashtra"}}. Reports group leads
 * by a tag key, so keys are normalised to one spelling: trimmed, lower-cased, runs of
 * spaces / hyphens turned into {@code _}, and limited to {@code [a-z0-9_]{1,40}}. Values are
 * trimmed, 1-60 characters, with no control characters. A null or blank value removes the key.
 * At most {@value #MAX_TAGS} keys per list. Stored as canonical JSON with sorted keys, or
 * NULL when the list has no tags.
 */
public final class AudienceTagsUtil {

    private static final Logger logger = LoggerFactory.getLogger(AudienceTagsUtil.class);

    public static final int MAX_TAGS = 10;
    public static final int MAX_KEY_LENGTH = 40;
    public static final int MAX_VALUE_LENGTH = 60;

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z0-9_]{1," + MAX_KEY_LENGTH + "}$");
    private static final Pattern KEY_SEPARATORS = Pattern.compile("[\\s\\-]+");
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private AudienceTagsUtil() {
    }

    /**
     * Canonical form of a tag key: trimmed, lower-cased, runs of spaces / hyphens as one
     * {@code _}. Throws a 400 when the result is not {@code [a-z0-9_]{1,40}}.
     */
    public static String normalizeKey(String rawKey) {
        if (rawKey == null) {
            throw badRequest("Tag name is required.");
        }
        String key = KEY_SEPARATORS.matcher(rawKey.trim().toLowerCase(Locale.ROOT)).replaceAll("_");
        if (key.isEmpty()) {
            throw badRequest("Tag name is required.");
        }
        if (!KEY_PATTERN.matcher(key).matches()) {
            throw badRequest("Tag name \"" + rawKey.trim() + "\" is not valid. Use up to "
                    + MAX_KEY_LENGTH + " letters, numbers or underscores (for example: state, course, lead_source).");
        }
        return key;
    }

    /**
     * Validates and canonicalises a tag map. Null input means "no tags" and yields an empty
     * map. Entries with a null or blank value are dropped (that is how a key is removed).
     *
     * @return the tags sorted by key; never null
     * @throws VacademyException (400) on an invalid key or value, a key given twice after
     *                           normalisation, or more than {@value #MAX_TAGS} tags
     */
    public static SortedMap<String, String> normalize(Map<String, String> rawTags) {
        SortedMap<String, String> tags = new TreeMap<>();
        if (rawTags == null || rawTags.isEmpty()) {
            return tags;
        }
        Set<String> seenKeys = new HashSet<>();
        for (Map.Entry<String, String> entry : rawTags.entrySet()) {
            String key = normalizeKey(entry.getKey());
            if (!seenKeys.add(key)) {
                throw badRequest("Tag \"" + key + "\" is given more than once. A list can have one value per tag.");
            }
            String value = normalizeValue(key, entry.getValue());
            if (value != null) {
                tags.put(key, value);
            }
        }
        if (tags.size() > MAX_TAGS) {
            throw badRequest("A list can have at most " + MAX_TAGS + " tags (got " + tags.size() + ").");
        }
        return tags;
    }

    /** Trimmed value, or null when blank (the key is removed). Throws a 400 when invalid. */
    private static String normalizeValue(String key, String rawValue) {
        if (rawValue == null) {
            return null;
        }
        String value = rawValue.trim();
        if (value.isEmpty()) {
            return null;
        }
        if (value.codePointCount(0, value.length()) > MAX_VALUE_LENGTH) {
            throw badRequest("The value of tag \"" + key + "\" is too long. Use at most "
                    + MAX_VALUE_LENGTH + " characters.");
        }
        boolean hasControlChar = value.codePoints().anyMatch(Character::isISOControl);
        if (hasControlChar) {
            throw badRequest("The value of tag \"" + key + "\" contains a line break or other control character.");
        }
        return value;
    }

    /** Canonical JSON (keys sorted) for storage, or null when there are no tags. */
    public static String toJson(SortedMap<String, String> tags) {
        if (tags == null || tags.isEmpty()) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(tags);
        } catch (Exception e) {
            throw new VacademyException("Could not save tags: " + e.getMessage());
        }
    }

    /**
     * Reads a stored {@code tags_json} back, sorted by key. Tolerant: a null, blank or
     * unparsable column yields an empty map rather than failing the page that shows it, and
     * non-string values are skipped.
     */
    public static SortedMap<String, String> fromJson(String tagsJson) {
        SortedMap<String, String> tags = new TreeMap<>();
        if (tagsJson == null || tagsJson.isBlank()) {
            return tags;
        }
        try {
            Map<String, Object> parsed = MAPPER.readValue(tagsJson, MAP_TYPE);
            if (parsed == null) {
                return tags;
            }
            for (Map.Entry<String, Object> entry : parsed.entrySet()) {
                if (entry.getKey() != null && entry.getValue() instanceof String value && !value.isBlank()) {
                    tags.put(entry.getKey(), value);
                }
            }
        } catch (Exception e) {
            logger.warn("Ignoring unparsable audience tags_json: {}", e.getMessage());
            return new TreeMap<>();
        }
        return tags;
    }

    private static VacademyException badRequest(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }
}
