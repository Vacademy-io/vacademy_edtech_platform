package vacademy.io.admin_core_service.features.live_session.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.live_session.dto.AttendanceReportDTO;
import vacademy.io.admin_core_service.features.live_session.dto.AttendanceReportProjection;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassFeedbackProjection;
import vacademy.io.admin_core_service.features.live_session.dto.ScheduleAttendanceProjection;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionParticipants;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface LiveSessionParticipantRepository extends JpaRepository<LiveSessionParticipants, String> {

    @Transactional
    void deleteAllBySessionId(String SessionId);

    @Transactional
    void deleteBySessionIdAndSourceId(String sessionId, String sourceId);

    @Transactional
    List<LiveSessionParticipants> findBySessionId(String sessionId);

    boolean existsBySessionIdAndSourceTypeAndSourceId(String sessionId, String sourceType, String sourceId);

    /**
     * True if the user is a participant of the session — either directly added as a
     * USER participant, or as a member of a BATCH participant via an ACTIVE
     * student_session_institute_group_mapping. Mirrors the participant predicate in
     * {@link #findAttendanceForUser}; used by the join authorizer to gate
     * SDK-signature / join-link issuance to enrolled learners only.
     */
    @Query(value = """
        SELECT EXISTS (
            SELECT 1 FROM live_session_participants lsp
            WHERE lsp.session_id = :sessionId
              AND (
                  (lsp.source_type = 'USER' AND lsp.source_id = :userId)
                  OR (lsp.source_type = 'BATCH' AND EXISTS (
                      SELECT 1 FROM student_session_institute_group_mapping m
                      WHERE m.user_id = :userId
                        AND m.package_session_id = lsp.source_id
                        AND m.status = 'ACTIVE'
                  ))
              )
        )
        """, nativeQuery = true)
    boolean isUserParticipantOfSession(@Param("sessionId") String sessionId, @Param("userId") String userId);

    /**
     * Resolves a Zoom/provider participant email to the user_id of an enrolled
     * participant of the session (USER source, or BATCH member via an ACTIVE
     * mapping). Used by attendance polling to attribute a provider attendee to a
     * Vacademy user; empty when the email matches no enrolled participant (guest).
     */
    @Query(value = """
        SELECT s.user_id
        FROM live_session_participants lsp
        LEFT JOIN student_session_institute_group_mapping m
            ON m.package_session_id = lsp.source_id AND lsp.source_type = 'BATCH' AND m.status = 'ACTIVE'
        JOIN student s
            ON ((lsp.source_type = 'USER' AND s.user_id = lsp.source_id)
                OR (lsp.source_type = 'BATCH' AND s.user_id = m.user_id))
        WHERE lsp.session_id = :sessionId
          AND LOWER(s.email) = LOWER(:email)
        LIMIT 1
        """, nativeQuery = true)
    List<String> findEnrolledUserIdByEmail(@Param("sessionId") String sessionId, @Param("email") String email);

        @Query(value = """
        WITH all_participants AS (
            -- Query for BATCH source type participants
            SELECT
                s.user_id AS studentId,
                s.full_name AS fullName,
                s.email AS email,
                s.mobile_number AS mobileNumber,
                s.gender AS gender,
                s.date_of_birth AS dateOfBirth,
                m.institute_enrollment_number AS instituteEnrollmentNumber,
                m.status AS enrollmentStatus,
                COALESCE(lsl.status, 'UNMARKED') AS attendanceStatus,
                lsl.details AS attendanceDetails,
                lsl.created_at AS attendanceTimestamp,
                'BATCH' AS source_type,
                lsl.status_type AS statusType,
                lsl.engagement_data AS engagementData,
                lsl.provider_total_duration_minutes AS providerTotalDurationMinutes,
                lsl.provider_total_duration_seconds AS providerTotalDurationSeconds,
                fbl.details AS feedbackDetails,
                CASE
                    WHEN COALESCE(TRIM(ps.name), '') <> ''
                     AND UPPER(TRIM(ps.name)) NOT IN ('DEFAULT', 'GENERAL')
                    THEN ps.name
                    WHEN LOWER(TRIM(COALESCE(l.level_name, ''))) IN ('', 'default')
                    THEN p.package_name
                    ELSE CONCAT(l.level_name, ' ', p.package_name)
                END AS batchName,
                lsp.created_at AS registeredAt,
                1 AS priority
            FROM live_session_participants lsp
            JOIN student_session_institute_group_mapping m
                ON m.package_session_id = lsp.source_id AND lsp.source_type = 'BATCH' AND m.status = 'ACTIVE'
            JOIN student s
                ON s.user_id = m.user_id
            LEFT JOIN package_session ps
                ON ps.id = lsp.source_id
            LEFT JOIN level l
                ON l.id = ps.level_id
            LEFT JOIN package p
                ON p.id = ps.package_id
            LEFT JOIN live_session_logs lsl
                ON lsl.user_source_id = s.user_id
                AND lsl.user_source_type = 'USER'
                AND lsl.session_id = :sessionId
                AND lsl.schedule_id = :scheduleId
                AND lsl.log_type = 'ATTENDANCE_RECORDED'
            LEFT JOIN live_session_logs fbl
                ON fbl.user_source_id = s.user_id
                AND fbl.user_source_type = 'USER'
                AND fbl.session_id = :sessionId
                AND fbl.schedule_id = :scheduleId
                AND fbl.log_type = 'FEEDBACK_SUBMITTED'
            WHERE lsp.session_id = :sessionId
            AND lsp.source_type = 'BATCH'

            UNION ALL

            -- Query for USER source type participants
            SELECT
                s.user_id AS studentId,
                s.full_name AS fullName,
                s.email AS email,
                s.mobile_number AS mobileNumber,
                s.gender AS gender,
                s.date_of_birth AS dateOfBirth,
                NULL AS instituteEnrollmentNumber,
                NULL AS enrollmentStatus,
                COALESCE(lsl.status, 'UNMARKED') AS attendanceStatus,
                lsl.details AS attendanceDetails,
                lsl.created_at AS attendanceTimestamp,
                'USER' AS source_type,
                lsl.status_type AS statusType,
                lsl.engagement_data AS engagementData,
                lsl.provider_total_duration_minutes AS providerTotalDurationMinutes,
                lsl.provider_total_duration_seconds AS providerTotalDurationSeconds,
                fbl.details AS feedbackDetails,
                NULL AS batchName,
                lsp.created_at AS registeredAt,
                2 AS priority
            FROM live_session_participants lsp
            JOIN student s
                ON s.user_id = lsp.source_id
            LEFT JOIN live_session_logs lsl
                ON lsl.user_source_id = s.user_id
                AND lsl.user_source_type = 'USER'
                AND lsl.session_id = :sessionId
                AND lsl.schedule_id = :scheduleId
                AND lsl.log_type = 'ATTENDANCE_RECORDED'
            LEFT JOIN live_session_logs fbl
                ON fbl.user_source_id = s.user_id
                AND fbl.user_source_type = 'USER'
                AND fbl.session_id = :sessionId
                AND fbl.schedule_id = :scheduleId
                AND fbl.log_type = 'FEEDBACK_SUBMITTED'
            WHERE lsp.session_id = :sessionId
            AND lsp.source_type = 'USER'
        )
        SELECT DISTINCT ON (studentId)
            studentId,
            fullName,
            email,
            mobileNumber,
            gender,
            dateOfBirth,
            instituteEnrollmentNumber,
            enrollmentStatus,
            attendanceStatus,
            attendanceDetails,
            attendanceTimestamp,
            source_type AS sourceType,
            statusType,
            engagementData,
            providerTotalDurationMinutes,
            feedbackDetails,
            batchName,
            registeredAt
        FROM all_participants
        ORDER BY studentId, priority ASC
    """, nativeQuery = true)
        List<AttendanceReportDTO> getAttendanceReportBySessionIds(
                @Param("sessionId") String sessionId,
                @Param("scheduleId") String scheduleId
        );


    @Query(value = """
    SELECT 
        s.user_id AS studentId,
        s.full_name AS fullName,
        s.email AS email,
        s.mobile_number AS mobileNumber,
        s.gender AS gender,
        s.date_of_birth AS dateOfBirth,
        m.institute_enrollment_number AS instituteEnrollmentNumber,
        m.status AS enrollmentStatus,
        m.enrolled_date AS enrolledDate,
        COALESCE(lsl.status, 'UNMARKED') AS attendanceStatus,
        lsl.details AS attendanceDetails,
        lsl.created_at AS attendanceTimestamp,
        lsp.session_id AS sessionId,
        ss.id AS scheduleId,
        ls.title AS title,
        ss.meeting_date AS meetingDate,
        ss.start_time AS startTime,
        ss.last_entry_time AS lastEntryTime,
        ss.daily_attendance AS dailyAttendance,
        fbl.details AS feedbackDetails,
        lsp.source_id AS packageSessionId,
        lsl.provider_total_duration_minutes AS providerTotalDurationMinutes,
                lsl.provider_total_duration_seconds AS providerTotalDurationSeconds,
        lsl.engagement_data AS engagementData
    FROM live_session_participants lsp
    JOIN student_session_institute_group_mapping m
        ON m.package_session_id = lsp.source_id
        AND lsp.source_type = 'BATCH'
        AND m.status = 'ACTIVE'
    JOIN student s
        ON s.user_id = m.user_id
    JOIN session_schedules ss
        ON ss.session_id = lsp.session_id
    JOIN live_session ls
        ON ls.id = lsp.session_id
    LEFT JOIN live_session_logs lsl
        ON lsl.user_source_id = s.user_id
        AND lsl.user_source_type = 'USER'
        AND lsl.session_id = lsp.session_id
        AND lsl.schedule_id = ss.id
        AND lsl.log_type = 'ATTENDANCE_RECORDED'
    LEFT JOIN live_session_logs fbl
        ON fbl.user_source_id = s.user_id
        AND fbl.user_source_type = 'USER'
        AND fbl.session_id = lsp.session_id
        AND fbl.schedule_id = ss.id
        AND fbl.log_type = 'FEEDBACK_SUBMITTED'
    WHERE lsp.source_id = :batchSessionId
      AND ss.meeting_date BETWEEN :startDate AND :endDate
      AND (m.enrolled_date IS NULL OR ss.meeting_date >= m.enrolled_date)
      AND ss.status <> 'DELETED'
      AND ls.status <> 'DELETED'
    """, nativeQuery = true)
    List<AttendanceReportProjection> getAttendanceReportWithinDateRange(
            @Param("batchSessionId") String batchSessionId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate
    );

    @Query(
            value = """
        SELECT DISTINCT s.user_id AS studentId
        FROM (
            SELECT DISTINCT ON (lsp.session_id, ss.id, m.user_id)
                   lsp.session_id AS session_id,
                   ss.id AS schedule_id,
                   m.user_id AS user_id,
                   m.package_session_id AS package_session_id,
                   m.institute_enrollment_number AS institute_enrollment_number,
                   m.status AS enrollment_status,
                   m.enrolled_date AS enrolled_date
            FROM live_session_participants lsp
            JOIN session_schedules ss
                ON ss.session_id = lsp.session_id
                AND ss.status <> 'DELETED'
                AND ss.meeting_date BETWEEN :startDate AND :endDate
            JOIN live_session ls
                ON ls.id = lsp.session_id
                AND ls.status <> 'DELETED'
            JOIN student_session_institute_group_mapping m
                ON m.status = 'ACTIVE'
                AND m.institute_id = :instituteId
                AND ((lsp.source_type = 'BATCH' AND m.package_session_id = lsp.source_id)
                  OR (lsp.source_type = 'USER' AND m.user_id = lsp.source_id))
            WHERE (m.enrolled_date IS NULL OR ss.meeting_date >= m.enrolled_date)
            ORDER BY lsp.session_id, ss.id, m.user_id, m.enrolled_date DESC NULLS LAST
        ) r
        JOIN student s ON s.user_id = r.user_id
        WHERE (:name IS NULL OR LOWER(s.full_name) LIKE LOWER(CONCAT('%', :name, '%')))
          AND (:batchIdsSize = 0 OR r.package_session_id IN (:batchIds))
          AND (:liveSessionIdsSize = 0 OR r.session_id IN (:liveSessionIds))
        """,
            countQuery = """
        SELECT COUNT(DISTINCT s.user_id)
        FROM (
            SELECT DISTINCT ON (lsp.session_id, ss.id, m.user_id)
                   lsp.session_id AS session_id,
                   ss.id AS schedule_id,
                   m.user_id AS user_id,
                   m.package_session_id AS package_session_id,
                   m.institute_enrollment_number AS institute_enrollment_number,
                   m.status AS enrollment_status,
                   m.enrolled_date AS enrolled_date
            FROM live_session_participants lsp
            JOIN session_schedules ss
                ON ss.session_id = lsp.session_id
                AND ss.status <> 'DELETED'
                AND ss.meeting_date BETWEEN :startDate AND :endDate
            JOIN live_session ls
                ON ls.id = lsp.session_id
                AND ls.status <> 'DELETED'
            JOIN student_session_institute_group_mapping m
                ON m.status = 'ACTIVE'
                AND m.institute_id = :instituteId
                AND ((lsp.source_type = 'BATCH' AND m.package_session_id = lsp.source_id)
                  OR (lsp.source_type = 'USER' AND m.user_id = lsp.source_id))
            WHERE (m.enrolled_date IS NULL OR ss.meeting_date >= m.enrolled_date)
            ORDER BY lsp.session_id, ss.id, m.user_id, m.enrolled_date DESC NULLS LAST
        ) r
        JOIN student s ON s.user_id = r.user_id
        WHERE (:name IS NULL OR LOWER(s.full_name) LIKE LOWER(CONCAT('%', :name, '%')))
          AND (:batchIdsSize = 0 OR r.package_session_id IN (:batchIds))
          AND (:liveSessionIdsSize = 0 OR r.session_id IN (:liveSessionIds))
        """,
            nativeQuery = true
    )
    Page<String> findDistinctStudentIdsWithFilters(
            @Param("instituteId") String instituteId,
            @Param("name") String name,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate,
            @Param("batchIds") List<String> batchIds,
            @Param("batchIdsSize") int batchIdsSize,
            @Param("liveSessionIds") List<String> liveSessionIds,
            @Param("liveSessionIdsSize") int liveSessionIdsSize,
            Pageable pageable
    );

    @Query(value = """
    SELECT
        s.user_id AS studentId,
        s.full_name AS fullName,
        s.email AS email,
        s.mobile_number AS mobileNumber,
        s.gender AS gender,
        s.date_of_birth AS dateOfBirth,
        r.institute_enrollment_number AS instituteEnrollmentNumber,
        r.enrollment_status AS enrollmentStatus,
        r.enrolled_date AS enrolledDate,
        COALESCE(lsl.status, 'UNMARKED') AS attendanceStatus,
        lsl.details AS attendanceDetails,
        lsl.created_at AS attendanceTimestamp,
        r.session_id AS sessionId,
        r.schedule_id AS scheduleId,
        ls.title AS title,
        ss.meeting_date AS meetingDate,
        ss.start_time AS startTime,
        ss.last_entry_time AS lastEntryTime,
        ss.daily_attendance AS dailyAttendance,
        fbl.details AS feedbackDetails,
        r.package_session_id AS packageSessionId,
        lsl.provider_total_duration_minutes AS providerTotalDurationMinutes,
        lsl.provider_total_duration_seconds AS providerTotalDurationSeconds,
        lsl.engagement_data AS engagementData
    FROM (
        SELECT DISTINCT ON (lsp.session_id, ss.id, m.user_id)
               lsp.session_id AS session_id,
               ss.id AS schedule_id,
               m.user_id AS user_id,
               m.package_session_id AS package_session_id,
               m.institute_enrollment_number AS institute_enrollment_number,
               m.status AS enrollment_status,
               m.enrolled_date AS enrolled_date
        FROM live_session_participants lsp
        JOIN session_schedules ss
            ON ss.session_id = lsp.session_id
            AND ss.status <> 'DELETED'
            AND ss.meeting_date BETWEEN :startDate AND :endDate
        JOIN live_session ls
            ON ls.id = lsp.session_id
            AND ls.status <> 'DELETED'
        JOIN student_session_institute_group_mapping m
            ON m.status = 'ACTIVE'
            AND m.institute_id = :instituteId
            AND m.user_id IN (:studentIds)
            AND ((lsp.source_type = 'BATCH' AND m.package_session_id = lsp.source_id)
              OR (lsp.source_type = 'USER' AND m.user_id = lsp.source_id))
        WHERE (m.enrolled_date IS NULL OR ss.meeting_date >= m.enrolled_date)
        ORDER BY lsp.session_id, ss.id, m.user_id, m.enrolled_date DESC NULLS LAST
    ) r
    JOIN student s ON s.user_id = r.user_id
    JOIN session_schedules ss ON ss.id = r.schedule_id
    JOIN live_session ls ON ls.id = r.session_id
    LEFT JOIN live_session_logs lsl
        ON lsl.user_source_id = s.user_id
        AND lsl.user_source_type = 'USER'
        AND lsl.session_id = r.session_id
        AND lsl.schedule_id = r.schedule_id
        AND lsl.log_type = 'ATTENDANCE_RECORDED'
    LEFT JOIN live_session_logs fbl
        ON fbl.user_source_id = s.user_id
        AND fbl.user_source_type = 'USER'
        AND fbl.session_id = r.session_id
        AND fbl.schedule_id = r.schedule_id
        AND fbl.log_type = 'FEEDBACK_SUBMITTED'
    WHERE (:batchIdsSize = 0 OR r.package_session_id IN (:batchIds))
      AND (:liveSessionIdsSize = 0 OR r.session_id IN (:liveSessionIds))
    ORDER BY LOWER(s.full_name), ss.meeting_date
""",nativeQuery = true)
    List<AttendanceReportProjection> getAttendanceReportForStudentIds(
            @Param("instituteId") String instituteId,
            @Param("studentIds") List<String> studentIds,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate,
            @Param("batchIds") List<String> batchIds,
            @Param("batchIdsSize") int batchIdsSize,
            @Param("liveSessionIds") List<String> liveSessionIds,
            @Param("liveSessionIdsSize") int liveSessionIdsSize
    );

    // NOTE: keep SQL "--" comments OUT of this native @Query text block. Spring Data's
    // SpEL QuotationMap scans the whole string for apostrophes (including inside comments)
    // before binding params, so a lone "'" in a comment throws "starts a quoted range ...
    // but never ends it" at startup. Put explanations in Java "//" comments like this one.
    //
    // The batch narrowing (:batchId filter) applies ONLY to BATCH rows. Applying it to USER
    // rows would compare lsp.source_id (which IS the userId for those rows) against the batch
    // id and drop every session the learner was individually added to.
    @Query(value = """
    SELECT DISTINCT ON (ss.id, ls.id)
        ss.id AS scheduleId,
        ss.meeting_date AS meetingDate,
        ss.start_time AS startTime,
        ss.last_entry_time AS lastEntryTime,
        ls.id AS sessionId,
        ls.title AS sessionTitle,
        ls.subject AS subject,
        ls.status AS sessionStatus,
        ls.access_level AS accessLevel,
        COALESCE(lsl.status, 'UNMARKED') AS attendanceStatus,
        lsl.provider_total_duration_minutes AS durationMinutes
    FROM live_session_participants lsp
    JOIN session_schedules ss ON ss.session_id = lsp.session_id
    JOIN live_session ls ON ls.id = lsp.session_id
    LEFT JOIN LATERAL (
        SELECT status, details, created_at, provider_total_duration_minutes
        FROM live_session_logs
        WHERE session_id = lsp.session_id
          AND schedule_id = ss.id
          AND user_source_type = 'USER'
          AND user_source_id = :userId
          AND log_type = 'ATTENDANCE_RECORDED'
        ORDER BY created_at DESC
        LIMIT 1
    ) lsl ON TRUE
    LEFT JOIN student_session_institute_group_mapping m
        ON m.package_session_id = lsp.source_id
        AND m.user_id = :userId
        AND m.status = 'ACTIVE'
    WHERE (
            (lsp.source_type = 'USER' AND lsp.source_id = :userId)
            OR (lsp.source_type = 'BATCH' AND m.user_id IS NOT NULL
                AND (:batchId IS NULL OR lsp.source_id = :batchId))
          )
      AND ls.status <> 'DELETED'
      AND ss.status <> 'DELETED'
      AND ss.meeting_date BETWEEN :startDate AND :endDate
      AND (m.enrolled_date IS NULL OR ss.meeting_date >= m.enrolled_date)
    ORDER BY ss.id, ls.id
    """, nativeQuery = true)
    List<ScheduleAttendanceProjection> findAttendanceForUser(
            @Param("userId") String userId,
            @Param("batchId") String batchId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate
    );

    /**
     * Attendance rows for one learner, scoped to EVERY batch they are actively enrolled in
     * (plus any session they were added to individually). Used by the student report.
     *
     * <p>Differs from {@link #findAttendanceForUser} — which required a single caller-supplied
     * {@code batchId} to equal {@code live_session_participants.source_id} and therefore returned
     * ZERO rows (reported as 0% attendance) whenever that batch id was null, stale, or simply not
     * the batch the session was attached to. Semantics here deliberately mirror
     * {@link #getAttendanceReportForStudentIds}, which is what the admin attendance screen shows,
     * so the report and that screen can no longer disagree:
     * <ul>
     *   <li>enrolment is resolved from the learner's ACTIVE mappings, not a passed-in id;</li>
     *   <li>{@code enrolled_date} is applied per-mapping (sessions before the learner joined that
     *       batch don't count against them);</li>
     *   <li>DELETED schedules are excluded — the old query only excluded non-LIVE sessions, so a
     *       deleted schedule still counted as an UNMARKED (→ absent) session and deflated the %.</li>
     * </ul>
     * {@code batchId} is an OPTIONAL narrowing filter: pass null to count all batches.
     */
    @Query(value = """
    SELECT DISTINCT ON (ss.id, ls.id)
        ss.id AS scheduleId,
        ss.meeting_date AS meetingDate,
        ss.start_time AS startTime,
        ss.last_entry_time AS lastEntryTime,
        ls.id AS sessionId,
        ls.title AS sessionTitle,
        ls.subject AS subject,
        ls.status AS sessionStatus,
        ls.access_level AS accessLevel,
        COALESCE(lsl.status, 'UNMARKED') AS attendanceStatus
    FROM live_session_participants lsp
    JOIN session_schedules ss ON ss.session_id = lsp.session_id
    JOIN live_session ls ON ls.id = lsp.session_id
    LEFT JOIN student_session_institute_group_mapping m
        ON lsp.source_type = 'BATCH'
       AND m.package_session_id = lsp.source_id
       AND m.user_id = :userId
       -- Enrolment status is deliberately NOT restricted to ACTIVE. A report for a past term is
       -- generated after the mapping has flipped to EXPIRED/INACTIVE (or the learner moved to the
       -- next years batch) -- requiring ACTIVE returned ZERO sessions for a learner with a full
       -- attendance history. They *were* enrolled when those sessions ran, which is what matters.
       -- INVITED (never enrolled) and DELETED are still excluded.
       AND m.status NOT IN ('INVITED', 'DELETED')
    LEFT JOIN LATERAL (
        SELECT status
        FROM live_session_logs
        WHERE session_id = lsp.session_id
          AND schedule_id = ss.id
          AND user_source_type = 'USER'
          AND user_source_id = :userId
          AND log_type = 'ATTENDANCE_RECORDED'
        ORDER BY created_at DESC
        LIMIT 1
    ) lsl ON TRUE
    WHERE (
            (lsp.source_type = 'USER' AND lsp.source_id = :userId)
            OR (lsp.source_type = 'BATCH' AND m.user_id IS NOT NULL
                -- The batch narrowing applies ONLY to BATCH rows. Applying it to USER rows would
                -- compare lsp.source_id (which IS the userId for those rows) against the batch id
                -- and drop every session the learner was individually added to.
                AND (:batchId IS NULL OR lsp.source_id = :batchId))
          )
      AND ls.status <> 'DELETED'
      AND ss.status <> 'DELETED'
      AND ss.meeting_date BETWEEN :startDate AND :endDate
      AND (m.enrolled_date IS NULL OR ss.meeting_date >= m.enrolled_date)
    ORDER BY ss.id, ls.id
    """, nativeQuery = true)
    List<ScheduleAttendanceProjection> findAttendanceForUserAcrossBatches(
            @Param("userId") String userId,
            @Param("batchId") String batchId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate
    );

    /**
     * Cross-session learner feedback search for the admin "Live Class Feedback"
     * page. Driving table is the FEEDBACK_SUBMITTED log itself, so there is no row
     * multiplication; batch is matched via an EXISTS subquery and the session's
     * batch ids are returned comma-joined in {@code packageSessionIds} (names
     * resolved on the frontend). Empty batch/subject lists mean "all".
     */
    @Query(value = """
        SELECT
            fbl.id AS feedbackId,
            fbl.user_source_id AS userId,
            s.full_name AS learnerName,
            s.email AS learnerEmail,
            s.mobile_number AS learnerMobile,
            ls.id AS sessionId,
            ss.id AS scheduleId,
            ls.title AS sessionTitle,
            ls.subject AS subject,
            ss.meeting_date AS meetingDate,
            ss.start_time AS startTime,
            ls.feedback_config_json AS feedbackConfigJson,
            (SELECT string_agg(DISTINCT p.source_id, ',')
               FROM live_session_participants p
              WHERE p.session_id = fbl.session_id
                AND p.source_type = 'BATCH') AS packageSessionIds,
            fbl.details AS feedbackDetails,
            fbl.created_at AS submittedAt
        FROM (
            SELECT DISTINCT ON (l.user_source_id, l.session_id, l.schedule_id)
                   l.id, l.user_source_id, l.session_id, l.schedule_id, l.details, l.created_at
            FROM live_session_logs l
            WHERE l.log_type = 'FEEDBACK_SUBMITTED'
              AND l.user_source_type = 'USER'
            ORDER BY l.user_source_id, l.session_id, l.schedule_id, l.created_at DESC
        ) fbl
        JOIN live_session ls ON ls.id = fbl.session_id
        JOIN session_schedules ss ON ss.id = fbl.schedule_id
        LEFT JOIN LATERAL (
            SELECT st.full_name, st.email, st.mobile_number
            FROM student st
            WHERE st.user_id = fbl.user_source_id
            ORDER BY st.created_at DESC NULLS LAST
            LIMIT 1
        ) s ON TRUE
        WHERE ls.institute_id = :instituteId
          AND ls.status <> 'DELETED'
          AND ss.status <> 'DELETED'
          AND ss.meeting_date BETWEEN :startDate AND :endDate
          AND (:batchIdsSize = 0 OR EXISTS (
                SELECT 1 FROM live_session_participants p
                WHERE p.session_id = fbl.session_id
                  AND p.source_type = 'BATCH'
                  AND p.source_id IN (:batchIds)))
          AND (:subjectsSize = 0 OR ls.subject IN (:subjects))
          AND (:search IS NULL
                OR LOWER(s.full_name) LIKE LOWER(CONCAT('%', :search, '%'))
                OR LOWER(ls.title) LIKE LOWER(CONCAT('%', :search, '%')))
          AND (:hasRatingBelow = 0 OR (
                SELECT CAST(CAST(fbl.details AS jsonb) ->> (q.value ->> 'id') AS numeric)
                FROM jsonb_array_elements(
                        CASE WHEN pg_input_is_valid(ls.feedback_config_json, 'jsonb')
                              AND pg_input_is_valid(fbl.details, 'jsonb')
                             THEN CASE WHEN jsonb_typeof(CAST(ls.feedback_config_json AS jsonb) -> 'questions') = 'array'
                                       THEN CAST(ls.feedback_config_json AS jsonb) -> 'questions' END
                        END
                     ) WITH ORDINALITY AS q(value, ord)
                WHERE q.value ->> 'type' = 'star_rating'
                  AND (CAST(fbl.details AS jsonb) ->> (q.value ->> 'id')) ~ '^[0-9]+(\\.[0-9]+)?$'
                ORDER BY q.ord
                LIMIT 1
              ) < :ratingBelow)
        ORDER BY ss.meeting_date DESC, fbl.created_at DESC
        """,
            countQuery = """
        SELECT COUNT(*)
        FROM (
            SELECT DISTINCT ON (l.user_source_id, l.session_id, l.schedule_id)
                   l.id, l.user_source_id, l.session_id, l.schedule_id, l.details
            FROM live_session_logs l
            WHERE l.log_type = 'FEEDBACK_SUBMITTED'
              AND l.user_source_type = 'USER'
            ORDER BY l.user_source_id, l.session_id, l.schedule_id, l.created_at DESC
        ) fbl
        JOIN live_session ls ON ls.id = fbl.session_id
        JOIN session_schedules ss ON ss.id = fbl.schedule_id
        LEFT JOIN LATERAL (
            SELECT st.full_name
            FROM student st
            WHERE st.user_id = fbl.user_source_id
            ORDER BY st.created_at DESC NULLS LAST
            LIMIT 1
        ) s ON TRUE
        WHERE ls.institute_id = :instituteId
          AND ls.status <> 'DELETED'
          AND ss.status <> 'DELETED'
          AND ss.meeting_date BETWEEN :startDate AND :endDate
          AND (:batchIdsSize = 0 OR EXISTS (
                SELECT 1 FROM live_session_participants p
                WHERE p.session_id = fbl.session_id
                  AND p.source_type = 'BATCH'
                  AND p.source_id IN (:batchIds)))
          AND (:subjectsSize = 0 OR ls.subject IN (:subjects))
          AND (:search IS NULL
                OR LOWER(s.full_name) LIKE LOWER(CONCAT('%', :search, '%'))
                OR LOWER(ls.title) LIKE LOWER(CONCAT('%', :search, '%')))
          AND (:hasRatingBelow = 0 OR (
                SELECT CAST(CAST(fbl.details AS jsonb) ->> (q.value ->> 'id') AS numeric)
                FROM jsonb_array_elements(
                        CASE WHEN pg_input_is_valid(ls.feedback_config_json, 'jsonb')
                              AND pg_input_is_valid(fbl.details, 'jsonb')
                             THEN CASE WHEN jsonb_typeof(CAST(ls.feedback_config_json AS jsonb) -> 'questions') = 'array'
                                       THEN CAST(ls.feedback_config_json AS jsonb) -> 'questions' END
                        END
                     ) WITH ORDINALITY AS q(value, ord)
                WHERE q.value ->> 'type' = 'star_rating'
                  AND (CAST(fbl.details AS jsonb) ->> (q.value ->> 'id')) ~ '^[0-9]+(\\.[0-9]+)?$'
                ORDER BY q.ord
                LIMIT 1
              ) < :ratingBelow)
        """,
            nativeQuery = true)
    Page<LiveClassFeedbackProjection> searchFeedback(
            @Param("instituteId") String instituteId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate,
            @Param("batchIds") List<String> batchIds,
            @Param("batchIdsSize") int batchIdsSize,
            @Param("subjects") List<String> subjects,
            @Param("subjectsSize") int subjectsSize,
            @Param("search") String search,
            @Param("hasRatingBelow") int hasRatingBelow,
            @Param("ratingBelow") double ratingBelow,
            Pageable pageable
    );

    /**
     * Distinct live-class subjects for an institute, optionally narrowed to the
     * given batches — populates the subject filter on the feedback page.
     */
    @Query(value = """
        SELECT DISTINCT ls.subject
        FROM live_session ls
        WHERE ls.institute_id = :instituteId
          AND ls.subject IS NOT NULL
          AND ls.subject <> ''
          AND ls.status <> 'DELETED'
          AND (:batchIdsSize = 0 OR EXISTS (
                SELECT 1 FROM live_session_participants p
                WHERE p.session_id = ls.id
                  AND p.source_type = 'BATCH'
                  AND p.source_id IN (:batchIds)))
        ORDER BY ls.subject
        """, nativeQuery = true)
    List<String> findDistinctSubjects(
            @Param("instituteId") String instituteId,
            @Param("batchIds") List<String> batchIds,
            @Param("batchIdsSize") int batchIdsSize
    );

    interface SessionBatchProjection {
        String getSessionId();
        String getSourceId();
    }

    @Query(value = """
        SELECT lsp.session_id AS sessionId, lsp.source_id AS sourceId
        FROM live_session_participants lsp
        WHERE lsp.session_id IN (:sessionIds) AND lsp.source_type = 'BATCH'
        """, nativeQuery = true)
    List<SessionBatchProjection> findBatchSourceIdsBySessionIds(@Param("sessionIds") List<String> sessionIds);

    @Query(value = """
    SELECT
        CASE
            WHEN total_days = 0 THEN 0
            ELSE ROUND((attended_days * 100.0) / total_days, 2)
        END AS attendance_percentage
    FROM (
        -- Total scheduled days in the batch
        SELECT COUNT(DISTINCT ss.meeting_date) AS total_days
        FROM session_schedules ss
        JOIN live_session_participants lsp 
            ON lsp.session_id = ss.session_id
        WHERE lsp.source_type = 'BATCH'
          AND lsp.source_id = :batchId
          AND ss.meeting_date BETWEEN :startDate AND :endDate
    ) total
    CROSS JOIN (
        SELECT COUNT(DISTINCT ss.meeting_date) AS attended_days
        FROM session_schedules ss
        JOIN live_session_participants lsp 
            ON lsp.session_id = ss.session_id
        JOIN live_session_logs lsl 
            ON lsl.session_id = ss.session_id
           AND lsl.schedule_id = ss.id
           AND lsl.user_source_type = 'USER'
           AND lsl.user_source_id = :userId
           AND lsl.log_type = 'ATTENDANCE_RECORDED'
        WHERE lsp.source_type = 'BATCH'
          AND lsp.source_id = :batchId
          AND ss.meeting_date BETWEEN :startDate AND :endDate
    ) attended
    """, nativeQuery = true)
    Double getAttendancePercentage(
            @Param("batchId") String batchId,
            @Param("userId") String userId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate
    );


}
