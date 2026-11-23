package vacademy.io.notification_service.features.announcements.security;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.ClientAuthenticationService;
import vacademy.io.notification_service.features.announcements.dto.MessageInteractionRequest;
import vacademy.io.notification_service.features.announcements.entity.RecipientMessage;
import vacademy.io.notification_service.features.announcements.enums.InteractionType;
import vacademy.io.notification_service.features.announcements.repository.RecipientMessageRepository;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Service-credential guard and the learner's own-messages guard. */
class AnnouncementCallerGuardsTest {

    private static CustomUserDetails user(String userId) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setAuthorities(List.of("STUDENT"));
        return new CustomUserDetails(dto);
    }

    private static HttpStatus statusOf(Runnable call) {
        try {
            call.run();
            return HttpStatus.OK;
        } catch (ResponseStatusException e) {
            return HttpStatus.valueOf(e.getStatusCode().value());
        }
    }

    // --- service credentials ---

    @Test
    void internalClientNeedsValidCredentials() {
        ClientAuthenticationService clients = mock(ClientAuthenticationService.class);
        when(clients.validateClient("admin_core_service", "right")).thenReturn(true);
        InternalClientGuard guard = new InternalClientGuard(clients);

        assertThat(statusOf(() -> guard.requireInternalClient(null, null))).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(statusOf(() -> guard.requireInternalClient("admin_core_service", ""))).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(statusOf(() -> guard.requireInternalClient("admin_core_service", "wrong"))).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(statusOf(() -> guard.requireInternalClient("admin_core_service", "right"))).isEqualTo(HttpStatus.OK);
    }

    @Test
    void internalClientLookupFailureIsRefused() {
        ClientAuthenticationService clients = mock(ClientAuthenticationService.class);
        when(clients.validateClient("x", "y")).thenThrow(new IllegalStateException("db down"));
        assertThat(statusOf(() -> new InternalClientGuard(clients).requireInternalClient("x", "y")))
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // --- a user's own messages ---

    private final RecipientMessageRepository messages = mock(RecipientMessageRepository.class);
    private final UserMessageAccessGuard userGuard = new UserMessageAccessGuard(messages);

    @Test
    void pathUserIdMustBeTheCaller() {
        assertThat(statusOf(() -> userGuard.requireSelf(null, "u1"))).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(statusOf(() -> userGuard.requireSelf(user("u2"), "u1"))).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(userGuard.requireSelf(user("u1"), "u1")).isEqualTo("u1");
        assertThat(userGuard.requireSelf(user("u1"), null)).isEqualTo("u1");
    }

    private static MessageInteractionRequest interaction(String messageId, String userId) {
        return new MessageInteractionRequest(messageId, userId, InteractionType.READ, null);
    }

    private void messageBelongsTo(String messageId, String owner) {
        RecipientMessage rm = new RecipientMessage();
        rm.setId(messageId);
        rm.setUserId(owner);
        when(messages.findById(messageId)).thenReturn(Optional.of(rm));
    }

    @Test
    void interactionUserIdIsTakenFromTheToken() {
        messageBelongsTo("m1", "u1");
        MessageInteractionRequest withoutUser = interaction("m1", null);
        userGuard.requireOwnMessage(user("u1"), withoutUser);
        assertThat(withoutUser.getUserId()).isEqualTo("u1");
    }

    @Test
    void interactionOnSomeoneElsesMessageIsRefused() {
        messageBelongsTo("m1", "u1");
        when(messages.findById("missing")).thenReturn(Optional.empty());

        // Body names another user.
        assertThat(statusOf(() -> userGuard.requireOwnMessage(user("u2"), interaction("m1", "u1"))))
                .isEqualTo(HttpStatus.FORBIDDEN);
        // Body names the caller, but the message was delivered to someone else.
        assertThat(statusOf(() -> userGuard.requireOwnMessage(user("u2"), interaction("m1", "u2"))))
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(statusOf(() -> userGuard.requireOwnMessage(user("u1"), interaction("missing", "u1"))))
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(statusOf(() -> userGuard.requireOwnMessage(null, interaction("m1", "u1"))))
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
