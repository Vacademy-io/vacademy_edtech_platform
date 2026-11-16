package vacademy.io.admin_core_service.features.commerce.order.payment;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService.Outcome;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService.Result;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGuard.WebhookMatch;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The webhook branch decides from rows; the notes of a payment can only get it refused. */
class CommerceWebhookBranchTest {

    private final ObjectMapper json = new ObjectMapper();
    private CommercePaymentGuard guard;
    private CommerceGatewayOrderRepository gatewayOrders;
    private CommercePaymentConfirmService confirmService;
    private CommerceWebhookBranch branch;
    private CommerceGatewayOrder row;

    @BeforeEach
    void setUp() {
        guard = mock(CommercePaymentGuard.class);
        gatewayOrders = mock(CommerceGatewayOrderRepository.class);
        confirmService = mock(CommercePaymentConfirmService.class);
        branch = new CommerceWebhookBranch(guard, gatewayOrders, confirmService);

        row = new CommerceGatewayOrder();
        row.setId("row-1");
        row.setInstituteId("inst-1");
        row.setCommerceOrderId("order-1");
        row.setVendor("RAZORPAY");
        row.setGatewayOrderId("order_rzp1");
        row.setAmountMinor(49900L);
        row.setCurrency("INR");
        when(gatewayOrders.findById("row-1")).thenReturn(Optional.of(row));
        when(guard.webhookMatch(anyString(), any(), any())).thenReturn(WebhookMatch.NONE);
    }

    private JsonNode payment(String gatewayOrderId, long amount, String notesOrderId) throws Exception {
        return json.readTree("{\"id\":\"pay_1\",\"order_id\":\"" + gatewayOrderId + "\",\"amount\":" + amount
                + ",\"currency\":\"INR\",\"notes\":{\"orderId\":\"" + notesOrderId + "\"}}");
    }

    @Test
    void aCoursePaymentIsOneReadAndNotCommerce() throws Exception {
        Result result = branch.handle("payment.captured", payment("order_rzp9", 10000, "log-course"), "inst-1");

        assertSame(Result.NOT_COMMERCE, result);
        assertFalse(result.commerce());
        verify(guard).webhookMatch("RAZORPAY", "order_rzp9", "log-course");
        verifyNoInteractions(confirmService, gatewayOrders);
    }

    @Test
    void aCaptureOnOurGatewayOrderIsConfirmedWithTheAmountOfThePayment() throws Exception {
        when(guard.webhookMatch("RAZORPAY", "order_rzp1", "order-1")).thenReturn(new WebhookMatch("row-1", "order-1"));
        when(confirmService.confirmPaid(any(), any(), any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.HANDLED, "order-1", null, 1));

        Result result = branch.handle("payment.captured", payment("order_rzp1", 49900, "order-1"), "inst-1");

        assertTrue(result.commerce());
        verify(confirmService).confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");
    }

    @Test
    void theNotesAreNotNeeded() throws Exception {
        when(guard.webhookMatch(eq("RAZORPAY"), eq("order_rzp1"), isNull())).thenReturn(new WebhookMatch("row-1", null));
        when(confirmService.confirmPaid(any(), any(), any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.HANDLED, "order-1", null, 1));
        JsonNode noNotes = json.readTree(
                "{\"id\":\"pay_1\",\"order_id\":\"order_rzp1\",\"amount\":49900,\"currency\":\"INR\",\"notes\":[]}");

        branch.handle("order.paid", noNotes, "inst-1");

        verify(confirmService).confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");
    }

    /** Pay a cheap gateway order while naming an expensive shop order in the notes. */
    @Test
    void namingAShopOrderWhilePayingAnotherGatewayOrderIsRefused() throws Exception {
        when(guard.webhookMatch("RAZORPAY", "order_cheap", "order-1")).thenReturn(new WebhookMatch(null, "order-1"));
        when(confirmService.refuse(any(), any(), any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.REFUSED, "order-1", "GATEWAY_ORDER_MISMATCH", 0));

        Result result = branch.handle("payment.captured", payment("order_cheap", 100, "order-1"), "inst-1");

        assertTrue(result.refused());
        verify(confirmService).refuse(eq(CommercePaymentConfirmService.REASON_ORDER_MISMATCH), any(), eq("inst-1"),
                eq("pay_1"), eq("webhook"), anyString());
        verify(confirmService, never()).confirmPaid(any(), any(), any(), any(), any(), any());
        verify(confirmService, never()).markFailed(any(), any(), any(), any());
    }

    @Test
    void theGatewayOrderDecidesWhenTheNotesNameAnotherShopOrder() throws Exception {
        when(guard.webhookMatch("RAZORPAY", "order_rzp1", "order-2")).thenReturn(new WebhookMatch("row-1", "order-2"));
        when(confirmService.confirmPaid(any(), any(), any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.HANDLED, "order-1", null, 1));

        Result result = branch.handle("payment.captured", payment("order_rzp1", 49900, "order-2"), "inst-1");

        // order-1 is what was paid for; order-2 is only a name in a note.
        assertEquals("order-1", result.commerceOrderId());
        verify(confirmService).confirmPaid(row, "inst-1", 49900L, "INR", "pay_1", "webhook");
    }

    @Test
    void aFailedAttemptAndAnAuthorisationGoToTheirOwnSteps() throws Exception {
        when(guard.webhookMatch(anyString(), eq("order_rzp1"), any())).thenReturn(new WebhookMatch("row-1", null));
        when(confirmService.markFailed(any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.HANDLED, "order-1", null, 0));
        when(confirmService.markAuthorized(any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.HANDLED, "order-1", null, 0));

        branch.handle("payment.failed", payment("order_rzp1", 49900, "order-1"), "inst-1");
        branch.handle("payment.authorized", payment("order_rzp1", 49900, "order-1"), "inst-1");

        verify(confirmService).markFailed(row, "inst-1", "pay_1", "webhook");
        verify(confirmService).markAuthorized(row, "inst-1", "pay_1", "webhook");
        verify(confirmService, never()).confirmPaid(any(), any(), any(), any(), any(), any());
    }

    @Test
    void anOrderEntityIsReadByItsOwnIdAndAmountPaid() throws Exception {
        when(guard.webhookMatch(eq("RAZORPAY"), eq("order_rzp1"), isNull())).thenReturn(new WebhookMatch("row-1", null));
        when(confirmService.confirmPaid(any(), any(), any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.HANDLED, "order-1", null, 1));
        JsonNode order = json.readTree(
                "{\"id\":\"order_rzp1\",\"amount\":49900,\"amount_paid\":49900,\"currency\":\"INR\",\"status\":\"paid\"}");

        branch.handle("order.paid", order, "inst-1");

        verify(confirmService).confirmPaid(row, "inst-1", 49900L, "INR", null, "webhook");
    }

    @Test
    void aCaptureWithoutAnAmountCarriesANumberThatMatchesNoOrder() throws Exception {
        when(guard.webhookMatch(anyString(), eq("order_rzp1"), any())).thenReturn(new WebhookMatch("row-1", null));
        when(confirmService.confirmPaid(any(), any(), any(), any(), any(), any()))
                .thenReturn(new Result(Outcome.REFUSED, "order-1", "AMOUNT_MISMATCH", 0));
        JsonNode noAmount = json.readTree("{\"id\":\"pay_1\",\"order_id\":\"order_rzp1\",\"currency\":\"INR\"}");

        branch.handle("payment.captured", noAmount, "inst-1");

        verify(confirmService).confirmPaid(row, "inst-1", -1L, "INR", "pay_1", "webhook");
    }

    @Test
    void theInstituteOfAGatewayOrderIsReadFromItsRow() throws Exception {
        when(gatewayOrders.findByVendorAndGatewayOrderId("RAZORPAY", "order_rzp1")).thenReturn(Optional.of(row));
        when(gatewayOrders.findByVendorAndGatewayOrderId("RAZORPAY", "order_rzp9")).thenReturn(Optional.empty());

        assertEquals("inst-1", branch.instituteOfGatewayOrder(payment("order_rzp1", 1, "x")));
        assertNull(branch.instituteOfGatewayOrder(payment("order_rzp9", 1, "x")));
        assertNull(branch.instituteOfGatewayOrder(json.readTree("{\"id\":\"pay_1\"}")));
    }

    // -- refund events (WP-32) --

    @SuppressWarnings("unchecked")
    private vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundWebhookService refunds() {
        var service = org.mockito.Mockito.mock(
                vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundWebhookService.class);
        org.springframework.beans.factory.ObjectProvider<
                vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundWebhookService> provider =
                org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(service);
        branch.setRefundWebhook(provider);
        return service;
    }

    @Test
    void aRefundEventOfOurPaymentGoesToTheRefundServiceWithItsEntity() throws Exception {
        var refunds = refunds();
        when(guard.webhookMatch("RAZORPAY", "order_rzp1", "order-1")).thenReturn(new WebhookMatch("row-1", "order-1"));
        JsonNode refund = json.readTree("{\"id\":\"rfnd_1\",\"amount\":100}");

        Result processed = branch.handle("refund.processed", payment("order_rzp1", 49900, "order-1"), "inst-1", refund);
        Result failed = branch.handle("refund.failed", payment("order_rzp1", 49900, "order-1"), "inst-1", refund);

        assertEquals(Outcome.HANDLED, processed.outcome());
        assertEquals(Outcome.HANDLED, failed.outcome());
        verify(refunds).handle("refund.processed", refund, row, "inst-1");
        verify(refunds).handle("refund.failed", refund, row, "inst-1");
        verifyNoInteractions(confirmService);
    }

    @Test
    void refundCreatedNeedsNothingAndANullEntityIsHandledForThePoll() throws Exception {
        var refunds = refunds();
        when(guard.webhookMatch("RAZORPAY", "order_rzp1", "order-1")).thenReturn(new WebhookMatch("row-1", "order-1"));

        assertEquals(Outcome.HANDLED, branch.handle("refund.created", payment("order_rzp1", 49900, "order-1"),
                "inst-1", json.readTree("{}")).outcome());
        org.mockito.Mockito.verifyNoInteractions(refunds);
        assertEquals(Outcome.HANDLED, branch.handle("refund.processed", payment("order_rzp1", 49900, "order-1"),
                "inst-1", null).outcome());
        verify(refunds).handle("refund.processed", null, row, "inst-1");
    }

    @Test
    void aRefundEventVerifiedWithAnotherInstitutesSecretIsRefused() throws Exception {
        var refunds = refunds();
        when(guard.webhookMatch("RAZORPAY", "order_rzp1", "order-1")).thenReturn(new WebhookMatch("row-1", "order-1"));
        when(confirmService.refuse(eq(CommercePaymentConfirmService.REASON_INSTITUTE_MISMATCH), eq(row), eq("inst-2"),
                any(), any(), any())).thenReturn(new Result(Outcome.REFUSED, "order-1", "INSTITUTE_MISMATCH", 0));

        Result result = branch.handle("refund.processed", payment("order_rzp1", 49900, "order-1"), "inst-2",
                json.readTree("{\"id\":\"rfnd_1\"}"));

        assertTrue(result.refused());
        org.mockito.Mockito.verifyNoInteractions(refunds);
    }

    @Test
    void aRefundEventOfACoursePaymentIsNotCommerceAndItsRefundEntityIsNeverRead() throws Exception {
        var refunds = refunds();
        JsonNode refund = org.mockito.Mockito.mock(JsonNode.class);

        Result result = branch.handle("refund.processed", payment("order_rzp9", 10000, "log-course"), "inst-1", refund);

        assertSame(Result.NOT_COMMERCE, result);
        org.mockito.Mockito.verifyNoInteractions(refunds, refund, confirmService);
    }
}
