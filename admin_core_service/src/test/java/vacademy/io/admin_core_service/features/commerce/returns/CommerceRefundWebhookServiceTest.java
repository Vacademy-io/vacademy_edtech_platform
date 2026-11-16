package vacademy.io.admin_core_service.features.commerce.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommerceGatewayOrder;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundWebhookService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundWebhookService.Outcome;

import java.math.BigDecimal;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.PAYMENT;

/** refund.processed and refund.failed move our refund row once, found by its gateway id or our receipt. */
class CommerceRefundWebhookServiceTest {

    private RefundFixture f;
    private CommerceRefundWebhookService service;
    private CommerceGatewayOrder gatewayOrder;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        f = new RefundFixture();
        service = new CommerceRefundWebhookService(f.refundRepository, f.service, f.transactionManager);
        gatewayOrder = f.paying;
        when(f.refundRepository.findByGatewayVendorAndGatewayRefundId("RAZORPAY", "rfnd_1")).thenAnswer(call ->
                f.refunds.stream().filter(r -> "rfnd_1".equals(r.getGatewayRefundId())).findFirst());
    }

    private JsonNode entity(String id, String receipt, long amount, String status) throws Exception {
        return mapper.readTree("{\"id\":\"" + id + "\",\"payment_id\":\"" + PAYMENT + "\",\"amount\":" + amount
                + ",\"status\":\"" + status + "\"" + (receipt == null ? "" : ",\"receipt\":\"" + receipt + "\"")
                + ",\"acquirer_data\":{\"arn\":\"ARN77\"}}");
    }

    @Test
    void processedByGatewayIdMovesTheRefundOnceAndAReplayChangesNothing() throws Exception {
        CommerceRefund r = f.pendingGateway("200.00");
        r.setStatus("IN_PROGRESS");
        r.setGatewayRefundId("rfnd_1");
        assertEquals(Outcome.PROCESSED, service.handle("refund.processed", entity("rfnd_1", null, 20000L,
                "processed"), gatewayOrder, INST));
        assertEquals("PROCESSED", r.getStatus());
        assertEquals("ARN77", r.getReference());
        assertEquals(0, new BigDecimal("200.00").compareTo(f.order.getAmountRefunded()));
        assertEquals(Outcome.REPLAY, service.handle("refund.processed", entity("rfnd_1", null, 20000L,
                "processed"), gatewayOrder, INST));
        assertEquals(0, new BigDecimal("200.00").compareTo(f.order.getAmountRefunded()));
    }

    @Test
    void aRefundWhoseCreateAnswerWasLostIsFoundByItsReceiptAndItsIdStored() throws Exception {
        CommerceRefund r = f.pendingGateway("200.00");
        r.setStatus("IN_PROGRESS");
        assertEquals(Outcome.FAILED, service.handle("refund.failed", entity("rfnd_2", r.getId(), 20000L, "failed"),
                gatewayOrder, INST));
        verify(f.refundRepository).storeGatewayRefund(r.getId(), "rfnd_2", "failed", "ARN77");
        assertEquals("FAILED", r.getStatus());
        assertEquals("GATEWAY_FAILED", r.getFailureCode());
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getRefundCommitted()));
    }

    @Test
    void anAmountThatDiffersAndAnUnknownRefundAreAlertsAndChangeNothing() throws Exception {
        CommerceRefund r = f.pendingGateway("200.00");
        r.setStatus("IN_PROGRESS");
        r.setGatewayRefundId("rfnd_1");
        assertEquals(Outcome.AMOUNT_MISMATCH, service.handle("refund.processed", entity("rfnd_1", null, 19999L,
                "processed"), gatewayOrder, INST));
        assertEquals("IN_PROGRESS", r.getStatus());
        assertEquals(Outcome.UNKNOWN_REFUND, service.handle("refund.processed", entity("rfnd_hand", "x-1", 500L,
                "processed"), gatewayOrder, INST));
        // A receipt of another payment is not ours.
        CommerceRefund other = f.pendingGateway("50.00");
        other.setGatewayPaymentId("pay_other");
        assertEquals(Outcome.UNKNOWN_REFUND, service.handle("refund.processed", entity("rfnd_3", other.getId(),
                5000L, "processed"), gatewayOrder, INST));
        verify(f.refundRepository, never()).markProcessed(anyString(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void anotherInstitutesRefundIdIsNotFoundAndANullEntityIsLeftToThePoll() throws Exception {
        CommerceRefund r = f.pendingGateway("200.00");
        r.setGatewayRefundId("rfnd_1");
        r.setInstituteId("inst-other");
        when(f.refundRepository.findByGatewayVendorAndGatewayRefundId("RAZORPAY", "rfnd_1"))
                .thenReturn(Optional.of(r));
        assertEquals(Outcome.UNKNOWN_REFUND, service.handle("refund.processed", entity("rfnd_1", null, 20000L,
                "processed"), gatewayOrder, INST));
        assertEquals(Outcome.NO_ENTITY, service.handle("refund.processed", null, gatewayOrder, INST));
    }
}
