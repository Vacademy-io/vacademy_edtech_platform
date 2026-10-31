package vacademy.io.admin_core_service.features.hr_teaching.repository;

import java.sql.Date;
import java.sql.Time;

/**
 * One row per (teacher, session occurrence) in a month: the schedule itself
 * plus the teacher's own latest ATTENDANCE_RECORDED log for that occurrence
 * (null columns when the teacher has no log). The teacher is the session's
 * {@code live_session.created_by_user_id} — the only host identity the
 * live-session model carries.
 */
public interface TeachingScheduleProjection {

    String getTeacherUserId();

    String getSessionId();

    String getSessionTitle();

    String getSubject();

    String getScheduleId();

    /** DATE column — convert via {@code toLocalDate()}. */
    Date getMeetingDate();

    /** TIME column — convert via {@code toLocalTime()}; may be null. */
    Time getStartTime();

    /** TIME column — convert via {@code toLocalTime()}; may be null. */
    Time getLastEntryTime();

    /** Status of the teacher's attendance log; null when no log exists. */
    String getAttendanceStatus();

    /** Provider minutes (whole minutes, e.g. Zoom); may be null. */
    Integer getDurationMinutes();

    /** Provider seconds (BBB only, V471); may be null. */
    Integer getDurationSeconds();
}
