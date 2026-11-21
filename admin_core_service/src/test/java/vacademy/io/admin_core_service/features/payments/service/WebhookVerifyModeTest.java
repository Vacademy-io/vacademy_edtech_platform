package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.enums.WebHookStatus;
import vacademy.io.admin_core_service.features.payments.service.PaymentWebhookVerifier.Mode;
import vacademy.io.admin_core_service.features.payments.service.PaymentWebhookVerifier.Outcome;
import vacademy.io.admin_core_service.features.payments.service.PaymentWebhookVerifier.Result;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Cashfree and PhonePe webhook handling in log mode (process exactly as before; the gateway
 * read-back is handed off only after the webhook row is marked processed)
 * and enforce mode (apply only what the gateway confirms; 200 without a change on a
 * disagreement, 503 when the gateway could not be asked).
 */
class WebhookVerifyModeTest {

    private static final String CASHFREE_PAID = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
            + "\"order\":{\"order_id\":\"order_123\",\"order_amount\":499.0},"
            + "\"payment\":{\"payment_status\":\"SUCCESS\"}}}";
    private static final String PHONEPE_PAID = "{\"event\":\"checkout.order.completed\",\"payload\":{"
            + "\"merchantOrderId\":\"MP1\",\"state\":\"COMPLETED\",\"amount\":49900}}";

    private WebHookService webHookService;
    private PaymentLogService paymentLogService;
    private PaymentWebhookVerifier verifier;
    private InstitutePaymentGatewayMappingService gatewayService;
    private CashfreeWebHookService cashfreeService;
    private PhonePeWebHookService phonePeService;

    @BeforeEach
    void setUp() {
        webHookService = mock(WebHookService.class);
        paymentLogService = mock(PaymentLogService.class);
        verifier = mock(PaymentWebhookVerifier.class);
        gatewayService = mock(InstitutePaymentGatewayMappingService.class);
        when(webHookService.saveWebhook(anyString(), anyString(), any())).thenReturn("wh-1");

        cashfreeService = new CashfreeWebHookService();
        ReflectionTestUtils.setField(cashfreeService, "webHookService", webHookService);
        ReflectionTestUtils.setField(cashfreeService, "paymentLogService", paymentLogService);
        ReflectionTestUtils.setField(cashfreeService, "objectMapper", new ObjectMapper());
        ReflectionTestUtils.setField(cashfreeService, "webhookVerifier", verifier);

        phonePeService = new PhonePeWebHookService();
        ReflectionTestUtils.setField(phonePeService, "webHookService", webHookService);
        ReflectionTestUtils.setField(phonePeService, "paymentLogService", paymentLogService);
        ReflectionTestUtils.setField(phonePeService, "objectMapper", new ObjectMapper());
        ReflectionTestUtils.setField(phonePeService, "webhookVerifier", verifier);
        ReflectionTestUtils.setField(phonePeService, "institutePaymentGatewayMappingService", gatewayService);
        // No PhonePe webhook credentials configured (the Authorization check is skipped, as before).
        when(gatewayService.findInstitutePaymentGatewaySpecifData("PHONEPE", "inst-request")).thenReturn(Map.of());
    }

    // ── Cashfree ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Cashfree log mode: processed exactly as before, then the read-back is handed off")
    void cashfreeLogModeProcessesAsBefore() {
        when(verifier.cashfreeMode()).thenReturn(Mode.LOG);

        ResponseEntity<String> response = cashfreeService.processWebHook(CASHFREE_PAID, "sig", "123", "inst-request");

        assertEquals(200, response.getStatusCode().value());
        assertEquals("SUCCESS", response.getBody());
        InOrder order = inOrder(paymentLogService, webHookService, verifier);
        order.verify(paymentLogService).updatePaymentLogsByOrderId("order_123", "PAID", "inst-request");
        order.verify(webHookService).updateWebHookStatus("wh-1", WebHookStatus.PROCESSED, null);
        order.verify(verifier).checkCashfreeAfterApply("wh-1", "order_123", PaymentStatusEnum.PAID, "inst-request",
                true, "sig", "123", CASHFREE_PAID);
        verify(paymentLogService, never()).updatePaymentLogsForWebhook(anyString(), anyString(), anyString(), anyString());
        // Nothing gateway-bound on the webhook thread.
        verify(verifier, never()).verifyCashfree(anyString(), any());
        verify(verifier, never()).checkCashfreeSignature(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("Cashfree log mode: a failing hand-off cannot change the response")
    void cashfreeLogModeHandOffFailure() {
        when(verifier.cashfreeMode()).thenReturn(Mode.LOG);
        doThrow(new RuntimeException("boom")).when(verifier)
                .checkCashfreeAfterApply(any(), any(), any(), any(), anyBoolean(), any(), any(), any());

        ResponseEntity<String> response = cashfreeService.processWebHook(CASHFREE_PAID, null, null, "inst-request");

        assertEquals(200, response.getStatusCode().value());
        assertEquals("SUCCESS", response.getBody());
        verify(paymentLogService).updatePaymentLogsByOrderId("order_123", "PAID", "inst-request");
        verify(webHookService).updateWebHookStatus("wh-1", WebHookStatus.PROCESSED, null);
        verify(webHookService, never()).updateWebHookStatus(eq("wh-1"), eq(WebHookStatus.FAILED), any());
    }

    @Test
    @DisplayName("Cashfree enforce: a gateway disagreement is acknowledged with 200 and changes nothing")
    void cashfreeEnforceRefuses() {
        when(verifier.cashfreeMode()).thenReturn(Mode.ENFORCE);
        when(verifier.verifyCashfree("order_123", PaymentStatusEnum.PAID))
                .thenReturn(new Outcome(Result.STATUS_MISMATCH, "inst-owner", "ACTIVE"));

        ResponseEntity<String> response = cashfreeService.processWebHook(CASHFREE_PAID, null, null, "inst-request");

        assertEquals(200, response.getStatusCode().value());
        assertEquals("IGNORED", response.getBody());
        verify(paymentLogService, never()).updatePaymentLogsByOrderId(anyString(), anyString(), anyString());
        verify(paymentLogService, never()).updatePaymentLogsForWebhook(anyString(), anyString(), anyString(), anyString());
        verify(webHookService).updateWebHookStatus(eq("wh-1"), eq(WebHookStatus.FAILED), startsWith("Not applied"));
    }

    @Test
    @DisplayName("Cashfree enforce: gateway unreachable answers 503 so Cashfree retries, nothing changes")
    void cashfreeEnforceRetries() {
        when(verifier.cashfreeMode()).thenReturn(Mode.ENFORCE);
        when(verifier.verifyCashfree("order_123", PaymentStatusEnum.PAID))
                .thenReturn(new Outcome(Result.FETCH_ERROR, "inst-owner", null));

        ResponseEntity<String> response = cashfreeService.processWebHook(CASHFREE_PAID, null, null, "inst-request");

        assertEquals(503, response.getStatusCode().value());
        verify(paymentLogService, never()).updatePaymentLogsForWebhook(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("Cashfree enforce: a confirmed payment is applied by exact lookup for the owning institute")
    void cashfreeEnforceApplies() {
        when(verifier.cashfreeMode()).thenReturn(Mode.ENFORCE);
        when(verifier.verifyCashfree("order_123", PaymentStatusEnum.PAID))
                .thenReturn(new Outcome(Result.OK, "inst-owner", "PAID"));

        ResponseEntity<String> response = cashfreeService.processWebHook(CASHFREE_PAID, null, null, "inst-request");

        assertEquals(200, response.getStatusCode().value());
        assertEquals("SUCCESS", response.getBody());
        verify(paymentLogService).updatePaymentLogsForWebhook("order_123", "CASHFREE", "PAID", "inst-owner");
        verify(paymentLogService, never()).updatePaymentLogsByOrderId(anyString(), anyString(), anyString());
    }

    // ── PhonePe ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("PhonePe log mode: processed as before, then the read-back is handed off")
    void phonePeLogMode() {
        when(verifier.phonePeMode()).thenReturn(Mode.LOG);

        ResponseEntity<String> response = phonePeService.processWebHook(PHONEPE_PAID, null, "inst-request");

        assertEquals(200, response.getStatusCode().value());
        assertEquals("SUCCESS", response.getBody());
        InOrder order = inOrder(paymentLogService, webHookService, verifier);
        order.verify(paymentLogService).updatePaymentLogsByOrderId("MP1", "PAID", "inst-request");
        order.verify(webHookService).updateWebHookStatus("wh-1", WebHookStatus.PROCESSED, null);
        order.verify(verifier).checkPhonePeAfterApply("wh-1", "MP1", PaymentStatusEnum.PAID, "inst-request");
        verify(verifier, never()).verifyPhonePe(anyString(), any());
    }

    @Test
    @DisplayName("PhonePe enforce: PENDING at the gateway is not marked paid; COMPLETED is, for the owning institute")
    void phonePeEnforce() {
        when(verifier.phonePeMode()).thenReturn(Mode.ENFORCE);
        when(verifier.verifyPhonePe("MP1", PaymentStatusEnum.PAID))
                .thenReturn(new Outcome(Result.STATUS_MISMATCH, "inst-owner", "PENDING"));

        ResponseEntity<String> refused = phonePeService.processWebHook(PHONEPE_PAID, null, "inst-request");

        assertEquals("IGNORED", refused.getBody());
        verify(paymentLogService, never()).updatePaymentLogsForWebhook(anyString(), anyString(), anyString(), anyString());
        verify(paymentLogService, never()).updatePaymentLogsByOrderId(anyString(), anyString(), anyString());

        when(verifier.verifyPhonePe("MP1", PaymentStatusEnum.PAID))
                .thenReturn(new Outcome(Result.OK, "inst-owner", "COMPLETED"));
        ResponseEntity<String> applied = phonePeService.processWebHook(PHONEPE_PAID, null, "inst-request");

        assertEquals("SUCCESS", applied.getBody());
        verify(paymentLogService).updatePaymentLogsForWebhook("MP1", "PHONEPE", "PAID", "inst-owner");
    }
}
