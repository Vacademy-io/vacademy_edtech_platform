package vacademy.io.admin_core_service.features.notification.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * One message, sent to one learner a second time from their communication timeline.
 *
 * <p>Deliberately NOT a pass-through of {@link UnifiedSendRequest}: this endpoint exists so the
 * action lands in {@code admin_activity_log} with the admin who performed it, and a free-form send
 * body would let a caller resend anything to anyone under that audited name. The shape here is
 * exactly a replay — one recipient, one channel, the template or body that already went out — so
 * the audited description can describe what actually happened.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResendCommunicationRequest {

    private String instituteId;

    /** WHATSAPP or EMAIL. Nothing else can be replayed from a log row. */
    private String channel;

    /** The notification_log row being replayed — carried into the audit row as the entity id. */
    private String sourceLogId;

    /** WhatsApp only: the approved template being replayed. */
    private String templateName;

    private String languageCode;

    /** Phone (WhatsApp) or email address (EMAIL) — whoever the original send went to. */
    private String recipient;

    /** The learner's user id, so the audit row and the unsubscribe checks both resolve a person. */
    private String recipientUserId;

    private String recipientName;

    /** Template variables for this send: the originals, or the admin's edits. */
    private Map<String, String> variables;

    /** True when the admin changed a variable before sending — recorded in the audit row. */
    private boolean variablesChanged;

    /** EMAIL only: the subject the original send stored. */
    private String emailSubject;

    /** EMAIL only: the rendered body the original send stored. */
    private String emailBody;

    /** WhatsApp only: IMAGE / VIDEO / DOCUMENT, when the template carries a media header. */
    private String headerType;

    /** WhatsApp only: the media the original send attached to that header. */
    private String headerUrl;
}
