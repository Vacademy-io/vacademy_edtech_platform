package vacademy.io.admin_core_service.features.audience.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/**
 * Which lead list one ad campaign's leads go to, for one connector (see V563).
 * {@code audienceId} null = not mapped yet: the lead goes to the connector's own
 * audience, the catch-all.
 */
@Entity
@Table(name = "ad_campaign_route")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AdCampaignRoute {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "connector_id", nullable = false)
    private String connectorId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Google: the numeric campaign_id from the lead form webhook. */
    @Column(name = "campaign_id", nullable = false, length = 64)
    private String campaignId;

    @Column(name = "audience_id")
    private String audienceId;

    /** Admin-entered campaign name (Google's webhook sends only the id). Names the auto-created list. */
    @Column(name = "campaign_name")
    private String campaignName;

    @Column(name = "lead_count", nullable = false)
    @Builder.Default
    private Integer leadCount = 0;

    @Column(name = "first_lead_at")
    private LocalDateTime firstLeadAt;

    @Column(name = "last_lead_at")
    private LocalDateTime lastLeadAt;

    /** Mapped by an admin before the campaign's first lead arrived. */
    @Column(name = "added_manually", nullable = false)
    @Builder.Default
    private Boolean addedManually = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
