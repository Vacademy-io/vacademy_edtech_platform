package vacademy.io.admin_core_service.features.institute.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StringUtils;

import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Strips credentials out of {@code institutes.setting_json} before it leaves through the
 * PUBLIC (no login) institute details endpoints.
 *
 * <p>The blob holds every setting key at once, and some keys carry provider secrets
 * (EMAIL_SETTING SMTP password, WHATSAPP_SETTING apiKey, LMS/Moodle tokens). The public
 * details response is cached by browsers and CDNs for 10 minutes and needs nothing but the
 * institute id, so those values were readable by anyone.
 *
 * <p>Every non-empty STRING value whose field name looks like a credential is blanked; the
 * structure, booleans (e.g. {@code allowViewPassword}) and every other field are kept, so
 * learner-side readers of display/theme/naming settings see no change.
 */
@Slf4j
public final class PublicSettingRedactor {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * Suffixes of credential field names, compared against the name lower-cased with '_' and
     * '-' removed. A suffix (not a substring) match keeps configuration such as the learner
     * signup's {@code passwordStrategy} / {@code passwordDelivery} intact.
     */
    private static final List<String> SECRET_NAME_SUFFIXES = List.of(
            "password", "passwd", "secret", "apikey", "token", "privatekey", "credential",
            "credentials", "authkey");

    private PublicSettingRedactor() {
    }

    /** The setting JSON with credential values blanked; null when it is blank or unreadable. */
    public static String redact(String settingJson) {
        if (!StringUtils.hasText(settingJson)) {
            return settingJson;
        }
        try {
            JsonNode root = MAPPER.readTree(settingJson);
            redactNode(root);
            return MAPPER.writeValueAsString(root);
        } catch (Exception e) {
            // Never fall back to the raw blob on a public endpoint.
            log.warn("Could not parse institute setting JSON for public redaction: {}", e.getMessage());
            return null;
        }
    }

    static boolean isSecretFieldName(String fieldName) {
        if (fieldName == null) {
            return false;
        }
        String normalized = fieldName.toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
        for (String suffix : SECRET_NAME_SUFFIXES) {
            if (normalized.endsWith(suffix)) {
                return true;
            }
        }
        return false;
    }

    private static void redactNode(JsonNode node) {
        if (node instanceof ObjectNode object) {
            Iterator<Map.Entry<String, JsonNode>> fields = object.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                JsonNode value = field.getValue();
                if (value.isTextual() && !value.asText().isEmpty() && isSecretFieldName(field.getKey())) {
                    field.setValue(object.textNode(""));
                } else {
                    redactNode(value);
                }
            }
        } else if (node instanceof ArrayNode array) {
            for (JsonNode item : array) {
                redactNode(item);
            }
        }
    }
}
