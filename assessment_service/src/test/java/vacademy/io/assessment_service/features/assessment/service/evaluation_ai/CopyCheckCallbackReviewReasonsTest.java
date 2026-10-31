package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckCallbackDto;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The stored question JSON is the serialized callback: review_reasons must survive it for
 * the partner API's needs_review rule, and stay out of it when ai_service sends none.
 */
class CopyCheckCallbackReviewReasonsTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void review_reasons_round_trip_into_the_stored_json() throws Exception {
        CopyCheckCallbackDto.QuestionDone in = mapper.readValue(
                "{\"question_id\":\"q1\",\"confidence\":0.9,\"review_reasons\":[\"enforcement_changed_marks\"]}",
                CopyCheckCallbackDto.QuestionDone.class);
        assertThat(in.getReviewReasons()).containsExactly("enforcement_changed_marks");
        assertThat(mapper.writeValueAsString(in)).contains("\"review_reasons\":[\"enforcement_changed_marks\"]");
    }

    @Test
    void absent_review_reasons_leave_the_stored_json_unchanged() throws Exception {
        CopyCheckCallbackDto.QuestionDone in = CopyCheckCallbackDto.QuestionDone.builder().questionId("q1").build();
        assertThat(mapper.writeValueAsString(in)).doesNotContain("review_reasons");
    }

    @Test
    void the_confidence_pattern_reads_jacksons_scientific_notation() throws Exception {
        // Same pattern as the SQL in ApiSubmissionStore (Postgres ARE and java.util.regex agree here).
        Pattern p = Pattern.compile("\"confidence\":(-?[0-9]+(?:[.][0-9]*)?(?:[eE][-+]?[0-9]+)?)");
        String json = mapper.writeValueAsString(List.of(java.util.Map.of("confidence", 5.4E-4)));
        Matcher m = p.matcher(json);
        assertThat(m.find()).isTrue();
        assertThat(new java.math.BigDecimal(m.group(1))).isEqualByComparingTo("0.00054");
        Matcher plain = p.matcher("{\"confidence\":0.54}");
        assertThat(plain.find()).isTrue();
        assertThat(plain.group(1)).isEqualTo("0.54");
    }
}
