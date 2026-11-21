package vacademy.io.admin_core_service.features.payments.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.common.payment.dto.PhonePeStatusResponseDTO;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The webhook read-back status call gives up after the response timeout; checkout's call is unchanged. */
class PhonePeStatusWithTimeoutsTest {

    private HttpServer server;
    private final CountDownLatch release = new CountDownLatch(1);

    @AfterEach
    void stop() {
        release.countDown();
        if (server != null) {
            server.stop(0);
        }
    }

    private String start(boolean hang) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try {
                if (hang) {
                    release.await(30, TimeUnit.SECONDS);
                }
                byte[] body = "{\"success\":true,\"data\":{\"state\":\"COMPLETED\",\"amount\":49900}}"
                        .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            } catch (Exception ignored) {
                // client went away
            } finally {
                exchange.close();
            }
        });
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static Map<String, Object> v1Config(String baseUrl) {
        return Map.of("clientId", "M1", "clientSecret", "salt", "baseUrl", baseUrl);
    }

    @Test
    @DisplayName("answers normally when PhonePe answers")
    void answers() throws Exception {
        PhonePePaymentManager manager = new PhonePePaymentManager(WebClient.builder(), new ObjectMapper());
        PhonePeStatusResponseDTO status = manager.checkPaymentStatusWithTimeouts("MP1", v1Config(start(false)));
        assertEquals("COMPLETED", status.getState());
        assertEquals(49900L, status.getAmount().longValue());
    }

    @Test
    @DisplayName("a PhonePe that never answers is given up on after the response timeout")
    void givesUpOnHang() throws Exception {
        PhonePePaymentManager manager = new PhonePePaymentManager(WebClient.builder(), new ObjectMapper());
        String baseUrl = start(true);
        long started = System.nanoTime();
        PhonePeStatusResponseDTO status = manager.checkPaymentStatusWithTimeouts("MP1", v1Config(baseUrl));
        long seconds = TimeUnit.NANOSECONDS.toSeconds(System.nanoTime() - started);
        // Reported as the manager's local failure (FAILED with nothing else), which the verifier
        // treats as "could not ask".
        assertEquals("FAILED", status.getState());
        assertEquals(null, status.getAmount());
        assertTrue(seconds >= PhonePePaymentManager.CHECK_RESPONSE_TIMEOUT.getSeconds() - 1 && seconds < 20,
                "gave up after " + seconds + " s");
    }
}
