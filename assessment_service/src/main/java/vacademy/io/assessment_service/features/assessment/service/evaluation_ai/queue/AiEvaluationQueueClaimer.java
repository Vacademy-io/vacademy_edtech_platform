package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Fair-share claim of queued AI evaluations, one lane at a time
 * (AI_EVALUATION_PUBLIC_API.md 11.2, gate G7).
 *
 * <p>One transaction per lane per tick:
 * <ol>
 *   <li>{@code pg_try_advisory_xact_lock} on the lane. assessment_service has no
 *       ShedLock; the advisory lock makes the replicas take turns, so the running
 *       count read in step 2 is still true when step 3 writes. Busy = skip this tick.</li>
 *   <li>Running rows per institute in the lane -> room = min(batch, lane cap - running).</li>
 *   <li>One {@code UPDATE ... RETURNING}: every waiting row gets a slot number =
 *       its institute's running count + its place in that institute's queue; rows
 *       within their institute's cap are taken in slot order (then age) up to room,
 *       and move straight to DISPATCHED with our claim on them.</li>
 * </ol>
 * Ordering by slot is max-min fairness: one institute alone can use the whole lane
 * (up to its cap); a newcomer's first row has slot 1 and goes ahead of everybody's
 * second, so it waits at most for the shortest running job.
 *
 * <p>The claimed rows are DISPATCHED, which counts as in flight: unlike the old
 * claim (rows stayed PENDING until dispatch committed) the cap now holds across
 * replicas and across a slow dispatch.
 */
@Slf4j
@Component
public class AiEvaluationQueueClaimer {

        /** Prefix of the advisory-lock key; the lane name is appended. */
        static final String LOCK_KEY_PREFIX = "ai_eval_claim:";

        static final String TRY_LOCK_SQL = "SELECT pg_try_advisory_xact_lock(hashtext(:lockKey))";

        static final String RUNNING_SQL = """
                        SELECT institute_id, count(*) AS n
                        FROM ai_evaluation_process
                        WHERE lane = :lane AND status IN (:inFlight)
                        GROUP BY institute_id
                        """;

        /**
         * NULL institute_id (a legacy row whose registration could not be traced) is
         * treated as one more institute, so such rows still drain - hence the
         * IS NOT DISTINCT FROM / IS NULL pairs instead of plain equality. Overrides
         * arrive as two parallel arrays (ids, caps) unnested into a VALUES-like set.
         */
        static final String CLAIM_SQL = """
                        WITH running AS (
                            SELECT institute_id, count(*) AS n
                            FROM ai_evaluation_process
                            WHERE lane = :lane AND status IN (:inFlight)
                            GROUP BY institute_id
                        ),
                        waiting AS (
                            SELECT DISTINCT institute_id
                            FROM ai_evaluation_process
                            WHERE status = 'PENDING' AND lane = :lane
                        ),
                        caps AS (
                            SELECT o.institute_id, o.cap
                            FROM unnest(CAST(:overrideIds AS text[]), CAST(:overrideCaps AS int[])) AS o(institute_id, cap)
                        ),
                        cand AS (
                            SELECT c.id, c.created_at,
                                   COALESCE(r.n, 0) + c.rn AS slot,
                                   COALESCE(k.cap, :perInstituteCap) AS cap
                            FROM waiting w
                            LEFT JOIN running r ON r.institute_id IS NOT DISTINCT FROM w.institute_id
                            LEFT JOIN caps k ON k.institute_id = w.institute_id
                            CROSS JOIN LATERAL (
                                SELECT p.id, p.created_at,
                                       row_number() OVER (ORDER BY p.created_at, p.id) AS rn
                                FROM ai_evaluation_process p
                                WHERE p.status = 'PENDING'
                                  AND p.lane = :lane
                                  AND (p.institute_id = w.institute_id
                                       OR (p.institute_id IS NULL AND w.institute_id IS NULL))
                                  AND (p.claimed_at IS NULL OR p.claimed_at < :staleBefore)
                                ORDER BY p.created_at, p.id
                                LIMIT :perInstituteCapMax
                            ) c
                        )
                        UPDATE ai_evaluation_process t
                        SET status = 'DISPATCHED', claimed_by = :me, claimed_at = :now,
                            updated_at = :now, current_step = 'CLAIMED'
                        WHERE t.id IN (
                            SELECT q.id
                            FROM ai_evaluation_process q
                            JOIN cand c ON c.id = q.id
                            WHERE q.status = 'PENDING' AND c.slot <= c.cap
                            ORDER BY c.slot, c.created_at, q.id
                            LIMIT :room
                            FOR UPDATE OF q SKIP LOCKED
                        )
                        RETURNING t.id, t.attempt_id,
                                  (SELECT a.ai_evaluation_model FROM assessment a WHERE a.id = t.assessment_id) AS model
                        """;

        /** One row this instance now owns (status DISPATCHED, claimed_by = me). */
        public record ClaimedJob(String processId, String attemptId, String model) {
        }

        private final NamedParameterJdbcTemplate jdbc;

        @Autowired
        public AiEvaluationQueueClaimer(JdbcTemplate jdbcTemplate) {
                this(new NamedParameterJdbcTemplate(jdbcTemplate));
        }

        AiEvaluationQueueClaimer(NamedParameterJdbcTemplate jdbc) {
                this.jdbc = jdbc;
        }

        /**
         * Claim this lane's next fair share for {@code me}. Public and on its own bean
         * so the {@code @Transactional} proxy applies (the poller calls it from a
         * {@code @Scheduled} method; self-invocation would silently skip the
         * transaction and with it the advisory lock).
         */
        @Transactional
        public List<ClaimedJob> claim(AiEvaluationLane lane, AiEvaluationLaneCaps caps, String me, Date now,
                        Date staleBefore) {
                Boolean locked = jdbc.queryForObject(TRY_LOCK_SQL,
                                new MapSqlParameterSource("lockKey", LOCK_KEY_PREFIX + lane.name()), Boolean.class);
                if (!Boolean.TRUE.equals(locked)) {
                        log.debug("[ai-eval-claim] {} lane busy on another replica; skipping this tick", lane);
                        return List.of();
                }

                Map<String, Long> running = new HashMap<>();
                jdbc.query(RUNNING_SQL, new MapSqlParameterSource()
                                .addValue("lane", lane.name())
                                .addValue("inFlight", AiEvaluationStatusEnum.IN_FLIGHT),
                                rs -> {
                                        running.put(rs.getString("institute_id"), rs.getLong("n"));
                                });
                long runningTotal = running.values().stream().mapToLong(Long::longValue).sum();
                int room = room(caps.batch(lane), caps.laneCap(lane), runningTotal);
                if (room == 0) {
                        return List.of();
                }

                int perInstituteCap = caps.perInstituteCap(lane);
                Map<String, Integer> overrides = caps.overrides(lane);
                List<String> overrideIds = new ArrayList<>(overrides.keySet());
                List<Integer> overrideCaps = overrideIds.stream().map(overrides::get).toList();
                int capMax = overrideCaps.stream().mapToInt(Integer::intValue).reduce(perInstituteCap, Math::max);
                if (capMax <= 0) {
                        return List.of();
                }

                MapSqlParameterSource params = new MapSqlParameterSource()
                                .addValue("lane", lane.name())
                                .addValue("inFlight", AiEvaluationStatusEnum.IN_FLIGHT)
                                .addValue("overrideIds", pgTextArray(overrideIds))
                                .addValue("overrideCaps", pgIntArray(overrideCaps))
                                .addValue("perInstituteCap", perInstituteCap)
                                .addValue("perInstituteCapMax", capMax)
                                .addValue("staleBefore", new Timestamp(staleBefore.getTime()))
                                .addValue("me", me)
                                .addValue("now", new Timestamp(now.getTime()))
                                .addValue("room", room);
                return jdbc.query(CLAIM_SQL, params, (rs, i) -> new ClaimedJob(
                                rs.getString("id"), rs.getString("attempt_id"), rs.getString("model")));
        }

        /** What one tick may take: never past the lane cap, never more than a batch. */
        static int room(int batch, int laneCap, long running) {
                long free = laneCap - running;
                return (int) Math.max(0, Math.min(batch, free));
        }

        /**
         * A Postgres array literal for a text[] parameter. Elements are quoted and
         * escaped, so an id can never break out of the literal.
         */
        static String pgTextArray(List<String> values) {
                StringBuilder sb = new StringBuilder("{");
                for (int i = 0; i < values.size(); i++) {
                        if (i > 0) sb.append(',');
                        String v = values.get(i) == null ? "" : values.get(i);
                        sb.append('"').append(v.replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
                }
                return sb.append('}').toString();
        }

        static String pgIntArray(List<Integer> values) {
                StringBuilder sb = new StringBuilder("{");
                for (int i = 0; i < values.size(); i++) {
                        if (i > 0) sb.append(',');
                        sb.append(values.get(i) == null ? 0 : values.get(i).intValue());
                }
                return sb.append('}').toString();
        }
}
