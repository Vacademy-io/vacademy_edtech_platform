package vacademy.io.notification_service.features.chatbot_flow.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One button of a WhatsApp template message, as the Inbox draws it under the bubble. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class InboxTemplateButtonDTO {
    /** URL, QUICK_REPLY, PHONE_NUMBER, COPY_CODE, ... */
    private String type;
    private String text;
    /** Complete http(s) link of a URL button; null when it cannot be rebuilt. */
    private String url;
    private String phoneNumber;
}
