package vacademy.io.admin_core_service.features.live_session.provider.manager;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccessTokenService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccountStore;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleConferenceService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleEventsSubscriptionService;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.CreateMeetingRequestDTO;
import vacademy.io.common.meeting.dto.CreateMeetingResponseDTO;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * createMeeting against a scripted Google: the class must still get a link when the plan lacks a
 * feature, and the account's auto-record flag is turned off only when recording was the proven
 * blocker — the same as before per-class settings existed.
 */
class GoogleMeetCreateFallbackTest {

    private static final String OK = "{\"name\":\"spaces/abc\",\"meetingUri\":\"https://meet.google.com/abc-defg-hij\",\"meetingCode\":\"abc-defg-hij\"}";

    private final GoogleAccountStore store = mock(GoogleAccountStore.class);
    private final GoogleAccessTokenService tokens = mock(GoogleAccessTokenService.class);
    private final Deque<ClientResponse> replies = new ArrayDeque<>();
    private final AtomicInteger calls = new AtomicInteger();
    private final List<String> urls = new ArrayList<>();
    private final LiveSessionRepository sessions = mock(LiveSessionRepository.class);
    private final AuthService auth = mock(AuthService.class);
    private GoogleAccount account;

    private GoogleMeetManager manager(boolean recordingEnabled) {
        account = GoogleAccount.builder().id("acc-1").instituteId("inst-1")
                .recordingEnabled(recordingEnabled).defaultAccessType("OPEN").build();
        when(store.findByIdAndInstitute("acc-1", "inst-1")).thenReturn(Optional.of(account));
        when(tokens.getAccessToken(any())).thenReturn("token");
        WebClient.Builder web = WebClient.builder().exchangeFunction(req -> {
            calls.incrementAndGet();
            urls.add(req.url().toString());
            return Mono.just(replies.removeFirst());
        });
        return new GoogleMeetManager(store, tokens, mock(GoogleConferenceService.class),
                mock(GoogleEventsSubscriptionService.class), web, mock(SessionScheduleRepository.class),
                sessions, auth);
    }

    private void reply(HttpStatus status, String body) {
        replies.add(ClientResponse.create(status)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .body(body).build());
    }

    private static CreateMeetingRequestDTO request(Map<String, Object> cfg) {
        return CreateMeetingRequestDTO.builder().topic("Class").providerAccountId("acc-1")
                .providerConfig(cfg).build();
    }

    private static String refused(String field) {
        return "{\"error\":{\"code\":403,\"message\":\"" + field + " is not available to the user\",\"status\":\"PERMISSION_DENIED\"}}";
    }

    @Test
    @DisplayName("old client (no per-class config), plan can't record: link created, account auto-record turned off")
    void legacyRecordingRefused() {
        GoogleMeetManager m = manager(true);
        reply(HttpStatus.FORBIDDEN, refused("updateAutoRecordingGeneration"));
        reply(HttpStatus.OK, OK);

        CreateMeetingResponseDTO r = m.createMeeting(request(null), "inst-1");

        assertEquals("spaces/abc", r.getProviderMeetingId());
        assertEquals(2, calls.get());
        assertFalse(account.isRecordingEnabled());
        verify(store).update(account);
    }

    @Test
    @DisplayName("per-class recording ON refused: link created, account auto-record turned off")
    void perClassRecordingRefused() {
        GoogleMeetManager m = manager(true);
        reply(HttpStatus.FORBIDDEN, refused("updateAutoRecordingGeneration"));
        reply(HttpStatus.OK, OK);

        m.createMeeting(request(Map.of("recording", true, "transcription", false)), "inst-1");

        assertEquals(2, calls.get());
        assertFalse(account.isRecordingEnabled());
    }

    @Test
    @DisplayName("only transcription refused: recording kept, account flag untouched")
    void transcriptionRefused() {
        GoogleMeetManager m = manager(true);
        reply(HttpStatus.FORBIDDEN, refused("updateAutoTranscriptionGeneration"));
        reply(HttpStatus.OK, OK);

        m.createMeeting(request(Map.of("recording", true, "transcription", true)), "inst-1");

        assertEquals(2, calls.get());
        assertTrue(account.isRecordingEnabled());
        verify(store, never()).update(any());
    }

    @Test
    @DisplayName("several features refused one by one: one retry per feature, then the link")
    void refusedOneByOne() {
        GoogleMeetManager m = manager(false);
        reply(HttpStatus.FORBIDDEN, refused("updateAutoSmartNotesGeneration"));
        reply(HttpStatus.FORBIDDEN, "{\"error\":{\"message\":\"attendance_report_generation_type is not available\"}}");
        reply(HttpStatus.OK, OK);

        m.createMeeting(request(Map.of("smartNotes", true, "attendanceReport", true)), "inst-1");

        assertEquals(3, calls.get());
    }

    @Test
    @DisplayName("unnamed refusal with several features: all dropped, recording not blamed")
    void unnamedRefusal() {
        GoogleMeetManager m = manager(true);
        reply(HttpStatus.BAD_REQUEST, "{\"error\":{\"message\":\"Request contains an invalid argument.\"}}");
        reply(HttpStatus.OK, OK);

        m.createMeeting(request(Map.of("recording", true, "transcription", true)), "inst-1");

        assertEquals(2, calls.get());
        assertTrue(account.isRecordingEnabled());
    }

    @Test
    @DisplayName("no optional feature sent: a 4xx still fails, no retry (unchanged)")
    void noFeatureFails() {
        GoogleMeetManager m = manager(false);
        reply(HttpStatus.FORBIDDEN, "{}");

        assertThrows(VacademyException.class, () -> m.createMeeting(request(null), "inst-1"));
        assertEquals(1, calls.get());
    }

    @Test
    @DisplayName("401 evicts the token and fails without dropping features (unchanged)")
    void unauthorized() {
        GoogleMeetManager m = manager(true);
        reply(HttpStatus.UNAUTHORIZED, "{}");

        assertThrows(VacademyException.class, () -> m.createMeeting(request(null), "inst-1"));
        assertEquals(1, calls.get());
        verify(tokens).evict("acc-1");
        assertTrue(account.isRecordingEnabled());
    }

    @Test
    @DisplayName("everything refused: fails after dropping all features")
    void allRefused() {
        GoogleMeetManager m = manager(true);
        reply(HttpStatus.FORBIDDEN, refused("updateAutoRecordingGeneration"));
        reply(HttpStatus.FORBIDDEN, "{}");

        assertThrows(VacademyException.class, () -> m.createMeeting(request(null), "inst-1"));
        assertEquals(2, calls.get());
        assertTrue(account.isRecordingEnabled());
    }

    private void creator(String email) {
        LiveSession session = new LiveSession();
        session.setCreatedByUserId("creator-1");
        when(sessions.findById("ses-1")).thenReturn(Optional.of(session));
        UserDTO user = new UserDTO();
        user.setEmail(email);
        when(auth.getUsersFromAuthServiceByUserIds(List.of("creator-1"))).thenReturn(List.of(user));
    }

    private static CreateMeetingRequestDTO requestForSession() {
        return CreateMeetingRequestDTO.builder().topic("Class").providerAccountId("acc-1").sessionId("ses-1").build();
    }

    @Test
    @DisplayName("class creator is made co-host right after the space is created")
    void creatorAddedAsCohost() {
        GoogleMeetManager m = manager(false);
        creator("teacher@gmail.com");
        reply(HttpStatus.OK, OK);
        reply(HttpStatus.OK, "{\"name\":\"spaces/abc/members/1\",\"role\":\"COHOST\"}");

        CreateMeetingResponseDTO r = m.createMeeting(requestForSession(), "inst-1");

        assertEquals("spaces/abc", r.getProviderMeetingId());
        assertEquals(2, calls.get());
        assertEquals("https://meet.googleapis.com/v2/spaces/abc/members", urls.get(1));
    }

    @Test
    @DisplayName("co-host add refused or creator email unknown: the class still gets its link")
    void creatorCohostFailureIgnored() {
        GoogleMeetManager m = manager(false);
        creator("teacher@gmail.com");
        reply(HttpStatus.OK, OK);
        reply(HttpStatus.FORBIDDEN, "{}");
        assertEquals("spaces/abc", m.createMeeting(requestForSession(), "inst-1").getProviderMeetingId());

        when(auth.getUsersFromAuthServiceByUserIds(any())).thenThrow(new RuntimeException("auth down"));
        reply(HttpStatus.OK, OK);
        assertEquals("spaces/abc", m.createMeeting(requestForSession(), "inst-1").getProviderMeetingId());
        assertEquals(3, calls.get()); // no members call without an email
    }
}
