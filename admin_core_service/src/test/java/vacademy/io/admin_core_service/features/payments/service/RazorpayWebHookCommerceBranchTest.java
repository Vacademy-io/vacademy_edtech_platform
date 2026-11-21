package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService.Outcome;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService.Result;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommerceWebhookBranch;
import vacademy.io.admin_core_service.features.payments.enums.WebHookStatus;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The commerce branch sits at the top of the verified part of the Razorpay webhook: a shop
 * payment never reaches the legacy routing, and a course payment goes on exactly as before.
 */
class RazorpayWebHookCommerceBranchTest {

    private RazorpayWebHookService service;
    private CommerceWebhookBranch branch;
    private PaymentLogService paymentLogService;
    private WebHookService webHooks;

    @BeforeEach
    void setUp() {
        service = new RazorpayWebHookService();
        branch = mock(CommerceWebhookBranch.class);
        paymentLogService = mock(PaymentLogService.class);
        webHooks = mock(WebHookService.class);
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        ReflectionTestUtils.setField(service, "commerceWebhookBranch", branch);
        ReflectionTestUtils.setField(service, "paymentLogService", paymentLogService);
        ReflectionTestUtils.setField(service, "webHookService", webHooks);
    }

    private static String event(String type, String gatewayOrderId, String notesOrderId) {
        return "{\"event\":\"" + type + "\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_1\","
                + "\"order_id\":\"" + gatewayOrderId + "\",\"amount\":49900,\"currency\":\"INR\","
                + "\"notes\":{\"orderId\":\"" + notesOrderId + "\",\"instituteId\":\"inst-1\"}}}}}";
    }

    private ResponseEntity<String> process(String payload) {
        return ReflectionTestUtils.invokeMethod(service, "processVerifiedPayload", "wh-1", payload, "inst-1");
    }

    @Test
    void aShopPaymentIsHandledByTheBranchAndNoLegacyLogicRuns() {
        when(branch.handle(eq("payment.captured"), any(), eq("inst-1"), isNull()))
                .thenReturn(new Result(Outcome.HANDLED, "order-1", null, 2));

        ResponseEntity<String> answer = process(event("payment.captured", "order_rzp1", "order-1"));

        assertEquals(200, answer.getStatusCode().value());
        verify(webHooks).updateWebHookStatus("wh-1", WebHookStatus.PROCESSED, null);
        // No update by the order reference of the notes, hence no legacy post-payment logic,
        // no Razorpay-hosted invoice and no saved payment method.
        verifyNoInteractions(paymentLogService);
    }

    @Test
    void aRefusedShopPaymentIsAcknowledgedMarkedFailedAndChangesNothing() {
        when(branch.handle(any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.REFUSED, "order-1", "AMOUNT_MISMATCH", 0));

        ResponseEntity<String> answer = process(event("payment.captured", "order_rzp1", "order-1"));

        assertEquals(200, answer.getStatusCode().value());
        verify(webHooks).updateWebHookStatus("wh-1", WebHookStatus.FAILED,
                "Commerce payment refused: AMOUNT_MISMATCH");
        verifyNoInteractions(paymentLogService);
    }

    @Test
    void aCoursePaymentGoesOnToTheLegacyPathUnchanged() {
        when(branch.handle(any(), any(), any(), any())).thenReturn(Result.NOT_COMMERCE);

        ResponseEntity<String> answer = process(event("payment.failed", "order_rzp9", "log-course"));

        assertEquals(200, answer.getStatusCode().value());
        verify(paymentLogService).updatePaymentLog("log-course", "FAILED", "inst-1");
        verify(webHooks).updateWebHookStatus("wh-1", WebHookStatus.PROCESSED, null);
    }

    @Test
    void withoutTheBranchInTheContextTheWebhookWorksAsBefore() {
        ReflectionTestUtils.setField(service, "commerceWebhookBranch", null);

        process(event("payment.failed", "order_rzp9", "log-course"));

        verify(paymentLogService).updatePaymentLog("log-course", "FAILED", "inst-1");
    }

    // -- refund events (WP-32) --

    private static String refundEvent(String type, String gatewayOrderId, String notesOrderId) {
        return "{\"event\":\"" + type + "\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_1\","
                + "\"order_id\":\"" + gatewayOrderId + "\",\"amount\":49900,\"currency\":\"INR\","
                + "\"notes\":{\"orderId\":\"" + notesOrderId + "\",\"instituteId\":\"inst-1\"}}},"
                + "\"refund\":{\"entity\":{\"id\":\"rfnd_1\",\"payment_id\":\"pay_1\",\"amount\":20000,"
                + "\"status\":\"processed\",\"receipt\":\"r-1\"}}}}";
    }

    @Test
    void aRefundEventOfACoursePaymentRunsTheLegacyPathExactlyAsWithoutTheBranch() {
        String payload = refundEvent("refund.processed", "order_rzp9", "log-course");
        when(branch.handle(any(), any(), any(), any())).thenReturn(Result.NOT_COMMERCE);
        ResponseEntity<String> withBranch = process(payload);

        // The same event on a service without the commerce branch: the legacy behaviour as it was.
        RazorpayWebHookService legacy = new RazorpayWebHookService();
        PaymentLogService legacyLogs = mock(PaymentLogService.class);
        WebHookService legacyHooks = mock(WebHookService.class);
        ReflectionTestUtils.setField(legacy, "objectMapper", new ObjectMapper());
        ReflectionTestUtils.setField(legacy, "commerceWebhookBranch", null);
        ReflectionTestUtils.setField(legacy, "paymentLogService", legacyLogs);
        ReflectionTestUtils.setField(legacy, "webHookService", legacyHooks);
        ResponseEntity<String> without = ReflectionTestUtils.invokeMethod(legacy, "processVerifiedPayload", "wh-1",
                payload, "inst-1");

        assertEquals(without.getStatusCode(), withBranch.getStatusCode());
        assertEquals(without.getBody(), withBranch.getBody());
        assertEquals(calls(legacyLogs), calls(paymentLogService), "the same legacy calls, in the same order");
        assertEquals(calls(legacyHooks), calls(webHooks));
    }

    @Test
    void aRefundEventOfAShopPaymentGoesToTheBranchWithItsRefundEntityAndNoLegacyLogicRuns() {
        org.mockito.ArgumentCaptor<com.fasterxml.jackson.databind.JsonNode> refund =
                org.mockito.ArgumentCaptor.forClass(com.fasterxml.jackson.databind.JsonNode.class);
        when(branch.handle(eq("refund.processed"), any(), eq("inst-1"), refund.capture()))
                .thenReturn(new Result(Outcome.HANDLED, "order-1", null, 0));

        ResponseEntity<String> answer = process(refundEvent("refund.processed", "order_rzp1", "order-1"));

        assertEquals(200, answer.getStatusCode().value());
        assertEquals("rfnd_1", refund.getValue().path("id").asText());
        verify(webHooks).updateWebHookStatus("wh-1", WebHookStatus.PROCESSED, null);
        verifyNoInteractions(paymentLogService);
    }

    @Test
    void aPaymentEventCarriesNoRefundEntity() {
        when(branch.handle(any(), any(), any(), any())).thenReturn(Result.NOT_COMMERCE);
        process(event("payment.failed", "order_rzp9", "log-course"));
        verify(branch).handle(eq("payment.failed"), any(), eq("inst-1"), isNull());
    }

    private static java.util.List<String> calls(Object mock) {
        return org.mockito.Mockito.mockingDetails(mock).getInvocations().stream()
                .map(i -> i.getMethod().getName() + i.getArguments().length + java.util.Arrays.toString(i.getArguments()))
                .toList();
    }
}
