package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DocumentRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Location;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.MoneyRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.PaidNotInvoicedRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.SessionRow;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Day book and payment modes (contract 2.7, 2.8): which events are money, where they count, the
 * sessions footer and "cash at the tills", and that payment modes reads the same money rows.
 */
class DayBookServiceTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 5);

    private MoneyReportRepository repository;
    private DayBookService dayBook;
    private PaymentModesService paymentModes;
    private ReportQuery query;

    @BeforeEach
    void setUp() {
        repository = mock(MoneyReportRepository.class);
        dayBook = new DayBookService(repository);
        paymentModes = new PaymentModesService(repository);
        when(repository.locations("inst-1")).thenReturn(List.of(new Location("L1", "S1", "Test City store"),
                new Location("L2", "S2", "Test City counter")));
        query = ReportQuery.builder().instituteId("inst-1").range(new ReportRange(DAY, DAY))
                .scope(new ReportScope(true, null, true, null)).today(LocalDate.of(2026, 11, 19))
                .staffNames(Map.of("u-cashier", "Test Cashier")).build();
        feedMoney(List.of(
                money("TENDER", DayBookService.SALE_PAYMENT, "CASH", "300.00", "L1", "u-cashier", null),
                money("TENDER", DayBookService.SALE_PAYMENT, "UPI", "81.11", "L1", "u-cashier", null),
                money("TENDER", DayBookService.RECEIPT_ON_CREDIT, "CASH", "40.00", "L1", "u-manager", null),
                money("TENDER", DayBookService.COD_COLLECTED, "COD", "500.00", "L1", null, DAY),
                money("TENDER", DayBookService.CREDIT_NOTE_USED, "CREDIT_NOTE", "25.00", "L2", null, null),
                money("REFUND", DayBookService.REFUND_PAID, "CASH", "30.00", "L2", null, null),
                money("REFUND", DayBookService.EXCHANGE_CREDIT, "EXCHANGE_CREDIT", "25.00", "L2", null, null),
                money("CASH_MOVEMENT", DayBookService.CASH_IN, "CASH", "50.00", "L2", null, null),
                money("CASH_MOVEMENT", DayBookService.CASH_OUT, "CASH", "20.00", "L2", null, null),
                money("TENDER", DayBookService.SALE_PAYMENT, "GATEWAY", "99.00", null, null, null)));
        feed(DocumentRow.class, inv -> repository.documentRows(any(), inv), List.of(
                new DocumentRow("INVOICE", "i-1", DAY, "2026-11-05 11:30", DAY, "INV/1", null, "TAX_INVOICE",
                        new BigDecimal("381.00"), false, "Walk-in", "ORD-1", "u-cashier", "L1"),
                new DocumentRow("INVOICE", "i-2", DAY, "2026-11-05 12:00", DAY, "INV/2", null, "TAX_INVOICE",
                        new BigDecimal("52.50"), true, "Walk-in", "ORD-2", "u-cashier", "L1"),
                new DocumentRow("INVOICE", "i-3", DAY, "2026-11-07 10:00", LocalDate.of(2026, 11, 7), "BK/101",
                        "101", "TAX_INVOICE", new BigDecimal("10.50"), false, null, null, null, "L2"),
                new DocumentRow("CREDIT_NOTE", "n-1", DAY, "2026-11-05 15:00", DAY, "CN/1", null, "CREDIT_NOTE",
                        new BigDecimal("155.12"), false, "Walk-in", "ORD-1", null, "L1")));
        feed(SessionRow.class, inv -> repository.footerSessions(any(), any(), any(), inv), List.of(
                new SessionRow("s-1", "CLOSED", DAY, DAY, "2026-11-05 08:30", "2026-11-05T03:00:00.000000",
                        "2026-11-05 18:30", "R1", "Counter one", "L1", "u-cashier", new BigDecimal("1000.00"),
                        new BigDecimal("1300.00"), new BigDecimal("1290.00"), new BigDecimal("-10.00"), null,
                        "short", null),
                new SessionRow("s-2", "OPEN", DAY, null, "2026-11-05 09:00", "2026-11-05T03:30:00.000000", null, "R2",
                        "Counter two", "L2", "u-other", new BigDecimal("500.00"), null, null, null,
                        new BigDecimal("600.00"), null, null)));
        feed(PaidNotInvoicedRow.class, inv -> repository.paidNotInvoiced(any(), any(), any(), inv), List.of(
                new PaidNotInvoicedRow("o-9", "ORD-9", DAY, "ONLINE", "CONFIRMED", "Buyer", "L1",
                        new BigDecimal("99.00"))));
    }

    private static MoneyRow money(String source, String kind, String mode, String amount, String location,
                                  String staff, LocalDate typedDay) {
        return new MoneyRow(source, kind, kind + mode + amount, DAY, "2026-11-05 11:30", typedDay, mode,
                new BigDecimal(amount), "ORD-1", "Walk-in", staff, location, null);
    }

    private void feedMoney(List<MoneyRow> rows) {
        feed(MoneyRow.class, inv -> repository.moneyRows(any(), any(), any(), inv), rows);
    }

    @SuppressWarnings("unchecked")
    private <T> void feed(Class<T> type, java.util.function.Consumer<Consumer<T>> call, List<T> rows) {
        doAnswer(inv -> {
            Consumer<T> sink = inv.getArgument(inv.getArguments().length - 1);
            rows.forEach(sink);
            return null;
        }).when(repository);
        call.accept(any());
    }

    private static ReportDtos.Section section(ReportAnswer a, String key) {
        return a.getSections().stream().filter(s -> s.getKey().equals(key)).findFirst().orElseThrow();
    }

    private static BigDecimal amount(Object value) {
        return value == null ? null : (BigDecimal) value;
    }

    @Test
    void documentsAndMoneyAreTwoBlocksWithTheFooter() {
        ReportAnswer a = dayBook.dayBook(query);
        assertEquals(List.of("documents", "money", "by_mode", "sessions", "tills"),
                a.getSections().stream().map(ReportDtos.Section::getKey).toList());
        ReportDtos.Section documents = section(a, "documents");
        assertEquals(4, documents.getRows().size());
        // The cancelled invoice is listed and left out of the totals.
        assertEquals("CANCELLED", documents.getRows().get(1).get("status"));
        assertEquals(2L, documents.getTotals().get("invoices"));
        assertEquals(new BigDecimal("391.50"), documents.getTotals().get("invoices_value"));
        assertEquals(new BigDecimal("155.12"), documents.getTotals().get("credit_notes_value"));
        assertEquals(new BigDecimal("236.38"), documents.getTotals().get("net"));
        // R2: the cancelled invoice keeps its number and status, its money moves to cancelled_value;
        // the value column is signed (a note negative) and sums to the net.
        assertNull(documents.getRows().get(1).get("value"));
        assertEquals(new BigDecimal("52.50"), documents.getRows().get(1).get("cancelled_value"));
        assertEquals(new BigDecimal("-155.12"), documents.getRows().get(3).get("value"));
        BigDecimal valueColumn = documents.getRows().stream().map(r -> amount(r.get("value")))
                .filter(java.util.Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertEquals(documents.getTotals().get("value"), valueColumn);
        assertEquals(new BigDecimal("52.50"), documents.getTotals().get("cancelled_value"));
        // A paper bill shows its paper number, no time, and when it was entered.
        Map<String, Object> paper = documents.getRows().get(2);
        assertEquals("PAPER_BILL", paper.get("type"));
        assertEquals("101", paper.get("number"));
        assertEquals(DayBookService.NO_TIME, paper.get("time"));
        assertTrue(((String) paper.get("note")).startsWith("paper bill, entered on 2026-11-07"));
        assertEquals("Test Cashier", documents.getRows().get(0).get("staff"));
    }

    @Test
    void onlyReceivedMoneyCountsAndNonMoneyRowsCarryAValueOnly() {
        ReportAnswer a = dayBook.dayBook(query);
        ReportDtos.Section money = section(a, "money");
        Map<String, Object> creditNote = money.getRows().get(4);
        assertEquals(DayBookService.CREDIT_NOTE_USED, creditNote.get("type"));
        assertNull(creditNote.get("amount_in"));
        assertNull(creditNote.get("amount_out"));
        assertEquals(new BigDecimal("25.00"), creditNote.get("value"));
        Map<String, Object> exchange = money.getRows().get(6);
        assertEquals(DayBookService.EXCHANGE_CREDIT, exchange.get("type"));
        assertNull(exchange.get("amount_out"), "an exchange credit is not money paid out");
        // In: 300 + 81.11 + 40 (receipt on credit) + 500 (COD) + 50 (cash in) + 99 (gateway).
        assertEquals(new BigDecimal("1070.11"), money.getTotals().get("amount_in"));
        // Out: 30 (cash refund) + 20 (cash out).
        assertEquals(new BigDecimal("50.00"), money.getTotals().get("amount_out"));
        assertEquals(new BigDecimal("1020.11"), a.getTotals().get("net_money"));
    }

    @Test
    void codCollectedIsDatedByTheRemittanceAndHasNoTime() {
        ReportAnswer a = dayBook.dayBook(query);
        Map<String, Object> cod = section(a, "money").getRows().get(3);
        assertEquals(DayBookService.COD_COLLECTED, cod.get("type"));
        assertEquals("2026-11-05", cod.get("date"));
        assertEquals(DayBookService.NO_TIME, cod.get("time"));
        assertEquals(new BigDecimal("500.00"), cod.get("amount_in"));
    }

    @Test
    void everyMoneyRowNamesItsLocationAndNoneReadsNoLocation() {
        ReportAnswer a = dayBook.dayBook(query);
        List<Map<String, Object>> rows = section(a, "money").getRows();
        assertEquals("Test City store", rows.get(0).get("location"));
        assertEquals("Test City counter", rows.get(5).get("location"));
        assertEquals(MoneyReportSupport.NO_LOCATION, rows.get(9).get("location"));
    }

    @Test
    void cashAtTheTillsIsCountedForSessionsClosedThatDayOnly() {
        ReportAnswer a = dayBook.dayBook(query);
        ReportDtos.Section sessions = section(a, "sessions");
        assertEquals(new BigDecimal("1290.00"), sessions.getRows().get(0).get("cash_at_till"));
        assertNull(sessions.getRows().get(1).get("cash_at_till"), "a session still open is not cash at the tills");
        assertEquals(new BigDecimal("600.00"), sessions.getRows().get(1).get("expected"),
                "it shows the cash expected by the end of the day");
        assertNull(sessions.getRows().get(1).get("counted"), "an open session has no count yet");
        assertEquals(new BigDecimal("1290.00"), a.getTotals().get("cash_at_tills"));
        ReportDtos.Section tills = section(a, "tills");
        assertEquals(1, tills.getRows().size());
        assertEquals("Test City store", tills.getRows().get(0).get("location"));
        assertEquals(new BigDecimal("1290.00"), tills.getTotals().get("cash_at_tills"));
    }

    @Test
    void severalDaysGiveCashAtTheTillsPerDayAndNoTotal() {
        LocalDate next = DAY.plusDays(1);
        feed(SessionRow.class, inv -> repository.footerSessions(any(), any(), any(), inv), List.of(
                new SessionRow("s-1", "CLOSED", DAY, DAY, "2026-11-05 08:30", "2026-11-05T03:00:00.000000",
                        "2026-11-05 18:30", "R1", "Counter one", "L1", "u-cashier", new BigDecimal("1000.00"),
                        new BigDecimal("6000.00"), new BigDecimal("6000.00"), BigDecimal.ZERO, null, null, null),
                new SessionRow("s-2", "CLOSED", next, next, "2026-11-06 08:30", "2026-11-06T03:00:00.000000",
                        "2026-11-06 18:30", "R1", "Counter one", "L1", "u-cashier", new BigDecimal("1000.00"),
                        new BigDecimal("6000.00"), new BigDecimal("6000.00"), BigDecimal.ZERO, null, null, null),
                new SessionRow("s-3", "CLOSED", next, next.plusDays(1), "2026-11-06 20:00",
                        "2026-11-06T14:30:00.000000", "2026-11-07 01:00", "R2", "Counter two", "L2", "u-cashier",
                        new BigDecimal("500.00"), new BigDecimal("700.00"), new BigDecimal("700.00"),
                        BigDecimal.ZERO, null, null, null)));
        ReportAnswer a = dayBook.dayBook(query.toBuilder().range(new ReportRange(DAY, next)).build());
        ReportDtos.Section tills = section(a, "tills");
        assertEquals(List.of("2026-11-05", "2026-11-06"), tills.getRows().stream().map(r -> r.get("date")).toList());
        assertNull(a.getTotals().get("cash_at_tills"), "the same cash is counted each day: no total over days");
        assertNull(tills.getTotals().get("cash_at_tills"));
        assertNull(section(a, "sessions").getRows().get(2).get("cash_at_till"), "closed after the range");
    }

    @Test
    void codKeptByTheCourierIsMoneyOutAndBothReportsAgree() {
        feedMoney(List.of(
                money("TENDER", DayBookService.COD_COLLECTED, "COD", "1200.00", "L1", null, DAY),
                new MoneyRow("REMITTANCE", DayBookService.COD_DEDUCTION, "r-1:D", DAY, null, DAY, "COD",
                        new BigDecimal("30.00"), "STMT-1", "Test Post", null, null, "STMT-1"),
                new MoneyRow("REMITTANCE", DayBookService.COD_SHORT, "r-1:S", DAY, null, DAY, "COD",
                        new BigDecimal("20.00"), "STMT-1", "Test Post", null, null, "STMT-1")));
        ReportAnswer book = dayBook.dayBook(query);
        assertEquals(new BigDecimal("1150.00"), book.getTotals().get("net_money"), "1200 less 30 and 20 kept");
        Map<String, Object> deduction = section(book, "money").getRows().get(1);
        assertEquals(new BigDecimal("30.00"), deduction.get("amount_out"));
        assertEquals(DayBookService.NO_TIME, deduction.get("time"));
        ReportAnswer modes = paymentModes.paymentModes(query);
        assertEquals(new BigDecimal("1200.00"), modes.getTotals().get("cod_collected"));
        assertEquals(new BigDecimal("50.00"), modes.getTotals().get("cod_deductions"));
        assertEquals(new BigDecimal("1150.00"), modes.getTotals().get("net_money"));
        ReportAnswer limited = dayBook.dayBook(query.toBuilder()
                .scope(new ReportScope(false, Set.of("L1"), false, null)).build());
        assertTrue(limited.getWarnings().stream().anyMatch(w -> "COD_GROSS".equals(w.getCode())));
    }

    @Test
    void aReissuedBillIsNamedInAWarning() {
        when(repository.reissuesInRange(any())).thenReturn(List.of("RA-1 -> RA-2 (CA-1)"));
        ReportAnswer a = dayBook.dayBook(query);
        assertTrue(a.getWarnings().stream().anyMatch(w -> "REISSUE_COUNTED_ONCE".equals(w.getCode())
                && "RA-1 -> RA-2 (CA-1)".equals(w.getRef())));
    }

    @Test
    void moneyByModeEqualsPaymentModes() {
        ReportAnswer book = dayBook.dayBook(query);
        ReportAnswer modes = paymentModes.paymentModes(query);
        Map<String, Object> pm = modes.getTotals();
        Map<String, BigDecimal[]> byMode = new java.util.HashMap<>();
        for (Map<String, Object> row : section(book, "by_mode").getRows()) {
            byMode.put((String) row.get("payment_mode"), new BigDecimal[]{amount(row.get("amount_in")),
                    amount(row.get("amount_out"))});
        }
        // Cash in the day book = cash tenders + counter cash in; out = cash refunds + cash out.
        assertEquals(amount(pm.get("cash")).add(amount(pm.get("cash_in"))), byMode.get("CASH")[0]);
        assertEquals(amount(pm.get("refund_cash")).add(amount(pm.get("cash_out"))), byMode.get("CASH")[1]);
        assertEquals(amount(pm.get("upi")), byMode.get("UPI")[0]);
        assertEquals(amount(pm.get("cod_collected")), byMode.get("COD")[0]);
        assertEquals(amount(pm.get("gateway")), byMode.get("GATEWAY")[0]);
        assertEquals(book.getTotals().get("net_money"), pm.get("net_money"));
        assertEquals(new BigDecimal("340.00"), pm.get("cash"), "sale cash and the receipt on credit");
        assertEquals(new BigDecimal("25.00"), pm.get("credit_note_used"));
        assertEquals(new BigDecimal("99.00"), pm.get("paid_not_invoiced"));
        assertEquals("ORD-9", section(modes, "paid_not_invoiced").getRows().get(0).get("order_number"));
    }

    @Test
    void paymentModesRowsAreDayAndLocation() {
        ReportAnswer modes = paymentModes.paymentModes(query);
        assertEquals(List.of("No location", "Test City counter", "Test City store"),
                modes.getRows().stream().map(r -> r.get("location")).toList());
        Map<String, Object> store = modes.getRows().get(2);
        assertEquals(new BigDecimal("921.11"), store.get("received"));
        assertEquals("2026-11-05", store.get("date"));
    }

    @Test
    void theDayBookReadsWithTheIndiaBoundsOfItsDays() {
        dayBook.dayBook(query);
        verify(repository).moneyRows(any(), eq(java.time.LocalDateTime.of(2026, 11, 4, 18, 30)),
                eq(java.time.LocalDateTime.of(2026, 11, 5, 18, 30)), any());
        verify(repository).footerSessions(any(), eq(java.time.LocalDateTime.of(2026, 11, 4, 18, 30)),
                eq(java.time.LocalDateTime.of(2026, 11, 5, 18, 30)), any());
    }

    @Test
    void aLocationLimitedReaderPassesItsLocations() {
        ReportQuery limited = query.toBuilder().scope(new ReportScope(false, Set.of("L2"), false, null)).build();
        dayBook.dayBook(limited);
        verify(repository).documentRows(org.mockito.ArgumentMatchers.argThat(f -> Set.of("L2").equals(
                f.locationIn())), any());
    }

    @Test
    void aBlockLongerThanTheScreenIsCutWithAWarningAndFullTotals() {
        List<MoneyRow> many = new java.util.ArrayList<>();
        for (int i = 0; i < MoneyReportSupport.SCREEN_ROWS + 3; i++) {
            many.add(money("TENDER", DayBookService.SALE_PAYMENT, "CASH", "1.00", "L1", null, null));
        }
        feedMoney(many);
        ReportAnswer a = dayBook.dayBook(query);
        assertEquals(MoneyReportSupport.SCREEN_ROWS, section(a, "money").getRows().size());
        assertEquals(new BigDecimal("5003.00"), section(a, "money").getTotals().get("amount_in"));
        assertTrue(a.getWarnings().stream().anyMatch(w -> MoneyReportSupport.ROWS_CUT.equals(w.getCode())));
    }
}
