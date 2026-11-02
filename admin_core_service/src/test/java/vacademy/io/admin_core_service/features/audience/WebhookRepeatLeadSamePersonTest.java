package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.CatalogueLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.CounsellorMode;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.ReattemptSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.RepeatLeadSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.StatusMode;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.audience.service.LeadTierService;
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

    private AudienceResponse existingLeadInList() {
        AudienceResponse existing = AudienceResponse.builder()
                .id("resp-old")
                .audienceId("aud-1")
                .userId("user-old")
                .parentMobile("+919876543210")
                .build();
        when(responses.existsByAudienceIdAndUserId("aud-1", "user-old")).thenReturn(true);
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus("aud-1", "user-old", "ACTIVE"))
                .thenReturn(List.of(existing));
        return existing;
    }

    /**
     * The person already has a lead in this list: the repeat joins them and is applied to
     * that lead, with no second person and no second row, and returns that lead's id.
     */
    @Test
    void sameListRepeatJoinsThePersonAndRepeatsTheirLeadInThisList() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));
        existingLeadInList();

        String result = service.submitLeadFromFormWebhook("aud-1", ProcessedFormDataDTO.builder()
                .email("asha@example.com")
                .fullName("Asha Rao")
                .phone("+919876543210")
                .formFields(Map.of())
                .metadata(Map.of())
                .build(), "META_LEAD_ADS");

        assertEquals("resp-old", result);
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        verify(responses, never()).save(any(AudienceResponse.class));
        // The re-enquiry shows on the existing lead's journey.
        ArgumentCaptor<AudienceResponseRepository.PrimaryLeadRow> lead =
                ArgumentCaptor.forClass(AudienceResponseRepository.PrimaryLeadRow.class);
        ArgumentCaptor<AudienceResponse> enquiry = ArgumentCaptor.forClass(AudienceResponse.class);
        verify(dedup).logReattempt(lead.capture(), enquiry.capture(), eq("Meta Lead Ads"), eq("Diploma 2027"));
        assertEquals("resp-old", lead.getValue().getResponseId());
        assertEquals("user-old", lead.getValue().getUserId());
        assertEquals("asha@example.com", enquiry.getValue().getParentEmail());
        // Already owned, so SAME_AS_PREVIOUS leaves the owner alone.
        verify(profileService, never()).assignCounselor(any(), any(), any(), any());
    }

    /** Same email as the person's account: nothing differs from before, still "already submitted". */
    @Test
    void sameListResubmissionWithThePersonsOwnEmailIsStillAlreadySubmitted() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        UserDTO old = oldPerson();
        old.setEmail("ASHA@example.com");
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(old));
        existingLeadInList();

        String result = service.submitLeadFromFormWebhook("aud-1", ProcessedFormDataDTO.builder()
                .email("asha@example.com")
                .fullName("Asha Rao")
                .phone("+919876543210")
                .formFields(Map.of())
                .metadata(Map.of())
                .build(), "META_LEAD_ADS");

        assertEquals("You have already submitted your response for this campaign", result);
        verify(responses, never()).save(any(AudienceResponse.class));
        verify(dedup, never()).logReattempt(any(), any(), any(), any());
    }

    /** A soft-deleted lead in this list is revived and the repeat applies to it. */
    @Test
    void sameListRepeatRevivesASoftDeletedLead() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));
        AudienceResponse hidden = AudienceResponse.builder()
                .id("resp-old").audienceId("aud-1").userId("user-old").audienceStatus("INACTIVE").build();
        when(responses.existsByAudienceIdAndUserId("aud-1", "user-old")).thenReturn(true);
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus("aud-1", "user-old", "INACTIVE"))
                .thenReturn(List.of(hidden));
        when(responses.findByAudienceIdAndUserIdAndAudienceStatus("aud-1", "user-old", "ACTIVE"))
                .thenAnswer(inv -> "ACTIVE".equals(hidden.getAudienceStatus()) ? List.of(hidden) : List.of());
        // Reviving saves the existing row as it is (the shared stub would hand it a new id).
        doReturn(hidden).when(responses).save(hidden);

        String result = submitByHand(null);

        assertEquals("resp-old", result);
        assertEquals("ACTIVE", hidden.getAudienceStatus());
        verify(responses).save(hidden);
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
    }

    /** Admin add (WALK_IN) by the owner of a person already in this list: a repeat, not a new person. */
    @Test
    void manualAddByTheOwnerOfAPersonInThisListRepeatsTheirLead() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));
        existingLeadInList();

        assertEquals("resp-old", submitByHand("counsellor-previous"));

        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        verify(responses, never()).save(any(AudienceResponse.class));
        // The owner is the counsellor the request names, so the owner stays the same.
        verify(profileService).assignCounselor(eq("user-old"), eq("inst-1"), eq("counsellor-previous"), any());
        verify(profileService, never()).assignCounselor(eq("user-old"), any(), argThat(id -> id != null
                && !"counsellor-previous".equals(id)), any());
    }

    /**
     * Reattempt switches act against the existing lead: priority follow-up on it, bell to its
     * owner, tier, status reset. No row exists to flag as a duplicate.
     */
    @Test
    void sameListRepeatGetsTheReattemptEffectsOnTheExistingLead() throws Exception {
        when(dedup.checkDuplicate(eq("inst-1"), eq("aud-1"), any(), any()))
                .thenReturn(Optional.of(new LeadDeduplicationService.DuplicateMatch(
                        LeadDedupSettingService.DedupAction.ALLOW_REASSIGN, null,
                        new RepeatLeadSettings(CounsellorMode.SAME_AS_PREVIOUS, null, null,
                                StatusMode.RESET_TO_NEW, true, false,
                                new ReattemptSettings(true, true, true, false, true, "VERY_HOT", false)))));
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));
        existingLeadInList();
        AudienceResponseRepository.PrimaryLeadRow primary = new AudienceResponseRepository.PrimaryLeadRow() {
            @Override
            public String getResponseId() {
                return "resp-old";
            }

            @Override
            public String getUserId() {
                return "user-old";
            }

            @Override
            public String getCounsellorId() {
                return "counsellor-previous";
            }

            @Override
            public String getStatusKey() {
                return "LOST";
            }
        };
        when(dedup.findPrimaryLead(eq("inst-1"), eq("aud-1"), any(), any(), eq("same-list-repeat")))
                .thenReturn(Optional.of(primary));
        when(((LeadTierService) get("leadTierService")).isKnownTier("inst-1", "VERY_HOT")).thenReturn(true);

        submit();

        verify(responses, never()).save(any(AudienceResponse.class));
        verify(responses, never()).markDuplicateOf(any(), any());
        ArgumentCaptor<LeadFollowup> followUp = ArgumentCaptor.forClass(LeadFollowup.class);
        verify((LeadFollowupRepository) get("leadFollowupRepository")).save(followUp.capture());
        assertEquals("resp-old", followUp.getValue().getAudienceResponseId());
        assertEquals("counsellor-previous", followUp.getValue().getCreatedBy());
        verify((LeadAssignmentNotifier) get("leadAssignmentNotifier")).notifyReattempt(eq("inst-1"),
                eq("counsellor-previous"), any(), eq("Meta Lead Ads"), eq("Diploma 2027"), eq("user-old"));
        verify(profileService).updateLeadTier("user-old", "inst-1", "VERY_HOT");
        verify(profileService).updateConversionStatus("user-old", "inst-1", "LEAD", "SYSTEM");
        // One journey entry, on the existing lead (not a second one from the journeyEntry switch).
        verify(dedup, times(1)).logReattempt(any(), any(), any(), any());
    }

    @Test
    void catalogueSameListRepeatJoinsThePersonAndRepeatsTheirLead() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));
        existingLeadInList();

        String result = service.submitCatalogueLead(CatalogueLeadRequestDTO.builder()
                .instituteId("inst-1")
                .audienceId("aud-1")
                .fullName("Asha Rao")
                .email("asha@example.com")
                .mobileNumber("+919876543210")
                .build());

        assertEquals("resp-old", result);
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        verify(responses, never()).save(any(AudienceResponse.class));
    }

    @Test
    void catalogueCrossListRepeatNowJoinsThePersonByPhone() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));

        service.submitCatalogueLead(CatalogueLeadRequestDTO.builder()
                .instituteId("inst-1")
                .audienceId("aud-1")
                .fullName("Asha Rao")
                .email("asha@example.com")
                .mobileNumber("+919876543210")
                .build());

        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        assertEquals("user-old", saved().getUserId());
    }

    @Test
    void liveClassSameListRepeatJoinsThePersonAndRepeatsTheirLead() throws Exception {
        Audience audience = ((AudienceRepository) get("audienceRepository")).findById("aud-1").orElseThrow();
        when(((AudienceRepository) get("audienceRepository")).findByIdAndInstituteId("aud-1", "inst-1"))
                .thenReturn(Optional.of(audience));
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));
        existingLeadInList();

        String result = service.submitLiveClassLeadToAudienceId("aud-1", "inst-1", "Asha Rao",
                "asha@example.com", "+919876543210", Map.of(), "session-1");

        assertEquals("resp-old", result);
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        verify(responses, never()).save(any(AudienceResponse.class));
        verify(dedup).logReattempt(any(), any(), eq("Live session"), eq("Diploma 2027"));
    }

    @Test
    void submitLeadV2SameListRepeatJoinsThePersonAndRepeatsTheirLead() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        when(auth.getUsersFromAuthServiceByUserIds(List.of("user-old"))).thenReturn(List.of(oldPerson()));
        existingLeadInList();
        SubmitLeadRequestDTO request = new SubmitLeadRequestDTO();
        request.setAudienceId("aud-1");
        request.setSourceType("AUDIENCE_CAMPAIGN");
        UserDTO user = new UserDTO();
        user.setEmail("asha@example.com");
        user.setFullName("Asha Rao");
        user.setMobileNumber("+919876543210");
        request.setUserDTO(user);

        assertEquals("resp-old", service.submitLeadV2(request));
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        verify(responses, never()).save(any(AudienceResponse.class));
        verify(dedup).logReattempt(any(), any(), eq("website form"), eq("Diploma 2027"));
    }

    /** Admin add naming a counsellor other than the owner: the person is not joined (as before). */
    @Test
    void manualAddNamingAnotherCounsellorNeverJoinsAPersonInThisList() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.of("user-old"));
        existingLeadInList();

        submitByHand("counsellor-other");

        verify(auth).createUserFromAuthService(any(), eq("inst-1"), eq(false));
        verify(auth, never()).getUsersFromAuthServiceByUserIds(List.of("user-old"));
        assertEquals("user-new", saved().getUserId());
    }

    /** The switch off (no person found by phone): a same-list repeat behaves exactly as before. */
    @Test
    void switchOffSameListRepeatIsUnchanged() {
        repeatMatched();
        when(dedup.findExistingLeadUserIdByPhone(any(), any(), any())).thenReturn(Optional.empty());
        when(responses.existsByAudienceIdAndUserId("aud-1", "user-new")).thenReturn(true);

        String result = submitByHand(null);

        assertEquals("You have already submitted your response for this campaign", result);
        verify(responses, never()).save(any(AudienceResponse.class));
        verify(dedup, never()).logReattempt(any(), any(), any(), any());
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
