package vacademy.io.assessment_service.features.question_library.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.question_core.dto.OptionDTO;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.rich_text.dto.AssessmentRichTextDataDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The prompt sent for AI concept tagging and how the answer is cleaned before it is saved. */
class QuestionLibraryAutoTagServiceTest {

    private QuestionLibraryAutoTagService service() {
        QuestionLibraryAutoTagService service = new QuestionLibraryAutoTagService();
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        return service;
    }

    private static QuestionDTO question(String html, String... options) {
        QuestionDTO dto = new QuestionDTO();
        dto.setText(new AssessmentRichTextDataDTO(null, "HTML", html));
        dto.setOptions(java.util.Arrays.stream(options).map(text -> {
            OptionDTO option = new OptionDTO();
            option.setText(new AssessmentRichTextDataDTO(null, "HTML", text));
            return option;
        }).toList());
        return dto;
    }

    @Test
    void the_prompt_carries_plain_text_options_chapter_and_the_tags_to_reuse() {
        String prompt = QuestionLibraryAutoTagService.buildPrompt(
                List.of("q1", "missing"),
                Map.of("q1", question("<p>A ball is thrown at&nbsp;30&deg;</p>", "<b>10 m</b>", "20 m")),
                Map.of("q1", List.of("JEE Main", "Physics", "Kinematics")),
                List.of("Projectile Motion", "Relative Velocity"));

        assertThat(prompt).contains("EXISTING TAGS: Projectile Motion; Relative Velocity");
        assertThat(prompt).contains("[1] id: q1");
        assertThat(prompt).contains("chapter: JEE Main > Physics > Kinematics");
        assertThat(prompt).contains("text: A ball is thrown at 30&deg;");
        assertThat(prompt).contains("options: A) 10 m | B) 20 m");
        assertThat(prompt).doesNotContain("<p>").doesNotContain("missing");
    }

    @Test
    void says_so_when_there_are_no_tags_yet() {
        String prompt = QuestionLibraryAutoTagService.buildPrompt(List.of(), Map.of(), Map.of(), List.of());
        assertThat(prompt).contains("EXISTING TAGS: (none yet)");
    }

    @Test
    void keeps_only_asked_ids_three_clean_tags_each_and_no_chapter_names() {
        String answer = """
                {"questions":[
                  {"id":"q1","tags":["  Projectile Motion. ","projectile motion","\\"Range\\"","Kinematics","Time of Flight","Max Height"]},
                  {"id":"q2","tags":[]},
                  {"id":"intruder","tags":["Anything"]},
                  {"id":"q1","tags":["Second Answer"]},
                  {"id":"q3","tags":["%s"]}
                ]}
                """.formatted("x".repeat(80));

        Map<String, List<String>> parsed = service().parse(answer, Set.of("q1", "q2", "q3"),
                Map.of("q1", List.of("JEE Main", "Physics", "Kinematics")));

        assertThat(parsed).containsOnlyKeys("q1", "q2", "q3");
        // Duplicate in another case, the chapter name and the 4th tag are dropped.
        assertThat(parsed.get("q1")).containsExactly("Projectile Motion", "Range", "Time of Flight");
        assertThat(parsed.get("q2")).isEmpty();
        // Over 60 characters is not a tag.
        assertThat(parsed.get("q3")).isEmpty();
    }

    @Test
    void an_answer_that_is_not_json_is_an_error_not_an_empty_result() {
        assertThatThrownBy(() -> service().parse("Sure! Here are the tags:", Set.of("q1"), Map.of()))
                .isInstanceOf(VacademyException.class);
        assertThat(service().parse("{\"other\":1}", Set.of("q1"), Map.of())).isEmpty();
    }

    @Test
    void cleans_a_tag_but_keeps_inner_punctuation() {
        assertThat(QuestionLibraryAutoTagService.cleanTag("  \"Ohm's Law\".\n")).isEqualTo("Ohm's Law");
        assertThat(QuestionLibraryAutoTagService.cleanTag("- Article  21 -")).isEqualTo("Article 21");
        assertThat(QuestionLibraryAutoTagService.cleanTag(null)).isEmpty();
    }
}
