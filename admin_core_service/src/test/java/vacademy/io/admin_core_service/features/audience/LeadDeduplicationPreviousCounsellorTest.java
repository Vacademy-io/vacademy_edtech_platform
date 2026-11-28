package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupAction;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupField;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupScope;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * findPreviousCounsellorId looks up the earlier lead's owner under the SAME field and scope
 * the dedup check matched on — otherwise "previous" could be a different person who merely
 * shares an email, or a lead outside the lists the institute dedups across.
 */
class LeadDeduplicationPreviousCounsellorTest {

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

    private void withSettings(boolean enabled, DedupField field, DedupScope scope, List<String> audienceIds) {
        when(settings.get("inst-1")).thenReturn(new DedupSettings(enabled, field, scope, audienceIds,
                DedupAction.ALLOW_REASSIGN, LeadDedupSettingService.DEFAULT_REPEAT_LEAD));
    }

    @Test
    void phoneFieldInstituteScopeMatchesOnTheLast10Digits() {
        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of());
        when(responses.findPreviousCounsellorIdByPhoneLast10("inst-1", null, "9876543210", "resp-new"))
                .thenReturn(List.of("counsellor-previous"));

        assertEquals(Optional.of("counsellor-previous"),
                service.findPreviousCounsellorId("inst-1", "aud-1", "p@x.com", "+91 98765-43210", "resp-new"));
        verify(responses, never()).findPreviousCounsellorIdByEmail(any(), any(), any(), any());
    }

    @Test
    void campaignScopeOnlyLooksInsideTheSameList() {
        withSettings(true, DedupField.PHONE, DedupScope.CAMPAIGN, List.of());
        when(responses.findPreviousCounsellorIdByPhoneLast10("inst-1", "aud-1", "9876543210", "resp-new"))
                .thenReturn(List.of("counsellor-previous"));

        assertEquals(Optional.of("counsellor-previous"),
                service.findPreviousCounsellorId("inst-1", "aud-1", null, "9876543210", "resp-new"));
    }

    @Test
    void selectedScopeLooksAcrossTheConfiguredLists() {
        withSettings(true, DedupField.EMAIL, DedupScope.SELECTED, List.of("aud-1", "aud-2"));
        when(responses.findPreviousCounsellorIdByEmail("inst-1", "aud-1,aud-2", "p@x.com", "resp-new"))
                .thenReturn(List.of("counsellor-previous"));

        assertEquals(Optional.of("counsellor-previous"),
                service.findPreviousCounsellorId("inst-1", "aud-1", "p@x.com", "9876543210", "resp-new"));
        verify(responses, never()).findPreviousCounsellorIdByPhoneLast10(any(), any(), any(), any());
    }

    @Test
    void emptyWhenDedupIsOffOrTheIdentifierIsMissing() {
        withSettings(false, DedupField.PHONE, DedupScope.INSTITUTE, List.of());
        assertEquals(Optional.empty(),
                service.findPreviousCounsellorId("inst-1", "aud-1", "p@x.com", "9876543210", "resp-new"));

        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of());
        assertEquals(Optional.empty(),
                service.findPreviousCounsellorId("inst-1", "aud-1", "p@x.com", "12345", "resp-new"));

        withSettings(true, DedupField.EMAIL, DedupScope.INSTITUTE, List.of());
        assertEquals(Optional.empty(),
                service.findPreviousCounsellorId("inst-1", "aud-1", " ", "9876543210", "resp-new"));
        verifyNoInteractions(responses);
    }

    @Test
    void emptyWhenNoMatchedLeadHasAnOwner() {
        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of());
        when(responses.findPreviousCounsellorIdByPhoneLast10(any(), any(), any(), any())).thenReturn(List.of());

        assertEquals(Optional.empty(),
                service.findPreviousCounsellorId("inst-1", "aud-1", null, "9876543210", "resp-new"));
    }
}
