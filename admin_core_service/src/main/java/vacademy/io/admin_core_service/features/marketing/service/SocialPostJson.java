package vacademy.io.admin_core_service.features.marketing.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostMediaDTO;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reads and writes the JSON columns of social_post: media_json
 * {@code [{"file_id","type","name"}]} and overrides_json {@code {"PLATFORM":"text"}}.
 * Unreadable JSON reads as empty (a broken row must not break the whole list).
 */
public final class SocialPostJson {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SocialPostJson() {
    }

    public static List<SocialPostMediaDTO> readMedia(String json) {
        List<SocialPostMediaDTO> out = new ArrayList<>();
        if (json == null || json.isBlank()) return out;
        try {
            JsonNode root = MAPPER.readTree(json);
            if (root == null || !root.isArray()) return out;
            for (JsonNode n : root) {
                String fileId = n.path("file_id").asText(null);
                if (fileId == null || fileId.isBlank()) continue;
                out.add(SocialPostMediaDTO.builder()
                        .fileId(fileId)
                        .type(n.path("type").asText(MarketingConstants.MEDIA_TYPE_IMAGE).toUpperCase(Locale.ROOT))
                        .name(n.hasNonNull("name") ? n.get("name").asText() : null)
                        .build());
            }
        } catch (Exception e) {
            return new ArrayList<>();
        }
        return out;
    }

    /** Stores file_id, type and name only (never a URL). Null for no media. */
    public static String writeMedia(List<SocialPostMediaDTO> media) {
        if (media == null || media.isEmpty()) return null;
        List<Map<String, String>> rows = new ArrayList<>();
        for (SocialPostMediaDTO m : media) {
            Map<String, String> row = new LinkedHashMap<>();
            row.put("file_id", m.getFileId());
            row.put("type", m.getType());
            if (m.getName() != null) row.put("name", m.getName());
            rows.add(row);
        }
        return write(rows);
    }

    public static Map<String, String> readOverrides(String json) {
        Map<String, String> out = new LinkedHashMap<>();
        if (json == null || json.isBlank()) return out;
        try {
            Map<String, Object> raw = MAPPER.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {
            });
            for (Map.Entry<String, Object> e : raw.entrySet()) {
                if (e.getKey() == null || e.getValue() == null) continue;
                String text = String.valueOf(e.getValue());
                if (!text.isBlank()) out.put(e.getKey().toUpperCase(Locale.ROOT), text);
            }
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
        return out;
    }

    /** Null for no overrides. */
    public static String writeOverrides(Map<String, String> overrides) {
        if (overrides == null || overrides.isEmpty()) return null;
        return write(overrides);
    }

    private static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("Could not serialise social post JSON", e);
        }
    }
}
