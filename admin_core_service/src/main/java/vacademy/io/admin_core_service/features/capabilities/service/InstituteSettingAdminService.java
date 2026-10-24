package vacademy.io.admin_core_service.features.capabilities.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute.util.PublicSettingRedactor;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingHistory;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingHistoryRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Super-admin reads and writes of institute settings (spec §12.3): role display settings with
 * a version check, and the setting history with restore. Callers must already have passed
 * {@code SuperAdminAuthUtil.requireSuperAdmin}. Every write goes through
 * {@link InstituteSettingWriter} as source PLATFORM with the caller's reason, under a row lock
 * on the institute.
 */
@Slf4j
@Service
public class InstituteSettingAdminService {

    public static final int MAX_HISTORY_PAGE_SIZE = 100;
    /** Caches that hold a copy of setting_json (see InstituteSettingManager.saveGenericSetting). */
    static final List<String> INSTITUTE_CACHES =
            List.of("openInstituteDetails", "openInstituteDetailsNonBatches", "instituteById");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstituteRepository instituteRepository;
    private final InstituteSettingWriter settingWriter;
    private final InstituteSettingHistoryRepository historyRepository;
    private final CacheManager cacheManager;

    public InstituteSettingAdminService(InstituteRepository instituteRepository,
                                        InstituteSettingWriter settingWriter,
                                        InstituteSettingHistoryRepository historyRepository,
                                        CacheManager cacheManager) {
        this.instituteRepository = instituteRepository;
        this.settingWriter = settingWriter;
        this.historyRepository = historyRepository;
        this.cacheManager = cacheManager;
    }

    // ── Display settings ─────────────────────────────────────────────────────

    /** GET /institutes/{id}/display-settings?role_key= → {role_key, data, version}. */
    @Transactional(readOnly = true)
    public Map<String, Object> getDisplaySettings(String instituteId, String roleKey) {
        DisplaySettingsFormat.RoleTarget target = DisplaySettingsFormat.parseRoleKey(roleKey);
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Institute not found."));
        JsonNode data = DisplaySettingsFormat.roleData(InstituteSettingWriter.settingNodes(institute.getSetting()),
                target);
        return displayView(target, data);
    }

    /**
     * PUT /institutes/{id}/display-settings?role_key= body {data, expected_version, reason}.
     * {@code data: null} removes the role's blob (the admin app then falls back to its defaults).
     * Throws {@link VersionConflictException} when {@code expected_version} is not the current
     * version of THAT role's blob.
     */
    @Transactional
    public Map<String, Object> putDisplaySettings(String instituteId, String roleKey, JsonNode body,
                                                  String actorUserId) {
        DisplaySettingsFormat.RoleTarget target = DisplaySettingsFormat.parseRoleKey(roleKey);
        if (body == null || !body.isObject()) {
            throw badRequest("Request body is required.");
        }
        String reason = InstituteModuleService.requireReason(body.get("reason"));
        if (!body.has("data")) {
            throw badRequest("data is required (null resets the role to the app defaults).");
        }
        JsonNode data = body.get("data");
        if (!data.isNull() && !data.isObject()) {
            throw badRequest("data must be an object or null.");
        }
        JsonNode expectedNode = body.get("expected_version");
        if (expectedNode == null || !expectedNode.isTextual() || expectedNode.asText().isBlank()) {
            throw badRequest("expected_version is required: send the version from the last GET.");
        }

        Institute institute = instituteRepository.findByIdForUpdate(instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Institute not found."));
        Map<String, JsonNode> settings = InstituteSettingWriter.settingNodes(institute.getSetting());
        JsonNode current = DisplaySettingsFormat.roleData(settings, target);
        String currentVersion = DisplaySettingsFormat.version(current);
        if (!currentVersion.equals(expectedNode.asText().trim())) {
            throw new VersionConflictException(currentVersion);
        }

        JsonNode newData = data.isNull() ? null : data;
        JsonNode newEntry = buildSettingEntry(settings.get(target.settingKey()), target, newData);
        settingWriter.putSettingKey(institute, target.settingKey(), newEntry,
                InstituteSettingWriter.Actor.platform(actorUserId, reason));
        evictInstituteCaches(instituteId);
        return displayView(target, newData);
    }

    /**
     * The new {@code setting.<KEY>} value, in exactly the admin app's shape: {key, name, data}.
     * Keeps a stored name; for custom roles replaces only that role's entry in the map. Returns
     * null (remove the key) when an ADMIN/TEACHER blob is reset.
     */
    static JsonNode buildSettingEntry(JsonNode existingEntry, DisplaySettingsFormat.RoleTarget target,
                                      JsonNode newData) {
        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("key", target.settingKey());
        JsonNode existingName = existingEntry == null ? null : existingEntry.get("name");
        entry.put("name", existingName != null && existingName.isTextual() ? existingName.asText()
                : target.settingName());
        if (!target.custom()) {
            if (newData == null) {
                return null;
            }
            entry.set("data", newData);
            return entry;
        }
        JsonNode existingData = existingEntry == null ? null : existingEntry.get("data");
        ObjectNode roles = existingData != null && existingData.isObject()
                ? ((ObjectNode) existingData).deepCopy()
                : MAPPER.createObjectNode();
        if (newData == null) {
            roles.remove(target.customRoleId());
        } else {
            roles.set(target.customRoleId(), newData);
        }
        entry.set("data", roles);
        return entry;
    }

    private static Map<String, Object> displayView(DisplaySettingsFormat.RoleTarget target, JsonNode data) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("role_key", target.roleKey());
        out.put("data", data);
        out.put("version", DisplaySettingsFormat.version(data));
        return out;
    }

    // ── Setting history ──────────────────────────────────────────────────────

    /** GET /institutes/{id}/settings/history?setting_key=&page=&size=. */
    @Transactional(readOnly = true)
    public Map<String, Object> history(String instituteId, String settingKey, int page, int size) {
        PageRequest pageRequest = PageRequest.of(Math.max(0, page),
                Math.max(1, Math.min(MAX_HISTORY_PAGE_SIZE, size)));
        Page<InstituteSettingHistory> rows = settingKey == null || settingKey.isBlank()
                ? historyRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId, pageRequest)
                : historyRepository.findByInstituteIdAndSettingKeyOrderByCreatedAtDesc(instituteId,
                settingKey.trim(), pageRequest);
        List<Map<String, Object>> content = new ArrayList<>();
        rows.getContent().forEach(h -> content.add(summary(h)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("content", content);
        out.put("total_elements", rows.getTotalElements());
        out.put("total_pages", rows.getTotalPages());
        out.put("number", rows.getNumber());
        out.put("size", rows.getSize());
        return out;
    }

    /** GET /institutes/{id}/settings/history/{hid}: summary + old_value, new_value, reason. */
    @Transactional(readOnly = true)
    public Map<String, Object> historyEntry(String instituteId, String historyId) {
        return detail(findHistory(instituteId, historyId));
    }

    /**
     * POST /institutes/{id}/settings/history/{hid}/restore body {reason}: puts the entry's
     * old_value back as the key's value (removes the key when old_value is null). Goes through
     * the same writer, so the restore itself is a new history row (source PLATFORM).
     */
    @Transactional
    public Map<String, Object> restore(String instituteId, String historyId, JsonNode body, String actorUserId) {
        if (body == null || !body.isObject()) {
            throw badRequest("Request body is required.");
        }
        String reason = InstituteModuleService.requireReason(body.get("reason"));
        InstituteSettingHistory entry = findHistory(instituteId, historyId);
        JsonNode value;
        try {
            value = entry.getOldValue() == null ? null : MAPPER.readTree(entry.getOldValue());
        } catch (JsonProcessingException e) {
            throw badRequest("Stored old value is not valid JSON; cannot restore.");
        }
        Institute institute = instituteRepository.findByIdForUpdate(instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Institute not found."));
        InstituteSettingWriter.WriteResult result = settingWriter.putSettingKey(institute, entry.getSettingKey(),
                value, InstituteSettingWriter.Actor.platform(actorUserId,
                        reason + " [restore of " + entry.getId() + "]"));
        evictInstituteCaches(instituteId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("restored_from", entry.getId());
        out.put("setting_key", entry.getSettingKey());
        out.put("changed", !result.history().isEmpty());
        out.put("history", result.history().isEmpty() ? null : detail(result.history().get(0)));
        return out;
    }

    private InstituteSettingHistory findHistory(String instituteId, String historyId) {
        return historyRepository.findByIdAndInstituteId(historyId, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "History entry not found."));
    }

    private static Map<String, Object> summary(InstituteSettingHistory h) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", h.getId());
        row.put("setting_key", h.getSettingKey());
        row.put("actor_user_id", h.getActor());
        row.put("source", h.getSource());
        row.put("created_at", InstituteModuleService.iso(h.getCreatedAt()));
        return row;
    }

    private static Map<String, Object> detail(InstituteSettingHistory h) {
        Map<String, Object> row = summary(h);
        // Stored raw so a restore puts real credentials back; shown with them blanked
        // (SMTP password, WhatsApp apiKey, LMS tokens live in these values).
        row.put("old_value", PublicSettingRedactor.redact(h.getOldValue()));
        row.put("new_value", PublicSettingRedactor.redact(h.getNewValue()));
        row.put("reason", h.getReason());
        return row;
    }

    private void evictInstituteCaches(String instituteId) {
        for (String name : INSTITUTE_CACHES) {
            Cache cache = cacheManager.getCache(name);
            if (cache != null) {
                cache.evict(instituteId);
            }
        }
    }

    private static VacademyException badRequest(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }
}
