package vacademy.io.notification_service.features.send.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * What the provider ultimately did with one outbound message, as reported by its status webhook.
 * <p>
 * Distinct from the send response, which can only say the provider accepted the message: acceptance
 * is a queue receipt, and a message accepted at 06:51:47 can be rejected at 06:51:48 (Meta 131042,
 * "Business eligibility payment issue", is the common one and kills every send on the account).
 * A caller that needs to know whether something actually arrived polls this after sending.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeliveryStatusDTO {

    /** Provider message id (WhatsApp wamid) this status belongs to. */
    private String messageId;

    /**
     * SENT, DELIVERED, READ or FAILED as reported by the provider — or PENDING when no status has
     * arrived yet. PENDING is a "still waiting", never a failure.
     */
    private String status;

    /** Provider error code when status is FAILED (e.g. Meta 131042). */
    private String errorCode;

    /** Human-readable provider reason when status is FAILED. */
    private String errorMessage;

    /** When the provider reported this status. Null while PENDING. */
    private Instant reportedAt;

    /** Convenience for callers: true once the outcome can no longer change. */
    private boolean settled;
}
