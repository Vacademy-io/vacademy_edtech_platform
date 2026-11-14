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

import java.math.BigDecimal;
import java.sql.Timestamp;

/** One learner's attempt at one item. Unique on (item_id, user_id). */
@Entity
@Table(name = "engagement_attempt")
@Getter
@Setter
@NoArgsConstructor
public class EngagementAttempt {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "item_id", nullable = false)
    private String itemId;

    @Column(name = "item_version", nullable = false)
    private Integer itemVersion = 1;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "package_session_id", nullable = false)
    private String packageSessionId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "is_correct")
    private Boolean isCorrect;

    @Column(name = "score")
    private BigDecimal score;

    @Column(name = "max_score")
    private BigDecimal maxScore;

    @Column(name = "response_json", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String responseJson;

    @Column(name = "time_spent_ms")
    private Long timeSpentMs;

    @Column(name = "points_awarded", nullable = false)
    private Integer pointsAwarded = 0;

    /** Completed under catch-up. Recovers points; never repairs a streak. */
    @Column(name = "is_late", nullable = false)
    private Boolean isLate = false;

    @Column(name = "is_verified", nullable = false)
    private Boolean isVerified = false;

    @Column(name = "started_at")
    private Timestamp startedAt;

    @Column(name = "completed_at")
    private Timestamp completedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
