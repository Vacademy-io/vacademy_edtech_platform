package vacademy.io.community_service.feature.appregistry.build;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.RequestEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Date;
import java.util.Map;

/**
 * Firebase Management API client for the iOS build: finds or registers the iOS app for a bundle
 * id in the shared Firebase project and returns its {@code GoogleService-Info.plist}.
 *
 * <p>Credential: {@code FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON}, a service account of the project
 * with the "Firebase Admin" role. A GoogleService-Info.plist is not a secret (it ships inside
 * every app binary); the service-account key is, and stays in the k8s secret.
 */
@Slf4j
@Component
public class FirebaseAppClient {

    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String API = "https://firebase.googleapis.com/v1beta1";
    private static final String SCOPE = "https://www.googleapis.com/auth/firebase";

    private final String project;
    private final String clientEmail;
    private final PrivateKey privateKey;
    private final RestTemplate restTemplate = BuildHttp.restTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private String cachedToken;
    private long cachedTokenExpiresAt;

    public FirebaseAppClient(@Value("${FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON:}") String serviceAccountJson,
                             @Value("${appregistry.firebase.project:vacademy-app-2}") String project) {
        this.project = project;
        String email = null;
        PrivateKey key = null;
        if (StringUtils.hasText(serviceAccountJson)) {
            try {
                JsonNode json = objectMapper.readTree(serviceAccountJson);
                email = json.path("client_email").asText(null);
                String pem = json.path("private_key").asText("")
                        .replace("-----BEGIN PRIVATE KEY-----", "")
                        .replace("-----END PRIVATE KEY-----", "")
                        .replaceAll("\\s", "");
                key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
            } catch (Exception e) {
                log.warn("[Firebase] Could not parse FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON: {}", e.getMessage());
                email = null;
                key = null;
            }
        }
        this.clientEmail = email;
        this.privateKey = key;
    }

    public boolean isConfigured() {
        return clientEmail != null && privateKey != null;
    }

    public String project() {
        return project;
    }

    public record IosApp(String appId, String displayName) {
    }

    /** @return the project's iOS app for this bundle id, or null if none is registered. */
    public IosApp findIosApp(String bundleId) throws Exception {
        String pageToken = "";
        for (int page = 0; page < 20; page++) {
            JsonNode body = call(HttpMethod.GET, "/projects/" + project + "/iosApps?pageSize=100"
                    + (pageToken.isEmpty() ? "" : "&pageToken=" + URLEncoder.encode(pageToken, StandardCharsets.UTF_8)), null);
            for (JsonNode app : body.path("apps")) {
                if (bundleId.equals(app.path("bundleId").asText(""))) {
                    return new IosApp(app.path("appId").asText(""), app.path("displayName").asText(""));
                }
            }
            pageToken = body.path("nextPageToken").asText("");
            if (pageToken.isEmpty()) {
                break;
            }
        }
        return null;
    }

    /** Registers the iOS app and waits (up to ~40 s) for Firebase's long-running operation. */
    public IosApp createIosApp(String bundleId, String displayName) throws Exception {
        JsonNode op = call(HttpMethod.POST, "/projects/" + project + "/iosApps",
                objectMapper.writeValueAsString(Map.of("bundleId", bundleId, "displayName", displayName)));
        String name = op.path("name").asText("");
        for (int i = 0; i < 20 && !op.path("done").asBoolean(false); i++) {
            Thread.sleep(2000);
            op = call(HttpMethod.GET, "/" + name, null);
        }
        if (op.has("error")) {
            throw new IllegalStateException("Firebase refused the iOS app: " + op.path("error").path("message").asText());
        }
        if (!op.path("done").asBoolean(false)) {
            // Still running: the next status check will find it by bundle id.
            return null;
        }
        JsonNode app = op.path("response");
        return new IosApp(app.path("appId").asText(""), app.path("displayName").asText(displayName));
    }

    /** @return the app's GoogleService-Info.plist, base64-encoded exactly as Firebase serves it. */
    public String configPlistBase64(String appId) throws Exception {
        return call(HttpMethod.GET, "/projects/" + project + "/iosApps/" + appId + "/config", null)
                .path("configFileContents").asText("");
    }

    /* ------------------------------------------------------------------ internals */

    private JsonNode call(HttpMethod method, String path, String body) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token());
        if (body != null) {
            headers.setContentType(MediaType.APPLICATION_JSON);
        }
        String response = restTemplate.exchange(new RequestEntity<>(body, headers, method, URI.create(API + path)),
                String.class).getBody();
        return objectMapper.readTree(response == null ? "{}" : response);
    }

    private synchronized String token() throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is not set");
        }
        long now = System.currentTimeMillis() / 1000;
        if (cachedToken != null && now < cachedTokenExpiresAt - 60) {
            return cachedToken;
        }
        String assertion = Jwts.builder()
                .setIssuer(clientEmail)
                .setAudience(TOKEN_URL)
                .claim("scope", SCOPE)
                .setIssuedAt(new Date(now * 1000))
                .setExpiration(new Date((now + 3300) * 1000))
                .signWith(privateKey, SignatureAlgorithm.RS256)
                .compact();
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
        form.add("assertion", assertion);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        String response = restTemplate.exchange(new RequestEntity<>(form, headers, HttpMethod.POST, URI.create(TOKEN_URL)),
                String.class).getBody();
        JsonNode json = objectMapper.readTree(response);
        cachedToken = json.path("access_token").asText(null);
        cachedTokenExpiresAt = now + json.path("expires_in").asLong(3300);
        return cachedToken;
    }
}
