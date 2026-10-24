package vacademy.io.assessment_service.features.open_evaluation.result;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FailureCodesTest {

    @Test
    void ai_service_code_prefix_wins() {
        assertThat(FailureCodes.code("language_not_supported: 34% Devanagari", null))
                .isEqualTo(FailureCodes.LANGUAGE_NOT_SUPPORTED);
        assertThat(FailureCodes.code("copy_unreadable: x", null)).isEqualTo(FailureCodes.COPY_UNREADABLE);
    }

    @Test
    void engine_messages_map_to_spec_codes() {
        assertThat(FailureCodes.code("insufficient_credits: needs 12", "INSUFFICIENT_CREDITS"))
                .isEqualTo(FailureCodes.INSUFFICIENT_CREDITS);
        assertThat(FailureCodes.code("x", "INSUFFICIENT_CREDITS")).isEqualTo(FailureCodes.INSUFFICIENT_CREDITS);
        assertThat(FailureCodes.code("Evaluation timed out after 2 requeues", null)).isEqualTo(FailureCodes.TIMED_OUT);
        assertThat(FailureCodes.code("no file_id on attempt — nothing to grade", null)).isEqualTo(FailureCodes.FILE_MISSING);
        assertThat(FailureCodes.code("media-service did not return a URL for file_id=abc", null))
                .isEqualTo(FailureCodes.FILE_UNAVAILABLE);
        assertThat(FailureCodes.code("no questions found for attempt a1", null))
                .isEqualTo(FailureCodes.NO_GRADABLE_QUESTIONS);
        assertThat(FailureCodes.code("The answer sheet could not be read reliably", null))
                .isEqualTo(FailureCodes.COPY_UNREADABLE);
        assertThat(FailureCodes.code("Cancelled by user", null)).isEqualTo(FailureCodes.CANCELLED);
        assertThat(FailureCodes.code("ai_service submit failed: 500", null)).isEqualTo(FailureCodes.ENGINE_UNAVAILABLE);
        assertThat(FailureCodes.code(null, null)).isEqualTo(FailureCodes.ENGINE_UNAVAILABLE);
    }

    @Test
    void an_unknown_prefix_is_not_trusted_and_messages_are_fixed() {
        assertThat(FailureCodes.code("weird_code: boom", null)).isEqualTo(FailureCodes.ENGINE_UNAVAILABLE);
        assertThat(FailureCodes.error("internal file id f-123 broke", null).get("message"))
                .asString().doesNotContain("f-123");
    }
}
