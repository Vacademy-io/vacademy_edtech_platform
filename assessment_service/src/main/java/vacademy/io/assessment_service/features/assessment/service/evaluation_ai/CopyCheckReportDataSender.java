package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.service.AssessmentDataEnrichmentService;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Hands a copy-checked attempt's marks to admin_core's AI analysis, so the student and
 * class AI reports are built from what the copy check found.
 *
 * <p>Without this, an analysis only ever came from the learner's own submit (or offline
 * entry): a copy a teacher uploaded had none, and a copy the learner uploaded online was
 * analysed before the AI had marked it.
 *
 * <p>The row is tagged {@code analysis_trigger=copy_check}. admin_core then analyses it on
 * demand (when a report is asked for), unless the learner submitted the test themselves,
 * whose analysis is made automatically as before, and retires the older rows that were
 * made from marks the copy check replaced. No AI credits are spent here.
 *
 * <p>Only copies checked through a bulk AI check (an {@code ai_copy_intake_item}): an
 * online test's own automatic AI marking is left exactly as it was.
 *
 * <p>Sent after the transaction commits, a short while later: a teacher reviewing a copy
 * edits question after question, and each edit would otherwise send the whole attempt
 * again. One thread does the work, so a 200-copy batch finishing together is sent one
 * copy at a time.
 */
@Slf4j
@Service
public class CopyCheckReportDataSender implements DisposableBean {

    static final String ANALYSIS_TRIGGER_KEY = "analysis_trigger";
    static final String COPY_CHECK_TRIGGER = "copy_check";

    private final StudentAttemptRepository attempts;
    private final AssessmentDataEnrichmentService enrichment;
    private final AdminCoreServiceClient adminCore;
    private final TransactionTemplate readOnly;
    private final JdbcTemplate jdbc;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "copy-check-report-data");
        t.setDaemon(true);
        return t;
    });
    private final Map<String, ScheduledFuture<?>> pending = new ConcurrentHashMap<>();

    @Value("${assessment.llm-analytics.enabled:true}")
    private boolean enabled;

    /** Seconds to wait for more edits of the same attempt before sending it. */
    @Value("${assessment.copy-check.report-data-delay-seconds:45}")
    private long delaySeconds;

    public CopyCheckReportDataSender(StudentAttemptRepository attempts, AssessmentDataEnrichmentService enrichment,
                                     AdminCoreServiceClient adminCore, PlatformTransactionManager transactionManager,
                                     JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.attempts = attempts;
        this.enrichment = enrichment;
        this.adminCore = adminCore;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** Best-effort, never throws: a report must never fail a grading callback or an edit. */
    public void sendAfterCommit(String attemptId) {
        if (!enabled || attemptId == null) {
            return;
        }
        try {
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        schedule(attemptId);
                    }
                });
            } else {
                schedule(attemptId);
            }
        } catch (Exception e) {
            log.warn("[copy-check-report] could not queue attempt {}: {}", attemptId, e.getMessage());
        }
    }

    void schedule(String attemptId) {
        pending.compute(attemptId, (id, previous) -> {
            if (previous != null) {
                previous.cancel(false);
            }
            return worker.schedule(() -> send(id), Math.max(0, delaySeconds), TimeUnit.SECONDS);
        });
    }

    /**
     * Sends one copy's analysis data now, on the caller's thread: for a copy whose delayed
     * send never landed (a restart inside the wait). True when it was sent.
     */
    public boolean sendNow(String attemptId) {
        try {
            Map<String, Object> data = readOnly.execute(status -> build(attemptId));
            if (data == null) {
                return false;
            }
            adminCore.saveAssessmentRawDataAsync(data);
            return true;
        } catch (Exception e) {
            log.warn("[copy-check-report] could not send attempt {} now: {}", attemptId, e.getMessage());
            return false;
        }
    }

    void send(String attemptId) {
        pending.remove(attemptId);
        try {
            // Database work in a short read-only transaction; the HTTP call outside it, so
            // no connection is held while admin_core answers.
            Map<String, Object> data = readOnly.execute(status -> build(attemptId));
            if (data == null) {
                return;
            }
            adminCore.saveAssessmentRawDataAsync(data);
            log.info("[copy-check-report] analysis data sent for attempt {}", attemptId);
        } catch (Exception e) {
            log.warn("[copy-check-report] could not send attempt {}: {}", attemptId, e.getMessage());
        }
    }

    Map<String, Object> build(String attemptId) {
        StudentAttempt attempt = attempts.findById(attemptId).orElse(null);
        if (attempt == null) {
            return null;
        }
        // Only a finished attempt, or a copy checked without a student (Evalezy / check only).
        String status = attempt.getStatus();
        if (!"ENDED".equals(status) && !CopyIntakeService.COPY_CHECK_ATTEMPT_STATUS.equals(status)) {
            return null;
        }
        AssessmentUserRegistration registration = attempt.getRegistration();
        Assessment assessment = registration != null ? registration.getAssessment() : null;
        if (assessment == null || registration.getUserId() == null) {
            return null;
        }
        if (!fromBulkCheck(attemptId)) {
            return null;
        }
        Map<String, Object> data = enrichment.buildEnrichedAssessmentData(attempt, assessment.getId(),
                assessment.getName(), assessment.getAssessmentType(), assessment.getDuration(), 0,
                registration.getInstituteId());
        if (data == null || data.containsKey("enrichmentError")) {
            log.warn("[copy-check-report] attempt {} not sent: {}", attemptId,
                    data == null ? "no data" : data.get("enrichmentError"));
            return null;
        }
        data.put(ANALYSIS_TRIGGER_KEY, COPY_CHECK_TRIGGER);
        return data;
    }

    /** Whether the attempt is a copy of a bulk AI check (uploaded, learner-submitted or check-only). */
    public boolean fromBulkCheck(String attemptId) {
        Boolean found = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM ai_copy_intake_item WHERE attempt_id = ?)", Boolean.class, attemptId);
        return Boolean.TRUE.equals(found);
    }

    @Override
    public void destroy() {
        worker.shutdown();
    }
}
