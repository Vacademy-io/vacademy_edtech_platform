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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The lead a repeat enquiry repeats is looked up with the dedup check's own field and
 * scope, and the reattempt switches are read from LEAD_SETTING, all off unless set.
 */
class LeadDeduplicationReattemptTest {

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

    private void withSettings(boolean enabled, DedupField field, DedupScope scope) {
        when(settings.get("inst-1")).thenReturn(new DedupSettings(enabled, field, scope, List.of(),
                DedupAction.ALLOW_REASSIGN, LeadDedupSettingService.DEFAULT_REPEAT_LEAD));
    }

    private void withOpenLeadBlock(boolean on, DedupField field, DedupAction action) {
        when(settings.get("inst-1")).thenReturn(new DedupSettings(true, field, DedupScope.INSTITUTE, List.of(),
                action, new LeadDedupSettingService.RepeatLeadSettings(
                        LeadDedupSettingService.CounsellorMode.SAME_AS_PREVIOUS, null, null,
                        LeadDedupSettingService.StatusMode.KEEP_EXISTING, false, false, ReattemptSettings.OFF, on)));
    }

    @Test
    void openLeadLookupOnlyRunsWhenItsSwitchIsOn() {
        withOpenLeadBlock(false, DedupField.PHONE, DedupAction.ALLOW_REASSIGN);
        assertEquals(Optional.empty(), service.findOpenLeadForManualAdd("inst-1", "aud-1", null, "9876543210"));
        withOpenLeadBlock(true, DedupField.PHONE, DedupAction.REJECT);
        assertEquals(Optional.empty(), service.findOpenLeadForManualAdd("inst-1", "aud-1", null, "9876543210"));
        verifyNoInteractions(responses);

        withOpenLeadBlock(true, DedupField.PHONE, DedupAction.ALLOW_REASSIGN);
        when(responses.findOpenLeadByPhoneLast10(any(), any(), any())).thenReturn(List.of());
        service.findOpenLeadForManualAdd("inst-1", "aud-1", null, "+91 98765-43210");
        verify(responses).findOpenLeadByPhoneLast10("inst-1", null, "9876543210");

        withOpenLeadBlock(true, DedupField.EMAIL, DedupAction.ALLOW_REASSIGN);
        when(responses.findOpenLeadByEmail(any(), any(), any())).thenReturn(List.of());
        service.findOpenLeadForManualAdd("inst-1", "aud-1", " a@x.com ", null);
        verify(responses).findOpenLeadByEmail("inst-1", null, "a@x.com");
    }

    @Test
    void phoneLookupUsesTheLast10DigitsAndTheDedupScope() {
        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE);
        when(responses.findPrimaryLeadByPhoneLast10(any(), any(), any(), any())).thenReturn(List.of());

        service.findPrimaryLead("inst-1", "aud-1", "a@x.com", "+91 98765-43210", "resp-new");
        verify(responses).findPrimaryLeadByPhoneLast10("inst-1", null, "9876543210", "resp-new");

        withSettings(true, DedupField.PHONE, DedupScope.CAMPAIGN);
        service.findPrimaryLead("inst-1", "aud-1", "a@x.com", "9876543210", "resp-new");
        verify(responses).findPrimaryLeadByPhoneLast10("inst-1", "aud-1", "9876543210", "resp-new");
    }

    @Test
    void emailDedupLooksUpByEmail() {
        withSettings(true, DedupField.EMAIL, DedupScope.INSTITUTE);
        when(responses.findPrimaryLeadByEmail(any(), any(), any(), any())).thenReturn(List.of());

        service.findPrimaryLead("inst-1", "aud-1", "a@x.com", "9876543210", "resp-new");

        verify(responses).findPrimaryLeadByEmail("inst-1", null, "a@x.com", "resp-new");
        verify(responses, never()).findPrimaryLeadByPhoneLast10(any(), any(), any(), any());
    }

    @Test
    void nothingIsLookedUpWhenDedupIsOffOrTheIdentifierIsMissing() {
        withSettings(false, DedupField.PHONE, DedupScope.INSTITUTE);
        assertEquals(Optional.empty(), service.findPrimaryLead("inst-1", "aud-1", null, "9876543210", "resp-new"));

        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE);
        assertEquals(Optional.empty(), service.findPrimaryLead("inst-1", "aud-1", null, "12345", "resp-new"));
        assertEquals(Optional.empty(), service.findPrimaryLead("inst-1", "aud-1", null, "9876543210", null));
        verifyNoInteractions(responses);
    }

    private static ReattemptSettings parse(String repeatLeadJson) {
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute institute = new Institute();
        institute.setSetting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"dedup\":{\"enabled\":true,"
                + "\"action\":\"ALLOW_REASSIGN\",\"repeatLead\":" + repeatLeadJson + "}}}}}");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(institute));
        return new LeadDedupSettingService(institutes, new ObjectMapper()).get("inst-1").repeatLead().reattempt();
    }

    @Test
    void reattemptSwitchesAreReadFromLeadSettings() {
        assertEquals(ReattemptSettings.OFF, parse("{\"counsellorMode\":\"SAME_AS_PREVIOUS\"}"));
        assertEquals(ReattemptSettings.OFF, parse("{\"reattempt\":\"yes\"}"));
        assertEquals(new ReattemptSettings(true, false, true, false, false, null),
                parse("{\"reattempt\":{\"markDuplicate\":true,\"notifyOwner\":true}}"));
        assertEquals(new ReattemptSettings(true, true, true, true, false, null),
                parse("{\"reattempt\":{\"markDuplicate\":true,\"journeyEntry\":true,\"notifyOwner\":true,"
                        + "\"showBadge\":true}}"));
        assertEquals(new ReattemptSettings(false, false, false, false, true, "VERY_HOT"),
                parse("{\"reattempt\":{\"followUp\":true,\"tier\":\" very_hot \"}}"));
        assertEquals(ReattemptSettings.OFF, parse("{\"reattempt\":{\"tier\":\"\"}}"));
    }

    @Test
    void resetClosedStatusModeIsRead() {
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute institute = new Institute();
        institute.setSetting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"dedup\":{\"enabled\":true,"
                + "\"action\":\"ALLOW_REASSIGN\",\"repeatLead\":{\"statusMode\":\"RESET_CLOSED_TO_NEW\"}}}}}}");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(institute));
        assertEquals(LeadDedupSettingService.StatusMode.RESET_CLOSED_TO_NEW,
                new LeadDedupSettingService(institutes, new ObjectMapper()).get("inst-1").repeatLead().statusMode());
    }

    @Test
    void blockOpenLeadManualAddIsReadAndDefaultsOff() {
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute institute = new Institute();
        institute.setSetting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"dedup\":{\"enabled\":true,"
                + "\"action\":\"ALLOW_REASSIGN\",\"repeatLead\":{\"blockOpenLeadManualAdd\":true}}}}}}");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(institute));
        assertEquals(true, new LeadDedupSettingService(institutes, new ObjectMapper()).get("inst-1")
                .repeatLead().blockOpenLeadManualAdd());
        assertEquals(false, LeadDedupSettingService.DEFAULT_REPEAT_LEAD.blockOpenLeadManualAdd());
    }

    @Test
    void duplicateOpenOnlyDefaultsOn() {
        assertEquals(true, parse("{\"reattempt\":{\"markDuplicate\":true}}").duplicateOpenOnly());
        assertEquals(false, parse("{\"reattempt\":{\"duplicateOpenOnly\":false}}").duplicateOpenOnly());
    }

    @Test
    void duplicateListFilterAcceptsOnlyItsTwoValues() throws Exception {
        java.lang.reflect.Method normalize = vacademy.io.admin_core_service.features.audience.service.AudienceService.class
                .getDeclaredMethod("normalizeDuplicateFilter", String.class);
        normalize.setAccessible(true);
        assertEquals("EXCLUDE", normalize.invoke(null, " exclude "));
        assertEquals("ONLY", normalize.invoke(null, "ONLY"));
        assertEquals(null, normalize.invoke(null, "all"));
        assertEquals(null, normalize.invoke(null, (Object) null));
    }

    @Test
    void openMeansNotConvertedAndNotLost() throws Exception {
        java.lang.reflect.Method open = vacademy.io.admin_core_service.features.audience.service.AudienceService.class
                .getDeclaredMethod("isOpenLeadStatus", String.class);
        open.setAccessible(true);
        assertEquals(true, open.invoke(null, "CALL_BACK"));
        assertEquals(true, open.invoke(null, (Object) null));
        assertEquals(false, open.invoke(null, "lost"));
        assertEquals(false, open.invoke(null, "CONVERTED"));
    }

    @Test
    void sourceTypesReadAsChannelNames() throws Exception {
        java.lang.reflect.Method label = vacademy.io.admin_core_service.features.audience.service.AudienceService.class
                .getDeclaredMethod("reattemptSourceLabel", String.class);
        label.setAccessible(true);
        assertEquals("Meta Lead Ads", label.invoke(null, "META_LEAD_ADS"));
        assertEquals("Google Ads", label.invoke(null, "GOOGLE_LEAD_ADS"));
        assertEquals("website form", label.invoke(null, "AUDIENCE_CAMPAIGN"));
        assertEquals("Zoho forms", label.invoke(null, "ZOHO_FORMS"));
        assertEquals(null, label.invoke(null, " "));
    }
}
