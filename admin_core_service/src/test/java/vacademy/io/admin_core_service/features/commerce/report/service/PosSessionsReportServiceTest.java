package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.SessionRow;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** POS sessions (contract 2.11): closed sessions from their stored Z-report, open ones without totals. */
class PosSessionsReportServiceTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 5);

    /** A Z-report as the counter freezes it at close (snake_case, figures as numbers). */
    private static final String Z1 = """
            {"session_id":"s-1","opening_cash":1000.00,"bills":{"count":3,"total":1381.00},
             "voided":{"count":1,"total":52.50},"discounts":15.00,
             "by_mode":[{"mode":"CASH","count":2,"amount":900.00},{"mode":"UPI","count":1,"amount":381.11},
                        {"mode":"CREDIT_NOTE","count":1,"amount":99.89}],
             "refunds":[{"method":"CASH","count":1,"amount":30.00},{"method":"UPI","count":1,"amount":20.00}],
             "returns":{"count":2,"credit":50.00},"cash_in":50.00,"cash_out":20.00,"expected_cash":1900.00,
             "counted_cash":1890.00,"variance":-10.00,"bill_book":{"count":2,"total":31.50},
             "first_invoice_number":"INV/2627-00001","last_invoice_number":"INV/2627-00003"}""";
    private static final String Z2 = """
            {"opening_cash":500.00,"bills":{"count":1,"total":100.00},"voided":{"count":0,"total":0},
             "discounts":0,"by_mode":[{"mode":"CARD","count":1,"amount":100.00}],"refunds":[],
             "returns":{"count":0,"credit":0},"cash_in":0,"cash_out":0,"expected_cash":500.00,
             "counted_cash":500.00,"variance":0,"bill_book":{"count":0,"total":0}}""";

    private MoneyReportRepository repository;
    private PosSessionsReportService service;
    private ReportQuery query;

    @BeforeEach
    void setUp() {
        repository = mock(MoneyReportRepository.class);
        service = new PosSessionsReportService(repository);
        when(repository.locations("inst-1")).thenReturn(List.of());
        query = ReportQuery.builder().instituteId("inst-1").range(new ReportRange(DAY, DAY))
                .scope(new ReportScope(true, null, true, null)).today(LocalDate.of(2026, 11, 19))
                .staffNames(Map.of("u-1", "Test Cashier")).build();
        List<SessionRow> sessions = List.of(
                session("s-1", "CLOSED", "2026-11-05T03:00:00.000000", Z1),
                session("s-2", "CLOSED", "2026-11-05T04:00:00.000000", Z2),
                session("s-3", "OPEN", "2026-11-05T05:00:00.000000", null));
        doAnswer(inv -> {
            Consumer<SessionRow> sink = inv.getArgument(3);
            sessions.forEach(sink);
            return null;
        }).when(repository).sessionsOpenedIn(any(), any(), any(), any());
        when(repository.liveInvoicesOfSessions(eq("inst-1"), eq(List.of("s-1", "s-2"))))
                .thenReturn(new BigDecimal("1512.50"));
    }

    private static SessionRow session(String id, String status, String openedRaw, String z) {
        return new SessionRow(id, status, DAY, "2026-11-05 08:30", openedRaw, "CLOSED".equals(status)
                ? "2026-11-05 18:30" : null, "R1", "Counter one", "L1", "u-1", new BigDecimal("1000.00"),
                null, null, null, null, "note " + id, z);
    }

    @Test
    void aClosedSessionIsItsStoredZReport() {
        ReportAnswer a = service.sessions(query);
        Map<String, Object> row = a.getRows().get(0);
        assertEquals(3L, row.get("bills"));
        assertEquals(new BigDecimal("1381.00"), row.get("bills_value"));
        assertEquals(1L, row.get("voided"));
        assertEquals(new BigDecimal("52.50"), row.get("voided_value"));
        assertEquals(new BigDecimal("15.00"), row.get("discounts"));
        assertEquals(new BigDecimal("900.00"), row.get("cash"));
        assertEquals(new BigDecimal("381.11"), row.get("upi"));
        assertEquals(new BigDecimal("0.00"), row.get("card"));
        assertEquals(new BigDecimal("99.89"), row.get("other_modes"));
        assertEquals(new BigDecimal("30.00"), row.get("refund_cash"));
        assertEquals(new BigDecimal("20.00"), row.get("refund_upi"));
        assertEquals(new BigDecimal("1900.00"), row.get("expected"));
        assertEquals(new BigDecimal("1890.00"), row.get("counted"));
        assertEquals(new BigDecimal("-10.00"), row.get("variance"));
        assertEquals(2L, row.get("bill_book_bills"));
        assertEquals("INV/2627-00003", row.get("last_number"));
        assertEquals("Test Cashier", row.get("cashier"));
        // The opening cash is the Z-report's, not the session row's.
        assertEquals(new BigDecimal("1000.00"), row.get("opening_cash"));
        assertEquals(new BigDecimal("500.00"), a.getRows().get(1).get("opening_cash"));
    }

    @Test
    void totalsCoverClosedSessionsAndOpenOnesHaveNone() {
        ReportAnswer a = service.sessions(query);
        assertEquals(2, a.getRows().size());
        assertEquals(new BigDecimal("1481.00"), a.getTotals().get("bills_value"));
        assertEquals(new BigDecimal("100.00"), a.getTotals().get("card"));
        assertEquals(new BigDecimal("-10.00"), a.getTotals().get("variance"));
        assertEquals(4L, a.getTotals().get("bills"));
        assertEquals(2L, a.getTotals().get("closed_sessions"));
        assertEquals(1L, a.getTotals().get("open_sessions"));
        var open = a.getSections().get(0);
        assertEquals("open_sessions", open.getKey());
        assertEquals(1, open.getRows().size());
        assertEquals("OPEN", open.getRows().get(0).get("status"));
        assertFalse(open.getRows().get(0).containsKey("bills_value"), "an open session shows no totals");
    }

    @Test
    void theCheckTiesTheZReportsToTheInvoices() {
        ReportAnswer a = service.sessions(query);
        assertEquals(new BigDecimal("1512.50"), a.getCheck().get("bills_value"), "bills 1481.00 + paper 31.50");
        assertEquals(new BigDecimal("0.00"), a.getCheck().get("difference"));
        assertTrue(a.getWarnings().isEmpty());

        when(repository.liveInvoicesOfSessions(eq("inst-1"), eq(List.of("s-1", "s-2"))))
                .thenReturn(new BigDecimal("1500.00"));
        ReportAnswer off = service.sessions(query);
        assertEquals(new BigDecimal("12.50"), off.getCheck().get("difference"));
        assertEquals(PosSessionsReportService.SESSIONS_DO_NOT_ADD_UP, off.getWarnings().get(0).getCode());
    }

    @Test
    void aClosedSessionWithoutAZReportIsFlaggedNotRecomputed() {
        doAnswer(inv -> {
            Consumer<SessionRow> sink = inv.getArgument(3);
            sink.accept(session("s-9", "CLOSED", "2026-11-05T03:00:00.000000", null));
            return null;
        }).when(repository).sessionsOpenedIn(any(), any(), any(), any());
        ReportAnswer a = service.sessions(query);
        assertEquals(new BigDecimal("0.00"), a.getRows().get(0).get("bills_value"));
        assertEquals(PosSessionsReportService.Z_REPORT_MISSING, a.getWarnings().get(0).getCode());
    }

    @Test
    void pagesFollowTheCursor() {
        ReportAnswer first = service.sessions(query.toBuilder().size(1).build());
        assertEquals("s-1", first.getRows().get(0).get("session_id"));
        assertNotNull(first.getNextCursor());
        ReportAnswer second = service.sessions(query.toBuilder().size(1).cursor(first.getNextCursor()).build());
        assertEquals("s-2", second.getRows().get(0).get("session_id"));
        assertNull(second.getNextCursor());
        assertEquals(first.getTotals(), second.getTotals(), "totals cover the whole filter on every page");
    }
}
