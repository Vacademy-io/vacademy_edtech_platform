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

    /** {@link #fixture()} plus an opt-in module shop(shop.items on, shop.till on). */
    public static CapabilityCatalog fixtureWithOptIn() {
        ObjectNode shop = module("shop", false, feature("shop.items", true), feature("shop.till", true));
        shop.put("opt_in", true);
        return CapabilityCatalogRegistry.parse(catalog(
                module("core", true, feature("core.dashboard", true, "dashboard")),
                module("lms", false, feature("lms.courses", true, "courses"),
                        feature("lms.mentorship", false, "mentorship")),
                module("crm", false, feature("crm.leads", true, "leads"),
                        feature("crm.ai_calling", true, "calling/calling-ai-agents")),
                shop));
    }

    @Test
    void shippedCatalogueHasTheOptInCommerceModule() {
        CapabilityCatalogRegistry registry = new CapabilityCatalogRegistry();
        CapabilityCatalog.Module commerce = registry.modulesByKey().get("commerce");
        assertNotNull(commerce, "missing module commerce");
        assertEquals("COMMERCE", commerce.rail());
        assertFalse(commerce.core());
        assertTrue(commerce.optIn());
        assertEquals(java.util.List.of("commerce.catalogue", "commerce.orders", "commerce.stock",
                        "commerce.pos", "commerce.tax_reports", "commerce.accounts"),
                commerce.features().stream().map(CapabilityCatalog.Feature::key).toList());
        for (CapabilityCatalog.Feature feature : commerce.features()) {
            if ("commerce.accounts".equals(feature.key())) {
                // Off for every institute until it is given the feature row.
                assertFalse(feature.defaultOn(), "commerce.accounts must not be default_on");
            } else {
                assertTrue(feature.defaultOn(), feature.key() + " must be default_on");
            }
        }
        // The sidebar tabs of the admin shell (WP-06). Home, Settings and Reports open on any
        // one of several features, so no single feature governs them.
        java.util.Map<String, java.util.List<String>> nav = new java.util.LinkedHashMap<>();
        commerce.features().forEach(f -> nav.put(f.key(), f.governs().nav()));
        assertEquals(java.util.List.of("commerce-products", "commerce-collections", "commerce-discounts"),
                nav.get("commerce.catalogue"));
        assertEquals(java.util.List.of("commerce-orders", "commerce-customers"), nav.get("commerce.orders"));
        assertEquals(java.util.List.of("commerce-inventory"), nav.get("commerce.stock"));
        assertEquals(java.util.List.of("commerce-pos"), nav.get("commerce.pos"));
        assertTrue(nav.get("commerce.tax_reports").isEmpty());
        assertTrue(nav.get("commerce.accounts").isEmpty());
        for (String ungoverned : java.util.List.of("commerce-home", "commerce-settings", "commerce-reports")) {
            assertTrue(nav.values().stream().noneMatch(list -> list.contains(ungoverned)), ungoverned);
        }
        // Commerce is the only opt-in module. The learner home builder is on for LEGACY
        // institutes (learners keep the classic home until an admin publishes a layout).
        assertEquals(java.util.List.of("commerce"), registry.modules().stream()
                .filter(CapabilityCatalog.Module::optIn).map(CapabilityCatalog.Module::key).sorted().toList());
        CapabilityCatalog.Module home = registry.modulesByKey().get("learner_home");
        assertFalse(home.optIn());
        assertEquals("LMS", home.rail());
        assertEquals(java.util.List.of("learner-home"), home.features().get(0).governs().nav());
        assertTrue(home.features().get(0).defaultOn());
    }

    @Test
    void optInMustBeABooleanAndNeverOnACoreModule() {
        ObjectNode textual = module("crm", false, feature("crm.leads", true));
        textual.put("opt_in", "yes");
        assertInvalid(catalog(module("core", true, feature("core.a", true)), textual),
                "opt_in must be a boolean");
        ObjectNode core = module("core", true, feature("core.a", true));
        core.put("opt_in", true);
        assertInvalid(catalog(core), "a core module cannot be opt_in");
    }

    @Test
    void optInDefaultsToFalse() {
        assertTrue(fixture().modules().stream().noneMatch(CapabilityCatalog.Module::optIn));
        assertTrue(fixtureWithOptIn().modulesByKey().get("shop").optIn());
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
