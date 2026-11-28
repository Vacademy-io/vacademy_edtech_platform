package vacademy.io.admin_core_service.features.quiz_results.dto;

/** One quiz slide in a batch: where it sits in the course tree and what it is worth. */
public interface QuizSlideMetaProjection {
    String getSlideId();

    /** quiz_slide.id - the answer-key side of the slide. */
    String getQuizSlideId();

    String getSlideTitle();

    /** PUBLISHED / DRAFT / UNSYNC - a draft quiz legitimately has no results yet. */
    String getSlideStatus();

    Integer getSlideOrder();

    String getChapterId();

    String getChapterName();

    String getModuleName();

    String getSubjectName();

    /** null when the quiz defines no pass mark; the UI then shows no pass/fail split. */
    Double getPassPercentage();

    Integer getTimeLimitInMinutes();

    Integer getReAttemptCount();

    Long getQuestionCount();

    /** Sum of per-question marks, falling back to the quiz-level marks-per-question. */
    Double getTotalMarks();
}
