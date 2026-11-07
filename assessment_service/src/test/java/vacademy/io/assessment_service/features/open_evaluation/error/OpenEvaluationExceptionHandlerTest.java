package vacademy.io.assessment_service.features.open_evaluation.error;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import vacademy.io.assessment_service.features.open_evaluation.auth.ApiScopes;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.tracing.RequestIds;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Spec 7.0 envelope and 8.3 request codes, without leaking internals. */
@SuppressWarnings("unchecked")
class OpenEvaluationExceptionHandlerTest {

    private final OpenEvaluationExceptionHandler handler = new OpenEvaluationExceptionHandler();

    private static MockHttpServletRequest request() {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/assessment-service/open/evaluation/v1/exams");
        req.setAttribute(RequestIds.ATTRIBUTE, "req_test123");
        return req;
    }

    private static Map<String, Object> error(ResponseEntity<Map<String, Object>> response) {
        return (Map<String, Object>) response.getBody().get("error");
    }

    @Test
    void api_exception_renders_code_message_request_id_details_and_headers() {
        OpenApiException ex = new OpenApiException(HttpStatus.TOO_MANY_REQUESTS, "daily_quota_exceeded", "Used up.",
                Map.of("quota", "daily_copy_quota"), Map.of("Retry-After", "60"));

        ResponseEntity<Map<String, Object>> r = handler.handleApi(request(), ex);

        assertThat(r.getStatusCode().value()).isEqualTo(429);
        assertThat(error(r)).containsEntry("code", "daily_quota_exceeded").containsEntry("message", "Used up.")
                .containsEntry("request_id", "req_test123");
        assertThat((Map<String, Object>) error(r).get("details")).containsEntry("quota", "daily_copy_quota");
        assertThat(r.getHeaders().getFirst("Retry-After")).isEqualTo("60");
        assertThat(r.getHeaders().getFirst("X-Request-Id")).isEqualTo("req_test123");
        assertThat(r.getHeaders().getCacheControl()).isEqualTo("no-store");
    }

    @Test
    void validation_errors_carry_field_level_details() {
        OpenApiException ex = OpenApiException.validation(List.of(
                new OpenApiException.FieldError("questions[3].max_marks", "required", "max_marks is required."),
                new OpenApiException.FieldError("title", "too_long", "title is too long.")));
        ResponseEntity<Map<String, Object>> r = handler.handleApi(request(), ex);
        assertThat(r.getStatusCode().value()).isEqualTo(422);
        assertThat(error(r)).containsEntry("code", "validation_failed");
        List<Map<String, String>> errors = (List<Map<String, String>>) ((Map<String, Object>) error(r).get("details"))
                .get("errors");
        assertThat(errors).hasSize(2);
        assertThat(errors.get(0)).containsEntry("field", "questions[3].max_marks").containsEntry("code", "required");
    }

    @Test
    void scope_refusal_is_403_insufficient_scope_naming_the_scope() {
        MockHttpServletRequest req = request();
        req.setAttribute(ApiScopes.REQUIRED_SCOPE_ATTRIBUTE, "evaluation:finalize");
        ResponseEntity<Map<String, Object>> r = handler.handleDenied(req, new AccessDeniedException("Access Denied"));
        assertThat(r.getStatusCode().value()).isEqualTo(403);
        assertThat(error(r)).containsEntry("code", "insufficient_scope");
        assertThat((Map<String, Object>) error(r).get("details")).containsEntry("required_scope", "evaluation:finalize");
    }

    @Test
    void finalized_result_is_409_submission_finalized() {
        ResponseEntity<Map<String, Object>> r = handler.handleLocked(request(), new ResultLockedException("att-1"));
        assertThat(r.getStatusCode().value()).isEqualTo(409);
        assertThat(error(r)).containsEntry("code", "submission_finalized");
    }

    @Test
    void unreadable_body_is_400_malformed_json() {
        ResponseEntity<Map<String, Object>> r = handler.handleUnreadable(request(),
                new HttpMessageNotReadableException("bad", new ServletServerHttpRequest(request())));
        assertThat(r.getStatusCode().value()).isEqualTo(400);
        assertThat(error(r)).containsEntry("code", "malformed_json");
    }

    @Test
    void not_found_and_tenant_failures_are_404_without_internal_detail() {
        ResponseEntity<Map<String, Object>> nf = handler.handleNotFound(request(),
                new ResourceNotFoundException("Student Attempt not found: other-institute-id"));
        assertThat(nf.getStatusCode().value()).isEqualTo(404);
        assertThat(String.valueOf(error(nf).get("message"))).doesNotContain("other-institute-id");

        ResponseEntity<Map<String, Object>> forbidden = handler.handleForbidden(request(),
                new ForbiddenException("This assessment does not belong to your institute"));
        assertThat(forbidden.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void unexpected_errors_are_500_internal_error_with_a_generic_message() {
        ResponseEntity<Map<String, Object>> r = handler.handleAny(request(),
                new IllegalStateException("password=hunter2 at db host 10.0.0.5"));
        assertThat(r.getStatusCode().value()).isEqualTo(500);
        assertThat(error(r)).containsEntry("code", "internal_error");
        assertThat(String.valueOf(error(r).get("message"))).doesNotContain("hunter2");

        ResponseEntity<Map<String, Object>> legacy = handler.handleVacademy(request(),
                new VacademyException("Assessment Not Found in table x"));
        assertThat(legacy.getStatusCode().value()).isEqualTo(500);
    }

    @Test
    void error_writer_from_filters_shares_the_envelope() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        new OpenApiAuthEntryPoint((rq, rs, e) -> {
            throw new AssertionError("fallback must not run for partner paths");
        }, (rq, rs, e) -> {
            throw new AssertionError("fallback must not run for partner paths");
        }).commence(request(), response, null);
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("\"code\":\"invalid_api_key\"");
    }

    @Test
    void dashboard_paths_keep_the_existing_entry_point() throws Exception {
        MockHttpServletRequest dashboard = new MockHttpServletRequest("GET", "/assessment-service/assessment/x");
        assertThatThrownBy(() -> new OpenApiAuthEntryPoint((rq, rs, e) -> {
            throw new IllegalStateException("fallback ran");
        }, (rq, rs, e) -> {
        }).commence(dashboard, new MockHttpServletResponse(), null)).hasMessage("fallback ran");
    }
}
