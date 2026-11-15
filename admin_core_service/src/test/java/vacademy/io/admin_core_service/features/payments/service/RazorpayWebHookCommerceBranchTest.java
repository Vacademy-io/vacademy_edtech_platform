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
        when(branch.handle(eq("payment.captured"), any(), eq("inst-1")))
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
        when(branch.handle(any(), any(), any()))
                .thenReturn(new Result(Outcome.REFUSED, "order-1", "AMOUNT_MISMATCH", 0));

        ResponseEntity<String> answer = process(event("payment.captured", "order_rzp1", "order-1"));

        assertEquals(200, answer.getStatusCode().value());
        verify(webHooks).updateWebHookStatus("wh-1", WebHookStatus.FAILED,
                "Commerce payment refused: AMOUNT_MISMATCH");
        verifyNoInteractions(paymentLogService);
    }

    @Test
    void aCoursePaymentGoesOnToTheLegacyPathUnchanged() {
        when(branch.handle(any(), any(), any())).thenReturn(Result.NOT_COMMERCE);

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
}
