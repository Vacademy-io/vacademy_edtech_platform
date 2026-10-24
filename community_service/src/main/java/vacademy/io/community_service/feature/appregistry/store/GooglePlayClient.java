package vacademy.io.community_service.feature.appregistry.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Date;

/**
 * Google Play Developer API client — read-only in intent, but the API itself has no read-only
 * status endpoint: inspecting a track's release status requires opening an "edit" session, the
 * same mechanism a human uses in Play Console to stage changes. So {@link #fetchStatus} opens an
 * edit, reads the production track, and deletes (never commits) the edit in a finally block —
 * nothing is ever published through this class, and the edit is discarded immediately after the
 * read rather than left dangling.
 *
 * <p><b>Real, load-bearing caveat:</b> Play Console allows only one open edit per app at a time.
 * If a human has an edit open in the console when this runs, this call will fail with a 409 — by
 * design, not a bug to route around. {@link #fetchStatus} treats that as "could not verify right
 * now" (null), never as "not registered".
 *
 * <p><b>Unverified.</b> Unlike {@link AppStoreConnectClient}, this was written to Google's
 * documented API shape but never exercised against a real service account — no Play Developer
 * credential exists anywhere in this project yet. Treat the parsing logic as reviewed-but-untested
 * until the first real credential is wired in and this gets exercised for real.
 */
@Slf4j
public class GooglePlayClient {

    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
    private static final String SCOPE = "https://www.googleapis.com/auth/androidpublisher";
    private static final long TOKEN_TTL_SECONDS = 3300; // Google allows up to 3600s; stay under.

    private final String clientEmail;
    private final PrivateKey privateKey;
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private volatile String cachedAccessToken;
    private volatile long cachedTokenExpiresAtEpochSeconds;

    private GooglePlayClient(String clientEmail, PrivateKey privateKey) {
        this.clientEmail = clientEmail;
        this.privateKey = privateKey;
    }

    /**
     * @param serviceAccountJson the raw JSON of a downloaded Google Cloud service-account key
     *                           (must contain {@code client_email} and {@code private_key}).
     * @return a client, or null if the JSON is missing those fields or doesn't parse.
     */
    public static GooglePlayClient of(String serviceAccountJson) {
        if (!StringUtils.hasText(serviceAccountJson)) {
            return null;
        }
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode json = mapper.readTree(serviceAccountJson);
            String clientEmail = json.path("client_email").asText(null);
            String pem = json.path("private_key").asText(null);
            if (clientEmail == null || pem == null) {
                return null;
            }
            String cleaned = pem
                    .replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "")
                    .replaceAll("\\s", "");
            byte[] der = Base64.getDecoder().decode(cleaned);
            PrivateKey privateKey = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
            return new GooglePlayClient(clientEmail, privateKey);
        } catch (Exception e) {
            log.warn("[GooglePlay] Could not parse service account JSON: {}", e.getMessage());
            return null;
        }
    }

    /** Result of a track lookup, or null if this account has no app with that package name. */
    public record AppStatus(String releaseStatus, String versionCode, String releaseName) {
    }

    /**
     * @return production-track status for {@code packageName}, or null if the app isn't visible
     *         to this service account, or the lookup couldn't complete (including the 409
     *         "another edit is already open" case — never conflated with "not registered").
     */
    public AppStatus fetchStatus(String packageName) {
        if (!StringUtils.hasText(packageName)) {
            return null;
        }
        String editId = null;
        try {
            JsonNode editBody = post("/applications/" + packageName + "/edits", null);
            editId = editBody.path("id").asText(null);
            if (editId == null) {
                return null;
            }

            JsonNode track = get("/applications/" + packageName + "/edits/" + editId + "/tracks/production");
            JsonNode releases = track.path("releases");
            if (!releases.isArray() || releases.isEmpty()) {
                // Track exists (app is registered) but nothing has ever been released to it.
                return new AppStatus("draft", "", "");
            }

            // releases[0] is documented as the track's current/most relevant release.
            JsonNode release = releases.get(0);
            String status = release.path("status").asText("");
            String versionCode = "";
            JsonNode versionCodes = release.path("versionCodes");
            if (versionCodes.isArray() && !versionCodes.isEmpty()) {
                versionCode = versionCodes.get(0).asText("");
            }
            String releaseName = release.path("name").asText("");
            return new AppStatus(status, versionCode, releaseName);
        } catch (HttpClientErrorException.NotFound e) {
            // No app registered under this package name for this service account.
            return null;
        } catch (HttpClientErrorException.Conflict e) {
            log.warn("[GooglePlay] Edit conflict for {} — another edit session is already open "
                    + "(likely a human in Play Console); could not verify status this time.", packageName);
            return null;
        } catch (Exception e) {
            log.warn("[GooglePlay] Status lookup failed for packageName={}: {}", packageName, e.getMessage());
            return null;
        } finally {
            if (editId != null) {
                try {
                    delete("/applications/" + packageName + "/edits/" + editId);
                } catch (Exception e) {
                    log.warn("[GooglePlay] Could not discard edit {} for {}: {}", editId, packageName, e.getMessage());
                }
            }
        }
    }

    /* ------------------------------------------------------------------ internals */

    private JsonNode get(String path) throws Exception {
        return exchange(HttpMethod.GET, path, null);
    }

    private JsonNode post(String path, Object body) throws Exception {
        return exchange(HttpMethod.POST, path, body);
    }

    private void delete(String path) throws Exception {
        exchange(HttpMethod.DELETE, path, null);
    }

    private JsonNode exchange(HttpMethod method, String path, Object body) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + accessToken());
        headers.setContentType(MediaType.APPLICATION_JSON);
        RequestEntity<Object> request = new RequestEntity<>(body, headers, method, URI.create(API_BASE + path));
        ResponseEntity<String> response = restTemplate.exchange(request, String.class);
        String responseBody = response.getBody();
        return (responseBody == null || responseBody.isBlank()) ? objectMapper.createObjectNode()
                : objectMapper.readTree(responseBody);
    }

    private synchronized String accessToken() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        if (cachedAccessToken != null && now < cachedTokenExpiresAtEpochSeconds - 30) {
            return cachedAccessToken;
        }

        long exp = now + TOKEN_TTL_SECONDS;
        String assertion = Jwts.builder()
                .setIssuer(clientEmail)
                .claim("scope", SCOPE)
                .setAudience(TOKEN_URL)
                .setIssuedAt(new Date(now * 1000))
                .setExpiration(new Date(exp * 1000))
                .signWith(privateKey, SignatureAlgorithm.RS256)
                .compact();

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        org.springframework.util.MultiValueMap<String, String> form = new org.springframework.util.LinkedMultiValueMap<>();
        form.add("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
        form.add("assertion", assertion);
        RequestEntity<org.springframework.util.MultiValueMap<String, String>> request =
                new RequestEntity<>(form, headers, HttpMethod.POST, URI.create(TOKEN_URL));

        ResponseEntity<String> response = restTemplate.exchange(request, String.class);
        JsonNode json = objectMapper.readTree(response.getBody());
        String accessToken = json.path("access_token").asText(null);
        if (accessToken == null) {
            throw new IllegalStateException("Google token endpoint did not return access_token");
        }
        long expiresIn = json.path("expires_in").asLong(TOKEN_TTL_SECONDS);

        cachedAccessToken = accessToken;
        cachedTokenExpiresAtEpochSeconds = now + expiresIn;
        return cachedAccessToken;
    }
}
