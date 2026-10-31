package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.CounsellorMode;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.ReattemptSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.RepeatLeadSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.StatusMode;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorAssignmentService;
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Repeat-lead discardedToNewCounsellor: a repeat of a discarded (LOST) lead goes to the next
 * pool counsellor, never the one who owned it, even when the repeat joins the same person
 * who still has that owner. Off, or an earlier lead that is still open, keeps SAME_AS_PREVIOUS.
 */
class WebhookRepeatLeadDiscardedNewCounsellorTest {

    private static final String OLD = "counsellor-old";
    private static final String NEXT = "counsellor-next";

    private AudienceService service;
    private LeadDeduplicationService dedup;
    private UserLeadProfileRepository profiles;
    private UserLeadProfileService profileService;
    private CounselorAssignmentService pool;
    private LeadFollowupRepository followups;

    @BeforeEach
    void setUp() throws Exception {
        service = new AudienceService();
        for (Field f : AudienceService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        dedup = (LeadDeduplicationService) get("leadDeduplicationService");
        profiles = (UserLeadProfileRepository) get("userLeadProfileRepository");
        profileService = (UserLeadProfileService) get("userLeadProfileService");
        pool = (CounselorAssignmentService) get("counselorAssignmentService");
        followups = (LeadFollowupRepository) get("leadFollowupRepository");

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        audience.setStatus("ACTIVE");
        audience.setCampaignName("Diploma 2027");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));

        UserDTO user = new UserDTO();
        user.setId("user-1");
        user.setEmail("asha@example.com");
        when(((AuthService) get("authService")).createUserFromAuthService(any(), eq("inst-1"), anyBoolean()))
                .thenReturn(user);
        AudienceResponseRepository responses = (AudienceResponseRepository) get("audienceResponseRepository");
        when(responses.save(any(AudienceResponse.class))).thenAnswer(inv -> {
            AudienceResponse r = inv.getArgument(0);
            r.setId("resp-new");
            return r;
        });

        // Same person, still owned by the counsellor who discarded the lead.
        UserLeadProfile owned = new UserLeadProfile();
        owned.setAssignedCounselorId(OLD);
        when(profiles.findByUserIdAndInstituteId("user-1", "inst-1")).thenReturn(Optional.of(owned));
        when(pool.assignCounselorOnIntake(eq("aud-1"), any())).thenReturn(Optional.of(NEXT));
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private void settings(boolean discardedToNewCounsellor) {
        when(dedup.checkDuplicate(eq("inst-1"), eq("aud-1"), any(), any()))
                .thenReturn(Optional.of(new LeadDeduplicationService.DuplicateMatch(
                        LeadDedupSettingService.DedupAction.ALLOW_REASSIGN, null,
                        new RepeatLeadSettings(CounsellorMode.SAME_AS_PREVIOUS, null, null,
                                StatusMode.KEEP_EXISTING, false, false, ReattemptSettings.OFF, false,
                                false, discardedToNewCounsellor))));
    }

    private void earlierLead(String statusKey) {
        AudienceResponseRepository.PrimaryLeadRow primary = mock(AudienceResponseRepository.PrimaryLeadRow.class);
        when(primary.getResponseId()).thenReturn("resp-old");
        when(primary.getUserId()).thenReturn("user-1");
        when(primary.getCounsellorId()).thenReturn(OLD);
        when(primary.getStatusKey()).thenReturn(statusKey);
        when(dedup.findPrimaryLead(eq("inst-1"), eq("aud-1"), any(), any(), eq("resp-new")))
                .thenReturn(Optional.of(primary));
    }

    private void submit() {
        service.submitLeadFromFormWebhook("aud-1", ProcessedFormDataDTO.builder()
                .email("asha@example.com")
                .fullName("Asha Rao")
                .phone("+919876543210")
                .formFields(Map.of())
                .metadata(Map.of())
                .build(), "META_LEAD_ADS");
    }

    @Test
    void discardedLeadGoesToTheNextCounsellorNotTheOldOne() {
        settings(true);
        earlierLead("LOST");

        submit();

        verify(pool).assignCounselorOnIntake("aud-1", Set.of(OLD));
        verify(profileService).assignCounselor(eq("user-1"), eq("inst-1"), eq(NEXT), any());
        // The old counsellor's open follow-ups on this lead are closed, so they leave their list.
        verify(followups).closeOpenByCreatorsForLeadUsers(eq("inst-1"), eq(Set.of(OLD)), eq(List.of("user-1")),
                any(), any());
    }

    /** Only the old counsellor in the pool: they keep the lead and their follow-ups. */
    @Test
    void poolWithOnlyTheOldCounsellorLeavesEverythingAsIs() {
        settings(true);
        earlierLead("LOST");
        when(pool.assignCounselorOnIntake(eq("aud-1"), any())).thenReturn(Optional.of(OLD));

        submit();

        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
        verify(followups, never()).closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any());
    }

    /** Closing the follow-ups failing must not undo the new counsellor. */
    @Test
    void followUpCloseFailureKeepsTheNewCounsellor() {
        settings(true);
        earlierLead("LOST");
        when(followups.closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any()))
                .thenThrow(new RuntimeException("db blip"));

        submit();

        verify(profileService).assignCounselor(eq("user-1"), eq("inst-1"), eq(NEXT), any());
    }

    @Test
    void openEarlierLeadKeepsTheOldCounsellor() {
        settings(true);
        earlierLead("LEAD");

        submit();

        verify(pool, never()).assignCounselorOnIntake(any(), any());
        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
    }

    @Test
    void convertedEarlierLeadKeepsTheOldCounsellor() {
        settings(true);
        earlierLead("CONVERTED");

        submit();

        verify(pool, never()).assignCounselorOnIntake(any(), any());
        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
    }

    @Test
    void switchOffKeepsTheOldCounsellor() {
        settings(false);
        earlierLead("LOST");

        submit();

        verify(pool, never()).assignCounselorOnIntake(any(), any());
        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
        verify(followups, never()).closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any());
    }

    /** No pool pick (no pool / manual pool): SAME_AS_PREVIOUS as before, so the owner stays. */
    @Test
    void noPoolPickFallsBackToTheCounsellorMode() {
        settings(true);
        earlierLead("LOST");
        when(pool.assignCounselorOnIntake(eq("aud-1"), any())).thenReturn(Optional.empty());

        submit();

        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
    }
}
