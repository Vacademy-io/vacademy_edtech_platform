package vacademy.io.admin_core_service.features.institute.setting_history;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * THE one place that writes {@code institutes.setting_json} (spec §5, §12.3). Every writer —
 * the generic save-setting path, the NAMING / CERTIFICATE / CUSTOM_FIELD / ROLE_DISPLAY
 * strategies, the WhatsApp and lead-workbench writers, and the super-admin display-settings
 * and restore endpoints — hands its new blob to {@link #save}. It persists the institute and,
 * in the same transaction, records one {@link InstituteSettingHistory} row per top-level
 * setting key whose value changed, holding the old and new value of THAT key only.
 *
 * <p>Actor and source: tenant writers pass nothing and get {@link Actor#fromRequest()} — the
 * signed-in user of the current request (null outside a request, e.g. institute creation
 * jobs), source TENANT. Platform writers pass {@link Actor#platform}.
 */
@Slf4j
@Service
public class InstituteSettingWriter {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstituteRepository instituteRepository;
    private final InstituteSettingHistoryRepository historyRepository;
    private Clock clock = Clock.systemUTC();

    public InstituteSettingWriter(InstituteRepository instituteRepository,
                                  InstituteSettingHistoryRepository historyRepository) {
        this.instituteRepository = instituteRepository;
        this.historyRepository = historyRepository;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    /** Who made a write. {@code reason} is required for platform writes, optional otherwise. */
    public record Actor(String source, String userId, String reason) {

        public static Actor platform(String userId, String reason) {
            return new Actor(InstituteSettingHistory.SOURCE_PLATFORM, userId, reason);
        }

        public static Actor tenant(String userId) {
            return new Actor(InstituteSettingHistory.SOURCE_TENANT, userId, null);
        }

        /** The request's signed-in user (the JwtAuthFilter "user" attribute), source TENANT. */
        public static Actor fromRequest() {
            String userId = null;
            RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
            if (attributes != null) {
                Object user = attributes.getAttribute("user", RequestAttributes.SCOPE_REQUEST);
                if (user instanceof CustomUserDetails details) {
                    userId = details.getUserId();
                }
            }
            return tenant(userId);
        }
    }

    /** The saved institute and the history rows written (empty when no key changed). */
    public record WriteResult(Institute institute, List<InstituteSettingHistory> history) {
    }

    /** Tenant write: actor from the current request, source TENANT. */
    @Transactional
    public WriteResult save(Institute institute, String newSettingJson) {
        return save(institute, newSettingJson, Actor.fromRequest());
    }

    /**
     * Sets {@code institute.setting_json = newSettingJson}, saves the institute and records the
     * per-key history rows, in one transaction.
     */
    @Transactional
    public WriteResult save(Institute institute, String newSettingJson, Actor actor) {
        String oldSettingJson = institute.getSetting();
        institute.setSetting(newSettingJson);
        Institute saved = instituteRepository.save(institute);
        List<InstituteSettingHistory> history = recordChanges(institute.getId(), oldSettingJson, newSettingJson, actor);
        return new WriteResult(saved, history);
    }

    /**
     * Replaces (or, with {@code value == null}, removes) one top-level key in
     * {@code setting_json.setting}, leaving every other key byte-for-byte as parsed. Used by the
     * platform display-settings write and by restore.
     */
    @Transactional
    public WriteResult putSettingKey(Institute institute, String settingKey, JsonNode value, Actor actor) {
        ObjectNode root = parseRoot(institute.getSetting(), institute.getId());
        ObjectNode settings = root.has("setting") && root.get("setting").isObject()
                ? (ObjectNode) root.get("setting")
                : root.putObject("setting");
        if (value == null || value.isNull()) {
            settings.remove(settingKey);
        } else {
            settings.set(settingKey, value);
        }
        try {
            return save(institute, MAPPER.writeValueAsString(root), actor);
        } catch (JsonProcessingException e) {
            throw new VacademyException("Could not serialise institute settings: " + e.getMessage());
        }
    }

    /** Writes one history row per changed key. Returns the rows written. */
    List<InstituteSettingHistory> recordChanges(String instituteId, String oldJson, String newJson, Actor actor) {
        if (Objects.equals(oldJson, newJson)) {
            return List.of();
        }
        Map<String, JsonNode> before = settingNodes(oldJson);
        Map<String, JsonNode> after = settingNodes(newJson);
        Set<String> keys = new LinkedHashSet<>(before.keySet());
        keys.addAll(after.keySet());
        Actor who = actor != null ? actor : Actor.fromRequest();
        Instant now = Instant.now(clock);
        List<InstituteSettingHistory> rows = new ArrayList<>();
        for (String key : keys) {
            JsonNode oldNode = before.get(key);
            JsonNode newNode = after.get(key);
            if (Objects.equals(oldNode, newNode)) {
                continue;
            }
            rows.add(InstituteSettingHistory.builder()
                    .id(UUID.randomUUID().toString())
                    .instituteId(instituteId)
                    .settingKey(key)
                    .oldValue(oldNode == null ? null : oldNode.toString())
                    .newValue(newNode == null ? null : newNode.toString())
                    .actor(who.userId())
                    .source(who.source())
                    .reason(who.reason())
                    .createdAt(now)
                    .build());
        }
        if (!rows.isEmpty()) {
            historyRepository.saveAll(rows);
        }
        return rows;
    }

    /**
     * The {@code setting} map of a setting_json blob, key -> node. Empty for null, blank or
     * unparseable input (an unparseable old blob then shows every new key as added).
     */
    public static Map<String, JsonNode> settingNodes(String settingJson) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        if (!StringUtils.hasText(settingJson)) {
            return out;
        }
        try {
            JsonNode root = MAPPER.readTree(settingJson);
            JsonNode settings = root == null ? null : root.get("setting");
            if (settings != null && settings.isObject()) {
                Iterator<Map.Entry<String, JsonNode>> it = settings.fields();
                while (it.hasNext()) {
                    Map.Entry<String, JsonNode> e = it.next();
                    out.put(e.getKey(), e.getValue());
                }
            }
        } catch (JsonProcessingException e) {
            log.warn("Unparseable institute setting_json while diffing: {}", e.getMessage());
        }
        return out;
    }

    private static ObjectNode parseRoot(String settingJson, String instituteId) {
        if (StringUtils.hasText(settingJson)) {
            try {
                JsonNode root = MAPPER.readTree(settingJson);
                if (root != null && root.isObject()) {
                    return (ObjectNode) root;
                }
            } catch (JsonProcessingException e) {
                throw new VacademyException("Institute settings are not valid JSON; refusing to overwrite them: "
                        + e.getMessage());
            }
        }
        ObjectNode root = MAPPER.createObjectNode();
        root.put("institute_id", instituteId);
        root.putObject("setting");
        return root;
    }
}
