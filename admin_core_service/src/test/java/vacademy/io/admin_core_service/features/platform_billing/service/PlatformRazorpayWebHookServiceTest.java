package vacademy.io.admin_core_service.features.platform_billing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.payments.service.WebHookService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentStatus;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService.FulfilResult;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler.CaptureOutcome;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The platform webhook's money rules: grant before PAID with retry (F1), the row lock path,
 * amount checks against the server-side total (#10), duplicate / late dispositions with a single
 * guarded auto-refund (#7), cumulative refunds (F10), the AI_SUBSCRIPTION / token extension
 * point (F11), and the credit-pack happy path staying exactly as before.
 */
class PlatformRazorpayWebHookServiceTest {

    private static final String SECRET = "whsec_test";
    private static final String INST = "inst-1";
    private static final ObjectMapper M = new ObjectMapper();

    private final Map<String, PlatformPayment> rows = new HashMap<>();
    private final Map<String, List<PlatformPaymentItem>> itemsByPayment = new HashMap<>();
    /** Status of each row at the moment the credit grant ran (proves grant-before-PAID). */
    private final List<PlatformPaymentResult> statusAtGrant = new ArrayList<>();

    private WebHookService webHookService;
    private PlatformPaymentConfigService configService;
    private PlatformPaymentRepository paymentRepository;
    private PlatformPaymentItemRepository itemRepository;
    private PlatformInvoiceService invoiceService;
    private PlatformInvoicePdfService pdfService;
    private CreditClient creditClient;
    private InstituteRepository instituteRepository;
    private PaymentNotificatonService notificationService;
    private RazorpayPaymentManager razorpay;
    private SubscriptionPaymentHandler handler;
    private ObjectProvider<SubscriptionPaymentHandler> handlerProvider;
    private PlatformRazorpayWebHookService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        webHookService = mock(WebHookService.class);
        when(webHookService.saveWebhook(anyString(), anyString(), any())).thenReturn("wh-1");
        configService = mock(PlatformPaymentConfigService.class);
        when(configService.getWebhookSecret()).thenReturn(SECRET);
        when(configService.getRazorpayCredsMap()).thenReturn(Map.of("apiKey", "k", "keySecret", "s"));
        paymentRepository = mock(PlatformPaymentRepository.class);
        itemRepository = mock(PlatformPaymentItemRepository.class);
        invoiceService = mock(PlatformInvoiceService.class);
        pdfService = mock(PlatformInvoicePdfService.class);
        creditClient = mock(CreditClient.class);
        instituteRepository = mock(InstituteRepository.class);
        notificationService = mock(PaymentNotificatonService.class);
        razorpay = mock(RazorpayPaymentManager.class);
        handler = mock(SubscriptionPaymentHandler.class);
        handlerProvider = mock(ObjectProvider.class);
        when(handlerProvider.getIfAvailable()).thenReturn(null);

        // In-memory platform_payment table.
        when(paymentRepository.findById(anyString())).thenAnswer(i -> Optional.ofNullable(rows.get(i.<String>getArgument(0))));
        when(paymentRepository.findByIdForUpdate(anyString())).thenAnswer(i -> Optional.ofNullable(rows.get(i.<String>getArgument(0))));
        when(paymentRepository.findByVendorPaymentId(anyString())).thenAnswer(i -> rows.values().stream()
                .filter(p -> i.getArgument(0).equals(p.getVendorPaymentId())).findFirst());
        when(paymentRepository.findByVendorPaymentIdForUpdate(anyString())).thenAnswer(i -> rows.values().stream()
                .filter(p -> i.getArgument(0).equals(p.getVendorPaymentId())).findFirst());
        when(paymentRepository.findByVendorOrderId(anyString())).thenAnswer(i -> rows.values().stream()
                .filter(p -> i.getArgument(0).equals(p.getVendorOrderId())).findFirst());
        when(paymentRepository.save(any())).thenAnswer(i -> store(i.getArgument(0)));
        when(paymentRepository.saveAndFlush(any())).thenAnswer(i -> store(i.getArgument(0)));
        when(itemRepository.findByPlatformPaymentId(anyString()))
                .thenAnswer(i -> itemsByPayment.getOrDefault(i.<String>getArgument(0), List.of()));

        when(creditClient.grantFromPayment(anyString(), any(), anyString(), anyString(), any())).thenAnswer(i -> {
            statusAtGrant.add(rows.get(i.<String>getArgument(3)).getPaymentStatus());
            return Map.of("success", true);
        });
        when(creditClient.refundFromPayment(anyString(), any(), anyString(), anyString(), any()))
                .thenReturn(Map.of("success", true));

        PlatformInvoice invoice = new PlatformInvoice();
        invoice.setInvoiceNumber("INV-AICRED-202610-0001");
        when(invoiceService.generateInvoice(anyString())).thenReturn(invoice);
        Institute inst = new Institute();
        inst.setId(INST);
        inst.setEmail("billing@inst.test");
        when(instituteRepository.findById(INST)).thenReturn(Optional.of(inst));

        service = new PlatformRazorpayWebHookService(webHookService, configService, paymentRepository,
                itemRepository, invoiceService, pdfService, creditClient, instituteRepository,
                notificationService, razorpay, handlerProvider, mock(PlatformTransactionManager.class));
    }

    private PlatformPayment store(PlatformPayment p) {
        if (p.getId() == null) p.setId(UUID.randomUUID().toString());
        rows.put(p.getId(), p);
        return p;
    }

    private PlatformPayment packOrder(String id, long total) {
        PlatformPayment p = new PlatformPayment();
        p.setId(id);
        p.setInstituteId(INST);
        p.setVendor("RAZORPAY");
        p.setVendorOrderId("plink_" + id);
        p.setCurrency("INR");
        p.setBaseAmountMinor(total * 100 / 118);
        p.setTaxAmountMinor(total - total * 100 / 118);
        p.setTotalAmountMinor(total);
        p.setStatus(PlatformPaymentStatus.INITIATED);
        p.setPaymentStatus(PlatformPaymentResult.PAYMENT_PENDING);
        rows.put(id, p);
        PlatformPaymentItem item = new PlatformPaymentItem();
        item.setPlatformPaymentId(id);
        item.setPackId("pack-1");
        item.setPackCodeSnapshot("PACK_500");
        item.setCredits(new BigDecimal("500"));
        item.setItemKind(PlatformPaymentItemKind.CREDIT_PACK);
        itemsByPayment.put(id, List.of(item));
        return p;
    }

    private PlatformPayment subscriptionOrder(String id, long total) {
        PlatformPayment p = packOrder(id, total);
        PlatformPaymentItem item = new PlatformPaymentItem();
        item.setPlatformPaymentId(id);
        item.setPackCodeSnapshot("AI_SUB:pro");
        item.setCredits(BigDecimal.ZERO);
        item.setItemKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
        item.setSubscriptionChargeId("charge-1");
        itemsByPayment.put(id, List.of(item));
        return p;
    }

    private static String sign(String payload) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        StringBuilder hex = new StringBuilder();
        for (byte b : mac.doFinal(payload.getBytes(StandardCharsets.UTF_8))) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    private static String paymentEvent(String event, String orderId, String payId, long amount, String type) {
        String notes = orderId == null ? "{}" : "{\"orderId\":\"" + orderId + "\",\"instituteId\":\"" + INST
                + "\",\"payment_type\":\"" + type + "\"}";
        return "{\"event\":\"" + event + "\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"" + payId
                + "\",\"amount\":" + amount + ",\"currency\":\"INR\",\"status\":\"captured\",\"order_id\":\"order_X\","
                + "\"notes\":" + notes + "}}}}";
    }

    private static String refundEvent(String event, String payId, String refundId, long amount, Long cumulative) {
        String payment = cumulative == null ? "" : ",\"payment\":{\"entity\":{\"id\":\"" + payId
                + "\",\"amount_refunded\":" + cumulative + ",\"notes\":{\"payment_type\":\"AI_CREDIT_PACK\"}}}";
        return "{\"event\":\"" + event + "\",\"payload\":{\"refund\":{\"entity\":{\"id\":\"" + refundId
                + "\",\"payment_id\":\"" + payId + "\",\"amount\":" + amount + "}}" + payment + "}}";
    }

    private ResponseEntity<String> deliver(String payload) throws Exception {
        return service.handleWebhook(payload, sign(payload));
    }

    // ── credit packs: happy path unchanged, F1 order ───────────────────

    @Test
    void packCaptureGrantsFirstThenMarksPaidThenInvoicesAndEmails() throws Exception {
        packOrder("pp-1", 59000);

        ResponseEntity<String> r = deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 59000, "AI_CREDIT_PACK"));

        assertEquals(200, r.getStatusCode().value());
        PlatformPayment p = rows.get("pp-1");
        assertEquals(PlatformPaymentResult.PAID, p.getPaymentStatus());
        assertEquals(PlatformPaymentStatus.SUCCESS, p.getStatus());
        assertEquals("pay_1", p.getVendorPaymentId());
        assertEquals(PlatformPaymentDisposition.NORMAL, p.getDisposition());
        assertEquals(List.of(PlatformPaymentResult.PAYMENT_PENDING), statusAtGrant, "grant ran before PAID");
        verify(creditClient).grantFromPayment(INST, new BigDecimal("500"), "pay_1", "pp-1", "PACK_500");
        InOrder order = inOrder(creditClient, invoiceService, notificationService);
        order.verify(creditClient).grantFromPayment(any(), any(), any(), any(), any());
        order.verify(invoiceService).generateInvoice("pp-1");
        order.verify(notificationService).sendCreditPackConfirmation(eq(INST), eq("billing@inst.test"), any(),
                eq("INV-AICRED-202610-0001"), eq("500"), eq("₹590.00"), eq("PACK_500"), any(), any());
        verify(razorpay, never()).refundPayment(anyString(), any(), any(), any(), any());
    }

    @Test
    void orderPaidAfterCaptureIsANoOp() throws Exception {
        packOrder("pp-1", 59000);
        deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 59000, "AI_CREDIT_PACK"));
        deliver(paymentEvent("order.paid", "pp-1", "pay_1", 59000, "AI_CREDIT_PACK"));

        verify(creditClient, times(1)).grantFromPayment(any(), any(), any(), any(), any());
        verify(invoiceService, times(1)).generateInvoice(any());
        verify(notificationService, times(1)).sendCreditPackConfirmation(any(), any(), any(), any(), any(), any(),
                any(), any(), any());
    }

    @Test
    void failedGrantLeavesThePaymentUnpaidAndReturns500SoRazorpayRetries() throws Exception {
        packOrder("pp-1", 59000);
        // doX().when() form: re-stubbing with when() would invoke the setUp answer with null args.
        org.mockito.Mockito.doThrow(new CreditClient.PaymentGrantException("ai_service down", null))
                .doReturn(Map.of("success", true))
                .when(creditClient).grantFromPayment(anyString(), any(), anyString(), anyString(), any());
        String event = paymentEvent("payment.captured", "pp-1", "pay_1", 59000, "AI_CREDIT_PACK");

        assertEquals(500, deliver(event).getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, rows.get("pp-1").getPaymentStatus());
        assertNull(rows.get("pp-1").getVendorPaymentId());
        verify(invoiceService, never()).generateInvoice(any());

        // Razorpay's retry succeeds.
        assertEquals(200, deliver(event).getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAID, rows.get("pp-1").getPaymentStatus());
        verify(invoiceService).generateInvoice("pp-1");
    }

    @Test
    void amountBelowTheSnapshotGrantsNothingAndDoesNotLoop() throws Exception {
        packOrder("pp-1", 59000);

        ResponseEntity<String> r = deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 100, "AI_CREDIT_PACK"));

        assertEquals(200, r.getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, rows.get("pp-1").getPaymentStatus());
        assertTrue(rows.get("pp-1").getPaymentSpecificData().contains("amountMismatch"));
        verifyNoInteractions(creditClient);
    }

    @Test
    void failureEventNeverDowngradesAPaidPayment() throws Exception {
        packOrder("pp-1", 59000);
        deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 59000, "AI_CREDIT_PACK"));
        deliver(paymentEvent("payment.failed", "pp-1", "pay_2", 59000, "AI_CREDIT_PACK"));
        assertEquals(PlatformPaymentResult.PAID, rows.get("pp-1").getPaymentStatus());

        packOrder("pp-2", 59000);
        deliver(paymentEvent("payment.failed", "pp-2", "pay_3", 59000, "AI_CREDIT_PACK"));
        assertEquals(PlatformPaymentResult.FAILED, rows.get("pp-2").getPaymentStatus());
    }

    // ── duplicates (critique #7) ──────────────────────────────────────

    @Test
    void secondPaymentForAPaidOrderIsRecordedAsDuplicateAndRefundedOnce() throws Exception {
        packOrder("pp-1", 59000);
        deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 59000, "AI_CREDIT_PACK"));
        when(razorpay.fetchPayment(eq("pay_2"), any())).thenReturn(Map.of("amount", 59000, "amount_refunded", 0));

        String dup = paymentEvent("payment.captured", "pp-1", "pay_2", 59000, "AI_CREDIT_PACK");
        assertEquals(200, deliver(dup).getStatusCode().value());
        assertEquals(200, deliver(paymentEvent("order.paid", "pp-1", "pay_2", 59000, "AI_CREDIT_PACK"))
                .getStatusCode().value());

        PlatformPayment stray = rows.values().stream().filter(p -> "pay_2".equals(p.getVendorPaymentId()))
                .findFirst().orElseThrow();
        assertNotEquals("pp-1", stray.getId());
        assertEquals(PlatformPaymentDisposition.DUPLICATE, stray.getDisposition());
        assertNotNull(stray.getRefundRequestedAt());
        assertEquals("pay_1", rows.get("pp-1").getVendorPaymentId(), "original payment untouched");
        verify(creditClient, times(1)).grantFromPayment(any(), any(), any(), any(), any());
        verify(razorpay, times(1)).refundPayment(eq("pay_2"), eq(59000L), eq("ar-" + stray.getId()), any(), any());
        verify(invoiceService, times(1)).generateInvoice("pp-1");
    }

    @Test
    void failedAutoRefundIsAlertedNeverThrownAndNeverRetriedAutomatically() {
        PlatformPayment p = packOrder("pp-9", 1000);
        p.setDisposition(PlatformPaymentDisposition.DUPLICATE);
        p.setVendorPaymentId("pay_9");
        when(razorpay.fetchPayment(eq("pay_9"), any())).thenReturn(Map.of("amount", 1000, "amount_refunded", 0));
        when(razorpay.refundPayment(anyString(), any(), any(), any(), any())).thenThrow(new VacademyException("boom"));

        assertFalse(service.autoRefund("pp-9", "TEST"));
        assertNotNull(rows.get("pp-9").getRefundRequestedAt());
        assertFalse(service.autoRefund("pp-9", "TEST"), "guard stops a second attempt");
        verify(razorpay, times(1)).refundPayment(anyString(), any(), any(), any(), any());
    }

    @Test
    void autoRefundSkipsWhenRazorpayAlreadyRefundedAndRefusesNormalPayments() {
        PlatformPayment dup = packOrder("pp-8", 1000);
        dup.setDisposition(PlatformPaymentDisposition.LATE);
        dup.setVendorPaymentId("pay_8");
        when(razorpay.fetchPayment(eq("pay_8"), any())).thenReturn(Map.of("amount", 1000, "amount_refunded", 1000));
        assertFalse(service.autoRefund("pp-8", "TEST"));

        PlatformPayment normal = packOrder("pp-7", 1000);
        normal.setVendorPaymentId("pay_7");
        assertFalse(service.autoRefund("pp-7", "TEST"));
        assertNull(rows.get("pp-7").getRefundRequestedAt());
        verify(razorpay, never()).refundPayment(anyString(), any(), any(), any(), any());
    }

    // ── refunds (F10, #7) ─────────────────────────────────────────────

    @Test
    void partialRefundsAreCumulativeAndEachRefundReversesCreditsOnce() throws Exception {
        packOrder("pp-1", 10000);
        deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 10000, "AI_CREDIT_PACK"));

        deliver(refundEvent("refund.created", "pay_1", "rfnd_a", 3000, null));
        assertEquals(PlatformPaymentResult.PARTIALLY_REFUNDED, rows.get("pp-1").getPaymentStatus());
        deliver(refundEvent("refund.processed", "pay_1", "rfnd_a", 3000, 3000L));
        assertEquals(3000L, rows.get("pp-1").getRefundedAmountMinor());

        deliver(refundEvent("refund.processed", "pay_1", "rfnd_b", 7000, 10000L));
        assertEquals(PlatformPaymentResult.REFUNDED, rows.get("pp-1").getPaymentStatus());
        assertEquals(10000L, rows.get("pp-1").getRefundedAmountMinor());

        verify(creditClient, times(1)).refundFromPayment(INST, new BigDecimal("150.00"), "rfnd_a", "pp-1", "PACK_500");
        verify(creditClient, times(1)).refundFromPayment(INST, new BigDecimal("350.00"), "rfnd_b", "pp-1", "PACK_500");
    }

    @Test
    void fullRefundStillMarksRefundedAsBefore() throws Exception {
        packOrder("pp-1", 59000);
        deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 59000, "AI_CREDIT_PACK"));
        deliver(refundEvent("refund.processed", "pay_1", "rfnd_1", 59000, null));
        assertEquals(PlatformPaymentResult.REFUNDED, rows.get("pp-1").getPaymentStatus());
        verify(creditClient).refundFromPayment(INST, new BigDecimal("500.00"), "rfnd_1", "pp-1", "PACK_500");
    }

    @Test
    void refundOfADuplicateNeverTouchesCreditsOrTheHandler() throws Exception {
        PlatformPayment dup = subscriptionOrder("pp-d", 5000);
        dup.setDisposition(PlatformPaymentDisposition.DUPLICATE);
        dup.setVendorPaymentId("pay_d");
        dup.setPaymentStatus(PlatformPaymentResult.PAID);
        when(handlerProvider.getIfAvailable()).thenReturn(handler);

        assertEquals(200, deliver(refundEvent("refund.processed", "pay_d", "rfnd_d", 5000, null)).getStatusCode().value());

        assertEquals(PlatformPaymentResult.REFUNDED, rows.get("pp-d").getPaymentStatus());
        verify(creditClient, never()).refundFromPayment(any(), any(), any(), any(), any());
        verify(handler, never()).onRefund(any(), any(), any());
    }

    @Test
    void aFailingCreditReversalIsAckedAndRetriedByTheNextEventForTheSameRefund() throws Exception {
        packOrder("pp-1", 10000);
        deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 10000, "AI_CREDIT_PACK"));
        when(creditClient.refundFromPayment(any(), any(), any(), any(), any()))
                .thenReturn(Map.of("success", false))
                .thenReturn(Map.of("success", true));

        assertEquals(200, deliver(refundEvent("refund.created", "pay_1", "rfnd_a", 10000, null)).getStatusCode().value());
        assertEquals(200, deliver(refundEvent("refund.processed", "pay_1", "rfnd_a", 10000, null)).getStatusCode().value());
        assertEquals(200, deliver(refundEvent("refund.processed", "pay_1", "rfnd_a", 10000, null)).getStatusCode().value());
        verify(creditClient, times(2)).refundFromPayment(any(), any(), eq("rfnd_a"), any(), any());
    }

    @Test
    void anExplodingRefundPathStillAnswers200() throws Exception {
        packOrder("pp-1", 10000);
        deliver(paymentEvent("payment.captured", "pp-1", "pay_1", 10000, "AI_CREDIT_PACK"));
        when(creditClient.refundFromPayment(any(), any(), any(), any(), any())).thenThrow(new RuntimeException("x"));
        assertEquals(200, deliver(refundEvent("refund.processed", "pay_1", "rfnd_a", 10000, null)).getStatusCode().value());
    }

    // ── AI_SUBSCRIPTION extension point (F11) ─────────────────────────

    @Test
    void subscriptionPaymentGoesToTheHandlerNotTheCreditGrant() throws Exception {
        subscriptionOrder("pp-s", 118000);
        when(handlerProvider.getIfAvailable()).thenReturn(handler);
        when(handler.onPaymentCaptured(any(), any(), any())).thenAnswer(i -> {
            assertEquals(PlatformPaymentResult.PAYMENT_PENDING, i.<PlatformPayment>getArgument(0).getPaymentStatus());
            return CaptureOutcome.FULFILLED;
        });

        assertEquals(200, deliver(paymentEvent("payment.captured", "pp-s", "pay_s", 118000, "AI_SUBSCRIPTION"))
                .getStatusCode().value());

        assertEquals(PlatformPaymentResult.PAID, rows.get("pp-s").getPaymentStatus());
        ArgumentCaptor<SubscriptionPaymentHandler.CapturedPayment> cap =
                ArgumentCaptor.forClass(SubscriptionPaymentHandler.CapturedPayment.class);
        verify(handler).onPaymentCaptured(any(), any(), cap.capture());
        assertEquals("pay_s", cap.getValue().vendorPaymentId());
        assertEquals(118000L, cap.getValue().amountMinor());
        verify(handler).afterPaid(any(), any());
        verifyNoInteractions(creditClient);
        verify(invoiceService, never()).generateInvoice(any());
    }

    @Test
    void subscriptionPaymentWithoutAHandlerIsRetriedNotMarkedPaid() throws Exception {
        subscriptionOrder("pp-s", 118000);
        assertEquals(500, deliver(paymentEvent("payment.captured", "pp-s", "pay_s", 118000, "AI_SUBSCRIPTION"))
                .getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, rows.get("pp-s").getPaymentStatus());
    }

    @Test
    void handlerLateOutcomeKeepsTheRowRecordsLateAndRefundsWithoutInvoice() throws Exception {
        subscriptionOrder("pp-s", 118000);
        when(handlerProvider.getIfAvailable()).thenReturn(handler);
        when(handler.onPaymentCaptured(any(), any(), any())).thenReturn(CaptureOutcome.LATE);
        when(razorpay.fetchPayment(eq("pay_s"), any())).thenReturn(Map.of("amount", 118000, "amount_refunded", 0));

        assertEquals(200, deliver(paymentEvent("payment.captured", "pp-s", "pay_s", 118000, "AI_SUBSCRIPTION"))
                .getStatusCode().value());

        PlatformPayment p = rows.get("pp-s");
        assertEquals(PlatformPaymentDisposition.LATE, p.getDisposition());
        assertEquals(PlatformPaymentResult.PAID, p.getPaymentStatus());
        assertNotNull(p.getRefundRequestedAt());
        verify(razorpay).refundPayment(eq("pay_s"), eq(118000L), any(), any(), any());
        verify(handler, never()).afterPaid(any(), any());
    }

    @Test
    void handlerHeldOutcomeAcksWithoutMarkingPaidOrRefunding() throws Exception {
        subscriptionOrder("pp-s", 118000);
        when(handlerProvider.getIfAvailable()).thenReturn(handler);
        when(handler.onPaymentCaptured(any(), any(), any())).thenReturn(CaptureOutcome.HELD);

        assertEquals(200, deliver(paymentEvent("payment.captured", "pp-s", "pay_s", 118000, "AI_SUBSCRIPTION"))
                .getStatusCode().value());

        PlatformPayment p = rows.get("pp-s");
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, p.getPaymentStatus());
        assertEquals(PlatformPaymentDisposition.NORMAL, p.getDisposition());
        assertNull(p.getRefundRequestedAt());
        verify(razorpay, never()).refundPayment(any(), anyLong(), any(), any(), any());
        verify(handler, never()).afterPaid(any(), any());
    }

    @Test
    void handlerExceptionReturns500AndWritesNothing() throws Exception {
        subscriptionOrder("pp-s", 118000);
        when(handlerProvider.getIfAvailable()).thenReturn(handler);
        when(handler.onPaymentCaptured(any(), any(), any())).thenThrow(new VacademyException("ai_service 503"));
        assertEquals(500, deliver(paymentEvent("payment.captured", "pp-s", "pay_s", 118000, "AI_SUBSCRIPTION"))
                .getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, rows.get("pp-s").getPaymentStatus());
    }

    @Test
    void subscriptionRefundGoesToTheHandlerWithTheCumulativeTotal() throws Exception {
        PlatformPayment p = subscriptionOrder("pp-s", 10000);
        p.setVendorPaymentId("pay_s");
        p.setPaymentStatus(PlatformPaymentResult.PAID);
        when(handlerProvider.getIfAvailable()).thenReturn(handler);

        deliver(refundEvent("refund.processed", "pay_s", "rfnd_1", 4000, 4000L));

        ArgumentCaptor<SubscriptionPaymentHandler.RefundEvent> ev =
                ArgumentCaptor.forClass(SubscriptionPaymentHandler.RefundEvent.class);
        verify(handler).onRefund(any(), any(), ev.capture());
        assertEquals("rfnd_1", ev.getValue().vendorRefundId());
        assertEquals(4000L, ev.getValue().cumulativeRefundedMinor());
        assertFalse(ev.getValue().fullyRefunded());
        verifyNoInteractions(creditClient);
    }

    @Test
    void tokenEventsReachTheHandler() throws Exception {
        when(handlerProvider.getIfAvailable()).thenReturn(handler);
        String payload = "{\"event\":\"token.confirmed\",\"contains\":[\"token\"],\"payload\":{\"token\":{\"entity\":"
                + "{\"id\":\"token_1\",\"recurring_details\":{\"status\":\"confirmed\"}}}}}";

        assertEquals(200, deliver(payload).getStatusCode().value());

        ArgumentCaptor<JsonNode> token = ArgumentCaptor.forClass(JsonNode.class);
        verify(handler).onTokenEvent(eq("token.confirmed"), token.capture(), any());
        assertEquals("token_1", token.getValue().get("id").asText());
    }

    @Test
    void foreignPaymentTypesAreStillSkipped() throws Exception {
        packOrder("pp-1", 59000);
        String payload = paymentEvent("payment.captured", "pp-1", "pay_1", 59000, "INITIAL");
        assertEquals("Skipped", service.handleWebhook(payload, "bad-signature").getBody());
        verifyNoInteractions(creditClient);
    }

    @Test
    void registrationLinkPaymentWithoutNotesIsFoundByItsOrderId() throws Exception {
        PlatformPayment p = subscriptionOrder("pp-r", 100);
        p.setVendorOrderId("order_X");
        when(handlerProvider.getIfAvailable()).thenReturn(handler);
        when(handler.onPaymentCaptured(any(), any(), any())).thenReturn(CaptureOutcome.FULFILLED);

        assertEquals(200, deliver(paymentEvent("payment.captured", null, "pay_r", 100, null)).getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAID, rows.get("pp-r").getPaymentStatus());
    }

    // ── manual fulfil (critique B) ────────────────────────────────────

    @Test
    void manualFulfilVerifiesThePaymentWithRazorpay() {
        packOrder("pp-1", 59000);
        when(razorpay.fetchPayment(eq("pay_wrong"), any())).thenReturn(Map.of(
                "id", "pay_wrong", "status", "captured", "amount", 59000, "currency", "INR",
                "notes", Map.of("orderId", "someone-else")));
        when(razorpay.fetchPayment(eq("pay_auth"), any())).thenReturn(Map.of(
                "id", "pay_auth", "status", "authorized", "amount", 59000, "currency", "INR",
                "notes", Map.of("orderId", "pp-1")));
        when(razorpay.fetchPayment(eq("pay_1"), any())).thenReturn(Map.of(
                "id", "pay_1", "status", "captured", "amount", 59000, "currency", "INR",
                "notes", Map.of("orderId", "pp-1")));

        assertThrows(VacademyException.class, () -> service.fulfillCreditPackPayment("pp-1", "pay_wrong"));
        assertThrows(VacademyException.class, () -> service.fulfillCreditPackPayment("pp-1", "pay_auth"));
        verifyNoInteractions(creditClient);

        assertEquals(FulfilResult.FULFILLED, service.fulfillCreditPackPayment("pp-1", "pay_1"));
        assertEquals(PlatformPaymentResult.PAID, rows.get("pp-1").getPaymentStatus());
        assertEquals(FulfilResult.ALREADY_FULFILLED, service.fulfillCreditPackPayment("pp-1", "pay_1"));
    }

    // ── reconcile (F7) ────────────────────────────────────────────────

    @Test
    void reconcileExpiresAnUnpaidExpiredLinkAndFulfilsAPaidOne() {
        packOrder("pp-e", 1000);
        when(razorpay.fetchPaymentLink(eq("plink_pp-e"), any())).thenReturn(Map.of("status", "expired", "payments", List.of()));
        assertEquals("expired", service.reconcileFromLink("pp-e"));
        assertEquals(PlatformPaymentResult.EXPIRED, rows.get("pp-e").getPaymentStatus());
        assertEquals(PlatformPaymentStatus.EXPIRED, rows.get("pp-e").getStatus());

        packOrder("pp-p", 1000);
        when(razorpay.fetchPaymentLink(eq("plink_pp-p"), any())).thenReturn(Map.of("status", "paid",
                "payments", List.of(Map.of("paymentId", "pay_p", "status", "captured", "amount", 1000L))));
        when(razorpay.fetchPayment(eq("pay_p"), any())).thenReturn(Map.of(
                "id", "pay_p", "status", "captured", "amount", 1000, "currency", "INR",
                "notes", Map.of("orderId", "pp-p")));
        assertEquals("paid", service.reconcileFromLink("pp-p"));
        assertEquals(PlatformPaymentResult.PAID, rows.get("pp-p").getPaymentStatus());
    }

    @Test
    void capturedPaymentParsing() throws Exception {
        JsonNode e = M.readTree("{\"id\":\"pay_1\",\"amount\":500,\"currency\":\"INR\",\"method\":\"upi\","
                + "\"order_id\":\"order_1\",\"invoice_id\":\"inv_1\",\"token_id\":\"token_1\","
                + "\"customer_id\":\"cust_1\",\"created_at\":1760000000}");
        SubscriptionPaymentHandler.CapturedPayment c = PlatformRazorpayWebHookService.toCaptured(e);
        assertEquals("pay_1", c.vendorPaymentId());
        assertEquals(500L, c.amountMinor());
        assertEquals("token_1", c.tokenId());
        assertEquals("cust_1", c.customerId());
        assertEquals("inv_1", c.razorpayInvoiceId());
        assertEquals(1760000000L, c.capturedAtEpochSeconds());
        assertEquals(-1L, PlatformRazorpayWebHookService.toCaptured(M.readTree("{\"id\":\"x\"}")).amountMinor());
        assertNotNull(Instant.now());
    }
}
