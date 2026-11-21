package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.OpenAssessmentLeadEventDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.AutoListLeadLookupRepository;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** An open assessment's registrants land in its own list, and their marks follow. */
class OpenAssessmentLeadServiceTest {

    private OpenAssessmentLeadService service;
    private AutoLeadListProvisioner provisioner;
    private AudienceService audienceService;
    private AudienceResponseRepository responses;
    private CustomFieldValuesRepository values;
    private AutoListLeadLookupRepository lookup;
    private Audience list;

    @BeforeEach
    void setUp() throws Exception {
        service = new OpenAssessmentLeadService();
        for (Field f : OpenAssessmentLeadService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class)) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        provisioner = (AutoLeadListProvisioner) get("provisioner");
        audienceService = (AudienceService) get("audienceService");
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        values = (CustomFieldValuesRepository) get("customFieldValuesRepository");
        lookup = (AutoListLeadLookupRepository) get("leadLookupRepository");

        list = new Audience();
        list.setId("aud-1");
        list.setInstituteId("inst-1");
        list.setStatus("ACTIVE");
        when(provisioner.getOrCreate("inst-1", "Open Assessment", "test-1", "Admission Test Class 6")).thenReturn(list);
        // field id = "cf:" + the column name, so assertions read naturally
        when(provisioner.ensureField(eq("inst-1"), eq("aud-1"), anyString(), anyInt()))
                .thenAnswer(inv -> "cf:" + inv.getArgument(2));
    }

    private Object get(String name) throws Exception {
        Field f = OpenAssessmentLeadService.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(service);
    }

    private static OpenAssessmentLeadEventDTO event() {
        return OpenAssessmentLeadEventDTO.builder()
                .instituteId("inst-1").assessmentId("test-1").assessmentName("Admission Test Class 6")
                .userId("user-1").fullName("Asha Rao").email("asha@example.com").mobileNumber("+919876543210")
                .build();
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> submittedValues() {
        ArgumentCaptor<Map<String, String>> captor = ArgumentCaptor.forClass(Map.class);
        verify(audienceService).submitLeadToAutoList(same(list), eq("Asha Rao"), eq("asha@example.com"),
                eq("+919876543210"), captor.capture(), eq("OPEN_ASSESSMENT"), eq("test-1"));
        return captor.getValue();
    }

    @Test
    void registrationBecomesALeadWithEveryFormAnswerAndStatusRegistered() {
        OpenAssessmentLeadEventDTO e = event();
        e.setAnswers(List.of(
                new OpenAssessmentLeadEventDTO.Answer("Class", "6"),
                new OpenAssessmentLeadEventDTO.Answer("Parent Name", " Ravi Rao "),
                new OpenAssessmentLeadEventDTO.Answer("Full Name", "Asha Rao"),
                new OpenAssessmentLeadEventDTO.Answer("phone_number", "9876543210"),
                new OpenAssessmentLeadEventDTO.Answer("City", "  ")));

        service.captureRegistration(e);

        Map<String, String> v = submittedValues();
        assertEquals(Map.of("cf:Class", "6", "cf:Parent Name", "Ravi Rao", "cf:Test Status", "Registered"), v);
        verify(provisioner, never()).ensureField(any(), any(), eq("Full Name"), anyInt());
        verify(provisioner, never()).ensureField(any(), any(), eq("City"), anyInt());
    }

    @Test
    void noEmailMeansNoLead() {
        OpenAssessmentLeadEventDTO e = event();
        e.setEmail(" ");

        assertNull(service.captureRegistration(e));
        verifyNoInteractions(audienceService);
    }

    @Test
    void aPausedListIsLeftAlone() {
        list.setStatus("INACTIVE");

        assertNull(service.captureRegistration(event()));
        verifyNoInteractions(audienceService);
    }

    @Test
    void resultWritesMarksPercentageAndCompletedOnTheSameLead() {
        AudienceResponse lead = new AudienceResponse();
        lead.setId("lead-1");
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus("aud-1", "user-1", "ACTIVE"))
                .thenReturn(List.of(lead));
        CustomFieldValues status = CustomFieldValues.builder().id("v-status").customFieldId("cf:Test Status")
                .sourceType("AUDIENCE_RESPONSE").sourceId("lead-1").value("Registered").build();
        when(values.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                anyString(), eq("AUDIENCE_RESPONSE"), eq("lead-1")))
                .thenAnswer(inv -> "cf:Test Status".equals(inv.getArgument(0))
                        ? Optional.of(status) : Optional.empty());
        OpenAssessmentLeadEventDTO e = event();
        e.setMarks(56.0);
        e.setTotalMarks(100.0);
        e.setPercentage(56.0);

        service.recordResult(e);

        ArgumentCaptor<CustomFieldValues> saved = ArgumentCaptor.forClass(CustomFieldValues.class);
        verify(values, times(3)).save(saved.capture());
        Map<String, String> byField = new HashMap<>();
        saved.getAllValues().forEach(v -> {
            assertEquals("lead-1", v.getSourceId());
            byField.put(v.getCustomFieldId(), v.getValue());
        });
        assertEquals(Map.of("cf:Marks Scored", "56/100", "cf:Percentage", "56", "cf:Test Status", "Completed"),
                byField);
        assertEquals("v-status", saved.getAllValues().get(2).getId(), "status row is updated, not duplicated");
        verifyNoInteractions(audienceService);
    }

    @Test
    void resultFindsTheLeadByEmailWhenTheUserIdDiffers() {
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus(any(), any(), any())).thenReturn(List.of());
        AudienceResponse mine = new AudienceResponse();
        mine.setId("lead-1");
        when(lookup.findFirstInListByEmail("aud-1", "asha@example.com")).thenReturn(Optional.of(mine));
        when(values.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(any(), any(), any()))
                .thenReturn(Optional.empty());

        service.recordResult(event());

        ArgumentCaptor<CustomFieldValues> saved = ArgumentCaptor.forClass(CustomFieldValues.class);
        verify(values, atLeastOnce()).save(saved.capture());
        saved.getAllValues().forEach(v -> assertEquals("lead-1", v.getSourceId()));
        verifyNoInteractions(audienceService);
    }

    @Test
    void emailWinsOverAUserIdThatPointsAtASiblingsLead() {
        // Lead created through phone dedup can carry the sibling's user id.
        AudienceResponse siblingLead = new AudienceResponse();
        siblingLead.setId("lead-sibling");
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus("aud-1", "user-1", "ACTIVE"))
                .thenReturn(List.of(siblingLead));
        AudienceResponse mine = new AudienceResponse();
        mine.setId("lead-1");
        when(lookup.findFirstInListByEmail("aud-1", "asha@example.com")).thenReturn(Optional.of(mine));
        when(values.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(any(), any(), any()))
                .thenReturn(Optional.empty());

        service.recordResult(event());

        verify(values, atLeastOnce()).save(argThat(v -> "lead-1".equals(v.getSourceId())));
        verify(values, never()).save(argThat(v -> "lead-sibling".equals(v.getSourceId())));
    }

    @Test
    void someoneWithoutALeadNeverGetsMarksOnAnotherLeadSharingTheirPhone() {
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus(any(), any(), any())).thenReturn(List.of());
        when(lookup.findFirstInListByEmail(any(), any())).thenReturn(Optional.empty());

        service.recordResult(event());

        verify(values, never()).save(any());
    }

    @Test
    void aLeadTheAdminDeletedIsNotBroughtBackByAResult() {
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus(any(), any(), any())).thenReturn(List.of());
        when(lookup.findFirstInListByEmail(any(), any())).thenReturn(Optional.empty());
        when(lookup.existsInListByEmailAnyStatus("aud-1", "asha@example.com")).thenReturn(true);

        service.recordResult(event());

        verifyNoInteractions(audienceService);
        verify(values, never()).save(any());
    }

    @Test
    void aDeletedLeadFoundByUserIdIsNotBroughtBackEither() {
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus(any(), any(), any())).thenReturn(List.of());
        when(lookup.findFirstInListByEmail(any(), any())).thenReturn(Optional.empty());
        when(responses.existsByAudienceIdAndUserId("aud-1", "user-1")).thenReturn(true);

        service.recordResult(event());

        verifyNoInteractions(audienceService);
    }

    @Test
    void aColumnTheAdminRemovedIsLeftOut() {
        when(provisioner.ensureField("inst-1", "aud-1", "Class", 3)).thenReturn(null);
        OpenAssessmentLeadEventDTO e = event();
        e.setAnswers(List.of(new OpenAssessmentLeadEventDTO.Answer("Class", "6"),
                new OpenAssessmentLeadEventDTO.Answer("Parent Name", "Ravi")));

        service.captureRegistration(e);

        assertEquals(Map.of("cf:Parent Name", "Ravi", "cf:Test Status", "Registered"), submittedValues());
    }

    @Test
    void resultForSomeoneWithNoLeadYetCreatesTheLeadFirst() {
        AudienceResponse lead = new AudienceResponse();
        lead.setId("lead-new");
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus("aud-1", "user-1", "ACTIVE"))
                .thenReturn(List.of())
                .thenReturn(List.of(lead));
        when(values.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(any(), any(), any()))
                .thenReturn(Optional.empty());
        OpenAssessmentLeadEventDTO e = event();
        e.setMarks(10.5);
        e.setTotalMarks(20.0);

        service.recordResult(e);

        submittedValues();
        verify(values).save(argThat(v -> "cf:Marks Scored".equals(v.getCustomFieldId())
                && "10.5/20".equals(v.getValue()) && "lead-new".equals(v.getSourceId())));
    }

    @Test
    void numbersAreWrittenTheWayACounsellorReadsThem() {
        assertEquals("56", OpenAssessmentLeadService.number(56.0));
        assertEquals("56.46", OpenAssessmentLeadService.number(56.456));
        assertNull(OpenAssessmentLeadService.number(Double.NaN));
        assertEquals("56/100", OpenAssessmentLeadService.marksText(56.0, 100.0));
        assertEquals("56", OpenAssessmentLeadService.marksText(56.0, null));
        assertNull(OpenAssessmentLeadService.marksText(null, 100.0));
        assertTrue(OpenAssessmentLeadService.isIdentityField(" Mobile  Number "));
        assertTrue(OpenAssessmentLeadService.isIdentityField("full_name"));
        assertFalse(OpenAssessmentLeadService.isIdentityField("Class"));
    }
}
