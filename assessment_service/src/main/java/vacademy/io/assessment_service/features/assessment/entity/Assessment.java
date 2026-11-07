package vacademy.io.assessment_service.features.assessment.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Filter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;

@Entity
@Table(name = "assessment")
@Builder
@Getter
@Setter
@EqualsAndHashCode(of = "id")
@NoArgsConstructor
@AllArgsConstructor
public class Assessment {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "name", nullable = false)
    private String name;

    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "about_id", referencedColumnName = "id", insertable = true, updatable = true)
    private AssessmentRichTextData about;

    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "instructions_id", referencedColumnName = "id", insertable = true, updatable = true)
    private AssessmentRichTextData instructions;

    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "registration_instructions_id", referencedColumnName = "id", insertable = true, updatable = true)
    private AssessmentRichTextData registrationInstructions;

    @Column(name = "play_mode", nullable = false)
    private String playMode;

    @Column(name = "evaluation_type", nullable = false)
    private String evaluationType;

    /**
     * Evaluate every submission with AI, without a teacher pressing anything (V43).
     *
     * NULL means off. AI evaluation charges institute credits per graded question, so
     * this is deliberately opt-in: an assessment never starts spending on its own.
     * Independent of {@link #evaluationType} -- that decides how the AUTO scorer treats
     * the paper, this decides whether the AI grader is additionally enqueued on submit.
     */
    @Column(name = "ai_evaluation_enabled")
    private Boolean aiEvaluationEnabled;

    /** Preferred model for those runs. NULL falls back to the ai_service default. */
    @Column(name = "ai_evaluation_model")
    private String aiEvaluationModel;

    /**
     * Checked-copy template for AI-checked copies (V55): OUTSIDE = remarks in a
     * Teacher Comments panel beside the copy. NULL / INSIDE = written on the copy.
     */
    @Column(name = "copy_comment_placement")
    private String copyCommentPlacement;

    /**
     * How the AI checks this paper's copies (V59): subject, level, the institute's
     * marking instructions and the language-feedback choice, as JSON. See
     * {@link vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckConfig}.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "copy_check_config", columnDefinition = "jsonb")
    private String copyCheckConfig;

    /**
     * Proctoring tier + knobs as JSON (V50); see
     * {@link vacademy.io.assessment_service.features.proctoring.dto.ProctoringConfigDTO}.
     * NULL means off -- the behaviour of every assessment that predates it. Read and
     * written only through ProctoringConfigService.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "proctoring_config", columnDefinition = "jsonb")
    private String proctoringConfig;

    /**
     * OMR sheet settings as JSON (V60); see
     * {@link vacademy.io.assessment_service.features.assessment.omr.dto.OmrConfig}.
     * Only meaningful while {@link #omrMode} is on. Read and written only through
     * OmrSetService.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "omr_config", columnDefinition = "jsonb")
    private String omrConfig;

    @Column(name = "submission_type", nullable = false)
    private String submissionType;

    @Column(name = "source")
    private String source;

    @Column(name = "sourceId")
    private String sourceId;

    @Column(name = "duration")
    private Integer duration;

    @Column(name = "preview_time")
    private Integer previewTime;

    @Column(name = "duration_distribution")
    private String durationDistribution;

    @Column(name = "can_switch_section", nullable = false)
    private Boolean canSwitchSection;

    @Column(name = "can_request_reattempt", nullable = false)
    private Boolean canRequestReattempt;

    @Column(name = "can_request_time_increase", nullable = false)
    private Boolean canRequestTimeIncrease;

    @Column(name = "assessment_visibility", nullable = false)
    private String assessmentVisibility;

    @Column(name = "status", nullable = true)
    private String status;

    @Column(name = "registration_close_date")
    private Date registrationCloseDate;

    @Column(name = "registration_open_date")
    private Date registrationOpenDate;

    @Column(name = "expected_participants")
    private Integer expectedParticipants;

    @Column(name = "cover_file_id")
    private Integer coverFileId;

    @Column(name = "bound_start_time")
    private Date boundStartTime;

    @Column(name = "bound_end_time")
    private Date boundEndTime;

    @Column(name = "omr_mode")
    private Boolean omrMode;

    @Column(name = "result_type")
    private String resultType;

    @Column(name = "reattempt_count")
    private Integer reattemptCount;

    @OneToMany(mappedBy = "assessment")
    @Filter(name = "activeSections", condition = "active = :active")
    private Set<Section> sections = new HashSet<>();

    @OneToMany(mappedBy = "assessment", fetch = FetchType.LAZY)
    private Set<AssessmentUserRegistration> userRegistrations = new HashSet<>();

    @OneToMany(mappedBy = "assessment", fetch = FetchType.EAGER)
    private Set<AssessmentBatchRegistration> batchRegistrations = new HashSet<>();

    // Serialized straight to the client for both the admin's step-3 form builder and the
    // public registration page, so iteration order IS the form order. Without @OrderBy this
    // is a HashSet and the two screens show the fields in different, arbitrary orders —
    // the admin then reads that hash order as the real one and saves it back on any reorder.
    @OneToMany(mappedBy = "assessment", fetch = FetchType.LAZY)
    @OrderBy("fieldOrder ASC, createdAt ASC")
    private Set<AssessmentCustomField> assessmentCustomFields = new LinkedHashSet<>();

    @OneToMany(mappedBy = "assessment", fetch = FetchType.LAZY)
    private Set<AssessmentInstituteMapping> assessmentInstituteMappings = new HashSet<>();

    @OneToOne(mappedBy = "assessment")
    private AssessmentNotificationMetadata assessmentNotificationMetadata;

    @Column(name = "assessment_type")
    private String assessmentType;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}