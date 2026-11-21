package vacademy.io.assessment_service.features.assessment.copy_intake.scan.service;

import com.fasterxml.jackson.core.type.TypeReference;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.dto.CopyIntakeDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.config.ScanStationProperties;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos.DecisionRequest;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos.LoadDecisions;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos.LoadRequest;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanLoad;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanLoadRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanSessionRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeRunner;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The scan station's state machine (contract C3). Sessions and loads are the
 * only stored state; the copies, flags and verdict come from {@link ScanPlanner}
 * on every read. Loads and decisions change only while the session is OPEN;
 * Build needs a READY verdict; Start needs the plan to still be exactly what
 * was built, and hands the PDFs to the existing bulk copy intake as source SCAN.
 *
 * <p>Errors carry their HTTP status: 404 for anything outside the caller's
 * institute and assessment, 409 for a step the session's state does not allow,
 * 422 for a request that cannot be right (the message starts with a code), 403
 * for a file the institute did not upload.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ScanStationService {

    public static final int MAX_LOADS = 40;
    public static final int MAX_PAGES_PER_PASS = 100;
    public static final int MAX_COPIES = 500;

    private static final Set<String> KINDS = Set.of("IMAGE", "PDF");

    private final ScanStationProperties properties;
    private final AiScanSessionRepository sessionRepository;
    private final AiScanLoadRepository loadRepository;
    private final ScanPlanLoader plans;
    private final ScanStationRunner runner;
    private final InstituteFileOwnership fileOwnership;
    private final CopyIntakeService copyIntakeService;
    private final CopyIntakeRunner copyIntakeRunner;
    private final AssessmentAuditClient auditClient;
    private final TransactionTemplate tx;

    // ---------------------------------------------------------------- reads

    public ScanStationDtos.ConfigDto config(String instituteId) {
        return ScanStationDtos.ConfigDto.builder().enabled(properties.isOn(instituteId))
                .maxLoads(MAX_LOADS).maxPagesPerPass(MAX_PAGES_PER_PASS).maxCopies(MAX_COPIES).build();
    }

    /** The session, if it belongs to this institute (and assessment, when one is named); 404 otherwise. */
    public AiScanSession requireSession(String sessionId, String instituteId, String assessmentId) {
        AiScanSession s = sessionRepository.findById(sessionId).orElse(null);
        if (s == null || !s.getInstituteId().equals(instituteId)
                || (StringUtils.hasText(assessmentId) && !s.getAssessmentId().equals(assessmentId))) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Scan session not found");
        }
        return s;
    }

    public ScanStationDtos.SessionDto getSession(AiScanSession session) {
        AiScanSession fresh = sessionRepository.findById(session.getId()).orElse(session);
        return toDto(plans.load(fresh));
    }

    public List<ScanStationDtos.SessionSummaryDto> listSessions(String assessmentId, String instituteId) {
        List<ScanStationDtos.SessionSummaryDto> out = new ArrayList<>();
        for (AiScanSession s : sessionRepository
                .findTop10ByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(assessmentId, instituteId)) {
            ScanPlanner.Plan plan = plans.load(s).plan();
            out.add(ScanStationDtos.SessionSummaryDto.builder().id(s.getId()).status(s.getStatus())
                    .verdict(plan.verdict()).createdAt(s.getCreatedAt()).loads(plan.totals().loads())
                    .copies(plan.totals().copies()).intakeBatchId(s.getIntakeBatchId()).build());
        }
        return out;
    }

    // ------------------------------------------------------------- sessions

    public ScanStationDtos.SessionDto createSession(CustomUserDetails user, String assessmentId, String instituteId) {
        AiScanSession s = sessionRepository.save(AiScanSession.builder()
                .assessmentId(assessmentId).instituteId(instituteId)
                .createdByUserId(user == null ? null : user.getUserId())
                .createdByName(user == null ? null : user.getFullName())
                .status(AiScanSession.OPEN).build());
        return toDto(plans.load(s));
    }

    // ---------------------------------------------------------------- loads

    public ScanStationDtos.SessionDto addLoad(AiScanSession session, LoadRequest request) {
        validate(session, request);
        String loadId = tx.execute(st -> {
            AiScanSession s = requireOpen(session.getId());
            List<AiScanLoad> all = loadRepository.findBySessionIdOrderByLoadNo(s.getId());
            long live = all.stream().filter(AiScanLoad::isLive).count();
            if (live >= MAX_LOADS) {
                throw unprocessable("TOO_MANY_LOADS", "At most " + MAX_LOADS + " loads in one session");
            }
            int next = all.stream().mapToInt(AiScanLoad::getLoadNo).max().orElse(0) + 1;
            AiScanLoad l = loadRepository.save(AiScanLoad.builder().sessionId(s.getId()).loadNo(next)
                    .status(AiScanLoad.PENDING).passesJson(plans.write(request)).attempts(0).build());
            touch(s);
            return l.getId();
        });
        runner.kickLoad(loadId);
        return getSession(session);
    }

    /** A rescan: the load gets the new files, is read again from scratch, and loses its decisions. */
    public ScanStationDtos.SessionDto replaceLoad(AiScanSession session, int loadNo, LoadRequest request) {
        validate(session, request);
        String loadId = tx.execute(st -> {
            AiScanSession s = requireOpen(session.getId());
            AiScanLoad l = requireLiveLoad(s.getId(), loadNo);
            l.setPassesJson(plans.write(request));
            l.setStatus(AiScanLoad.PENDING);
            l.setAttempts(0);
            l.setResultJson(null);
            l.setDecisionsJson(null);
            l.setErrorMessage(null);
            l.setClaimedAt(null);
            loadRepository.save(l);
            touch(s);
            return l.getId();
        });
        runner.kickLoad(loadId);
        return getSession(session);
    }

    public ScanStationDtos.SessionDto removeLoad(AiScanSession session, int loadNo) {
        tx.execute(st -> {
            AiScanSession s = requireOpen(session.getId());
            AiScanLoad l = requireLiveLoad(s.getId(), loadNo);
            l.setStatus(AiScanLoad.REMOVED);
            loadRepository.save(l);
            touch(s);
            return null;
        });
        return getSession(session);
    }

    private void validate(AiScanSession session, LoadRequest request) {
        if (request == null || request.getPasses() == null || request.getPasses().size() != 2) {
            throw unprocessable("BAD_LOAD", "A load has exactly two passes");
        }
        Set<Integer> passNos = new HashSet<>();
        Set<String> fileIds = new HashSet<>();
        int[] pages = new int[2];
        int i = 0;
        for (ScanStationDtos.Pass p : request.getPasses()) {
            if (p == null || p.getPassNo() == null || (p.getPassNo() != 1 && p.getPassNo() != 2)
                    || !passNos.add(p.getPassNo())) {
                throw unprocessable("BAD_LOAD", "The passes must be numbered 1 and 2");
            }
            if (p.getFiles() == null || p.getFiles().isEmpty()) {
                throw unprocessable("EMPTY_PASS", "Pass " + p.getPassNo() + " has no files");
            }
            int n = 0;
            for (ScanStationDtos.PassFile f : p.getFiles()) {
                if (f == null || !StringUtils.hasText(f.getFileId()) || !fileIds.add(f.getFileId())) {
                    throw unprocessable("DUPLICATE_FILE", "Every file must be named once");
                }
                String kind = f.getKind() == null ? "" : f.getKind().toUpperCase(Locale.ROOT);
                if (!KINDS.contains(kind)) {
                    throw unprocessable("UNSUPPORTED_FILE", "Only JPEG/PNG images and PDFs can be scanned in");
                }
                f.setKind(kind);
                int count = f.getPageCount() == null ? ("IMAGE".equals(kind) ? 1 : 0) : f.getPageCount();
                if (count < 1 || ("IMAGE".equals(kind) && count != 1)) {
                    throw unprocessable("BAD_PAGE_COUNT", "Every file needs its page count");
                }
                f.setPageCount(count);
                n += count;
            }
            if (n > MAX_PAGES_PER_PASS) {
                throw unprocessable("LOAD_TOO_LARGE", "Pass " + p.getPassNo() + " has " + n
                        + " pages; at most " + MAX_PAGES_PER_PASS);
            }
            pages[i++] = n;
        }
        if (pages[0] != pages[1]) {
            throw unprocessable("COUNT_MISMATCH", "One pass has " + pages[0] + " pages and the other " + pages[1]
                    + "; a sheet was pulled in twice or skipped. Rescan this load.");
        }
        List<String> foreign = fileOwnership.notOwnedBy(session.getInstituteId(), new ArrayList<>(fileIds));
        if (!foreign.isEmpty()) {
            log.warn("[scan-station] refused {} file(s) not recorded for institute {} on session {}",
                    foreign.size(), session.getInstituteId(), session.getId());
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "FOREIGN_FILE: some files were not uploaded for this institute; upload them again from this page");
        }
    }

    // ------------------------------------------------------------- decisions

    public ScanStationDtos.SessionDto decide(AiScanSession session, DecisionRequest request) {
        if (request == null || !StringUtils.hasText(request.getAction())) {
            throw unprocessable("BAD_DECISION", "Name the action");
        }
        for (int attempt = 0; ; attempt++) {
            try {
                tx.execute(st -> {
                    apply(session.getId(), request);
                    return null;
                });
                break;
            } catch (OptimisticLockingFailureException e) {
                // Someone else decided at the same moment: re-plan on their change and apply once more.
                if (attempt >= 1) {
                    throw new VacademyException(HttpStatus.CONFLICT, "The session changed at the same time; try again");
                }
            }
        }
        return getSession(session);
    }

    private void apply(String sessionId, DecisionRequest r) {
        AiScanSession s = requireOpen(sessionId);
        ScanPlanLoader.Loaded loaded = plans.load(s);
        ScanPlanner.Plan plan = loaded.plan();
        String action = r.getAction().trim().toUpperCase(Locale.ROOT);

        if ("SET_FRONTS_DIRECTION".equals(action)) {
            String value = r.getValue() == null ? "" : r.getValue().trim().toUpperCase(Locale.ROOT);
            if (!ScanPlanner.FORWARD.equals(value) && !ScanPlanner.REVERSED.equals(value)) {
                throw unprocessable("BAD_DECISION", "The fronts direction is FORWARD or REVERSED");
            }
            setDirection(s, loaded, value);
            // Every copy can change with the direction, so no accept survives it.
            for (AiScanLoad l : loaded.liveLoads()) {
                LoadDecisions d = loaded.decisions().get(l.getLoadNo());
                if (d != null && !d.getAccepted().isEmpty()) {
                    d.getAccepted().clear();
                    saveDecisions(l, d);
                }
            }
            touch(s);
            return;
        }
        if ("ACCEPT_LOAD_FLAG".equals(action) && (r.getLoadNo() == null
                || ScanPlanner.FRONT_ORDER_UNCERTAIN.equals(r.getCode()))) {
            ScanPlanner.Flag f = r.getCode() == null ? null : plan.sessionFlag(r.getCode());
            if (f == null) throw unprocessable("NO_SUCH_FLAG", "That flag is not on this session");
            if (!ScanPlanner.FRONT_ORDER_UNCERTAIN.equals(f.code())) {
                throw unprocessable("NOT_ACCEPTABLE", "This problem cannot be accepted; fix it instead");
            }
            // Accepting the guess fixes it: the copies stay exactly as they are now.
            setDirection(s, loaded, plan.direction());
            touch(s);
            return;
        }

        int loadNo = requireValue(r.getLoadNo(), "load_no");
        AiScanLoad load = loaded.load(loadNo);
        if (load == null) throw new VacademyException(HttpStatus.NOT_FOUND, "Load not found");
        LoadDecisions d = loaded.decisions().get(loadNo);
        ScanAnalysis.Result result = loaded.results().get(loadNo);

        switch (action) {
            case "ACCEPT_LOAD_FLAG" -> {
                ScanPlanner.Flag f = pickLoadFlag(plan, loadNo, r);
                if (!ScanPlanner.REVIEW.equals(f.severity())) {
                    throw unprocessable("NOT_ACCEPTABLE", "This problem cannot be accepted; rescan the load");
                }
                requireSeen(r, f.fingerprint());
                // Keyed by fingerprint: a second flag with the same code is its own accept.
                d.getAcceptedFlags().put(f.fingerprint(), f.code());
            }
            case "ACCEPT_COPY", "EXCLUDE_COPY", "INCLUDE_COPY", "MERGE_WITH_PREVIOUS" -> {
                int sheetNo = requireValue(r.getSheetNo(), "sheet_no");
                ScanPlanner.Copy copy = plan.copyAt(loadNo, sheetNo);
                if (copy == null) throw unprocessable("NO_SUCH_COPY", "No copy starts at that sheet");
                String key = String.valueOf(sheetNo);
                switch (action) {
                    case "ACCEPT_COPY" -> {
                        if (copy.excluded()) throw unprocessable("COPY_EXCLUDED", "Put the copy back first");
                        requireSeen(r, copy.fingerprint());
                        d.getAccepted().put(key, copy.fingerprint());
                    }
                    case "EXCLUDE_COPY" -> {
                        if (!d.getExcluded().contains(sheetNo)) d.getExcluded().add(sheetNo);
                        d.getAccepted().remove(key);
                    }
                    case "INCLUDE_COPY" -> d.getExcluded().remove(Integer.valueOf(sheetNo));
                    default -> {
                        d.getStartOverrides().put(key, false);
                        d.getAccepted().remove(key);
                    }
                }
            }
            case "SPLIT_BEFORE_SHEET", "CLEAR_SHEET" -> {
                int sheetNo = requireValue(r.getSheetNo(), "sheet_no");
                if (sheet(result, sheetNo) == null) throw unprocessable("NO_SUCH_SHEET", "That sheet is not in this load");
                if ("SPLIT_BEFORE_SHEET".equals(action)) d.getStartOverrides().put(String.valueOf(sheetNo), true);
                else d.getStartOverrides().remove(String.valueOf(sheetNo));
            }
            case "KEEP_PAGE", "DROP_PAGE" -> {
                String ref = r.getRef();
                if (!StringUtils.hasText(ref) || result == null || result.getPages() == null
                        || result.getPages().stream().noneMatch(p -> p != null && ref.equals(p.getRef()))) {
                    throw unprocessable("NO_SUCH_PAGE", "That page is not in this load");
                }
                if ("DROP_PAGE".equals(action) && result.getSheets() != null && result.getSheets().stream()
                        .anyMatch(sh -> sh != null && ref.equals(sh.getFront()) && Boolean.TRUE.equals(sh.getLabelPresent()))) {
                    throw unprocessable("LABELLED_FRONT", "A front with a name label cannot be left out");
                }
                d.getPageOverrides().put(ref, "DROP_PAGE".equals(action) ? ScanPlanner.DROP : ScanPlanner.KEEP);
            }
            default -> throw unprocessable("BAD_DECISION", "Unknown action " + action);
        }
        saveDecisions(load, d);
        touch(s);
    }

    /**
     * The load flag an ACCEPT_LOAD_FLAG names: by code, and among several with that
     * code by expected_fingerprint. A fingerprint that matches none of them means
     * the flag changed while the clerk looked (409 PLAN_CHANGED).
     */
    private static ScanPlanner.Flag pickLoadFlag(ScanPlanner.Plan plan, int loadNo, DecisionRequest r) {
        List<ScanPlanner.Flag> withCode = plan.loadFlags(loadNo, r.getCode());
        if (withCode.isEmpty()) throw unprocessable("NO_SUCH_FLAG", "That flag is not on this load");
        String expected = r.getExpectedFingerprint();
        if (StringUtils.hasText(expected)) {
            for (ScanPlanner.Flag f : withCode) {
                if (expected.equals(f.fingerprint())) return f;
            }
            throw new VacademyException(HttpStatus.CONFLICT,
                    "PLAN_CHANGED: this changed while you were looking at it; check it again");
        }
        if (withCode.size() > 1) {
            throw unprocessable("AMBIGUOUS_FLAG", "This load has " + withCode.size()
                    + " problems of this kind; send expected_fingerprint to say which one");
        }
        return withCode.get(0);
    }

    /**
     * An accept is for what the clerk saw. When the screen sends the fingerprint it
     * showed and the copy or flag has changed since (a load finished reading and
     * joined it, a new review reason appeared), refuse instead of accepting unseen.
     */
    private static void requireSeen(DecisionRequest r, String current) {
        String expected = r.getExpectedFingerprint();
        if (StringUtils.hasText(expected) && !expected.equals(current)) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "PLAN_CHANGED: this changed while you were looking at it; check it again");
        }
    }

    private void setDirection(AiScanSession s, ScanPlanLoader.Loaded loaded, String direction) {
        ScanStationDtos.SessionDecisions sd = loaded.sessionDecisions();
        sd.setFrontsDirection(direction);
        s.setDecisionsJson(plans.write(sd));
    }

    private void saveDecisions(AiScanLoad l, LoadDecisions d) {
        l.setDecisionsJson(plans.write(d));
        loadRepository.save(l);
    }

    private static ScanAnalysis.Sheet sheet(ScanAnalysis.Result r, int sheetNo) {
        if (r == null || r.getSheets() == null) return null;
        for (ScanAnalysis.Sheet s : r.getSheets()) {
            if (s != null && s.getSheetNo() != null && s.getSheetNo() == sheetNo) return s;
        }
        return null;
    }

    // ------------------------------------------------------- build / reopen

    public ScanStationDtos.SessionDto build(AiScanSession session) {
        String id = session.getId();
        try {
            tx.execute(st -> {
                AiScanSession s = sessionRepository.findById(id)
                        .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Scan session not found"));
                if (!AiScanSession.OPEN.equals(s.getStatus()) && !AiScanSession.FAILED.equals(s.getStatus())) {
                    throw new VacademyException(HttpStatus.CONFLICT, "The copies are already being made or were made");
                }
                ScanPlanner.Plan plan = plans.load(s).plan();
                if (!ScanPlanner.VERDICT_READY.equals(plan.verdict())) {
                    throw new VacademyException(HttpStatus.CONFLICT, "NOT_READY: the session is " + plan.verdict());
                }
                s.setStatus(AiScanSession.BUILDING);
                s.setBuiltJson(null);
                s.setBuildFingerprint(null);
                s.setErrorMessage(null);
                sessionRepository.save(s);
                return null;
            });
        } catch (OptimisticLockingFailureException e) {
            throw new VacademyException(HttpStatus.CONFLICT, "The session changed at the same time; try again");
        }
        runner.kickBuild(id);
        return getSession(session);
    }

    /** Change something after the copies were made (or failed): back to OPEN; the copies are made again later. */
    public ScanStationDtos.SessionDto reopen(AiScanSession session) {
        try {
            tx.execute(st -> {
                AiScanSession s = sessionRepository.findById(session.getId())
                        .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Scan session not found"));
                if (!AiScanSession.BUILT.equals(s.getStatus()) && !AiScanSession.FAILED.equals(s.getStatus())) {
                    throw new VacademyException(HttpStatus.CONFLICT, "Only made or failed copies can be changed");
                }
                s.setStatus(AiScanSession.OPEN);
                s.setBuiltJson(null);
                s.setBuildFingerprint(null);
                s.setErrorMessage(null);
                sessionRepository.save(s);
                return null;
            });
        } catch (OptimisticLockingFailureException e) {
            throw new VacademyException(HttpStatus.CONFLICT, "The session changed at the same time; try again");
        }
        return getSession(session);
    }

    // ----------------------------------------------------------------- start

    public ScanStationDtos.StartResponse start(CustomUserDetails user, AiScanSession session,
                                               ScanStationDtos.StartRequest request) {
        AiScanSession s = sessionRepository.findById(session.getId()).orElse(session);
        if (AiScanSession.STARTED.equals(s.getStatus())) return started(s);
        if (!AiScanSession.BUILT.equals(s.getStatus())) {
            throw new VacademyException(HttpStatus.CONFLICT, "Make the copies first");
        }
        ScanPlanner.Plan plan = plans.load(s).plan();
        List<ScanStationDtos.BuiltEntry> built = builtEntries(s);
        if (!ScanPlanner.VERDICT_READY.equals(plan.verdict()) || !plan.fingerprint().equals(s.getBuildFingerprint())
                || built.size() != plan.buildList().size()) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "PLAN_CHANGED: the copies changed after they were made; make them again");
        }
        if (sessionRepository.transition(s.getId(), AiScanSession.BUILT, AiScanSession.STARTING) != 1) {
            AiScanSession now = sessionRepository.findById(s.getId()).orElse(s);
            if (AiScanSession.STARTED.equals(now.getStatus())) return started(now);
            throw new VacademyException(HttpStatus.CONFLICT, "The check is already being started");
        }

        List<CopyIntakeDtos.UploadedFile> files = new ArrayList<>();
        int pages = 0;
        for (ScanStationDtos.BuiltEntry b : built) {
            files.add(CopyIntakeDtos.UploadedFile.builder().fileId(b.getFileId()).fileName(b.getFileName())
                    .pageCount(b.getPageCount()).build());
            pages += b.getPageCount();
        }
        ScanStationDtos.StartRequest r = request == null ? new ScanStationDtos.StartRequest() : request;
        CopyIntakeDtos.StartRequest startRequest = CopyIntakeDtos.StartRequest.builder()
                .files(files).preferredModel(r.getPreferredModel()).notifyEmail(r.getNotifyEmail())
                .commentPlacement(r.getCommentPlacement()).copyCheckConfig(r.getCopyCheckConfig())
                .mapStudents(r.getMapStudents() == null || r.getMapStudents()).build();

        final AiCopyIntakeBatch batch;
        try {
            batch = copyIntakeService.start(user, s.getAssessmentId(), s.getInstituteId(), startRequest,
                    AiCopyIntakeBatch.SOURCE_SCAN);
        } catch (RuntimeException e) {
            // Credits, gradable questions, ownership: the clerk sees the same error as an upload would.
            sessionRepository.transition(s.getId(), AiScanSession.STARTING, AiScanSession.BUILT);
            throw e;
        }
        AiScanSession done = tx.execute(st -> {
            AiScanSession x = sessionRepository.findById(session.getId()).orElseThrow();
            x.setStatus(AiScanSession.STARTED);
            x.setIntakeBatchId(batch.getId());
            x.setErrorMessage(null);
            return sessionRepository.save(x);
        });
        copyIntakeRunner.run(batch.getId());
        auditClient.record(user, s.getInstituteId(), "SCAN_STATION_START", s.getAssessmentId(),
                "started AI check of " + files.size() + " scanned copies from the scan station",
                Map.of("session_id", s.getId(), "batch_id", batch.getId(), "copies", files.size(), "pages", pages,
                        "source", batch.getSource()));
        return ScanStationDtos.StartResponse.builder().session(toDto(plans.load(done)))
                .batch(copyIntakeService.toDto(batch, false)).build();
    }

    private ScanStationDtos.StartResponse started(AiScanSession s) {
        CopyIntakeDtos.BatchDto batch = s.getIntakeBatchId() == null ? null
                : copyIntakeService.getBatch(s.getIntakeBatchId()).map(b -> copyIntakeService.toDto(b, false))
                .orElse(null);
        return ScanStationDtos.StartResponse.builder().session(toDto(plans.load(s))).batch(batch).build();
    }

    private List<ScanStationDtos.BuiltEntry> builtEntries(AiScanSession s) {
        List<ScanStationDtos.BuiltEntry> b = plans.read(s.getBuiltJson(),
                new TypeReference<List<ScanStationDtos.BuiltEntry>>() { });
        return b == null ? List.of() : b;
    }

    // --------------------------------------------------------------- helpers

    private AiScanSession requireOpen(String sessionId) {
        AiScanSession s = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Scan session not found"));
        if (!AiScanSession.OPEN.equals(s.getStatus())) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "SESSION_NOT_OPEN: the copies are being made or were made; use 'Change something' first");
        }
        return s;
    }

    private AiScanLoad requireLiveLoad(String sessionId, int loadNo) {
        AiScanLoad l = loadRepository.findBySessionIdAndLoadNo(sessionId, loadNo).orElse(null);
        if (l == null || !l.isLive()) throw new VacademyException(HttpStatus.NOT_FOUND, "Load not found");
        return l;
    }

    /** Bump the session's version, so a decision and a Build racing each other cannot both win. */
    private void touch(AiScanSession s) {
        s.setUpdatedAt(new Date());
        sessionRepository.save(s);
    }

    private static int requireValue(Integer v, String name) {
        if (v == null) throw unprocessable("BAD_DECISION", name + " is required for this action");
        return v;
    }

    private static VacademyException unprocessable(String code, String message) {
        return new VacademyException(HttpStatus.UNPROCESSABLE_ENTITY, code + ": " + message);
    }

    // ------------------------------------------------------------------ DTO

    ScanStationDtos.SessionDto toDto(ScanPlanLoader.Loaded loaded) {
        AiScanSession s = loaded.session();
        ScanPlanner.Plan plan = loaded.plan();

        List<ScanStationDtos.LoadDto> loads = new ArrayList<>();
        for (AiScanLoad l : loaded.liveLoads()) {
            int n = l.getLoadNo();
            LoadRequest req = loaded.requests().get(n);
            ScanAnalysis.Result result = loaded.results().get(n);
            ScanPlanner.LoadPlan lp = plan.loads().get(n);
            Map<String, String> eff = lp == null ? Map.of() : lp.blankEffective();

            List<ScanStationDtos.PassDto> passes = new ArrayList<>();
            if (req != null && req.getPasses() != null) {
                for (ScanStationDtos.Pass p : req.getPasses()) {
                    List<ScanStationDtos.PassFileDto> files = new ArrayList<>();
                    int count = 0;
                    for (ScanStationDtos.PassFile f : p.getFiles() == null ? List.<ScanStationDtos.PassFile>of() : p.getFiles()) {
                        files.add(ScanStationDtos.PassFileDto.builder().fileId(f.getFileId())
                                .fileName(f.getFileName()).kind(f.getKind()).build());
                        count += f.getPageCount() == null ? 1 : f.getPageCount();
                    }
                    passes.add(ScanStationDtos.PassDto.builder().passNo(p.getPassNo() == null ? 0 : p.getPassNo())
                            .pageCount(count).files(files).build());
                }
            }
            List<ScanStationDtos.PageDto> pages = new ArrayList<>();
            if (result != null && result.getPages() != null) {
                for (ScanAnalysis.Page p : result.getPages()) {
                    if (p == null) continue;
                    pages.add(ScanStationDtos.PageDto.builder().ref(p.getRef()).passNo(p.getPassNo())
                            .fileId(p.getFileId()).pageIndex(p.getPageIndex()).kind(p.getKind()).dpi(p.getDpi())
                            .dpiSource(p.getDpiSource()).widthPx(p.getWidthPx()).heightPx(p.getHeightPx())
                            .inkPer10k(p.getInkPer10k()).blankClass(p.getBlankClass()).error(p.getError())
                            .blankEffective(eff.getOrDefault(p.getRef(), p.getBlankClass())).build());
                }
            }
            List<ScanStationDtos.LoadFlag> flags = new ArrayList<>();
            if (lp != null) lp.flags().forEach(f -> flags.add(loadFlag(f)));
            for (ScanPlanner.Copy c : plan.copies()) {
                for (ScanPlanner.Flag f : c.flags()) {
                    if (f.loadNo() != null && f.loadNo() == n) flags.add(loadFlag(f));
                }
            }
            loads.add(ScanStationDtos.LoadDto.builder().loadNo(n).status(l.getStatus()).attempts(l.getAttempts())
                    .errorMessage(l.getErrorMessage()).passes(passes)
                    .layout(result == null ? null : result.getLayout())
                    .pages(pages).sheets(result == null || result.getSheets() == null ? List.of() : result.getSheets())
                    .flags(flags).build());
        }

        List<ScanStationDtos.CopyDto> copies = new ArrayList<>();
        for (ScanPlanner.Copy c : plan.copies()) {
            copies.add(ScanStationDtos.CopyDto.builder().copyKey(c.copyKey()).loadNo(c.loadNo())
                    .firstSheetNo(c.firstSheetNo())
                    .sheets(c.sheets().stream().map(x -> ScanStationDtos.SheetRefDto.builder()
                            .loadNo(x.loadNo()).sheetNo(x.sheetNo()).build()).toList())
                    .pages(c.pages().stream().map(p -> ScanStationDtos.CopyPageDto.builder().loadNo(p.loadNo())
                            .ref(p.ref()).fileId(p.fileId()).pageIndex(p.pageIndex()).kind(p.kind())
                            .rotation(p.rotation()).side(p.side()).build()).toList())
                    .leftOut(c.leftOut().stream().map(p -> ScanStationDtos.LeftOutPageDto.builder().loadNo(p.loadNo())
                            .ref(p.ref()).fileId(p.fileId()).pageIndex(p.pageIndex()).kind(p.kind()).build()).toList())
                    .pageCount(c.pages().size()).nameText(c.nameText())
                    .flags(c.flags().stream().map(f -> ScanStationDtos.CopyFlag.builder().code(f.code())
                            .severity(f.severity()).sheetNo(f.sheetNo()).detail(f.detail()).build()).toList())
                    .decision(c.decision()).needsReview(c.needsReview()).fingerprint(c.fingerprint()).build());
        }

        List<ScanStationDtos.BuiltDto> built = s.getBuiltJson() == null ? null : builtEntries(s).stream()
                .map(b -> ScanStationDtos.BuiltDto.builder().copyKey(b.getCopyKey()).fileId(b.getFileId())
                        .pageCount(b.getPageCount()).build()).toList();
        ScanPlanner.Totals t = plan.totals();
        return ScanStationDtos.SessionDto.builder()
                .id(s.getId()).assessmentId(s.getAssessmentId()).status(s.getStatus()).verdict(plan.verdict())
                .verdictReasons(plan.verdictReasons().stream().map(f -> ScanStationDtos.VerdictReason.builder()
                        .code(f.code()).severity(f.severity()).loadNo(f.loadNo()).copyKey(f.copyKey()).build()).toList())
                .frontsDirection(plan.direction()).frontsDirectionSource(plan.directionSource())
                .sessionFlags(plan.sessionFlags().stream().map(f -> ScanStationDtos.SessionFlag.builder()
                        .code(f.code()).severity(f.severity()).detail(f.detail()).accepted(f.accepted()).build()).toList())
                .loads(loads).copies(copies).built(built).intakeBatchId(s.getIntakeBatchId())
                .errorMessage(s.getErrorMessage())
                .totals(ScanStationDtos.Totals.builder().loads(t.loads()).sheets(t.sheets()).pages(t.pages())
                        .copies(t.copies()).blankLeftOut(t.blankLeftOut()).excluded(t.excluded()).build())
                .build();
    }

    private static ScanStationDtos.LoadFlag loadFlag(ScanPlanner.Flag f) {
        return ScanStationDtos.LoadFlag.builder().code(f.code()).severity(f.severity()).sheetNo(f.sheetNo())
                .detail(f.detail()).accepted(f.accepted()).fingerprint(f.fingerprint()).build();
    }
}
