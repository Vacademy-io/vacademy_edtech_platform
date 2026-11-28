package vacademy.io.assessment_service.features.assessment.copy_intake.scan;

import com.fasterxml.jackson.core.type.TypeReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import vacademy.io.assessment_service.features.assessment.client.AiServiceScanClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.config.ScanStationProperties;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanLoad;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanLoadRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanSessionRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanMediaUrls;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanLoader;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanStationRunner;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static vacademy.io.assessment_service.features.assessment.copy_intake.scan.ScanFixtures.load;

/** The runner with the pool running inline and the database held in maps. */
class ScanStationRunnerTest {

    private AiScanSessionRepository sessions;
    private AiScanLoadRepository loads;
    private AiCopyIntakeItemRepository items;
    private AiServiceScanClient client;
    private ScanPlanLoader plans;
    private ScanStationRunner runner;
    private ThreadPoolTaskExecutor executor;
    private ScanMediaUrls media;

    private final Map<String, AiScanSession> sessionRows = new HashMap<>();
    private final Map<String, AiScanLoad> loadRows = new HashMap<>();
    private final List<Long> pauses = new ArrayList<>();

    @BeforeEach
    void setUp() {
        sessions = mock(AiScanSessionRepository.class);
        loads = mock(AiScanLoadRepository.class);
        items = mock(AiCopyIntakeItemRepository.class);
        client = mock(AiServiceScanClient.class);
        media = mock(ScanMediaUrls.class);
        when(media.url(anyString())).thenAnswer(inv -> "https://media/" + inv.getArgument(0));
        executor = mock(ThreadPoolTaskExecutor.class);
        doAnswer(inv -> {
            inv.<Runnable>getArgument(0).run();
            return null;
        }).when(executor).execute(any(Runnable.class));
        plans = new ScanPlanLoader(loads);

        when(sessions.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(sessionRows.get(inv.<String>getArgument(0))));
        when(sessions.save(any(AiScanSession.class))).thenAnswer(inv -> {
            AiScanSession s = inv.getArgument(0);
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
        when(loads.save(any(AiScanLoad.class))).thenAnswer(inv -> {
            AiScanLoad l = inv.getArgument(0);
            l.setUpdatedAt(new Date());                         // @UpdateTimestamp
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
        when(loads.transition(anyString(), anyString(), anyString())).thenAnswer(inv -> {
            AiScanLoad l = loadRows.get(inv.<String>getArgument(0));
            if (l == null || !l.getStatus().equals(inv.getArgument(1))) return 0;
            l.setStatus(inv.getArgument(2));
            return 1;
        });

        runner = new ScanStationRunner(new ScanStationProperties(true, "*", 60000), sessions, loads, items, client,
                media, plans, executor) {
            @Override
            protected void pause(long millis) {
                pauses.add(millis);     // no waiting in tests
            }
        };
    }

    private AiScanSession session(String status) {
        AiScanSession s = AiScanSession.builder().id("sess-1").assessmentId("a-1").instituteId("inst-1")
                .status(status).version(0L).build();
        sessionRows.put(s.getId(), s);
        return s;
    }

    private AiScanLoad pendingLoad(int attempts) {
        ScanStationDtos.LoadRequest req = ScanStationDtos.LoadRequest.builder().passes(List.of(
                ScanStationDtos.Pass.builder().passNo(2).files(List.of(
                        ScanStationDtos.PassFile.builder().fileId("b1").fileName("Scan 1.jpeg").kind("IMAGE").orderIndex(1).pageCount(1).build(),
                        ScanStationDtos.PassFile.builder().fileId("b0").fileName("Scan.jpeg").kind("IMAGE").orderIndex(0).pageCount(1).build())).build(),
                ScanStationDtos.Pass.builder().passNo(1).files(List.of(
                        ScanStationDtos.PassFile.builder().fileId("a0").fileName("Scan.jpeg").kind("IMAGE").orderIndex(0).pageCount(1).build(),
                        ScanStationDtos.PassFile.builder().fileId("a1").fileName("Scan 1.jpeg").kind("IMAGE").orderIndex(1).pageCount(1).build())).build()))
                .build();
        AiScanLoad l = AiScanLoad.builder().id("load-1").sessionId("sess-1").loadNo(1).status(AiScanLoad.PENDING)
                .passesJson(ScanFixtures.write(req)).attempts(attempts).version(0L).build();
        loadRows.put(l.getId(), l);
        return l;
    }

    private AiScanLoad doneLoad(int loadNo, ScanAnalysis.Result r) {
        AiScanLoad l = AiScanLoad.builder().id("load-" + loadNo).sessionId("sess-1").loadNo(loadNo)
                .status(AiScanLoad.DONE).passesJson("{\"passes\":[]}").resultJson(ScanFixtures.write(r))
                .version(0L).build();
        loadRows.put(l.getId(), l);
        return l;
    }

    // --------------------------------------------------------------- analyse

    @Test
    void analyseSendsTheFilesInPassAndScanOrderAndStoresTheAnswerVerbatim() {
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(0);
        String json = ScanFixtures.json("c1_1118_layout.json");
        when(client.analyseLoad(any())).thenReturn(new AiServiceScanClient.Analysed(json, ScanFixtures.fixture("c1_1118_layout.json")));

        runner.kickLoad("load-1");

        ArgumentCaptor<ScanAnalysis.AnalyseRequest> req = ArgumentCaptor.forClass(ScanAnalysis.AnalyseRequest.class);
        verify(client).analyseLoad(req.capture());
        assertThat(req.getValue().getInstituteId()).isEqualTo("inst-1");
        assertThat(req.getValue().getSessionId()).isEqualTo("sess-1");
        assertThat(req.getValue().getLoadNo()).isEqualTo(1);
        assertThat(req.getValue().getPasses()).extracting(ScanAnalysis.PassRef::getPassNo).containsExactly(1, 2);
        assertThat(req.getValue().getPasses().get(1).getFiles()).extracting(ScanAnalysis.FileRef::getFileId)
                .containsExactly("b0", "b1");
        assertThat(req.getValue().getPasses().get(0).getFiles().get(0).getUrl()).isEqualTo("https://media/a0");
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.DONE);
        assertThat(l.getResultJson()).isEqualTo(json);
        assertThat(l.getAttempts()).isEqualTo(1);
    }

    @Test
    void busyGoesBackToPending() {
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(0);
        when(client.analyseLoad(any())).thenThrow(new AiServiceScanClient.ScanBusyException("busy"));

        runner.kickLoad("load-1");

        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);
        assertThat(l.getAttempts()).isZero();                   // busy is not the load's fault
        assertThat(l.getErrorMessage()).contains("busy");
    }

    @Test
    void aBusyAiServiceNeverFailsALoad() {
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(0);
        when(client.analyseLoad(any())).thenThrow(new AiServiceScanClient.ScanBusyException("busy"));

        for (int i = 0; i < 6; i++) runner.kickLoad("load-1");

        verify(client, times(6)).analyseLoad(any());
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);
        assertThat(l.getAttempts()).isZero();

        // a real failure still counts
        org.mockito.Mockito.doThrow(new AiServiceScanClient.ScanRetryableException("503")).when(client).analyseLoad(any());
        runner.kickLoad("load-1");
        assertThat(l.getAttempts()).isEqualTo(1);
    }

    @Test
    void threeFailuresFailTheLoad() {
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(0);
        when(client.analyseLoad(any())).thenThrow(new AiServiceScanClient.ScanRetryableException("503"));

        runner.kickLoad("load-1");
        runner.kickLoad("load-1");
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);
        runner.kickLoad("load-1");

        assertThat(l.getStatus()).isEqualTo(AiScanLoad.FAILED);
        assertThat(l.getAttempts()).isEqualTo(3);
        assertThat(l.getErrorMessage()).contains("after 3 tries");
        verify(client, times(3)).analyseLoad(any());
    }

    @Test
    void aRefusalFailsAtOnceAndASwitchedOffReaderSpendsNoAttempt() {
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(0);
        when(client.analyseLoad(any())).thenThrow(new AiServiceScanClient.ScanDisabledException("off"));
        runner.kickLoad("load-1");
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);
        assertThat(l.getAttempts()).isZero();

        org.mockito.Mockito.doThrow(new AiServiceScanClient.ScanRejectedException(422, "bad"))
                .when(client).analyseLoad(any());
        runner.kickLoad("load-1");
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.FAILED);
    }

    @Test
    void aSwitchedOffReaderParksTheLoadAndTheSweepAsksAgainOnlyAfterTheBackOff() {
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(0);
        when(loads.findByStatus(AiScanLoad.PENDING)).thenAnswer(inv -> loadRows.values().stream()
                .filter(x -> AiScanLoad.PENDING.equals(x.getStatus())).toList());
        when(client.analyseLoad(any())).thenThrow(new AiServiceScanClient.ScanDisabledException("404 scan reader off"));

        runner.kickLoad("load-1");
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);
        assertThat(l.getErrorMessage()).isEqualTo(ScanStationRunner.AI_OFF_MESSAGE);
        assertThat(l.getAttempts()).isZero();

        // every sweep inside the back-off leaves it alone: no call, no attempt
        for (int i = 0; i < 5; i++) runner.sweep();
        verify(client, times(1)).analyseLoad(any());

        // past the back-off it is asked once more, still spends nothing, and parks again
        l.setUpdatedAt(new Date(System.currentTimeMillis() - 6 * 60_000L));
        runner.sweep();
        verify(client, times(2)).analyseLoad(any());
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);
        assertThat(l.getAttempts()).isZero();
        runner.sweep();
        verify(client, times(2)).analyseLoad(any());

        // switched on: the next ask after the back-off reads it
        org.mockito.Mockito.reset(client);
        when(client.analyseLoad(any())).thenReturn(new AiServiceScanClient.Analysed(
                ScanFixtures.json("c1_1118_layout.json"), ScanFixtures.fixture("c1_1118_layout.json")));
        l.setUpdatedAt(new Date(System.currentTimeMillis() - 6 * 60_000L));
        runner.sweep();
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.DONE);
        assertThat(l.getAttempts()).isEqualTo(1);
        assertThat(l.getErrorMessage()).isNull();
    }

    @Test
    void aLoadReadMeansTheReaderIsOnSoParkedLoadsAreAskedAtOnce() {
        session(AiScanSession.OPEN);
        AiScanLoad parked = pendingLoad(0);
        parked.setErrorMessage(ScanStationRunner.AI_OFF_MESSAGE);
        parked.setUpdatedAt(new Date(System.currentTimeMillis() - 1_000L));
        AiScanLoad fresh = AiScanLoad.builder().id("load-2").sessionId("sess-1").loadNo(2).status(AiScanLoad.PENDING)
                .passesJson(parked.getPassesJson()).attempts(0).version(0L).build();
        loadRows.put(fresh.getId(), fresh);
        when(loads.findByStatus(AiScanLoad.PENDING)).thenAnswer(inv -> loadRows.values().stream()
                .filter(x -> AiScanLoad.PENDING.equals(x.getStatus()))
                .sorted(Comparator.comparingInt(AiScanLoad::getLoadNo)).toList());
        when(client.analyseLoad(any())).thenReturn(new AiServiceScanClient.Analysed(
                ScanFixtures.json("c1_1118_layout.json"), ScanFixtures.fixture("c1_1118_layout.json")));

        runner.sweep();                     // load 1 still waits; the clerk's new load 2 is read
        assertThat(parked.getStatus()).isEqualTo(AiScanLoad.PENDING);
        assertThat(fresh.getStatus()).isEqualTo(AiScanLoad.DONE);

        runner.sweep();                     // a read succeeded since load 1 was parked: ask now
        assertThat(parked.getStatus()).isEqualTo(AiScanLoad.DONE);
        assertThat(parked.getAttempts()).isEqualTo(1);
    }

    @Test
    void sweepRequeuesAStaleAnalysingLoad() {
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(1);
        l.setStatus(AiScanLoad.ANALYSING);
        when(loads.findByStatus(AiScanLoad.PENDING)).thenReturn(List.of());
        when(loads.findByStatusAndClaimedAtBefore(anyString(), any(Date.class))).thenReturn(List.of(l));
        when(client.analyseLoad(any())).thenReturn(new AiServiceScanClient.Analysed(
                ScanFixtures.json("c1_1118_layout.json"), ScanFixtures.fixture("c1_1118_layout.json")));

        runner.sweep();

        verify(loads).transition("load-1", AiScanLoad.ANALYSING, AiScanLoad.PENDING);
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.DONE);
        assertThat(l.getAttempts()).isEqualTo(2);
    }

    @Test
    void sweepIsIdleWhileSwitchedOff() {
        ScanStationRunner off = new ScanStationRunner(new ScanStationProperties(false, "*", 60000), sessions, loads,
                items, client, mock(ScanMediaUrls.class), plans, mock(ThreadPoolTaskExecutor.class));
        off.sweep();
        verifyNoInteractions(loads, items, client);
    }

    @Test
    void anInstituteOffTheListIsNotRead() {
        ScanStationRunner listed = new ScanStationRunner(new ScanStationProperties(true, "other-inst", 60000),
                sessions, loads, items, client, media, plans, executor);
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(0);
        when(loads.findByStatus(AiScanLoad.PENDING)).thenReturn(List.of(l));
        listed.sweep();
        // the sweep asks only for the listed institutes' rows, so inst-1's load is never offered
        verify(loads).findByStatusForInstitutes(AiScanLoad.PENDING, Set.of("other-inst"));
        verify(loads, never()).findByStatus(anyString());
        verify(executor, never()).execute(any(Runnable.class));
        verify(client, never()).analyseLoad(any());
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);

        // a kick that still reaches the worker (a request racing the list change) is declined there
        listed.kickLoad("load-1");
        verify(client, never()).analyseLoad(any());
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);
    }

    @Test
    void anInstituteTakenOffTheListKeepsItsBuildingSessionAsItIs() {
        ScanStationRunner listed = new ScanStationRunner(new ScanStationProperties(true, "other-inst", 60000),
                sessions, loads, items, client, media, plans, executor);
        AiScanSession s = session(AiScanSession.BUILDING);
        s.setErrorMessage(ScanStationRunner.BUSY_MESSAGE);
        // even if a query hands back a row of an institute that is off, it is not touched
        when(sessions.findByStatusAndInstituteIdInAndUpdatedAtBefore(anyString(), any(), any(Date.class)))
                .thenReturn(List.of(s));
        when(sessions.findByStatusAndErrorMessageAndInstituteIdInAndUpdatedAtBefore(anyString(), anyString(), any(),
                any(Date.class))).thenReturn(List.of(s));
        when(sessions.claimBuild(anyString(), anyString(), any(Date.class))).thenReturn(1);

        listed.sweep();

        verify(sessions, never()).findByStatusAndUpdatedAtBefore(anyString(), any(Date.class));
        verify(sessions, never()).findByStatusAndErrorMessageAndUpdatedAtBefore(anyString(), anyString(), any(Date.class));
        verify(sessions, times(2)).findByStatusAndInstituteIdInAndUpdatedAtBefore(anyString(),
                org.mockito.ArgumentMatchers.eq(Set.of("other-inst")), any(Date.class));
        verify(sessions, never()).claimBuild(anyString(), anyString(), any(Date.class));
        verify(sessions, never()).transition(anyString(), anyString(), anyString());
        verify(client, never()).build(any());
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILDING);
        assertThat(s.getErrorMessage()).isEqualTo(ScanStationRunner.BUSY_MESSAGE);
    }

    @Test
    void anAllowListedInstituteIsSweptThroughTheFilteredQueries() {
        ScanStationRunner listed = new ScanStationRunner(new ScanStationProperties(true, "inst-1, other-inst", 60000),
                sessions, loads, items, client, media, plans, executor);
        session(AiScanSession.OPEN);
        AiScanLoad l = pendingLoad(0);
        when(loads.findByStatusForInstitutes(anyString(), any())).thenReturn(List.of(l));
        when(client.analyseLoad(any())).thenReturn(new AiServiceScanClient.Analysed(
                ScanFixtures.json("c1_1118_layout.json"), ScanFixtures.fixture("c1_1118_layout.json")));

        listed.sweep();

        verify(loads).findByStatusForInstitutes(AiScanLoad.PENDING, Set.of("inst-1", "other-inst"));
        verify(loads).findByStatusAndClaimedAtBeforeForInstitutes(org.mockito.ArgumentMatchers.eq(AiScanLoad.ANALYSING),
                any(Date.class), org.mockito.ArgumentMatchers.eq(Set.of("inst-1", "other-inst")));
        assertThat(l.getStatus()).isEqualTo(AiScanLoad.DONE);
    }

    @Test
    void anEmptyListSweepsNothing() {
        ScanStationRunner none = new ScanStationRunner(new ScanStationProperties(true, " ", 60000),
                sessions, loads, items, client, media, plans, executor);
        none.sweep();
        verifyNoInteractions(loads, sessions, items, client);
    }

    // ------------------------------------------------------------------ build

    @Test
    void buildStoresEveryCopyInPileOrderWithTheFingerprint() {
        AiScanSession s = session(AiScanSession.BUILDING);
        doneLoad(1, load(3).labels(0, 1, 2).back(1, ScanAnalysis.BLANK)
                .flag("UNSURE_KEPT", "INFO", null).result());
        // BLANKS_TO_CONFIRM must be accepted for READY
        ScanPlanner.Plan before = plans.load(s).plan();
        ScanStationDtos.LoadDecisions d = new ScanStationDtos.LoadDecisions();
        d.getAcceptedFlags().put(ScanPlanner.BLANKS_TO_CONFIRM, before.loadFlag(1, ScanPlanner.BLANKS_TO_CONFIRM).fingerprint());
        loadRows.get("load-1").setDecisionsJson(ScanFixtures.write(d));
        ScanPlanner.Plan plan = plans.load(s).plan();
        assertThat(plan.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
        when(client.build(any())).thenAnswer(inv -> {
            ScanAnalysis.BuildRequest r = inv.getArgument(0);
            List<ScanAnalysis.BuiltCopy> out = new ArrayList<>();
            for (ScanAnalysis.BuildCopy c : r.getCopies()) {
                out.add(ScanAnalysis.BuiltCopy.builder().copyKey(c.getCopyKey()).fileId("pdf-" + c.getCopyKey())
                        .pageCount(c.getPages().size()).build());
            }
            return ScanAnalysis.BuildResult.builder().copies(out).build();
        });

        runner.kickBuild("sess-1");

        ArgumentCaptor<ScanAnalysis.BuildRequest> req = ArgumentCaptor.forClass(ScanAnalysis.BuildRequest.class);
        verify(client).build(req.capture());
        assertThat(req.getValue().getSourceId()).isEqualTo("ASSESSMENT_SCAN_STATION");
        assertThat(req.getValue().getCopies().get(1).getPages()).hasSize(1);    // blank back left out
        assertThat(req.getValue().getCopies().get(0).getPages().get(0).getUrl()).isEqualTo("https://media/file-1-0");
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILT);
        assertThat(s.getBuildFingerprint()).isEqualTo(plan.fingerprint());
        List<ScanStationDtos.BuiltEntry> built = plans.read(s.getBuiltJson(),
                new TypeReference<List<ScanStationDtos.BuiltEntry>>() { });
        assertThat(built).extracting(ScanStationDtos.BuiltEntry::getCopyKey).containsExactly("L1-S0", "L1-S1", "L1-S2");
        assertThat(built).extracting(ScanStationDtos.BuiltEntry::getPageCount).containsExactly(2, 1, 2);
        assertThat(built.get(0).getFileName()).isEqualTo("Load 1 copy 1");
        assertThat(built.get(0).getPageMap()).extracting(ScanStationDtos.PageMapEntry::getRef).containsExactly("p1.0", "p2.0");
    }

    @Test
    void aCopyThatFailsTwiceFailsTheBuild() {
        AiScanSession s = session(AiScanSession.BUILDING);
        doneLoad(1, load(2).labels(0, 1).result());
        when(client.build(any())).thenAnswer(inv -> {
            ScanAnalysis.BuildRequest r = inv.getArgument(0);
            List<ScanAnalysis.BuiltCopy> out = new ArrayList<>();
            for (ScanAnalysis.BuildCopy c : r.getCopies()) {
                boolean bad = c.getCopyKey().equals("L1-S1");
                out.add(ScanAnalysis.BuiltCopy.builder().copyKey(c.getCopyKey()).fileId(bad ? null : "pdf")
                        .pageCount(2).error(bad ? "COPY_TOO_LARGE" : null).build());
            }
            return ScanAnalysis.BuildResult.builder().copies(out).build();
        });

        runner.kickBuild("sess-1");

        verify(client, times(2)).build(any());   // the failed copy is tried once more on its own
        assertThat(s.getStatus()).isEqualTo(AiScanSession.FAILED);
        assertThat(s.getErrorMessage()).isEqualTo("1 copy could not be made");
        assertThat(s.getBuildFingerprint()).isNull();
    }

    @Test
    void buildRefusesAPlanThatIsNoLongerReady() {
        AiScanSession s = session(AiScanSession.BUILDING);
        doneLoad(1, load(2).labels(0, 1).flag("DPI_LOW", "REVIEW", null).result());
        runner.kickBuild("sess-1");
        verify(client, never()).build(any());
        assertThat(s.getStatus()).isEqualTo(AiScanSession.FAILED);
    }

    @Test
    void buildChunksByCopiesAndPages() {
        AiScanSession s = session(AiScanSession.BUILDING);
        int[] all = new int[23];
        for (int i = 0; i < all.length; i++) all[i] = i;
        doneLoad(1, load(23).labels(all).result());
        when(client.build(any())).thenAnswer(inv -> {
            ScanAnalysis.BuildRequest r = inv.getArgument(0);
            assertThat(r.getCopies()).hasSizeLessThanOrEqualTo(10);
            List<ScanAnalysis.BuiltCopy> out = new ArrayList<>();
            for (ScanAnalysis.BuildCopy c : r.getCopies()) {
                out.add(ScanAnalysis.BuiltCopy.builder().copyKey(c.getCopyKey()).fileId("pdf").pageCount(2).build());
            }
            return ScanAnalysis.BuildResult.builder().copies(out).build();
        });
        runner.kickBuild("sess-1");
        verify(client, times(3)).build(any());
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILT);
    }

    private static org.mockito.stubbing.Answer<ScanAnalysis.BuildResult> builtOk() {
        return inv -> {
            ScanAnalysis.BuildRequest r = inv.getArgument(0);
            List<ScanAnalysis.BuiltCopy> out = new ArrayList<>();
            for (ScanAnalysis.BuildCopy c : r.getCopies()) {
                out.add(ScanAnalysis.BuiltCopy.builder().copyKey(c.getCopyKey()).fileId("pdf-" + c.getCopyKey())
                        .pageCount(c.getPages().size()).build());
            }
            return ScanAnalysis.BuildResult.builder().copies(out).build();
        };
    }

    @Test
    void buildWaitsOutABusyAiServiceAndStampsTheSessionBeforeEveryCall() {
        AiScanSession s = session(AiScanSession.BUILDING);
        doneLoad(1, load(2).labels(0, 1).result());
        List<Date> stamps = new ArrayList<>();
        org.mockito.stubbing.Answer<ScanAnalysis.BuildResult> ok = builtOk();
        int[] calls = { 0 };
        when(client.build(any())).thenAnswer(inv -> {
            stamps.add(s.getUpdatedAt());
            if (calls[0]++ < 2) throw new AiServiceScanClient.ScanBusyException("busy");
            return ok.answer(inv);
        });

        runner.kickBuild("sess-1");

        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILT);
        assertThat(pauses).containsExactly(10_000L, 20_000L);    // at least Retry-After, growing
        assertThat(stamps).hasSize(3).doesNotContainNull();
    }

    @Test
    void aBuildThatStaysBusyIsParkedNotFailedAndKeepsWhatItMade() {
        AiScanSession s = session(AiScanSession.BUILDING);
        int[] all = new int[13];
        for (int i = 0; i < all.length; i++) all[i] = i;
        doneLoad(1, load(13).labels(all).result());
        org.mockito.stubbing.Answer<ScanAnalysis.BuildResult> ok = builtOk();
        int[] calls = { 0 };
        when(client.build(any())).thenAnswer(inv -> {
            if (calls[0]++ == 0) return ok.answer(inv);           // the first chunk of 10 is made
            throw new AiServiceScanClient.ScanBusyException("busy");
        });

        runner.kickBuild("sess-1");

        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILDING);
        assertThat(s.getErrorMessage()).isEqualTo(ScanStationRunner.BUSY_MESSAGE);
        assertThat(calls[0]).isEqualTo(1 + 6);                   // one try and five waits on the second chunk
        List<ScanStationDtos.BuiltEntry> kept = plans.read(s.getBuiltJson(),
                new TypeReference<List<ScanStationDtos.BuiltEntry>>() { });
        assertThat(kept).hasSize(10);

        // the sweep resumes it; only the 3 copies not made yet go to ai_service
        when(sessions.findByStatusAndErrorMessageAndUpdatedAtBefore(anyString(), anyString(), any(Date.class)))
                .thenReturn(List.of(s));
        when(sessions.claimBuild(anyString(), anyString(), any(Date.class))).thenReturn(1);
        List<Integer> sent = new ArrayList<>();
        org.mockito.Mockito.reset(client);
        when(client.build(any())).thenAnswer(inv -> {
            sent.add(inv.<ScanAnalysis.BuildRequest>getArgument(0).getCopies().size());
            return ok.answer(inv);
        });

        runner.sweep();

        assertThat(sent).containsExactly(3);
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILT);
        assertThat(s.getErrorMessage()).isNull();
        List<ScanStationDtos.BuiltEntry> built = plans.read(s.getBuiltJson(),
                new TypeReference<List<ScanStationDtos.BuiltEntry>>() { });
        assertThat(built).hasSize(13);
        assertThat(built.get(0).getFileId()).isEqualTo("pdf-L1-S0");
    }

    @Test
    void theSweepRestartsAStaleBuildOnlyWhenItWinsTheClaim() {
        AiScanSession s = session(AiScanSession.BUILDING);
        doneLoad(1, load(2).labels(0, 1).result());
        when(sessions.findByStatusAndUpdatedAtBefore(anyString(), any(Date.class))).thenAnswer(inv ->
                AiScanSession.BUILDING.equals(inv.getArgument(0)) ? List.of(s) : List.of());
        when(client.build(any())).thenAnswer(builtOk());

        when(sessions.claimBuild(anyString(), anyString(), any(Date.class))).thenReturn(0);   // another pod won
        runner.sweep();
        verify(client, never()).build(any());
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILDING);

        when(sessions.claimBuild(anyString(), anyString(), any(Date.class))).thenReturn(1);
        runner.sweep();
        verify(sessions, times(2)).claimBuild(org.mockito.ArgumentMatchers.eq("sess-1"),
                org.mockito.ArgumentMatchers.eq(AiScanSession.BUILDING), any(Date.class));
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILT);
    }

    // --------------------------------------------------------------- recovery

    @Test
    void startingRecoveryAdoptsTheBatchItAlreadyMadeAndNeverStartsAgain() {
        AiScanSession s = session(AiScanSession.STARTING);
        s.setBuiltJson("[{\"copy_key\":\"L1-S0\",\"file_id\":\"pdf-1\",\"page_count\":2}]");
        when(loads.findByStatus(anyString())).thenReturn(List.of());
        when(loads.findByStatusAndClaimedAtBefore(anyString(), any(Date.class))).thenReturn(List.of());
        when(sessions.findByStatusAndUpdatedAtBefore(anyString(), any(Date.class))).thenAnswer(inv ->
                AiScanSession.STARTING.equals(inv.getArgument(0)) ? List.of(s) : List.of());
        when(items.findFirstByFileIdIn(anyList())).thenReturn(Optional.of(
                AiCopyIntakeItem.builder().id("item-1").batchId("batch-7").fileId("pdf-1").build()));

        runner.sweep();

        assertThat(s.getStatus()).isEqualTo(AiScanSession.STARTED);
        assertThat(s.getIntakeBatchId()).isEqualTo("batch-7");
        verify(sessions, never()).transition(anyString(), anyString(), anyString());
    }

    @Test
    void startingRecoveryWithNoBatchGoesBackToBuilt() {
        AiScanSession s = session(AiScanSession.STARTING);
        s.setBuiltJson("[{\"copy_key\":\"L1-S0\",\"file_id\":\"pdf-1\",\"page_count\":2}]");
        when(loads.findByStatus(anyString())).thenReturn(List.of());
        when(loads.findByStatusAndClaimedAtBefore(anyString(), any(Date.class))).thenReturn(List.of());
        when(sessions.findByStatusAndUpdatedAtBefore(anyString(), any(Date.class))).thenAnswer(inv ->
                AiScanSession.STARTING.equals(inv.getArgument(0)) ? List.of(s) : List.of());
        when(items.findFirstByFileIdIn(anyList())).thenReturn(Optional.empty());

        runner.sweep();

        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILT);
        assertThat(s.getIntakeBatchId()).isNull();
    }
}
