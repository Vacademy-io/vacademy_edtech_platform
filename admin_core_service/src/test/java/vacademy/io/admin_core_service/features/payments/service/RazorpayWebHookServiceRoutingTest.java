package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** F11: which events the institute-account webhook hands to the platform handler. */
class RazorpayWebHookServiceRoutingTest {

    private RazorpayWebHookService service;
    private SubscriptionPaymentHandler handler;
    private PlatformPaymentRepository platformPayments;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        service = new RazorpayWebHookService();
        handler = mock(SubscriptionPaymentHandler.class);
        ObjectProvider<SubscriptionPaymentHandler> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(handler);
        platformPayments = mock(PlatformPaymentRepository.class);
        when(platformPayments.findByVendorOrderId(anyString())).thenReturn(Optional.empty());
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        ReflectionTestUtils.setField(service, "subscriptionPaymentHandler", provider);
        ReflectionTestUtils.setField(service, "platformPaymentRepository", platformPayments);
    }

    private static String payment(String event, String notesJson, String orderId) {
        return "{\"event\":\"" + event + "\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_1\","
                + "\"order_id\":" + (orderId == null ? "null" : "\"" + orderId + "\"")
                + ",\"notes\":" + notesJson + "}}}}";
    }

    @Test
    void creditPackEventsStillGoToThePlatformHandler() {
        assertTrue(service.isPlatformCreditPackEvent(
                payment("payment.captured", "{\"payment_type\":\"AI_CREDIT_PACK\",\"orderId\":\"pp-1\"}", "order_1")));
    }

    @Test
    void subscriptionEventsGoToThePlatformHandler() {
        assertTrue(service.isPlatformCreditPackEvent(
                payment("payment.captured", "{\"payment_type\":\"AI_SUBSCRIPTION\",\"orderId\":\"pp-2\"}", "order_2")));
        String orderPaid = "{\"event\":\"order.paid\",\"payload\":{\"order\":{\"entity\":{\"id\":\"order_3\","
                + "\"notes\":{\"payment_type\":\"AI_SUBSCRIPTION\"}}}}}";
        assertTrue(service.isPlatformCreditPackEvent(orderPaid));
    }

    @Test
    void learnerPaymentsStayOnTheInstitutePath() {
        assertFalse(service.isPlatformCreditPackEvent(
                payment("payment.captured", "{\"payment_type\":\"INITIAL\",\"orderId\":\"po-1\"}", "order_9")));
        assertFalse(service.isPlatformCreditPackEvent(
                payment("payment.captured", "{\"payment_type\":\"RENEWAL\"}", "order_9")));
        assertFalse(service.isPlatformCreditPackEvent("not json"));
    }

    @Test
    void notesLessPaymentIsOursOnlyWhenItsOrderIsAPlatformOrder() {
        String event = payment("payment.captured", "[]", "order_reg");
        assertFalse(service.isPlatformCreditPackEvent(event));

        when(platformPayments.findByVendorOrderId("order_reg")).thenReturn(Optional.of(new PlatformPayment()));
        assertTrue(service.isPlatformCreditPackEvent(event));
    }

    @Test
    void tokenEventsAreOursOnlyForPlatformMandates() {
        String token = "{\"event\":\"token.confirmed\",\"payload\":{\"token\":{\"entity\":{\"id\":\"token_1\"}}}}";
        when(handler.ownsToken("token_1")).thenReturn(false);
        assertFalse(service.isPlatformCreditPackEvent(token));
        when(handler.ownsToken("token_1")).thenReturn(true);
        assertTrue(service.isPlatformCreditPackEvent(token));
    }
}
