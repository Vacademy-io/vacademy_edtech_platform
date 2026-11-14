package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardBatchBalanceProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardBreakdownProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardPackageSessionProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardSeriesProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentDashboardRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentDashboardResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentDashboardRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Assembly of the Payment Dashboard response: the month / financial-year / day series are
 * zero-filled and cut in the admin's zone, the comparison window is a year earlier, and batch rows
 * merge collections with balances. The SQL itself is reconciled against the billing summary on
 * real data, not here.
 */
class PaymentDashboardServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final LocalDateTime START = LocalDateTime.of(2026, 3, 31, 18, 30); // 1 Apr 2026 IST
    private static final LocalDateTime END = LocalDateTime.of(2026, 9, 28, 12, 0);

    private final PaymentDashboardService service = new PaymentDashboardService();
    private final PaymentDashboardRepository repo = mock(PaymentDashboardRepository.class);
    private final UserPlanRepository userPlanRepository = mock(UserPlanRepository.class);
    private final PaymentLogService paymentLogService = mock(PaymentLogService.class);

    @BeforeEach
    void wire() {
        ReflectionTestUtils.setField(service, "dashboardRepository", repo);
        ReflectionTestUtils.setField(service, "userPlanRepository", userPlanRepository);
        ReflectionTestUtils.setField(service, "paymentLogService", paymentLogService);
        ReflectionTestUtils.setField(service, "upcomingDays", 30);
        when(paymentLogService.getBillingSummary(any())).thenReturn(BillingSummaryResponseDTO.builder()
                .collected(5000d).due(300d).upcoming(200d).upcomingDays(30).upcomingAll(900d)
                .outstanding(1200d).learnersOwing(3L).learnersUpcoming(2L).learnersUpcomingAll(4L)
                .currency("INR").build());
    }

    private static PaymentDashboardRequestDTO request(LocalDateTime start, LocalDateTime end, String zone) {
        PaymentDashboardRequestDTO r = new PaymentDashboardRequestDTO();
        r.setInstituteId(INSTITUTE);
        r.setStartDateInUtc(start);
        r.setEndDateInUtc(end);
        r.setTimeZone(zone);
        return r;
    }

    private static DashboardSeriesProjection month(String bucket, double amount) {
        DashboardSeriesProjection p = mock(DashboardSeriesProjection.class);
        when(p.getBucket()).thenReturn(bucket);
        when(p.getAmount()).thenReturn(amount);
        when(p.getPayments()).thenReturn(1L);
        when(p.getPayers()).thenReturn(1L);
        return p;
    }

    private static DashboardBreakdownProjection slice(String dimension, String key, double amount, long payers) {
        DashboardBreakdownProjection p = mock(DashboardBreakdownProjection.class);
        when(p.getDimension()).thenReturn(dimension);
        when(p.getBucketKey()).thenReturn(key);
        when(p.getAmount()).thenReturn(amount);
        when(p.getPayments()).thenReturn(payers);
        when(p.getPayers()).thenReturn(payers);
        return p;
    }

    @Test
    @DisplayName("months, financial years and days are zero-filled and cut in the normalised zone")
    void seriesAreZeroFilledInTheAdminsZone() {
        // Mocks are built before stubbing starts — Mockito rejects a mock created mid-stub.
        List<DashboardSeriesProjection> months = List.of(month("2026-09", 1000), month("2025-09", 400),
                month("2026-03", 200), month("2023-04", 50));
        when(repo.collectedByMonth(eq(INSTITUTE), any(), any(), anyBoolean(), anyList(), anyString()))
                .thenReturn(months);

        // Chrome reports India as Asia/Calcutta, a name prod Postgres rejects.
        PaymentDashboardResponseDTO d = service.getDashboard(request(START, END, "Asia/Calcutta"));

        assertEquals("Asia/Kolkata", d.getTimeZone());
        verify(repo).collectedByMonth(eq(INSTITUTE), eq(LocalDateTime.of(2023, 3, 31, 18, 30)), eq(END),
                eq(true), anyList(), eq("Asia/Kolkata"));

        assertEquals(24, d.getMonths().size());
        assertEquals("2024-10", d.getMonths().get(0).getBucket());
        assertEquals("2026-09", d.getMonths().get(23).getBucket());
        assertEquals(1000d, d.getMonths().get(23).getCollected());
        assertEquals(400d, d.getMonths().get(11).getCollected());
        assertEquals(0d, d.getMonths().get(22).getCollected());

        Map<String, PaymentDashboardResponseDTO.YearPoint> years = d.getYears().stream()
                .collect(Collectors.toMap(PaymentDashboardResponseDTO.YearPoint::getFinancialYear, Function.identity()));
        assertEquals(List.of("2023-24", "2024-25", "2025-26", "2026-27"),
                d.getYears().stream().map(PaymentDashboardResponseDTO.YearPoint::getFinancialYear).toList());
        assertEquals(50d, years.get("2023-24").getCollected());
        assertEquals(0d, years.get("2024-25").getCollected());
        // March 2026 belongs to FY 2025-26, not the calendar year it falls in.
        assertEquals(600d, years.get("2025-26").getCollected());
        assertFalse(years.get("2025-26").getPartial());
        assertEquals(1000d, years.get("2026-27").getCollected());
        assertTrue(years.get("2026-27").getPartial());

        assertEquals(182, d.getDays().size());
        // 12:00 UTC on the 28th is 17:30 IST — still the 28th.
        assertEquals("2026-09-28", d.getDays().get(181).getBucket());
    }

    @Test
    @DisplayName("the comparison window is the same period a year earlier")
    void comparesWithTheSamePeriodAYearEarlier() {
        List<DashboardBreakdownProjection> current = List.of(slice("TOTAL", null, 1500, 12));
        List<DashboardBreakdownProjection> previous = List.of(slice("TOTAL", null, 1000, 10));
        when(repo.collectedBreakdown(INSTITUTE, START, END, true, List.of("__none__"))).thenReturn(current);
        when(repo.collectedBreakdown(INSTITUTE, START.minusYears(1), END.minusYears(1), true, List.of("__none__")))
                .thenReturn(previous);

        PaymentDashboardResponseDTO d = service.getDashboard(request(START, END, "Asia/Kolkata"));

        assertEquals(1500d, d.getKpis().getCollected());
        assertEquals(1000d, d.getKpis().getPreviousCollected());
        assertEquals(12L, d.getKpis().getPayingLearners());
        assertEquals(10L, d.getKpis().getPreviousPayingLearners());
        assertEquals(START.minusYears(1), d.getPreviousStart());
        // Balances come straight from the billing summary Manage Payments shows.
        assertEquals(300d, d.getKpis().getOverdue());
        assertEquals(200d, d.getKpis().getDueSoon());
        assertEquals(900d, d.getKpis().getStillToCome());
        assertEquals(5000d, d.getKpis().getCollectedAllTime());
        assertEquals("INR", d.getCurrency());
    }

    @Test
    @DisplayName("all time has no comparison and asks for the breakdown once")
    void allTimeHasNoComparison() {
        PaymentDashboardResponseDTO d = service.getDashboard(request(null, END, null));

        assertNull(d.getPeriodStart());
        assertNull(d.getPreviousStart());
        assertNull(d.getKpis().getPreviousCollected());
        assertNull(d.getKpis().getPreviousPayingLearners());
        assertNull(d.getKpis().getPreviousNewPayingLearners());
        assertEquals("Z", d.getTimeZone());
        verify(repo, times(1)).collectedBreakdown(anyString(), any(), any(), anyBoolean(), anyList());
    }

    @Test
    @DisplayName("an unknown zone falls back to UTC instead of failing the query")
    void unknownZoneFallsBackToUtc() {
        PaymentDashboardResponseDTO d = service.getDashboard(request(START, END, "Mars/Olympus"));
        assertEquals("Z", d.getTimeZone());
    }

    @Test
    @DisplayName("a bare offset falls back to UTC, since Postgres reads its sign the other way")
    void bareOffsetFallsBackToUtc() {
        assertEquals("Z", service.getDashboard(request(START, END, "+05:30")).getTimeZone());
        assertEquals("Z", service.getDashboard(request(START, END, "GMT+5")).getTimeZone());
    }

    @Test
    @DisplayName("a window that ends before it starts is rejected")
    void rejectsBackwardsWindow() {
        assertThrows(VacademyException.class, () -> service.getDashboard(request(END, START, null)));
    }

    @Test
    @DisplayName("batch rows merge period, all-time and balances; only real batches are looked up")
    void batchRowsMergeCollectionsAndBalances() {
        List<DashboardBreakdownProjection> period = List.of(slice("TOTAL", null, 150, 2),
                slice("BATCH", "ps-1", 100, 1), slice("BATCH", null, 50, 1));
        List<DashboardBreakdownProjection> allTime = List.of(slice("BATCH", "ps-1", 300, 3));
        when(repo.collectedBreakdown(INSTITUTE, START, END, true, List.of("__none__"))).thenReturn(period);
        when(repo.collectedBreakdown(eq(INSTITUTE), eq(LocalDateTime.of(1970, 1, 1, 0, 0)), any(), eq(true), anyList()))
                .thenReturn(allTime);
        DashboardBatchBalanceProjection owed = mock(DashboardBatchBalanceProjection.class);
        when(owed.getPackageSessionId()).thenReturn("ps-2");
        when(owed.getOverdue()).thenReturn(70d);
        when(owed.getStillToCome()).thenReturn(30d);
        when(owed.getLearners()).thenReturn(2L);
        when(repo.balancesByBatch(anyString(), any(), any(), anyBoolean(), anyList(), anyInt()))
                .thenReturn(List.of(owed));
        DashboardPackageSessionProjection name = mock(DashboardPackageSessionProjection.class);
        when(name.getPackageSessionId()).thenReturn("ps-1");
        when(name.getPackageName()).thenReturn("Pre-Sea DNS");
        when(repo.packageSessionNames(anyList())).thenReturn(List.of(name));

        PaymentDashboardResponseDTO d = service.getDashboard(request(START, END, "Asia/Kolkata"));

        Map<String, PaymentDashboardResponseDTO.BatchRow> rows = d.getBatches().stream()
                .collect(Collectors.toMap(r -> String.valueOf(r.getPackageSessionId()), Function.identity()));
        assertEquals(3, rows.size());
        assertEquals(100d, rows.get("ps-1").getCollected());
        assertEquals(300d, rows.get("ps-1").getCollectedAllTime());
        assertEquals("Pre-Sea DNS", rows.get("ps-1").getPackageName());
        assertEquals(50d, rows.get("null").getCollected());
        assertNull(rows.get("null").getPackageName());
        assertEquals(70d, rows.get("ps-2").getOverdue());
        assertEquals(30d, rows.get("ps-2").getStillToCome());
        assertEquals(2L, rows.get("ps-2").getLearners());
        verify(repo).packageSessionNames(List.of("ps-1", "ps-2"));
    }
}
