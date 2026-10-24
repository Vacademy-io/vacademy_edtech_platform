package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementPlanDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementPlanRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSlotDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSlotRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAttempt;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAttemptRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementItemRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementSlotRepository;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/** Teacher/admin authoring: plans, slots, items. */
@Service
@RequiredArgsConstructor
@Slf4j
public class EngagementPlanService {

    private final EngagementPlanRepository planRepository;
    private final EngagementSlotRepository slotRepository;
    private final EngagementItemRepository itemRepository;
    private final EngagementAttemptRepository attemptRepository;
    private final InstituteTimezoneService instituteTimezoneService;
    private final EngagementScheduleResolver scheduleResolver;
    private final ObjectMapper objectMapper;

    /**
     * Create the plan for every batch named in the request.
     *
     * A plan stays scoped to one batch — this writes one plan per id rather than
     * widening the schema — so the feed, tracking and leaderboards keep working
     * exactly as before. Returns one DTO per batch.
     */
    @Transactional
    public List<EngagementPlanDTO> createPlans(EngagementPlanRequest request, String instituteId,
                                               String userId) {
        List<String> targets = new ArrayList<>();
        if (request.getPackageSessionIds() != null) {
            for (String id : request.getPackageSessionIds()) {
                if (id != null && !id.isBlank() && !targets.contains(id)) targets.add(id);
            }
        }
        if (targets.isEmpty() && request.getPackageSessionId() != null
                && !request.getPackageSessionId().isBlank()) {
            targets.add(request.getPackageSessionId());
        }
        if (targets.isEmpty()) {
            throw new VacademyException("At least one batch is required");
        }

        List<EngagementPlanDTO> created = new ArrayList<>();
        for (String packageSessionId : targets) {
            // createPlan reads the batch off the request, so point it at each target in
            // turn. Slot/item ids in the payload are null on create, so every batch gets
            // its own rows rather than sharing them.
            request.setPackageSessionId(packageSessionId);
            created.add(createPlan(request, instituteId, userId));
        }
        return created;
    }

    @Transactional
    public EngagementPlanDTO createPlan(EngagementPlanRequest request, String instituteId, String userId) {
        if (request.getPackageSessionId() == null || request.getPackageSessionId().isBlank()) {
            throw new VacademyException("packageSessionId is required");
        }
        if (request.getTitle() == null || request.getTitle().isBlank()) {
            throw new VacademyException("title is required");
        }
        if (planRepository.countBatchInInstitute(request.getPackageSessionId(), instituteId) == 0) {
            // Without this, staff of one institute could aim a plan at another's batch and
            // read its roster through tracking, or push to its learners.
            throw new VacademyException("Batch not found in this institute");
        }

        EngagementPlan plan = new EngagementPlan();
        plan.setInstituteId(instituteId);
        plan.setPackageSessionId(request.getPackageSessionId());
        plan.setTitle(request.getTitle());
        plan.setDescription(request.getDescription());
        plan.setSubjectId(request.getSubjectId());
        plan.setStatus(safeStatus(request.getStatus()));
        // Snapshot, not a live read — see EngagementPlan.timezone.
        plan.setTimezone(instituteTimezoneService.getTimezoneId(instituteId));
        // Same default as the column: a caller that leaves it out gets EXPIRES.
        plan.setDefaultMissPolicy(request.getDefaultMissPolicy() == null
                ? EngagementEnums.MissPolicy.EXPIRES.name()
                : safeMissPolicy(request.getDefaultMissPolicy()));
        plan.setDefaultCatchUpDays(request.getDefaultCatchUpDays());
        plan.setDefaultCatchUpPercent(request.getDefaultCatchUpPercent());
        plan.setScheduleMode(safeScheduleMode(request.getScheduleMode()));
        stampPublished(plan);
        plan.setCreatedByUserId(userId);
        plan.setUpdatedAt(now());
        plan = planRepository.save(plan);

        if (request.getSlots() != null) {
            for (EngagementSlotRequest slotRequest : request.getSlots()) {
                upsertSlot(plan, slotRequest);
            }
        }
        return getPlan(plan.getId(), instituteId);
    }

    @Transactional
    public EngagementPlanDTO updatePlan(String planId, EngagementPlanRequest request, String instituteId) {
        EngagementPlan plan = requirePlan(planId, instituteId);
        if (request.getTitle() != null) plan.setTitle(request.getTitle());
        if (request.getDescription() != null) plan.setDescription(request.getDescription());
        if (request.getSubjectId() != null) plan.setSubjectId(request.getSubjectId());
        if (request.getStatus() != null) plan.setStatus(safeStatus(request.getStatus()));
        stampPublished(plan);
        if (request.getScheduleMode() != null
                && !safeScheduleMode(request.getScheduleMode()).equals(plan.getScheduleMode())) {
            // Every learner's timeline, attempt and reveal is computed from the mode;
            // switching it under a running plan would move tasks around for everyone.
            throw new VacademyException("A plan's schedule type can't change. Create a new plan instead.");
        }
        if (request.getDefaultMissPolicy() != null) {
            plan.setDefaultMissPolicy(safeMissPolicy(request.getDefaultMissPolicy()));
        }
        if (request.getDefaultCatchUpDays() != null) plan.setDefaultCatchUpDays(request.getDefaultCatchUpDays());
        if (request.getDefaultCatchUpPercent() != null) {
            plan.setDefaultCatchUpPercent(request.getDefaultCatchUpPercent());
        }
        plan.setUpdatedAt(now());
        planRepository.save(plan);

        if (request.getSlots() != null) {
            for (EngagementSlotRequest slotRequest : request.getSlots()) {
                upsertSlot(plan, slotRequest);
            }
        }
        return getPlan(planId, instituteId);
    }

    @Transactional
    public void deletePlan(String planId, String instituteId) {
        EngagementPlan plan = requirePlan(planId, instituteId);
        plan.setStatus(EngagementEnums.PlanStatus.DELETED.name());
        plan.setUpdatedAt(now());
        planRepository.save(plan);
    }

    @Transactional
    public EngagementSlotDTO upsertSlot(String planId, EngagementSlotRequest request, String instituteId) {
        EngagementPlan plan = requirePlan(planId, instituteId);
        EngagementSlot slot = upsertSlot(plan, request);
        List<EngagementItem> items = itemRepository.findActiveBySlot(slot.getId());
        List<String> itemIds = new ArrayList<>();
        for (EngagementItem item : items) itemIds.add(item.getId());
        String psId = plan.getPackageSessionId();
        Long learnerCount = psId == null ? null
                : learnerCounts(List.of(psId)).getOrDefault(psId, 0L);
        return toSlotDto(plan, slot, items, completedCounts(itemIds), learnerCount);
    }

    @Transactional
    public void deleteSlot(String slotId, String instituteId) {
        EngagementSlot slot = slotRepository.findById(slotId)
                .orElseThrow(() -> new VacademyException("Slot not found"));
        requirePlan(slot.getPlanId(), instituteId);
        slot.setStatus(EngagementEnums.SlotStatus.DELETED.name());
        slot.setUpdatedAt(now());
        slotRepository.save(slot);
    }

    /**
     * The plan with its active slots and items (admin view, unredacted), plus the list
     * summary fields. A fixed number of queries: slots, items, completion counts,
     * batch label, batch size and today's learners — not one per item.
     */
    @Transactional(readOnly = true)
    public EngagementPlanDTO getPlan(String planId, String instituteId) {
        EngagementPlan plan = requirePlan(planId, instituteId);
        List<EngagementSlot> slots = slotRepository.findActiveByPlan(planId);

        Map<String, List<EngagementItem>> itemsBySlot = new LinkedHashMap<>();
        for (EngagementSlot slot : slots) itemsBySlot.put(slot.getId(), new ArrayList<>());
        List<String> itemIds = new ArrayList<>();
        if (!slots.isEmpty()) {
            List<String> slotIds = new ArrayList<>(itemsBySlot.keySet());
            for (EngagementItem item : itemRepository.findActiveBySlots(slotIds)) {
                List<EngagementItem> bucket = itemsBySlot.get(item.getSlotId());
                if (bucket == null) continue;
                bucket.add(item);
                itemIds.add(item.getId());
            }
        }
        Map<String, Long> completed = completedCounts(itemIds);
        String psId = plan.getPackageSessionId();
        Map<String, Long> learners = learnerCounts(psId == null ? List.of() : List.of(psId));
        Long learnerCount = psId == null ? null : learners.getOrDefault(psId, 0L);

        List<EngagementSlotDTO> slotDtos = new ArrayList<>();
        Map<String, Long> itemCountBySlot = new HashMap<>();
        for (EngagementSlot slot : slots) {
            List<EngagementItem> items = itemsBySlot.get(slot.getId());
            itemCountBySlot.put(slot.getId(), (long) items.size());
            slotDtos.add(toSlotDto(plan, slot, items, completed, learnerCount));
        }

        EngagementPlanDTO dto = toPlanDto(plan, slotDtos);
        PlanSchedule schedule = summarize(slots, itemCountBySlot, plan.isRelative() ? null : todayFor(plan),
                scheduleResolver);
        Map<String, long[]> todayLearners = todayLearnerCounts(schedule.todaySlotIds());
        applySummary(dto, plan, schedule, labels(psId == null ? List.of() : List.of(psId)).get(psId),
                learnerCount, todayLearners.get(plan.getId()));
        return dto;
    }

    /**
     * Today's behaviour, unchanged: every non-deleted plan of the institute (or of one
     * batch), newest first, with no slots. Each DTO now also carries the summary fields.
     */
    @Transactional(readOnly = true)
    public List<EngagementPlanDTO> listPlans(String instituteId, String packageSessionId) {
        return listPlans(instituteId, packageSessionId, null, null, null, null, null).plans();
    }

    /**
     * The plan list with optional filters.
     *
     * @param status   comma-separated; each value matches the derived todayState
     *                 (DRAFT, UPCOMING, RUNNING, ENDED, ARCHIVED) or the stored status
     *                 (e.g. PUBLISHED). Case-insensitive. Null/blank = no filter.
     * @param q        case-insensitive substring of the title or the batch label.
     * @param sort     CREATED (default, newest first), START_DATE (earliest first date
     *                 first, plans with no days last) or TITLE.
     * @param page     0-based. Paging applies only when page or size is given.
     * @param size     page size, default 20, clamped to 1..100.
     *
     * With every optional argument null this returns exactly what it always did (the
     * deployed admin list calls it that way), plus the additive summary fields.
     * {@code total} is the filtered count before paging.
     */
    @Transactional(readOnly = true)
    public PlanListResult listPlans(String instituteId, String packageSessionId, String status,
                                    String q, String sort, Integer page, Integer size) {
        List<EngagementPlan> found = (packageSessionId == null || packageSessionId.isBlank())
                ? planRepository.findByInstitute(instituteId)
                : planRepository.findByPackageSession(packageSessionId);
        List<EngagementPlan> plans = new ArrayList<>();
        for (EngagementPlan plan : found) {
            if (Objects.equals(plan.getInstituteId(), instituteId)) plans.add(plan);
        }

        List<EngagementPlanDTO> out = summarizeForList(plans);

        Set<String> statuses = parseStatusFilter(status);
        String needle = q == null || q.isBlank() ? null : q.strip().toLowerCase(Locale.ROOT);
        if (!statuses.isEmpty() || needle != null) {
            List<EngagementPlanDTO> filtered = new ArrayList<>();
            for (EngagementPlanDTO dto : out) {
                if (!statuses.isEmpty()
                        && !statuses.contains(upper(dto.getTodayState()))
                        && !statuses.contains(upper(dto.getStatus()))) continue;
                if (needle != null && !contains(dto.getTitle(), needle)
                        && !contains(dto.getPackageSessionLabel(), needle)) continue;
                filtered.add(dto);
            }
            out = filtered;
        }

        String sortKey = sort == null ? "" : sort.strip().toUpperCase(Locale.ROOT);
        if ("START_DATE".equals(sortKey)) {
            out = new ArrayList<>(out);
            out.sort(Comparator.comparing(EngagementPlanDTO::getFirstDate,
                    Comparator.nullsLast(Comparator.naturalOrder())));
        } else if ("TITLE".equals(sortKey)) {
            out = new ArrayList<>(out);
            out.sort(Comparator.comparing(d -> d.getTitle() == null ? "" : d.getTitle().toLowerCase(Locale.ROOT)));
        }

        int total = out.size();
        if (page == null && size == null) {
            return new PlanListResult(out, total, 0, total);
        }
        int pageSize = size == null ? DEFAULT_PAGE_SIZE : Math.max(1, Math.min(MAX_PAGE_SIZE, size));
        int pageNo = page == null ? 0 : Math.max(0, page);
        long from = (long) pageNo * pageSize;
        out = from >= total ? List.of()
                : new ArrayList<>(out.subList((int) from, (int) Math.min(total, from + pageSize)));
        return new PlanListResult(out, total, pageNo, pageSize);
    }

    /**
     * A page of the plan list plus the filtered total (before paging). {@code page} and
     * {@code size} are the values actually applied (size = total when not paged).
     */
    public record PlanListResult(List<EngagementPlanDTO> plans, int total, int page, int size) {
        /** The paged response body: {content, page, size, totalRows, totalPages}. */
        public PlanListPage toPage() {
            int pages = size <= 0 ? 1 : Math.max(1, (int) Math.ceil(total / (double) size));
            return new PlanListPage(plans, page, size, total, pages);
        }
    }

    /** JSON body of a paged /plan/list call. */
    public record PlanListPage(List<EngagementPlanDTO> content, int page, int size, long totalRows,
                               int totalPages) {}

    // ── list summary ─────────────────────────────────────────────────────────

    static final int DEFAULT_PAGE_SIZE = 20;
    static final int MAX_PAGE_SIZE = 100;
    /** IN-list chunk size; keeps every query far below the bind-parameter limit. */
    private static final int IN_CHUNK = 500;
    /** Per-slot date walk cap (~3 years); longer ranges still get exact first/last dates. */
    static final int MAX_DAYS_SCANNED = 1100;

    /**
     * Summary DTOs (no slots) for many plans with a constant number of queries:
     * one for all slots, one for their item counts, one for batch labels, one for batch
     * sizes and one for today's learners — each chunked only past 500 ids.
     */
    private List<EngagementPlanDTO> summarizeForList(List<EngagementPlan> plans) {
        if (plans.isEmpty()) return new ArrayList<>();
        List<String> planIds = new ArrayList<>();
        Set<String> psIds = new java.util.LinkedHashSet<>();
        for (EngagementPlan plan : plans) {
            planIds.add(plan.getId());
            if (plan.getPackageSessionId() != null) psIds.add(plan.getPackageSessionId());
        }

        Map<String, List<EngagementSlot>> slotsByPlan = new HashMap<>();
        List<String> slotIds = new ArrayList<>();
        for (List<String> chunk : chunks(planIds)) {
            for (EngagementSlot slot : planRepository.findActiveSlotsForPlans(chunk)) {
                slotsByPlan.computeIfAbsent(slot.getPlanId(), k -> new ArrayList<>()).add(slot);
                slotIds.add(slot.getId());
            }
        }
        Map<String, Long> itemCountBySlot = new HashMap<>();
        for (List<String> chunk : chunks(slotIds)) {
            for (Object[] row : planRepository.countActiveItemsBySlots(chunk)) {
                itemCountBySlot.put((String) row[0], toLong(row[1]));
            }
        }
        Map<String, String> labels = labels(new ArrayList<>(psIds));
        Map<String, Long> learners = learnerCounts(new ArrayList<>(psIds));

        Map<String, PlanSchedule> schedules = new HashMap<>();
        List<String> todaySlotIds = new ArrayList<>();
        for (EngagementPlan plan : plans) {
            PlanSchedule schedule = summarize(slotsByPlan.getOrDefault(plan.getId(), List.of()),
                    itemCountBySlot, plan.isRelative() ? null : todayFor(plan), scheduleResolver);
            schedules.put(plan.getId(), schedule);
            todaySlotIds.addAll(schedule.todaySlotIds());
        }
        Map<String, long[]> todayLearners = todayLearnerCounts(todaySlotIds);

        List<EngagementPlanDTO> out = new ArrayList<>();
        for (EngagementPlan plan : plans) {
            EngagementPlanDTO dto = toPlanDto(plan, List.of());
            String psId = plan.getPackageSessionId();
            applySummary(dto, plan, schedules.get(plan.getId()), psId == null ? null : labels.get(psId),
                    psId == null ? null : learners.getOrDefault(psId, 0L), todayLearners.get(plan.getId()));
            out.add(dto);
        }
        return out;
    }

    /**
     * Schedule facts for one plan, computed from already-loaded slots — no queries.
     *
     * @param todaySlotIds the active slots that run on {@code today}
     */
    public record PlanSchedule(LocalDate firstDate, LocalDate lastDate, int dayCount, int slotCount,
                               int taskCount, int todayTaskCount, List<String> todaySlotIds) {}

    /**
     * Pure: dates a slot runs on honour its weekday mask. Exposed for tests.
     */
    public static PlanSchedule summarize(List<EngagementSlot> slots, Map<String, Long> itemCountBySlot,
                                         LocalDate today, EngagementScheduleResolver resolver) {
        Set<LocalDate> days = new TreeSet<>();
        LocalDate first = null;
        LocalDate last = null;
        long tasks = 0;
        long todayTasks = 0;
        List<String> todaySlotIds = new ArrayList<>();
        for (EngagementSlot slot : slots) {
            long items = itemCountBySlot == null ? 0 : itemCountBySlot.getOrDefault(slot.getId(), 0L);
            tasks += items;
            LocalDate start = slot.getStartDate();
            LocalDate end = slot.effectiveEndDate();
            if (start == null || end == null || end.isBefore(start)) continue;

            LocalDate slotFirst = null;
            LocalDate cursor = start;
            for (int i = 0; i < 7 && !cursor.isAfter(end); i++, cursor = cursor.plusDays(1)) {
                if (resolver.runsOn(slot, cursor)) { slotFirst = cursor; break; }
            }
            if (slotFirst == null) continue;   // the weekday mask never matches in range
            LocalDate slotLast = resolver.mostRecentRunDate(slot, end);

            int scanned = 0;
            for (LocalDate d = slotFirst; !d.isAfter(end) && scanned < MAX_DAYS_SCANNED;
                 d = d.plusDays(1), scanned++) {
                if (resolver.runsOn(slot, d)) days.add(d);
            }
            if (first == null || slotFirst.isBefore(first)) first = slotFirst;
            if (slotLast != null && (last == null || slotLast.isAfter(last))) last = slotLast;

            if (today != null && resolver.runsOn(slot, today)) {
                todayTasks += items;
                todaySlotIds.add(slot.getId());
            }
        }
        return new PlanSchedule(first, last, days.size(), slots.size(), (int) tasks, (int) todayTasks,
                todaySlotIds);
    }

    /**
     * DRAFT and ARCHIVED come from the stored status. A published plan is UPCOMING
     * before its first day (or when it has no days yet), RUNNING from its first to its
     * last day inclusive (gap days included), and ENDED after.
     */
    public static String todayState(String status, PlanSchedule schedule, LocalDate today) {
        if (EngagementEnums.PlanStatus.ARCHIVED.name().equals(status)) return "ARCHIVED";
        if (!EngagementEnums.PlanStatus.PUBLISHED.name().equals(status)) return "DRAFT";
        if (schedule == null || schedule.firstDate() == null || today == null) return "UPCOMING";
        if (today.isBefore(schedule.firstDate())) return "UPCOMING";
        if (schedule.lastDate() != null && today.isAfter(schedule.lastDate())) return "ENDED";
        return "RUNNING";
    }

    private void applySummary(EngagementPlanDTO dto, EngagementPlan plan, PlanSchedule schedule,
                              String label, Long learnerCount, long[] todayLearners) {
        LocalDate today = todayFor(plan);
        dto.setPackageSessionLabel(label);
        dto.setToday(today.toString());
        dto.setLearnerCount(learnerCount);
        if (schedule != null) {
            dto.setFirstDate(schedule.firstDate() == null ? null : schedule.firstDate().toString());
            dto.setLastDate(schedule.lastDate() == null ? null : schedule.lastDate().toString());
            dto.setDayCount(schedule.dayCount());
            dto.setSlotCount(schedule.slotCount());
            dto.setTaskCount(schedule.taskCount());
            dto.setTodayTaskCount(schedule.todayTaskCount());
        }
        dto.setTodayState(todayState(plan.getStatus(), schedule, today));
        if (plan.isRelative()) {
            // Every learner is on their own day: no shared first/last date or "today".
            dto.setFirstDate(null);
            dto.setLastDate(null);
            dto.setLastDay(schedule == null || schedule.lastDate() == null ? null
                    : (int) java.time.temporal.ChronoUnit.DAYS.between(EngagementRelativeSchedule.VIRTUAL_DAY_ONE,
                            schedule.lastDate()) + 1);
            dto.setTodayTaskCount(null);
            if (EngagementEnums.PlanStatus.PUBLISHED.name().equals(plan.getStatus())) dto.setTodayState("RUNNING");
        }
        boolean runsToday = schedule != null && !schedule.todaySlotIds().isEmpty();
        dto.setTodayStartedLearners(runsToday ? (todayLearners == null ? 0L : todayLearners[0]) : null);
        dto.setTodayCompletedLearners(runsToday ? (todayLearners == null ? 0L : todayLearners[1]) : null);
    }

    private LocalDate todayFor(EngagementPlan plan) {
        return LocalDate.now(scheduleResolver.zoneOf(plan));
    }

    private Map<String, Long> completedCounts(List<String> itemIds) {
        Map<String, Long> out = new HashMap<>();
        for (List<String> chunk : chunks(itemIds)) {
            for (Object[] row : attemptRepository.countCompletedForItems(chunk)) {
                out.put((String) row[0], toLong(row[1]));
            }
        }
        return out;
    }

    private Map<String, Long> learnerCounts(List<String> packageSessionIds) {
        Map<String, Long> out = new HashMap<>();
        for (List<String> chunk : chunks(packageSessionIds)) {
            for (Object[] row : planRepository.countActiveLearnersByPackageSessions(chunk)) {
                out.put((String) row[0], toLong(row[1]));
            }
        }
        return out;
    }

    /** planId -> [learners with any attempt, learners with a completion] on the given slots. */
    private Map<String, long[]> todayLearnerCounts(List<String> slotIds) {
        Map<String, long[]> out = new HashMap<>();
        for (List<String> chunk : chunks(slotIds)) {
            for (Object[] row : planRepository.countLearnersBySlotsGroupedByPlan(chunk)) {
                long[] acc = out.computeIfAbsent((String) row[0], k -> new long[2]);
                // A plan's today-slots can span two chunks; summing may then overcount a
                // learner seen in both, which only happens past 500 slots running today.
                acc[0] += toLong(row[1]);
                acc[1] += toLong(row[2]);
            }
        }
        return out;
    }

    /** packageSessionId -> label: the batch's own name, else "Course · Session · Level". */
    private Map<String, String> labels(List<String> packageSessionIds) {
        Map<String, String> out = new HashMap<>();
        for (List<String> chunk : chunks(packageSessionIds)) {
            for (Object[] row : planRepository.findPackageSessionLabelParts(chunk)) {
                out.put((String) row[0], batchLabel((String) row[1], (String) row[2], (String) row[3],
                        (String) row[4]));
            }
        }
        return out;
    }

    /**
     * The batch's own name when it has one; otherwise course, session and level joined
     * by " · ", skipping blanks and the placeholder "DEFAULT".
     */
    public static String batchLabel(String name, String packageName, String sessionName, String levelName) {
        if (name != null && !name.isBlank()) return name.strip();
        List<String> parts = new ArrayList<>();
        for (String part : new String[] {packageName, sessionName, levelName}) {
            if (part == null || part.isBlank() || "DEFAULT".equalsIgnoreCase(part.strip())) continue;
            parts.add(part.strip());
        }
        if (parts.isEmpty()) return packageName == null || packageName.isBlank() ? null : packageName.strip();
        return String.join(" · ", parts);
    }

    private static Set<String> parseStatusFilter(String raw) {
        Set<String> out = new HashSet<>();
        if (raw == null || raw.isBlank()) return out;
        for (String part : raw.split(",")) {
            if (!part.isBlank()) out.add(part.strip().toUpperCase(Locale.ROOT));
        }
        return out;
    }

    private static String upper(String s) {
        return s == null ? "" : s.toUpperCase(Locale.ROOT);
    }

    private static boolean contains(String haystack, String lowerNeedle) {
        return haystack != null && haystack.toLowerCase(Locale.ROOT).contains(lowerNeedle);
    }

    private static long toLong(Object value) {
        return value instanceof Number n ? n.longValue() : 0L;
    }

    private static List<List<String>> chunks(List<String> ids) {
        List<List<String>> out = new ArrayList<>();
        if (ids == null || ids.isEmpty()) return out;
        for (int i = 0; i < ids.size(); i += IN_CHUNK) {
            out.add(ids.subList(i, Math.min(ids.size(), i + IN_CHUNK)));
        }
        return out;
    }

    // ── internals ────────────────────────────────────────────────────────────

    private EngagementSlot upsertSlot(EngagementPlan plan, EngagementSlotRequest request) {
        EngagementSlot slot = (request.getId() == null || request.getId().isBlank())
                ? new EngagementSlot()
                : slotRepository.findById(request.getId())
                    .filter(existing -> plan.getId().equals(existing.getPlanId()))
                    // A slot id from another plan (or another institute) must not be moved
                    // into this one: that handed over its tasks, answer keys and tracking.
                    .orElseThrow(() -> new VacademyException("Slot not found"));

        slot.setPlanId(plan.getId());
        slot.setTitle(request.getTitle());
        if (plan.isRelative()) {
            // Days after joining: stored on a virtual calendar (Day 1 = 2000-01-01) so the
            // date columns stay valid; each learner sees it shifted onto their own Day 1.
            int startDay = request.getStartDay() == null ? 0 : request.getStartDay();
            int endDay = request.getEndDay() == null ? startDay : request.getEndDay();
            if (startDay < 1 || startDay > MAX_RELATIVE_DAY) {
                throw new VacademyException("Pick a start day between 1 and " + MAX_RELATIVE_DAY + ".");
            }
            if (endDay < startDay || endDay > MAX_RELATIVE_DAY) {
                throw new VacademyException("The last day must be between the start day and " + MAX_RELATIVE_DAY + ".");
            }
            slot.setStartDay(startDay);
            slot.setEndDay(endDay);
            slot.setStartDate(EngagementRelativeSchedule.virtualDate(startDay));
            slot.setEndDate(EngagementRelativeSchedule.virtualDate(endDay));
        } else {
            slot.setStartDay(null);
            slot.setEndDay(null);
            slot.setStartDate(parseDate(request.getStartDate(), "startDate"));
            slot.setEndDate(request.getEndDate() == null || request.getEndDate().isBlank()
                    ? null : parseDate(request.getEndDate(), "endDate"));
        }
        slot.setStartTime(parseTime(request.getStartTime(), "startTime"));
        slot.setEndTime(parseTime(request.getEndTime(), "endTime"));
        // Days after joining are consecutive; a weekday mask does not apply.
        slot.setDowMask(plan.isRelative() ? null : request.getDowMask());
        slot.setRevealTime(request.getRevealTime() == null || request.getRevealTime().isBlank()
                ? null : parseTime(request.getRevealTime(), "revealTime"));
        slot.setNotifyTime(request.getNotifyTime() == null || request.getNotifyTime().isBlank()
                ? null : parseTime(request.getNotifyTime(), "notifyTime"));
        slot.setSortOrder(request.getSortOrder() == null ? 0 : request.getSortOrder());
        slot.setUpdatedAt(now());

        validateSlot(slot);
        slot = slotRepository.save(slot);

        if (request.getItems() != null) {
            // Track what this call actually wrote, so anything else still active in the
            // slot can be retired below without guessing from timestamps.
            Set<String> touched = new HashSet<>();
            for (EngagementItemRequest itemRequest : request.getItems()) {
                touched.add(upsertItem(plan, slot, itemRequest));
            }
            retireItemsNotIn(slot, touched);
        }
        return slot;
    }

    /**
     * Soft-delete the slot's items this save did not write.
     *
     * An edit that removes a task has to remove it for learners too — otherwise the
     * composer shows three tasks, the teacher deletes one, saves, and learners keep
     * seeing all three. Attempts are left untouched: points already earned stay
     * earned and the tracking row stays readable.
     */
    /**
     * Windows crossing midnight are rejected rather than supported: a 10 PM - 2 AM
     * window is not a real use case and would complicate every date resolution.
     * The DB carries the same CHECK constraint. (Dropped by mistake in the plan-edit
     * change while its call site stayed, which left main uncompilable.)
     */
    private void validateSlot(EngagementSlot slot) {
        if (!slot.getEndTime().isAfter(slot.getStartTime())) {
            throw new VacademyException("endTime must be after startTime (windows cannot cross midnight)");
        }
        if (slot.getEndDate() != null && slot.getEndDate().isBefore(slot.getStartDate())) {
            throw new VacademyException("endDate cannot be before startDate");
        }
        LocalTime reveal = slot.getRevealTime();
        if (reveal != null && reveal.isBefore(slot.getStartTime())) {
            throw new VacademyException("revealTime cannot be before startTime");
        }
    }

    private void retireItemsNotIn(EngagementSlot slot, Set<String> touchedItemIds) {
        for (EngagementItem existing : itemRepository.findActiveBySlot(slot.getId())) {
            if (touchedItemIds.contains(existing.getId())) continue;
            existing.setStatus(EngagementEnums.ItemStatus.DELETED.name());
            existing.setUpdatedAt(now());
            itemRepository.save(existing);
            log.info("[engagement] item {} removed from slot {} by an edit",
                    existing.getId(), slot.getId());
        }
    }

    /**
     * Create or update an item.
     *
     * The composer re-sends every task on every save, so most saves change nothing.
     * An unchanged task is left exactly as it is (only its order and schedule
     * overrides are updated). A real change is versioned IN PLACE: same id, version
     * + 1, so learners who already finished stay finished and their attempts, points
     * and tracking rows stay attached. The old rule retired the row and re-issued it
     * under a new id on any save once anyone had opened it — a no-op save wiped
     * completions and let learners earn the points again.
     *
     * Once learners have answered, the answer key itself is frozen (see
     * EngagementItemChangePolicy.guardAnswerKey).
     */
    private String upsertItem(EngagementPlan plan, EngagementSlot slot, EngagementItemRequest request) {
        boolean isNew = request.getId() == null || request.getId().isBlank();
        EngagementEnums.ItemType type = safeItemType(request.getItemType());
        // FLASHCARDS: validate + canonicalise the deck and apply the server-forced fields
        // BEFORE the no-op compare, so an unchanged deck re-saved with reordered keys
        // (or different client values for the forced fields) is still a no-op.
        EngagementItemChangePolicy.normalizeRequest(type, request, objectMapper);

        if (isNew) {
            EngagementItemChangePolicy.validate(type, request, objectMapper);
            EngagementItem item = new EngagementItem();
            applyItemRequest(item, request, slot);
            return itemRepository.save(item).getId();
        }

        EngagementItem existing = itemRepository.findById(request.getId())
                .orElseThrow(() -> new VacademyException("Item not found"));
        // An item id from another plan (or institute) must not be writable through this
        // one. Moving a task between days of the SAME plan is allowed.
        boolean samePlan = Objects.equals(existing.getSlotId(), slot.getId())
                || slotRepository.findById(existing.getSlotId())
                        .map(owner -> Objects.equals(owner.getPlanId(), plan.getId()))
                        .orElse(false);
        if (!samePlan) {
            throw new VacademyException("Item not found");
        }

        if (!EngagementItemChangePolicy.isLearnerVisibleChange(existing, request, objectMapper)) {
            // Order, day and schedule overrides only; nothing a learner sees or is graded on.
            // Moving a task to another day of the same plan keeps its id and attempts.
            existing.setSlotId(slot.getId());
            existing.setSortOrder(request.getSortOrder() == null ? 0 : request.getSortOrder());
            existing.setMissPolicy(request.getMissPolicy() == null ? null : safeMissPolicy(request.getMissPolicy()));
            existing.setCatchUpDays(request.getCatchUpDays());
            existing.setCatchUpPercent(request.getCatchUpPercent());
            existing.setStatus(EngagementEnums.ItemStatus.ACTIVE.name());
            existing.setUpdatedAt(now());
            return itemRepository.save(existing).getId();
        }

        EngagementItemChangePolicy.guardAnswerKey(existing, request,
                attemptRepository.countCompletedForItem(existing.getId()), objectMapper);
        EngagementItemChangePolicy.validate(type, request, objectMapper);
        int nextVersion = (existing.getVersion() == null ? 1 : existing.getVersion()) + 1;
        applyItemRequest(existing, request, slot);
        existing.setVersion(nextVersion);
        log.info("[engagement] item {} edited — version {}", existing.getId(), nextVersion);
        return itemRepository.save(existing).getId();
    }

    private void applyItemRequest(EngagementItem item, EngagementItemRequest request, EngagementSlot slot) {
        EngagementEnums.ItemType type = safeItemType(request.getItemType());
        item.setSlotId(slot.getId());
        item.setItemType(type.name());
        item.setTitle(request.getTitle() == null ? type.name() : request.getTitle());
        item.setSortOrder(request.getSortOrder() == null ? 0 : request.getSortOrder());
        item.setIsRequired(Boolean.TRUE.equals(request.getIsRequired()));
        item.setContentHtml(request.getContentHtml());
        item.setSlideId(request.getSlideId());
        item.setQuestionId(request.getQuestionId());
        item.setAssessmentId(request.getAssessmentId());
        item.setPayloadJson(request.getPayloadJson());
        item.setCompletionPoints(request.getCompletionPoints() == null ? 0 : request.getCompletionPoints());
        item.setCorrectPoints(request.getCorrectPoints() == null ? 0 : request.getCorrectPoints());
        item.setMaxScore(request.getMaxScore());
        item.setHideResultUntilReveal(Boolean.TRUE.equals(request.getHideResultUntilReveal()));
        // Only types the SERVER can grade are verifiable. A teacher-uploaded game
        // reports its own score and anyone with devtools can report any number.
        // Verifiable = the SERVER can decide the outcome itself. A course slide
        // qualifies: its completion is read from the learner's own progress, not
        // reported by the page.
        // FLASHCARDS is listed explicitly as NOT verifiable: "Got it" is a self-rating,
        // so it pays completion points only.
        item.setIsVerifiable(type != EngagementEnums.ItemType.FLASHCARDS
                && (type == EngagementEnums.ItemType.QUESTION_OF_DAY
                    || type == EngagementEnums.ItemType.QUIZ
                    || type == EngagementEnums.ItemType.COURSE_SLIDE));
        if (type == EngagementEnums.ItemType.FLASHCARDS) {
            // Server-forced whatever the request says (normalizeRequest already applied
            // these; repeated here so no write path can skip them). A hidden result would
            // make toLearnerDto show "result pending" for a deck that has no result.
            item.setCorrectPoints(0);
            item.setHideResultUntilReveal(false);
            item.setMaxScore(FlashcardsPayloadValidator.readTrusted(item.getPayloadJson()).size());
        }
        item.setMissPolicy(request.getMissPolicy() == null ? null : safeMissPolicy(request.getMissPolicy()));
        item.setCatchUpDays(request.getCatchUpDays());
        item.setCatchUpPercent(request.getCatchUpPercent());
        item.setStatus(EngagementEnums.ItemStatus.ACTIVE.name());
        item.setUpdatedAt(now());
    }

    /** Longest "days after joining" a slot may reach. */
    static final int MAX_RELATIVE_DAY = 366;

    private static String safeScheduleMode(String raw) {
        return "RELATIVE".equalsIgnoreCase(raw == null ? "" : raw.trim()) ? "RELATIVE" : "CALENDAR";
    }

    /** The first time a plan goes live; RELATIVE plans start existing learners on this day. */
    private void stampPublished(EngagementPlan plan) {
        if (plan.getPublishedAt() == null
                && EngagementEnums.PlanStatus.PUBLISHED.name().equals(plan.getStatus())) {
            plan.setPublishedAt(now());
        }
    }

    private EngagementPlan requirePlan(String planId, String instituteId) {
        EngagementPlan plan = planRepository.findById(planId)
                .orElseThrow(() -> new VacademyException("Plan not found"));
        // Cross-tenant guard: a plan id from another institute must not be readable.
        if (!Objects.equals(plan.getInstituteId(), instituteId)) {
            throw new VacademyException("Plan not found");
        }
        return plan;
    }

    private EngagementPlanDTO toPlanDto(EngagementPlan plan, List<EngagementSlotDTO> slots) {
        return EngagementPlanDTO.builder()
                .id(plan.getId())
                .instituteId(plan.getInstituteId())
                .packageSessionId(plan.getPackageSessionId())
                .title(plan.getTitle())
                .description(plan.getDescription())
                .subjectId(plan.getSubjectId())
                .status(plan.getStatus())
                .timezone(plan.getTimezone())
                .scheduleMode(plan.getScheduleMode())
                .publishedAt(plan.getPublishedAt() == null ? null : plan.getPublishedAt().toInstant().toString())
                .defaultMissPolicy(plan.getDefaultMissPolicy())
                .defaultCatchUpDays(plan.getDefaultCatchUpDays())
                .defaultCatchUpPercent(plan.getDefaultCatchUpPercent())
                .createdByUserId(plan.getCreatedByUserId())
                .createdAt(plan.getCreatedAt() == null ? null : plan.getCreatedAt().toInstant().toString())
                .slots(slots)
                .build();
    }

    private EngagementSlotDTO toSlotDto(EngagementPlan plan, EngagementSlot slot, List<EngagementItem> slotItems,
                                        Map<String, Long> completedByItem, Long learnerCount) {
        List<EngagementItemDTO> items = new ArrayList<>();
        for (EngagementItem item : slotItems) {
            items.add(EngagementItemDTO.builder()
                    .id(item.getId())
                    .slotId(slot.getId())
                    .planId(plan.getId())
                    .packageSessionId(plan.getPackageSessionId())
                    .itemType(item.getItemType())
                    .title(item.getTitle())
                    .version(item.getVersion())
                    .sortOrder(item.getSortOrder())
                    .isRequired(item.getIsRequired())
                    // Admin view is unredacted — the teacher authored this content.
                    .contentHtml(item.getContentHtml())
                    .slideId(item.getSlideId())
                    .questionId(item.getQuestionId())
                    .assessmentId(item.getAssessmentId())
                    .payloadJson(item.getPayloadJson())
                    .completionPoints(item.getCompletionPoints())
                    .correctPoints(item.getCorrectPoints())
                    .maxScore(item.getMaxScore())
                    .hideResultUntilReveal(item.getHideResultUntilReveal())
                    .completedCount(completedByItem.getOrDefault(item.getId(), 0L))
                    .learnerCount(learnerCount)
                    .missPolicy(item.getMissPolicy())
                    .catchUpDays(item.getCatchUpDays())
                    .catchUpPercent(item.getCatchUpPercent())
                    .build());
        }
        return EngagementSlotDTO.builder()
                .id(slot.getId())
                .planId(slot.getPlanId())
                .title(slot.getTitle())
                .startDate(slot.getStartDate().toString())
                .startDay(slot.getStartDay())
                .endDay(slot.getEndDay())
                .endDate(slot.getEndDate() == null ? null : slot.getEndDate().toString())
                .startTime(slot.getStartTime().toString())
                .endTime(slot.getEndTime().toString())
                .dowMask(slot.getDowMask())
                .revealTime(slot.getRevealTime() == null ? null : slot.getRevealTime().toString())
                .notifyTime(slot.getNotifyTime() == null ? null : slot.getNotifyTime().toString())
                .sortOrder(slot.getSortOrder())
                .status(slot.getStatus())
                .items(items)
                .learnerCount(learnerCount)
                .build();
    }

    private String safeStatus(String raw) {
        if (raw == null || raw.isBlank()) return EngagementEnums.PlanStatus.DRAFT.name();
        try {
            return EngagementEnums.PlanStatus.valueOf(raw).name();
        } catch (Exception e) {
            throw new VacademyException("Unknown plan status: " + raw);
        }
    }

    private String safeMissPolicy(String raw) {
        try {
            return EngagementEnums.MissPolicy.valueOf(raw).name();
        } catch (Exception e) {
            throw new VacademyException("Unknown miss policy: " + raw);
        }
    }

    private EngagementEnums.ItemType safeItemType(String raw) {
        try {
            return EngagementEnums.ItemType.valueOf(raw);
        } catch (Exception e) {
            throw new VacademyException("Unknown item type: " + raw);
        }
    }

    private LocalDate parseDate(String raw, String field) {
        try {
            return LocalDate.parse(raw);
        } catch (Exception e) {
            throw new VacademyException(field + " must be yyyy-MM-dd");
        }
    }

    private LocalTime parseTime(String raw, String field) {
        try {
            return LocalTime.parse(raw);
        } catch (Exception e) {
            throw new VacademyException(field + " must be HH:mm");
        }
    }

    private Timestamp now() {
        return new Timestamp(System.currentTimeMillis());
    }
}
