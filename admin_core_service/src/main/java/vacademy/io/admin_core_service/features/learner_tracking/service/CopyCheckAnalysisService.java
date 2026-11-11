package vacademy.io.admin_core_service.features.learner_tracking.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogProcessingProjection;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Makes the AI analyses of a bulk AI check's copies when a report asks for them - for the
 * learners assessment_service names, never anyone else.
 *
 * <p>Each learner's newest analysis row is taken with a conditional UPDATE to 'processing'
 * first: exactly one caller wins (this request, another pod, or the hourly scheduler), so
 * an analysis is never made, or charged, twice. Rows that waited for a report
 * ('on_demand'), were queued ('raw'), failed, or were skipped for credits can be taken;
 * a made ('processed') or in-flight ('processing') row never is. The analysis itself is
 * the scheduler's own {@link ActivityLogProcessorService#processActivityLog}.
 */
@Slf4j
@Service
public class CopyCheckAnalysisService implements DisposableBean {

    /** A newest row in one of these states can be made now. */
    static final List<String> CLAIMABLE = List.of("on_demand", "raw", "failed",
            "skipped_no_credits", "skipped_usage_limit");

    private final ActivityLogRepository activityLogRepository;
    private final ActivityLogProcessorService processor;
    /** Two at a time: a class of copies must not crowd out the scheduler's model calls. */
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(2000), r -> {
        Thread t = new Thread(r, "copy-check-analysis");
        t.setDaemon(true);
        return t;
    });

    public CopyCheckAnalysisService(ActivityLogRepository activityLogRepository,
                                    ActivityLogProcessorService processor) {
        this.activityLogRepository = activityLogRepository;
        this.processor = processor;
    }

    /** Each learner's newest live analysis-row status for an assessment (absent: no row). */
    public Map<String, String> newestStatusByUser(String sourceId) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Object[] row : activityLogRepository.findNewestAssessmentLogStatusPerUser(sourceId)) {
            if (row[0] != null) {
                out.put(row[0].toString(), row[1] != null ? row[1].toString() : null);
            }
        }
        return out;
    }

    /** The status of one learner's newest live analysis row; null when there is none. */
    public String newestStatus(String userId, String sourceId) {
        return newest(userId, sourceId).map(r -> r[1] != null ? r[1].toString() : null).orElse(null);
    }

    /** Queues the named learners' analyses that can be made now; returns how many were queued. */
    public int processAsync(String sourceId, Collection<String> userIds) {
        int queued = 0;
        for (String userId : userIds) {
            Optional<Object[]> row = newest(userId, sourceId);
            if (row.isEmpty() || !CLAIMABLE.contains(String.valueOf(row.get()[1]))) {
                continue;
            }
            String id = row.get()[0].toString();
            try {
                worker.execute(() -> claimAndProcess(id));
                queued++;
            } catch (RejectedExecutionException e) {
                // Full: the rest are queued by the next ask.
                log.warn("[copy-check-analysis] queue full; {} left for the next request", id);
                break;
            }
        }
        log.info("[copy-check-analysis] {} analysis(es) queued for source {}", queued, sourceId);
        return queued;
    }

    /**
     * Makes one learner's analysis now, if it can be made. Empty when the learner has no
     * row; otherwise the row as it ended ('processing' when another caller holds it).
     */
    public Optional<ActivityLog> processNow(String userId, String sourceId) {
        Optional<Object[]> row = newest(userId, sourceId);
        if (row.isEmpty()) {
            return Optional.empty();
        }
        String id = row.get()[0].toString();
        if (CLAIMABLE.contains(String.valueOf(row.get()[1]))) {
            claimAndProcess(id);
        }
        return activityLogRepository.findById(id);
    }

    void claimAndProcess(String id) {
        try {
            if (activityLogRepository.claimAssessmentLog(id, CLAIMABLE) != 1) {
                return; // another request, pod or the scheduler has it
            }
            ActivityLog row = activityLogRepository.findById(id).orElse(null);
            if (row == null) {
                return;
            }
            processor.processActivityLog(projection(row));
        } catch (Exception e) {
            // processActivityLog marks the row failed itself; a claim left 'processing' by a
            // crash is handed back by the scheduler's stale-claim reaper.
            log.warn("[copy-check-analysis] analysis {} failed: {}", id, e.getMessage());
        }
    }

    private Optional<Object[]> newest(String userId, String sourceId) {
        List<Object[]> rows = activityLogRepository.findNewestLiveAssessmentLog(userId, sourceId);
        return rows.isEmpty() || rows.get(0)[0] == null ? Optional.empty() : Optional.of(rows.get(0));
    }

    private static ActivityLogProcessingProjection projection(ActivityLog row) {
        return new ActivityLogProcessingProjection() {
            @Override
            public String getId() {
                return row.getId();
            }

            @Override
            public String getUserId() {
                return row.getUserId();
            }

            @Override
            public String getSourceType() {
                return row.getSourceType();
            }

            @Override
            public String getRawJson() {
                return row.getRawJson();
            }

            @Override
            public String getProcessedJson() {
                return row.getProcessedJson();
            }

            @Override
            public String getStatus() {
                return row.getStatus();
            }

            @Override
            public LocalDateTime getCreatedAt() {
                return row.getCreatedAt() != null ? row.getCreatedAt().toLocalDateTime() : null;
            }
        };
    }

    @Override
    public void destroy() {
        worker.shutdown();
    }
}
