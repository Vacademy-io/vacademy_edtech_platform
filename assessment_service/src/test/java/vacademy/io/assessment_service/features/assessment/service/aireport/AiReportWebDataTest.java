package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Outcome;

import static org.assertj.core.api.Assertions.assertThat;

/** The on-screen report data carries the PDF's numbers and never more than the PDF shows. */
class AiReportWebDataTest {

    private static final ObjectMapper OM = new ObjectMapper();
    private static final AiReportHtmlBuilderV2 BUILDER = new AiReportHtmlBuilderV2();

    private static AiReportModel model() {
        return AiReportHtmlBuilderV2Test.model("Riya Verma", "ENR-001", AiReportHtmlBuilderV2Test.ai());
    }

    @Test
    void carriesTheSameNumbersAndHeadlineAsThePdf() throws Exception {
        AiReportModel m = model();
        AiReportWebData d = AiReportWebData.from(m, BUILDER);

        assertThat(d.score()).isEqualTo(m.getScore());
        assertThat(d.maxScore()).isEqualTo(30);
        assertThat(d.headline()).isEqualTo(BUILDER.heroHeadline(m));
        assertThat(BUILDER.build(m)).contains(d.headline());
        assertThat(d.sections()).hasSize(2);
        assertThat(d.questions()).hasSize(m.getQuestions().size());
        assertThat(d.history()).hasSize(3);
        assertThat(d.classScores()).hasSize(m.getParticipants());

        JsonNode json = OM.readTree(OM.writeValueAsString(d));
        assertThat(json.has("max_score")).isTrue();
        assertThat(json.path("questions").get(0).path("outcome").asText()).isEqualTo("CORRECT");
        assertThat(json.path("questions").get(2).path("your_answer").asText()).isEqualTo("Option A");
        assertThat(json.path("ai").path("misconception_analysis").get(0).path("correct_answer").asText()).isEqualTo("-10 cm");
    }

    @Test
    void rightAnswerOnlyWhereItWasMissed() {
        AiReportWebData d = AiReportWebData.from(model(), BUILDER);
        d.questions().forEach(q -> {
            if (q.outcome() == Outcome.CORRECT) assertThat(q.correctAnswer()).isNull();
            else assertThat(q.correctAnswer()).isEqualTo("Option B");
        });
    }

    @Test
    void hiddenAnswersAndExplanationsAreNotSent() {
        AiReportModel m = model().toBuilder().hideYourAnswer(true).hideCorrectAnswer(true).hideExplanation(true).build();
        AiReportWebData d = AiReportWebData.from(m, BUILDER);

        assertThat(d.questions()).allSatisfy(q -> {
            assertThat(q.yourAnswer()).isNull();
            assertThat(q.correctAnswer()).isNull();
            assertThat(q.explanation()).isNull();
            assertThat(q.text()).isNotBlank();
        });
        JsonNode fix = d.ai().path("misconception_analysis").get(0);
        assertThat(fix.has("student_answer")).isFalse();
        assertThat(fix.has("correct_answer")).isFalse();
        assertThat(fix.path("misconception").asText()).isNotBlank();
        // The model's own AI JSON is untouched: the PDF still reads it.
        assertThat(m.getAi().path("misconception_analysis").get(0).has("correct_answer")).isTrue();
    }

    @Test
    void questionWiseHiddenKeepsTheCountsButNoQuestionContent() {
        AiReportModel m = model().toBuilder().hideQuestionWise(true).build();
        AiReportWebData d = AiReportWebData.from(m, BUILDER);

        assertThat(d.hideQuestionWise()).isTrue();
        assertThat(d.questions()).hasSize(m.getQuestions().size());
        assertThat(d.questions()).allSatisfy(q -> {
            assertThat(q.text()).isNull();
            assertThat(q.shortText()).isNull();
            assertThat(q.yourAnswer()).isNull();
            assertThat(q.correctAnswer()).isNull();
            assertThat(q.explanation()).isNull();
        });
        assertThat(d.ai().has("misconception_analysis")).isFalse();
        assertThat(d.ai().path("flashcards").isArray()).isTrue();
    }
}
