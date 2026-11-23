package vacademy.io.notification_service.features.announcements.security;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.service.ClientAuthenticationService;

/**
 * Service-to-service check for announcement endpoints that other services call without a user
 * token. Uses the same {@code clientName} + {@code Signature} headers and client table as
 * InternalAuthFilter, which only covers paths with an "internal" segment; these routes predate
 * that convention and keep their path so existing callers do not need to move.
 */
@Component
@RequiredArgsConstructor
public class InternalClientGuard {

    private final ClientAuthenticationService clientAuthenticationService;

    public void requireInternalClient(String clientName, String signature) {
        if (!StringUtils.hasText(clientName) || !StringUtils.hasText(signature)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "CLIENT_AUTH_REQUIRED");
        }
        boolean valid;
        try {
            valid = clientAuthenticationService.validateClient(clientName, signature);
        } catch (RuntimeException e) {
            valid = false;
        }
        if (!valid) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "CLIENT_AUTH_INVALID");
        }
    }
}
