package vacademy.io.notification_service.features.chatbot_flow.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class InboxConversationDTO {
    private String phone;
    private String senderName;
    private String userId;
    private String lastMessage;
    private String lastMessageType;   // OUTGOING or INCOMING
    /**
     * What the learner's last message was when it carried no text — sticker, image, voice,
     * reaction, ... (see InboxMessageDTO.messageKind). The UI labels it; lastMessage then holds only
     * a caption or, for a reaction, the emoji.
     */
    private String lastMessageKind;
    /** When the last message was sent/received. Jackson emits Instant as ISO-8601 with trailing Z. */
    private Instant lastMessageTime;
    /**
     * What WhatsApp said about the last message when it was outgoing: SENT, DELIVERED, READ or
     * FAILED. Null when nothing has been reported yet, or when the last message came in — the row
     * then draws a single tick, which is all we honestly know.
     */
    private String lastMessageStatus;
    private long unreadCount;

    // --- Hand-over state: the chatbot could not answer and a human is expected to ---

    /** True while an escalation on this conversation is still PENDING — shown as "Unanswered". */
    private boolean awaitingReply;
    /** Id of the open escalation, so the UI can resolve it without replying. */
    private String escalationId;
    /** NO_CONTEXT | MAX_TURNS | AI_ERROR | NO_CREDITS | MANUAL | EXISTING_LEAD | CRM_SAVE_FAILED — why the bot handed over. */
    private String escalationReason;
    /** The learner message the bot could not answer. */
    private String escalationMessage;
    /** When the hand-over happened. */
    private Instant escalatedAt;

    /** How many outgoing messages in this conversation the provider refused to deliver. */
    private long failedCount;
}
