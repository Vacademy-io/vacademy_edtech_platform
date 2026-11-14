package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionDeleteAuditDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.ScheduleNotificationRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.scheduler.LiveSessionNotificationProcessor;

import java.sql.Time;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Deleting one class of a recurring session (the Past tab's Delete) must actually
 * mark that occurrence DELETED, and the activity-log snapshot must name the class.
 */
@ExtendWith(MockitoExtension.class)
class GetLiveSessionServiceDeleteTest {

    @Mock
    private LiveSessionRepository sessionRepository;
    @Mock
    private SessionScheduleRepository scheduleRepository;
    @Mock
    private LiveSessionNotificationProcessor notificationProcessor;
    @Mock
    private ScheduleNotificationRepository scheduleNotificationRepository;

    @InjectMocks
    private GetLiveSessionService service;

    private static LiveSession session(String id, String title) {
        LiveSession s = new LiveSession();
        s.setId(id);
        s.setTitle(title);
        s.setInstituteId("inst-1");
        s.setTimezone("Asia/Kolkata");
        return s;
    }

    @Test
    @DisplayName("one occurrence of a recurring session is soft-deleted, after learners are notified")
    void occurrenceOfRecurringSessionIsDeleted() {
        when(scheduleRepository.findSessionIdByScheduleId("sch-1", "DELETED")).thenReturn("ses-1");
        when(scheduleRepository.countActiveSchedulesBySessionId("ses-1", "DELETED")).thenReturn(28);
        when(sessionRepository.findById("ses-1")).thenReturn(Optional.of(session("ses-1", "robotics intro")));

        service.deleteLiveSessions(List.of("sch-1"), "schedule", true);

        var order = inOrder(notificationProcessor, scheduleRepository);
        order.verify(notificationProcessor).sendDeleteNotificationForSchedules(List.of("sch-1"), "inst-1");
        order.verify(scheduleRepository).softDeleteScheduleByIdIn(List.of("sch-1"));
        verify(sessionRepository, never()).softDeleteLiveSessionById(anyString());
    }

    @Test
    @DisplayName("no notification when the caller opts out, and the occurrence is still deleted")
    void occurrenceDeletedWithoutNotification() {
        when(scheduleRepository.findSessionIdByScheduleId("sch-1", "DELETED")).thenReturn("ses-1");
        when(scheduleRepository.countActiveSchedulesBySessionId("ses-1", "DELETED")).thenReturn(5);
        when(sessionRepository.findById("ses-1")).thenReturn(Optional.of(session("ses-1", "maths")));

        service.deleteLiveSessions(List.of("sch-1"), "schedule", false);

        verify(notificationProcessor, never()).sendDeleteNotificationForSchedules(anyList(), anyString());
        verify(scheduleRepository).softDeleteScheduleByIdIn(List.of("sch-1"));
    }

    @Test
    @DisplayName("the last occurrence takes the session with it")
    void lastOccurrenceDeletesSession() {
        when(scheduleRepository.findSessionIdByScheduleId("sch-1", "DELETED")).thenReturn("ses-1");
        when(scheduleRepository.countActiveSchedulesBySessionId("ses-1", "DELETED")).thenReturn(1);
        when(sessionRepository.findById("ses-1")).thenReturn(Optional.of(session("ses-1", "maths")));

        service.deleteLiveSessions(List.of("sch-1"), "schedule", false);

        verify(scheduleRepository).softDeleteScheduleByIdIn(List.of("sch-1"));
        verify(sessionRepository).softDeleteLiveSessionById("ses-1");
    }

    @Test
    @DisplayName("audit snapshot names the class, its date, time and timezone")
    void auditSnapshotNamesTheClass() {
        SessionSchedule schedule = new SessionSchedule();
        schedule.setId("sch-1");
        schedule.setSessionId("ses-1");
        schedule.setMeetingDate(java.sql.Date.valueOf("2026-09-08"));
        schedule.setStartTime(Time.valueOf("10:00:00"));
        when(scheduleRepository.findById("sch-1")).thenReturn(Optional.of(schedule));
        when(sessionRepository.findById("ses-1")).thenReturn(Optional.of(session("ses-1", "robotics intro")));

        LiveSessionDeleteAuditDTO audit = service.deleteAuditSnapshot(List.of("sch-1"), "schedule");

        assertEquals("ses-1", audit.getSessionId());
        assertEquals("live class \"robotics intro\" on 08 Sep 2026 at 10:00 (Asia/Kolkata)", audit.getLabel());
    }

    @Test
    @DisplayName("audit snapshot never throws — a failed lookup yields null")
    void auditSnapshotIsTotal() {
        when(scheduleRepository.findById("sch-1")).thenThrow(new RuntimeException("db down"));

        assertNull(service.deleteAuditSnapshot(List.of("sch-1"), "schedule"));
        assertNull(service.deleteAuditSnapshot(List.of(), "schedule"));
    }
}
