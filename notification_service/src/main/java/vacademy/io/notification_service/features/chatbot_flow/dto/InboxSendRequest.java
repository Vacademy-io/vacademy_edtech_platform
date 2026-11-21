package vacademy.io.notification_service.features.chatbot_flow.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One outbound message from the WhatsApp Inbox.
 * <p>
 * Text-only sends keep their original shape ({@code phone}, {@code text}, {@code instituteId}), so
 * a client that predates media keeps working. Adding {@code mediaType} + {@code mediaUrl} turns the
 * same call into a media send, and {@code text} then travels as the caption.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InboxSendRequest {

    private String phone;
    private String instituteId;

    /** Message text, or the caption when media is attached. Optional on a media send. */
    private String text;

    /** Admin user id, recorded on the escalation this reply resolves. */
    private String repliedBy;

    // --- Media (optional) ---
    /** image, video, audio or document. Absent for a plain text reply. */
    private String mediaType;

    /** Public http(s) URL WhatsApp can download the file from. */
    private String mediaUrl;

    /** Filename to show on a document bubble. Derived from the URL when omitted. */
    private String filename;

    /**
     * Send even though our record of the 24-hour window says it has closed.
     * <p>
     * The window is computed from the last inbound message we logged, which is not the whole truth:
     * a conversation opened from a click-to-WhatsApp ad gets 72 hours, and any inbound message that
     * never reached our webhook is invisible to us. This is the escape hatch for those cases — the
     * send still has to satisfy Meta, which is the only authority that matters.
     */
    private boolean force;

    public boolean hasMedia() {
        return mediaType != null && !mediaType.isBlank();
    }
}
