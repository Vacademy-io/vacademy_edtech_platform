package vacademy.io.admin_core_service.features.fee_management.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeeAllocationLedgerRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Oldest-first allocation puts money only where something is still owed and not written off: a
 * waived installment, one a discount took to zero, and one paid beyond its amount are passed over.
 */
class FeeLedgerAllocationSkipTest {

    private static StudentFeePayment bill(String id, String status, String expected, String paid) {
        StudentFeePayment b = new StudentFeePayment();
        b.setId(id);
        b.setUserId("u");
        b.setStatus(status);
        b.setAmountExpected(new BigDecimal(expected));
        b.setAmountPaid(new BigDecimal(paid));
        return b;
    }

    @Test
    @DisplayName("waived, zero and overpaid installments take nothing; the payment reaches the real due")
    void skipsBillsThatCannotTakePayment() {
        StudentFeePayment waived = bill("waived", "WAIVED", "5000", "0");
        StudentFeePayment zero = bill("zero", "PENDING", "0", "0");
        StudentFeePayment overpaid = bill("overpaid", "OVERDUE", "4000", "5000");
        StudentFeePayment due = bill("due", "PENDING", "10000", "0");

        StudentFeePaymentRepository sfps = mock(StudentFeePaymentRepository.class);
        when(sfps.findByUserPlanIdAndStatusNotOrderByDueDateAsc("plan", "PAID"))
                .thenReturn(List.of(waived, zero, overpaid, due));
        StudentFeeAllocationLedgerRepository ledger = mock(StudentFeeAllocationLedgerRepository.class);
        PaymentLogRepository logs = mock(PaymentLogRepository.class);
        when(logs.findById(anyString())).thenReturn(Optional.empty());

        FeeLedgerAllocationService service = new FeeLedgerAllocationService();
        ReflectionTestUtils.setField(service, "studentFeePaymentRepository", sfps);
        ReflectionTestUtils.setField(service, "studentFeeAllocationLedgerRepository", ledger);
        ReflectionTestUtils.setField(service, "paymentLogRepository", logs);

        service.allocatePaymentForNewLog("pl", new BigDecimal("6000"), "plan");

        assertEquals("WAIVED", waived.getStatus());
        assertEquals(0, waived.getAmountPaid().signum());
        assertEquals("PENDING", zero.getStatus());
        assertEquals("OVERDUE", overpaid.getStatus());
        assertEquals(0, overpaid.getAmountPaid().compareTo(new BigDecimal("5000")));
        assertEquals("PARTIAL_PAID", due.getStatus());
        assertEquals(0, due.getAmountPaid().compareTo(new BigDecimal("6000")));
        verify(ledger, times(1)).save(any(StudentFeeAllocationLedger.class));
        verify(sfps, times(1)).save(eq(due));
    }
}
