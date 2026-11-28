package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementTrackingDTO;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAttempt;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAttemptRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementItemRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementSlotRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver.SlotState;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;

/**
 * Read-only tracking for teachers: who did what on an item, and how a whole batch is
 * keeping up with a plan.
 *
 * <p>Attempts are one row per (item, learner), not per occurrence. On a recurring slot a
 * single completion therefore covers every day the task runs; per-occurrence tracking is
 * deferred (roadmap §0.3 decision 4) and everything here is honest about that.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EngagementTrackingService {

    private static final int MAX_PAGE_SIZE = 200;
    private static final int DEFAULT_OVERVIEW_PAGE_SIZE = 20;
    /** Bound on the export so one click cannot pull an unbounded result set. */
    private static final int EXPORT_LIMIT = 5000;
    /** The completion-by-day series covers at most this many calendar days back from today. */
    private static final int DAYS_WINDOW = 60;
    /** IN-list chunk for the aggregate attempt read. */
    private static final int ID_CHUNK = 500;
    /** Byte-order mark; the controller encodes the body as UTF-8, so this lands as EF BB BF. */
    public static final String CSV_BOM = "\uFEFF";

    public static final String CLASS_NOT_STARTED = "NOT_STARTED";
    public static final String CLASS_BEHIND = "BEHIND";
    public static final String CLASS_ON_TRACK = "ON_TRACK";
    /** Status of a synthesized row: an enrolled learner with no attempt at all. */
    public static final String ROW_NOT_STARTED = "NOT_STARTED";

    private static final String COMPLETED = EngagementEnums.AttemptStatus.COMPLETED.name();
    private static final String STARTED = EngagementEnums.AttemptStatus.STARTED.name();
    private static final List<String> ACTIVE_ENROLMENT = List.of("ACTIVE");

    private final EngagementItemRepository itemRepository;
    private final EngagementSlotRepository slotRepository;
    private final EngagementPlanRepository planRepository;
    private final EngagementAttemptRepository attemptRepository;
    private final AuthService authService;
    private final EngagementScheduleResolver scheduleResolver;
    private final vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository enrollmentRepository;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;
    private final EngagementSettingsService settingsService;
    /** Plans scheduled in days after joining. Optional so hand-built tests need not wire it. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private EngagementRelativeSchedule relativeSchedule;

    /** Server-side paging, search and filter for the plan overview's learner rows. */
    public record OverviewQuery(Integer page, Integer size, String q, boolean needsAttention) {
        /** No paging, no filter: every row, as the overview has always answered. */
        public static final OverviewQuery ALL = new OverviewQuery(null, null, null, false);

        boolean paged() {
            return page != null || size != null;
        }
    }

    // ── Item tracking ────────────────────────────────────────────────────────

    /** Attempt rows for one item (the original contract), plus the additive counters. */
    @Transactional(readOnly = true)
    public EngagementTrackingDTO getItemTracking(String itemId, String instituteId, int page, int size) {
        return getItemTracking(itemId, instituteId, null, page, size);
    }

    /**
     * Tracking for one item with a status filter.
     *
     * <ul>
     *   <li>null: attempt rows only, newest first (the original behaviour).</li>
     *   <li>ALL: attempt rows, then every enrolled learner with no attempt as a
     *       synthesized NOT_STARTED row (alphabetical).</li>
     *   <li>DONE: COMPLETED attempts. STARTED: opened, not finished. LATE: completed
     *       under catch-up.</li>
     *   <li>NOT_DONE: enrolled learners who have neither opened nor finished it, so
     *       Done + Opened + Not done add up to the batch.</li>
     * </ul>
     * The counters are always for the whole item, whatever the filter.
     */
    @Transactional(readOnly = true)
    public EngagementTrackingDTO getItemTracking(String itemId, String instituteId, String status,
                                                 int page, int size) {
        ItemContext ctx = requireContext(itemId, instituteId);
        EngagementItem item = ctx.item();
        String filter = normaliseTrackingStatus(status);
        int pageSize = Math.max(1, Math.min(size, MAX_PAGE_SIZE));
        int pageNo = Math.max(0, page);

        List<String> enrolled = enrolledLearners(ctx.plan());
        Set<String> enrolledSet = new HashSet<>(enrolled);

        long completed = 0, correct = 0, started = 0, late = 0, graded = 0;
        Set<String> engaged = new HashSet<>();
        Map<String, String> statusByUser = new HashMap<>();
        for (Object[] row : attemptRepository.findUserStatusesByItem(itemId)) {
            String userId = (String) row[0];
            String st = (String) row[1];
            boolean isLate = Boolean.TRUE.equals(row[2]);
            Boolean isCorrect = (Boolean) row[3];
            statusByUser.put(userId, st);
            if (COMPLETED.equals(st)) {
                completed++;
                engaged.add(userId);
                if (Boolean.TRUE.equals(isCorrect)) correct++;
                if (isCorrect != null) graded++;
                if (isLate) late++;
            } else if (STARTED.equals(st)) {
                started++;
                engaged.add(userId);
            }
        }
        List<String> notDone = new ArrayList<>();
        for (String userId : enrolled) {
            if (!engaged.contains(userId)) notDone.add(userId);
        }

        EngagementTrackingDTO dto = new EngagementTrackingDTO();
        dto.setItemId(item.getId());
        dto.setTitle(item.getTitle());
        dto.setItemType(item.getItemType());
        dto.setCompletedCount(completed);
        dto.setCorrectCount(correct);
        dto.setStatus(filter);
        dto.setEnrolledCount((long) enrolledSet.size());
        dto.setStartedCount(started);
        dto.setNotDoneCount((long) notDone.size());
        dto.setLateCount(late);
        dto.setGradedCount(graded);
        dto.setMaxScore(item.getMaxScore());
        dto.setOptionCounts(optionCounts(item));

        PageRequest pageable = PageRequest.of(pageNo, pageSize);
        if (filter == null || "DONE".equals(filter) || STARTED.equals(filter) || "LATE".equals(filter)) {
            Page<EngagementAttempt> attempts = switch (filter == null ? "" : filter) {
                case "DONE" -> attemptRepository.findPageByItemAndStatus(itemId, COMPLETED, pageable);
                case "STARTED" -> attemptRepository.findPageByItemAndStatus(itemId, STARTED, pageable);
                case "LATE" -> attemptRepository.findPageLateByItem(itemId, pageable);
                default -> attemptRepository.findPageByItem(itemId, pageable);
            };
            dto.setRows(toRows(attempts.getContent(), item));
            dto.setPage(attempts.getNumber());
            dto.setPageSize(attempts.getSize());
            dto.setTotalRows(attempts.getTotalElements());
            dto.setTotalPages(attempts.getTotalPages());
            return dto;
        }

        // NOT_DONE and ALL are built in memory: the not-done half has no rows to page in SQL.
        Map<String, UserDTO> notDoneUsers = hydrateUsers(notDone);
        List<String> notDoneSorted = new ArrayList<>(notDone);
        notDoneSorted.sort(byName(notDoneUsers));

        List<Object> entries = new ArrayList<>();
        if ("ALL".equals(filter)) {
            entries.addAll(attemptRepository.findByItem(itemId));
            // A learner whose attempt is SKIPPED is already listed by that attempt row;
            // only learners with no row at all are added, so nobody appears twice.
            for (String userId : notDoneSorted) {
                if (!statusByUser.containsKey(userId)) entries.add(userId);
            }
        } else {
            entries.addAll(notDoneSorted);
        }

        int total = entries.size();
        int from = sliceStart(total, pageNo, pageSize);
        int to = Math.min(total, from + pageSize);
        List<Object> slice = entries.subList(from, to);

        List<EngagementAttempt> pageAttempts = new ArrayList<>();
        for (Object e : slice) if (e instanceof EngagementAttempt a) pageAttempts.add(a);
        List<EngagementTrackingDTO.Row> rows = new ArrayList<>(toRows(pageAttempts, item));
        for (Object e : slice) {
            if (e instanceof String userId) {
                rows.add(notStartedRow(userId, statusByUser.get(userId), notDoneUsers.get(userId)));
            }
        }
        dto.setRows(rows);
        dto.setPage(pageNo);
        dto.setPageSize(pageSize);
        dto.setTotalRows(total);
        dto.setTotalPages(total == 0 ? 0 : (int) Math.ceil(total / (double) pageSize));
        return dto;
    }

    /**
     * Per-card outcomes of a FLASHCARDS task: every COMPLETED attempt across versions
     * (the item keeps its id when edited). Card text is the CURRENT deck; outcomes on
     * card ids no longer in it are summed into removedOutcomes. Cards come back in deck
     * order; the UI sorts.
     */
    @Transactional(readOnly = true)
    public EngagementTrackingDTO.CardStats getCardStats(String itemId, String instituteId) {
        ItemContext ctx = requireContext(itemId, instituteId);
        EngagementItem item = ctx.item();
        EngagementTrackingDTO.CardStats out = new EngagementTrackingDTO.CardStats();
        out.setItemId(item.getId());
        out.setVersion(item.getVersion());
        out.setCards(new ArrayList<>());
        if (!EngagementEnums.ItemType.FLASHCARDS.name().equals(item.getItemType())) {
            return out;
        }
        out.setCompletedCount(attemptRepository.countCompletedForItem(itemId));

        Map<String, long[]> byCard = new HashMap<>();
        for (Object[] row : attemptRepository.countFlashcardOutcomes(itemId)) {
            if (row[0] == null) continue;
            byCard.put(String.valueOf(row[0]), new long[] {toLong(row[1]), toLong(row[2])});
        }

        FlashcardsPayloadValidator.Parsed deck = FlashcardsPayloadValidator.readTrusted(item.getPayloadJson());
        Set<String> inDeck = new HashSet<>();
        for (FlashcardsPayloadValidator.Card card : deck.cards()) {
            inDeck.add(card.id());
            long[] counts = byCard.getOrDefault(card.id(), new long[2]);
            long studied = counts[0];
            long gotIt = Math.min(counts[1], studied);
            long learning = studied - gotIt;
            out.getCards().add(new EngagementTrackingDTO.CardStat(
                    card.id(), card.front(), card.back(), studied, gotIt, learning,
                    studied == 0 ? 0d : learning / (double) studied));
        }
        long removed = 0;
        for (Map.Entry<String, long[]> e : byCard.entrySet()) {
            if (!inDeck.contains(e.getKey())) removed += e.getValue()[0];
        }
        out.setRemovedOutcomes(removed);
        return out;
    }

    /**
     * Every attempt on the item as CSV.
     *
     * Built here rather than in the browser so the export is the FULL result set, not
     * whatever page happened to be on screen — exporting only the visible page is a
     * quietly wrong answer a teacher would not notice.
     */
    @Transactional(readOnly = true)
    public String exportItemCsv(String itemId, String instituteId) {
        ItemContext ctx = requireContext(itemId, instituteId);
        EngagementItem item = ctx.item();
        List<EngagementAttempt> attempts = attemptRepository.findByItem(itemId);
        if (attempts.size() > EXPORT_LIMIT) attempts = attempts.subList(0, EXPORT_LIMIT);
        List<EngagementTrackingDTO.Row> rows = toRows(attempts, item);

        Map<String, String> optionText = optionTextById(item.getPayloadJson());
        Map<String, String> frontById = new HashMap<>();
        for (FlashcardsPayloadValidator.Card card :
                FlashcardsPayloadValidator.readTrusted(item.getPayloadJson()).cards()) {
            frontById.put(card.id(), card.front());
        }
        String batch = batchLabel(ctx.plan().getPackageSessionId());
        String taskDate = slotDateLabel(ctx.slot());

        // UTF-8 BOM first: without it Excel reads the file as the system code page and
        // Hindi / Arabic names come out as mojibake.
        StringBuilder csv = new StringBuilder(CSV_BOM);
        csv.append("Name,Username,Email,Status,Result,Score,Points,Late,Time since first opened (s),")
           .append("Completed at,Answer,Files,Selected option,Known (first pass),Cards,")
           .append("Still learning (fronts),Task,Type,Task date,Batch\n");
        for (EngagementTrackingDTO.Row row : rows) {
            String selected = row.getSelectedOptionId() == null ? null
                    : optionText.getOrDefault(row.getSelectedOptionId(), row.getSelectedOptionId());
            String learningFronts = null;
            if (row.getLearningCardIds() != null) {
                List<String> fronts = new ArrayList<>();
                for (String id : row.getLearningCardIds()) fronts.add(frontById.getOrDefault(id, id));
                learningFronts = String.join(" | ", fronts);
            }
            csv.append(csvCell(row.getFullName())).append(',')
               .append(csvCell(row.getUsername())).append(',')
               .append(csvCell(row.getEmail())).append(',')
               .append(csvCell(row.getStatus())).append(',')
               .append(csvCell(resultLabel(row))).append(',')
               .append(row.getScore() == null ? "" : formatNumber(row.getScore())).append(',')
               .append(row.getPointsAwarded() == null ? 0 : row.getPointsAwarded()).append(',')
               .append(Boolean.TRUE.equals(row.getIsLate()) ? "yes" : "no").append(',')
               .append(row.getServerTimeMs() == null ? "" : row.getServerTimeMs() / 1000).append(',')
               .append(csvCell(row.getCompletedAt())).append(',')
               .append(csvCell(row.getTextAnswer())).append(',')
               .append(csvCell(row.getFileIds() == null ? "" : String.join(" ", row.getFileIds()))).append(',')
               .append(csvCell(selected)).append(',')
               .append(row.getFlashcardsKnown() == null ? "" : row.getFlashcardsKnown()).append(',')
               .append(row.getFlashcardsTotal() == null ? "" : row.getFlashcardsTotal()).append(',')
               .append(csvCell(learningFronts)).append(',')
               .append(csvCell(item.getTitle())).append(',')
               .append(csvCell(item.getItemType())).append(',')
               .append(csvCell(taskDate)).append(',')
               .append(csvCell(batch))
               .append('\n');
        }
        log.info("[engagement] CSV export for item {} ({} rows)", itemId, rows.size());
        return csv.toString();
    }

    // ── Plan overview ────────────────────────────────────────────────────────

    /** Every learner row, most-at-risk first (the original contract plus additive fields). */
    @Transactional(readOnly = true)
    public EngagementTrackingDTO.PlanOverview getPlanOverview(String planId, String instituteId) {
        return getPlanOverview(planId, instituteId, OverviewQuery.ALL);
    }

    @Transactional(readOnly = true)
    public EngagementTrackingDTO.PlanOverview getPlanOverview(String planId, String instituteId,
                                                              OverviewQuery query) {
        EngagementPlan plan = requirePlan(planId, instituteId);
        return getPlanOverview(plan, query, scheduleResolver.nowIn(plan));
    }

    /**
     * Batch-level overview of a plan: every enrolled learner, how much they have done,
     * and who needs a nudge.
     *
     * <p>One read of the plan's slots, one of its items and one aggregate read of their
     * attempts (chunked IN-list), then everything is counted in memory. A task hidden by
     * the institute's daily cap on its day is not counted against a learner (unless they
     * did it anyway), because the learner was never shown it.
     *
     * <p>{@code now} is a parameter so the whole classification is testable.
     */
    @Transactional(readOnly = true)
    public EngagementTrackingDTO.PlanOverview getPlanOverview(EngagementPlan plan, OverviewQuery query,
                                                              ZonedDateTime now) {
        PlanModel model = buildModel(plan, now);
        OverviewQuery q = query == null ? OverviewQuery.ALL : query;

        List<EngagementTrackingDTO.LearnerProgress> all = new ArrayList<>();
        long active = 0, slipping = 0, notStarted = 0, behind = 0, onTrack = 0;
        for (String userId : model.learners) {
            EngagementTrackingDTO.LearnerProgress p = progressFor(model, userId);
            all.add(p);
            if (p.getDone() != null && p.getDone() > 0) active++;
            switch (p.getLearnerClass()) {
                case CLASS_NOT_STARTED -> notStarted++;
                case CLASS_BEHIND -> behind++;
                default -> onTrack++;
            }
            if (!CLASS_ON_TRACK.equals(p.getLearnerClass()) && p.getOverdue() != null && p.getOverdue() > 0) {
                slipping++;
            }
        }
        all.sort(MOST_AT_RISK_FIRST);

        List<EngagementTrackingDTO.LearnerProgress> filtered = new ArrayList<>();
        String needle = q.q() == null ? "" : q.q().strip().toLowerCase(Locale.ROOT);
        for (EngagementTrackingDTO.LearnerProgress p : all) {
            if (q.needsAttention() && CLASS_ON_TRACK.equals(p.getLearnerClass())) continue;
            if (!needle.isEmpty() && !matches(p, model.users.get(p.getUserId()), needle)) continue;
            filtered.add(p);
        }

        long tasksClosed = 0, tasksOpened = 0, tasksPastDue = 0, tasksCapHidden = 0;
        for (EngagementItem item : model.items) {
            Occurrence o = model.occurrences.get(item.getId());
            boolean hidden = model.capHidden(item);
            if (o.closed()) tasksClosed++;
            if (o.opened() && hidden) tasksCapHidden++;
            if (o.opened() && !hidden) tasksOpened++;
            if (o.pastDue() && !hidden) tasksPastDue++;
        }

        EngagementTrackingDTO.PlanOverview out = new EngagementTrackingDTO.PlanOverview(
                plan.getId(), plan.getTitle(), tasksClosed, model.items.size(),
                model.learners.size(), active, slipping, filtered);
        out.setNotStarted(notStarted);
        out.setBehind(behind);
        out.setOnTrack(onTrack);
        out.setTasksOpened(tasksOpened);
        out.setTasksPastDue(tasksPastDue);
        out.setTasksCapHidden(tasksCapHidden);
        out.setDailyItemCap(model.cap);
        out.setToday(model.today.toString());
        out.setDays(daySeries(model));
        out.setTasks(taskProgress(model));

        if (q.paged()) {
            int size = q.size() == null ? DEFAULT_OVERVIEW_PAGE_SIZE : Math.max(1, Math.min(q.size(), MAX_PAGE_SIZE));
            int page = q.page() == null ? 0 : Math.max(0, q.page());
            int total = filtered.size();
            int from = sliceStart(total, page, size);
            out.setRows(new ArrayList<>(filtered.subList(from, Math.min(total, from + size))));
            out.setPage(page);
            out.setPageSize(size);
            out.setTotalRows((long) total);
            out.setTotalPages(total == 0 ? 0 : (int) Math.ceil(total / (double) size));
        }
        return out;
    }

    /**
     * The whole plan as a learner × task CSV: one row per enrolled learner (most at risk
     * first), the summary columns, then one column per task in schedule order.
     */
    @Transactional(readOnly = true)
    public String exportPlanCsv(String planId, String instituteId) {
        EngagementPlan plan = requirePlan(planId, instituteId);
        return exportPlanCsv(plan, scheduleResolver.nowIn(plan));
    }

    @Transactional(readOnly = true)
    public String exportPlanCsv(EngagementPlan plan, ZonedDateTime now) {
        PlanModel model = buildModel(plan, now);
        List<EngagementTrackingDTO.LearnerProgress> rows = new ArrayList<>();
        for (String userId : model.learners) rows.add(progressFor(model, userId));
        rows.sort(MOST_AT_RISK_FIRST);
        if (rows.size() > EXPORT_LIMIT) rows = rows.subList(0, EXPORT_LIMIT);

        StringBuilder csv = new StringBuilder(CSV_BOM);
        csv.append("Name,Username,Email,Progress,Done,Available,Overdue,Missed,Points,Last completed at");
        for (EngagementItem item : model.items) {
            String when;
            if (isRelative(model)) {
                // Every learner is on their own dates; the day number is what they share.
                when = "Day " + model.storedSlots.get(item.getSlotId()).getStartDay();
            } else {
                Occurrence o = model.occurrences.get(item.getId());
                LocalDate date = o.runDate() != null ? o.runDate() : model.slots.get(item.getSlotId()).getStartDate();
                when = date.toString();
            }
            csv.append(',').append(csvCell(when + " · " + item.getTitle()));
        }
        csv.append('\n');

        for (EngagementTrackingDTO.LearnerProgress p : rows) {
            UserDTO user = model.users.get(p.getUserId());
            csv.append(csvCell(p.getFullName())).append(',')
               .append(csvCell(p.getUsername())).append(',')
               .append(csvCell(user == null ? null : user.getEmail())).append(',')
               .append(csvCell(classLabel(p.getLearnerClass()))).append(',')
               .append(nz(p.getDone())).append(',')
               .append(nz(p.getAvailable())).append(',')
               .append(nz(p.getOverdue())).append(',')
               .append(p.getMissed()).append(',')
               .append(p.getPointsEarned()).append(',')
               .append(csvCell(p.getLastCompletedAt()));
            Map<String, AttemptLite> mine = model.attempts.getOrDefault(p.getUserId(), Map.of());
            for (EngagementItem item : model.items) {
                csv.append(',').append(csvCell(cellLabel(model, p.getUserId(), item, mine.get(item.getId()))));
            }
            csv.append('\n');
        }
        log.info("[engagement] plan CSV export for plan {} ({} learners x {} tasks)",
                plan.getId(), rows.size(), model.items.size());
        return csv.toString();
    }

    // ── overview internals ───────────────────────────────────────────────────

    /** Where one item sits right now: the most recent occurrence that has opened. */
    record Occurrence(LocalDate runDate, SlotState state) {
        boolean opened() {
            return state != null && state != SlotState.UPCOMING;
        }

        boolean pastDue() {
            return state == SlotState.CATCH_UP || state == SlotState.CLOSED;
        }

        boolean closed() {
            return state == SlotState.CLOSED;
        }
    }

    /** One attempt, as the overview needs it. */
    record AttemptLite(String status, boolean late, Boolean correct, int points, Timestamp completedAt) {
        boolean completed() {
            return COMPLETED.equals(status);
        }
    }

    /** Everything the overview, its series and the plan CSV are computed from. */
    private final class PlanModel {
        EngagementPlan plan;
        ZoneId zone;
        ZonedDateTime now;
        LocalDate today;
        int cap;
        Map<String, EngagementSlot> slots = new HashMap<>();
        /** Active, non-QUIZ items in schedule order. */
        List<EngagementItem> items = new ArrayList<>();
        Map<String, Occurrence> occurrences = new HashMap<>();
        /** Enrolled (ACTIVE) learner ids, in enrolment-query order. */
        List<String> learners = new ArrayList<>();
        Map<String, UserDTO> users = new HashMap<>();
        /** RELATIVE plans: each learner's Day 1. Empty for calendar plans. */
        Map<String, LocalDate> dayOnes = new HashMap<>();
        /** RELATIVE plans: stored slots (virtual dates), kept for per-learner shifting. */
        Map<String, EngagementSlot> storedSlots = new HashMap<>();
        /** CALENDAR plans: each learner's local join day. A run before it was never theirs. */
        Map<String, LocalDate> joinDates = new HashMap<>();
        /** userId -> itemId -> attempt. */
        Map<String, Map<String, AttemptLite>> attempts = new HashMap<>();
        private final Map<LocalDate, Set<String>> visibleByDate = new HashMap<>();

        /** Items the learner feed would show on {@code date}: the first {@code cap} in feed order. */
        Set<String> visibleOn(LocalDate date) {
            return visibleByDate.computeIfAbsent(date, d -> {
                List<EngagementItem> running = new ArrayList<>();
                for (EngagementItem item : items) {
                    if (scheduleResolver.runsOn(slots.get(item.getSlotId()), d)) running.add(item);
                }
                running.sort(feedRank(slots));
                Set<String> out = new HashSet<>();
                for (int i = 0; i < running.size() && i < cap; i++) out.add(running.get(i).getId());
                return out;
            });
        }

        /** Hidden by the cap on the day of its current occurrence (false before it first opens). */
        boolean capHidden(EngagementItem item) {
            Occurrence o = occurrences.get(item.getId());
            if (o == null || o.runDate() == null) return false;
            return !visibleOn(o.runDate()).contains(item.getId());
        }
    }

    private PlanModel buildModel(EngagementPlan plan, ZonedDateTime now) {
        PlanModel m = new PlanModel();
        m.plan = plan;
        m.zone = scheduleResolver.zoneOf(plan);
        m.now = now.withZoneSameInstant(m.zone);
        m.today = m.now.toLocalDate();
        m.cap = dailyCap(plan.getInstituteId());

        List<EngagementSlot> slots = slotRepository.findActiveByPlan(plan.getId());
        if (plan.isRelative() && relativeSchedule != null) {
            // Every learner is on their own days. Plan-wide figures (tasks closed, the
            // by-day series) follow the earliest learner — the furthest anyone has got;
            // each learner's own progress is computed on their own days in progressFor.
            m.dayOnes = relativeSchedule.dayOnesForBatch(plan);
            LocalDate earliest = m.dayOnes.values().stream().min(LocalDate::compareTo).orElse(m.today);
            for (EngagementSlot slot : slots) {
                m.storedSlots.put(slot.getId(), slot);
                slot = relativeSchedule.localize(plan, slot, earliest);
                m.slots.put(slot.getId(), slot);
            }
        } else {
            for (EngagementSlot slot : slots) m.slots.put(slot.getId(), slot);
            for (Object[] row : planRepository.findJoinDatesForBatch(plan.getPackageSessionId())) {
                LocalDate joined = localDate(row[1], m.zone);
                if (row[0] != null && joined != null) m.joinDates.put((String) row[0], joined);
            }
        }
        List<EngagementItem> items = slots.isEmpty()
                ? List.of()
                : itemRepository.findActiveBySlots(new ArrayList<>(m.slots.keySet()));
        for (EngagementItem item : items) {
            // QUIZ has no learner path; the feed never shows it, so it is not a task here.
            if (EngagementEnums.ItemType.QUIZ.name().equals(item.getItemType())) continue;
            if (!m.slots.containsKey(item.getSlotId())) continue;
            m.items.add(item);
        }
        m.items.sort(scheduleOrder(m.slots));
        for (EngagementItem item : m.items) {
            m.occurrences.put(item.getId(), occurrenceOf(plan, m.slots.get(item.getSlotId()), item, m.now));
        }

        m.learners = enrolledLearners(plan);
        m.users = hydrateUsers(m.learners);

        List<String> itemIds = m.items.stream().map(EngagementItem::getId).toList();
        for (int i = 0; i < itemIds.size(); i += ID_CHUNK) {
            List<String> chunk = itemIds.subList(i, Math.min(itemIds.size(), i + ID_CHUNK));
            for (Object[] r : attemptRepository.findProgressRowsForItems(new ArrayList<>(chunk))) {
                String itemId = (String) r[0];
                String userId = (String) r[1];
                if (itemId == null || userId == null) continue;
                AttemptLite a = new AttemptLite((String) r[2], Boolean.TRUE.equals(r[3]), (Boolean) r[4],
                        r[5] == null ? 0 : ((Number) r[5]).intValue(), (Timestamp) r[6]);
                m.attempts.computeIfAbsent(userId, k -> new HashMap<>()).put(itemId, a);
            }
        }
        return m;
    }

    /**
     * The occurrence in effect: the most recent run on or before today; when today's run
     * has not opened yet, the run before it (a recurring task was available yesterday).
     */
    private Occurrence occurrenceOf(EngagementPlan plan, EngagementSlot slot, EngagementItem item,
                                    ZonedDateTime now) {
        LocalDate today = now.toLocalDate();
        LocalDate run = scheduleResolver.mostRecentRunDate(slot, today);
        if (run == null) return new Occurrence(null, null);
        SlotState state = scheduleResolver.stateOn(plan, slot, item, run, now);
        if (state == SlotState.UPCOMING) {
            LocalDate previous = scheduleResolver.mostRecentRunDate(slot, run.minusDays(1));
            if (previous == null) return new Occurrence(run, SlotState.UPCOMING);
            return new Occurrence(previous, scheduleResolver.stateOn(plan, slot, item, previous, now));
        }
        return new Occurrence(run, state);
    }

    private EngagementTrackingDTO.LearnerProgress progressFor(PlanModel m, String userId) {
        Map<String, AttemptLite> mine = m.attempts.getOrDefault(userId, Map.of());
        long completed = 0, correct = 0, points = 0;
        Timestamp last = null;
        for (AttemptLite a : mine.values()) {
            points += a.points();
            if (Boolean.TRUE.equals(a.correct())) correct++;
            if (a.completed()) {
                completed++;
                if (a.completedAt() != null && (last == null || a.completedAt().after(last))) last = a.completedAt();
            }
        }
        long available = 0, overdue = 0, missed = 0;
        for (EngagementItem item : m.items) {
            AttemptLite a = mine.get(item.getId());
            if (a != null && a.completed()) {
                available++;
                continue;
            }
            Occurrence o = occurrenceFor(m, userId, item);
            if (o == null || !o.opened() || capHiddenFor(m, item)) continue;
            available++;
            if (o.pastDue()) overdue++;
            if (o.closed()) missed++;
        }
        UserDTO u = m.users.get(userId);
        EngagementTrackingDTO.LearnerProgress p = new EngagementTrackingDTO.LearnerProgress(
                userId,
                u == null ? null : u.getFullName(),
                u == null ? null : u.getUsername(),
                completed, correct, points, missed,
                last == null ? null : last.toInstant().toString());
        p.setAvailable(available);
        p.setDone(completed);
        p.setOverdue(overdue);
        p.setLearnerClass(classify(completed, available));
        return p;
    }

    /** NOT_STARTED when nothing is done; BEHIND under half of what has opened; else ON_TRACK. */
    public static String classify(long done, long available) {
        if (done <= 0) return CLASS_NOT_STARTED;
        if (available > 0 && done * 2 < available) return CLASS_BEHIND;
        return CLASS_ON_TRACK;
    }

    /**
     * Class (NOT_STARTED, BEHIND, ON_TRACK), then missed desc, overdue desc, done asc,
     * last completion asc (never first), then name.
     */
    static final Comparator<EngagementTrackingDTO.LearnerProgress> MOST_AT_RISK_FIRST = Comparator
            .comparingInt((EngagementTrackingDTO.LearnerProgress p) -> classRank(p.getLearnerClass()))
            .thenComparing(EngagementTrackingDTO.LearnerProgress::getMissed, Comparator.reverseOrder())
            .thenComparing(p -> nz(p.getOverdue()), Comparator.reverseOrder())
            .thenComparing(p -> nz(p.getDone()))
            .thenComparing(EngagementTrackingDTO.LearnerProgress::getLastCompletedAt,
                    Comparator.nullsFirst(Comparator.naturalOrder()))
            .thenComparing(p -> p.getFullName() == null ? "" : p.getFullName().toLowerCase(Locale.ROOT));

    private static int classRank(String cls) {
        if (CLASS_NOT_STARTED.equals(cls)) return 0;
        if (CLASS_BEHIND.equals(cls)) return 1;
        return 2;
    }

    /**
     * Completion by day. A completion is filed under the occurrence that was in effect
     * when it happened (for a single-day slot, its day), which matches the learner
     * history. Cap-hidden tasks add to the denominator only for learners who did them.
     */
    private List<EngagementTrackingDTO.Day> daySeries(PlanModel m) {
        Set<String> enrolled = new HashSet<>(m.learners);
        // itemId -> filed date -> completions by enrolled learners
        Map<String, Map<LocalDate, Long>> filed = new HashMap<>();
        Map<String, EngagementItem> itemsById = new HashMap<>();
        for (EngagementItem item : m.items) itemsById.put(item.getId(), item);
        for (Map.Entry<String, Map<String, AttemptLite>> byUser : m.attempts.entrySet()) {
            if (!enrolled.contains(byUser.getKey())) continue;
            for (Map.Entry<String, AttemptLite> e : byUser.getValue().entrySet()) {
                AttemptLite a = e.getValue();
                EngagementItem item = itemsById.get(e.getKey());
                if (item == null || !a.completed() || a.completedAt() == null) continue;
                EngagementSlot slot = m.slots.get(item.getSlotId());
                LocalDate doneOn = a.completedAt().toInstant().atZone(m.zone).toLocalDate();
                LocalDate date = scheduleResolver.mostRecentRunDate(slot, doneOn);
                if (date == null) date = slot.getStartDate();
                filed.computeIfAbsent(item.getId(), k -> new HashMap<>()).merge(date, 1L, Long::sum);
            }
        }

        LocalDate earliest = null;
        for (EngagementSlot slot : m.slots.values()) {
            if (earliest == null || slot.getStartDate().isBefore(earliest)) earliest = slot.getStartDate();
        }
        if (earliest == null) return new ArrayList<>();
        LocalDate from = m.today.minusDays(DAYS_WINDOW - 1L);
        if (earliest.isAfter(from)) from = earliest;

        TreeMap<LocalDate, long[]> byDate = new TreeMap<>();
        long learners = m.learners.size();
        for (LocalDate d = from; !d.isAfter(m.today); d = d.plusDays(1)) {
            Set<String> visible = m.visibleOn(d);
            for (EngagementItem item : m.items) {
                EngagementSlot slot = m.slots.get(item.getSlotId());
                if (!scheduleResolver.runsOn(slot, d)) continue;
                if (d.equals(m.today)
                        && scheduleResolver.stateOn(m.plan, slot, item, d, m.now) == SlotState.UPCOMING) {
                    continue;
                }
                long done = filed.getOrDefault(item.getId(), Map.of()).getOrDefault(d, 0L);
                long[] acc = byDate.computeIfAbsent(d, k -> new long[3]);
                if (visible.contains(item.getId())) {
                    acc[0]++;
                    acc[2] += learners;
                } else {
                    acc[2] += done;
                }
                acc[1] += done;
            }
        }
        List<EngagementTrackingDTO.Day> out = new ArrayList<>();
        for (Map.Entry<LocalDate, long[]> e : byDate.entrySet()) {
            long[] acc = e.getValue();
            if (acc[0] == 0 && acc[1] == 0) continue;
            long completed = Math.min(acc[1], acc[2]);
            out.add(new EngagementTrackingDTO.Day(e.getKey().toString(), acc[0], completed, acc[2],
                    acc[2] == 0 ? null : completed / (double) acc[2]));
        }
        return out;
    }

    private List<EngagementTrackingDTO.TaskProgress> taskProgress(PlanModel m) {
        long learners = m.learners.size();
        Map<String, long[]> counts = new HashMap<>();
        for (String userId : m.learners) {
            for (Map.Entry<String, AttemptLite> e : m.attempts.getOrDefault(userId, Map.of()).entrySet()) {
                long[] acc = counts.computeIfAbsent(e.getKey(), k -> new long[2]);
                if (e.getValue().completed()) acc[0]++;
                else if (STARTED.equals(e.getValue().status())) acc[1]++;
            }
        }
        List<EngagementTrackingDTO.TaskProgress> out = new ArrayList<>();
        for (EngagementItem item : m.items) {
            EngagementSlot slot = m.slots.get(item.getSlotId());
            Occurrence o = m.occurrences.get(item.getId());
            LocalDate runDate = o.opened() ? o.runDate() : nextRunDate(slot, m.today);
            SlotState state = o.opened() ? o.state() : SlotState.UPCOMING;
            boolean hidden = runDate != null && !m.visibleOn(runDate).contains(item.getId());
            long[] acc = counts.getOrDefault(item.getId(), new long[2]);
            out.add(new EngagementTrackingDTO.TaskProgress(
                    item.getId(), item.getSlotId(), item.getTitle(), item.getItemType(),
                    runDate == null ? null : runDate.toString(),
                    state.name(), hidden, acc[0], acc[1],
                    learners == 0 ? null : acc[0] / (double) learners));
        }
        return out;
    }

    private LocalDate nextRunDate(EngagementSlot slot, LocalDate today) {
        LocalDate cursor = today.isBefore(slot.getStartDate()) ? slot.getStartDate() : today;
        for (int i = 0; i < 8; i++) {
            if (cursor.isAfter(slot.effectiveEndDate())) return null;
            if (scheduleResolver.runsOn(slot, cursor)) return cursor;
            cursor = cursor.plusDays(1);
        }
        return null;
    }

    private String cellLabel(PlanModel m, String userId, EngagementItem item, AttemptLite a) {
        if (a != null && a.completed()) return a.late() ? "Done (late)" : "Done";
        Occurrence o = occurrenceFor(m, userId, item);
        if (o == null) return isRelative(m) ? "Not open yet" : "Before joining";
        if (!o.opened()) return "Not open yet";
        if (capHiddenFor(m, item)) return "Hidden (daily cap)";
        if (o.closed()) return "Missed";
        if (a != null && STARTED.equals(a.status())) return o.pastDue() ? "Opened, overdue" : "Opened";
        return o.pastDue() ? "Overdue" : "Not done";
    }

    private boolean isRelative(PlanModel m) {
        return m.plan.isRelative() && relativeSchedule != null;
    }

    /**
     * This task's run as one learner meets it: on their own days for a RELATIVE plan. Null
     * when it isn't theirs to do: a calendar run from before they joined, or no Day 1.
     */
    private Occurrence occurrenceFor(PlanModel m, String userId, EngagementItem item) {
        if (isRelative(m)) {
            LocalDate dayOne = m.dayOnes.get(userId);
            if (dayOne == null) return null;
            EngagementSlot learnerSlot = relativeSchedule.localize(m.plan, m.storedSlots.get(item.getSlotId()), dayOne);
            return occurrenceOf(m.plan, learnerSlot, item, m.now);
        }
        Occurrence o = m.occurrences.get(item.getId());
        LocalDate joined = m.joinDates.get(userId);
        if (o != null && joined != null && o.runDate() != null && o.runDate().isBefore(joined)) return null;
        return o;
    }

    /** The daily cap is modelled plan-wide on calendar days; RELATIVE plans have no shared day to cap. */
    private boolean capHiddenFor(PlanModel m, EngagementItem item) {
        return !isRelative(m) && m.capHidden(item);
    }

    private static LocalDate localDate(Object value, ZoneId zone) {
        if (value instanceof Timestamp t) return t.toInstant().atZone(zone).toLocalDate();
        if (value instanceof java.sql.Date d) return d.toLocalDate(); // a calendar date has no zone
        if (value instanceof java.util.Date d) return d.toInstant().atZone(zone).toLocalDate();
        if (value instanceof java.time.Instant i) return i.atZone(zone).toLocalDate();
        if (value instanceof java.time.LocalDateTime l) return Timestamp.valueOf(l).toInstant().atZone(zone).toLocalDate();
        return null;
    }

    private static String classLabel(String cls) {
        if (CLASS_NOT_STARTED.equals(cls)) return "Not started";
        if (CLASS_BEHIND.equals(cls)) return "Behind";
        return "On track";
    }

    /** The learner feed's order: required first, then the earliest window end, then authored order. */
    private static Comparator<EngagementItem> feedRank(Map<String, EngagementSlot> slots) {
        return Comparator
                .comparing((EngagementItem i) -> !Boolean.TRUE.equals(i.getIsRequired()))
                .thenComparing(i -> slots.get(i.getSlotId()).getEndTime())
                .thenComparing(i -> nzInt(slots.get(i.getSlotId()).getSortOrder()))
                .thenComparing(i -> nzInt(i.getSortOrder()))
                .thenComparing(EngagementItem::getId);
    }

    private static Comparator<EngagementItem> scheduleOrder(Map<String, EngagementSlot> slots) {
        return Comparator
                .comparing((EngagementItem i) -> slots.get(i.getSlotId()).getStartDate())
                .thenComparing(i -> slots.get(i.getSlotId()).getStartTime())
                .thenComparing(i -> nzInt(slots.get(i.getSlotId()).getSortOrder()))
                .thenComparing(EngagementItem::getSlotId)
                .thenComparing((EngagementItem i) -> !Boolean.TRUE.equals(i.getIsRequired()))
                .thenComparing(i -> nzInt(i.getSortOrder()))
                .thenComparing(EngagementItem::getId);
    }

    private int dailyCap(String instituteId) {
        try {
            return settingsService.getDailyItemCap(instituteId);
        } catch (Exception e) {
            return EngagementSettingsService.DEFAULT_DAILY_ITEM_CAP;
        }
    }

    private static boolean matches(EngagementTrackingDTO.LearnerProgress p, UserDTO user, String needle) {
        for (String s : new String[] {p.getFullName(), p.getUsername(), user == null ? null : user.getEmail()}) {
            if (s != null && s.toLowerCase(Locale.ROOT).contains(needle)) return true;
        }
        return false;
    }

    // ── item internals ───────────────────────────────────────────────────────

    private record ItemContext(EngagementItem item, EngagementSlot slot, EngagementPlan plan) {}

    private static String normaliseTrackingStatus(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String s = raw.strip().toUpperCase(Locale.ROOT);
        return switch (s) {
            case "ALL", "DONE", "NOT_DONE", "STARTED", "LATE" -> s;
            default -> throw new VacademyException("Unknown tracking filter: " + raw.strip());
        };
    }

    private List<String> enrolledLearners(EngagementPlan plan) {
        List<String> ids = enrollmentRepository
                .findDistinctUserIdsByPackageSessionAndStatus(plan.getPackageSessionId(), ACTIVE_ENROLMENT);
        if (ids == null) return new ArrayList<>();
        return new ArrayList<>(new LinkedHashSet<>(ids.stream().filter(Objects::nonNull).toList()));
    }

    /**
     * Options with their pick counts: the payload's options first in authored order
     * (0 when nobody picked one), then any picked id the payload no longer has. Null for
     * a type without options.
     */
    private List<EngagementTrackingDTO.OptionCount> optionCounts(EngagementItem item) {
        List<String> authored = new ArrayList<>(optionTextById(item.getPayloadJson()).keySet());
        boolean hasOptions = !authored.isEmpty()
                || EngagementEnums.ItemType.POLL.name().equals(item.getItemType())
                || EngagementEnums.ItemType.QUESTION_OF_DAY.name().equals(item.getItemType());
        if (!hasOptions) return null;
        Map<String, Long> counts = new LinkedHashMap<>();
        for (String id : authored) counts.put(id, 0L);
        for (Object[] row : attemptRepository.countByOption(item.getId())) {
            if (row[0] == null) continue;
            counts.merge(String.valueOf(row[0]), toLong(row[1]), Long::sum);
        }
        // A TEXT or UPLOAD question of the day has no options and no picks: no distribution.
        if (counts.isEmpty()) return null;
        List<EngagementTrackingDTO.OptionCount> out = new ArrayList<>();
        counts.forEach((id, n) -> out.add(new EngagementTrackingDTO.OptionCount(id, n)));
        return out;
    }

    /** optionId -> text, in authored order, from {"options":[{"id","text"}]}. */
    private Map<String, String> optionTextById(String payloadJson) {
        Map<String, String> out = new LinkedHashMap<>();
        if (payloadJson == null || payloadJson.isBlank()) return out;
        try {
            JsonNode root = objectMapper.readTree(payloadJson);
            JsonNode options = root == null ? null : root.get("options");
            if (options == null || !options.isArray()) return out;
            for (JsonNode option : options) {
                if (option == null || !option.hasNonNull("id")) continue;
                String id = option.get("id").asText();
                if (id.isBlank()) continue;
                out.put(id, option.hasNonNull("text") ? option.get("text").asText() : id);
            }
        } catch (Exception e) {
            // A malformed payload has no options to count; tracking still renders.
        }
        return out;
    }

    private Map<String, Object> parseResponse(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private List<String> fileIdsOf(Map<String, Object> response) {
        Object raw = response.get("fileIds");
        if (raw instanceof List<?> list) {
            List<String> out = new ArrayList<>();
            for (Object o : list) if (o != null) out.add(String.valueOf(o));
            return out;
        }
        return null;
    }

    private List<EngagementTrackingDTO.Row> toRows(List<EngagementAttempt> attempts, EngagementItem item) {
        Map<String, UserDTO> users = hydrateUsers(
                attempts.stream().map(EngagementAttempt::getUserId).toList());

        List<EngagementTrackingDTO.Row> rows = new ArrayList<>();
        for (EngagementAttempt attempt : attempts) {
            UserDTO user = users.get(attempt.getUserId());
            Map<String, Object> response = parseResponse(attempt.getResponseJson());
            EngagementTrackingDTO.Row row = new EngagementTrackingDTO.Row();
            row.setUserId(attempt.getUserId());
            row.setFullName(user == null ? null : user.getFullName());
            row.setUsername(user == null ? null : user.getUsername());
            row.setEmail(user == null ? null : user.getEmail());
            row.setStatus(attempt.getStatus());
            row.setIsCorrect(attempt.getIsCorrect());
            row.setScore(attempt.getScore() == null ? null : attempt.getScore().doubleValue());
            row.setPointsAwarded(attempt.getPointsAwarded());
            row.setIsLate(attempt.getIsLate());
            row.setTimeSpentMs(attempt.getTimeSpentMs());
            row.setCompletedAt(attempt.getCompletedAt() == null ? null : attempt.getCompletedAt().toInstant().toString());
            row.setTextAnswer(response.get("textAnswer") == null ? null : String.valueOf(response.get("textAnswer")));
            row.setFileIds(fileIdsOf(response));
            row.setSelectedOptionId(response.get("selectedOptionId") == null
                    ? null : String.valueOf(response.get("selectedOptionId")));

            if (attempt.getMaxScore() != null) {
                row.setMaxScore(attempt.getMaxScore().doubleValue());
            } else if (item != null && item.getMaxScore() != null) {
                row.setMaxScore(item.getMaxScore().doubleValue());
            }
            row.setStartedAt(attempt.getStartedAt() == null ? null : attempt.getStartedAt().toInstant().toString());
            row.setServerTimeMs(serverTimeMs(attempt));
            applyFlashcards(row, response);
            rows.add(row);
        }
        return rows;
    }

    /** completedAt − startedAt on the server clock; null unless both exist and are ordered. */
    static Long serverTimeMs(EngagementAttempt attempt) {
        if (attempt.getStartedAt() == null || attempt.getCompletedAt() == null) return null;
        long ms = attempt.getCompletedAt().getTime() - attempt.getStartedAt().getTime();
        return ms < 0 ? null : ms;
    }

    /** Reads the server-built {"flashcards":{version,total,known,outcomes[{cardId,result}]}}. */
    private void applyFlashcards(EngagementTrackingDTO.Row row, Map<String, Object> response) {
        if (!(response.get("flashcards") instanceof Map<?, ?> fc)) return;
        if (fc.get("known") instanceof Number n) row.setFlashcardsKnown(n.intValue());
        if (fc.get("total") instanceof Number n) row.setFlashcardsTotal(n.intValue());
        if (fc.get("outcomes") instanceof List<?> outcomes) {
            List<String> learning = new ArrayList<>();
            for (Object o : outcomes) {
                if (!(o instanceof Map<?, ?> outcome) || outcome.get("cardId") == null) continue;
                if (!"KNOWN".equals(String.valueOf(outcome.get("result")))) {
                    learning.add(String.valueOf(outcome.get("cardId")));
                }
            }
            row.setLearningCardIds(learning);
        }
    }

    private static EngagementTrackingDTO.Row notStartedRow(String userId, String attemptStatus, UserDTO user) {
        EngagementTrackingDTO.Row row = new EngagementTrackingDTO.Row();
        row.setUserId(userId);
        row.setFullName(user == null ? null : user.getFullName());
        row.setUsername(user == null ? null : user.getUsername());
        row.setEmail(user == null ? null : user.getEmail());
        // A SKIPPED attempt keeps its own status; everyone else never opened it.
        row.setStatus(attemptStatus == null ? ROW_NOT_STARTED : attemptStatus);
        row.setPointsAwarded(0);
        row.setIsLate(false);
        return row;
    }

    private static Comparator<String> byName(Map<String, UserDTO> users) {
        return Comparator
                .comparing((String id) -> {
                    UserDTO u = users.get(id);
                    String name = u == null ? null : (u.getFullName() != null ? u.getFullName() : u.getUsername());
                    return name == null ? null : name.toLowerCase(Locale.ROOT);
                }, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(id -> id);
    }

    /**
     * Names come from auth_service over HTTP — admin_core has no users table to join.
     * A failure leaves names null rather than failing the whole table: a teacher is
     * better served by ids than by an error page.
     */
    private Map<String, UserDTO> hydrateUsers(Collection<String> userIds) {
        List<String> ids = userIds.stream()
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .toList();
        if (ids.isEmpty()) return new HashMap<>();
        Map<String, UserDTO> out = new HashMap<>();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids));
            if (users != null) {
                for (UserDTO user : users) {
                    if (user != null && user.getId() != null) out.put(user.getId(), user);
                }
            }
        } catch (Exception e) {
            log.warn("[engagement] learner name hydration failed: {}", e.getMessage());
        }
        return out;
    }

    private ItemContext requireContext(String itemId, String instituteId) {
        EngagementItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new VacademyException("Item not found"));
        EngagementSlot slot = slotRepository.findById(item.getSlotId())
                .orElseThrow(() -> new VacademyException("Item not found"));
        EngagementPlan plan = planRepository.findById(slot.getPlanId())
                .orElseThrow(() -> new VacademyException("Item not found"));
        // Cross-tenant guard: an item id from another institute must not be readable.
        if (!Objects.equals(plan.getInstituteId(), instituteId)) {
            throw new VacademyException("Item not found");
        }
        return new ItemContext(item, slot, plan);
    }

    private EngagementPlan requirePlan(String planId, String instituteId) {
        EngagementPlan plan = planRepository.findById(planId)
                .orElseThrow(() -> new VacademyException("Plan not found"));
        if (!Objects.equals(plan.getInstituteId(), instituteId)) {
            throw new VacademyException("Plan not found");
        }
        return plan;
    }

    /** The batch's display label, or null (cosmetic: a failure never fails the export). */
    private String batchLabel(String packageSessionId) {
        if (packageSessionId == null) return null;
        try {
            for (Object[] row : planRepository.findPackageSessionLabelParts(List.of(packageSessionId))) {
                return EngagementPlanService.batchLabel((String) row[1], (String) row[2], (String) row[3],
                        (String) row[4]);
            }
        } catch (Exception e) {
            log.debug("[engagement] batch label lookup failed for {}: {}", packageSessionId, e.getMessage());
        }
        return null;
    }

    private static String slotDateLabel(EngagementSlot slot) {
        if (slot != null && slot.getStartDay() != null) {
            // Days after joining: the stored dates are placeholders (2000-01-0N), never shown.
            int end = slot.getEndDay() == null ? slot.getStartDay() : slot.getEndDay();
            return end == slot.getStartDay() ? "Day " + end : "Days " + slot.getStartDay() + " to " + end;
        }
        if (slot == null || slot.getStartDate() == null) return null;
        LocalDate end = slot.effectiveEndDate();
        return end.equals(slot.getStartDate()) ? slot.getStartDate().toString()
                : slot.getStartDate() + " to " + end;
    }

    private String resultLabel(EngagementTrackingDTO.Row row) {
        if (row.getIsCorrect() == null) return "";
        return Boolean.TRUE.equals(row.getIsCorrect()) ? "Correct" : "Wrong";
    }

    private static String formatNumber(double value) {
        return value == Math.rint(value) && !Double.isInfinite(value)
                ? String.valueOf((long) value)
                : String.valueOf(value);
    }

    /** First index of an in-memory page; long maths so a huge page number cannot overflow. */
    public static int sliceStart(int total, int page, int size) {
        return (int) Math.min((long) total, (long) Math.max(0, page) * Math.max(1, size));
    }

    private static long toLong(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    private static long nz(Long v) {
        return v == null ? 0L : v;
    }

    private static int nzInt(Integer v) {
        return v == null ? 0 : v;
    }

    /**
     * One quoted CSV cell.
     *
     * RFC-4180 quoting, because a learner's name can legitimately contain a comma or
     * quote. Plus formula-injection defence: names and answers are learner-typed, and a
     * cell starting with = + - @ TAB or CR is executed as a formula by Excel / Sheets
     * when the teacher opens the file. A leading apostrophe makes it plain text.
     */
    public static String csvCell(String value) {
        if (value == null || value.isEmpty()) return "";
        String safe = startsLikeFormula(value) ? "'" + value : value;
        return "\"" + safe.replace("\"", "\"\"") + "\"";
    }

    private static boolean startsLikeFormula(String value) {
        char first = value.charAt(0);
        return first == '=' || first == '+' || first == '-' || first == '@'
                || first == '\t' || first == '\r';
    }
}
