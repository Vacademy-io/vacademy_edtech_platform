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
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.RepeatLeadSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The same-person and current-owner lookups only answer under PHONE dedup with
 * "Allow & reassign" and their own Lead Settings switch on, in the scope the dedup check
 * uses — any other setting keeps the old behaviour (a new email is a new person; manual
 * adds are not checked).
 */
class LeadDeduplicationSamePersonTest {

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

    private static final RepeatLeadSettings BOTH_ON = new RepeatLeadSettings(
            LeadDedupSettingService.CounsellorMode.SAME_AS_PREVIOUS, null, null,
            LeadDedupSettingService.StatusMode.KEEP_EXISTING, true, true);

    private void withSettings(boolean enabled, DedupField field, DedupScope scope, List<String> audienceIds,
            DedupAction action) {
        withSettings(enabled, field, scope, audienceIds, action, BOTH_ON);
    }

    private void withSettings(boolean enabled, DedupField field, DedupScope scope, List<String> audienceIds,
            DedupAction action, RepeatLeadSettings repeatLead) {
        when(settings.get("inst-1")).thenReturn(new DedupSettings(enabled, field, scope, audienceIds,
                action, repeatLead));
    }

    @Test
    void lookupsStayOffUntilTheirSwitchIsOn() {
        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of(), DedupAction.ALLOW_REASSIGN,
                LeadDedupSettingService.DEFAULT_REPEAT_LEAD);
        assertEquals(Optional.empty(), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "9876543210"));
        assertEquals(Optional.empty(), service.findCurrentOwnerByPhone("inst-1", "aud-1", "9876543210"));
        verifyNoInteractions(responses);

        // Each switch only turns on its own lookup.
        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of(), DedupAction.ALLOW_REASSIGN,
                new RepeatLeadSettings(LeadDedupSettingService.CounsellorMode.SAME_AS_PREVIOUS, null, null,
                        LeadDedupSettingService.StatusMode.KEEP_EXISTING, false, true));
        assertEquals(Optional.empty(), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "9876543210"));
        verify(responses, never()).findLeadUserIdByPhoneLast10(any(), any(), any());
    }

    @Test
    void phoneReassignInstituteScopeFindsThePersonOnTheLast10Digits() {
        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of(), DedupAction.ALLOW_REASSIGN);
        when(responses.findLeadUserIdByPhoneLast10("inst-1", null, "9876543210")).thenReturn(List.of("user-old"));

        assertEquals(Optional.of("user-old"),
                service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "+91 98765-43210"));
    }

    @Test
    void campaignAndSelectedScopesPassTheirLists() {
        withSettings(true, DedupField.PHONE, DedupScope.CAMPAIGN, List.of(), DedupAction.ALLOW_REASSIGN);
        when(responses.findLeadUserIdByPhoneLast10("inst-1", "aud-1", "9876543210")).thenReturn(List.of("user-a"));
        assertEquals(Optional.of("user-a"), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "9876543210"));

        withSettings(true, DedupField.PHONE, DedupScope.SELECTED, List.of("aud-1", "aud-2"),
                DedupAction.ALLOW_REASSIGN);
        when(responses.findLeadUserIdByPhoneLast10("inst-1", "aud-1,aud-2", "9876543210"))
                .thenReturn(List.of("user-b"));
        assertEquals(Optional.of("user-b"), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "9876543210"));
    }

    @Test
    void anyOtherSettingKeepsTheOldBehaviour() {
        withSettings(false, DedupField.PHONE, DedupScope.INSTITUTE, List.of(), DedupAction.ALLOW_REASSIGN);
        assertEquals(Optional.empty(), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "9876543210"));

        withSettings(true, DedupField.EMAIL, DedupScope.INSTITUTE, List.of(), DedupAction.ALLOW_REASSIGN);
        assertEquals(Optional.empty(), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "9876543210"));

        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of(), DedupAction.REJECT);
        assertEquals(Optional.empty(), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "9876543210"));
        assertEquals(Optional.empty(), service.findCurrentOwnerByPhone("inst-1", "aud-1", "9876543210"));

        // SELECTED with no lists dedups nothing, so it must not match a person either.
        withSettings(true, DedupField.PHONE, DedupScope.SELECTED, List.of(), DedupAction.ALLOW_REASSIGN);
        assertEquals(Optional.empty(), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "9876543210"));

        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of(), DedupAction.ALLOW_REASSIGN);
        assertEquals(Optional.empty(), service.findExistingLeadUserIdByPhone("inst-1", "aud-1", "12345"));

        verifyNoInteractions(responses);
    }

    @Test
    void currentOwnerComesFromTheSameScope() {
        withSettings(true, DedupField.PHONE, DedupScope.INSTITUTE, List.of(), DedupAction.ALLOW_REASSIGN);
        AudienceResponseRepository.LeadOwnerRow row = mock(AudienceResponseRepository.LeadOwnerRow.class);
        when(row.getCounsellorId()).thenReturn("counsellor-1");
        when(responses.findCurrentOwnerByPhoneLast10("inst-1", null, "9876543210")).thenReturn(List.of(row));

        assertEquals("counsellor-1",
                service.findCurrentOwnerByPhone("inst-1", "aud-1", "9876543210").orElseThrow().getCounsellorId());
    }
}
