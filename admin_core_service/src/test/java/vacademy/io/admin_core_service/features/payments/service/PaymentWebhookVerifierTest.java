package vacademy.io.admin_core_service.features.payments.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.manager.CashfreePaymentManager;
import vacademy.io.admin_core_service.features.payments.manager.CashfreePaymentManager.CashfreeOrderStatus;
import vacademy.io.admin_core_service.features.payments.manager.PhonePePaymentManager;
import vacademy.io.admin_core_service.features.payments.service.PaymentWebhookVerifier.Mode;
import vacademy.io.admin_core_service.features.payments.service.PaymentWebhookVerifier.Result;
import vacademy.io.admin_core_service.features.payments.service.PaymentWebhookVerifier.SignatureResult;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService.WebhookOrderMatch;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PhonePeStatusResponseDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.math.BigDecimal;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PaymentWebhookVerifierTest {

    private static final String SECRET = "cf_test_secret_key";
    private static final String TIMESTAMP = "1700000000000";
    private static final String BODY = "{\"data\":{\"order\":{\"order_id\":\"order_123\",\"order_amount\":499.0}},"
            + "\"type\":\"PAYMENT_SUCCESS_WEBHOOK\"}";
    /** Base64(HMAC-SHA256(SECRET, TIMESTAMP + BODY)), computed independently. */
    private static final String EXPECTED_SIGNATURE = "W69hpcoBWLM6V03T2gx1ydpWw9GAalyEyJxnjTIlCXQ=";

    private PaymentLogService paymentLogService;
    private InstitutePaymentGatewayMappingService gatewayService;
    private CashfreePaymentManager cashfree;
    private PhonePePaymentManager phonePe;
    private PaymentWebhookVerifier verifier;

    @BeforeEach
    void setUp() {
        paymentLogService = mock(PaymentLogService.class);
        gatewayService = mock(InstitutePaymentGatewayMappingService.class);
        cashfree = mock(CashfreePaymentManager.class);
        phonePe = mock(PhonePePaymentManager.class);
        verifier = new PaymentWebhookVerifier(paymentLogService, gatewayService, cashfree, phonePe, null, null);
        when(gatewayService.findInstitutePaymentGatewaySpecifData(anyString(), eq("inst-owner")))
                .thenReturn(Map.of("clientId", "id", "clientSecret", SECRET));
    }

    private static WebhookOrderMatch match(String instituteId, double amount) {
        Set<String> institutes = new LinkedHashSet<>();
        institutes.add(instituteId);
        return new WebhookOrderMatch(List.of("pl-1"), List.of(amount), institutes, Set.of(), List.of("pl-1"));
    }

    // ── Modes ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("mode defaults to log; only 'enforce' enforces")
    void modeParsing() {
        assertEquals(Mode.LOG, verifier.cashfreeMode());
        assertEquals(Mode.LOG, verifier.phonePeMode());
        assertEquals(Mode.LOG, Mode.parse("off"));
        assertEquals(Mode.ENFORCE, Mode.parse(" ENFORCE "));
    }

    // ── Log mode: after apply ────────────────────────────────────────────────

    @Test
    @DisplayName("after apply: reads the order back with the bounded call, checks the signature, never throws")
    void cashfreeAfterApplyRunsOffThread() throws Exception {
        java.util.List<Runnable> queued = new java.util.ArrayList<>();
        verifier.setAfterApplyExecutor(queued::add);
        when(paymentLogService.matchWebhookOrder("order_123", "CASHFREE")).thenReturn(match("inst-owner", 499.0));
        when(cashfree.fetchOrder(eq("order_123"), any()))
                .thenReturn(new CashfreeOrderStatus("order_123", "PAID", new BigDecimal("499.0"), "INR"));

        verifier.checkCashfreeAfterApply("wh-1", "order_123", PaymentStatusEnum.PAID, "inst-request",
                true, EXPECTED_SIGNATURE, TIMESTAMP, BODY);

        // Nothing ran on the caller's thread.
        verify(paymentLogService, never()).matchWebhookOrder(anyString(), anyString());
        assertEquals(1, queued.size());
        queued.get(0).run();
        verify(cashfree).fetchOrder(eq("order_123"), any());
        verify(gatewayService, org.mockito.Mockito.atLeastOnce())
                .findInstitutePaymentGatewaySpecifData("CASHFREE", "inst-owner");
    }

    @Test
    @DisplayName("after apply: a rejected hand-off or a failing check is swallowed")
    void afterApplyNeverThrows() {
        verifier.setAfterApplyExecutor(task -> {
            throw new java.util.concurrent.RejectedExecutionException("full");
        });
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() ->
                verifier.checkPhonePeAfterApply("wh-1", "MP1", PaymentStatusEnum.PAID, "inst-request"));

        verifier.setAfterApplyExecutor(Runnable::run);
        when(paymentLogService.matchWebhookOrder(anyString(), anyString())).thenThrow(new RuntimeException("db"));
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() ->
                verifier.checkCashfreeAfterApply("wh-1", "order_123", PaymentStatusEnum.PAID, "inst-request",
                        false, null, null, BODY));
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() ->
                verifier.checkPhonePeAfterApply("wh-1", "MP1", PaymentStatusEnum.PAID, "inst-request"));
    }

    // ── Signature ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Cashfree signature matches a fixed vector; tampered body or wrong secret differ")
    void cashfreeSignatureVector() {
        assertEquals(EXPECTED_SIGNATURE, PaymentWebhookVerifier.cashfreeSignature(SECRET, TIMESTAMP, BODY));
        assertNotEquals(EXPECTED_SIGNATURE,
                PaymentWebhookVerifier.cashfreeSignature(SECRET, TIMESTAMP, BODY.replace("499.0", "1.0")));
        assertNotEquals(EXPECTED_SIGNATURE, PaymentWebhookVerifier.cashfreeSignature("other", TIMESTAMP, BODY));
    }

    @Test
    @DisplayName("signature check uses the institute's client secret and reports match / mismatch / missing")
    void cashfreeSignatureCheck() {
        assertEquals(SignatureResult.MATCH,
                verifier.checkCashfreeSignature("inst-owner", TIMESTAMP, EXPECTED_SIGNATURE, BODY, "order_123"));
        assertEquals(SignatureResult.MISMATCH,
                verifier.checkCashfreeSignature("inst-owner", TIMESTAMP, "AAAA", BODY, "order_123"));
        assertEquals(SignatureResult.MISSING_HEADERS,
                verifier.checkCashfreeSignature("inst-owner", null, EXPECTED_SIGNATURE, BODY, "order_123"));
        assertEquals(SignatureResult.NO_SECRET,
                verifier.checkCashfreeSignature(null, TIMESTAMP, EXPECTED_SIGNATURE, BODY, "order_123"));
    }

    // ── Cashfree ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Cashfree PAID claim: gateway PAID with the same amount is ok, with the owning institute's keys")
    void cashfreePaidOk() {
        when(paymentLogService.matchWebhookOrder("order_123", "CASHFREE")).thenReturn(match("inst-owner", 499.0));
        when(cashfree.fetchOrder(eq("order_123"), any()))
                .thenReturn(new CashfreeOrderStatus("order_123", "PAID", new BigDecimal("499.00"), "INR"));

        PaymentWebhookVerifier.Outcome outcome = verifier.verifyCashfree("order_123", PaymentStatusEnum.PAID);

        assertEquals(Result.OK, outcome.result());
        assertEquals("inst-owner", outcome.instituteId());
        verify(gatewayService).findInstitutePaymentGatewaySpecifData("CASHFREE", "inst-owner");
    }

    @Test
    @DisplayName("Cashfree PAID claim on an order still ACTIVE is a status mismatch")
    void cashfreeActiveIsNotPaid() {
        when(paymentLogService.matchWebhookOrder("order_123", "CASHFREE")).thenReturn(match("inst-owner", 499.0));
        when(cashfree.fetchOrder(eq("order_123"), any()))
                .thenReturn(new CashfreeOrderStatus("order_123", "ACTIVE", new BigDecimal("499"), "INR"));

        PaymentWebhookVerifier.Outcome outcome = verifier.verifyCashfree("order_123", PaymentStatusEnum.PAID);

        assertEquals(Result.STATUS_MISMATCH, outcome.result());
        assertFalse(outcome.retryable());
    }

    @Test
    @DisplayName("Cashfree PAID with a different amount is an amount mismatch; currency is not compared")
    void cashfreeAmountMismatch() {
        when(paymentLogService.matchWebhookOrder("order_123", "CASHFREE")).thenReturn(match("inst-owner", 499.0));
        when(cashfree.fetchOrder(eq("order_123"), any()))
                .thenReturn(new CashfreeOrderStatus("order_123", "PAID", new BigDecimal("1.00"), "INR"));
        assertEquals(Result.AMOUNT_MISMATCH, verifier.verifyCashfree("order_123", PaymentStatusEnum.PAID).result());

        when(cashfree.fetchOrder(eq("order_123"), any()))
                .thenReturn(new CashfreeOrderStatus("order_123", "PAID", new BigDecimal("499.00"), "usd"));
        assertEquals(Result.OK, verifier.verifyCashfree("order_123", PaymentStatusEnum.PAID).result());
    }

    @Test
    @DisplayName("Cashfree FAILED claim is ok unless the gateway says PAID")
    void cashfreeFailedClaim() {
        when(paymentLogService.matchWebhookOrder("order_123", "CASHFREE")).thenReturn(match("inst-owner", 499.0));
        when(cashfree.fetchOrder(eq("order_123"), any()))
                .thenReturn(new CashfreeOrderStatus("order_123", "ACTIVE", new BigDecimal("499"), "INR"));
        assertEquals(Result.OK, verifier.verifyCashfree("order_123", PaymentStatusEnum.FAILED).result());

        when(cashfree.fetchOrder(eq("order_123"), any()))
                .thenReturn(new CashfreeOrderStatus("order_123", "PAID", new BigDecimal("499"), "INR"));
        assertEquals(Result.STATUS_MISMATCH, verifier.verifyCashfree("order_123", PaymentStatusEnum.FAILED).result());
    }

    @Test
    @DisplayName("gateway unreachable is a retryable fetch error")
    void cashfreeFetchError() {
        when(paymentLogService.matchWebhookOrder("order_123", "CASHFREE")).thenReturn(match("inst-owner", 499.0));
        when(cashfree.fetchOrder(eq("order_123"), any())).thenThrow(new VacademyException("timeout"));

        PaymentWebhookVerifier.Outcome outcome = verifier.verifyCashfree("order_123", PaymentStatusEnum.PAID);

        assertEquals(Result.FETCH_ERROR, outcome.result());
        assertTrue(outcome.retryable());
    }

    @Test
    @DisplayName("no exactly matching log: nothing is fetched, retryable")
    void noLogFound() {
        when(paymentLogService.matchWebhookOrder("%", "CASHFREE"))
                .thenReturn(new WebhookOrderMatch(List.of(), List.of(), Set.of(), Set.of(), null));

        PaymentWebhookVerifier.Outcome outcome = verifier.verifyCashfree("%", PaymentStatusEnum.PAID);

        assertEquals(Result.LOG_NOT_FOUND, outcome.result());
        verify(cashfree, never()).fetchOrder(anyString(), any());
    }

    @Test
    @DisplayName("logs of more than one institute (or none resolvable) are not verified")
    void instituteUnresolved() {
        Set<String> two = new LinkedHashSet<>(List.of("inst-a", "inst-b"));
        when(paymentLogService.matchWebhookOrder("o", "CASHFREE")).thenReturn(
                new WebhookOrderMatch(List.of("a", "b"), List.of(1.0, 1.0), two, Set.of(), List.of("a", "b")));
        assertEquals(Result.INSTITUTE_UNRESOLVED, verifier.verifyCashfree("o", PaymentStatusEnum.PAID).result());

        Set<String> none = new LinkedHashSet<>();
        none.add(null);
        when(paymentLogService.matchWebhookOrder("o", "CASHFREE")).thenReturn(
                new WebhookOrderMatch(List.of("a"), List.of(1.0), none, Set.of(), List.of("a")));
        assertEquals(Result.INSTITUTE_UNRESOLVED, verifier.verifyCashfree("o", PaymentStatusEnum.PAID).result());
    }

    @Test
    @DisplayName("multi-package: the parent's total or the sum of all logs counts as the order amount")
    void multiPackageAmount() {
        Set<String> institutes = new LinkedHashSet<>(List.of("inst-owner"));
        WebhookOrderMatch parentHoldsTotal = new WebhookOrderMatch(List.of("parent", "child"),
                List.of(900.0, 400.0), institutes, Set.of("child"), List.of("parent", "child"));
        assertTrue(PaymentWebhookVerifier.amountMatches(new BigDecimal("900.00"), parentHoldsTotal));
        assertFalse(PaymentWebhookVerifier.amountMatches(new BigDecimal("400.00"), parentHoldsTotal));

        WebhookOrderMatch lines = new WebhookOrderMatch(List.of("a", "b"),
                List.of(500.0, 400.0), institutes, Set.of(), List.of("a", "b"));
        assertTrue(PaymentWebhookVerifier.amountMatches(new BigDecimal("900"), lines));
        assertFalse(PaymentWebhookVerifier.amountMatches(null, lines));
    }

    // ── PhonePe ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("PhonePe: COMPLETED with the amount in paise is ok; PENDING is a mismatch; FAILED confirms a failure")
    void phonePeStates() {
        when(paymentLogService.matchWebhookOrder("MP1", "PHONEPE")).thenReturn(match("inst-owner", 499.0));

        when(phonePe.checkPaymentStatusWithTimeouts(eq("MP1"), any())).thenReturn(
                PhonePeStatusResponseDTO.builder().state("COMPLETED").amount(49900L).orderId("OMO1").build());
        assertEquals(Result.OK, verifier.verifyPhonePe("MP1", PaymentStatusEnum.PAID).result());

        when(phonePe.checkPaymentStatusWithTimeouts(eq("MP1"), any())).thenReturn(
                PhonePeStatusResponseDTO.builder().state("PENDING").amount(49900L).orderId("OMO1").build());
        assertEquals(Result.STATUS_MISMATCH, verifier.verifyPhonePe("MP1", PaymentStatusEnum.PAID).result());

        when(phonePe.checkPaymentStatusWithTimeouts(eq("MP1"), any())).thenReturn(
                PhonePeStatusResponseDTO.builder().state("FAILED").amount(49900L).orderId("OMO1").build());
        assertEquals(Result.OK, verifier.verifyPhonePe("MP1", PaymentStatusEnum.FAILED).result());
        assertEquals(Result.STATUS_MISMATCH, verifier.verifyPhonePe("MP1", PaymentStatusEnum.PAID).result());

        when(phonePe.checkPaymentStatusWithTimeouts(eq("MP1"), any())).thenReturn(
                PhonePeStatusResponseDTO.builder().state("COMPLETED").amount(100L).orderId("OMO1").build());
        assertEquals(Result.AMOUNT_MISMATCH, verifier.verifyPhonePe("MP1", PaymentStatusEnum.PAID).result());
    }

    @Test
    @DisplayName("PhonePe: the status call's own error (bare FAILED) is a retryable fetch error")
    void phonePeLocalFailure() {
        when(paymentLogService.matchWebhookOrder("MP1", "PHONEPE")).thenReturn(match("inst-owner", 499.0));
        when(phonePe.checkPaymentStatusWithTimeouts(eq("MP1"), any())).thenReturn(
                PhonePeStatusResponseDTO.builder().state("FAILED").merchantOrderId("MP1").build());

        PaymentWebhookVerifier.Outcome outcome = verifier.verifyPhonePe("MP1", PaymentStatusEnum.PAID);

        assertEquals(Result.FETCH_ERROR, outcome.result());
        assertTrue(outcome.retryable());
        verify(gatewayService).findInstitutePaymentGatewaySpecifData("PHONEPE", "inst-owner");
    }
}
