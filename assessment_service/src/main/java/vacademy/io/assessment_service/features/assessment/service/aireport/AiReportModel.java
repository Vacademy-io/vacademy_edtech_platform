package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Builder;
import lombok.Getter;

import java.util.Date;
import java.util.List;

/**
 * Everything the student AI report renders, gathered once by {@link AiReportDataService}
 * and handed to {@link AiReportHtmlBuilderV2}. The builder does no I/O.
 *
 * <p>Marks here are always measured against the paper's real maximum: the sum of each
 * question's {@code marking_json} totalMark. The stored {@code section.total_marks} is
 * client-supplied and often wrong (0, truncated, or stale), so it is never used.
 */
@Getter
@Builder(toBuilder = true)
public class AiReportModel {

    // Who and what
    private final String instituteName;
    /** data: URI of the institute logo, or null to show the initials badge. */
    private final String logoDataUri;
    /** Logo width / height, so the header badge fits it exactly; null when unknown. */
    private final Double logoAspect;
    private final String assessmentName;
    private final String studentName;
    private final String enrollmentNumber;
    private final Date attemptDate;

    // Institute colours (already validated #rrggbb)
    private final String brandColor;
    private final String accentColor;

    // Score
    private final double score;
    private final double maxScore;
    private final Long timeTakenSeconds;
    private final Integer durationLimitMinutes;

    // Class (latest ENDED attempt per learner, this institute). Null when unavailable.
    private final List<Double> classScores;
    private final Integer rank;
    private final Integer participants;
    /** Share of other students who scored strictly less, 0-100. */
    private final Double percentile;
    private final Double classAverage;
    private final Double classHighest;
    private final Long classAverageTimeSeconds;

    private final List<SectionRow> sections;
    /** In paper order: section order, then question order. */
    private final List<QuestionRow> questions;
    /** Most recent last; includes this test as the final point. Empty when this is the only test. */
    private final List<HistoryPoint> history;

    /** Question-by-question content (text, answers, feedback), keyed by questionId|sectionId. */
    private final java.util.Map<String, QuestionDetail> details;

    /** Projected score had the skipped questions been attempted at the class's success rate; null when none. */
    private final Potential potential;

    /** "+2.5 per correct answer, −0.5 per wrong answer" when every question is marked alike; else null. */
    private final String markingNote;

    /** Report option (profile report_options.question_wise = HIDE): leave out every per-question item. */
    private final boolean hideQuestionWise;

    /** The processed AI JSON from admin_core (may be an empty object, never null). */
    private final JsonNode ai;

    public enum Outcome { CORRECT, PARTIAL, WRONG, SKIPPED, PENDING }

    public record SectionRow(String id, String name, int index, double max, double score,
                             Double classAverage, long timeSeconds, Double classAverageTimeSeconds, Double classTop) {
    }

    public record Criterion(String name, String marks, String reason) {
    }

    public record QuestionDetail(String type, String text, String yourAnswer, String correctAnswer,
                                 String feedback, List<Criterion> criteria, String explanation) {
    }

    public record Potential(double score, Integer rank, Double percentile, int skippedConsidered) {
    }

    public record QuestionRow(String questionId, String sectionId, int sectionIndex, String sectionName,
                              int numberInSection, double max, double marks, Outcome outcome, Long timeSeconds,
                              Double classCorrectPercent, Double classAverageTimeSeconds, String shortText) {
        public boolean answered() {
            return outcome != Outcome.SKIPPED;
        }
    }

    public record HistoryPoint(String assessmentName, Date date, double percent) {
    }

    public int count(Outcome outcome) {
        return questions == null ? 0 : (int) questions.stream().filter(q -> q.outcome() == outcome).count();
    }

    public boolean hasClass() {
        return participants != null && participants >= 2 && classScores != null && !classScores.isEmpty();
    }
}
