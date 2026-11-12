package vacademy.io.admin_core_service.features.audience;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorAssignmentService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.common.auth.dto.UserDTO;

import org.mockito.ArgumentCaptor;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * reattempt.closedRepeatTakesOver: a repeat of a converted or discarded lead becomes the lead
 * and the old one is flagged its duplicate, so the lists show the person once, as the new
 * enquiry. Off, or with the earlier lead still open, intake behaves as before.
 */
class ClosedRepeatTakesOverTest {

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

    /** markDuplicate + followUp + closedRepeatTakesOver, duplicateOpenOnly on (its default). */
    private static ReattemptSettings takesOver(boolean on) {
        return new ReattemptSettings(true, true, false, false, true, null, true, true, on);
    }

    private LeadFollowupRepository followups() throws Exception {
        return (LeadFollowupRepository) get("leadFollowupRepository");
    }

    /** A discarded or converted lead's repeat becomes the lead; the old one moves under it. */
    @Test
    void closedLeadsRepeatTakesItsPlace() throws Exception {
        repeatWith(takesOver(true));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        when(responses.foldLeadUnderRepeat("resp-old", "resp-new")).thenReturn(1);

        for (String closed : List.of("LOST", "CONVERTED")) {
            primaryStatus = closed;
            submit();
        }

        verify(responses, never()).markDuplicateOf(any(), any());
        verify(responses, times(2)).foldLeadUnderRepeat("resp-old", "resp-new");
        verify(followups(), times(2)).moveOpenToResponse("resp-old", "resp-new");
        // The journey still records the reattempt on the person.
        verify(dedup, times(2)).logReattempt(eq(primary), any(AudienceResponse.class), any(), any());
    }

    /** The reattempt follow-up (the list's Reattempt tag) lands on the row the lists show. */
    @Test
    void reattemptFollowUpGoesToTheRepeat() throws Exception {
        repeatWith(takesOver(true));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        when(responses.foldLeadUnderRepeat("resp-old", "resp-new")).thenReturn(1);
        primaryStatus = "LOST";

        submit();

        ArgumentCaptor<LeadFollowup> saved = ArgumentCaptor.forClass(LeadFollowup.class);
        verify(followups()).save(saved.capture());
        assertEquals("resp-new", saved.getValue().getAudienceResponseId());
        assertEquals(OWNER, saved.getValue().getCreatedBy());
        assertEquals(Boolean.TRUE, saved.getValue().getIsPriority());
        // Moved before the "one priority follow-up per lead" check reads the repeat.
        org.mockito.InOrder order = inOrder(followups());
        order.verify(followups()).moveOpenToResponse("resp-old", "resp-new");
        order.verify(followups()).existsByAudienceResponseIdAndIsClosedFalseAndIsPriorityTrue("resp-new");
    }

    /** A priority follow-up moved over from the old lead is not doubled. */
    @Test
    void movedPriorityFollowUpIsNotDoubled() throws Exception {
        repeatWith(takesOver(true));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        when(responses.foldLeadUnderRepeat("resp-old", "resp-new")).thenReturn(1);
        when(followups().existsByAudienceResponseIdAndIsClosedFalseAndIsPriorityTrue("resp-new")).thenReturn(true);
        primaryStatus = "LOST";

        submit();

        verify(followups(), never()).save(any(LeadFollowup.class));
    }

    /** Switch off: a closed lead's repeat is a second lead, exactly as before. */
    @Test
    void switchOffKeepsTheRepeatAsASecondLead() throws Exception {
        repeatWith(takesOver(false));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        primaryStatus = "LOST";

        submit();

        verify(responses, never()).markDuplicateOf(any(), any());
        verify(responses, never()).foldLeadUnderRepeat(any(), any());
        verify(followups(), never()).moveOpenToResponse(any(), any());
        ArgumentCaptor<LeadFollowup> saved = ArgumentCaptor.forClass(LeadFollowup.class);
        verify(followups()).save(saved.capture());
        assertEquals("resp-old", saved.getValue().getAudienceResponseId());
    }

    /** An open lead's repeat is flagged its duplicate; the switch changes nothing there. */
    @Test
    void openLeadsRepeatIsStillADuplicate() throws Exception {
        repeatWith(takesOver(true));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        primaryStatus = "CALL_BACK";

        submit();

        verify(responses).markDuplicateOf("resp-new", "resp-old");
        verify(responses, never()).foldLeadUnderRepeat(any(), any());
        ArgumentCaptor<LeadFollowup> saved = ArgumentCaptor.forClass(LeadFollowup.class);
        verify(followups()).save(saved.capture());
        assertEquals("resp-old", saved.getValue().getAudienceResponseId());
    }

    /** It needs markDuplicate: with that off nothing is flagged either way. */
    @Test
    void needsMarkDuplicate() throws Exception {
        repeatWith(new ReattemptSettings(false, true, false, false, false, null, true, true, true));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        primaryStatus = "LOST";

        submit();

        verify(responses, never()).foldLeadUnderRepeat(any(), any());
        verify(responses, never()).markDuplicateOf(any(), any());
    }

    /** A failed fold leaves the old lead as it was and its follow-ups where they were. */
    @Test
    void failedFoldKeepsTheOldLead() throws Exception {
        repeatWith(takesOver(true));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        when(responses.foldLeadUnderRepeat(any(), any())).thenThrow(new RuntimeException("db down"));
        primaryStatus = "LOST";

        submit();

        verify(followups(), never()).moveOpenToResponse(any(), any());
        ArgumentCaptor<LeadFollowup> saved = ArgumentCaptor.forClass(LeadFollowup.class);
        verify(followups()).save(saved.capture());
        assertEquals("resp-old", saved.getValue().getAudienceResponseId());
        // The rest of intake still ran.
        verify(dedup).logReattempt(eq(primary), any(AudienceResponse.class), any(), any());
    }

    /** The old lead was already gone: nothing moved, the follow-up stays on it. */
    @Test
    void nothingFoldedKeepsTheOldLead() throws Exception {
        repeatWith(takesOver(true));
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        when(responses.foldLeadUnderRepeat("resp-old", "resp-new")).thenReturn(0);
        primaryStatus = "LOST";

        submit();

        verify(followups(), never()).moveOpenToResponse(any(), any());
        ArgumentCaptor<LeadFollowup> saved = ArgumentCaptor.forClass(LeadFollowup.class);
        verify(followups()).save(saved.capture());
        assertEquals("resp-old", saved.getValue().getAudienceResponseId());
    }

    /** An open lead of the same phone that the lookups would find once the old lead is flagged. */
    private static AudienceResponseRepository.PrimaryLeadRow openRow() {
        return new AudienceResponseRepository.PrimaryLeadRow() {
            @Override public String getResponseId() { return "resp-other"; }
            @Override public String getUserId() { return "user-other"; }
            @Override public String getCounsellorId() { return OWNER; }
            @Override public String getStatusKey() { return "CALL_BACK"; }
        };
    }

    /**
     * RESET_CLOSED_TO_NEW still resets after a take-over: the lead it repeated was closed, and
     * the reset no longer looks it up (that lookup would now skip the flagged old lead and
     * could land on some other, open one).
     */
    @Test
    void takeOverStillResetsAClosedLeadsStatus() throws Exception {
        repeatWith(takesOver(true), StatusMode.RESET_CLOSED_TO_NEW);
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        when(responses.foldLeadUnderRepeat("resp-old", "resp-new")).thenReturn(1);
        primaryStatus = "LOST";
        when(dedup.findPrimaryLead("inst-1", "aud-1", "asha@example.com", "+919876543210", "resp-new"))
                .thenReturn(Optional.of(primary), Optional.of(openRow()));

        submit();

        verify(profileService).updateConversionStatus("user-new", "inst-1", "LEAD", "SYSTEM");
    }

    /** Switch off, same data: the status reset looks the earlier lead up as before. */
    @Test
    void switchOffKeepsTheResetLookup() throws Exception {
        repeatWith(takesOver(false), StatusMode.RESET_CLOSED_TO_NEW);
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        primaryStatus = "LOST";
        when(dedup.findPrimaryLead("inst-1", "aud-1", "asha@example.com", "+919876543210", "resp-new"))
                .thenReturn(Optional.of(primary), Optional.of(openRow()));

        submit();

        verify(profileService, never()).updateConversionStatus(any(), any(), eq("LEAD"), any());
    }

    /** KEEP_EXISTING keeps the status after a take-over too. */
    @Test
    void takeOverKeepsStatusUnderKeepExisting() throws Exception {
        repeatWith(takesOver(true), StatusMode.KEEP_EXISTING);
        when(profiles.findByUserIdAndInstituteId("user-new", "inst-1")).thenReturn(Optional.of(ownedBy(OWNER)));
        when(responses.foldLeadUnderRepeat("resp-old", "resp-new")).thenReturn(1);
        primaryStatus = "LOST";

        submit();

        verify(profileService, never()).updateConversionStatus(any(), any(), eq("LEAD"), any());
    }

    /** Read from the setting, off unless set; the older constructors keep it off. */
    @Test
    void switchIsReadAndDefaultsOff() {
        assertTrue(parse("{\"closedRepeatTakesOver\":true}").closedRepeatTakesOver());
        assertFalse(parse("{\"markDuplicate\":true}").closedRepeatTakesOver());
        assertFalse(parse("{\"closedRepeatTakesOver\":\"yes\"}").closedRepeatTakesOver());
        assertFalse(ReattemptSettings.OFF.closedRepeatTakesOver());
        assertEquals(new ReattemptSettings(true, false, false, true, false, null, true, true),
                parse("{\"markDuplicate\":true,\"showBadge\":true,\"duplicatesTabOnly\":true}"));
    }

    private static ReattemptSettings parse(String reattemptJson) {
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute institute = new Institute();
        institute.setSetting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"dedup\":{\"enabled\":true,"
                + "\"action\":\"ALLOW_REASSIGN\",\"repeatLead\":{\"reattempt\":" + reattemptJson + "}}}}}}");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(institute));
        return new LeadDedupSettingService(institutes, new ObjectMapper()).get("inst-1").repeatLead().reattempt();
    }
}
