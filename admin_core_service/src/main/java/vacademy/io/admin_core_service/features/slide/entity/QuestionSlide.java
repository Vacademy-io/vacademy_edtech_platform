package vacademy.io.admin_core_service.features.slide.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.common.entity.RichTextData;
import vacademy.io.admin_core_service.features.slide.dto.QuestionSlideDTO;

import java.sql.Timestamp;
import java.util.List;
import java.util.stream.Collectors;

@Entity
@Table(name = "question_slide")
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class QuestionSlide {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    // Foreign Keys
    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "parent_rich_text_id", referencedColumnName = "id")
    private RichTextData parentRichText;

    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "text_id", referencedColumnName = "id")
    private RichTextData textData;

    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "explanation_text_id", referencedColumnName = "id")
    private RichTextData explanationTextData;

    // Other Columns
    @Column(name = "media_id")
    private String mediaId;

    @Column(name = "question_response_type")
    private String questionResponseType;

    @Column(name = "question_type")
    private String questionType;

    @Column(name = "access_level")
    private String accessLevel;

    @Column(name = "auto_evaluation_json")
    private String autoEvaluationJson;

    @Column(name = "evaluation_type")
    private String evaluationType;

    @Column(name = "default_question_time_mins")
    private Integer defaultQuestionTimeMins;

    @Column(name = "re_attempt_count")
    private Integer reAttemptCount;

    @Column(name = "points")
    private Integer points;

    // Timestamps
    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    @OneToMany(mappedBy = "questionSlide", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Option> options;

    @Column(name = "source_type")
    private String sourceType;

    /**
     * CBE_RESPONSE only: the model solution, marking scheme and grading notes, kept out of
     * {@link #autoEvaluationJson} (which learners receive). Never selected by the native
     * slide JSON queries; see QuestionSlideEvaluationSecretService.
     */
    @Column(name = "evaluation_secret_json", columnDefinition = "TEXT")
    private String evaluationSecretJson;

    public QuestionSlide(QuestionSlideDTO dto) {
        this.id = dto.getId();

        if (dto.getParentRichText() != null) {
            this.parentRichText = new RichTextData(dto.getParentRichText());
        }

        if (dto.getTextData() != null) {
            this.textData = new RichTextData(dto.getTextData());
        }

        if (dto.getExplanationTextData() != null) {
            this.explanationTextData = new RichTextData(dto.getExplanationTextData());
        }

        this.mediaId = dto.getMediaId();
        this.questionResponseType = dto.getQuestionResponseType();
        this.questionType = dto.getQuestionType();
        this.accessLevel = dto.getAccessLevel();
        this.autoEvaluationJson = dto.getAutoEvaluationJson();
        this.evaluationType = dto.getEvaluationType();
        this.defaultQuestionTimeMins = dto.getDefaultQuestionTimeMins();
        this.reAttemptCount = dto.getReAttemptCount();
        this.points = dto.getPoints();
        this.sourceType = dto.getSourceType();
        this.evaluationSecretJson = dto.getEvaluationSecretJson();

        if (dto.getOptions() != null) {
            this.options = dto.getOptions().stream()
                    .map(optionDTO -> new Option(optionDTO, this))
                    .collect(Collectors.toList());
        }
    }

}
