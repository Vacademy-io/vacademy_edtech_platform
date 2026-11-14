package vacademy.io.admin_core_service.features.engagement;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.engagement.controller.EngagementAdminController;
import vacademy.io.admin_core_service.features.engagement.controller.EngagementInsightController;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementTrackingDTO;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAttempt;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAttemptRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementItemRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementSlotRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementPlanService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver;
import vacademy.io.admin_core_service.features.engagement.service.EngagementSettingsService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTrackingService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTrackingService.OverviewQuery;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Teacher insight: the item CSV (opened in Excel by teachers, with learner-typed names in
 * it), item tracking filters and counters, flashcard card stats, the plan overview and
 * its CSV, and the routing that lets the new filters share the original paths.
 */
class EngagementTrackingServiceTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private EngagementItemRepository items;
    private EngagementSlotRepository slots;
    private EngagementPlanRepository plans;
    private EngagementAttemptRepository attempts;
    private AuthService auth;
    private StudentSessionInstituteGroupMappingRepository enrollment;
    private EngagementSettingsService settings;
    private EngagementTrackingService service;

    @BeforeEach
    void setUp() {
        items = mock(EngagementItemRepository.class);
        slots = mock(EngagementSlotRepository.class);
        plans = mock(EngagementPlanRepository.class);
        attempts = mock(EngagementAttemptRepository.class);
        auth = mock(AuthService.class);
        enrollment = mock(StudentSessionInstituteGroupMappingRepository.class);
        settings = mock(EngagementSettingsService.class);
        when(settings.getDailyItemCap(anyString())).thenReturn(5);
        service = new EngagementTrackingService(items, slots, plans, attempts, auth,
                new EngagementScheduleResolver(), enrollment, new ObjectMapper(), settings);
    }

    // ── fixtures ─────────────────────────────────────────────────────────────

    private static EngagementPlan plan() {
        EngagementPlan plan = new EngagementPlan();
        plan.setId("plan-1");
        plan.setInstituteId("inst-1");
        plan.setPackageSessionId("ps-1");
        plan.setTitle("Plan");
        plan.setTimezone("Asia/Kolkata");
        return plan;
    }

    private static EngagementSlot slot(String id, LocalDate day, int sortOrder) {
        EngagementSlot slot = new EngagementSlot();
        slot.setId(id);
        slot.setPlanId("plan-1");
        slot.setStartDate(day);
        slot.setStartTime(LocalTime.of(6, 0));
        slot.setEndTime(LocalTime.of(20, 0));
        slot.setSortOrder(sortOrder);
        return slot;
    }

    private static EngagementItem item(String id, String slotId, String type, boolean required, int sortOrder) {
        EngagementItem item = new EngagementItem();
        item.setId(id);
        item.setSlotId(slotId);
        item.setItemType(type);
        item.setTitle("Task " + id);
        item.setIsRequired(required);
        item.setSortOrder(sortOrder);
        return item;
    }

    private static UserDTO user(String id, String name) {
        UserDTO u = new UserDTO();
        u.setId(id);
        u.setFullName(name);
        u.setUsername(id);
        u.setEmail(id + "@x.io");
        return u;
    }

    private static Timestamp at(String isoLocal) {
        return Timestamp.from(java.time.LocalDateTime.parse(isoLocal).atZone(IST).toInstant());
    }

    private static Object[] progress(String itemId, String userId, String status, Timestamp completedAt) {
        return new Object[] {itemId, userId, status, false, null, "COMPLETED".equals(status) ? 10 : 0, completedAt};
    }

    private void wireItem(EngagementItem item, EngagementSlot slot, EngagementPlan plan) {
        when(items.findById(item.getId())).thenReturn(Optional.of(item));
        when(slots.findById(slot.getId())).thenReturn(Optional.of(slot));
        when(plans.findById(plan.getId())).thenReturn(Optional.of(plan));
    }

    // ── csvCell ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("csvCell quotes plain values and doubles embedded quotes")
    void quotesPlainValues() {
        assertEquals("\"Asha\"", EngagementTrackingService.csvCell("Asha"));
        assertEquals("\"Rao, Asha\"", EngagementTrackingService.csvCell("Rao, Asha"));
        assertEquals("\"say \"\"hi\"\"\"", EngagementTrackingService.csvCell("say \"hi\""));
    }

    @Test
    @DisplayName("csvCell writes null and empty as an empty cell")
    void nullAndEmpty() {
        assertEquals("", EngagementTrackingService.csvCell(null));
        assertEquals("", EngagementTrackingService.csvCell(""));
    }

    @Test
    @DisplayName("csvCell prefixes an apostrophe to every formula trigger")
    void neutralisesFormulaTriggers() {
        assertEquals("\"'=1+1\"", EngagementTrackingService.csvCell("=1+1"));
        assertEquals("\"'+91 98765\"", EngagementTrackingService.csvCell("+91 98765"));
        assertEquals("\"'-2+3\"", EngagementTrackingService.csvCell("-2+3"));
        assertEquals("\"'@SUM(A1)\"", EngagementTrackingService.csvCell("@SUM(A1)"));
        assertEquals("\"'\tcmd\"", EngagementTrackingService.csvCell("\tcmd"));
        assertEquals("\"'\rcmd\"", EngagementTrackingService.csvCell("\rcmd"));
        // The quote-doubling still applies after the prefix.
        assertEquals("\"'=HYPERLINK(\"\"x\"\")\"",
                EngagementTrackingService.csvCell("=HYPERLINK(\"x\")"));
    }

    @Test
    @DisplayName("csvCell leaves a trigger character alone when it is not the first character")
    void triggerMidValueIsFine() {
        assertEquals("\"a=b\"", EngagementTrackingService.csvCell("a=b"));
        assertEquals("\"नमस्ते\"", EngagementTrackingService.csvCell("नमस्ते"));
    }

    // ── item CSV ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("exportItemCsv starts with a UTF-8 BOM and escapes a formula-shaped name")
    void exportHasBomAndEscapedCells() {
        EngagementItem item = item("item-1", "slot-1", "QUESTION_OF_DAY", true, 0);
        item.setPayloadJson("{\"options\":[{\"id\":\"a\",\"text\":\"Activity limitation\"},{\"id\":\"b\",\"text\":\"=cmd\"}]}");
        wireItem(item, slot("slot-1", LocalDate.of(2026, 9, 24), 0), plan());

        EngagementAttempt attempt = new EngagementAttempt();
        attempt.setUserId("u-1");
        attempt.setItemId("item-1");
        attempt.setStatus("COMPLETED");
        attempt.setResponseJson("{\"textAnswer\":\"@cmd\",\"selectedOptionId\":\"a\"}");
        attempt.setStartedAt(at("2026-09-24T10:00:00"));
        attempt.setCompletedAt(at("2026-09-24T10:01:30"));
        when(attempts.findByItem("item-1")).thenReturn(List.of(attempt));

        UserDTO user = user("u-1", "=1+1");
        user.setUsername("asha");
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(user));

        String csv = service.exportItemCsv("item-1", "inst-1");
        byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF},
                new byte[] {bytes[0], bytes[1], bytes[2]});

        String[] lines = csv.substring(1).split("\n");
        assertTrue(lines[0].startsWith("Name,Username,Email"));
        assertTrue(lines[0].contains("Selected option,Known (first pass),Cards,Still learning (fronts),Task,Type"),
                lines[0]);
        assertTrue(lines[1].startsWith("\"'=1+1\",\"asha\","), lines[1]);
        assertTrue(lines[1].contains(",\"'@cmd\","), lines[1]);
        // Server time since first open (90 s), and the option TEXT, not its id.
        assertTrue(lines[1].contains(",90,"), lines[1]);
        assertTrue(lines[1].contains(",\"Activity limitation\","), lines[1]);
        assertTrue(lines[1].contains(",\"2026-09-24\","), lines[1]);
    }

    @Test
    @DisplayName("exportItemCsv writes flashcards Known, Cards and the fronts still being learned")
    void exportFlashcardsColumns() {
        EngagementItem item = item("fc-1", "slot-1", "FLASHCARDS", true, 0);
        item.setMaxScore(3);
        item.setPayloadJson("{\"schema\":\"flashcards/v1\",\"cards\":[{\"id\":\"c1\",\"front\":\"F1\",\"back\":\"B1\"},"
                + "{\"id\":\"c2\",\"front\":\"F2\",\"back\":\"B2\"},{\"id\":\"c3\",\"front\":\"-F3\",\"back\":\"B3\"}]}");
        wireItem(item, slot("slot-1", LocalDate.of(2026, 9, 24), 0), plan());

        EngagementAttempt attempt = new EngagementAttempt();
        attempt.setUserId("u-1");
        attempt.setItemId("fc-1");
        attempt.setStatus("COMPLETED");
        attempt.setScore(BigDecimal.valueOf(1));
        attempt.setResponseJson("{\"flashcards\":{\"version\":1,\"total\":3,\"known\":1,\"outcomes\":["
                + "{\"cardId\":\"c1\",\"result\":\"KNOWN\"},{\"cardId\":\"c2\",\"result\":\"LEARNING\"},"
                + "{\"cardId\":\"c3\",\"result\":\"LEARNING\"}]}}");
        when(attempts.findByItem("fc-1")).thenReturn(List.of(attempt));
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(user("u-1", "Asha")));

        String[] lines = service.exportItemCsv("fc-1", "inst-1").substring(1).split("\n");
        // Known 1, Cards 3, the fronts still being learned joined by " | " (a mid-cell "-" is not a formula).
        assertTrue(lines[1].contains(",1,3,\"F2 | -F3\","), lines[1]);
    }

    // ── item tracking ────────────────────────────────────────────────────────

    private EngagementItem pollFixture() {
        EngagementItem item = item("poll-1", "slot-1", "POLL", false, 0);
        item.setPayloadJson("{\"prompt\":\"?\",\"options\":[{\"id\":\"a\",\"text\":\"A\"},"
                + "{\"id\":\"b\",\"text\":\"B\"},{\"id\":\"c\",\"text\":\"C\"}]}");
        wireItem(item, slot("slot-1", LocalDate.of(2026, 9, 24), 0), plan());
        when(enrollment.findDistinctUserIdsByPackageSessionAndStatus(eq("ps-1"), anyList()))
                .thenReturn(List.of("u1", "u2", "u3", "u4"));
        when(attempts.findUserStatusesByItem("poll-1")).thenReturn(List.of(
                new Object[] {"u1", "COMPLETED", true, null},
                new Object[] {"u2", "STARTED", false, null}));
        List<Object[]> picks = new ArrayList<>();
        picks.add(new Object[] {"b", 1L});
        when(attempts.countByOption("poll-1")).thenReturn(picks);
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(
                user("u1", "Uma"), user("u2", "Ravi"), user("u3", "Zed"), user("u4", "Amy")));
        return item;
    }

    private EngagementAttempt attempt(String userId, String itemId, String status) {
        EngagementAttempt a = new EngagementAttempt();
        a.setUserId(userId);
        a.setItemId(itemId);
        a.setStatus(status);
        return a;
    }

    @Test
    @DisplayName("NOT_DONE synthesizes a row for every enrolled learner who never opened the task")
    void notDoneRowsAreSynthesized() {
        pollFixture();
        EngagementTrackingDTO dto = service.getItemTracking("poll-1", "inst-1", "not_done", 0, 20);

        assertEquals("NOT_DONE", dto.getStatus());
        assertEquals(4L, dto.getEnrolledCount());
        assertEquals(1L, dto.getCompletedCount());
        assertEquals(1L, dto.getStartedCount());
        assertEquals(2L, dto.getNotDoneCount());
        assertEquals(1L, dto.getLateCount());
        assertEquals(2, dto.getRows().size());
        // Alphabetical: Amy before Zed.
        assertEquals("u4", dto.getRows().get(0).getUserId());
        assertEquals("NOT_STARTED", dto.getRows().get(0).getStatus());
        assertEquals(0, dto.getRows().get(0).getPointsAwarded());
        assertEquals("u3", dto.getRows().get(1).getUserId());
        assertEquals(2L, dto.getTotalRows());
        verify(attempts, never()).findPageByItem(anyString(), any(Pageable.class));
    }

    @Test
    @DisplayName("optionCounts lists every authored option in order, including the ones nobody picked")
    void optionCountsIncludeZeroes() {
        pollFixture();
        when(attempts.findPageByItem(eq("poll-1"), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));
        EngagementTrackingDTO dto = service.getItemTracking("poll-1", "inst-1", 0, 20);

        assertNull(dto.getStatus());
        List<EngagementTrackingDTO.OptionCount> counts = dto.getOptionCounts();
        assertEquals(3, counts.size());
        assertEquals("a", counts.get(0).getOptionId());
        assertEquals(0L, counts.get(0).getCount());
        assertEquals("b", counts.get(1).getOptionId());
        assertEquals(1L, counts.get(1).getCount());
        assertEquals(0L, counts.get(2).getCount());
    }

    @Test
    @DisplayName("ALL is every attempt followed by the never-opened learners, paged in memory")
    void allCombinesAttemptsAndNotStarted() {
        pollFixture();
        when(attempts.findByItem("poll-1")).thenReturn(List.of(
                attempt("u1", "poll-1", "COMPLETED"), attempt("u2", "poll-1", "STARTED")));

        EngagementTrackingDTO first = service.getItemTracking("poll-1", "inst-1", "ALL", 0, 3);
        assertEquals(4L, first.getTotalRows());
        assertEquals(2, first.getTotalPages());
        assertEquals(List.of("u1", "u2", "u4"), first.getRows().stream().map(EngagementTrackingDTO.Row::getUserId).toList());

        EngagementTrackingDTO second = service.getItemTracking("poll-1", "inst-1", "ALL", 1, 3);
        assertEquals(List.of("u3"), second.getRows().stream().map(EngagementTrackingDTO.Row::getUserId).toList());
    }

    @Test
    @DisplayName("ALL never lists a SKIPPED learner twice; NOT_DONE shows them with their own status")
    void skippedLearnerListedOnce() {
        pollFixture();
        when(attempts.findUserStatusesByItem("poll-1")).thenReturn(List.of(
                new Object[] {"u1", "COMPLETED", false, null},
                new Object[] {"u3", "SKIPPED", false, null}));
        when(attempts.findByItem("poll-1")).thenReturn(List.of(
                attempt("u1", "poll-1", "COMPLETED"), attempt("u3", "poll-1", "SKIPPED")));

        EngagementTrackingDTO all = service.getItemTracking("poll-1", "inst-1", "ALL", 0, 20);
        List<String> ids = all.getRows().stream().map(EngagementTrackingDTO.Row::getUserId).toList();
        assertEquals(List.of("u1", "u3", "u4", "u2"), ids);
        assertEquals(4L, all.getTotalRows());

        EngagementTrackingDTO notDone = service.getItemTracking("poll-1", "inst-1", "NOT_DONE", 0, 20);
        assertEquals(3L, notDone.getNotDoneCount());
        EngagementTrackingDTO.Row zed = notDone.getRows().stream()
                .filter(r -> "u3".equals(r.getUserId())).findFirst().orElseThrow();
        assertEquals("SKIPPED", zed.getStatus());
    }

    @Test
    @DisplayName("A huge page number returns an empty page instead of overflowing")
    void hugePageIsEmpty() {
        pollFixture();
        EngagementTrackingDTO dto = service.getItemTracking("poll-1", "inst-1", "NOT_DONE", Integer.MAX_VALUE, 200);
        assertTrue(dto.getRows().isEmpty());
        assertEquals(2L, dto.getTotalRows());
        assertEquals(0, EngagementTrackingService.sliceStart(0, Integer.MAX_VALUE, Integer.MAX_VALUE));
    }

    @Test
    @DisplayName("A TEXT question of the day with no options and no picks has no optionCounts")
    void textQuestionHasNoOptionCounts() {
        EngagementItem item = item("q-1", "slot-1", "QUESTION_OF_DAY", true, 0);
        item.setPayloadJson("{\"format\":\"TEXT\",\"prompt\":\"Why?\"}");
        wireItem(item, slot("slot-1", LocalDate.of(2026, 9, 24), 0), plan());
        when(attempts.findPageByItem(eq("q-1"), any(Pageable.class))).thenReturn(new PageImpl<>(List.of()));
        assertNull(service.getItemTracking("q-1", "inst-1", 0, 20).getOptionCounts());
    }

    @Test
    @DisplayName("DONE pages COMPLETED attempts in SQL")
    void donePagesInSql() {
        pollFixture();
        when(attempts.findPageByItemAndStatus(eq("poll-1"), eq("COMPLETED"), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(attempt("u1", "poll-1", "COMPLETED"))));
        EngagementTrackingDTO dto = service.getItemTracking("poll-1", "inst-1", "DONE", 0, 20);
        assertEquals(1, dto.getRows().size());
        assertEquals("Uma", dto.getRows().get(0).getFullName());
    }

    @Test
    @DisplayName("An unknown status filter is rejected rather than silently ignored")
    void unknownStatusRejected() {
        pollFixture();
        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class,
                () -> service.getItemTracking("poll-1", "inst-1", "WHATEVER", 0, 20));
    }

    @Test
    @DisplayName("Rows carry maxScore, startedAt, server time and the flashcards outcome")
    void rowCarriesServerTimeAndFlashcards() {
        EngagementItem item = item("fc-1", "slot-1", "FLASHCARDS", true, 0);
        item.setMaxScore(3);
        wireItem(item, slot("slot-1", LocalDate.of(2026, 9, 24), 0), plan());
        EngagementAttempt a = attempt("u1", "fc-1", "COMPLETED");
        a.setStartedAt(at("2026-09-24T10:00:00"));
        a.setCompletedAt(at("2026-09-24T10:00:42"));
        a.setResponseJson("{\"flashcards\":{\"version\":1,\"total\":3,\"known\":2,\"outcomes\":["
                + "{\"cardId\":\"c1\",\"result\":\"KNOWN\"},{\"cardId\":\"c2\",\"result\":\"KNOWN\"},"
                + "{\"cardId\":\"c3\",\"result\":\"LEARNING\"}]}}");
        when(attempts.findPageByItem(eq("fc-1"), any(Pageable.class))).thenReturn(new PageImpl<>(List.of(a)));

        EngagementTrackingDTO dto = service.getItemTracking("fc-1", "inst-1", 0, 20);
        EngagementTrackingDTO.Row row = dto.getRows().get(0);
        assertEquals(3.0, row.getMaxScore());
        assertEquals(42_000L, row.getServerTimeMs());
        assertEquals(2, row.getFlashcardsKnown());
        assertEquals(3, row.getFlashcardsTotal());
        assertEquals(List.of("c3"), row.getLearningCardIds());
        assertEquals(a.getStartedAt().toInstant().toString(), row.getStartedAt());
        assertNull(dto.getOptionCounts());
    }

    // ── card stats ───────────────────────────────────────────────────────────

    @Test
    @DisplayName("Card stats come back in deck order; outcomes on removed cards are summed separately")
    void cardStats() {
        EngagementItem item = item("fc-1", "slot-1", "FLASHCARDS", true, 0);
        item.setVersion(2);
        item.setPayloadJson("{\"schema\":\"flashcards/v1\",\"cards\":[{\"id\":\"c1\",\"front\":\"F1\",\"back\":\"B1\"},"
                + "{\"id\":\"c2\",\"front\":\"F2\",\"back\":\"B2\"},{\"id\":\"c3\",\"front\":\"F3\",\"back\":\"B3\"}]}");
        wireItem(item, slot("slot-1", LocalDate.of(2026, 9, 24), 0), plan());
        when(attempts.countCompletedForItem("fc-1")).thenReturn(4L);
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[] {"c2", 4L, 1L});
        rows.add(new Object[] {"c1", 4L, 3L});
        rows.add(new Object[] {"gone", 2L, 2L});
        when(attempts.countFlashcardOutcomes("fc-1")).thenReturn(rows);

        EngagementTrackingDTO.CardStats stats = service.getCardStats("fc-1", "inst-1");
        assertEquals(2, stats.getVersion());
        assertEquals(4L, stats.getCompletedCount());
        assertEquals(2L, stats.getRemovedOutcomes());
        assertEquals(List.of("c1", "c2", "c3"),
                stats.getCards().stream().map(EngagementTrackingDTO.CardStat::getCardId).toList());
        EngagementTrackingDTO.CardStat c2 = stats.getCards().get(1);
        assertEquals("F2", c2.getFront());
        assertEquals(4L, c2.getStudied());
        assertEquals(1L, c2.getGotIt());
        assertEquals(3L, c2.getStillLearning());
        assertEquals(0.75, c2.getStillLearningRate(), 1e-9);
        assertEquals(0L, stats.getCards().get(2).getStudied());
        assertEquals(0.0, stats.getCards().get(2).getStillLearningRate(), 1e-9);
    }

    @Test
    @DisplayName("Card stats for a non-flashcards item are empty, with no outcome query")
    void cardStatsForOtherTypes() {
        EngagementItem item = item("poll-1", "slot-1", "POLL", false, 0);
        wireItem(item, slot("slot-1", LocalDate.of(2026, 9, 24), 0), plan());
        EngagementTrackingDTO.CardStats stats = service.getCardStats("poll-1", "inst-1");
        assertTrue(stats.getCards().isEmpty());
        verify(attempts, never()).countFlashcardOutcomes(anyString());
    }

    // ── plan overview ────────────────────────────────────────────────────────

    /**
     * Today is Fri 25 Sep 2026, noon IST. Wed 23: i1 (required) + i2. Thu 24: i3.
     * Fri 25: i4 (open now). Sat 26: i5 (upcoming). All EXPIRES, so past days are CLOSED.
     * u1 did i1 on Wed and i4 today; u2 only opened i3; u3 is not enrolled.
     */
    private ZonedDateTime overviewFixture() {
        EngagementSlot wed = slot("s-wed", LocalDate.of(2026, 9, 23), 0);
        EngagementSlot thu = slot("s-thu", LocalDate.of(2026, 9, 24), 0);
        EngagementSlot fri = slot("s-fri", LocalDate.of(2026, 9, 25), 0);
        EngagementSlot sat = slot("s-sat", LocalDate.of(2026, 9, 26), 0);
        when(slots.findActiveByPlan("plan-1")).thenReturn(List.of(wed, thu, fri, sat));
        when(items.findActiveBySlots(anyList())).thenReturn(List.of(
                item("i1", "s-wed", "QUESTION_OF_DAY", true, 0),
                item("i2", "s-wed", "READING_HTML", false, 1),
                item("i3", "s-thu", "POLL", false, 0),
                item("i4", "s-fri", "GAME", false, 0),
                item("i5", "s-sat", "READING_HTML", false, 0),
                item("q1", "s-fri", "QUIZ", false, 1)));
        when(enrollment.findDistinctUserIdsByPackageSessionAndStatus(eq("ps-1"), anyList()))
                .thenReturn(List.of("u1", "u2"));
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(
                user("u1", "Deepa"), user("u2", "Deepankar Dey")));
        List<Object[]> rows = new ArrayList<>();
        rows.add(progress("i1", "u1", "COMPLETED", at("2026-09-23T10:00:00")));
        rows.add(progress("i4", "u1", "COMPLETED", at("2026-09-25T09:00:00")));
        rows.add(progress("i3", "u2", "STARTED", null));
        rows.add(progress("i1", "u3", "COMPLETED", at("2026-09-23T11:00:00")));
        when(attempts.findProgressRowsForItems(anyList())).thenReturn(rows);
        return ZonedDateTime.of(2026, 9, 25, 12, 0, 0, 0, IST);
    }

    @Test
    @DisplayName("Overview: the learner with nothing done comes first as NOT_STARTED")
    void overviewClassifiesAndSorts() {
        ZonedDateTime now = overviewFixture();
        EngagementTrackingDTO.PlanOverview o = service.getPlanOverview(plan(), OverviewQuery.ALL, now);

        assertEquals(5, o.getTasksTotal());          // the QUIZ is not a learner task
        assertEquals(3, o.getTasksClosed());
        assertEquals(4L, o.getTasksOpened());
        assertEquals(3L, o.getTasksPastDue());
        assertEquals(2, o.getLearners());
        assertEquals(1, o.getLearnersActive());
        assertEquals(1L, o.getNotStarted());
        assertEquals(0L, o.getBehind());
        assertEquals(1L, o.getOnTrack());
        assertEquals(1, o.getLearnersSlipping());
        assertEquals("2026-09-25", o.getToday());
        assertNull(o.getPage());

        EngagementTrackingDTO.LearnerProgress first = o.getRows().get(0);
        assertEquals("u2", first.getUserId());
        assertEquals("NOT_STARTED", first.getLearnerClass());
        assertEquals(0L, first.getDone());
        assertEquals(4L, first.getAvailable());
        assertEquals(3L, first.getOverdue());
        assertEquals(3L, first.getMissed());

        EngagementTrackingDTO.LearnerProgress second = o.getRows().get(1);
        assertEquals("u1", second.getUserId());
        assertEquals("ON_TRACK", second.getLearnerClass());
        assertEquals(2L, second.getDone());
        assertEquals(2L, second.getCompleted());
        assertEquals(4L, second.getAvailable());
        assertEquals(2L, second.getMissed());
        assertEquals(20L, second.getPointsEarned());
    }

    @Test
    @DisplayName("Overview: a learner who joined Thursday is not charged with Wednesday's tasks")
    void overviewLateJoinerNotCharged() {
        ZonedDateTime now = overviewFixture();
        List<Object[]> joins = new ArrayList<>();
        joins.add(new Object[] {"u2", Timestamp.from(ZonedDateTime.of(2026, 9, 24, 9, 0, 0, 0, IST).toInstant())});
        when(plans.findJoinDatesForBatch("ps-1")).thenReturn(joins);

        EngagementTrackingDTO.LearnerProgress u2 = service.getPlanOverview(plan(), OverviewQuery.ALL, now)
                .getRows().stream().filter(r -> "u2".equals(r.getUserId())).findFirst().orElseThrow();

        assertEquals(2L, u2.getAvailable()); // Thu i3 + Fri i4, not Wed's i1/i2
        assertEquals(1L, u2.getMissed());    // Thu i3 only
    }

    @Test
    @DisplayName("Overview days[]: completions filed under their day, today counted once it opened")
    void overviewDays() {
        ZonedDateTime now = overviewFixture();
        List<EngagementTrackingDTO.Day> days = service.getPlanOverview(plan(), OverviewQuery.ALL, now).getDays();
        assertEquals(List.of("2026-09-23", "2026-09-24", "2026-09-25"),
                days.stream().map(EngagementTrackingDTO.Day::getDate).toList());
        EngagementTrackingDTO.Day wed = days.get(0);
        assertEquals(2, wed.getTasks());
        assertEquals(4, wed.getAvailable());
        assertEquals(1, wed.getCompleted());   // u3 is not enrolled
        assertEquals(0.25, wed.getRate(), 1e-9);
        assertEquals(0.0, days.get(1).getRate(), 1e-9);
        assertEquals(0.5, days.get(2).getRate(), 1e-9);
    }

    @Test
    @DisplayName("Overview tasks[]: schedule order, the upcoming task carries its next run date")
    void overviewTasks() {
        ZonedDateTime now = overviewFixture();
        List<EngagementTrackingDTO.TaskProgress> tasks =
                service.getPlanOverview(plan(), OverviewQuery.ALL, now).getTasks();
        assertEquals(List.of("i1", "i2", "i3", "i4", "i5"),
                tasks.stream().map(EngagementTrackingDTO.TaskProgress::getItemId).toList());
        assertEquals("CLOSED", tasks.get(0).getState());
        assertEquals(1L, tasks.get(0).getCompleted());
        assertEquals(0.5, tasks.get(0).getRate(), 1e-9);
        assertEquals(1L, tasks.get(2).getStarted());
        assertEquals("OPEN", tasks.get(3).getState());
        assertEquals("UPCOMING", tasks.get(4).getState());
        assertEquals("2026-09-26", tasks.get(4).getRunDate());
    }

    @Test
    @DisplayName("A task hidden by the daily cap is not counted as missed")
    void capHiddenIsNotMissed() {
        when(settings.getDailyItemCap(anyString())).thenReturn(1);
        ZonedDateTime now = overviewFixture();
        EngagementTrackingDTO.PlanOverview o = service.getPlanOverview(plan(), OverviewQuery.ALL, now);

        assertEquals(1, o.getDailyItemCap());
        assertEquals(1L, o.getTasksCapHidden());
        EngagementTrackingDTO.LearnerProgress u2 = o.getRows().get(0);
        assertEquals("u2", u2.getUserId());
        assertEquals(2L, u2.getMissed());       // i1 and i3; i2 was never shown
        assertEquals(3L, u2.getAvailable());
        assertTrue(o.getTasks().get(1).isCapHidden());
        assertFalse(o.getTasks().get(0).isCapHidden());
        assertEquals(1, o.getDays().get(0).getTasks());
    }

    @Test
    @DisplayName("Overview paging, search and needsAttention filter rows but not the tiles")
    void overviewPagingAndSearch() {
        ZonedDateTime now = overviewFixture();
        EngagementTrackingDTO.PlanOverview attention =
                service.getPlanOverview(plan(), new OverviewQuery(0, 10, null, true), now);
        assertEquals(1, attention.getRows().size());
        assertEquals("u2", attention.getRows().get(0).getUserId());
        assertEquals(1L, attention.getTotalRows());
        assertEquals(1L, attention.getOnTrack());

        EngagementTrackingDTO.PlanOverview search =
                service.getPlanOverview(plan(), new OverviewQuery(0, 10, "  DEEPA ", false), now);
        assertEquals(2, search.getRows().size());
        EngagementTrackingDTO.PlanOverview byEmail =
                service.getPlanOverview(plan(), new OverviewQuery(0, 10, "u1@x", false), now);
        assertEquals(List.of("u1"), byEmail.getRows().stream()
                .map(EngagementTrackingDTO.LearnerProgress::getUserId).toList());

        EngagementTrackingDTO.PlanOverview page1 =
                service.getPlanOverview(plan(), new OverviewQuery(1, 1, null, false), now);
        assertEquals(1, page1.getPage());
        assertEquals(1, page1.getPageSize());
        assertEquals(2L, page1.getTotalRows());
        assertEquals(2, page1.getTotalPages());
        assertEquals("u1", page1.getRows().get(0).getUserId());
    }

    @Test
    @DisplayName("LearnerProgress serialises its class as \"class\"")
    void learnerClassJsonName() throws Exception {
        EngagementTrackingDTO.LearnerProgress p =
                new EngagementTrackingDTO.LearnerProgress("u", "n", "n", 0, 0, 0, 0, null);
        p.setLearnerClass("BEHIND");
        JsonNode json = new ObjectMapper().valueToTree(p);
        assertEquals("BEHIND", json.get("class").asText());
        assertFalse(json.has("learnerClass"));
    }

    @Test
    @DisplayName("Plan CSV: BOM, one row per enrolled learner, one column per task")
    void planCsv() {
        ZonedDateTime now = overviewFixture();
        String csv = service.exportPlanCsv(plan(), now);
        assertTrue(csv.startsWith(EngagementTrackingService.CSV_BOM));
        String[] lines = csv.substring(1).split("\n");
        assertEquals(3, lines.length);
        assertTrue(lines[0].startsWith("Name,Username,Email,Progress,Done,Available,Overdue,Missed,Points"));
        assertTrue(lines[0].contains("\"2026-09-23 · Task i1\""), lines[0]);
        assertTrue(lines[0].endsWith("\"2026-09-26 · Task i5\""), lines[0]);
        // u2 first: Not started, then cells for i1..i5.
        assertTrue(lines[1].startsWith("\"Deepankar Dey\",\"u2\",\"u2@x.io\",\"Not started\",0,4,3,3,0,"),
                lines[1]);
        assertTrue(lines[1].endsWith("\"Missed\",\"Missed\",\"Missed\",\"Not done\",\"Not open yet\""), lines[1]);
        assertTrue(lines[2].endsWith("\"Done\",\"Missed\",\"Missed\",\"Done\",\"Not open yet\""), lines[2]);
    }

    @Test
    @DisplayName("classify: nothing done, under half, at least half")
    void classify() {
        assertEquals("NOT_STARTED", EngagementTrackingService.classify(0, 0));
        assertEquals("NOT_STARTED", EngagementTrackingService.classify(0, 5));
        assertEquals("BEHIND", EngagementTrackingService.classify(2, 5));
        assertEquals("ON_TRACK", EngagementTrackingService.classify(3, 6));
        assertEquals("ON_TRACK", EngagementTrackingService.classify(1, 0));
    }

    // ── routing ──────────────────────────────────────────────────────────────

    /**
     * The new filters share the original paths with EngagementAdminController. A params
     * condition picks the handler: without the new params the original answers, with
     * them the insight controller does, and no two insight variants match one request.
     */
    @Nested
    class Routing {
        private EngagementTrackingService tracking;
        private InstituteAccessValidator validator;
        private MockMvc mvc;
        private CustomUserDetails user;

        @BeforeEach
        void mvc() {
            tracking = mock(EngagementTrackingService.class);
            validator = mock(InstituteAccessValidator.class);
            user = mock(CustomUserDetails.class);
            mvc = MockMvcBuilders.standaloneSetup(
                    new EngagementAdminController(mock(EngagementPlanService.class), tracking, validator),
                    new EngagementInsightController(tracking, validator)).build();
        }

        @Test
        @DisplayName("tracking without status stays on the original handler")
        void legacyTracking() throws Exception {
            mvc.perform(get("/admin-core-service/engagement/admin/v1/item/i1/tracking")
                            .param("instituteId", "inst").requestAttr("user", user))
                    .andExpect(status().isOk());
            verify(tracking).getItemTracking("i1", "inst", 0, 20);
            verify(tracking, never()).getItemTracking(anyString(), anyString(), anyString(), anyInt(), anyInt());
        }

        @Test
        @DisplayName("tracking with status goes to the insight handler, with the staff check")
        void filteredTracking() throws Exception {
            mvc.perform(get("/admin-core-service/engagement/admin/v1/item/i1/tracking")
                            .param("instituteId", "inst").param("status", "NOT_DONE")
                            .param("page", "2").requestAttr("user", user))
                    .andExpect(status().isOk());
            verify(tracking).getItemTracking("i1", "inst", "NOT_DONE", 2, 20);
            verify(validator).requireStaffAccess(user, "inst");
        }

        @Test
        @DisplayName("overview without params stays on the original handler")
        void legacyOverview() throws Exception {
            mvc.perform(get("/admin-core-service/engagement/admin/v1/plan/p1/overview")
                            .param("instituteId", "inst").requestAttr("user", user))
                    .andExpect(status().isOk());
            verify(tracking).getPlanOverview("p1", "inst");
            verify(tracking, never()).getPlanOverview(anyString(), anyString(), any(OverviewQuery.class));
        }

        @Test
        @DisplayName("every combination of overview params reaches exactly one insight handler")
        void pagedOverview() throws Exception {
            String[][] combos = {
                    {"page", "1"}, {"size", "5"}, {"q", "dee"}, {"needsAttention", "true"},
                    {"page", "0", "size", "5", "q", "x", "needsAttention", "true"},
                    {"size", "5", "q", "x"}, {"q", "x", "needsAttention", "true"},
                    {"size", "5", "needsAttention", "true"}};
            for (String[] combo : combos) {
                var request = get("/admin-core-service/engagement/admin/v1/plan/p1/overview")
                        .param("instituteId", "inst").requestAttr("user", user);
                for (int i = 0; i < combo.length; i += 2) request.param(combo[i], combo[i + 1]);
                mvc.perform(request).andExpect(status().isOk());
            }
            verify(tracking, org.mockito.Mockito.times(combos.length))
                    .getPlanOverview(eq("p1"), eq("inst"), any(OverviewQuery.class));
            verify(tracking).getPlanOverview("p1", "inst", new OverviewQuery(1, null, null, false));
            verify(tracking).getPlanOverview("p1", "inst", new OverviewQuery(0, null, null, true));
            verify(tracking, never()).getPlanOverview("p1", "inst");
        }

        @Test
        @DisplayName("card stats and plan export are reachable")
        void newPaths() throws Exception {
            when(tracking.exportPlanCsv("p1", "inst")).thenReturn(EngagementTrackingService.CSV_BOM + "Name\n");
            mvc.perform(get("/admin-core-service/engagement/admin/v1/item/i1/tracking/cards")
                            .param("instituteId", "inst").requestAttr("user", user))
                    .andExpect(status().isOk());
            mvc.perform(get("/admin-core-service/engagement/admin/v1/plan/p1/overview/export")
                            .param("instituteId", "inst").requestAttr("user", user))
                    .andExpect(status().isOk());
            verify(tracking).getCardStats("i1", "inst");
            verify(tracking).exportPlanCsv("p1", "inst");
        }
    }
}
