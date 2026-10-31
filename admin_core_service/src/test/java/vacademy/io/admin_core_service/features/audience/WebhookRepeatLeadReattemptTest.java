package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.dto.ProcessedFormDataDTO;
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
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorAssignmentService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.common.auth.dto.UserDTO;

import org.mockito.ArgumentCaptor;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Repeat-lead reattempt switches (LEAD_SETTING.data.dedup.repeatLead.reattempt) on the
 * webhook path: flag the enquiry as a duplicate of the lead it repeats, log a Reattempt in
 * that lead's journey, and ring its counsellor — each only when its switch is on.
 */
class WebhookRepeatLeadReattemptTest {

    private static final String OWNER = "counsellor-owner";

    private AudienceService service;
    private LeadDeduplicationService dedup;
    private UserLeadProfileRepository profiles;
    private UserLeadProfileService profileService;
    private AudienceResponseRepository responses;
    private LeadAssignmentNotifier notifier;

    /** Status of the lead the repeat repeats, as the primary-lead lookup returns it. */
    private String primaryStatus = "CALL_BACK";

    private final AudienceResponseRepository.PrimaryLeadRow primary = new AudienceResponseRepository.PrimaryLeadRow() {
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
            return OWNER;
        }

        @Override
        public String getStatusKey() {
            return primaryStatus;
        }
    };

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
        responses = (AudienceResponseRepository) get("audienceResponseRepository");
        notifier = (LeadAssignmentNotifier) get("leadAssignmentNotifier");

        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        audience.setStatus("ACTIVE");
        audience.setCampaignName("Diploma 2027");
        when(((AudienceRepository) get("audienceRepository")).findById("aud-1")).thenReturn(Optional.of(audience));

        UserDTO user = new UserDTO();
        user.setId("user-new");
        user.setEmail("asha@example.com");
        user.setFullName("Asha Rao");
        when(((AuthService) get("authService")).createUserFromAuthService(any(), eq("inst-1"), anyBoolean()))
                .thenReturn(user);
        when(responses.save(any(AudienceResponse.class))).thenAnswer(inv -> {
            AudienceResponse r = inv.getArgument(0);
            r.setId("resp-new");
            return r;
        });

        when(((CounsellorScopeService) get("counsellorScopeService")).allCounsellorUserIds("inst-1"))
                .thenReturn(List.of(OWNER));
        when(dedup.findPrimaryLead("inst-1", "aud-1", "asha@example.com", "+919876543210", "resp-new"))
                .thenReturn(Optional.of(primary));
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private void repeatWith(ReattemptSettings reattempt) {
        repeatWith(reattempt, StatusMode.KEEP_EXISTING);
    }

    private void repeatWith(ReattemptSettings reattempt, StatusMode statusMode) {
        when(dedup.checkDuplicate(eq("inst-1"), eq("aud-1"), any(), any()))
                .thenReturn(Optional.of(new LeadDeduplicationService.DuplicateMatch(
                        LeadDedupSettingService.DedupAction.ALLOW_REASSIGN, null,
                        new RepeatLeadSettings(CounsellorMode.SAME_AS_PREVIOUS, null, null,
                                statusMode, false, false, reattempt))));
    }

    private static UserLeadProfile ownedBy(String counsellorId) {
        UserLeadProfile p = new UserLeadProfile();
        p.setAssignedCounselorId(counsellorId);
        return p;
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

    /** Every switch off (the default) — nothing changes from before the switches existed. */
    @Test
    void switchesOffLeaveTheRepeatAsBefore() {
        repeatWith(ReattemptSettings.OFF);
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));

        submit();

        verify(dedup, never()).findPrimaryLead(any(), any(), any(), any(), any());
        verify(responses, never()).markDuplicateOf(any(), any());
        verify(dedup, never()).logReattempt(any(), any(), any(), any());
        verify(notifier, never()).notifyReattempt(any(), any(), any(), any(), any(), any());
    }

    @Test
    void allSwitchesOnMarkLogAndRingTheOwner() {
        repeatWith(new ReattemptSettings(true, true, true, true, false, null));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));

        submit();

        verify(responses).markDuplicateOf("resp-new", "resp-old");
        verify(dedup).logReattempt(eq(primary), any(AudienceResponse.class), eq("Meta Lead Ads"), eq("Diploma 2027"));
        verify(notifier).notifyReattempt("inst-1", OWNER, "Asha Rao", "Meta Lead Ads", "Diploma 2027", "user-new");
    }

    @Test
    void eachSwitchActsAlone() {
        repeatWith(new ReattemptSettings(true, false, false, false, false, null));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));

        submit();

        verify(responses).markDuplicateOf("resp-new", "resp-old");
        verify(dedup, never()).logReattempt(any(), any(), any(), any());
        verify(notifier, never()).notifyReattempt(any(), any(), any(), any(), any(), any());
    }

    /**
     * A repeat with a new email is a new person that SAME_AS_PREVIOUS hands to the earlier
     * owner. With the reattempt bell on, that owner gets the Reattempt bell, not a "new lead" one.
     */
    @Test
    void newPersonRepeatRingsReattemptInsteadOfNewLead() {
        repeatWith(new ReattemptSettings(false, false, true, false, false, null));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1"))
                .thenReturn(Optional.empty(), Optional.of(ownedBy(OWNER)));
        when(dedup.findPreviousCounsellorId("inst-1", "aud-1", "asha@example.com", "+919876543210", "resp-new"))
                .thenReturn(Optional.of(OWNER));

        submit();

        verify(profileService).assignCounselor(eq("user-new"), eq("inst-1"), eq(OWNER), any());
        verify(notifier, never()).notifyAssigned(any(), any(), any(), any(), any());
        verify(notifier).notifyReattempt("inst-1", OWNER, "Asha Rao", "Meta Lead Ads", "Diploma 2027", "user-new");
    }

    /** Reattempt bell off — the previous owner still hears about it through the new-lead bell. */
    @Test
    void newPersonRepeatKeepsTheNewLeadBellWhenReattemptBellIsOff() {
        repeatWith(new ReattemptSettings(true, true, false, false, false, null));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.empty());
        when(dedup.findPreviousCounsellorId("inst-1", "aud-1", "asha@example.com", "+919876543210", "resp-new"))
                .thenReturn(Optional.of(OWNER));

        submit();

        verify(notifier).notifyAssigned("inst-1", OWNER, "Asha Rao", "Diploma 2027", "user-new");
        verify(notifier, never()).notifyReattempt(any(), any(), any(), any(), any(), any());
    }

    /** No active lead to repeat (e.g. only a deleted one matched) — nothing is flagged or logged. */
    @Test
    void noLeadToRepeatDoesNothing() {
        repeatWith(new ReattemptSettings(true, true, true, true, false, null));
        when(dedup.findPrimaryLead(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));

        submit();

        verify(responses, never()).markDuplicateOf(any(), any());
        verify(dedup, never()).logReattempt(any(), any(), any(), any());
        verify(notifier, never()).notifyReattempt(any(), any(), any(), any(), any(), any());
    }

    /** A first-time lead never reaches the reattempt step. */
    @Test
    void firstTimeLeadIsNotAReattempt() {
        when(dedup.checkDuplicate(any(), any(), any(), any())).thenReturn(Optional.empty());

        submit();

        verify(dedup, never()).findPrimaryLead(any(), any(), any(), any(), any());
        verify(responses, never()).markDuplicateOf(any(), any());
    }

    /** A failing duplicate flag must not stop the journey entry, the bell, or the intake. */
    @Test
    void markFailureDoesNotStopTheRest() {
        repeatWith(new ReattemptSettings(true, true, true, true, false, null));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        when(responses.markDuplicateOf(any(), any())).thenThrow(new RuntimeException("db down"));

        submit();

        verify(dedup).logReattempt(eq(primary), any(AudienceResponse.class), any(), any());
        verify(notifier).notifyReattempt(eq("inst-1"), eq(OWNER), any(), any(), any(), eq("user-new"));
    }

    /** Tier switch: the person behind the repeated lead and the repeat itself go to Very Hot. */
    @Test
    void tierIsSetOnBothPeople() throws Exception {
        repeatWith(new ReattemptSettings(false, false, false, false, false, "very_hot"));
        when(((LeadTierService) get("leadTierService")).isKnownTier("inst-1", "VERY_HOT")).thenReturn(true);
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));

        submit();

        verify(profileService).updateLeadTier("user-old", "inst-1", "VERY_HOT");
        verify(profileService).updateLeadTier("user-new", "inst-1", "VERY_HOT");
    }

    /** A tier the institute does not have is skipped before it can throw inside intake. */
    @Test
    void unknownTierIsSkipped() throws Exception {
        repeatWith(new ReattemptSettings(false, false, false, false, false, "GOLD"));
        when(((LeadTierService) get("leadTierService")).isKnownTier("inst-1", "GOLD")).thenReturn(false);

        submit();

        verify(profileService, never()).updateLeadTier(any(), any(), any());
    }

    /** Follow-up switch: a priority follow-up due now on the repeated lead, for its counsellor. */
    @Test
    void followUpOpensAPriorityFollowUpForTheOwner() throws Exception {
        repeatWith(new ReattemptSettings(false, false, false, false, true, null));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        LeadFollowupRepository followups = (LeadFollowupRepository) get("leadFollowupRepository");

        long before = System.currentTimeMillis();
        submit();

        ArgumentCaptor<LeadFollowup> saved = ArgumentCaptor.forClass(LeadFollowup.class);
        verify(followups).save(saved.capture());
        LeadFollowup f = saved.getValue();
        assertEquals("resp-old", f.getAudienceResponseId());
        assertEquals("inst-1", f.getInstituteId());
        assertEquals(OWNER, f.getCreatedBy());
        assertEquals(Boolean.TRUE, f.getIsPriority());
        assertEquals(Boolean.FALSE, f.getIsClosed());
        assertTrue(f.getScheduleTime().getTime() >= before);
        assertEquals("Reattempt: enquired again via Meta Lead Ads · Diploma 2027", f.getContent());
    }

    /** One open priority follow-up per lead — a second reattempt adds nothing. */
    @Test
    void followUpIsNotOpenedTwice() throws Exception {
        repeatWith(new ReattemptSettings(false, false, false, false, true, null));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        LeadFollowupRepository followups = (LeadFollowupRepository) get("leadFollowupRepository");
        when(followups.existsByAudienceResponseIdAndIsClosedFalseAndIsPriorityTrue("resp-old")).thenReturn(true);

        submit();

        verify(followups, never()).save(any(LeadFollowup.class));
    }

    /** A repeat of a converted or discarded lead is a new lead, not a duplicate. */
    @Test
    void closedLeadRepeatIsNotMarkedDuplicate() {
        repeatWith(new ReattemptSettings(true, true, false, false, false, null));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));

        for (String closed : List.of("LOST", "CONVERTED")) {
            primaryStatus = closed;
            submit();
        }

        verify(responses, never()).markDuplicateOf(any(), any());
        // The journey still records that the person came back.
        verify(dedup, times(2)).logReattempt(eq(primary), any(AudienceResponse.class), any(), any());
    }

    /** With duplicateOpenOnly off, closed leads' repeats are flagged too. */
    @Test
    void duplicateOpenOnlyOffMarksClosedLeadsToo() {
        repeatWith(new ReattemptSettings(true, false, false, false, false, null, false));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        primaryStatus = "LOST";

        submit();

        verify(responses).markDuplicateOf("resp-new", "resp-old");
    }

    /**
     * The open/closed check reads the status before RESET_TO_NEW moves a discarded lead back
     * to New — otherwise every repeat of a discarded lead would look open.
     */
    @Test
    void openCheckRunsBeforeTheStatusReset() {
        repeatWith(new ReattemptSettings(true, false, false, false, false, null), StatusMode.RESET_TO_NEW);
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));

        submit();

        org.mockito.InOrder order = inOrder(dedup, profileService);
        order.verify(dedup).findPrimaryLead(any(), any(), any(), any(), any());
        order.verify(profileService).updateConversionStatus("user-new", "inst-1", "LEAD", "SYSTEM");
    }

    /** RESET_CLOSED_TO_NEW: a lead still being worked keeps its status on a repeat. */
    @Test
    void resetClosedKeepsAnOpenLeadsStatus() {
        repeatWith(ReattemptSettings.OFF, StatusMode.RESET_CLOSED_TO_NEW);
        primaryStatus = "CALL_BACK";

        submit();

        verify(profileService, never()).updateConversionStatus(any(), any(), any(), any());
    }

    /** RESET_CLOSED_TO_NEW: a converted or discarded lead's repeat starts again as New. */
    @Test
    void resetClosedResetsAClosedLead() {
        repeatWith(ReattemptSettings.OFF, StatusMode.RESET_CLOSED_TO_NEW);

        for (String closed : List.of("LOST", "CONVERTED")) {
            primaryStatus = closed;
            submit();
        }

        verify(profileService, times(2)).updateConversionStatus("user-new", "inst-1", "LEAD", "SYSTEM");
    }

    /** No active lead left to repeat (only a deleted one matched) — treated as a new lead. */
    @Test
    void resetClosedResetsWhenNoActiveLeadIsLeft() {
        repeatWith(ReattemptSettings.OFF, StatusMode.RESET_CLOSED_TO_NEW);
        when(dedup.findPrimaryLead(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        submit();

        verify(profileService).updateConversionStatus("user-new", "inst-1", "LEAD", "SYSTEM");
    }

    /** Can't tell whether the earlier lead is open — leave the status alone. */
    @Test
    void resetClosedKeepsStatusWhenTheLookupFails() {
        repeatWith(ReattemptSettings.OFF, StatusMode.RESET_CLOSED_TO_NEW);
        when(dedup.findPrimaryLead(any(), any(), any(), any(), any())).thenThrow(new RuntimeException("db down"));

        submit();

        verify(profileService, never()).updateConversionStatus(any(), any(), any(), any());
    }

    /** RESET_TO_NEW is unchanged: it resets even an open lead, with no lookup. */
    @Test
    void resetToNewStillResetsEveryRepeat() {
        repeatWith(ReattemptSettings.OFF, StatusMode.RESET_TO_NEW);
        primaryStatus = "CALL_BACK";

        submit();

        verify(profileService).updateConversionStatus("user-new", "inst-1", "LEAD", "SYSTEM");
        verify(dedup, never()).findPrimaryLead(any(), any(), any(), any(), any());
    }
}
