package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementFeedDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementHistoryDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSubmitRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSubmitResponse;
import vacademy.io.admin_core_service.features.engagement.dto.FlashcardOutcome;
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
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_operation.enums.LearnerOperationSourceEnum;
import vacademy.io.admin_core_service.features.learner_operation.entity.LearnerOperation;
import vacademy.io.admin_core_service.features.learner_operation.repository.LearnerOperationRepository;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Everything the learner side of daily engagement does: feed, open, submit. */
@Service
@RequiredArgsConstructor
@Slf4j
public class EngagementLearnerService {

    /** How many days ahead the locked "coming up" strip looks. */
    private static final int UPCOMING_DAYS = 7;
    private static final int HISTORY_MAX_DAYS = 90;

    /** The feed looks back at least this far for runs still inside catch-up. */
    private static final int CATCH_UP_LOOKBACK_MIN_DAYS = 7;
    private static final int CATCH_UP_LOOKBACK_MAX_DAYS = 30;

    /** Catch-ups shown at once. They sit outside the daily cap, so they get their own. */
    public static final int CATCH_UP_FEED_CAP = 2;

    /** Vote splits and correct rates are shown only from this many answers up. */
    public static final int MIN_RESPONSES_FOR_RESULTS = 5;

    /** Longest {@code excerpt}, in UTF-16 units, ellipsis included. */
    public static final int EXCERPT_MAX = 160;

    /** Flashcards patience gate: per card, floor and ceiling (see {@link #flashcardsMinMs}). */
    static final long FLASHCARDS_MS_PER_CARD = 1_500L;
    static final long FLASHCARDS_MIN_MS = 5_000L;
    static final long FLASHCARDS_MAX_MS = 60_000L;

    /**
     * The progress rows a finished slide can leave behind — one per slide type.
     *
     * A COURSE_SLIDE task is complete when ANY of these reads at or above the
     * threshold, because the teacher picks a slide without caring whether it happens
     * to be a video, a document or a quiz.
     */
    private static final List<String> SLIDE_COMPLETION_OPERATIONS = List.of(
            "PERCENTAGE_DOCUMENT_COMPLETED",
            "PERCENTAGE_VIDEO_WATCHED",
            "PERCENTAGE_QUESTION_COMPLETED",
            "PERCENTAGE_ASSIGNMENT_COMPLETED",
            "PERCENTAGE_QUIZ_COMPLETED",
            "PERCENTAGE_AUDIO_LISTENED",
            "PERCENTAGE_SCORM_COMPLETED",
            "PERCENTAGE_ASSESSMENT_DONE",
            "MARKED_AS_WATCHED");

    /** Percent of a slide that counts as done. */
    private static final double SLIDE_COMPLETE_THRESHOLD = 80.0;

    private static final Pattern HIDDEN_BLOCKS = Pattern.compile(
            "<(script|style|head|template|noscript)\\b[^>]*>.*?</\\1\\s*>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern HTML_COMMENT = Pattern.compile("<!--.*?-->", Pattern.DOTALL);
    private static final Pattern TAG = Pattern.compile("<[^>]*>");
    private static final Pattern NUMERIC_ENTITY = Pattern.compile("&#(x[0-9a-fA-F]{1,6}|[0-9]{1,7});");
    private static final Pattern WHITESPACE = Pattern.compile("[\\s\\u00A0\\u2000-\\u200B\\u202F\\u205F\\u3000\\uFEFF]+");

    private final EngagementPlanRepository planRepository;
    private final EngagementSlotRepository slotRepository;
    private final EngagementItemRepository itemRepository;
    private final EngagementAttemptRepository attemptRepository;
    private final EngagementScheduleResolver scheduleResolver;
    private final EngagementSettingsService settingsService;
    private final PointsLedgerService pointsLedgerService;
    private final StudentSessionInstituteGroupMappingRepository enrollmentRepository;
    private final LearnerOperationRepository learnerOperationRepository;
    private final vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository packageSessionRepository;
    private final ObjectMapper objectMapper;
    /**
     * Read in the caller's transaction so settle-on-read can skip an already-paid bonus
     * without {@link PointsLedgerService#award}'s REQUIRES_NEW taking a second pooled
     * connection on every feed read.
     */
    private final PointsLedgerRepository pointsLedgerRepository;
    /** For the one write the read-only feed can make: a settled bonus on the attempt row. */
    private final PlatformTransactionManager transactionManager;
    /** Plans scheduled in days after joining. Optional so hand-built tests need not wire it. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private EngagementRelativeSchedule relativeSchedule;

    /** The service's clock. Every "now" goes through it so tests can pin the time. */
    private Clock clock = Clock.systemUTC();

    /** Test seam: pin "now". Production never calls this. */
    public void setClock(Clock clock) {
        this.clock = clock == null ? Clock.systemUTC() : clock;
    }

    // ── Feed ─────────────────────────────────────────────────────────────────

    /**
     * Today's items across every batch the learner is enrolled in.
     *
     * Items hidden by the daily cap are NOT recorded as missed — a learner in four
     * batches would otherwise accumulate failures for work they were never shown.
     *
     * Read-only, so it stays on the read replica. It also settles, on read, a
     * hidden-result bonus whose reveal has passed but which the reveal job (every 15 min)
     * has not paid yet: the ledger award and the attempt update each run in their own
     * transaction on the primary, only when a bonus is actually due. Idempotent (same
     * ledger key as the job), and it never fails the read.
     */
    @Transactional(readOnly = true)
    public EngagementFeedDTO getFeed(String instituteId, String userId) {
        List<String> packageSessionIds =
                enrollmentRepository.findPackageSessionIdsByUserIdAndInstituteId(userId, instituteId);
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return emptyFeed(null);
        }

        List<EngagementPlan> plans =
                planRepository.findPublishedForPackageSessions(packageSessionIds, instituteId);
        if (plans.isEmpty()) {
            return emptyFeed(null);
        }
        String feedToday = today(plans.get(0)).toString();

        Map<String, EngagementPlan> plansById = new HashMap<>();
        for (EngagementPlan plan : plans) plansById.put(plan.getId(), plan);
        Map<String, String> batchNames = batchNames(plans);

        // The slot query is date-bounded; the plan's own timezone decides which local
        // date that is, so widen by a day on each side and let the resolver judge. It
        // also reaches back over the catch-up window: a one-off slot from three days ago
        // with a three-day catch-up is still doable today and belongs in catchUp[].
        LocalDate utcToday = LocalDate.now(clock.withZone(ZoneId.of("UTC")));
        LocalDate probeFrom = utcToday.minusDays(1L + catchUpLookbackDays(plans));
        LocalDate probeTo = utcToday.plusDays(UPCOMING_DAYS + 1);
        List<EngagementSlot> slots = withRelativeSlots(
                slotRepository.findInRange(new ArrayList<>(plansById.keySet()), probeFrom, probeTo),
                plansById, userId);
        if (slots.isEmpty()) {
            return emptyFeed(feedToday);
        }

        Map<String, EngagementSlot> slotsById = new HashMap<>();
        for (EngagementSlot slot : slots) slotsById.put(slot.getId(), slot);

        List<EngagementItem> items = itemRepository.findActiveBySlots(new ArrayList<>(slotsById.keySet()));
        if (items.isEmpty()) {
            return emptyFeed(feedToday);
        }
        List<String> itemIds = items.stream().map(EngagementItem::getId).toList();

        Map<String, EngagementAttempt> attempts = new HashMap<>();
        for (EngagementAttempt attempt : attemptRepository.findByUserAndItems(userId, itemIds)) {
            attempts.put(attempt.getItemId(), attempt);
        }

        Map<String, Long> completedCounts = new HashMap<>();
        for (Object[] row : attemptRepository.countCompletedForItems(itemIds)) {
            completedCounts.put((String) row[0], ((Number) row[1]).longValue());
        }

        ReadScope scope = new ReadScope(userId, settingsService.snapshot(instituteId));

        List<EngagementItemDTO> todayOpen = new ArrayList<>();
        List<EngagementItemDTO> catchUpAll = new ArrayList<>();
        List<EngagementItemDTO> doneToday = new ArrayList<>();
        List<EngagementItemDTO> upcoming = new ArrayList<>();
        List<EngagementItemDTO> revealed = new ArrayList<>();
        int completedToday = 0;
        int scheduledToday = 0;

        for (EngagementItem item : items) {
            // QUIZ has no authoring or learner path yet; showing it would be a dead card.
            if (EngagementEnums.ItemType.QUIZ.name().equals(item.getItemType())) continue;
            EngagementSlot slot = slotsById.get(item.getSlotId());
            if (slot == null) continue;
            EngagementPlan plan = plansById.get(slot.getPlanId());
            if (plan == null) continue;

            ZonedDateTime now = nowIn(plan);
            LocalDate today = now.toLocalDate();
            EngagementAttempt attempt = attempts.get(item.getId());
            settleRevealBonus(plan, slot, item, attempt, now, false);
            long completedCount = completedCounts.getOrDefault(item.getId(), 0L);

            boolean runsToday = scheduleResolver.runsOn(slot, today);
            boolean isCompleted = isCompleted(attempt);
            if (runsToday) {
                // Every task scheduled today counts, in any state, so the total never
                // moves during the day. A catch-up from an earlier run never runs today.
                scheduledToday++;
                if (isCompleted) completedToday++;
            }

            // Today's occurrence (or the most recent one still inside catch-up). When the
            // slot runs today, today's run wins even before it opens: attempts are per
            // item, so yesterday's run of the same item cannot be caught up separately
            // (the D20 stopgap: no catch-up for a recurring slot whose today-run exists).
            LocalDate runDate = runsToday ? today : scheduleResolver.mostRecentRunDate(slot, today);
            SlotState state = runDate == null ? null
                    : scheduleResolver.stateOn(plan, slot, item, runDate, now);

            if (runDate != null) {
                // The reveal moment: a task this learner completed, whose reveal time
                // has now passed, within the last two days. This is where the answer
                // key and explanation are finally allowed out. Only question and poll
                // items have anything to reveal; a finished reading or game is not news.
                if (isCompleted && hasReveal(item)
                        && scheduleResolver.isRevealed(plan, slot, runDate, now)
                        && !runDate.isBefore(today.minusDays(2))) {
                    EngagementItemDTO shown = toLearnerDto(plan, slot, item, runDate, state, attempt,
                            completedCount, now, scope);
                    shown.setPackageSessionName(batchNames.get(plan.getPackageSessionId()));
                    shown.setCorrectOptionId(readPayloadText(item.getPayloadJson(), "correctOptionId"));
                    shown.setExplanation(readPayloadText(item.getPayloadJson(), "explanation"));
                    shown.setSelectedOptionId(readResponseText(attempt, "selectedOptionId"));
                    if (isKeyedQuestion(item)) {
                        shown.setResponseCount(completedCount);
                        if (completedCount >= MIN_RESPONSES_FOR_RESULTS) {
                            shown.setCorrectRate(
                                    attemptRepository.countCorrectForItem(item.getId()) / (double) completedCount);
                        }
                    }
                    revealed.add(shown);
                }

                if (isCompleted && (runsToday || completedOn(attempt, now.getZone(), today))) {
                    EngagementItemDTO done = toLearnerDto(plan, slot, item, runDate, state, attempt,
                            completedCount, now, scope);
                    done.setPackageSessionName(batchNames.get(plan.getPackageSessionId()));
                    // A summary row (D46): no deployed client reads doneToday, and the
                    // document itself comes from GET item when it is reopened.
                    done.setContentHtml(null);
                    doneToday.add(done);
                }

                if ((state == SlotState.OPEN || state == SlotState.CATCH_UP) && !isCompleted) {
                    EngagementItemDTO dto = toLearnerDto(plan, slot, item, runDate, state, attempt,
                            completedCount, now, scope);
                    dto.setPackageSessionName(batchNames.get(plan.getPackageSessionId()));
                    if (state == SlotState.CATCH_UP) catchUpAll.add(dto);
                    else todayOpen.add(dto);
                    continue;
                }
            }

            // Locked future occurrence — metadata only.
            //
            // Today's run that has not opened yet is listed under today. Otherwise search
            // from TOMORROW when today's occurrence is already spent (closed, or
            // completed above): searching from today would return today's date for any
            // daily slot and park a finished task in "Coming up" with today on it.
            LocalDate nextRun;
            if (runsToday && state == SlotState.UPCOMING && !isCompleted) {
                nextRun = today;
            } else {
                LocalDate searchFrom = (runDate != null && runDate.equals(today)) ? today.plusDays(1) : today;
                nextRun = nextRunDate(slot, searchFrom);
            }
            if (nextRun != null && !nextRun.isAfter(today.plusDays(UPCOMING_DAYS))) {
                upcoming.add(toLearnerDto(plan, slot, item, nextRun, SlotState.UPCOMING, null,
                        completedCount, now, scope));
            }
        }

        // Today: required, then closing soonest, then the item's own order; the cap
        // applies to today only.
        todayOpen.sort(feedOrder());
        int cap = scope.settings.dailyItemCap();
        int hiddenByCap = Math.max(0, todayOpen.size() - cap);
        List<EngagementItemDTO> todayShown = hiddenByCap > 0
                ? new ArrayList<>(todayOpen.subList(0, cap)) : todayOpen;

        // Catch-ups: their own small cap, the window closing soonest first.
        catchUpAll.sort(catchUpOrder());
        List<EngagementItemDTO> catchUpShown = catchUpAll.size() > CATCH_UP_FEED_CAP
                ? new ArrayList<>(catchUpAll.subList(0, CATCH_UP_FEED_CAP)) : catchUpAll;

        List<EngagementItemDTO> legacyItems = new ArrayList<>(todayShown);
        legacyItems.addAll(catchUpShown);
        boolean capApplied = hiddenByCap > 0 || catchUpAll.size() > catchUpShown.size();

        upcoming.sort(Comparator.comparing(EngagementItemDTO::getRunDate,
                        Comparator.nullsLast(Comparator.<String>naturalOrder()))
                .thenComparing(EngagementItemDTO::getOpensAt, Comparator.nullsLast(Comparator.<String>naturalOrder())));

        // Newest reveal first; the learner most wants last night's answer.
        revealed.sort(Comparator.comparing(EngagementItemDTO::getRevealAt,
                Comparator.nullsLast(Comparator.reverseOrder())));
        doneToday.sort(Comparator.comparing(EngagementItemDTO::getCompletedAt,
                Comparator.nullsLast(Comparator.<String>reverseOrder())));

        EngagementFeedDTO feed = new EngagementFeedDTO(legacyItems, upcoming, legacyItems.size(),
                completedToday, capApplied);
        feed.setRevealed(revealed);
        feed.setStreakDays(engagementStreak(userId, instituteId, plansById.values()));
        feed.setScheduledToday(scheduledToday);
        feed.setCatchUp(catchUpShown);
        feed.setDoneToday(doneToday);
        feed.setHiddenByCap(hiddenByCap);
        feed.setCatchUpClosesAt(catchUpShown.stream()
                .map(EngagementItemDTO::getCatchUpClosesAt)
                .filter(Objects::nonNull)
                .min(Comparator.naturalOrder())
                .orElse(null));
        feed.setToday(feedToday);
        feed.setServerTimeMs(clock.millis());
        return feed;
    }

    /**
     * Days before today the feed loads slots from, so a run still inside its catch-up
     * window is found: the longest plan default, at least a week (an item may override
     * its plan), at most {@link #CATCH_UP_LOOKBACK_MAX_DAYS}.
     */
    private static int catchUpLookbackDays(List<EngagementPlan> plans) {
        int days = CATCH_UP_LOOKBACK_MIN_DAYS;
        for (EngagementPlan plan : plans) {
            if (plan.getDefaultCatchUpDays() != null) days = Math.max(days, plan.getDefaultCatchUpDays());
        }
        return Math.min(days, CATCH_UP_LOOKBACK_MAX_DAYS);
    }

    private EngagementFeedDTO emptyFeed(String today) {
        EngagementFeedDTO feed = new EngagementFeedDTO(List.of(), List.of(), 0, 0, false);
        feed.setToday(today);
        feed.setServerTimeMs(clock.millis());
        return feed;
    }

    // ── History ──────────────────────────────────────────────────────────────

    /**
     * Past occurrences for this learner, newest first.
     *
     * An attempt is per item, not per run date, so for a recurring slot the single
     * completion is filed under the occurrence that was in effect when it happened
     * (a late catch-up lands on the day it caught up FOR, not the day it was done).
     * Occurrences after that completion are skipped — the feed never showed them —
     * and earlier ones that have closed count as missed. Today's open tasks stay on
     * the home card, so history only carries today's entries once they are done or
     * closed.
     *
     * CATCH_UP is reported only for the occurrence a learner can actually open now:
     * the item's current run. An older run of a recurring slot is MISSED once a newer
     * run exists, because opening the item opens the newer run (the D20 stopgap).
     */
    @Transactional(readOnly = true)
    public EngagementHistoryDTO getHistory(String instituteId, String userId, int days) {
        int window = Math.max(1, Math.min(days, HISTORY_MAX_DAYS));

        List<String> packageSessionIds =
                enrollmentRepository.findPackageSessionIdsByUserIdAndInstituteId(userId, instituteId);
        List<EngagementPlan> plans = (packageSessionIds == null || packageSessionIds.isEmpty())
                ? List.of()
                : planRepository.findPublishedForPackageSessions(packageSessionIds, instituteId);

        // The window is the institute's own calendar (the first plan's zone), not UTC.
        ZoneId headZone = plans.isEmpty() ? ZoneId.of("UTC") : scheduleResolver.zoneOf(plans.get(0));
        LocalDate headToday = LocalDate.now(clock.withZone(headZone));
        String from = headToday.minusDays(window).toString();
        String to = headToday.toString();
        EngagementHistoryDTO empty = new EngagementHistoryDTO(from, to, List.of(), 0, 0, 0, 0);
        empty.setToday(to);
        empty.setTimezone(headZone.getId());
        if (plans.isEmpty()) return empty;

        Map<String, EngagementPlan> plansById = new HashMap<>();
        for (EngagementPlan plan : plans) plansById.put(plan.getId(), plan);
        Map<String, String> batchNames = batchNames(plans);

        List<EngagementSlot> slots = withRelativeSlots(slotRepository.findInRange(
                new ArrayList<>(plansById.keySet()), headToday.minusDays(window + 1), headToday.plusDays(1)),
                plansById, userId);
        if (slots.isEmpty()) return empty;
        Map<String, EngagementSlot> slotsById = new HashMap<>();
        for (EngagementSlot slot : slots) slotsById.put(slot.getId(), slot);

        List<EngagementItem> items = itemRepository.findActiveBySlots(new ArrayList<>(slotsById.keySet()));
        if (items.isEmpty()) return empty;
        List<String> itemIds = items.stream().map(EngagementItem::getId).toList();

        Map<String, EngagementAttempt> attempts = new HashMap<>();
        for (EngagementAttempt attempt : attemptRepository.findByUserAndItems(userId, itemIds)) {
            attempts.put(attempt.getItemId(), attempt);
        }
        Map<String, Long> completedCounts = new HashMap<>();
        for (Object[] row : attemptRepository.countCompletedForItems(itemIds)) {
            completedCounts.put((String) row[0], ((Number) row[1]).longValue());
        }

        ReadScope scope = new ReadScope(userId, settingsService.snapshot(instituteId));
        List<EngagementItemDTO> out = new ArrayList<>();
        int done = 0, missed = 0, catchUp = 0, points = 0;

        for (EngagementItem item : items) {
            if (EngagementEnums.ItemType.QUIZ.name().equals(item.getItemType())) continue;
            EngagementSlot slot = slotsById.get(item.getSlotId());
            if (slot == null) continue;
            EngagementPlan plan = plansById.get(slot.getPlanId());
            if (plan == null) continue;
            ZonedDateTime now = nowIn(plan);
            ZoneId zone = now.getZone();
            LocalDate today = now.toLocalDate();
            LocalDate first = today.minusDays(window);
            EngagementAttempt attempt = attempts.get(item.getId());
            boolean completed = isCompleted(attempt);
            // The run a GET item would open right now.
            LocalDate currentRun = scheduleResolver.runsOn(slot, today)
                    ? today : scheduleResolver.mostRecentRunDate(slot, today);
            // A recurring item is ONE item across its runs: while its current run can
            // still be answered, an older closed run must not ship the answer key, or the
            // Past tab hands out today's answer (and its bonus).
            SlotState currentState = currentRun == null ? null
                    : scheduleResolver.stateOn(plan, slot, item, currentRun, now);
            // Same while a later run is still to come (today's not open yet, or a coming
            // day): the learner will be able to answer it then.
            boolean answerableNow = !completed
                    && (currentState == SlotState.OPEN || currentState == SlotState.CATCH_UP
                        || hasRunStillToCome(plan, slot, item, today, now));

            // Which occurrence the completion belongs to.
            LocalDate doneRun = null;
            if (completed && attempt.getCompletedAt() != null) {
                LocalDate doneLocal = attempt.getCompletedAt().toInstant().atZone(zone).toLocalDate();
                doneRun = scheduleResolver.mostRecentRunDate(slot, doneLocal);
                if (doneRun != null && Boolean.TRUE.equals(attempt.getIsLate())) {
                    // A late completion is a catch-up for the occurrence BEFORE the
                    // one running on the day it was done, when there was one.
                    LocalDate prior = scheduleResolver.mostRecentRunDate(slot, doneRun.minusDays(1));
                    if (prior != null) doneRun = prior;
                }
            }

            LocalDate last = today.isAfter(slot.effectiveEndDate()) ? slot.effectiveEndDate() : today;
            for (LocalDate run = last; !run.isBefore(first); run = run.minusDays(1)) {
                if (run.isBefore(slot.getStartDate())) break;
                if (!scheduleResolver.runsOn(slot, run)) continue;
                SlotState state = scheduleResolver.stateOn(plan, slot, item, run, now);
                if (state == SlotState.UPCOMING) continue;

                String status;
                if (completed && doneRun != null && run.equals(doneRun)) {
                    status = "DONE";
                } else if (completed && doneRun != null && run.isAfter(doneRun)) {
                    continue; // already done — the feed never asked for this occurrence
                } else if (state == SlotState.OPEN) {
                    continue; // still on the home card
                } else if (state == SlotState.CATCH_UP && !completed && run.equals(currentRun)) {
                    status = "CATCH_UP";
                } else {
                    status = "MISSED";
                }

                EngagementItemDTO dto = toLearnerDto(plan, slot, item, run, state,
                        "DONE".equals(status) ? attempt : null,
                        completedCounts.getOrDefault(item.getId(), 0L), now, scope);
                dto.setPackageSessionName(batchNames.get(plan.getPackageSessionId()));
                dto.setHistoryStatus(status);
                // History is a summary; the document itself is fetched on open.
                dto.setContentHtml(null);
                if ("DONE".equals(status)) {
                    done++;
                    points += attempt.getPointsAwarded() == null ? 0 : attempt.getPointsAwarded();
                    if (scheduleResolver.isRevealed(plan, slot, run, now)) {
                        dto.setCorrectOptionId(readPayloadText(item.getPayloadJson(), "correctOptionId"));
                        dto.setExplanation(readPayloadText(item.getPayloadJson(), "explanation"));
                    }
                } else if ("CATCH_UP".equals(status)) {
                    catchUp++;
                } else {
                    if (answerableNow) {
                        dto.setPayloadJson(redactPayload(item.getPayloadJson(), false));
                    }
                    // Not doable any more: nothing to earn from it.
                    dto.setEarnablePoints(null);
                    dto.setEffectivePoints(null);
                    dto.setPendingBonus(null);
                    dto.setClaimable(null);
                    missed++;
                }
                out.add(dto);
            }
        }

        out.sort(Comparator.comparing(EngagementItemDTO::getRunDate,
                        Comparator.nullsLast(Comparator.<String>reverseOrder()))
                .thenComparing(EngagementItemDTO::getOpensAt,
                        Comparator.nullsLast(Comparator.<String>reverseOrder())));
        EngagementHistoryDTO history = new EngagementHistoryDTO(from, to, out, done, missed, catchUp, points);
        history.setToday(to);
        history.setTimezone(headZone.getId());
        return history;
    }

    /**
     * Required first, then whatever closes soonest, then the item's own order — so a
     * learner in several batches meets a deterministic, urgency-led queue.
     */
    private Comparator<EngagementItemDTO> feedOrder() {
        return Comparator
                .comparing((EngagementItemDTO d) -> !Boolean.TRUE.equals(d.getIsRequired()))
                .thenComparing(EngagementItemDTO::getClosesAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(EngagementItemDTO::getSortOrder, Comparator.nullsLast(Comparator.naturalOrder()));
    }

    /** Catch-ups: required first, then the window that closes soonest, then the item's order. */
    private Comparator<EngagementItemDTO> catchUpOrder() {
        return Comparator
                .comparing((EngagementItemDTO d) -> !Boolean.TRUE.equals(d.getIsRequired()))
                .thenComparing(EngagementItemDTO::getCatchUpClosesAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(EngagementItemDTO::getSortOrder, Comparator.nullsLast(Comparator.naturalOrder()));
    }

    /** Next local date on/after today that the slot runs; null if it never runs again. */
    /** A run of this slot that has not closed yet: today's before or during its window, or a later day's. */
    private boolean hasRunStillToCome(EngagementPlan plan, EngagementSlot slot, EngagementItem item,
                                      LocalDate today, ZonedDateTime now) {
        if (scheduleResolver.runsOn(slot, today)) {
            SlotState state = scheduleResolver.stateOn(plan, slot, item, today, now);
            if (state == SlotState.UPCOMING || state == SlotState.OPEN) return true;
        }
        return nextRunDate(slot, today.plusDays(1)) != null;
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

    // ── Open one item ────────────────────────────────────────────────────────

    /**
     * Full payload for an item the learner may actually open right now.
     *
     * Opening is also the start signal: a STARTED attempt is recorded once, and the
     * reading, game and flashcards gates measure from its startedAt on the server.
     * Before this, the gates trusted a timeSpentMs the client made up.
     */
    @Transactional
    public EngagementItemDTO getItem(String itemId, String instituteId, String userId) {
        Context ctx = loadContext(itemId, instituteId, userId);
        rejectUnlessOpen(ctx);
        attemptRepository.insertStartedIfAbsent(java.util.UUID.randomUUID().toString(), itemId,
                ctx.item.getVersion() == null ? 1 : ctx.item.getVersion(), userId, instituteId,
                ctx.plan.getPackageSessionId());
        EngagementAttempt attempt =
                attemptRepository.findByItemIdAndUserId(itemId, userId).orElse(null);
        ZonedDateTime now = nowIn(ctx.plan);
        settleRevealBonus(ctx.plan, ctx.slot, ctx.item, attempt, now, true);
        EngagementItemDTO dto = toLearnerDto(ctx.plan, ctx.slot, ctx.item, ctx.runDate, ctx.state, attempt,
                attemptRepository.countCompletedForItem(itemId), now,
                new ReadScope(userId, settingsService.snapshot(instituteId)));
        dto.setServerTimeMs(clock.millis());
        return dto;
    }

    // ── Submit ───────────────────────────────────────────────────────────────

    /**
     * Complete an item: grade it, write the attempt, award points.
     *
     * The unique index on (item_id, user_id) is the concurrency guard — a
     * double-tapped submit collides there rather than scoring twice — and the
     * ledger's idempotency key is the second line of defence.
     *
     * Refusals throw {@link EngagementRejectedException}: the same 510 and message as
     * before, plus a reasonCode the client can act on.
     */
    @Transactional
    public EngagementSubmitResponse submit(String itemId, String instituteId, String userId,
                                           EngagementSubmitRequest request) {
        Context ctx = loadContext(itemId, instituteId, userId);
        EngagementSubmitRequest req = request == null ? new EngagementSubmitRequest() : request;

        // Idempotency before the window check: a retried submit that lands after the close
        // must still hear "already done", not TASK_CLOSED for work that was saved.
        Optional<EngagementAttempt> existing = attemptRepository.findByItemIdAndUserId(itemId, userId);
        if (existing.isPresent() && isCompleted(existing.get())) {
            return buildResponse(ctx, existing.get(), instituteId, userId, true, null);
        }
        rejectUnlessOpen(ctx);

        EngagementEnums.ItemType type = itemType(ctx.item);
        boolean isLate = ctx.state == SlotState.CATCH_UP;
        ZonedDateTime now = nowIn(ctx.plan);

        Timestamp startedAt = existing.map(EngagementAttempt::getStartedAt).orElse(null);
        EngagementSettingsService.Snapshot settings = settingsService.snapshot(instituteId);
        if (settings == null) settings = EngagementSettingsService.Snapshot.defaults();
        Grade grade = grade(ctx.item, type, req, settings, userId, startedAt);
        if (!grade.accepted) {
            throw new EngagementRejectedException(grade.reasonCode, grade.rejectionReason);
        }

        int points = grade.points;
        boolean revealedAtSubmit = scheduleResolver.isRevealed(ctx.plan, ctx.slot, ctx.runDate, now);
        if (revealedAtSubmit && Boolean.TRUE.equals(grade.isCorrect)) {
            // Once the reveal has passed, the answer is out among classmates who
            // finished. Record the outcome, but only completion points are earned.
            points -= nz(ctx.item.getCorrectPoints());
        }
        boolean withholdResult = Boolean.TRUE.equals(ctx.item.getHideResultUntilReveal())
                && !revealedAtSubmit;
        if (withholdResult && Boolean.TRUE.equals(grade.isCorrect)) {
            // Hold the bonus back to the reveal. Awarding it now would tell the learner
            // they were right through the points, which is the same secret by another
            // route. EngagementRevealJob (or the next feed read) pays it once the reveal passes.
            points -= nz(ctx.item.getCorrectPoints());
        }
        if (isLate) {
            int percent = scheduleResolver.resolveCatchUpPercent(ctx.plan, ctx.item);
            points = (int) Math.floor(points * (percent / 100.0));
        }

        EngagementAttempt attempt = existing.orElseGet(EngagementAttempt::new);
        attempt.setItemId(itemId);
        attempt.setItemVersion(ctx.item.getVersion());
        attempt.setUserId(userId);
        attempt.setInstituteId(instituteId);
        attempt.setPackageSessionId(ctx.plan.getPackageSessionId());
        attempt.setStatus(EngagementEnums.AttemptStatus.COMPLETED.name());
        attempt.setIsCorrect(grade.isCorrect);
        attempt.setScore(grade.score);
        if (grade.maxScore != null) {
            attempt.setMaxScore(grade.maxScore);
        } else {
            attempt.setMaxScore(ctx.item.getMaxScore() == null
                    ? null : BigDecimal.valueOf(ctx.item.getMaxScore()));
        }
        // FLASHCARDS stores only what the server built; the client's extra and score
        // never reach the row.
        attempt.setResponseJson(grade.responseJson != null ? grade.responseJson : buildResponseJson(type, req));
        attempt.setTimeSpentMs(req.getTimeSpentMs());
        attempt.setPointsAwarded(points);
        attempt.setIsLate(isLate);
        attempt.setIsVerified(Boolean.TRUE.equals(ctx.item.getIsVerifiable()));
        if (attempt.getStartedAt() == null) attempt.setStartedAt(now());
        attempt.setCompletedAt(now());
        attempt.setUpdatedAt(now());

        try {
            attempt = attemptRepository.saveAndFlush(attempt);
        } catch (DataIntegrityViolationException e) {
            // Concurrent submit won the race; its row is the authoritative one.
            EngagementAttempt winner = attemptRepository.findByItemIdAndUserId(itemId, userId)
                    .orElseThrow(() -> new VacademyException("Could not record this attempt"));
            return buildResponse(ctx, winner, instituteId, userId, true, null);
        }

        if (points != 0) {
            pointsLedgerService.award(
                    userId,
                    instituteId,
                    ctx.plan.getPackageSessionId(),
                    PointsSourceType.ENGAGEMENT_ITEM,
                    itemId,
                    points,
                    ctx.item.getTitle(),
                    // Version in the key so a re-issued item version can award again,
                    // while a retry of the same submit cannot.
                    "ENGAGEMENT_ITEM:" + itemId + ":v" + ctx.item.getVersion() + ":" + userId);
        }

        return buildResponse(ctx, attempt, instituteId, userId, false,
                grade.isCorrect != null && revealedAtSubmit);
    }

    /** NOT_OPEN before the run opens, TASK_CLOSED once it (and any catch-up) is over. */
    private void rejectUnlessOpen(Context ctx) {
        if (ctx.state == SlotState.UPCOMING) {
            throw new EngagementRejectedException(EngagementRejectedException.NOT_OPEN,
                    "This task is not open yet");
        }
        if (ctx.state == SlotState.CLOSED) {
            throw new EngagementRejectedException(EngagementRejectedException.TASK_CLOSED,
                    "This task has closed");
        }
    }

    /**
     * What the learner actually submitted, kept for the teacher.
     *
     * The grader reads textAnswer/fileIds to decide the outcome, but nothing else
     * stored them — a written answer was validated, graded as "completed", and
     * thrown away. The teacher then had a row saying COMPLETED and no way to read
     * what was written.
     */
    private String buildResponseJson(EngagementEnums.ItemType type, EngagementSubmitRequest request) {
        try {
            ObjectNode node = objectMapper.createObjectNode();
            if (request.getSelectedOptionId() != null) node.put("selectedOptionId", request.getSelectedOptionId());
            if (request.getTextAnswer() != null && !request.getTextAnswer().isBlank()) {
                node.put("textAnswer", request.getTextAnswer().trim());
            }
            if (request.getFileIds() != null && !request.getFileIds().isEmpty()) {
                ArrayNode files = node.putArray("fileIds");
                request.getFileIds().forEach(files::add);
            }
            if (request.getScore() != null) node.put("score", request.getScore());
            if (request.getScrollPercent() != null) node.put("scrollPercent", request.getScrollPercent());
            // Anything the client chose to attach as free-form extra.
            if (request.getResponseJson() != null && !request.getResponseJson().isBlank()) {
                try {
                    node.set("extra", objectMapper.readTree(request.getResponseJson()));
                } catch (Exception ignored) {
                    node.put("extra", request.getResponseJson());
                }
            }
            return node.size() == 0 ? null : objectMapper.writeValueAsString(node);
        } catch (Exception e) {
            log.warn("[engagement] could not serialise response for {}: {}", type, e.getMessage());
            return request.getResponseJson();
        }
    }

    // ── Grading ──────────────────────────────────────────────────────────────

    /**
     * A grading outcome. {@code responseJson} and {@code maxScore} override what the
     * submit would otherwise store (FLASHCARDS builds both on the server).
     */
    private record Grade(boolean accepted, String reasonCode, String rejectionReason, Boolean isCorrect,
                         BigDecimal score, int points, String responseJson, BigDecimal maxScore) {
        static Grade reject(String code, String reason) {
            return new Grade(false, code, reason, null, null, 0, null, null);
        }
        static Grade of(Boolean correct, BigDecimal score, int points) {
            return new Grade(true, null, null, correct, score, points, null, null);
        }
    }

    private Grade grade(EngagementItem item, EngagementEnums.ItemType type,
                        EngagementSubmitRequest request, EngagementSettingsService.Snapshot settings,
                        String userId, Timestamp startedAt) {
        int completion = item.getCompletionPoints() == null ? 0 : item.getCompletionPoints();
        // Measured from the STARTED row written when the learner opened the item. A
        // missing row means the item was never opened through getItem.
        long serverElapsedMs = startedAt == null ? -1 : clock.millis() - startedAt.getTime();

        switch (type) {
            case QUESTION_OF_DAY -> {
                String format = questionFormat(item);
                if ("TEXT".equals(format)) {
                    // Nothing to grade against: a written answer is read by the teacher
                    // in the tracking table, so it earns completion points only.
                    if (request.getTextAnswer() == null || request.getTextAnswer().isBlank()) {
                        return Grade.reject(EngagementRejectedException.ANSWER_REQUIRED, "Write your answer first");
                    }
                    return Grade.of(null, null, completion);
                }
                if ("UPLOAD".equals(format)) {
                    if (request.getFileIds() == null || request.getFileIds().isEmpty()) {
                        return Grade.reject(EngagementRejectedException.ANSWER_REQUIRED, "Attach your answer first");
                    }
                    return Grade.of(null, null, completion);
                }

                String correctOptionId = readPayloadText(item.getPayloadJson(), "correctOptionId");
                if (correctOptionId == null) {
                    // Nothing to grade against — treat as completion-only rather than
                    // silently marking every learner wrong.
                    log.warn("[engagement] item {} has no correctOptionId; scoring completion only", item.getId());
                    return Grade.of(null, null, completion);
                }
                if (request.getSelectedOptionId() == null || request.getSelectedOptionId().isBlank()) {
                    return Grade.reject(EngagementRejectedException.ANSWER_REQUIRED, "An answer is required");
                }
                if (!isAuthoredOption(item, request.getSelectedOptionId())) {
                    return Grade.reject(EngagementRejectedException.ANSWER_REQUIRED, "Pick one of the options");
                }
                boolean correct = correctOptionId.equals(request.getSelectedOptionId());
                int points = completion + (correct ? nz(item.getCorrectPoints()) : 0);
                return Grade.of(correct, BigDecimal.valueOf(correct ? 1 : 0), points);
            }
            case READING_HTML, VISUAL_NOTE -> {
                // Dwell + scroll is a patience signal, not a comprehension one. It gates
                // completion points only, and those are kept small by design.
                int scroll = request.getScrollPercent() == null ? 0 : request.getScrollPercent();
                if (serverElapsedMs < 0) {
                    return Grade.reject(EngagementRejectedException.READ_GATE, "Open the reading first");
                }
                // scrollPercent is advisory (the server cannot see the page); the time
                // gate is the server's own clock since the item was opened.
                if (scroll < settings.minScrollPercent() || serverElapsedMs < settings.minReadMs()) {
                    return Grade.reject(EngagementRejectedException.READ_GATE,
                            "Finish reading before marking this complete");
                }
                return Grade.of(null, null, completion);
            }
            case QUIZ -> {
                // No assessment backs a QUIZ item yet, so there is nothing to finish:
                // grading it as a game paid completion for an empty card (D52). The feed
                // and history already leave QUIZ out; this closes a direct submit.
                return Grade.reject(EngagementRejectedException.UNSUPPORTED_TYPE,
                        "This task can't be completed here yet");
            }
            case GAME -> {
                if (serverElapsedMs < 0) {
                    return Grade.reject(EngagementRejectedException.GAME_NOT_FINISHED, "Open the game first");
                }
                if (serverElapsedMs < settings.minGameMs()) {
                    return Grade.reject(EngagementRejectedException.GAME_NOT_FINISHED, "Play the game first");
                }
                double reported = request.getScore() == null ? 0 : request.getScore();
                // Clamp: the page reports its own score and cannot be trusted.
                double max = item.getMaxScore() == null ? reported : item.getMaxScore();
                double clamped = Math.max(0, Math.min(reported, max));
                int points = completion;
                boolean scoreMayEarnPoints = Boolean.TRUE.equals(item.getIsVerifiable())
                        || settings.unverifiedScoreBonusEnabled();
                if (scoreMayEarnPoints && max > 0) {
                    points += (int) Math.round(nz(item.getCorrectPoints()) * (clamped / max));
                }
                return Grade.of(null, BigDecimal.valueOf(clamped), points);
            }
            case COURSE_SLIDE -> {
                // Read the learner's real progress on the slide rather than trusting a
                // "done" tap. A lesson finished the ordinary way in the study library
                // therefore also finishes this task, and nothing is tracked twice.
                if (item.getSlideId() == null || item.getSlideId().isBlank()) {
                    log.warn("[engagement] COURSE_SLIDE item {} has no slideId", item.getId());
                    return Grade.of(null, null, completion);
                }
                if (!hasCompletedSlide(userId, item.getSlideId())) {
                    return Grade.reject(EngagementRejectedException.LESSON_NOT_FINISHED,
                            "Open the lesson and finish it to complete this task");
                }
                return Grade.of(null, null, completion);
            }
            case POLL -> {
                if (request.getSelectedOptionId() == null || request.getSelectedOptionId().isBlank()) {
                    return Grade.reject(EngagementRejectedException.ANSWER_REQUIRED, "Pick an option");
                }
                if (!isAuthoredOption(item, request.getSelectedOptionId())) {
                    // An unknown id would become its own bucket in the poll results.
                    return Grade.reject(EngagementRejectedException.ANSWER_REQUIRED, "Pick one of the options");
                }
                return Grade.of(null, null, completion);
            }
            case FLASHCARDS -> {
                return gradeFlashcards(item, request, completion, serverElapsedMs);
            }
            default -> {
                return Grade.of(null, null, completion);
            }
        }
    }

    /**
     * FLASHCARDS, checked in this order (the first failure wins):
     * <ol>
     *   <li>never opened through GET item (no startedAt) → FLASHCARDS_STALE;</li>
     *   <li>the client studied another version of the deck → FLASHCARDS_STALE;</li>
     *   <li>the outcomes are not exactly the current deck's card ids, once each, each
     *       KNOWN or LEARNING → FLASHCARDS_INCOMPLETE (also what an old app that sends no
     *       outcomes gets, with a hint to update);</li>
     *   <li>sooner than {@link #flashcardsMinMs} since the first open → FLASHCARDS_TOO_FAST.</li>
     * </ol>
     * The time gate is a patience check only: startedAt is the FIRST open ever and is
     * never reset, so a learner who reopens later passes it immediately.
     *
     * <p>Pays completion points only, in every setting: the self-rating is honest effort,
     * not a graded answer. score = cards rated KNOWN, maxScore = the deck size, isCorrect
     * stays null. The stored response is built here from the validated outcomes.
     */
    private Grade gradeFlashcards(EngagementItem item, EngagementSubmitRequest request, int completion,
                                  long serverElapsedMs) {
        if (serverElapsedMs < 0) {
            return Grade.reject(EngagementRejectedException.FLASHCARDS_STALE, "Open the cards first");
        }
        int version = item.getVersion() == null ? 1 : item.getVersion();
        if (request.getItemVersion() != null && request.getItemVersion() != version) {
            return Grade.reject(EngagementRejectedException.FLASHCARDS_STALE,
                    "These cards were just updated. Reloading them now.");
        }

        FlashcardsPayloadValidator.Parsed deck = FlashcardsPayloadValidator.readTrusted(item.getPayloadJson());
        Map<String, String> resultByCard = new LinkedHashMap<>();
        // One outcome per card: a list of any other length can never match, so it is
        // refused before the loop (and a padded list costs nothing to reject).
        boolean wellFormed = request.getCardOutcomes() != null && deck.size() > 0
                && request.getCardOutcomes().size() == deck.size();
        if (wellFormed) {
            for (FlashcardOutcome outcome : request.getCardOutcomes()) {
                String result = outcome == null ? null : normaliseResult(outcome.getResult());
                if (outcome == null || outcome.getCardId() == null || result == null
                        || resultByCard.put(outcome.getCardId(), result) != null) {
                    wellFormed = false;
                    break;
                }
            }
        }
        if (deck.size() == 0) {
            log.warn("[engagement] FLASHCARDS item {} has no readable cards", item.getId());
        }
        if (!wellFormed || !resultByCard.keySet().equals(deck.cardIds())) {
            return Grade.reject(EngagementRejectedException.FLASHCARDS_INCOMPLETE,
                    "Study every card to finish. If you don't see the cards, update the app.");
        }

        if (serverElapsedMs < flashcardsMinMs(deck.size())) {
            return Grade.reject(EngagementRejectedException.FLASHCARDS_TOO_FAST,
                    "Take a moment with each card before finishing");
        }

        int known = 0;
        ObjectNode root = objectMapper.createObjectNode();
        ObjectNode flashcards = root.putObject("flashcards");
        flashcards.put("version", version);
        flashcards.put("total", deck.size());
        ArrayNode outcomes = objectMapper.createArrayNode();
        // Deck order, not submit order, so every stored row reads the same way.
        for (String cardId : deck.cardIds()) {
            String result = resultByCard.get(cardId);
            if (FlashcardOutcome.KNOWN.equals(result)) known++;
            ObjectNode o = outcomes.addObject();
            o.put("cardId", cardId);
            o.put("result", result);
        }
        flashcards.put("known", known);
        flashcards.set("outcomes", outcomes);
        String json;
        try {
            json = objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            // Unreachable for a tree of plain values; refuse rather than store nothing.
            throw new VacademyException("Could not record this attempt");
        }
        return new Grade(true, null, null, null, BigDecimal.valueOf(known), completion, json,
                BigDecimal.valueOf(deck.size()));
    }

    /** max(5 s, min(n × 1.5 s, 60 s)): the least time a deck of n cards can take. */
    static long flashcardsMinMs(int cardCount) {
        return Math.max(FLASHCARDS_MIN_MS, Math.min(cardCount * FLASHCARDS_MS_PER_CARD, FLASHCARDS_MAX_MS));
    }

    private static String normaliseResult(String raw) {
        if (raw == null) return null;
        String value = raw.trim().toUpperCase(Locale.ROOT);
        return FlashcardOutcome.KNOWN.equals(value) || FlashcardOutcome.LEARNING.equals(value) ? value : null;
    }

    /** A field off the learner's stored response, or null. */
    private String readResponseText(EngagementAttempt attempt, String field) {
        if (attempt == null) return null;
        return readPayloadText(attempt.getResponseJson(), field);
    }

    /**
     * Consecutive institute-local days with at least one completed task, ending
     * today or yesterday. Yesterday counts so a learner who has not opened today's
     * task yet still sees the streak they are about to keep, not one already broken.
     */
    private int engagementStreak(String userId, String instituteId, Collection<EngagementPlan> plans) {
        ZoneId zone = plans.stream().findFirst().map(scheduleResolver::zoneOf)
                .orElse(java.time.ZoneId.of("Asia/Kolkata"));
        LocalDate today = LocalDate.now(clock.withZone(zone));
        LocalDate from = today.minusDays(60);
        List<EngagementAttempt> attempts = attemptRepository.findCompletedBetween(
                userId, instituteId,
                Timestamp.from(from.atStartOfDay(zone).toInstant()),
                Timestamp.from(today.plusDays(1).atStartOfDay(zone).toInstant()));
        if (attempts == null) return 0;
        Set<LocalDate> days = new HashSet<>();
        for (EngagementAttempt a : attempts) {
            if (a.getCompletedAt() != null) {
                days.add(a.getCompletedAt().toInstant().atZone(zone).toLocalDate());
            }
        }
        LocalDate cursor = days.contains(today) ? today : today.minusDays(1);
        int streak = 0;
        while (days.contains(cursor) && streak < 365) {
            streak++;
            cursor = cursor.minusDays(1);
        }
        return streak;
    }

    /** MCQ (the default), TEXT or UPLOAD, from the item's payload. */
    private String questionFormat(EngagementItem item) {
        String format = readPayloadText(item.getPayloadJson(), "format");
        return (format == null || format.isBlank()) ? "MCQ" : format.toUpperCase(Locale.ROOT);
    }

    /** A multiple-choice question of the day with an answer key: the only graded type. */
    private boolean isKeyedQuestion(EngagementItem item) {
        return EngagementEnums.ItemType.QUESTION_OF_DAY.name().equals(item.getItemType())
                && "MCQ".equals(questionFormat(item))
                && readPayloadText(item.getPayloadJson(), "correctOptionId") != null;
    }

    /** Only questions (the key) and polls (the split) have anything to reveal. */
    private static boolean hasReveal(EngagementItem item) {
        return EngagementEnums.ItemType.QUESTION_OF_DAY.name().equals(item.getItemType())
                || EngagementEnums.ItemType.POLL.name().equals(item.getItemType());
    }

    /**
     * Can correctPoints still be earned on this item? A keyed question whose answer is
     * not out yet, or a game whose score is trusted. Everything else pays completion only.
     */
    private boolean bonusEnabled(EngagementItem item, boolean answerOut,
                                 EngagementSettingsService.Snapshot settings) {
        if (nz(item.getCorrectPoints()) <= 0) return false;
        String type = item.getItemType();
        if (EngagementEnums.ItemType.QUESTION_OF_DAY.name().equals(type)) {
            return !answerOut && isKeyedQuestion(item);
        }
        if (EngagementEnums.ItemType.GAME.name().equals(type) || EngagementEnums.ItemType.QUIZ.name().equals(type)) {
            return Boolean.TRUE.equals(item.getIsVerifiable()) || settings.unverifiedScoreBonusEnabled();
        }
        return false;
    }

    /** True when any slide-progress row for this learner reads as finished. */
    private boolean hasCompletedSlide(String userId, String slideId) {
        for (String operation : SLIDE_COMPLETION_OPERATIONS) {
            Optional<LearnerOperation> row = learnerOperationRepository
                    .findByUserIdAndSourceAndSourceIdAndOperation(
                            userId, LearnerOperationSourceEnum.SLIDE.name(), slideId, operation);
            if (row == null || row.isEmpty() || row.get().getValue() == null) continue;
            String value = row.get().getValue().trim();
            // MARKED_AS_WATCHED carries a flag; the PERCENTAGE_* rows carry a number.
            if (value.equalsIgnoreCase("true")) return true;
            try {
                if (Double.parseDouble(value) >= SLIDE_COMPLETE_THRESHOLD) return true;
            } catch (NumberFormatException ignored) {
                // A non-numeric percentage is not evidence of completion.
            }
        }
        return false;
    }

    // ── Reveal settlement on read ────────────────────────────────────────────

    /**
     * Pay a held-back correctness bonus as soon as the learner looks, instead of waiting
     * for EngagementRevealJob's next 15-minute tick.
     *
     * Same rule and same ledger key as the job, so whichever runs first pays and the
     * other is a no-op: a correct answer on a hide-until-reveal item, given BEFORE the
     * reveal of the occurrence it was given in, whose reveal has now passed; a late
     * answer earns the bonus at its catch-up percent. Never fails the read.
     *
     * @param inCallerTx true when the caller's transaction is read-write (getItem) and
     *                   the attempt row is saved in it; false for the read-only feed, where
     *                   the row is updated in a transaction of its own.
     */
    private void settleRevealBonus(EngagementPlan plan, EngagementSlot slot, EngagementItem item,
                                   EngagementAttempt attempt, ZonedDateTime now, boolean inCallerTx) {
        try {
            if (!isCompleted(attempt) || !Boolean.TRUE.equals(attempt.getIsCorrect())) return;
            if (!Boolean.TRUE.equals(item.getHideResultUntilReveal())) return;
            int fullBonus = nz(item.getCorrectPoints());
            if (fullBonus <= 0 || attempt.getCompletedAt() == null) return;

            ZoneId zone = now.getZone();
            LocalDate doneLocal = attempt.getCompletedAt().toInstant().atZone(zone).toLocalDate();
            LocalDate run = scheduleResolver.mostRecentRunDate(slot, doneLocal);
            if (run == null) return;
            Instant revealAt = LocalDateTime.of(run, slot.effectiveRevealTime()).atZone(zone).toInstant();
            if (!attempt.getCompletedAt().toInstant().isBefore(revealAt)) return;
            if (now.toInstant().isBefore(revealAt)) return;

            int bonus = Boolean.TRUE.equals(attempt.getIsLate())
                    ? (int) Math.floor(fullBonus * (scheduleResolver.resolveCatchUpPercent(plan, item) / 100.0))
                    : fullBonus;
            if (bonus <= 0) return;

            Integer answeredVersion = attempt.getItemVersion() == null ? item.getVersion() : attempt.getItemVersion();
            String key = "ENGAGEMENT_BONUS:" + item.getId() + ":v" + answeredVersion + ":" + attempt.getUserId();
            // Already paid (by the job or an earlier read): the common case on every
            // later read, answered here without opening a second transaction.
            if (pointsLedgerRepository.existsByIdempotencyKey(key)) return;
            Optional<?> awarded = pointsLedgerService.award(
                    attempt.getUserId(),
                    attempt.getInstituteId(),
                    attempt.getPackageSessionId(),
                    PointsSourceType.ENGAGEMENT_ITEM,
                    item.getId(),
                    bonus,
                    "Correct answer — " + item.getTitle(),
                    key);
            if (awarded != null && awarded.isPresent()) {
                if (inCallerTx) {
                    attempt.setPointsAwarded(nz(attempt.getPointsAwarded()) + bonus);
                    attempt.setUpdatedAt(now());
                    attemptRepository.save(attempt);
                } else {
                    addSettledPoints(attempt.getId(), bonus);
                    // Stored first; now the in-memory row, so this response shows it too.
                    attempt.setPointsAwarded(nz(attempt.getPointsAwarded()) + bonus);
                }
                log.info("[engagement] reveal bonus {} settled on read for {} on item {}",
                        bonus, attempt.getUserId(), item.getId());
            }
        } catch (Exception e) {
            // The job settles it on its next tick; the read must not fail over it.
            log.warn("[engagement] could not settle reveal bonus on read for item {}: {}",
                    item.getId(), e.getMessage());
        }
    }

    /**
     * Add a settled bonus to the stored attempt in a new read-write transaction. Only the
     * caller whose ledger award succeeded gets here, so the bonus is added once.
     */
    private void addSettledPoints(String attemptId, int bonus) {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        tx.executeWithoutResult(status -> attemptRepository.findById(attemptId).ifPresent(row -> {
            row.setPointsAwarded(nz(row.getPointsAwarded()) + bonus);
            row.setUpdatedAt(now());
            attemptRepository.save(row);
        }));
    }

    // ── DTO assembly + redaction ─────────────────────────────────────────────

    /**
     * Per-request state: the viewing learner, the institute settings read once, and
     * memoised poll counts and slide-completion checks.
     */
    private static final class ReadScope {
        final String userId;
        final EngagementSettingsService.Snapshot settings;
        final Map<String, PollSummary> polls = new HashMap<>();
        final Map<String, Boolean> slides = new HashMap<>();

        ReadScope(String userId, EngagementSettingsService.Snapshot settings) {
            this.userId = userId;
            this.settings = settings == null ? EngagementSettingsService.Snapshot.defaults() : settings;
        }
    }

    /** A poll's votes: the split to show (null under the threshold) and the vote total. */
    private record PollSummary(List<EngagementItemDTO.PollResult> results, long responseCount) {}

    /**
     * Build the learner-facing DTO.
     *
     * An UPCOMING item carries NO content: no HTML, no slide, no question, no
     * payload, no excerpt. Shipping tomorrow's payload and hiding it with CSS puts
     * tomorrow's answer one devtools panel away, and in a ranked batch somebody will
     * look. An open question's answer key is stripped until the reveal time passes.
     */
    private EngagementItemDTO toLearnerDto(EngagementPlan plan, EngagementSlot slot, EngagementItem item,
                                           LocalDate runDate, SlotState state,
                                           EngagementAttempt attempt, long completedCount,
                                           ZonedDateTime now, ReadScope scope) {
        ZoneId zone = scheduleResolver.zoneOf(plan);
        SlotState shownState = state == null ? SlotState.UPCOMING : state;
        boolean locked = shownState == SlotState.UPCOMING;
        boolean revealed = !locked && runDate != null && scheduleResolver.isRevealed(plan, slot, runDate, now);
        boolean finished = isCompleted(attempt);
        int percent = shownState == SlotState.CATCH_UP ? scheduleResolver.resolveCatchUpPercent(plan, item) : 100;
        String type = item.getItemType();

        EngagementItemDTO.EngagementItemDTOBuilder builder = EngagementItemDTO.builder()
                .id(item.getId())
                .slotId(slot.getId())
                .planId(plan.getId())
                .packageSessionId(plan.getPackageSessionId())
                .itemType(type)
                .title(item.getTitle())
                .version(item.getVersion())
                .sortOrder(item.getSortOrder())
                .isRequired(item.getIsRequired())
                .completionPoints(item.getCompletionPoints())
                .correctPoints(item.getCorrectPoints())
                .maxScore(item.getMaxScore())
                .state(shownState.name())
                .runDate(runDate == null ? null : runDate.toString())
                .opensAt(instant(runDate, slot.getStartTime(), zone))
                .closesAt(instant(runDate, slot.getEndTime(), zone))
                .revealAt(instant(runDate, slot.effectiveRevealTime(), zone))
                .isRevealed(revealed)
                .pointsPercent(percent)
                .hideResultUntilReveal(item.getHideResultUntilReveal())
                .completedCount(completedCount);

        // Gates, so the client can mirror the server rule instead of guessing.
        if (EngagementEnums.ItemType.READING_HTML.name().equals(type)
                || EngagementEnums.ItemType.VISUAL_NOTE.name().equals(type)) {
            builder.minReadMs(scope.settings.minReadMs()).minScrollPercent(scope.settings.minScrollPercent());
        } else if (EngagementEnums.ItemType.GAME.name().equals(type)
                || EngagementEnums.ItemType.QUIZ.name().equals(type)) {
            builder.minGameMs(scope.settings.minGameMs());
        }

        if (!locked) {
            // The reveal time alone must not un-redact: a catch-up question past its
            // reveal is still answerable, and shipping the key to it handed out the
            // answer (and the bonus). The key goes only to a learner who has finished,
            // or who can no longer submit.
            boolean submittable = shownState == SlotState.OPEN || shownState == SlotState.CATCH_UP;
            boolean keyVisible = revealed && (finished || !submittable);
            builder.contentHtml(item.getContentHtml())
                    .slideId(item.getSlideId())
                    .questionId(item.getQuestionId())
                    .assessmentId(item.getAssessmentId())
                    .payloadJson(redactPayload(item.getPayloadJson(), keyVisible));
            if (EngagementEnums.ItemType.READING_HTML.name().equals(type)
                    || EngagementEnums.ItemType.VISUAL_NOTE.name().equals(type)) {
                builder.excerpt(excerptOf(item.getContentHtml(), item.getTitle()));
            } else if (hasReveal(item)) {
                builder.promptText(promptTextOf(item.getPayloadJson()));
            }
        }

        // Points: what finishing now can earn, and what is held back to the reveal.
        boolean bonusNow = bonusEnabled(item, revealed, scope.settings);
        builder.scoreBonusEnabled(bonusNow);
        if (!finished) {
            int completion = nz(item.getCompletionPoints());
            int bonus = bonusNow ? nz(item.getCorrectPoints()) : 0;
            builder.earnablePoints(scaled(completion + bonus, percent))
                    .effectivePoints(scaled(completion, percent));
            if (bonusNow && Boolean.TRUE.equals(item.getHideResultUntilReveal())) {
                builder.pendingBonus(scaled(bonus, percent));
            }
            if (shownState == SlotState.CATCH_UP && runDate != null && slot.getEndTime() != null) {
                int days = scheduleResolver.resolveCatchUpDays(plan, item);
                builder.catchUpClosesAt(LocalDateTime.of(runDate, slot.getEndTime()).atZone(zone)
                        .plusDays(Math.max(0, days)).toInstant().toString());
            }
            if (EngagementEnums.ItemType.COURSE_SLIDE.name().equals(type)
                    && (shownState == SlotState.OPEN || shownState == SlotState.CATCH_UP)) {
                // Mirrors the grader: a slide-less task and a finished slide both submit.
                // Read-only: no attempt is created for this check.
                builder.claimable(item.getSlideId() == null || item.getSlideId().isBlank()
                        || hasCompletedSlide(scope.userId, item.getSlideId(), scope));
            }
        } else {
            builder.earnablePoints(0);
        }

        if (attempt != null) {
            // Same rule as the submit response: a hide-until-reveal question must not
            // confirm the outcome on a refresh either, or the redaction is theatre.
            boolean withholdResult =
                    Boolean.TRUE.equals(item.getHideResultUntilReveal()) && !revealed;
            builder.attemptStatus(attempt.getStatus())
                    .isCorrect(withholdResult ? null : attempt.getIsCorrect())
                    .resultPending(withholdResult)
                    .pointsAwarded(attempt.getPointsAwarded())
                    .startedAt(attempt.getStartedAt() == null ? null : attempt.getStartedAt().toInstant().toString());

            if (finished) {
                builder.isLate(attempt.getIsLate())
                        .completedAt(attempt.getCompletedAt() == null
                                ? null : attempt.getCompletedAt().toInstant().toString());
                // The learner's own answer is theirs to see again.
                builder.selectedOptionId(readResponseText(attempt, "selectedOptionId"))
                        .textAnswer(readResponseText(attempt, "textAnswer"))
                        .fileIds(readResponseList(attempt, "fileIds"));
                if (withholdResult && bonusEnabled(item, false, scope.settings)) {
                    // "Bonus pending": the same amount whatever the answer was, so it
                    // says nothing about whether the answer was right.
                    int latePercent = Boolean.TRUE.equals(attempt.getIsLate())
                            ? scheduleResolver.resolveCatchUpPercent(plan, item) : 100;
                    builder.pendingBonus(scaled(nz(item.getCorrectPoints()), latePercent));
                }
                if (isKeyedQuestion(item) && runDate != null && attempt.getCompletedAt() != null) {
                    Instant revealAt = LocalDateTime.of(runDate, slot.effectiveRevealTime()).atZone(zone).toInstant();
                    builder.answerAlreadyOut(!attempt.getCompletedAt().toInstant().isBefore(revealAt));
                }
                if (EngagementEnums.ItemType.FLASHCARDS.name().equals(type)) {
                    builder.flashcardsResult(flashcardsResultOf(attempt));
                }
                if (EngagementEnums.ItemType.POLL.name().equals(type)
                        && (!Boolean.TRUE.equals(item.getHideResultUntilReveal()) || revealed)) {
                    PollSummary poll = pollSummary(item, scope);
                    builder.pollResults(poll.results()).responseCount(poll.responseCount());
                }
            }
        }
        return builder.build();
    }

    /** Points after a percent, floored as the submit floors them. */
    private static int scaled(int points, int percent) {
        return (int) Math.floor(points * (percent / 100.0));
    }

    /** Slide completion, memoised per request (history can list the same lesson often). */
    private boolean hasCompletedSlide(String userId, String slideId, ReadScope scope) {
        if (userId == null) return false;
        return scope.slides.computeIfAbsent(userId + "|" + slideId, k -> hasCompletedSlide(userId, slideId));
    }

    /** Strip the answer key from a question payload until the reveal time passes. */
    private String redactPayload(String payloadJson, boolean revealed) {
        if (payloadJson == null || payloadJson.isBlank() || revealed) return payloadJson;
        try {
            JsonNode node = objectMapper.readTree(payloadJson);
            if (!node.isObject()) return payloadJson;
            ObjectNode copy = ((ObjectNode) node).deepCopy();
            copy.remove("correctOptionId");
            copy.remove("correctOptionIds");
            copy.remove("explanation");
            copy.remove("answer");
            return objectMapper.writeValueAsString(copy);
        } catch (Exception e) {
            // Unparseable payload: withhold it entirely rather than risk leaking a key.
            log.warn("[engagement] could not redact payload, withholding it: {}", e.getMessage());
            return null;
        }
    }

    /** The stored flashcards summary of a COMPLETED attempt, or null for a legacy row. */
    private EngagementItemDTO.FlashcardsResult flashcardsResultOf(EngagementAttempt attempt) {
        if (attempt == null || attempt.getResponseJson() == null || attempt.getResponseJson().isBlank()) return null;
        try {
            JsonNode node = objectMapper.readTree(attempt.getResponseJson());
            JsonNode fc = node == null ? null : node.get("flashcards");
            if (fc == null || !fc.isObject()) return null;
            List<String> learning = new ArrayList<>();
            int known = 0;
            JsonNode outcomes = fc.get("outcomes");
            if (outcomes != null && outcomes.isArray()) {
                for (JsonNode o : outcomes) {
                    String cardId = o.hasNonNull("cardId") ? o.get("cardId").asText() : null;
                    String result = o.hasNonNull("result") ? o.get("result").asText() : null;
                    if (cardId == null) continue;
                    if (FlashcardOutcome.LEARNING.equals(result)) learning.add(cardId);
                    else if (FlashcardOutcome.KNOWN.equals(result)) known++;
                }
            }
            Integer version = fc.hasNonNull("version") ? fc.get("version").asInt()
                    : attempt.getItemVersion();
            Integer storedKnown = fc.hasNonNull("known") ? fc.get("known").asInt() : known;
            Integer total = fc.hasNonNull("total") ? fc.get("total").asInt()
                    : (outcomes != null && outcomes.isArray() ? outcomes.size() : null);
            return new EngagementItemDTO.FlashcardsResult(version, storedKnown, total, learning);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The vote split over the authored options, in authored order, with whole percents
     * that sum to 100 (largest remainder). Votes for an option the teacher has since
     * removed still count in responseCount but are not shown. Null results under
     * {@link #MIN_RESPONSES_FOR_RESULTS} shown votes, so a tiny batch cannot tell who
     * picked what.
     */
    private PollSummary pollSummary(EngagementItem item, ReadScope scope) {
        return scope.polls.computeIfAbsent(item.getId(), id -> {
            Map<String, Long> counts = new LinkedHashMap<>();
            for (String optionId : optionIds(item.getPayloadJson())) counts.put(optionId, 0L);
            long total = 0;
            List<Object[]> rows = attemptRepository.countByOption(id);
            if (rows != null) {
                for (Object[] row : rows) {
                    if (row == null || row[0] == null || row[1] == null) continue;
                    long n = ((Number) row[1]).longValue();
                    total += n;
                    String optionId = String.valueOf(row[0]);
                    if (counts.containsKey(optionId)) counts.merge(optionId, n, Long::sum);
                }
            }
            long shown = counts.values().stream().mapToLong(Long::longValue).sum();
            if (shown < MIN_RESPONSES_FOR_RESULTS || counts.isEmpty()) {
                return new PollSummary(null, total);
            }
            return new PollSummary(percentSplit(counts, shown), total);
        });
    }

    /** Largest-remainder whole percents, ties broken by authored order. */
    private static List<EngagementItemDTO.PollResult> percentSplit(Map<String, Long> counts, long total) {
        List<String> ids = new ArrayList<>(counts.keySet());
        int[] floors = new int[ids.size()];
        double[] remainders = new double[ids.size()];
        int assigned = 0;
        for (int i = 0; i < ids.size(); i++) {
            double exact = counts.get(ids.get(i)) * 100.0 / total;
            floors[i] = (int) Math.floor(exact);
            remainders[i] = exact - floors[i];
            assigned += floors[i];
        }
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) order.add(i);
        order.sort((a, b) -> {
            int byRemainder = Double.compare(remainders[b], remainders[a]);
            return byRemainder != 0 ? byRemainder : Integer.compare(a, b);
        });
        for (int k = 0; k < 100 - assigned && k < order.size(); k++) floors[order.get(k)]++;
        List<EngagementItemDTO.PollResult> out = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) {
            out.add(new EngagementItemDTO.PollResult(ids.get(i), counts.get(ids.get(i)), floors[i]));
        }
        return out;
    }

    /** True when the id is one of the item's options (or the item lists none to check against). */
    private boolean isAuthoredOption(EngagementItem item, String optionId) {
        List<String> ids = optionIds(item.getPayloadJson());
        return ids.isEmpty() || ids.contains(optionId);
    }

    /** Option ids in authored order from {"options":[{"id",...}]}. */
    private List<String> optionIds(String payloadJson) {
        List<String> out = new ArrayList<>();
        if (payloadJson == null || payloadJson.isBlank()) return out;
        try {
            JsonNode options = objectMapper.readTree(payloadJson).get("options");
            if (options == null || !options.isArray()) return out;
            for (JsonNode option : options) {
                if (option == null || !option.hasNonNull("id")) continue;
                String id = option.get("id").asText();
                if (!id.isBlank() && !out.contains(id)) out.add(id);
            }
        } catch (Exception ignored) {
            // No options to show.
        }
        return out;
    }

    private EngagementSubmitResponse buildResponse(Context ctx, EngagementAttempt attempt,
                                                   String instituteId, String userId,
                                                   boolean alreadyCompleted, Boolean answerAlreadyOut) {
        ZonedDateTime now = nowIn(ctx.plan);
        boolean revealed = scheduleResolver.isRevealed(ctx.plan, ctx.slot, ctx.runDate, now);
        boolean withholdResult =
                Boolean.TRUE.equals(ctx.item.getHideResultUntilReveal()) && !revealed;

        Boolean answerOut = answerAlreadyOut;
        if (answerOut == null && attempt.getIsCorrect() != null && attempt.getCompletedAt() != null
                && ctx.runDate != null) {
            Instant revealAt = LocalDateTime.of(ctx.runDate, ctx.slot.effectiveRevealTime())
                    .atZone(now.getZone()).toInstant();
            answerOut = !attempt.getCompletedAt().toInstant().isBefore(revealAt);
        }

        EngagementSubmitResponse.EngagementSubmitResponseBuilder builder = EngagementSubmitResponse.builder()
                .attemptId(attempt.getId())
                .status(attempt.getStatus())
                .isCorrect(withholdResult ? null : attempt.getIsCorrect())
                .pointsAwarded(attempt.getPointsAwarded())
                .isLate(attempt.getIsLate())
                .isVerified(attempt.getIsVerified())
                .isRevealed(revealed)
                .correctOptionId(revealed ? readPayloadText(ctx.item.getPayloadJson(), "correctOptionId") : null)
                .explanation(revealed ? readPayloadText(ctx.item.getPayloadJson(), "explanation") : null)
                .newTotalPoints(totalPoints(instituteId, userId))
                .resultPending(withholdResult)
                .alreadyCompleted(alreadyCompleted)
                .answerAlreadyOut(answerOut);

        String type = ctx.item.getItemType();
        if (EngagementEnums.ItemType.FLASHCARDS.name().equals(type)) {
            builder.flashcardsResult(flashcardsResultOf(attempt));
        }
        if (EngagementEnums.ItemType.POLL.name().equals(type) && !withholdResult) {
            PollSummary poll = pollSummary(ctx.item, new ReadScope(userId, null));
            builder.pollResults(poll.results()).responseCount(poll.responseCount());
        }
        return builder.build();
    }

    /** The learner's ledger total; null (not a failed submit) when it cannot be read. */
    private Long totalPoints(String instituteId, String userId) {
        try {
            var summary = pointsLedgerService.getSummary(instituteId, userId);
            return summary == null ? null : summary.getTotalPoints();
        } catch (RuntimeException e) {
            log.warn("[engagement] could not read the points total for {}: {}", userId, e.getMessage());
            return null;
        }
    }

    // ── Context loading ──────────────────────────────────────────────────────

    private record Context(EngagementPlan plan, EngagementSlot slot, EngagementItem item,
                           LocalDate runDate, SlotState state) {}

    /**
     * Load an item with its slot and plan, verifying the learner is actually enrolled
     * in the owning batch. Without this check any learner could submit to any item id.
     */
    private Context loadContext(String itemId, String instituteId, String userId) {
        EngagementItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new VacademyException("Task not found"));
        if (!EngagementEnums.ItemStatus.ACTIVE.name().equals(item.getStatus())) {
            throw new VacademyException("Task not found");
        }
        EngagementSlot slot = slotRepository.findById(item.getSlotId())
                .orElseThrow(() -> new VacademyException("Task not found"));
        // Removing a day marks only the slot DELETED; its tasks stay ACTIVE rows, so the
        // slot's status is what takes them away from learners.
        if (!EngagementEnums.SlotStatus.ACTIVE.name().equals(slot.getStatus())) {
            throw new VacademyException("Task not found");
        }
        EngagementPlan plan = planRepository.findById(slot.getPlanId())
                .orElseThrow(() -> new VacademyException("Task not found"));

        if (!Objects.equals(plan.getInstituteId(), instituteId)
                || !EngagementEnums.PlanStatus.PUBLISHED.name().equals(plan.getStatus())) {
            throw new VacademyException("Task not found");
        }
        List<String> enrolled =
                enrollmentRepository.findPackageSessionIdsByUserIdAndInstituteId(userId, instituteId);
        if (enrolled == null || !enrolled.contains(plan.getPackageSessionId())) {
            throw new VacademyException("Task not found");
        }
        if (plan.isRelative() && relativeSchedule != null) {
            slot = relativeSchedule.localize(plan, slot,
                    relativeSchedule.dayOnesForUser(userId, List.of(plan)).get(plan.getId()));
        }

        ZonedDateTime now = nowIn(plan);
        LocalDate today = now.toLocalDate();
        LocalDate runDate = scheduleResolver.runsOn(slot, today)
                ? today
                : scheduleResolver.mostRecentRunDate(slot, today);
        if (runDate == null) {
            LocalDate next = nextRunDate(slot, today);
            return new Context(plan, slot, item, next, SlotState.UPCOMING);
        }
        return new Context(plan, slot, item, runDate,
                scheduleResolver.stateOn(plan, slot, item, runDate, now));
    }

    // ── small helpers ────────────────────────────────────────────────────────

    /**
     * Calendar slots as loaded, plus every active slot of the learner's RELATIVE plans
     * shifted onto this learner's own days. (A RELATIVE slot's stored dates are virtual,
     * so the date-bounded query never returns it.)
     */
    private List<EngagementSlot> withRelativeSlots(List<EngagementSlot> loaded,
                                                   Map<String, EngagementPlan> plansById, String userId) {
        List<EngagementSlot> out = new ArrayList<>();
        for (EngagementSlot slot : loaded) {
            EngagementPlan plan = plansById.get(slot.getPlanId());
            if (plan != null && !plan.isRelative()) out.add(slot);
        }
        if (relativeSchedule == null) return out;
        List<EngagementPlan> relative = plansById.values().stream().filter(EngagementPlan::isRelative).toList();
        if (relative.isEmpty()) return out;
        Map<String, LocalDate> dayOnes = relativeSchedule.dayOnesForUser(userId, relative);
        for (EngagementPlan plan : relative) {
            LocalDate dayOne = dayOnes.get(plan.getId());
            if (dayOne == null) continue;
            for (EngagementSlot slot : slotRepository.findActiveByPlan(plan.getId())) {
                out.add(relativeSchedule.localize(plan, slot, dayOne));
            }
        }
        return out;
    }

    private Map<String, String> batchNames(List<EngagementPlan> plans) {
        // A learner in several batches needs each card to say which batch it is from.
        Map<String, String> batchNames = new HashMap<>();
        for (EngagementPlan plan : plans) {
            String psId = plan.getPackageSessionId();
            if (batchNames.containsKey(psId)) continue;
            try {
                packageSessionRepository.findBatchAndInstituteByPackageSessionId(psId)
                        .ifPresent(ctx -> batchNames.put(psId, ctx.getBatchName()));
            } catch (Exception ignored) {
                // A missing name is cosmetic; the card still renders.
            }
        }
        return batchNames;
    }

    private static boolean isCompleted(EngagementAttempt attempt) {
        return attempt != null && EngagementEnums.AttemptStatus.COMPLETED.name().equals(attempt.getStatus());
    }

    private static boolean completedOn(EngagementAttempt attempt, ZoneId zone, LocalDate day) {
        return attempt != null && attempt.getCompletedAt() != null
                && attempt.getCompletedAt().toInstant().atZone(zone).toLocalDate().equals(day);
    }

    private ZonedDateTime nowIn(EngagementPlan plan) {
        return ZonedDateTime.now(clock.withZone(scheduleResolver.zoneOf(plan)));
    }

    private LocalDate today(EngagementPlan plan) {
        return nowIn(plan).toLocalDate();
    }

    private EngagementEnums.ItemType itemType(EngagementItem item) {
        try {
            return EngagementEnums.ItemType.valueOf(item.getItemType());
        } catch (Exception e) {
            throw new EngagementRejectedException(EngagementRejectedException.UNSUPPORTED_TYPE,
                    "Unsupported task type: " + item.getItemType());
        }
    }

    private String readPayloadText(String payloadJson, String field) {
        if (payloadJson == null || payloadJson.isBlank()) return null;
        try {
            JsonNode node = objectMapper.readTree(payloadJson);
            JsonNode value = node.get(field);
            return value == null || value.isNull() ? null : value.asText();
        } catch (Exception e) {
            return null;
        }
    }

    private List<String> readResponseList(EngagementAttempt attempt, String field) {
        if (attempt == null || attempt.getResponseJson() == null || attempt.getResponseJson().isBlank()) return null;
        try {
            JsonNode value = objectMapper.readTree(attempt.getResponseJson()).get(field);
            if (value == null || !value.isArray()) return null;
            List<String> out = new ArrayList<>();
            for (JsonNode v : value) if (v != null && !v.isNull()) out.add(v.asText());
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    /** Plain text of a question or poll prompt ({@code prompt}, else {@code question}). */
    private String promptTextOf(String payloadJson) {
        String prompt = readPayloadText(payloadJson, "prompt");
        if (prompt == null || prompt.isBlank()) prompt = readPayloadText(payloadJson, "question");
        if (prompt == null || prompt.isBlank()) return null;
        String text = htmlToText(prompt);
        return text.isEmpty() ? null : text;
    }

    /**
     * A plain-text glimpse of a reading: tags and hidden blocks removed, entities
     * decoded, whitespace collapsed, a leading heading that repeats the title dropped,
     * then cut at a word boundary to {@link #EXCERPT_MAX} characters with an ellipsis.
     */
    static String excerptOf(String html, String title) {
        String text = htmlToText(html);
        if (text.isEmpty()) return null;
        String t = title == null ? "" : htmlToText(title);
        if (!t.isEmpty() && text.length() > t.length()
                && text.regionMatches(true, 0, t, 0, t.length())) {
            text = text.substring(t.length()).replaceFirst("^[\\s:.\\-–—|]+", "");
        } else if (!t.isEmpty() && text.equalsIgnoreCase(t)) {
            return null;
        }
        if (text.length() <= EXCERPT_MAX) return text.isEmpty() ? null : text;
        int cut = EXCERPT_MAX - 1;
        int space = text.lastIndexOf(' ', cut);
        if (space >= EXCERPT_MAX / 2) cut = space;
        if (Character.isHighSurrogate(text.charAt(cut - 1))) cut--;
        return text.substring(0, cut).stripTrailing() + "…";
    }

    /** Markup to one line of plain text. Not a sanitiser: the result is only ever text. */
    static String htmlToText(String html) {
        if (html == null || html.isBlank()) return "";
        String s = HTML_COMMENT.matcher(html).replaceAll(" ");
        s = HIDDEN_BLOCKS.matcher(s).replaceAll(" ");
        s = TAG.matcher(s).replaceAll(" ");
        s = decodeEntities(s);
        return WHITESPACE.matcher(s).replaceAll(" ").strip();
    }

    private static String decodeEntities(String s) {
        if (s.indexOf('&') < 0) return s;
        Matcher m = NUMERIC_ENTITY.matcher(s);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String code = m.group(1);
            String replacement;
            try {
                int cp = code.startsWith("x") ? Integer.parseInt(code.substring(1), 16) : Integer.parseInt(code);
                replacement = Character.isValidCodePoint(cp) && cp != 0 ? new String(Character.toChars(cp)) : " ";
            } catch (NumberFormatException e) {
                replacement = " ";
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        m.appendTail(sb);
        return sb.toString()
                .replace("&nbsp;", " ")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&#39;", "'")
                .replace("&mdash;", "—")
                .replace("&ndash;", "–")
                .replace("&hellip;", "…")
                .replace("&rsquo;", "’")
                .replace("&lsquo;", "‘")
                .replace("&rdquo;", "”")
                .replace("&ldquo;", "“")
                .replace("&amp;", "&");
    }

    private String instant(LocalDate date, java.time.LocalTime time, ZoneId zone) {
        if (date == null || time == null) return null;
        return LocalDateTime.of(date, time).atZone(zone).toInstant().toString();
    }

    private static int nz(Integer value) {
        return value == null ? 0 : value;
    }

    private Timestamp now() {
        return new Timestamp(clock.millis());
    }
}
