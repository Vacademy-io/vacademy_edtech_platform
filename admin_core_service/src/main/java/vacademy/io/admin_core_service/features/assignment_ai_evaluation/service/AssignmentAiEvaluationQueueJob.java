package vacademy.io.admin_core_service.features.assignment_ai_evaluation.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Sends queued assignment AI checks to the grader a few at a time, so "Check all with AI"
 * on a large class never floods ai_service or this service. One pod per tick (ShedLock).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AssignmentAiEvaluationQueueJob {

    private final AssignmentAiEvaluationService evaluationService;

    /** Copies with the grader at once, across all pods. */
    @Value("${assignment.ai-evaluation.max-active:3}")
    private int maxActive;

    @Scheduled(fixedDelayString = "${assignment.ai-evaluation.queue-poll-ms:15000}", initialDelay = 60000)
    @SchedulerLock(name = "AssignmentAiEvaluationQueueJob", lockAtMostFor = "PT10M", lockAtLeastFor = "PT5S")
    public void run() {
        try {
            evaluationService.failStale();
            int sent = evaluationService.dispatchQueued(maxActive);
            if (sent > 0) {
                log.info("[assignment-ai-eval] sent {} queued copies to the grader", sent);
            }
            evaluationService.announceFinishedBatches();
        } catch (Exception e) {
            log.warn("[assignment-ai-eval] queue tick failed: {}", e.getMessage());
        }
    }
}
