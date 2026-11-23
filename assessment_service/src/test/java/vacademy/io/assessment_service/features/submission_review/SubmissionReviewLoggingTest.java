package vacademy.io.assessment_service.features.submission_review;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.health.service.SlowQueryRegistry;
import vacademy.io.common.tracing.SlowQueryLogger;
import vacademy.io.common.tracing.TracingProperties;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Live follow-up B5 (2026-11-19): an expected refusal of the submission-review API (stale
 * edit, blocked release, missing reason...) is not a failure. The shared tracing aspect
 * logged every one at ERROR "FAILED" (and recorded it as an error); as a VacademyException
 * with a 4xx status it is now treated like any other business rejection.
 */
class SubmissionReviewLoggingTest {

    private SlowQueryLogger aspect;
    private SlowQueryRegistry registry;

    @BeforeEach
    void setUp() {
        aspect = new SlowQueryLogger();
        registry = mock(SlowQueryRegistry.class);
        ReflectionTestUtils.setField(aspect, "tracingProperties", new TracingProperties());
        ReflectionTestUtils.setField(aspect, "slowQueryRegistry", registry);
    }

    private ProceedingJoinPoint throwing(Throwable t) throws Throwable {
        ProceedingJoinPoint jp = mock(ProceedingJoinPoint.class);
        MethodSignature sig = mock(MethodSignature.class);
        when(sig.getDeclaringType()).thenReturn(SubmissionReviewService.class);
        when(sig.getName()).thenReturn("editOne");
        when(jp.getSignature()).thenReturn(sig);
        when(jp.getArgs()).thenReturn(new Object[0]);
        when(jp.proceed()).thenThrow(t);
        return jp;
    }

    @Test
    void refusals_are_vacademy_exceptions_with_their_status() {
        SubmissionReviewException e = SubmissionReviewException.conflict("STALE_REVISION", "changed", Map.of());
        assertThat(e).isInstanceOf(VacademyException.class);
        assertThat(((VacademyException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(SubmissionReviewException.unprocessable("REASON_REQUIRED", "why", null).getStatus().value())
                .isEqualTo(422);
    }

    @Test
    void expected_4xx_refusals_are_not_recorded_as_errors() throws Throwable {
        for (SubmissionReviewException e : new SubmissionReviewException[] {
                SubmissionReviewException.conflict("BLOCKERS", "Some answers are not marked yet", Map.of()),
                SubmissionReviewException.conflict("STALE_REVISION", "changed", Map.of()),
                SubmissionReviewException.conflict("RELEASE_CHANGED", "released", Map.of()),
                SubmissionReviewException.conflict("PROTECTED_MARK", "teacher", Map.of()),
                SubmissionReviewException.unprocessable("OUT_OF_RANGE", "0..5", Map.of()),
                SubmissionReviewException.unprocessable("REASON_REQUIRED", "why", null),
                SubmissionReviewException.unprocessable("TOO_MANY", "500", null)}) {
            ProceedingJoinPoint jp = throwing(e);
            assertThatThrownBy(() -> aspect.logServiceMethods(jp)).isSameAs(e);
        }
        verify(registry, never()).record(anyString(), anyString(), anyLong(), anyString(), any());
    }

    @Test
    void a_real_failure_is_still_an_error() throws Throwable {
        IllegalStateException boom = new IllegalStateException("db down");
        ProceedingJoinPoint jp = throwing(boom);
        assertThatThrownBy(() -> aspect.logServiceMethods(jp)).isSameAs(boom);
        verify(registry).record(eq("SubmissionReviewService.editOne"), eq("service"), anyLong(), eq("error"),
                eq("db down"));
        SubmissionReviewException server = new SubmissionReviewException(HttpStatus.INTERNAL_SERVER_ERROR, "X", "y");
        assertThatThrownBy(() -> aspect.logServiceMethods(throwing(server))).isSameAs(server);
        verify(registry).record(eq("SubmissionReviewService.editOne"), eq("service"), anyLong(), eq("error"),
                eq("y"));
    }
}
