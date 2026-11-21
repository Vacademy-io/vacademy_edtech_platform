package vacademy.io.assessment_service.features.open_evaluation.auth;

import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Objects;

/**
 * Builds the {@link CustomUserDetails} that existing managers expect, for a call made with
 * an API key (spec 6.4).
 *
 * <p>Managers and {@code EvaluationAccessValidator} refuse a principal without
 * authorities, so the synthetic user carries {@code ADMIN}. Its id is
 * {@code apikey:{key_id}} (what billing and audit record) and its name
 * {@code API · {key name}} (what the activity log shows). It is not a root user.
 *
 * <p><b>Pass it to manager calls only. Never put it in the SecurityContext</b>: there the
 * request is an {@code ApiKeyAuthentication}, and every authorization rule of the partner
 * API depends on that; an ADMIN {@code CustomUserDetails} in the context would let the
 * request through JWT-only rules too. Nothing in this class touches the context.
 */
public final class ApiActorPrincipals {

    public static final String API_AUTHORITY = "ADMIN";
    public static final String NAME_PREFIX = "API · ";

    private ApiActorPrincipals() {
    }

    public static CustomUserDetails forKey(ApiKeyPrincipal key) {
        Objects.requireNonNull(key, "key");
        if (key.getKeyId() == null || key.getKeyId().isBlank()) {
            throw new IllegalArgumentException("API key principal has no key id");
        }
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(key.actorId());
        dto.setUsername(key.actorId());
        dto.setFullName(NAME_PREFIX + (key.getName() == null || key.getName().isBlank() ? key.getKeyId() : key.getName()));
        dto.setEnabled(true);
        dto.setRootUser(false);
        dto.setRoles(List.of(API_AUTHORITY));
        dto.setAuthorities(List.of(API_AUTHORITY));
        return new CustomUserDetails(dto);
    }
}
