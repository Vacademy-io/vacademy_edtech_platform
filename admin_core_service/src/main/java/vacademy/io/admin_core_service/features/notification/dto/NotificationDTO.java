package vacademy.io.admin_core_service.features.notification.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

@Data
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class NotificationDTO {
    private String body;
    private String notificationType;
    private String subject;
    private String source;
    private String sourceId;
    /** Optional. Null means UTILITY_EMAIL. Commercial types get the unsubscribe footer. */
    private String emailType;
    private List<NotificationToUserDTO> users;
}
