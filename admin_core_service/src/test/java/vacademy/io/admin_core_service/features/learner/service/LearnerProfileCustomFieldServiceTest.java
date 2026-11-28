package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.common.dto.request.CustomFieldValueDto;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.SystemFieldCustomFieldMappingRepository;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner.dto.LearnerProfileCustomFieldDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerProfileCustomFieldValueDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collection;
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
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Which custom fields a learner sees on their own profile, which value they see, and what they may save.
 */
class LearnerProfileCustomFieldServiceTest {

    private static final String USER = "learner-1";
    private static final String INSTITUTE = "inst-1";
    private static final String ENROLLMENT = "ssigm-1";

    private CustomFieldValuesRepository valuesRepository;
    private CustomFieldRepository fieldRepository;
    private InstituteCustomFieldRepository instituteFieldRepository;
    private SystemFieldCustomFieldMappingRepository systemMappingRepository;
    private InstituteRepository instituteRepository;
    private StudentSessionRepository studentSessionRepository;
    private InstituteSettingService settingService;
    private CustomFieldValueService valueService;
    private LearnerProfileCustomFieldService service;

    private final Map<String, CustomFields> fields = new HashMap<>();
    private final List<CustomFieldValues> userRows = new ArrayList<>();
    private final List<CustomFieldValues> enrollmentRows = new ArrayList<>();
    private final List<Map<String, Object>> settingEntries = new ArrayList<>();
    private final List<String> unmapped = new ArrayList<>();
    private final List<String> systemSynced = new ArrayList<>();
    private final Map<String, Object> invoiceSetting = new HashMap<>();
    private boolean brokenSettings;

    @BeforeEach
    void setUp() {
        valuesRepository = mock(CustomFieldValuesRepository.class);
        fieldRepository = mock(CustomFieldRepository.class);
        instituteFieldRepository = mock(InstituteCustomFieldRepository.class);
        systemMappingRepository = mock(SystemFieldCustomFieldMappingRepository.class);
        instituteRepository = mock(InstituteRepository.class);
        studentSessionRepository = mock(StudentSessionRepository.class);
        settingService = mock(InstituteSettingService.class);
        valueService = mock(CustomFieldValueService.class);
        service = new LearnerProfileCustomFieldService(valuesRepository, fieldRepository, instituteFieldRepository,
                systemMappingRepository, instituteRepository, studentSessionRepository, settingService, valueService,
                new ObjectMapper());

        Institute institute = new Institute();
        institute.setId(INSTITUTE);
        when(instituteRepository.findById(INSTITUTE)).thenReturn(Optional.of(institute));
        when(settingService.getAllSettings(institute)).thenAnswer(inv -> {
            if (brokenSettings) {
                throw new VacademyException("Error parsing settings: x");
            }
            Map<String, SettingDto> byKey = new HashMap<>();
            SettingDto customFields = new SettingDto();
            customFields.setData(Map.of("data", Map.of("currentCustomFieldsAndGroups", settingEntries)));
            byKey.put("CUSTOM_FIELD_SETTING", customFields);
            SettingDto invoice = new SettingDto();
            invoice.setData(invoiceSetting);
            byKey.put("INVOICE_SETTING", invoice);
            return InstituteSettingDto.builder().instituteId(INSTITUTE).setting(byKey).build();
        });
        when(systemMappingRepository.findCustomFieldIdsWithSystemSync(anyCollection()))
                .thenAnswer(inv -> inv.<Collection<String>>getArgument(0).stream()
                        .filter(systemSynced::contains).toList());

        when(studentSessionRepository.findIdsByUserIdAndInstituteId(USER, INSTITUTE)).thenReturn(List.of(ENROLLMENT));
        when(valuesRepository.findBySourceTypeAndSourceId("USER", USER)).thenReturn(userRows);
        when(valuesRepository.findBySourceTypeInAndSourceIdIn(anyCollection(), eq(List.of(ENROLLMENT))))
                .thenReturn(enrollmentRows);
        when(instituteFieldRepository.findActiveCustomFieldIdsForInstitute(eq(INSTITUTE), anyCollection()))
                .thenAnswer(inv -> inv.<Collection<String>>getArgument(1).stream()
                        .filter(id -> !unmapped.contains(id)).toList());
        when(fieldRepository.findAllById(anyList())).thenAnswer(inv -> inv.<List<String>>getArgument(0).stream()
                .map(fields::get).filter(f -> f != null).toList());
    }

    private CustomFields field(String id, String key, String name) {
        CustomFields field = CustomFields.builder().id(id).fieldKey(key).fieldName(name).fieldType("text")
                .status("ACTIVE").isHidden(false).formOrder(0).build();
        fields.put(id, field);
        return field;
    }

    private void onProfile(String customFieldId, int order, String... locations) {
        Map<String, Object> entry = new HashMap<>();
        entry.put("customFieldId", customFieldId);
        entry.put("individualOrder", order);
        entry.put("status", "ACTIVE");
        entry.put("locations", List.of(locations));
        settingEntries.add(entry);
    }

    private static CustomFieldValues row(String customFieldId, String sourceType, String sourceId, String value, long at) {
        CustomFieldValues row = new CustomFieldValues();
        row.setId(customFieldId + "-" + at);
        row.setCustomFieldId(customFieldId);
        row.setSourceType(sourceType);
        row.setSourceId(sourceId);
        row.setValue(value);
        row.setCreatedAt(new Timestamp(at));
        return row;
    }

    private static List<String> ids(List<LearnerProfileCustomFieldDTO> list) {
        return list.stream().map(LearnerProfileCustomFieldDTO::getCustomFieldId).toList();
    }

    @Test
    void showsTickedFieldsInSettingOrderThenFilledInviteAnswers() {
        field("roll", "roll_number_inst_1", "Roll Number");
        field("school", "school_name", "School Name");
        field("college", "college_name", "College Name");
        onProfile("college", 2, "Learner Profile");
        onProfile("roll", 1, "Learner's List", "Learner Profile");
        userRows.add(row("school", "USER", USER, "DPS", 1000));

        List<LearnerProfileCustomFieldDTO> result = service.getProfileFields(USER, INSTITUTE);

        assertEquals(List.of("roll", "college", "school"), ids(result));
        assertNull(result.get(0).getValue(), "a ticked field with no answer is still offered, empty");
        assertEquals("DPS", result.get(2).getValue());
    }

    @Test
    void leavesOutIdentityHiddenDeletedUnmappedAndUntickedEmptyFields() {
        field("name", "full_name", "Full Name");
        field("mail", "email_inst_9", "Email");
        field("phone", "phone_number", "Phone Number");
        field("utm", "utm_source", "UTM Source").setIsHidden(true);
        field("old", "old_field", "Old Field").setStatus("DELETED");
        field("other", "other_inst", "Other Institute Field");
        field("notes", "notes", "Notes");
        field("school", "school_name", "School Name");
        unmapped.add("other");
        onProfile("name", 1, "Learner Profile");
        onProfile("mail", 2, "Learner Profile");
        onProfile("phone", 3, "Learner Profile");
        onProfile("notes", 4, "Learner's List");
        userRows.add(row("utm", "USER", USER, "google", 1000));
        userRows.add(row("old", "USER", USER, "x", 1000));
        userRows.add(row("other", "USER", USER, "y", 1000));
        userRows.add(row("school", "USER", USER, "DPS", 1000));

        assertEquals(List.of("school"), ids(service.getProfileFields(USER, INSTITUTE)));
    }

    @Test
    void profileRowWinsOverANewerEnrollmentRowAndNewestProfileRowWins() {
        field("school", "school_name", "School Name");
        field("roll", "roll_no", "Roll No");
        userRows.add(row("school", "USER", USER, "Old School", 1000));
        userRows.add(row("school", "USER", USER, "New School", 2000));
        enrollmentRows.add(row("school", "STUDENT_SESSION_INSTITUTE_GROUP_MAPPING", ENROLLMENT, "Enroll School", 3000));
        enrollmentRows.add(row("roll", "STUDENT_SESSION_INSTITUTE_GROUP_MAPPING", ENROLLMENT, "R-12", 3000));

        Map<String, String> values = new HashMap<>();
        service.getProfileFields(USER, INSTITUTE).forEach(f -> values.put(f.getCustomFieldId(), f.getValue()));

        assertEquals("New School", values.get("school"));
        assertEquals("R-12", values.get("roll"), "enrollment-only answers still show");
    }

    @Test
    void notEnrolledSeesNothingAndCannotSave() {
        when(studentSessionRepository.findIdsByUserIdAndInstituteId(USER, INSTITUTE)).thenReturn(List.of());

        assertTrue(service.getProfileFields(USER, INSTITUTE).isEmpty());
        assertThrows(VacademyException.class, () -> service.saveProfileFields(USER, INSTITUTE,
                List.of(new LearnerProfileCustomFieldValueDTO("school", "DPS"))));
        verify(valueService, never()).upsertCustomFieldValues(any());
    }

    @Test
    void refusesFieldsThatAreNotOnTheProfile() {
        field("school", "school_name", "School Name");
        field("fees", "fee_remarks", "Fee Remarks");
        onProfile("school", 1, "Learner Profile");

        assertThrows(VacademyException.class, () -> service.saveProfileFields(USER, INSTITUTE, List.of(
                new LearnerProfileCustomFieldValueDTO("school", "DPS"),
                new LearnerProfileCustomFieldValueDTO("fees", "paid"))));
        verify(valueService, never()).upsertCustomFieldValues(any());
    }

    @Test
    @SuppressWarnings("unchecked")
    void savesAsTheLearnersOwnProfileRow() {
        field("school", "school_name", "School Name");
        field("roll", "roll_no", "Roll No");
        onProfile("school", 1, "Learner Profile");
        userRows.add(row("roll", "USER", USER, "R-1", 1000));

        service.saveProfileFields(USER, INSTITUTE, List.of(
                new LearnerProfileCustomFieldValueDTO("school", "DPS"),
                new LearnerProfileCustomFieldValueDTO("roll", null)));

        ArgumentCaptor<List<CustomFieldValueDto>> saved = ArgumentCaptor.forClass(List.class);
        verify(valueService).upsertCustomFieldValues(saved.capture());
        assertEquals(2, saved.getValue().size());
        for (CustomFieldValueDto dto : saved.getValue()) {
            assertEquals("USER", dto.getSourceType());
            assertEquals(USER, dto.getSourceId());
            assertNull(dto.getType());
        }
        assertEquals("DPS", saved.getValue().get(0).getValue());
        assertEquals("", saved.getValue().get(1).getValue(), "a cleared field is saved empty");
    }

    @Test
    void readsLocationsFromTheStoredSettingShape() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String stored = """
                {"data":{"currentCustomFieldsAndGroups":[
                  {"customFieldId":"a","individualOrder":3,"status":"ACTIVE","locations":["Learner Profile"]},
                  {"customFieldId":"b","individualOrder":1,"status":"DELETED","locations":["Learner Profile"]},
                  {"customFieldId":"c","individualOrder":2,"status":"ACTIVE","locations":["Learner’s List"]}
                ],"customGroup":{"g":{"customFieldId":"d","individualOrder":5,"locations":["learner profile"]}}}}
                """;

        Map<String, Integer> order = LearnerProfileCustomFieldService.learnerProfileFieldOrder(mapper.readTree(stored));

        assertEquals(Map.of("a", 3, "d", 5), order);
        assertTrue(LearnerProfileCustomFieldService.learnerProfileFieldOrder(null).isEmpty());
    }

    @Test
    void brokenSettingsStillShowAnswersButLockEverything() {
        brokenSettings = true;
        field("school", "school_name", "School Name");
        userRows.add(row("school", "USER", USER, "DPS", 1000));

        List<LearnerProfileCustomFieldDTO> result = service.getProfileFields(USER, INSTITUTE);

        assertEquals(List.of("school"), ids(result), "a broken setting still shows filled answers");
        assertFalse(result.get(0).isEditable(), "but nothing can be edited when the rules can't be read");
        assertThrows(VacademyException.class, () -> service.saveProfileFields(USER, INSTITUTE,
                List.of(new LearnerProfileCustomFieldValueDTO("school", "KV"))));
        verify(valueService, never()).upsertCustomFieldValues(any());
    }

    @Test
    void fieldsThatPickAnInvoiceSeriesAreShownButLocked() {
        field("branch", "branch", "Branch");
        field("centre", "centre", "Centre");
        field("school", "school_name", "School Name");
        userRows.add(row("branch", "USER", USER, "North", 1000));
        userRows.add(row("centre", "USER", USER, "Main", 1000));
        userRows.add(row("school", "USER", USER, "DPS", 1000));
        invoiceSetting.put("numberingSeries", List.of(
                Map.of("key", "NORTH", "format", "RCPT-N-{{seq}}", "learnerFieldId", "branch",
                        "values", List.of("North"))));
        invoiceSetting.put("numberingSeriesPolicy", Map.of("askOnFirstPayment", true, "fieldId", "centre"));

        Map<String, Boolean> editable = new HashMap<>();
        service.getProfileFields(USER, INSTITUTE).forEach(f -> editable.put(f.getCustomFieldId(), f.isEditable()));

        assertEquals(Map.of("branch", false, "centre", false, "school", true), editable);
        assertThrows(VacademyException.class, () -> service.saveProfileFields(USER, INSTITUTE,
                List.of(new LearnerProfileCustomFieldValueDTO("branch", "South"))));
        verify(valueService, never()).upsertCustomFieldValues(any());
    }

    @Test
    void fieldsSyncedIntoASystemColumnAreShownButLocked() {
        field("whatsapp", "whatsapp_number", "WhatsApp Number");
        field("school", "school_name", "School Name");
        userRows.add(row("whatsapp", "USER", USER, "919876543210", 1000));
        userRows.add(row("school", "USER", USER, "DPS", 1000));
        systemSynced.add("whatsapp");

        Map<String, Boolean> editable = new HashMap<>();
        service.getProfileFields(USER, INSTITUTE).forEach(f -> editable.put(f.getCustomFieldId(), f.isEditable()));

        assertEquals(Map.of("whatsapp", false, "school", true), editable);
        assertThrows(VacademyException.class, () -> service.saveProfileFields(USER, INSTITUTE,
                List.of(new LearnerProfileCustomFieldValueDTO("whatsapp", "919999999999"))));
        verify(valueService, never()).upsertCustomFieldValues(any());
    }
}
