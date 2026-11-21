package vacademy.io.assessment_service.features.open_evaluation.error;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.ResultReleasedException;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.CreditCheckUnavailableException;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.InsufficientCreditsException;
import vacademy.io.common.tracing.RequestIds;

import java.math.BigDecimal;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** The engine's credit and release refusals in the partner envelope (spec 8.3, 10.6). */
@SuppressWarnings("unchecked")
class OpenEvaluationCreditErrorsTest {

    private final OpenEvaluationExceptionHandler handler = new OpenEvaluationExceptionHandler();

    private static MockHttpServletRequest request() {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/assessment-service/open/evaluation/v1/exams/e/submissions");
        req.setAttribute(RequestIds.ATTRIBUTE, "req_1");
        return req;
    }

    @Test
    void insufficient_credits_is_402_with_the_numbers() {
        ResponseEntity<Map<String, Object>> r = handler.handleCredits(request(), new InsufficientCreditsException(
                new BigDecimal("28"), new BigDecimal("12.50"), new BigDecimal("10.50"), new BigDecimal("5"),
                new BigDecimal("3.00")));

        assertThat(r.getStatusCode().value()).isEqualTo(402);
        Map<String, Object> error = (Map<String, Object>) r.getBody().get("error");
        assertThat(error).containsEntry("code", "insufficient_credits");
        assertThat((Map<String, Object>) error.get("details")).containsEntry("required", 28L)
                .containsEntry("available", new BigDecimal("12.5")).containsEntry("balance", new BigDecimal("10.5"))
                .containsEntry("credit_limit", 5L).containsEntry("committed", 3L);
    }

    @Test
    void credit_service_down_is_503_engine_unavailable_with_retry_after() {
        ResponseEntity<Map<String, Object>> r = handler.handleCreditsUnavailable(request(),
                new CreditCheckUnavailableException("401"));

        assertThat(r.getStatusCode().value()).isEqualTo(503);
        assertThat(((Map<String, Object>) r.getBody().get("error")).get("code")).isEqualTo("engine_unavailable");
        assertThat(r.getHeaders().getFirst("Retry-After")).isEqualTo("30");
    }

    @Test
    void a_released_result_is_409_submission_finalized() {
        ResponseEntity<Map<String, Object>> r = handler.handleReleased(request(), new ResultReleasedException("x"));
        assertThat(r.getStatusCode().value()).isEqualTo(409);
        assertThat(((Map<String, Object>) r.getBody().get("error")).get("code")).isEqualTo("submission_finalized");
    }
}
