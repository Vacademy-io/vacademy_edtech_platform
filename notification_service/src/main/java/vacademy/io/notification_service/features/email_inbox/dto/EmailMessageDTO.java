package vacademy.io.notification_service.features.email_inbox.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmailMessageDTO {
    private String id;
    /** OUTGOING (institute → audience) or INCOMING (audience → institute). */
    private String direction;
    /** Subject line when available (parsed from inbound, may be empty for outbound). */
    private String subject;
    /** Plain-text body preview (HTML stripped, truncated). */
    private String bodyPreview;
    /** Full body — HTML for outbound, plaintext for inbound. */
    private String body;
    /** Counterparty email (the address the institute is talking to). */
    private String counterpartyEmail;
    /** Display name of the other party when known (inbound From personal name). */
    private String counterpartyName;
    /** Institute-side address (sender for outbound, receiver for inbound). */
    private String instituteAddress;
    /** When the message was sent/received. Jackson emits Instant as ISO-8601 with trailing Z. */
    private Instant timestamp;
    /**
     * Raw source identifier, kept for compatibility (announcement-service, OTP_SERVICE, ...).
     * Null for inbound rows — their source column holds the parent log id, exposed as
     * {@link #inReplyToId} instead. The UI must never render this verbatim; use {@link #origin}.
     */
    private String source;
    /**
     * Human-meaningful classification. OUTGOING: CAMPAIGN | INBOX_REPLY | OTP | AUTOMATION | EMAIL.
     * INCOMING: REPLY (linked to an outbound log) | INCOMING (unsolicited) | BOUNCE.
     */
    private String origin;
    /** True for bounces / mail-system auto notifications (mailer-daemon, postmaster, ...). */
    private boolean system;
    /** INCOMING only: the outbound notification_log id this message replies to, when linked. */
    private String inReplyToId;
    /**
     * OUTGOING only, optional. The row's recorded delivery state: FAILED for an announcement
     * that was never sent (unsubscribed / missing address / thrown send) or a provider failure,
     * BOUNCED etc. from SES events, DEFERRED for a reply queued behind the sender's daily cap,
     * SENT for a reply just accepted for dispatch. Null when nothing is recorded — treat as sent.
     */
    private String deliveryStatus;
    /** Human-readable reason when {@link #deliveryStatus} is a failure; null otherwise. */
    private String deliveryErrorMessage;
    /** INCOMING only: the email's files. Empty when it has none or was never indexed. */
    private List<EmailAttachmentDTO> attachments;
    /** INCOMING only: the original HTML body can be fetched from the html endpoint. */
    private boolean hasHtml;
}
