package vacademy.io.admin_core_service.features.commerce.accounts.ledger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplier;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierLedgerEntry;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierStatementService.StatementView;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierLedgerRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A supplier statement: opening, running balance, closing, range rules and the row cap. */
class SupplierStatementServiceTest {

    private static final String INST = "inst-1";
    private static final String SUP = "sup-1";
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 20);

    private CommerceSupplierRepository suppliers;
    private CommerceSupplierLedgerRepository ledger;
    private JdbcTemplate jdbc;
    private SupplierStatementService service;

    @BeforeEach
    void setUp() {
        suppliers = mock(CommerceSupplierRepository.class);
        ledger = mock(CommerceSupplierLedgerRepository.class);
        StockClock clock = mock(StockClock.class);
        when(clock.today(anyString())).thenReturn(TODAY);
        jdbc = mock(JdbcTemplate.class);
        service = new SupplierStatementService(suppliers, ledger, clock, jdbc, mock(PlatformTransactionManager.class));
        when(suppliers.findByInstituteIdAndId(INST, SUP)).thenReturn(Optional.of(new CommerceSupplier()));
    }

    private static CommerceSupplierLedgerEntry row(String id, String date, String type, String amount) {
        CommerceSupplierLedgerEntry e = new CommerceSupplierLedgerEntry();
        e.setId(id);
        e.setSupplierId(SUP);
        e.setBookDate(LocalDate.parse(date));
        e.setType(type);
        e.setAmount(new BigDecimal(amount));
        return e;
    }

    @Test
    void openingAndRowsAreReadInOneRepeatableReadSnapshot() {
        LocalDate from = LocalDate.of(2026, 10, 1);
        LocalDate to = LocalDate.of(2026, 10, 31);
        when(ledger.sumBefore(INST, SUP, from)).thenReturn(BigDecimal.ZERO);
        when(ledger.rowsBetween(INST, SUP, from, to, SupplierStatementService.ROW_CAP + 1)).thenReturn(List.of());
        service.statement(INST, SUP, from, to);
        InOrder order = inOrder(jdbc, suppliers, ledger);
        order.verify(jdbc).execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        order.verify(suppliers).findByInstituteIdAndId(INST, SUP);
        order.verify(ledger).sumBefore(INST, SUP, from);
        order.verify(ledger).rowsBetween(INST, SUP, from, to, SupplierStatementService.ROW_CAP + 1);
    }

    @Test
    void openingRunningBalanceAndClosing() {
        LocalDate from = LocalDate.of(2026, 10, 1);
        LocalDate to = LocalDate.of(2026, 10, 31);
        when(ledger.sumBefore(INST, SUP, from)).thenReturn(new BigDecimal("250.5"));
        when(ledger.rowsBetween(INST, SUP, from, to, SupplierStatementService.ROW_CAP + 1)).thenReturn(List.of(
                row("a", "2026-10-02", "BILL", "1000.00"),
                row("b", "2026-10-10", "PAYMENT", "-600.00"),
                row("c", "2026-10-11", "TDS", "-10.00")));

        StatementView view = service.statement(INST, SUP, from, to);

        assertEquals("250.50", view.getOpening());
        assertEquals(List.of("1250.50", "650.50", "640.50"),
                view.getRows().stream().map(SupplierStatementService.StatementRow::getRunningBalance).toList());
        assertEquals(List.of("1000.00", "-600.00", "-10.00"),
                view.getRows().stream().map(SupplierStatementService.StatementRow::getAmount).toList());
        assertEquals("640.50", view.getClosing());
        assertFalse(view.isTruncated());
        assertEquals(SUP, view.getSupplierId());
        assertEquals(from, view.getFrom());
        assertEquals(to, view.getTo());
    }

    @Test
    void noRowsAndNoHistoryIsZero() {
        when(ledger.sumBefore(anyString(), anyString(), any())).thenReturn(null);
        when(ledger.rowsBetween(anyString(), anyString(), any(), any(), anyInt())).thenReturn(List.of());
        StatementView view = service.statement(INST, SUP, LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 2));
        assertEquals("0.00", view.getOpening());
        assertEquals("0.00", view.getClosing());
        assertTrue(view.getRows().isEmpty());
    }

    @Test
    void defaultsAreTheFinancialYearToToday() {
        when(ledger.rowsBetween(anyString(), anyString(), any(), any(), anyInt())).thenReturn(List.of());
        StatementView view = service.statement(INST, SUP, null, null);
        assertEquals(LocalDate.of(2026, 4, 1), view.getFrom());
        assertEquals(TODAY, view.getTo());
        assertEquals(LocalDate.of(2025, 4, 1), SupplierStatementService.financialYearStart(LocalDate.of(2026, 3, 31)));
        assertEquals(LocalDate.of(2026, 4, 1), SupplierStatementService.financialYearStart(LocalDate.of(2026, 4, 1)));
    }

    @Test
    void rangeOverAYearOrBackwardsIs400() {
        InvalidRequestException tooLong = assertThrows(InvalidRequestException.class,
                () -> service.statement(INST, SUP, LocalDate.of(2025, 1, 1), LocalDate.of(2026, 1, 2)));
        assertTrue(tooLong.getMessage().startsWith("VALIDATION: "));
        assertTrue(tooLong.getMessage().contains("one year"));
        assertThrows(InvalidRequestException.class,
                () -> service.statement(INST, SUP, LocalDate.of(2026, 10, 2), LocalDate.of(2026, 10, 1)));
        // 366 days (a leap year) is allowed.
        when(ledger.rowsBetween(anyString(), anyString(), any(), any(), anyInt())).thenReturn(List.of());
        service.statement(INST, SUP, LocalDate.of(2024, 1, 1), LocalDate.of(2024, 12, 31));
        verify(ledger, never()).sumBefore(eq(INST), eq(SUP), eq(LocalDate.of(2025, 1, 1)));
    }

    @Test
    void aboveTheCapIsTruncatedWithoutClosing() {
        List<CommerceSupplierLedgerEntry> rows = new ArrayList<>();
        for (int i = 0; i <= SupplierStatementService.ROW_CAP; i++) {
            rows.add(row("r" + i, "2026-10-01", "BILL", "1.00"));
        }
        when(ledger.sumBefore(anyString(), anyString(), any())).thenReturn(BigDecimal.ZERO);
        when(ledger.rowsBetween(anyString(), anyString(), any(), any(), anyInt())).thenReturn(rows);
        StatementView view = service.statement(INST, SUP, LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31));
        assertTrue(view.isTruncated());
        assertNull(view.getClosing());
        assertEquals(SupplierStatementService.ROW_CAP, view.getRows().size());
        assertEquals("0.00", view.getOpening());
    }

    @Test
    void supplierOfAnotherInstituteIs404() {
        when(suppliers.findByInstituteIdAndId("inst-2", SUP)).thenReturn(Optional.empty());
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.statement("inst-2", SUP, null, null));
        assertTrue(e.getMessage().startsWith("NOT_FOUND"));
        verify(ledger, never()).rowsBetween(anyString(), anyString(), any(), any(), anyInt());
    }
}
