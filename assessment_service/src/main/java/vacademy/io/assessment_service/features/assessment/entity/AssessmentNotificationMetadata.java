package vacademy.io.assessment_service.features.assessment.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

@Entity
@Table(name = "assessment_notification_metadata")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssessmentNotificationMetadata {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne
    @JoinColumn(name = "assessment_id")
    @JsonIgnore
    private Assessment assessment;

    @Column(name = "participant_when_assessment_created", nullable = false)
    private boolean participantWhenAssessmentCreated;

    @Column(name = "participant_show_leaderboard", nullable = false)
    private boolean participantShowLeaderboard;

    @Column(name = "participant_before_assessment_goes_live", nullable = false)
    private Integer participantBeforeAssessmentGoesLive;

    @Column(name = "participant_when_assessment_live", nullable = false)
    private boolean participantWhenAssessmentLive;

    @Column(name = "parent_when_assessment_created", nullable = false)
    private boolean parentWhenAssessmentCreated;

    @Column(name = "parent_show_leaderboard", nullable = false)
    private boolean parentShowLeaderboard;

    @Column(name = "parent_before_assessment_goes_live", nullable = false)
    private Integer parentBeforeAssessmentGoesLive;

    @Column(name = "parent_when_assessment_live", nullable = false)
    private boolean parentWhenAssessmentLive;

    @Column(name = "when_student_appears")
    private boolean whenStudentAppears;

    @Column(name = "when_student_finishes_test")
    private boolean whenStudentFinishesTest;

    @Column(name = "participant_when_assessment_report_generated", nullable = false)
    private boolean participantWhenAssessmentReportGenerated;

    @Column(name = "parent_when_assessment_report_generated", nullable = false)
    private boolean parentWhenAssessmentReportGenerated;

    /**
     * Start time the "starts in N minutes" email already went out for (null = not sent).
     * Written only by the claim UPDATE in the repository — read-only here so re-saving the
     * notification settings in Step 3 can never clear or rewind it.
     */
    @JsonIgnore
    @Column(name = "participant_reminder_sent_for", insertable = false, updatable = false)
    private Date participantReminderSentFor;

    /** Start time the "assessment is live" email already went out for. Same rules as above. */
    @JsonIgnore
    @Column(name = "participant_live_sent_for", insertable = false, updatable = false)
    private Date participantLiveSentFor;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
