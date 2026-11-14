package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue.AiEvaluationLaneCaps;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue.AiEvaluationQueueClaimer;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue.AiEvaluationQueueClaimer.ClaimedJob;

import java.net.InetAddress;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.UUID;

/**
 * Drains the AI-evaluation queue.
 *
 * Submissions only ENQUEUE (see {@link AiEvaluationSubmissionEnqueuer}); this is what
 * actually starts the work. Splitting the two is the point of the design: the job is
 * owned by a row in the database, not by whichever pod served the learner's submit, so a
 * deploy or a crash mid-exam does not lose anybody's grading.
 *
 * Two lanes, each on its own tick (AI_EVALUATION_PUBLIC_API.md 11.2): COPY (handwritten
 * sheets, minutes each) every 15 s and TYPED (typed long answers, seconds each) every
 * 5 s. Each tick claims the lane's fair share through {@link AiEvaluationQueueClaimer}:
 * an advisory lock per lane so replicas take turns, then one UPDATE that moves the
 * chosen rows straight to DISPATCHED with this instance's claim. Every claimed row is
 * then handed to the dispatch executor, whose first step is a guarded
 * DISPATCHED -> PROCESSING update - so a row can be dispatched once, by its claimant.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiEvaluationQueuePoller {

        private final AiEvaluationProcessRepository processRepository;
        private final AiEvaluationAsyncService aiEvaluationAsyncService;
        private final AiEvaluationQueueClaimer claimer;
        private final AiEvaluationLaneCaps laneCaps;

        /**
         * Off by default.
         *
         * The queue can fill (assessments opt in) without anything draining it, which
         * means this can be rolled out and watched before it starts spending credits.
         * Turn it on once the queued rows look right.
         */
        @Value("${assessment.ai-evaluation.poller-enabled:false}")
        private boolean pollerEnabled;

        /**
         * A PENDING row still carrying a claim younger than this is left alone. Only
         * rows claimed by a pre-V52 pod during a rolling deploy carry one (claims now
         * move rows to DISPATCHED, and every hand-back clears the claim); the window
         * keeps a new pod from dispatching what an old pod is about to.
         */
        @Value("${assessment.ai-evaluation.claim-stale-minutes:15}")
        private long claimStaleMinutes;

        /** Statuses that mean "with the AI service now" - counted against the lane caps. */
        static final List<String> IN_FLIGHT = AiEvaluationStatusEnum.IN_FLIGHT;

        /**
         * Identifies this instance in claimed_by. Host name plus a per-boot suffix: the
         * host alone is not enough, because a restarted pod keeps its name and would
         * otherwise look like the owner of claims made by the process it replaced.
         */
        private final String instanceId = buildInstanceId();

        private static String buildInstanceId() {
                String host;
                try {
                        host = InetAddress.getLocalHost().getHostName();
                } catch (Exception e) {
                        host = "unknown-host";
                }
                String suffix = UUID.randomUUID().toString().substring(0, 8);
                String id = host + "-" + suffix;
                // claimed_by is varchar(120).
                return id.length() > 120 ? id.substring(0, 120) : id;
        }

        String instanceId() {
                return instanceId;
        }

        /** Handwritten copies. Keeps the old poller-interval-ms so existing env config holds. */
        @Scheduled(fixedDelayString = "${assessment.ai-evaluation.poller-interval-ms:15000}",
                        initialDelayString = "${assessment.ai-evaluation.poller-initial-delay-ms:30000}")
        public void drainQueue() {
                drainLane(AiEvaluationLane.COPY);
        }

        /** Typed long answers: short jobs, so a shorter tick keeps them from waiting on it. */
        @Scheduled(fixedDelayString = "${assessment.ai-evaluation.typed-poller-interval-ms:5000}",
                        initialDelayString = "${assessment.ai-evaluation.poller-initial-delay-ms:30000}")
        public void drainTypedQueue() {
                drainLane(AiEvaluationLane.TYPED);
        }

        void drainLane(AiEvaluationLane lane) {
                if (!pollerEnabled) {
                        return;
                }
                try {
                        Date now = new Date();
                        Date staleBefore = Date.from(Instant.now().minus(claimStaleMinutes, ChronoUnit.MINUTES));
                        List<ClaimedJob> claimed = claimer.claim(lane, laneCaps, instanceId, now, staleBefore);
                        if (claimed.isEmpty()) {
                                return;
                        }
                        log.info("[ai-eval-poller] {} claimed {} queued {} evaluation(s)", instanceId, claimed.size(), lane);
                        for (ClaimedJob job : claimed) {
                                dispatch(job);
                        }
                } catch (Exception e) {
                        // A scheduled method that throws is not retried, and on some
                        // schedulers it silently stops being scheduled at all. Swallow, log,
                        // and let the next tick try again.
                        log.error("[ai-eval-poller] {} tick failed: {}", lane, e.getMessage(), e);
                }
        }

        /**
         * Hand one claimed job to the dispatch executor.
         *
         * The worker is the same one the teacher-triggered path uses, so automatic and
         * manual evaluations behave identically from here on -- same progress reporting,
         * same callbacks, same review-and-release gates before a learner sees anything.
         */
        private void dispatch(ClaimedJob job) {
                String processId = job.processId();
                if (job.attemptId() == null) {
                        log.error("[ai-eval-poller] process {} has no attempt, leaving it for the sweeper", processId);
                        return;
                }
                try {
                        aiEvaluationAsyncService.evaluateAttemptAsync(processId, job.attemptId(), job.model(), instanceId);
                        log.info("[ai-eval-poller] dispatched evaluation {} for attempt {} (model {})",
                                        processId, job.attemptId(), job.model());
                } catch (Exception e) {
                        // Usually the dispatch executor's queue is full. The row is DISPATCHED
                        // with our claim on it: give it straight back to the queue rather than
                        // leave it for the sweeper's stale timeout.
                        log.error("[ai-eval-poller] could not dispatch evaluation {}: {}", processId, e.getMessage(), e);
                        try {
                                processRepository.handBackClaim(processId, instanceId, new Date());
                        } catch (Exception handBack) {
                                log.error("[ai-eval-poller] could not hand back evaluation {}: {}", processId,
                                                handBack.getMessage());
                        }
                }
        }
}
