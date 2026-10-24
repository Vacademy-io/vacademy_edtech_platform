package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;

import java.util.List;

/**
 * Queues an AI evaluation when a learner submits, for assessments that opted in.
 *
 * Deliberately separate from {@link AiEvaluationService#triggerEvaluation}, which is the
 * teacher pressing "Evaluate with AI" on the submissions table. That path is interactive:
 * it validates institute access, reports per-attempt failures back to the caller, and
 * dispatches immediately. This one runs inside a learner's submit request, where none of
 * that applies -- there is no admin to report to, and nothing here may ever make a
 * submission fail.
 *
 * It only ENQUEUES. {@link AiEvaluationQueuePoller} does the dispatching, so the work is
 * owned by a row in the database rather than by whichever pod happened to serve the
 * submit -- if that pod dies a moment later, another one picks the job up.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiEvaluationSubmissionEnqueuer {

        /**
         * An evaluation in any of these states already covers this attempt. The shared
         * list, not a copy: a copy of it missed DISPATCHED once already, and a claimed
         * row read as "nothing running" would be queued (and paid for) a second time.
         */
        static final List<String> ACTIVE_STATUSES = AiEvaluationStatusEnum.ACTIVE;

        private final AiEvaluationProcessRepository aiEvaluationProcessRepository;
        private final TypedAnswerEvaluation typedAnswerEvaluation;

        /**
         * Kill switch. Turning this off stops all automatic evaluation without touching
         * per-assessment settings, which is what you want at 2am if the AI service is
         * misbehaving or credits are being burned unexpectedly. The teacher-triggered
         * path is unaffected.
         */
        @Value("${assessment.ai-evaluation.on-submit-enabled:true}")
        private boolean onSubmitEnabled;

        /**
         * Queue an evaluation for a just-submitted attempt.
         *
         * REQUIRES_NEW: this runs at the tail of the learner's submit. It must not join
         * that transaction, because a failure here would then roll back the submission
         * itself -- losing a learner's exam to protect an optional grading nicety is the
         * wrong trade every time. For the same reason every exit path is a log, never a
         * throw.
         *
         * @return the process id, or null when nothing was queued
         */
        @Transactional(propagation = Propagation.REQUIRES_NEW)
        public String enqueueIfEnabled(StudentAttempt attempt, Assessment assessment) {
                try {
                        if (!onSubmitEnabled) {
                                return null;
                        }
                        if (attempt == null || assessment == null) {
                                return null;
                        }
                        // NULL means off. Every assessment that existed before V43 reads as
                        // NULL here, so none of them start spending credits on their own.
                        if (!Boolean.TRUE.equals(assessment.getAiEvaluationEnabled())) {
                                return null;
                        }
                        // A released result is frozen against AI writes (G8, T0.33): queueing it
                        // would bill a run whose marks are then thrown away.
                        if (AiEvaluationService.isReleased(attempt)) {
                                log.info("[AI-EVAL-ENQUEUE] Attempt {} result is already released; not queued",
                                                attempt.getId());
                                return null;
                        }
                        // No credit check here, on purpose: this runs inside the learner's
                        // submit and must never wait on the credit service. The row is priced
                        // and checked when it is dispatched (AiEvaluationCreditGate.checkAtDispatch);
                        // a shortfall fails it there, unbilled, where the teacher sees it.
                        // With an uploaded copy the AI grades the sheet. Without one it grades
                        // only the typed written answers - so an online paper with nothing
                        // written would be dispatched only to fail with "nothing to grade";
                        // 88 such rows sat in the queue on one institute before this guard.
                        if (!typedAnswerEvaluation.hasAnswerSheet(attempt)
                                        && !typedAnswerEvaluation.awaitsAiGrading(attempt, assessment)) {
                                log.info("[AI-EVAL-ENQUEUE] Attempt {} has no submission file and no written question; not queued",
                                                attempt.getId());
                                return null;
                        }

                        // The learner client retries submit up to 3 times with backoff, and the
                        // submit endpoint itself is not idempotent -- so without this check a
                        // flaky network would queue (and pay for) the same attempt repeatedly.
                        List<AiEvaluationProcess> active = aiEvaluationProcessRepository
                                        .findActiveByAttemptId(attempt.getId(), ACTIVE_STATUSES);
                        if (!active.isEmpty()) {
                                log.info("[AI-EVAL-ENQUEUE] Attempt {} already has evaluation {} in flight, skipping",
                                                attempt.getId(), active.get(0).getId());
                                return active.get(0).getId();
                        }

                        AiEvaluationProcess process = new AiEvaluationProcess();
                        process.setStudentAttempt(attempt);
                        process.setAssessment(assessment);
                        process.setStatus(AiEvaluationStatusEnum.PENDING.name());
                        // The fair queue shares capacity out per institute and lane (V52).
                        process.setInstituteId(attempt.getRegistration() != null
                                        ? attempt.getRegistration().getInstituteId() : null);
                        process.setLane(AiEvaluationLane.of(
                                        typedAnswerEvaluation.isTypedAttempt(attempt, assessment)).name());
                        // startedAt is stamped by the worker when it actually begins. Leaving it
                        // null here is what distinguishes "queued" from "running" for the
                        // stale-job sweeper.
                        AiEvaluationProcess saved = aiEvaluationProcessRepository.save(process);

                        log.info("[AI-EVAL-ENQUEUE] Queued evaluation {} for attempt {} (assessment {}, model {})",
                                        saved.getId(), attempt.getId(), assessment.getId(),
                                        assessment.getAiEvaluationModel());
                        return saved.getId();
                } catch (Exception e) {
                        // A submission that succeeded must still read as a success to the learner.
                        log.error("[AI-EVAL-ENQUEUE] Could not queue evaluation for attempt {}: {}",
                                        attempt == null ? "?" : attempt.getId(), e.getMessage(), e);
                        return null;
                }
        }
}
