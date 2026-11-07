package vacademy.io.auth_service.core.config;

import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService.ActiveClient;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.Optional;

/**
 * The platform registrations from application properties, plus one registration per institute that
 * has its own OAuth client ({@link InstituteOAuthClientService}), built on demand.
 *
 * <p>An institute registration id is {@code google@<instituteId>@<fingerprint>}:
 * <ul>
 *   <li>the base id, so {@link #baseRegistrationIdOf} lets the success handler treat the login as
 *       plain "google" — same vendor rows, same account linking (Google's {@code sub} is the same
 *       for every client);</li>
 *   <li>the institute, so the callback can rebuild the registration from the id Spring saved in
 *       the session;</li>
 *   <li>a fingerprint of the client id, so a login started before a brand swapped its client is
 *       refused instead of being exchanged with the wrong client. Spring also caches the ID-token
 *       validator per registration id; a new client id means a new id and a fresh validator.</li>
 * </ul>
 *
 * <p>The redirect URI is the base registration's, so every brand's Google client whitelists the
 * same callback ({@code .../login/oauth2/code/google}). That works because Spring's callback filter
 * takes the registration id from the saved authorization request, not from the callback path.
 */
public class InstituteAwareClientRegistrationRepository
        implements ClientRegistrationRepository, Iterable<ClientRegistration> {

    static final char SEPARATOR = '@';
    private static final int FINGERPRINT_HEX_CHARS = 12;

    private final ClientRegistrationRepository base;
    private final InstituteOAuthClientService instituteClients;

    public InstituteAwareClientRegistrationRepository(ClientRegistrationRepository base,
                                                      InstituteOAuthClientService instituteClients) {
        this.base = base;
        this.instituteClients = instituteClients;
    }

    /** "google@inst@fp" → "google"; a base id is returned unchanged. */
    public static String baseRegistrationIdOf(String registrationId) {
        if (registrationId == null) {
            return null;
        }
        int separator = registrationId.indexOf(SEPARATOR);
        return separator < 0 ? registrationId : registrationId.substring(0, separator);
    }

    /**
     * @return the registration id to start this institute's login with, or null to keep
     *         {@code baseRegistrationId} (no client for the institute, or not a base id).
     */
    public String instituteRegistrationId(String baseRegistrationId, String instituteId) {
        if (baseRegistrationId == null || baseRegistrationId.indexOf(SEPARATOR) >= 0
                || instituteId == null || instituteId.isBlank() || instituteId.indexOf(SEPARATOR) >= 0
                || base.findByRegistrationId(baseRegistrationId) == null) {
            return null;
        }
        return instituteClients.findActiveClient(instituteId, baseRegistrationId)
                .map(client -> baseRegistrationId + SEPARATOR + instituteId + SEPARATOR + fingerprint(client.clientId()))
                .orElse(null);
    }

    @Override
    public ClientRegistration findByRegistrationId(String registrationId) {
        if (registrationId == null || registrationId.indexOf(SEPARATOR) < 0) {
            return base.findByRegistrationId(registrationId);
        }
        String[] parts = registrationId.split(String.valueOf(SEPARATOR), -1);
        if (parts.length != 3 || parts[0].isEmpty() || parts[1].isEmpty() || parts[2].isEmpty()) {
            return null;
        }
        ClientRegistration baseRegistration = base.findByRegistrationId(parts[0]);
        if (baseRegistration == null) {
            return null;
        }
        Optional<ActiveClient> client = instituteClients.findActiveClient(parts[1], parts[0]);
        if (client.isEmpty() || !fingerprint(client.get().clientId()).equals(parts[2])) {
            return null;
        }
        return ClientRegistration.withClientRegistration(baseRegistration)
                .registrationId(registrationId)
                .clientId(client.get().clientId())
                .clientSecret(client.get().clientSecret())
                .redirectUri(baseRegistration.getRedirectUri()
                        .replace("{registrationId}", baseRegistration.getRegistrationId()))
                .build();
    }

    /** Only the platform registrations; institute ones exist per request. */
    @Override
    @SuppressWarnings("unchecked")
    public Iterator<ClientRegistration> iterator() {
        if (base instanceof Iterable<?> iterable) {
            return ((Iterable<ClientRegistration>) iterable).iterator();
        }
        return Collections.emptyIterator();
    }

    static String fingerprint(String clientId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(clientId.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, FINGERPRINT_HEX_CHARS);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
