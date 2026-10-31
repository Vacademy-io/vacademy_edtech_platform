package vacademy.io.admin_core_service.features.user_account.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.user_account.dto.UserAccountSummaryDTO;
import vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A migrated fee plan has installments but no ledger accrual. Recording one installment
 * payment used to make the Account Summary read Accrued 0 / Due 0.
 */
class UserAccountLedgerPreLedgerSummaryTest {

    private final UserAccountLedgerRepository repository = mock(UserAccountLedgerRepository.class);
    private final InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
    private final UserAccountLedgerService service = new UserAccountLedgerService(
            repository, invoiceRepository, mock(PaymentLogRepository.class));

    private static BigDecimal bd(String v) {
        return new BigDecimal(v);
    }

    private void ledger(String debits, String credits, String pastDue) {
        when(repository.existsByUserIdAndInstituteId("u1", "inst")).thenReturn(true);
        when(repository.sumDebits("u1", "inst")).thenReturn(bd(debits));
        when(repository.sumCredits("u1", "inst")).thenReturn(bd(credits));
        when(repository.sumPastDueDebits("u1", "inst")).thenReturn(bd(pastDue));
        when(invoiceRepository.sumUnledgeredAdminInvoiceAccruals("u1", "inst")).thenReturn(BigDecimal.ZERO);
        when(invoiceRepository.sumUnledgeredAdminInvoicePayments("u1", "inst")).thenReturn(BigDecimal.ZERO);
    }

    private void preLedger(String accrued, String paid, String pastDue,
                           String bookedDebits, String bookedCredits, String bookedPastDue) {
        when(repository.sumPreLedgerFeePlans("u1", "inst")).thenReturn(List.<Object[]>of(new Object[]{
                bd(accrued), bd(paid), bd(pastDue), bd(bookedDebits), bd(bookedCredits), bd(bookedPastDue)}));
    }

    @Test
    @DisplayName("migrated plan + one recorded payment: shows the installment totals, not 0 / 0")
    void migratedPlanAfterPayment() {
        // Ledger holds only the new 10,000 payment; installments say 70,000 net, 15,000 paid.
        ledger("0", "10000", "0");
        preLedger("70000", "15000", "47500", "0", "10000", "0");

        UserAccountSummaryDTO s = service.getSummary("u1", "inst");

        assertEquals(0, bd("70000").compareTo(s.getTotalAccrued()));
        assertEquals(0, bd("15000").compareTo(s.getTotalPaid()));
        assertEquals(0, bd("55000").compareTo(s.getBalance()));
        assertEquals(0, bd("32500").compareTo(s.getOverdue()));
    }

    @Test
    @DisplayName("discount and split rows booked on a migrated plan are not counted twice")
    void deltasOnMigratedPlanAreReplaced() {
        // Split pair (+22,500 / -22,500) and a 5,000 discount reversal on the migrated plan.
        ledger("-5000", "10000", "-27500");
        preLedger("70000", "15000", "47500", "-5000", "10000", "-27500");

        UserAccountSummaryDTO s = service.getSummary("u1", "inst");

        assertEquals(0, bd("70000").compareTo(s.getTotalAccrued()));
        assertEquals(0, bd("55000").compareTo(s.getBalance()));
    }

    @Test
    @DisplayName("learner with only ledgered plans is unchanged")
    void ledgeredOnly() {
        ledger("45000", "20000", "45000");
        preLedger("0", "0", "0", "0", "0", "0");

        UserAccountSummaryDTO s = service.getSummary("u1", "inst");

        assertEquals(0, bd("45000").compareTo(s.getTotalAccrued()));
        assertEquals(0, bd("20000").compareTo(s.getTotalPaid()));
        assertEquals(0, bd("25000").compareTo(s.getBalance()));
        assertEquals(0, bd("25000").compareTo(s.getOverdue()));
    }

    @Test
    @DisplayName("ledgered and migrated plans on one learner add up")
    void mixed() {
        // Ledgered plan: 45,000 accrued, 20,000 paid. Migrated plan: 30,000 net, 30,000 paid,
        // of which 5,000 was a new payment already on the ledger.
        ledger("45000", "25000", "0");
        preLedger("30000", "30000", "30000", "0", "5000", "0");

        UserAccountSummaryDTO s = service.getSummary("u1", "inst");

        assertEquals(0, bd("75000").compareTo(s.getTotalAccrued()));
        assertEquals(0, bd("50000").compareTo(s.getTotalPaid()));
        assertEquals(0, bd("25000").compareTo(s.getBalance()));
    }

    @Test
    @DisplayName("empty ledger stays zero so the screen keeps its invoice-list fallback")
    void emptyLedgerUntouched() {
        when(repository.sumDebits("u1", "inst")).thenReturn(BigDecimal.ZERO);
        when(repository.sumCredits("u1", "inst")).thenReturn(BigDecimal.ZERO);
        when(repository.sumPastDueDebits("u1", "inst")).thenReturn(BigDecimal.ZERO);
        when(repository.existsByUserIdAndInstituteId("u1", "inst")).thenReturn(false);
        preLedger("70000", "15000", "47500", "0", "0", "0");

        UserAccountSummaryDTO s = service.getSummary("u1", "inst");

        assertEquals(0, BigDecimal.ZERO.compareTo(s.getTotalAccrued()));
        assertEquals(0, BigDecimal.ZERO.compareTo(s.getTotalPaid()));
        assertEquals(0, BigDecimal.ZERO.compareTo(s.getBalance()));
        verify(repository, never()).sumPreLedgerFeePlans("u1", "inst");
    }
}
