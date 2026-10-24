package vacademy.io.admin_core_service.features.capabilities.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingHistory;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingHistoryRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Super-admin display settings: exact admin-app storage format, per-role version hash, 409 on a
 * stale version, PLATFORM history rows; and restore through the same writer.
 */
class InstituteSettingAdminServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String INSTITUTE = "inst-1";

    private Institute institute;
    private InstituteRepository instituteRepository;
    private InstituteSettingHistoryRepository historyRepository;
    private CacheManager cacheManager;
    private InstituteSettingAdminService service;
    private final List<InstituteSettingHistory> recorded = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        institute = new Institute();
        institute.setId(INSTITUTE);
        institute.setSetting("{\"institute_id\":\"inst-1\",\"setting\":{"
                + "\"ADMIN_DISPLAY_SETTINGS\":{\"key\":\"ADMIN_DISPLAY_SETTINGS\",\"name\":\"Admin Display Settings\","
                + "\"data\":{\"sidebar\":[{\"id\":\"leads\",\"visible\":true}]}},"
                + "\"ROLE_DISPLAY_SETTINGS\":{\"key\":\"ROLE_DISPLAY_SETTINGS\",\"name\":\"Role Display Settings\","
                + "\"data\":{\"role-a\":{\"sidebar\":[]},\"role-b\":{\"sidebar\":[{\"id\":\"courses\"}]}}},"
                + "\"NAMING_SETTING\":{\"key\":\"NAMING_SETTING\",\"name\":\"Naming\",\"data\":{\"Course\":\"Program\"}}}}");
        instituteRepository = mock(InstituteRepository.class);
        when(instituteRepository.findById(INSTITUTE)).thenReturn(Optional.of(institute));
        when(instituteRepository.findByIdForUpdate(INSTITUTE)).thenReturn(Optional.of(institute));
        when(instituteRepository.save(any(Institute.class))).thenAnswer(inv -> inv.getArgument(0));
        historyRepository = mock(InstituteSettingHistoryRepository.class);
        when(historyRepository.saveAll(any())).thenAnswer(inv -> {
            ((Iterable<InstituteSettingHistory>) inv.getArgument(0)).forEach(recorded::add);
            return inv.getArgument(0);
        });
        cacheManager = mock(CacheManager.class);
        when(cacheManager.getCache(anyString())).thenReturn(mock(Cache.class));
        service = new InstituteSettingAdminService(instituteRepository,
                new InstituteSettingWriter(instituteRepository, historyRepository), historyRepository, cacheManager);
    }

    private static ObjectNode body(JsonNode data, String expectedVersion, String reason) {
        ObjectNode b = MAPPER.createObjectNode();
        b.set("data", data);
        if (expectedVersion != null) {
            b.put("expected_version", expectedVersion);
        }
        if (reason != null) {
            b.put("reason", reason);
        }
        return b;
    }

    @Test
    void getReturnsStoredBlobAndVersion() {
        Map<String, Object> admin = service.getDisplaySettings(INSTITUTE, "ADMIN");
        assertEquals("ADMIN", admin.get("role_key"));
        assertEquals("leads", ((JsonNode) admin.get("data")).get("sidebar").get(0).get("id").asText());
        assertEquals(32, ((String) admin.get("version")).length());

        Map<String, Object> custom = service.getDisplaySettings(INSTITUTE, "custom:role-b");
        assertEquals("CUSTOM:role-b", custom.get("role_key"));
        assertEquals("courses", ((JsonNode) custom.get("data")).get("sidebar").get(0).get("id").asText());

        Map<String, Object> teacher = service.getDisplaySettings(INSTITUTE, "TEACHER");
        assertNull(teacher.get("data"));
        assertEquals(DisplaySettingsFormat.version(null), teacher.get("version"));
    }

    @Test
    void staleVersionIsAConflictAndWritesNothing() {
        VersionConflictException ex = assertThrows(VersionConflictException.class,
                () -> service.putDisplaySettings(INSTITUTE, "ADMIN",
                        body(MAPPER.createObjectNode(), "not-the-version", "fix nav"), "staff-1"));
        assertEquals(service.getDisplaySettings(INSTITUTE, "ADMIN").get("version"), ex.getCurrentVersion());
        verify(instituteRepository, never()).save(any());
        assertTrue(recorded.isEmpty());
    }

    @Test
    void tenantSaveInBetweenMakesThePortalVersionStale() {
        String portalVersion = (String) service.getDisplaySettings(INSTITUTE, "ADMIN").get("version");
        // The institute admin saves from their own Settings page meanwhile.
        institute.setSetting(institute.getSetting().replace("\"visible\":true", "\"visible\":false"));
        assertThrows(VersionConflictException.class, () -> service.putDisplaySettings(INSTITUTE, "ADMIN",
                body(MAPPER.createObjectNode(), portalVersion, "fix nav"), "staff-1"));
    }

    @Test
    void versionIgnoresKeyOrder() throws Exception {
        JsonNode a = MAPPER.readTree("{\"x\":1,\"y\":{\"p\":true,\"q\":[1,2]}}");
        JsonNode b = MAPPER.readTree("{\"y\":{\"q\":[1,2],\"p\":true},\"x\":1}");
        assertEquals(DisplaySettingsFormat.version(a), DisplaySettingsFormat.version(b));
        assertNotEquals(DisplaySettingsFormat.version(a), DisplaySettingsFormat.version(null));
    }

    @Test
    void adminWriteUsesTheAdminAppFormat() throws Exception {
        String version = (String) service.getDisplaySettings(INSTITUTE, "ADMIN").get("version");
        JsonNode data = MAPPER.readTree("{\"sidebar\":[{\"id\":\"leads\",\"visible\":false}]}");
        Map<String, Object> out = service.putDisplaySettings(INSTITUTE, "ADMIN", body(data, version, "client asked"),
                "staff-1");
        assertEquals(data, out.get("data"));
        assertNotEquals(version, out.get("version"));

        // Read back exactly as the admin app's /institute/setting/v1/get path does.
        InstituteSettingDto dto = MAPPER.readValue(institute.getSetting(), InstituteSettingDto.class);
        assertEquals("ADMIN_DISPLAY_SETTINGS", dto.getSetting().get("ADMIN_DISPLAY_SETTINGS").getKey());
        assertEquals("Admin Display Settings", dto.getSetting().get("ADMIN_DISPLAY_SETTINGS").getName());
        assertEquals(data, MAPPER.valueToTree(dto.getSetting().get("ADMIN_DISPLAY_SETTINGS").getData()));
        assertEquals(3, dto.getSetting().size());

        assertEquals(1, recorded.size());
        assertEquals("ADMIN_DISPLAY_SETTINGS", recorded.get(0).getSettingKey());
        assertEquals(InstituteSettingHistory.SOURCE_PLATFORM, recorded.get(0).getSource());
        assertEquals("staff-1", recorded.get(0).getActor());
        assertEquals("client asked", recorded.get(0).getReason());
    }

    @Test
    void customRoleWriteReplacesOnlyThatRole() throws Exception {
        String version = (String) service.getDisplaySettings(INSTITUTE, "CUSTOM:role-a").get("version");
        JsonNode data = MAPPER.readTree("{\"sidebar\":[{\"id\":\"leads\",\"visible\":true}]}");
        service.putDisplaySettings(INSTITUTE, "CUSTOM:role-a", body(data, version, "counsellors need leads"), "s");
        JsonNode roles = InstituteSettingWriter.settingNodes(institute.getSetting()).get("ROLE_DISPLAY_SETTINGS");
        assertEquals("ROLE_DISPLAY_SETTINGS", roles.get("key").asText());
        assertEquals("Role Display Settings", roles.get("name").asText());
        assertEquals(data, roles.get("data").get("role-a"));
        assertEquals("courses", roles.get("data").get("role-b").get("sidebar").get(0).get("id").asText());
    }

    @Test
    void anotherRolesEditDoesNotConflict() throws Exception {
        String versionA = (String) service.getDisplaySettings(INSTITUTE, "CUSTOM:role-a").get("version");
        String versionB = (String) service.getDisplaySettings(INSTITUTE, "CUSTOM:role-b").get("version");
        service.putDisplaySettings(INSTITUTE, "CUSTOM:role-b",
                body(MAPPER.readTree("{\"sidebar\":[]}"), versionB, "r"), "s");
        service.putDisplaySettings(INSTITUTE, "CUSTOM:role-a",
                body(MAPPER.readTree("{\"sidebar\":[{\"id\":\"x\"}]}"), versionA, "r"), "s");
        assertEquals(2, recorded.size());
    }

    @Test
    void newCustomRoleOnAnInstituteWithNoRoleBlob() throws Exception {
        institute.setSetting(null);
        String version = (String) service.getDisplaySettings(INSTITUTE, "CUSTOM:r1").get("version");
        service.putDisplaySettings(INSTITUTE, "CUSTOM:r1", body(MAPPER.readTree("{\"a\":1}"), version, "r"), "s");
        JsonNode root = MAPPER.readTree(institute.getSetting());
        assertEquals(INSTITUTE, root.get("institute_id").asText());
        assertEquals(1, root.get("setting").get("ROLE_DISPLAY_SETTINGS").get("data").get("r1").get("a").asInt());
    }

    @Test
    void nullDataResetsTheRole() {
        String version = (String) service.getDisplaySettings(INSTITUTE, "ADMIN").get("version");
        ObjectNode b = body(null, version, "reset to defaults");
        b.putNull("data");
        service.putDisplaySettings(INSTITUTE, "ADMIN", b, "s");
        assertFalse(InstituteSettingWriter.settingNodes(institute.getSetting()).containsKey("ADMIN_DISPLAY_SETTINGS"));
    }

    @Test
    void writeValidation() {
        String version = (String) service.getDisplaySettings(INSTITUTE, "ADMIN").get("version");
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class, () -> service.putDisplaySettings(
                INSTITUTE, "ADMIN", body(MAPPER.createObjectNode(), version, " "), "s")).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class, () -> service.putDisplaySettings(
                INSTITUTE, "ADMIN", body(MAPPER.createObjectNode(), null, "r"), "s")).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class, () -> service.putDisplaySettings(
                INSTITUTE, "OWNER", body(MAPPER.createObjectNode(), version, "r"), "s")).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class, () -> service.putDisplaySettings(
                INSTITUTE, "CUSTOM:a+b", body(MAPPER.createObjectNode(), version, "r"), "s")).getStatus());
        ObjectNode noData = body(null, version, "r");
        noData.remove("data");
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class,
                () -> service.putDisplaySettings(INSTITUTE, "ADMIN", noData, "s")).getStatus());
        verify(instituteRepository, never()).save(any());
    }

    @Test
    void restorePutsTheOldValueBackThroughTheWriter() throws Exception {
        String version = (String) service.getDisplaySettings(INSTITUTE, "ADMIN").get("version");
        JsonNode original = InstituteSettingWriter.settingNodes(institute.getSetting()).get("ADMIN_DISPLAY_SETTINGS");
        service.putDisplaySettings(INSTITUTE, "ADMIN", body(MAPPER.readTree("{\"sidebar\":[]}"), version, "r1"), "s");
        InstituteSettingHistory edit = recorded.get(0);
        when(historyRepository.findByIdAndInstituteId(edit.getId(), INSTITUTE)).thenReturn(Optional.of(edit));

        ObjectNode restoreBody = MAPPER.createObjectNode().put("reason", "undo");
        Map<String, Object> out = service.restore(INSTITUTE, edit.getId(), restoreBody, "staff-2");
        assertEquals(true, out.get("changed"));
        assertEquals(original, InstituteSettingWriter.settingNodes(institute.getSetting()).get("ADMIN_DISPLAY_SETTINGS"));
        InstituteSettingHistory restoreRow = recorded.get(1);
        assertEquals(InstituteSettingHistory.SOURCE_PLATFORM, restoreRow.getSource());
        assertEquals("staff-2", restoreRow.getActor());
        assertTrue(restoreRow.getReason().startsWith("undo"));

        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class,
                () -> service.restore(INSTITUTE, edit.getId(), MAPPER.createObjectNode(), "s")).getStatus());
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(VacademyException.class,
                () -> service.restore(INSTITUTE, "missing", restoreBody, "s")).getStatus());
    }

    @Test
    void meDisplaySettingsVersionTracksTheThreeKeys() {
        Map<String, JsonNode> settings = InstituteSettingWriter.settingNodes(institute.getSetting());
        String v1 = DisplaySettingsFormat.displaySettingsVersion(settings);
        assertEquals(32, v1.length());
        assertNull(DisplaySettingsFormat.displaySettingsVersion(Map.of()));
        String version = (String) service.getDisplaySettings(INSTITUTE, "CUSTOM:role-a").get("version");
        service.putDisplaySettings(INSTITUTE, "CUSTOM:role-a", body(MAPPER.createObjectNode(), version, "r"), "s");
        assertNotEquals(v1, DisplaySettingsFormat.displaySettingsVersion(
                InstituteSettingWriter.settingNodes(institute.getSetting())));
    }
}
