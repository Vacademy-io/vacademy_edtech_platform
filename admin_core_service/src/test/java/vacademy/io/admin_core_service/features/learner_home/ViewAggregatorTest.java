package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeViewAggregator;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ViewAggregatorTest {

    @SuppressWarnings("unchecked")
    @Test
    void concurrentIncrementsFlushAsOneUpsertRowPerKeyInTheInstituteDay() throws Exception {
        LearnerHomeJdbc jdbc = mock(LearnerHomeJdbc.class);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone("i")).thenReturn(ZoneId.of("Asia/Kolkata"));
        LearnerHomeViewAggregator agg = new LearnerHomeViewAggregator(jdbc, tz);
        // 20:00 UTC is already the next day in India.
        Instant at = Instant.parse("2026-11-16T20:00:00Z");
        ExecutorService pool = Executors.newFixedThreadPool(8);
        CountDownLatch start = new CountDownLatch(1);
        for (int t = 0; t < 8; t++) {
            pool.submit(() -> {
                start.await();
                for (int i = 0; i < 1000; i++) agg.record("i", "b1", null, "PHONE", at);
                return null;
            });
        }
        start.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
        agg.record("i", "b1", "s1", "DESKTOP", at);

        assertEquals(2, agg.flush());
        ArgumentCaptor<List<LearnerHomeJdbc.ViewRow>> rows = ArgumentCaptor.forClass(List.class);
        verify(jdbc).upsertViews(rows.capture());
        LearnerHomeJdbc.ViewRow block = rows.getValue().stream().filter(r -> r.itemKey().isEmpty()).findFirst().orElseThrow();
        assertEquals(8000, block.views());
        assertEquals(LocalDate.of(2026, 11, 17), block.day());
        assertEquals("PHONE", block.device());
        // a second flush with nothing new writes nothing
        assertEquals(0, agg.flush());
        verify(jdbc, times(1)).upsertViews(any());
    }

    @Test
    void aFailedFlushKeepsTheCountsAndShutdownFlushes() {
        LearnerHomeJdbc jdbc = mock(LearnerHomeJdbc.class);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone(any())).thenThrow(new RuntimeException("db down"));
        LearnerHomeViewAggregator agg = new LearnerHomeViewAggregator(jdbc, tz);
        agg.record("i", "b1", null, "PHONE", Instant.parse("2026-11-16T10:00:00Z"));
        agg.record("i", "b1", null, "PHONE", Instant.parse("2026-11-16T10:00:00Z"));
        doThrow(new RuntimeException("down")).doNothing().when(jdbc).upsertViews(any());
        assertEquals(0, agg.flush());
        agg.flushOnShutdown();
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LearnerHomeJdbc.ViewRow>> rows = ArgumentCaptor.forClass(List.class);
        verify(jdbc, times(2)).upsertViews(rows.capture());
        assertEquals(2, rows.getAllValues().get(1).get(0).views());
        assertEquals(ZoneId.of("Asia/Kolkata"), agg.zone("other"), "timezone failure falls back to IST");
    }
}
