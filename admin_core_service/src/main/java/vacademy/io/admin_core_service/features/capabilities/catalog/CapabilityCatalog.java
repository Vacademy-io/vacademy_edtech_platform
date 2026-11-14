package vacademy.io.admin_core_service.features.capabilities.catalog;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Parsed, validated {@code capabilities/catalog.json} (spec §4, §12.1). Immutable.
 * Build it with {@link CapabilityCatalogRegistry#parse}.
 *
 * @param version catalogue version ({@code version})
 * @param modules modules in file order
 * @param raw     the file as read, served verbatim by {@code GET /capabilities/v1/catalog}
 */
public record CapabilityCatalog(int version, List<Module> modules, JsonNode raw) {

    public record Module(String key, String label, String description, String rail, boolean core,
                         List<Feature> features) {
    }

    public record Feature(String key, String moduleKey, String label, String description, boolean defaultOn,
                          Governs governs, List<String> settingKeys) {
    }

    public record Governs(List<String> nav, List<String> widgets, List<String> quickActions,
                          List<String> assistantGroups, List<String> setupSteps, List<String> routes) {
    }

    public Map<String, Module> modulesByKey() {
        Map<String, Module> out = new LinkedHashMap<>();
        modules.forEach(m -> out.put(m.key(), m));
        return Collections.unmodifiableMap(out);
    }

    public Map<String, Feature> featuresByKey() {
        Map<String, Feature> out = new LinkedHashMap<>();
        modules.forEach(m -> m.features().forEach(f -> out.put(f.key(), f)));
        return Collections.unmodifiableMap(out);
    }
}
