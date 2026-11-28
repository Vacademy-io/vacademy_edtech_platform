package vacademy.io.admin_core_service.features.audience;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupAction;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupField;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupScope;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.ReattemptSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * repeatLead.alsoMatchEmail: under PHONE dedup with "Allow & reassign", an enquiry whose
 * phone matches no lead is still a repeat when its email matches one (e.g. a Google form
 * prefilled with a different phone). Off by default, never applied to in-place edits.
 */
class LeadDeduplicationEmailFallbackTest {

    private LeadDeduplicationService service;
    private AudienceResponseRepository responses;
    private LeadDedupSettingService settings;

    @BeforeEach
    void setUp() throws Exception {
        service = new LeadDeduplicationService();
        for (Field f : LeadDeduplicationService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class)) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        settings = (LeadDedupSettingService) get("leadDedupSettingService");
    }

    private Object get(String field) throws Exception {
        Field f = LeadDeduplicationService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private void withSettings(boolean alsoMatchEmail, DedupAction action, boolean blockOpenLeadManualAdd) {
        when(settings.get("inst-1")).thenReturn(new DedupSettings(true, DedupField.PHONE, DedupScope.INSTITUTE,
                List.of(), action, new LeadDedupSettingService.RepeatLeadSettings(
                        LeadDedupSettingService.CounsellorMode.SAME_AS_PREVIOUS, null, null,
                        LeadDedupSettingService.StatusMode.KEEP_EXISTING, true, true, ReattemptSettings.OFF,
                        blockOpenLeadManualAdd, alsoMatchEmail)));
    }

    @Test
    void newPhoneWithAKnownEmailIsARepeatWhenSwitchedOn() {
        withSettings(true, DedupAction.ALLOW_REASSIGN, false);
        when(responses.existsByInstituteIdAndPhoneLast10("inst-1", "9023884961", null)).thenReturn(false);
        when(responses.existsByInstituteIdAndParentEmailIgnoreCase("inst-1", "a@x.com", null)).thenReturn(true);

        var match = service.checkDuplicate("inst-1", "aud-1", " a@x.com ", "+919023884961");

        assertTrue(match.isPresent());
        assertEquals(DedupAction.ALLOW_REASSIGN, match.get().action());
    }

    @Test
    void switchOffKeepsPhoneOnlyMatching() {
        withSettings(false, DedupAction.ALLOW_REASSIGN, false);
        when(responses.existsByInstituteIdAndPhoneLast10(any(), any(), any())).thenReturn(false);

        assertEquals(Optional.empty(), service.checkDuplicate("inst-1", "aud-1", "a@x.com", "9023884961"));
        verify(responses, never()).existsByInstituteIdAndParentEmailIgnoreCase(any(), any(), any());
    }

    @Test
    void rejectActionAndInPlaceEditsNeverFallBackToEmail() {
        withSettings(true, DedupAction.REJECT, false);
        when(responses.existsByInstituteIdAndPhoneLast10(any(), any(), any())).thenReturn(false);
        assertEquals(Optional.empty(), service.checkDuplicate("inst-1", "aud-1", "a@x.com", "9023884961"));

        withSettings(true, DedupAction.ALLOW_REASSIGN, false);
        assertEquals(Optional.empty(),
                service.checkDuplicate("inst-1", "aud-1", "a@x.com", "9023884961", "resp-being-edited"));
        verify(responses, never()).existsByInstituteIdAndParentEmailIgnoreCase(any(), any(), any());
    }

    @Test
    void phoneMatchStillWinsAndBlankEmailMatchesNothing() {
        withSettings(true, DedupAction.ALLOW_REASSIGN, false);
        when(responses.existsByInstituteIdAndPhoneLast10("inst-1", "8347649467", null)).thenReturn(true);
        assertTrue(service.checkDuplicate("inst-1", "aud-1", "a@x.com", "8347649467").isPresent());
        verify(responses, never()).existsByInstituteIdAndParentEmailIgnoreCase(any(), any(), any());

        when(responses.existsByInstituteIdAndPhoneLast10("inst-1", "9023884961", null)).thenReturn(false);
        assertEquals(Optional.empty(), service.checkDuplicate("inst-1", "aud-1", " ", "9023884961"));
        verify(responses, never()).existsByInstituteIdAndParentEmailIgnoreCase(any(), any(), any());
    }

    @Test
    void placeholderEmailsNeverMatchByEmail() throws Exception {
        withSettings(true, DedupAction.ALLOW_REASSIGN, true);
        vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService placeholders =
                (vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService)
                        get("placeholderEmailService");
        when(placeholders.isPlaceholder(anyString()))
                .thenAnswer(inv -> ((String) inv.getArgument(0)).endsWith("@vacademy.com"));
        when(responses.existsByInstituteIdAndPhoneLast10(any(), any(), any())).thenReturn(false);
        when(responses.findPrimaryLeadByPhoneLast10(any(), any(), any(), any())).thenReturn(List.of());
        when(responses.findOpenLeadByPhoneLast10(any(), any(), any())).thenReturn(List.of());

        assertEquals(Optional.empty(),
                service.checkDuplicate("inst-1", "aud-1", "raj9023884961@vacademy.com", "9023884961"));
        assertEquals(Optional.empty(), service.checkDuplicate("inst-1", "aud-1", "9023884961@emailid.no", "9023884961"));
        service.findPrimaryLead("inst-1", "aud-1", "child_ab12@noemail.vacademy.io", "9023884961", "resp-new");
        service.findOpenLeadForManualAdd("inst-1", "aud-1", "9023884961@email.no", "9023884961");

        verify(responses, never()).existsByInstituteIdAndParentEmailIgnoreCase(any(), any(), any());
        verify(responses, never()).findPrimaryLeadByEmail(any(), any(), any(), any());
        verify(responses, never()).findOpenLeadByEmail(any(), any(), any());
    }

    @Test
    void shortPhoneStillMatchesByEmail() {
        withSettings(true, DedupAction.ALLOW_REASSIGN, false);
        when(responses.existsByInstituteIdAndParentEmailIgnoreCase("inst-1", "a@x.com", null)).thenReturn(true);
        assertTrue(service.checkDuplicate("inst-1", "aud-1", "a@x.com", "12345").isPresent());
    }

    @Test
    void primaryLeadFallsBackToTheEmailMatch() {
        withSettings(true, DedupAction.ALLOW_REASSIGN, false);
        when(responses.findPrimaryLeadByPhoneLast10(any(), any(), any(), any())).thenReturn(List.of());
        when(responses.findPrimaryLeadByEmail(any(), any(), any(), any())).thenReturn(List.of());

        service.findPrimaryLead("inst-1", "aud-1", "a@x.com", "9023884961", "resp-new");

        verify(responses).findPrimaryLeadByPhoneLast10("inst-1", null, "9023884961", "resp-new");
        verify(responses).findPrimaryLeadByEmail("inst-1", null, "a@x.com", "resp-new");
    }

    @Test
    void primaryLeadByPhoneSkipsTheEmailLookup() {
        withSettings(true, DedupAction.ALLOW_REASSIGN, false);
        AudienceResponseRepository.PrimaryLeadRow row = mock(AudienceResponseRepository.PrimaryLeadRow.class);
        when(responses.findPrimaryLeadByPhoneLast10(any(), any(), any(), any())).thenReturn(List.of(row));

        assertSame(row, service.findPrimaryLead("inst-1", "aud-1", "a@x.com", "9023884961", "resp-new").orElseThrow());
        verify(responses, never()).findPrimaryLeadByEmail(any(), any(), any(), any());
    }

    @Test
    void previousOwnerAndOpenLeadGuardFallBackToEmail() {
        withSettings(true, DedupAction.ALLOW_REASSIGN, true);
        when(responses.findPreviousCounsellorIdByPhoneLast10(any(), any(), any(), any())).thenReturn(List.of());
        when(responses.findPreviousCounsellorIdByEmail("inst-1", null, "a@x.com", "resp-new"))
                .thenReturn(List.of("counsellor-1"));
        assertEquals(Optional.of("counsellor-1"),
                service.findPreviousCounsellorId("inst-1", "aud-1", "a@x.com", "9023884961", "resp-new"));

        when(responses.findOpenLeadByPhoneLast10(any(), any(), any())).thenReturn(List.of());
        when(responses.findOpenLeadByEmail(any(), any(), any())).thenReturn(List.of());
        service.findOpenLeadForManualAdd("inst-1", "aud-1", " a@x.com ", "9023884961");
        verify(responses).findOpenLeadByEmail("inst-1", null, "a@x.com");
    }

    @Test
    void alsoMatchEmailIsReadAndDefaultsOff() {
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute institute = new Institute();
        institute.setSetting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"dedup\":{\"enabled\":true,"
                + "\"action\":\"ALLOW_REASSIGN\",\"repeatLead\":{\"alsoMatchEmail\":true}}}}}}");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(institute));
        assertTrue(new LeadDedupSettingService(institutes, new ObjectMapper()).get("inst-1")
                .repeatLead().alsoMatchEmail());
        assertFalse(LeadDedupSettingService.DEFAULT_REPEAT_LEAD.alsoMatchEmail());
    }
}
