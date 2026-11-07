package vacademy.io.admin_core_service.features.slide.entity;

import jakarta.persistence.*;
import lombok.*;
import vacademy.io.admin_core_service.features.common.entity.RichTextData;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideDTO;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Entity
@Table(name = "quiz_slide")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class QuizSlide {

    @Id
    private String id;

    @OneToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "description", referencedColumnName = "id", foreignKey = @ForeignKey(name = "fk_quiz_desc_rich_text_id"))
    private RichTextData descriptionRichText;

    private String title;

    @Column(name = "time_limit_in_minutes")
    private Integer timeLimitInMinutes;

    @Builder.Default
    @Column(name = "marks_per_question")
    private Double marksPerQuestion = 1.0;

    @Builder.Default
    @Column(name = "negative_marking")
    private Double negativeMarking = 0.0;

    @Column(name = "pass_percentage")
    private Double passPercentage;

    /** Proportional marks on multiple-correct questions answered with a subset of the key. */
    @Builder.Default
    @Column(name = "partial_marking")
    private Boolean partialMarking = false;

    @Column(name = "re_attempt_count")
    private Integer reAttemptCount;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @OneToMany(mappedBy = "quizSlide", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<QuizSlideQuestion> questions;

    public QuizSlide(QuizSlideDTO quizSlideDTO) {
        this.id = quizSlideDTO.getId();
        this.title = quizSlideDTO.getTitle();
        this.timeLimitInMinutes = quizSlideDTO.getTimeLimitInMinutes();
        this.marksPerQuestion = quizSlideDTO.getMarksPerQuestion() != null ? quizSlideDTO.getMarksPerQuestion() : 1.0;
        this.negativeMarking = quizSlideDTO.getNegativeMarking() != null ? quizSlideDTO.getNegativeMarking() : 0.0;
        this.passPercentage = quizSlideDTO.getPassPercentage();
        this.partialMarking = Boolean.TRUE.equals(quizSlideDTO.getPartialMarking());
        this.reAttemptCount = quizSlideDTO.getReAttemptCount();
        if (quizSlideDTO.getDescription() != null) {
            this.descriptionRichText = new RichTextData(quizSlideDTO.getDescription());
        }
        if (quizSlideDTO.getQuestions() != null && !quizSlideDTO.getQuestions().isEmpty()) {
            this.questions = quizSlideDTO.getQuestions().stream()
                    .map(q -> new QuizSlideQuestion(q, this))
                    .collect(Collectors.toList());
        }
    }
}
