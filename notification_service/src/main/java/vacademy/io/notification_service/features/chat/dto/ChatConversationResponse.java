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
public class ChatConversationResponse {
    private String id;
    private String type;             // DIRECT | BATCH_GROUP | COMMUNITY
    private String instituteId;
    private String referenceId;      // package_session_id for BATCH_GROUP
    private String title;            // group/community name; for DIRECT, the other user's name
    private String otherUserId;      // for DIRECT: the counterpart user id
    private String lastMessagePreview;
    private String lastMessageSenderId;
    private Instant lastMessageAt;
    private Long lastMessageSeq;
    private long unreadCount;
    private String memberRole;       // caller's role in the conversation
    private Integer rulesVersion;
    private boolean canPost;         // whether the caller may post (permissions + rules)
    // Whether the caller may edit / delete a message THEY sent. Institute-configurable for students
    // (settings.chat.message_actions); always true for teachers and admins.
    private boolean canEditOwnMessages;
    private boolean canDeleteOwnMessages;
}
