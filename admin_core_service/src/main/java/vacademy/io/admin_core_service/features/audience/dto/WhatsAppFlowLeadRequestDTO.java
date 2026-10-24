package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Request from notification_service's chatbot engine for the WhatsApp flow lead nodes.
 * One shape serves both internal endpoints:
 * <ul>
 *   <li>{@code /check} (CRM_LEAD_CHECK node) reads instituteId, phone, name and the flow/message
 *       fields — it finds the existing lead or creates a new one.</li>
 *   <li>{@code /save} (ASK_FIELD after each answer, SAVE_TO_CRM at the end) also reads
 *       responseId, fieldValues, fullName, email, statusKey, overwrite, complete, fireWorkflow.</li>
 * </ul>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class WhatsAppFlowLeadRequestDTO {
    private String instituteId;
    /** The WhatsApp number as the provider delivered it, e.g. "447911123456". */
    private String phone;
    /** WhatsApp profile name, used as the lead's display name until the flow asks for one. */
    private String name;
    private String flowId;
    private String flowName;
    private String sessionId;
    /** The inbound message that started this step — recorded on a repeat contact. */
    private String messageText;

    /** The lead this chatbot session is working on, once known. */
    private String responseId;
    /** Answers keyed by custom_field_id. */
    private Map<String, String> fieldValues;
    /** System-field answers. */
    private String fullName;
    private String email;
    /** Optional lead_status.status_key to set when the flow completes (new leads only). */
    private String statusKey;
    /**
     * True when this session created the lead — its answers may replace what is stored.
     * False for a lead that already existed: only empty fields are filled.
     */
    private Boolean overwrite;
    /** True from the SAVE_TO_CRM node: the flow has finished collecting. */
    private Boolean complete;
    /** Fire AUDIENCE_LEAD_SUBMISSION once the answers are saved (new leads only). */
    private Boolean fireWorkflow;
}
