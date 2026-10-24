package vacademy.io.admin_core_service.features.live_session.provider.controller.google;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleJoinPayloadResponse;
import vacademy.io.admin_core_service.features.live_session.provider.manager.GoogleMeetManager;
import vacademy.io.admin_core_service.features.live_session.provider.security.JoinAuthorization;
import vacademy.io.admin_core_service.features.live_session.provider.security.JoinRole;
import vacademy.io.admin_core_service.features.live_session.provider.security.LiveSessionJoinAuthorizer;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccountStore;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAttendanceService;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The co-host step is an add-on to the join: learners join exactly as before, and a host still
 * gets the Meet link (and the organizer hint) whether or not Google accepted the co-host.
 */
class GoogleMeetJoinControllerTest {

    private static final String LINK = "https://meet.google.com/abc-defg-hij";

    private final SessionScheduleRepository schedules = mock(SessionScheduleRepository.class);
    private final LiveSessionJoinAuthorizer authorizer = mock(LiveSessionJoinAuthorizer.class);
    private final GoogleAttendanceService attendance = mock(GoogleAttendanceService.class);
    private final GoogleAccountStore accounts = mock(GoogleAccountStore.class);
    private final UserRepository users = mock(UserRepository.class);
    private final GoogleMeetManager meet = mock(GoogleMeetManager.class);
    private final GoogleMeetJoinController controller =
            new GoogleMeetJoinController(schedules, authorizer, attendance, accounts, users, meet);

    private final GoogleAccount account = GoogleAccount.builder().id("acc-1").organizerEmail("team@org.in").build();

    private SessionSchedule schedule(String accountId, String spaceName, String link) {
        SessionSchedule s = SessionSchedule.builder().id("sch-1").sessionId("ses-1")
                .providerAccountId(accountId).providerMeetingId(spaceName).customMeetingLink(link).build();
        when(schedules.findById("sch-1")).thenReturn(Optional.of(s));
        when(accounts.findById("acc-1")).thenReturn(Optional.of(account));
        return s;
    }

    private CustomUserDetails user(String email) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn("u-1");
        when(u.getFullName()).thenReturn("Teacher One");
        when(u.getEmail()).thenReturn(email);
        return u;
    }

    private void role(JoinRole role) {
        when(authorizer.authorize(anyString(), any(), any())).thenReturn(new JoinAuthorization(role, "inst-1"));
    }

    @Test
    @DisplayName("learner: marked present, same payload as before, never made co-host")
    void learnerUnchanged() {
        role(JoinRole.PARTICIPANT);
        schedule("acc-1", "spaces/abc", LINK);

        GoogleJoinPayloadResponse r = controller.join("sch-1", null, user("kid@gmail.com")).getBody();

        assertEquals(LINK, r.getJoinUrl());
        assertFalse(r.isHost());
        assertEquals("team@org.in", r.getOrganizerEmail());
        assertNull(r.getCohostEmail());
        verify(attendance).markPresent("ses-1", "sch-1", "u-1", "Teacher One", "spaces/abc");
        verify(meet, never()).ensureCohost(any(), any(), any());
    }

    @Test
    @DisplayName("host: made co-host with their login email, not counted in attendance")
    void hostMadeCohost() {
        role(JoinRole.HOST);
        schedule("acc-1", "spaces/abc", LINK);
        when(meet.ensureCohost(account, "spaces/abc", "teacher@gmail.com")).thenReturn(true);

        GoogleJoinPayloadResponse r = controller.join("sch-1", null, user("teacher@gmail.com")).getBody();

        assertTrue(r.isHost());
        assertEquals(LINK, r.getJoinUrl());
        assertEquals("team@org.in", r.getOrganizerEmail());
        assertEquals("teacher@gmail.com", r.getCohostEmail());
        verify(attendance, never()).markPresent(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("host, Google refused co-host: still joins with the old organizer hint")
    void hostCohostRefused() {
        role(JoinRole.HOST);
        schedule("acc-1", "spaces/abc", LINK);
        when(meet.ensureCohost(any(), any(), any())).thenReturn(false);

        GoogleJoinPayloadResponse r = controller.join("sch-1", null, user("teacher@gmail.com")).getBody();

        assertEquals(LINK, r.getJoinUrl());
        assertEquals("team@org.in", r.getOrganizerEmail());
        assertNull(r.getCohostEmail());
    }

    @Test
    @DisplayName("host without an email in the token: email read from the users table")
    void hostEmailFromDb() {
        role(JoinRole.HOST);
        schedule("acc-1", "spaces/abc", LINK);
        when(users.findById("u-1")).thenReturn(Optional.of(User.builder().email("db@gmail.com").build()));
        when(meet.ensureCohost(account, "spaces/abc", "db@gmail.com")).thenReturn(true);

        GoogleJoinPayloadResponse r = controller.join("sch-1", null, user(null)).getBody();

        assertEquals("db@gmail.com", r.getCohostEmail());
    }

    @Test
    @DisplayName("host, users lookup throws: join still succeeds without co-host")
    void hostEmailLookupFails() {
        role(JoinRole.HOST);
        schedule("acc-1", "spaces/abc", LINK);
        when(users.findById("u-1")).thenThrow(new RuntimeException("db down"));

        GoogleJoinPayloadResponse r = controller.join("sch-1", null, user(null)).getBody();

        assertEquals(LINK, r.getJoinUrl());
        assertNull(r.getCohostEmail());
    }

    @Test
    @DisplayName("schedule without a linked account: organizer hint null, no co-host, link returned")
    void noAccount() {
        role(JoinRole.HOST);
        schedule(null, "spaces/abc", LINK);

        GoogleJoinPayloadResponse r = controller.join("sch-1", null, user("teacher@gmail.com")).getBody();

        assertEquals(LINK, r.getJoinUrl());
        assertNull(r.getOrganizerEmail());
        assertNull(r.getCohostEmail());
    }

    @Test
    @DisplayName("space not provisioned yet: 409 as before, Google never called")
    void notProvisioned() {
        role(JoinRole.HOST);
        schedule("acc-1", null, null);

        VacademyException e = assertThrows(VacademyException.class,
                () -> controller.join("sch-1", null, user("teacher@gmail.com")));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        verify(meet, never()).ensureCohost(any(), any(), any());
    }
}
