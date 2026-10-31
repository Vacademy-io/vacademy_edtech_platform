package vacademy.io.notification_service.features.chat.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatReportResponse {
    private String id;
    private String instituteId;
    private String conversationId;
    private String conversationType;  // DIRECT / BATCH_GROUP / COMMUNITY — gates moderation actions
    private String messageId;
    private String reporterId;
    private String reason;
    private String details;
    private String status;
    private String reviewedBy;
    private Instant reviewedAt;
    private Instant createdAt;
    // Only the reported message's content is exposed (never arbitrary DM history).
    private ChatMessageResponse reportedMessage;
}
