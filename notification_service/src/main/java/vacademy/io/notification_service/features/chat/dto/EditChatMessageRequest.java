package vacademy.io.notification_service.features.chat.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * Edit the body of a message you already sent. Only the text is editable — content type, attachment
 * and reply target are fixed at send time, so an edit can never turn one message into a different one.
 */
@Data
public class EditChatMessageRequest {

    @Size(max = 8000)
    private String text;

    private String richTextType; // optional: html/text; defaults to the original's type
}
