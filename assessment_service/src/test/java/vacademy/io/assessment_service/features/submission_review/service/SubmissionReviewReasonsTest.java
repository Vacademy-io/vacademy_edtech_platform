package vacademy.io.assessment_service.features.submission_review.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** The AI check's review reasons reach the submission review screen; older results have none. */
class SubmissionReviewReasonsTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void reasons_are_read_from_the_stored_result() throws Exception {
        assertThat(SubmissionReviewService.reviewReasons(mapper.readTree(
                "{\"review_reasons\":[\"Handwriting unclear in 2(a)(iii): 'not' may be a misreading\",\"\",null]}")))
                .containsExactly("Handwriting unclear in 2(a)(iii): 'not' may be a misreading");
    }

    @Test
    void older_results_have_none() throws Exception {
        assertThat(SubmissionReviewService.reviewReasons(mapper.readTree("{\"marks_awarded\":4}"))).isEmpty();
        assertThat(SubmissionReviewService.reviewReasons(null)).isEmpty();
    }
}
