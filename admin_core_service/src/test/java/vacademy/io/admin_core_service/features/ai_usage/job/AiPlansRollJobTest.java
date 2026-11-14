package vacademy.io.admin_core_service.features.ai_usage.job;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AiPlansRollJobTest {

    /** Fake DB: the setting read and the "anything to roll" probe. */
    static class FakeDb extends JdbcTemplate {
        String setting;
        boolean settingFails;
        boolean anyRollable;
        boolean subscriptionTableMissing;

        @Override
        @SuppressWarnings("unchecked")
        public <T> List<T> queryForList(String sql, Class<T> type, Object... args) {
            if (sql.equals(AiPlansRollJob.SELECT_SETTING)) {
                if (settingFails) throw new IllegalStateException("db down");
                return setting == null ? List.of() : (List<T>) List.of(setting);
            }
            if (sql.equals(AiPlansRollJob.SELECT_ANY_ROLLABLE)) {
                if (subscriptionTableMissing) throw new IllegalStateException("relation does not exist");
                return anyRollable ? (List<T>) List.of(1) : List.of();
            }
            throw new AssertionError("unexpected SQL " + sql);
        }

        /** The no-argument overload the "anything to roll" probe resolves to. */
        @Override
        public <T> List<T> queryForList(String sql, Class<T> type) {
            return queryForList(sql, type, new Object[0]);
        }
    }

    private final FakeDb db = new FakeDb();
    private final CreditClient credits = mock(CreditClient.class);
    private final AiPlansRollJob job = new AiPlansRollJob(db, credits);

    @Test
    void switchedOffDoesNothing() {
        db.setting = "\"false\"";
        db.anyRollable = true;
        assertNull(job.runOnce());
        db.setting = "false";
        assertNull(job.runOnce());
        verify(credits, never()).rollAiPlans();
    }

    @Test
    void noSubscriptionOrNoTableMeansNoCall() {
        assertNull(job.runOnce(), "no subscriptions: the day this ships");
        db.subscriptionTableMissing = true;
        assertNull(job.runOnce(), "before the migration");
        verify(credits, never()).rollAiPlans();
    }

    @Test
    void rollsAndReturnsTheReport() {
        db.anyRollable = true;
        when(credits.rollAiPlans()).thenReturn(Map.of("ok", true, "periods_created", 3));
        Map<String, Object> report = job.runOnce();
        assertNotNull(report);
        assertEquals(3, report.get("periods_created"));
        verify(credits, times(1)).rollAiPlans();
    }

    @Test
    void aFailedRollIsLoggedNotThrown() {
        db.anyRollable = true;
        when(credits.rollAiPlans()).thenReturn(null);
        assertNull(job.runOnce());
        when(credits.rollAiPlans()).thenReturn(Map.of("ok", false, "error", "plans engine unavailable"));
        assertEquals(false, job.runOnce().get("ok"));
        when(credits.rollAiPlans()).thenThrow(new RuntimeException("boom"));
        assertDoesNotThrow(job::run);
    }

    @Test
    void settingDefaultsOn() {
        assertTrue(job.isEnabled(), "absent = on");
        db.setting = "true";
        assertTrue(job.isEnabled());
        db.setting = "\"true\"";
        assertTrue(job.isEnabled());
        db.setting = "false";
        assertFalse(job.isEnabled());
        db.settingFails = true;
        assertTrue(job.isEnabled(), "unreadable = on");
        assertEquals("billing.plans.roll.enabled", AiPlansRollJob.SETTING_KEY);
    }

    @Test
    void scheduledHourlyUnderAShedLock() throws Exception {
        var m = AiPlansRollJob.class.getMethod("run");
        Scheduled s = m.getAnnotation(Scheduled.class);
        SchedulerLock l = m.getAnnotation(SchedulerLock.class);
        assertNotNull(s);
        assertNotNull(l);
        assertEquals("0 7 * * * *", s.cron(), "once an hour");
        assertEquals("UTC", s.zone());
        assertEquals("AiPlansRollJob", l.name());
        assertFalse(AiPlansRollJob.SELECT_SETTING.contains(":"));
        assertFalse(AiPlansRollJob.SELECT_ANY_ROLLABLE.contains(":"));
    }

    @Test
    void anUnpaidCheckoutAloneStillTriggersTheRoll() {
        // ai_service's roll expires PENDING paid-plan checkouts; the pre-check must not skip them.
        assertTrue(AiPlansRollJob.SELECT_ANY_ROLLABLE.contains("'PENDING'"));
    }
}
