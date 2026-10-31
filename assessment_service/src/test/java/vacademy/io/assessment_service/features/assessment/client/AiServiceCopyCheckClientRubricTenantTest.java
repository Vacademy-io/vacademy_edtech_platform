package vacademy.io.assessment_service.features.assessment.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The rubric calls forward the verified institute as {@code ?institute_id=} — the
 * query param ai_service's rubric routes read for their row-level tenant check.
 * A local HTTP server records what actually goes on the wire.
 */
class AiServiceCopyCheckClientRubricTenantTest {

    private HttpServer server;
    private final List<String> requests = new CopyOnWriteArrayList<>();
    private AiServiceCopyCheckClient client;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.add(exchange.getRequestMethod() + " " + exchange.getRequestURI());
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();
        client = new AiServiceCopyCheckClient("http://127.0.0.1:" + server.getAddress().getPort(), "tok");
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    @DisplayName("GET/DELETE rubric and PUT/DELETE question carry ?institute_id=")
    void rubricCallsCarryInstitute() throws Exception {
        client.getRubric("a-1", "inst-1");
        client.deleteRubric("a-1", "inst-1");
        client.upsertQuestionAnswer("a-1", "q-1", "inst-1",
                new ObjectMapper().readTree("{\"model_answer\":\"x\"}"));
        client.deleteQuestionAnswer("a-1", "q-1", "inst-1");

        assertEquals(List.of(
                "GET /ai-service/copy-check/rubric/a-1?institute_id=inst-1",
                "DELETE /ai-service/copy-check/rubric/a-1?institute_id=inst-1",
                "PUT /ai-service/copy-check/rubric/a-1/question/q-1?institute_id=inst-1",
                "DELETE /ai-service/copy-check/rubric/a-1/question/q-1?institute_id=inst-1"
        ), requests);
    }
}
