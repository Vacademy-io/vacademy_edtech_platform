package vacademy.io.assessment_service.features.question_core.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "question")
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class Question {

    @Id
    @Column(name = "id", nullable = false)
    @UuidGenerator
    private String id;

    @Column(name = "media_id")
    private String mediaId;

    // One-to-One mapping with AssessmentRichTextData for parent_rich_text_id
    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "parent_rich_text_id", referencedColumnName = "id", insertable = true, updatable = true)
    private AssessmentRichTextData parentRichText;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    @Column(name = "question_response_type", nullable = false)
    private String questionResponseType;

    @Column(name = "question_type", nullable = false)
    private String questionType;

    @Column(name = "access_level", nullable = false)
    private String accessLevel;

    @Column(name = "auto_evaluation_json")
    private String autoEvaluationJson;

    @Column(name = "options_json")
    private String optionsJson;

    @Column(name = "evaluation_type")
    private String evaluationType;

    @Column(name = "status")
    private String status;

    @Column(name = "difficulty")
    private String difficulty;

    @Column(name = "problem_type")
    private String problemType;

    @Column(name = "default_question_time_mins")
    private Integer defaultQuestionTimeMins;

    /** Owning institute (V42). Nullable: public/community questions have none. */
    @Column(name = "institute_id")
    private String instituteId;

    /** MANUAL | UPLOAD | AI | KNOWLEDGE_BASE (V42). */
    @Column(name = "source_type")
    private String sourceType;

    /**
     * Where this question came from, as JSON (V42). For a knowledge-base question:
     * kb_id, node_ids, topic, source_page, generation_id, figures. Kept as a string
     * here — nothing in Java reads inside it; the browse query filters it in Postgres.
     */
    @Column(name = "source_meta", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String sourceMeta;

    // One-to-One mapping with AssessmentRichTextData for text_id
    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "text_id", referencedColumnName = "id", insertable = true, updatable = true)
    private AssessmentRichTextData textData;

    // One-to-One mapping with AssessmentRichTextData for explanation_text_id
    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "explanation_text_id", referencedColumnName = "id", insertable = true, updatable = true)
    private AssessmentRichTextData explanationTextData;

    // AI Evaluation criteria fields
    @Column(name = "evaluation_criteria_json", columnDefinition = "TEXT")
    private String evaluationCriteriaJson;

    @Column(name = "criteria_template_id", length = 36)
    private String criteriaTemplateId;

    @OneToMany(mappedBy = "question", fetch = FetchType.LAZY)
    private List<Option> options = new ArrayList<>();

    public Question(QuestionDTO questionDTO) {
        this.id = questionDTO.getId();
        this.mediaId = questionDTO.getMediaId();
        this.createdAt = (Timestamp) questionDTO.getCreatedAt();
        this.updatedAt = (Timestamp) questionDTO.getUpdatedAt();
        this.questionResponseType = questionDTO.getQuestionResponseType();
        this.questionType = questionDTO.getQuestionType();
        this.accessLevel = questionDTO.getAccessLevel();
        this.autoEvaluationJson = questionDTO.getAutoEvaluationJson();
        this.evaluationType = questionDTO.getEvaluationType();
        this.defaultQuestionTimeMins = questionDTO.getDefaultQuestionTimeMins();
        this.textData = AssessmentRichTextData.fromDTO(questionDTO.getText());
        this.explanationTextData = AssessmentRichTextData.fromDTO(questionDTO.getExplanationText());
        this.parentRichText = AssessmentRichTextData.fromDTO(questionDTO.getParentRichText());
        this.optionsJson = questionDTO.getOptionsJson();
        this.evaluationCriteriaJson = questionDTO.getEvaluationCriteriaJson();
        this.criteriaTemplateId = questionDTO.getCriteriaTemplateId();
        // These three were silently dropped by this constructor, so any path building a
        // Question from a DTO here (rather than through the import manager's
        // initializeQuestion) lost the question's difficulty and problem type.
        this.difficulty = questionDTO.getAiDifficultyLevel();
        this.problemType = questionDTO.getProblemType();
        this.instituteId = questionDTO.getInstituteId();
        this.sourceType = questionDTO.getSourceType();
        this.sourceMeta = questionDTO.getSourceMeta();
    }

    public Question(String id) {
        this.id = id;
    }
}