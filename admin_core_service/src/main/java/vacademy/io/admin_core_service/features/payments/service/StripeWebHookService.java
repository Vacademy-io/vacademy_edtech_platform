package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.exception.StripeException;
import com.stripe.model.*;
import com.stripe.net.Webhook;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.enums.WebHookStatus;
import vacademy.io.admin_core_service.features.payments.util.WebHookErrorUtils;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.enrollment_policy.service.RenewalPaymentService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.common.payment.enums.PaymentType;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
public class StripeWebHookService {

    @Autowired
    private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;
    @Autowired
    private WebHookService webHookService;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private PaymentLogService paymentLogService;
    @Autowired
    private RenewalPaymentService renewalPaymentService;
    @Autowired
    private vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService planChangeService;

    public ResponseEntity<String> processWebHook(String payload, String sigHeader) {
        log.info("Received Stripe webhook payload.");
        String webhookId = null;

        try {
            // Log the incoming webhook for auditing purposes
            webhookId = webHookService.saveWebhook(PaymentGateway.STRIPE.name(), payload, null);

            String instituteId = extractInstituteId(payload);
            if (instituteId == null) {
                log.warn("Webhook ignored: Missing or invalid 'instituteId' in metadata.");
                updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Missing instituteId in metadata");
                // Return 200 OK to Stripe to prevent retries for irrelevant events.
                return ResponseEntity.ok("Webhook ignored: No instituteId found.");
            }

            String webhookSecret = getWebhookSecret(instituteId);
            if (webhookSecret == null) {
                log.error("Webhook secret not found for institute: {}", instituteId);
                SentryLogger.logError(new IllegalStateException("Webhook secret not found"),
                        "Stripe webhook secret not configured", Map.of(
                                "payment.vendor", "STRIPE",
                                "institute.id", instituteId,
                                "webhook.id", webhookId,
                                "operation", "getWebhookSecret"));
                updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Webhook secret not found");
                return ResponseEntity.status(404).body("Unknown institute");
            }

            Event event = verifySignature(payload, sigHeader, webhookSecret);
            if (event == null) {
                updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Invalid signature");
                return ResponseEntity.status(400).body("Invalid signature");
            }

            return processVerifiedEvent(webhookId, event, instituteId, payload);

        } catch (Exception ex) {
            String detailedMessage = WebHookErrorUtils.describeException(ex);
            log.error("Unhandled error during Stripe webhook processing: {}", detailedMessage, ex);
            SentryLogger.SentryEventBuilder.error(ex)
                    .withMessage("Stripe webhook processing failed with unhandled error")
                    .withTag("payment.vendor", "STRIPE")
                    .withTag("webhook.id", webhookId != null ? webhookId : "unknown")
                    .withTag("operation", "processStripeWebhook")
                    .send();
            if (webhookId != null) {
                updateWebhookStatus(webhookId, WebHookStatus.FAILED, detailedMessage);
            }
            return ResponseEntity.status(500).body("Internal server error");
        }
    }

    /**
     * Manually re-runs a previously persisted Stripe webhook by id, bypassing
     * signature verification (the signature was checked when the webhook was
     * first received). Resets the WebHook row to RECEIVED before processing.
     */
    public ResponseEntity<String> reprocessWebhook(String webhookId) {
        log.info("Manual reprocess requested for Stripe webhookId={}", webhookId);

        var webhookOpt = webHookService.findById(webhookId);
        if (webhookOpt.isEmpty()) {
            return ResponseEntity.status(404).body("WebHook not found: " + webhookId);
        }
        var webhook = webhookOpt.get();

        if (!PaymentGateway.STRIPE.name().equalsIgnoreCase(webhook.getVendor())) {
            return ResponseEntity.status(400)
                    .body("WebHook vendor is " + webhook.getVendor() + ", expected STRIPE for this endpoint.");
        }

        String payload = webhook.getPayload();
        if (payload == null || payload.isBlank()) {
            updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Stored payload is empty, cannot reprocess");
            return ResponseEntity.status(400).body("Stored payload is empty for webhook " + webhookId);
        }

        String instituteId = extractInstituteId(payload);
        if (instituteId == null) {
            updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Missing instituteId in stored payload");
            return ResponseEntity.status(400).body("Missing instituteId in stored payload");
        }

        webHookService.resetForReprocess(webhookId);

        try {
            // Bypass signature verification: deserialize Event directly from stored payload
            // using the same Gson instance the SDK uses for Webhook.constructEvent.
            Event event = com.stripe.net.ApiResource.GSON.fromJson(payload, Event.class);
            if (event == null || event.getType() == null) {
                updateWebhookStatus(webhookId, WebHookStatus.FAILED,
                        "Stored payload does not parse as a Stripe Event");
                return ResponseEntity.status(400).body("Stored payload is not a valid Stripe Event");
            }
            return processVerifiedEvent(webhookId, event, instituteId, payload);
        } catch (Exception ex) {
            String detailedMessage = WebHookErrorUtils.describeException(ex);
            log.error("Manual reprocess failed for Stripe webhookId={}: {}", webhookId, detailedMessage, ex);
            SentryLogger.SentryEventBuilder.error(ex)
                    .withMessage("Stripe webhook manual reprocess failed")
                    .withTag("payment.vendor", "STRIPE")
                    .withTag("webhook.id", webhookId)
                    .withTag("institute.id", instituteId)
                    .withTag("operation", "reprocessWebhook")
                    .send();
            updateWebhookStatus(webhookId, WebHookStatus.FAILED, detailedMessage);
            return ResponseEntity.status(500).body("Reprocess failed: " + detailedMessage);
        }
    }

    /**
     * Steps after signature verification. Shared between live webhook delivery
     * and manual reprocess so behavior matches exactly.
     */
    private ResponseEntity<String> processVerifiedEvent(String webhookId, Event event, String instituteId,
            String payload) {
        log.info("Processing Stripe event: {} for institute: {} (webhookId={})", event.getType(), instituteId,
                webhookId);

        // Extract the PaymentIntent object from the event payload
        PaymentIntent paymentIntent = extractPaymentIntentFromEvent(event);
        if (paymentIntent == null) {
            // This could be an event we don't handle, like `customer.created`. This is
            // normal.
            log.info("Event {} does not contain a PaymentIntent object. Acknowledging and skipping.",
                    event.getType());
            updateWebhookStatus(webhookId, WebHookStatus.PROCESSED,
                    "Event does not contain a PaymentIntent, skipped.");
            return ResponseEntity.ok("Webhook acknowledged, no action taken.");
        }

        String orderId = paymentIntent.getMetadata().get("orderId");
        if (orderId == null) {
            log.error("Missing 'orderId' in PaymentIntent metadata for pi_id: {}", paymentIntent.getId());
            SentryLogger.logError(new IllegalStateException("Missing orderId in metadata"),
                    "Stripe webhook missing orderId in PaymentIntent metadata", Map.of(
                            "payment.vendor", "STRIPE",
                            "payment.intent.id", paymentIntent.getId(),
                            "institute.id", instituteId,
                            "webhook.id", webhookId != null ? webhookId : "unknown",
                            "payment.webhook.event", event.getType(),
                            "operation", "extractOrderId"));
            updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Missing orderId in metadata");
            return ResponseEntity.status(400).body("Missing orderId in metadata");
        }

        // Update our internal records with the final event type and order ID
        webHookService.updateWebHook(webhookId, payload, orderId, event.getType());

        // Extract payment_type from metadata
        String paymentType = paymentIntent.getMetadata().get("payment_type");

        // Route based on payment_type
        if (paymentType != null && PaymentType.RENEWAL.name().equals(paymentType)) {
            log.info("Processing RENEWAL payment webhook for orderId: {}", orderId);
            handleRenewalPayment(event, paymentIntent, orderId, instituteId);
        } else if (paymentType != null && PaymentType.PLAN_CHANGE.name().equals(paymentType)) {
            // Must be its own branch: the else below routes to handleInitialPayment, which
            // would treat an upgrade as a first enrollment and never apply the plan swap.
            log.info("Processing PLAN_CHANGE payment webhook for orderId: {}", orderId);
            handlePlanChangePayment(paymentIntent, orderId, instituteId);
        } else {
            log.info("Processing INITIAL payment webhook for orderId: {}", orderId);
            handleInitialPayment(event, orderId, instituteId);
        }

        updateWebhookStatus(webhookId, WebHookStatus.PROCESSED, null);
        return ResponseEntity.ok("Webhook processed successfully");
    }

    private void updateWebhookStatus(String webhookId, WebHookStatus status, String notes) {
        if (webhookId != null) {
            webHookService.updateWebHookStatus(webhookId, status, notes);
        }
    }

    /**
     * UPDATED: Extracts instituteId from PaymentIntent or Invoice metadata.
     */
    private String extractInstituteId(String payload) {
        try {
            JsonNode dataObject = objectMapper.readTree(payload).at("/data/object");
            JsonNode metadataNode = dataObject.get("metadata");
            if (metadataNode != null && metadataNode.has("instituteId")) {
                return metadataNode.get("instituteId").asText();
            }
        } catch (Exception e) {
            log.error("Failed to parse payload or extract instituteId", e);
            SentryLogger.logError(e, "Failed to parse Stripe webhook payload", Map.of(
                    "payment.vendor", "STRIPE",
                    "operation", "extractInstituteId"));
        }
        return null;
    }

    private String getWebhookSecret(String instituteId) {
        Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                .findInstitutePaymentGatewaySpecifData(PaymentGateway.STRIPE.name(), instituteId);
        return gatewayData != null ? (String) gatewayData.get("webhookSecret") : null;
    }

    private Event verifySignature(String payload, String sigHeader, String secret) {
        try {
            return Webhook.constructEvent(payload, sigHeader, secret);
        } catch (SignatureVerificationException e) {
            log.error("Stripe signature verification failed.", e);
            SentryLogger.logError(e, "Stripe webhook signature verification failed", Map.of(
                    "payment.vendor", "STRIPE",
                    "operation", "verifySignature"));
            return null;
        }
    }    private PaymentIntent extractPaymentIntentFromEvent(Event event) {
        if (!event.getType().startsWith("payment_intent.")) {
            return null; // Not a payment intent event
        }

        EventDataObjectDeserializer dataObjectDeserializer = event.getDataObjectDeserializer();

        // This is a more robust way to handle deserialization.
        // It gets the raw JSON of the event's data object and explicitly parses it.
        try {
            String rawJson = dataObjectDeserializer.getRawJson();
            return PaymentIntent.GSON.fromJson(rawJson, PaymentIntent.class);
        } catch (Exception e) {
            log.error("Could not deserialize PaymentIntent from raw JSON for event type: {}: {}", event.getType(),
                    e.getMessage());
            SentryLogger.logError(e, "Could not deserialize Stripe PaymentIntent", Map.of(
                    "payment.vendor", "STRIPE",
                    "payment.webhook.event", event.getType(),
                    "operation", "extractPaymentIntent"));
            throw new VacademyException("Webhook data object could not be parsed as a PaymentIntent.");
        }
    }

    private void handleInitialPayment(Event event, String orderId, String instituteId) {
        // Handle the event based on its type
        switch (event.getType()) {
            case "payment_intent.succeeded":
                log.info("PaymentIntent succeeded for orderId: {}", orderId);
                paymentLogService.updatePaymentLog(orderId, PaymentStatusEnum.PAID.name(), instituteId);
                break;
            case "payment_intent.payment_failed":
                log.warn("PaymentIntent failed for orderId: {}", orderId);
                paymentLogService.updatePaymentLog(orderId, PaymentStatusEnum.FAILED.name(), instituteId);
                break;
            default:
                log.info("Unhandled but valid event type: {}. Acknowledging.", event.getType());
                break;
        }
    }
    
    private void handleRenewalPayment(Event event, PaymentIntent paymentIntent, String orderId, String instituteId) {
        try {
            // Determine payment status
            PaymentStatusEnum paymentStatus = determinePaymentStatus(paymentIntent.getStatus());
            
            log.info("Processing renewal payment: orderId={}, status={}", orderId, paymentStatus);
            
            // Call renewal service to handle payment confirmation
            renewalPaymentService.handleRenewalPaymentConfirmation(orderId, instituteId, paymentStatus, paymentIntent);
            
        } catch (Exception e) {
            log.error("Error processing renewal payment webhook", e);
        }
    }
    
    /** An upgrade payment settled. Applying the change is idempotent inside PlanChangeService. */
    private void handlePlanChangePayment(PaymentIntent paymentIntent, String orderId, String instituteId) {
        try {
            PaymentStatusEnum paymentStatus = determinePaymentStatus(paymentIntent.getStatus());
            log.info("Processing plan-change payment: orderId={}, status={}", orderId, paymentStatus);
            planChangeService.handlePlanChangePaymentConfirmation(orderId, instituteId, paymentStatus);
        } catch (Exception e) {
            log.error("Error processing plan-change payment webhook for orderId {}", orderId, e);
        }
    }

    private PaymentStatusEnum determinePaymentStatus(String stripeStatus) {
        if ("succeeded".equals(stripeStatus)) {
            return PaymentStatusEnum.PAID;
        } else if ("processing".equals(stripeStatus)) {
            return PaymentStatusEnum.PAYMENT_PENDING;
        } else {
            return PaymentStatusEnum.FAILED;
        }
    }
}
