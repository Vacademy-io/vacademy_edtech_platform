package vacademy.io.assessment_service.features.proctoring.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.util.Date;

/**
 * One signal the learner's device reported during an attempt (V50).
 * <p>
 * Append-only. Not joined to {@code StudentAttempt} on purpose: this table must
 * never be loaded by the grading or report paths, and a plain id keeps it that
 * way. Evidence is a media_service file id; bytes never land here.
 */
@Entity
@Table(name = "attempt_proctor_event")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AttemptProctorEvent {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "attempt_id", nullable = false)
    private String attemptId;

    @Column(name = "assessment_id", nullable = false)
    private String assessmentId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "event_type", nullable = false)
    private String eventType;

    @Column(name = "severity", nullable = false)
    private String severity;

    @Column(name = "occurred_at", nullable = false)
    private Date occurredAt;

    @CreationTimestamp
    @Column(name = "received_at", updatable = false)
    private Date receivedAt;

    @Column(name = "evidence_file_id")
    private String evidenceFileId;

    /** JSON, persisted as jsonb. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "meta", columnDefinition = "jsonb")
    private String meta;
}
