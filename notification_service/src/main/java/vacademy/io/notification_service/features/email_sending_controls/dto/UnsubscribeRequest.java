package vacademy.io.notification_service.features.email_sending_controls.dto;

import lombok.Data;

@Data
public class UnsubscribeRequest {
    private String email;
    private String reason;
}
