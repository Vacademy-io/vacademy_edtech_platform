package vacademy.io.notification_service.features.email_inbox.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmailConversationDTO {

    /** Counterparty email address (the audience member). */
    private String email;
    /** Resolved display name when available. */
    private String name;
    /** Linked user id when resolvable. */
    private String userId;
    /** Direction of the last message: OUTGOING or INCOMING. */
    private String lastMessageDirection;
    /** Subject of the last message when known. */
    private String lastMessageSubject;
    /** Truncated preview of the last message: its subject when known, else clean body text. */
    private String lastMessagePreview;
    /** When the last message was sent/received. Jackson emits Instant as ISO-8601 with trailing Z. */
    private Instant lastMessageTime;
    /** Number of inbound messages newer than the latest outbound to this counterparty. */
    private long unreadCount;
    /** True when the counterparty is a mail-system sender (mailer-daemon / postmaster / no-reply-aws). */
    private boolean system;
    /** True when this counterparty sent at least one email with a (non-inline) attachment. */
    private boolean hasAttachments;
}
