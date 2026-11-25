package vacademy.io.assessment_service.features.assessment.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Data;
import lombok.EqualsAndHashCode;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

@Entity
@Table(name = "student_attempt")
@Data
@EqualsAndHashCode(of = "id")
public class StudentAttempt {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne
    @JoinColumn(name = "registration_id")
    @JsonIgnore
    private AssessmentUserRegistration registration;

    @Column(name = "attempt_number", nullable = false)
    private Integer attemptNumber;

    @Column(name = "start_time", nullable = false)
    private Date startTime;

    @Column(name = "submit_time")
    private Date submitTime;

    @Column(name = "preview_start_time")
    private Date previewStartTime;

    /**
     * Minutes allowed for this attempt. Written on insert only: entity saves never update it.
     * The live autosave and its async marks pass save the whole row from a copy loaded seconds
     * earlier, so an admin's extra time added in between would be silently put back. Change it
     * through StudentAttemptRepository.addMinutesToLiveAttempt / overwriteMaxTime instead.
     */
    @Column(name = "max_time", nullable = false, updatable = false)
    private Integer maxTime;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "attempt_data")
    private String attemptData;

    @Column(name = "submit_data")
    private String submitData;

    @Column(name = "server_last_sync")
    private Date serverLastSync;

    @Column(name = "client_last_sync")
    private Date clientLastSync;

    @Column(name = "duration_distribution_json")
    private String durationDistributionJson;

    @Column(name = "total_marks")
    private Double totalMarks;

    @Column(name = "total_time_in_seconds")
    private Long totalTimeInSeconds;

    @Column(name = "result_marks")
    private Double resultMarks;

    @Column(name = "result_status")
    private String resultStatus;

    @Column(name = "report_release_status")
    private String reportReleaseStatus;

    @Column(name = "report_last_release_date")
    private Date reportLastReleaseDate;

    // Which content locale the attempt was served in (i18n Phase 1). Nullable,
    // additive: legacy rows and pre-i18n clients keep NULL (canonical English).
    @Column(name = "content_locale")
    private String contentLocale;

    @ManyToOne
    @JoinColumn(name = "set_id")
    private AssessmentSetMapping assessmentSetMapping;

    @Column(name = "comma_separated_evaluator_user_ids")
    private String commaSeparatedEvaluatorUserIds;

    @Column(name = "evaluated_file_id")
    private String evaluatedFileId;

    @Column(name = "report_pdf_file_id")
    private String reportPdfFileId;

    // Submission review (V74). Read-only here: many paths save an attempt entity loaded
    // long before (async revaluate, the release render loop, autosave) and would reset
    // these. They are written only by targeted UPDATEs (submission_review MarkWriter /
    // SubmissionReleaseService).
    @Column(name = "marks_revision", insertable = false, updatable = false)
    private Integer marksRevision;

    @Column(name = "notified_revision", insertable = false, updatable = false)
    private Integer notifiedRevision;

    @Column(name = "result_revised_at", insertable = false, updatable = false)
    private Date resultRevisedAt;

    @Column(name = "release_when_marked", insertable = false, updatable = false)
    private Boolean releaseWhenMarked;

    // "Hide result again": set by the withdraw, cleared by a teacher's release. Automatic
    // releases (cron, submit-time, re-mark, release-when-marked on submit) skip it.
    @Column(name = "result_withheld_at", insertable = false, updatable = false)
    private Date resultWithheldAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}