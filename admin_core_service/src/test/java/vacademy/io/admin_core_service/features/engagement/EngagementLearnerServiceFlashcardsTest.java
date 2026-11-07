package vacademy.io.admin_core_service.features.engagement;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementFeedDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSubmitRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSubmitResponse;
import vacademy.io.admin_core_service.features.engagement.dto.FlashcardOutcome;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAttempt;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAttemptRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementItemRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementSlotRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementLearnerService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementRejectedException;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver;
import vacademy.io.admin_core_service.features.engagement.service.EngagementSettingsService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_operation.repository.LearnerOperationRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * FLASHCARDS grading (flashcards spec B2 / B7): the four refusals in order, completion
 * points only in every setting, and a stored response the server builds itself.
 */
class EngagementLearnerServiceFlashcardsTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final String INST = "inst-1";
    private static final String USER = "u-1";
    private static final String PS = "ps-1";
    private static final ZonedDateTime NOW = ZonedDateTime.of(2026, 9, 25, 10, 0, 0, 0, IST);
    private static final LocalDate TODAY = NOW.toLocalDate();

    /** Four cards: the patience gate is max(5 s, min(4 × 1.5 s, 60 s)) = 6 s. */
    private static final String DECK = "{\"schema\":\"flashcards/v1\",\"cards\":["
            + "{\"id\":\"c1\",\"front\":\"F1\",\"back\":\"B1\"},"
            + "{\"id\":\"c2\",\"front\":\"F2\",\"back\":\"B2\"},"
            + "{\"id\":\"c3\",\"front\":\"F3\",\"back\":\"B3\",\"hint\":\"H\"},"
            + "{\"id\":\"c4\",\"front\":\"F4\",\"back\":\"B4\"}],\"settings\":{\"shuffle\":true}}";

    private final ObjectMapper om = new ObjectMapper();

    private EngagementAttemptRepository attempts;
    private EngagementSettingsService settings;
    private PointsLedgerService points;
    private EngagementLearnerService service;
    private EngagementPlan plan;
    private EngagementSlot slot;
    private EngagementItem deck;
    private boolean unverifiedBonus;

    @BeforeEach
    void setUp() {
        EngagementPlanRepository plans = mock(EngagementPlanRepository.class);
        EngagementSlotRepository slots = mock(EngagementSlotRepository.class);
        EngagementItemRepository items = mock(EngagementItemRepository.class);
        StudentSessionInstituteGroupMappingRepository enrollment =
                mock(StudentSessionInstituteGroupMappingRepository.class);
        attempts = mock(EngagementAttemptRepository.class);
        settings = mock(EngagementSettingsService.class);
        points = mock(PointsLedgerService.class);
        PointsLedgerRepository ledgerRepo = mock(PointsLedgerRepository.class);
        service = new EngagementLearnerService(plans, slots, items, attempts, new EngagementScheduleResolver(),
                settings, points, enrollment, mock(LearnerOperationRepository.class),
                mock(PackageSessionRepository.class), om, ledgerRepo,
                mock(org.springframework.transaction.PlatformTransactionManager.class));
        service.setClock(Clock.fixed(NOW.toInstant(), ZoneOffset.UTC));

        plan = new EngagementPlan();
        plan.setId("plan-1");
        plan.setInstituteId(INST);
        plan.setPackageSessionId(PS);
        plan.setStatus("PUBLISHED");
        plan.setTimezone("Asia/Kolkata");
        plan.setDefaultMissPolicy("CATCH_UP_REDUCED");
        plan.setDefaultCatchUpDays(2);
        plan.setDefaultCatchUpPercent(50);

        slot = new EngagementSlot();
        slot.setId("slot-1");
        slot.setPlanId("plan-1");
        slot.setStartDate(TODAY);
        slot.setStartTime(LocalTime.of(7, 0));
        slot.setEndTime(LocalTime.of(21, 0));

        deck = new EngagementItem();
        deck.setId("fc-1");
        deck.setSlotId("slot-1");
        deck.setItemType("FLASHCARDS");
        deck.setTitle("Key terms");
        deck.setVersion(3);
        deck.setCompletionPoints(10);
        deck.setCorrectPoints(0);
        deck.setMaxScore(4);
        deck.setPayloadJson(DECK);

        when(enrollment.findPackageSessionIdsByUserIdAndInstituteId(USER, INST)).thenReturn(List.of(PS));
        when(plans.findById("plan-1")).thenReturn(Optional.of(plan));
        when(plans.findPublishedForPackageSessions(anyList(), eq(INST))).thenReturn(List.of(plan));
        when(slots.findById("slot-1")).thenReturn(Optional.of(slot));
        when(slots.findInRange(anyList(), any(), any())).thenAnswer(inv -> List.of(slot));
        when(items.findById("fc-1")).thenReturn(Optional.of(deck));
        when(items.findActiveBySlots(anyList())).thenAnswer(inv -> List.of(deck));
        when(attempts.countCompletedForItems(anyList())).thenReturn(List.of());
        when(attempts.findCompletedBetween(anyString(), anyString(), any(), any())).thenReturn(List.of());
        when(attempts.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        when(settings.snapshot(INST)).thenAnswer(inv -> new EngagementSettingsService.Snapshot(
                5, 80, 15_000L, 20_000L, unverifiedBonus));
        when(points.award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyString(),
                anyString())).thenReturn(Optional.empty());
    }

    /** The STARTED row GET item writes, opened {@code secondsAgo} ago. */
    private EngagementAttempt openedAgo(long secondsAgo) {
        EngagementAttempt a = new EngagementAttempt();
        a.setId("att-1");
        a.setItemId("fc-1");
        a.setItemVersion(3);
        a.setUserId(USER);
        a.setInstituteId(INST);
        a.setPackageSessionId(PS);
        a.setStatus("STARTED");
        a.setStartedAt(Timestamp.from(NOW.minusSeconds(secondsAgo).toInstant()));
        when(attempts.findByItemIdAndUserId("fc-1", USER)).thenReturn(Optional.of(a));
        when(attempts.findByUserAndItems(eq(USER), anyList())).thenReturn(List.of(a));
        return a;
    }

    private static EngagementSubmitRequest request(Integer version, String... pairs) {
        EngagementSubmitRequest req = new EngagementSubmitRequest();
        req.setItemVersion(version);
        List<FlashcardOutcome> outcomes = new ArrayList<>();
        for (String pair : pairs) {
            String[] p = pair.split("=");
            outcomes.add(new FlashcardOutcome(p[0], p.length > 1 ? p[1] : null));
        }
        req.setCardOutcomes(outcomes);
        return req;
    }

    private static EngagementSubmitRequest valid() {
        return request(3, "c1=KNOWN", "c2=LEARNING", "c3=KNOWN", "c4=KNOWN");
    }

    private EngagementRejectedException refused(EngagementSubmitRequest req) {
        return assertThrows(EngagementRejectedException.class, () -> service.submit("fc-1", INST, USER, req));
    }

    // ── refusals, in order ──────────────────────────────────────────────────

    @Test
    @DisplayName("1. never opened through GET item: 'Open the cards first'")
    void notOpened() {
        when(attempts.findByItemIdAndUserId("fc-1", USER)).thenReturn(Optional.empty());

        EngagementRejectedException e = refused(valid());

        assertEquals(EngagementRejectedException.FLASHCARDS_STALE, e.getReasonCode());
        assertEquals("Open the cards first", e.getMessage());
    }

    @Test
    @DisplayName("2. a stale itemVersion is refused, even when every other rule would pass")
    void staleVersion() {
        openedAgo(120);

        EngagementRejectedException e = refused(request(2, "c1=KNOWN", "c2=KNOWN", "c3=KNOWN", "c4=KNOWN"));

        assertEquals(EngagementRejectedException.FLASHCARDS_STALE, e.getReasonCode());
        assertEquals("These cards were just updated. Reloading them now.", e.getMessage());
    }

    @Test
    @DisplayName("2 before 3: a stale version wins over incomplete outcomes")
    void staleBeforeIncomplete() {
        openedAgo(120);

        assertEquals(EngagementRejectedException.FLASHCARDS_STALE, refused(request(2, "c1=KNOWN")).getReasonCode());
    }

    @Test
    @DisplayName("3. missing, duplicate, unknown card ids, a bad result, or no outcomes at all")
    void incompleteOutcomes() {
        openedAgo(120);
        List<EngagementSubmitRequest> bad = List.of(
                request(3, "c1=KNOWN", "c2=KNOWN", "c3=KNOWN"),                          // missing c4
                request(3, "c1=KNOWN", "c2=KNOWN", "c3=KNOWN", "c4=KNOWN", "c4=KNOWN"),  // duplicate
                request(3, "c1=KNOWN", "c2=KNOWN", "c3=KNOWN", "zz=KNOWN"),              // unknown
                request(3, "c1=KNOWN", "c2=MAYBE", "c3=KNOWN", "c4=KNOWN"),              // bad result
                request(3, "c1=KNOWN", "c2", "c3=KNOWN", "c4=KNOWN"));                   // no result
        for (EngagementSubmitRequest req : bad) {
            EngagementRejectedException e = refused(req);
            assertEquals(EngagementRejectedException.FLASHCARDS_INCOMPLETE, e.getReasonCode());
            assertEquals("Study every card to finish. If you don't see the cards, update the app.", e.getMessage());
        }

        // An old app: no outcomes and no version.
        EngagementSubmitRequest legacy = new EngagementSubmitRequest();
        legacy.setTimeSpentMs(90_000L);
        legacy.setScore(4.0);
        assertEquals(EngagementRejectedException.FLASHCARDS_INCOMPLETE, refused(legacy).getReasonCode());
    }

    @Test
    @DisplayName("4. sooner than max(5 s, min(n × 1.5 s, 60 s)) since the first open")
    void tooFast() {
        openedAgo(5); // 4 cards → 6 s

        EngagementRejectedException e = refused(valid());

        assertEquals(EngagementRejectedException.FLASHCARDS_TOO_FAST, e.getReasonCode());
        assertEquals("Take a moment with each card before finishing", e.getMessage());
    }

    @Test
    @DisplayName("the patience gate at 6 s passes for a 4-card deck")
    void gateBoundaryPasses() {
        openedAgo(6);

        assertEquals("COMPLETED", service.submit("fc-1", INST, USER, valid()).getStatus());
    }

    // ── a valid submit ──────────────────────────────────────────────────────

    @Test
    @DisplayName("pays completion only, even with the unverified score bonus on; score = known, maxScore = n")
    void validSubmit() throws Exception {
        unverifiedBonus = true;
        deck.setCorrectPoints(50); // a legacy row: must never pay
        deck.setIsVerifiable(true);
        openedAgo(120);
        EngagementSubmitRequest req = request(3, "c4=KNOWN", "c3=KNOWN", "c2=learning", "c1=KNOWN");
        req.setScore(99.0);
        req.setResponseJson("{\"cheat\":true}");

        EngagementSubmitResponse resp = service.submit("fc-1", INST, USER, req);

        ArgumentCaptor<EngagementAttempt> saved = ArgumentCaptor.forClass(EngagementAttempt.class);
        verify(attempts).saveAndFlush(saved.capture());
        EngagementAttempt row = saved.getValue();
        assertEquals(10, row.getPointsAwarded());
        assertEquals(0, new BigDecimal(3).compareTo(row.getScore()));
        assertEquals(0, new BigDecimal(4).compareTo(row.getMaxScore()));
        assertNull(row.getIsCorrect());
        assertEquals(3, row.getItemVersion());

        JsonNode stored = om.readTree(row.getResponseJson());
        assertEquals(1, stored.size(), "only the flashcards object is stored");
        JsonNode fc = stored.get("flashcards");
        assertEquals(3, fc.get("version").asInt());
        assertEquals(4, fc.get("total").asInt());
        assertEquals(3, fc.get("known").asInt());
        // Deck order, normalised result.
        assertEquals("c1", fc.get("outcomes").get(0).get("cardId").asText());
        assertEquals("LEARNING", fc.get("outcomes").get(1).get("result").asText());
        assertFalse(row.getResponseJson().contains("cheat"));
        assertFalse(row.getResponseJson().contains("99"));

        verify(points).award(eq(USER), eq(INST), eq(PS), any(), eq("fc-1"), eq(10), anyString(), anyString());
        assertEquals(10, resp.getPointsAwarded());
        assertNull(resp.getIsCorrect());
        assertEquals(Boolean.FALSE, resp.getAlreadyCompleted());
        assertEquals(Boolean.FALSE, resp.getResultPending());
        assertEquals(new EngagementItemDTO.FlashcardsResult(3, 3, 4, List.of("c2")), resp.getFlashcardsResult());
    }

    @Test
    @DisplayName("a catch-up deck pays completion × the catch-up percent")
    void lateDeck() {
        slot.setStartDate(TODAY.minusDays(1));
        openedAgo(120);

        EngagementSubmitResponse resp = service.submit("fc-1", INST, USER, valid());

        assertEquals(5, resp.getPointsAwarded());
        assertEquals(Boolean.TRUE, resp.getIsLate());
    }

    @Test
    @DisplayName("a second submit is idempotent: alreadyCompleted, nothing saved or awarded")
    void secondSubmitIdempotent() {
        EngagementAttempt done = openedAgo(120);
        done.setStatus("COMPLETED");
        done.setCompletedAt(Timestamp.from(NOW.minusSeconds(10).toInstant()));
        done.setPointsAwarded(10);
        done.setResponseJson("{\"flashcards\":{\"version\":3,\"total\":4,\"known\":4,\"outcomes\":["
                + "{\"cardId\":\"c1\",\"result\":\"KNOWN\"},{\"cardId\":\"c2\",\"result\":\"KNOWN\"},"
                + "{\"cardId\":\"c3\",\"result\":\"KNOWN\"},{\"cardId\":\"c4\",\"result\":\"KNOWN\"}]}}");

        // Even a request that would be refused now returns the earlier result.
        EngagementSubmitResponse resp = service.submit("fc-1", INST, USER, request(1));

        assertEquals(Boolean.TRUE, resp.getAlreadyCompleted());
        assertEquals(10, resp.getPointsAwarded());
        assertEquals(4, resp.getFlashcardsResult().getKnown());
        verify(attempts, never()).saveAndFlush(any());
        verify(points, never()).award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(),
                anyString(), anyString());
    }

    // ── reads ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GET item: flashcardsResult from the stored response, maxScore = the deck size, no bonus")
    void itemCarriesResult() {
        EngagementAttempt done = openedAgo(300);
        done.setStatus("COMPLETED");
        done.setCompletedAt(Timestamp.from(NOW.minusSeconds(60).toInstant()));
        done.setResponseJson("{\"flashcards\":{\"version\":2,\"total\":3,\"known\":1,\"outcomes\":["
                + "{\"cardId\":\"c1\",\"result\":\"KNOWN\"},{\"cardId\":\"c2\",\"result\":\"LEARNING\"},"
                + "{\"cardId\":\"c3\",\"result\":\"LEARNING\"}]}}");

        EngagementItemDTO dto = service.getItem("fc-1", INST, USER);

        assertEquals(new EngagementItemDTO.FlashcardsResult(2, 1, 3, List.of("c2", "c3")), dto.getFlashcardsResult());
        assertEquals(4, dto.getMaxScore());
        assertEquals(Boolean.FALSE, dto.getScoreBonusEnabled());
        assertEquals(0, dto.getEarnablePoints());
        assertEquals(NOW.toInstant().toEpochMilli(), dto.getServerTimeMs());
        assertTrue(dto.getPayloadJson().contains("\"c3\""));
    }

    @Test
    @DisplayName("an open deck: earnable = completion, no pending bonus, no result")
    void openDeckChips() {
        openedAgo(1);

        EngagementItemDTO dto = service.getItem("fc-1", INST, USER);

        assertEquals(10, dto.getEarnablePoints());
        assertNull(dto.getPendingBonus());
        assertNull(dto.getFlashcardsResult());
        assertEquals(NOW.minusSeconds(1).toInstant().toString(), dto.getStartedAt());
    }

    @Test
    @DisplayName("getFeed never lists a completed deck under revealed")
    void neverRevealed() {
        slot.setStartDate(TODAY.minusDays(1));
        plan.setDefaultMissPolicy("EXPIRES");
        EngagementAttempt done = openedAgo(86_000);
        done.setStatus("COMPLETED");
        done.setCompletedAt(Timestamp.from(NOW.minusHours(20).toInstant()));

        EngagementFeedDTO feed = service.getFeed(INST, USER);

        assertTrue(feed.getRevealed().isEmpty());
    }
}
