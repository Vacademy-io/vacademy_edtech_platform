package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogWithUserPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.UserPlanDTO;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The optional Enrollment Date / Next Due Date columns on the payment list: which rows get which
 * value, and that a failed lookup costs only those two columns.
 */
class PaymentLogPlanDatesTest {

    private final PaymentLogService service = new PaymentLogService();
    private final PaymentPlanDatesLoader loader = mock(PaymentPlanDatesLoader.class);

    @BeforeEach
    void wire() {
        ReflectionTestUtils.setField(service, "paymentPlanDatesLoader", loader);
    }

    private static PaymentLogWithUserPlanDTO row(String planId) {
        return PaymentLogWithUserPlanDTO.builder()
                .userPlan(planId == null ? null : UserPlanDTO.builder().id(planId).build())
                .build();
    }

    private void attach(List<PaymentLogWithUserPlanDTO> rows) {
        ReflectionTestUtils.invokeMethod(service, "attachPlanDates", rows);
    }

    @Test
    @DisplayName("instalment plans get a plain due day, subscriptions a UTC instant, invoices nothing")
    void fillsEachKindOfRow() {
        PaymentLogWithUserPlanDTO cpo = row("cpo");
        PaymentLogWithUserPlanDTO sub = row("sub");
        PaymentLogWithUserPlanDTO oneTime = row("one");
        PaymentLogWithUserPlanDTO invoiceRow = row(null);
        when(loader.load(anyList())).thenReturn(Map.of(
                "cpo", new PaymentPlanDatesLoader.PlanDates(LocalDate.of(2026, 8, 31), LocalDate.of(2026, 10, 15), null),
                "sub", new PaymentPlanDatesLoader.PlanDates(LocalDate.of(2026, 9, 6), null,
                        LocalDateTime.of(2026, 10, 18, 18, 30)),
                "one", new PaymentPlanDatesLoader.PlanDates(LocalDate.of(2026, 9, 1), null, null)));

        attach(List.of(cpo, sub, oneTime, invoiceRow));

        assertEquals(LocalDate.of(2026, 8, 31), cpo.getEnrolledDate());
        assertEquals("2026-10-15", cpo.getNextDueOn());
        assertEquals("2026-10-18T18:30:00Z", sub.getNextDueOn());
        assertEquals(LocalDate.of(2026, 9, 1), oneTime.getEnrolledDate());
        assertNull(oneTime.getNextDueOn());
        assertNull(invoiceRow.getEnrolledDate());
        verify(loader).load(List.of("cpo", "sub", "one"));
    }

    @Test
    @DisplayName("a failed lookup leaves the two columns empty and the list intact")
    void failureCostsOnlyTheColumns() {
        PaymentLogWithUserPlanDTO r = row("p1");
        when(loader.load(anyList())).thenThrow(new RuntimeException("statement timeout"));

        assertDoesNotThrow(() -> attach(List.of(r)));
        assertNull(r.getEnrolledDate());
        assertNull(r.getNextDueOn());
    }

    @Test
    @DisplayName("a page with no plans asks nothing")
    void noPlansNoQuery() {
        attach(List.of(row(null)));
        verify(loader, never()).load(anyList());
    }
}
