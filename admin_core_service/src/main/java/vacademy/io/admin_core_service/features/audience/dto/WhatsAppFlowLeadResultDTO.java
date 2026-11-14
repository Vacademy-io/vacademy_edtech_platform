package vacademy.io.admin_core_service.features.audience.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** What the WhatsApp flow lead endpoints report back to the chatbot engine. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WhatsAppFlowLeadResultDTO {
    /** NEW — a lead was created for this conversation; EXISTING — the phone was already a lead. */
    private String result;
    private String responseId;
    private String userId;
    private String audienceId;
    /** True when the matched lead had been soft-deleted and was brought back. */
    private boolean revived;
    /** How many custom-field values were written by this call. */
    private int savedFields;
}
