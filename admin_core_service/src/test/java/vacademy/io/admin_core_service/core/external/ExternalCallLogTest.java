package vacademy.io.admin_core_service.core.external;

import vacademy.io.common.external.ExternalCallLog;
import vacademy.io.common.external.IntegratedVendors;

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
        assertTrue(ExternalCallLog.recorded("api.plivo.com"));
        assertTrue(ExternalCallLog.recorded("live-server.wati.io"));
        assertFalse(ExternalCallLog.recorded("sayajihotels.com"), "a website, not an integration");
        assertFalse(ExternalCallLog.recorded("cloudflare-dns.com"));
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

    /** Rows the log would write, collected instead of stored. */
    private static java.util.List<ExternalCallLog.Failure> capture() {
        java.util.List<ExternalCallLog.Failure> rows = new java.util.concurrent.CopyOnWriteArrayList<>();
        ExternalCallLog.install(rows::add, "admin_core");
        return rows;
    }

    private static void waitFor(java.util.List<?> rows, int n) throws InterruptedException {
        for (int i = 0; i < 200 && rows.size() < n; i++) Thread.sleep(10);
    }

    @Test
    void aFailedCallIsWrittenAndTheCallerStillGetsItsError() throws Exception {
        var rows = capture();
        RestTemplate rest = ExternalCallLog.attach(new RestTemplate());
        MockRestServiceServer server = MockRestServiceServer.bindTo(rest).build();
        server.expect(requestTo("https://api.plivo.com/v1/Account/MA1/Call/?secret=x"))
                .andRespond(withStatus(HttpStatus.UNAUTHORIZED)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .body("{\"error\":\"Authentication failed\",\"auth_token\":\"tok_live_1\"}"));
        server.expect(requestTo("https://api.plivo.com/v1/ok")).andRespond(withSuccess());

        HttpClientErrorException error = assertThrows(HttpClientErrorException.class,
                () -> rest.exchange("https://api.plivo.com/v1/Account/MA1/Call/?secret=x", HttpMethod.GET, null, String.class));
        // The caller still gets the vendor's whole error body.
        assertTrue(error.getResponseBodyAsString().contains("Authentication failed"));
        rest.getForObject("https://api.plivo.com/v1/ok", String.class);

        waitFor(rows, 1);
        Thread.sleep(100);
        assertEquals(1, rows.size(), "the success is not written");
        ExternalCallLog.Failure f = rows.get(0);
        assertEquals("api.plivo.com", f.vendor());
        assertEquals("admin_core", f.sourceService());
        assertEquals("GET /v1/Account", f.operation());
        assertEquals(401, f.httpStatus());
        assertTrue(f.request().contains("\"query_params\":[\"secret\"]") && !f.request().contains("=x"));
        assertTrue(f.response().contains("Authentication failed") && !f.response().contains("tok_live_1"));
    }

    @Test
    void aWebClientFailureIsWrittenAndTheCallerStillGetsTheBody() throws Exception {
        var rows = capture();
        org.springframework.web.reactive.function.client.WebClient client = ExternalCallLog.attach(
                org.springframework.web.reactive.function.client.WebClient.builder()
                        .exchangeFunction(req -> reactor.core.publisher.Mono.just(
                                org.springframework.web.reactive.function.client.ClientResponse
                                        .create(HttpStatus.PAYMENT_REQUIRED)
                                        .header("Content-Type", "application/json")
                                        .body("{\"error\":{\"message\":\"Insufficient credits\"}}").build())))
                .build();

        String body = client.post().uri("https://openrouter.ai/api/v1/chat/completions?key=abc")
                .retrieve()
                .onStatus(s -> s.value() == 402, r -> r.bodyToMono(String.class).map(IllegalStateException::new))
                .bodyToMono(String.class)
                .onErrorResume(IllegalStateException.class, e -> reactor.core.publisher.Mono.just(e.getMessage()))
                .block();

        assertTrue(body.contains("Insufficient credits"), "the caller still reads the error body");
        waitFor(rows, 1);
        ExternalCallLog.Failure f = rows.get(0);
        assertEquals("openrouter.ai", f.vendor());
        assertEquals(402, f.httpStatus());
        assertEquals("POST /api/v1", f.operation());
        assertTrue(f.response().contains("Insufficient credits"));
        assertTrue(f.request().contains("\"query_params\":[\"key\"]") && !f.request().contains("abc"));
    }

    @Test
    void anSdkFailureIsWrittenWithSecretsHidden() throws Exception {
        var rows = capture();
        ExternalCallLog.sdkFailure("api.razorpay.com", "orders.create", 400,
                new RuntimeException("BAD_REQUEST_ERROR: amount must be at least INR 1.00"),
                java.util.Map.of("amount", 0, "currency", "INR", "key_secret", "rzp_secret_1"));
        ExternalCallLog.sdkFailure("example.com", "x", 500, new RuntimeException("no"), null);

        waitFor(rows, 1);
        Thread.sleep(100);
        assertEquals(1, rows.size(), "not an integration: not written");
        ExternalCallLog.Failure f = rows.get(0);
        assertEquals("orders.create", f.operation());
        assertTrue(f.error().contains("amount must be at least"));
        assertTrue(f.request().contains("\"currency\":\"INR\"") && !f.request().contains("rzp_secret_1"));
    }

    @Test
    void failuresPostedByOtherServicesAreCheckedBeforeStoring() {
        var ok = ExternalCallFailureController.parse(java.util.Map.of(
                "occurredAt", "2026-11-18T10:00:00Z", "vendor", "live-server.wati.io", "sourceService", "notification",
                "operation", "POST /api/v1", "httpStatus", 401, "request", "{\"method\":\"POST\"}",
                "response", "not json"));
        assertEquals("live-server.wati.io", ok.vendor());
        assertEquals(401, ok.httpStatus());
        assertEquals("{\"method\":\"POST\"}", ok.request());
        assertEquals(null, ok.response(), "text that is not JSON is dropped, it is cast to jsonb");
        assertEquals(null, ExternalCallFailureController.parse(java.util.Map.of(
                "vendor", "sayajihotels.com", "sourceService", "notification")), "not an integration");
    }

    @Test
    void attachingTwiceAddsOneInterceptor() {
        RestTemplate rest = ExternalCallLog.attach(ExternalCallLog.attach(new RestTemplate()));
        assertEquals(1, rest.getInterceptors().size());
    }

    @Test
    void integratedVendorsSqlConditionMatchesHostsAndNames() {
        String sql = IntegratedVendors.sqlCondition("e.vendor");
        assertTrue(sql.contains("lower(e.vendor) = 'api.sarvam.ai'"));
        assertTrue(sql.contains("LIKE '%.wati.io'"));
        assertTrue(sql.contains("IN ('serper', 'aws-ses', 'email-smtp')"));
        assertTrue(IntegratedVendors.isIntegrated("serper"));
        assertFalse(IntegratedVendors.isIntegrated("www.linkedin.com"));
    }
}
