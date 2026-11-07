package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.function.Consumer;

/**
 * Changes fields inside the raw {@code AI_CALLING_SETTING.data} object of one institute,
 * under a row lock on the institute, re-reading the stored settings after taking the lock.
 *
 * <p>Two writers used to read-modify-write this blob without coordination: the agent
 * registry bridge (AiAgentService) and, since the public API's default-agent endpoint, the
 * API. Both now go through here, so they serialise against each other and never write back
 * a copy read before the other's commit. Every other key of setting_json, and every field
 * of AI_CALLING_SETTING the change does not touch, is kept exactly as stored (the frontend
 * keeps fields the server pojo does not model, so a pojo round-trip is never used).
 *
 * <p>Not covered: the dashboard's settings page saves the WHOLE AI_CALLING_SETTING object it
 * loaded in the browser, without a version check. A page opened before an API change and
 * saved after it still puts the old value back; only a version check on that endpoint
 * could prevent it.
 */
@Service
@RequiredArgsConstructor
public class AiCallingSettingsMutator {

    static final String KEY = SettingKeyEnums.AI_CALLING_SETTING.name();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstituteRepository instituteRepository;
    private final InstituteSettingWriter settingWriter;

    @PersistenceContext
    private EntityManager entityManager;

    /** Applies {@code change} to the {@code data} object of AI_CALLING_SETTING and saves it. */
    @Transactional
    public void update(String instituteId, Consumer<ObjectNode> change, InstituteSettingWriter.Actor actor) {
        Institute institute = instituteRepository.findByIdForUpdate(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found"));
        if (entityManager != null) {
            // A copy loaded earlier in this request is not refreshed by the locking query.
            entityManager.refresh(institute);
        }
        ObjectNode entry = currentEntry(institute.getSetting());
        JsonNode data = entry.get("data");
        ObjectNode dataNode = data instanceof ObjectNode o ? o : entry.putObject("data");
        change.accept(dataNode);
        settingWriter.putSettingKey(institute, KEY, entry, actor);
    }

    /** A copy of the stored {key, name, data} entry, or a new one. */
    static ObjectNode currentEntry(String settingJson) {
        JsonNode existing = null;
        if (settingJson != null && !settingJson.isBlank()) {
            try {
                JsonNode root = MAPPER.readTree(settingJson);
                existing = root == null || root.get("setting") == null ? null : root.get("setting").get(KEY);
            } catch (Exception e) {
                throw new VacademyException("Institute settings are not valid JSON; refusing to overwrite them.");
            }
        }
        if (existing instanceof ObjectNode o) return o.deepCopy();
        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("key", KEY);
        entry.put("name", "AI Calling Settings");
        entry.putObject("data");
        return entry;
    }
}
