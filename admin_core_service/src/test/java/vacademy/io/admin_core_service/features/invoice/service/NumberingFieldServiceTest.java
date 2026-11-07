package vacademy.io.admin_core_service.features.invoice.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The numbering-series field (e.g. branch) is asked once per enrolment, validated against the
 * field's options, and pinned so later installments never ask again. Off unless configured.
 */
class NumberingFieldServiceTest {

    private static final String INST = "inst-1";
    private static final String FIELD = "field-branch";

    private InstituteSettingService settings;
    private CustomFieldRepository fields;
    private CustomFieldValuesRepository values;
    private StudentSessionRepository sessions;
    private NumberingFieldService service;
    private final Map<String, Object> invoiceSetting = new HashMap<>();

    @BeforeEach
    void setUp() {
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute institute = new Institute();
        when(institutes.findById(INST)).thenReturn(Optional.of(institute));
        settings = mock(InstituteSettingService.class);
        when(settings.getSettingData(any(), eq("INVOICE_SETTING"))).thenReturn(invoiceSetting);
        fields = mock(CustomFieldRepository.class);
        CustomFields branch = new CustomFields();
        branch.setId(FIELD);
        branch.setFieldName("Branch");
        branch.setConfig("[{\"id\":1,\"value\":\"Branch A\",\"label\":\"Branch A\"},{\"id\":2,\"value\":\"Branch B\",\"label\":\"Branch B\"}]");
        when(fields.findById(FIELD)).thenReturn(Optional.of(branch));
        values = mock(CustomFieldValuesRepository.class);
        sessions = mock(StudentSessionRepository.class);

        service = new NumberingFieldService();
        ReflectionTestUtils.setField(service, "instituteRepository", institutes);
        ReflectionTestUtils.setField(service, "instituteSettingService", settings);
        ReflectionTestUtils.setField(service, "customFieldRepository", fields);
        ReflectionTestUtils.setField(service, "customFieldValuesRepository", values);
        ReflectionTestUtils.setField(service, "studentSessionRepository", sessions);
    }

    private void configure(boolean ask, boolean required) {
        invoiceSetting.put("numbering", Map.of("format", "RCPT-A-{{seq}}", "seqScope", "NEVER"));
        invoiceSetting.put("numberingSeries", List.of(Map.of("key", "B", "format", "RCPT-B-{{seq}}",
                "startFrom", 1, "learnerFieldId", FIELD, "values", List.of("Branch B"))));
        invoiceSetting.put("numberingSeriesPolicy", Map.of("askOnFirstPayment", ask, "required", required));
    }

    private static StudentSessionInstituteGroupMapping mapping(String id) {
        StudentSessionInstituteGroupMapping m = new StudentSessionInstituteGroupMapping();
        m.setId(id);
        return m;
    }

    @Test
    @DisplayName("off by default: nothing is asked and a picked value is ignored")
    void offByDefault() {
        assertFalse(service.describe(INST, "plan-1", "user-1").isAsk());
        configure(false, true);
        assertFalse(service.describe(INST, "plan-1", "user-1").isAsk());
        service.pin(INST, "plan-1", "user-1", "Branch B");
        verify(values, never()).saveAndFlush(any());
    }

    @Test
    @DisplayName("first payment of an enrolment: asked, required, options and the learner's value")
    void asksOnFirstPayment() {
        configure(true, true);
        when(values.findLatestValueForUser(FIELD, "user-1")).thenReturn("Branch B");
        NumberingFieldService.Info info = service.describe(INST, "plan-1", "user-1");
        assertTrue(info.isAsk());
        assertTrue(info.isRequired());
        assertEquals("Branch", info.getLabel());
        assertEquals(List.of("Branch A", "Branch B"), info.getOptions());
        assertEquals("Branch B", info.getSuggested());
        assertNull(info.getValue());
    }

    @Test
    @DisplayName("an enrolment that already has a value is not asked again")
    void notAskedOncePinned() {
        configure(true, true);
        when(values.findLatestValueForEnrollment(FIELD, "plan-1")).thenReturn("Branch A");
        NumberingFieldService.Info info = service.describe(INST, "plan-1", "user-1");
        assertFalse(info.isAsk());
        assertEquals("Branch A", info.getValue());
    }

    @Test
    @DisplayName("a value outside the field's options is rejected; spelling is canonicalised")
    void validates() {
        configure(true, true);
        assertEquals("Branch B", service.validate(INST, " branch b "));
        assertThrows(VacademyException.class, () -> service.validate(INST, "Branch Z"));
        assertNull(service.validate(INST, "  "));
    }

    @Test
    @DisplayName("pin writes the value on every mapping of the enrolment and on an empty profile")
    void pinsEnrolmentAndProfile() {
        configure(true, true);
        when(sessions.findAllByUserPlanIdAndStatusIn(eq("plan-1"), anyList()))
                .thenReturn(List.of(mapping("m-1"), mapping("m-2")));
        service.pin(INST, "plan-1", "user-1", "branch b");
        ArgumentCaptor<CustomFieldValues> saved = ArgumentCaptor.forClass(CustomFieldValues.class);
        verify(values, times(3)).saveAndFlush(saved.capture());
        assertEquals(List.of("m-1", "m-2", "user-1"),
                saved.getAllValues().stream().map(CustomFieldValues::getSourceId).toList());
        assertEquals(List.of("STUDENT_SESSION_INSTITUTE_GROUP_MAPPING", "STUDENT_SESSION_INSTITUTE_GROUP_MAPPING", "USER"),
                saved.getAllValues().stream().map(CustomFieldValues::getSourceType).toList());
        assertTrue(saved.getAllValues().stream().allMatch(v -> "Branch B".equals(v.getValue())
                && FIELD.equals(v.getCustomFieldId())));
    }

    @Test
    @DisplayName("a pinned enrolment and a filled profile are never overwritten")
    void neverOverwrites() {
        configure(true, true);
        when(values.findLatestValueForEnrollment(FIELD, "plan-1")).thenReturn("Branch A");
        when(values.findLatestValueForUser(FIELD, "user-1")).thenReturn("Branch A");
        service.pin(INST, "plan-1", "user-1", "Branch B");
        verify(values, never()).saveAndFlush(any());
    }

    @Test
    @DisplayName("an invalid value fails before anything is written")
    void invalidPinWritesNothing() {
        configure(true, true);
        assertThrows(VacademyException.class, () -> service.pin(INST, "plan-1", "user-1", "Nowhere"));
        verify(values, never()).saveAndFlush(any());
    }

    @Test
    @DisplayName("options are read from all three stored config shapes")
    void optionShapes() {
        CustomFields f = new CustomFields();
        f.setConfig("{\"options\":[{\"value\":\"X\"},{\"label\":\"Y\"}],\"defaultValue\":\"X\"}");
        assertEquals(List.of("X", "Y"), NumberingFieldService.optionsOf(f));
        f.setConfig("{\"coommaSepartedOptions\":\"P, Q ,P\"}");
        assertEquals(List.of("P", "Q"), NumberingFieldService.optionsOf(f));
        f.setConfig(null);
        assertTrue(NumberingFieldService.optionsOf(f).isEmpty());
    }
}
