package vacademy.io.admin_core_service.features.fee_management.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeBillCancellation;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeBillCancellationRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** I2CAN 2026-10-21: removing a course left its unpaid installments due in the payment history. */
class FeeBillCancellationServiceTest {

    private static StudentFeePayment bill(String id, String expected, String paid, String status) {
        StudentFeePayment b = new StudentFeePayment();
        b.setId(id);
        b.setUserId("u1");
        b.setUserPlanId("plan");
        b.setInstituteId("inst");
        b.setAmountExpected(new BigDecimal(expected));
        b.setAmountPaid(new BigDecimal(paid));
        b.setStatus(status);
        b.setDueDate(new java.sql.Date(1_792_368_000_000L));
        return b;
    }

    @Test
    @DisplayName("open bills are cancelled down to what was paid; the ledger follows; settled ones are untouched")
    void cancelsOpenBills() {
        StudentFeePaymentRepository sfps = mock(StudentFeePaymentRepository.class);
        UserAccountLedgerService ledger = mock(UserAccountLedgerService.class);
        UserAccountLedgerRepository ledgerRepo = mock(UserAccountLedgerRepository.class);
        StudentFeePayment paid = bill("b1", "5000", "5000", "PAID");
        StudentFeePayment partial = bill("b2", "23334", "20000", "PARTIAL_PAID");
        StudentFeePayment open = bill("b3", "22500", "0", "PENDING");
        StudentFeePayment noLedger = bill("b4", "1000", "0", "OVERDUE");
        StudentFeePayment preLedger = bill("b5", "6668", "5000", "PARTIAL_PAID");
        when(sfps.findByUserPlanId("plan")).thenReturn(List.of(paid, partial, open, noLedger, preLedger));
        when(ledgerRepo.debitNetBySourceId("b2")).thenReturn(new BigDecimal("23334"));
        when(ledgerRepo.debitNetBySourceId("b3")).thenReturn(new BigDecimal("22500"));
        when(ledgerRepo.debitNetBySourceId("b4")).thenReturn(BigDecimal.ZERO);
        when(ledgerRepo.debitNetBySourceId("b5")).thenReturn(BigDecimal.ZERO);

        int n = new FeeBillCancellationService(sfps, ledger, ledgerRepo,
                mock(FeeBillCancellationRepository.class)).cancelOpenBills("plan", null);

        assertEquals(4, n);
        assertEquals("PAID", paid.getStatus());
        assertEquals("CANCELLED", partial.getStatus());
        assertEquals(0, partial.getAmountExpected().compareTo(new BigDecimal("20000")));
        assertEquals(0, open.getAmountExpected().signum());
        verify(ledger).recordDebitReversal(eq("u1"), eq("inst"), eq(new BigDecimal("3334.00")), anyString(), any(),
                eq("PLAN_CANCELLED"), eq("b2"), any(), anyString());
        verify(ledger).recordDebitReversal(eq("u1"), eq("inst"), eq(new BigDecimal("22500.00")), anyString(), any(),
                eq("PLAN_CANCELLED"), eq("b3"), any(), anyString());
        // A bill whose ledger rows are missing gets nothing posted, rather than going negative.
        verify(ledger, never()).recordDebitReversal(any(), any(), any(), any(), any(), any(), eq("b4"), any(), any());
        // Nor does one with less on the ledger than was paid get a new charge.
        verify(ledger, never()).recordDebitAccrual(any(), any(), any(), any(), any(), any(), any(), any(), any());
        assertEquals("CANCELLED", preLedger.getStatus());
    }

    @Test
    @DisplayName("stopping dues records each bill so reopening puts amount, status and ledger back")
    void stopDuesThenReopen() {
        StudentFeePaymentRepository sfps = mock(StudentFeePaymentRepository.class);
        UserAccountLedgerService ledger = mock(UserAccountLedgerService.class);
        UserAccountLedgerRepository ledgerRepo = mock(UserAccountLedgerRepository.class);
        FeeBillCancellationRepository records = mock(FeeBillCancellationRepository.class);
        FeeBillCancellationService service = new FeeBillCancellationService(sfps, ledger, ledgerRepo, records);
        StudentFeePayment partial = bill("b2", "30000", "10000", "PARTIAL_PAID");
        StudentFeePayment open = bill("b3", "30000", "0", "OVERDUE");
        StudentFeePayment paid = bill("b1", "5000", "5000", "PAID");
        when(ledgerRepo.debitNetBySourceId("b2")).thenReturn(new BigDecimal("30000"));
        when(ledgerRepo.debitNetBySourceId("b3")).thenReturn(new BigDecimal("30000"));

        assertEquals(2, service.stopDues(List.of(paid, partial, open), "Dropped out", "admin"));

        assertEquals("CANCELLED", open.getStatus());
        assertEquals(0, open.getAmountExpected().signum());
        assertEquals(0, partial.getAmountExpected().compareTo(new BigDecimal("10000")));
        assertEquals("PAID", paid.getStatus());
        ArgumentCaptor<FeeBillCancellation> saved = ArgumentCaptor.forClass(FeeBillCancellation.class);
        verify(records, org.mockito.Mockito.times(2)).save(saved.capture());
        FeeBillCancellation openRecord = saved.getAllValues().get(1);
        assertEquals("OVERDUE", openRecord.getPreviousStatus());
        assertEquals(0, openRecord.getLedgerReversed().compareTo(new BigDecimal("30000")));
        assertEquals(0, openRecord.cancelledAmount().compareTo(new BigDecimal("30000")));
        assertEquals("Dropped out", openRecord.getReason());

        when(records.findFirstByStudentFeePaymentIdAndReopenedAtIsNullOrderByCancelledAtDesc("b3"))
                .thenReturn(Optional.of(openRecord));
        when(records.findFirstByStudentFeePaymentIdAndReopenedAtIsNullOrderByCancelledAtDesc("b2"))
                .thenReturn(Optional.of(saved.getAllValues().get(0)));
        assertEquals(2, service.reopen(List.of(partial, open), "admin"));

        assertEquals("OVERDUE", open.getStatus());
        assertEquals(0, open.getAmountExpected().compareTo(new BigDecimal("30000")));
        assertEquals("PARTIAL_PAID", partial.getStatus());
        assertEquals(0, partial.getAmountExpected().compareTo(new BigDecimal("30000")));
        verify(ledger).recordDebitAccrual(eq("u1"), eq("inst"), eq(new BigDecimal("30000.00")), anyString(), any(),
                eq("PLAN_REOPENED"), eq("b3"), any(), anyString());
        assertEquals("admin", openRecord.getReopenedByUserId());
    }
}
