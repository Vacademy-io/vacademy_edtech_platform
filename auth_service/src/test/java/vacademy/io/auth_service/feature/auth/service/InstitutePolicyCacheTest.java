package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.admin_core_service.dto.InstituteSignupPolicy;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * "Learners may create courses" decides whether a public learner sign-up may be given
 * TEACHER. An answer from admin-core is reused for five minutes; no answer (admin-core down
 * or restarting) is not an answer, and is asked again after ten seconds.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class InstitutePolicyCacheTest {

    private static final String AUTHORS = "{\"setting\":\"{\\\"setting\\\":{\\\"COURSE_SETTING\\\":"
            + "{\\\"data\\\":{\\\"permissions\\\":{\\\"allowLearnersToCreateCourses\\\":true}}}}}\"}";
    private static final String NO_SETTINGS = "{\"setting\":null}";

    @Mock InternalClientUtils internalClientUtils;

    InstitutePolicyService service;
    final AtomicLong now = new AtomicLong(1_000_000L);

    @BeforeEach
    void setUp() {
        service = new InstitutePolicyService();
        ReflectionTestUtils.setField(service, "internalClientUtils", internalClientUtils);
        ReflectionTestUtils.setField(service, "applicationName", "auth_service");
        ReflectionTestUtils.setField(service, "adminCoreServiceBaseUrl", "http://admin-core.test");
        ReflectionTestUtils.setField(service, "clock", (LongSupplier) now::get);
    }

    private void adminCoreAnswers(String body) {
        doReturn(ResponseEntity.ok(body)).when(internalClientUtils)
                .makeHmacRequest(any(), any(), any(), any(), any());
    }

    private void adminCoreIsDown() {
        doThrow(new RuntimeException("connection refused")).when(internalClientUtils)
                .makeHmacRequest(any(), any(), any(), any(), any());
    }

    private void asked(int times) {
        verify(internalClientUtils, times(times)).makeHmacRequest(any(), any(), any(), any(), any());
    }

    @Test
    void aFailedLookupIsAskedAgainAfterTenSecondsNotFiveMinutes() {
        adminCoreIsDown();
        assertNull(service.fetchSignupPolicyCached("inst-1"));
        now.addAndGet(5_000);
        assertNull(service.fetchSignupPolicyCached("inst-1"));
        asked(1);

        adminCoreAnswers(AUTHORS);
        now.addAndGet(6_000);
        InstituteSignupPolicy policy = service.fetchSignupPolicyCached("inst-1");

        assertNotNull(policy);
        assertTrue(policy.isAllowLearnersToCreateCourses());
        asked(2);
    }

    @Test
    void theLastGoodAnswerIsKeptWhileAdminCoreCannotBeReached() {
        adminCoreAnswers(AUTHORS);
        assertTrue(service.fetchSignupPolicyCached("inst-1").isAllowLearnersToCreateCourses());

        adminCoreIsDown();
        now.addAndGet(6 * 60 * 1000L);
        assertTrue(service.fetchSignupPolicyCached("inst-1").isAllowLearnersToCreateCourses());
        asked(2);
    }

    @Test
    void anAnswerIncludingNoSettingsIsReusedForFiveMinutes() {
        adminCoreAnswers(NO_SETTINGS);
        assertNull(service.fetchSignupPolicyCached("inst-1"));
        now.addAndGet(4 * 60 * 1000L);
        assertNull(service.fetchSignupPolicyCached("inst-1"));
        asked(1);

        now.addAndGet(2 * 60 * 1000L);
        service.fetchSignupPolicyCached("inst-1");
        asked(2);
    }

    @Test
    void theUncachedLookupStillAnswersNullWhenAdminCoreIsDown() {
        adminCoreIsDown();
        assertNull(service.fetchSignupPolicy("inst-1"));
    }
}
