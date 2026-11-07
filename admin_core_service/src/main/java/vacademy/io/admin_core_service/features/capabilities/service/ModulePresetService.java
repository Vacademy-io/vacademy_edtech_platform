package vacademy.io.admin_core_service.features.capabilities.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.capabilities.entity.ModulePreset;
import vacademy.io.admin_core_service.features.capabilities.repository.ModulePresetRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Module presets (spec §12.3): named module sets, applied in bulk. Apply = listed modules
 * enabled, every other non-core module disabled; feature rows and mode untouched. Each
 * institute is applied in its own transaction ({@link InstituteModuleService#applyModuleSet}),
 * so one failure does not undo the others; failures are reported per institute.
 */
@Slf4j
@Service
public class ModulePresetService {

    public static final int MAX_APPLY_INSTITUTES = 500;
    private static final Pattern PRESET_KEY = Pattern.compile("[a-z][a-z0-9_]{0,63}");

    private final ModulePresetRepository presetRepository;
    private final CapabilityCatalogRegistry registry;
    private final InstituteModuleService moduleService;
    private Clock clock = Clock.systemUTC();

    public ModulePresetService(ModulePresetRepository presetRepository, CapabilityCatalogRegistry registry,
                               InstituteModuleService moduleService) {
        this.presetRepository = presetRepository;
        this.registry = registry;
        this.moduleService = moduleService;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
        presetRepository.findAllByOrderByKeyAsc().forEach(p -> out.add(toView(p)));
        return out;
    }

    /** PUT /module-presets/{key} body {name, description, modules}; creates or replaces. */
    @Transactional
    public Map<String, Object> upsert(String key, JsonNode body, String actorUserId) {
        if (key == null || !PRESET_KEY.matcher(key).matches()) {
            throw badRequest("Preset key must match " + PRESET_KEY.pattern() + ".");
        }
        if (body == null || !body.isObject()) {
            throw badRequest("Request body is required.");
        }
        JsonNode nameNode = body.get("name");
        if (nameNode == null || !nameNode.isTextual() || nameNode.asText().isBlank()) {
            throw badRequest("name is required.");
        }
        JsonNode descriptionNode = body.get("description");
        String description = descriptionNode == null || descriptionNode.isNull() ? null : descriptionNode.asText();
        List<String> modules = parseModules(body.get("modules"));

        ModulePreset preset = presetRepository.findById(key)
                .orElseGet(() -> ModulePreset.builder().key(key).build());
        preset.setName(nameNode.asText().trim());
        preset.setDescription(description);
        Map<String, Object> entitlements = new LinkedHashMap<>();
        entitlements.put("modules", modules);
        preset.setEntitlements(entitlements);
        preset.setUpdatedBy(actorUserId);
        preset.setUpdatedAt(Instant.now(clock));
        return toView(presetRepository.save(preset));
    }

    @Transactional
    public void delete(String key) {
        if (!presetRepository.existsById(key)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Preset not found: " + key);
        }
        presetRepository.deleteById(key);
    }

    /**
     * POST /module-presets/{key}/apply body {institute_ids, reason} →
     * {applied:[id], failed:[{institute_id, error}]}. Not transactional itself on purpose.
     */
    public Map<String, Object> apply(String key, JsonNode body, String actorUserId) {
        if (body == null || !body.isObject()) {
            throw badRequest("Request body is required.");
        }
        String reason = InstituteModuleService.requireReason(body.get("reason"));
        JsonNode idsNode = body.get("institute_ids");
        if (idsNode == null || !idsNode.isArray() || idsNode.isEmpty()) {
            throw badRequest("institute_ids must be a non-empty array.");
        }
        Set<String> ids = new LinkedHashSet<>();
        for (JsonNode id : idsNode) {
            if (!id.isTextual() || id.asText().isBlank()) {
                throw badRequest("institute_ids must contain institute ids.");
            }
            ids.add(id.asText().trim());
        }
        if (ids.size() > MAX_APPLY_INSTITUTES) {
            throw badRequest("At most " + MAX_APPLY_INSTITUTES + " institutes per request.");
        }
        ModulePreset preset = presetRepository.findById(key)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Preset not found: " + key));
        List<String> modules = presetModules(preset);
        for (String m : modules) {
            if (!registry.isModule(m)) {
                // A module key removed from the catalogue after the preset was saved.
                throw badRequest("Preset '" + key + "' lists unknown module '" + m + "'; fix the preset first.");
            }
        }
        String fullReason = reason + " [preset " + key + "]";
        List<String> applied = new ArrayList<>();
        List<Map<String, Object>> failed = new ArrayList<>();
        for (String instituteId : ids) {
            try {
                moduleService.applyModuleSet(instituteId, modules, fullReason, actorUserId);
                applied.add(instituteId);
            } catch (Exception e) {
                log.warn("Preset {} apply failed for institute {}: {}", key, instituteId, e.getMessage());
                Map<String, Object> f = new LinkedHashMap<>();
                f.put("institute_id", instituteId);
                f.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                failed.add(f);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("applied", applied);
        out.put("failed", failed);
        return out;
    }

    private List<String> parseModules(JsonNode node) {
        if (node == null || !node.isArray()) {
            throw badRequest("modules must be an array of module keys.");
        }
        Set<String> out = new LinkedHashSet<>();
        for (JsonNode m : node) {
            String key = m.isTextual() ? m.asText().trim() : null;
            if (key == null || !registry.isModule(key)) {
                throw badRequest("Unknown module key: " + (key == null ? m.toString() : key));
            }
            out.add(key);
        }
        return new ArrayList<>(out);
    }

    @SuppressWarnings("unchecked")
    static List<String> presetModules(ModulePreset preset) {
        Object modules = preset.getEntitlements() == null ? null : preset.getEntitlements().get("modules");
        List<String> out = new ArrayList<>();
        if (modules instanceof List<?> list) {
            for (Object o : list) {
                if (o != null) {
                    out.add(o.toString());
                }
            }
        }
        return out;
    }

    private Map<String, Object> toView(ModulePreset p) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("key", p.getKey());
        out.put("name", p.getName());
        out.put("description", p.getDescription());
        out.put("modules", presetModules(p));
        out.put("updated_by", p.getUpdatedBy());
        out.put("updated_at", InstituteModuleService.iso(p.getUpdatedAt()));
        return out;
    }

    private static VacademyException badRequest(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }
}
