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
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.CounsellorMode;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.RepeatLeadSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.StatusMode;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorAssignmentService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Repeat-lead SAME_AS_PREVIOUS on the webhook path: the repeat goes to the counsellor who
 * owned the earlier lead. It used to be a no-op, so a repeat that matched on phone but came
 * with a new email (a new user, ownerless profile) arrived with no owner at all and skipped
 * the pool too.
 */
class WebhookRepeatLeadSameCounsellorTest {

    private static final String PREVIOUS = "counsellor-previous";

    private AudienceService service;
    private LeadDeduplicationService dedup;
    private UserLeadProfileRepository profiles;
    private UserLeadProfileService profileService;
    private CounselorAssignmentService pool;
    private CounsellorScopeService scope;

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
        scope = (CounsellorScopeService) get("counsellorScopeService");

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        audience.setStatus("ACTIVE");
        audience.setCampaignName("Diploma 2027");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));

        UserDTO user = new UserDTO();
        user.setId("user-new");
        user.setEmail("asha@example.com");
        when(((AuthService) get("authService")).createUserFromAuthService(any(), eq("inst-1"), anyBoolean()))
                .thenReturn(user);
        AudienceResponseRepository responses = (AudienceResponseRepository) get("audienceResponseRepository");
        when(responses.save(any(AudienceResponse.class))).thenAnswer(inv -> {
            AudienceResponse r = inv.getArgument(0);
            r.setId("resp-new");
            return r;
        });

        when(dedup.checkDuplicate(eq("inst-1"), eq("aud-1"), any(), any()))
                .thenReturn(Optional.of(new LeadDeduplicationService.DuplicateMatch(
                        LeadDedupSettingService.DedupAction.ALLOW_REASSIGN, null,
                        new RepeatLeadSettings(CounsellorMode.SAME_AS_PREVIOUS, null, null,
                                StatusMode.KEEP_EXISTING))));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.empty());
        when(scope.allCounsellorUserIds("inst-1")).thenReturn(List.of(PREVIOUS, "counsellor-other"));
        when(pool.assignCounselorOnIntake("aud-1")).thenReturn(Optional.of("counsellor-other"));
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
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
    void phoneMatchWithANewEmailGoesToThePreviousCounsellor() {
        when(dedup.findPreviousCounsellorId("inst-1", "aud-1", "asha@example.com", "+919876543210", "resp-new"))
                .thenReturn(Optional.of(PREVIOUS));

        submit();

        verify(profileService).assignCounselor(eq("user-new"), eq("inst-1"), eq(PREVIOUS), any());
        verify(pool, never()).assignCounselorOnIntake(any());
    }

    /** Same person record that already has an owner — untouched, exactly as before. */
    @Test
    void repeatThatIsAlreadyOwnedKeepsItsOwner() {
        UserLeadProfile owned = new UserLeadProfile();
        owned.setAssignedCounselorId("counsellor-existing");
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(owned));

        submit();

        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
        verify(pool, never()).assignCounselorOnIntake(any());
        verify(dedup, never()).findPreviousCounsellorId(any(), any(), any(), any(), any());
    }

    /** Nobody owned the earlier lead — the pool routes it, so the repeat never arrives unowned. */
    @Test
    void noPreviousOwnerFallsBackToThePool() {
        when(dedup.findPreviousCounsellorId(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        submit();

        verify(pool).assignCounselorOnIntake("aud-1");
        verify(profileService).assignCounselor(eq("user-new"), eq("inst-1"), eq("counsellor-other"), any());
    }

    /** A removed counsellor would make the lead invisible to every counsellor — use the pool. */
    @Test
    void previousOwnerWhoIsNoLongerACounsellorFallsBackToThePool() {
        when(dedup.findPreviousCounsellorId(any(), any(), any(), any(), any()))
                .thenReturn(Optional.of("counsellor-removed"));

        submit();

        verify(profileService, never()).assignCounselor(any(), any(), eq("counsellor-removed"), any());
        verify(pool).assignCounselorOnIntake("aud-1");
    }

    /** Can't tell whether the lead is already owned — don't risk replacing an owner. */
    @Test
    void profileLookupFailureLeavesTheCounsellorUntouched() {
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenThrow(new RuntimeException("db down"));

        submit();

        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
        verify(pool, never()).assignCounselorOnIntake(any());
    }
}
