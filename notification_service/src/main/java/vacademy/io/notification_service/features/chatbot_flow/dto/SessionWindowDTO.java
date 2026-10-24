package vacademy.io.notification_service.features.chatbot_flow.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Whether Meta's 24-hour customer service window is open on a conversation — what decides if the
 * Inbox may send free-form text and media, or must fall back to an approved template.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SessionWindowDTO {

    /** True while free-form replies are allowed. */
    private boolean open;

    /** When the learner last messaged us. Null when we have no inbound message on record. */
    private Instant lastInboundAt;

    /** lastInboundAt + 24h. Null when lastInboundAt is null. */
    private Instant expiresAt;

    /** Whole minutes left, floored at 0. Null when we cannot tell. */
    private Long minutesRemaining;

    /**
     * True when no inbound message exists for this conversation, so the window state is unknown
     * rather than closed. The UI should let the admin try — Meta, not this service, is the
     * authority — while making clear the send may be refused.
     */
    private boolean unknown;
}
