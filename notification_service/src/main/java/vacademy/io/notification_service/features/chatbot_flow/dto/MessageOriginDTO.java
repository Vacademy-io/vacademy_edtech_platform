package vacademy.io.notification_service.features.chatbot_flow.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Who sent an outgoing WhatsApp message: a workflow or a chatbot flow, with its name when known. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class MessageOriginDTO {
    /** WORKFLOW or CHATBOT_FLOW. */
    private String type;
    private String id;
    /** Workflow / flow name; null when it could not be resolved. */
    private String name;
}
