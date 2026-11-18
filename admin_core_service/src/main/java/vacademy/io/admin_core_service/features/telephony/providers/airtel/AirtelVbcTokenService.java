package vacademy.io.admin_core_service.features.telephony.providers.airtel;

import vacademy.io.admin_core_service.core.external.ExternalCallLog;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderCredentials;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;
import java.net.URLEncoder;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Mints + caches VBC end-user bearer tokens (password grant), cached until ~2 min
 * before expiry.
 *
 * CRITICAL: the Telephony (click2dial) API requires a token for a real VBC USER —
 * one stamped with {@code eAuthStatus:true} + {@code eClaims(accountNumber)}. That
 * only comes from the {@code api.vonage.com/token} gateway authenticating the VBC
 * user's email + VBC password. The raw WSO2 {@code oauth2/token} endpoint mints a
 * token for the OAuth APPLICATION only (no end-user auth), and the Telephony API
 * silently rejects it (an empty 202). So {@code vbcUsername}/{@code vbcPassword}
 * must be a VBC user login, NOT the API service account. The token is
 * account-scoped, so one VBC user can place click2dial from any extension.
 */
@Component
public class AirtelVbcTokenService {

    static final String DEFAULT_TOKEN_URL = "https://api.vonage.com/token";
    /** VBC realm suffix appended to the username for the password grant. */
    private static final String VBC_REALM_SUFFIX = "@vbc.prod";

    private final RestTemplate rest = ExternalCallLog.attach(new RestTemplate());
    private final Map<String, CachedToken> cache = new ConcurrentHashMap<>();

    private record CachedToken(String bearer, Instant expiresAt) {}

    /** A valid bearer for these credentials, minting + caching as needed. */
    public String bearer(ProviderCredentials creds) {
        String key = cacheKey(creds);
        CachedToken c = cache.get(key);
        if (c != null && c.expiresAt().isAfter(Instant.now())) {
            return c.bearer();
        }
        return mint(creds, key);
    }

    /** Drop the cached token (e.g. after a 401), forcing a fresh mint next call. */
    public void invalidate(ProviderCredentials creds) {
        cache.remove(cacheKey(creds));
    }

    /**
     * The minted bearer is scoped to the VBC USER (password grant), not just the
     * OAuth application — so the cache key must include the username (and token
     * host). Otherwise two institutes sharing one consumerKey but different VBC
     * users could be served each other's user-scoped token.
     */
    private static String cacheKey(ProviderCredentials creds) {
        String consumerKey = creds.secret("consumerKey");
        if (consumerKey == null) throw new VacademyException("Airtel consumerKey is not configured");
        String username = creds.secret("vbcUsername");
        String tokenUrl = firstNonBlank(creds.conf("tokenUrl"), DEFAULT_TOKEN_URL);
        return consumerKey + "|" + (username == null ? "" : username) + "|" + tokenUrl;
    }

    @SuppressWarnings("unchecked")
    private String mint(ProviderCredentials creds, String key) {
        String tokenUrl = firstNonBlank(creds.conf("tokenUrl"), DEFAULT_TOKEN_URL);
        // Append the @vbc.prod realm. endsWith (not "contains '@'") so a VBC login
        // EMAIL like "name@org.com" becomes "name@org.com@vbc.prod" rather than
        // being left unsuffixed (which fails auth).
        String username = creds.secret("vbcUsername");
        if (username != null && !username.endsWith(VBC_REALM_SUFFIX)) username += VBC_REALM_SUFFIX;

        // client_id/client_secret go in the BODY — the api.vonage.com/token gateway
        // takes them as form params, not HTTP Basic. username/password are the VBC
        // end-user's login.
        String form = "grant_type=password&scope=openid"
                + "&username=" + enc(username)
                + "&password=" + enc(creds.secret("vbcPassword"))
                + "&client_id=" + enc(creds.secret("consumerKey"))
                + "&client_secret=" + enc(creds.secret("consumerSecret"));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        Map<String, Object> body;
        try {
            ResponseEntity<Map> resp = rest.postForEntity(tokenUrl, new HttpEntity<>(form, headers), Map.class);
            body = resp.getBody();
        } catch (Exception e) {
            throw new VacademyException("Airtel token request failed: " + e.getMessage());
        }
        if (body == null || body.get("access_token") == null) {
            throw new VacademyException("Airtel token response missing access_token");
        }
        String token = String.valueOf(body.get("access_token"));
        long expiresIn = body.get("expires_in") instanceof Number n ? n.longValue() : 86400L;
        cache.put(key, new CachedToken(token, Instant.now().plusSeconds(Math.max(60, expiresIn - 120))));
        return token;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }

    private static String firstNonBlank(String a, String b) {
        return (a != null && !a.isBlank()) ? a : b;
    }
}
