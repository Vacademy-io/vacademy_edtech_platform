package vacademy.io.assessment_service.features.assessment.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * AiServiceScanClient against a real local HTTP server standing in for ai_service
 * (the house pattern; this module has no MockWebServer dependency).
 */
class AiServiceScanClientTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer server;
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicReference<String> responseBody = new AtomicReference<>("{}");
    private final AtomicLong delayMs = new AtomicLong(0);
    private final AtomicReference<String> seenPath = new AtomicReference<>();
    private final AtomicReference<String> seenToken = new AtomicReference<>();
    private final AtomicReference<String> seenBody = new AtomicReference<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            seenPath.set(exchange.getRequestURI().getPath());
            seenToken.set(exchange.getRequestHeaders().getFirst("X-Internal-Service-Token"));
            seenBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            if (delayMs.get() > 0) {
                try {
                    Thread.sleep(delayMs.get());
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
            byte[] out = responseBody.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), out.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(out);
            } catch (IOException ignored) {
                // the client gave up (timeout test)
            }
        });
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private AiServiceScanClient client(Duration timeout) {
        return new AiServiceScanClient("http://127.0.0.1:" + server.getAddress().getPort() + "/", "secret", timeout);
    }

    private AiServiceScanClient client() {
        return client(Duration.ofSeconds(10));
    }

    private static ScanAnalysis.AnalyseRequest analyseRequest() {
        return ScanAnalysis.AnalyseRequest.builder().instituteId("inst-1").sessionId("sess-1").loadNo(3)
                .preferredModel(null)
                .passes(List.of(
                        ScanAnalysis.PassRef.builder().passNo(1).files(List.of(ScanAnalysis.FileRef.builder()
                                .fileId("f1").url("https://media/f1").kind("IMAGE").name("Scan 3.jpeg").build())).build(),
                        ScanAnalysis.PassRef.builder().passNo(2).files(List.of(ScanAnalysis.FileRef.builder()
                                .fileId("f2").url("https://media/f2").kind("PDF").name("back.pdf").build())).build()))
                .build();
    }

    @Test
    void analyseLoadSendsSnakeCaseWithTheTokenAndKeepsTheAnswerVerbatim() throws Exception {
        String answer = "{\"analyser_version\":\"scan-1\",\"load_no\":3,\"status\":\"OK\",\"something_new\":1,"
                + "\"layout\":{\"fronts_pass\":2,\"fronts_rotation\":180,\"backs_order\":\"REVERSED\",\"backs_rotation\":0,"
                + "\"order_margin\":0.31,\"shift\":{\"from_sheet\":4,\"offset\":1},\"blank_rule_suspect\":false},"
                + "\"evidence\":{\"first_front_label\":true,\"last_front_label\":false},"
                + "\"pages\":[{\"ref\":\"p1.0\",\"pass_no\":1,\"file_id\":\"f1\",\"page_index\":0,\"kind\":\"IMAGE\","
                + "\"dpi\":300,\"dpi_source\":\"JFIF\",\"width_px\":2480,\"height_px\":3508,\"ink_per_10k\":0.14,"
                + "\"blank_class\":\"BLANK\",\"error\":null}],"
                + "\"sheets\":[{\"sheet_no\":0,\"front\":\"p2.0\",\"back\":\"p1.0\",\"label_kind\":\"PRINTED_FIELD\","
                + "\"label_present\":true,\"name_text\":\"x\",\"pair_is_row_max\":true}],"
                + "\"flags\":[{\"code\":\"PAIR_NOT_ROW_MAX\",\"severity\":\"REVIEW\",\"sheet_no\":0,\"detail\":\"d\"}],"
                + "\"usage\":{\"model\":\"m\",\"model_calls\":7}}";
        responseBody.set(answer);

        AiServiceScanClient.Analysed a = client().analyseLoad(analyseRequest());

        assertThat(seenPath.get()).isEqualTo("/ai-service/copy-check/scan/analyse-load");
        assertThat(seenToken.get()).isEqualTo("secret");
        JsonNode body = mapper.readTree(seenBody.get());
        assertThat(body.get("institute_id").asText()).isEqualTo("inst-1");
        assertThat(body.get("session_id").asText()).isEqualTo("sess-1");
        assertThat(body.get("load_no").asInt()).isEqualTo(3);
        assertThat(body.has("preferred_model")).isTrue();
        assertThat(body.get("passes").get(0).get("pass_no").asInt()).isEqualTo(1);
        assertThat(body.get("passes").get(1).get("files").get(0).get("file_id").asText()).isEqualTo("f2");
        assertThat(body.get("passes").get(0).get("files").get(0).get("name").asText()).isEqualTo("Scan 3.jpeg");

        assertThat(a.json()).isEqualTo(answer);
        assertThat(a.result().getLayout().getFrontsRotation()).isEqualTo(180);
        assertThat(a.result().getLayout().getShift().getFromSheet()).isEqualTo(4);
        assertThat(a.result().getPages().get(0).getInkPer10k()).isEqualTo(0.14);
        assertThat(a.result().getSheets().get(0).getLabelPresent()).isTrue();
        assertThat(a.result().getFlags().get(0).getSheetNo()).isZero();
    }

    @Test
    void buildSendsCopiesAndReadsPerCopyResults() throws Exception {
        responseBody.set("{\"copies\":[{\"copy_key\":\"L3-S5\",\"file_id\":\"pdf-1\",\"page_count\":5,\"bytes\":4123456,"
                + "\"error\":null},{\"copy_key\":\"L3-S7\",\"file_id\":null,\"page_count\":0,\"bytes\":0,"
                + "\"error\":\"COPY_TOO_LARGE\"}]}");

        ScanAnalysis.BuildResult r = client().build(ScanAnalysis.BuildRequest.builder().instituteId("inst-1")
                .sessionId("sess-1").sourceId("ASSESSMENT_SCAN_STATION")
                .copies(List.of(ScanAnalysis.BuildCopy.builder().copyKey("L3-S5").fileName("scan_l3_c5.pdf")
                        .pages(List.of(ScanAnalysis.BuildPage.builder().url("https://m/1").kind("IMAGE").pageIndex(0)
                                .rotation(180).dpi(300).build())).build()))
                .build());

        assertThat(seenPath.get()).isEqualTo("/ai-service/copy-check/scan/build");
        JsonNode body = mapper.readTree(seenBody.get());
        assertThat(body.get("source_id").asText()).isEqualTo("ASSESSMENT_SCAN_STATION");
        JsonNode copy = body.get("copies").get(0);
        assertThat(copy.get("copy_key").asText()).isEqualTo("L3-S5");
        assertThat(copy.get("file_name").asText()).isEqualTo("scan_l3_c5.pdf");
        assertThat(copy.get("pages").get(0).get("page_index").asInt()).isZero();
        assertThat(copy.get("pages").get(0).get("rotation").asInt()).isEqualTo(180);

        assertThat(r.getCopies()).hasSize(2);
        assertThat(r.getCopies().get(0).getFileId()).isEqualTo("pdf-1");
        assertThat(r.getCopies().get(0).getBytes()).isEqualTo(4123456L);
        assertThat(r.getCopies().get(1).getError()).isEqualTo("COPY_TOO_LARGE");
    }

    @Test
    void busyIs429() {
        status.set(429);
        assertThatThrownBy(() -> client().analyseLoad(analyseRequest()))
                .isInstanceOf(AiServiceScanClient.ScanBusyException.class);
    }

    @Test
    void retryable503IsRetryableAndAPlain503IsNot() {
        status.set(503);
        responseBody.set("{\"retryable\":true}");
        assertThatThrownBy(() -> client().analyseLoad(analyseRequest()))
                .isInstanceOf(AiServiceScanClient.ScanRetryableException.class)
                .isNotInstanceOf(AiServiceScanClient.ScanBusyException.class);

        // FastAPI's HTTPException puts the body under "detail"
        responseBody.set("{\"detail\":{\"retryable\":true}}");
        assertThatThrownBy(() -> client().build(ScanAnalysis.BuildRequest.builder().copies(List.of()).build()))
                .isInstanceOf(AiServiceScanClient.ScanRetryableException.class);

        responseBody.set("{\"retryable\":false}");
        assertThatThrownBy(() -> client().analyseLoad(analyseRequest()))
                .isInstanceOf(AiServiceScanClient.ScanRejectedException.class);
    }

    @Test
    void notFoundMeansSwitchedOff() {
        status.set(404);
        responseBody.set("{\"detail\":\"Not Found\"}");
        assertThatThrownBy(() -> client().analyseLoad(analyseRequest()))
                .isInstanceOf(AiServiceScanClient.ScanDisabledException.class);
    }

    @Test
    void otherClientErrorsAreRejectionsWithTheirStatus() {
        status.set(422);
        responseBody.set("{\"detail\":\"more than 10 copies\"}");
        assertThatThrownBy(() -> client().build(ScanAnalysis.BuildRequest.builder().copies(List.of()).build()))
                .isInstanceOfSatisfying(AiServiceScanClient.ScanRejectedException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(422));
        status.set(401);
        assertThatThrownBy(() -> client().analyseLoad(analyseRequest()))
                .isInstanceOf(AiServiceScanClient.ScanRejectedException.class);
    }

    @Test
    void serverErrorsAndTimeoutsAreRetryable() {
        status.set(500);
        assertThatThrownBy(() -> client().analyseLoad(analyseRequest()))
                .isInstanceOf(AiServiceScanClient.ScanRetryableException.class);

        status.set(200);
        delayMs.set(1500);
        assertThatThrownBy(() -> client(Duration.ofMillis(300)).analyseLoad(analyseRequest()))
                .isInstanceOf(AiServiceScanClient.ScanRetryableException.class);
    }

    @Test
    void unreachableIsRetryable() {
        server.stop(0);
        assertThatThrownBy(() -> client().analyseLoad(analyseRequest()))
                .isInstanceOf(AiServiceScanClient.ScanRetryableException.class);
    }
}
