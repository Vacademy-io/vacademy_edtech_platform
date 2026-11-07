package vacademy.io.notification_service.features.chatbot_flow.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotEscalation;

import java.sql.Timestamp;
import java.time.Instant;

/** One "a learner is waiting for a human reply" item, as the admin dashboard sees it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class EscalationDTO {
    private String id;
    private String instituteId;
    private String flowId;
    private String sessionId;
    private String userPhone;
    private String userId;
    private String userName;
    /** NO_CONTEXT | MAX_TURNS | AI_ERROR | NO_CREDITS | MANUAL | EXISTING_LEAD | CRM_SAVE_FAILED */
    private String reason;
    /** The learner message the bot could not answer. */
    private String userMessage;
    /** What the bot said instead. */
    private String botReply;
    /** PENDING | RESOLVED */
    private String status;
    /** When the admin notification last went out; null = never notified. */
    private Instant notifiedAt;
    private String notifiedEmails;
    private String notifiedPhones;
    private Instant resolvedAt;
    private String resolvedBy;
    private Instant createdAt;

    public static EscalationDTO from(ChatbotEscalation e) {
        return EscalationDTO.builder()
                .id(e.getId())
                .instituteId(e.getInstituteId())
                .flowId(e.getFlowId())
                .sessionId(e.getSessionId())
                .userPhone(e.getUserPhone())
                .userId(e.getUserId())
                .userName(e.getUserName())
                .reason(e.getReason())
                .userMessage(e.getUserMessage())
                .botReply(e.getBotReply())
                .status(e.getStatus())
                .notifiedAt(toInstant(e.getNotifiedAt()))
                .notifiedEmails(e.getNotifiedEmails())
                .notifiedPhones(e.getNotifiedPhones())
                .resolvedAt(toInstant(e.getResolvedAt()))
                .resolvedBy(e.getResolvedBy())
                .createdAt(toInstant(e.getCreatedAt()))
                .build();
    }

    private static Instant toInstant(Timestamp ts) {
        return ts != null ? ts.toInstant() : null;
    }
}
