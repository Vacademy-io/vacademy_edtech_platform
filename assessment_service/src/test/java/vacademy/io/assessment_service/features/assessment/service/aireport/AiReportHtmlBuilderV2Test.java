package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfReader;
import com.itextpdf.kernel.pdf.canvas.parser.PdfTextExtractor;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.HistoryPoint;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Outcome;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.QuestionRow;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.SectionRow;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Renders the redesigned student AI report from made-up data through the real iText
 * pipeline and bundled fonts, and checks what a student would read.
 */
class AiReportHtmlBuilderV2Test {

    private static final ObjectMapper OM = new ObjectMapper();

    @Test
    void rendersAllPagesWithHeadlinesComputedFromTheMarks() throws Exception {
        AiReportModel m = model("Riya Verma", "ENR-001", ai());
        String html = new AiReportHtmlBuilderV2().build(m);

        assertThat(html).contains("Riya's result", "Enrollment no. ENR-001", "Top quarter of 20 students",
                "Marks by section", "Where you stand", "Every answer", "Topic mastery", "Bloom", "Speed vs accuracy",
                "Mistakes explained", "This week's plan", "Flashcards", "Progress",
                // everything the normal report has
                "Question by question", "All 15 questions, with your answers", "Your answer", "Right answer",
                "Explanation:", "Your potential", "top 18");
        // Classmates are counted, never named.
        assertThat(html).doesNotContain("Classmate");

        String text = pdfText(html);
        assertThat(text).contains("Riya", "Physics", "Maths");
    }

    @Test
    void reportsTheRealMaximumAndNeverAGradeOrAnotherStudentsName() {
        String html = new AiReportHtmlBuilderV2().build(model("Riya Verma", null, ai()));
        assertThat(html).contains("/30").doesNotContain("A+").doesNotContain("Enrollment no.");
    }

    @Test
    void leavesOutAiSectionsWhenTheAiJsonIsEmpty() throws Exception {
        String html = new AiReportHtmlBuilderV2().build(model("Riya Verma", null, OM.createObjectNode()));
        assertThat(html).doesNotContain("Topic mastery", "Bloom", "Mistakes explained", "This week's plan");
        assertThat(html).contains("Marks by section", "Every answer");
        assertThat(pdfText(html)).isNotBlank();
    }

    @Test
    void hidingQuestionWiseDataLeavesOutEveryPerQuestionItem() throws Exception {
        AiReportModel m = model("Riya Verma", null, ai()).toBuilder().hideQuestionWise(true).build();
        String html = new AiReportHtmlBuilderV2().build(m);
        assertThat(html).doesNotContain("Question by question", "Every answer", "Mistakes explained",
                "Easy marks missed", "Your expertise", "Sample question");
        assertThat(html).contains("Marks by section", "Topic mastery", "This week's plan");
        assertThat(pdfText(html)).isNotBlank();
    }

    @Test
    void topicAnalysisHasARadarWhenThereAreThreeOrMoreTopics() throws Exception {
        String three = new AiReportHtmlBuilderV2().build(model("Riya Verma", null, OM.readTree("""
                {"topic_analysis":[{"topic":"Algebra and linear equations in two variables","questions_count":6,"correct":5,"accuracy":83},
                                   {"topic":"Optics","questions_count":5,"correct":3,"accuracy":60},
                                   {"topic":"Life processes","questions_count":4,"correct":0,"accuracy":0}]}
                """)));
        assertThat(three).contains("Algebra and linear").contains("<polygon");
        assertThat(AiReportCharts.wrap("Algebra and linear equations in two variables", 22, 2)).hasSize(2);
    }

    @Test
    void greekAndArrowsAreSetInTheSymbolFontOnly() {
        assertThat(AiReportHtmlBuilderV2.esc("x → y < z"))
                .isEqualTo("x <span style=\"font-family:'Noto Sans Math'\">→</span> y &lt; z");
        assertThat(AiReportHtmlBuilderV2.esc("θ = 30°")).startsWith("<span style=\"font-family:'Noto Sans Math'\">θ</span>");
    }

    @Test
    void skippedQuestionsProjectAPotentialScoreAtTheClassRate() {
        QuestionRow skipped = new QuestionRow("q1", "s", 0, "S", 1, 4, 0, Outcome.SKIPPED, null, 50.0, 20.0, null);
        QuestionRow right = new QuestionRow("q2", "s", 0, "S", 2, 4, 4, Outcome.CORRECT, 10L, 90.0, 20.0, null);
        AiReportDataService.ClassData klass = new AiReportDataService.ClassData(List.of(), null, null, null, null, null,
                java.util.Map.of(), java.util.Map.of(), List.of(3.0, 5.0, 7.0));
        AiReportModel.Potential p = AiReportDataService.potential(List.of(skipped, right), klass, 4, 8);
        assertThat(p.score()).isEqualTo(6.0);
        assertThat(p.rank()).isEqualTo(2);
        assertThat(AiReportDataService.potential(List.of(right), klass, 4, 8)).isNull();
    }

    @Test
    void shoutingAndEmailNamesAreShownAsNames() {
        assertThat(AiReportHtmlBuilderV2.displayName("SHOURYA YADAV")).isEqualTo("Shourya Yadav");
        assertThat(AiReportHtmlBuilderV2.displayName("rahul@example.com")).isEqualTo("rahul");
        assertThat(AiReportHtmlBuilderV2.possessive("Aarav")).isEqualTo("Aarav's");
        assertThat(AiReportHtmlBuilderV2.possessive("Paras")).isEqualTo("Paras'");
    }

    @Test
    void pendingWithoutAnAnswerIsSkippedAndWithAnAnswerIsBeingChecked() {
        assertThat(AiReportDataService.outcomeOf(null, 2)).isEqualTo(Outcome.SKIPPED);
        assertThat(AiReportDataService.outcomeOf(new AiReportDataService.StudentAnswer(0, "PENDING", 5L, false), 2))
                .isEqualTo(Outcome.SKIPPED);
        assertThat(AiReportDataService.outcomeOf(new AiReportDataService.StudentAnswer(0, "PENDING", 5L, true), 2))
                .isEqualTo(Outcome.PENDING);
        assertThat(AiReportDataService.outcomeOf(new AiReportDataService.StudentAnswer(1, "evaluated", 5L, true), 2))
                .isEqualTo(Outcome.PARTIAL);
        assertThat(AiReportDataService.outcomeOf(new AiReportDataService.StudentAnswer(-0.5, "INCORRECT", 5L, true), 2))
                .isEqualTo(Outcome.WRONG);
    }

    @Test
    void readsMaxMarksStoredAsNumberOrString() {
        AiReportDataService svc = new AiReportDataService(null, OM, null, null, null, null, null);
        assertThat(svc.maxMark("{\"type\":\"MCQS\",\"data\":{\"totalMark\":\"2.5\"}}")).isEqualTo(2.5);
        assertThat(svc.maxMark("{\"data\":{\"totalMark\":4}}")).isEqualTo(4.0);
        assertThat(svc.maxMark("not json")).isZero();
        assertThat(svc.hasResponse("{\"responseData\":{\"type\":\"MCQS\",\"optionIds\":[]}}")).isFalse();
        assertThat(svc.hasResponse("{\"responseData\":{\"type\":\"MCQS\",\"optionIds\":[\"a\"]}}")).isTrue();
    }

    @Test
    void paleBrandColoursGetDarkHeaderText() {
        assertThat(new ReportPalette("#FFE066", "#FFC531").onBrand).isEqualTo(ReportPalette.INK);
        assertThat(new ReportPalette("#1D3B8F", "#FFC531").onBrand).isEqualTo(ReportPalette.PAPER);
    }

    // ── fixtures ──

    private static AiReportModel model(String name, String enrollment, JsonNode ai) {
        // Physics: 5 questions x 2 marks; Maths: 10 questions x 2 marks. Max 30.
        List<QuestionRow> qs = new ArrayList<>();
        Outcome[] phy = {Outcome.CORRECT, Outcome.CORRECT, Outcome.WRONG, Outcome.CORRECT, Outcome.SKIPPED};
        for (int i = 0; i < phy.length; i++) {
            qs.add(q("p" + i, "s1", 0, "Physics", i + 1, phy[i], i == 2 ? 4L : 25L));
        }
        Outcome[] mat = {Outcome.CORRECT, Outcome.CORRECT, Outcome.CORRECT, Outcome.WRONG, Outcome.CORRECT,
                Outcome.CORRECT, Outcome.CORRECT, Outcome.CORRECT, Outcome.WRONG, Outcome.CORRECT};
        for (int i = 0; i < mat.length; i++) {
            qs.add(q("m" + i, "s2", 1, "Maths", i + 1, mat[i], i == 3 ? 3L : 20L + i));
        }
        double phyScore = qs.stream().filter(x -> x.sectionId().equals("s1")).mapToDouble(QuestionRow::marks).sum();
        double matScore = qs.stream().filter(x -> x.sectionId().equals("s2")).mapToDouble(QuestionRow::marks).sum();
        List<SectionRow> sections = List.of(
                new SectionRow("s1", "Physics", 0, 10, phyScore, 5.5, 120, 100.0, 10.0),
                new SectionRow("s2", "Maths", 1, 20, matScore, 9.0, 240, 210.0, 18.0));
        double score = phyScore + matScore;
        List<Double> klass = new ArrayList<>(List.of(2.0, 5.0, 6.5, 8.0, 9.0, 10.0, 11.0, 12.0, 12.5, 13.0, 14.0, 15.0, 15.5,
                16.0, 17.0, 18.0, 19.0, 26.0, 28.0));
        klass.add(score);
        long above = klass.stream().filter(v -> v > score).count();
        long below = klass.stream().filter(v -> v < score).count();
        return AiReportModel.builder()
                .instituteName("Sample Academy").assessmentName("Unit Test 3").studentName(name).enrollmentNumber(enrollment)
                .attemptDate(new Date(1_790_000_000_000L)).brandColor("#3352D1").accentColor("#FF8A5C")
                .score(score).maxScore(30).timeTakenSeconds(400L).durationLimitMinutes(20)
                .classScores(klass).rank((int) above + 1).participants(klass.size()).percentile(100.0 * below / klass.size())
                .classAverage(klass.stream().mapToDouble(Double::doubleValue).average().orElse(0)).classHighest(28.0)
                .classAverageTimeSeconds(380L).sections(sections).questions(qs)
                .history(List.of(new HistoryPoint("Unit Test 1", new Date(1_780_000_000_000L), 48),
                        new HistoryPoint("Unit Test 2", new Date(1_785_000_000_000L), 55),
                        new HistoryPoint(null, new Date(1_790_000_000_000L), 100 * score / 30)))
                .details(details(qs))
                .potential(new AiReportModel.Potential(score + 1.4, 2, 85.0, 1))
                .ai(ai).build();
    }

    private static java.util.Map<String, AiReportModel.QuestionDetail> details(List<QuestionRow> qs) {
        java.util.Map<String, AiReportModel.QuestionDetail> out = new java.util.HashMap<>();
        for (QuestionRow q : qs) {
            out.put(AiReportDataService.key(q.questionId(), q.sectionId()), new AiReportModel.QuestionDetail("MCQS",
                    "Sample question " + q.numberInSection() + " about θ → 2θ", q.outcome() == Outcome.SKIPPED ? null : "Option A",
                    "Option B", null, List.of(), "Because 2θ doubles the angle."));
        }
        return out;
    }

    private static QuestionRow q(String id, String sid, int idx, String sname, int n, Outcome o, long t) {
        double marks = o == Outcome.CORRECT ? 2 : o == Outcome.WRONG ? -0.5 : 0;
        return new QuestionRow(id, sid, idx, sname, n, 2, marks, o, o == Outcome.SKIPPED ? null : t,
                70.0, 22.0, "Sample question " + n);
    }

    private static JsonNode ai() {
        try {
            return OM.readTree("""
                    {"performance_analysis":"Riya, your maths is strong. Physics question 3 was answered in 4 seconds.",
                     "topic_analysis":[{"topic":"Algebra","questions_count":6,"correct":5,"accuracy":83,"mastery_level":"Proficient"},
                                       {"topic":"Optics","questions_count":5,"correct":3,"accuracy":60,"mastery_level":"Developing"}],
                     "blooms_taxonomy":{"remember":{"total":3,"correct":1},"apply":{"total":8,"correct":7}},
                     "confidence_estimation":{"insight":"Quick answers were mostly right."},
                     "behavioral_insights":{"time_management":"Steady pace.","fatigue_indicator":"No slowdown.","skip_pattern":"One skipped."},
                     "misconception_analysis":[{"question_summary":"Lens formula sign","student_answer":"+10 cm","correct_answer":"-10 cm",
                       "misconception":"Sign convention mixed up.","remediation":"Draw the ray diagram first."}],
                     "recommended_learning_path":[{"topic":"Sign convention","suggestion":"Ten practice questions.","estimated_time":"30 minutes"}],
                     "flashcards":[{"front":"Lens formula?","back":"1/f = 1/v - 1/u"}]}
                    """);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String pdfText(String html) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ConverterProperties props = new ConverterProperties();
        props.setFontProvider(new AiReportFonts().newProvider());
        HtmlConverter.convertToPdf(html, out, props);
        StringBuilder text = new StringBuilder();
        try (PdfDocument pdf = new PdfDocument(new PdfReader(new ByteArrayInputStream(out.toByteArray())))) {
            assertThat(pdf.getNumberOfPages()).isGreaterThanOrEqualTo(1);
            for (int i = 1; i <= pdf.getNumberOfPages(); i++) text.append(PdfTextExtractor.getTextFromPage(pdf.getPage(i)));
        }
        return text.toString();
    }
}
