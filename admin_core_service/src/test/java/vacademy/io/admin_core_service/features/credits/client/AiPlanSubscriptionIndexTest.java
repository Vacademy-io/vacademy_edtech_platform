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

class AiPlanSubscriptionIndexTest {

    /** Fake DB answering the one reload query; counts how often it ran. */
    static class FakeDb extends JdbcTemplate {
        List<String> rows = new ArrayList<>();
        boolean fail;
        int queries;
        String lastSql;

        @Override
        public void query(PreparedStatementCreator psc, RowCallbackHandler rch) {
            queries++;
            if (fail) {
                throw new BadSqlGrammarException("q", AiPlanSubscriptionIndex.SELECT_LIVE_PLAN_INSTITUTES,
                        new SQLException("relation \"institute_ai_subscription\" does not exist"));
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
    private final AiPlanSubscriptionIndex index = new AiPlanSubscriptionIndex(db, clock::get, Runnable::run);

    private void advanceSeconds(long s) {
        clock.addAndGet(s * 1_000_000_000L);
    }

    @Test
    void noLiveSubscriptionMeansNoInstituteIsCovered() {
        assertFalse(index.mayHaveLivePlan("inst-1"));
        assertEquals(1, db.queries, "one load, then cached");
        assertFalse(index.mayHaveLivePlan("inst-1"));
        assertEquals(1, db.queries);
    }

    @Test
    void oneQueryPerTtlNotPerCall() {
        db.rows = List.of("inst-1", " inst-2 ");
        for (int i = 0; i < 1000; i++) {
            assertTrue(index.mayHaveLivePlan("inst-1"));
            assertTrue(index.mayHaveLivePlan("inst-2"));
            assertFalse(index.mayHaveLivePlan("inst-3"));
        }
        assertEquals(1, db.queries);
        db.rows = List.of("inst-3");
        advanceSeconds(AiPlanSubscriptionIndex.TTL_SECONDS + 1);
        assertTrue(index.mayHaveLivePlan("inst-3"), "reloaded after the TTL");
        assertFalse(index.mayHaveLivePlan("inst-1"));
        assertEquals(2, db.queries);
    }

    @Test
    void aFailedReloadKeepsTheLastGoodSetAndAMissingTableIsEmpty() {
        db.fail = true;
        assertFalse(index.mayHaveLivePlan("inst-1"), "before the migration: nobody is covered");
        db.fail = false;
        db.rows = List.of("inst-1");
        advanceSeconds(AiPlanSubscriptionIndex.TTL_SECONDS + 1);
        assertTrue(index.mayHaveLivePlan("inst-1"));
        db.fail = true;
        advanceSeconds(AiPlanSubscriptionIndex.TTL_SECONDS + 1);
        assertTrue(index.mayHaveLivePlan("inst-1"), "last good set");
    }

    @Test
    void theReloadNeverRunsOnTheCallersThread() {
        List<Runnable> queued = new ArrayList<>();
        AiPlanSubscriptionIndex async = new AiPlanSubscriptionIndex(db, clock::get, queued::add);
        db.rows = List.of("inst-1");
        assertFalse(async.mayHaveLivePlan("inst-1"), "not loaded yet: wallet-only, no query on this thread");
        assertFalse(async.mayHaveLivePlan("inst-1"));
        assertEquals(0, db.queries);
        assertEquals(1, queued.size(), "one reload scheduled, not one per caller");
        queued.remove(0).run();
        assertTrue(async.mayHaveLivePlan("inst-1"));
    }

    @Test
    void aRefusingExecutorMeansNotCovered() {
        AiPlanSubscriptionIndex refused = new AiPlanSubscriptionIndex(db, clock::get, r -> {
            throw new java.util.concurrent.RejectedExecutionException("shutting down");
        });
        db.rows = List.of("inst-1");
        assertFalse(refused.mayHaveLivePlan("inst-1"));
        assertEquals(0, db.queries);
    }

    @Test
    void blankInstituteNeverQueries() {
        assertFalse(index.mayHaveLivePlan(null));
        assertFalse(index.mayHaveLivePlan(" "));
        assertEquals(0, db.queries);
    }

    @Test
    void sqlOnlyCountsLiveEnforcedSubscriptionsBehindTheGlobalSwitch() {
        String s = AiPlanSubscriptionIndex.SELECT_LIVE_PLAN_INSTITUTES;
        assertFalse(s.contains(":"));
        for (String line : s.split("\n")) {
            assertFalse(line.endsWith(" "), "no trailing space: [" + line + "]");
        }
        assertTrue(s.contains("FROM institute_ai_subscription s\nWHERE"), "lines must not glue");
        assertTrue(s.contains("s.status IN ('TRIAL', 'ACTIVE', 'GRACE')"));
        assertTrue(s.contains("s.enforcement = 'LIVE'"), "SHADOW subscriptions charge as today");
        assertTrue(s.contains("p.setting_key = 'billing.plans.enabled'"));
        assertTrue(s.contains("= 'true'"), "absent or false switch = nobody");
        assertEquals("billing.plans.enabled", AiPlanSubscriptionIndex.PLANS_ENABLED_KEY);
    }
}
