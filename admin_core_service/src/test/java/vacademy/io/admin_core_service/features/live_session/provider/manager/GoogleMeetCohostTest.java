package vacademy.io.admin_core_service.features.live_session.provider.manager;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccessTokenService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccountStore;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleConferenceService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleEventsSubscriptionService;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * ensureCohost against a scripted Google: added or already-a-member counts as done, and every
 * failure is swallowed so the host's join is never blocked.
 */
class GoogleMeetCohostTest {

    private final GoogleAccessTokenService tokens = mock(GoogleAccessTokenService.class);
    private final List<ClientRequest> requests = new ArrayList<>();
    private final GoogleAccount account = GoogleAccount.builder().id("acc-1").instituteId("inst-1")
            .organizerEmail("team@org.in").build();

    private GoogleMeetManager manager(Function<ClientRequest, Mono<ClientResponse>> google) {
        when(tokens.getAccessToken(any())).thenReturn("token");
        WebClient.Builder web = WebClient.builder().exchangeFunction(req -> {
            requests.add(req);
            return google.apply(req);
        });
        return new GoogleMeetManager(mock(GoogleAccountStore.class), tokens, mock(GoogleConferenceService.class),
                mock(GoogleEventsSubscriptionService.class), web, mock(SessionScheduleRepository.class));
    }

    private static Mono<ClientResponse> reply(HttpStatus status, String body) {
        return Mono.just(ClientResponse.create(status)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .body(body).build());
    }

    @Test
    @DisplayName("200: teacher added as co-host on the space's members endpoint")
    void added() {
        GoogleMeetManager m = manager(req -> reply(HttpStatus.OK,
                "{\"name\":\"spaces/abc/members/1\",\"email\":\"teacher@gmail.com\",\"role\":\"COHOST\"}"));

        assertTrue(m.ensureCohost(account, "spaces/abc", "teacher@gmail.com"));
        assertEquals(1, requests.size());
        assertEquals(HttpMethod.POST, requests.get(0).method());
        assertEquals("https://meet.googleapis.com/v2/spaces/abc/members", requests.get(0).url().toString());
        assertEquals("Bearer token", requests.get(0).headers().getFirst(HttpHeaders.AUTHORIZATION));
    }

    @Test
    @DisplayName("409 ALREADY_EXISTS: second Start click on the same class is still a success")
    void alreadyMember() {
        GoogleMeetManager m = manager(req -> reply(HttpStatus.CONFLICT,
                "{\"error\":{\"code\":409,\"status\":\"ALREADY_EXISTS\"}}"));

        assertTrue(m.ensureCohost(account, "spaces/abc", "teacher@gmail.com"));
    }

    @Test
    @DisplayName("403 refused: false, no exception, token kept")
    void refused() {
        GoogleMeetManager m = manager(req -> reply(HttpStatus.FORBIDDEN,
                "{\"error\":{\"code\":403,\"status\":\"PERMISSION_DENIED\"}}"));

        assertFalse(m.ensureCohost(account, "spaces/abc", "teacher@gmail.com"));
        verify(tokens, never()).evict(any());
    }

    @Test
    @DisplayName("401: false and the cached token is evicted")
    void unauthorized() {
        GoogleMeetManager m = manager(req -> reply(HttpStatus.UNAUTHORIZED, "{}"));

        assertFalse(m.ensureCohost(account, "spaces/abc", "teacher@gmail.com"));
        verify(tokens).evict("acc-1");
    }

    @Test
    @DisplayName("Google 500 / network error / token failure: false, no exception")
    void failuresSwallowed() {
        assertFalse(manager(req -> reply(HttpStatus.INTERNAL_SERVER_ERROR, "{}"))
                .ensureCohost(account, "spaces/abc", "teacher@gmail.com"));
        assertFalse(manager(req -> Mono.error(new RuntimeException("connection reset")))
                .ensureCohost(account, "spaces/abc", "teacher@gmail.com"));

        GoogleMeetManager m = manager(req -> reply(HttpStatus.OK, "{}"));
        when(tokens.getAccessToken(any())).thenThrow(new RuntimeException("refresh revoked"));
        assertFalse(m.ensureCohost(account, "spaces/abc", "teacher@gmail.com"));
    }

    @Test
    @DisplayName("organizer, blank email, missing account or space: no call to Google")
    void skipped() {
        GoogleMeetManager m = manager(req -> reply(HttpStatus.OK, "{}"));

        assertFalse(m.ensureCohost(account, "spaces/abc", "TEAM@org.in"));
        assertFalse(m.ensureCohost(account, "spaces/abc", " "));
        assertFalse(m.ensureCohost(account, "spaces/abc", null));
        assertFalse(m.ensureCohost(null, "spaces/abc", "teacher@gmail.com"));
        assertFalse(m.ensureCohost(account, null, "teacher@gmail.com"));
        assertEquals(0, requests.size());
    }
}
