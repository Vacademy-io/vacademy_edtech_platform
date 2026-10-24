package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
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
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Under phone dedup with "Allow & reassign", a repeat that comes with a new email joins
 * the person who already holds the phone instead of becoming a second person. That
 * person's owner then carries over untouched.
 */
class WebhookRepeatLeadSamePersonTest {

    private AudienceService service;
    private LeadDeduplicationService dedup;
    private AuthService auth;
    private AudienceResponseRepository responses;
    private UserLeadProfileService profileService;

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
        auth = (AuthService) get("authService");
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        profileService = (UserLeadProfileService) get("userLeadProfileService");

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        audience.setStatus("ACTIVE");
        audience.setCampaignName("Diploma 2027");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));

        UserDTO fresh = new UserDTO();
        fresh.setId("user-new");
        fresh.setEmail("asha@example.com");
        when(auth.createUserFromAuthService(any(), eq("inst-1"), anyBoolean())).thenReturn(fresh);
        when(responses.save(any(AudienceResponse.class))).thenAnswer(inv -> {
            AudienceResponse r = inv.getArgument(0);
            r.setId("resp-new");
            return r;
        });

        UserLeadProfile owned = new UserLeadProfile();
        owned.setAssignedCounselorId("counsellor-previous");
        when(((UserLeadProfileRepository) get("userLeadProfileRepository"))
                .findByUserIdAndInstituteId("user-old", "inst-1")).thenReturn(Optional.of(owned));
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private void repeatMatched() {
        when(dedup.checkDuplicate(eq("inst-1"), eq("aud-1"), any(), any()))
                .thenReturn(Optional.of(new LeadDeduplicationService.DuplicateMatch(
                        LeadDedupSettingService.DedupAction.ALLOW_REASSIGN, null,
                        new RepeatLeadSettings(CounsellorMode.SAME_AS_PREVIOUS, null, null,
                                StatusMode.KEEP_EXISTING))));
    }

    private UserDTO oldPerson() {
        UserDTO old = new UserDTO();
        old.setId("user-old");
        old.setEmail("9876543210@placeholder.example");
        old.setFullName("ASHA RAO");
        return old;
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

    private AudienceResponse saved() {
        ArgumentCaptor<AudienceResponse> captor = ArgumentCaptor.forClass(AudienceResponse.class);
        verify(responses).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void repeatWithANewEmailJoinsThePersonWhoHoldsThePhone() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone("inst-1", "aud-1", "+919876543210"))
                .thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));

        submit();

        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        AudienceResponse response = saved();
        assertEquals("user-old", response.getUserId());
        assertEquals("asha@example.com", response.getParentEmail());
        // Already owned, so SAME_AS_PREVIOUS leaves the owner alone.
        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
    }

    /** The person already has a lead in this list: the repeat still comes in as its own lead. */
    @Test
    void sameListRepeatStillComesInAsItsOwnLead() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(responses.existsByAudienceIdAndUserId("aud-1", "user-old")).thenReturn(true);

        submit();

        verify(auth).createUserFromAuthService(any(), eq("inst-1"), eq(false));
        assertEquals("user-new", saved().getUserId());
    }

    private String submitByHand(String counsellorId) {
        SubmitLeadRequestDTO request = new SubmitLeadRequestDTO();
        request.setAudienceId("aud-1");
        request.setSourceType("WALK_IN");
        request.setCounsellorId(counsellorId);
        UserDTO user = new UserDTO();
        user.setEmail("asha@example.com");
        user.setFullName("Asha Rao");
        user.setMobileNumber("+919876543210");
        request.setUserDTO(user);
        return service.submitLead(request);
    }

    /** A hand-picked counsellor other than the owner keeps the old path, so intake never moves an owned lead. */
    @Test
    void manualCounsellorOtherThanTheOwnerDoesNotJoinThePerson() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));

        submitByHand("counsellor-other");

        verify(auth).createUserFromAuthService(any(), eq("inst-1"), eq(false));
        assertEquals("user-new", saved().getUserId());
    }

    @Test
    void manualCounsellorWhoIsTheOwnerJoinsThePerson() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));

        submitByHand("counsellor-previous");

        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        assertEquals("user-old", saved().getUserId());
    }

    @Test
    void noPersonForThePhoneCreatesByEmailAsBefore() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.empty());

        submit();

        verify(auth).createUserFromAuthService(any(), eq("inst-1"), eq(false));
        assertEquals("user-new", saved().getUserId());
    }

    @Test
    void lookupFailureCreatesByEmailAsBefore() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenThrow(new RuntimeException("db down"));

        submit();

        verify(auth).createUserFromAuthService(any(), eq("inst-1"), eq(false));
        assertEquals("user-new", saved().getUserId());
    }

    @Test
    void personMissingInAuthCreatesByEmailAsBefore() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of());

        submit();

        verify(auth).createUserFromAuthService(any(), eq("inst-1"), eq(false));
    }

    @Test
    void firstTimeLeadNeverLooksUpByPhone() {
        when(dedup.checkDuplicate(any(), any(), any(), any())).thenReturn(Optional.empty());

        submit();

        verify(dedup, never()).findExistingLeadUserIdByPhone(any(), any(), any());
        verify(auth).createUserFromAuthService(any(), eq("inst-1"), eq(false));
    }
}
