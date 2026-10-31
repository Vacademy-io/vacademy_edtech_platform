package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;

/**
 * API shape for a lead pipeline status. Snake-cased so the frontend reads
 * status_key / display_order / is_default / is_active.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadStatusDTO {
    private String id;
    private String instituteId;
    private String statusKey;
    private String label;
    private String color;
    private Integer displayOrder;
    private Boolean isDefault;
    private Boolean isActive;
    /** Offered in the Lead Status filter dropdowns. Null on update = leave unchanged. */
    private Boolean showInFilter;
    private Boolean isSystem;
    /** Audit trail — who created / last changed / deleted the row (read-only). */
    private String createdBy;
    private String updatedBy;
    private String deletedBy;

    public static LeadStatusDTO from(LeadStatus s) {
        return LeadStatusDTO.builder()
                .id(s.getId())
                .instituteId(s.getInstituteId())
                .statusKey(s.getStatusKey())
                .label(s.getLabel())
                .color(s.getColor())
                .displayOrder(s.getDisplayOrder())
                .isDefault(s.getIsDefault())
                .isActive(s.getIsActive())
                .showInFilter(s.getShowInFilter())
                .isSystem(s.getIsSystem())
                .createdBy(s.getCreatedBy())
                .updatedBy(s.getUpdatedBy())
                .deletedBy(s.getDeletedBy())
                .build();
    }
}
