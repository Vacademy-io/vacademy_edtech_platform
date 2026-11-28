package vacademy.io.admin_core_service.features.engagement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.sql.Timestamp;

/** One card a learner sees inside a slot. */
@Entity
@Table(name = "engagement_item")
@Getter
@Setter
@NoArgsConstructor
public class EngagementItem {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "slot_id", nullable = false)
    private String slotId;

    @Column(name = "item_type", nullable = false)
    private String itemType;

    @Column(name = "title", nullable = false)
    private String title;

    /**
     * Bumped when an already-open item with attempts is edited. Attempts pin to the
     * version they were made against, so a mid-day correction cannot retroactively
     * invalidate the morning's scores.
     */
    @Column(name = "version", nullable = false)
    private Integer version = 1;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(name = "is_required", nullable = false)
    private Boolean isRequired = false;

    @Column(name = "content_html", columnDefinition = "TEXT")
    private String contentHtml;

    @Column(name = "slide_id")
    private String slideId;

    @Column(name = "question_id")
    private String questionId;

    @Column(name = "assessment_id")
    private String assessmentId;

    @Column(name = "payload_json", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String payloadJson;

    @Column(name = "completion_points", nullable = false)
    private Integer completionPoints = 0;

    @Column(name = "correct_points", nullable = false)
    private Integer correctPoints = 0;

    /** Ceiling a reported score is clamped to. */
    @Column(name = "max_score")
    private Integer maxScore;

    /**
     * TRUE only when the server holds the answer key. Teacher-uploaded games are
     * FALSE — the page reports its own score and cannot be trusted to be honest.
     */
    @Column(name = "is_verifiable", nullable = false)
    private Boolean isVerifiable = false;

    /**
     * Keep the outcome hidden until the slot's reveal time.
     *
     * With the result shown at submit, early answerers learn the answer and can pass
     * it on before the reveal. When this is on, the correctness bonus is withheld too
     * and awarded by the reveal sweep — a learner who saw the bonus land would know
     * they were right without being told.
     */
    @Column(name = "hide_result_until_reveal", nullable = false)
    private Boolean hideResultUntilReveal = false;

    /** NULL = inherit the plan default. */
    @Column(name = "miss_policy")
    private String missPolicy;

    @Column(name = "catch_up_days")
    private Integer catchUpDays;

    @Column(name = "catch_up_percent")
    private Integer catchUpPercent;

    @Column(name = "status", nullable = false)
    private String status = EngagementEnums.ItemStatus.ACTIVE.name();

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
