package vacademy.io.assessment_service.features.assessment.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;

import java.util.Date;
import java.util.List;
import java.util.Optional;

@Repository
public interface AiEvaluationProcessRepository extends JpaRepository<AiEvaluationProcess, String> {

        Optional<AiEvaluationProcess> findByStudentAttempt_Id(String attemptId);

        Optional<AiEvaluationProcess> findByStudentAttemptId(String attemptId);

        /**
         * In-flight evaluations for an attempt, newest first. Used for trigger
         * idempotency so a double-click / re-trigger returns the running process
         * instead of spawning a second concurrent (full-cost) run that would
         * interleave marks into the same question_wise_marks rows.
         */
        @Query("SELECT p FROM AiEvaluationProcess p WHERE p.studentAttempt.id = :attemptId " +
                        "AND p.status IN :activeStatuses ORDER BY p.startedAt DESC")
        List<AiEvaluationProcess> findActiveByAttemptId(@Param("attemptId") String attemptId,
                        @Param("activeStatuses") List<String> activeStatuses);

        List<AiEvaluationProcess> findByStatus(String status);

        List<AiEvaluationProcess> findByStatusAndRetryCountLessThan(String status, Integer maxRetryCount);

        List<AiEvaluationProcess> findByAssessmentId(String assessmentId);

        /** Every run, of any status, for a set of attempts - one query for a whole table page. */
        List<AiEvaluationProcess> findByStudentAttempt_IdIn(List<String> attemptIds);

        /**
         * Non-terminal processes that started before {@code cutoff} — i.e. jobs the
         * stale-job sweeper should mark FAILED because ai_service died / never sent
         * a terminal callback, leaving them stuck forever. Rows with a null
         * started_at are excluded by the comparison, so they are never swept.
         */
        @Query("SELECT p FROM AiEvaluationProcess p " +
                        "WHERE p.status IN :statuses AND p.startedAt < :cutoff")
        List<AiEvaluationProcess> findStaleNonTerminal(@Param("statuses") List<String> statuses,
                        @Param("cutoff") Date cutoff);

        /**
         * Dispatched rows with no heartbeat since the cutoff. Uses updated_at, which
         * every progress callback touches, so a copy that is genuinely being graded
         * is never mistaken for one whose worker died with it.
         */
        @Query("SELECT p FROM AiEvaluationProcess p " +
                        "WHERE p.status IN :statuses AND COALESCE(p.updatedAt, p.startedAt) < :cutoff")
        List<AiEvaluationProcess> findSilentDispatched(@Param("statuses") List<String> statuses,
                        @Param("cutoff") Date cutoff);

        /**
         * Heartbeat: move updated_at and nothing else, and only while the process
         * is still running. A bulk UPDATE so it cannot overwrite a concurrent
         * status change the way a full entity save would.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("UPDATE AiEvaluationProcess p SET p.updatedAt = :now WHERE p.id = :id AND p.status NOT IN :terminal")
        int touch(@Param("id") String id, @Param("now") Date now, @Param("terminal") List<String> terminal);

        /**
         * Settled (COMPLETED/FAILED) checks nobody has been told about yet, oldest
         * first. The completion notifier groups them per assessment.
         */
        @Query("SELECT DISTINCT p FROM AiEvaluationProcess p " +
                        "LEFT JOIN FETCH p.assessment " +
                        "LEFT JOIN FETCH p.studentAttempt sa " +
                        "LEFT JOIN FETCH sa.registration " +
                        "WHERE p.notifiedAt IS NULL AND p.status IN :terminal ORDER BY p.completedAt ASC")
        List<AiEvaluationProcess> findUnnotifiedSettled(@Param("terminal") List<String> terminal);

        /** Whether any check for the assessment is still running (the notice waits for it). */
        @Query("SELECT COUNT(p) FROM AiEvaluationProcess p WHERE p.assessment.id = :assessmentId AND p.status IN :active")
        long countActiveForAssessment(@Param("assessmentId") String assessmentId, @Param("active") List<String> active);

        /**
         * Claim a set of settled checks for one notice. Replica-safe: the WHERE on
         * notified_at IS NULL means the first replica to run this wins and the
         * others update zero rows, so the same copies are never announced twice.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("UPDATE AiEvaluationProcess p SET p.notifiedAt = :now WHERE p.id IN :ids AND p.notifiedAt IS NULL")
        int claimForNotice(@Param("ids") List<String> ids, @Param("now") Date now);

        /** How many copies are with the AI service right now (dispatched, not finished). */
        @Query("SELECT COUNT(p) FROM AiEvaluationProcess p WHERE p.status IN :statuses")
        long countByStatusIn(@Param("statuses") List<String> statuses);

        /**
         * All AI-evaluation processes for an assessment within one institute,
         * newest first, with the attempt + registration eagerly loaded for the
         * dashboard (participant name). The registration.instituteId filter scopes
         * results to the caller's institute so cross-tenant listing is impossible.
         */
        @Query("SELECT p FROM AiEvaluationProcess p " +
                        "LEFT JOIN FETCH p.studentAttempt sa " +
                        "LEFT JOIN FETCH sa.registration reg " +
                        "WHERE p.assessment.id = :assessmentId AND reg.instituteId = :instituteId " +
                        "ORDER BY p.startedAt DESC")
        List<AiEvaluationProcess> findByAssessmentAndInstitute(@Param("assessmentId") String assessmentId,
                        @Param("instituteId") String instituteId);

        /**
         * Fetch AiEvaluationProcess with eagerly loaded StudentAttempt to avoid lazy
         * initialization errors
         */
        @Query("SELECT p FROM AiEvaluationProcess p LEFT JOIN FETCH p.studentAttempt WHERE p.id = :processId")
        Optional<AiEvaluationProcess> findByIdWithStudentAttempt(@Param("processId") String processId);

        /**
         * Fetch AiEvaluationProcess with eagerly loaded StudentAttempt, Registration,
         * and Assessment
         * for the progress API
         */
        @Query("SELECT p FROM AiEvaluationProcess p " +
                        "LEFT JOIN FETCH p.studentAttempt sa " +
                        "LEFT JOIN FETCH sa.registration reg " +
                        "LEFT JOIN FETCH reg.assessment " +
                        "WHERE p.id = :processId")
        Optional<AiEvaluationProcess> findByIdWithCompleteDetails(@Param("processId") String processId);

        // ------------------------------------------------------------------ dispatch guards
        //
        // The claim itself (pg_try_advisory_xact_lock + fair-share UPDATE ... RETURNING)
        // lives in AiEvaluationQueueClaimer: it needs several statements in one
        // transaction. These are the single-row transitions after it. Each is a guarded
        // UPDATE, never a read-then-save, so two pods (or a pod and a callback) can never
        // both win the same transition (gate G6).

        /**
         * DISPATCHED -> PROCESSING, only for the holder of the claim. 0 rows means
         * someone else already dispatched it, a teacher cancelled it, or the sweeper
         * took it back - the caller must stop.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Transactional
        @Query("UPDATE AiEvaluationProcess p SET p.status = 'PROCESSING', p.currentStep = 'DISPATCHED', "
                        + "p.startedAt = :now, p.updatedAt = :now "
                        + "WHERE p.id = :id AND p.status = 'DISPATCHED' AND p.claimedBy = :claimedBy")
        int beginDispatch(@Param("id") String id, @Param("claimedBy") String claimedBy, @Param("now") Date now);

        /**
         * DISPATCHED -> PENDING with the claim cleared, only for the holder of the claim:
         * the typed hand-back (marks not written yet) and a dispatch the executor could
         * not take. The next tick claims it again.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Transactional
        @Query("UPDATE AiEvaluationProcess p SET p.status = 'PENDING', p.claimedBy = NULL, p.claimedAt = NULL, "
                        + "p.updatedAt = :now "
                        + "WHERE p.id = :id AND p.status = 'DISPATCHED' AND p.claimedBy = :claimedBy")
        int handBackClaim(@Param("id") String id, @Param("claimedBy") String claimedBy, @Param("now") Date now);

        /**
         * DISPATCHED -> FAILED, only for the holder of the claim, before anything was sent
         * to ai_service (so nothing is billed): the dispatch-time credit re-check found the
         * balance short, or the result was released while the copy waited (10.6, G8).
         * {@code step} carries the machine reason (INSUFFICIENT_CREDITS, RESULT_RELEASED).
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Transactional
        @Query("UPDATE AiEvaluationProcess p SET p.status = 'FAILED', p.currentStep = :step, "
                        + "p.errorMessage = :message, p.completedAt = :now, p.updatedAt = :now "
                        + "WHERE p.id = :id AND p.status = 'DISPATCHED' AND p.claimedBy = :claimedBy")
        int failClaimed(@Param("id") String id, @Param("claimedBy") String claimedBy, @Param("step") String step,
                        @Param("message") String message, @Param("now") Date now);

        /**
         * The quote and rate snapshot for a row that was queued without one (a learner's
         * submit, or a row queued before the credit check existed), written at dispatch.
         * Never overwrites a quote made at accept.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Transactional
        @Query(value = "UPDATE ai_evaluation_process SET quoted_credits = :quoted, "
                        + "rate_snapshot = CAST(:snapshot AS jsonb), updated_at = :now "
                        + "WHERE id = :id AND quoted_credits IS NULL", nativeQuery = true)
        int recordQuote(@Param("id") String id, @Param("quoted") java.math.BigDecimal quoted,
                        @Param("snapshot") String snapshot, @Param("now") Date now);

        /**
         * PROCESSING -> PENDING after ai_service answered 429 (every grading slot
         * busy): backpressure, not a failure, so no retry is counted and the row
         * waits for the next tick. Guarded on the claim so a row that moved on in
         * the meantime is left alone.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Transactional
        @Query("UPDATE AiEvaluationProcess p SET p.status = 'PENDING', p.claimedBy = NULL, p.claimedAt = NULL, "
                        + "p.currentStep = 'AI_SERVICE_BUSY', p.updatedAt = :now "
                        + "WHERE p.id = :id AND p.status = 'PROCESSING' AND p.claimedBy = :claimedBy")
        int requeueBusy(@Param("id") String id, @Param("claimedBy") String claimedBy, @Param("now") Date now);

        /**
         * After ai_service accepted the job (outside any transaction): store its job id.
         * current_step moves to AI_SERVICE_SUBMITTED only if no progress callback has
         * already moved it on - the callbacks can arrive before this write.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Transactional
        @Query(value = "UPDATE ai_evaluation_process SET ai_service_job_id = :jobId, "
                        + "current_step = CASE WHEN current_step = 'DISPATCHED' THEN 'AI_SERVICE_SUBMITTED' ELSE current_step END, "
                        + "updated_at = :now WHERE id = :id", nativeQuery = true)
        int recordSubmitted(@Param("id") String id, @Param("jobId") String jobId, @Param("now") Date now);

        /** A progress callback's step, without touching any other column. */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("UPDATE AiEvaluationProcess p SET p.currentStep = :step, p.updatedAt = :now "
                        + "WHERE p.id = :id AND p.status NOT IN :terminal")
        int applyProgressStep(@Param("id") String id, @Param("step") String step, @Param("now") Date now,
                        @Param("terminal") List<String> terminal);

        /** A progress callback's step and the status it implies, without touching any other column. */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("UPDATE AiEvaluationProcess p SET p.currentStep = :step, p.status = :status, p.updatedAt = :now "
                        + "WHERE p.id = :id AND p.status NOT IN :terminal")
        int applyProgressStepAndStatus(@Param("id") String id, @Param("step") String step,
                        @Param("status") String status, @Param("now") Date now,
                        @Param("terminal") List<String> terminal);

        /** One more question settled. An increment in SQL, so concurrent callbacks cannot lose a count. */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("UPDATE AiEvaluationProcess p SET p.questionsCompleted = COALESCE(p.questionsCompleted, 0) + 1, "
                        + "p.updatedAt = :now WHERE p.id = :id")
        int incrementQuestionsCompleted(@Param("id") String id, @Param("now") Date now);

        /**
         * Sweeper: a silent in-flight row goes back to the queue - only if it is still in
         * the state, and still as silent, as when the sweeper read it. A callback that
         * landed in between (a COMPLETED, a fresh heartbeat) makes this a no-op instead
         * of being overwritten.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("UPDATE AiEvaluationProcess p SET p.status = 'PENDING', p.currentStep = 'REQUEUED', "
                        + "p.retryCount = :retryCount, p.claimedBy = NULL, p.claimedAt = NULL, p.aiServiceJobId = NULL, "
                        + "p.errorMessage = :message, p.updatedAt = :now "
                        + "WHERE p.id = :id AND p.status = :expectedStatus "
                        + "AND COALESCE(p.updatedAt, p.startedAt) < :cutoff")
        int sweepRequeue(@Param("id") String id, @Param("expectedStatus") String expectedStatus,
                        @Param("cutoff") Date cutoff, @Param("retryCount") int retryCount,
                        @Param("message") String message, @Param("now") Date now);

        /** Sweeper: a silent in-flight row that used up its requeues is failed, under the same guard. */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("UPDATE AiEvaluationProcess p SET p.status = 'FAILED', p.currentStep = 'TIMED_OUT', "
                        + "p.errorMessage = :message, p.completedAt = :now, p.updatedAt = :now "
                        + "WHERE p.id = :id AND p.status = :expectedStatus "
                        + "AND COALESCE(p.updatedAt, p.startedAt) < :cutoff")
        int sweepFail(@Param("id") String id, @Param("expectedStatus") String expectedStatus,
                        @Param("cutoff") Date cutoff, @Param("message") String message, @Param("now") Date now);
}
