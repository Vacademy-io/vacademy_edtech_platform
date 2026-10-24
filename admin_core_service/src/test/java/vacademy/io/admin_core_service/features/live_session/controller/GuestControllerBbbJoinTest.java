package vacademy.io.admin_core_service.features.live_session.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.live_session.entity.SessionGuestRegistration;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.manager.BbbMeetingManager;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionGuestRegistrationRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.service.LiveSessionPaymentService;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Public-session guests used to reach BBB as "Guest" — the learner app never sent
 * the name typed on the registration form, and the attendance row was written under
 * a throw-away guest-&lt;uuid&gt; id that neither the analytics callback nor the guest
 * attendance report could tie back to the registration.
 */
class GuestControllerBbbJoinTest {

    private static final String SESSION = "sess-1";
    private static final String SCHEDULE = "sched-1";
    private static final String MEETING = "bbb-meeting-1";
    private static final String REGISTRATION = "reg-1";

    private GuestController controller;
    private SessionScheduleRepository scheduleRepository;
    private SessionGuestRegistrationRepository registrationRepository;
    private LiveSessionLogsRepository logsRepository;
    private BbbMeetingManager bbbMeetingManager;

    @BeforeEach
    void setUp() {
        controller = new GuestController();
        scheduleRepository = mock(SessionScheduleRepository.class);
        registrationRepository = mock(SessionGuestRegistrationRepository.class);
        logsRepository = mock(LiveSessionLogsRepository.class);
        bbbMeetingManager = mock(BbbMeetingManager.class);
        LiveSessionPaymentService paymentService = mock(LiveSessionPaymentService.class);

        ReflectionTestUtils.setField(controller, "scheduleRepository", scheduleRepository);
        ReflectionTestUtils.setField(controller, "guestRegistrationRepository", registrationRepository);
        ReflectionTestUtils.setField(controller, "liveSessionLogsRepository", logsRepository);
        ReflectionTestUtils.setField(controller, "bbbMeetingManager", bbbMeetingManager);
        ReflectionTestUtils.setField(controller, "liveSessionPaymentService", paymentService);

        when(scheduleRepository.findById(SCHEDULE)).thenReturn(Optional.of(
                SessionSchedule.builder().id(SCHEDULE).sessionId(SESSION).providerMeetingId(MEETING).build()));
        when(paymentService.isRegistrationCleared(anyString(), any())).thenReturn(true);
        when(bbbMeetingManager.isMeetingRunning(MEETING, null)).thenReturn(true);
        when(bbbMeetingManager.buildJoinUrlForUser(eq(MEETING), anyString(), anyString(), eq("VIEWER"), isNull()))
                .thenAnswer(inv -> "https://bbb/join?name=" + inv.getArgument(1) + "&userID=" + inv.getArgument(2));
    }

    private void registered(String sessionId, String name) {
        when(registrationRepository.findById(REGISTRATION)).thenReturn(Optional.of(
                SessionGuestRegistration.builder().id(REGISTRATION).sessionId(sessionId).email("a@b.c").build()));
        when(registrationRepository.findRegistrantNameByRegistrationId(REGISTRATION))
                .thenReturn(Optional.ofNullable(name));
    }

    @Test
    @DisplayName("registered guest joins under the registration form name, keyed by registration id")
    void registeredGuestJoinsWithRegisteredName() {
        registered(SESSION, "  Riya Jain ");

        ResponseEntity<Map<String, String>> response = controller.guestBbbJoin(SCHEDULE, "Guest", REGISTRATION);

        assertEquals("https://bbb/join?name=Riya Jain&userID=" + REGISTRATION, response.getBody().get("joinUrl"));
        verify(logsRepository).upsertBbbJoinAttendance(anyString(), eq(SESSION), eq(SCHEDULE),
                eq("EXTERNAL_USER"), eq(REGISTRATION), eq("Riya Jain | role=VIEWER | guest=true"),
                anyString(), eq(MEETING));
    }

    @Test
    @DisplayName("form without a usable name keeps the registration identity but shows the fallback name")
    void registeredGuestWithoutNameFallsBackToGuestLabel() {
        registered(SESSION, null);

        ResponseEntity<Map<String, String>> response = controller.guestBbbJoin(SCHEDULE, "Guest", REGISTRATION);

        assertEquals("https://bbb/join?name=Guest&userID=" + REGISTRATION, response.getBody().get("joinUrl"));
        verify(logsRepository).upsertBbbJoinAttendance(anyString(), eq(SESSION), eq(SCHEDULE),
                eq("EXTERNAL_USER"), eq(REGISTRATION), anyString(), anyString(), eq(MEETING));
    }

    @Test
    @DisplayName("a registration id from another session is ignored: anonymous guest identity as before")
    void foreignRegistrationIsTreatedAsUnregistered() {
        registered("some-other-session", "Someone Else");

        ResponseEntity<Map<String, String>> response = controller.guestBbbJoin(SCHEDULE, "Guest", REGISTRATION);

        ArgumentCaptor<String> sourceId = ArgumentCaptor.forClass(String.class);
        verify(logsRepository).upsertBbbJoinAttendance(anyString(), eq(SESSION), eq(SCHEDULE),
                eq("GUEST"), sourceId.capture(), eq("Guest | role=VIEWER | guest=true"),
                anyString(), eq(MEETING));
        assertTrue(sourceId.getValue().startsWith("guest-"));
        assertEquals("https://bbb/join?name=Guest&userID=" + sourceId.getValue(),
                response.getBody().get("joinUrl"));
    }

    @Test
    @DisplayName("name lookup failure never blocks the join: registration identity kept, fallback name")
    void nameLookupFailureFallsBackButKeepsIdentity() {
        when(registrationRepository.findById(REGISTRATION)).thenReturn(Optional.of(
                SessionGuestRegistration.builder().id(REGISTRATION).sessionId(SESSION).email("a@b.c").build()));
        when(registrationRepository.findRegistrantNameByRegistrationId(REGISTRATION))
                .thenThrow(new RuntimeException("db hiccup"));

        ResponseEntity<Map<String, String>> response = controller.guestBbbJoin(SCHEDULE, "Guest", REGISTRATION);

        assertEquals("https://bbb/join?name=Guest&userID=" + REGISTRATION, response.getBody().get("joinUrl"));
        verify(logsRepository).upsertBbbJoinAttendance(anyString(), eq(SESSION), eq(SCHEDULE),
                eq("EXTERNAL_USER"), eq(REGISTRATION), anyString(), anyString(), eq(MEETING));
    }

    @Test
    @DisplayName("registration lookup failure degrades to the old anonymous behaviour")
    void registrationLookupFailureDegradesToAnonymous() {
        when(registrationRepository.findById(REGISTRATION)).thenThrow(new RuntimeException("db hiccup"));

        ResponseEntity<Map<String, String>> response = controller.guestBbbJoin(SCHEDULE, "Guest", REGISTRATION);

        assertTrue(response.getBody().get("joinUrl").startsWith("https://bbb/join?name=Guest&userID=guest-"));
        verify(logsRepository).upsertBbbJoinAttendance(anyString(), eq(SESSION), eq(SCHEDULE),
                eq("GUEST"), anyString(), eq("Guest | role=VIEWER | guest=true"), anyString(), eq(MEETING));
    }

    @Test
    @DisplayName("attendance write failure never blocks the join (unchanged contract)")
    void attendanceFailureDoesNotBlockJoin() {
        registered(SESSION, "Riya Jain");
        org.mockito.Mockito.doThrow(new RuntimeException("index"))
                .when(logsRepository).upsertBbbJoinAttendance(anyString(), anyString(), anyString(),
                        anyString(), anyString(), anyString(), anyString(), anyString());

        ResponseEntity<Map<String, String>> response = controller.guestBbbJoin(SCHEDULE, "Guest", REGISTRATION);

        assertEquals("https://bbb/join?name=Riya Jain&userID=" + REGISTRATION, response.getBody().get("joinUrl"));
    }

    @Test
    @DisplayName("no registration id at all: anonymous guest, name from the request")
    void unregisteredVisitorUsesRequestName() {
        ResponseEntity<Map<String, String>> response = controller.guestBbbJoin(SCHEDULE, "Walk-in", null);

        assertTrue(response.getBody().get("joinUrl").startsWith("https://bbb/join?name=Walk-in&userID=guest-"));
        verify(logsRepository).upsertBbbJoinAttendance(anyString(), eq(SESSION), eq(SCHEDULE),
                eq("GUEST"), anyString(), eq("Walk-in | role=VIEWER | guest=true"), anyString(), eq(MEETING));
    }
}
