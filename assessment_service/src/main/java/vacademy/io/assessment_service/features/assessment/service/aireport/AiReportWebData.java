package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.assessment_service.features.assessment.service.HtmlBuilderService;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Outcome;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.QuestionDetail;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.QuestionRow;

import java.util.List;

/**
 * The student AI report as data, for the learner app's on-screen report. It is the same model the
 * PDF download is built from, with the report options already applied: whatever the PDF leaves out
 * (question-wise items, the learner's answer, the right answer, explanations) is left out here too,
 * so the screen never shows more than the download.
 *
 * <p>With question-wise items hidden the questions are still sent, for the counts and the
 * behaviour charts the PDF also draws from them, but without their text, answers or feedback.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record AiReportWebData(
        String instituteName, String assessmentName, String studentName, String enrollmentNumber,
        List<ReportStudentDetail> studentDetails, Long attemptDate,
        String headline, String subline,
        double score, double maxScore, Long timeTakenSeconds, Integer durationLimitMinutes,
        boolean hasClass, Integer rank, Integer participants, Double percentile, Double classAverage,
        Double classHighest, Long classAverageTimeSeconds, List<Double> classScores,
        String markingNote,
        boolean hideQuestionWise, boolean hideYourAnswer, boolean hideCorrectAnswer, boolean hideExplanation,
        List<Section> sections, List<Question> questions, List<History> history, Potential potential,
        JsonNode ai) {

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Section(String id, String name, int index, double max, double score, Double classAverage,
                          long timeSeconds, Double classAverageTimeSeconds, Double classTop) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Criterion(String name, String marks, String reason) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Question(String questionId, String sectionId, int sectionIndex, String sectionName, int number,
                          double max, double marks, Outcome outcome, Long timeSeconds, Double classCorrectPercent,
                          Double classAverageTimeSeconds, String shortText, String type, String text,
                          String yourAnswer, String correctAnswer, String feedback, List<Criterion> criteria,
                          String explanation) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record History(String assessmentName, Long date, double percent) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Potential(double score, Integer rank, Double percentile, int skippedConsidered) {
    }

    /** {@code m} must already carry the report options (see AiReportPdfService.withReportOptions). */
    static AiReportWebData from(AiReportModel m, AiReportHtmlBuilderV2 builder) {
        boolean qw = !m.isHideQuestionWise();
        List<Question> questions = m.getQuestions().stream().map(q -> question(m, q, qw)).toList();
        AiReportModel.Potential pot = m.getPotential();
        return new AiReportWebData(
                m.getInstituteName(), m.getAssessmentName(), m.getStudentName(), m.getEnrollmentNumber(),
                m.getStudentDetails() == null ? List.of() : m.getStudentDetails(),
                m.getAttemptDate() == null ? null : m.getAttemptDate().getTime(),
                builder.heroHeadline(m), builder.heroSubline(m),
                m.getScore(), m.getMaxScore(), m.getTimeTakenSeconds(), m.getDurationLimitMinutes(),
                m.hasClass(), m.getRank(), m.getParticipants(), m.getPercentile(), m.getClassAverage(),
                m.getClassHighest(), m.getClassAverageTimeSeconds(), m.hasClass() ? m.getClassScores() : List.of(),
                m.getMarkingNote(),
                m.isHideQuestionWise(), m.isHideYourAnswer(), m.isHideCorrectAnswer(), m.isHideExplanation(),
                m.getSections().stream().map(r -> new Section(r.id(), r.name(), r.index(), r.max(), r.score(),
                        r.classAverage(), r.timeSeconds(), r.classAverageTimeSeconds(), r.classTop())).toList(),
                questions,
                m.getHistory() == null ? List.of() : m.getHistory().stream()
                        .map(h -> new History(h.assessmentName(), h.date() == null ? null : h.date().getTime(), h.percent())).toList(),
                pot == null ? null : new Potential(pot.score(), pot.rank(), pot.percentile(), pot.skippedConsidered()),
                ai(m));
    }

    private static Question question(AiReportModel m, QuestionRow q, boolean questionWise) {
        if (!questionWise) {
            return new Question(q.questionId(), q.sectionId(), q.sectionIndex(), q.sectionName(), q.numberInSection(),
                    q.max(), q.marks(), q.outcome(), q.timeSeconds(), q.classCorrectPercent(), q.classAverageTimeSeconds(),
                    null, null, null, null, null, null, List.of(), null);
        }
        QuestionDetail d = m.getDetails() == null ? null : m.getDetails().get(AiReportDataService.key(q.questionId(), q.sectionId()));
        String type = d == null || d.type() == null ? null : HtmlBuilderService.formatQuestionType(d.type());
        // The PDF prints the right answer only where it was missed.
        String right = d == null || m.isHideCorrectAnswer() || q.outcome() == Outcome.CORRECT ? null : d.correctAnswer();
        return new Question(q.questionId(), q.sectionId(), q.sectionIndex(), q.sectionName(), q.numberInSection(),
                q.max(), q.marks(), q.outcome(), q.timeSeconds(), q.classCorrectPercent(), q.classAverageTimeSeconds(),
                q.shortText(), type, d == null ? null : d.text(),
                d == null || m.isHideYourAnswer() ? null : d.yourAnswer(),
                right,
                d == null ? null : d.feedback(),
                d == null || d.criteria() == null ? List.of()
                        : d.criteria().stream().map(c -> new Criterion(c.name(), c.marks(), c.reason())).toList(),
                d == null || m.isHideExplanation() ? null : d.explanation());
    }

    /** The AI JSON with the same report options applied as the PDF's "Mistakes explained". */
    private static JsonNode ai(AiReportModel m) {
        JsonNode ai = m.getAi();
        if (ai == null || !ai.isObject()) return JsonNodeFactory.instance.objectNode();
        ObjectNode copy = ai.deepCopy();
        if (m.isHideQuestionWise()) {
            copy.remove("misconception_analysis");
            if (copy.path("confidence_estimation").isObject()) {
                ((ObjectNode) copy.get("confidence_estimation")).remove("per_question");
            }
        } else if (copy.path("misconception_analysis").isArray()) {
            for (JsonNode item : copy.get("misconception_analysis")) {
                if (!item.isObject()) continue;
                if (m.isHideYourAnswer()) ((ObjectNode) item).remove("student_answer");
                if (m.isHideCorrectAnswer()) ((ObjectNode) item).remove("correct_answer");
            }
        }
        return copy;
    }
}
