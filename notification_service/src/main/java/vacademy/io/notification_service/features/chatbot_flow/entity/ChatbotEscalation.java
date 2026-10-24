package vacademy.io.notification_service.features.chatbot_flow.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * One "the bot handed this learner over to a human" record.
 *
 * <p>Raised when an AI_RESPONSE node cannot answer from its own context, exhausts its turn
 * budget, or errors. While {@code status = PENDING} the conversation shows as <b>Unanswered</b> in
 * the WhatsApp Inbox and the flow's configured notification emails have been told a learner is
 * waiting. Replying from the Inbox resolves it.
 *
 * <p>At most one PENDING row per (instituteId, userPhone) — enforced by a partial unique index in
 * V32, so a learner who keeps asking unanswerable questions produces one open item, not a queue.
 */
@Entity
@Table(name = "chatbot_escalation")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatbotEscalation {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "flow_id")
    private String flowId;

    @Column(name = "session_id")
    private String sessionId;

    @Column(name = "node_id")
    private String nodeId;

    @Column(name = "user_phone", nullable = false)
    private String userPhone;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "user_name")
    private String userName;

    @Column(name = "channel_type", length = 50)
    private String channelType;

    @Column(name = "business_channel_id")
    private String businessChannelId;

    /** {@link vacademy.io.notification_service.features.chatbot_flow.enums.EscalationReason} */
    @Column(name = "reason", nullable = false, length = 50)
    private String reason;

    /** The learner message the bot could not answer. */
    @Column(name = "user_message", columnDefinition = "TEXT")
    private String userMessage;

    /** What the bot said instead ("I'll check with our team and get back to you"). */
    @Column(name = "bot_reply", columnDefinition = "TEXT")
    private String botReply;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /** PENDING | RESOLVED */
    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private String status = "PENDING";

    /** Last time an admin notification went out for this row; null = never. Gates re-notification. */
    @Column(name = "notified_at")
    private Timestamp notifiedAt;

    /** Comma-separated email recipients of the last notification, for audit. */
    @Column(name = "notified_emails", columnDefinition = "TEXT")
    private String notifiedEmails;

    /** Comma-separated WhatsApp recipients of the last notification, for audit. */
    @Column(name = "notified_phones", columnDefinition = "TEXT")
    private String notifiedPhones;

    @Column(name = "resolved_at")
    private Timestamp resolvedAt;

    /** Who answered — an admin user id, or "INBOX_REPLY" when resolved by the reply itself. */
    @Column(name = "resolved_by")
    private String resolvedBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
