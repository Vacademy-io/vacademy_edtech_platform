package vacademy.io.assessment_service.features.assessment.copy_intake.scan.service;

import com.fasterxml.jackson.core.type.TypeReference;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.client.AiServiceScanClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceScanClient.ScanBusyException;
import vacademy.io.assessment_service.features.assessment.client.AiServiceScanClient.ScanDisabledException;
import vacademy.io.assessment_service.features.assessment.client.AiServiceScanClient.ScanRejectedException;
import vacademy.io.assessment_service.features.assessment.client.AiServiceScanClient.ScanRetryableException;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.config.ScanStationProperties;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanLoad;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanLoadRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanSessionRepository;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Does the scan station's slow work off the request thread, on its own pool:
 * reads each load through ai_service (analyse-load) and builds the per-student
 * PDFs (build). Both ai calls are synchronous and can take minutes.
 *
 * <p>Every step is claimed with a conditional status change, so two pods or a
 * sweep overlapping a kick never do the same work twice; this pod also keeps
 * the keys it has queued, so the sweep does not stack duplicates.
 *
 * <p>A busy ai_service (429) is not the load's fault: an analysis gives the
 * attempt back and waits for the sweep; a build waits at least the Retry-After
 * between tries, and if ai_service stays busy it parks the session (still
 * BUILDING, {@link #BUSY_MESSAGE}) for the sweep instead of failing it.
 *
 * <p>A load ai_service refuses because its reader is switched off (404) is not
 * the load's fault either: it stays PENDING with {@link #AI_OFF_MESSAGE}, spends
 * no attempt, and is offered again only every {@link #AI_OFF_RETRY_MS} (sooner
 * once another load on this pod has been read), with one warning per parking,
 * so a switched-off reader costs one call per load every few minutes instead of
 * an error line a minute; it resumes by itself once ai_service is switched on.
 *
 * <p>The sweep (every {@code sweep-ms}, idle while the station is off, and
 * reading only the rows of institutes the station is on for, so an institute
 * taken off the list costs nothing and its rows wait as they are) re-offers
 * PENDING loads, requeues loads stuck in ANALYSING, restarts builds whose
 * session stopped moving (a build stamps the session before every ai call, so
 * a live one never looks stale) or that were parked as busy, claiming each with
 * a conditional update so only one pod restarts it, and settles a STARTING
 * session a crash left behind:
 * the intake batch it made is adopted if one exists, otherwise it goes back to
 * BUILT, so a crash never makes a second batch or charges twice.
 */
@Component
@Slf4j
public class ScanStationRunner {

    static final int MAX_ATTEMPTS = 3;
    /** Longer than one ai call (300 s timeout) plus the longest pause, so a live build never looks stale. */
    static final long STALE_MS = 10 * 60 * 1000L;
    /** A build parked because ai_service was busy is resumed by the first sweep this long after. */
    static final long PARKED_RETRY_MS = 60 * 1000L;
    /** Waits between build calls answered 429; ai_service says Retry-After: 10. */
    static final long[] BUSY_WAITS_MS = { 10_000L, 20_000L, 30_000L, 30_000L, 30_000L };
    static final long RETRY_PAUSE_MS = 5_000L;
    public static final String BUSY_MESSAGE =
            "The AI service is busy; the copies will be made as soon as it is free";
    /** A PENDING load parked because ai_service's scan reader is switched off (it answered 404). */
    public static final String AI_OFF_MESSAGE =
            "The scan reader is switched off on the AI service; this load will be read once it is on";
    /** How long a load parked by {@link #AI_OFF_MESSAGE} waits before the sweep offers it again. */
    static final long AI_OFF_RETRY_MS = 5 * 60 * 1000L;
    static final int BUILD_CHUNK_COPIES = 10;
    static final int BUILD_CHUNK_PAGES = 300;
    static final String BUILD_SOURCE_ID = "ASSESSMENT_SCAN_STATION";

    private final ScanStationProperties properties;
    private final AiScanSessionRepository sessionRepository;
    private final AiScanLoadRepository loadRepository;
    private final AiCopyIntakeItemRepository itemRepository;
    private final AiServiceScanClient client;
    private final ScanMediaUrls mediaUrls;
    private final ScanPlanLoader plans;
    private final ThreadPoolTaskExecutor executor;

    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();
    /** When this pod last had a load read: ai_service is on again, so parked loads need not wait. */
    private volatile long lastReadAt = 0L;

    public ScanStationRunner(ScanStationProperties properties,
                             AiScanSessionRepository sessionRepository,
                             AiScanLoadRepository loadRepository,
                             AiCopyIntakeItemRepository itemRepository,
                             AiServiceScanClient client,
                             ScanMediaUrls mediaUrls,
                             ScanPlanLoader plans,
                             @Qualifier("scanStationExecutor") ThreadPoolTaskExecutor executor) {
        this.properties = properties;
        this.sessionRepository = sessionRepository;
        this.loadRepository = loadRepository;
        this.itemRepository = itemRepository;
        this.client = client;
        this.mediaUrls = mediaUrls;
        this.plans = plans;
        this.executor = executor;
    }

    // ------------------------------------------------------------------ kicks

    /** Queue the analysis of a PENDING load; returns at once. */
    public void kickLoad(String loadId) {
        submit("load:" + loadId, () -> analyse(loadId));
    }

    /** Queue the build of a BUILDING session; returns at once. */
    public void kickBuild(String sessionId) {
        submit("build:" + sessionId, () -> build(sessionId));
    }

    private void submit(String key, Runnable work) {
        if (!inFlight.add(key)) return;
        try {
            executor.execute(() -> {
                try {
                    work.run();
                } catch (Exception e) {
                    log.error("[scan-station] {} failed: {}", key, e.getMessage(), e);
                } finally {
                    inFlight.remove(key);
                }
            });
        } catch (RuntimeException e) {
            inFlight.remove(key);
            log.warn("[scan-station] pool full; {} will be offered again by the sweep", key);
        }
    }

    // ------------------------------------------------------------------ sweep

    @Scheduled(fixedDelayString = "${assessment.copy-intake.scan-station.sweep-ms:60000}",
            initialDelayString = "${assessment.copy-intake.scan-station.sweep-ms:60000}")
    public void sweep() {
        if (!properties.isEnabled()) return;
        boolean all = properties.isAllInstitutes();
        Set<String> listed = all ? Set.of() : properties.getInstitutes();
        if (!all && listed.isEmpty()) return;      // the list fails closed: no institute is on
        try {
            long now = System.currentTimeMillis();
            Date stale = new Date(now - STALE_MS);
            List<AiScanLoad> pending = all ? loadRepository.findByStatus(AiScanLoad.PENDING)
                    : loadRepository.findByStatusForInstitutes(AiScanLoad.PENDING, listed);
            for (AiScanLoad l : pending) {
                if (waitingForAi(l, now)) continue;
                kickLoad(l.getId());
            }
            List<AiScanLoad> stuck = all ? loadRepository.findByStatusAndClaimedAtBefore(AiScanLoad.ANALYSING, stale)
                    : loadRepository.findByStatusAndClaimedAtBeforeForInstitutes(AiScanLoad.ANALYSING, stale, listed);
            for (AiScanLoad l : stuck) {
                if (inFlight.contains("load:" + l.getId())) continue;
                // The worker that claimed it died (no ai call outlives the 300 s timeout).
                if (loadRepository.transition(l.getId(), AiScanLoad.ANALYSING, AiScanLoad.PENDING) == 1) {
                    log.info("[scan-station] load {} was stuck analysing; queued again", l.getId());
                    kickLoad(l.getId());
                }
            }
            for (AiScanSession s : sessions(AiScanSession.BUILDING, null, stale, all, listed)) {
                resumeBuild(s, stale);
            }
            Date parked = new Date(now - PARKED_RETRY_MS);
            for (AiScanSession s : sessions(AiScanSession.BUILDING, BUSY_MESSAGE, parked, all, listed)) {
                resumeBuild(s, parked);
            }
            for (AiScanSession s : sessions(AiScanSession.STARTING, null, stale, all, listed)) {
                recoverStarting(s);
            }
        } catch (Exception e) {
            log.warn("[scan-station] sweep failed: {}", e.getMessage());
        }
    }

    /** Sessions in {@code status} last stamped before {@code before}, of the institutes the station is on for. */
    private List<AiScanSession> sessions(String status, String errorMessage, Date before, boolean all,
                                         Set<String> listed) {
        List<AiScanSession> rows;
        if (errorMessage == null) {
            rows = all ? sessionRepository.findByStatusAndUpdatedAtBefore(status, before)
                    : sessionRepository.findByStatusAndInstituteIdInAndUpdatedAtBefore(status, listed, before);
        } else {
            rows = all ? sessionRepository.findByStatusAndErrorMessageAndUpdatedAtBefore(status, errorMessage, before)
                    : sessionRepository.findByStatusAndErrorMessageAndInstituteIdInAndUpdatedAtBefore(status,
                    errorMessage, listed, before);
        }
        return rows.stream().filter(s -> properties.isOn(s.getInstituteId())).toList();
    }

    /**
     * Parked because ai_service's reader was switched off, recently, and no load
     * has been read on this pod since: not offered again yet.
     */
    private boolean waitingForAi(AiScanLoad l, long now) {
        if (!AI_OFF_MESSAGE.equals(l.getErrorMessage()) || l.getUpdatedAt() == null) return false;
        long parkedAt = l.getUpdatedAt().getTime();
        return now - parkedAt < AI_OFF_RETRY_MS && parkedAt > lastReadAt;
    }

    /**
     * Restart a build nobody is working on. The claim (a conditional stamp of
     * updated_at) succeeds on one pod only, so two sweeps never start the same
     * build twice.
     */
    private void resumeBuild(AiScanSession s, Date before) {
        if (inFlight.contains("build:" + s.getId())) return;
        if (sessionRepository.claimBuild(s.getId(), AiScanSession.BUILDING, before) == 1) {
            log.info("[scan-station] session {}: build resumed", s.getId());
            kickBuild(s.getId());
        }
    }

    /**
     * A session left STARTING by a crash. If the intake batch was made (its
     * items carry the built file ids), adopt it; otherwise back to BUILT so the
     * clerk can start again. Never starts a batch itself.
     */
    void recoverStarting(AiScanSession s) {
        List<ScanStationDtos.BuiltEntry> built = builtEntries(s);
        List<String> fileIds = built.stream().map(ScanStationDtos.BuiltEntry::getFileId)
                .filter(id -> id != null && !id.isBlank()).toList();
        Optional<AiCopyIntakeItem> item = fileIds.isEmpty() ? Optional.empty()
                : itemRepository.findFirstByFileIdIn(fileIds);
        try {
            if (item.isPresent()) {
                s.setStatus(AiScanSession.STARTED);
                s.setIntakeBatchId(item.get().getBatchId());
                s.setErrorMessage(null);
                sessionRepository.save(s);
                log.info("[scan-station] session {} adopted intake batch {} after a crash", s.getId(),
                        item.get().getBatchId());
            } else if (sessionRepository.transition(s.getId(), AiScanSession.STARTING, AiScanSession.BUILT) == 1) {
                log.info("[scan-station] session {} was stuck starting with no batch; back to BUILT", s.getId());
            }
        } catch (OptimisticLockingFailureException e) {
            log.info("[scan-station] session {} changed while recovering; left as it is", s.getId());
        }
    }

    // --------------------------------------------------------------- analyse

    void analyse(String loadId) {
        AiScanLoad load = loadRepository.findById(loadId).orElse(null);
        if (load == null || !AiScanLoad.PENDING.equals(load.getStatus())) return;
        AiScanSession session = sessionRepository.findById(load.getSessionId()).orElse(null);
        if (session == null || !properties.isOn(session.getInstituteId())) return;
        if (load.getAttempts() >= MAX_ATTEMPTS) {
            finish(load, AiScanLoad.FAILED, null, "This load could not be read after " + MAX_ATTEMPTS
                    + " tries; rescan it or try again later");
            return;
        }
        if (loadRepository.claim(loadId, AiScanLoad.PENDING, AiScanLoad.ANALYSING, new Date()) != 1) return;
        load = loadRepository.findById(loadId).orElse(null);
        if (load == null) return;
        boolean wasWaitingForAi = AI_OFF_MESSAGE.equals(load.getErrorMessage());

        ScanStationDtos.LoadRequest req = plans.read(load.getPassesJson(), ScanStationDtos.LoadRequest.class);
        if (req == null || req.getPasses() == null) {
            finish(load, AiScanLoad.FAILED, null, "The load's file list is unreadable; add the load again");
            return;
        }
        List<ScanAnalysis.PassRef> passes = new ArrayList<>();
        List<ScanStationDtos.Pass> sortedPasses = new ArrayList<>(req.getPasses());
        sortedPasses.sort(Comparator.comparing(p -> p.getPassNo() == null ? 0 : p.getPassNo()));
        for (ScanStationDtos.Pass p : sortedPasses) {
            List<ScanStationDtos.PassFile> files = new ArrayList<>(p.getFiles() == null ? List.of() : p.getFiles());
            files.sort(Comparator.comparing(f -> f.getOrderIndex() == null ? 0 : f.getOrderIndex()));
            List<ScanAnalysis.FileRef> refs = new ArrayList<>();
            for (ScanStationDtos.PassFile f : files) {
                String url = mediaUrls.url(f.getFileId());
                if (url == null) {
                    retryLater(load, "Could not reach the media service; trying again shortly");
                    return;
                }
                refs.add(ScanAnalysis.FileRef.builder().fileId(f.getFileId()).url(url).kind(f.getKind())
                        .name(f.getFileName()).build());
            }
            passes.add(ScanAnalysis.PassRef.builder().passNo(p.getPassNo()).files(refs).build());
        }
        ScanAnalysis.AnalyseRequest request = ScanAnalysis.AnalyseRequest.builder()
                .instituteId(session.getInstituteId()).sessionId(session.getId()).loadNo(load.getLoadNo())
                .preferredModel(null).passes(passes).oneSided(req.isOneSided()).build();
        try {
            AiServiceScanClient.Analysed answer = client.analyseLoad(request);
            lastReadAt = System.currentTimeMillis();
            if (wasWaitingForAi) log.info("[scan-station] load {}: the AI service's reader is on again", loadId);
            finish(load, AiScanLoad.DONE, answer.json(), null);
        } catch (ScanDisabledException e) {
            // Switched off on ai_service: nothing is wrong with the load. Do not spend an attempt;
            // park it (PENDING, AI_OFF_MESSAGE) so the sweep asks again only every AI_OFF_RETRY_MS.
            if (wasWaitingForAi) {
                log.debug("[scan-station] load {}: the AI service's reader is still switched off", loadId);
            } else {
                log.warn("[scan-station] load {}: {}; parked, asking again every {} min", loadId, e.getMessage(),
                        AI_OFF_RETRY_MS / 60_000);
            }
            load.setAttempts(Math.max(0, load.getAttempts() - 1));
            retryLater(load, AI_OFF_MESSAGE);
        } catch (ScanBusyException e) {
            // Every reader slot was taken: not the load's fault either. The sweep offers it
            // again (every sweep-ms, well past Retry-After) without spending an attempt.
            log.info("[scan-station] load {}: {}", loadId, e.getMessage());
            load.setAttempts(Math.max(0, load.getAttempts() - 1));
            retryLater(load, "The AI service is busy; this load will be read shortly");
        } catch (ScanRejectedException e) {
            log.warn("[scan-station] load {} refused: {}", loadId, e.getMessage());
            finish(load, AiScanLoad.FAILED, null, "The AI service could not read this load ("
                    + e.getStatus() + "); rescan it");
        } catch (ScanRetryableException e) {
            log.info("[scan-station] load {} attempt {}: {}", loadId, load.getAttempts(), e.getMessage());
            retryLater(load, e.getMessage());
        } catch (Exception e) {
            log.warn("[scan-station] load {} attempt {} failed: {}", loadId, load.getAttempts(), e.getMessage());
            retryLater(load, "Reading failed (" + e.getClass().getSimpleName() + "); trying again");
        }
    }

    /** Back to PENDING for the sweep, or FAILED once the attempts are used up. */
    private void retryLater(AiScanLoad load, String why) {
        if (load.getAttempts() >= MAX_ATTEMPTS) {
            finish(load, AiScanLoad.FAILED, null, "This load could not be read after " + MAX_ATTEMPTS
                    + " tries (" + why + "); rescan it or try again later");
        } else {
            finish(load, AiScanLoad.PENDING, null, why);
        }
    }

    /**
     * Store the outcome on the row read after the claim. A load the clerk replaced
     * or removed meanwhile has a newer version; that save fails and the stale
     * answer is dropped.
     */
    private void finish(AiScanLoad load, String status, String resultJson, String error) {
        load.setStatus(status);
        if (resultJson != null) load.setResultJson(resultJson);
        load.setErrorMessage(error);
        try {
            loadRepository.save(load);
        } catch (OptimisticLockingFailureException e) {
            log.info("[scan-station] load {} changed while it was read; this answer is dropped", load.getId());
        }
    }

    // ----------------------------------------------------------------- build

    void build(String sessionId) {
        AiScanSession s = sessionRepository.findById(sessionId).orElse(null);
        if (s == null || !AiScanSession.BUILDING.equals(s.getStatus()) || !properties.isOn(s.getInstituteId())) return;
        ScanPlanLoader.Loaded loaded = plans.load(s);
        ScanPlanner.Plan plan = loaded.plan();
        if (!ScanPlanner.VERDICT_READY.equals(plan.verdict())) {
            failBuild(s, "The session is no longer ready (" + plan.verdict() + "); check it and make the copies again");
            return;
        }
        List<ScanPlanner.Copy> list = plan.buildList();
        Map<String, String> urls = new HashMap<>();
        for (ScanPlanner.Copy c : list) {
            for (ScanPlanner.PagePick p : c.pages()) {
                if (p.fileId() == null || urls.containsKey(p.fileId())) continue;
                String url = mediaUrls.url(p.fileId());
                if (url == null) {
                    failBuild(s, "Could not reach the media service; make the copies again");
                    return;
                }
                urls.put(p.fileId(), url);
            }
        }

        // A resumed build keeps the PDFs made before it stopped, when their pages are still the same.
        Map<String, ScanAnalysis.BuiltCopy> made = new LinkedHashMap<>(reusable(s, list));
        Map<String, String> lastError = new HashMap<>();
        List<ScanPlanner.Copy> todo = list.stream().filter(c -> !made.containsKey(c.copyKey())).toList();
        Job job = new Job(s);
        try {
            for (int round = 0; round < 2 && !todo.isEmpty(); round++) {     // per-copy errors get one retry
                for (List<ScanPlanner.Copy> chunk : chunks(todo)) {
                    ScanAnalysis.BuildResult result = buildChunk(job, chunk, urls);
                    s = job.session;
                    Map<String, ScanAnalysis.BuiltCopy> byKey = new HashMap<>();
                    if (result != null && result.getCopies() != null) {
                        for (ScanAnalysis.BuiltCopy b : result.getCopies()) {
                            if (b != null && b.getCopyKey() != null) byKey.put(b.getCopyKey(), b);
                        }
                    }
                    for (ScanPlanner.Copy c : chunk) {
                        ScanAnalysis.BuiltCopy b = byKey.get(c.copyKey());
                        if (b != null && b.getError() == null && b.getFileId() != null && !b.getFileId().isBlank()) {
                            made.put(c.copyKey(), b);
                        } else {
                            lastError.put(c.copyKey(), b == null ? "missing from the answer" : String.valueOf(b.getError()));
                        }
                    }
                    s = heartbeat(s, list, made);
                    if (s == null) return;
                    job.session = s;
                }
                todo = list.stream().filter(c -> !made.containsKey(c.copyKey())).toList();
            }
        } catch (BuildParked e) {
            s = job.session;
            log.info("[scan-station] session {}: ai_service stayed busy; build parked for the sweep", sessionId);
            s.setBuiltJson(plans.write(builtEntries(list, made)));
            s.setErrorMessage(BUSY_MESSAGE);
            try {
                sessionRepository.save(s);
            } catch (OptimisticLockingFailureException ex) {
                log.info("[scan-station] session {} changed while building; this build stops", sessionId);
            }
            return;
        } catch (ScanDisabledException e) {
            s = job.session;
            log.error("[scan-station] session {} build: {}", sessionId, e.getMessage());
            failBuild(s, "The scan reader is switched off on the AI service; try again later");
            return;
        } catch (OptimisticLockingFailureException e) {
            log.info("[scan-station] session {} changed while building; this build stops", sessionId);
            return;
        } catch (Exception e) {
            s = job.session;
            log.warn("[scan-station] session {} build failed: {}", sessionId, e.getMessage());
            failBuild(s, "Making the copies failed (" + e.getMessage() + "); try again");
            return;
        }

        int missing = list.size() - made.size();
        if (missing > 0) {
            log.warn("[scan-station] session {}: {} of {} copies not made: {}", sessionId, missing, list.size(),
                    lastError.values().stream().distinct().limit(3).toList());
            failBuild(s, missing + (missing == 1 ? " copy" : " copies") + " could not be made");
            return;
        }
        s.setBuiltJson(plans.write(builtEntries(list, made)));
        s.setBuildFingerprint(plan.fingerprint());
        s.setStatus(AiScanSession.BUILT);
        s.setErrorMessage(null);
        try {
            sessionRepository.save(s);
            log.info("[scan-station] session {}: {} copies built", sessionId, list.size());
        } catch (OptimisticLockingFailureException e) {
            log.info("[scan-station] session {} changed while building; this build is dropped", sessionId);
        }
    }

    /**
     * One build call. The session is stamped before every try, so the sweep sees
     * the build is alive. A 429 waits {@link #BUSY_WAITS_MS} between tries and,
     * when ai_service stays busy, parks the build ({@link BuildParked}); another
     * retryable error is tried once more after a short pause.
     */
    private ScanAnalysis.BuildResult buildChunk(Job job, List<ScanPlanner.Copy> chunk, Map<String, String> urls) {
        AiScanSession s = job.session;
        List<ScanAnalysis.BuildCopy> copies = new ArrayList<>();
        for (ScanPlanner.Copy c : chunk) {
            List<ScanAnalysis.BuildPage> pages = new ArrayList<>();
            for (ScanPlanner.PagePick p : c.pages()) {
                pages.add(ScanAnalysis.BuildPage.builder().url(urls.get(p.fileId())).kind(p.kind())
                        .pageIndex(p.pageIndex()).rotation(p.rotation()).dpi(p.dpi()).build());
            }
            copies.add(ScanAnalysis.BuildCopy.builder().copyKey(c.copyKey()).fileName(c.buildFileName())
                    .pages(pages).build());
        }
        ScanAnalysis.BuildRequest req = ScanAnalysis.BuildRequest.builder().instituteId(s.getInstituteId())
                .sessionId(s.getId()).sourceId(BUILD_SOURCE_ID).copies(copies).build();
        int busy = 0;
        boolean retried = false;
        while (true) {
            stamp(job);
            try {
                return client.build(req);
            } catch (ScanBusyException e) {
                if (busy >= BUSY_WAITS_MS.length) throw new BuildParked();
                log.info("[scan-station] session {} build chunk: {}; waiting", s.getId(), e.getMessage());
                pause(BUSY_WAITS_MS[busy++]);
            } catch (ScanRetryableException e) {
                if (retried) throw e;
                retried = true;
                log.info("[scan-station] session {} build chunk: {}; trying once more", s.getId(), e.getMessage());
                pause(RETRY_PAUSE_MS);
            }
        }
    }

    /** Mark the build alive just before an ai call: the sweep only restarts a build stamped long ago. */
    private void stamp(Job job) {
        AiScanSession s = job.session;
        s.setUpdatedAt(new Date());
        s.setErrorMessage(null);
        job.session = sessionRepository.save(s);
    }

    /** Copies a stopped build already made, whose pages are still exactly what the plan wants now. */
    private Map<String, ScanAnalysis.BuiltCopy> reusable(AiScanSession s, List<ScanPlanner.Copy> list) {
        Map<String, ScanAnalysis.BuiltCopy> out = new HashMap<>();
        Map<String, ScanStationDtos.BuiltEntry> byKey = new HashMap<>();
        for (ScanStationDtos.BuiltEntry e : builtEntries(s)) {
            if (e != null && e.getCopyKey() != null) byKey.put(e.getCopyKey(), e);
        }
        for (ScanPlanner.Copy c : list) {
            ScanStationDtos.BuiltEntry e = byKey.get(c.copyKey());
            if (e == null || e.getFileId() == null || e.getFileId().isBlank() || !samePages(c, e.getPageMap())) continue;
            out.put(c.copyKey(), ScanAnalysis.BuiltCopy.builder().copyKey(c.copyKey()).fileId(e.getFileId())
                    .pageCount(e.getPageCount()).build());
        }
        return out;
    }

    private static boolean samePages(ScanPlanner.Copy c, List<ScanStationDtos.PageMapEntry> map) {
        if (map == null || map.size() != c.pages().size()) return false;
        for (int i = 0; i < map.size(); i++) {
            ScanPlanner.PagePick p = c.pages().get(i);
            ScanStationDtos.PageMapEntry m = map.get(i);
            if (m == null || !Objects.equals(m.getLoadNo(), p.loadNo())
                    || !Objects.equals(m.getRef(), p.ref())
                    || !Objects.equals(m.getFileId(), p.fileId())
                    || !Objects.equals(m.getPageIndex(), p.pageIndex())
                    || !Objects.equals(m.getRotation(), p.rotation())) {
                return false;
            }
        }
        return true;
    }

    /** The session a build is working on; replaced after every save (its version moves). */
    private static final class Job {
        AiScanSession session;

        Job(AiScanSession session) {
            this.session = session;
        }
    }

    /** ai_service stayed busy through every wait: the build stops, still BUILDING, for the sweep. */
    private static final class BuildParked extends RuntimeException {
        BuildParked() {
            super("ai_service stayed busy", null, false, false);
        }
    }

    /** Store the copies made so far: the clerk sees progress, and the sweep sees the build is alive. */
    private AiScanSession heartbeat(AiScanSession s, List<ScanPlanner.Copy> list, Map<String, ScanAnalysis.BuiltCopy> made) {
        s.setBuiltJson(plans.write(builtEntries(list, made)));
        return sessionRepository.save(s);
    }

    static List<List<ScanPlanner.Copy>> chunks(List<ScanPlanner.Copy> copies) {
        List<List<ScanPlanner.Copy>> out = new ArrayList<>();
        List<ScanPlanner.Copy> cur = new ArrayList<>();
        int pages = 0;
        for (ScanPlanner.Copy c : copies) {
            int n = c.pages().size();
            if (!cur.isEmpty() && (cur.size() >= BUILD_CHUNK_COPIES || pages + n > BUILD_CHUNK_PAGES)) {
                out.add(cur);
                cur = new ArrayList<>();
                pages = 0;
            }
            cur.add(c);
            pages += n;
        }
        if (!cur.isEmpty()) out.add(cur);
        return out;
    }

    private static List<ScanStationDtos.BuiltEntry> builtEntries(List<ScanPlanner.Copy> list,
                                                                  Map<String, ScanAnalysis.BuiltCopy> made) {
        List<ScanStationDtos.BuiltEntry> out = new ArrayList<>();
        for (ScanPlanner.Copy c : list) {
            ScanAnalysis.BuiltCopy b = made.get(c.copyKey());
            if (b == null) continue;
            List<ScanStationDtos.PageMapEntry> map = new ArrayList<>();
            for (ScanPlanner.PagePick p : c.pages()) {
                map.add(ScanStationDtos.PageMapEntry.builder().loadNo(p.loadNo()).ref(p.ref()).fileId(p.fileId())
                        .pageIndex(p.pageIndex()).rotation(p.rotation()).side(p.side()).build());
            }
            out.add(ScanStationDtos.BuiltEntry.builder().copyKey(c.copyKey()).fileId(b.getFileId())
                    .pageCount(b.getPageCount() != null ? b.getPageCount() : c.pages().size())
                    .fileName(c.label()).pageMap(map).build());
        }
        return out;
    }

    private List<ScanStationDtos.BuiltEntry> builtEntries(AiScanSession s) {
        List<ScanStationDtos.BuiltEntry> b = plans.read(s.getBuiltJson(),
                new TypeReference<List<ScanStationDtos.BuiltEntry>>() { });
        return b == null ? List.of() : b;
    }

    private void failBuild(AiScanSession s, String why) {
        s.setStatus(AiScanSession.FAILED);
        s.setErrorMessage(why);
        try {
            sessionRepository.save(s);
        } catch (OptimisticLockingFailureException e) {
            log.info("[scan-station] session {} changed while building; not marked failed", s.getId());
        }
    }

    /** Overridable so tests do not wait. */
    protected void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
