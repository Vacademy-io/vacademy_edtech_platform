package vacademy.io.admin_core_service.features.audience.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.sql.Timestamp;

/**
 * Stores computed lead score for each AudienceResponse.
 * raw_score is updated in real-time on every lead event.
 * percentile_rank is recalculated in batch every 15 minutes.
 */
@Entity
@Table(name = "lead_score")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LeadScore {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "audience_response_id", nullable = false, unique = true)
    private String audienceResponseId;

    @Column(name = "audience_id", nullable = false)
    private String audienceId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "raw_score", nullable = false)
    @Builder.Default
    private Integer rawScore = 0;

    @Column(name = "percentile_rank")
    @Builder.Default
    private BigDecimal percentileRank = new BigDecimal("50.00");

    @Column(name = "scoring_factors_json", columnDefinition = "TEXT")
    private String scoringFactorsJson;

    /** True when raw_score was set manually; auto-recalculation is skipped while this is true. */
    @Column(name = "is_manual_override")
    @Builder.Default
    private Boolean isManualOverride = false;

    @Column(name = "last_calculated_at", nullable = false)
    @Builder.Default
    private Timestamp lastCalculatedAt = new Timestamp(System.currentTimeMillis());

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    /**
     * LEGACY tier from rawScore using the fixed 80/50 thresholds. Prefer
     * {@code LeadTierService.deriveTier(getInstituteId(), getRawScore())}, which honours the
     * institute's own tier catalog; this stays only for callers with no institute context.
     */
    public String getTier() {
        return vacademy.io.admin_core_service.features.audience.service.LeadTierService
                .legacyTier(rawScore != null ? rawScore : 0);
    }
}
