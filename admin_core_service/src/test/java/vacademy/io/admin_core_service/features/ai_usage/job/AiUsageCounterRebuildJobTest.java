package vacademy.io.admin_core_service.features.ai_usage.job;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import vacademy.io.admin_core_service.features.credits.client.AiLimitsPolicyIndex;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AiUsageCounterRebuildJobTest {

    /** Fake DB: only the setting read. */
    static class FakeDb extends JdbcTemplate {
        String setting;
        boolean fail;

        @Override
        @SuppressWarnings("unchecked")
        public <T> List<T> queryForList(String s, Class<T> type, Object... args) {
            if (fail) throw new IllegalStateException("db down");
            return setting == null ? List.of() : (List<T>) List.of(setting);
        }
    }

    private final FakeDb db = new FakeDb();
    private final CreditClient credits = mock(CreditClient.class);
    private final AiLimitsPolicyIndex index = mock(AiLimitsPolicyIndex.class);
    private final AiUsageCounterRebuildJob job = new AiUsageCounterRebuildJob(db, credits, index);

    @Test
    void switchedOffDoesNothing() {
        db.setting = "\"false\"";
        when(index.anyInstituteHasLimits()).thenReturn(true);
        assertNull(job.runOnce());
        verify(credits, never()).rebuildUsageCounters(anyInt());
    }

    @Test
    void noInstituteWithLimitsMeansNoCall() {
        when(index.anyInstituteHasLimits()).thenReturn(false);
        assertNull(job.runOnce());
        verify(credits, never()).rebuildUsageCounters(anyInt());
    }

    @Test
    void rebuildsThirtyFiveDaysAndReturnsTheReport() {
        when(index.anyInstituteHasLimits()).thenReturn(true);
        when(credits.rebuildUsageCounters(35)).thenReturn(Map.of("counters_fixed", 2));
        Map<String, Object> report = job.runOnce();
        assertNotNull(report);
        assertEquals(2, report.get("counters_fixed"));
        verify(credits).rebuildUsageCounters(35);
    }

    @Test
    void aFailedRebuildIsLoggedNotThrown() {
        when(index.anyInstituteHasLimits()).thenReturn(true);
        when(credits.rebuildUsageCounters(35)).thenReturn(null);
        assertNull(job.runOnce());
        when(credits.rebuildUsageCounters(35)).thenReturn(Map.of("ok", false, "error", "limits engine unavailable"));
        assertEquals(false, job.runOnce().get("ok"), "an engine failure is reported, not thrown");
        when(credits.rebuildUsageCounters(35)).thenThrow(new RuntimeException("boom"));
        assertDoesNotThrow(job::run);
    }

    @Test
    void settingDefaultsOn() {
        assertTrue(job.isEnabled(), "absent = on");
        db.setting = "true";
        assertTrue(job.isEnabled());
        db.setting = "false";
        assertFalse(job.isEnabled());
        db.fail = true;
        assertTrue(job.isEnabled(), "unreadable = on");
        assertEquals("metering.limits.rebuild.enabled", AiUsageCounterRebuildJob.SETTING_KEY);
    }

    @Test
    void scheduledOnceANightUnderAShedLock() throws Exception {
        var m = AiUsageCounterRebuildJob.class.getMethod("run");
        Scheduled s = m.getAnnotation(Scheduled.class);
        SchedulerLock l = m.getAnnotation(SchedulerLock.class);
        assertNotNull(s);
        assertNotNull(l);
        assertEquals("UTC", s.zone());
        assertEquals("AiUsageCounterRebuildJob", l.name());
        assertFalse(AiUsageCounterRebuildJob.SELECT_SETTING.contains(":"));
    }
}
