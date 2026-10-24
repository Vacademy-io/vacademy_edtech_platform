package vacademy.io.assessment_service.features.assessment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.UUID;

/**
 * The one AI-written class analysis for an assessment: generated once, charged
 * once, re-served free afterwards.
 *
 * <p>The row is also the concurrency gate. It is claimed as
 * {@link #STATUS_GENERATING} before the model call, so a second admin clicking
 * Generate finds it taken instead of making a second (real-money) model call.
 */
@Entity
@Table(name = "assessment_class_ai_analysis")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssessmentClassAiAnalysis {

    public static final String STATUS_GENERATING = "GENERATING";
    public static final String STATUS_READY = "READY";
    public static final String STATUS_FAILED = "FAILED";

    public static final String CHARGE_PENDING = "PENDING";
    public static final String CHARGE_CHARGED = "CHARGED";
    public static final String CHARGE_FAILED = "FAILED";

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "assessment_id", nullable = false)
    private String assessmentId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "status", nullable = false)
    private String status;

    /** The model's JSON. Source of truth — the PDF is re-renderable from it. */
    @Column(name = "analysis_json")
    private String analysisJson;

    @Column(name = "pdf_file_id")
    private String pdfFileId;

    @Column(name = "content_fingerprint")
    private String contentFingerprint;

    @Column(name = "model")
    private String model;

    /**
     * The ROW id, prefixed. Never the assessment id — ai_service short-circuits
     * a deduction whose key it has seen, so keying on the assessment would make
     * every future paid regenerate a silent free no-op.
     */
    @Column(name = "idempotency_key")
    private String idempotencyKey;

    @Column(name = "charge_status", nullable = false)
    private String chargeStatus;

    /** What the admin was quoted and therefore what they are billed. */
    @Column(name = "credits_quoted")
    private BigDecimal creditsQuoted;

    @Column(name = "generated_by_user_id")
    private String generatedByUserId;

    @Column(name = "claimed_at")
    private Timestamp claimedAt;

    @Column(name = "generated_at")
    private Timestamp generatedAt;

    /**
     * Set when a paid Refresh replaces this report. Non-null rows are history:
     * still downloadable, but no longer the live one — and deliberately outside
     * the partial unique index, so they cannot block a new claim.
     */
    @Column(name = "superseded_at")
    private Timestamp supersededAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;

    @PrePersist
    public void prePersist() {
        if (id == null) id = UUID.randomUUID().toString();
        if (chargeStatus == null) chargeStatus = CHARGE_PENDING;
        updatedAt = new Timestamp(System.currentTimeMillis());
    }

    @PreUpdate
    public void preUpdate() {
        updatedAt = new Timestamp(System.currentTimeMillis());
    }

    public boolean isReady() {
        return STATUS_READY.equalsIgnoreCase(status);
    }

    public boolean isGenerating() {
        return STATUS_GENERATING.equalsIgnoreCase(status);
    }
}
