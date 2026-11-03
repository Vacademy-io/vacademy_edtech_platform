package vacademy.io.assessment_service.features.institute_pulse.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.institute_pulse.dto.AssessmentFunnelProjection;
import vacademy.io.assessment_service.features.institute_pulse.dto.AssessmentSubmissionProjection;
import vacademy.io.assessment_service.features.institute_pulse.dto.AssessmentTotalsProjection;
import vacademy.io.assessment_service.features.institute_pulse.dto.AttemptRiskProjection;
import vacademy.io.assessment_service.features.institute_pulse.dto.EvaluationFunnelProjection;

import java.time.Instant;
import java.util.List;

/**
 * Read-only queries for the Institute Pulse assessment rail. Two queries per refresh for the
 * WHOLE institute — never one per assessment.
 *
 * <p><b>Access path.</b> {@code assessment_user_registration.institute_id} is populated, so
 * institute scope is applied at the registration level and {@code assessment_institute_mapping}
 * stays off the hot path. Both queries drive from
 * {@code idx_aur_institute_assessment (institute_id, assessment_id)} and reach attempts through
 * {@code idx_sa_registration (registration_id)} — see migrations V25/V26. Without those,
 * {@code student_attempt} has no secondary index at all and every refresh seq-scans the largest
 * table in this service, against a 5-connection pool.
 *
 * <p><b>Not touched:</b> {@code question_wise_marks}. Hardest-questions, the in-flight
 * leaderboard, and avg progress/marks are out of v1 precisely because they aggregate that table
 * across every live attempt on every poll, and it carries no index on {@code attempt_id}.
 */
public interface InstitutePulseRepository extends JpaRepository<StudentAttempt, String> {

    /**
     * Institute-wide totals, independent of the current page. Two cheap scalar subqueries — see
     * {@link AssessmentTotalsProjection} for why it is only two numbers.
     */
    @Query(value = """
            SELECT
                (SELECT COUNT(*)
                 FROM assessment a
                 WHERE a.status <> 'DELETED'
                   AND a.bound_start_time <= now()
                   AND a.bound_end_time   >= now()
                   AND EXISTS (SELECT 1 FROM assessment_user_registration r
                               WHERE r.assessment_id = a.id AND r.institute_id = :instituteId
                                 AND r.source IS DISTINCT FROM 'COPY_CHECK_ONLY')
                   AND (:batchId = '' OR EXISTS (
                           SELECT 1 FROM assessment_batch_registration abr
                           WHERE abr.assessment_id = a.id AND abr.batch_id = :batchId))
                ) AS liveAssessments,
                (SELECT COUNT(*)
                 FROM student_attempt sa
                     JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                 WHERE aur.institute_id = :instituteId AND sa.status = 'LIVE'
                   AND (:batchId = '' OR EXISTS (
                           SELECT 1 FROM assessment_batch_registration abr
                           WHERE abr.assessment_id = aur.assessment_id AND abr.batch_id = :batchId))
                ) AS inProgress
            """, nativeQuery = true)
    AssessmentTotalsProjection getLiveTotals(@Param("instituteId") String instituteId,
                                             @Param("batchId") String batchId);

    /**
     * One PAGE of live assessments with their funnel counts.
     *
     * <p><b>The limit is applied BEFORE the aggregation, and that is the whole point.</b> A
     * {@code LIMIT} on the output would still make Postgres aggregate every registration across
     * every live assessment and then discard most of the result — no saving at all. The
     * {@code page} CTE instead selects a handful of rows from {@code assessment} first, so the
     * expensive per-registration work is done only for the assessments actually being shown.
     * Cost therefore scales with the page, not with the institute.
     *
     * <p>Ordered by soonest-to-end so page 1 is the page that matters.
     *
     * <p><b>Why the two-level GROUP BY.</b> A registration can own several attempts (reattempts),
     * so counting attempt rows directly would place one learner in two buckets and the funnel
     * would not sum to {@code enrolled}. The inner query collapses each registration to ONE
     * effective state; the outer one counts registrations.
     *
     * <p><b>Precedence: LIVE &gt; ENDED &gt; PREVIEW &gt; none.</b> Deliberately not
     * "latest attempt wins". Someone who submitted attempt 1 and is now working on attempt 2
     * counts as IN_PROGRESS — this is a live view, and what matters is that they are working now.
     */
    @Query(value = """
            WITH page AS (
                SELECT a.id, a.name, a.bound_start_time, a.bound_end_time
                FROM assessment a
                WHERE a.status <> 'DELETED'
                  AND a.bound_start_time <= now()
                  AND a.bound_end_time   >= now()
                  AND EXISTS (SELECT 1 FROM assessment_user_registration r
                              WHERE r.assessment_id = a.id AND r.institute_id = :instituteId
                                AND r.source IS DISTINCT FROM 'COPY_CHECK_ONLY')
                  AND (:batchId = '' OR EXISTS (
                          SELECT 1 FROM assessment_batch_registration abr
                          WHERE abr.assessment_id = a.id AND abr.batch_id = :batchId))
                ORDER BY a.bound_end_time ASC, a.id ASC
                LIMIT :limitCount OFFSET :offsetCount
            )
            SELECT assessmentId, assessmentName, startEpoch, endEpoch,
                   COUNT(*)                                              AS enrolled,
                   COUNT(*) FILTER (WHERE effectiveState = 'NOT_STARTED') AS notStarted,
                   COUNT(*) FILTER (WHERE effectiveState = 'IN_PREVIEW')  AS inPreview,
                   COUNT(*) FILTER (WHERE effectiveState = 'IN_PROGRESS') AS inProgress,
                   COUNT(*) FILTER (WHERE effectiveState = 'SUBMITTED')   AS submitted
            FROM (
                SELECT p.id                                                          AS assessmentId,
                       p.name                                                        AS assessmentName,
                       CAST(EXTRACT(EPOCH FROM p.bound_start_time) * 1000 AS bigint) AS startEpoch,
                       CAST(EXTRACT(EPOCH FROM p.bound_end_time) * 1000 AS bigint)   AS endEpoch,
                       aur.id                                                        AS registrationId,
                       CASE
                           WHEN bool_or(sa.status = 'LIVE')    THEN 'IN_PROGRESS'
                           WHEN bool_or(sa.status = 'ENDED')   THEN 'SUBMITTED'
                           WHEN bool_or(sa.status = 'PREVIEW') THEN 'IN_PREVIEW'
                           ELSE 'NOT_STARTED'
                       END                                                           AS effectiveState
                FROM page p
                    JOIN assessment_user_registration aur ON aur.assessment_id = p.id
                    LEFT JOIN student_attempt sa ON sa.registration_id = aur.id
                WHERE aur.institute_id = :instituteId
                  AND aur.source IS DISTINCT FROM 'COPY_CHECK_ONLY'
                GROUP BY p.id, p.name, p.bound_start_time, p.bound_end_time, aur.id
            ) per_registration
            GROUP BY assessmentId, assessmentName, startEpoch, endEpoch
            ORDER BY endEpoch ASC
            """, nativeQuery = true)
    List<AssessmentFunnelProjection> getLiveFunnelPage(@Param("instituteId") String instituteId,
                                                       @Param("batchId") String batchId,
                                                       @Param("limitCount") int limitCount,
                                                       @Param("offsetCount") int offsetCount);

    /**
     * In-flight attempts that tripped at least one risk rule, soonest-to-end first.
     *
     * <p>Every rule is applied in SQL so {@code limitCount} is a meaningful cap — an institute can
     * have thousands of attempts live at once, and materialising them all to filter in Java would
     * defeat the point. Overrun needs no separate clause: an overrun attempt has a negative
     * {@code secondsRemaining}, which is below the auto-submit threshold by definition.
     *
     * <p>{@code max_time} is MINUTES (see {@code AssessmentAttemptEndTaskExecutor}:
     * {@code startTime + maxTime * 60 * 1000}), hence {@code make_interval(mins => ...)}.
     *
     * <p>A NULL {@code server_last_sync} is treated as stalled — the attempt is LIVE but the
     * server has never heard from the client.
     *
     * <p><b>MANUAL (pen-and-paper) assessments get a different stall rule.</b> Learners on these
     * tests legitimately background the app for an hour-plus while writing on paper, so "no sync
     * for {@code stalledSeconds}" would flag most of the cohort mid-test (observed 18 of 21 on
     * 2026-08-08). For them, silence only becomes a risk once the learner is inside the last
     * {@code manualReturnSeconds} of their personal clock and still hasn't reconnected to upload
     * — the moment an admin can actually act on. AUTO/typed assessments keep the original rule.
     */
    @Query(value = """
            SELECT sa.id           AS attemptId,
                   a.id            AS assessmentId,
                   a.name          AS assessmentName,
                   aur.user_id     AS userId,
                   aur.participant_name AS participantName,
                   CAST(EXTRACT(EPOCH FROM (now() - sa.server_last_sync)) AS bigint) AS secondsSinceSync,
                   CAST(EXTRACT(EPOCH FROM (
                       sa.start_time + make_interval(mins => sa.max_time) - now()
                   )) AS bigint) AS secondsRemaining
            FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                JOIN assessment a ON a.id = aur.assessment_id
            WHERE aur.institute_id = :instituteId
              AND sa.status = 'LIVE'
              AND (:batchId = '' OR EXISTS (
                      SELECT 1 FROM assessment_batch_registration abr
                      WHERE abr.assessment_id = a.id AND abr.batch_id = :batchId))
              AND (
                    sa.start_time + make_interval(mins => sa.max_time) - now()
                        < make_interval(secs => :autoSubmitSeconds)
                 OR (
                        (sa.server_last_sync IS NULL
                         OR now() - sa.server_last_sync > make_interval(secs => :stalledSeconds))
                    AND (
                            a.evaluation_type IS DISTINCT FROM 'MANUAL'
                         OR sa.start_time + make_interval(mins => sa.max_time) - now()
                                < make_interval(secs => :manualReturnSeconds)
                        )
                    )
              )
            ORDER BY secondsRemaining ASC NULLS LAST
            LIMIT :limitCount
            """, nativeQuery = true)
    List<AttemptRiskProjection> getAttemptRisks(@Param("instituteId") String instituteId,
                                                @Param("batchId") String batchId,
                                                @Param("stalledSeconds") long stalledSeconds,
                                                @Param("autoSubmitSeconds") long autoSubmitSeconds,
                                                @Param("manualReturnSeconds") long manualReturnSeconds,
                                                @Param("limitCount") int limitCount);

    /**
     * Attempts submitted inside the feed window, newest first — the assessment rail's
     * contribution to the institute-wide live feed.
     *
     * <p>These do NOT overlap with the feed's {@code SUBMITTED_ASSESSMENT} events in
     * admin_core_service: those come from {@code assessment_slide_tracked}, which hangs off
     * {@code activity_log} and represents an assessment SLIDE embedded in course content. A
     * standalone assessment lives only in this service and would otherwise never reach the feed.
     *
     * <p>Deliberately restricted to assessments whose bound window is currently open, reusing the
     * funnel's access path ({@code idx_aur_institute_assessment} → {@code idx_sa_registration})
     * rather than scanning every registration the institute has ever had. Consequence: a
     * submission made just before an assessment closed drops off the feed the moment the window
     * closes. That is the right trade for a live feed, and it avoids needing an index on
     * {@code submit_time}.
     */
    @Query(value = """
            SELECT sa.id   AS attemptId,
                   a.id    AS assessmentId,
                   a.name  AS assessmentName,
                   aur.user_id          AS userId,
                   aur.participant_name AS participantName,
                   CAST(EXTRACT(EPOCH FROM sa.submit_time) * 1000 AS bigint) AS submittedAtEpoch
            FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                JOIN assessment a ON a.id = aur.assessment_id
            WHERE aur.institute_id = :instituteId
              AND a.status <> 'DELETED'
              AND a.bound_start_time <= now()
              AND a.bound_end_time   >= now()
              AND sa.status = 'ENDED'
              AND sa.submit_time > :sinceCutoff
              AND (:batchId = '' OR EXISTS (
                      SELECT 1 FROM assessment_batch_registration abr
                      WHERE abr.assessment_id = a.id AND abr.batch_id = :batchId))
            ORDER BY sa.submit_time DESC
            LIMIT :limitCount
            """, nativeQuery = true)
    List<AssessmentSubmissionProjection> getRecentSubmissions(
            @Param("instituteId") String instituteId,
            @Param("batchId") String batchId,
            @Param("sinceCutoff") Instant sinceCutoff,
            @Param("limitCount") int limitCount);

    /**
     * Results pipeline: for assessments that ENDED recently, where their submitted attempts sit
     * between submission and results going out.
     *
     * <p><b>Why a different scope from every other query here.</b> The rest of the rail is bounded
     * to assessments whose window is currently open. Evaluation happens strictly AFTER the window
     * closes, so reusing that scope would produce a permanently empty panel. This one looks
     * backwards over {@code :endedSince} instead.
     *
     * <p><b>Drives from {@code assessment}, not from registrations.</b> Scoping by
     * {@code aur.institute_id} first would pull every registration the institute has ever had and
     * only then filter by date. Leading with the {@code bound_end_time} window keeps the driving
     * set to a handful of assessments; {@code assessment_user_registration_unique
     * (assessment_id, user_id)} then gives an indexed hop to registrations, and
     * {@code idx_sa_registration} to attempts.
     *
     * <p>{@code released} is a SUBSET of evaluated, not a further disjoint stage — an attempt can
     * be evaluated and released at once. The other four buckets are disjoint and sum to
     * {@code submitted}.
     */
    @Query(value = """
            WITH page AS (
                SELECT a.id, a.name, a.bound_end_time
                FROM assessment a
                WHERE a.status <> 'DELETED'
                  AND a.bound_end_time < now()
                  AND a.bound_end_time > :endedSince
                  AND EXISTS (SELECT 1 FROM assessment_user_registration r
                              WHERE r.assessment_id = a.id AND r.institute_id = :instituteId
                                AND r.source IS DISTINCT FROM 'COPY_CHECK_ONLY')
                  AND (:batchId = '' OR EXISTS (
                          SELECT 1 FROM assessment_batch_registration abr
                          WHERE abr.assessment_id = a.id AND abr.batch_id = :batchId))
                ORDER BY a.bound_end_time DESC, a.id ASC
                LIMIT :limitCount
            )
            SELECT p.id   AS assessmentId,
                   p.name AS assessmentName,
                   CAST(EXTRACT(EPOCH FROM p.bound_end_time) * 1000 AS bigint) AS endedAtEpoch,
                   COUNT(*) AS submitted,
                   COUNT(*) FILTER (
                       WHERE sa.result_status IS NULL OR sa.result_status = 'PENDING'
                   ) AS awaiting,
                   COUNT(*) FILTER (
                       WHERE sa.result_status IN ('EVALUATING', 'AI_EVALUATION_IN_PROGRESS')
                   ) AS evaluating,
                   COUNT(*) FILTER (
                       WHERE sa.result_status IN ('COMPLETED', 'AI_EVALUATION_COMPLETED')
                   ) AS evaluated,
                   COUNT(*) FILTER (WHERE sa.result_status = 'AI_EVALUATION_FAILED') AS failed,
                   COUNT(*) FILTER (WHERE sa.report_release_status = 'RELEASED')      AS released
            FROM page p
                JOIN assessment_user_registration aur ON aur.assessment_id = p.id
                JOIN student_attempt sa ON sa.registration_id = aur.id
            WHERE aur.institute_id = :instituteId
              AND sa.status = 'ENDED'
            GROUP BY p.id, p.name, p.bound_end_time
            ORDER BY p.bound_end_time DESC
            """, nativeQuery = true)
    List<EvaluationFunnelProjection> getEvaluationPipeline(
            @Param("instituteId") String instituteId,
            @Param("batchId") String batchId,
            @Param("endedSince") Instant endedSince,
            @Param("limitCount") int limitCount);
}
