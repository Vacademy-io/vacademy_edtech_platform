package vacademy.io.community_service.feature.appregistry.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;

/**
 * Microsoft Store submission API client (Partner Center), Azure AD client-credentials auth.
 *
 * <p><b>Unverified.</b> Same caveat as {@link GooglePlayClient}: written to Microsoft's documented
 * API shape, never exercised against a real Partner Center account — no Azure AD credential for
 * this exists anywhere in the project. The field names read out of the application resource
 * ({@code lastPublishedApplicationSubmission.status}, etc.) are Microsoft's documented shape as of
 * when this was written; verify against a real response before trusting the status mapping.
 */
@Slf4j
public class MicrosoftPartnerCenterClient {

    private static final String API_BASE = "https://manage.devcenter.microsoft.com/v1.0/my";
    private static final String RESOURCE = "https://manage.devcenter.microsoft.com";

    private final String tenantId;
    private final String clientId;
    private final String clientSecret;
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private volatile String cachedAccessToken;
    private volatile long cachedTokenExpiresAtEpochSeconds;

    private MicrosoftPartnerCenterClient(String tenantId, String clientId, String clientSecret) {
        this.tenantId = tenantId;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    /**
     * @return a client, or null if any of tenantId/clientId/clientSecret is missing.
     */
    public static MicrosoftPartnerCenterClient of(String tenantId, String clientId, String clientSecret) {
        if (!StringUtils.hasText(tenantId) || !StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
            return null;
        }
        return new MicrosoftPartnerCenterClient(tenantId, clientId, clientSecret);
    }

    /**
     * Result of an application lookup, or null if this account has no such application.
     *
     * @param failureReason what certification actually objected to, when the submission failed.
     *                      Microsoft is the only one of the three stores that returns this text —
     *                      Apple keeps its review message in Resolution Center and Play keeps
     *                      policy decisions in the console — so it is the one rejection an
     *                      institute can be shown a real reason for.
     */
    public record AppStatus(String submissionStatus, String versionOrPackageFamily, String failureReason) {
    }

    /**
     * @param applicationId the Microsoft Store application id (the "Store ID", e.g. 9NBLGGH4XXXX).
     * @return the app's most recent submission status, or null if it isn't visible to this
     *         account or the lookup failed.
     */
    public AppStatus fetchStatus(String applicationId) {
        if (!StringUtils.hasText(applicationId)) {
            return null;
        }
        try {
            JsonNode app = get("/applications/" + applicationId);

            // Prefer the in-flight submission if one exists (it's the more current answer to
            // "what's happening with this app right now"); fall back to the last published one.
            JsonNode submission = app.path("pendingApplicationSubmission");
            if (submission.isMissingNode() || submission.isNull()) {
                submission = app.path("lastPublishedApplicationSubmission");
            }
            if (submission.isMissingNode() || submission.isNull()) {
                // App is registered in Partner Center but has never had a submission.
                return new AppStatus("None", "", "");
            }

            String status = submission.path("status").asText("");
            String packageFamilyName = app.path("packageFamilyName").asText("");
            return new AppStatus(status, packageFamilyName, failureReasonOf(submission));
        } catch (HttpClientErrorException.NotFound e) {
            return null;
        } catch (Exception e) {
            log.warn("[MicrosoftPartnerCenter] Status lookup failed for applicationId={}: {}",
                    applicationId, e.getMessage());
            return null;
        }
    }

    /**
     * The certification errors on a failed submission, joined into one readable line.
     *
     * <p>Microsoft returns them under {@code statusDetails.errors[]} as a code and a details
     * string; the code alone ("PackageValidationFailed") tells an institute nothing, so the
     * details are what is kept, with the code as a fallback when a details string is missing.
     */
    private static String failureReasonOf(JsonNode submission) {
        JsonNode errors = submission.path("statusDetails").path("errors");
        if (!errors.isArray() || errors.isEmpty()) {
            return "";
        }
        StringBuilder reason = new StringBuilder();
        for (JsonNode error : errors) {
            String details = error.path("details").asText("");
            if (details.isBlank()) {
                details = error.path("code").asText("");
            }
            if (details.isBlank()) {
                continue;
            }
            if (reason.length() > 0) {
                reason.append(" · ");
            }
            reason.append(details);
        }
        return reason.toString();
    }

    /* ------------------------------------------------------------------ internals */

    private JsonNode get(String path) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + accessToken());
        RequestEntity<Void> request = new RequestEntity<>(headers, HttpMethod.GET, URI.create(API_BASE + path));
        ResponseEntity<String> response = restTemplate.exchange(request, String.class);
        return objectMapper.readTree(response.getBody());
    }

    private synchronized String accessToken() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        if (cachedAccessToken != null && now < cachedTokenExpiresAtEpochSeconds - 30) {
            return cachedAccessToken;
        }

        String tokenUrl = "https://login.microsoftonline.com/" + tenantId + "/oauth2/token";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "client_credentials");
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        form.add("resource", RESOURCE);
        RequestEntity<MultiValueMap<String, String>> request =
                new RequestEntity<>(form, headers, HttpMethod.POST, URI.create(tokenUrl));

        ResponseEntity<String> response = restTemplate.exchange(request, String.class);
        JsonNode json = objectMapper.readTree(response.getBody());
        String accessToken = json.path("access_token").asText(null);
        if (accessToken == null) {
            throw new IllegalStateException("Azure AD token endpoint did not return access_token");
        }
        long expiresIn = json.path("expires_in").asLong(3300);

        cachedAccessToken = accessToken;
        cachedTokenExpiresAtEpochSeconds = now + expiresIn;
        return cachedAccessToken;
    }
}
