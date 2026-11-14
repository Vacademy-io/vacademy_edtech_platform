package vacademy.io.admin_core_service.features.live_activity.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityAnalyticsDTO;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.repository.LiveActivityAnalyticsRepository;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Assembles the dashboard payload.
 *
 * <p>Everything here is derived from grouped queries over {@code user_live_event} alone.
 * That constraint is the line between this and Institute Pulse: the moment a figure needs a
 * second service or its own endpoint, it has stopped being a view of the feed.
 */
@Service
@RequiredArgsConstructor
public class LiveActivityAnalyticsService {

    /** Above this many hours the hourly timeline stops being readable, so it is capped. */
    private static final int MAX_TIMELINE_BUCKETS = 24 * 14;

    private final LiveActivityAnalyticsRepository repository;

    public LiveActivityAnalyticsDTO analytics(String instituteId, long fromMillis, long toMillis) {
        Timestamp from = new Timestamp(fromMillis);
        Timestamp to = new Timestamp(toMillis);

        // The preceding window of equal length, so every KPI can show a trend rather than a
        // bare number. A count with nothing to compare it to tells an admin very little.
        long windowMillis = Math.max(1L, toMillis - fromMillis);
        Timestamp prevFrom = new Timestamp(fromMillis - windowMillis);
        Timestamp prevTo = from;

        Map<String, Long> actions = toCountMap(repository.countByAction(instituteId, from, to));
        Map<String, Long> prevActions = toCountMap(repository.countByAction(instituteId, prevFrom, prevTo));

        Double revenue = repository.sumRevenue(instituteId, from, to);
        Double prevRevenue = repository.sumRevenue(instituteId, prevFrom, prevTo);

        LiveActivityAnalyticsDTO.Kpis kpis = LiveActivityAnalyticsDTO.Kpis.builder()
                .leads(count(actions, LiveActivityAction.LEAD_SUBMITTED))
                .enrolments(count(actions, LiveActivityAction.ENROLLED))
                .revenue(revenue == null ? 0d : revenue)
                .currency(repository.dominantCurrency(instituteId, from, to))
                .callsPlaced(count(actions, LiveActivityAction.CALL_QUEUED))
                .callsConnected(count(actions, LiveActivityAction.CALL_CONNECTED))
                .needsAttention(repository.countNeedsAttention(instituteId, from, to))
                .previousLeads(count(prevActions, LiveActivityAction.LEAD_SUBMITTED))
                .previousEnrolments(count(prevActions, LiveActivityAction.ENROLLED))
                .previousRevenue(prevRevenue == null ? 0d : prevRevenue)
                .build();

        return LiveActivityAnalyticsDTO.builder()
                .kpis(kpis)
                .funnel(buildFunnel(actions))
                .timeline(buildTimeline(instituteId, from, to, fromMillis, toMillis))
                .leadSources(toNamedCounts(repository.countLeadSources(instituteId, from, to)))
                .counsellors(toNamedCounts(repository.countByCounsellor(instituteId, from, to)))
                .callOutcomes(toNamedCounts(repository.countCallOutcomes(instituteId, from, to)))
                .build();
    }

    /**
     * The enrolment funnel, widest first.
     *
     * <p>These three stages are the reason the funnel events exist. FORM_NEXT fires when a
     * prospect leaves the details step, REACHED_PAYMENT when they hit the gateway, ENROLLED
     * on success -- so the gaps between them separate "never really started" from "got to
     * the payment page and bailed", which are very different follow-ups.
     */
    private List<LiveActivityAnalyticsDTO.NamedCount> buildFunnel(Map<String, Long> actions) {
        List<LiveActivityAnalyticsDTO.NamedCount> funnel = new ArrayList<>();
        funnel.add(stage("Details filled", count(actions, LiveActivityAction.FORM_NEXT)));
        funnel.add(stage("Reached payment", count(actions, LiveActivityAction.REACHED_PAYMENT)));
        funnel.add(stage("Enrolled", count(actions, LiveActivityAction.ENROLLED)));
        return funnel;
    }

    /**
     * Hourly counts with the empty hours filled in.
     *
     * <p>The query only returns hours that had events. Plotting that directly would draw a
     * line straight across a quiet night as though activity had continued, so the gaps are
     * materialised as explicit zeroes.
     */
    private List<LiveActivityAnalyticsDTO.TimeBucket> buildTimeline(String instituteId,
                                                                    Timestamp from,
                                                                    Timestamp to,
                                                                    long fromMillis,
                                                                    long toMillis) {
        Map<Long, Long> byHour = new HashMap<>();
        for (Object[] row : repository.countByHour(instituteId, from, to)) {
            if (row[0] == null) {
                continue;
            }
            byHour.put(((Timestamp) row[0]).getTime(), ((Number) row[1]).longValue());
        }

        List<LiveActivityAnalyticsDTO.TimeBucket> buckets = new ArrayList<>();
        Instant cursor = Instant.ofEpochMilli(fromMillis).truncatedTo(ChronoUnit.HOURS);
        Instant end = Instant.ofEpochMilli(toMillis);

        int guard = 0;
        while (cursor.isBefore(end) && guard++ < MAX_TIMELINE_BUCKETS) {
            long start = cursor.toEpochMilli();
            buckets.add(LiveActivityAnalyticsDTO.TimeBucket.builder()
                    .startEpochMillis(start)
                    .count(byHour.getOrDefault(start, 0L))
                    .build());
            cursor = cursor.plus(1, ChronoUnit.HOURS);
        }
        return buckets;
    }

    private static LiveActivityAnalyticsDTO.NamedCount stage(String name, long count) {
        return LiveActivityAnalyticsDTO.NamedCount.builder().name(name).count(count).build();
    }

    private static long count(Map<String, Long> counts, LiveActivityAction action) {
        return counts.getOrDefault(action.name(), 0L);
    }

    private static Map<String, Long> toCountMap(List<Object[]> rows) {
        Map<String, Long> out = new HashMap<>();
        for (Object[] row : rows) {
            if (row[0] == null) {
                continue;
            }
            out.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
        }
        return out;
    }

    private static List<LiveActivityAnalyticsDTO.NamedCount> toNamedCounts(List<Object[]> rows) {
        List<LiveActivityAnalyticsDTO.NamedCount> out = new ArrayList<>();
        for (Object[] row : rows) {
            out.add(stage(row[0] == null ? "Unknown" : String.valueOf(row[0]),
                    ((Number) row[1]).longValue()));
        }
        return out;
    }
}
