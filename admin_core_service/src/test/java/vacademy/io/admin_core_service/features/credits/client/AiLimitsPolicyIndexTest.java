package vacademy.io.admin_core_service.features.credits.client;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AiLimitsPolicyIndexTest {

    /** Fake DB answering the one reload query; counts how often it ran. */
    static class FakeDb extends JdbcTemplate {
        List<String> rows = new ArrayList<>();
        boolean fail;
        int queries;

        @Override
        public void query(PreparedStatementCreator psc, RowCallbackHandler rch) {
            queries++;
            if (fail) {
                throw new BadSqlGrammarException("q", AiLimitsPolicyIndex.SELECT_POLICY_INSTITUTES,
                        new SQLException("relation \"institute_ai_limits_policy\" does not exist"));
            }
            for (String row : rows) {
                ResultSet rs = mock(ResultSet.class);
                try {
                    when(rs.getString(1)).thenReturn(row);
                    rch.processRow(rs);
                } catch (SQLException e) {
                    throw new IllegalStateException(e);
                }
            }
        }
    }

    private final FakeDb db = new FakeDb();
    private final AtomicLong clock = new AtomicLong(1_000_000_000L);
    /** Runs the reload inline, so most tests read like a synchronous cache. */
    private final AiLimitsPolicyIndex index = new AiLimitsPolicyIndex(db, clock::get, Runnable::run);

    private void advanceSeconds(long s) {
        clock.addAndGet(s * 1_000_000_000L);
    }

    @Test
    void emptyTableMeansNoInstituteIsGated() {
        assertFalse(index.mayHaveLimits("inst-1"));
        assertFalse(index.anyInstituteHasLimits());
        assertEquals(1, db.queries, "one load, then cached");
    }

    @Test
    void oneQueryPerTtlNotPerCall() {
        db.rows = List.of("inst-1", " inst-2 ");
        for (int i = 0; i < 1000; i++) {
            assertTrue(index.mayHaveLimits("inst-1"));
            assertTrue(index.mayHaveLimits("inst-2"));
            assertFalse(index.mayHaveLimits("inst-3"));
        }
        assertEquals(1, db.queries);

        advanceSeconds(AiLimitsPolicyIndex.TTL_SECONDS - 1);
        index.mayHaveLimits("inst-1");
        assertEquals(1, db.queries, "still fresh");

        db.rows = List.of("inst-3");
        advanceSeconds(2);
        assertTrue(index.mayHaveLimits("inst-3"), "reloaded after the TTL");
        assertFalse(index.mayHaveLimits("inst-1"));
        assertEquals(2, db.queries);
    }

    @Test
    void aFailedReloadKeepsTheLastGoodSet() {
        db.rows = List.of("inst-1");
        assertTrue(index.mayHaveLimits("inst-1"));
        db.fail = true;
        advanceSeconds(AiLimitsPolicyIndex.TTL_SECONDS + 1);
        assertTrue(index.mayHaveLimits("inst-1"), "last good set");
        assertEquals(2, db.queries);
        advanceSeconds(1);
        index.mayHaveLimits("inst-1");
        assertEquals(2, db.queries, "a failure also waits a TTL before the next try");
    }

    @Test
    void missingTableIsEmptyNotAnError() {
        db.fail = true;
        assertFalse(index.mayHaveLimits("inst-1"));
        assertFalse(index.anyInstituteHasLimits());
        db.fail = false;
        db.rows = List.of("inst-1");
        advanceSeconds(AiLimitsPolicyIndex.TTL_SECONDS + 1);
        assertTrue(index.mayHaveLimits("inst-1"), "picked up once the migration lands");
    }

    @Test
    void theReloadNeverRunsOnTheCallersThread() {
        // A pool that is saturated, or a slow query, must never hold up a request: the caller
        // only schedules the reload and answers from the last good set at once.
        List<Runnable> queued = new ArrayList<>();
        AiLimitsPolicyIndex async = new AiLimitsPolicyIndex(db, clock::get, queued::add);
        db.rows = List.of("inst-1");
        assertFalse(async.mayHaveLimits("inst-1"), "not loaded yet: allowed, no query on this thread");
        assertFalse(async.mayHaveLimits("inst-1"));
        assertEquals(0, db.queries);
        assertEquals(1, queued.size(), "one reload scheduled, not one per caller");
        queued.remove(0).run();
        assertEquals(1, db.queries);
        assertTrue(async.mayHaveLimits("inst-1"));
        assertEquals(0, queued.size(), "fresh: nothing scheduled");

        db.rows = List.of();
        advanceSeconds(AiLimitsPolicyIndex.TTL_SECONDS + 1);
        assertTrue(async.mayHaveLimits("inst-1"), "stale: still the last good set while the reload runs");
        assertEquals(1, queued.size());
        queued.remove(0).run();
        assertFalse(async.mayHaveLimits("inst-1"));
        assertEquals(2, db.queries);
    }

    @Test
    void aRefusingExecutorFailsOpen() {
        AiLimitsPolicyIndex refused = new AiLimitsPolicyIndex(db, clock::get, r -> {
            throw new java.util.concurrent.RejectedExecutionException("shutting down");
        });
        db.rows = List.of("inst-1");
        assertFalse(refused.mayHaveLimits("inst-1"));
        assertEquals(0, db.queries);
    }

    @Test
    void theNightlyJobReloadsOnItsOwnThread() {
        List<Runnable> queued = new ArrayList<>();
        AiLimitsPolicyIndex async = new AiLimitsPolicyIndex(db, clock::get, queued::add);
        db.rows = List.of("inst-1");
        assertTrue(async.anyInstituteHasLimits(), "the job thread may wait for the query");
        assertEquals(1, db.queries);
        assertEquals(0, queued.size());
    }

    @Test
    void blankInstituteNeverQueries() {
        assertFalse(index.mayHaveLimits(null));
        assertFalse(index.mayHaveLimits(" "));
        assertEquals(0, db.queries);
    }

    @Test
    void sqlFollowsTheNativeQueryRules() {
        String s = AiLimitsPolicyIndex.SELECT_POLICY_INSTITUTES;
        assertFalse(s.contains(":"));
        for (String line : s.split("\n")) {
            assertFalse(line.endsWith(" "), "no trailing space: [" + line + "]");
        }
        assertTrue(s.contains("FROM institute_ai_limits_policy\nWHERE"), "lines must not glue");
    }
}
