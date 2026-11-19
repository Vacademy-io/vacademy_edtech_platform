package vacademy.io.common.external;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;

import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class VendorCallLogTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final LinkedBlockingQueue<VendorCallLog.Failure> rows = new LinkedBlockingQueue<>();

    @BeforeEach
    void capture() {
        VendorCallLog.install(rows::add, "test");
        VendorCallLog.resetRate();
    }

    @AfterEach
    void detach() {
        VendorCallLog.install(null, "unknown");
    }

    private VendorCallLog.Failure next() throws InterruptedException {
        VendorCallLog.Failure f = rows.poll(5, TimeUnit.SECONDS);
        assertNotNull(f, "a failure should have been recorded");
        return f;
    }

    private void nothingRecorded() throws InterruptedException {
        assertNull(rows.poll(300, TimeUnit.MILLISECONDS), "nothing should have been recorded");
    }

    @Test
    void restTemplateErrorKeepsStatusAndRedactedBodies() throws Exception {
        HttpClientErrorException e = HttpClientErrorException.create(HttpStatus.PAYMENT_REQUIRED, "Payment Required",
                new HttpHeaders(), "{\"error\":\"insufficient credits\",\"email\":\"a@b.com\"}".getBytes(StandardCharsets.UTF_8),
                StandardCharsets.UTF_8);
        VendorCallLog.failed("https://api.plivo.com/v1/Account/X/Call/", "make call",
                Map.of("to", "+919999999999", "answer_url", "https://x", "api_key", "sk_live_1"), e);

        VendorCallLog.Failure f = next();
        assertEquals("api.plivo.com", f.vendor());
        assertEquals("test", f.sourceService());
        assertEquals("make call", f.operation());
        assertEquals(402, f.httpStatus());
        JsonNode req = JSON.readTree(f.request()).path("body");
        assertEquals("<hidden>", req.path("api_key").asText());
        assertNotEquals("+919999999999", req.path("to").asText());
        JsonNode res = JSON.readTree(f.response());
        assertEquals(402, res.path("status").asInt());
        assertEquals("insufficient credits", res.path("body").path("error").asText());
        assertEquals("<hidden>", res.path("body").path("email").asText());
    }

    @Test
    void timeoutHasNoStatusAndNamesTheCause() throws Exception {
        VendorCallLog.failed("api.razorpay.com", "create order", null,
                new ResourceAccessException("I/O error", new SocketTimeoutException("Read timed out")));
        VendorCallLog.Failure f = next();
        assertNull(f.httpStatus());
        assertTrue(f.error().contains("ResourceAccessException"), f.error());
        assertTrue(f.error().contains("SocketTimeoutException"), f.error());
        assertNull(f.request());
    }

    @Test
    void anHttpUrlConnectionErrorGivesItsStatus() throws Exception {
        VendorCallLog.failed("https://api.plivo.com/v1/Account/X/Recording/1.mp3", "fetch recording", null,
                new java.io.IOException("Server returned HTTP response code: 404 for URL: https://api.plivo.com/x"));
        assertEquals(404, next().httpStatus());
    }

    @Test
    void wrappedVendorErrorIsFound() throws Exception {
        RuntimeException wrapped = new RuntimeException("WATI send failed",
                HttpServerErrorException.create(HttpStatus.SERVICE_UNAVAILABLE, "Unavailable", new HttpHeaders(),
                        "down".getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8));
        VendorCallLog.failed("live-mt-server.wati.io", "send template", "{\"template\":\"otp\"}", wrapped);
        VendorCallLog.Failure f = next();
        assertEquals("live-mt-server.wati.io", f.vendor());
        assertEquals(503, f.httpStatus());
        assertEquals("down", JSON.readTree(f.response()).path("body").path("text").asText());
    }

    /** Stripe and AWS exceptions expose the status as getStatusCode(). */
    static final class SdkException extends RuntimeException {
        SdkException() {
            super("card_declined for customer a@b.com");
        }

        public Integer getStatusCode() {
            return 402;
        }
    }

    /** Firebase keeps the answer on getHttpResponse(). */
    public static final class HttpResponse {
        public Integer getStatusCode() {
            return 429;
        }

        public String getContent() {
            return "{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\"}}";
        }
    }

    static final class FirebaseLikeException extends RuntimeException {
        public HttpResponse getHttpResponse() {
            return new HttpResponse();
        }
    }

    @Test
    void firebaseStyleResponseIsRead() throws Exception {
        VendorCallLog.failed("fcm.googleapis.com", "send push", null, new FirebaseLikeException());
        VendorCallLog.Failure f = next();
        assertEquals(429, f.httpStatus());
        assertEquals("RESOURCE_EXHAUSTED",
                JSON.readTree(f.response()).path("body").path("error").path("status").asText());
    }

    @Test
    void sdkExceptionStatusIsReadAndItsMessageCleaned() throws Exception {
        VendorCallLog.failed("api.stripe.com", "create payment intent", null, new SdkException());
        VendorCallLog.Failure f = next();
        assertEquals(402, f.httpStatus());
        assertFalse(f.error().contains("a@b.com"), f.error());
    }

    @Test
    void statusAndBodyWithoutAnException() throws Exception {
        VendorCallLog.failed("api.cloudconvert.com", "create job", "a=1&email=x%40y.com", 429, "{\"message\":\"slow down\"}");
        VendorCallLog.Failure f = next();
        assertEquals(429, f.httpStatus());
        JsonNode req = JSON.readTree(f.request()).path("body");
        assertEquals("1", req.path("a").asText());
        assertEquals("<hidden>", req.path("email").asText());
        assertEquals("slow down", JSON.readTree(f.response()).path("body").path("message").asText());

        VendorCallLog.failed("api.cloudconvert.com", "create job", null, 200, "ok");
        nothingRecorded();
    }

    @Test
    void notAnIntegratedVendorIsNotRecorded() throws Exception {
        VendorCallLog.failed("https://some-institute.edu/feed", "fetch", null, new RuntimeException("x"));
        VendorCallLog.failed("admin-core-service.vacademy.svc.cluster.local", "x", null, 500, "x");
        VendorCallLog.failed(null, "x", null, new RuntimeException("x"));
        nothingRecorded();
    }

    @Test
    void uploadsAndLargeBodiesAreNotKept() throws Exception {
        LinkedMultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("file", new ByteArrayResource(new byte[]{1, 2, 3}));
        form.add("name", "deck.pptx");
        VendorCallLog.failed("api.cloudconvert.com", "upload", form, 413, null);
        assertEquals("file upload", JSON.readTree(next().request()).path("body").path("omitted").asText());

        VendorCallLog.failed("api.mathpix.com", "convert", new byte[200_000], 400, null);
        assertEquals("200000 bytes", JSON.readTree(next().request()).path("body").path("omitted").asText());

        String multipart = "--b\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nPDFDATA\r\n--b--";
        VendorCallLog.failed("api.mathpix.com", "convert", multipart, 400, null);
        assertEquals("file upload", JSON.readTree(next().request()).path("body").path("omitted").asText());
    }

    @Test
    void anOutageIsCappedPerSecond() throws Exception {
        for (int i = 0; i < VendorCallLog.MAX_PER_SECOND + 15; i++) {
            VendorCallLog.failed("api.plivo.com", "make call", null, 503, "down");
        }
        Thread.sleep(500);
        assertTrue(rows.size() <= VendorCallLog.MAX_PER_SECOND, "recorded " + rows.size());
    }

    @Test
    void aBrokenSinkNeverReachesTheCaller() {
        VendorCallLog.install(f -> {
            throw new IllegalStateException("db down");
        }, "test");
        assertDoesNotThrow(() -> VendorCallLog.failed("api.plivo.com", "x", null, 500, "x"));
    }

    @Test
    void installerNamesSources() {
        assertEquals("notification", VendorCallLogInstaller.sourceName("notification_service"));
        assertEquals("unknown", VendorCallLogInstaller.sourceName(null));
    }

    @Test
    void cleanHidesSecretsEmailsAndNumbers() {
        String s = VendorCallLog.clean("token=abc123 for ravi@x.in at +91 98765 43210, code 402", 500);
        assertFalse(s.contains("abc123"), s);
        assertFalse(s.contains("ravi@x.in"), s);
        assertFalse(s.contains("98765"), s);
        assertTrue(s.contains("402"), s);

        String url = VendorCallLog.clean("audio https://b.s3.amazonaws.com/a.mp3?X-Amz-Signature=abc&X-Amz-Expires=60 ok", 500);
        assertEquals("audio https://b.s3.amazonaws.com/a.mp3?<query> ok", url);
    }
}
