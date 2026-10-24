package vacademy.io.assessment_service.features.open_evaluation.queue;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue.AiEvaluationLaneCaps;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * {@code queue.position} and {@code estimated_ready_at} on submission responses (spec 11.4).
 *
 * <ul>
 *   <li>Position (per institute, per lane): one range count on {@code idx_ai_eval_pending_fair},
 *       the rows of the same institute and lane queued before this one.</li>
 *   <li>A snapshot per lane, rebuilt at most every {@value #SNAPSHOT_SECONDS} s (the poller's
 *       COPY tick): active institutes {@code A}, lane cap, per-institute cap, and the median
 *       run time by page bucket (1–5, 6–15, 16–40, 41–80) over the last 200 COMPLETED rows.</li>
 *   <li>Queued: {@code s = min(perInstituteCap, max(1, floor(laneCap / A)))};
 *       {@code ready = now + ceil((pos + 1) / s) × T + T(bucket)}, with T the lane median.</li>
 *   <li>Running: {@code started_at + T(bucket)}, or while grading, the remaining questions at
 *       the pace so far. Never earlier than now + 30 s.</li>
 * </ul>
 * One number, no confidence band. Until the load test measures real times (T1.45), lanes with
 * no history use the section 11.3 estimates.
 */
@Slf4j
@Service
public class QueueEtaService {

    static final long SNAPSHOT_SECONDS = 15;
    static final int HISTORY = 200;
    static final Duration FLOOR = Duration.ofSeconds(30);

    /** Section 11.3 estimates per page bucket (COPY) and per typed submission. */
    static final long[] COPY_DEFAULT_SECONDS = {75, 270, 660, 780};
    static final long TYPED_DEFAULT_SECONDS = 30;

    private final NamedParameterJdbcTemplate jdbc;
    private final AiEvaluationLaneCaps caps;
    private final Clock clock;
    private final Map<AiEvaluationLane, Snapshot> snapshots = Collections.synchronizedMap(new EnumMap<>(AiEvaluationLane.class));

    @Autowired
    public QueueEtaService(JdbcTemplate jdbcTemplate, AiEvaluationLaneCaps caps) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), caps, Clock.systemUTC());
    }

    QueueEtaService(NamedParameterJdbcTemplate jdbc, AiEvaluationLaneCaps caps, Clock clock) {
        this.jdbc = jdbc;
        this.caps = caps;
        this.clock = clock;
    }

    /** What the queue looks like for one lane. */
    record Snapshot(Instant takenAt, int activeInstitutes, int laneCap, int perInstituteCap, long laneMedianSeconds,
            long[] bucketMedianSeconds) {
    }

    /** {@code queue} of a queued submission: its place and when it should be ready. */
    public record Estimate(Long position, Instant estimatedReadyAt) {
    }

    /**
     * @param status      the process status
     * @param laneName    COPY | TYPED
     * @param createdAt   when the run was queued
     * @param startedAt   when it was dispatched (running rows)
     * @param pageCount   pages of the copy (null for typed)
     * @param laneCapOverride the institute's own cap in this lane, when its contract sets one
     */
    public Estimate estimate(String instituteId, String status, String laneName, Instant createdAt, Instant startedAt,
            Integer pageCount, Integer questionsCompleted, Integer questionsTotal, Integer laneCapOverride) {
        if (status == null) {
            return null;
        }
        AiEvaluationLane lane = "TYPED".equalsIgnoreCase(laneName) ? AiEvaluationLane.TYPED : AiEvaluationLane.COPY;
        try {
            Snapshot snap = snapshot(lane);
            Instant now = clock.instant();
            long own = bucketSeconds(snap, lane, pageCount);
            if (AiEvaluationStatusEnum.PENDING.name().equals(status) || AiEvaluationStatusEnum.DISPATCHED.name().equals(status)) {
                long position = AiEvaluationStatusEnum.PENDING.name().equals(status)
                        ? position(lane, instituteId, createdAt) : 0;
                int perInstitute = laneCapOverride != null && laneCapOverride >= 0
                        ? Math.min(laneCapOverride, snap.laneCap()) : snap.perInstituteCap();
                Instant ready = queuedReadyAt(now, position, snap.laneCap(), perInstitute, snap.activeInstitutes(),
                        snap.laneMedianSeconds(), own);
                return new Estimate(position, ready);
            }
            if (AiEvaluationStatusEnum.TERMINAL.contains(status)) {
                return null;
            }
            return new Estimate(null, runningReadyAt(now, startedAt, own, questionsCompleted, questionsTotal));
        } catch (RuntimeException e) {
            log.warn("[open-api] queue estimate failed: {}", e.getMessage());
            return null;
        }
    }

    /** Queued: {@code now + ceil((pos + 1) / s) × T + T(bucket)}. */
    static Instant queuedReadyAt(Instant now, long position, int laneCap, int perInstituteCap, int activeInstitutes,
            long laneMedianSeconds, long ownSeconds) {
        int a = Math.max(1, activeInstitutes);
        int share = Math.max(1, laneCap / a);
        int s = Math.max(1, Math.min(Math.max(1, perInstituteCap), share));
        long rounds = (position + 1 + s - 1) / s;
        Instant ready = now.plusSeconds(rounds * laneMedianSeconds + ownSeconds);
        return floor(now, ready);
    }

    /** Running: started + T(bucket), or the remaining questions at the pace so far. */
    static Instant runningReadyAt(Instant now, Instant startedAt, long ownSeconds, Integer done, Integer total) {
        Instant ready;
        if (startedAt != null && done != null && total != null && done > 0 && total > done) {
            long elapsed = Math.max(1, Duration.between(startedAt, now).getSeconds());
            ready = now.plusSeconds((long) Math.ceil((double) elapsed / done * (total - done)));
        } else if (startedAt != null) {
            ready = startedAt.plusSeconds(ownSeconds);
        } else {
            ready = now.plusSeconds(ownSeconds);
        }
        return floor(now, ready);
    }

    private static Instant floor(Instant now, Instant ready) {
        Instant min = now.plus(FLOOR);
        return ready.isBefore(min) ? min : ready;
    }

    long position(AiEvaluationLane lane, String instituteId, Instant createdAt) {
        if (createdAt == null) {
            return 0;
        }
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("lane", lane.name())
                .addValue("mine", Timestamp.from(createdAt));
        String institute;
        if (instituteId == null) {
            institute = "institute_id IS NULL";
        } else {
            institute = "institute_id = :inst";
            p.addValue("inst", instituteId);
        }
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM ai_evaluation_process WHERE status = 'PENDING' "
                + "AND lane = :lane AND " + institute + " AND created_at < :mine", p, Long.class);
        return count == null ? 0 : count;
    }

    Snapshot snapshot(AiEvaluationLane lane) {
        Instant now = clock.instant();
        Snapshot cached = snapshots.get(lane);
        if (cached != null && cached.takenAt().plusSeconds(SNAPSHOT_SECONDS).isAfter(now)) {
            return cached;
        }
        Snapshot fresh = build(lane, now);
        snapshots.put(lane, fresh);
        return fresh;
    }

    private Snapshot build(AiEvaluationLane lane, Instant now) {
        MapSqlParameterSource p = new MapSqlParameterSource("lane", lane.name());
        String inFlight = AiEvaluationStatusEnum.IN_FLIGHT.stream().map(s -> "'" + s + "'")
                .collect(Collectors.joining(", "));
        Integer active = jdbc.queryForObject("SELECT COUNT(DISTINCT COALESCE(institute_id, '')) FROM ("
                + " SELECT institute_id FROM ai_evaluation_process WHERE status = 'PENDING' AND lane = :lane"
                + " UNION ALL"
                + " SELECT institute_id FROM ai_evaluation_process WHERE status IN (" + inFlight + ") AND lane = :lane"
                + ") a", p, Integer.class);
        List<long[]> history = jdbc.query("SELECT page_count, EXTRACT(EPOCH FROM (completed_at - started_at)) "
                        + "FROM ai_evaluation_process WHERE status = 'COMPLETED' AND lane = :lane "
                        + "AND completed_at IS NOT NULL AND started_at IS NOT NULL "
                        + "ORDER BY completed_at DESC LIMIT " + HISTORY, p,
                (rs, i) -> new long[]{rs.getObject(1) == null ? -1 : rs.getInt(1), (long) rs.getDouble(2)});
        return fromHistory(lane, now, active == null ? 0 : active, caps.laneCap(lane), caps.perInstituteCap(lane),
                history);
    }

    /** Medians by bucket; buckets (and lanes) without history fall back to the 11.3 estimates. */
    static Snapshot fromHistory(AiEvaluationLane lane, Instant now, int active, int laneCap, int perInstituteCap,
            List<long[]> history) {
        List<List<Long>> byBucket = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            byBucket.add(new ArrayList<>());
        }
        List<Long> all = new ArrayList<>();
        for (long[] row : history) {
            long seconds = row[1];
            if (seconds <= 0) {
                continue;
            }
            all.add(seconds);
            if (row[0] > 0) {
                byBucket.get(bucket((int) row[0])).add(seconds);
            }
        }
        long laneDefault = lane == AiEvaluationLane.TYPED ? TYPED_DEFAULT_SECONDS : COPY_DEFAULT_SECONDS[1];
        long laneMedian = all.isEmpty() ? laneDefault : median(all);
        long[] medians = new long[4];
        for (int i = 0; i < 4; i++) {
            long fallback = lane == AiEvaluationLane.TYPED ? laneMedian : COPY_DEFAULT_SECONDS[i];
            medians[i] = byBucket.get(i).isEmpty() ? fallback : median(byBucket.get(i));
        }
        return new Snapshot(now, active, laneCap, perInstituteCap, laneMedian, medians);
    }

    private static long bucketSeconds(Snapshot snap, AiEvaluationLane lane, Integer pages) {
        if (lane == AiEvaluationLane.TYPED || pages == null || pages <= 0) {
            return snap.laneMedianSeconds();
        }
        return snap.bucketMedianSeconds()[bucket(pages)];
    }

    /** 1–5, 6–15, 16–40, 41+. */
    static int bucket(int pages) {
        if (pages <= 5) {
            return 0;
        }
        if (pages <= 15) {
            return 1;
        }
        if (pages <= 40) {
            return 2;
        }
        return 3;
    }

    static long median(List<Long> values) {
        List<Long> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        int n = sorted.size();
        return n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2;
    }
}
