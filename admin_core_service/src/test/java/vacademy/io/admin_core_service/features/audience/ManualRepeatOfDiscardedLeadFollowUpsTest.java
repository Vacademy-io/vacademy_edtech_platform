package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.CounsellorMode;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.ReattemptSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.RepeatLeadSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.StatusMode;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A repeat that names its own counsellor (a counsellor's manual add, a CSV owner column) of
 * a discarded (LOST) lead: with repeatLead.discardedToNewCounsellor on, the earlier owner's
 * open follow-ups on it are closed once the lead has moved to the new counsellor, as the
 * pool path already does. Everything else leaves the follow-ups alone.
 */
class ManualRepeatOfDiscardedLeadFollowUpsTest {

    private static final String OLD = "counsellor-old";
    private static final String NEW = "counsellor-new";

    private AudienceService service;
    private LeadDeduplicationService dedup;
    private UserLeadProfileService profileService;
    private LeadFollowupRepository followups;
    private UserLeadProfile profile;

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
        profileService = (UserLeadProfileService) get("userLeadProfileService");
        followups = (LeadFollowupRepository) get("leadFollowupRepository");

        // Same person, still owned by the counsellor who discarded the lead; assigning moves it.
        profile = new UserLeadProfile();
        profile.setAssignedCounselorId(OLD);
        when(((UserLeadProfileRepository) get("userLeadProfileRepository"))
                .findByUserIdAndInstituteId("user-1", "inst-1")).thenReturn(Optional.of(profile));
        doAnswer(inv -> {
            profile.setAssignedCounselorId(inv.getArgument(2));
            return null;
        }).when(profileService).assignCounselor(eq("user-1"), eq("inst-1"), any(), any());
    }

    private Object get(String field) throws Exception {
        Field f = AudienceService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    private static RepeatLeadSettings settings(boolean discardedToNewCounsellor) {
        return new RepeatLeadSettings(CounsellorMode.SAME_AS_PREVIOUS, null, null,
                StatusMode.KEEP_EXISTING, false, false, ReattemptSettings.OFF, false,
                false, discardedToNewCounsellor);
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

    private void addBy(RepeatLeadSettings repeatLeadSettings, String manualCounsellorId) throws Exception {
        AudienceResponse saved = AudienceResponse.builder().id("resp-new").audienceId("aud-1").userId("user-1").build();
        Method m = AudienceService.class.getDeclaredMethod("applyCounsellorAssignment", RepeatLeadSettings.class,
                AudienceResponse.class, String.class, String.class, String.class, String.class, String.class,
                String.class, String.class, String.class);
        m.setAccessible(true);
        try {
            m.invoke(service, repeatLeadSettings, saved, "user-1", "inst-1", manualCounsellorId, "New Counsellor",
                    "Asha Rao", "Diploma 2027", "asha@example.com", "+919876543210");
        } catch (InvocationTargetException e) {
            throw (Exception) e.getCause();
        }
    }

    @Test
    void anotherCounsellorAddingADiscardedLeadClosesTheOldOwnersFollowUps() throws Exception {
        earlierLead("LOST");

        addBy(settings(true), NEW);

        verify(profileService).assignCounselor(eq("user-1"), eq("inst-1"), eq(NEW), any());
        verify(followups).closeOpenByCreatorsForLeadUsers(eq("inst-1"), eq(Set.of(OLD)), eq(List.of("user-1")),
                any(), any());
    }

    /** The counsellor who discarded it adds it again: their follow-ups stay. */
    @Test
    void sameCounsellorReAddingKeepsTheirFollowUps() throws Exception {
        earlierLead("LOST");

        addBy(settings(true), OLD);

        verify(followups, never()).closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any());
    }

    @Test
    void openOrConvertedEarlierLeadKeepsTheFollowUps() throws Exception {
        earlierLead("CALL_BACK");
        addBy(settings(true), NEW);

        earlierLead("CONVERTED");
        addBy(settings(true), NEW);

        verify(followups, never()).closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any());
    }

    /** discardedToNewCounsellor off: the manual path is exactly as before. */
    @Test
    void switchOffLeavesTheManualPathAsBefore() throws Exception {
        earlierLead("LOST");

        addBy(settings(false), NEW);

        verify(dedup, never()).findPrimaryLead(any(), any(), any(), any(), any());
        verify(profileService).assignCounselor(eq("user-1"), eq("inst-1"), eq(NEW), any());
        verify(followups, never()).closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any());
    }

    /** A first-time lead (no repeat match) never looks up an earlier lead. */
    @Test
    void firstTimeLeadIsUnchanged() throws Exception {
        addBy(null, NEW);

        verify(dedup, never()).findPrimaryLead(any(), any(), any(), any(), any());
        verify(followups, never()).closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any());
    }

    /** The assignment failed, so the old owner still has the lead and keeps the follow-ups. */
    @Test
    void failedAssignmentKeepsTheFollowUps() throws Exception {
        earlierLead("LOST");
        doThrow(new RuntimeException("db blip")).when(profileService).assignCounselor(any(), any(), any(), any());

        addBy(settings(true), NEW);

        verify(followups, never()).closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any());
    }

    /** The earlier-lead lookup failing never blocks the add or closes anything. */
    @Test
    void lookupFailureStillAssignsAndClosesNothing() throws Exception {
        when(dedup.findPrimaryLead(any(), any(), any(), any(), any())).thenThrow(new RuntimeException("db down"));

        addBy(settings(true), NEW);

        verify(profileService).assignCounselor(eq("user-1"), eq("inst-1"), eq(NEW), any());
        verify(followups, never()).closeOpenByCreatorsForLeadUsers(any(), any(), any(), any(), any());
    }
}
