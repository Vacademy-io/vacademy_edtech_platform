package vacademy.io.admin_core_service.features.institute.setting_history;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.certificate.repository.IssuedCertificateRepository;
import vacademy.io.admin_core_service.features.certificate.service.CertificateCodeService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateCustomFieldService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateNumberService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateSettingsResolver;
import vacademy.io.admin_core_service.features.certificate.service.CertificateTextFitService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateVerificationService;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.course_settings.service.DripConditionService;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute.service.setting.SettingStrategyFactory;
import vacademy.io.admin_core_service.features.learner_operation.repository.LearnerOperationRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.media.service.FileService;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Every setting write records one history row per changed key, with the old and new value of
 * THAT key only, the request's user and source TENANT — through the real InstituteSettingService
 * and strategies (generic save-setting path, role display paths), not a stub.
 */
class InstituteSettingHistoryRecordingTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String INSTITUTE = "inst-1";

    private InstituteRepository instituteRepository;
    private InstituteSettingHistoryRepository historyRepository;
    private InstituteSettingWriter writer;
    private InstituteSettingService service;
    private final List<InstituteSettingHistory> recorded = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        instituteRepository = mock(InstituteRepository.class);
        when(instituteRepository.save(any(Institute.class))).thenAnswer(inv -> inv.getArgument(0));
        historyRepository = mock(InstituteSettingHistoryRepository.class);
        when(historyRepository.saveAll(any())).thenAnswer(inv -> {
            ((Iterable<InstituteSettingHistory>) inv.getArgument(0)).forEach(recorded::add);
            return inv.getArgument(0);
        });
        writer = new InstituteSettingWriter(instituteRepository, historyRepository);
        service = new InstituteSettingService(instituteRepository, MAPPER, mock(FileService.class),
                mock(MediaService.class), mock(AuthService.class), mock(InstituteCustomFiledService.class),
                new SettingStrategyFactory(mock(DripConditionService.class)),
                mock(IssuedCertificateRepository.class), mock(CertificateSettingsResolver.class),
                mock(CertificateNumberService.class), mock(CertificateCodeService.class),
                mock(CertificateVerificationService.class), mock(CertificateCustomFieldService.class),
                mock(CertificateTextFitService.class), mock(LearnerOperationRepository.class), writer);

        MockHttpServletRequest request = new MockHttpServletRequest();
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("admin-user");
        dto.setUsername("admin-user");
        dto.setAuthorities(List.of("ADMIN"));
        request.setAttribute("user", new CustomUserDetails(dto));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** A blob as the admin app leaves it: naming + admin display settings. */
    private static Institute institute() throws Exception {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("institute_id", INSTITUTE);
        Map<String, Object> setting = new LinkedHashMap<>();
        setting.put("NAMING_SETTING", Map.of("key", "NAMING_SETTING", "name", "Naming", "data",
                Map.of("Course", "Program")));
        setting.put("ADMIN_DISPLAY_SETTINGS", Map.of("key", "ADMIN_DISPLAY_SETTINGS", "name",
                "Admin Display Settings", "data", Map.of("sidebar", List.of(Map.of("id", "leads", "visible", true)))));
        root.put("setting", setting);
        Institute institute = new Institute();
        institute.setId(INSTITUTE);
        institute.setSetting(MAPPER.writeValueAsString(root));
        return institute;
    }

    @Test
    void genericSaveRecordsOnlyTheWrittenKey() throws Exception {
        Institute institute = institute();
        service.saveGenericSetting(institute, "LEAD_SETTING", GenericSettingRequest.builder()
                .settingName("Lead Setting").settingData(Map.of("workbench", Map.of("enabled", true))).build());

        assertEquals(1, recorded.size());
        InstituteSettingHistory row = recorded.get(0);
        assertEquals(INSTITUTE, row.getInstituteId());
        assertEquals("LEAD_SETTING", row.getSettingKey());
        assertNull(row.getOldValue());
        JsonNode newValue = MAPPER.readTree(row.getNewValue());
        assertEquals("LEAD_SETTING", newValue.get("key").asText());
        assertTrue(newValue.get("data").get("workbench").get("enabled").asBoolean());
        assertEquals("admin-user", row.getActor());
        assertEquals(InstituteSettingHistory.SOURCE_TENANT, row.getSource());
        assertNull(row.getReason());

        // Second write of the same key: old value is the first write's new value.
        recorded.clear();
        service.saveGenericSetting(institute, "LEAD_SETTING", GenericSettingRequest.builder()
                .settingName("Lead Setting").settingData(Map.of("workbench", Map.of("enabled", false))).build());
        assertEquals(1, recorded.size());
        assertEquals(newValue, MAPPER.readTree(recorded.get(0).getOldValue()));
        assertTrue(!MAPPER.readTree(recorded.get(0).getNewValue()).get("data").get("workbench")
                .get("enabled").asBoolean());
    }

    @Test
    void unchangedWriteRecordsNothing() throws Exception {
        Institute institute = institute();
        GenericSettingRequest same = GenericSettingRequest.builder().settingName("Lead Setting")
                .settingData(Map.of("a", 1)).build();
        service.saveGenericSetting(institute, "LEAD_SETTING", same);
        assertEquals(1, recorded.size());
        recorded.clear();
        // Same value again: the generic strategy re-serialises the whole blob, but no key changed.
        service.saveGenericSetting(institute, "LEAD_SETTING", same);
        assertTrue(recorded.isEmpty());
        verify(historyRepository, times(1)).saveAll(any());
    }

    @Test
    void customRoleDisplaySaveAsTheAdminAppDoesIt() throws Exception {
        Institute institute = institute();
        // saveDisplaySettings(CUSTOM_ROLE_DISPLAY_SETTINGS_KEY_<id>): whole map re-posted, key ROLE_DISPLAY_SETTINGS.
        service.saveGenericSetting(institute, "ROLE_DISPLAY_SETTINGS", GenericSettingRequest.builder()
                .settingName("Role Display Settings")
                .settingData(Map.of("role-1", Map.of("sidebar", List.of()))).build());
        assertEquals(1, recorded.size());
        assertEquals("ROLE_DISPLAY_SETTINGS", recorded.get(0).getSettingKey());
        assertTrue(MAPPER.readTree(recorded.get(0).getNewValue()).get("data").has("role-1"));
    }

    @Test
    void dedicatedRoleDisplayStrategyRecordsItsKey() throws Exception {
        Institute institute = institute();
        Map<String, Object> request = Map.of("role_settings",
                Map.of("role-9", Map.of("display_name", "Counsellor")));
        service.updateGenericSetting(institute, "ROLE_DISPLAY_SETTING", request);
        assertEquals(1, recorded.size());
        InstituteSettingHistory row = recorded.get(0);
        assertEquals("ROLE_DISPLAY_SETTING", row.getSettingKey());
        assertNull(row.getOldValue());
        JsonNode role = MAPPER.readTree(row.getNewValue()).get("data").get("role_settings").get("role-9");
        assertEquals("Counsellor", role.get("display_name").asText());
        // RoleDisplaySettingStrategy's custom-role defaults are part of the recorded value.
        assertEquals("/study-library/courses", role.get("post_login_route").asText());
    }

    @Test
    void platformPutKeyRecordsPlatformSourceAndReasonAndKeepsOtherKeys() throws Exception {
        Institute institute = institute();
        JsonNode value = MAPPER.readTree("{\"key\":\"TEACHER_DISPLAY_SETTINGS\",\"name\":\"Teacher Display Settings\","
                + "\"data\":{\"sidebar\":[]}}");
        InstituteSettingWriter.WriteResult result = writer.putSettingKey(institute, "TEACHER_DISPLAY_SETTINGS",
                value, InstituteSettingWriter.Actor.platform("staff-1", "client asked"));
        assertEquals(1, result.history().size());
        InstituteSettingHistory row = result.history().get(0);
        assertEquals(InstituteSettingHistory.SOURCE_PLATFORM, row.getSource());
        assertEquals("staff-1", row.getActor());
        assertEquals("client asked", row.getReason());
        Map<String, JsonNode> after = InstituteSettingWriter.settingNodes(institute.getSetting());
        assertEquals(3, after.size());
        assertEquals("Program", after.get("NAMING_SETTING").get("data").get("Course").asText());

        // Removing a key records new_value null.
        recorded.clear();
        writer.putSettingKey(institute, "TEACHER_DISPLAY_SETTINGS", null,
                InstituteSettingWriter.Actor.platform("staff-1", "reset"));
        assertEquals(1, recorded.size());
        assertNull(recorded.get(0).getNewValue());
    }

    @Test
    void writesOutsideARequestHaveNoActor() throws Exception {
        RequestContextHolder.resetRequestAttributes();
        Institute institute = institute();
        service.saveGenericSetting(institute, "LEAD_SETTING", GenericSettingRequest.builder()
                .settingData(Map.of("a", 1)).build());
        assertEquals(1, recorded.size());
        assertNull(recorded.get(0).getActor());
        assertEquals(InstituteSettingHistory.SOURCE_TENANT, recorded.get(0).getSource());
    }

    @Test
    void historyRowIsWrittenWithTheSave() throws Exception {
        Institute institute = institute();
        service.saveGenericSetting(institute, "LEAD_SETTING", GenericSettingRequest.builder()
                .settingData(Map.of("a", 1)).build());
        ArgumentCaptor<Institute> saved = ArgumentCaptor.forClass(Institute.class);
        verify(instituteRepository).save(saved.capture());
        assertTrue(saved.getValue().getSetting().contains("LEAD_SETTING"));
    }
}
