package vacademy.io.assessment_service.features.learner_assessment.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.util.Date;

@Entity
@Table(name = "question_wise_marks")
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class QuestionWiseMarks {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne
    @JoinColumn(name = "assessment_id")
    @JsonIgnore
    private Assessment assessment;

    @ManyToOne
    @JoinColumn(name = "attempt_id")
    @JsonIgnore
    private StudentAttempt studentAttempt;

    @ManyToOne
    @JoinColumn(name = "question_id")
    @JsonIgnore
    private Question question;

    @Column(name = "marks")
    private double marks;

    @Column(name = "status")
    private String status;

    @Column(name = "time_taken_in_seconds")
    private Long timeTakenInSeconds;

    @Column(name = "response_json")
    private String responseJson;

    @ManyToOne
    @JoinColumn(name = "section_id")
    @JsonIgnore
    private Section section;

    @Column(name = "section_id", insertable = false, updatable = false)
    private String sectionId;

    // AI Evaluation fields
    @Column(name = "ai_evaluated_at")
    private Date aiEvaluatedAt;

    @Column(name = "ai_evaluation_details_json", columnDefinition = "TEXT")
    private String aiEvaluationDetailsJson;

    @Column(name = "evaluator_feedback", columnDefinition = "TEXT")
    private String evaluatorFeedback;

    // How this mark was produced: AI, AI_REVIEWED (AI graded, teacher edited),
    // MANUAL, or AUTO. Null on legacy rows written before this column existed.
    @Column(name = "marks_source")
    private String marksSource;

    // Submission review (V73). mark_state NULL = a legacy row whose state is derived
    // on read (submission_review MarkStateDeriver).
    @Column(name = "mark_state")
    private String markState;

    /** The question's maximum when this mark was written (snapshot). */
    @Column(name = "max_marks")
    private Double maxMarks;

    /** User id of whoever set this mark (null for the answer key / AI). */
    @Column(name = "marked_by")
    private String markedBy;

    @Column(name = "marked_at")
    private Date markedAt;

    /** Bumped on every change of the mark; the optimistic check behind "edited elsewhere". */
    @Builder.Default
    @Column(name = "revision", nullable = false)
    private int revision = 0;

    @Column(name = "ai_question_evaluation_id")
    private String aiQuestionEvaluationId;

    @Column(name = "pending_ai_evaluation_id")
    private String pendingAiEvaluationId;

    @Column(name = "part_marks_json", columnDefinition = "TEXT")
    private String partMarksJson;

    /** Pages of the answer sheet holding this answer, e.g. "3,4". */
    @Column(name = "answer_pages")
    private String answerPages;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
