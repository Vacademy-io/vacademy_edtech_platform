package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import vacademy.io.common.auth.dto.UserDTO;

/**
 * DTO for submitting a lead from website form
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SubmitLeadRequestDTO {

    private String audienceId;
    private String sourceType; // WEBSITE (for now)
    private String sourceId; // Landing page ID, form URL, etc.
    
    // Custom field values
    // Key: fieldKey (e.g., "email", "phone"), Value: submitted value
    private Map<String, String> customFieldValues;

    // Optional direct user payload; if provided, it takes precedence over custom fields
    private UserDTO userDTO;

    // Optional manual counsellor (lead owner) assignment. When set, this user_id is
    // written to user_lead_profile.assigned_counselor_id/name (the field the leads
    // table renders) and pool auto-assignment is skipped for this lead.
    private String counsellorId;

    // Optional display name for the manual counsellor. If blank, it is looked up from
    // auth_service so the Counsellor column renders a name rather than "Unassigned".
    private String counsellorName;

    // Optional pipeline lead status. Maps to a lead_status row (by status_key) within
    // the audience's institute and sets audience_response.lead_status_id (the status
    // chip). Ignored if blank or if no matching status exists for the institute.
    private String leadStatusKey;

    // Staff member entering the lead, written to audience_response.created_by_user_id.
    // Server-set from the token on the authenticated endpoints only; @JsonIgnore so a
    // public form cannot claim to have been entered by a counsellor.
    @JsonIgnore
    private String createdByUserId;
}

