package vacademy.io.admin_core_service.features.capabilities.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The shipped catalogue boots, and every rule that must fail boot does: unique keys, feature
 * keys prefixed by their module, at least one core module, well-formed governs.
 */
public class CapabilityCatalogRegistryTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    static ObjectNode feature(String key, boolean defaultOn, String... nav) {
        ObjectNode f = MAPPER.createObjectNode();
        f.put("key", key);
        f.put("label", key);
        f.put("description", "d");
        f.put("default_on", defaultOn);
        ObjectNode governs = f.putObject("governs");
        ArrayNode navArray = governs.putArray("nav");
        for (String n : nav) {
            navArray.add(n);
        }
        governs.putArray("widgets");
        governs.putArray("quick_actions");
        governs.putArray("assistant_groups");
        governs.putArray("setup_steps");
        governs.putArray("routes");
        f.putArray("setting_keys");
        return f;
    }

    static ObjectNode module(String key, boolean core, ObjectNode... features) {
        ObjectNode m = MAPPER.createObjectNode();
        m.put("key", key);
        m.put("label", key);
        m.put("description", "d");
        m.putNull("rail");
        m.put("core", core);
        ArrayNode fs = m.putArray("features");
        for (ObjectNode f : features) {
            fs.add(f);
        }
        return m;
    }

    static ObjectNode catalog(ObjectNode... modules) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("version", 1);
        ArrayNode ms = root.putArray("modules");
        for (ObjectNode m : modules) {
            ms.add(m);
        }
        return root;
    }

    /** core(core.dashboard) + lms(lms.courses on, lms.mentorship off) + crm(crm.leads, crm.ai_calling). */
    public static CapabilityCatalog fixture() {
        return CapabilityCatalogRegistry.parse(catalog(
                module("core", true, feature("core.dashboard", true, "dashboard")),
                module("lms", false, feature("lms.courses", true, "courses"),
                        feature("lms.mentorship", false, "mentorship")),
                module("crm", false, feature("crm.leads", true, "leads"),
                        feature("crm.ai_calling", true, "calling/calling-ai-agents"))));
    }

    @Test
    void shippedCatalogueLoadsAndIsValid() {
        CapabilityCatalogRegistry registry = new CapabilityCatalogRegistry();
        assertTrue(registry.version() >= 1);
        assertTrue(registry.isCoreModule("core"));
        assertFalse(registry.isCoreModule("crm"));
        assertTrue(registry.isFeature("crm.ai_calling"));
        assertTrue(registry.isModule("lms"));
        assertEquals("crm", registry.featuresByKey().get("crm.ai_calling").moduleKey());
        assertTrue(registry.featuresByKey().get("crm.ai_calling").settingKeys().contains("AI_CALLING_SETTING"));
        assertNotNull(registry.rawCatalog());
        // §12.1 module set (v1).
        for (String m : new String[]{"core", "lms", "assessments", "live_classes", "crm", "communications",
                "automation", "website", "finance", "sub_orgs", "inventory", "erp", "ai"}) {
            assertTrue(registry.isModule(m), "missing module " + m);
        }
    }

    @Test
    void seededPresetsOnlyListCatalogueModules() throws Exception {
        CapabilityCatalogRegistry registry = new CapabilityCatalogRegistry();
        String sql;
        try (InputStream in = new ClassPathResource(
                "db/migration/V567__institute_modules_and_setting_history.sql").getInputStream()) {
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        Matcher lists = Pattern.compile("\\{\"modules\": \\[([^\\]]*)]}").matcher(sql);
        int presets = 0;
        while (lists.find()) {
            Matcher keys = Pattern.compile("\"([a-z_]+)\"").matcher(lists.group(1));
            while (keys.find()) {
                String key = keys.group(1);
                assertTrue(registry.isModule(key), "preset seed lists unknown module " + key);
                assertFalse(registry.isCoreModule(key), "preset seed lists core module " + key);
            }
            presets++;
        }
        assertTrue(presets >= 3, "expected the three seeded presets");
    }

    @Test
    void fixtureParses() {
        CapabilityCatalog c = fixture();
        assertEquals(3, c.modules().size());
        assertEquals(5, c.featuresByKey().size());
        assertEquals("calling/calling-ai-agents", c.featuresByKey().get("crm.ai_calling").governs().nav().get(0));
    }

    private static void assertInvalid(JsonNode catalog, String expectedFragment) {
        IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> new CapabilityCatalogRegistry(catalog, null));
        assertTrue(ex.getMessage().contains(expectedFragment),
                "expected '" + expectedFragment + "' in: " + ex.getMessage());
    }

    @Test
    void duplicateModuleKeyFailsBoot() {
        assertInvalid(catalog(module("core", true, feature("core.a", true)),
                module("core", false, feature("core.b", true))), "duplicate module key 'core'");
    }

    @Test
    void duplicateFeatureKeyFailsBoot() {
        assertInvalid(catalog(module("core", true, feature("core.a", true), feature("core.a", false))),
                "duplicate feature key 'core.a'");
    }

    @Test
    void featureKeyMustBePrefixedByItsModule() {
        assertInvalid(catalog(module("core", true, feature("core.a", true)),
                module("crm", false, feature("lms.leads", true))), "must be 'crm.<segment>'");
    }

    @Test
    void atLeastOneCoreModule() {
        assertInvalid(catalog(module("crm", false, feature("crm.leads", true))), "core: true");
    }

    @Test
    void navEntriesAreTabOrTabSlashSub() {
        assertInvalid(catalog(module("core", true, feature("core.a", true, "a/b/c"))), "'tab' or 'tab/sub'");
        assertInvalid(catalog(module("core", true, feature("core.a", true, "a/"))), "'tab' or 'tab/sub'");
    }

    @Test
    void defaultOnAndGovernsAreRequired() {
        ObjectNode f = feature("core.a", true);
        f.remove("default_on");
        assertInvalid(catalog(module("core", true, f)), "default_on must be a boolean");
        ObjectNode g = feature("core.b", true);
        ((ObjectNode) g.get("governs")).remove("routes");
        assertInvalid(catalog(module("core", true, g)), "governs.routes must be an array");
    }

    @Test
    void versionAndModulesAreRequired() {
        ObjectNode root = catalog(module("core", true, feature("core.a", true)));
        root.put("version", 0);
        assertInvalid(root, "version must be an integer >= 1");
        assertInvalid(MAPPER.createObjectNode().put("version", 1), "modules must be a non-empty array");
    }

    @Test
    void moduleWithoutFeaturesFailsBoot() {
        assertInvalid(catalog(module("core", true)), "features must be a non-empty array");
    }
}
