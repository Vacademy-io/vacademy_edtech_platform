package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue.AiEvaluationQueueClaimer.ClaimedJob;

import java.sql.ResultSet;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The fair-share claim (11.2, gate G7). The SQL cannot run without Postgres here,
 * so this pins its SHAPE - the parts that make it safe and fair - and the Java
 * around it: the advisory lock gates everything, room never exceeds the lane cap,
 * and the caps and overrides reach the statement.
 */
class AiEvaluationQueueClaimerTest {

    private NamedParameterJdbcTemplate jdbc;
    private AiEvaluationQueueClaimer claimer;
    private AiEvaluationLaneCaps caps;
    private final Date now = new Date();
    private final Date staleBefore = new Date(now.getTime() - 900_000L);

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        claimer = new AiEvaluationQueueClaimer(jdbc);
        caps = new AiEvaluationLaneCaps(3, -1, -1, 12, 6, -1);
    }

    private void lockAcquired(boolean acquired) {
        when(jdbc.queryForObject(eq(AiEvaluationQueueClaimer.TRY_LOCK_SQL), any(SqlParameterSource.class),
                eq(Boolean.class))).thenReturn(acquired);
    }

    /** Running rows per institute, as the RUNNING_SQL would return them. */
    private void running(Map<String, Long> perInstitute) {
        doAnswer(inv -> {
            RowCallbackHandler handler = inv.getArgument(2);
            for (Map.Entry<String, Long> e : perInstitute.entrySet()) {
                ResultSet rs = mock(ResultSet.class);
                when(rs.getString("institute_id")).thenReturn(e.getKey());
                when(rs.getLong("n")).thenReturn(e.getValue());
                handler.processRow(rs);
            }
            return null;
        }).when(jdbc).query(eq(AiEvaluationQueueClaimer.RUNNING_SQL), any(SqlParameterSource.class),
                any(RowCallbackHandler.class));
    }

    @SuppressWarnings("unchecked")
    private MapSqlParameterSource claimParams() {
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).query(eq(AiEvaluationQueueClaimer.CLAIM_SQL), params.capture(), any(RowMapper.class));
        return (MapSqlParameterSource) params.getValue();
    }

    // ------------------------------------------------------------------ SQL shape

    @Test
    void theClaimIsOneGuardedUpdateIntoDispatchedReturningTheIds() {
        String sql = AiEvaluationQueueClaimer.CLAIM_SQL;
        assertThat(sql).contains("UPDATE ai_evaluation_process t")
                .contains("SET status = 'DISPATCHED', claimed_by = :me, claimed_at = :now")
                .contains("current_step = 'CLAIMED'")
                .contains("RETURNING t.id, t.attempt_id")
                // re-checked under the row lock, and never two pods on one row
                .contains("WHERE q.status = 'PENDING' AND c.slot <= c.cap")
                .contains("FOR UPDATE OF q SKIP LOCKED")
                .contains("LIMIT :room");
    }

    @Test
    void theClaimOrdersBySlotSoANewcomerGoesAheadOfABacklog() {
        String sql = AiEvaluationQueueClaimer.CLAIM_SQL;
        // slot = the institute's running count + its place in its own queue ...
        assertThat(sql).contains("COALESCE(r.n, 0) + c.rn AS slot")
                .contains("row_number() OVER (ORDER BY p.created_at, p.id) AS rn")
                // ... per lane and institute, waiting rows only, stale claims allowed ...
                .contains("p.status = 'PENDING'")
                .contains("p.lane = :lane")
                .contains("(p.claimed_at IS NULL OR p.claimed_at < :staleBefore)")
                // ... capped per institute, with overrides ...
                .contains("COALESCE(k.cap, :perInstituteCap) AS cap")
                .contains("unnest(CAST(:overrideIds AS text[]), CAST(:overrideCaps AS int[]))")
                // ... and taken in slot order: max-min fairness.
                .contains("ORDER BY c.slot, c.created_at, q.id");
        // Rows whose institute could not be traced still drain.
        assertThat(sql).contains("r.institute_id IS NOT DISTINCT FROM w.institute_id")
                .contains("(p.institute_id IS NULL AND w.institute_id IS NULL)");
    }

    @Test
    void runningIsCountedOverEveryInFlightStatusIncludingDispatched() {
        assertThat(AiEvaluationQueueClaimer.RUNNING_SQL).contains("lane = :lane AND status IN (:inFlight)");
        assertThat(AiEvaluationStatusEnum.IN_FLIGHT).contains("DISPATCHED", "PROCESSING", "EXTRACTING", "EVALUATING")
                .doesNotContain("PENDING", "COMPLETED", "FAILED", "CANCELLED");
    }

    @Test
    void theLockIsPerLane() {
        assertThat(AiEvaluationQueueClaimer.TRY_LOCK_SQL).contains("pg_try_advisory_xact_lock(hashtext(:lockKey))");
        lockAcquired(false);

        claimer.claim(AiEvaluationLane.TYPED, caps, "pod-a", now, staleBefore);

        ArgumentCaptor<SqlParameterSource> lock = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).queryForObject(eq(AiEvaluationQueueClaimer.TRY_LOCK_SQL), lock.capture(), eq(Boolean.class));
        assertThat(lock.getValue().getValue("lockKey")).isEqualTo("ai_eval_claim:TYPED");
    }

    // ------------------------------------------------------------------ the Java around it

    @Test
    @SuppressWarnings("unchecked")
    void anotherReplicaHoldingTheLockMeansNoClaimThisTick() {
        lockAcquired(false);

        List<ClaimedJob> claimed = claimer.claim(AiEvaluationLane.COPY, caps, "pod-a", now, staleBefore);

        assertThat(claimed).isEmpty();
        verify(jdbc, never()).query(eq(AiEvaluationQueueClaimer.RUNNING_SQL), any(SqlParameterSource.class),
                any(RowCallbackHandler.class));
        verify(jdbc, never()).query(eq(AiEvaluationQueueClaimer.CLAIM_SQL), any(SqlParameterSource.class),
                any(RowMapper.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aFullLaneClaimsNothing() {
        lockAcquired(true);
        running(Map.of("inst-a", 2L, "inst-b", 1L));

        assertThat(claimer.claim(AiEvaluationLane.COPY, caps, "pod-a", now, staleBefore)).isEmpty();
        verify(jdbc, never()).query(eq(AiEvaluationQueueClaimer.CLAIM_SQL), any(SqlParameterSource.class),
                any(RowMapper.class));
    }

    @Test
    void roomIsWhatIsLeftOfTheLaneAcrossAllInstitutes() {
        lockAcquired(true);
        running(Map.of("inst-a", 1L));

        claimer.claim(AiEvaluationLane.COPY, caps, "pod-a", now, staleBefore);

        MapSqlParameterSource params = claimParams();
        assertThat(params.getValue("room")).isEqualTo(2);
        assertThat(params.getValue("lane")).isEqualTo("COPY");
        assertThat(params.getValue("me")).isEqualTo("pod-a");
        // A 3-slot COPY lane: one institute alone may use all of it.
        assertThat(params.getValue("perInstituteCap")).isEqualTo(3);
        assertThat(params.getValue("overrideIds")).isEqualTo("{}");
        assertThat(params.getValue("overrideCaps")).isEqualTo("{}");
    }

    @Test
    void theTypedLaneUsesItsOwnCaps() {
        lockAcquired(true);
        running(Map.of("inst-a", 6L, "inst-b", 2L));

        claimer.claim(AiEvaluationLane.TYPED, caps, "pod-a", now, staleBefore);

        MapSqlParameterSource params = claimParams();
        assertThat(params.getValue("room")).isEqualTo(4); // 12 - 8
        assertThat(params.getValue("perInstituteCap")).isEqualTo(6);
        assertThat(params.getValue("perInstituteCapMax")).isEqualTo(6);
    }

    @Test
    void perInstituteOverridesReachTheStatement() {
        caps.setOverride(AiEvaluationLane.COPY, "inst-big", 5);
        lockAcquired(true);
        running(Map.of());

        claimer.claim(AiEvaluationLane.COPY, caps, "pod-a", now, staleBefore);

        MapSqlParameterSource params = claimParams();
        assertThat(params.getValue("overrideIds")).isEqualTo("{\"inst-big\"}");
        assertThat(params.getValue("overrideCaps")).isEqualTo("{5}");
        // The per-institute look-ahead must reach the biggest cap.
        assertThat(params.getValue("perInstituteCapMax")).isEqualTo(5);
    }

    @Test
    void roomNeverPassesTheBatchOrTheLaneCap() {
        assertThat(AiEvaluationQueueClaimer.room(3, 3, 0)).isEqualTo(3);
        assertThat(AiEvaluationQueueClaimer.room(3, 3, 2)).isEqualTo(1);
        assertThat(AiEvaluationQueueClaimer.room(3, 3, 5)).isZero(); // over cap after a direct run
        assertThat(AiEvaluationQueueClaimer.room(2, 12, 0)).isEqualTo(2);
    }

    @Test
    void arrayLiteralsCannotBeBrokenOutOf() {
        assertThat(AiEvaluationQueueClaimer.pgTextArray(List.of("a", "b\"c", "d\\e")))
                .isEqualTo("{\"a\",\"b\\\"c\",\"d\\\\e\"}");
        assertThat(AiEvaluationQueueClaimer.pgIntArray(List.of(1, 2))).isEqualTo("{1,2}");
    }
}
