package vacademy.io.assessment_service.features.assessment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/**
 * A learner asking for another attempt (or more time) on an assessment.
 *
 * <p>Kept deliberately flat rather than joined to {@code AssessmentUserRegistration}: the
 * request is raised from inside the live exam shell, which knows the assessment and the user
 * but not always the registration row, and a learner who is watching a timer run out should
 * never have their request rejected because a lookup missed. {@code registrationId} is
 * resolved on the review path instead, where the admin's grant needs it.
 */
@Entity
@Table(name = "assessment_reattempt_request")
@Getter
@Setter
@Builder
@AllArgsConstructor
@NoArgsConstructor
@EqualsAndHashCode(of = "id")
public class AssessmentReattemptRequest {

    public static final String TYPE_REATTEMPT = "REATTEMPT";
    public static final String TYPE_TIME_INCREASE = "TIME_INCREASE";
    /** A learner reporting a problem with a question (or the exam) from inside the live test. */
    public static final String TYPE_PROBLEM_REPORT = "PROBLEM_REPORT";

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_APPROVED = "APPROVED";
    public static final String STATUS_REJECTED = "REJECTED";
    /** How an admin closes a {@link #TYPE_PROBLEM_REPORT}; nothing is granted. */
    public static final String STATUS_RESOLVED = "RESOLVED";

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "assessment_id", nullable = false)
    private String assessmentId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "registration_id")
    private String registrationId;

    @Column(name = "attempt_id")
    private String attemptId;

    /** {@link #TYPE_REATTEMPT}, {@link #TYPE_TIME_INCREASE} or {@link #TYPE_PROBLEM_REPORT}. */
    @Column(name = "request_type", nullable = false)
    private String requestType;

    @Column(name = "reason")
    private String reason;

    /**
     * The question a {@link #TYPE_PROBLEM_REPORT} is about. Null for the other types, and for a
     * report whose question could not be matched to this assessment.
     */
    @Column(name = "question_id")
    private String questionId;

    /**
     * {@link #STATUS_PENDING}, {@link #STATUS_APPROVED}, {@link #STATUS_REJECTED} or
     * {@link #STATUS_RESOLVED} (problem reports only).
     */
    @Column(name = "status", nullable = false)
    private String status;

    /** Attempts actually granted on approval — an admin may give fewer than were asked for. */
    @Column(name = "granted_count")
    private Integer grantedCount;

    @Column(name = "reviewed_by")
    private String reviewedBy;

    @Column(name = "review_note")
    private String reviewNote;

    @Column(name = "reviewed_at")
    private Date reviewedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
