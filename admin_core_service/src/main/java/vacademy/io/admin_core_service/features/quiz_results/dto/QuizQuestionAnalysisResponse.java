package vacademy.io.admin_core_service.features.quiz_results.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Quiz Results tab, question view: which questions the batch actually got wrong, and
 * which wrong option pulled them there. This is the part a teacher re-teaches from.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QuizQuestionAnalysisResponse {

    /** learners of this batch with at least one attempt - the denominator for every rate. */
    private long attemptedLearners;

    private List<QuestionStat> questions;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QuestionStat {
        private String questionId;
        private int order;
        private String questionText;
        private String explanation;
        private String questionType;
        private double marks;

        /** learners who have a tracked response row for this question. */
        private long responded;

        private long correctCount;
        private long wrongCount;
        private long skippedCount;

        /** answered, but not auto-gradable; excluded from the accuracy denominator. */
        private long ungradedCount;

        /** attempted learners with no response row at all for this question. */
        private long unansweredCount;

        /** correct / attempted learners, as a %; null when nobody attempted the quiz. */
        private Double accuracyPercent;

        /** EASY (>=80%) | MODERATE (>=50%) | HARD (>=25%) | CRITICAL - null when unattempted. */
        private String difficulty;

        private List<OptionStat> options;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OptionStat {
        private String optionId;
        private String text;
        private boolean correct;
        private long selectedCount;

        /** share of responding learners who picked this option. */
        private Double selectedPercent;
    }
}
