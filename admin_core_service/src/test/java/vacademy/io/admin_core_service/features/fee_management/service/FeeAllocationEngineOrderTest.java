package vacademy.io.admin_core_service.features.fee_management.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeeAllocationLedgerRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * I2CAN, 19 Oct 2026: installments 1 (₹5,000) and 2 (₹17,500) were both due that day and the
 * ₹5,000 paid at enrollment landed on installment 2. Same-day bills go in installment order.
 */
class FeeAllocationEngineOrderTest {

    private static StudentFeePayment bill(String id, int number, String amount) {
        StudentFeePayment b = new StudentFeePayment();
        b.setId(id);
        b.setInstallmentNumber(number);
        b.setAmountExpected(new BigDecimal(amount));
        b.setAmountPaid(BigDecimal.ZERO);
        // java.util.Date: the engine reads due dates with toInstant(), which java.sql.Date refuses.
        b.setDueDate(new java.util.Date(System.currentTimeMillis() + 3L * 86_400_000L));
        b.setStatus("PENDING");
        return b;
    }

    @Test
    @DisplayName("bills due the same day are paid in installment order, not biggest first")
    void sameDayInstallmentOrder() {
        FeeAllocationEngine engine = new FeeAllocationEngine();
        StudentFeePaymentRepository sfps = mock(StudentFeePaymentRepository.class);
        when(sfps.save(any(StudentFeePayment.class))).thenAnswer(inv -> inv.getArgument(0));
        AdjustmentResolver adjustments = mock(AdjustmentResolver.class);
        when(adjustments.computeAdjustmentEffect(any(StudentFeePayment.class))).thenReturn(BigDecimal.ZERO);
        ReflectionTestUtils.setField(engine, "studentFeePaymentRepository", sfps);
        ReflectionTestUtils.setField(engine, "studentFeeAllocationLedgerRepository", mock(StudentFeeAllocationLedgerRepository.class));
        ReflectionTestUtils.setField(engine, "adjustmentResolver", adjustments);

        StudentFeePayment second = bill("b-2", 2, "17500");
        StudentFeePayment first = bill("b-1", 1, "5000");
        BigDecimal left = engine.allocate(List.of(second, first), new BigDecimal("5000"), "pl-1", null,
                vacademy.io.admin_core_service.features.fee_management.enums.AllocationScope.ALL_DUES);

        assertEquals(0, left.signum());
        assertEquals("PAID", first.getStatus());
        assertEquals(0, second.getAmountPaid().signum());
    }
}
