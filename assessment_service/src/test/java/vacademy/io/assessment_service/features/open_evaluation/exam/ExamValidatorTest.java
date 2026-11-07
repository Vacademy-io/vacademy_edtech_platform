package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ExamValidatorTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 1);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    static ExamInputs.QuestionInput mcq(String label, String section, String... correct) {
        ExamInputs.QuestionInput q = new ExamInputs.QuestionInput();
        q.setLabel(label);
        q.setSection(section);
        q.setType("mcq_single");
        q.setText("Which is balanced?");
        q.setMaxMarks(BigDecimal.ONE);
        q.setOptions(List.of(new ExamInputs.OptionInput("A", "a"), new ExamInputs.OptionInput("B", "b"),
                new ExamInputs.OptionInput("C", "c")));
        q.setCorrectOptions(List.of(correct));
        return q;
    }

    static ExamInputs.QuestionInput longAnswer(String label, String section, String max) {
        ExamInputs.QuestionInput q = new ExamInputs.QuestionInput();
        q.setLabel(label);
        q.setSection(section);
        q.setType("long_answer");
        q.setText("Why is respiration exothermic?");
        q.setMaxMarks(new BigDecimal(max));
        return q;
    }

    static ExamInputs.RubricInput rubric(Object... nameMarksGuidance) {
        ExamInputs.RubricInput r = new ExamInputs.RubricInput();
        List<ExamInputs.CriterionInput> criteria = new ArrayList<>();
        for (int i = 0; i < nameMarksGuidance.length; i += 3) {
            criteria.add(new ExamInputs.CriterionInput((String) nameMarksGuidance[i],
                    new BigDecimal(nameMarksGuidance[i + 1].toString()), List.of(), (String) nameMarksGuidance[i + 2]));
        }
        r.setCriteria(criteria);
        return r;
    }

    static ExamInputs.CreateExam exam(ExamInputs.QuestionInput... questions) {
        ExamInputs.CreateExam e = new ExamInputs.CreateExam();
        e.setTitle("Class X Science — Half-Yearly");
        e.setMode("handwritten");
        e.setQuestions(new ArrayList<>(List.of(questions)));
        return e;
    }

    @Test
    void valid_exam_gets_defaults_and_derived_sections() {
        ExamValidator.ValidatedExam v = ExamValidator.validateCreate(
                exam(mcq("1", "A", "C"), longAnswer("21", "B", "2")), TODAY);

        assertThat(v.conductedOn()).isEqualTo(TODAY);
        assertThat(v.level()).isEqualTo("school");
        assertThat(v.answerLanguage()).isEqualTo("en");
        assertThat(v.sections()).extracting(ExamInputs.SectionInput::getName).containsExactly("A", "B");
        assertThat(v.questions()).extracting(ExamValidator.ValidatedQuestion::internalType)
                .containsExactly("MCQS", "LONG_ANSWER");
        // long answer without rubric or model answer: accepted with auto_rubric
        assertThat(v.warnings()).extracting(w -> w.code()).containsExactly("auto_rubric");
    }

    @Test
    void no_sections_and_no_question_sections_defaults_to_a() {
        ExamValidator.ValidatedExam v = ExamValidator.validateCreate(exam(mcq("1", null, "A")), TODAY);
        assertThat(v.sections()).extracting(ExamInputs.SectionInput::getName).containsExactly("A");
        assertThat(v.questions().get(0).section()).isEqualTo("A");
    }

    @Test
    void shape_errors_are_collected_together() {
        ExamInputs.CreateExam e = exam(mcq("1", "A", "A"), mcq("1", "A", "B"));
        e.setTitle(" ");
        e.setMode("oral");
        e.getQuestions().get(0).setMaxMarks(new BigDecimal("0.3"));

        assertThatThrownBy(() -> ExamValidator.validateCreate(e, TODAY))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED);
                    @SuppressWarnings("unchecked")
                    List<Map<String, String>> errors = (List<Map<String, String>>) ex.getDetails().get("errors");
                    assertThat(errors).extracting(m -> m.get("field"))
                            .contains("title", "mode", "questions[0].max_marks", "questions[1].label");
                });
    }

    @Test
    void declared_sections_must_cover_question_sections() {
        ExamInputs.CreateExam e = exam(mcq("1", "Z", "A"));
        e.setSections(List.of(new ExamInputs.SectionInput("A", 1)));
        assertThatThrownBy(() -> ExamValidator.validateCreate(e, TODAY))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("questions[0].section"));
    }

    @Test
    void unknown_correct_option_label_has_its_own_code() {
        assertThatThrownBy(() -> ExamValidator.validateCreate(exam(mcq("1", "A", "D")), TODAY))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ApiErrorCode.UNKNOWN_OPTION_LABEL);
                    assertThat(ex.getDetails()).containsEntry("option_label", "D").containsEntry("question_label", "1");
                });
    }

    @Test
    void mcq_single_needs_exactly_one_correct_option() {
        assertThatThrownBy(() -> ExamValidator.validateCreate(exam(mcq("1", "A", "A", "B")), TODAY))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("questions[0].correct_options"));
    }

    @Test
    void rubric_marks_must_add_up_to_question_max() {
        ExamInputs.QuestionInput q = longAnswer("3(a)", "A", "5");
        q.setRubric(rubric("Idea", 2, "States the idea.", "Example", 2, "Gives an example."));
        assertThatThrownBy(() -> ExamValidator.validateCreate(exam(q), TODAY))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ApiErrorCode.RUBRIC_MARKS_MISMATCH);
                    assertThat(ex.getDetails()).containsEntry("question_label", "3(a)");
                    assertThat(ex.getMessage()).contains("add up to 4").contains("max is 5");
                });
    }

    @Test
    void duplicate_criterion_names_are_refused_case_insensitively() {
        ExamInputs.QuestionInput q = longAnswer("2", "A", "2");
        q.setRubric(rubric("Energy", 1, "", "energy ", 1, ""));
        assertThatThrownBy(() -> ExamValidator.validateCreate(exam(q), TODAY))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.RUBRIC_DUPLICATE_CRITERION));
    }

    @Test
    void guidance_with_mark_figures_is_refused() {
        ExamInputs.QuestionInput q = longAnswer("2", "A", "2");
        q.setRubric(rubric("Energy", 2, "Award 1 mark for naming energy."));
        assertThatThrownBy(() -> ExamValidator.validateCreate(exam(q), TODAY))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.RUBRIC_GUIDANCE_HAS_MARKS));
    }

    @Test
    void quarter_mark_criteria_are_accepted_with_a_warning_and_a_rubric_silences_auto_rubric() {
        ExamInputs.QuestionInput q = longAnswer("2", "A", "1");
        q.setRubric(rubric("Idea", "0.25", "", "Detail", "0.75", ""));
        ExamValidator.ValidatedExam v = ExamValidator.validateCreate(exam(q), TODAY);
        assertThat(v.warnings()).extracting(w -> w.code()).containsExactly("rubric_marks_not_half_step",
                "rubric_marks_not_half_step");
    }

    @Test
    void hindi_is_refused_with_language_not_supported() {
        ExamInputs.CreateExam e = exam(mcq("1", "A", "A"));
        e.setAnswerLanguage("hi");
        assertThatThrownBy(() -> ExamValidator.validateCreate(e, TODAY))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.LANGUAGE_NOT_SUPPORTED));
    }

    @Test
    void negative_marks_on_handwritten_are_dropped_with_a_warning_but_kept_on_typed() {
        ExamInputs.QuestionInput q = mcq("1", "A", "A");
        q.setNegativeMarks(new BigDecimal("0.25"));
        ExamValidator.ValidatedExam hw = ExamValidator.validateCreate(exam(q), TODAY);
        assertThat(hw.questions().get(0).negativeMarks()).isEqualByComparingTo("0");
        assertThat(hw.warnings()).extracting(w -> w.code()).contains("negative_marks_ignored");

        ExamInputs.CreateExam typed = exam(q);
        typed.setMode("typed");
        ExamValidator.ValidatedExam t = ExamValidator.validateCreate(typed, TODAY);
        assertThat(t.questions().get(0).negativeMarks()).isEqualByComparingTo("0.25");
        assertThat(t.warnings()).extracting(w -> w.code()).doesNotContain("negative_marks_ignored");
    }

    @Test
    void numeric_and_one_word_need_answers() {
        ExamInputs.QuestionInput n = longAnswer("1", "A", "1");
        n.setType("numeric");
        ExamInputs.QuestionInput w = longAnswer("2", "A", "1");
        w.setType("one_word");
        assertThatThrownBy(() -> ExamValidator.validateCreate(exam(n, w), TODAY))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> assertThat(ex.getDetails().toString())
                        .contains("questions[0].answer").contains("questions[1].answer"));

        n.setAnswer(JsonNodeFactory.instance.textNode("9.8"));
        w.setAnswer(JsonNodeFactory.instance.textNode("photosynthesis"));
        ExamValidator.ValidatedExam v = ExamValidator.validateCreate(exam(n, w), TODAY);
        assertThat(v.questions().get(0).numericAnswers()).containsExactly(9.8);
        assertThat(v.questions().get(1).oneWordAnswer()).isEqualTo("photosynthesis");
    }

    @Test
    void angle_brackets_are_refused_in_labels_and_titles() {
        ExamInputs.CreateExam e = exam(mcq("<b>1</b>", "A", "A"));
        e.setTitle("Test <script>");
        assertThatThrownBy(() -> ExamValidator.validateCreate(e, TODAY))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> assertThat(ex.getDetails().toString())
                        .contains("invalid_characters").contains("title").contains("questions[0].label"));
    }

    @Test
    void choice_groups_are_checked_and_paper_max_takes_top_attempt_maxima() {
        ExamInputs.ChoiceGroupInput partB = new ExamInputs.ChoiceGroupInput("Part B", List.of("11", "12", "13"), 2, "best");
        ExamValidator.validateChoiceGroups(List.of(partB), List.of("1", "11", "12", "13"), "choice_groups");

        Map<String, BigDecimal> max = new java.util.LinkedHashMap<>();
        max.put("1", new BigDecimal("2"));
        max.put("11", new BigDecimal("10"));
        max.put("12", new BigDecimal("5"));
        max.put("13", new BigDecimal("8"));
        assertThat(ExamValidator.paperMax(max, List.of(partB))).isEqualByComparingTo("20"); // 2 + 10 + 8

        ExamInputs.ChoiceGroupInput all = new ExamInputs.ChoiceGroupInput(null, List.of("11", "12"), 2, "first");
        ExamInputs.ChoiceGroupInput overlap = new ExamInputs.ChoiceGroupInput(null, List.of("12", "13"), 1, "worst");
        assertThatThrownBy(() -> ExamValidator.validateChoiceGroups(List.of(all, overlap),
                List.of("11", "12", "13"), "choice_groups"))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> assertThat(ex.getDetails().toString())
                        .contains("choice_groups[0].attempt")       // attempt == size is not a choice
                        .contains("choice_groups[1].question_labels") // 12 in two groups
                        .contains("choice_groups[1].policy"));
    }

    @Test
    void create_validates_choice_group_labels_against_its_questions() {
        ExamInputs.CreateExam e = exam(longAnswer("33", "A", "5"), longAnswer("33-OR", "A", "5"));
        e.setChoiceGroups(List.of(new ExamInputs.ChoiceGroupInput("Q33", List.of("33", "34"), 1, "first")));
        assertThatThrownBy(() -> ExamValidator.validateCreate(e, TODAY))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("No question labelled 34"));
    }

    @Test
    void choice_group_labels_match_question_labels_ignoring_case() {
        ExamInputs.ChoiceGroupInput g = new ExamInputs.ChoiceGroupInput(null, List.of("33", "33-or"), 1, "first");
        ExamValidator.validateChoiceGroups(List.of(g), List.of("33", "33-OR"), "choice_groups");

        ExamInputs.ChoiceGroupInput dup = new ExamInputs.ChoiceGroupInput(null, List.of("33-OR", "33-or"), 1, "first");
        assertThatThrownBy(() -> ExamValidator.validateChoiceGroups(List.of(dup), List.of("33", "33-OR"), "choice_groups"))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("duplicate"));
    }

    @Test
    void candidates_need_unique_external_ids_and_small_metadata() throws Exception {
        ExamInputs.CandidateInput a = new ExamInputs.CandidateInput("STU-1", "Aarav", "10A07", null, null);
        ExamInputs.CandidateInput b = new ExamInputs.CandidateInput("STU-1", "Dup", null, null,
                MAPPER.readTree("{\"blob\":\"" + "x".repeat(3000) + "\"}"));
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        ExamValidator.validateCandidates(List.of(a, b), "candidates", errors);
        assertThat(errors).extracting(OpenApiException.FieldError::field)
                .containsExactly("candidates[1].external_id", "candidates[1].metadata");
    }
}
