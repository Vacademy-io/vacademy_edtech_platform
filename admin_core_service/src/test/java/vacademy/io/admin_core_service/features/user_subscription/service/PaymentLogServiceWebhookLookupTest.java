package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The exact webhook lookup next to the legacy LIKE / primary-key lookup. */
class PaymentLogServiceWebhookLookupTest {

    private PaymentLogRepository repository;
    private PaymentLogService service;

    @BeforeEach
    void setUp() {
        repository = mock(PaymentLogRepository.class);
        service = new PaymentLogService();
        ReflectionTestUtils.setField(service, "paymentLogRepository", repository);
    }

    private static PaymentLog log(String id, String vendor, String data) {
        PaymentLog log = new PaymentLog();
        log.setId(id);
        log.setVendor(vendor);
        log.setPaymentSpecificData(data);
        log.setPaymentAmount(100.0);
        return log;
    }

    @Test
    @DisplayName("candidates come from an escaped pattern; only exact same-gateway rows are kept")
    void exactLookupFiltersCandidates() {
        PaymentLog hit = log("pl-1", "CASHFREE", "{\"originalRequest\":{\"order_id\":\"MP1\"}}");
        PaymentLog otherGateway = log("pl-2", "RAZORPAY", "{\"originalRequest\":{\"order_id\":\"MP1\"}}");
        PaymentLog elsewhere = log("pl-3", "CASHFREE", "{\"response\":{\"note\":\"MP1\"}}");
        when(repository.findWebhookOrderCandidates("MP1", "%\"MP1\"%"))
                .thenReturn(List.of(hit, otherGateway, elsewhere));

        List<PaymentLog> found = service.findLogsForWebhook("MP1", "CASHFREE");

        assertEquals(List.of(hit), found);
    }

    @Test
    @DisplayName("a wildcard order id is searched literally and matches nothing")
    void wildcardIdMatchesNothing() {
        when(repository.findWebhookOrderCandidates("%", "%\"\\%\"%")).thenReturn(List.of());
        assertTrue(service.findLogsForWebhook("%", "CASHFREE").isEmpty());
        verify(repository, never()).findAllByOrderIdInJson(anyString());
    }

    @Test
    @DisplayName("match report: exact ids, owning institute from server data, legacy ids for comparison")
    void matchReportsBothLookups() {
        PaymentLog donation = log("pl-1", "CASHFREE",
                "{\"originalRequest\":{\"order_id\":\"pl-1\",\"institute_id\":\"inst-1\"}}");
        when(repository.findWebhookOrderCandidates("pl-1", "%\"pl-1\"%")).thenReturn(List.of(donation));
        when(repository.findAllByOrderIdInOriginalRequest("pl-1")).thenReturn(List.of(donation));

        PaymentLogService.WebhookOrderMatch match = service.matchWebhookOrder("pl-1", "CASHFREE");

        assertEquals(List.of("pl-1"), match.logIds());
        assertEquals(List.of(100.0), match.amounts());
        assertEquals(java.util.Set.of("inst-1"), match.instituteIds());
        assertEquals(List.of("pl-1"), match.legacyLogIds());
    }

    @Test
    @DisplayName("match report skips the legacy lookup for wildcard ids")
    void matchSkipsLegacyForWildcards() {
        when(repository.findWebhookOrderCandidates(anyString(), anyString())).thenReturn(List.of());
        PaymentLogService.WebhookOrderMatch match = service.matchWebhookOrder("a_b", "CASHFREE");
        assertNull(match.legacyLogIds());
        verify(repository, never()).findAllByOrderIdInOriginalRequest(anyString());
    }

    @Test
    @DisplayName("legacy lookup unchanged: JSON order id, then substring, then primary key")
    void legacyLookupOrder() {
        PaymentLog byPk = log("pl-9", "CASHFREE", null);
        when(repository.findAllByOrderIdInOriginalRequest("pl-9")).thenReturn(List.of());
        when(repository.findAllByOrderIdInJson("pl-9")).thenReturn(List.of());
        when(repository.findById("pl-9")).thenReturn(Optional.of(byPk));

        assertEquals(List.of(byPk), service.findLogsByOrderIdLegacy("pl-9"));
    }
}
