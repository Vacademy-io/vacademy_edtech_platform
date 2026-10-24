package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.assessment.dto.LeaderBoardDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.AssessmentOverviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.MarksRankDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.ParticipantsQuestionOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentAttemptHistoryProjection;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.UserAssessmentHistorySummaryProjection;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.ManualAttemptResponseDto;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;

import java.util.Date;
import java.util.Optional;

import java.util.List;

@Repository
public interface StudentAttemptRepository extends CrudRepository<StudentAttempt, String> {


    @Query("SELECT sa FROM StudentAttempt sa JOIN FETCH sa.registration WHERE sa.id = :id")
    Optional<StudentAttempt> findByIdWithRegistration(@Param("id") String id);


    @Query(value = """
                WITH RankedAttemptsRaw AS (
                    SELECT
                        sa.id AS attemptId,
                        aur.user_id AS userId,
                        aur.participant_name AS studentName,
                        aur.source_id AS batchId,
                        sa.total_time_in_seconds AS completionTimeInSeconds,
                        sa.total_marks AS achievedMarks,
                        aur.status,
                        sa.submit_time,
                        ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                    FROM student_attempt sa
                    JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                    WHERE aur.assessment_id = :assessmentId
                      AND aur.institute_id = :instituteId
                      AND sa.status IN ('LIVE', 'ENDED')
                      AND (:statusList IS NULL OR aur.status IN (:statusList))
                ),
                FilteredAttempts AS (
                    SELECT * FROM RankedAttemptsRaw WHERE rn = 1
                ),
                RankedAttempts AS (
                    SELECT *,
                           DENSE_RANK() OVER (ORDER BY achievedMarks DESC NULLS LAST, completionTimeInSeconds ASC NULLS LAST) AS rank
                    FROM FilteredAttempts
                ),
                TotalParticipants AS (
                    SELECT COUNT(*) AS totalParticipants FROM RankedAttempts
                )
                SELECT
                    attemptId,
                    userId,
                    studentName,
                    batchId,
                    completionTimeInSeconds,
                    achievedMarks,
                    status,
                    rank,
                    ROUND(CAST(100.0 * (1.0 - (CAST(rank - 1 AS FLOAT) / NULLIF(t.totalParticipants * 1.0, 0))) AS NUMERIC), 2) AS percentile
                FROM RankedAttempts ra, TotalParticipants t
                ORDER BY achievedMarks DESC NULLS LAST, completionTimeInSeconds ASC NULLS LAST
            """,
            countQuery = """
                                WITH RankedAttemptsRaw AS (
                                    SELECT
                                        sa.id AS attemptId,
                                        ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                                    FROM student_attempt sa
                                    JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                                    WHERE aur.assessment_id = :assessmentId
                                      AND aur.institute_id = :instituteId
                                      AND sa.status IN ('LIVE', 'ENDED')
                                      AND (:statusList IS NULL OR aur.status IN (:statusList))
                                ),
                                FilteredAttempts AS (
                                    SELECT * FROM RankedAttemptsRaw WHERE rn = 1
                                ),
                                RankedAttempts AS (
                                    SELECT * FROM FilteredAttempts
                                ),
                                TotalParticipants AS (
                                    SELECT COUNT(*) AS totalParticipants FROM RankedAttempts
                                )
                                SELECT
                                    count(attemptId)
                                FROM RankedAttempts ra
                    """,
            nativeQuery = true)
    Page<LeaderBoardDto> findLeaderBoardForAssessmentAndInstituteIdWithoutSearch(
            @Param("assessmentId") String assessmentId,
            @Param("instituteId") String instituteId,
            @Param("statusList") List<String> statusList,
            Pageable pageable);


    @Query(value = """
            WITH RankedAttemptsRaw AS (
                    SELECT
                        sa.id AS attemptId,
                        aur.user_id AS userId,
                        aur.participant_name AS studentName,
                        aur.source_id AS batchId,
                        sa.total_time_in_seconds AS completionTimeInSeconds,
                        sa.total_marks AS achievedMarks,
                        aur.status,
                        sa.submit_time,
                        ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                    FROM student_attempt sa
                    JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                    WHERE aur.assessment_id = :assessmentId
                      AND aur.institute_id = :instituteId
                      AND sa.status IN ('LIVE', 'ENDED')
                      AND (:statusList IS NULL OR aur.status IN (:statusList))
                ),
                FilteredAttempts AS (
                    SELECT * FROM RankedAttemptsRaw WHERE rn = 1
                ),
                RankedAttempts AS (
                    SELECT *,
                           DENSE_RANK() OVER (ORDER BY achievedMarks DESC NULLS LAST, completionTimeInSeconds ASC NULLS LAST) AS rank
                    FROM FilteredAttempts
                ),
                TotalParticipants AS (
                    SELECT COUNT(*) AS totalParticipants FROM RankedAttempts
                )
                SELECT
                    attemptId,
                    userId,
                    studentName,
                    batchId,
                    completionTimeInSeconds,
                    achievedMarks,
                    status,
                    rank,
                    ROUND(CAST(100.0 * (1.0 - (CAST(rank - 1 AS FLOAT) / NULLIF(t.totalParticipants * 1.0, 0))) AS NUMERIC), 2) AS percentile
                FROM RankedAttempts ra, TotalParticipants t
                WHERE (
                                to_tsvector('simple', concat(
                                ra.studentName
                                )) @@ plainto_tsquery('simple', :name)
                                OR ra.studentName ILIKE :name || '%'
                               )
                ORDER BY achievedMarks DESC NULLS LAST, completionTimeInSeconds ASC NULLS LAST
            """, countQuery = """
            WITH RankedAttemptsRaw AS (
                                    SELECT
                                        sa.id AS attemptId,
                                        aur.participant_name AS studentName,
                                        sa.total_time_in_seconds AS completionTimeInSeconds,
                                        sa.total_marks AS achievedMarks,
                                        ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                                    FROM student_attempt sa
                                    JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                                    WHERE aur.assessment_id = :assessmentId
                                      AND aur.institute_id = :instituteId
                                      AND sa.status IN ('LIVE', 'ENDED')
                                      AND (:statusList IS NULL OR aur.status IN (:statusList))
                                ),
                                FilteredAttempts AS (
                                    SELECT * FROM RankedAttemptsRaw WHERE rn = 1
                                ),
                                RankedAttempts AS (
                                    SELECT *,
                                           DENSE_RANK() OVER (ORDER BY achievedMarks DESC NULLS LAST, completionTimeInSeconds ASC NULLS LAST) AS rank
                                    FROM FilteredAttempts
                                ),
                                TotalParticipants AS (
                                    SELECT COUNT(*) AS totalParticipants FROM RankedAttempts
                                )
                                SELECT
                                    count(attemptId)
                                FROM RankedAttempts ra
                                WHERE (
                                          to_tsvector('simple', concat(
                                          ra.studentName
                                          )) @@ plainto_tsquery('simple', :name)
                                          OR ra.studentName ILIKE :name || '%'
                                          )
            """, nativeQuery = true)
    public Page<LeaderBoardDto> findLeaderBoardForAssessmentAndInstituteIdWithSearch(@Param("name") String name,
                                                                                     @Param("assessmentId") String assessmentId,
                                                                                     @Param("instituteId") String instituteId,
                                                                                     @Param("statusList") List<String> statusList,
                                                                                     Pageable pageable);


    @Query(value = """
            WITH LatestAttempts AS (
                SELECT sa.id AS attemptId, ROUND(CAST(sa.total_marks AS NUMERIC), 2) AS achievedMarks, aur.user_id AS userId,
                       ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                WHERE aur.assessment_id = :assessmentId
                AND aur.institute_id = :instituteId
                AND sa.status in ('ENDED','LIVE')
            ),
            RankedAttempts AS (
                SELECT achievedMarks,
                       DENSE_RANK() OVER (ORDER BY achievedMarks DESC) AS rank,
                       COUNT(*) OVER (PARTITION BY achievedMarks) AS noOfParticipants
                FROM LatestAttempts
                WHERE rn = 1
            ),
            TotalParticipants AS (
                SELECT COUNT(*) AS totalParticipants FROM LatestAttempts WHERE rn = 1
            )
            SELECT
                distinct r.achievedMarks as marks,
                r.rank as rank,
                r.noOfParticipants as noOfParticipants,
                ROUND(CAST(100.0 * (1.0 - (CAST(r.rank - 1 AS FLOAT) / NULLIF(t.totalParticipants * 1.0, 0))) AS NUMERIC), 2) AS percentile
            FROM RankedAttempts r, TotalParticipants t
            ORDER BY r.rank ASC
            """, nativeQuery = true)
    List<MarksRankDto> findMarkRankForAssessment(@Param("assessmentId") String assessmentId,
                                                 @Param("instituteId") String instituteId);


    @Query(value = """
            WITH LatestAttempts AS (
                SELECT
                    sa.id AS attemptId,
                    sa.total_marks AS achievedMarks,
                    sa.total_time_in_seconds AS totalTime,
                    aur.user_id AS userId,
                    sa.status AS attemptStatus,
                    ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                WHERE aur.assessment_id = :assessmentId
                AND aur.institute_id = :instituteId
                AND sa.status IN ('ENDED', 'LIVE')
            ),
            AssessmentInfo AS (
                SELECT
                    a.id AS assessment_id,
                    a.created_at,
                    a.bound_start_time,
                    a.bound_end_time,
                    a.duration,
                    aim.subject_id
                FROM assessment a
                JOIN assessment_institute_mapping aim ON a.id = aim.assessment_id
                WHERE a.id = :assessmentId
                AND aim.institute_id = :instituteId
                LIMIT 1
            )
            SELECT
                ai.created_at AS createdOn,
                ai.bound_start_time AS startDateAndTime,
                ai.bound_end_time AS endDateAndTime,
                ai.duration AS durationInMin,
                ai.subject_id AS subjectId,
                COUNT(la.userId) AS totalParticipants,
                COALESCE(AVG(la.totalTime) FILTER (WHERE la.totalTime IS NOT NULL AND la.totalTime > 0), 0) AS averageDuration,
                COALESCE(AVG(la.achievedMarks), 0) AS averageMarks,
                COUNT(CASE WHEN la.attemptStatus = 'ENDED' THEN 1 END) AS totalAttempted,
                COUNT(CASE WHEN la.attemptStatus = 'LIVE' THEN 1 END) AS totalOngoing
            FROM AssessmentInfo ai
            LEFT JOIN LatestAttempts la ON 1=1
            WHERE la.rn = 1 OR la.rn IS NULL
            GROUP BY ai.created_at, ai.bound_start_time, ai.bound_end_time, ai.duration, ai.subject_id;
            """, nativeQuery = true)
    AssessmentOverviewDto findAssessmentOverviewDetails(@Param("assessmentId") String assessmentId,
                                                        @Param("instituteId") String instituteId);


    @Query(value = """
            SELECT
                a.id AS assessmentId,
                a.name AS assessmentName,
                sa.id AS attemptId,
                a.play_mode AS playMode,
                a.evaluation_type AS evaluationType,
                a.bound_start_time AS startTime,
                a.bound_end_time AS endTime,
                COALESCE(sa.status, 'PENDING') AS attemptStatus,
                sa.created_at AS attemptDate,
                sa.total_time_in_seconds AS durationInSeconds,
                -- Learner list (hideHeldManualMarks = true) -- a manual-result attempt, or any
                -- attempt held PENDING for a teacher, shows no score until released. Admin views pass false.
                -- NB no apostrophes or colons in these comments -- Spring Data parses the
                -- whole string for quotes and parameters and cannot see SQL comments.
                CASE
                    WHEN :hideHeldManualMarks = TRUE
                     AND ((a.result_type = 'MANUAL'
                           AND (sa.report_release_status IS NULL OR sa.report_release_status <> 'RELEASED'))
                          OR sa.report_release_status = 'PENDING')
                    THEN NULL
                    ELSE sa.total_marks
                END AS totalMarks,
                aim.subject_id as subjectId,
                CASE
                    WHEN a.bound_end_time < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN 'ENDED'
                    ELSE 'LIVE'
                END AS assessmentStatus,
                sa.report_release_status AS reportReleaseStatus
            FROM public.assessment a
            LEFT JOIN public.assessment_institute_mapping aim
                ON a.id = aim.assessment_id
            LEFT JOIN public.assessment_user_registration aur
                ON a.id = aur.assessment_id
                AND aur.user_id = :userId
            LEFT JOIN public.student_attempt sa
                ON aur.id = sa.registration_id
                AND sa.id = (
                    SELECT sa_inner.id
                    FROM public.student_attempt sa_inner
                    WHERE sa_inner.registration_id = aur.id
                    ORDER BY sa_inner.created_at DESC
                    LIMIT 1
                )
            WHERE aim.institute_id = :instituteId
            AND COALESCE(sa.status, 'PENDING') IN (:statusList)
            AND (:releaseResultStatus IS NULL OR sa.report_release_status IN (:releaseResultStatus))
            AND (:assessmentType IS NULL OR a.assessment_type IN(:assessmentType))
            and a.status = 'PUBLISHED'
            """, countQuery = """
            SELECT COUNT(*)
            FROM public.assessment a
            LEFT JOIN public.assessment_institute_mapping aim
                ON a.id = aim.assessment_id
            LEFT JOIN public.assessment_user_registration aur
                ON a.id = aur.assessment_id
                AND aur.user_id = :userId
            LEFT JOIN public.student_attempt sa
                ON aur.id = sa.registration_id
                AND sa.id = (
                    SELECT sa_inner.id
                    FROM public.student_attempt sa_inner
                    WHERE sa_inner.registration_id = aur.id
                    ORDER BY sa_inner.created_at DESC
                    LIMIT 1
                )
            WHERE aim.institute_id = :instituteId
            AND COALESCE(sa.status, 'PENDING') IN (:statusList)
            AND (:releaseResultStatus IS NULL OR sa.report_release_status IN (:releaseResultStatus))
            AND (:assessmentType IS NULL OR a.assessment_type IN(:assessmentType))
            and a.status = 'PUBLISHED'
            """, nativeQuery = true)
    Page<StudentReportDto> findAssessmentForUserWithFilter(@Param("hideHeldManualMarks") boolean hideHeldManualMarks,
                                                           @Param("userId") String userId,
                                                           @Param("instituteId") String instituteId,
                                                           @Param("statusList") List<String> statusList,
                                                           @Param("releaseResultStatus") List<String> releaseStatus,
                                                           @Param("assessmentType") List<String> assessmentTypes,
                                                           Pageable pageable);

    /**
     * Learner chatbot: the learner's latest ENDED attempt per published test in an institute,
     * newest first, with NO release filter so the caller can split released results from ones
     * awaiting release (a held MANUAL attempt has a NULL release status, which an IN-list filter
     * cannot express). Same columns as findAssessmentForUserWithFilter; marks of any attempt that
     * is not RELEASED on a MANUAL or NO_AUTO_RELEASE test, or that is held PENDING, are NULL here
     * as well, so a held score never leaves this query.
     */
    @Query(value = """
            SELECT
                a.id AS assessmentId,
                a.name AS assessmentName,
                sa.id AS attemptId,
                a.play_mode AS playMode,
                a.evaluation_type AS evaluationType,
                a.bound_start_time AS startTime,
                a.bound_end_time AS endTime,
                sa.status AS attemptStatus,
                sa.created_at AS attemptDate,
                sa.total_time_in_seconds AS durationInSeconds,
                CASE
                    WHEN sa.report_release_status = 'PENDING'
                      OR (a.result_type IN ('MANUAL', 'NO_AUTO_RELEASE')
                          AND (sa.report_release_status IS NULL OR sa.report_release_status <> 'RELEASED'))
                    THEN NULL
                    ELSE sa.total_marks
                END AS totalMarks,
                aim.subject_id AS subjectId,
                'ENDED' AS assessmentStatus,
                sa.report_release_status AS reportReleaseStatus
            FROM public.assessment a
            JOIN public.assessment_institute_mapping aim
                ON a.id = aim.assessment_id AND aim.institute_id = :instituteId
            JOIN public.assessment_user_registration aur
                ON a.id = aur.assessment_id AND aur.user_id = :userId
            JOIN public.student_attempt sa
                ON aur.id = sa.registration_id
                AND sa.id = (
                    SELECT sa_inner.id
                    FROM public.student_attempt sa_inner
                    WHERE sa_inner.registration_id = aur.id
                    ORDER BY sa_inner.created_at DESC
                    LIMIT 1
                )
            WHERE sa.status = 'ENDED'
              AND a.status = 'PUBLISHED'
            ORDER BY sa.created_at DESC
            LIMIT :maxRows
            """, nativeQuery = true)
    List<StudentReportDto> findLatestEndedAttemptsForLearnerChat(@Param("userId") String userId,
                                                                 @Param("instituteId") String instituteId,
                                                                 @Param("maxRows") int maxRows);


    @Query(value = """
            SELECT
                a.id AS assessmentId,
                a.name AS assessmentName,
                a.play_mode AS playMode,
                a.evaluation_type AS evaluationType,
                sa.id AS attempt_id,
                a.bound_start_time AS startTime,
                a.bound_end_time AS endTime,
                COALESCE(sa.status, 'PENDING') AS attemptStatus,
                sa.created_at AS attemptDate,
                sa.total_time_in_seconds AS durationInSeconds,
                -- Learner list (hideHeldManualMarks = true) -- a manual-result attempt, or any
                -- attempt held PENDING for a teacher, shows no score until released. Admin views pass false.
                -- NB no apostrophes or colons in these comments -- Spring Data parses the
                -- whole string for quotes and parameters and cannot see SQL comments.
                CASE
                    WHEN :hideHeldManualMarks = TRUE
                     AND ((a.result_type = 'MANUAL'
                           AND (sa.report_release_status IS NULL OR sa.report_release_status <> 'RELEASED'))
                          OR sa.report_release_status = 'PENDING')
                    THEN NULL
                    ELSE sa.total_marks
                END AS totalMarks,
                aim.subject_id as subjectId,
                CASE
                    WHEN a.bound_end_time < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN 'ENDED'
                    ELSE 'LIVE'
                END AS assessmentStatus,
                sa.report_release_status AS reportReleaseStatus
            FROM public.assessment a
            LEFT JOIN public.assessment_institute_mapping aim
                ON a.id = aim.assessment_id
            LEFT JOIN public.assessment_user_registration aur
                ON a.id = aur.assessment_id
                AND aur.user_id = :userId
            LEFT JOIN public.student_attempt sa
                ON aur.id = sa.registration_id
                AND sa.id = (
                    SELECT sa_inner.id
                    FROM public.student_attempt sa_inner
                    WHERE sa_inner.registration_id = aur.id
                    ORDER BY sa_inner.created_at DESC
                    LIMIT 1
                )
            WHERE aim.institute_id = :instituteId
            AND (
                    to_tsvector('simple', concat(
                    a.name
                    )) @@ plainto_tsquery('simple', :name)
                    OR a.name LIKE :name || '%'
                   )
            AND COALESCE(sa.status, 'PENDING') IN (:statusList)
            AND (:releaseResultStatus IS NULL OR sa.report_release_status IN (:releaseResultStatus))
            AND (:assessmentType IS NULL OR a.assessment_type IN(:assessmentType))
            and a.status = 'PUBLISHED'
            """, countQuery = """
            SELECT COUNT(*)
            FROM public.assessment a
            LEFT JOIN public.assessment_institute_mapping aim
                ON a.id = aim.assessment_id
            LEFT JOIN public.assessment_user_registration aur
                ON a.id = aur.assessment_id
                AND aur.user_id = :userId
            LEFT JOIN public.student_attempt sa
                ON aur.id = sa.registration_id
                AND sa.id = (
                    SELECT sa_inner.id
                    FROM public.student_attempt sa_inner
                    WHERE sa_inner.registration_id = aur.id
                    ORDER BY sa_inner.created_at DESC
                    LIMIT 1
                )
            WHERE aim.institute_id = :instituteId
            AND (
                    to_tsvector('simple', concat(
                    a.name
                    )) @@ plainto_tsquery('simple', :name)
                    OR a.name LIKE :name || '%'
                   )
            AND COALESCE(sa.status, 'PENDING') IN (:statusList)
            AND (:releaseResultStatus IS NULL OR sa.report_release_status IN (:releaseResultStatus))
            AND (:assessmentType IS NULL OR a.assessment_type IN(:assessmentType))
            and a.status = 'PUBLISHED'
            """, nativeQuery = true)
    Page<StudentReportDto> findAssessmentForUserWithFilterAndSearch(@Param("hideHeldManualMarks") boolean hideHeldManualMarks,
                                                                    @Param("name") String name,
                                                                    @Param("userId") String userId,
                                                                    @Param("instituteId") String instituteId,
                                                                    @Param("statusList") List<String> statusList,
                                                                    @Param("releaseResultStatus") List<String> releaseStatus,
                                                                    @Param("assessmentType") List<String> assessmentTypes,
                                                                    Pageable pageable);

    @Query(value = """
            WITH RankedAttempts AS (
                SELECT
                    sa.id AS attemptId,
                    aur.user_id AS userId,
                    sa.total_time_in_seconds AS completionTimeInSeconds,
                    sa.total_marks AS achievedMarks,
                    aur.status,
                    sa.submit_time AS submitTime,
                    sa.start_time AS startTime,
                    aim.subject_id AS subjectId,
                    ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                JOIN assessment a ON a.id = aur.assessment_id
                JOIN assessment_institute_mapping aim ON aim.assessment_id = a.id
                WHERE aur.assessment_id = :assessmentId
                AND aim.institute_id = :instituteId
                AND sa.status IN ('LIVE', 'ENDED')
                AND aur.status IN ('ACTIVE')
            ),
            TotalParticipants AS (
                SELECT COUNT(*) AS totalParticipants
                FROM assessment_user_registration aur2
                WHERE aur2.assessment_id = :assessmentId
            ),
            AttemptInformation AS (
                SELECT
                    attempt_id,
                    COUNT(*) FILTER (WHERE status = 'CORRECT') AS correct_count,
                    COUNT(*) FILTER (WHERE status = 'INCORRECT') AS wrong_count,
                    COUNT(*) FILTER (WHERE status = 'PARTIAL_CORRECT') AS partial_correct_count,
                    COUNT(*) FILTER (WHERE status IS NULL OR status = 'PENDING') AS skipped_count,
                    COALESCE(SUM(marks) FILTER (WHERE status = 'CORRECT'), 0) AS totalCorrectMarks,
                    COALESCE(SUM(marks) FILTER (WHERE status = 'INCORRECT'), 0) AS totalIncorrectMarks,
                    COALESCE(SUM(marks) FILTER (WHERE status = 'PARTIAL_CORRECT'), 0) AS totalPartialMarks
                FROM question_wise_marks
                WHERE attempt_id = :attemptId
                GROUP BY attempt_id
            ),
            RankedWithTotal AS (
                SELECT
                    attemptId,
                    userId,
                    completionTimeInSeconds,
                    achievedMarks,
                    status,
                    startTime,
                    subjectId,
                    submitTime,
                    DENSE_RANK() OVER (ORDER BY achievedMarks DESC NULLS LAST, completionTimeInSeconds ASC NULLS LAST) AS rank,
                    (SELECT totalParticipants FROM TotalParticipants) AS totalParticipants
                FROM RankedAttempts
                WHERE rn = 1
            )
            SELECT
                tb.attemptId,
                tb.userId,
                tb.completionTimeInSeconds,
                tb.achievedMarks,
                tb.startTime,
                tb.subjectId,
                ROUND(CAST(100.0 * (1.0 - (CAST(tb.rank - 1 AS FLOAT) / NULLIF(tb.totalParticipants * 1.0, 0))) AS NUMERIC), 2) AS percentile,
                ai.correct_count AS correctAttempt,
                ai.wrong_count AS wrongAttempt,
                ai.partial_correct_count AS partialCorrectAttempt,
                ai.skipped_count AS skippedCount,
                ai.totalCorrectMarks,
                ai.totalIncorrectMarks,
                ai.totalPartialMarks,
                tb.rank,
                tb.submitTime
            FROM RankedWithTotal tb
            LEFT JOIN AttemptInformation ai ON tb.attemptId = ai.attempt_id
            WHERE tb.attemptId = :attemptId
            ORDER BY tb.achievedMarks DESC, tb.completionTimeInSeconds ASC;
                        
            """, nativeQuery = true)
    ParticipantsQuestionOverallDetailDto findParticipantsQuestionOverallDetails(@Param("assessmentId") String assessmentId,
                                                                                @Param("instituteId") String instituteId,
                                                                                @Param("attemptId") String attemptId);

    @Query(value = """
            select sa.* from student_attempt sa
            join assessment_user_registration aur on aur.id = sa.registration_id
            join assessment a on a.id = aur.assessment_id
            where a.id = :assessmentId
            and aur.status not in (:statusList)
            """, nativeQuery = true)
    List<StudentAttempt> findAllParticipantsFromAssessmentAndStatusNotIn(@Param("assessmentId") String assessmentId,
                                                                         @Param("statusList") List<String> statusList);

    @Query(value = """
            select sa.* from student_attempt sa
            join assessment_user_registration aur on aur.id = sa.registration_id
            join assessment a on a.id = aur.assessment_id
            where a.id = :assessmentId
            and aur.status not in (:statusList)
            and (sa.report_release_status IS NULL OR sa.report_release_status = 'PENDING')
            """, nativeQuery = true)
    List<StudentAttempt> findAllParticipantsFromAssessmentAndStatusNotInAndReportNotReleased(@Param("assessmentId") String assessmentId,
                                                                                             @Param("statusList") List<String> statusList);


    @Query(value = """
            WITH RankedAttempts AS (
                            SELECT
                                sa.id AS attemptId,
                                aur.user_id AS userId,
                                aur.participant_name AS studentName,
                                aur.source_id AS batchId,
                                sa.total_time_in_seconds AS completionTimeInSeconds,
                                ROUND(CAST(sa.total_marks AS NUMERIC), 2) AS achievedMarks,
                                aur.status,
                                sa.submit_time,
                                ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn,
                                DENSE_RANK() OVER (ORDER BY sa.total_marks DESC NULLS LAST, sa.total_time_in_seconds ASC NULLS LAST) AS rank
                            FROM student_attempt sa
                            JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                            WHERE aur.assessment_id = :assessmentId
                            AND aur.institute_id = :instituteId
                            AND sa.status IN ('LIVE', 'ENDED')
                            AND (:statusList IS NULL OR aur.status IN (:statusList))
                        )
                        ,TotalParticipants AS (
                                        SELECT COUNT(*) AS totalParticipants FROM RankedAttempts WHERE rn = 1
                                    )
                        SELECT
                            rank,
                            attemptId,
                            userId,
                            studentName,
                            batchId,
                            completionTimeInSeconds,
                            achievedMarks,
                            status,
                            ROUND(CAST(100.0 * (1.0 - (CAST(ra.rank - 1 AS FLOAT) / NULLIF(t.totalParticipants * 1.0, 0))) AS NUMERIC), 2) AS percentile
                        FROM RankedAttempts as ra,TotalParticipants as t
                        WHERE rn = 1
                        ORDER BY achievedMarks DESC NULLS LAST, completionTimeInSeconds ASC NULLS LAST
            """, nativeQuery = true)
    public List<LeaderBoardDto> findLeaderBoardForAssessmentAndInstituteId(@Param("assessmentId") String assessmentId,
                                                                           @Param("instituteId") String instituteId,
                                                                           @Param("statusList") List<String> statusList);

    @Query(value = """
            SELECT sa.id as attemptId,
            aur.user_id as userId,
            sa.result_status as evaluationStatus,
            sa.submit_time as submitTime,
            aur.participant_name as participantName
            FROM student_attempt as sa
            JOIN assessment_user_registration aur ON aur.id = sa.registration_id
            JOIN assessment_institute_mapping aim ON aim.assessment_id = aur.assessment_id
            WHERE aim.assessment_id = :assessmentId
            AND aim.institute_id = :instituteId
            AND (LOWER(sa.comma_separated_evaluator_user_ids) LIKE LOWER(CONCAT('%', :userId, '%')))
            AND (:evaluationStatus IS NULL OR sa.result_status IN (:evaluationStatus))
            AND (:name IS NULL OR :name = '' OR LOWER(aur.participant_name) LIKE LOWER(CONCAT('%', :name, '%')))
            AND (sa.status = 'ENDED')
            """, countQuery = """
            SELECT count(*)
            FROM student_attempt as sa
            JOIN assessment_user_registration aur ON aur.id = sa.registration_id
            JOIN assessment_institute_mapping aim ON aim.assessment_id = aur.assessment_id
            WHERE aim.assessment_id = :assessmentId
            AND aim.institute_id = :instituteId
            AND (LOWER(sa.comma_separated_evaluator_user_ids) LIKE LOWER(CONCAT('%', :userId, '%')))
            AND (:evaluationStatus IS NULL OR sa.result_status IN (:evaluationStatus))
            AND (:name IS NULL OR :name = '' OR LOWER(aur.participant_name) LIKE LOWER(CONCAT('%', :name, '%')))
            AND (sa.status = 'ENDED')
            """, nativeQuery = true)
    Page<ManualAttemptResponseDto> findAllAssignedAttemptForUserIdWithFilter(@Param("userId") String userId,
                                                                             @Param("instituteId") String instituteId,
                                                                             @Param("assessmentId") String assessmentId,
                                                                             @Param("name") String name,
                                                                             @Param("evaluationStatus") List<String> evaluationStatus,
                                                                             Pageable pageable);

    List<StudentAttempt> findByStatusNotIn(List<String> name);

    /**
     * Open attempts on assessments that have no clock (practice, survey). One
     * query, so the hourly attempt-end sweep does not walk a lazy
     * registration -> assessment chain per attempt outside a transaction.
     */
    @Query("SELECT sa.id FROM StudentAttempt sa WHERE sa.status NOT IN :statuses "
            + "AND sa.registration.assessment.playMode IN :playModes")
    List<String> findOpenAttemptIdsByPlayModes(@Param("statuses") List<String> statuses,
                                               @Param("playModes") List<String> playModes);

    Optional<StudentAttempt> findTopByRegistrationOrderByCreatedAtDesc(vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration registration);

    /**
     * List the most-recent attempt per assessment for a student within an institute and optional
     * date range, ordered newest first.  Used by the internal student-analysis endpoint.
     *
     * Dates are inclusive bounds on the attempt's EXAM date — COALESCE(submit_time, start_time,
     * created_at). Not created_at alone: bulk-imported offline marks are all created in one
     * import run, so created_at is the import time, not the exam. Pass null to skip either bound.
     */
    @Query(value = """
            SELECT
                a.id              AS assessmentId,
                a.name            AS assessmentName,
                sa.id             AS attemptId,
                COALESCE(sa.submit_time, sa.start_time, sa.created_at) AS attemptDate,
                sa.total_marks    AS totalMarks,
                sa.total_time_in_seconds AS durationInSeconds,
                sa.result_status  AS resultStatus
            FROM public.assessment a
            JOIN public.assessment_institute_mapping aim
                ON aim.assessment_id = a.id
                AND aim.institute_id = :instituteId
            JOIN public.assessment_user_registration aur
                ON aur.assessment_id = a.id
                AND aur.user_id = :userId
            JOIN public.student_attempt sa
                ON sa.registration_id = aur.id
                AND sa.id = (
                    -- Latest ENDED attempt *WITHIN THE REPORT WINDOW*. The window must be applied
                    -- here, not only in the outer WHERE: this subselect used to pick the latest
                    -- ENDED attempt of the learner across ALL TIME, which the outer date predicate
                    -- then rejected, so an assessment sat inside the window vanished from the
                    -- report entirely just because it was retaken after the window closed.
                    SELECT sa_inner.id
                    FROM public.student_attempt sa_inner
                    WHERE sa_inner.registration_id = aur.id
                      AND sa_inner.status = 'ENDED'
                      AND (CAST(:startDate AS timestamp) IS NULL
                           OR COALESCE(sa_inner.submit_time, sa_inner.start_time, sa_inner.created_at) >= CAST(:startDate AS timestamp))
                      AND (CAST(:endDate   AS timestamp) IS NULL
                           OR COALESCE(sa_inner.submit_time, sa_inner.start_time, sa_inner.created_at) <= CAST(:endDate AS timestamp))
                    ORDER BY COALESCE(sa_inner.submit_time, sa_inner.start_time, sa_inner.created_at) DESC, sa_inner.id
                    LIMIT 1
                )
            WHERE a.status = 'PUBLISHED'
              AND sa.status = 'ENDED'
            ORDER BY COALESCE(sa.submit_time, sa.start_time, sa.created_at) DESC, sa.id
            """, nativeQuery = true)
    List<StudentAttemptHistoryProjection> findAssessmentHistoryForUserInDateRange(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate,
            Pageable pageable);

    /**
     * BATCHED sibling of {@link #findAssessmentHistoryForUserInDateRange}: one query for a whole
     * cohort.  Returns one row per userId that has at least one ENDED attempt since {@code since}
     * (users with no attempts simply have no row — never zeros).  Used by the internal
     * student-analysis batch endpoint consumed by admin_core_service's Engagement Engine.
     *
     * <p>Counting/marks semantics mirror the per-user endpoint:
     * <ul>
     *   <li>Only {@code sa.status = 'ENDED'} attempts on PUBLISHED, institute-mapped assessments.
     *   <li>Per-attempt percentage = {@code sa.total_marks / SUM(section.total_marks)} * 100,
     *       where achievable marks are summed over non-DELETED sections of the assessment —
     *       the same basis {@code LearnerReportService.buildComparisonData} uses.  Attempts whose
     *       marks cannot be computed reliably (null earned marks or achievable sum <= 0) are
     *       excluded from the average via CASE→NULL (AVG ignores NULLs); if none are computable
     *       the average itself is NULL — never the 100-marks fallback the comparison path uses.
     * </ul>
     */
    @Query(value = """
            WITH attempts AS (
                SELECT
                    aur.user_id     AS user_id,
                    sa.id           AS attempt_id,
                    sa.created_at   AS attempt_at,
                    sa.total_marks  AS earned_marks,
                    a.id            AS assessment_id,
                    a.name          AS assessment_name
                FROM public.student_attempt sa
                JOIN public.assessment_user_registration aur
                    ON aur.id = sa.registration_id
                    AND aur.user_id IN (:userIds)
                JOIN public.assessment a
                    ON a.id = aur.assessment_id
                    AND a.status = 'PUBLISHED'
                JOIN public.assessment_institute_mapping aim
                    ON aim.assessment_id = a.id
                    AND aim.institute_id = :instituteId
                WHERE sa.status = 'ENDED'
                  AND sa.created_at >= :since
            ),
            achievable AS (
                SELECT s.assessment_id       AS assessment_id,
                       SUM(s.total_marks)    AS total_achievable
                FROM public.section s
                WHERE s.status <> 'DELETED'
                  AND s.assessment_id IN (SELECT DISTINCT assessment_id FROM attempts)
                GROUP BY s.assessment_id
            )
            SELECT
                t.user_id           AS userId,
                COUNT(*)            AS attemptCount,
                MAX(t.attempt_at)   AS lastAttemptAt,
                AVG(CASE
                        WHEN t.earned_marks IS NOT NULL AND ach.total_achievable > 0
                        THEN (t.earned_marks / ach.total_achievable) * 100.0
                    END)            AS avgPercentage,
                (ARRAY_AGG(t.assessment_name ORDER BY t.attempt_at DESC, t.attempt_id DESC))[1]
                                    AS lastAssessmentName
            FROM attempts t
            LEFT JOIN achievable ach ON ach.assessment_id = t.assessment_id
            GROUP BY t.user_id
            """, nativeQuery = true)
    List<UserAssessmentHistorySummaryProjection> findAssessmentHistorySummaryForUsersSince(
            @Param("instituteId") String instituteId,
            @Param("userIds") List<String> userIds,
            @Param("since") Date since);

    @Query(value = """
            SELECT sa.* FROM student_attempt sa
            JOIN assessment_user_registration aur ON aur.id = sa.registration_id
            JOIN assessment a ON a.id = aur.assessment_id
            WHERE a.result_type = 'AUTO_AFTER_ASSESSMENT_END'
            AND COALESCE(a.omr_mode, false) = false
            AND CURRENT_TIMESTAMP AT TIME ZONE 'UTC' > a.bound_end_time
            AND sa.status = 'ENDED'
            AND sa.result_status = 'COMPLETED'
            AND (sa.report_release_status IS NULL OR sa.report_release_status = 'PENDING')
            """, nativeQuery = true)
    List<StudentAttempt> findUnreleasedAttemptsForEndedAutoReleaseAssessments();
}



