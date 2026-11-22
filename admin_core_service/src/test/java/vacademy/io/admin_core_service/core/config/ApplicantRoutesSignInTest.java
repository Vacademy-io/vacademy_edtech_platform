package vacademy.io.admin_core_service.core.config;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Applicant, enquiry and admission routes: only the application form routes
 * (and the two bulk imports, for now) stay open; everything else needs sign-in.
 * Mirrors the filter chain: a request is open when any ALLOWED_PATHS entry
 * matches it, otherwise anyRequest().authenticated() applies.
 */
class ApplicantRoutesSignInTest {

    private static boolean isOpen(String method, String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.setServletPath(uri);
        return Arrays.stream(ApplicationSecurityConfig.ALLOWED_PATHS)
                .anyMatch(p -> AntPathRequestMatcher.antMatcher(p).matches(request));
    }

    @ParameterizedTest
    @CsvSource({
            "POST, /admin-core-service/v1/applicant/list",
            "GET,  /admin-core-service/v1/applicant/list",
            "POST, /admin-core-service/v1/applicant/abc-123/move-stage",
            "POST, /admin-core-service/v1/applicant/onboard",
            "GET,  /admin-core-service/v1/applicant/parent/user-1",
            "GET,  /admin-core-service/v1/applicant/abc-123/stages",
            "GET,  /admin-core-service/applicant/v1/enquiry/details",
            "GET,  /admin-core-service/applicant/v1/enquiry/search",
            "POST, /admin-core-service/v1/admission/submit",
            // already signed-in before this change; must stay that way
            "POST, /admin-core-service/v1/admission/responses/list",
            "GET,  /admin-core-service/v1/admission/dashboard/pipeline-metrics",
            "GET,  /admin-core-service/admin/ota/v1/versions",
            "POST, /admin-core-service/admin/ota/v1/register",
            "POST, /admin-core-service/v1/invoices/test/generate/pl-1",
            "POST, /admin-core-service/v1/invoices/test/generate-multi-package/order-1",
            "POST, /admin-core-service/v1/invoices/test/generate-single/pl-1",
            // legacy presentation mode (no client calls it)
            "POST, /admin-core-service/live-presenter/v1/create",
            "GET,  /admin-core-service/live-presenter/v1/session-1",
            "GET,  /admin-core-service/live-learner/v1/session-1",
            "POST, /admin-core-service/live-learner/v1/session-1/heartbeat",
    })
    void requiresSignIn(String method, String uri) {
        assertFalse(isOpen(method, uri), uri + " should require sign-in");
    }

    @ParameterizedTest
    @CsvSource({
            "POST, /admin-core-service/v1/applicant/apply",
            "POST, /admin-core-service/v1/applicant/abc-123/payment/initiate",
            "POST, /admin-core-service/v1/applicant/bulk-apply",
            "POST, /admin-core-service/v1/admission/bulk-submit-with-admission",
            "POST, /admin-core-service/open/v1/applicant/abc-123/payment/initiate",
            "POST, /admin-core-service/open/v1/audience/lead/submit-with-enquiry",
            "GET,  /admin-core-service/public/ota/v1/check",
            "GET,  /admin-core-service/enrollment-policy/anything",
    })
    void staysOpen(String method, String uri) {
        assertTrue(isOpen(method, uri), uri + " should stay open");
    }
}
