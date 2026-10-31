package vacademy.io.admin_core_service.core.exception;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import vacademy.io.common.core.exception.GlobalExceptionHandler;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * An oversized multipart body used to fall through to {@code GlobalExceptionHandler}'s
 * {@code RuntimeException} catch-all and go out as 511, which both frontends discard as a
 * server error -- so a SCORM zip over the limit surfaced as an unexplained "Network Error".
 *
 * <p>Reading the advice is not enough to prove the fix: Spring picks a handler by walking the
 * exception hierarchy, so only a real round-trip shows that the specific handler wins over the
 * supertype one. Same lesson the {@code ResponseStatusException} 511 regression taught.
 */
class UploadSizeExceptionHandlingTest {

    @RestController
    static class ThrowingController {
        @PostMapping("/upload")
        public String upload() {
            throw new MaxUploadSizeExceededException(150L * 1024 * 1024);
        }
    }

    private MockMvc mockMvc(String configuredLimit) {
        GlobalExceptionHandler advice = new GlobalExceptionHandler();
        // @Value is not applied to a hand-built advice; set the field the way the context would.
        ReflectionTestUtils.setField(advice, "maxFileSize", configuredLimit);
        return MockMvcBuilders.standaloneSetup(new ThrowingController())
                .setControllerAdvice(advice)
                .build();
    }

    @Test
    void oversizedUploadAnswers413WithAReasonCodeClientsCanMatch() throws Exception {
        mockMvc("150MB").perform(post("/upload").contentType(MediaType.MULTIPART_FORM_DATA))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.responseCode").value("FILE_TOO_LARGE"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("150MB")))
                // `ex` repeats the reason so clients already reading ErrorInfo's field keep working.
                .andExpect(jsonPath("$.ex").value(org.hamcrest.Matchers.containsString("exceeds the maximum")));
    }

    @Test
    void limitIsOmittedRatherThanPrintedBlankWhenThePropertyIsUnset() throws Exception {
        mockMvc("").perform(post("/upload").contentType(MediaType.MULTIPART_FORM_DATA))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.message").value("The uploaded file exceeds the maximum allowed size."));
    }
}
