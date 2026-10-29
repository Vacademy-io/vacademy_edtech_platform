package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.admin_activity_logs.async.AsyncAuditDispatcher;
import vacademy.io.admin_core_service.features.admin_activity_logs.entity.AdminActivityLog;
import vacademy.io.admin_core_service.features.admin_activity_logs.service.CrmAuditNarrator;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import vacademy.io.admin_core_service.features.audience.entity.LeadTier;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A follow-up's interest level becoming the lead's tier: only with the institute's switch on,
 * only for a value that names a tier, never re-setting the tier the lead already has, and
 * never letting a failure escape into the follow-up save.
 */
class FollowUpInterestTierSyncTest {

    private static final String INSTITUTE = "inst-1";
    private static final String LEAD = "lead-user-1";

    private LeadFollowupSettingService settings;
    private LeadTierService tiers;
    private UserLeadProfileService profiles;
    private UserLeadProfileRepository profileRepo;
    private TimelineEventService timeline;
    private AsyncAuditDispatcher audit;
    private FollowUpInterestTierSync sync;
    private static final FollowUpInterestTierSync.Actor ACTOR = new FollowUpInterestTierSync.Actor(
            "counsellor-a", "Asha Rao", "asha", "PUT", "/admin-core-service/v1/lead-followup/f-1", "1.2.3.4", "ua");

    @BeforeEach
    void setUp() {
        settings = mock(LeadFollowupSettingService.class);
        tiers = mock(LeadTierService.class);
        profiles = mock(UserLeadProfileService.class);
        profileRepo = mock(UserLeadProfileRepository.class);
        timeline = mock(TimelineEventService.class);
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        audit = mock(AsyncAuditDispatcher.class);
        CrmAuditNarrator narrator = mock(CrmAuditNarrator.class);
        when(narrator.leadUserFor(LEAD)).thenReturn("Ravi");
        sync = new FollowUpInterestTierSync(settings, tiers, profiles, profileRepo, timeline, tm,
                audit, narrator, new ObjectMapper());

        // An institute whose tier labels carry the follow-up wording in brackets.
        when(tiers.cachedActiveTiers(INSTITUTE)).thenReturn(List.of(
                tier("SUPER_HOT", "Ready to join now (Super Hot)"),
                tier("VERY_HOT", "Highly Interested (Very Hot)"),
                tier("LUKEWARM", "Interested but unsure (Lukewarm)"),
                tier("POOR", "Hot lead")));
        when(settings.syncInterestToLead(INSTITUTE)).thenReturn(true);
        when(profileRepo.findByUserIdAndInstituteId(LEAD, INSTITUTE)).thenReturn(Optional.empty());
        UserLeadProfile saved = UserLeadProfile.builder().id("ulp-1").userId(LEAD).instituteId(INSTITUTE).build();
        when(profiles.updateLeadTier(anyString(), anyString(), anyString())).thenReturn(saved);
    }

    private static LeadTier tier(String key, String label) {
        return LeadTier.builder().tierKey(key).label(label).build();
    }

    @Test
    void matchesByKeyLabelOrBracketedLabel() {
        assertEquals("VERY_HOT", sync.resolveTierKey(INSTITUTE, "Very Hot"));
        assertEquals("VERY_HOT", sync.resolveTierKey(INSTITUTE, "  very   hot "));
        assertEquals("LUKEWARM", sync.resolveTierKey(INSTITUTE, "Lukewarm"));
        assertEquals("POOR", sync.resolveTierKey(INSTITUTE, "Hot lead"));
    }

    @Test
    void aValueNamingNoTierMapsToNothing() {
        when(tiers.isKnownTier(INSTITUTE, "TIMEPASS")).thenReturn(false);
        assertNull(sync.resolveTierKey(INSTITUTE, "Timepass"));
    }

    @Test
    void aLegacyKeyTheInstituteAcceptsStillMaps() {
        when(tiers.isKnownTier(INSTITUTE, "WARM")).thenReturn(true);
        assertEquals("WARM", sync.resolveTierKey(INSTITUTE, "Warm"));
    }

    @Test
    void setsTheTierAndLogsItOnTheJourney() {
        sync.syncNow(INSTITUTE, LEAD, "Very Hot", ACTOR);

        verify(profiles).updateLeadTier(LEAD, INSTITUTE, "VERY_HOT");
        verify(timeline).logJourneyEvent(eq("USER_LEAD_PROFILE"), eq("ulp-1"),
                eq(LeadJourneyActionType.STATUS_CHANGED), eq("ADMIN"), eq("counsellor-a"), eq("asha"),
                anyString(), any(), any(), eq(LEAD));
    }

    @Test
    void writesTheSameActivityLogEntryAManualTierChangeDoes() {
        sync.syncNow(INSTITUTE, LEAD, "Very Hot", ACTOR);

        ArgumentCaptor<AdminActivityLog> row = ArgumentCaptor.forClass(AdminActivityLog.class);
        verify(audit).dispatch(row.capture());
        AdminActivityLog log = row.getValue();
        assertEquals(INSTITUTE, log.getInstituteId());
        assertEquals("LEAD", log.getEntityType());
        assertEquals("TIER_CHANGE", log.getAction());
        assertEquals(LEAD, log.getEntityId());
        assertEquals("counsellor-a", log.getActorId());
        assertEquals("Asha Rao", log.getActorName());
        assertEquals("asha", log.getActorEmail());
        assertEquals("changed lead tier of Ravi to VERY_HOT from a follow-up", log.getDescription());
        assertTrue(log.getRequestPayload().contains("\"interestLevel\":\"Very Hot\""));
        assertEquals("1.2.3.4", log.getIpAddress());
    }

    @Test
    void anActivityLogFailureDoesNotUndoTheTierChange() {
        org.mockito.Mockito.doThrow(new RuntimeException("audit down")).when(audit).dispatch(any());

        sync.syncNow(INSTITUTE, LEAD, "Very Hot", ACTOR);

        verify(profiles).updateLeadTier(LEAD, INSTITUTE, "VERY_HOT");
    }

    @Test
    void noTierChangeMeansNoActivityLogEntry() {
        when(settings.syncInterestToLead(INSTITUTE)).thenReturn(false);

        sync.syncNow(INSTITUTE, LEAD, "Very Hot", ACTOR);

        verify(audit, never()).dispatch(any());
    }

    @Test
    void switchOffLeavesTheLeadAlone() {
        when(settings.syncInterestToLead(INSTITUTE)).thenReturn(false);

        sync.syncNow(INSTITUTE, LEAD, "Very Hot", ACTOR);

        verify(profiles, never()).updateLeadTier(anyString(), anyString(), anyString());
    }

    @Test
    void theTierTheLeadAlreadyHasIsNotSetAgain() {
        UserLeadProfile current = UserLeadProfile.builder().userId(LEAD).instituteId(INSTITUTE)
                .leadTier("VERY_HOT").build();
        when(profileRepo.findByUserIdAndInstituteId(LEAD, INSTITUTE)).thenReturn(Optional.of(current));

        sync.syncNow(INSTITUTE, LEAD, "Very Hot", ACTOR);

        verify(profiles, never()).updateLeadTier(anyString(), anyString(), anyString());
    }

    @Test
    void anUnmatchedValueLeavesTheLeadAlone() {
        when(tiers.isKnownTier(INSTITUTE, "TIMEPASS")).thenReturn(false);

        sync.syncNow(INSTITUTE, LEAD, "Timepass", ACTOR);

        verify(profiles, never()).updateLeadTier(anyString(), anyString(), anyString());
    }

    @Test
    void aFailureIsSwallowedSoTheFollowUpSaveIsNeverAffected() {
        when(profiles.updateLeadTier(anyString(), anyString(), anyString()))
                .thenThrow(new RuntimeException("db down"));

        sync.syncNow(INSTITUTE, LEAD, "Very Hot", ACTOR);

        verify(timeline, never()).logJourneyEvent(anyString(), anyString(), any(), anyString(),
                anyString(), anyString(), anyString(), any(), any(), anyString());
    }

    @Test
    void outsideATransactionItRunsStraightAway() {
        sync.syncAfterCommit(INSTITUTE, LEAD, "Very Hot", null);

        verify(profiles).updateLeadTier(LEAD, INSTITUTE, "VERY_HOT");
    }

    @Test
    void blankInputsDoNothing() {
        sync.syncAfterCommit(INSTITUTE, null, "Very Hot", null);
        sync.syncAfterCommit(INSTITUTE, LEAD, "  ", null);

        verify(settings, never()).syncInterestToLead(anyString());
    }
}
