package vacademy.io.admin_core_service.features.learner_badge.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardBadgeRequest;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardBadgeResponse;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardOutcome;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinition;
import vacademy.io.admin_core_service.features.learner_badge.dto.SyncUnlocksRequest;
import vacademy.io.admin_core_service.features.learner_badge.entity.LearnerBadge;
import vacademy.io.admin_core_service.features.learner_badge.entity.LearnerBadgeStatus;
import vacademy.io.admin_core_service.features.learner_badge.repository.LearnerBadgeRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.exceptions.ForbiddenException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Staff awards and the learner app's auto-unlock sync share one table ({@code learner_badge})
 * and one partial unique index (one ACTIVE row per user x badge). Pinned here:
 * <ul>
 *   <li>award outcomes — NEW insert, ALREADY_ACTIVE no-op, and the in-place UPGRADE of an
 *       AUTO row to MANUAL (the alternative, a second insert, trips the index);</li>
 *   <li>exactly ONE batched notification per call, after the transaction commits, and none
 *       at all while the institute's badges master toggle is off;</li>
 *   <li>the sync no longer trusts the client: non-members get 403, ids outside the
 *       catalogue (manual / disabled / unknown) are dropped, the six defaults are accepted
 *       when the institute has no stored list, and the stored snapshot comes from the
 *       catalogue entry rather than the request.</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerBadgeServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String BADGE = "badge_x";
    private static final String ADMIN = "admin-1";

    @Mock private LearnerBadgeRepository learnerBadgeRepository;
    @Mock private NotificationService notificationService;
    @Mock private BadgeCatalogueService badgeCatalogueService;
    @Mock private StudentSessionInstituteGroupMappingRepository ssigmRepository;

    private LearnerBadgeService service;

    @BeforeEach
    void setUp() {
        service = new LearnerBadgeService(learnerBadgeRepository, notificationService,
                badgeCatalogueService, ssigmRepository);
        when(learnerBadgeRepository.save(any(LearnerBadge.class))).thenAnswer(inv -> {
            LearnerBadge b = inv.getArgument(0);
            if (b.getId() == null) b.setId("row-" + b.getUserId() + "-" + b.getBadgeId());
            return b;
        });
        when(badgeCatalogueService.isEnabled(INSTITUTE)).thenReturn(true);
        // Every requested id is an institute member unless a test says otherwise.
        when(ssigmRepository.findUserIdsInInstitute(eq(INSTITUTE), any()))
                .thenAnswer(inv -> new ArrayList<String>(inv.<Collection<String>>getArgument(1)));
    }

    @AfterEach
    void noDanglingSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    // ---------------------------------------------------------------- fixtures

    private static AwardBadgeRequest request(String... userIds) {
        return new AwardBadgeRequest(List.of(userIds), BADGE, "Helper", "Star", "Helps others", "Great work");
    }

    private static LearnerBadge activeRow(String userId, String source) {
        LearnerBadge row = new LearnerBadge();
        row.setId("existing-" + userId);
        row.setUserId(userId);
        row.setInstituteId(INSTITUTE);
        row.setBadgeId(BADGE);
        row.setBadgeName("Helper");
        row.setSource(source);
        row.setStatus(LearnerBadgeStatus.ACTIVE);
        row.setAwardedAt(new Timestamp(1_000L));
        return row;
    }

    private void existing(String userId, LearnerBadge row) {
        when(learnerBadgeRepository.findActiveAward(userId, BADGE, INSTITUTE))
                .thenReturn(Optional.ofNullable(row));
    }

    private static BadgeDefinition def(String id, String name, String trigger) {
        return new BadgeDefinition(id, name, name + " desc", "lib:" + id, trigger, 1L, true, false);
    }

    // ------------------------------------------------------------------ award

    @Nested
    class Award {

        @Test
        @DisplayName("no active row → a MANUAL row is inserted and reported as NEW")
        void newAward() {
            existing("u1", null);

            AwardBadgeResponse r = service.award(request("u1"), INSTITUTE, ADMIN, "Ms. Rao");

            assertEquals(1, r.getResults().size());
            AwardOutcome o = r.getResults().get(0);
            assertEquals("u1", o.getUserId());
            assertEquals(AwardOutcome.NEW, o.getStatus());
            assertEquals("MANUAL", o.getBadge().getSource());
            assertEquals("Great work", o.getBadge().getReason());
            assertEquals(ADMIN, o.getBadge().getAwardedByUserId());
            assertEquals(1, r.getAwardedCount());
            assertEquals(0, r.getAlreadyHadCount());
            assertEquals(0, r.getUpgradedCount());
            assertTrue(r.isNotified());

            ArgumentCaptor<LearnerBadge> saved = ArgumentCaptor.forClass(LearnerBadge.class);
            verify(learnerBadgeRepository).save(saved.capture());
            assertEquals("MANUAL", saved.getValue().getSource());
            assertEquals(LearnerBadgeStatus.ACTIVE, saved.getValue().getStatus());
            assertNotNull(saved.getValue().getAwardedAt());
        }

        @Test
        @DisplayName("an id with no mapping row in the institute is reported NOT_ENROLLED — nothing written, nothing sent")
        void notEnrolledSkipped() {
            existing("u1", null);
            when(ssigmRepository.findUserIdsInInstitute(eq(INSTITUTE), any())).thenReturn(List.of("u1"));

            AwardBadgeResponse r = service.award(request("u1", "outsider"), INSTITUTE, ADMIN, "Ms. Rao");

            assertEquals(2, r.getResults().size());
            assertEquals(AwardOutcome.NEW, r.getResults().get(0).getStatus());
            AwardOutcome outsider = r.getResults().get(1);
            assertEquals("outsider", outsider.getUserId());
            assertEquals(AwardOutcome.NOT_ENROLLED, outsider.getStatus());
            assertNull(outsider.getBadge());
            assertEquals(1, r.getNotEnrolledCount());
            assertEquals(1, r.getAwardedCount());
            verify(learnerBadgeRepository, never()).findActiveAward(eq("outsider"), any(), any());
            verify(learnerBadgeRepository, times(1)).save(any(LearnerBadge.class));
        }

        @Test
        @DisplayName("an active MANUAL row is left alone and reported as ALREADY_ACTIVE (no notification)")
        void alreadyActive() {
            existing("u1", activeRow("u1", "MANUAL"));

            AwardBadgeResponse r = service.award(request("u1"), INSTITUTE, ADMIN, "Ms. Rao");

            assertEquals(AwardOutcome.ALREADY_ACTIVE, r.getResults().get(0).getStatus());
            assertEquals(0, r.getAwardedCount());
            assertEquals(1, r.getAlreadyHadCount());
            assertFalse(r.isNotified());
            verify(learnerBadgeRepository, never()).save(any());
            verifyNoInteractions(notificationService);
        }

        @Test
        @DisplayName("an active AUTO row is upgraded in place to MANUAL with reason, awarded-by and a fresh awarded-at")
        void upgradedFromAuto() {
            LearnerBadge auto = activeRow("u1", "AUTO");
            existing("u1", auto);

            AwardBadgeResponse r = service.award(request("u1"), INSTITUTE, ADMIN, "Ms. Rao");

            AwardOutcome o = r.getResults().get(0);
            assertEquals(AwardOutcome.UPGRADED_FROM_AUTO, o.getStatus());
            assertEquals("MANUAL", o.getBadge().getSource());
            assertEquals("existing-u1", o.getBadge().getId(), "same row, not a second insert");
            assertEquals(1, r.getUpgradedCount());
            assertEquals(0, r.getAwardedCount());
            assertTrue(r.isNotified());

            assertEquals("MANUAL", auto.getSource());
            assertEquals("Great work", auto.getReason());
            assertEquals(ADMIN, auto.getAwardedByUserId());
            assertTrue(auto.getAwardedAt().getTime() > 1_000L, "awarded_at bumped to now");
            verify(learnerBadgeRepository, times(1)).save(auto);
        }

        @Test
        @DisplayName("mixed batch: one notification for the NEW + UPGRADED learners only, blanks and duplicates dropped")
        void singleBatchedNotification() {
            existing("new", null);
            existing("held", activeRow("held", "MANUAL"));
            existing("auto", activeRow("auto", "AUTO"));

            AwardBadgeResponse r = service.award(
                    new AwardBadgeRequest(List.of("new", "held", "auto", " ", "new"), BADGE,
                            "Helper", "Star", null, "Great work"),
                    INSTITUTE, ADMIN, "Ms. Rao");

            assertEquals(3, r.getResults().size(), "duplicate and blank ids collapse");
            assertEquals(1, r.getAwardedCount());
            assertEquals(1, r.getAlreadyHadCount());
            assertEquals(1, r.getUpgradedCount());
            assertTrue(r.isNotified());

            @SuppressWarnings("unchecked")
            ArgumentCaptor<List<String>> recipients = ArgumentCaptor.forClass(List.class);
            ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
            verify(notificationService, times(1)).createSystemAlertAnnouncement(
                    eq(INSTITUTE), recipients.capture(), eq("You earned a badge!"), body.capture(),
                    eq(ADMIN), eq("Ms. Rao"), eq("ADMIN"), any());
            assertEquals(List.of("new", "auto"), recipients.getValue());
            assertEquals("Ms. Rao awarded you the \"Helper\" badge — Great work", body.getValue());

            verify(notificationService, times(1)).sendPushViaUnified(
                    eq(INSTITUTE), eq(List.of("new", "auto")), eq("You earned a badge!"),
                    eq(body.getValue()), any());
        }

        @Test
        @DisplayName("inside a transaction the notification waits for afterCommit")
        void notifiesAfterCommit() {
            existing("u1", null);
            TransactionSynchronizationManager.initSynchronization();

            AwardBadgeResponse r = service.award(request("u1"), INSTITUTE, ADMIN, null);

            assertTrue(r.isNotified(), "scheduled, so reported as notified");
            verifyNoInteractions(notificationService);

            List<TransactionSynchronization> pending = TransactionSynchronizationManager.getSynchronizations();
            assertEquals(1, pending.size());
            pending.forEach(TransactionSynchronization::afterCommit);

            ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
            verify(notificationService, times(1)).createSystemAlertAnnouncement(
                    eq(INSTITUTE), eq(List.of("u1")), anyString(), body.capture(),
                    eq(ADMIN), eq("Admin"), eq("ADMIN"), any());
            assertEquals("Your institute awarded you the \"Helper\" badge — Great work", body.getValue(),
                    "no awarder name → 'Your institute'");
            verify(notificationService, times(1)).sendPushViaUnified(any(), anyList(), any(), any(), any());
        }

        @Test
        @DisplayName("badges master toggle off → award persists, nobody is notified, notified=false")
        void noNotificationWhenDisabled() {
            when(badgeCatalogueService.isEnabled(INSTITUTE)).thenReturn(false);
            existing("u1", null);

            AwardBadgeResponse r = service.award(request("u1"), INSTITUTE, ADMIN, "Ms. Rao");

            assertEquals(AwardOutcome.NEW, r.getResults().get(0).getStatus());
            assertEquals(1, r.getAwardedCount());
            assertFalse(r.isNotified());
            verify(learnerBadgeRepository).save(any(LearnerBadge.class));
            verifyNoInteractions(notificationService);
        }

        @Test
        @DisplayName("a blank reason ends the sentence with a full stop")
        void blankReasonCopy() {
            existing("u1", null);
            service.award(new AwardBadgeRequest(List.of("u1"), BADGE, "Helper", null, null, "  "),
                    INSTITUTE, ADMIN, "Ms. Rao");
            ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
            verify(notificationService).createSystemAlertAnnouncement(
                    any(), anyList(), any(), body.capture(), any(), any(), any(), any());
            assertEquals("Ms. Rao awarded you the \"Helper\" badge.", body.getValue());
        }
    }

    // ----------------------------------------------------------------- revoke

    @Test
    @DisplayName("revoke flips an active row (either source) to REVOKED and stamps who/when; nothing to revoke → false")
    void revoke() {
        LearnerBadge auto = activeRow("u1", "AUTO");
        existing("u1", auto);

        assertTrue(service.revoke("u1", BADGE, INSTITUTE, ADMIN));
        assertEquals(LearnerBadgeStatus.REVOKED, auto.getStatus());
        assertEquals(ADMIN, auto.getRevokedByUserId());
        assertNotNull(auto.getRevokedAt());
        verify(learnerBadgeRepository).save(auto);

        existing("u2", null);
        assertFalse(service.revoke("u2", BADGE, INSTITUTE, ADMIN));
    }

    // ------------------------------------------------------------------- sync

    @Nested
    class Sync {

        private static SyncUnlocksRequest.UnlockedBadge claim(String id, String name) {
            return new SyncUnlocksRequest.UnlockedBadge(id, name, "ClientIcon", "client description");
        }

        private void member(boolean isMember) {
            when(ssigmRepository.findLatestPackageSessionIdByUserIdAndInstituteId("learner", INSTITUTE))
                    .thenReturn(isMember ? Optional.of("ps-1") : Optional.empty());
        }

        private void catalogue(BadgeDefinition... allowed) {
            Map<String, BadgeDefinition> map = new LinkedHashMap<>();
            for (BadgeDefinition d : allowed) map.put(d.getId(), d);
            when(badgeCatalogueService.syncableBadges(INSTITUTE)).thenReturn(map);
        }

        @Test
        @DisplayName("a learner with no enrollment in the institute gets a ForbiddenException before any lookup")
        void nonMemberForbidden() {
            member(false);
            assertThrows(ForbiddenException.class,
                    () -> service.syncAutoUnlocks("learner", INSTITUTE, List.of(claim("streak_7", "On Fire"))));
            verifyNoInteractions(badgeCatalogueService);
            verify(learnerBadgeRepository, never()).save(any());
        }

        @Test
        @DisplayName("manual, disabled and unknown ids are rejected; only catalogue-allowed ids are inserted")
        void rejectsNonSyncableIds() {
            member(true);
            // The catalogue service already filtered manual/disabled out — what it returns is the allow-list.
            catalogue(def("streak_7", "On Fire", "streak"));

            int inserted = service.syncAutoUnlocks("learner", INSTITUTE, List.of(
                    claim("streak_7", "On Fire"),
                    claim("badge_manual", "Staff only"),
                    claim("switched_off", "Disabled"),
                    claim("made_up", "Forged")));

            assertEquals(1, inserted);
            ArgumentCaptor<LearnerBadge> saved = ArgumentCaptor.forClass(LearnerBadge.class);
            verify(learnerBadgeRepository, times(1)).save(saved.capture());
            assertEquals("streak_7", saved.getValue().getBadgeId());
            assertEquals("AUTO", saved.getValue().getSource());
        }

        @Test
        @DisplayName("the stored snapshot comes from the catalogue entry, never from the client")
        void snapshotFromConfig() {
            member(true);
            catalogue(def("streak_7", "On Fire", "streak"));

            service.syncAutoUnlocks("learner", INSTITUTE, List.of(claim("streak_7", "Hacked Name")));

            ArgumentCaptor<LearnerBadge> saved = ArgumentCaptor.forClass(LearnerBadge.class);
            verify(learnerBadgeRepository).save(saved.capture());
            assertEquals("On Fire", saved.getValue().getBadgeName());
            assertEquals("lib:streak_7", saved.getValue().getBadgeIcon());
            assertEquals("On Fire desc", saved.getValue().getBadgeDescription());
        }

        @Test
        @DisplayName("an icon token longer than the column is dropped rather than stored truncated")
        void oversizedIconDropped() {
            member(true);
            catalogue(new BadgeDefinition("big", "Big", "d", "x".repeat(300), "streak", 1L, true, false));

            service.syncAutoUnlocks("learner", INSTITUTE, List.of(claim("big", "Big")));

            ArgumentCaptor<LearnerBadge> saved = ArgumentCaptor.forClass(LearnerBadge.class);
            verify(learnerBadgeRepository).save(saved.capture());
            assertNull(saved.getValue().getBadgeIcon());
        }

        @Test
        @DisplayName("defaults are accepted when the institute has no stored list (catalogue falls back to them)")
        void acceptsDefaultsWhenListEmpty() {
            member(true);
            // Mirrors BadgeCatalogueService.syncableBadges for an absent/empty list.
            catalogue(def("first_course", "First Steps", "course_count"),
                    def("streak_7", "On Fire", "streak"),
                    def("streak_30", "Unstoppable", "streak"),
                    def("perfect_score", "Perfect Score", "assessment_score"),
                    def("completionist", "Completionist", "course_completion"),
                    def("dedicated_learner", "Dedicated Learner", "xp_total"));

            int inserted = service.syncAutoUnlocks("learner", INSTITUTE, List.of(
                    claim("first_course", "x"), claim("dedicated_learner", "y"), claim("badge_custom", "z")));

            assertEquals(2, inserted);
        }

        @Test
        @DisplayName("rows already present (any status) are skipped; a racing duplicate insert is absorbed")
        void idempotentAndRaceSafe() {
            member(true);
            catalogue(def("a", "A", "streak"), def("b", "B", "streak"), def("c", "C", "streak"));
            when(learnerBadgeRepository.existsByUserIdAndBadgeIdAndInstituteId("learner", "a", INSTITUTE))
                    .thenReturn(true);
            when(learnerBadgeRepository.save(any(LearnerBadge.class))).thenAnswer(inv -> {
                LearnerBadge b = inv.getArgument(0);
                if ("b".equals(b.getBadgeId())) throw new DataIntegrityViolationException("dup");
                return b;
            });

            int inserted = service.syncAutoUnlocks("learner", INSTITUTE,
                    List.of(claim("a", "A"), claim("b", "B"), claim("c", "C")));

            assertEquals(1, inserted, "a = already present, b = lost the race, c = inserted");
        }

        @Test
        @DisplayName("blank user/institute or an empty list are a no-op")
        void noOps() {
            assertEquals(0, service.syncAutoUnlocks("", INSTITUTE, List.of(claim("a", "A"))));
            assertEquals(0, service.syncAutoUnlocks("learner", null, List.of(claim("a", "A"))));
            member(true);
            assertEquals(0, service.syncAutoUnlocks("learner", INSTITUTE, null));
            assertEquals(0, service.syncAutoUnlocks("learner", INSTITUTE, List.of()));
            verifyNoInteractions(badgeCatalogueService);
        }
    }
}
