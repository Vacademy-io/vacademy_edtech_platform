package vacademy.io.admin_core_service.features.live_session.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionLogs;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface LiveSessionLogsRepository extends JpaRepository<LiveSessionLogs, String>, LiveSessionLogsRepositoryCustom {

    @Query("SELECT l FROM LiveSessionLogs l WHERE l.scheduleId = :scheduleId AND l.logType = 'ATTENDANCE_RECORDED'")
    List<LiveSessionLogs> findAllAttendanceByScheduleId(@Param("scheduleId") String scheduleId);

    @Query("SELECT l FROM LiveSessionLogs l WHERE l.scheduleId = :scheduleId AND l.userSourceId = :userSourceId AND l.logType = 'ATTENDANCE_RECORDED' ORDER BY l.createdAt ASC")
    List<LiveSessionLogs> findAllAttendanceRecords(@Param("scheduleId") String scheduleId,
            @Param("userSourceId") String userSourceId);

    default Optional<LiveSessionLogs> findExistingAttendanceRecord(String scheduleId, String userSourceId) {
        List<LiveSessionLogs> records = findAllAttendanceRecords(scheduleId, userSourceId);
        return records.isEmpty() ? Optional.empty() : Optional.of(records.get(0));
    }

    /**
     * Learner-days with a PRESENT live class in this institute, for the streak bonus.
     * The day is the class's meeting_date, not when attendance was written: provider
     * attendance can land many hours after the class and must not move it to the next day.
     */
    @Query(value = """
            SELECT DISTINCT lsl.user_source_id AS userId, ss.meeting_date AS activityDate
            FROM live_session_logs lsl
            JOIN live_session ls ON ls.id = lsl.session_id
            JOIN session_schedules ss ON ss.id = lsl.schedule_id
            WHERE ls.institute_id = :instituteId
              AND lsl.log_type = 'ATTENDANCE_RECORDED'
              AND lsl.status = 'PRESENT'
              AND lsl.user_source_type = 'USER'
              AND ss.meeting_date BETWEEN :fromDate AND :toDate
              AND ls.status IS DISTINCT FROM 'DELETED'
              AND ss.status IS DISTINCT FROM 'DELETED'
              AND lsl.user_source_id IN (
                  SELECT DISTINCT ssigm.user_id
                  FROM student_session_institute_group_mapping ssigm
                  WHERE ssigm.institute_id = :instituteId
                    AND ssigm.status IN (:learnerStatuses)
              )
            """, nativeQuery = true)
    List<PresentDayProjection> findPresentDaysForInstitute(@Param("instituteId") String instituteId,
                                                           @Param("fromDate") LocalDate fromDate,
                                                           @Param("toDate") LocalDate toDate,
                                                           @Param("learnerStatuses") List<String> learnerStatuses);

    interface PresentDayProjection {
        String getUserId();
        Date getActivityDate();
    }

    /*
     * The single-round-trip attendance upsert lives in
     * LiveSessionLogsRepositoryCustomImpl.upsertAttendanceReturningPreviousStatus.
     * It has to report the pre-existing status so callers can skip re-notifying
     * on a repeat mark, and @Modifying cannot return a value. Conflict target is
     * still the partial unique index uq_lsl_attendance_schedule_user (V415).
     */

    /**
     * Upsert for the BBB meeting-join path (also a class-start stampede).
     * Carries provider join metadata; on conflict it refreshes join
     * time/meeting id and forces PRESENT but leaves details untouched,
     * matching the previous update branch of markBbbAttendance.
     * userSourceType is USER for authenticated learners and EXTERNAL_USER for
     * registered public-session guests (userSourceId = registration id).
     */
    @Modifying
    @Transactional
    @Query(value = """
            INSERT INTO live_session_logs
                (id, session_id, schedule_id, user_source_type, user_source_id,
                 log_type, status, status_type, details, provider_join_time,
                 provider_meeting_id, updated_at)
            VALUES (:id, :sessionId, :scheduleId, :userSourceType, :userSourceId,
                    'ATTENDANCE_RECORDED', 'PRESENT', 'ONLINE', :details,
                    :providerJoinTime, :providerMeetingId, now())
            ON CONFLICT (schedule_id, user_source_id) WHERE log_type = 'ATTENDANCE_RECORDED'
            DO UPDATE SET status              = 'PRESENT',
                          status_type         = 'ONLINE',
                          provider_join_time  = EXCLUDED.provider_join_time,
                          provider_meeting_id = EXCLUDED.provider_meeting_id,
                          updated_at          = now()
            """, nativeQuery = true)
    void upsertBbbJoinAttendance(
            @Param("id") String id,
            @Param("sessionId") String sessionId,
            @Param("scheduleId") String scheduleId,
            @Param("userSourceType") String userSourceType,
            @Param("userSourceId") String userSourceId,
            @Param("details") String details,
            @Param("providerJoinTime") String providerJoinTime,
            @Param("providerMeetingId") String providerMeetingId);

    /**
     * Stores the BBB activeness plugin report (on-device camera attention score) on
     * the learner's attendance row, in one atomic statement.
     *
     * engagement_data is TEXT holding a flat JSON object of integers (BBB analytics
     * counters, summed by the analytics callback). The activeness keys are merged
     * into it as flat integers too, so that merge keeps them. NULL, blank or invalid
     * JSON is treated as an empty object. Nested CASE (not AND) guards each cast:
     * Postgres does not promise left-to-right AND evaluation. CAST(... AS jsonb) and
     * jsonb_build_object() instead of ::jsonb / a brace literal, which Hibernate's
     * native-query parser can mangle.
     *
     * Monotonic: a report only lands when its seconds are > the stored
     * activenessSeconds, so a stale, out-of-order or repeated beacon cannot overwrite
     * a newer report (and a replayed one costs no write).
     *
     * Plausible: the seconds tracked cannot exceed the time since the learner's first
     * join (created_at, set once by the join upsert) plus a little slack. Without this
     * a learner could post one report with a huge `seconds` and the guard above would
     * then reject every honest report for the rest of the class.
     *
     * onScreen / attention use -1 for "not measured": the stored key is then removed
     * rather than left at an older value (Hibernate binds a null Integer badly in
     * native SQL).
     *
     * @return rows updated — 0 when the learner has no attendance row, or the report is stale or implausible
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE live_session_logs
               SET engagement_data = CAST(
                       (CASE WHEN pg_input_is_valid(engagement_data, 'jsonb')
                             THEN (CASE WHEN jsonb_typeof(CAST(engagement_data AS jsonb)) = 'object'
                                        THEN CAST(engagement_data AS jsonb)
                                        ELSE jsonb_build_object() END)
                             ELSE jsonb_build_object() END)
                       - 'activenessOnScreen' - 'activenessAttention'
                       || jsonb_strip_nulls(jsonb_build_object(
                              'activeness', CAST(:avg AS integer),
                              'activenessOnScreen', CASE WHEN CAST(:onScreen AS integer) >= 0
                                                         THEN CAST(:onScreen AS integer) END,
                              'activenessAttention', CASE WHEN CAST(:attention AS integer) >= 0
                                                          THEN CAST(:attention AS integer) END,
                              'activenessSeconds', CAST(:seconds AS integer),
                              'activenessAwayCount', CAST(:awayCount AS integer),
                              'activenessAwaySeconds', CAST(:awaySeconds AS integer),
                              'activenessState', 1))
                   AS text)
             WHERE schedule_id = :scheduleId
               AND user_source_id = :userId
               AND log_type = 'ATTENDANCE_RECORDED'
               AND (CASE WHEN pg_input_is_valid(engagement_data, 'jsonb')
                         THEN (CASE WHEN jsonb_typeof(CAST(engagement_data AS jsonb) -> 'activenessSeconds') = 'number'
                                    THEN CAST(CAST(engagement_data AS jsonb) ->> 'activenessSeconds' AS numeric)
                                    ELSE -1 END)
                         ELSE -1 END) < CAST(:seconds AS integer)
               AND (created_at IS NULL
                    OR CAST(:seconds AS integer) <= EXTRACT(EPOCH FROM (LOCALTIMESTAMP - created_at)) + 300)
            """, nativeQuery = true)
    int mergeActivenessReport(
            @Param("scheduleId") String scheduleId,
            @Param("userId") String userId,
            @Param("avg") int avg,
            @Param("onScreen") int onScreen,
            @Param("attention") int attention,
            @Param("seconds") int seconds,
            @Param("awayCount") int awayCount,
            @Param("awaySeconds") int awaySeconds);

    /**
     * Why the activeness plugin is not (or no longer) measuring this learner — a
     * phone, the learner turned it off, the camera is blocked/busy/missing, … — as
     * an integer code in engagement_data.activenessState (see
     * LiveSessionProviderController.ACTIVENESS_STATES; the analytics callback only
     * merges integer keys). A score report sets it back to 1.
     *
     * "Waiting for camera permission" (10) never overwrites a learner who already
     * has a score: it can only arrive late, after the prompt was answered.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE live_session_logs
               SET engagement_data = CAST(
                       (CASE WHEN pg_input_is_valid(engagement_data, 'jsonb')
                             THEN (CASE WHEN jsonb_typeof(CAST(engagement_data AS jsonb)) = 'object'
                                        THEN CAST(engagement_data AS jsonb)
                                        ELSE jsonb_build_object() END)
                             ELSE jsonb_build_object() END)
                       || jsonb_build_object('activenessState', CAST(:state AS integer))
                   AS text),
                   updated_at = now()
             WHERE schedule_id = :scheduleId
               AND user_source_id = :userId
               AND log_type = 'ATTENDANCE_RECORDED'
               AND (CAST(:state AS integer) <> 10
                    OR NOT (CASE WHEN pg_input_is_valid(engagement_data, 'jsonb')
                                 THEN (CASE WHEN jsonb_typeof(CAST(engagement_data AS jsonb)) = 'object'
                                            THEN jsonb_exists(CAST(engagement_data AS jsonb), 'activeness')
                                            ELSE FALSE END)
                                 ELSE FALSE END))
            """, nativeQuery = true)
    int mergeActivenessState(
            @Param("scheduleId") String scheduleId,
            @Param("userId") String userId,
            @Param("state") int state);

    /**
     * Used by the provider sync scheduler to upsert provider-sourced attendance.
     * Looks up by schedule + attendee email (stored in userSourceId for
     * PROVIDER_EMAIL records).
     */
    @Query("""
                SELECT l FROM LiveSessionLogs l
                WHERE l.scheduleId = :scheduleId
                  AND l.userSourceId = :email
                  AND l.userSourceType = 'PROVIDER_EMAIL'
                  AND l.logType = 'ATTENDANCE_RECORDED'
                ORDER BY l.createdAt ASC
            """)
    List<LiveSessionLogs> findAllProviderAttendanceRecords(
            @Param("scheduleId") String scheduleId,
            @Param("email") String email);

    default Optional<LiveSessionLogs> findExistingProviderAttendanceRecord(String scheduleId, String email) {
        List<LiveSessionLogs> records = findAllProviderAttendanceRecords(scheduleId, email);
        return records.isEmpty() ? Optional.empty() : Optional.of(records.get(0));
    }

    /**
     * Count attendance records for a specific user across all sessions.
     * Used by UserLeadProfileService to compute demo_attendance_count.
     */
    long countByUserSourceIdAndLogType(String userSourceId, String logType);

    /**
     * Has this learner already been marked present in THIS scheduled class?
     *
     * <p>Scoped to the one schedule, not the institute: the disclaimer is shown for
     * every class a learner has not been in before, and suppressed only when they
     * are returning to the same class (a reload, or rejoining after dropping out).
     * A learner who attended yesterday's class is still a newcomer to today's.</p>
     */
    boolean existsByUserSourceIdAndScheduleIdAndLogType(String userSourceId,
                                                        String scheduleId,
                                                        String logType);

    @Query("""
        SELECT l FROM LiveSessionLogs l
        WHERE l.logType = :logType
          AND l.userSourceType = :userSourceType
          AND l.createdAt BETWEEN :startTime AND :endTime
    """)
    List<LiveSessionLogs> findByLogTypeAndUserSourceTypeAndCreatedAtBetween(
        @Param("logType") String logType,
        @Param("userSourceType") String userSourceType,
        @Param("startTime") Timestamp startTime,
        @Param("endTime") Timestamp endTime
    );

    @Query("""
            SELECT l FROM LiveSessionLogs l
            WHERE l.scheduleId = :scheduleId
              AND l.userSourceId = :userId
              AND l.logType = 'FEEDBACK_SUBMITTED'
            ORDER BY l.createdAt ASC
        """)
    List<LiveSessionLogs> findFeedbackByScheduleAndUser(
            @Param("scheduleId") String scheduleId,
            @Param("userId") String userId);

    default boolean hasFeedbackBeenSubmitted(String scheduleId, String userId) {
        return !findFeedbackByScheduleAndUser(scheduleId, userId).isEmpty();
    }

    /**
     * Batched attendance + engagement lookup for the learner "Past Sessions"
     * endpoint — one query for the whole page of schedule_ids instead of one
     * query per card (avoids N+1). Feeds both attendance_status and the
     * activity block (engagement_data + provider_total_duration_minutes) from
     * the same rows.
     */
    @Query("""
        SELECT l FROM LiveSessionLogs l
        WHERE l.scheduleId IN :scheduleIds
          AND l.userSourceId = :userId
          AND l.logType = 'ATTENDANCE_RECORDED'
    """)
    List<LiveSessionLogs> findAttendanceLogsForScheduleIdsAndUser(
            @Param("scheduleIds") List<String> scheduleIds,
            @Param("userId") String userId);
}