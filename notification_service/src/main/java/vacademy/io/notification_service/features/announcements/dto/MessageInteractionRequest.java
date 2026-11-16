package vacademy.io.notification_service.features.announcements.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.notification_service.features.announcements.enums.InteractionType;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Map;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class MessageInteractionRequest {
    
    @NotBlank(message = "Recipient message ID is required")
    private String recipientMessageId;
    
    // Optional: the controller sets it from the caller's token and refuses any other id.
    private String userId;
    
    @NotNull(message = "Interaction type is required")
    private InteractionType interactionType;
    
    private Map<String, Object> additionalData;
}