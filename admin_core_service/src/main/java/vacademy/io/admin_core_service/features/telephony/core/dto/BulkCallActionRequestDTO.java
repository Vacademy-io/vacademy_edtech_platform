package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/**
 * Body for the Call Log's bulk actions ({@code POST /telephony/calls/bulk/*}):
 * the selected call rows plus the one value the action applies. Which field is
 * required depends on the action; the others are ignored.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BulkCallActionRequestDTO {
    private String instituteId;
    private List<String> callLogIds;
    /** bulk/disposition */
    private String dispositionKey;
    private String notes;
    /** bulk/lead-status — a lead_status.id of this institute. */
    private String statusId;
    /** bulk/assign-counsellor — blank counselorId unassigns. */
    private String counselorId;
    private String counselorName;
}
