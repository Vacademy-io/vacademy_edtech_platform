package vacademy.io.admin_core_service.features.commerce.order.payment;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentFetchService.Kind;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentFetchService.Outcome;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The run of the fetch job: the window it asks for, the caps, the kinds, and failures that stay local. */
class CommercePaymentFetchJobTest {

    private static final Date NOW = Date.from(Instant.parse("2026-11-15T10:00:10Z"));

    private CommercePaymentGuard guard;
    private CommercePaymentFetchService fetchService;
    private CommercePaymentFetchJob job;

    @BeforeEach
    void setUp() {
        guard = mock(CommercePaymentGuard.class);
        fetchService = mock(CommercePaymentFetchService.class);
        job = new CommercePaymentFetchJob(guard, fetchService);
    }

    private static CommercePaymentGuard.DueFetch row(String id, String institute, Date holdExpiresAt) {
        return new CommercePaymentGuard.DueFetch(id, institute, "gw_" + id, "order-" + id, "PENDING_PAYMENT", 0, null,
                null, holdExpiresAt, null, new Date(NOW.getTime() - 180_000L));
    }

    @Test
    void theRunAsksForTheWindowsOfTheSchedule() {
        when(guard.dueFetches(any(), any(), any(), any(), any(), anyInt(), anyInt(), anyInt())).thenReturn(List.of());

        job.runOnce(NOW);

        verify(guard).dueFetches(NOW,
                new Date(NOW.getTime() - Duration.ofHours(48).toMillis()),
                new Date(NOW.getTime() + 60_000L),
                new Date(NOW.getTime() - Duration.ofMinutes(2).toMillis()),
                new Date(NOW.getTime() - Duration.ofMinutes(15).toMillis()),
                9, 25, 100);
    }

    @Test
    void eachRowGetsItsKind_finalWinsNearTheEndOfTheHold() {
        CommercePaymentGuard.DueFetch open = row("a", "inst-1", new Date(NOW.getTime() + 600_000L));
        CommercePaymentGuard.DueFetch nearEnd = row("b", "inst-1", new Date(NOW.getTime() + 30_000L));
        when(guard.dueFetches(any(), any(), any(), any(), any(), anyInt(), anyInt(), anyInt()))
                .thenReturn(List.of(open, nearEnd));
        when(fetchService.fetch(any(), any(), any())).thenReturn(Outcome.NO_PAYMENT);

        job.runOnce(NOW);

        verify(fetchService).fetch(open, Kind.OPEN, NOW);
        verify(fetchService).fetch(nearEnd, Kind.FINAL, NOW);
    }

    @Test
    void atMost100RowsARunAnd25AnInstitute() {
        List<CommercePaymentGuard.DueFetch> rows = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            rows.add(row("big-" + i, "inst-big", new Date(NOW.getTime() + 600_000L)));
        }
        for (int i = 0; i < 120; i++) {
            rows.add(row("r-" + i, "inst-" + (i % 10), new Date(NOW.getTime() + 600_000L)));
        }
        when(guard.dueFetches(any(), any(), any(), any(), any(), anyInt(), anyInt(), anyInt())).thenReturn(rows);
        when(fetchService.fetch(any(), any(), any())).thenReturn(Outcome.NO_PAYMENT);

        Map<Outcome, Integer> counts = job.runOnce(NOW);

        ArgumentCaptor<CommercePaymentGuard.DueFetch> fetched = ArgumentCaptor.forClass(
                CommercePaymentGuard.DueFetch.class);
        verify(fetchService, times(100)).fetch(fetched.capture(), any(), eq(NOW));
        assertEquals(25, fetched.getAllValues().stream().filter(r -> "inst-big".equals(r.instituteId())).count());
        assertEquals(100, counts.get(Outcome.NO_PAYMENT));
    }

    @Test
    void oneFailingRowDoesNotStopTheRun() {
        CommercePaymentGuard.DueFetch bad = row("bad", "inst-1", new Date(NOW.getTime() + 600_000L));
        CommercePaymentGuard.DueFetch good = row("good", "inst-1", new Date(NOW.getTime() + 600_000L));
        when(guard.dueFetches(any(), any(), any(), any(), any(), anyInt(), anyInt(), anyInt()))
                .thenReturn(List.of(bad, good));
        when(fetchService.fetch(eq(bad), any(), any())).thenThrow(new IllegalStateException("boom"));
        when(fetchService.fetch(eq(good), any(), any())).thenReturn(Outcome.CONFIRMED);

        Map<Outcome, Integer> counts = job.runOnce(NOW);

        assertEquals(1, counts.get(Outcome.ERROR));
        assertEquals(1, counts.get(Outcome.CONFIRMED));
    }

    @Test
    void aFailingCandidateQueryIsCaughtByTheScheduledEntry() {
        when(guard.dueFetches(any(), any(), any(), any(), any(), anyInt(), anyInt(), anyInt()))
                .thenThrow(new IllegalStateException("database down"));
        job.run();
        verify(fetchService, times(0)).fetch(any(), any(), any());
    }
}
