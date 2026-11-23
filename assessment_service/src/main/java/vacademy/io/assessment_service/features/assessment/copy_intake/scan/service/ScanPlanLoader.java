package vacademy.io.assessment_service.features.assessment.copy_intake.scan.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanLoad;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanLoadRepository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Reads a session's loads and decisions from the database and runs the planner
 * over them. Shared by the API (every read re-plans) and the runner (build and
 * start re-plan too), so both always see the same copies.
 *
 * <p>Owns the JSON of the scan tables: a plain mapper, so the stored shapes
 * depend only on the DTO annotations and never on the app's global settings.
 */
@Component
@Slf4j
public class ScanPlanLoader {

    private final AiScanLoadRepository loadRepository;
    private final ScanPlanner planner;
    private final ObjectMapper mapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @Autowired
    public ScanPlanLoader(AiScanLoadRepository loadRepository) {
        this(loadRepository, new ScanPlanner());
    }

    ScanPlanLoader(AiScanLoadRepository loadRepository, ScanPlanner planner) {
        this.loadRepository = loadRepository;
        this.planner = planner;
    }

    /** A session with everything the planner read, and its plan. */
    public record Loaded(AiScanSession session, List<AiScanLoad> liveLoads,
                         Map<Integer, ScanStationDtos.LoadRequest> requests,
                         Map<Integer, ScanAnalysis.Result> results,
                         Map<Integer, ScanStationDtos.LoadDecisions> decisions,
                         ScanStationDtos.SessionDecisions sessionDecisions,
                         ScanPlanner.Plan plan) {

        public AiScanLoad load(int loadNo) {
            for (AiScanLoad l : liveLoads) {
                if (l.getLoadNo() == loadNo) return l;
            }
            return null;
        }
    }

    public Loaded load(AiScanSession session) {
        List<AiScanLoad> live = new ArrayList<>();
        Set<Integer> removed = new HashSet<>();
        for (AiScanLoad l : loadRepository.findBySessionIdOrderByLoadNo(session.getId())) {
            if (l.isLive()) live.add(l);
            else removed.add(l.getLoadNo());
        }
        return plan(session, live, removed);
    }

    /** @param removed the numbers of the loads the clerk removed: holes in the physical pile */
    public Loaded plan(AiScanSession session, List<AiScanLoad> live, Set<Integer> removed) {
        Map<Integer, ScanStationDtos.LoadRequest> requests = new HashMap<>();
        Map<Integer, ScanAnalysis.Result> results = new HashMap<>();
        Map<Integer, ScanStationDtos.LoadDecisions> decisions = new HashMap<>();
        List<ScanPlanner.LoadFacts> facts = new ArrayList<>();
        for (AiScanLoad l : live) {
            ScanStationDtos.LoadRequest req = read(l.getPassesJson(), ScanStationDtos.LoadRequest.class);
            ScanAnalysis.Result result = AiScanLoad.DONE.equals(l.getStatus())
                    ? read(l.getResultJson(), ScanAnalysis.Result.class) : null;
            ScanStationDtos.LoadDecisions d = loadDecisions(l);
            if (req != null) requests.put(l.getLoadNo(), req);
            if (result != null) results.put(l.getLoadNo(), result);
            decisions.put(l.getLoadNo(), d);
            // A DONE row whose answer cannot be read is as good as a failed analysis.
            String status = AiScanLoad.DONE.equals(l.getStatus()) && result == null ? AiScanLoad.FAILED : l.getStatus();
            facts.add(new ScanPlanner.LoadFacts(l.getLoadNo(), status, result,
                    req == null ? null : req.getClientWarnings(), l.getErrorMessage()));
        }
        ScanStationDtos.SessionDecisions sd = sessionDecisions(session);
        return new Loaded(session, live, requests, results, decisions, sd, planner.plan(facts, removed, sd, decisions));
    }

    public ScanStationDtos.LoadDecisions loadDecisions(AiScanLoad l) {
        ScanStationDtos.LoadDecisions d = read(l.getDecisionsJson(), ScanStationDtos.LoadDecisions.class);
        return (d == null ? new ScanStationDtos.LoadDecisions() : d).normalized();
    }

    public ScanStationDtos.SessionDecisions sessionDecisions(AiScanSession s) {
        ScanStationDtos.SessionDecisions d = read(s.getDecisionsJson(), ScanStationDtos.SessionDecisions.class);
        return d == null ? new ScanStationDtos.SessionDecisions() : d;
    }

    // ------------------------------------------------------------------ JSON

    public <T> T read(String json, Class<T> type) {
        if (!StringUtils.hasText(json)) return null;
        try {
            return mapper.readValue(json, type);
        } catch (Exception e) {
            // the class only: a parse message quotes the JSON, and that can hold a student's name
            log.warn("[scan-station] stored {} JSON unreadable ({})", type.getSimpleName(), e.getClass().getSimpleName());
            return null;
        }
    }

    public <T> T read(String json, com.fasterxml.jackson.core.type.TypeReference<T> type) {
        if (!StringUtils.hasText(json)) return null;
        try {
            return mapper.readValue(json, type);
        } catch (Exception e) {
            log.warn("[scan-station] stored JSON unreadable ({})", e.getClass().getSimpleName());
            return null;
        }
    }

    public String write(Object value) {
        try {
            return value == null ? null : mapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("scan station JSON could not be written: " + e.getMessage(), e);
        }
    }
}
