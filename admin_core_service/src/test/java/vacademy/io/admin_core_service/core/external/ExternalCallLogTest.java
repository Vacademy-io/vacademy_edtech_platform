package vacademy.io.admin_core_service.core.external;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** Failed third-party calls from admin-core are logged; successes and our own hosts are not. */
class ExternalCallLogTest {

    @Test
    void onlyOutsideHostsCount() {
        assertTrue(ExternalCallLog.external("api.plivo.com"));
        assertTrue(ExternalCallLog.external("api.razorpay.com"));
        for (String own : new String[]{"backend-stage.vacademy.io", "vacademy.io", "admin-core-service", "localhost",
                "10.0.0.5", "127.0.0.1", "media.default.svc.cluster.local", ""}) {
            assertFalse(ExternalCallLog.external(own), own);
        }
    }

    @Test
    void operationKeepsTwoPathSegmentsAndNoQuery() {
        assertEquals("POST /v1/Account", ExternalCallLog.operation("POST", "/v1/Account/MA123/Call/"));
        assertEquals("GET /", ExternalCallLog.operation("GET", ""));
    }

    @Test
    void aFailedCallIsWrittenAndTheCallerStillGetsItsError() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new ExternalCallLog(jdbc).register();
        RestTemplate rest = ExternalCallLog.attach(new RestTemplate());
        MockRestServiceServer server = MockRestServiceServer.bindTo(rest).build();
        server.expect(requestTo("https://api.plivo.com/v1/Account/MA1/Call/?secret=x"))
                .andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        server.expect(requestTo("https://api.plivo.com/v1/ok")).andRespond(withSuccess());

        assertThrows(HttpClientErrorException.class,
                () -> rest.exchange("https://api.plivo.com/v1/Account/MA1/Call/?secret=x", HttpMethod.GET, null, String.class));
        rest.getForObject("https://api.plivo.com/v1/ok", String.class);

        verify(jdbc, timeout(2000)).update(anyString(), org.mockito.ArgumentMatchers.any(java.sql.Timestamp.class),
                eq("api.plivo.com"), eq("admin_core"), eq("GET /v1/Account"), eq(401), eq((Object) null));
        verify(jdbc, never()).update(anyString(), org.mockito.ArgumentMatchers.any(java.sql.Timestamp.class),
                eq("api.plivo.com"), eq("admin_core"), eq("GET /v1/ok"),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void attachingTwiceAddsOneInterceptor() {
        RestTemplate rest = ExternalCallLog.attach(ExternalCallLog.attach(new RestTemplate()));
        assertEquals(1, rest.getInterceptors().size());
    }
}
