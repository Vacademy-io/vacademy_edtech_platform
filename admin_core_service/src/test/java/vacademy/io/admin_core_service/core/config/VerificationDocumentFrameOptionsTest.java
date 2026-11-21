package vacademy.io.admin_core_service.core.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Only the public verification document may be framed; every other response
 * keeps X-Frame-Options: DENY.
 */
class VerificationDocumentFrameOptionsTest {

    private static boolean matches(String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", uri);
        return ApplicationSecurityConfig.VERIFICATION_DOCUMENT.matches(request);
    }

    @Test
    void matchesTheVerificationDocument() {
        assertTrue(matches("/admin-core-service/open/v1/certificate/verify/EDU2026001/document"));
        // Numbering patterns allow '/', which arrives percent-encoded.
        assertTrue(matches("/admin-core-service/open/v1/certificate/verify/EDU%2F2026%2F001/document"));
    }

    @Test
    void doesNotMatchAnythingElse() {
        assertFalse(matches("/admin-core-service/open/v1/certificate/verify/EDU2026001"));
        assertFalse(matches("/admin-core-service/open/v1/certificate/verify"));
        assertFalse(matches("/admin-core-service/institute/v1/document"));
        assertFalse(matches("/admin-core-service/open/v1/certificate/verify/x/document/extra"));
    }
}
