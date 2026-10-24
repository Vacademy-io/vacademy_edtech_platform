package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LiveSessionAttendanceOnlyModeServiceTest {

    private final InstituteSettingService settings = mock(InstituteSettingService.class);
    private final PackageSessionRepository packageSessions = mock(PackageSessionRepository.class);
    private final LiveSessionRepository sessions = mock(LiveSessionRepository.class);
    private final LiveSessionAttendanceOnlyModeService service =
            new LiveSessionAttendanceOnlyModeService(settings, packageSessions, sessions, new ObjectMapper());

    private static LiveSession session(String id, String bookingTypeId, String source) {
        LiveSession s = new LiveSession();
        s.setId(id);
        s.setInstituteId("i1");
        s.setBookingTypeId(bookingTypeId);
        s.setSource(source);
        return s;
    }

    @Test
    void notificationsSuppressedForClassesButNotBookedMeetings() {
        when(settings.getSettingByInstituteIdAndKey("i1", "LIVE_SESSION_SETTING"))
                .thenReturn(Map.of("attendanceOnlyMode", true));
        when(sessions.findById("class")).thenReturn(Optional.of(session("class", null, null)));
        when(sessions.findById("booked")).thenReturn(Optional.of(session("booked", "bt1", null)));
        when(sessions.findById("meeting")).thenReturn(Optional.of(session("meeting", null, "MEETING_BOOKING")));

        assertTrue(service.suppressesLearnerNotifications("i1", "class"));
        assertFalse(service.suppressesLearnerNotifications("i1", "booked"));
        assertFalse(service.suppressesLearnerNotifications("i1", "meeting"));

        assertTrue(service.suppressesLearnerNotifications(session("class", null, null)));
        assertFalse(service.suppressesLearnerNotifications(session("booked", "bt1", null)));
        assertFalse(service.suppressesLearnerNotifications((LiveSession) null));
    }

    @Test
    void classMarkedShowToLearnersKeepsLearnerNotifications() {
        when(settings.getSettingByInstituteIdAndKey("i1", "LIVE_SESSION_SETTING"))
                .thenReturn(Map.of("attendanceOnlyMode", true));
        LiveSession online = session("online", null, null);
        online.setShowToLearners(true);
        LiveSession offline = session("offline", null, null);
        offline.setShowToLearners(false);
        when(sessions.findById("online")).thenReturn(Optional.of(online));
        when(sessions.findById("offline")).thenReturn(Optional.of(offline));

        assertFalse(service.suppressesLearnerNotifications("i1", "online"));
        assertTrue(service.suppressesLearnerNotifications("i1", "offline"));
        assertFalse(service.suppressesLearnerNotifications(online));
        assertTrue(service.suppressesLearnerNotifications(offline));
    }

    @Test
    void notificationsUntouchedWhenModeOff() {
        when(settings.getSettingByInstituteIdAndKey("i1", "LIVE_SESSION_SETTING"))
                .thenReturn(Map.of("feedbackEnabled", true));

        assertFalse(service.suppressesLearnerNotifications("i1", "class"));
        assertFalse(service.suppressesLearnerNotifications(session("class", null, null)));
        // Off = no extra session lookup on the send path.
        verify(sessions, never()).findById("class");
    }

    @Test
    void offWhenSettingMissingOrFlagAbsent() {
        when(settings.getSettingByInstituteIdAndKey("i1", "LIVE_SESSION_SETTING")).thenReturn(null);
        assertFalse(service.isEnabled("i1"));

        when(settings.getSettingByInstituteIdAndKey("i2", "LIVE_SESSION_SETTING"))
                .thenReturn(Map.of("feedbackEnabled", true));
        assertFalse(service.isEnabled("i2"));

        assertFalse(service.isEnabled(null));
    }

    @Test
    void onWhenFlagTrue() {
        when(settings.getSettingByInstituteIdAndKey("i1", "LIVE_SESSION_SETTING"))
                .thenReturn(Map.of("attendanceOnlyMode", true));
        assertTrue(service.isEnabled("i1"));
    }

    @Test
    void neverThrowsOnSettingReadFailure() {
        when(settings.getSettingByInstituteIdAndKey(anyString(), anyString()))
                .thenThrow(new RuntimeException("Institute Not Found"));
        assertFalse(service.isEnabled("i1"));
        assertFalse(service.hidesLearnerSessions("ps1", "i1"));
    }

    @Test
    void resolvesInstituteFromParamThenBatch() {
        when(settings.getSettingByInstituteIdAndKey("i1", "LIVE_SESSION_SETTING"))
                .thenReturn(Map.of("attendanceOnlyMode", true));
        when(packageSessions.findInstituteIdByPackageSessionId("ps1")).thenReturn(Optional.of("i1"));

        assertTrue(service.hidesLearnerSessions(null, "i1"));
        assertTrue(service.hidesLearnerSessions("ps1", null));
        // Explicit instituteId wins over the batch's institute.
        assertFalse(service.hidesLearnerSessions("ps1", "other"));
    }

    @Test
    void notHiddenWhenInstituteCannotBeResolved() {
        // Learner in an attendance-only institute AND another one: without an
        // instituteId or a resolvable batch we must not guess and hide.
        when(settings.getSettingByInstituteIdAndKey("i1", "LIVE_SESSION_SETTING"))
                .thenReturn(Map.of("attendanceOnlyMode", true));
        when(packageSessions.findInstituteIdByPackageSessionId("gone")).thenReturn(Optional.empty());

        assertFalse(service.hidesLearnerSessions(null, null));
        assertFalse(service.hidesLearnerSessions("gone", null));
    }
}
