package vacademy.io.admin_core_service.features.auth_service.service;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpServerErrorException;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The admin sees auth-service's reason, not the raw HTTP error text. */
class AuthErrorMessageTest {

    private static HttpServerErrorException authError(String body) {
        return HttpServerErrorException.create(HttpStatus.NOT_EXTENDED, "Not Extended", new HttpHeaders(),
                body.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8);
    }

    @Test
    void readsTheReasonFromAuthsErrorBody() {
        String body = "{\"url\":\"x\",\"ex\":\"Username \\\"Sahil\\\" is already taken. Please use a different username.\","
                + "\"responseCode\":\"510 NOT_EXTENDED\"}";

        assertEquals("Username \"Sahil\" is already taken. Please use a different username.",
                AuthService.authErrorMessage(authError(body)));
    }

    @Test
    void keepsTheExceptionMessageWhenTheBodyIsNotJson() {
        HttpServerErrorException e = authError("gateway down");

        assertEquals(e.getMessage(), AuthService.authErrorMessage(e));
    }

    @Test
    void keepsAnyOtherExceptionsMessage() {
        assertEquals("boom", AuthService.authErrorMessage(new IllegalStateException("boom")));
    }
}
