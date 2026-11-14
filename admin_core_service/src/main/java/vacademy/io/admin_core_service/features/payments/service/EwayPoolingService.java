package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.entity.WebHook;
import vacademy.io.admin_core_service.features.payments.enums.WebHookStatus;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.enrollment_policy.service.RenewalPaymentService;
import vacademy.io.common.payment.dto.EwayTransaction;
import vacademy.io.common.payment.dto.EwayWebHookDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.payment.enums.PaymentType;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.admin_core_service.features.payments.manager.EwayPaymentManager;

import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class EwayPoolingService {

    private static final int POLLING_INTERVAL_MS = 30_000;

    @Autowired
    private WebHookService webHookService;
    @Autowired
    private PaymentLogService paymentLogService;
    @Autowired
    private RenewalPaymentService renewalPaymentService;
    @Autowired
    private vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService planChangeService;
    @Autowired
    private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;
    @Autowired
    private EwayPaymentManager ewayPaymentManager;
    @Autowired
    private ObjectMapper objectMapper;

    /**
     * Polls pending Eway webhooks every minute.
     */
    @Scheduled(fixedRate = POLLING_INTERVAL_MS)
    public void pollPendingEwayTransactions() {
        List<WebHook> pendingWebhooks = webHookService.getPendingWebHooks(PaymentGateway.EWAY.name());

        if (pendingWebhooks.isEmpty()) {
            return;
        }

        log.info("Polling {} pending Eway webhooks", pendingWebhooks.size());

        for (WebHook webhook : pendingWebhooks) {
            processWebhook(webhook);
        }
    }

    private void processWebhook(WebHook webhook) {
        try {
            EwayWebHookDTO dto = objectMapper.readValue(webhook.getPayload(), EwayWebHookDTO.class);

            PaymentResponseDTO paymentResponse = dto.getPaymentResponse();
            if (paymentResponse == null || !StringUtils.hasText(paymentResponse.getOrderId())) {
                failWebhook(webhook, "Missing payment response or orderId");
                return;
            }

            String instituteId = dto.getInstituteId();
            String transactionId = (String) paymentResponse.getResponseData().get("transactionId");

            if (!StringUtils.hasText(transactionId)) {
                failWebhook(webhook, "Missing transactionId");
                return;
            }

            Map<String, Object> credentials = institutePaymentGatewayMappingService
                    .findInstitutePaymentGatewaySpecifData(
                            PaymentGateway.EWAY.name(), instituteId);

            EwayTransaction transaction = ewayPaymentManager.getTransactionById(transactionId, credentials);

            if (transaction == null) {
                log.warn("Transaction not found for webhookId={}", webhook.getId());
                return; // keep pending
            }

            if (transaction.getTransactionStatus()) {
                handleSuccess(dto, webhook);
            } else if (isDefinitiveFailure(transaction.getResponseMessage())) {
                handleFailure(dto, webhook);
            } else {
                log.info("Payment still pending for orderId={}",
                        paymentResponse.getOrderId());
            }

        } catch (Exception ex) {
            log.error("Eway polling failed for webhookId={}", webhook.getId(), ex);
            SentryLogger.logError(ex, "Eway polling failed",
                    Map.of("webhookId", webhook.getId()));

            // Fix for infinite loop: Mark webhook as FAILED so it's not picked up again
            // immediately
            webHookService.updateWebHookStatus(
                    webhook.getId(),
                    WebHookStatus.FAILED,
                    "Polling failed: " + ex.getMessage());
        }
    }

    /**
     * Handles SUCCESS payment for INITIAL, RENEWAL and PLAN_CHANGE types.
     */
    private void handleSuccess(EwayWebHookDTO dto, WebHook webhook) {

        PaymentType paymentType;

        if (dto.getPaymentType() == null || dto.getPaymentType().isBlank()) {
            paymentType = PaymentType.INITIAL;
        } else {
            paymentType = PaymentType.valueOf(dto.getPaymentType().toUpperCase());
        }

        switch (paymentType) {
            case INITIAL -> handleInitialPayment(dto);
            case RENEWAL -> handleRenewalPayment(dto);
            // Without this case an upgrade paid through eWay would throw here, leaving the
            // learner charged and still on their old plan.
            case PLAN_CHANGE -> handlePlanChangePayment(dto);
            default -> throw new IllegalStateException("Unsupported payment type: " + paymentType);
        }

        webHookService.updateWebHookStatus(
                webhook.getId(),
                WebHookStatus.PROCESSED,
                null);
    }

    private void handleInitialPayment(EwayWebHookDTO dto) {
        paymentLogService.updatePaymentLog(
                dto.getPaymentResponse().getOrderId(),
                PaymentStatusEnum.PAID.name(),
                dto.getInstituteId());
    }

    private void handleRenewalPayment(EwayWebHookDTO dto) {
        PaymentResponseDTO response = dto.getPaymentResponse();

        PaymentStatusEnum status = PaymentStatusEnum.PAID;
        if (response.getResponseData() != null &&
                response.getResponseData().containsKey("paymentStatus")) {
            status = PaymentStatusEnum.valueOf(
                    (String) response.getResponseData().get("paymentStatus"));
        }

        renewalPaymentService.handleRenewalPaymentConfirmation(
                response.getOrderId(),
                dto.getInstituteId(),
                status,
                response);
    }

    /** An upgrade paid through eWay. Same confirmation entry point as the push gateways. */
    private void handlePlanChangePayment(EwayWebHookDTO dto) {
        PaymentResponseDTO response = dto.getPaymentResponse();

        PaymentStatusEnum status = PaymentStatusEnum.PAID;
        if (response.getResponseData() != null &&
                response.getResponseData().containsKey("paymentStatus")) {
            status = PaymentStatusEnum.valueOf(
                    (String) response.getResponseData().get("paymentStatus"));
        }

        planChangeService.handlePlanChangePaymentConfirmation(
                response.getOrderId(),
                dto.getInstituteId(),
                status);
    }

    private void handleFailure(EwayWebHookDTO dto, WebHook webhook) {
        paymentLogService.updatePaymentLog(
                dto.getPaymentResponse().getOrderId(),
                PaymentStatusEnum.FAILED.name(),
                dto.getInstituteId());

        webHookService.updateWebHookStatus(
                webhook.getId(), WebHookStatus.PROCESSED, null);
    }

    private void failWebhook(WebHook webhook, String reason) {
        webHookService.updateWebHookStatus(
                webhook.getId(), WebHookStatus.FAILED, reason);
    }

    private boolean isDefinitiveFailure(String responseMessage) {
        if (responseMessage == null)
            return false;
        String msg = responseMessage.toLowerCase();
        return msg.contains("declined")
                || msg.contains("invalid")
                || msg.contains("expired");
    }
}
