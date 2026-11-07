package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** ai_service's FailedCallback.error_code is stored in front of the message (spec 8.3). */
class CopyCheckCallbackErrorCodeTest {

    @Test
    void the_code_is_prefixed_once() {
        assertThat(CopyCheckCallbackService.withErrorCode("copy_unreadable", "Sheet could not be read"))
                .isEqualTo("copy_unreadable: Sheet could not be read");
        assertThat(CopyCheckCallbackService.withErrorCode("copy_unreadable", "copy_unreadable: x"))
                .isEqualTo("copy_unreadable: x");
        assertThat(CopyCheckCallbackService.withErrorCode("language_not_supported", null))
                .isEqualTo("language_not_supported");
    }

    @Test
    void older_callbacks_and_odd_codes_keep_the_message_as_is() {
        assertThat(CopyCheckCallbackService.withErrorCode(null, "boom")).isEqualTo("boom");
        assertThat(CopyCheckCallbackService.withErrorCode("Not A Code!", "boom")).isEqualTo("boom");
    }
}
