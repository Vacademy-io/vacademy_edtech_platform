package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Request body for changing the lead status of many leads at once — the
 * "Change status" entry in the leads list's Bulk actions menu.
 *
 * <p>Body-based rather than query params for the same reason as
 * {@link LeadDeleteRequestDTO}: the selection is an id LIST, and bulk-select
 * across pages routinely sends thousands of them.</p>
 *
 * <p>Scope is always RESPONSE — one row in the list is one {@code audience_response},
 * and that is what the checkbox selected. The per-user mirror to
 * {@code user_lead_profile.conversion_status} still happens, because every lead
 * goes through the same single-lead {@code changeLeadStatus} path.</p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BulkLeadStatusRequestDTO {

    /** The audience_response ids to restatus. */
    private List<String> responseIds;

    /** Target lead_status id — the same catalog id the inline per-row dropdown sends. */
    private String statusId;

    /** Institute the action runs in. Used for the audit narration and validation. */
    private String instituteId;

    /** Recorded on every lead_status_history row. Defaults to BULK_MANUAL. */
    private String source;
}
