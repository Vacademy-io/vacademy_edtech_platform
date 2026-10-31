package vacademy.io.admin_core_service.features.engagement;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementPlanDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSlotRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAttemptRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementItemRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementSlotRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementPlanService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver;
import vacademy.io.admin_core_service.features.engagement.service.FlashcardsPayloadValidator;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Authoring through EngagementPlanService with in-memory repositories: what a save
 * actually writes (flashcards spec B7, EngagementPlanServiceTest), plus the batched
 * plan list / plan view summary.
 */
class EngagementPlanServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PS = "ps-1";
    private static final String PLAN = "plan-1";
    private static final String SLOT = "slot-1";

    private static final String DECK =
            "{\"schema\":\"flashcards/v1\",\"cards\":["
                    + "{\"id\":\"c_1\",\"front\":\"Impairment\",\"back\":\"A problem in body function\",\"hint\":\"Body level\"},"
                    + "{\"id\":\"c_2\",\"front\":\"2 < x > 1\",\"back\":\"<b>x</b>\"},"
                    + "{\"id\":\"c_3\",\"front\":\"Three\",\"back\":\"3\"}],"
                    + "\"settings\":{\"shuffle\":true}}";
    /** DECK as jsonb hands it back: keys reordered, whitespace changed. */
    private static final String DECK_REORDERED =
            "{ \"settings\": {\"shuffle\": true}, \"schema\": \"flashcards/v1\", \"cards\": ["
                    + "{\"hint\": \"Body level\", \"back\": \"A problem in body function\", \"front\": \"Impairment\", \"id\": \"c_1\"},"
                    + "{\"back\": \"<b>x</b>\", \"id\": \"c_2\", \"front\": \"2 < x > 1\"},"
                    + "{\"front\": \"Three\", \"back\": \"3\", \"id\": \"c_3\"}] }";

    private static final String QOTD =
            "{\"format\":\"MCQ\",\"options\":[{\"id\":\"a\",\"text\":\"A\"},{\"id\":\"b\",\"text\":\"B\"}],"
                    + "\"correctOptionId\":\"a\"}";

    private final ObjectMapper om = new ObjectMapper();

    private EngagementPlanRepository plans;
    private EngagementSlotRepository slots;
    private EngagementItemRepository items;
    private EngagementAttemptRepository attempts;
    private EngagementPlanService service;

    /** The item table: id -> row. Saves write here; queries read from here. */
    private final Map<String, EngagementItem> store = new LinkedHashMap<>();
    private final Map<String, Long> completedByItem = new HashMap<>();
    private int nextId = 1;

    private EngagementPlan plan;
    private EngagementSlot slot;

    @BeforeEach
    void setUp() {
        plans = mock(EngagementPlanRepository.class);
        slots = mock(EngagementSlotRepository.class);
        items = mock(EngagementItemRepository.class);
        attempts = mock(EngagementAttemptRepository.class);
        InstituteTimezoneService timezones = mock(InstituteTimezoneService.class);
        service = new EngagementPlanService(plans, slots, items, attempts, timezones,
                new EngagementScheduleResolver(), om);

        plan = new EngagementPlan();
        plan.setId(PLAN);
        plan.setInstituteId(INSTITUTE);
        plan.setPackageSessionId(PS);
        plan.setTitle("Week 1");
        plan.setStatus(EngagementEnums.PlanStatus.PUBLISHED.name());
        plan.setTimezone("UTC");
        when(plans.findById(PLAN)).thenReturn(Optional.of(plan));

        slot = slot(SLOT, PLAN, today(), null);
        when(slots.findById(SLOT)).thenReturn(Optional.of(slot));
        when(slots.save(any(EngagementSlot.class))).thenAnswer(inv -> inv.getArgument(0));

        when(items.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(store.get(inv.<String>getArgument(0))));
        when(items.save(any(EngagementItem.class))).thenAnswer(inv -> {
            EngagementItem item = inv.getArgument(0);
            if (item.getId() == null) item.setId("item-" + nextId++);
            store.put(item.getId(), item);
            return item;
        });
        when(items.findActiveBySlot(anyString())).thenAnswer(inv -> active(List.of(inv.<String>getArgument(0))));
        when(items.findActiveBySlots(anyList())).thenAnswer(inv -> active(inv.getArgument(0)));
        when(attempts.countCompletedForItem(anyString()))
                .thenAnswer(inv -> completedByItem.getOrDefault(inv.<String>getArgument(0), 0L));
        when(attempts.countCompletedForItems(anyList())).thenAnswer(inv -> {
            List<Object[]> rows = new ArrayList<>();
            for (String id : inv.<List<String>>getArgument(0)) {
                if (completedByItem.containsKey(id)) rows.add(new Object[] {id, completedByItem.get(id)});
            }
            return rows;
        });
        when(plans.countActiveLearnersByPackageSessions(anyList()))
                .thenAnswer(inv -> List.<Object[]>of(new Object[] {PS, 2L}));
    }

    // ── FLASHCARDS authoring ─────────────────────────────────────────────────

    @Test
    @DisplayName("FLASHCARDS forces isVerifiable=false, hideResultUntilReveal=false, correctPoints=0, maxScore=n whatever the request sends")
    void flashcardsForcedFieldsPersisted() throws Exception {
        EngagementItemRequest r = flashcards(null, DECK.replace("\"id\":\"c_3\",", ""));
        r.setCorrectPoints(50);
        r.setHideResultUntilReveal(true);
        r.setMaxScore(99);

        service.upsertSlot(PLAN, slotRequest(r), INSTITUTE);

        assertEquals(1, store.size());
        EngagementItem saved = store.values().iterator().next();
        assertEquals("FLASHCARDS", saved.getItemType());
        assertEquals(0, saved.getCorrectPoints());
        assertEquals(Boolean.FALSE, saved.getHideResultUntilReveal());
        assertEquals(Boolean.FALSE, saved.getIsVerifiable());
        assertEquals(3, saved.getMaxScore());
        assertEquals(10, saved.getCompletionPoints());

        // The stored payload is the canonical form, and the missing id was minted.
        JsonNode stored = om.readTree(saved.getPayloadJson());
        assertEquals("flashcards/v1", stored.get("schema").asText());
        assertEquals(3, stored.get("cards").size());
        String minted = stored.get("cards").get(2).get("id").asText();
        assertTrue(FlashcardsPayloadValidator.ID_PATTERN.matcher(minted).matches(), minted);
        assertEquals("c_1", stored.get("cards").get(0).get("id").asText());
    }

    @Test
    @DisplayName("FLASHCARDS: an invalid deck is rejected before anything is written")
    void flashcardsInvalidDeckWritesNothing() {
        EngagementItemRequest r = flashcards(null, "{\"schema\":\"flashcards/v1\",\"cards\":[]}");
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.upsertSlot(PLAN, slotRequest(r), INSTITUTE));
        assertEquals("Add at least 1 card", e.getMessage());
        assertTrue(store.isEmpty());
    }

    @Test
    @DisplayName("re-saving an unchanged deck (reordered keys, other forced values) creates no row and no version bump")
    void unchangedResaveIsNoOp() {
        String id = seedDeck();
        store.get(id).setPayloadJson(DECK_REORDERED);   // what jsonb returns on the next read

        EngagementItemRequest again = flashcards(id, DECK_REORDERED);
        again.setCorrectPoints(40);
        again.setHideResultUntilReveal(true);
        again.setMaxScore(7);
        service.upsertSlot(PLAN, slotRequest(again), INSTITUTE);

        assertEquals(1, store.size());
        EngagementItem after = store.get(id);
        assertEquals(1, after.getVersion());
        assertEquals(DECK_REORDERED, after.getPayloadJson());
        assertEquals(0, after.getCorrectPoints());
        assertEquals(3, after.getMaxScore());
        // The answer-key guard only runs on a real change.
        verify(attempts, never()).countCompletedForItem(id);
    }

    @Test
    @DisplayName("a changed deck keeps its id and gets version + 1; completions are left alone")
    void changedDeckVersionsInPlace() throws Exception {
        String id = seedDeck();
        completedByItem.put(id, 4L);

        EngagementItemRequest edited = flashcards(id, DECK.replace("Body level", "Body-level"));
        service.upsertSlot(PLAN, slotRequest(edited), INSTITUTE);

        assertEquals(1, store.size());
        EngagementItem after = store.get(id);
        assertEquals(2, after.getVersion());
        assertEquals("Body-level", om.readTree(after.getPayloadJson()).get("cards").get(0).get("hint").asText());
        assertEquals(EngagementEnums.ItemStatus.ACTIVE.name(), after.getStatus());
        // Attempts (and the points they paid) are never rewritten by an authoring save.
        verify(attempts, never()).save(any());
        verify(attempts, never()).delete(any());
        verify(attempts, never()).deleteAll(anyList());
    }

    @Test
    @DisplayName("converting a GAME with completions to FLASHCARDS is refused with the type-lock message")
    void gameToFlashcardsRefusedAfterCompletion() {
        EngagementItem game = new EngagementItem();
        game.setId("game-1");
        game.setSlotId(SLOT);
        game.setItemType("GAME");
        game.setTitle("Key terms");
        game.setContentHtml("<div>cards</div>");
        game.setCompletionPoints(10);
        store.put(game.getId(), game);
        completedByItem.put(game.getId(), 1L);

        VacademyException e = assertThrows(VacademyException.class,
                () -> service.upsertSlot(PLAN, slotRequest(flashcards("game-1", DECK)), INSTITUTE));
        assertTrue(e.getMessage().contains("its type can't change"), e.getMessage());
        assertEquals("GAME", store.get("game-1").getItemType());
    }

    // ── other item types ─────────────────────────────────────────────────────

    @Test
    @DisplayName("a QOTD correctOptionId change is rejected once learners completed it")
    void qotdAnswerKeyLocked() {
        EngagementItemRequest create = qotd(null, QOTD);
        service.upsertSlot(PLAN, slotRequest(create), INSTITUTE);
        String id = store.keySet().iterator().next();
        completedByItem.put(id, 3L);

        EngagementItemRequest flip = qotd(id, QOTD.replace("\"correctOptionId\":\"a\"", "\"correctOptionId\":\"b\""));
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.upsertSlot(PLAN, slotRequest(flip), INSTITUTE));
        assertTrue(e.getMessage().contains("answer key can't change"), e.getMessage());
        assertEquals(1, store.get(id).getVersion());
        assertTrue(store.get(id).getPayloadJson().contains("\"correctOptionId\":\"a\""));
    }

    @Test
    @DisplayName("omitting an item from the slot request still retires it")
    void omittedItemIsRetired() {
        service.upsertSlot(PLAN, slotRequest(qotd(null, QOTD), flashcards(null, DECK)), INSTITUTE);
        assertEquals(2, store.size());
        List<String> ids = new ArrayList<>(store.keySet());

        service.upsertSlot(PLAN, slotRequest(flashcards(ids.get(1), DECK)), INSTITUTE);

        assertEquals(EngagementEnums.ItemStatus.DELETED.name(), store.get(ids.get(0)).getStatus());
        assertEquals(EngagementEnums.ItemStatus.ACTIVE.name(), store.get(ids.get(1)).getStatus());
        assertEquals(1, store.get(ids.get(1)).getVersion());
    }

    // ── plan view and list summary ───────────────────────────────────────────

    @Test
    @DisplayName("getPlan counts completions in one batched query and returns the admin-only fields")
    void getPlanIsBatched() {
        EngagementSlot second = slot("slot-2", PLAN, today().plusDays(1), null);
        when(slots.findActiveByPlan(PLAN)).thenReturn(List.of(slot, second));
        EngagementItem a = item("i-a", SLOT, 0);
        a.setMissPolicy(EngagementEnums.MissPolicy.CATCH_UP_REDUCED.name());
        a.setCatchUpDays(2);
        a.setCatchUpPercent(50);
        store.put(a.getId(), a);
        store.put("i-b", item("i-b", SLOT, 1));
        store.put("i-c", item("i-c", "slot-2", 0));
        completedByItem.put("i-a", 1L);

        EngagementPlanDTO dto = service.getPlan(PLAN, INSTITUTE);

        verify(attempts, never()).countCompletedForItem(anyString());
        verify(attempts, times(1)).countCompletedForItems(anyList());
        verify(items, never()).findActiveBySlot(anyString());
        assertEquals(2, dto.getSlots().size());
        assertEquals(2L, dto.getSlots().get(0).getLearnerCount());
        EngagementItemDTO first = dto.getSlots().get(0).getItems().get(0);
        assertEquals("i-a", first.getId());
        assertEquals(1L, first.getCompletedCount());
        assertEquals(2L, first.getLearnerCount());
        assertEquals("CATCH_UP_REDUCED", first.getMissPolicy());
        assertEquals(2, first.getCatchUpDays());
        assertEquals(50, first.getCatchUpPercent());
        assertEquals(0L, dto.getSlots().get(0).getItems().get(1).getCompletedCount());

        assertEquals(3, dto.getTaskCount());
        assertEquals(2, dto.getTodayTaskCount());
        assertEquals(2, dto.getDayCount());
        assertEquals("RUNNING", dto.getTodayState());
        assertEquals(today().toString(), dto.getFirstDate());
        assertEquals(2L, dto.getLearnerCount());
    }

    @Test
    @DisplayName("listPlans with no filters keeps today's order and costs one slot query for all plans")
    void listPlansUnfiltered() {
        EngagementPlan draft = plan("plan-2", "Draft plan", EngagementEnums.PlanStatus.DRAFT);
        EngagementPlan other = plan("plan-x", "Other institute", EngagementEnums.PlanStatus.PUBLISHED);
        other.setInstituteId("inst-2");
        when(plans.findByInstitute(INSTITUTE)).thenReturn(List.of(plan, draft, other));
        when(plans.findActiveSlotsForPlans(anyList())).thenReturn(List.of(slot));
        when(plans.countActiveItemsBySlots(anyList())).thenReturn(List.<Object[]>of(new Object[] {SLOT, 3L}));
        when(plans.findPackageSessionLabelParts(anyList()))
                .thenReturn(List.<Object[]>of(new Object[] {PS, null, "Nursing", "DEFAULT", "Year 1"}));

        List<EngagementPlanDTO> list = service.listPlans(INSTITUTE, null);

        assertEquals(List.of(PLAN, "plan-2"), list.stream().map(EngagementPlanDTO::getId).toList());
        verify(plans, times(1)).findActiveSlotsForPlans(anyList());
        EngagementPlanDTO running = list.get(0);
        assertEquals("RUNNING", running.getTodayState());
        assertEquals("Nursing · Year 1", running.getPackageSessionLabel());
        assertEquals(3, running.getTaskCount());
        assertEquals(3, running.getTodayTaskCount());
        assertEquals(2L, running.getLearnerCount());
        assertEquals(0L, running.getTodayStartedLearners());
        assertTrue(running.getSlots() == null || running.getSlots().isEmpty());
        assertEquals("DRAFT", list.get(1).getTodayState());
        assertNull(list.get(1).getTodayStartedLearners());
    }

    @Test
    @DisplayName("listPlans filters by lifecycle / title and pages with the filtered total")
    void listPlansFilteredAndPaged() {
        EngagementPlan draft = plan("plan-2", "Draft plan", EngagementEnums.PlanStatus.DRAFT);
        EngagementPlan archived = plan("plan-3", "Old plan", EngagementEnums.PlanStatus.ARCHIVED);
        when(plans.findByInstitute(INSTITUTE)).thenReturn(List.of(plan, draft, archived));

        EngagementPlanService.PlanListResult drafts =
                service.listPlans(INSTITUTE, null, "draft,archived", null, "TITLE", 0, 1);
        assertEquals(2, drafts.total());
        assertEquals(1, drafts.plans().size());
        assertEquals("plan-2", drafts.plans().get(0).getId());
        assertEquals(2, drafts.toPage().totalPages());

        EngagementPlanService.PlanListResult search =
                service.listPlans(INSTITUTE, null, null, "  OLD ", null, null, null);
        assertEquals(List.of("plan-3"), search.plans().stream().map(EngagementPlanDTO::getId).toList());

        EngagementPlanService.PlanListResult past =
                service.listPlans(INSTITUTE, null, null, null, null, 5, 20);
        assertTrue(past.plans().isEmpty());
        assertEquals(3, past.total());
    }

    // ── fixtures ─────────────────────────────────────────────────────────────

    private String seedDeck() {
        service.upsertSlot(PLAN, slotRequest(flashcards(null, DECK)), INSTITUTE);
        assertEquals(1, store.size());
        return store.keySet().iterator().next();
    }

    private List<EngagementItem> active(List<String> slotIds) {
        List<EngagementItem> out = new ArrayList<>();
        for (EngagementItem item : store.values()) {
            if (slotIds.contains(item.getSlotId())
                    && EngagementEnums.ItemStatus.ACTIVE.name().equals(item.getStatus())) out.add(item);
        }
        return out;
    }

    @Test
    @DisplayName("a slot id from another plan is refused, not moved into this one")
    void slotOfAnotherPlanIsRefused() {
        EngagementSlot foreign = slot("foreign-slot", "plan-of-another-institute", today(), null);
        when(slots.findById("foreign-slot")).thenReturn(Optional.of(foreign));
        EngagementSlotRequest r = slotRequest();
        r.setId("foreign-slot");

        assertThrows(VacademyException.class, () -> service.upsertSlot(PLAN, r, INSTITUTE));
        assertEquals("plan-of-another-institute", foreign.getPlanId());
        verify(slots, never()).save(any(EngagementSlot.class));
    }

    @Test
    @DisplayName("a plan can't be created on a batch outside the institute")
    void planOnForeignBatchIsRefused() {
        when(plans.countBatchInInstitute("other-batch", INSTITUTE)).thenReturn(0L);
        vacademy.io.admin_core_service.features.engagement.dto.EngagementPlanRequest r =
                new vacademy.io.admin_core_service.features.engagement.dto.EngagementPlanRequest();
        r.setTitle("Steal");
        r.setPackageSessionId("other-batch");
        r.setDefaultMissPolicy("EXPIRES");

        assertThrows(VacademyException.class, () -> service.createPlan(r, INSTITUTE, "u"));
        verify(plans, never()).save(any(EngagementPlan.class));
    }

    private static LocalDate today() {
        return LocalDate.now(ZoneOffset.UTC);
    }

    private static EngagementSlot slot(String id, String planId, LocalDate start, LocalDate end) {
        EngagementSlot s = new EngagementSlot();
        s.setId(id);
        s.setPlanId(planId);
        s.setStartDate(start);
        s.setEndDate(end);
        s.setStartTime(LocalTime.of(0, 0));
        s.setEndTime(LocalTime.of(23, 59));
        return s;
    }

    private EngagementPlan plan(String id, String title, EngagementEnums.PlanStatus status) {
        EngagementPlan p = new EngagementPlan();
        p.setId(id);
        p.setInstituteId(INSTITUTE);
        p.setPackageSessionId(PS);
        p.setTitle(title);
        p.setStatus(status.name());
        p.setTimezone("UTC");
        return p;
    }

    private static EngagementItem item(String id, String slotId, int sortOrder) {
        EngagementItem i = new EngagementItem();
        i.setId(id);
        i.setSlotId(slotId);
        i.setItemType("READING_HTML");
        i.setTitle(id);
        i.setContentHtml("<p>x</p>");
        i.setSortOrder(sortOrder);
        return i;
    }

    private EngagementSlotRequest slotRequest(EngagementItemRequest... requests) {
        EngagementSlotRequest r = new EngagementSlotRequest();
        r.setId(SLOT);
        r.setTitle("Day 1");
        r.setStartDate(slot.getStartDate().toString());
        r.setStartTime("00:00");
        r.setEndTime("23:59");
        r.setItems(new ArrayList<>(List.of(requests)));
        return r;
    }

    private static EngagementItemRequest flashcards(String id, String payload) {
        EngagementItemRequest r = new EngagementItemRequest();
        r.setId(id);
        r.setItemType("FLASHCARDS");
        r.setTitle("Key terms");
        r.setPayloadJson(payload);
        r.setCompletionPoints(10);
        r.setIsRequired(true);
        r.setSortOrder(1);
        return r;
    }

    private static EngagementItemRequest qotd(String id, String payload) {
        EngagementItemRequest r = new EngagementItemRequest();
        r.setId(id);
        r.setItemType("QUESTION_OF_DAY");
        r.setTitle("Which is it?");
        r.setPayloadJson(payload);
        r.setCompletionPoints(5);
        r.setCorrectPoints(20);
        r.setSortOrder(0);
        return r;
    }
}
