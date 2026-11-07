package vacademy.io.common.auth.apikey;

import java.util.Optional;

/**
 * Resolves a key hash to its principal. Implemented per service (assessment_service calls
 * admin_core's internal verify endpoint behind a cache).
 *
 * <p>Contract:
 * <ul>
 *   <li>known key: the principal, whatever its status or expiry (the filter checks both, so
 *       a cached entry cannot outlive its own {@code expires_at});</li>
 *   <li>unknown, revoked or expired key according to the source of truth:
 *       {@link Optional#empty()};</li>
 *   <li>the source of truth cannot be reached and nothing is cached:
 *       throw {@link ApiKeyVerifierUnavailableException}. Never answer "unknown" for an
 *       outage, or every partner sees 401 during an admin_core restart.</li>
 * </ul>
 */
public interface ApiKeyVerifier {

    /**
     * @param keyHash lowercase hex SHA-256 of the full key ({@link ApiKeyFormat#sha256Hex})
     */
    Optional<ApiKeyPrincipal> verify(String keyHash) throws ApiKeyVerifierUnavailableException;
}
