package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.CodOrderRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DueRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DueTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.RemittanceRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.RtoRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** COD outstanding as of a day, red after 10 days; customer dues net of returns not paid back (contract 2.9, 2.10). */
class CodDuesReportServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 19);

    private MoneyReportRepository repository;
    private CodDuesReportService service;
    private ReportQuery query;

    @BeforeEach
    void setUp() {
        repository = mock(MoneyReportRepository.class);
        service = new CodDuesReportService(repository);
        when(repository.locations("inst-1")).thenReturn(List.of());
        query = ReportQuery.builder().instituteId("inst-1").range(new ReportRange(LocalDate.of(2026, 11, 1), TODAY))
                .scope(new ReportScope(true, null, true, null)).today(TODAY).build();
    }

    private static CodOrderRow cod(String number, LocalDate delivered) {
        return new CodOrderRow("o-" + number, number, LocalDate.of(2026, 11, 1), "Buyer", "9000000000",
                "Test courier", "TRK", LocalDate.of(2026, 11, 2), delivered, new BigDecimal("250.00"), "L1");
    }

    private void outstanding(List<CodOrderRow> rows) {
        doAnswer(inv -> {
            Consumer<CodOrderRow> sink = inv.getArgument(3);
            rows.forEach(sink);
            return null;
        }).when(repository).codOutstanding(any(), any(), any(), any());
    }

    private static ReportDtos.Section section(ReportAnswer a, String key) {
        return a.getSections().stream().filter(s -> s.getKey().equals(key)).findFirst().orElseThrow();
    }

    @Test
    void outstandingIsReadAsOfTheEndOfTheIndiaDay() {
        LocalDate asOf = LocalDate.of(2026, 11, 11);
        service.codOutstanding(query.toBuilder().asOf(asOf).build());
        verify(repository).codOutstanding(any(), eq(asOf), eq(StockClock.storedStartOf(asOf.plusDays(1))), any());
        verify(repository).codInTransit(any(), eq(StockClock.storedStartOf(asOf.plusDays(1))), any());
        service.codOutstanding(query);
        verify(repository).codOutstanding(any(), eq(TODAY), eq(StockClock.storedStartOf(TODAY.plusDays(1))), any());
    }

    @Test
    void anAsOfDayAfterTodayIsRefused() {
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.codOutstanding(query.toBuilder().asOf(TODAY.plusDays(1)).build()));
        assertTrue(e.getMessage().startsWith("VALIDATION"));
    }

    @Test
    void redAfterTenDays() {
        outstanding(List.of(cod("C-10", TODAY.minusDays(10)), cod("C-11", TODAY.minusDays(11))));
        ReportAnswer a = service.codOutstanding(query);
        List<Map<String, Object>> rows = section(a, "outstanding").getRows();
        assertEquals(10L, rows.get(0).get("days_outstanding"));
        assertEquals(false, rows.get(0).get("red_flag"));
        assertEquals(11L, rows.get(1).get("days_outstanding"));
        assertEquals(true, rows.get(1).get("red_flag"));
        assertEquals(2L, a.getTotals().get("outstanding_count"));
        assertEquals(new BigDecimal("500.00"), a.getTotals().get("outstanding_amount"));
        assertEquals(1L, a.getTotals().get("red_flag_count"));
        assertEquals("2026-11-19", a.getFilters().get("as_of"));
    }

    @Test
    void remittancesAndTheRtoRate() {
        doAnswer(inv -> {
            Consumer<RemittanceRow> sink = inv.getArgument(1);
            sink.accept(new RemittanceRow("r-1", LocalDate.of(2026, 11, 12), "REM-1", "Test courier", 2,
                    new BigDecimal("500.00"), new BigDecimal("480.00"), new BigDecimal("25.00"),
                    new BigDecimal("455.00"), "short paid"));
            return null;
        }).when(repository).remittances(any(), any());
        when(repository.rto(any(), any(), any())).thenReturn(List.of(new RtoRow("COD", 3, 1),
                new RtoRow("PREPAID", 4, 0)));
        ReportAnswer a = service.codOutstanding(query);
        ReportDtos.Section remittances = section(a, "remittances");
        assertEquals(new BigDecimal("480.00"), remittances.getTotals().get("gross"));
        assertEquals(new BigDecimal("25.00"), remittances.getTotals().get("deductions"));
        assertEquals(new BigDecimal("455.00"), remittances.getTotals().get("net"));
        assertEquals("short paid", remittances.getRows().get(0).get("difference_reason"));
        ReportDtos.Section rto = section(a, "rto");
        assertEquals(new BigDecimal("33.33"), rto.getRows().get(0).get("rto_rate"));
        assertEquals(new BigDecimal("0.00"), rto.getRows().get(1).get("rto_rate"));
        assertEquals(List.of("outstanding", "in_transit", "remittances", "rto"),
                a.getSections().stream().map(ReportDtos.Section::getKey).toList());
    }

    private void dues(List<DueRow> rows) {
        doAnswer(inv -> {
            Consumer<DueRow> sink = inv.getArgument(3);
            rows.forEach(sink);
            return null;
        }).when(repository).dues(any(), any(), any(), any());
        when(repository.dueTotals(any())).thenReturn(new DueTotals(2, 2, new BigDecimal("1300.00"),
                new BigDecimal("1000.00"), new BigDecimal("300.00"), new BigDecimal("0.00"), 1));
    }

    @Test
    void dueIsNetOfReturnCreditNotPaidBackAndNeverBelowZero() {
        dues(List.of(
                new DueRow("o-1", "ORD-1", LocalDate.of(2026, 11, 9), "Credit buyer", "9000000001",
                        new BigDecimal("1000.00"), BigDecimal.ZERO, new BigDecimal("300.00"), "L1"),
                new DueRow("o-2", "ORD-2", LocalDate.of(2026, 11, 10), "Other buyer", "9000000002",
                        new BigDecimal("300.00"), new BigDecimal("300.00"), BigDecimal.ZERO, "L1")));
        ReportAnswer a = service.customerDues(query);
        Map<String, Object> first = a.getRows().get(0);
        assertEquals(new BigDecimal("300.00"), first.get("credited_by_returns"));
        assertEquals(new BigDecimal("700.00"), first.get("due"));
        assertEquals(10L, first.get("days_outstanding"));
        assertEquals(new BigDecimal("0.00"), a.getRows().get(1).get("due"));
        assertEquals(1, a.getWarnings().size());
        assertEquals(CodDuesReportService.DUE_REDUCED_BY_RETURN, a.getWarnings().get(0).getCode());
        assertEquals("ORD-1", a.getWarnings().get(0).getRef());
        // Totals come from one aggregate query, never a sum of the page.
        assertEquals(new BigDecimal("1300.00"), a.getTotals().get("total"));
        assertEquals(2L, a.getTotals().get("customers"));
        assertNull(a.getNextCursor());
    }

    @Test
    void duesPageByKeyset() {
        DueRow one = new DueRow("o-1", "ORD-1", LocalDate.of(2026, 11, 9), "A", "1", new BigDecimal("10.00"),
                BigDecimal.ZERO, BigDecimal.ZERO, "L1");
        DueRow two = new DueRow("o-2", "ORD-2", LocalDate.of(2026, 11, 10), "B", "2", new BigDecimal("10.00"),
                BigDecimal.ZERO, BigDecimal.ZERO, "L1");
        dues(List.of(one, two));
        ReportAnswer page = service.customerDues(query.toBuilder().size(1).build());
        assertEquals(1, page.getRows().size());
        assertNotNull(page.getNextCursor());
        Keyset keyset = ReportCursor.decode(page.getNextCursor());
        assertEquals(new Keyset(LocalDate.of(2026, 11, 9), "ORD-1", "o-1"), keyset);
        verify(repository).dues(any(), eq(null), eq(2), any());
        service.customerDues(query.toBuilder().size(1).cursor(page.getNextCursor()).build());
        verify(repository).dues(any(), eq(keyset), eq(2), any());
    }

    @Test
    void theDueRuleIsTheReceiptRule() {
        assertEquals(0, new BigDecimal("700.00").compareTo(
                vacademy.io.admin_core_service.features.commerce.order.desk.CommerceReceiptService.amountDue(
                        new BigDecimal("1000.00"), BigDecimal.ZERO, new BigDecimal("300.00"))));
        assertFalse(CodDuesReportService.RED_FLAG_DAYS != 10);
    }
}
