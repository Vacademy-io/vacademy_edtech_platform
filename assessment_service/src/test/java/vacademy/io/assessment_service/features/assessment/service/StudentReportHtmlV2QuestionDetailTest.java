package vacademy.io.assessment_service.features.assessment.service;

import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportAnswerReviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionSnapshot;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The v2 report shipped with a compact ANSWER REVIEW table (Q.No / Result /
 * Marks / Time) and nothing else, so once the learner and admin download paths
 * moved onto this builder the PDF stopped showing what the student actually
 * answered. These tests lock the restored QUESTION-WISE DETAIL block in place:
 * the response, the correct answer and the submitted source code must survive
 * into the HTML, and the markup must still be something iText can turn into a
 * PDF (it silently drops constructs it cannot lay out).
 */
class StudentReportHtmlV2QuestionDetailTest {

    private StudentReportHtmlV2Builder builder;

    @BeforeEach
    void setUp() {
        OptionRepository optionRepository = mock(OptionRepository.class);
        when(optionRepository.findById(anyString())).thenReturn(Optional.empty());
        when(optionRepository.findById("opt-picked")).thenReturn(Optional.of(option("Mitochondrion")));
        when(optionRepository.findById("opt-right")).thenReturn(Optional.of(option("Ribosome")));

        HtmlBuilderService htmlBuilderService = new HtmlBuilderService();
        ReflectionTestUtils.setField(htmlBuilderService, "optionRepository", optionRepository);

        builder = new StudentReportHtmlV2Builder();
        ReflectionTestUtils.setField(builder, "htmlBuilderService", htmlBuilderService);
        ReflectionTestUtils.setField(builder, "reportBrandingHelper", mock(ReportBrandingHelper.class));
    }

    @Test
    void rendersTheStudentResponseAndCorrectAnswerForAnMcq() {
        String html = builder.build(inputWith(mcqReview()));

        assertThat(html).contains("QUESTION-WISE DETAIL");
        assertThat(html).contains("Which organelle is the powerhouse of the cell?");
        assertThat(html).contains("Your Answer:").contains("Mitochondrion");
        assertThat(html).contains("Correct Answer:").contains("Ribosome");
        // Question type and the explanation ride along with it.
        assertThat(html).contains("MCQ Single");
        assertThat(html).contains("Explanation:").contains("Ribosomes synthesise protein");
    }

    @Test
    void rendersTheSubmittedSourceCodeForACodingQuestion() {
        String html = builder.build(inputWith(codingReview()));

        assertThat(html).contains("Coding");
        // The summary line and the actual submission both matter — the summary
        // alone was what the compact table already implied.
        assertThat(html).contains("python").contains("WRONG_ANSWER");
        assertThat(html).contains("def solve(n):");
        assertThat(html).contains("Test cases passed:");
    }

    @Test
    void marksAnUnansweredQuestionAsNotAttempted() {
        String html = builder.build(inputWith(skippedReview()));

        assertThat(html).contains("Your Answer:").contains("Not attempted");
    }

    @Test
    void producesAPdfItextCanActuallyRender() {
        String html = builder.build(inputWith(mcqReview(), codingReview(), skippedReview()));

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        HtmlConverter.convertToPdf(html, out, new ConverterProperties());

        assertThat(out.size()).isGreaterThan(1000);
        assertThat(new String(out.toByteArray(), 0, 5)).isEqualTo("%PDF-");
    }

    /** Manual assessments keep the evaluated-sheet note and gain the detail only when rows exist. */
    @Test
    void manualReportStillRendersDetailWhenPerQuestionRowsExist() {
        StudentReportHtmlV2Builder.Input in = StudentReportHtmlV2Builder.Input.builder()
                .assessmentName("Unit Test 3")
                .evaluationType("MANUAL")
                .reportDetail(reportDetail(mcqReview()))
                .sections(List.of(new SectionSnapshot("sec-1", "Biology", 20.0, null, 1)))
                .build();

        String html = builder.build(in);

        assertThat(html).contains("QUESTION-WISE DETAIL").contains("Mitochondrion");
        // Time is meaningless on a pen-and-paper attempt and must stay out.
        assertThat(html).doesNotContain("1m 12s");
    }

    // ------------------------------------------------------------- fixtures

    @Test
    void reportOptionsLeaveOutTheHiddenPartsOfEveryQuestion() {
        String html = builder.build(inputWith(true, false, true, mcqReview()));

        assertThat(html).contains("QUESTION-WISE DETAIL").contains("Your Answer:").contains("Mitochondrion");
        assertThat(html).doesNotContain("Correct Answer:").doesNotContain("Ribosome")
                .doesNotContain("Explanation:").doesNotContain("Ribosomes synthesise protein");

        String noOwnAnswer = builder.build(inputWith(false, true, false, mcqReview()));
        assertThat(noOwnAnswer).doesNotContain("Your Answer:").contains("Correct Answer:");
    }

    private StudentReportHtmlV2Builder.Input inputWith(StudentReportAnswerReviewDto... reviews) {
        return inputWith(false, false, false, reviews);
    }

    private StudentReportHtmlV2Builder.Input inputWith(boolean hideCorrect, boolean hideYours, boolean hideExplanation,
                                                       StudentReportAnswerReviewDto... reviews) {
        return StudentReportHtmlV2Builder.Input.builder()
                .assessmentName("Unit Test 3")
                .evaluationType("AUTO")
                .reportDetail(reportDetail(reviews))
                .sections(List.of(new SectionSnapshot("sec-1", "Biology", 20.0, null, 1)))
                .hideCorrectAnswer(hideCorrect)
                .hideYourAnswer(hideYours)
                .hideExplanation(hideExplanation)
                .build();
    }

    private StudentReportOverallDetailDto reportDetail(StudentReportAnswerReviewDto... reviews) {
        StudentReportOverallDetailDto detail = new StudentReportOverallDetailDto();
        detail.setAllSections(Map.of("sec-1", List.of(reviews)));
        return detail;
    }

    private StudentReportAnswerReviewDto mcqReview() {
        return StudentReportAnswerReviewDto.builder()
                .questionId("q-1")
                .questionOrder(1)
                .questionType("MCQS")
                .questionName("Which organelle is the powerhouse of the cell?")
                .answerStatus("INCORRECT")
                .mark(0.0)
                .timeTakenInSeconds(72L)
                .studentResponseOptions("{\"responseData\":{\"type\":\"MCQS\",\"optionIds\":[\"opt-picked\"]}}")
                .correctOptions("{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"opt-right\"]}}")
                .explanation("Ribosomes synthesise protein; the question was a trick.")
                .build();
    }

    private StudentReportAnswerReviewDto codingReview() {
        return StudentReportAnswerReviewDto.builder()
                .questionId("q-2")
                .questionOrder(2)
                .questionType("CODING")
                .questionName("Return the nth Fibonacci number.")
                .answerStatus("INCORRECT")
                .mark(0.0)
                .studentResponseOptions("{\"responseData\":{\"type\":\"CODING\",\"language\":\"python\","
                + "\"verdict\":\"WRONG_ANSWER\",\"score\":0.0,\"totalTimeMs\":120,\"peakMemoryKb\":2048,"
                + "\"sourceCode\":\"def solve(n):\\n    return n\","
                + "\"testCaseResults\":[{\"visible\":true,\"passed\":true},{\"visible\":false,\"passed\":false}]}}")
                .correctOptions("{\"type\":\"CODING\",\"data\":{\"testCases\":["
                        + "{\"visible\":true},{\"visible\":false}]}}")
                .build();
    }

    private StudentReportAnswerReviewDto skippedReview() {
        return StudentReportAnswerReviewDto.builder()
                .questionId("q-3")
                .questionOrder(3)
                .questionType("ONE_WORD")
                .questionName("Name the process plants use to make food.")
                .answerStatus("PENDING")
                .mark(0.0)
                .build();
    }

    private Option option(String text) {
        Option option = new Option();
        AssessmentRichTextData richText = new AssessmentRichTextData();
        richText.setContent(text);
        option.setText(richText);
        return option;
    }
}
