package vacademy.io.assessment_service.features.assessment.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.util.Date;

/**
 * {@code @DynamicUpdate}: a save writes only the columns that changed. Several
 * writers touch this row concurrently (the dispatcher, ai_service callbacks, the
 * sweeper, a teacher's stop), and a full-row UPDATE from one of them used to put
 * back whatever the others had just written - a progress callback could undo a
 * dispatch, a dispatch could undo a claim (gate G6).
 */
@Entity
@Table(name = "ai_evaluation_process")
@DynamicUpdate
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiEvaluationProcess {

        @Id
        @UuidGenerator
        @Column(name = "id")
        private String id;

        @ManyToOne(fetch = FetchType.LAZY)
        @JoinColumn(name = "attempt_id", nullable = false)
        private StudentAttempt studentAttempt;

        @ManyToOne(fetch = FetchType.LAZY)
        @JoinColumn(name = "assessment_id", nullable = false)
        private Assessment assessment;

        @ManyToOne(fetch = FetchType.LAZY)
        @JoinColumn(name = "set_id")
        private AssessmentSetMapping setMapping;

        @Column(name = "status", nullable = false, length = 50)
        private String status;

        @Column(name = "current_section_id", length = 36)
        private String currentSectionId;

        @Column(name = "current_question_index")
        private Integer currentQuestionIndex;

        @Column(name = "evaluation_json", columnDefinition = "TEXT")
        private String evaluationJson;

        @Column(name = "error_message", columnDefinition = "TEXT")
        private String errorMessage;

        @Column(name = "retry_count")
        private Integer retryCount;

        @Column(name = "current_step", length = 50)
        private String currentStep;

        @Column(name = "questions_completed")
        private Integer questionsCompleted;

        @Column(name = "questions_total")
        private Integer questionsTotal;

        @Column(name = "ai_service_job_id", length = 64)
        private String aiServiceJobId;

        @Column(name = "started_at")
        private Date startedAt;

        @Column(name = "completed_at")
        private Date completedAt;

        /**
         * Which instance picked this job up, and when (V43).
         *
         * Dispatch used to be a plain in-JVM @Async call, so a pod dying between the
         * INSERT and the work starting left the job PENDING until the sweeper noticed.
         * A claim lets any replica drain the queue, and claimedAt is what makes an
         * abandoned claim recoverable rather than permanent.
         */
        @Column(name = "claimed_by", length = 120)
        private String claimedBy;

        @Column(name = "claimed_at")
        private Date claimedAt;

        /** When the staff were told this check had settled (V48); NULL = not yet. */
        @Column(name = "notified_at")
        private Date notifiedAt;

        /** The teacher who pressed "Evaluate with AI"; NULL for automatic and bulk checks. */
        @Column(name = "triggered_by", length = 255)
        private String triggeredBy;

        /** The tenant the fair-share claim shares capacity out by (V52); set at enqueue. */
        @Column(name = "institute_id", length = 36)
        private String instituteId;

        /** COPY or TYPED ({@link vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane}); set at enqueue. */
        @Column(name = "lane", length = 8, nullable = false)
        private String lane;

        @Column(name = "page_count")
        private Integer pageCount;

        @Column(name = "quoted_credits", precision = 10, scale = 2)
        private BigDecimal quotedCredits;

        /** JSON, persisted as jsonb: the rate the quote was made at. */
        @JdbcTypeCode(SqlTypes.JSON)
        @Column(name = "rate_snapshot", columnDefinition = "jsonb")
        private String rateSnapshot;

        /** The partner API key that created this run; NULL for dashboard runs. */
        @Column(name = "api_key_id", length = 36)
        private String apiKeyId;

        @Column(name = "created_at", insertable = false, updatable = false)
        private Date createdAt;

        // A real heartbeat: every status/progress save moves it, so "no activity
        // for N minutes" can be read off this column. It used to be DB-default
        // only, which made a row's age its start time and a 200-copy bulk run
        // look stale while it was still queued.
        @UpdateTimestamp
        @Column(name = "updated_at")
        private Date updatedAt;

        /**
         * The column is NOT NULL DEFAULT 'COPY', but Hibernate lists every column in
         * the INSERT, so the DB default never fires; a row created without a lane
         * (any older code path) must still land in the COPY lane, not fail.
         */
        @PrePersist
        void defaultLane() {
                if (lane == null || lane.isBlank()) {
                        lane = "COPY";
                }
        }
}
