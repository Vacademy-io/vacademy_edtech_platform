package vacademy.io.admin_core_service.features.live_session.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import java.util.List;

@Repository
public interface LiveSessionRepository extends JpaRepository<LiveSession, String>, LiveSessionRepositoryCustom {

    public interface LiveSessionListProjection {
        String getSessionId();
        Integer getWaitingRoomTime();
        String getThumbnailFileId();
        String getBackgroundScoreFileId();
        String getSessionStreamingServiceType();
        String getScheduleId();
        java.util.Date getMeetingDate();
        java.sql.Time getStartTime();
        java.sql.Time getLastEntryTime();
        String getRecurrenceType();
        String getAccessLevel();
        String getTitle();
        String getSubject();
        String getMeetingLink();
        String getRegistrationFormLinkForPublicSessions();
        Boolean getAllowPlayPause();
        String getTimezone();
        String getLearnerButtonConfig();
        String getDefaultClassLink();
        String getDefaultClassName();
        String getLinkType();
        // Zoom (and any future provider) meeting id. Lets the learner UI decide
        // "join early" eligibility — once the meeting has been provisioned the
        // learner can join any time before the session window closes, even
        // ahead of the scheduled start.
        String getProviderMeetingId();
        // DEFAULT | PRE_JOINING. Drives whether the learner's waiting-room-window
        // button enters the waiting-room screen or joins the live class directly.
        String getWaitingRoomType();
    }

    /**
     * Projection backing the learner "Past Sessions" endpoint
     * (findPastSessionsForUserAndBatch). Deliberately separate from
     * {@link LiveSessionListProjection} — it carries institute_id (needed to
     * resolve the LIVE_SESSION_SETTING learnerDisplay flags) and the raw
     * provider_recordings_json (sanitized server-side into LearnerRecordingDTO),
     * neither of which the live/upcoming projection exposes.
     */
    public interface LearnerPastSessionProjection {
        String getSessionId();
        String getScheduleId();
        String getTitle();
        String getSubject();
        java.util.Date getMeetingDate();
        java.sql.Time getStartTime();
        java.sql.Time getLastEntryTime();
        String getTimezone();
        String getLinkType();
        String getThumbnailFileId();
        String getInstituteId();
        String getProviderRecordingsJson();
    }

    public interface ScheduledSessionProjection {
        String getScheduleId();
        String getSessionId();
        String getTitle();
        String getSubject();
        // See LiveSessionListProjection#getMeetingDate for why LocalDate.
        java.time.LocalDate getMeetingDate();
        java.sql.Time getStartTime();
        java.sql.Time getLastEntryTime();
        String getCustomMeetingLink();
        String getCustomWaitingRoomMediaId();
        String getDefaultMeetLink();
        String getWaitingRoomLink();
        String getStatus();
    }

    @Query(value = """
    SELECT
        s.id AS sessionId,
        ss.meeting_date AS meetingDate,
        ss.id AS scheduleId,
        ss.start_time AS startTime,
        ss.last_entry_time AS lastEntryTime,
        ss.recurrence_type AS recurrenceType,
        s.access_level AS accessLevel,
        s.title AS title,
        s.subject AS subject,
        COALESCE(ss.custom_meeting_link, s.default_meet_link) AS meetingLink,
        s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
        s.allow_play_pause AS allowPlayPause,
        COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
        s.learner_button_config AS learnerButtonConfig,
        ss.default_class_link AS defaultClassLink,
        ss.default_class_name AS defaultClassName,
        COALESCE(ss.link_type, s.link_type) AS linkType
    FROM live_session s
    JOIN session_schedules ss ON s.id = ss.session_id
    WHERE s.status = 'LIVE'
      AND ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
      AND s.institute_id = :instituteId
      AND ss.status != 'DELETED'
      AND (
            :restrictVisibility = FALSE
            OR s.created_by_user_id = :callerUserId
            OR EXISTS (
                SELECT 1 FROM live_session_instructors lsi
                WHERE lsi.session_id = s.id
                  AND lsi.status = 'ACTIVE'
                  AND lsi.user_id IN (:allowedUserIds)
            )
            OR (
                NOT EXISTS (
                    SELECT 1 FROM live_session_instructors lsi2
                    WHERE lsi2.session_id = s.id
                      AND lsi2.status = 'ACTIVE'
                )
                AND s.created_by_user_id IN (:allowedUserIds)
            )
          )
""", nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findCurrentlyLiveSessions(@Param("instituteId") String instituteId,
                                                                                     @Param("restrictVisibility") boolean restrictVisibility,
                                                                                     @Param("callerUserId") String callerUserId,
                                                                                     @Param("allowedUserIds") java.util.Collection<String> allowedUserIds);


    @Query(value = """
    SELECT
        s.id AS sessionId,
        ss.id AS scheduleId,
        ss.meeting_date AS meetingDate,
        ss.start_time AS startTime,
        ss.last_entry_time AS lastEntryTime,
        ss.recurrence_type AS recurrenceType,
        s.access_level AS accessLevel,
        s.title AS title,
        s.subject AS subject,
        COALESCE(ss.custom_meeting_link, s.default_meet_link) AS meetingLink,
        s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
        s.allow_play_pause AS allowPlayPause,
        COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
        s.learner_button_config AS learnerButtonConfig,
        ss.default_class_link AS defaultClassLink,
        ss.default_class_name AS defaultClassName,
        COALESCE(ss.link_type, s.link_type) AS linkType
    FROM live_session s
    JOIN session_schedules ss ON s.id = ss.session_id
    WHERE s.status = 'LIVE'
    AND (
            ss.meeting_date > CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                    OR (ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date) 
                        AND CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) < ss.start_time)
          )
    AND s.institute_id = :instituteId
    AND ss.status != 'DELETED'
      AND (
            :restrictVisibility = FALSE
            OR s.created_by_user_id = :callerUserId
            OR EXISTS (
                SELECT 1 FROM live_session_instructors lsi
                WHERE lsi.session_id = s.id
                  AND lsi.status = 'ACTIVE'
                  AND lsi.user_id IN (:allowedUserIds)
            )
            OR (
                NOT EXISTS (
                    SELECT 1 FROM live_session_instructors lsi2
                    WHERE lsi2.session_id = s.id
                      AND lsi2.status = 'ACTIVE'
                )
                AND s.created_by_user_id IN (:allowedUserIds)
            )
          )
    ORDER BY ss.meeting_date ASC, ss.start_time ASC
""", nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findUpcomingSessions(@Param("instituteId") String instituteId,
                                                                                     @Param("restrictVisibility") boolean restrictVisibility,
                                                                                     @Param("callerUserId") String callerUserId,
                                                                                     @Param("allowedUserIds") java.util.Collection<String> allowedUserIds);

    @Query(value = """
    SELECT
        s.id AS sessionId,
        ss.id AS scheduleId,
        ss.meeting_date AS meetingDate,
        ss.start_time AS startTime,
        ss.last_entry_time AS lastEntryTime,
        ss.recurrence_type AS recurrenceType,
        s.access_level AS accessLevel,
        s.title AS title,
        s.subject AS subject,
        COALESCE(ss.custom_meeting_link, s.default_meet_link) AS meetingLink,
        s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
        s.allow_play_pause AS allowPlayPause,
        COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
        ss.default_class_link AS defaultClassLink,
        ss.default_class_name AS defaultClassName,
        s.learner_button_config AS learnerButtonConfig,
        COALESCE(ss.link_type, s.link_type) AS linkType
    FROM live_session s
    JOIN session_schedules ss ON s.id = ss.session_id
    WHERE s.status = 'LIVE'
      AND (
            ss.meeting_date < CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
            OR (ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date) 
                AND CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) > ss.last_entry_time)
          )
      AND s.institute_id = :instituteId
      AND ss.status != 'DELETED'
      AND (
            :restrictVisibility = FALSE
            OR s.created_by_user_id = :callerUserId
            OR EXISTS (
                SELECT 1 FROM live_session_instructors lsi
                WHERE lsi.session_id = s.id
                  AND lsi.status = 'ACTIVE'
                  AND lsi.user_id IN (:allowedUserIds)
            )
            OR (
                NOT EXISTS (
                    SELECT 1 FROM live_session_instructors lsi2
                    WHERE lsi2.session_id = s.id
                      AND lsi2.status = 'ACTIVE'
                )
                AND s.created_by_user_id IN (:allowedUserIds)
            )
          )
    ORDER BY ss.meeting_date ASC, ss.start_time ASC
    """, nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findPreviousSessions(@Param("instituteId") String instituteId,
                                                                                     @Param("restrictVisibility") boolean restrictVisibility,
                                                                                     @Param("callerUserId") String callerUserId,
                                                                                     @Param("allowedUserIds") java.util.Collection<String> allowedUserIds);

    @Query(value = """
    SELECT
        s.id AS sessionId,
        ss.id AS scheduleId,
        ss.meeting_date AS meetingDate,
        ss.start_time AS startTime,
        ss.last_entry_time AS lastEntryTime,
        ss.recurrence_type AS recurrenceType,
        s.access_level AS accessLevel,
        s.title AS title,
        s.subject AS subject,
        COALESCE(ss.custom_meeting_link, s.default_meet_link) AS meetingLink,
        s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
        s.allow_play_pause AS allowPlayPause,
        COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
        ss.default_class_link AS defaultClassLink,
        ss.default_class_name AS defaultClassName,
        s.learner_button_config AS learnerButtonConfig,
        COALESCE(ss.link_type, s.link_type) AS linkType
    FROM live_session s
    JOIN session_schedules ss ON s.id = ss.session_id
    WHERE s.status = 'DRAFT'
    AND s.institute_id = :instituteId
    AND ss.status != 'DELETED'
      AND (
            :restrictVisibility = FALSE
            OR s.created_by_user_id = :callerUserId
            OR EXISTS (
                SELECT 1 FROM live_session_instructors lsi
                WHERE lsi.session_id = s.id
                  AND lsi.status = 'ACTIVE'
                  AND lsi.user_id IN (:allowedUserIds)
            )
            OR (
                NOT EXISTS (
                    SELECT 1 FROM live_session_instructors lsi2
                    WHERE lsi2.session_id = s.id
                      AND lsi2.status = 'ACTIVE'
                )
                AND s.created_by_user_id IN (:allowedUserIds)
            )
          )
    """, nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findDraftedSessions(@Param("instituteId") String instituteId,
                                                                                     @Param("restrictVisibility") boolean restrictVisibility,
                                                                                     @Param("callerUserId") String callerUserId,
                                                                                     @Param("allowedUserIds") java.util.Collection<String> allowedUserIds);

    @Query(value = """
        SELECT DISTINCT
            s.id AS sessionId,
            s.waiting_room_time AS waitingRoomTime,
            s.waiting_room_type AS waitingRoomType,
            s.thumbnail_file_id AS thumbnailFileId,
            s.background_score_file_id AS backgroundScoreFileId,
            s.session_streaming_service_type AS sessionStreamingServiceType,
            ss.id AS scheduleId,
            ss.meeting_date AS meetingDate,
            ss.start_time AS startTime,
            ss.last_entry_time AS lastEntryTime,
            ss.recurrence_type AS recurrenceType,
            s.access_level AS accessLevel,
            s.title AS title,
            s.subject AS subject,
            s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
            s.allow_play_pause AS allowPlayPause,
            COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
            CASE
                WHEN ss.custom_meeting_link IS NOT NULL AND ss.custom_meeting_link <> '' THEN ss.custom_meeting_link
                ELSE s.default_meet_link
            END AS meetingLink,
            s.learner_button_config AS learnerButtonConfig,
            ss.default_class_link AS defaultClassLink,
            ss.default_class_name AS defaultClassName,
            COALESCE(ss.link_type, s.link_type) AS linkType
        FROM session_schedules ss
        JOIN live_session s ON ss.session_id = s.id
        JOIN live_session_participants lsp ON lsp.session_id = s.id
        WHERE lsp.source_type = 'BATCH'
          AND lsp.source_id = :batchId
          AND ss.meeting_date >= CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
          AND s.status IN ('DRAFT', 'LIVE')
          AND ss.status != 'DELETED'
        ORDER BY ss.meeting_date, ss.start_time
    """, nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findUpcomingSessionsForBatch(@Param("batchId") String batchId);

    @Query(value = """
        SELECT DISTINCT
            s.id AS sessionId,
            s.waiting_room_time AS waitingRoomTime,
            s.waiting_room_type AS waitingRoomType,
            s.thumbnail_file_id AS thumbnailFileId,
            s.background_score_file_id AS backgroundScoreFileId,
            s.session_streaming_service_type AS sessionStreamingServiceType,
            ss.id AS scheduleId,
            ss.meeting_date AS meetingDate,
            ss.start_time AS startTime,
            ss.last_entry_time AS lastEntryTime,
            ss.recurrence_type AS recurrenceType,
            s.access_level AS accessLevel,
            s.title AS title,
            s.subject AS subject,
            s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
            s.allow_play_pause AS allowPlayPause,
            COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
            CASE
                WHEN ss.custom_meeting_link IS NOT NULL AND ss.custom_meeting_link <> '' THEN ss.custom_meeting_link
                ELSE s.default_meet_link
            END AS meetingLink,
            s.learner_button_config AS learnerButtonConfig,
            ss.default_class_link AS defaultClassLink,
            ss.default_class_name AS defaultClassName,
            COALESCE(ss.link_type, s.link_type) AS linkType
        FROM session_schedules ss
        JOIN live_session s ON ss.session_id = s.id
        JOIN live_session_participants lsp ON lsp.session_id = s.id
        WHERE lsp.source_type = 'USER'
          AND lsp.source_id = :userId
          AND ss.meeting_date >= CURRENT_DATE - INTERVAL '1 day'
          AND s.status IN ('DRAFT', 'LIVE')
          AND ss.status != 'DELETED'
        ORDER BY ss.meeting_date, ss.start_time
    """, nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findUpcomingSessionsForUser(@Param("userId") String userId);

    @Query(value = """
        SELECT DISTINCT
            s.id AS sessionId,
            s.waiting_room_time AS waitingRoomTime,
            s.waiting_room_type AS waitingRoomType,
            s.thumbnail_file_id AS thumbnailFileId,
            s.background_score_file_id AS backgroundScoreFileId,
            s.session_streaming_service_type AS sessionStreamingServiceType,
            ss.id AS scheduleId,
            ss.meeting_date AS meetingDate,
            ss.start_time AS startTime,
            ss.last_entry_time AS lastEntryTime,
            ss.recurrence_type AS recurrenceType,
            s.access_level AS accessLevel,
            s.title AS title,
            s.subject AS subject,
            s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
            s.allow_play_pause AS allowPlayPause,
            COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
            CASE
                WHEN ss.custom_meeting_link IS NOT NULL AND ss.custom_meeting_link <> '' THEN ss.custom_meeting_link
                ELSE s.default_meet_link
            END AS meetingLink,
            s.learner_button_config AS learnerButtonConfig,
            ss.default_class_link AS defaultClassLink,
            ss.default_class_name AS defaultClassName,
            COALESCE(ss.link_type, s.link_type) AS linkType
        FROM session_schedules ss
        JOIN live_session s ON ss.session_id = s.id
        JOIN live_session_participants lsp ON lsp.session_id = s.id
        WHERE (
            (:batchId IS NOT NULL AND lsp.source_type = 'BATCH' AND lsp.source_id = :batchId)
            OR
            (:userId IS NOT NULL AND lsp.source_type = 'USER' AND lsp.source_id = :userId)
        )
        AND ss.meeting_date >= CURRENT_DATE - INTERVAL '1 day'
        AND s.status IN ('DRAFT', 'LIVE')
        AND ss.status != 'DELETED'
        ORDER BY ss.meeting_date, ss.start_time
    """, nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findUpcomingSessionsForUserAndBatch(
        @Param("batchId") String batchId,
        @Param("userId") String userId
    );

    @Query(value = """
        SELECT DISTINCT
            s.id AS sessionId,
            s.waiting_room_time AS waitingRoomTime,
            s.waiting_room_type AS waitingRoomType,
            s.thumbnail_file_id AS thumbnailFileId,
            s.background_score_file_id AS backgroundScoreFileId,
            s.session_streaming_service_type AS sessionStreamingServiceType,
            ss.id AS scheduleId,
            ss.meeting_date AS meetingDate,
            ss.start_time AS startTime,
            ss.last_entry_time AS lastEntryTime,
            ss.recurrence_type AS recurrenceType,
            s.access_level AS accessLevel,
            s.title AS title,
            s.subject AS subject,
            s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
            s.allow_play_pause AS allowPlayPause,
            COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
            CASE
                WHEN ss.custom_meeting_link IS NOT NULL AND ss.custom_meeting_link <> '' THEN ss.custom_meeting_link
                ELSE s.default_meet_link
            END AS meetingLink,
            s.learner_button_config AS learnerButtonConfig,
            ss.default_class_link AS defaultClassLink,
            ss.default_class_name AS defaultClassName,
            COALESCE(ss.link_type, s.link_type) AS linkType,
            ss.provider_meeting_id AS providerMeetingId
        FROM session_schedules ss
        JOIN live_session s ON ss.session_id = s.id
        JOIN live_session_participants lsp ON lsp.session_id = s.id
        WHERE (
            (:batchId IS NOT NULL AND lsp.source_type = 'BATCH' AND lsp.source_id = :batchId)
            OR
            (:userId IS NOT NULL AND lsp.source_type = 'USER' AND lsp.source_id = :userId)
        )
        AND ss.meeting_date >= COALESCE(CAST(:startDate AS DATE), CURRENT_DATE - INTERVAL '1 day')
        AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))
        AND s.status IN ('DRAFT', 'LIVE')
        AND ss.status != 'DELETED'
        AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)
        ORDER BY ss.meeting_date, ss.start_time
        LIMIT CASE WHEN :size IS NULL THEN NULL ELSE :size END
        OFFSET CASE WHEN :offset IS NULL THEN 0 ELSE :offset END
    """, nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findUpcomingSessionsForUserAndBatchWithFilters(
        @Param("batchId") String batchId,
        @Param("userId") String userId,
        @Param("startDate") String startDate,
        @Param("endDate") String endDate,
        @Param("offset") Integer offset,
        @Param("size") Integer size,
        @Param("learnerVisibleOnly") boolean learnerVisibleOnly
    );

    /**
     * Learner "Past Sessions" — mirrors findUpcomingSessionsForUserAndBatchWithFilters
     * scoping (BATCH participant on :batchId OR USER participant on :userId) but
     * inverted to strictly-past occurrences, computed timezone-aware in the
     * session's own timezone (never the server date — see
     * findUpcomingSessions/findPreviousSessions for the same idiom). Only LIVE
     * sessions are surfaced (DRAFT/DELETED excluded from history). Paged newest
     * first via Pageable + an explicit countQuery (native pagination).
     *
     * NOTE: no SQL comments or stray apostrophes inside this query string — the
     * Spring SpEL QuotationMap parser breaks on them (see plan doc gotchas).
     */
    @Query(value = """
        SELECT DISTINCT
            s.id AS sessionId,
            ss.id AS scheduleId,
            s.title AS title,
            s.subject AS subject,
            ss.meeting_date AS meetingDate,
            ss.start_time AS startTime,
            ss.last_entry_time AS lastEntryTime,
            COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
            COALESCE(ss.link_type, s.link_type) AS linkType,
            COALESCE(ss.thumbnail_file_id, s.thumbnail_file_id, s.cover_file_id) AS thumbnailFileId,
            s.institute_id AS instituteId,
            ss.provider_recordings_json AS providerRecordingsJson
        FROM session_schedules ss
        JOIN live_session s ON ss.session_id = s.id
        JOIN live_session_participants lsp ON lsp.session_id = s.id
        WHERE (
            (:batchId IS NOT NULL AND lsp.source_type = 'BATCH' AND lsp.source_id = :batchId)
            OR
            (:userId IS NOT NULL AND lsp.source_type = 'USER' AND lsp.source_id = :userId)
        )
        AND s.status = 'LIVE'
        AND ss.status != 'DELETED'
        AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)
        AND (
            ss.meeting_date < CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
            OR (ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                AND CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) > ss.last_entry_time)
        )
        AND (:startDate IS NULL OR ss.meeting_date >= CAST(:startDate AS DATE))
        AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))
        ORDER BY ss.meeting_date DESC, ss.start_time DESC
    """,
    countQuery = """
        SELECT COUNT(DISTINCT ss.id)
        FROM session_schedules ss
        JOIN live_session s ON ss.session_id = s.id
        JOIN live_session_participants lsp ON lsp.session_id = s.id
        WHERE (
            (:batchId IS NOT NULL AND lsp.source_type = 'BATCH' AND lsp.source_id = :batchId)
            OR
            (:userId IS NOT NULL AND lsp.source_type = 'USER' AND lsp.source_id = :userId)
        )
        AND s.status = 'LIVE'
        AND ss.status != 'DELETED'
        AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)
        AND (
            ss.meeting_date < CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
            OR (ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                AND CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) > ss.last_entry_time)
        )
        AND (:startDate IS NULL OR ss.meeting_date >= CAST(:startDate AS DATE))
        AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))
    """,
    nativeQuery = true)
    Page<LiveSessionRepository.LearnerPastSessionProjection> findPastSessionsForUserAndBatch(
        @Param("batchId") String batchId,
        @Param("userId") String userId,
        @Param("startDate") String startDate,
        @Param("endDate") String endDate,
        @Param("learnerVisibleOnly") boolean learnerVisibleOnly,
        Pageable pageable
    );

    /**
     * findUpcomingSessionsForUserAndBatchWithFilters PLUS every unassigned public
     * class of the institute: access_level public (stored lowercase, legacy rows
     * uppercase), status LIVE (drafts never broadcast), and no
     * live_session_participants row of any kind. A public class an admin attached
     * to a batch or to individual learners keeps its targeting.
     *
     * Only called when the institute opted in (STUDENT_DISPLAY_SETTINGS
     * liveClasses.showUnassignedPublicSessions) and the learner is enrolled there.
     * A separate query rather than an OR on the original one: an OR across the two
     * branches moves the planner off the participant index onto a
     * session_schedules date scan. UNION keeps each branch on its own index and
     * removes overlap. Paging is applied after the UNION so offsets stay correct.
     */
    @Query(value = """
        SELECT * FROM (
            SELECT DISTINCT
                s.id AS sessionId,
                s.waiting_room_time AS waitingRoomTime,
                s.waiting_room_type AS waitingRoomType,
                s.thumbnail_file_id AS thumbnailFileId,
                s.background_score_file_id AS backgroundScoreFileId,
                s.session_streaming_service_type AS sessionStreamingServiceType,
                ss.id AS scheduleId,
                ss.meeting_date AS meetingDate,
                ss.start_time AS startTime,
                ss.last_entry_time AS lastEntryTime,
                ss.recurrence_type AS recurrenceType,
                s.access_level AS accessLevel,
                s.title AS title,
                s.subject AS subject,
                s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
                s.allow_play_pause AS allowPlayPause,
                COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
                CASE
                    WHEN ss.custom_meeting_link IS NOT NULL AND ss.custom_meeting_link <> '' THEN ss.custom_meeting_link
                    ELSE s.default_meet_link
                END AS meetingLink,
                s.learner_button_config AS learnerButtonConfig,
                ss.default_class_link AS defaultClassLink,
                ss.default_class_name AS defaultClassName,
                COALESCE(ss.link_type, s.link_type) AS linkType,
                ss.provider_meeting_id AS providerMeetingId
            FROM session_schedules ss
            JOIN live_session s ON ss.session_id = s.id
            JOIN live_session_participants lsp ON lsp.session_id = s.id
            WHERE (
                (:batchId IS NOT NULL AND lsp.source_type = 'BATCH' AND lsp.source_id = :batchId)
                OR
                (:userId IS NOT NULL AND lsp.source_type = 'USER' AND lsp.source_id = :userId)
            )
            AND ss.meeting_date >= COALESCE(CAST(:startDate AS DATE), CURRENT_DATE - INTERVAL '1 day')
            AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))
            AND s.status IN ('DRAFT', 'LIVE')
            AND ss.status != 'DELETED'
            AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)

            UNION

            SELECT
                s.id AS sessionId,
                s.waiting_room_time AS waitingRoomTime,
                s.waiting_room_type AS waitingRoomType,
                s.thumbnail_file_id AS thumbnailFileId,
                s.background_score_file_id AS backgroundScoreFileId,
                s.session_streaming_service_type AS sessionStreamingServiceType,
                ss.id AS scheduleId,
                ss.meeting_date AS meetingDate,
                ss.start_time AS startTime,
                ss.last_entry_time AS lastEntryTime,
                ss.recurrence_type AS recurrenceType,
                s.access_level AS accessLevel,
                s.title AS title,
                s.subject AS subject,
                s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
                s.allow_play_pause AS allowPlayPause,
                COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
                CASE
                    WHEN ss.custom_meeting_link IS NOT NULL AND ss.custom_meeting_link <> '' THEN ss.custom_meeting_link
                    ELSE s.default_meet_link
                END AS meetingLink,
                s.learner_button_config AS learnerButtonConfig,
                ss.default_class_link AS defaultClassLink,
                ss.default_class_name AS defaultClassName,
                COALESCE(ss.link_type, s.link_type) AS linkType,
                ss.provider_meeting_id AS providerMeetingId
            FROM session_schedules ss
            JOIN live_session s ON ss.session_id = s.id
            WHERE s.institute_id = :instituteId
            AND s.status = 'LIVE'
            AND UPPER(s.access_level) = 'PUBLIC'
            AND NOT EXISTS (SELECT 1 FROM live_session_participants p WHERE p.session_id = s.id)
            AND ss.meeting_date >= COALESCE(CAST(:startDate AS DATE), CURRENT_DATE - INTERVAL '1 day')
            AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))
            AND ss.status != 'DELETED'
            AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)
        ) learner_sessions
        ORDER BY learner_sessions.meetingDate, learner_sessions.startTime, learner_sessions.scheduleId
        LIMIT CASE WHEN :size IS NULL THEN NULL ELSE :size END
        OFFSET CASE WHEN :offset IS NULL THEN 0 ELSE :offset END
    """, nativeQuery = true)
    List<LiveSessionRepository.LiveSessionListProjection> findUpcomingSessionsForUserAndBatchIncludingUnassignedPublic(
        @Param("batchId") String batchId,
        @Param("userId") String userId,
        @Param("instituteId") String instituteId,
        @Param("startDate") String startDate,
        @Param("endDate") String endDate,
        @Param("offset") Integer offset,
        @Param("size") Integer size,
        @Param("learnerVisibleOnly") boolean learnerVisibleOnly
    );

    /**
     * findPastSessionsForUserAndBatch PLUS the institute unassigned public
     * classes, same branch rules as
     * findUpcomingSessionsForUserAndBatchIncludingUnassignedPublic. Gated by the
     * caller exactly like the upcoming variant.
     */
    @Query(value = """
        SELECT * FROM (
            SELECT DISTINCT
                s.id AS sessionId,
                ss.id AS scheduleId,
                s.title AS title,
                s.subject AS subject,
                ss.meeting_date AS meetingDate,
                ss.start_time AS startTime,
                ss.last_entry_time AS lastEntryTime,
                COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
                COALESCE(ss.link_type, s.link_type) AS linkType,
                COALESCE(ss.thumbnail_file_id, s.thumbnail_file_id, s.cover_file_id) AS thumbnailFileId,
                s.institute_id AS instituteId,
                ss.provider_recordings_json AS providerRecordingsJson
            FROM session_schedules ss
            JOIN live_session s ON ss.session_id = s.id
            JOIN live_session_participants lsp ON lsp.session_id = s.id
            WHERE (
                (:batchId IS NOT NULL AND lsp.source_type = 'BATCH' AND lsp.source_id = :batchId)
                OR
                (:userId IS NOT NULL AND lsp.source_type = 'USER' AND lsp.source_id = :userId)
            )
            AND s.status = 'LIVE'
            AND ss.status != 'DELETED'
            AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)
            AND (
                ss.meeting_date < CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                OR (ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                    AND CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) > ss.last_entry_time)
            )
            AND (:startDate IS NULL OR ss.meeting_date >= CAST(:startDate AS DATE))
            AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))

            UNION

            SELECT
                s.id AS sessionId,
                ss.id AS scheduleId,
                s.title AS title,
                s.subject AS subject,
                ss.meeting_date AS meetingDate,
                ss.start_time AS startTime,
                ss.last_entry_time AS lastEntryTime,
                COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
                COALESCE(ss.link_type, s.link_type) AS linkType,
                COALESCE(ss.thumbnail_file_id, s.thumbnail_file_id, s.cover_file_id) AS thumbnailFileId,
                s.institute_id AS instituteId,
                ss.provider_recordings_json AS providerRecordingsJson
            FROM session_schedules ss
            JOIN live_session s ON ss.session_id = s.id
            WHERE s.institute_id = :instituteId
            AND s.status = 'LIVE'
            AND UPPER(s.access_level) = 'PUBLIC'
            AND NOT EXISTS (SELECT 1 FROM live_session_participants p WHERE p.session_id = s.id)
            AND ss.status != 'DELETED'
            AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)
            AND (
                ss.meeting_date < CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                OR (ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                    AND CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) > ss.last_entry_time)
            )
            AND (:startDate IS NULL OR ss.meeting_date >= CAST(:startDate AS DATE))
            AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))
        ) learner_past_sessions
        ORDER BY learner_past_sessions.meetingDate DESC, learner_past_sessions.startTime DESC, learner_past_sessions.scheduleId
    """,
    countQuery = """
        SELECT COUNT(*) FROM (
            SELECT ss.id
            FROM session_schedules ss
            JOIN live_session s ON ss.session_id = s.id
            JOIN live_session_participants lsp ON lsp.session_id = s.id
            WHERE (
                (:batchId IS NOT NULL AND lsp.source_type = 'BATCH' AND lsp.source_id = :batchId)
                OR
                (:userId IS NOT NULL AND lsp.source_type = 'USER' AND lsp.source_id = :userId)
            )
            AND s.status = 'LIVE'
            AND ss.status != 'DELETED'
            AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)
            AND (
                ss.meeting_date < CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                OR (ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                    AND CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) > ss.last_entry_time)
            )
            AND (:startDate IS NULL OR ss.meeting_date >= CAST(:startDate AS DATE))
            AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))

            UNION

            SELECT ss.id
            FROM session_schedules ss
            JOIN live_session s ON ss.session_id = s.id
            WHERE s.institute_id = :instituteId
            AND s.status = 'LIVE'
            AND UPPER(s.access_level) = 'PUBLIC'
            AND NOT EXISTS (SELECT 1 FROM live_session_participants p WHERE p.session_id = s.id)
            AND ss.status != 'DELETED'
            AND (:learnerVisibleOnly = FALSE OR s.show_to_learners IS TRUE)
            AND (
                ss.meeting_date < CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                OR (ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)
                    AND CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) > ss.last_entry_time)
            )
            AND (:startDate IS NULL OR ss.meeting_date >= CAST(:startDate AS DATE))
            AND (:endDate IS NULL OR ss.meeting_date <= CAST(:endDate AS DATE))
        ) learner_past_schedule_ids
    """,
    nativeQuery = true)
    Page<LiveSessionRepository.LearnerPastSessionProjection> findPastSessionsForUserAndBatchIncludingUnassignedPublic(
        @Param("batchId") String batchId,
        @Param("userId") String userId,
        @Param("instituteId") String instituteId,
        @Param("startDate") String startDate,
        @Param("endDate") String endDate,
        @Param("learnerVisibleOnly") boolean learnerVisibleOnly,
        Pageable pageable
    );

    @Modifying
    @Transactional
    @Query(value = "UPDATE live_session SET status = 'DELETED' WHERE id = :sessionId", nativeQuery = true)
    void softDeleteLiveSessionById(@Param("sessionId") String sessionId);

    @Query("SELECT s FROM LiveSession s WHERE s.instituteId = :instituteId AND s.status = :status")
    List<LiveSession> findByInstituteIdAndStatus(@Param("instituteId") String instituteId, @Param("status") String status);

    @Query("SELECT s FROM LiveSession s WHERE s.instituteId = :instituteId")
    List<LiveSession> findByInstituteId(@Param("instituteId") String instituteId);

    /**
     * LIVE Zoom sessions that have stored provisioning config but still hold a
     * schedule with no provider meeting — i.e. up-front async provisioning was
     * interrupted. Bounded to schedules created before {@code staleBefore} (so the
     * in-flight async run isn't double-provisioned) and on/after {@code earliestDate}
     * (don't scan ancient sessions). Drives the provisioning retry job.
     */
    @Query(value = """
        SELECT DISTINCT ls.* FROM live_session ls
        JOIN session_schedules ss ON ss.session_id = ls.id
        WHERE ls.status = 'LIVE'
          AND ls.zoom_account_id IS NOT NULL
          AND ss.status <> 'DELETED'
          AND (ss.provider_meeting_id IS NULL OR ss.provider_meeting_id = '')
          AND ss.created_at < :staleBefore
          AND ss.meeting_date >= :earliestDate
        """, nativeQuery = true)
    List<LiveSession> findZoomSessionsNeedingProvisionRetry(
            @Param("staleBefore") java.util.Date staleBefore,
            @Param("earliestDate") java.sql.Date earliestDate);
}
