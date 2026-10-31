package vacademy.io.admin_core_service.features.audience.dto.combined;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * Request DTO for combined users and audience API
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CombinedUserAudienceRequestDTO {

    @NotBlank(message = "Institute ID is required")
    private String instituteId;

    // Source selection flags (control which user sources to include)
    private Boolean includeInstituteUsers;     // If true, include institute enrolled users
    private Boolean includeAudienceRespondents; // If true, include audience campaign respondents

    // Audience/Campaign filters
    private CampaignFilterDTO campaignFilter;

    // User filters
    private UserFilterDTO userFilter;

    // Enrollment filters (same as Linked Course Contacts / v2 API)
    private List<String> statuses;
    private List<String> packageSessionIds;
    private List<String> paymentStatuses;
    private List<String> subOrgUserTypes;

    // Custom-field filters — same wire shape as the leads endpoint:
    // [{field_id, values}], OR within a field, AND across fields. A contact
    // matches when EITHER their learner (USER) answer or any of their lead
    // (AUDIENCE_RESPONSE) answers holds one of the values.
    private List<vacademy.io.admin_core_service.features.common.dto.CustomFieldListFilterDTO> customFieldFilters;

    // Campaign (UTM) attribution filter — same shape on every list surface.
    // A contact matches when any of their recorded touches (by user id, or by
    // the email / mobile a form captured) satisfies every dimension sent.
    private vacademy.io.admin_core_service.features.utm_attribution.dto.UtmListFilterDTO utmFilters;

    // Pagination
    private Integer page;
    private Integer size;
    private String sortBy;
    private String sortDirection;
    // When set: sort contacts by this custom field's value (latest learner
    // answer, falling back to the latest lead answer). Numeric-aware; contacts
    // without an answer sort last. sortDirection applies (default DESC).
    private String sortCustomFieldId;
}
