package vacademy.io.admin_core_service.features.commerce.returns.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommerceGatewayOrder;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;

/**
 * {@code refund.processed} and {@code refund.failed} of a commerce payment (the branch has
 * matched the gateway order and the institute). The refund row is found by the gateway's refund
 * id, else by its receipt (our refund id, on the same payment and institute), and then moved by
 * compare-and-set: a replayed event changes nothing. A refund we have no row for (made by hand
 * in the gateway dashboard) is an alert; staff adopt it. A database failure is thrown, so the
 * webhook answers 500 and the gateway delivers again.
 */
@Slf4j
@Service
public class CommerceRefundWebhookService {

    /** What the event did, for the tests and the log. */
    public enum Outcome { PROCESSED, FAILED, REPLAY, UNKNOWN_REFUND, AMOUNT_MISMATCH, NO_ENTITY, IGNORED }

    private final CommerceRefundRepository refundRepository;
    private final CommerceRefundService refundService;
    private final TransactionTemplate ownTransaction;

    public CommerceRefundWebhookService(CommerceRefundRepository refundRepository,
                                        CommerceRefundService refundService,
                                        PlatformTransactionManager transactionManager) {
        this.refundRepository = refundRepository;
        this.refundService = refundService;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public Outcome handle(String eventType, JsonNode refundEntity, CommerceGatewayOrder gatewayOrder,
                          String instituteId) {
        if (refundEntity == null || refundEntity.isNull() || refundEntity.isMissingNode()) {
            log.info("Commerce webhook: {} for order {} carries no refund entity; the refund poll covers it",
                    eventType, gatewayOrder.getCommerceOrderId());
            return Outcome.NO_ENTITY;
        }
        String gatewayRefundId = text(refundEntity.path("id"));
        String paymentId = text(refundEntity.path("payment_id"));
        String receipt = text(refundEntity.path("receipt"));
        long amount = refundEntity.path("amount").isIntegralNumber() ? refundEntity.path("amount").asLong() : -1L;
        String status = text(refundEntity.path("status"));
        String bankReference = text(refundEntity.path("acquirer_data").path("arn"));
        if (bankReference == null) {
            bankReference = text(refundEntity.path("acquirer_data").path("rrn"));
        }
        CommerceRefund refund = ownTransaction.execute(tx -> find(gatewayRefundId, paymentId, receipt, instituteId));
        if (refund == null) {
            log.error("COMMERCE_ALERT gateway_refund_not_recorded institute={} order={} payment={} gateway_refund={} "
                            + "amount={} (a refund made outside the shop: record it with gateway_refund_id)",
                    instituteId, gatewayOrder.getCommerceOrderId(), paymentId, gatewayRefundId, amount);
            return Outcome.UNKNOWN_REFUND;
        }
        long ours = CommerceRefundService.toMinor(refund.getAmount(), refund.getCurrency());
        if (amount != ours) {
            log.error("COMMERCE_ALERT refund_amount_mismatch institute={} refund={} gateway_refund={} ours={} "
                    + "gateway={}", instituteId, refund.getId(), gatewayRefundId, ours, amount);
            return Outcome.AMOUNT_MISMATCH;
        }
        if (gatewayRefundId != null && refund.getGatewayRefundId() == null) {
            String reference = bankReference;
            ownTransaction.executeWithoutResult(tx -> refundRepository.storeGatewayRefund(refund.getId(),
                    gatewayRefundId, CommerceRefundService.clip(status, 32), CommerceRefundService.clip(reference, 100)));
        }
        if ("refund.processed".equals(eventType)) {
            boolean moved = refundService.markProcessed(refund.getId(),
                    CommerceRefundService.Facts.gateway(status == null ? "processed" : status, bankReference));
            return moved ? Outcome.PROCESSED : Outcome.REPLAY;
        }
        if ("refund.failed".equals(eventType)) {
            boolean moved = refundService.markFailed(refund.getId(), CommerceRefundExecutor.GATEWAY_FAILED,
                    "the gateway reports the refund failed", status == null ? "failed" : status);
            return moved ? Outcome.FAILED : Outcome.REPLAY;
        }
        return Outcome.IGNORED;
    }

    private CommerceRefund find(String gatewayRefundId, String paymentId, String receipt, String instituteId) {
        if (gatewayRefundId != null) {
            CommerceRefund byId = refundRepository.findByGatewayVendorAndGatewayRefundId(CommerceRefundService.VENDOR,
                    gatewayRefundId).orElse(null);
            if (byId != null) {
                return instituteId.equals(byId.getInstituteId()) ? byId : null;
            }
        }
        if (receipt == null || receipt.length() > 36) {
            return null;
        }
        CommerceRefund byReceipt = refundRepository.findByIdAndInstituteId(receipt, instituteId).orElse(null);
        if (byReceipt == null || paymentId == null || !paymentId.equals(byReceipt.getGatewayPaymentId())) {
            return null;
        }
        return byReceipt;
    }

    private static String text(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        String value = node.asText();
        return value == null || value.isBlank() ? null : value.trim();
    }
}
