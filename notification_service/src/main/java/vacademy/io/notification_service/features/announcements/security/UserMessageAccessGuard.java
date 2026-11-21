package vacademy.io.notification_service.features.announcements.security;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.dto.MessageInteractionRequest;
import vacademy.io.notification_service.features.announcements.repository.RecipientMessageRepository;

/**
 * Caller checks for {@code /v1/user-messages/**}: a signed-in user reads and acts on their own
 * messages only. The user id always comes from the token; an id in the path or body that differs
 * from it is refused.
 */
@Component
@RequiredArgsConstructor
public class UserMessageAccessGuard {

    private final RecipientMessageRepository recipientMessageRepository;

    /** The caller's own user id; {@code requestedUserId} must be blank or the same id. */
    public String requireSelf(CustomUserDetails user, String requestedUserId) {
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
        }
        if (StringUtils.hasText(requestedUserId) && !requestedUserId.equals(user.getUserId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "USER_MISMATCH");
        }
        return user.getUserId();
    }

    /**
     * For read/dismiss/click writes: the body's user id is set from the token, and the message
     * must be one that was delivered to that user.
     */
    public void requireOwnMessage(CustomUserDetails user, MessageInteractionRequest request) {
        if (request == null || !StringUtils.hasText(request.getRecipientMessageId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "RECIPIENT_MESSAGE_ID_REQUIRED");
        }
        String userId = requireSelf(user, request.getUserId());
        request.setUserId(userId);
        boolean owned = recipientMessageRepository.findById(request.getRecipientMessageId())
                .map(rm -> userId.equals(rm.getUserId()))
                .orElse(false);
        if (!owned) {
            // Same answer for "no such message" and "someone else's message".
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND");
        }
    }
}
