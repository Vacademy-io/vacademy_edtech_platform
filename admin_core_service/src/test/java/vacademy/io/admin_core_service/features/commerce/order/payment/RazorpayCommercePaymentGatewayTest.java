package vacademy.io.admin_core_service.features.commerce.order.payment;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGateway.GatewayOrder;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceFactory;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceStrategy;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentType;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The gateway is a stub behind the platform's strategy interface: no call leaves the test. */
class RazorpayCommercePaymentGatewayTest {

    private static final String SECRET = "rzp-secret-value";

    private InstitutePaymentGatewayMappingService gatewayMappings;
    private PaymentServiceStrategy razorpay;
    private CommerceGatewayOrderRepository gatewayOrders;
    private RazorpayPaymentManager razorpayManager;
    private RazorpayCommercePaymentGateway gateway;
    private Map<String, Object> credentials;

    @BeforeEach
    void setUp() {
        gatewayMappings = mock(InstitutePaymentGatewayMappingService.class);
        razorpay = mock(PaymentServiceStrategy.class);
        gatewayOrders = mock(CommerceGatewayOrderRepository.class);
        PaymentServiceFactory factory = mock(PaymentServiceFactory.class);
        when(factory.getStrategy(PaymentGateway.RAZORPAY)).thenReturn(razorpay);
        razorpayManager = mock(RazorpayPaymentManager.class);
        gateway = new RazorpayCommercePaymentGateway(gatewayMappings, factory, gatewayOrders, razorpayManager);

        credentials = new HashMap<>();
        credentials.put("apiKey", "rzp_test_key");
        credentials.put("publishableKey", SECRET);
        when(gatewayMappings.findInstitutePaymentGatewaySpecifData("RAZORPAY", "inst-1")).thenReturn(credentials);
        when(gatewayOrders.findByCommerceOrderIdOrderByCreatedAtDesc("order-1")).thenReturn(List.of());
        when(gatewayOrders.save(any())).thenAnswer(call -> call.getArgument(0));
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    private static PaymentResponseDTO created(String gatewayOrderId, long amountMinor) {
        Map<String, Object> data = new HashMap<>();
        data.put("razorpayOrderId", gatewayOrderId);
        data.put("razorpayKeyId", "rzp_test_key");
        data.put("amount", amountMinor);
        data.put("currency", "INR");
        PaymentResponseDTO response = new PaymentResponseDTO();
        response.setResponseData(data);
        return response;
    }

    @Test
    void theOrderIsCreatedWithTheInstituteTheReferenceAndTheExactAmountAndIsRecorded() {
        when(razorpay.initiatePayment(any(), any(), any())).thenReturn(created("order_rzp1", 49900));

        GatewayOrder order = gateway.createOrder("inst-1", "order-1", 49900, "inr", "order-1",
                Map.of("order_number", "CH-1001"));

        assertEquals(new GatewayOrder("RAZORPAY", "order_rzp1", "rzp_test_key", 49900, "INR"), order);

        ArgumentCaptor<PaymentInitiationRequestDTO> request = ArgumentCaptor.forClass(PaymentInitiationRequestDTO.class);
        verify(razorpay).initiatePayment(any(), request.capture(), same(credentials));
        // Without the institute on the request the webhook cannot find the secret.
        assertEquals("inst-1", request.getValue().getInstituteId());
        assertEquals("order-1", request.getValue().getOrderId()); // receipt and the orderId note
        assertEquals(499.0, request.getValue().getAmount());
        assertEquals("INR", request.getValue().getCurrency());
        assertEquals(PaymentType.INITIAL, request.getValue().getPaymentType());
        assertEquals("commerce_order_id=order-1; order_number=CH-1001", request.getValue().getDescription());

        ArgumentCaptor<CommerceGatewayOrder> row = ArgumentCaptor.forClass(CommerceGatewayOrder.class);
        verify(gatewayOrders).save(row.capture());
        assertEquals("order-1", row.getValue().getCommerceOrderId());
        assertEquals("inst-1", row.getValue().getInstituteId());
        assertEquals("order_rzp1", row.getValue().getGatewayOrderId());
        assertEquals(49900L, row.getValue().getAmountMinor());
        assertEquals("CREATED", row.getValue().getStatus());
    }

    @Test
    void aGatewayFailureLeavesTheOrderRetryableAndNamesNoSecret() {
        when(razorpay.initiatePayment(any(), any(), any()))
                .thenThrow(new VacademyException("Error initiating Razorpay payment: timeout " + SECRET));

        CommercePaymentGatewayException failure = assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.createOrder("inst-1", "order-1", 49900, "INR", "order-1", Map.of()));

        assertTrue(failure.isRetryable());
        assertEquals(CommercePaymentGatewayException.UNAVAILABLE, failure.getCode());
        assertFalse(failure.getMessage().contains(SECRET));
        verify(gatewayOrders, never()).save(any());

        // The same call again works: nothing was left behind.
        doReturn(created("order_rzp2", 49900)).when(razorpay).initiatePayment(any(), any(), any());
        assertEquals("order_rzp2",
                gateway.createOrder("inst-1", "order-1", 49900, "INR", "order-1", Map.of()).gatewayOrderId());
    }

    @Test
    void anOpenAttemptOfTheSameAmountIsGivenBackWithoutASecondGatewayOrder() {
        CommerceGatewayOrder earlier = new CommerceGatewayOrder();
        earlier.setInstituteId("inst-1");
        earlier.setCommerceOrderId("order-1");
        earlier.setVendor("RAZORPAY");
        earlier.setGatewayOrderId("order_rzp1");
        earlier.setKeyId("rzp_test_key");
        earlier.setAmountMinor(49900L);
        earlier.setCurrency("INR");
        earlier.setReceipt("order-1");
        earlier.setStatus("FAILED"); // a failed attempt can be paid again on the same gateway order
        when(gatewayOrders.findByCommerceOrderIdOrderByCreatedAtDesc("order-1")).thenReturn(List.of(earlier));

        GatewayOrder order = gateway.createOrder("inst-1", "order-1", 49900, "INR", "order-1", null);

        assertEquals("order_rzp1", order.gatewayOrderId());
        verifyNoInteractions(razorpay);
        verify(gatewayOrders, never()).save(any());
    }

    @Test
    void aPaidOrderGetsNoNewGatewayOrder() {
        CommerceGatewayOrder paid = new CommerceGatewayOrder();
        paid.setInstituteId("inst-1");
        paid.setVendor("RAZORPAY");
        paid.setAmountMinor(49900L);
        paid.setCurrency("INR");
        paid.setStatus("PAID");
        when(gatewayOrders.findByCommerceOrderIdOrderByCreatedAtDesc("order-1")).thenReturn(List.of(paid));

        CommercePaymentGatewayException failure = assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.createOrder("inst-1", "order-1", 49900, "INR", "order-1", null));

        assertFalse(failure.isRetryable());
        verifyNoInteractions(razorpay);
    }

    @Test
    void anOrderCreatedForAnotherAmountIsNotHandedOut() {
        when(razorpay.initiatePayment(any(), any(), any())).thenReturn(created("order_rzp1", 100));

        assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.createOrder("inst-1", "order-1", 49900, "INR", "order-1", null));
        verify(gatewayOrders, never()).save(any());
    }

    @Test
    void anInstituteWithoutRazorpayIsToldSoAndNothingIsCalled() {
        when(gatewayMappings.findInstitutePaymentGatewaySpecifData("RAZORPAY", "inst-2"))
                .thenThrow(new VacademyException("No configurartion found for this payment gateway type"));
        when(gatewayOrders.findByCommerceOrderIdOrderByCreatedAtDesc("order-2")).thenReturn(List.of());

        CommercePaymentGatewayException failure = assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.createOrder("inst-2", "order-2", 49900, "INR", "order-2", null));

        assertEquals(CommercePaymentGatewayException.NOT_CONFIGURED, failure.getCode());
        assertFalse(failure.isRetryable());
        verifyNoInteractions(razorpay);
    }

    @Test
    void itRefusesToCallTheGatewayInsideATransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);

        assertThrows(IllegalStateException.class,
                () -> gateway.createOrder("inst-1", "order-1", 49900, "INR", "order-1", null));
        verifyNoInteractions(razorpay, gatewayMappings, gatewayOrders);
    }

    @Test
    void aBadRequestIsRefusedBeforeAnyCall() {
        assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.createOrder("inst-1", "order-1", 0, "INR", "order-1", null));
        assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.createOrder("inst-1", "order-1", 49900, "INR", "x".repeat(41), null));
        assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.createOrder(" ", "order-1", 49900, "INR", "order-1", null));
        verifyNoInteractions(razorpay);
    }

    @Test
    void aCredentialInAGatewayMessageIsBlankedBeforeItIsLogged() {
        String logged = RazorpayCommercePaymentGateway.withoutCredentials(
                "Authentication failed for rzp_test_key with " + SECRET, credentials);

        assertEquals("Authentication failed for *** with ***", logged);
    }

    @Test
    void theNoteIsCutToWhatRazorpayTakes() {
        String note = RazorpayCommercePaymentGateway.describe("order-1", Map.of("long", "y".repeat(400)));
        assertEquals(RazorpayCommercePaymentGateway.MAX_NOTE_LENGTH, note.length());
        assertTrue(note.startsWith("commerce_order_id=order-1; long="));
    }

    // ------------------------------------------------------------------ fetchPayments

    private static Map<String, Object> payment(String id, String orderId, String status, long amount, long created) {
        Map<String, Object> p = new HashMap<>();
        p.put("id", id);
        p.put("order_id", orderId);
        p.put("status", status);
        p.put("amount", amount);
        p.put("currency", "INR");
        p.put("created_at", created);
        return p;
    }

    @Test
    void fetchPaymentsMapsWhatTheGatewayReports() {
        when(razorpayManager.fetchOrderPayments("order_gw_1", credentials)).thenReturn(List.of(
                payment("pay_1", "order_gw_1", "CAPTURED", 105000L, 1_800_000_000L),
                payment("pay_2", "order_gw_1", "failed", 105000L, 1_799_999_000L)));

        List<CommercePaymentGateway.GatewayPayment> payments = gateway.fetchPayments("inst-1", "order_gw_1");

        assertEquals(2, payments.size());
        CommercePaymentGateway.GatewayPayment first = payments.get(0);
        assertEquals("pay_1", first.id());
        assertEquals("order_gw_1", first.orderId());
        assertEquals("captured", first.status());
        assertEquals(105000L, first.amountMinor());
        assertEquals("INR", first.currency());
        assertEquals(java.time.Instant.ofEpochSecond(1_800_000_000L), first.createdAt());
        assertEquals("failed", payments.get(1).status());
        assertEquals(0L, first.amountRefundedMinor());
        assertEquals(null, first.refundStatus());
        assertEquals(false, first.anyRefunded());
    }

    @Test
    void fetchPaymentsCarriesAPartialRefund() {
        Map<String, Object> partly = payment("pay_1", "order_gw_1", "captured", 105000L, 1_800_000_000L);
        partly.put("amount_refunded", 5000L);
        partly.put("refund_status", "partial");
        Map<String, Object> none = payment("pay_2", "order_gw_1", "captured", 105000L, 1_800_000_000L);
        none.put("amount_refunded", 0);
        none.put("refund_status", null);
        when(razorpayManager.fetchOrderPayments("order_gw_1", credentials)).thenReturn(List.of(partly, none));

        List<CommercePaymentGateway.GatewayPayment> payments = gateway.fetchPayments("inst-1", "order_gw_1");

        assertEquals(5000L, payments.get(0).amountRefundedMinor());
        assertEquals("partial", payments.get(0).refundStatus());
        assertEquals(true, payments.get(0).anyRefunded());
        assertEquals(false, payments.get(1).anyRefunded());
    }

    @Test
    void fetchPaymentsReadsTheCredentialsOncePerRun() {
        when(razorpayManager.fetchOrderPayments(any(), same(credentials))).thenReturn(List.of());

        gateway.fetchPayments("inst-1", "order_gw_1");
        gateway.fetchPayments("inst-1", "order_gw_2");

        verify(gatewayMappings, org.mockito.Mockito.times(1)).findInstitutePaymentGatewaySpecifData("RAZORPAY", "inst-1");
    }

    @Test
    void fetchPaymentsOfAnInstituteWithoutRazorpayIsATypedRefusal() {
        when(gatewayMappings.findInstitutePaymentGatewaySpecifData("RAZORPAY", "inst-2"))
                .thenThrow(new VacademyException("no mapping"));

        CommercePaymentGatewayException e = assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.fetchPayments("inst-2", "order_gw_1"));
        assertEquals(CommercePaymentGatewayException.NOT_CONFIGURED, e.getCode());
        verifyNoInteractions(razorpayManager);
    }

    @Test
    void aFailingFetchCarriesNoCredential() {
        when(razorpayManager.fetchOrderPayments(any(), any()))
                .thenThrow(new VacademyException("bad auth for " + SECRET));

        CommercePaymentGatewayException e = assertThrows(CommercePaymentGatewayException.class,
                () -> gateway.fetchPayments("inst-1", "order_gw_1"));
        assertEquals(CommercePaymentGatewayException.UNAVAILABLE, e.getCode());
        assertFalse(e.getMessage().contains(SECRET));
        assertTrue(e.getCause() == null, "the client library's message is not carried on");
    }

    @Test
    void fetchPaymentsRefusesToRunInsideATransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        assertThrows(IllegalStateException.class, () -> gateway.fetchPayments("inst-1", "order_gw_1"));
        verifyNoInteractions(razorpayManager);
    }
}
