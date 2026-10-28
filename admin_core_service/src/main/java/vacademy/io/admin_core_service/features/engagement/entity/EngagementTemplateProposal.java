package vacademy.io.admin_core_service.features.engagement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * One proposed WhatsApp template in the D8 negotiation loop (design §9). AI proposes → human
 * confirms → Meta adjudicates. This row is the state machine's memory; {@code status} is its state.
 *
 * The template can only ever be sent once Meta approves it, and Meta may reject or silently
 * re-categorise it (utility→marketing) — both of which demand human review, so both are
 * first-class states here, not error paths.
 *
 * {@code @DynamicUpdate}: saving a managed row writes only the columns changed in memory, so a stale
 * {@code status} nobody touched is not written back over a CAS transition (see the repository).
 */
@Entity
@Table(name = "engagement_template_proposal")
@DynamicUpdate
@Getter
@Setter
public class EngagementTemplateProposal {

    @Id
    @Column(length = 255, nullable = false)
    @UuidGenerator
    private String id;

    @Column(name = "engine_id", nullable = false)
    private String engineId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** FK into notification_service's notification_template, set the moment a draft is created there. */
    @Column(name = "notification_template_id")
    private String notificationTemplateId;

    /** The Meta-registered template name (lowercase/underscore, uniqueness-suffixed) — what a send uses. */
    private String name;

    /** en | hi (hinglish is authored under Meta code en with Latin-script Hindi body). */
    @Column(length = 10)
    private String language;

    @Column(name = "proposed_body", columnDefinition = "TEXT", nullable = false)
    private String proposedBody;

    /** AI proposes; a human ALWAYS confirms. MARKETING | UTILITY | AUTHENTICATION. */
    @Column(name = "proposed_category", nullable = false, length = 20)
    private String proposedCategory;

    /** What Meta actually assigned — may differ from proposed (re-categorisation → review). */
    @Column(name = "meta_category", length = 20)
    private String metaCategory;

    /**
     * AI_PROPOSED | USER_REVIEW | USER_APPROVED | SUBMITTED | META_PENDING |
     * META_APPROVED | META_REJECTED | META_RECATEGORISED | SUPERSEDED | WITHDRAWN
     */
    @Column(nullable = false, length = 30)
    private String status = "AI_PROPOSED";

    @Column(name = "rejection_reason", columnDefinition = "TEXT")
    private String rejectionReason;

    /** Negotiation round: alternatives requested after a rejection bump this. */
    @Column(nullable = false)
    private Integer round = 1;

    /** Ordered semantic variable names; position i ↔ WhatsApp {{i+1}}. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "variable_names", columnDefinition = "jsonb", nullable = false)
    private String variableNames = "[]";

    /** One example per variable (same order/length as variableNames) — Meta requires body samples. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "sample_values", columnDefinition = "jsonb", nullable = false)
    private String sampleValues = "[]";

    /** {variableName: source} — see templates.TemplateVariableSources (V617). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "variable_sources", columnDefinition = "jsonb", nullable = false)
    private String variableSources = "{}";

    /** What the template is for ("first touch", "missed class"), shown to reviewers (V617). */
    @Column(length = 120)
    private String purpose;

    @Column(name = "footer_text", length = 60)
    private String footerText;

    @Column(columnDefinition = "TEXT")
    private String rationale;

    @Column(name = "created_by")
    private String createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}
