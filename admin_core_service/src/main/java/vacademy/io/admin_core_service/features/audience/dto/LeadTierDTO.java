package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.audience.entity.LeadTier;

/**
 * API shape for a lead tier. Snake-cased so the frontend reads
 * tier_key / display_order / min_score / is_active / is_system.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadTierDTO {
    private String id;
    private String instituteId;
    private String tierKey;
    private String label;
    private String color;
    private Integer displayOrder;
    /** Lower bound of the auto-derive band; null = manual-only tier. */
    private Integer minScore;
    private Boolean isActive;
    private Boolean isSystem;
    /** Audit trail — who created / last changed / deleted the row (read-only). */
    private String createdBy;
    private String updatedBy;
    private String deletedBy;

    public static LeadTierDTO from(LeadTier t) {
        return LeadTierDTO.builder()
                .id(t.getId())
                .instituteId(t.getInstituteId())
                .tierKey(t.getTierKey())
                .label(t.getLabel())
                .color(t.getColor())
                .displayOrder(t.getDisplayOrder())
                .minScore(t.getMinScore())
                .isActive(t.getIsActive())
                .isSystem(t.getIsSystem())
                .createdBy(t.getCreatedBy())
                .updatedBy(t.getUpdatedBy())
                .deletedBy(t.getDeletedBy())
                .build();
    }
}
