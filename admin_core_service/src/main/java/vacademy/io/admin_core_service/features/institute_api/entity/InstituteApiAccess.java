package vacademy.io.admin_core_service.features.institute_api.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Per (institute, product) enablement and limits for partner APIs (spec 6.1).
 * Written by platform staff only (super-admin endpoints); read by the key verify path.
 */
@Entity
@Table(name = "institute_api_access")
@IdClass(InstituteApiAccessId.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InstituteApiAccess {

    public static final int DEFAULT_DAILY_COPY_QUOTA = 2000;
    public static final int DEFAULT_DAILY_IDENTIFY_PAGES = 5000;
    public static final int DEFAULT_DAILY_RUBRIC_GENERATIONS = 200;
    public static final String DEFAULT_RATE_TIER = "standard";

    @Id
    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Id
    @Column(name = "product", nullable = false, length = 32)
    private String product;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    /** school | university | upsc; NULL = no preset. */
    @Column(name = "segment", length = 16)
    private String segment;

    @Column(name = "rate_tier", nullable = false, length = 16)
    private String rateTier;

    @Column(name = "daily_copy_quota", nullable = false)
    private int dailyCopyQuota;

    @Column(name = "daily_identify_pages", nullable = false)
    private int dailyIdentifyPages;

    @Column(name = "daily_rubric_generations", nullable = false)
    private int dailyRubricGenerations;

    /** NULL = platform default. */
    @Column(name = "copy_lane_cap")
    private Integer copyLaneCap;

    @Column(name = "typed_lane_cap")
    private Integer typedLaneCap;

    /** Allowed overdraft in credits (postpaid contracts). */
    @Column(name = "credit_limit", nullable = false, precision = 12, scale = 2)
    private BigDecimal creditLimit;

    @Column(name = "fire_workflow_events", nullable = false)
    private boolean fireWorkflowEvents;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    @Column(name = "updated_by", nullable = false)
    private String updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** A not-yet-saved row carrying the table defaults. */
    public static InstituteApiAccess defaults(String instituteId, String product) {
        return InstituteApiAccess.builder()
                .instituteId(instituteId)
                .product(product)
                .enabled(false)
                .rateTier(DEFAULT_RATE_TIER)
                .dailyCopyQuota(DEFAULT_DAILY_COPY_QUOTA)
                .dailyIdentifyPages(DEFAULT_DAILY_IDENTIFY_PAGES)
                .dailyRubricGenerations(DEFAULT_DAILY_RUBRIC_GENERATIONS)
                .creditLimit(BigDecimal.ZERO)
                .fireWorkflowEvents(false)
                .build();
    }
}
