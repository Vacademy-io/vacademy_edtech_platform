package vacademy.io.common.auth.apikey;

import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Objects;
import java.util.Optional;

/**
 * The SecurityContext authentication of a request made with an institute API key.
 *
 * <p>Authorization must test {@code instanceof ApiKeyAuthentication}, never an authority
 * string: institute authorities mix role names with institute-defined permission names, so
 * a JWT user holding a custom permission called e.g. {@code API_KEY} must not pass. For the
 * same reason this token carries <b>no</b> granted authorities at all.
 *
 * <p>The raw key is not kept (credentials are null) so it cannot leak through a log line or
 * a serialised context.
 */
public final class ApiKeyAuthentication extends AbstractAuthenticationToken {

    private final ApiKeyPrincipal principal;

    public ApiKeyAuthentication(ApiKeyPrincipal principal) {
        super(AuthorityUtils.NO_AUTHORITIES);
        this.principal = Objects.requireNonNull(principal, "principal");
        super.setAuthenticated(true);
    }

    @Override
    public ApiKeyPrincipal getPrincipal() {
        return principal;
    }

    @Override
    public Object getCredentials() {
        return null;
    }

    @Override
    public String getName() {
        return principal.actorId();
    }

    /** Authenticated state is fixed at construction; it can be cleared but never re-granted. */
    @Override
    public void setAuthenticated(boolean authenticated) {
        if (authenticated) {
            throw new IllegalArgumentException("ApiKeyAuthentication cannot be marked authenticated after creation");
        }
        super.setAuthenticated(false);
    }

    /** The API-key principal of the current request, if it authenticated with a key. */
    public static Optional<ApiKeyPrincipal> current() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof ApiKeyAuthentication apiKey && apiKey.isAuthenticated()) {
            return Optional.of(apiKey.getPrincipal());
        }
        return Optional.empty();
    }
}
