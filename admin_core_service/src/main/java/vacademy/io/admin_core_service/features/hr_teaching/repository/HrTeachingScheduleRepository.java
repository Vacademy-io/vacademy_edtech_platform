package vacademy.io.admin_core_service.features.hr_teaching.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;

import java.time.LocalDate;
import java.util.List;

/**
 * hr_teaching's OWN read-only query surface over the live-session schema
 * (Phase F2 "LMS teaching → pay"). Deliberately not added to the live_session
 * repositories — this feature owns its query shape and can evolve it without
 * touching that module.
 */
// NOTE: keep SQL "--" comments OUT of the native @Query text block below. Spring
// Data's SpEL QuotationMap scans the whole string for apostrophes before binding
// params, so a lone "'" in a SQL comment crashes boot. Explanations live in Java
// "//" comments like this one.
@Repository
public interface HrTeachingScheduleRepository extends JpaRepository<LiveSession, String> {

    // One row per schedule occurrence of the month whose parent session was
    // created by an institute user (created_by_user_id = the host/teacher).
    // The LATERAL join picks the teacher's OWN latest ATTENDANCE_RECORDED log
    // for that occurrence, mirroring the shape of
    // LiveSessionParticipantRepository.findAttendanceForUser.
    @Query(value = """
        SELECT
            ls.created_by_user_id AS teacherUserId,
            ls.id AS sessionId,
            ls.title AS sessionTitle,
            ls.subject AS subject,
            ss.id AS scheduleId,
            ss.meeting_date AS meetingDate,
            ss.start_time AS startTime,
            ss.last_entry_time AS lastEntryTime,
            lsl.status AS attendanceStatus,
            lsl.provider_total_duration_minutes AS durationMinutes,
            lsl.provider_total_duration_seconds AS durationSeconds
        FROM session_schedules ss
        JOIN live_session ls ON ls.id = ss.session_id
        LEFT JOIN LATERAL (
            SELECT status, provider_total_duration_minutes, provider_total_duration_seconds
            FROM live_session_logs
            WHERE session_id = ls.id
              AND schedule_id = ss.id
              AND user_source_type = 'USER'
              AND user_source_id = ls.created_by_user_id
              AND log_type = 'ATTENDANCE_RECORDED'
            ORDER BY created_at DESC
            LIMIT 1
        ) lsl ON TRUE
        WHERE ls.institute_id = :instituteId
          AND ls.created_by_user_id IS NOT NULL
          AND ss.meeting_date BETWEEN :fromDate AND :toDate
          AND ls.status <> 'DELETED'
          AND ss.status <> 'DELETED'
        ORDER BY ls.created_by_user_id, ss.meeting_date, ss.start_time
        """, nativeQuery = true)
    List<TeachingScheduleProjection> findTeachingSchedules(
            @Param("instituteId") String instituteId,
            @Param("fromDate") LocalDate fromDate,
            @Param("toDate") LocalDate toDate);
}
