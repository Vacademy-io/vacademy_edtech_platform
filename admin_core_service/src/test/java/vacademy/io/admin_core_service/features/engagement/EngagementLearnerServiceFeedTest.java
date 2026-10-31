package vacademy.io.admin_core_service.features.engagement;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.features.engagement.controller.EngagementExceptionAdvice;
import vacademy.io.admin_core_service.features.engagement.controller.EngagementLearnerController;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementFeedDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementHistoryDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSubmitRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSubmitResponse;
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
import vacademy.io.admin_core_service.features.learner_operation.entity.LearnerOperation;
import vacademy.io.admin_core_service.features.learner_operation.repository.LearnerOperationRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.exception.GlobalExceptionHandler;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * The learner feed contract (WP-2A): a progress total that never moves, catch-ups kept
 * apart and out of the cap, finished work kept, honest point chips, the answer key only
 * for learners who can no longer answer, poll splits, and the error body with reasonCode.
 */
class EngagementLearnerServiceFeedTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final String INST = "inst-1";
    private static final String USER = "u-1";
    private static final String PS = "ps-1";
    /** Friday 25 Sep 2026, 10:00 in the plan's zone. */
    private static final ZonedDateTime NOW = ZonedDateTime.of(2026, 9, 25, 10, 0, 0, 0, IST);
    private static final LocalDate TODAY = NOW.toLocalDate();

    private final ObjectMapper om = new ObjectMapper();

    private EngagementPlanRepository plans;
    private EngagementSlotRepository slots;
    private EngagementItemRepository items;
    private EngagementAttemptRepository attempts;
    private EngagementSettingsService settings;
    private PointsLedgerService points;
    private StudentSessionInstituteGroupMappingRepository enrollment;
    private LearnerOperationRepository learnerOps;
    private PointsLedgerRepository ledgerRepo;
    private EngagementLearnerService service;

    private EngagementPlan plan;
    private final List<EngagementSlot> slotRows = new ArrayList<>();
    private final List<EngagementItem> itemRows = new ArrayList<>();
    private final List<EngagementAttempt> attemptRows = new ArrayList<>();
    private final List<Object[]> completedCountRows = new ArrayList<>();
    private int cap = 5;

    @BeforeEach
    void setUp() {
        plans = mock(EngagementPlanRepository.class);
        slots = mock(EngagementSlotRepository.class);
        items = mock(EngagementItemRepository.class);
        attempts = mock(EngagementAttemptRepository.class);
        settings = mock(EngagementSettingsService.class);
        points = mock(PointsLedgerService.class);
        enrollment = mock(StudentSessionInstituteGroupMappingRepository.class);
        learnerOps = mock(LearnerOperationRepository.class);
        ledgerRepo = mock(PointsLedgerRepository.class);
        service = new EngagementLearnerService(plans, slots, items, attempts, new EngagementScheduleResolver(),
                settings, points, enrollment, learnerOps, mock(PackageSessionRepository.class), om, ledgerRepo,
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

        when(enrollment.findPackageSessionIdsByUserIdAndInstituteId(USER, INST)).thenReturn(List.of(PS));
        when(plans.findPublishedForPackageSessions(anyList(), eq(INST))).thenReturn(List.of(plan));
        when(plans.findById("plan-1")).thenReturn(Optional.of(plan));
        when(slots.findInRange(anyList(), any(), any())).thenReturn(slotRows);
        when(items.findActiveBySlots(anyList())).thenReturn(itemRows);
        when(attempts.findByUserAndItems(eq(USER), anyList())).thenReturn(attemptRows);
        when(attempts.countCompletedForItems(anyList())).thenReturn(completedCountRows);
        when(attempts.findCompletedBetween(anyString(), anyString(), any(), any())).thenReturn(List.of());
        when(settings.snapshot(INST)).thenAnswer(inv -> new EngagementSettingsService.Snapshot(
                cap, 80, 15_000L, 20_000L, false));
        when(points.award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyString(),
                anyString())).thenReturn(Optional.empty());
    }

    // ── fixture helpers ─────────────────────────────────────────────────────

    private EngagementSlot slot(String id, LocalDate start, LocalDate end, LocalTime from, LocalTime to) {
        EngagementSlot s = new EngagementSlot();
        s.setId(id);
        s.setPlanId(plan.getId());
        s.setStartDate(start);
        s.setEndDate(end);
        s.setStartTime(from);
        s.setEndTime(to);
        slotRows.add(s);
        when(slots.findById(id)).thenReturn(Optional.of(s));
        return s;
    }

    /** A slot that runs once, on {@code day}, 07:00–21:00. */
    private EngagementSlot daySlot(String id, LocalDate day) {
        return slot(id, day, null, LocalTime.of(7, 0), LocalTime.of(21, 0));
    }

    private EngagementItem item(String id, EngagementSlot slot, String type, int sortOrder) {
        EngagementItem i = new EngagementItem();
        i.setId(id);
        i.setSlotId(slot.getId());
        i.setItemType(type);
        i.setTitle("Task " + id);
        i.setSortOrder(sortOrder);
        i.setCompletionPoints(10);
        i.setCorrectPoints(0);
        itemRows.add(i);
        when(items.findById(id)).thenReturn(Optional.of(i));
        return i;
    }

    private EngagementItem mcq(String id, EngagementSlot slot) {
        EngagementItem i = item(id, slot, "QUESTION_OF_DAY", 0);
        i.setCorrectPoints(20);
        i.setPayloadJson("{\"prompt\":\"<p>2 &amp; 2 = ?</p>\",\"options\":[{\"id\":\"a\",\"text\":\"3\"},"
                + "{\"id\":\"b\",\"text\":\"4\"}],\"correctOptionId\":\"b\",\"explanation\":\"Sum\"}");
        return i;
    }

    private EngagementAttempt completed(EngagementItem item, ZonedDateTime at, String responseJson) {
        EngagementAttempt a = new EngagementAttempt();
        a.setId("att-" + item.getId());
        a.setItemId(item.getId());
        a.setUserId(USER);
        a.setInstituteId(INST);
        a.setPackageSessionId(PS);
        a.setStatus("COMPLETED");
        a.setStartedAt(Timestamp.from(at.minusMinutes(2).toInstant()));
        a.setCompletedAt(Timestamp.from(at.toInstant()));
        a.setPointsAwarded(10);
        a.setResponseJson(responseJson);
        attemptRows.add(a);
        when(attempts.findByItemIdAndUserId(item.getId(), USER)).thenReturn(Optional.of(a));
        return a;
    }

    private static Set<String> ids(List<EngagementItemDTO> list) {
        return list.stream().map(EngagementItemDTO::getId).collect(Collectors.toCollection(HashSet::new));
    }

    // ── progress total, cap and catch-up ────────────────────────────────────

    @Nested
    @DisplayName("b1 fixture: 7 tasks today, cap 5, one catch-up from yesterday")
    class ProgressTotal {

        private final List<EngagementItem> today = new ArrayList<>();
        private EngagementItem yesterdayTask;

        @BeforeEach
        void fixture() {
            EngagementSlot t = daySlot("slot-today", TODAY);
            for (int n = 0; n < 7; n++) today.add(item("t" + n, t, "READING_HTML", n));
            yesterdayTask = item("y0", daySlot("slot-yesterday", TODAY.minusDays(1)), "READING_HTML", 0);
        }

        @Test
        @DisplayName("scheduledToday counts every task today; the catch-up stays out and out of the cap")
        void totalsBeforeAnyWork() {
            EngagementFeedDTO feed = service.getFeed(INST, USER);

            assertEquals(7, feed.getScheduledToday());
            assertEquals(0, feed.getCompletedToday());
            assertEquals(2, feed.getHiddenByCap());
            assertEquals(Set.of("y0"), ids(feed.getCatchUp()));
            // Legacy items: today's 5 (capped) then the catch-up; totalToday mirrors its size.
            assertEquals(6, feed.getItems().size());
            assertEquals(6, feed.getTotalToday());
            assertEquals("y0", feed.getItems().get(5).getId());
            assertTrue(feed.isCapApplied());

            EngagementItemDTO catchUp = feed.getCatchUp().get(0);
            assertEquals("CATCH_UP", catchUp.getState());
            assertEquals(5, catchUp.getEffectivePoints()); // 10 × 50 %
            assertEquals(5, catchUp.getEarnablePoints());
            String closes = ZonedDateTime.of(TODAY.minusDays(1), LocalTime.of(21, 0), IST)
                    .plusDays(2).toInstant().toString();
            assertEquals(closes, catchUp.getCatchUpClosesAt());
            assertEquals(closes, feed.getCatchUpClosesAt());
            assertEquals(TODAY.toString(), feed.getToday());
            assertEquals(NOW.toInstant().toEpochMilli(), feed.getServerTimeMs());
        }

        @Test
        @DisplayName("finishing tasks lowers hiddenByCap and fills doneToday while the total stays fixed")
        void totalStaysFixedAsWorkIsDone() {
            completed(today.get(0), NOW.minusMinutes(30), null);
            completed(today.get(1), NOW.minusMinutes(20), null);
            completedCountRows.add(new Object[] {"t0", 3L});

            EngagementFeedDTO feed = service.getFeed(INST, USER);

            assertEquals(7, feed.getScheduledToday());
            assertEquals(2, feed.getCompletedToday());
            assertEquals(0, feed.getHiddenByCap());
            assertEquals(List.of("t1", "t0"),
                    feed.getDoneToday().stream().map(EngagementItemDTO::getId).toList()); // newest first
            assertEquals(0, feed.getDoneToday().get(0).getEarnablePoints());
            assertEquals(5, feed.getItems().size() - feed.getCatchUp().size());
        }

        @Test
        @DisplayName("a catch-up finished today is in doneToday but never in scheduledToday or completedToday")
        void catchUpNeverEntersTheTotal() {
            EngagementAttempt late = completed(yesterdayTask, NOW.minusMinutes(5), null);
            late.setIsLate(true);

            EngagementFeedDTO feed = service.getFeed(INST, USER);

            assertEquals(7, feed.getScheduledToday());
            assertEquals(0, feed.getCompletedToday());
            assertTrue(feed.getCatchUp().isEmpty());
            assertEquals(Set.of("y0"), ids(feed.getDoneToday()));
        }

        @Test
        @DisplayName("only two catch-ups are listed, the soonest-closing first")
        void catchUpCap() {
            EngagementSlot older = daySlot("slot-2-days", TODAY.minusDays(2));
            // Closes 2 days after 25 Sep 21:00 minus 2 = 23 Sep 21:00 + 2 d = today 21:00.
            item("o1", older, "READING_HTML", 0);
            item("y1", slotRows.get(1), "READING_HTML", 1);

            EngagementFeedDTO feed = service.getFeed(INST, USER);

            assertEquals(EngagementLearnerService.CATCH_UP_FEED_CAP, feed.getCatchUp().size());
            assertEquals("o1", feed.getCatchUp().get(0).getId());
            assertEquals(7, feed.getScheduledToday());
        }
    }

    @Test
    @DisplayName("today's order: required first, then closing soonest, then the item's order")
    void feedOrder() {
        EngagementSlot early = slot("s-early", TODAY, null, LocalTime.of(7, 0), LocalTime.of(12, 0));
        EngagementSlot late = daySlot("s-late", TODAY);
        item("late-1", late, "READING_HTML", 1);
        item("late-0", late, "READING_HTML", 0);
        item("early", early, "READING_HTML", 5);
        item("required", late, "READING_HTML", 9).setIsRequired(true);

        List<String> order = service.getFeed(INST, USER).getItems().stream().map(EngagementItemDTO::getId).toList();

        assertEquals(List.of("required", "early", "late-0", "late-1"), order);
    }

    @Test
    @DisplayName("D20 stopgap: a recurring slot whose today-run exists offers no catch-up for yesterday")
    void recurringSlotHasNoCatchUpWhileTodayRuns() {
        EngagementSlot daily = slot("daily", TODAY.minusDays(3), TODAY.plusDays(3),
                LocalTime.of(7, 0), LocalTime.of(21, 0));
        item("d", daily, "READING_HTML", 0);

        EngagementFeedDTO feed = service.getFeed(INST, USER);

        assertTrue(feed.getCatchUp().isEmpty());
        assertEquals(List.of("OPEN"), feed.getItems().stream().map(EngagementItemDTO::getState).toList());
        assertEquals(1, feed.getScheduledToday());
    }

    @Test
    @DisplayName("today's run that has not opened yet is listed under today, not tomorrow")
    void notYetOpenTodayIsUpcomingToday() {
        slot("evening", TODAY, null, LocalTime.of(18, 0), LocalTime.of(21, 0));
        item("e", slotRows.get(0), "READING_HTML", 0);

        EngagementFeedDTO feed = service.getFeed(INST, USER);

        assertEquals(1, feed.getScheduledToday());
        assertTrue(feed.getItems().isEmpty());
        assertEquals(TODAY.toString(), feed.getUpcoming().get(0).getRunDate());
        assertNull(feed.getUpcoming().get(0).getExcerpt());
        assertNull(feed.getUpcoming().get(0).getContentHtml());
    }

    // ── reveal, answer key, points ──────────────────────────────────────────

    @Test
    @DisplayName("revealed carries only questions and polls: never FLASHCARDS, READING, GAME or a lesson")
    void revealedIsQuestionsAndPollsOnly() {
        EngagementSlot yesterday = daySlot("y", TODAY.minusDays(1));
        plan.setDefaultMissPolicy("EXPIRES");
        EngagementItem q = mcq("q", yesterday);
        EngagementItem poll = item("poll", yesterday, "POLL", 1);
        poll.setPayloadJson("{\"prompt\":\"Pick\",\"options\":[{\"id\":\"x\"},{\"id\":\"y\"}]}");
        for (String type : List.of("READING_HTML", "GAME", "FLASHCARDS", "VISUAL_NOTE", "COURSE_SLIDE")) {
            completed(item(type, yesterday, type, 2), NOW.minusHours(20), null);
        }
        completed(q, NOW.minusHours(20), "{\"selectedOptionId\":\"b\"}").setIsCorrect(true);
        completed(poll, NOW.minusHours(20), "{\"selectedOptionId\":\"x\"}");

        EngagementFeedDTO feed = service.getFeed(INST, USER);

        assertEquals(Set.of("q", "poll"), ids(feed.getRevealed()));
        EngagementItemDTO shown = feed.getRevealed().stream().filter(d -> d.getId().equals("q")).findFirst()
                .orElseThrow();
        assertEquals("b", shown.getCorrectOptionId());
        assertEquals("b", shown.getSelectedOptionId());
        assertEquals("Sum", shown.getExplanation());
    }

    @Test
    @DisplayName("a post-reveal catch-up MCQ ships no answer key; its bonus is off and its chip honest")
    void catchUpQuestionHasNoKey() throws Exception {
        mcq("q", daySlot("y", TODAY.minusDays(1)));

        EngagementItemDTO dto = service.getFeed(INST, USER).getCatchUp().get(0);

        assertTrue(dto.getIsRevealed());
        JsonNode payload = om.readTree(dto.getPayloadJson());
        assertFalse(payload.has("correctOptionId"));
        assertFalse(payload.has("explanation"));
        assertFalse(dto.getScoreBonusEnabled());
        assertEquals(5, dto.getEarnablePoints()); // completion only, at 50 %
        assertEquals("2 & 2 = ?", dto.getPromptText());
    }

    @Test
    @DisplayName("an open hide-until-reveal MCQ: the bonus is pending, no key, full earnable points")
    void pendingBonusOnHiddenQuestion() {
        EngagementSlot t = slot("t", TODAY, null, LocalTime.of(7, 0), LocalTime.of(21, 0));
        t.setRevealTime(LocalTime.of(20, 0));
        mcq("q", t).setHideResultUntilReveal(true);

        EngagementItemDTO dto = service.getFeed(INST, USER).getItems().get(0);

        assertTrue(dto.getScoreBonusEnabled());
        assertEquals(30, dto.getEarnablePoints());
        assertEquals(10, dto.getEffectivePoints());
        assertEquals(20, dto.getPendingBonus());
        assertFalse(dto.getPayloadJson().contains("correctOptionId"));
    }

    @Test
    @DisplayName("a correct hidden answer is settled on read once its reveal has passed")
    void settlesRevealBonusOnRead() {
        EngagementSlot y = daySlot("y", TODAY.minusDays(1));
        plan.setDefaultMissPolicy("EXPIRES");
        EngagementItem q = mcq("q", y);
        q.setHideResultUntilReveal(true);
        q.setVersion(3);
        EngagementAttempt a = completed(q, ZonedDateTime.of(TODAY.minusDays(1), LocalTime.of(9, 0), IST),
                "{\"selectedOptionId\":\"b\"}");
        a.setIsCorrect(true);
        a.setItemVersion(3);

        service.getFeed(INST, USER);

        verify(points).award(eq(USER), eq(INST), eq(PS), any(), eq("q"), eq(20), anyString(),
                eq("ENGAGEMENT_BONUS:q:v3:" + USER));
    }

    @Test
    @DisplayName("settle on read skips a bonus the ledger already holds, without calling award")
    void settleSkipsWhenAlreadyPaid() {
        EngagementSlot y = daySlot("y", TODAY.minusDays(1));
        plan.setDefaultMissPolicy("EXPIRES");
        EngagementItem q = mcq("q", y);
        q.setHideResultUntilReveal(true);
        q.setVersion(3);
        EngagementAttempt a = completed(q, ZonedDateTime.of(TODAY.minusDays(1), LocalTime.of(9, 0), IST),
                "{\"selectedOptionId\":\"b\"}");
        a.setIsCorrect(true);
        a.setItemVersion(3);
        when(ledgerRepo.existsByIdempotencyKey("ENGAGEMENT_BONUS:q:v3:" + USER)).thenReturn(true);

        service.getFeed(INST, USER);

        verify(points, never()).award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(),
                anyString(), anyString());
        verify(attempts, never()).save(any());
    }

    @Test
    @DisplayName("settle on read: the bonus is written in its own transaction and shown on the row")
    void settledBonusShowsOnTheRow() {
        EngagementSlot y = daySlot("y", TODAY.minusDays(1));
        plan.setDefaultMissPolicy("EXPIRES");
        EngagementItem q = mcq("q", y);
        q.setHideResultUntilReveal(true);
        EngagementAttempt a = completed(q, ZonedDateTime.of(TODAY.minusDays(1), LocalTime.of(9, 0), IST),
                "{\"selectedOptionId\":\"b\"}");
        a.setIsCorrect(true);
        when(points.award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyString(),
                anyString())).thenReturn(Optional.of(new vacademy.io.admin_core_service.features.points_ledger
                .entity.PointsLedger()));

        // The stored row, as the new read-write transaction loads it from the primary.
        EngagementAttempt stored = new EngagementAttempt();
        stored.setId(a.getId());
        stored.setPointsAwarded(10);
        when(attempts.findById(a.getId())).thenReturn(Optional.of(stored));

        EngagementFeedDTO feed = service.getFeed(INST, USER);

        assertEquals(30, stored.getPointsAwarded());
        verify(attempts).save(stored);
        verify(attempts, never()).save(a);
        assertEquals(30, feed.getRevealed().get(0).getPointsAwarded());
    }

    @Test
    @DisplayName("GET item settles in its own read-write transaction and shows the bonus")
    void getItemSettlesInline() {
        EngagementSlot t = daySlot("t", TODAY);
        t.setRevealTime(LocalTime.of(9, 30));
        EngagementItem q = mcq("q", t);
        q.setHideResultUntilReveal(true);
        EngagementAttempt a = completed(q, NOW.minusHours(1), "{\"selectedOptionId\":\"b\"}");
        a.setIsCorrect(true);
        when(points.award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyString(),
                anyString())).thenReturn(Optional.of(new vacademy.io.admin_core_service.features.points_ledger
                .entity.PointsLedger()));

        EngagementItemDTO dto = service.getItem("q", INST, USER);

        verify(attempts).save(a);
        assertEquals(30, dto.getPointsAwarded());
        assertEquals(Boolean.TRUE, dto.getIsCorrect());
        assertEquals("b", om.valueToTree(dto).get("selectedOptionId").asText());
    }

    @Test
    @DisplayName("the feed loads slots far enough back to find a catch-up older than yesterday")
    void feedLooksBackOverCatchUp() {
        plan.setDefaultCatchUpDays(10);
        daySlot("t", TODAY);
        item("t0", slotRows.get(0), "READING_HTML", 0);
        org.mockito.ArgumentCaptor<LocalDate> from = org.mockito.ArgumentCaptor.forClass(LocalDate.class);

        service.getFeed(INST, USER);

        verify(slots).findInRange(anyList(), from.capture(), any());
        LocalDate utcToday = NOW.withZoneSameInstant(ZoneOffset.UTC).toLocalDate();
        assertEquals(utcToday.minusDays(11), from.getValue());
    }

    @Test
    @DisplayName("history: an older run of a recurring question still open today ships no answer key")
    void historyHidesKeyWhileRecurringItemIsOpen() throws Exception {
        plan.setDefaultMissPolicy("EXPIRES");
        EngagementSlot daily = slot("daily", TODAY.minusDays(3), TODAY.plusDays(3),
                LocalTime.of(7, 0), LocalTime.of(21, 0));
        mcq("q", daily);
        // A one-off question that closed yesterday can no longer be answered: its key stays.
        mcq("gone", daySlot("y", TODAY.minusDays(1)));

        var history = service.getHistory(INST, USER, 7);

        List<EngagementItemDTO> recurring = history.getItems().stream()
                .filter(d -> d.getId().equals("q")).toList();
        assertEquals(3, recurring.size());
        for (EngagementItemDTO row : recurring) {
            assertEquals("MISSED", row.getHistoryStatus());
            assertFalse(om.readTree(row.getPayloadJson()).has("correctOptionId"), row.getRunDate());
            assertFalse(om.readTree(row.getPayloadJson()).has("explanation"), row.getRunDate());
        }
        EngagementItemDTO closed = history.getItems().stream().filter(d -> d.getId().equals("gone"))
                .findFirst().orElseThrow();
        assertTrue(om.readTree(closed.getPayloadJson()).has("correctOptionId"));
        assertEquals(TODAY.toString(), history.getToday());
        assertEquals("Asia/Kolkata", history.getTimezone());
    }

    @Test
    @DisplayName("excerpt: tags stripped, a repeated title dropped, cut to 160 with an ellipsis")
    void excerpt() {
        EngagementItem r = item("r", daySlot("t", TODAY), "READING_HTML", 0);
        r.setTitle("Photosynthesis");
        r.setContentHtml("<html><head><style>p{}</style></head><body><h1>Photosynthesis</h1><p>"
                + "Plants turn light into food. ".repeat(10) + "</p><script>x()</script></body></html>");

        String excerpt = service.getFeed(INST, USER).getItems().get(0).getExcerpt();

        assertTrue(excerpt.startsWith("Plants turn light"), excerpt);
        assertTrue(excerpt.length() <= EngagementLearnerService.EXCERPT_MAX, excerpt);
        assertTrue(excerpt.endsWith("…"), excerpt);
        assertFalse(excerpt.contains("x()"));
    }

    @Test
    @DisplayName("COURSE_SLIDE: claimable when the slide is finished, and no attempt is created by the check")
    void claimableWithoutWrites() {
        EngagementSlot t = daySlot("t", TODAY);
        EngagementItem done = item("done", t, "COURSE_SLIDE", 0);
        done.setSlideId("slide-done");
        EngagementItem notYet = item("not-yet", t, "COURSE_SLIDE", 1);
        notYet.setSlideId("slide-new");
        LearnerOperation op = new LearnerOperation();
        op.setValue("100");
        when(learnerOps.findByUserIdAndSourceAndSourceIdAndOperation(eq(USER), anyString(), eq("slide-done"),
                anyString())).thenReturn(Optional.of(op));

        EngagementFeedDTO feed = service.getFeed(INST, USER);

        assertEquals(Boolean.TRUE, feed.getItems().stream().filter(d -> d.getId().equals("done")).findFirst()
                .orElseThrow().getClaimable());
        assertEquals(Boolean.FALSE, feed.getItems().stream().filter(d -> d.getId().equals("not-yet"))
                .findFirst().orElseThrow().getClaimable());
        verify(attempts, never()).insertStartedIfAbsent(anyString(), anyString(), anyInt(), anyString(),
                anyString(), anyString());
        verify(attempts, never()).save(any());
        verify(attempts, never()).saveAndFlush(any());
    }

    @Test
    @DisplayName("gates are on the DTO: minReadMs / minScrollPercent for readings, minGameMs for games")
    void gatesOnDto() {
        EngagementSlot t = daySlot("t", TODAY);
        item("r", t, "READING_HTML", 0);
        item("g", t, "GAME", 1);

        List<EngagementItemDTO> list = service.getFeed(INST, USER).getItems();

        EngagementItemDTO r = list.stream().filter(d -> d.getId().equals("r")).findFirst().orElseThrow();
        EngagementItemDTO g = list.stream().filter(d -> d.getId().equals("g")).findFirst().orElseThrow();
        assertEquals(15_000L, r.getMinReadMs());
        assertEquals(80, r.getMinScrollPercent());
        assertNull(r.getMinGameMs());
        assertEquals(20_000L, g.getMinGameMs());
    }

    // ── polls ───────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("poll results")
    class Polls {

        private EngagementItem poll;

        @BeforeEach
        void fixture() {
            poll = item("poll", daySlot("t", TODAY), "POLL", 0);
            poll.setPayloadJson("{\"prompt\":\"Pick\",\"options\":[{\"id\":\"x\"},{\"id\":\"y\"},{\"id\":\"z\"}]}");
            completed(poll, NOW.minusMinutes(1), "{\"selectedOptionId\":\"x\"}");
        }

        @Test
        @DisplayName("from 5 votes: the split in authored order, whole percents that sum to 100")
        void splitFromFiveVotes() {
            // "gone" is an option the teacher has since removed: counted, never shown.
            when(attempts.countByOption("poll")).thenReturn(List.<Object[]>of(
                    new Object[] {"y", 2L}, new Object[] {"x", 4L}, new Object[] {"gone", 1L}));

            EngagementItemDTO done = service.getFeed(INST, USER).getDoneToday().get(0);

            assertEquals(List.of("x", "y", "z"),
                    done.getPollResults().stream().map(EngagementItemDTO.PollResult::getOptionId).toList());
            assertEquals(List.of(67, 33, 0),
                    done.getPollResults().stream().map(EngagementItemDTO.PollResult::getPercent).toList());
            assertEquals(7L, done.getResponseCount());
            assertEquals("x", done.getSelectedOptionId());
        }

        @Test
        @DisplayName("under 5 votes: no split, just the count")
        void noSplitUnderFive() {
            when(attempts.countByOption("poll")).thenReturn(List.<Object[]>of(new Object[] {"x", 4L}));

            EngagementItemDTO done = service.getFeed(INST, USER).getDoneToday().get(0);

            assertNull(done.getPollResults());
            assertEquals(4L, done.getResponseCount());
        }
    }

    // ── submit contract ─────────────────────────────────────────────────────

    @Test
    @DisplayName("a correct answer after the reveal: completion × percent only, answerAlreadyOut")
    void answerAfterRevealPaysCompletionOnly() {
        EngagementItem q = mcq("q", daySlot("y", TODAY.minusDays(1)));
        when(attempts.findByItemIdAndUserId("q", USER)).thenReturn(Optional.empty());
        when(attempts.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        EngagementSubmitRequest req = new EngagementSubmitRequest();
        req.setSelectedOptionId("b");

        EngagementSubmitResponse resp = service.submit("q", INST, USER, req);

        assertEquals(5, resp.getPointsAwarded()); // 10 completion × 50 %, no bonus
        assertEquals(Boolean.TRUE, resp.getIsCorrect());
        assertEquals(Boolean.TRUE, resp.getAnswerAlreadyOut());
        assertEquals(Boolean.FALSE, resp.getAlreadyCompleted());
        assertEquals(Boolean.TRUE, resp.getIsLate());
        verify(points).award(eq(USER), eq(INST), eq(PS), any(), eq("q"), eq(5), anyString(), anyString());
        assertNotNull(q);
    }

    @Test
    @DisplayName("a repeat submit returns the earlier attempt with alreadyCompleted and awards nothing")
    void repeatSubmitIsAlreadyCompleted() {
        EngagementItem r = item("r", daySlot("t", TODAY), "READING_HTML", 0);
        completed(r, NOW.minusMinutes(1), null);

        EngagementSubmitResponse resp = service.submit("r", INST, USER, new EngagementSubmitRequest());

        assertEquals(Boolean.TRUE, resp.getAlreadyCompleted());
        verify(points, never()).award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(),
                anyString(), anyString());
    }

    @Test
    @DisplayName("refusals carry a reasonCode: QUIZ, not open, closed, read gate, answer required")
    void reasonCodes() {
        EngagementSlot t = daySlot("t", TODAY);
        item("quiz", t, "QUIZ", 0);
        mcq("q", t);
        EngagementItem r = item("r", t, "READING_HTML", 1);
        EngagementAttempt started = new EngagementAttempt();
        started.setStatus("STARTED");
        started.setStartedAt(Timestamp.from(NOW.minusSeconds(3).toInstant()));
        when(attempts.findByItemIdAndUserId("r", USER)).thenReturn(Optional.of(started));
        item("later", slot("evening", TODAY, null, LocalTime.of(18, 0), LocalTime.of(21, 0)), "POLL", 0);
        plan.setDefaultMissPolicy("EXPIRES");
        item("gone", daySlot("y", TODAY.minusDays(1)), "POLL", 0);

        assertEquals(EngagementRejectedException.UNSUPPORTED_TYPE, codeOf("quiz", new EngagementSubmitRequest()));
        assertEquals(EngagementRejectedException.ANSWER_REQUIRED, codeOf("q", new EngagementSubmitRequest()));
        EngagementSubmitRequest forged = new EngagementSubmitRequest();
        forged.setScrollPercent(100);
        forged.setTimeSpentMs(999_999L);
        assertEquals(EngagementRejectedException.READ_GATE, codeOf("r", forged));
        assertEquals(EngagementRejectedException.NOT_OPEN, codeOf("later", new EngagementSubmitRequest()));
        assertEquals(EngagementRejectedException.TASK_CLOSED, codeOf("gone", new EngagementSubmitRequest()));
        assertNotNull(r);
    }

    private String codeOf(String itemId, EngagementSubmitRequest req) {
        EngagementRejectedException e = assertThrows(EngagementRejectedException.class,
                () -> service.submit(itemId, INST, USER, req));
        return e.getReasonCode();
    }

    // ── error body ──────────────────────────────────────────────────────────

    @Nested
    @DisplayName("error body")
    class ErrorBody {

        private EngagementLearnerService learner;
        private CustomUserDetails user;

        @BeforeEach
        void setUpMvc() {
            learner = mock(EngagementLearnerService.class);
            user = mock(CustomUserDetails.class);
            when(user.getUserId()).thenReturn(USER);
        }

        private MockMvc mvc(Object... advices) {
            return MockMvcBuilders.standaloneSetup(new EngagementLearnerController(learner))
                    .setControllerAdvice(advices).build();
        }

        private JsonNode submitBody(MockMvc mvc, int expectedStatus) throws Exception {
            MvcResult result = mvc.perform(post("/admin-core-service/engagement/learner/v1/item/i-1/submit")
                            .param("instituteId", INST)
                            .requestAttr("user", user)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andReturn();
            assertEquals(expectedStatus, result.getResponse().getStatus());
            return om.readTree(result.getResponse().getContentAsString());
        }

        @Test
        @DisplayName("a refusal is the old ErrorInfo body, status 510, plus reasonCode")
        void rejectedBodyIsOldBodyPlusReasonCode() throws Exception {
            when(learner.submit(eq("i-1"), eq(INST), eq(USER), any())).thenThrow(
                    new EngagementRejectedException(EngagementRejectedException.READ_GATE,
                            "Finish reading before marking this complete"));
            // Today's shape: the global handler alone, which answers any VacademyException.
            JsonNode before = submitBody(mvc(new GlobalExceptionHandler()), 510);
            JsonNode after = submitBody(mvc(new GlobalExceptionHandler(), new EngagementExceptionAdvice()), 510);

            assertEquals("READ_GATE", after.get("reasonCode").asText());
            ObjectNode stripped = ((ObjectNode) after.deepCopy());
            stripped.remove("reasonCode");
            assertEquals(fieldNames(before), fieldNames(stripped));
            for (String field : List.of("url", "ex", "responseCode")) {
                assertEquals(before.get(field), stripped.get(field), field);
            }
            assertEquals(before.get("date").getNodeType(), stripped.get("date").getNodeType());
            assertEquals("Finish reading before marking this complete", after.get("ex").asText());
            assertEquals("510 NOT_EXTENDED", after.get("responseCode").asText());
        }

        @Test
        @DisplayName("any other exception keeps the global body exactly: no reasonCode")
        void otherErrorsUnchanged() throws Exception {
            when(learner.submit(eq("i-1"), eq(INST), eq(USER), any()))
                    .thenThrow(new VacademyException("Task not found"));

            JsonNode body = submitBody(mvc(new GlobalExceptionHandler(), new EngagementExceptionAdvice()), 510);

            assertFalse(body.has("reasonCode"));
            assertEquals("Task not found", body.get("ex").asText());
        }

        private List<String> fieldNames(JsonNode node) {
            List<String> names = new ArrayList<>();
            for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) names.add(it.next());
            return names;
        }
    }

    // ── fixes from the 2026-09-28 end-to-end pass ───────────────────────────

    @Nested
    @DisplayName("2026-09-28 E2E pass")
    class EndToEndPass {

        @Test
        @DisplayName("a task whose day was removed can't be opened or submitted")
        void deletedDayIsGone() {
            EngagementSlot day = daySlot("gone", TODAY);
            mcq("q", day);
            day.setStatus("DELETED");

            assertThrows(VacademyException.class, () -> service.getItem("q", INST, USER));
            EngagementSubmitRequest req = new EngagementSubmitRequest();
            req.setSelectedOptionId("b");
            assertThrows(VacademyException.class, () -> service.submit("q", INST, USER, req));
        }

        @Test
        @DisplayName("an option id the question doesn't have is refused, not graded as a wrong answer")
        void unknownOptionRefused() {
            mcq("q", daySlot("today", TODAY));
            EngagementSubmitRequest req = new EngagementSubmitRequest();
            req.setSelectedOptionId("zzz");

            EngagementRejectedException ex = assertThrows(EngagementRejectedException.class,
                    () -> service.submit("q", INST, USER, req));
            assertEquals(EngagementRejectedException.ANSWER_REQUIRED, ex.getReasonCode());
        }

        @Test
        @DisplayName("a retried submit after the window closed still answers alreadyCompleted")
        void retryAfterCloseIsIdempotent() {
            EngagementSlot morning = slot("morning", TODAY, null, LocalTime.of(7, 0), LocalTime.of(9, 0));
            EngagementItem q = mcq("q", morning);
            q.setMissPolicy("EXPIRES");
            completed(q, NOW.minusHours(2), "{\"selectedOptionId\":\"b\"}");
            EngagementSubmitRequest req = new EngagementSubmitRequest();
            req.setSelectedOptionId("b");

            EngagementSubmitResponse resp = service.submit("q", INST, USER, req);

            assertTrue(Boolean.TRUE.equals(resp.getAlreadyCompleted()));
        }

        @Test
        @DisplayName("history hides a recurring question's key while a later run is still to come")
        void historyHidesKeyUntilLastRun() {
            // Runs yesterday..tomorrow at 12:00-13:00; it is 10:00, so today's run is ahead.
            EngagementSlot daily = slot("daily", TODAY.minusDays(1), TODAY.plusDays(1),
                    LocalTime.of(12, 0), LocalTime.of(13, 0));
            mcq("q", daily).setMissPolicy("EXPIRES");

            EngagementHistoryDTO history = service.getHistory(INST, USER, 7);

            EngagementItemDTO missed = history.getItems().stream()
                    .filter(d -> "q".equals(d.getId())).findFirst().orElseThrow();
            assertEquals("MISSED", missed.getHistoryStatus());
            assertFalse(missed.getPayloadJson().contains("correctOptionId"), missed.getPayloadJson());
            assertNull(missed.getCorrectOptionId());
        }

        @Test
        @DisplayName("once the last run is over, the missed question's key is shown")
        void historyShowsKeyAfterLastRun() {
            EngagementSlot once = slot("once", TODAY.minusDays(1), null, LocalTime.of(12, 0), LocalTime.of(13, 0));
            mcq("q", once).setMissPolicy("EXPIRES");

            EngagementHistoryDTO history = service.getHistory(INST, USER, 7);

            EngagementItemDTO missed = history.getItems().stream()
                    .filter(d -> "q".equals(d.getId())).findFirst().orElseThrow();
            assertTrue(missed.getPayloadJson().contains("correctOptionId"), missed.getPayloadJson());
        }
    }
}
