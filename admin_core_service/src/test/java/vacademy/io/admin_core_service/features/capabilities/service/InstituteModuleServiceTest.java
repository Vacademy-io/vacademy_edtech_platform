package vacademy.io.admin_core_service.features.capabilities.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistryTest;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlement;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlementId;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlementLog;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModulePolicy;
import vacademy.io.admin_core_service.features.capabilities.entity.ModulePreset;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementLogRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModulePolicyRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.ModulePresetRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Module writes (validation, upsert, log rows, mode) and preset apply semantics, on in-memory
 * repositories and the fixture catalogue (core, lms, crm).
 */
class InstituteModuleServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Instant NOW = Instant.parse("2026-10-13T10:00:00Z");

    private final Map<InstituteModuleEntitlementId, InstituteModuleEntitlement> rows = new HashMap<>();
    private final Map<String, InstituteModulePolicy> policies = new HashMap<>();
    private final List<InstituteModuleEntitlementLog> logs = new ArrayList<>();
    private final Map<String, ModulePreset> presets = new HashMap<>();
    private InstituteModuleService moduleService;
    private ModulePresetService presetService;

    @BeforeEach
    void setUp() {
        CapabilityCatalogRegistry registry =
                new CapabilityCatalogRegistry(CapabilityCatalogRegistryTest.fixture().raw(), null);

        InstituteModuleEntitlementRepository entitlementRepo = mock(InstituteModuleEntitlementRepository.class);
        when(entitlementRepo.findById(any())).thenAnswer(inv -> Optional.ofNullable(rows.get(inv.getArgument(0))));
        when(entitlementRepo.save(any())).thenAnswer(inv -> {
            InstituteModuleEntitlement e = inv.getArgument(0);
            rows.put(new InstituteModuleEntitlementId(e.getInstituteId(), e.getKey()), e);
            return e;
        });
        when(entitlementRepo.findByInstituteIdOrderByKeyAsc(anyString())).thenAnswer(inv -> rows.values().stream()
                .filter(e -> e.getInstituteId().equals(inv.getArgument(0)))
                .sorted(Comparator.comparing(InstituteModuleEntitlement::getKey)).toList());
        when(entitlementRepo.findByInstituteIdIn(any())).thenAnswer(inv -> rows.values().stream()
                .filter(e -> ((java.util.Collection<?>) inv.getArgument(0)).contains(e.getInstituteId())).toList());

        InstituteModulePolicyRepository policyRepo = mock(InstituteModulePolicyRepository.class);
        when(policyRepo.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(policies.get(inv.getArgument(0))));
        when(policyRepo.save(any())).thenAnswer(inv -> {
            InstituteModulePolicy p = inv.getArgument(0);
            policies.put(p.getInstituteId(), p);
            return p;
        });
        when(policyRepo.findByInstituteIdIn(any())).thenAnswer(inv -> policies.values().stream()
                .filter(p -> ((java.util.Collection<?>) inv.getArgument(0)).contains(p.getInstituteId())).toList());

        InstituteModuleEntitlementLogRepository logRepo = mock(InstituteModuleEntitlementLogRepository.class);
        when(logRepo.save(any())).thenAnswer(inv -> {
            logs.add(inv.getArgument(0));
            return inv.getArgument(0);
        });
        when(logRepo.findByInstituteIdOrderByCreatedAtDesc(anyString(), any(Pageable.class))).thenAnswer(inv -> {
            List<InstituteModuleEntitlementLog> list = logs.stream()
                    .filter(l -> l.getInstituteId().equals(inv.getArgument(0))).toList();
            return (Page<InstituteModuleEntitlementLog>) new PageImpl<>(list, inv.getArgument(1), list.size());
        });

        InstituteRepository instituteRepo = mock(InstituteRepository.class);
        when(instituteRepo.existsById(anyString())).thenAnswer(inv -> !"missing".equals(inv.getArgument(0)));

        CapabilityResolver resolver = new CapabilityResolver(registry, policyRepo, entitlementRepo);
        resolver.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
        moduleService = new InstituteModuleService(registry, resolver, policyRepo, entitlementRepo, logRepo,
                instituteRepo);
        moduleService.setClock(Clock.fixed(NOW, ZoneOffset.UTC));

        ModulePresetRepository presetRepo = mock(ModulePresetRepository.class);
        when(presetRepo.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(presets.get(inv.getArgument(0))));
        when(presetRepo.save(any())).thenAnswer(inv -> {
            ModulePreset p = inv.getArgument(0);
            presets.put(p.getKey(), p);
            return p;
        });
        presetService = new ModulePresetService(presetRepo, registry, moduleService);
        presetService.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static ObjectNode change(String key, boolean enabled) {
        return MAPPER.createObjectNode().put("key", key).put("enabled", enabled);
    }

    private static ObjectNode put(String reason, String mode, ObjectNode... changes) {
        ObjectNode body = MAPPER.createObjectNode();
        if (reason != null) {
            body.put("reason", reason);
        }
        if (mode != null) {
            body.put("mode", mode);
        }
        var arr = body.putArray("changes");
        for (ObjectNode c : changes) {
            arr.add(c);
        }
        return body;
    }

    private InstituteModuleEntitlement row(String institute, String key) {
        return rows.get(new InstituteModuleEntitlementId(institute, key));
    }

    private void assertBadRequest(JsonNode body) {
        VacademyException ex = assertThrows(VacademyException.class, () -> moduleService.update("i1", body, "s"));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
    }

    // ── PUT /institutes/{id}/modules ─────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void updateWritesRowsLogsAndReturnsTheView() {
        ObjectNode crm = change("crm", true).put("expires_at", "2026-11-01T00:00:00Z").put("note", "trial");
        Map<String, Object> view = moduleService.update("i1", put("signed CRM trial", "MANAGED", crm,
                change("crm.ai_calling", false)), "staff-1");

        assertEquals("MANAGED", view.get("mode"));
        assertEquals("staff-1", view.get("mode_updated_by"));
        assertEquals(1, view.get("catalog_version"));
        List<Map<String, Object>> entitlements = (List<Map<String, Object>>) view.get("entitlements");
        assertEquals(2, entitlements.size());
        Map<String, Object> resolved = (Map<String, Object>) view.get("resolved");
        assertEquals(true, ((Map<String, Boolean>) resolved.get("modules")).get("crm"));
        assertEquals(false, ((Map<String, Boolean>) resolved.get("features")).get("crm.ai_calling"));
        assertEquals(true, ((Map<String, Boolean>) resolved.get("features")).get("crm.leads"));

        assertEquals(Instant.parse("2026-11-01T00:00:00Z"), row("i1", "crm").getExpiresAt());
        assertEquals("trial", row("i1", "crm").getNote());
        assertEquals(3, logs.size()); // _mode + crm + crm.ai_calling
        assertTrue(logs.stream().allMatch(l -> "signed CRM trial".equals(l.getReason())
                && "staff-1".equals(l.getActor())));

        Map<String, Object> history = moduleService.history("i1", 0, 20);
        List<Map<String, Object>> content = (List<Map<String, Object>>) history.get("content");
        Map<String, Object> mode = content.stream().filter(r -> "_mode".equals(r.get("key"))).findFirst().orElseThrow();
        assertEquals("{\"mode\":\"LEGACY\"}", mode.get("old_value"));
        assertEquals("{\"mode\":\"MANAGED\"}", mode.get("new_value"));
        Map<String, Object> crmLog = content.stream().filter(r -> "crm".equals(r.get("key"))).findFirst().orElseThrow();
        assertNull(crmLog.get("old_value"));
        assertEquals("{\"enabled\":true,\"expires_at\":\"2026-11-01T00:00:00Z\",\"note\":\"trial\"}",
                crmLog.get("new_value"));
        assertEquals(3L, history.get("total_elements"));
    }

    @Test
    void absentExpiryKeepsItExplicitNullClearsIt() {
        moduleService.update("i1", put("r", null, change("crm", true).put("expires_at", "2026-11-01T00:00:00Z")), "s");
        moduleService.update("i1", put("r", null, change("crm", false)), "s");
        assertEquals(Instant.parse("2026-11-01T00:00:00Z"), row("i1", "crm").getExpiresAt());
        ObjectNode clear = change("crm", true);
        clear.putNull("expires_at");
        moduleService.update("i1", put("r", null, clear), "s");
        assertNull(row("i1", "crm").getExpiresAt());
    }

    @Test
    void noOpChangeWritesNoLog() {
        moduleService.update("i1", put("r", null, change("crm", true)), "s");
        int before = logs.size();
        moduleService.update("i1", put("r", null, change("crm", true)), "s");
        moduleService.update("i1", put("r", "LEGACY"), "s"); // already LEGACY (no row)
        assertEquals(before, logs.size());
    }

    @Test
    void updateValidation() {
        assertBadRequest(put(null, null, change("crm", true)));
        assertBadRequest(put("  ", null, change("crm", true)));
        assertBadRequest(put("r", null, change("nope", true)));
        assertBadRequest(put("r", null, change("core", false)));
        assertBadRequest(put("r", null, change("crm", true), change("crm", false)));
        assertBadRequest(put("r", "SOMETIMES"));
        assertBadRequest(put("r", null));
        assertBadRequest(put("r", null, MAPPER.createObjectNode().put("key", "crm")));
        assertBadRequest(put("r", null, change("crm", true).put("expires_at", "next week")));
        assertTrue(rows.isEmpty());
        assertTrue(logs.isEmpty());
        // Enabling core is allowed (a no-op for resolution).
        moduleService.update("i1", put("r", null, change("core", true)), "s");
    }

    @Test
    void unknownInstituteIs404() {
        VacademyException ex = assertThrows(VacademyException.class,
                () -> moduleService.update("missing", put("r", null, change("crm", true)), "s"));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatus());
    }

    @Test
    @SuppressWarnings("unchecked")
    void overviewListsModeAndResolvedModules() {
        moduleService.update("i1", put("r", "MANAGED", change("lms", true)), "s");
        Map<String, Object> out = moduleService.overview(List.of("i1", " i2 ", ""));
        Map<String, Object> i1 = (Map<String, Object>) out.get("i1");
        assertEquals("MANAGED", i1.get("mode"));
        assertEquals(List.of("core", "lms"), i1.get("enabled_modules"));
        Map<String, Object> i2 = (Map<String, Object>) out.get("i2");
        assertEquals("LEGACY", i2.get("mode"));
        assertEquals(List.of("core"), i2.get("enabled_modules"));
        assertThrows(VacademyException.class, () -> moduleService.overview(List.of()));
    }

    // ── Presets ──────────────────────────────────────────────────────────────

    private void savePreset(String key, String... modules) {
        ObjectNode body = MAPPER.createObjectNode().put("name", key).put("description", "d");
        var arr = body.putArray("modules");
        for (String m : modules) {
            arr.add(m);
        }
        presetService.upsert(key, body, "staff-1");
    }

    private static ObjectNode apply(String reason, String... ids) {
        ObjectNode body = MAPPER.createObjectNode();
        if (reason != null) {
            body.put("reason", reason);
        }
        var arr = body.putArray("institute_ids");
        for (String id : ids) {
            arr.add(id);
        }
        return body;
    }

    @Test
    @SuppressWarnings("unchecked")
    void applyEnablesListedDisablesOtherNonCoreAndLeavesFeaturesAndModeAlone() {
        // i1: MANAGED, crm on with a feature row, a trial expiry on crm, lms has no row.
        moduleService.update("i1", put("setup", "MANAGED",
                change("crm", true).put("expires_at", "2026-12-01T00:00:00Z"),
                change("crm.ai_calling", false)), "s");
        int logsBefore = logs.size();
        savePreset("lms_only", "lms");

        Map<String, Object> out = presetService.apply("lms_only", apply("moving to LMS", "i1"), "staff-2");
        assertEquals(List.of("i1"), out.get("applied"));
        assertTrue(((List<?>) out.get("failed")).isEmpty());

        assertTrue(row("i1", "lms").isEnabled());
        assertFalse(row("i1", "crm").isEnabled());
        assertEquals(Instant.parse("2026-12-01T00:00:00Z"), row("i1", "crm").getExpiresAt()); // untouched
        assertFalse(row("i1", "crm.ai_calling").isEnabled());   // feature row untouched
        assertNull(row("i1", "core"));                            // core never written
        assertEquals("MANAGED", policies.get("i1").getMode());   // mode untouched
        List<InstituteModuleEntitlementLog> applied = logs.subList(logsBefore, logs.size());
        assertEquals(2, applied.size());                          // lms on, crm off
        assertTrue(applied.stream().allMatch(l -> l.getReason().startsWith("moving to LMS")
                && l.getReason().contains("lms_only") && "staff-2".equals(l.getActor())));
    }

    @Test
    void applyDoesNotCreateRowsForModulesThatAreAlreadyOff() {
        savePreset("crm_only", "crm");
        presetService.apply("crm_only", apply("r", "i3"), "s");
        assertTrue(row("i3", "crm").isEnabled());
        assertNull(row("i3", "lms"));
        assertNull(policies.get("i3"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void applyReportsPerInstituteFailures() {
        savePreset("crm_only", "crm");
        Map<String, Object> out = presetService.apply("crm_only", apply("r", "i1", "missing", "i2"), "s");
        assertEquals(List.of("i1", "i2"), out.get("applied"));
        List<Map<String, Object>> failed = (List<Map<String, Object>>) out.get("failed");
        assertEquals(1, failed.size());
        assertEquals("missing", failed.get(0).get("institute_id"));
        assertEquals("Institute not found.", failed.get(0).get("error"));
    }

    @Test
    void applyAndPresetValidation() {
        savePreset("crm_only", "crm");
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class,
                () -> presetService.apply("crm_only", apply(null, "i1"), "s")).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class,
                () -> presetService.apply("crm_only", apply("r"), "s")).getStatus());
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(VacademyException.class,
                () -> presetService.apply("nope", apply("r", "i1"), "s")).getStatus());
        ObjectNode bad = MAPPER.createObjectNode().put("name", "x");
        bad.putArray("modules").add("crm.leads");
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class,
                () -> presetService.upsert("x", bad, "s")).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class,
                () -> presetService.upsert("Bad Key", MAPPER.createObjectNode().put("name", "x"), "s")).getStatus());
        assertTrue(rows.isEmpty());
    }
}
