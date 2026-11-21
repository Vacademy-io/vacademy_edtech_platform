package vacademy.io.admin_core_service.features.capabilities.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * How the admin app stores role display settings in {@code institutes.setting_json} — mirrored
 * exactly so a platform edit reads back unchanged in the admin app
 * (frontend-admin-dashboard/src/services/display-settings.ts, saveDisplaySettings /
 * getDisplaySettings):
 *
 * <pre>
 * setting.ADMIN_DISPLAY_SETTINGS   = {key, name: "Admin Display Settings",   data: DisplaySettingsData}
 * setting.TEACHER_DISPLAY_SETTINGS = {key, name: "Teacher Display Settings", data: DisplaySettingsData}
 * setting.ROLE_DISPLAY_SETTINGS    = {key, name: "Role Display Settings",
 *                                     data: {"&lt;auth roles.id&gt;": DisplaySettingsData, ...}}
 * </pre>
 *
 * The admin app writes these through {@code POST /institute/setting/v1/save-setting} with
 * {@code {setting_name, setting_data}} (generic strategy); custom roles are saved by
 * re-posting the whole ROLE_DISPLAY_SETTINGS map with one entry replaced. Note the key is
 * ROLE_DISPLAY_SETTINGS (plural), not the unused {@code SettingKeyEnums.ROLE_DISPLAY_SETTING}.
 */
public final class DisplaySettingsFormat {

    public static final String ADMIN_KEY = "ADMIN_DISPLAY_SETTINGS";
    public static final String TEACHER_KEY = "TEACHER_DISPLAY_SETTINGS";
    public static final String ROLE_KEY = "ROLE_DISPLAY_SETTINGS";
    public static final List<String> ALL_KEYS = List.of(ADMIN_KEY, TEACHER_KEY, ROLE_KEY);

    static final String CUSTOM_PREFIX = "CUSTOM:";

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final ObjectMapper CANONICAL = new ObjectMapper()
            .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    private DisplaySettingsFormat() {
    }

    /**
     * A parsed {@code role_key}: ADMIN, TEACHER or CUSTOM:&lt;roleId&gt;.
     *
     * @param roleKey     normalised role key echoed in responses
     * @param settingKey  institute setting key that holds it
     * @param settingName name the admin app writes for that key
     * @param customRoleId role id inside ROLE_DISPLAY_SETTINGS, null for ADMIN/TEACHER
     */
    public record RoleTarget(String roleKey, String settingKey, String settingName, String customRoleId) {

        public boolean custom() {
            return customRoleId != null;
        }
    }

    public static RoleTarget parseRoleKey(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "role_key is required (ADMIN, TEACHER or CUSTOM:<roleId>).");
        }
        String value = raw.trim();
        String upper = value.toUpperCase(Locale.ROOT);
        if (upper.equals("ADMIN")) {
            return new RoleTarget("ADMIN", ADMIN_KEY, "Admin Display Settings", null);
        }
        if (upper.equals("TEACHER")) {
            return new RoleTarget("TEACHER", TEACHER_KEY, "Teacher Display Settings", null);
        }
        if (upper.startsWith(CUSTOM_PREFIX)) {
            String roleId = value.substring(CUSTOM_PREFIX.length()).trim();
            // '+' separates role ids in the admin app's merged custom-role cache key.
            if (roleId.isEmpty() || roleId.length() > 255 || roleId.contains("+")) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "Invalid custom role id in role_key.");
            }
            return new RoleTarget(CUSTOM_PREFIX + roleId, ROLE_KEY, "Role Display Settings", roleId);
        }
        throw new VacademyException(HttpStatus.BAD_REQUEST, "role_key must be ADMIN, TEACHER or CUSTOM:<roleId>.");
    }

    /** The stored blob for a role, or null. {@code settings} = the setting map of setting_json. */
    public static JsonNode roleData(Map<String, JsonNode> settings, RoleTarget target) {
        JsonNode entry = settings.get(target.settingKey());
        JsonNode data = entry == null ? null : entry.get("data");
        if (data == null || data.isNull()) {
            return null;
        }
        if (target.custom()) {
            JsonNode roleData = data.isObject() ? data.get(target.customRoleId()) : null;
            return roleData == null || roleData.isNull() ? null : roleData;
        }
        return data;
    }

    /** Version of one role's blob: hash of its canonical JSON (a null blob has a version too). */
    public static String version(JsonNode data) {
        return hash(canonical(data));
    }

    /**
     * {@code display_settings_version} of /capabilities/me: hash of the stored ADMIN, TEACHER and
     * ROLE display keys; null when none is stored.
     */
    public static String displaySettingsVersion(Map<String, JsonNode> settings) {
        Map<String, Object> present = new LinkedHashMap<>();
        for (String key : ALL_KEYS) {
            JsonNode node = settings.get(key);
            if (node != null && !node.isNull()) {
                present.put(key, toObject(node));
            }
        }
        if (present.isEmpty()) {
            return null;
        }
        try {
            return hash(CANONICAL.writeValueAsString(present));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    static String canonical(JsonNode node) {
        try {
            return CANONICAL.writeValueAsString(node == null ? null : toObject(node));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Object toObject(JsonNode node) {
        try {
            return MAPPER.treeToValue(node, Object.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String hash(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest, 0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
