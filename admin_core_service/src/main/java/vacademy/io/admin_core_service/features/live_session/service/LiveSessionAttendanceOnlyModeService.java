package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;

import java.util.Optional;

/**
 * "Attendance only" mode — {@code LIVE_SESSION_SETTING.attendanceOnlyMode}.
 *
 * <p>For institutes that teach offline and create live classes only so that
 * attendance can be marked in the system. When on, learners (and parents) are
 * never shown the institute's live classes — upcoming, live or past — while
 * the attendance endpoints ({@code /live-session-report/student-report},
 * {@code /learner/reports/attendance}) are untouched, so learners still see
 * their attendance.
 *
 * <p>Learner notifications for those classes (on create, reminders, on live,
 * edit, cancel, attendance marked) are not sent either; instructors still get
 * theirs. Booked meetings (booking pages / mentorship) are exempt — the
 * attendee booked them and expects the confirmation and reminders.
 *
 * <p>Per class: a class saved with {@code live_session.show_to_learners = TRUE}
 * is a normal online class even while the mode is on — it is listed to
 * learners and parents and its learner notifications go out. FALSE or NULL
 * (every class created before the per-class choice existed) stays attendance
 * only. The learner list queries apply this in SQL so paging stays correct.
 *
 * <p>A live switch, not a scheduling default: it applies to classes that
 * already exist too. Off when the setting is absent or unreadable — this sits
 * on learner-facing list endpoints and must never throw.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LiveSessionAttendanceOnlyModeService {

    private static final String LIVE_SESSION_SETTING_KEY = "LIVE_SESSION_SETTING";
    private static final String ATTENDANCE_ONLY_MODE_NODE = "attendanceOnlyMode";
    /** MeetingBookingService.SOURCE_MEETING_BOOKING. */
    private static final String SOURCE_MEETING_BOOKING = "MEETING_BOOKING";

    private final InstituteSettingService instituteSettingService;
    private final PackageSessionRepository packageSessionRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final ObjectMapper objectMapper;

    public boolean isEnabled(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return false;
        }
        try {
            Object rawData = instituteSettingService.getSettingByInstituteIdAndKey(
                    instituteId, LIVE_SESSION_SETTING_KEY);
            if (rawData == null) {
                return false;
            }
            return objectMapper.valueToTree(rawData).path(ATTENDANCE_ONLY_MODE_NODE).asBoolean(false);
        } catch (Exception e) {
            log.warn("live_session.attendance_only.settings_read_failed instituteId={}: {}",
                    instituteId, e.getMessage());
            return false;
        }
    }

    /**
     * Whether learner notifications for this session must be skipped. The
     * session is only loaded when the institute has the mode on, so institutes
     * without it pay one settings read and nothing else.
     */
    public boolean suppressesLearnerNotifications(String instituteId, String sessionId) {
        if (!isEnabled(instituteId)) {
            return false;
        }
        try {
            return liveSessionRepository.findById(sessionId)
                    .map(session -> !isBookedMeeting(session) && !isShownToLearners(session))
                    .orElse(true);
        } catch (Exception e) {
            log.warn("live_session.attendance_only.session_read_failed sessionId={}: {}",
                    sessionId, e.getMessage());
            return true;
        }
    }

    public boolean suppressesLearnerNotifications(LiveSession session) {
        return session != null && !isBookedMeeting(session) && !isShownToLearners(session)
                && isEnabled(session.getInstituteId());
    }

    private boolean isShownToLearners(LiveSession session) {
        return Boolean.TRUE.equals(session.getShowToLearners());
    }

    private boolean isBookedMeeting(LiveSession session) {
        return StringUtils.hasText(session.getBookingTypeId())
                || SOURCE_MEETING_BOOKING.equals(session.getSource());
    }

    /**
     * Whether a learner list request must be limited to classes marked
     * {@code show_to_learners}. Institute is the
     * instituteId param (the learner app always sends its current one), else
     * the batch's institute. Deliberately no "any active enrolment" fallback:
     * that lookup is LIMIT 1, so for a learner in two institutes it could hide
     * the other institute's classes. Unresolved means not hidden.
     */
    public boolean hidesLearnerSessions(String batchId, String instituteId) {
        if (StringUtils.hasText(instituteId)) {
            return isEnabled(instituteId);
        }
        if (!StringUtils.hasText(batchId)) {
            return false;
        }
        try {
            Optional<String> resolved = packageSessionRepository.findInstituteIdByPackageSessionId(batchId);
            return resolved.isPresent() && isEnabled(resolved.get());
        } catch (Exception e) {
            log.warn("live_session.attendance_only.institute_resolve_failed batchId={}: {}",
                    batchId, e.getMessage());
            return false;
        }
    }
}
