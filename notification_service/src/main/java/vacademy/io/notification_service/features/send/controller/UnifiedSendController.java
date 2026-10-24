package vacademy.io.notification_service.features.send.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.notification_service.features.send.dto.DeliveryStatusDTO;
import vacademy.io.notification_service.features.send.dto.SendBatchSummaryDTO;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;

import java.util.List;

@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("notification-service/v1/send")
public class UnifiedSendController {

    private final UnifiedSendService unifiedSendService;

    /**
     * Unified send endpoint — routes to WhatsApp, Email, Push, or System Alert
     * based on the "channel" field. Handles sync (<=100 recipients) or async (>100).
     */
    @PostMapping
    public ResponseEntity<UnifiedSendResponse> send(@RequestBody UnifiedSendRequest request) {
        log.info("Unified send: channel={}, template={}, recipients={}, institute={}",
                request.getChannel(), request.getTemplateName(),
                request.getRecipients() != null ? request.getRecipients().size() : 0,
                request.getInstituteId());

        UnifiedSendResponse response = unifiedSendService.send(request);
        return ResponseEntity.ok(response);
    }

    /**
     * Get batch status for async sends (>100 recipients)
     */
    @GetMapping("/{batchId}/status")
    public ResponseEntity<UnifiedSendResponse> getBatchStatus(@PathVariable String batchId) {
        UnifiedSendResponse response = unifiedSendService.getBatchStatus(batchId);
        return ResponseEntity.ok(response);
    }

    /**
     * What the provider actually did with messages this caller sent, keyed by the messageId
     * (WhatsApp wamid) returned in the send response.
     * <p>
     * The send endpoint above returns as soon as the provider accepts the message, which is NOT
     * delivery — a message accepted at 06:51:47 is regularly rejected at 06:51:48. Anything that
     * needs to show a real outcome sends, then polls this for a few seconds. Ids with no verdict
     * yet come back PENDING.
     */
    @GetMapping("/delivery-status")
    public ResponseEntity<List<DeliveryStatusDTO>> getDeliveryStatus(
            @RequestParam("messageIds") List<String> messageIds) {
        return ResponseEntity.ok(unifiedSendService.getDeliveryStatus(messageIds));
    }

    /**
     * List recent batches for an institute (for admin dashboard)
     */
    @GetMapping("/batches")
    public ResponseEntity<List<SendBatchSummaryDTO>> listBatches(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "20") int limit) {
        List<SendBatchSummaryDTO> batches = unifiedSendService.listBatches(instituteId, limit);
        return ResponseEntity.ok(batches);
    }
}
