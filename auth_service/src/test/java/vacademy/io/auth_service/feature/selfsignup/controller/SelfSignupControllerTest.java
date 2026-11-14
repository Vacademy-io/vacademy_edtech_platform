package vacademy.io.auth_service.feature.selfsignup.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SelfSignupControllerTest {

    @Test
    void theVisitorIsReadFromCloudflareNotTheEdge() {
        HttpServletRequest http = mock(HttpServletRequest.class);
        when(http.getHeader("CF-Connecting-IP")).thenReturn(" 203.0.113.9 ");
        when(http.getHeader("X-Forwarded-For")).thenReturn("172.70.1.1, 10.0.0.1");
        assertEquals("203.0.113.9", SelfSignupController.clientIp(http));
    }

    @Test
    void withoutCloudflareItFallsBack() {
        HttpServletRequest http = mock(HttpServletRequest.class);
        when(http.getHeader("X-Forwarded-For")).thenReturn("198.51.100.7, 10.0.0.1");
        assertEquals("198.51.100.7", SelfSignupController.clientIp(http));
        HttpServletRequest direct = mock(HttpServletRequest.class);
        when(direct.getRemoteAddr()).thenReturn("10.1.1.1");
        assertEquals("10.1.1.1", SelfSignupController.clientIp(direct));
    }
}
