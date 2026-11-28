package vacademy.io.assessment_service.features.assessment.copy_intake.scan;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceScanClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.dto.CopyIntakeDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.config.ScanStationProperties;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanLoad;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanLoadRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanSessionRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanMediaUrls;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanLoader;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanStationRunner;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanStationService;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeRunner;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The 2026-11-18 Brother scan test, end to end through assessment_service's real
 * code: ScanStationService (as the clerk drives it) + ScanStationRunner + the real
 * AiServiceScanClient over HTTP + ScanPlanLoader + ScanPlanner.
 *
 * <p>The fixture {@code scan/c1_1118_real_scan.json} is ai_service's actual
 * analyse-load answer (contract C1) for the real scans: 2 passes of 6 JPEGs, the
 * header read stubbed with the names really in the name boxes (ai_service
 * {@code scripts/scan_station_e2e.py analyse}). A local HTTP server stands in for
 * ai_service and answers it byte for byte, so this proves T2's output and T1's
 * planner agree on the wire. The print set: Aarav Sharma (2 sheets), Priya Verma
 * (3 sheets; sheet 1's back is faint pencil, sheets 2 and 3 have blank backs),
 * Rohan Gupta (1 sheet). The fronts are pass 2 in pile order, the backs pass 1
 * in reverse.
 *
 * <p>When env SCAN_E2E_OUT_DIR is set, the analyse and build requests the client
 * sent are written there; {@code scan_station_e2e.py build} turns that build
 * request (contract C2) into real PDFs and checks them page by page.
 */
class ScanStationRealScanE2ETest {

    private static final String FIXTURE = "c1_1118_real_scan.json";
    private static final String TOKEN = "e2e-token";
    private static final ObjectMapper JSON = new ObjectMapper();

    private AiScanSessionRepository sessions;
    private AiScanLoadRepository loads;
    private CopyIntakeService copyIntake;
    private CopyIntakeRunner copyIntakeRunner;
    private ScanStationService service;
    private HttpServer fakeAi;
    private final Map<String, String> bodies = new ConcurrentHashMap<>();
    private final Map<String, String> tokens = new ConcurrentHashMap<>();

    private final Map<String, AiScanSession> sessionRows = new HashMap<>();
    private final Map<String, AiScanLoad> loadRows = new HashMap<>();
    private final CustomUserDetails clerk = new CustomUserDetails();

    @BeforeEach
    void setUp() throws IOException {
        String c1 = ScanFixtures.json(FIXTURE);
        fakeAi = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        fakeAi.createContext("/ai-service/copy-check/scan/analyse-load", ex -> {
            bodies.put("analyse", new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            tokens.put("analyse", String.valueOf(ex.getRequestHeaders().getFirst("X-Internal-Service-Token")));
            reply(ex, c1);
        });
        fakeAi.createContext("/ai-service/copy-check/scan/build", ex -> {
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            bodies.put("build", body);
            tokens.put("build", String.valueOf(ex.getRequestHeaders().getFirst("X-Internal-Service-Token")));
            ObjectNode out = JSON.createObjectNode();
            ArrayNode copies = out.putArray("copies");
            for (JsonNode c : JSON.readTree(body).get("copies")) {
                copies.addObject().put("copy_key", c.get("copy_key").asText())
                        .put("file_id", "built-" + c.get("copy_key").asText())
                        .put("page_count", c.get("pages").size()).put("bytes", 1000).putNull("error");
            }
            reply(ex, JSON.writeValueAsString(out));
        });
        fakeAi.start();
        AiServiceScanClient client = new AiServiceScanClient(
                "http://127.0.0.1:" + fakeAi.getAddress().getPort(), TOKEN);

        sessions = mock(AiScanSessionRepository.class);
        loads = mock(AiScanLoadRepository.class);
        copyIntake = mock(CopyIntakeService.class);
        copyIntakeRunner = mock(CopyIntakeRunner.class);
        InstituteFileOwnership ownership = mock(InstituteFileOwnership.class);
        when(ownership.notOwnedBy(anyString(), anyList())).thenReturn(List.of());
        ScanMediaUrls media = mock(ScanMediaUrls.class);
        // a signed-URL stand-in; the e2e script maps it back to the scan by file id
        when(media.url(anyString())).thenAnswer(inv -> "https://media.example/signed/" + inv.getArgument(0)
                + "?X-Amz-Signature=e2e");
        ThreadPoolTaskExecutor executor = mock(ThreadPoolTaskExecutor.class);
        doAnswer(inv -> {
            inv.<Runnable>getArgument(0).run();
            return null;
        }).when(executor).execute(any(Runnable.class));
        TransactionTemplate tx = mock(TransactionTemplate.class);
        when(tx.execute(any())).thenAnswer(inv ->
                inv.<TransactionCallback<?>>getArgument(0).doInTransaction(new SimpleTransactionStatus()));

        when(sessions.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(sessionRows.get(inv.<String>getArgument(0))));
        when(sessions.save(any(AiScanSession.class))).thenAnswer(inv -> {
            AiScanSession s = inv.getArgument(0);
            if (s.getId() == null) s.setId("sess-" + (sessionRows.size() + 1));
            sessionRows.put(s.getId(), s);
            return s;
        });
        when(sessions.transition(anyString(), anyString(), anyString())).thenAnswer(inv -> {
            AiScanSession s = sessionRows.get(inv.<String>getArgument(0));
            if (s == null || !s.getStatus().equals(inv.getArgument(1))) return 0;
            s.setStatus(inv.getArgument(2));
            return 1;
        });
        when(loads.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(loadRows.get(inv.<String>getArgument(0))));
        when(loads.findBySessionIdOrderByLoadNo(anyString())).thenAnswer(inv -> loadRows.values().stream()
                .filter(l -> l.getSessionId().equals(inv.getArgument(0)))
                .sorted(Comparator.comparingInt(AiScanLoad::getLoadNo)).toList());
        when(loads.findBySessionIdAndLoadNo(anyString(), anyInt())).thenAnswer(inv -> loadRows.values().stream()
                .filter(l -> l.getSessionId().equals(inv.getArgument(0)) && l.getLoadNo() == inv.<Integer>getArgument(1))
                .findFirst());
        when(loads.save(any(AiScanLoad.class))).thenAnswer(inv -> {
            AiScanLoad l = inv.getArgument(0);
            if (l.getId() == null) l.setId("load-" + (loadRows.size() + 1));
            loadRows.put(l.getId(), l);
            return l;
        });
        when(loads.claim(anyString(), anyString(), anyString(), any(Date.class))).thenAnswer(inv -> {
            AiScanLoad l = loadRows.get(inv.<String>getArgument(0));
            if (l == null || !l.getStatus().equals(inv.getArgument(1))) return 0;
            l.setStatus(inv.getArgument(2));
            l.setAttempts(l.getAttempts() + 1);
            l.setClaimedAt(inv.getArgument(3));
            return 1;
        });

        ScanStationProperties props = new ScanStationProperties(true, "inst-1", 60000);
        ScanPlanLoader plans = new ScanPlanLoader(loads);
        ScanStationRunner runner = new ScanStationRunner(props, sessions, loads, mock(AiCopyIntakeItemRepository.class),
                client, media, plans, executor) {
            @Override
            protected void pause(long millis) {
            }
        };
        service = new ScanStationService(props, sessions, loads, plans, runner, ownership, copyIntake,
                copyIntakeRunner, mock(AssessmentAuditClient.class), tx);
        ReflectionTestUtils.setField(clerk, "userId", "clerk-1");
        clerk.setFullName("Scan Clerk");
    }

    @AfterEach
    void tearDown() {
        if (fakeAi != null) fakeAi.stop(0);
    }

    private static void reply(com.sun.net.httpserver.HttpExchange ex, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(200, b.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(b);
        }
    }

    /** The two Image Capture folders as the clerk drops them: pass 1 = "1-fronts", pass 2 = "2-backs". */
    private static ScanStationDtos.LoadRequest theTwoPasses() {
        List<ScanStationDtos.Pass> passes = new ArrayList<>();
        for (int pass = 1; pass <= 2; pass++) {
            List<ScanStationDtos.PassFile> files = new ArrayList<>();
            for (int i = 0; i < 6; i++) {
                files.add(ScanStationDtos.PassFile.builder().fileId("p" + pass + "-" + i)
                        .fileName(i == 0 ? "Scan.jpeg" : "Scan " + i + ".jpeg").kind("IMAGE").orderIndex(i)
                        .lastModified(1_763_446_980_000L + i * 1000L).pageCount(1).build());
            }
            passes.add(ScanStationDtos.Pass.builder().passNo(pass).files(files).build());
        }
        return ScanStationDtos.LoadRequest.builder().passes(passes).intakeMode("TWO_PASSES")
                .orderSource("IMAGE_CAPTURE_SUFFIX").clientWarnings(List.of()).build();
    }

    private static List<String> refs(ScanStationDtos.CopyDto c) {
        return c.getPages().stream().map(p -> p.getRef() + ":" + p.getSide() + ":" + p.getRotation()).toList();
    }

    @Test
    void theRealBrotherScansBecomeThreeCopiesAndOneBuildRequest() throws Exception {
        AiScanSession session = sessionRows.get(service.createSession(clerk, "a-1", "inst-1").getId());

        // ---- add the load: the runner calls ai_service (the fake) and stores its answer verbatim
        ScanStationDtos.SessionDto dto = service.addLoad(session, theTwoPasses());

        assertThat(tokens.get("analyse")).isEqualTo(TOKEN);
        JsonNode analyse = JSON.readTree(bodies.get("analyse"));
        assertThat(analyse.get("institute_id").asText()).isEqualTo("inst-1");
        assertThat(analyse.get("load_no").asInt()).isEqualTo(1);
        // C1 request: passes 1 then 2, files in clerk order; the answer's page refs match them one to one
        JsonNode c1 = JSON.readTree(ScanFixtures.json(FIXTURE));
        Map<String, String> fileOfRef = new HashMap<>();
        for (JsonNode p : c1.get("pages")) fileOfRef.put(p.get("ref").asText(), p.get("file_id").asText());
        for (int pass = 0; pass < 2; pass++) {
            JsonNode files = analyse.get("passes").get(pass).get("files");
            assertThat(analyse.get("passes").get(pass).get("pass_no").asInt()).isEqualTo(pass + 1);
            assertThat(files).hasSize(6);
            for (int i = 0; i < 6; i++) {
                String id = "p" + (pass + 1) + "-" + i;
                assertThat(files.get(i).get("file_id").asText()).isEqualTo(id);
                assertThat(files.get(i).get("kind").asText()).isEqualTo("IMAGE");
                assertThat(files.get(i).get("url").asText()).contains("/signed/" + id + "?");
                assertThat(fileOfRef.get("p" + (pass + 1) + "." + i)).as("C1 page ref ↔ request file").isEqualTo(id);
            }
        }
        AiScanLoad stored = loadRows.values().iterator().next();
        assertThat(stored.getStatus()).isEqualTo(AiScanLoad.DONE);
        assertThat(stored.getResultJson()).isEqualTo(ScanFixtures.json(FIXTURE));

        // ---- the plan, before the clerk does anything
        assertThat(dto.getLoads().get(0).getLayout().getFrontsPass()).isEqualTo(2);
        assertThat(dto.getLoads().get(0).getLayout().getBacksOrder()).isEqualTo("REVERSED");
        assertThat(dto.getFrontsDirection()).isEqualTo(ScanPlanner.FORWARD);
        assertThat(dto.getCopies()).extracting(ScanStationDtos.CopyDto::getCopyKey)
                .containsExactly("L1-S0", "L1-S2", "L1-S5");
        assertThat(dto.getCopies()).extracting(ScanStationDtos.CopyDto::getNameText)
                .containsExactly("Aarav Sharma", "Priya Verma", "Rohan Gupta");
        assertThat(dto.getCopies()).extracting(c -> c.getSheets().stream().map(ScanStationDtos.SheetRefDto::getSheetNo).toList())
                .containsExactly(List.of(0, 1), List.of(2, 3, 4), List.of(5));
        // fronts p2.* in pile order; each back is its pair in the reversed pass 1
        assertThat(refs(dto.getCopies().get(0))).containsExactly("p2.0:FRONT:0", "p1.5:BACK:0", "p2.1:FRONT:0", "p1.4:BACK:0");
        assertThat(refs(dto.getCopies().get(1))).containsExactly("p2.2:FRONT:0", "p1.3:BACK:0", "p2.3:FRONT:0", "p2.4:FRONT:0");
        assertThat(refs(dto.getCopies().get(2))).containsExactly("p2.5:FRONT:0", "p1.0:BACK:0");
        // the two blank backs are left out; the faint pencil back (p1.3) is kept
        assertThat(dto.getCopies().get(1).getLeftOut()).extracting(ScanStationDtos.LeftOutPageDto::getRef)
                .containsExactly("p1.2", "p1.1");
        assertThat(dto.getCopies().get(0).getLeftOut()).isEmpty();
        assertThat(dto.getCopies().get(2).getLeftOut()).isEmpty();
        Map<String, String> eff = new HashMap<>();
        dto.getLoads().get(0).getPages().forEach(p -> eff.put(p.getRef(), p.getBlankEffective()));
        assertThat(eff).containsEntry("p1.1", "BLANK").containsEntry("p1.2", "BLANK").containsEntry("p1.3", "WRITTEN");
        assertThat(dto.getTotals().getCopies()).isEqualTo(3);
        assertThat(dto.getTotals().getPages()).isEqualTo(10);
        assertThat(dto.getTotals().getBlankLeftOut()).isEqualTo(2);
        assertThat(dto.getCopies()).allSatisfy(c -> assertThat(c.getFlags()).isEmpty());

        // Load 1's first AND last fronts carry labels, so the direction is the default
        // FORWARD and the clerk is asked; the blanks being left out are asked too.
        assertThat(dto.getFrontsDirectionSource()).isEqualTo(ScanPlanner.SOURCE_DEFAULT);
        assertThat(dto.getVerdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
        assertThat(dto.getVerdictReasons()).extracting(ScanStationDtos.VerdictReason::getCode)
                .containsExactlyInAnyOrder(ScanPlanner.FRONT_ORDER_UNCERTAIN, ScanPlanner.BLANKS_TO_CONFIRM);
        assertThat(dto.getVerdictReasons()).allSatisfy(r -> assertThat(r.getSeverity()).isEqualTo(ScanPlanner.REVIEW));

        // ---- the clerk: the first copy opens with Aarav's name box, so FORWARD; then confirm the blanks
        dto = service.decide(session, ScanStationDtos.DecisionRequest.builder()
                .action("SET_FRONTS_DIRECTION").value("FORWARD").build());
        assertThat(dto.getFrontsDirectionSource()).isEqualTo(ScanPlanner.SOURCE_CLERK);
        assertThat(dto.getVerdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
        ScanStationDtos.LoadFlag blanks = dto.getLoads().get(0).getFlags().stream()
                .filter(f -> ScanPlanner.BLANKS_TO_CONFIRM.equals(f.getCode())).findFirst().orElseThrow();
        dto = service.decide(session, ScanStationDtos.DecisionRequest.builder().action("ACCEPT_LOAD_FLAG")
                .loadNo(1).code(ScanPlanner.BLANKS_TO_CONFIRM).expectedFingerprint(blanks.getFingerprint()).build());
        assertThat(dto.getVerdict()).isEqualTo(ScanPlanner.VERDICT_READY);
        assertThat(dto.getVerdictReasons()).isEmpty();

        // ---- build: the runner sends one C2 request through the real client
        dto = service.build(session);
        assertThat(dto.getStatus()).isEqualTo(AiScanSession.BUILT);
        assertThat(tokens.get("build")).isEqualTo(TOKEN);
        JsonNode c2 = JSON.readTree(bodies.get("build"));
        assertThat(c2.get("institute_id").asText()).isEqualTo("inst-1");
        assertThat(c2.get("session_id").asText()).isEqualTo(session.getId());
        assertThat(c2.get("source_id").asText()).isEqualTo("ASSESSMENT_SCAN_STATION");
        List<String> keys = new ArrayList<>();
        List<List<String>> pageFiles = new ArrayList<>();
        for (JsonNode c : c2.get("copies")) {
            keys.add(c.get("copy_key").asText() + "|" + c.get("file_name").asText());
            List<String> files = new ArrayList<>();
            for (JsonNode p : c.get("pages")) {
                assertThat(p.get("kind").asText()).isEqualTo("IMAGE");
                assertThat(p.get("page_index").asInt()).isZero();
                assertThat(p.get("rotation").asInt()).isZero();
                assertThat(p.get("dpi").asInt()).isEqualTo(300);
                String url = p.get("url").asText();
                files.add(url.substring(url.indexOf("/signed/") + 8, url.indexOf('?')));
            }
            pageFiles.add(files);
        }
        assertThat(keys).containsExactly("L1-S0|scan_l1_c1.pdf", "L1-S2|scan_l1_c2.pdf", "L1-S5|scan_l1_c3.pdf");
        assertThat(pageFiles).containsExactly(
                List.of("p2-0", "p1-5", "p2-1", "p1-4"),
                List.of("p2-2", "p1-3", "p2-3", "p2-4"),
                List.of("p2-5", "p1-0"));
        assertThat(dto.getBuilt()).extracting(b -> b.getCopyKey() + ":" + b.getFileId() + ":" + b.getPageCount())
                .containsExactly("L1-S0:built-L1-S0:4", "L1-S2:built-L1-S2:4", "L1-S5:built-L1-S5:2");

        String outDir = System.getenv("SCAN_E2E_OUT_DIR");
        if (outDir != null && !outDir.isBlank()) {
            Path dir = Files.createDirectories(Path.of(outDir));
            Files.writeString(dir.resolve("c1_request.json"), bodies.get("analyse"));
            Files.writeString(dir.resolve("c2_build_request.json"), bodies.get("build"));
        }

        // ---- start: hands the three built PDFs to the existing copy intake as source SCAN
        AiCopyIntakeBatch batch = AiCopyIntakeBatch.builder().id("batch-1").source(AiCopyIntakeBatch.SOURCE_SCAN).build();
        when(copyIntake.start(any(), anyString(), anyString(), any(), anyString())).thenReturn(batch);
        when(copyIntake.toDto(batch, false)).thenReturn(CopyIntakeDtos.BatchDto.builder().id("batch-1").build());
        ScanStationDtos.StartResponse started = service.start(clerk, session, new ScanStationDtos.StartRequest());

        ArgumentCaptor<CopyIntakeDtos.StartRequest> req = ArgumentCaptor.forClass(CopyIntakeDtos.StartRequest.class);
        verify(copyIntake).start(eq(clerk), eq("a-1"), eq("inst-1"), req.capture(), eq(AiCopyIntakeBatch.SOURCE_SCAN));
        assertThat(req.getValue().getFiles())
                .extracting(f -> f.getFileId() + "|" + f.getFileName() + "|" + f.getPageCount())
                .containsExactly("built-L1-S0|Load 1 copy 1|4", "built-L1-S2|Load 1 copy 2|4", "built-L1-S5|Load 1 copy 3|2");
        assertThat(req.getValue().getMapStudents()).isTrue();
        verify(copyIntakeRunner).run("batch-1");
        assertThat(started.getSession().getStatus()).isEqualTo(AiScanSession.STARTED);
        assertThat(started.getSession().getIntakeBatchId()).isEqualTo("batch-1");
    }
}
