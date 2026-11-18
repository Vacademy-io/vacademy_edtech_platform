package vacademy.io.assessment_service.features.assessment.copy_intake.scan;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.dto.CopyIntakeDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.config.ScanStationProperties;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanLoad;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanLoadRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanSessionRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanLoader;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanStationRunner;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanStationService;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeRunner;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.assessment_service.features.assessment.copy_intake.scan.ScanFixtures.load;

/** The scan station's state machine with the database held in maps. */
class ScanStationServiceTest {

    private AiScanSessionRepository sessions;
    private AiScanLoadRepository loads;
    private ScanStationRunner runner;
    private InstituteFileOwnership ownership;
    private CopyIntakeService copyIntake;
    private CopyIntakeRunner copyIntakeRunner;
    private AssessmentAuditClient audit;
    private ScanPlanLoader plans;
    private ScanStationService service;

    private final Map<String, AiScanSession> sessionRows = new HashMap<>();
    private final Map<String, AiScanLoad> loadRows = new HashMap<>();
    private final CustomUserDetails admin = new CustomUserDetails();

    @BeforeEach
    void setUp() {
        sessions = mock(AiScanSessionRepository.class);
        loads = mock(AiScanLoadRepository.class);
        runner = mock(ScanStationRunner.class);
        ownership = mock(InstituteFileOwnership.class);
        copyIntake = mock(CopyIntakeService.class);
        copyIntakeRunner = mock(CopyIntakeRunner.class);
        audit = mock(AssessmentAuditClient.class);
        plans = new ScanPlanLoader(loads);
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
        when(ownership.notOwnedBy(anyString(), anyList())).thenReturn(List.of());

        service = new ScanStationService(new ScanStationProperties(true, "inst-1", 60000), sessions, loads, plans,
                runner, ownership, copyIntake, copyIntakeRunner, audit, tx);
        ReflectionTestUtils.setField(admin, "userId", "admin-1");
        admin.setFullName("Admin One");
    }

    // ---------------------------------------------------------------- helpers

    private AiScanSession session(String status) {
        AiScanSession s = AiScanSession.builder().id("sess-1").assessmentId("a-1").instituteId("inst-1")
                .status(status).version(0L).build();
        sessionRows.put(s.getId(), s);
        return s;
    }

    private AiScanLoad doneLoad(int loadNo, ScanAnalysis.Result r) {
        AiScanLoad l = AiScanLoad.builder().id("load-" + loadNo).sessionId("sess-1").loadNo(loadNo)
                .status(AiScanLoad.DONE).passesJson(ScanFixtures.write(request(2, 2)))
                .resultJson(ScanFixtures.write(r)).version(0L).build();
        loadRows.put(l.getId(), l);
        return l;
    }

    private static ScanStationDtos.LoadRequest request(int pass1, int pass2) {
        return ScanStationDtos.LoadRequest.builder().intakeMode("TWO_PASSES").orderSource("IMAGE_CAPTURE_SUFFIX")
                .passes(List.of(pass(1, pass1), pass(2, pass2))).build();
    }

    private static ScanStationDtos.Pass pass(int no, int pages) {
        List<ScanStationDtos.PassFile> files = new ArrayList<>();
        for (int i = 0; i < pages; i++) {
            files.add(ScanStationDtos.PassFile.builder().fileId("f" + no + "-" + i).fileName("Scan " + i + ".jpeg")
                    .kind("IMAGE").orderIndex(i).pageCount(1).build());
        }
        return ScanStationDtos.Pass.builder().passNo(no).files(files).build();
    }

    private static HttpStatus status(Throwable e) {
        return ((VacademyException) e).getStatus();
    }

    /** A READY session already built from its plan. */
    private AiScanSession builtSession() {
        AiScanSession s = session(AiScanSession.BUILT);
        doneLoad(1, load(4).labels(0, 1, 3).evidence(true, false).result());
        ScanPlanner.Plan plan = plans.load(s).plan();
        assertThat(plan.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
        List<ScanStationDtos.BuiltEntry> built = new ArrayList<>();
        int i = 0;
        for (ScanPlanner.Copy c : plan.buildList()) {
            built.add(ScanStationDtos.BuiltEntry.builder().copyKey(c.copyKey()).fileId("pdf-" + (++i))
                    .pageCount(c.pages().size()).fileName(c.label()).build());
        }
        s.setBuiltJson(ScanFixtures.write(built));
        s.setBuildFingerprint(plan.fingerprint());
        return s;
    }

    // ------------------------------------------------------------------ loads

    @Test
    void countMismatchIs422AndNothingIsSaved() {
        AiScanSession s = session(AiScanSession.OPEN);
        assertThatThrownBy(() -> service.addLoad(s, request(3, 2)))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY))
                .hasMessageStartingWith("COUNT_MISMATCH");
        assertThat(loadRows).isEmpty();
        verify(runner, never()).kickLoad(anyString());
    }

    @Test
    void aPdfCountsItsPagesWhenComparingPasses() {
        AiScanSession s = session(AiScanSession.OPEN);
        ScanStationDtos.LoadRequest r = ScanStationDtos.LoadRequest.builder().passes(List.of(pass(1, 3),
                ScanStationDtos.Pass.builder().passNo(2).files(List.of(ScanStationDtos.PassFile.builder()
                        .fileId("pdf").fileName("backs.pdf").kind("pdf").orderIndex(0).pageCount(3).build())).build()))
                .build();
        service.addLoad(s, r);
        assertThat(loadRows).hasSize(1);
    }

    @Test
    void foreignFileIs403() {
        AiScanSession s = session(AiScanSession.OPEN);
        when(ownership.notOwnedBy(eq("inst-1"), anyList())).thenReturn(List.of("f1-0"));
        assertThatThrownBy(() -> service.addLoad(s, request(2, 2)))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.FORBIDDEN));
        assertThat(loadRows).isEmpty();
    }

    @Test
    void tooManyPagesInAPassIs422() {
        AiScanSession s = session(AiScanSession.OPEN);
        assertThatThrownBy(() -> service.addLoad(s, request(101, 101)))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY))
                .hasMessageStartingWith("LOAD_TOO_LARGE");
    }

    @Test
    void addLoadSavesPendingNumbersLoadsAndKicksTheRunner() {
        AiScanSession s = session(AiScanSession.OPEN);
        ScanStationDtos.SessionDto dto = service.addLoad(s, request(2, 2));
        service.addLoad(s, request(1, 1));

        assertThat(loadRows.values()).extracting(AiScanLoad::getLoadNo).containsExactlyInAnyOrder(1, 2);
        assertThat(loadRows.values()).allMatch(l -> AiScanLoad.PENDING.equals(l.getStatus()));
        verify(runner).kickLoad("load-1");
        verify(runner).kickLoad("load-2");
        assertThat(dto.getVerdict()).isEqualTo(ScanPlanner.VERDICT_ANALYSING);
        assertThat(dto.getLoads().get(0).getPasses().get(0).getPageCount()).isEqualTo(2);
    }

    @Test
    void loadChangesAndDecisionsAreRefusedUnlessOpen() {
        AiScanSession s = session(AiScanSession.BUILT);
        doneLoad(1, load(2).labels(0, 1).result());

        assertThatThrownBy(() -> service.addLoad(s, request(2, 2)))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT));
        assertThatThrownBy(() -> service.replaceLoad(s, 1, request(2, 2)))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT));
        assertThatThrownBy(() -> service.removeLoad(s, 1))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT));
        assertThatThrownBy(() -> service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("EXCLUDE_COPY").loadNo(1).sheetNo(0).build()))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT));
        assertThat(loadRows.get("load-1").getDecisionsJson()).isNull();
    }

    @Test
    void replaceResetsTheLoadAndClearsItsDecisions() {
        AiScanSession s = session(AiScanSession.OPEN);
        AiScanLoad l = doneLoad(1, load(2).labels(0, 1).result());
        l.setDecisionsJson("{\"excluded\":[0]}");
        l.setAttempts(2);

        service.replaceLoad(s, 1, request(3, 3));

        assertThat(l.getStatus()).isEqualTo(AiScanLoad.PENDING);
        assertThat(l.getAttempts()).isZero();
        assertThat(l.getResultJson()).isNull();
        assertThat(l.getDecisionsJson()).isNull();
        verify(runner).kickLoad("load-1");
    }

    // -------------------------------------------------------------- decisions

    @Test
    void dropPageIsRefusedForALabelledFront() {
        AiScanSession s = session(AiScanSession.OPEN);
        doneLoad(1, load(2).labels(0).result());
        assertThatThrownBy(() -> service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("DROP_PAGE").loadNo(1).ref("p1.0").build()))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY));

        // an unlabelled front and a back can be dropped
        service.decide(s, ScanStationDtos.DecisionRequest.builder().action("DROP_PAGE").loadNo(1).ref("p1.1").build());
        service.decide(s, ScanStationDtos.DecisionRequest.builder().action("DROP_PAGE").loadNo(1).ref("p2.0").build());
        assertThat(plans.loadDecisions(loadRows.get("load-1")).getPageOverrides())
                .containsEntry("p1.1", "DROP").containsEntry("p2.0", "DROP");
    }

    @Test
    void acceptCopyStoresWhatTheClerkSawAndADirectionChangeClearsIt() {
        AiScanSession s = session(AiScanSession.OPEN);
        doneLoad(1, load(3).labels(0, 1).flag("PAIR_NOT_ROW_MAX", "REVIEW", 2).result());
        String fp = plans.load(s).plan().copyAt(1, 1).fingerprint();

        ScanStationDtos.SessionDto dto = service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_COPY").loadNo(1).sheetNo(1).build());
        assertThat(plans.loadDecisions(loadRows.get("load-1")).getAccepted()).containsEntry("1", fp);
        assertThat(dto.getCopies().get(1).getDecision()).isEqualTo(ScanPlanner.DECISION_ACCEPTED);

        dto = service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("SET_FRONTS_DIRECTION").value("FORWARD").build());
        assertThat(plans.loadDecisions(loadRows.get("load-1")).getAccepted()).isEmpty();
        assertThat(dto.getFrontsDirectionSource()).isEqualTo(ScanPlanner.SOURCE_CLERK);
        assertThat(dto.getCopies().get(1).getDecision()).isEqualTo(ScanPlanner.DECISION_NONE);
    }

    @Test
    void anAcceptForACopyThatChangedSinceItWasShownIsRefused() {
        AiScanSession s = session(AiScanSession.OPEN);
        doneLoad(1, load(3).labels(0, 1).flag("PAIR_NOT_ROW_MAX", "REVIEW", 2).result());
        ScanStationDtos.SessionDto shown = service.getSession(s);
        String seen = shown.getCopies().get(1).getFingerprint();
        assertThat(seen).isEqualTo(plans.load(s).plan().copyAt(1, 1).fingerprint());

        // a later load finishes and its unlabelled first sheet joins the copy on screen
        AiScanLoad l2 = doneLoad(2, load(2).labels(1).result());
        assertThat(plans.load(s).plan().copyAt(1, 1).sheets()).hasSize(3);
        assertThatThrownBy(() -> service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_COPY").loadNo(1).sheetNo(1).expectedFingerprint(seen).build()))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT))
                .hasMessageContaining("PLAN_CHANGED");
        assertThat(plans.loadDecisions(loadRows.get("load-1")).getAccepted()).isEmpty();

        // accepting what is on screen now works
        String now = service.getSession(s).getCopies().get(1).getFingerprint();
        ScanStationDtos.SessionDto dto = service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_COPY").loadNo(1).sheetNo(1).expectedFingerprint(now).build());
        assertThat(dto.getCopies().get(1).getDecision()).isEqualTo(ScanPlanner.DECISION_ACCEPTED);
        assertThat(l2.getLoadNo()).isEqualTo(2);
    }

    @Test
    void aLoadFlagAcceptChecksTheFingerprintShownToo() {
        AiScanSession s = session(AiScanSession.OPEN);
        doneLoad(1, load(3).labels(0, 1, 2).back(0, ScanAnalysis.BLANK).result());
        ScanStationDtos.LoadFlag blanks = service.getSession(s).getLoads().get(0).getFlags().stream()
                .filter(f -> ScanPlanner.BLANKS_TO_CONFIRM.equals(f.getCode())).findFirst().orElseThrow();
        assertThat(blanks.getFingerprint()).isNotBlank();

        assertThatThrownBy(() -> service.decide(s, ScanStationDtos.DecisionRequest.builder().action("ACCEPT_LOAD_FLAG")
                .loadNo(1).code(ScanPlanner.BLANKS_TO_CONFIRM).expectedFingerprint("stale").build()))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT));

        ScanStationDtos.SessionDto dto = service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_LOAD_FLAG").loadNo(1).code(ScanPlanner.BLANKS_TO_CONFIRM)
                .expectedFingerprint(blanks.getFingerprint()).build());
        assertThat(dto.getVerdict()).isEqualTo(ScanPlanner.VERDICT_READY);
    }

    @Test
    void aSecondLoadFlagWithTheSameCodeIsAcceptedByItsFingerprint() {
        AiScanSession s = session(AiScanSession.OPEN);
        doneLoad(1, load(3).labels(0, 1, 2).flag("ORDER_UNCERTAIN", "REVIEW", 1)
                .flag("ORDER_UNCERTAIN", "REVIEW", 2).result());
        List<ScanStationDtos.LoadFlag> shown = service.getSession(s).getLoads().get(0).getFlags().stream()
                .filter(f -> "ORDER_UNCERTAIN".equals(f.getCode())).toList();
        assertThat(shown).hasSize(2);

        // without the fingerprint the server cannot tell which one the clerk meant
        assertThatThrownBy(() -> service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_LOAD_FLAG").loadNo(1).code("ORDER_UNCERTAIN").build()))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY))
                .hasMessageContaining("AMBIGUOUS_FLAG");
        // a fingerprint that is none of them: the screen is out of date
        assertThatThrownBy(() -> service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_LOAD_FLAG").loadNo(1).code("ORDER_UNCERTAIN").expectedFingerprint("stale").build()))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT));

        ScanStationDtos.SessionDto dto = service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_LOAD_FLAG").loadNo(1).code("ORDER_UNCERTAIN")
                .expectedFingerprint(shown.get(1).getFingerprint()).build());
        assertThat(dto.getLoads().get(0).getFlags().stream().filter(f -> "ORDER_UNCERTAIN".equals(f.getCode())))
                .extracting(ScanStationDtos.LoadFlag::isAccepted).containsExactly(false, true);
        assertThat(dto.getVerdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);

        dto = service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_LOAD_FLAG").loadNo(1).code("ORDER_UNCERTAIN")
                .expectedFingerprint(shown.get(0).getFingerprint()).build());
        assertThat(dto.getLoads().get(0).getFlags().stream().filter(f -> "ORDER_UNCERTAIN".equals(f.getCode())))
                .extracting(ScanStationDtos.LoadFlag::isAccepted).containsExactly(true, true);
        assertThat(dto.getVerdict()).isEqualTo(ScanPlanner.VERDICT_READY);
        // stored fingerprint -> code, one entry per flag
        assertThat(plans.loadDecisions(loadRows.get("load-1")).getAcceptedFlags())
                .containsOnlyKeys(shown.get(0).getFingerprint(), shown.get(1).getFingerprint())
                .containsValues("ORDER_UNCERTAIN");
    }

    @Test
    void blockFlagsCannotBeAccepted() {
        AiScanSession s = session(AiScanSession.OPEN);
        doneLoad(1, load(2).labels(0, 1).flag("PAIR_SHIFT_DETECTED", "BLOCK", 1).result());
        assertThatThrownBy(() -> service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_LOAD_FLAG").loadNo(1).code("PAIR_SHIFT_DETECTED").build()))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY));
    }

    @Test
    void acceptingFrontOrderUncertainPinsTheCurrentDirection() {
        AiScanSession s = session(AiScanSession.OPEN);
        doneLoad(1, load(3).labels(0, 2).evidence(true, true).result());
        assertThat(plans.load(s).plan().sessionFlag(ScanPlanner.FRONT_ORDER_UNCERTAIN)).isNotNull();

        ScanStationDtos.SessionDto dto = service.decide(s, ScanStationDtos.DecisionRequest.builder()
                .action("ACCEPT_LOAD_FLAG").code(ScanPlanner.FRONT_ORDER_UNCERTAIN).build());
        assertThat(dto.getFrontsDirection()).isEqualTo(ScanPlanner.FORWARD);
        assertThat(dto.getSessionFlags()).isEmpty();
        assertThat(dto.getVerdict()).isEqualTo(ScanPlanner.VERDICT_READY);
    }

    // ------------------------------------------------------------ build/reopen

    @Test
    void buildIsRefusedUnlessReady() {
        AiScanSession s = session(AiScanSession.OPEN);
        doneLoad(1, load(2).labels(0, 1).flag("DPI_LOW", "REVIEW", null).result());
        assertThatThrownBy(() -> service.build(s))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT));
        assertThat(s.getStatus()).isEqualTo(AiScanSession.OPEN);
        verify(runner, never()).kickBuild(anyString());
    }

    @Test
    void buildMovesAReadySessionToBuildingAndKicks() {
        AiScanSession s = session(AiScanSession.FAILED);
        s.setBuiltJson("[]");
        doneLoad(1, load(2).labels(0, 1).result());
        service.build(s);
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILDING);
        assertThat(s.getBuiltJson()).isNull();
        verify(runner).kickBuild("sess-1");
    }

    @Test
    void reopenClearsTheBuild() {
        AiScanSession s = builtSession();
        service.reopen(s);
        assertThat(s.getStatus()).isEqualTo(AiScanSession.OPEN);
        assertThat(s.getBuiltJson()).isNull();
        assertThat(s.getBuildFingerprint()).isNull();
    }

    // ------------------------------------------------------------------ start

    @Test
    void startRefusesWhenThePlanDriftedFromTheBuild() {
        AiScanSession s = builtSession();
        s.setBuildFingerprint("something-else");
        assertThatThrownBy(() -> service.start(admin, s, null))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.CONFLICT));
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILT);
        verify(copyIntake, never()).start(any(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void startHandsTheBuiltCopiesToTheIntakeAsScanInPhysicalOrder() {
        AiScanSession s = builtSession();
        AiCopyIntakeBatch batch = AiCopyIntakeBatch.builder().id("batch-9").source(AiCopyIntakeBatch.SOURCE_SCAN).build();
        when(copyIntake.start(any(), anyString(), anyString(), any(), anyString())).thenReturn(batch);
        when(copyIntake.toDto(batch, false)).thenReturn(CopyIntakeDtos.BatchDto.builder().id("batch-9").build());

        ScanStationDtos.StartResponse out = service.start(admin, s, ScanStationDtos.StartRequest.builder()
                .notifyEmail(false).commentPlacement("INSIDE").build());

        ArgumentCaptor<CopyIntakeDtos.StartRequest> req = ArgumentCaptor.forClass(CopyIntakeDtos.StartRequest.class);
        verify(copyIntake).start(eq(admin), eq("a-1"), eq("inst-1"), req.capture(), eq(AiCopyIntakeBatch.SOURCE_SCAN));
        assertThat(req.getValue().getFiles()).extracting(CopyIntakeDtos.UploadedFile::getFileId)
                .containsExactly("pdf-1", "pdf-2", "pdf-3");
        assertThat(req.getValue().getFiles()).extracting(CopyIntakeDtos.UploadedFile::getFileName)
                .containsExactly("Load 1 copy 1", "Load 1 copy 2", "Load 1 copy 3");
        // copies of sheets [0], [1, 2] and [3]: the built page counts, in pile order
        assertThat(req.getValue().getFiles()).extracting(CopyIntakeDtos.UploadedFile::getPageCount)
                .containsExactly(2, 4, 2);
        assertThat(req.getValue().getMapStudents()).isTrue();
        assertThat(req.getValue().getNotifyEmail()).isFalse();
        assertThat(req.getValue().getCommentPlacement()).isEqualTo("INSIDE");

        assertThat(s.getStatus()).isEqualTo(AiScanSession.STARTED);
        assertThat(s.getIntakeBatchId()).isEqualTo("batch-9");
        verify(copyIntakeRunner).run("batch-9");
        verify(audit).record(eq(admin), eq("inst-1"), eq("SCAN_STATION_START"), eq("a-1"), anyString(), any());
        assertThat(out.getBatch().getId()).isEqualTo("batch-9");
        assertThat(out.getSession().getIntakeBatchId()).isEqualTo("batch-9");
    }

    @Test
    void startIsIdempotentOnceStarted() {
        AiScanSession s = builtSession();
        s.setStatus(AiScanSession.STARTED);
        s.setIntakeBatchId("batch-9");
        AiCopyIntakeBatch batch = AiCopyIntakeBatch.builder().id("batch-9").build();
        when(copyIntake.getBatch("batch-9")).thenReturn(Optional.of(batch));
        when(copyIntake.toDto(batch, false)).thenReturn(CopyIntakeDtos.BatchDto.builder().id("batch-9").build());

        ScanStationDtos.StartResponse out = service.start(admin, s, null);

        assertThat(out.getBatch().getId()).isEqualTo("batch-9");
        verify(copyIntake, never()).start(any(), anyString(), anyString(), any(), anyString());
        verify(copyIntakeRunner, never()).run(anyString());
    }

    @Test
    void startRevertsToBuiltWhenTheIntakeRefuses() {
        AiScanSession s = builtSession();
        when(copyIntake.start(any(), anyString(), anyString(), any(), anyString()))
                .thenThrow(new VacademyException(HttpStatus.PAYMENT_REQUIRED, "Not enough credits"));

        assertThatThrownBy(() -> service.start(admin, s, null)).hasMessage("Not enough credits");

        verify(sessions).transition("sess-1", AiScanSession.STARTING, AiScanSession.BUILT);
        assertThat(s.getStatus()).isEqualTo(AiScanSession.BUILT);
        verify(copyIntakeRunner, never()).run(anyString());
    }

    @Test
    void mapStudentsFalseIsPassedThroughSoTheBatchIsCheckOnly() {
        AiScanSession s = builtSession();
        AiCopyIntakeBatch batch = AiCopyIntakeBatch.builder().id("batch-9")
                .source(AiCopyIntakeBatch.SOURCE_CHECK_ONLY).build();
        when(copyIntake.start(any(), anyString(), anyString(), any(), anyString())).thenReturn(batch);

        service.start(admin, s, ScanStationDtos.StartRequest.builder().mapStudents(false).build());

        ArgumentCaptor<CopyIntakeDtos.StartRequest> req = ArgumentCaptor.forClass(CopyIntakeDtos.StartRequest.class);
        verify(copyIntake).start(any(), anyString(), anyString(), req.capture(), eq(AiCopyIntakeBatch.SOURCE_SCAN));
        assertThat(req.getValue().getMapStudents()).isFalse();
    }

    @Test
    void sessionOfAnotherInstituteOrAssessmentIsNotFound() {
        session(AiScanSession.OPEN);
        assertThatThrownBy(() -> service.requireSession("sess-1", "inst-2", null))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.NOT_FOUND));
        assertThatThrownBy(() -> service.requireSession("sess-1", "inst-1", "a-2"))
                .satisfies(e -> assertThat(status(e)).isEqualTo(HttpStatus.NOT_FOUND));
        assertThat(service.requireSession("sess-1", "inst-1", "a-1").getId()).isEqualTo("sess-1");
    }
}
