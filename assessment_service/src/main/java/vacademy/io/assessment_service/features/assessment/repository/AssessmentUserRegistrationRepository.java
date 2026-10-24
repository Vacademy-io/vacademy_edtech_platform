package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.dto.ParticipantsDetailsDto;
import vacademy.io.assessment_service.features.assessment.dto.RegistrationCustomFieldAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.RespondentListDto;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;

import java.util.List;
import java.util.Optional;

public interface AssessmentUserRegistrationRepository extends JpaRepository<AssessmentUserRegistration, String> {
    @Modifying
    @Transactional
    @Query(value = "UPDATE assessment_user_registration SET status = 'DELETED' WHERE assessment_id = ?1 AND user_id IN ?2 AND (institute_id = ?3 OR ?3 IS NULL AND institute_id IS NULL)", nativeQuery = true)
    void softDeleteByAssessmentIdAndUserIdsAndInstituteId(String assessmentId, List<String> userIds, String instituteId);

    @Modifying
    @Transactional
    @Query(value = "DELETE FROM assessment_user_registration WHERE assessment_id = ?1 AND user_id IN ?2 AND (institute_id = ?3 OR ?3 IS NULL AND institute_id IS NULL)", nativeQuery = true)
    void hardDeleteByAssessmentIdAndUserIdsAndInstituteId(String assessmentId, List<String> userIds, String instituteId);

    /**
     * User ids that already have an attempt for this assessment — the set subtracted from
     * batch enrollment to get "has not attempted".
     *
     * <p>Any attempt counts, whatever its status: a learner who opened the paper is not
     * someone who "never tried". Restricted to batch-sourced registrations because that
     * is the only tab this feeds; individual/open participants already get a real
     * registration row and are handled by the existing Pending queries.
     *
     * <p>EXISTS rather than a JOIN: the join fanned out to one row per attempt only to
     * have DISTINCT collapse them again (60 rows down to 40 on prod), and the semi-join
     * lets Postgres stop at the first attempt per registration. It is also the form that
     * benefits automatically once {@code idx_sa_registration} on
     * {@code student_attempt(registration_id)} is usable again — that index is currently
     * INVALID in prod (a failed CREATE INDEX CONCURRENTLY), which is why this still falls
     * back to a sequential scan of student_attempt.
     */
    @Query(value = """
            SELECT DISTINCT aur.user_id
            FROM assessment_user_registration aur
            WHERE aur.assessment_id = :assessmentId
              AND aur.institute_id = :instituteId
              AND aur.source = 'BATCH_PREVIEW_REGISTRATION'
              AND EXISTS (SELECT 1 FROM student_attempt sa WHERE sa.registration_id = aur.id)
            """, nativeQuery = true)
    List<String> findAttemptedUserIdsForBatchAssessment(@Param("assessmentId") String assessmentId,
                                                        @Param("instituteId") String instituteId);

    @Query("SELECT a FROM AssessmentUserRegistration a WHERE a.username = :username AND a.instituteId = :instituteId ORDER BY a.createdAt DESC LIMIT 1")
    Optional<AssessmentUserRegistration> findTopByUserNameAndInstituteId(@Param("username") String username, @Param("instituteId") String instituteId);

    @Query(value = "SELECT * FROM assessment_user_registration a WHERE a.user_id = :userId AND a.assessment_id = :assessmentId ORDER BY a.created_at DESC", nativeQuery = true)
    Optional<AssessmentUserRegistration> findTopByUserIdAndAssessmentId(@Param("userId") String userId, @Param("assessmentId") String assessmentId);

    @Query(value = """
            select aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName, sa.start_time as attemptDate, sa.submit_time as endTime, sa.total_time_in_seconds as duration, sa.result_marks as score, aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username, aur.source_id as batchId,
             sa.report_release_status as reportReleaseResultStatus,
            sa.report_last_release_date as lastReportReleaseDate,
            sa.result_status as evaluationStatus from assessment_user_registration aur
            JOIN (
                SELECT DISTINCT ON (registration_id) *
                FROM student_attempt
                ORDER BY registration_id, submit_time DESC
            ) sa ON sa.registration_id = aur.id
            where aur.assessment_id = :assessmentId
            and aur.institute_id = :instituteId
            AND (:status IS NULL OR aur.status IN (:status))
            AND (:batchIds IS NULL OR aur.source_id IN (:batchIds))
            AND aur.source = 'BATCH_PREVIEW_REGISTRATION'
            AND (:status IS NULL OR sa.status IN (:attemptType))
            AND ('__ALL__' IN (:evaluationStatus) OR sa.result_status IN (:evaluationStatus))
            AND ('__ALL__' IN (:submissionStatus) OR (CASE WHEN COALESCE(NULLIF(CAST(sa.attempt_data AS jsonb) ->> 'fileId', ''), NULLIF(sa.evaluated_file_id, '')) IS NOT NULL THEN 'SUBMITTED' ELSE 'NOT_SUBMITTED' END) IN (:submissionStatus))
            """,
            countQuery = """
                    select count(*)
                    from assessment_user_registration aur
                    JOIN (
                        SELECT DISTINCT ON (registration_id) *
                        FROM student_attempt
                        ORDER BY registration_id, submit_time DESC
                    ) sa ON sa.registration_id = aur.id
                    where aur.assessment_id = :assessmentId
                    and aur.institute_id = :instituteId
                    AND (:status IS NULL OR aur.status IN (:status))
                    AND (:batchIds IS NULL OR aur.source_id IN (:batchIds))
                    AND aur.source = 'BATCH_PREVIEW_REGISTRATION'
                    AND (:status IS NULL OR sa.status IN (:attemptType))
                    AND ('__ALL__' IN (:evaluationStatus) OR sa.result_status IN (:evaluationStatus))
                    AND ('__ALL__' IN (:submissionStatus) OR (CASE WHEN COALESCE(NULLIF(CAST(sa.attempt_data AS jsonb) ->> 'fileId', ''), NULLIF(sa.evaluated_file_id, '')) IS NOT NULL THEN 'SUBMITTED' ELSE 'NOT_SUBMITTED' END) IN (:submissionStatus))
                    """, nativeQuery = true)
    Page<ParticipantsDetailsDto> findUserRegistrationWithFilterForBatch(@Param("assessmentId") String assessmentId,
                                                                        @Param("instituteId") String instituteId,
                                                                        @Param("batchIds") List<String> batchIds,
                                                                        @Param("status") List<String> status,
                                                                        @Param("attemptType") List<String> attemptType,
                                                                        @Param("evaluationStatus") List<String> evaluationStatus,
                                                                        @Param("submissionStatus") List<String> submissionStatus,
                                                                        Pageable pageable);

    @Query(value = """
            select aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName, sa.start_time as attemptDate, sa.submit_time as endTime, sa.total_time_in_seconds as duration, sa.result_marks as score, aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username, aur.source_id as batchId from assessment_user_registration aur
            join student_attempt sa on sa.registration_id = aur.id
            where aur.assessment_id = :assessmentId
            and aur.institute_id = :instituteId
            AND (:status IS NULL OR aur.status IN (:status))
            AND (:batchIds IS NULL OR aur.source_id IN (:batchIds))
            AND aur.source = 'BATCH_PREVIEW_REGISTRATION'
            AND (:status IS NULL OR sa.status IN (:attemptType))
            ORDER BY aur.participant_name ASC, aur.id ASC, sa.id ASC
            """,
            countQuery = """
                    select count(*)
                    from assessment_user_registration aur
                    join student_attempt sa on sa.registration_id = aur.id
                    where aur.assessment_id = :assessmentId
                    and aur.institute_id = :instituteId
                    AND (:status IS NULL OR aur.status IN (:status))
                    AND (:batchIds IS NULL OR aur.source_id IN (:batchIds))
                    AND aur.source = 'BATCH_PREVIEW_REGISTRATION'
                    AND (:status IS NULL OR sa.status IN (:attemptType))
                    """, nativeQuery = true)
    List<ParticipantsDetailsDto> findUserRegistrationWithFilterForBatchForExport(@Param("assessmentId") String assessmentId,
                                                                                 @Param("instituteId") String instituteId,
                                                                                 @Param("batchIds") List<String> batchIds,
                                                                                 @Param("status") List<String> status,
                                                                                 @Param("attemptType") List<String> attemptType);


    @Query(value = """
            SELECT aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName,
                   sa.start_time as attemptDate, sa.submit_time as endTime,
                   sa.total_time_in_seconds as duration, sa.result_marks as score,
                   aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username, aur.source_id as batchId,
                   sa.report_release_status as reportReleaseResultStatus,
                sa.report_last_release_date as lastReportReleaseDate,
                sa.result_status as evaluationStatus
            FROM assessment_user_registration aur
            JOIN (
                SELECT DISTINCT ON (registration_id) *
                FROM student_attempt
                ORDER BY registration_id, submit_time DESC
            ) sa ON sa.registration_id = aur.id
            WHERE aur.assessment_id = :assessmentId
            AND aur.institute_id = :instituteId
            AND (
                to_tsvector('simple', aur.participant_name) @@ plainto_tsquery('simple', :name)
                OR aur.participant_name LIKE :name || '%'
            )
            AND (:status IS NULL OR aur.status IN (:status))
            AND (:batchIds IS NULL OR aur.source_id IN (:batchIds))
            AND aur.source = 'BATCH_PREVIEW_REGISTRATION'
            AND (:attemptType IS NULL OR sa.status IN (:attemptType))
            AND ('__ALL__' IN (:evaluationStatus) OR sa.result_status IN (:evaluationStatus))
            AND ('__ALL__' IN (:submissionStatus) OR (CASE WHEN COALESCE(NULLIF(CAST(sa.attempt_data AS jsonb) ->> 'fileId', ''), NULLIF(sa.evaluated_file_id, '')) IS NOT NULL THEN 'SUBMITTED' ELSE 'NOT_SUBMITTED' END) IN (:submissionStatus))
            """,
            countQuery = """
                    SELECT COUNT(*)
                    FROM assessment_user_registration aur
                    JOIN (
                        SELECT DISTINCT ON (registration_id) *
                        FROM student_attempt
                        ORDER BY registration_id, submit_time DESC
                    ) sa ON sa.registration_id = aur.id
                    WHERE aur.assessment_id = :assessmentId
                    AND aur.institute_id = :instituteId
                    AND (
                        to_tsvector('simple', aur.participant_name) @@ plainto_tsquery('simple', :name)
                        OR aur.participant_name LIKE :name || '%'
                    )
                    AND (:status IS NULL OR aur.status IN (:status))
                    AND (:batchIds IS NULL OR aur.source_id IN (:batchIds))
                    AND aur.source = 'BATCH_PREVIEW_REGISTRATION'
                    AND (:attemptType IS NULL OR sa.status IN (:attemptType))
                    AND ('__ALL__' IN (:evaluationStatus) OR sa.result_status IN (:evaluationStatus))
                    AND ('__ALL__' IN (:submissionStatus) OR (CASE WHEN COALESCE(NULLIF(CAST(sa.attempt_data AS jsonb) ->> 'fileId', ''), NULLIF(sa.evaluated_file_id, '')) IS NOT NULL THEN 'SUBMITTED' ELSE 'NOT_SUBMITTED' END) IN (:submissionStatus))
                    """,
            nativeQuery = true)
    Page<ParticipantsDetailsDto> findUserRegistrationWithFilterWithSearchForBatch(
            @Param("name") String name,
            @Param("assessmentId") String assessmentId,
            @Param("instituteId") String instituteId,
            @Param("batchIds") List<String> batchIds,
            @Param("status") List<String> status,
            @Param("attemptType") List<String> attemptType,
            @Param("evaluationStatus") List<String> evaluationStatus,
            @Param("submissionStatus") List<String> submissionStatus,
            Pageable pageable
    );


    @Query(value = """
            select aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName, sa.start_time as attemptDate, sa.submit_time as endTime, sa.total_time_in_seconds as duration, sa.result_marks as score, aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username,
              sa.report_release_status as reportReleaseResultStatus,
            sa.report_last_release_date as lastReportReleaseDate,
            aur.source_id as batchId,
            sa.result_status as evaluationStatus from assessment_user_registration aur
            join student_attempt sa on sa.registration_id = aur.id
            where aur.assessment_id = :assessmentId
            and aur.institute_id = :instituteId
            AND (:status IS NULL OR aur.status IN (:status))
            AND aur.source = :source
            AND (:status IS NULL OR sa.status IN (:attemptType))
            AND ('__ALL__' IN (:evaluationStatus) OR sa.result_status IN (:evaluationStatus))
            AND ('__ALL__' IN (:submissionStatus) OR (CASE WHEN COALESCE(NULLIF(CAST(sa.attempt_data AS jsonb) ->> 'fileId', ''), NULLIF(sa.evaluated_file_id, '')) IS NOT NULL THEN 'SUBMITTED' ELSE 'NOT_SUBMITTED' END) IN (:submissionStatus))
            """,
            countQuery = """
                    select count(distinct aur.user_id)
                    from assessment_user_registration aur
                    join student_attempt sa on sa.registration_id = aur.id
                    where aur.assessment_id = :assessmentId
                    and aur.institute_id = :instituteId
                    AND (:status IS NULL OR aur.status IN (:status))
                    AND aur.source = :source
                    AND (:status IS NULL OR sa.status IN (:attemptType))
                    AND ('__ALL__' IN (:evaluationStatus) OR sa.result_status IN (:evaluationStatus))
                    AND ('__ALL__' IN (:submissionStatus) OR (CASE WHEN COALESCE(NULLIF(CAST(sa.attempt_data AS jsonb) ->> 'fileId', ''), NULLIF(sa.evaluated_file_id, '')) IS NOT NULL THEN 'SUBMITTED' ELSE 'NOT_SUBMITTED' END) IN (:submissionStatus))
                    """, nativeQuery = true)
    Page<ParticipantsDetailsDto> findUserRegistrationWithFilterForSource(@Param("assessmentId") String assessmentId,
                                                                         @Param("instituteId") String instituteId,
                                                                         @Param("status") List<String> status,
                                                                         @Param("attemptType") List<String> attemptType,
                                                                         @Param("source") String source,
                                                                         @Param("evaluationStatus") List<String> evaluationStatus,
                                                                         @Param("submissionStatus") List<String> submissionStatus,
                                                                         Pageable pageable);

    @Query(value = """
            select aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName, sa.start_time as attemptDate, sa.submit_time as endTime, sa.total_time_in_seconds as duration, sa.result_marks as score, aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username  from assessment_user_registration aur
            join student_attempt sa on sa.registration_id = aur.id
            where aur.assessment_id = :assessmentId
            and aur.institute_id = :instituteId
            AND (:status IS NULL OR aur.status IN (:status))
            AND aur.source = :source
            AND (:status IS NULL OR sa.status IN (:attemptType))
            ORDER BY aur.participant_name ASC, aur.id ASC, sa.id ASC
            """,
            countQuery = """
                    select count(distinct aur.user_id)
                    from assessment_user_registration aur
                    join student_attempt sa on sa.registration_id = aur.id
                    where aur.assessment_id = :assessmentId
                    and aur.institute_id = :instituteId
                    AND (:status IS NULL OR aur.status IN (:status))
                    AND aur.source = :source
                    AND (:status IS NULL OR sa.status IN (:attemptType))
                    """, nativeQuery = true)
    List<ParticipantsDetailsDto> findUserRegistrationWithFilterForSourceExport(@Param("assessmentId") String assessmentId,
                                                                               @Param("instituteId") String instituteId,
                                                                               @Param("status") List<String> status,
                                                                               @Param("attemptType") List<String> attemptType,
                                                                               @Param("source") String source);


    @Query(value = """
              select aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName, sa.start_time as attemptDate, sa.submit_time as endTime, sa.total_time_in_seconds as duration, sa.result_marks as score, aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username,
                sa.report_release_status as reportReleaseResultStatus,
              sa.report_last_release_date as lastReportReleaseDate,
              sa.result_status as evaluationStatus from assessment_user_registration aur
              join student_attempt sa on sa.registration_id = aur.id
              where aur.assessment_id = :assessmentId
              and aur.institute_id = :instituteId
              AND (
              to_tsvector('simple', concat(
                aur.participant_name
              )) @@ plainto_tsquery('simple', :name)
              OR aur.participant_name LIKE :name || '%'
            )
              AND (:status IS NULL OR aur.status IN (:status))
              AND aur.source = :source
              AND (:status IS NULL OR sa.status IN (:attemptType))
              AND ('__ALL__' IN (:evaluationStatus) OR sa.result_status IN (:evaluationStatus))
              AND ('__ALL__' IN (:submissionStatus) OR (CASE WHEN COALESCE(NULLIF(CAST(sa.attempt_data AS jsonb) ->> 'fileId', ''), NULLIF(sa.evaluated_file_id, '')) IS NOT NULL THEN 'SUBMITTED' ELSE 'NOT_SUBMITTED' END) IN (:submissionStatus))
            """,
            countQuery = """
                     select count(distinct aur.user_id)
                     from assessment_user_registration aur
                     join student_attempt sa on sa.registration_id = aur.id
                     where aur.assessment_id = :assessmentId
                     and aur.institute_id = :instituteId
                     AND (
                     to_tsvector('simple', concat(
                     aur.participant_name
                     )) @@ plainto_tsquery('simple', :name)
                     OR aur.participant_name LIKE :name || '%'
                    )
                     AND (:status IS NULL OR aur.status IN (:status))
                     AND aur.source = :source
                     AND (:status IS NULL OR sa.status IN (:attemptType))
                     AND ('__ALL__' IN (:evaluationStatus) OR sa.result_status IN (:evaluationStatus))
                     AND ('__ALL__' IN (:submissionStatus) OR (CASE WHEN COALESCE(NULLIF(CAST(sa.attempt_data AS jsonb) ->> 'fileId', ''), NULLIF(sa.evaluated_file_id, '')) IS NOT NULL THEN 'SUBMITTED' ELSE 'NOT_SUBMITTED' END) IN (:submissionStatus))
                    """, nativeQuery = true)
    Page<ParticipantsDetailsDto> findUserRegistrationWithFilterWithSearchForSource(@Param("name") String name,
                                                                                   @Param("assessmentId") String assessmentId,
                                                                                   @Param("instituteId") String instituteId,
                                                                                   @Param("status") List<String> status,
                                                                                   @Param("attemptType") List<String> attemptType,
                                                                                   @Param("source") String source,
                                                                                   @Param("evaluationStatus") List<String> evaluationStatus,
                                                                                   @Param("submissionStatus") List<String> submissionStatus,
                                                                                   Pageable pageable);


    @Query(value = """
            select aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName, sa.start_time as attemptDate, sa.submit_time as endTime, sa.total_time_in_seconds as duration, sa.result_marks as score, aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username,
            sa.report_release_status as reportReleaseResultStatus,
            sa.report_last_release_date as lastReportReleaseDate,
            sa.result_status as evaluationStatus FROM assessment_user_registration aur
            LEFT JOIN student_attempt sa ON aur.id = sa.registration_id
            where aur.assessment_id = :assessmentId
            and aur.institute_id = :instituteId
            and sa.id IS NULL
            AND aur.source = :source
            AND (:status IS NULL OR aur.status IN (:status))
            """,
            countQuery = """
                            select count(distinct aur.user_id)
                            FROM assessment_user_registration aur
                    LEFT JOIN student_attempt sa ON aur.id = sa.registration_id
                    where aur.assessment_id = :assessmentId
                    and aur.institute_id = :instituteId
                    and sa.id IS NULL
                    AND aur.source = :source
                    AND (:status IS NULL OR aur.status IN (:status))
                    """, nativeQuery = true)
    Page<ParticipantsDetailsDto> findUserRegistrationWithFilterAdminPreRegistrationAndPending(@Param("assessmentId") String assessmentId,
                                                                                              @Param("instituteId") String instituteId,
                                                                                              @Param("status") List<String> status,
                                                                                              @Param("source") String source,
                                                                                              Pageable pageable);

    @Query(value = """
            select aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName, sa.start_time as attemptDate, sa.submit_time as endTime, sa.total_time_in_seconds as duration, sa.result_marks as score, aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username
            FROM assessment_user_registration aur
            LEFT JOIN student_attempt sa ON aur.id = sa.registration_id
            where aur.assessment_id = :assessmentId
            and aur.institute_id = :instituteId
            and sa.id IS NULL
            AND aur.source = :source
            AND (:status IS NULL OR aur.status IN (:status))
            ORDER BY aur.participant_name ASC, aur.id ASC
            """, nativeQuery = true)
    List<ParticipantsDetailsDto> findUserRegistrationWithFilterAdminPreRegistrationAndPendingExport(@Param("assessmentId") String assessmentId,
                                                                                                    @Param("instituteId") String instituteId,
                                                                                                    @Param("status") List<String> status,
                                                                                                    @Param("source") String source);


    @Query(value = """
              select aur.id as registrationId, sa.id as attemptId, aur.participant_name as studentName, sa.start_time as attemptDate, sa.submit_time as endTime, sa.total_time_in_seconds as duration, sa.result_marks as score, aur.user_id as userId, aur.user_email as userEmail, aur.phone_number as phoneNumber, aur.username as username,
              sa.report_release_status as reportReleaseResultStatus,
              sa.report_last_release_date as lastReportReleaseDate,
              sa.result_status as evaluationStatus FROM assessment_user_registration aur
              LEFT JOIN student_attempt sa ON aur.id = sa.registration_id
              where aur.assessment_id = :assessmentId
              and aur.institute_id = :instituteId
              AND (
              to_tsvector('simple', concat(
                aur.participant_name
              )) @@ plainto_tsquery('simple', :name)
              OR aur.participant_name LIKE :name || '%'
            )
              AND (:status IS NULL OR aur.status IN (:status))
              AND aur.source = :source
            """,
            countQuery = """
                            select count(distinct aur.user_id)
                            FROM assessment_user_registration aur
                    LEFT JOIN student_attempt sa ON aur.id = sa.registration_id
                    where aur.assessment_id = :assessmentId
                    and aur.institute_id = :instituteId
                            AND (
                            to_tsvector('simple', concat(
                            aur.participant_name
                            )) @@ plainto_tsquery('simple', :name)
                            OR aur.participant_name LIKE :name || '%'
                           )
                            AND (:status IS NULL OR aur.status IN (:status))
                            AND aur.source = :source
                    """, nativeQuery = true)
    Page<ParticipantsDetailsDto> findUserRegistrationWithFilterWithSearchForPreRegistrationAndPending(@Param("name") String name,
                                                                                                      @Param("assessmentId") String assessmentId,
                                                                                                      @Param("instituteId") String instituteId,
                                                                                                      @Param("status") List<String> status,
                                                                                                      @Param("source") String source,
                                                                                                      Pageable pageable);

    @Query("SELECT COUNT(DISTINCT a.assessment.id) FROM AssessmentUserRegistration a WHERE a.userId = :userId AND a.instituteId = :instituteId")
    Integer countDistinctAssessmentsByUserId(String userId, String instituteId);

    @Query(value = """
            select count(distinct aur.id) from assessment_user_registration aur
            where aur.assessment_id = :assessmentId
            and (:statusList IS NULL OR aur.status NOT IN (:statusList))
            """, nativeQuery = true)
    Long countUserRegisteredForAssessment(@Param("assessmentId") String assessmentId,
                                          @Param("statusList") List<String> status);

    @Query("SELECT COUNT(DISTINCT aur.assessment.id) " +
            "FROM AssessmentUserRegistration aur " +
            "JOIN aur.assessment a " +
            "WHERE aur.userId = :userId " +
            "AND aur.instituteId = :instituteId " +
            "AND aur.status IN :statusList " +
            "AND aur.source IN :sourceList " +
            "AND a.status IN :assessmentStatus " +
            "AND (a.boundEndTime >= CURRENT_TIMESTAMP)")
    Integer countDistinctAssessmentsByUserAndFilters(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("statusList") List<String> statusList,
            @Param("sourceList") List<String> sourceList,
            @Param("assessmentStatus") List<String> assessmentStatus
    );

    @Query("SELECT aur FROM AssessmentUserRegistration aur WHERE aur.assessment.id = :assessmentId AND aur.status IN :statuses")
    List<AssessmentUserRegistration> findByInstituteIdAndAssessmentIdAndStatusIn(
            @Param("assessmentId") String assessmentId,
            @Param("statuses") List<String> statuses
    );

    @Query(value = """
            SELECT\s
                aur.id AS registrationId,
                aur.user_id AS userId,
                aur.participant_name AS participantName,
                latest_sa.id AS attemptId,
                aur.source AS source,
                qwm.time_taken_in_seconds AS responseTimeInSeconds,
                aur.source_id AS sourceId,
                COALESCE(NULLIF(qwm.status, 'PENDING'), 'PENDING') AS status
            FROM assessment_user_registration aur
            JOIN (
                SELECT DISTINCT ON (registration_id) *
                FROM student_attempt
                ORDER BY registration_id, submit_time DESC
            ) latest_sa ON latest_sa.registration_id = aur.id
            JOIN question_wise_marks qwm ON qwm.attempt_id = latest_sa.id
            JOIN assessment a ON a.id = aur.assessment_id
            WHERE qwm.question_id = :questionId
              AND qwm.assessment_id = :assessmentId
              AND COALESCE(qwm.status, 'PENDING') IN (:attemptStatus)
              AND a.assessment_visibility IN (:assessmentVisibility)
              AND aur."source" IN (:source)
              AND (:sourceId IS NULL OR aur.source_id IN (:sourceId))
            """, countQuery = """
            SELECT count(*)
            FROM assessment_user_registration aur
            JOIN (
                SELECT DISTINCT ON (registration_id) *
                FROM student_attempt
                ORDER BY registration_id, submit_time DESC
            ) latest_sa ON latest_sa.registration_id = aur.id
            JOIN question_wise_marks qwm ON qwm.attempt_id = latest_sa.id
            JOIN assessment a ON a.id = aur.assessment_id
            WHERE qwm.question_id = :questionId
            AND qwm.assessment_id = :assessmentId
            AND COALESCE(qwm.status, 'PENDING') IN (:attemptStatus)
            and a.assessment_visibility in (:assessmentVisibility)
            and aur."source" in (:source)
            and (:sourceId IS NULL OR aur.source_id in (:sourceId))
            """, nativeQuery = true)
    Page<RespondentListDto> findRespondentListForAssessmentWithFilter(@Param("assessmentId") String assessmentId,
                                                                      @Param("questionId") String questionId,
                                                                      @Param("assessmentVisibility") List<String> assessmentVisibility,
                                                                      @Param("attemptStatus") List<String> attemptStatus,
                                                                      @Param("source") List<String> source,
                                                                      @Param("sourceId") List<String> sourceId,
                                                                      Pageable pageable);

    @Query(value = """
            SELECT aur.id as registrationId, aur.user_id AS userId, aur.participant_name as participantName,\s
            sa.id AS attemptId,
            aur.source as source,
            qwm.time_taken_in_seconds as responseTimeInSeconds,
            aur.source_id as sourceId,
                   COALESCE(NULLIF(qwm.status, 'PENDING'), 'PENDING') AS status
            FROM assessment_user_registration aur
            JOIN student_attempt sa ON sa.registration_id = aur.id
            JOIN question_wise_marks qwm ON qwm.attempt_id = sa.id
            join assessment a on a.id = aur.assessment_id
            WHERE qwm.question_id = :questionId
            AND qwm.assessment_id = :assessmentId
            AND COALESCE(qwm.status, 'PENDING') IN (:attemptStatus)
            and a.assessment_visibility in (:assessmentVisibility)
            and aur."source" in (:source)
            and (:sourceId IS NULL OR aur.source_id in (:sourceId))
            ORDER BY aur.participant_name ASC, aur.id ASC, sa.id ASC
            """, nativeQuery = true)
    List<RespondentListDto> findRespondentListForAssessmentWithFilterExport(@Param("assessmentId") String assessmentId,
                                                                            @Param("questionId") String questionId,
                                                                            @Param("assessmentVisibility") List<String> assessmentVisibility,
                                                                            @Param("attemptStatus") List<String> attemptStatus,
                                                                            @Param("source") List<String> source,
                                                                            @Param("sourceId") List<String> sourceId);


    @Query(value = """
              SELECT\s
                  aur.id AS registrationId,
                  aur.user_id AS userId,
                  aur.participant_name AS participantName,
                  sa.id AS attemptId,
                  aur.source AS source,
                  qwm.time_taken_in_seconds AS responseTimeInSeconds,
                  aur.source_id AS sourceId,
                  COALESCE(NULLIF(qwm.status, 'PENDING'), 'PENDING') AS status
              FROM assessment_user_registration aur
              JOIN (
                  SELECT DISTINCT ON (registration_id) *
                  FROM student_attempt
                  ORDER BY registration_id, submit_time DESC
              ) sa ON sa.registration_id = aur.id
              JOIN question_wise_marks qwm ON qwm.attempt_id = sa.id
              JOIN assessment a ON a.id = aur.assessment_id
              WHERE qwm.question_id = :questionId
                AND qwm.assessment_id = :assessmentId
                AND (
                      to_tsvector('simple', concat(aur.participant_name)) @@ plainto_tsquery('simple', :name)
                      OR aur.participant_name ILIKE :name || '%'
                    )
                AND COALESCE(qwm.status, 'PENDING') IN (:attemptStatus)
                AND a.assessment_visibility IN (:assessmentVisibility)
                AND aur."source" IN (:source)
                AND (:sourceId IS NULL OR aur.source_id IN (:sourceId))
            
            """, countQuery = """
              SELECT count(*)
              FROM assessment_user_registration aur
              JOIN (
                  SELECT DISTINCT ON (registration_id) *
                  FROM student_attempt
                  ORDER BY registration_id, submit_time DESC
              ) sa ON sa.registration_id = aur.id
              JOIN question_wise_marks qwm ON qwm.attempt_id = sa.id
              JOIN assessment a ON a.id = aur.assessment_id
              WHERE qwm.question_id = :questionId
              AND qwm.assessment_id = :assessmentId
              AND (
                    to_tsvector('simple', concat(aur.participant_name)) @@ plainto_tsquery('simple', :name)
                    OR aur.participant_name ILIKE :name || '%'
                )
              AND COALESCE(qwm.status, 'PENDING') IN (:attemptStatus)
              and a.assessment_visibility in (:assessmentVisibility)
              and aur."source" in (:source)
              and (:sourceId IS NULL OR aur.source_id in (:sourceId))
            """, nativeQuery = true)
    Page<RespondentListDto> findRespondentListForAssessmentWithFilterAndSearch(@Param("name") String name,
                                                                               @Param("assessmentId") String assessmentId,
                                                                               @Param("questionId") String questionId,
                                                                               @Param("assessmentVisibility") List<String> assessmentVisibility,
                                                                               @Param("attemptStatus") List<String> attemptStatus,
                                                                               @Param("source") List<String> source,
                                                                               @Param("sourceId") List<String> sourceId,
                                                                               Pageable pageable);

    boolean existsByInstituteIdAndAssessmentIdAndUserId(String instituteId, String assessmentId, String userId);

    // Fetch ALL completed attempts for an assessment across every registration
    // source (batch, open registration, admin pre-registration).  Used by the
    // result CSV export so the admin gets one unified file regardless of how
    // each learner enrolled.
    @Query(value = """
            SELECT aur.id            AS registrationId,
                   sa.id             AS attemptId,
                   aur.participant_name AS studentName,
                   aur.user_email    AS userEmail,
                   aur.phone_number  AS phoneNumber,
                   aur.username      AS username,
                   sa.start_time     AS attemptDate,
                   sa.submit_time    AS endTime,
                   sa.total_time_in_seconds AS duration,
                   COALESCE(sa.result_marks, sa.total_marks) AS score,
                   sa.total_marks    AS rankMarks,
                   aur.user_id       AS userId,
                   aur.source_id     AS batchId,
                   sa.report_release_status     AS reportReleaseResultStatus,
                   sa.report_last_release_date  AS lastReportReleaseDate,
                   sa.result_status             AS evaluationStatus
            FROM assessment_user_registration aur
            JOIN student_attempt sa ON sa.registration_id = aur.id
            WHERE aur.assessment_id = :assessmentId
              AND aur.institute_id  = :instituteId
              AND aur.status NOT IN ('DELETED')
              AND sa.status         = 'ENDED'
            ORDER BY sa.total_marks DESC NULLS LAST, sa.total_time_in_seconds ASC NULLS LAST
            """, nativeQuery = true)
    List<vacademy.io.assessment_service.features.assessment.dto.export.ResultExportRowDto>
            findAllEndedParticipantsForResultExport(@Param("assessmentId") String assessmentId,
                                                    @Param("instituteId") String instituteId);

    // Every registration-form answer given by the participants of an assessment,
    // flattened to (registration, field, answer). The export widens each result
    // row with these, so it is fetched in one shot rather than per participant.
    @Query(value = """
            SELECT cfr.assessment_registration_id AS registrationId,
                   cfr.custom_field_id            AS fieldId,
                   cfr.answer                     AS answer
            FROM assessment_registration_custom_field_response_data cfr
            JOIN assessment_user_registration aur ON aur.id = cfr.assessment_registration_id
            WHERE aur.assessment_id = :assessmentId
              AND aur.institute_id  = :instituteId
              AND aur.status NOT IN ('DELETED')
            """, nativeQuery = true)
    List<RegistrationCustomFieldAnswerDto> findCustomFieldAnswersForAssessment(
            @Param("assessmentId") String assessmentId,
            @Param("instituteId") String instituteId);
}
