package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionLogs;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccount;
import vacademy.io.admin_core_service.features.live_session.provider.manager.ZoomMeetingManager;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.meeting.dto.MeetingAttendeeDTO;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ZoomAttendanceServiceTest {

    private static final String SESSION_ID = "sess-1";
    private static final String SCHEDULE_ID = "sched-1";
    private static final String MEETING_ID = "123456";

    @Mock private LiveSessionLogsRepository liveSessionLogsRepository;
    @Mock private ZoomAccountStore zoomAccountStore;
    @Mock private ZoomMeetingManager zoomMeetingManager;
    @Mock private LiveSessionParticipantRepository participantRepository;
    @Mock private SessionScheduleRepository scheduleRepository;
    // Added to ZoomAttendanceService after this test was written; without the mock
    // @InjectMocks leaves the field null and every test here NPEs on the first sync.
    @Mock private vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository liveSessionRepository;
    @Mock private vacademy.io.admin_core_service.features.live_session.service.AttendanceCriteriaEvaluator attendanceCriteriaEvaluator;

    @InjectMocks private ZoomAttendanceService service;

    private SessionSchedule schedule() {
        return SessionSchedule.builder()
                .id(SCHEDULE_ID).sessionId(SESSION_ID)
                .providerMeetingId(MEETING_ID).providerAccountId("acct-1").build();
    }

    private MeetingAttendeeDTO attendee(String name, String email, int minutes, String join) {
        return MeetingAttendeeDTO.builder()
                .name(name).email(email).durationMinutes(minutes).joinTime(join).build();
    }

    @Test
    void aggregatesRejoinsResolvesUserAndKeepsGuests() {
        when(zoomAccountStore.findById("acct-1")).thenReturn(Optional.of(mock(ZoomAccount.class)));
        when(zoomMeetingManager.fetchAttendance(any(), eq(MEETING_ID))).thenReturn(List.of(
                attendee("Alice", "a@x.com", 30, "2026-06-10T10:00:00Z"),
                attendee("Alice", "a@x.com", 15, "2026-06-10T10:40:00Z"), // rejoin -> total 45
                attendee("Guest Bob", "bob@x.com", 20, "2026-06-10T10:05:00Z")));
        when(participantRepository.findEnrolledUserIdByEmail(SESSION_ID, "a@x.com")).thenReturn(List.of("user-a"));
        when(participantRepository.findEnrolledUserIdByEmail(SESSION_ID, "bob@x.com")).thenReturn(List.of());
        when(liveSessionLogsRepository.findExistingAttendanceRecord(eq(SCHEDULE_ID), anyString()))
                .thenReturn(Optional.empty());
        when(liveSessionLogsRepository.findExistingProviderAttendanceRecord(eq(SCHEDULE_ID), anyString()))
                .thenReturn(Optional.empty());

        int upserts = service.syncAttendance(schedule());

        assertEquals(2, upserts);
        ArgumentCaptor<LiveSessionLogs> captor = ArgumentCaptor.forClass(LiveSessionLogs.class);
        verify(liveSessionLogsRepository, times(2)).save(captor.capture());

        LiveSessionLogs alice = captor.getAllValues().stream()
                .filter(l -> "USER".equals(l.getUserSourceType())).findFirst().orElseThrow();
        assertEquals("user-a", alice.getUserSourceId());
        assertEquals(45, alice.getProviderTotalDurationMinutes()); // 30 + 15
        assertEquals("PRESENT", alice.getStatus());

        LiveSessionLogs guest = captor.getAllValues().stream()
                .filter(l -> "PROVIDER_EMAIL".equals(l.getUserSourceType())).findFirst().orElseThrow();
        assertEquals("bob@x.com", guest.getUserSourceId());
        assertEquals(20, guest.getProviderTotalDurationMinutes());

        verify(scheduleRepository, times(1)).save(any(SessionSchedule.class)); // stamps lastAttendanceSyncAt
    }

    @Test
    void setsDurationNotSumOnExistingRecord() {
        when(zoomAccountStore.findById("acct-1")).thenReturn(Optional.of(mock(ZoomAccount.class)));
        when(zoomMeetingManager.fetchAttendance(any(), eq(MEETING_ID)))
                .thenReturn(List.of(attendee("Alice", "a@x.com", 45, "2026-06-10T10:00:00Z")));
        when(participantRepository.findEnrolledUserIdByEmail(SESSION_ID, "a@x.com")).thenReturn(List.of("user-a"));
        LiveSessionLogs existing = LiveSessionLogs.builder()
                .scheduleId(SCHEDULE_ID).userSourceType("USER").userSourceId("user-a")
                .providerTotalDurationMinutes(10).status("PRESENT").build();
        when(liveSessionLogsRepository.findExistingAttendanceRecord(SCHEDULE_ID, "user-a"))
                .thenReturn(Optional.of(existing));

        service.syncAttendance(schedule());

        // SET to the report's cumulative 45 — NOT 10 + 45 — so repeated polls converge.
        assertEquals(45, existing.getProviderTotalDurationMinutes());
        verify(liveSessionLogsRepository).save(existing);
    }

    @Test
    void noOpWhenMeetingNotProvisioned() {
        SessionSchedule notProvisioned = SessionSchedule.builder()
                .id(SCHEDULE_ID).sessionId(SESSION_ID).build();
        assertEquals(0, service.syncAttendance(notProvisioned));
        verify(zoomMeetingManager, never()).fetchAttendance(any(), anyString());
    }
}
