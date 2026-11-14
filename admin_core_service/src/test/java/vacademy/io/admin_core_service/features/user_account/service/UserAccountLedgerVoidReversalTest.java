package vacademy.io.admin_core_service.features.user_account.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.user_account.entity.UserAccountLedger;
import vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A voided payment comes back out of "total paid" exactly once. */
class UserAccountLedgerVoidReversalTest {

    private final UserAccountLedgerRepository repository = mock(UserAccountLedgerRepository.class);
    private final UserAccountLedgerService service = new UserAccountLedgerService(
            repository, mock(InvoiceRepository.class), mock(PaymentLogRepository.class));

    @Test
    @DisplayName("posts one CREDIT_REVERSAL per credit booked for the payment")
    void reversesTheCredit() {
        UserAccountLedger credit = UserAccountLedger.builder()
                .userId("u1").instituteId("inst").eventType("CREDIT_PAYMENT")
                .amount(new BigDecimal("25000.00")).currency("INR")
                .sourceType("USER_PLAN").sourceId("plan-1").referenceId("pl-1")
                .build();
        when(repository.existsByReferenceIdAndEventType("pl-1", "CREDIT_REVERSAL")).thenReturn(false);
        when(repository.findByReferenceIdAndEventType("pl-1", "CREDIT_PAYMENT")).thenReturn(List.of(credit));

        BigDecimal reversed = service.reverseCreditsForVoidedPayment("pl-1", "Payment voided: typo");

        assertEquals(0, new BigDecimal("25000.00").compareTo(reversed));
        ArgumentCaptor<UserAccountLedger> saved = ArgumentCaptor.forClass(UserAccountLedger.class);
        verify(repository).save(saved.capture());
        assertEquals("CREDIT_REVERSAL", saved.getValue().getEventType());
        assertEquals("u1", saved.getValue().getUserId());
        assertEquals("inst", saved.getValue().getInstituteId());
        assertEquals("pl-1", saved.getValue().getReferenceId());
        assertEquals("USER_PLAN", saved.getValue().getSourceType());
        assertEquals(0, new BigDecimal("25000.00").compareTo(saved.getValue().getAmount()));
    }

    @Test
    @DisplayName("does nothing the second time")
    void idempotent() {
        when(repository.existsByReferenceIdAndEventType("pl-1", "CREDIT_REVERSAL")).thenReturn(true);
        assertEquals(0, BigDecimal.ZERO.compareTo(service.reverseCreditsForVoidedPayment("pl-1", "x")));
        verify(repository, never()).save(any());
    }
}
