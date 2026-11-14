package vacademy.io.admin_core_service.features.audience.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * A per-institute lead tier (e.g. Hot / Warm / Cold, or an Eduzilla-style
 * "Interest Level": Very Cold … Super Hot). Replaces the hard-coded
 * HOT/WARM/COLD vocabulary so institutes can rename, recolour and add tiers.
 *
 * <p>A tier with a {@code minScore} is auto-derived from the lead's best score
 * (highest band whose minScore <= score wins); a tier without one is
 * manual-only — counsellors pick it, the score never assigns it.</p>
 */
@Entity
@Table(name = "lead_tier")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LeadTier {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Stable code stored on user_lead_profile.lead_tier (e.g. HOT, SUPER_HOT). */
    @Column(name = "tier_key", nullable = false, length = 100)
    private String tierKey;

    @Column(name = "label", nullable = false)
    private String label;

    @Column(name = "color", length = 20)
    private String color;

    /** 1 = most important. Drives tier sort order and lead-board column order. */
    @Column(name = "display_order", nullable = false)
    @Builder.Default
    private Integer displayOrder = 0;

    /** Lower bound of the score band; null = manual-only tier. */
    @Column(name = "min_score")
    private Integer minScore;

    /** Soft delete — kept so leads already carrying this tier still resolve. */
    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = true;

    /** Seeded default (Hot/Warm/Cold): editable but not deletable. */
    @Column(name = "is_system", nullable = false)
    @Builder.Default
    private Boolean isSystem = false;

    /** User who created the row; null for rows seeded by the system. */
    @Column(name = "created_by")
    private String createdBy;

    /** User who last changed the row. */
    @Column(name = "updated_by")
    private String updatedBy;

    /** User who soft-deleted the row; cleared if it is reactivated. */
    @Column(name = "deleted_by")
    private String deletedBy;

    @Column(name = "deleted_at")
    private Timestamp deletedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
