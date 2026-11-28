package vacademy.io.common.auth.filter;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InternalAuthFilterTest {

    @Test
    void wholeInternalSegmentIsIntercepted() {
        assertTrue(InternalAuthFilter.isInternalPath("/auth-service/internal/user"));
        assertTrue(InternalAuthFilter.isInternalPath("/auth-service/v1/user/internal/create-user"));
        assertTrue(InternalAuthFilter.isInternalPath("/auth-service/v1/internal"));
        assertTrue(InternalAuthFilter.isInternalPath("/internal/v1/details/abc"));
        assertTrue(InternalAuthFilter.isInternalPath("/media-service/internal"));
        assertTrue(InternalAuthFilter.isInternalPath("/media-service/internal/"));
    }

    @Test
    void encodedOrMatrixFormsOfTheSegmentAreIntercepted() {
        assertTrue(InternalAuthFilter.isInternalPath("/auth-service/%69nternal/user"));
        assertTrue(InternalAuthFilter.isInternalPath("/auth-service/internal;x=1/user"));
        assertTrue(InternalAuthFilter.isInternalPath("/auth-service/inter%6Eal;x=1/user"));
    }

    @Test
    void substringOnlyIsNotIntercepted() {
        assertFalse(InternalAuthFilter.isInternalPath("/admin-core-service/v1/notes/internal_note"));
        assertFalse(InternalAuthFilter.isInternalPath("/admin-core-service/internal-x/foo"));
        assertFalse(InternalAuthFilter.isInternalPath("/admin-core-service/v1/internalApi"));
        assertFalse(InternalAuthFilter.isInternalPath("/admin-core-service/v1/perf/ping"));
        assertFalse(InternalAuthFilter.isInternalPath("/bad/%zz/escape"));
        assertFalse(InternalAuthFilter.isInternalPath(null));
    }
}
