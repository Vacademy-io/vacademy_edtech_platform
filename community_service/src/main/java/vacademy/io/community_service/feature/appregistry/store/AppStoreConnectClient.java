package vacademy.io.community_service.feature.appregistry.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.RequestEntity;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Date;

/**
 * App Store Connect API client for the app-registry "provider" status sync — read-only, and
 * deliberately narrow: it answers exactly the questions {@code getAppStatus} needs (does an app
 * exist for this bundle id, what's its latest version, and what review/release state is it in),
 * not a general-purpose ASC SDK.
 *
 * <p><b>Not a Spring-managed singleton.</b> Different white-label institutes can own separate
 * Apple Developer accounts — the flat "one shared credential from an env var" design this started
 * with silently reported every app under any *other* account as "Not Registered", which is
 * actively wrong, not just unverified (found via Shiksha Nation, which has its own account). So
 * this is now a plain object built per credential by {@link StoreCredentialResolver}, which picks
 * the right one — institute-specific, falling back to a shared default — before constructing it.
 * Each instance caches its own signed JWT; nothing here is process-wide state.
 */
@Slf4j
public class AppStoreConnectClient {

    private static final String BASE_URL = "https://api.appstoreconnect.apple.com";
    /** Apple caps token lifetime at 20 minutes; stay comfortably inside that. */
    private static final long TOKEN_TTL_SECONDS = 900;

    private final String issuerId;
    private final String keyId;
    private final PrivateKey privateKey;
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private volatile String cachedToken;
    private volatile long cachedTokenExpiresAtEpochSeconds;

    private AppStoreConnectClient(String issuerId, String keyId, PrivateKey privateKey) {
        this.issuerId = issuerId;
        this.keyId = keyId;
        this.privateKey = privateKey;
    }

    /**
     * @return a client for this credential, or null if issuerId/keyId/p8 are missing or the p8
     *         doesn't parse as an EC private key — callers treat null exactly like "not configured".
     */
    public static AppStoreConnectClient of(String issuerId, String keyId, String p8) {
        if (!StringUtils.hasText(issuerId) || !StringUtils.hasText(keyId) || !StringUtils.hasText(p8)) {
            return null;
        }
        PrivateKey privateKey = parsePrivateKey(p8);
        return privateKey == null ? null : new AppStoreConnectClient(issuerId, keyId, privateKey);
    }

    /**
     * The newest review submission for a platform. {@code state} is the one that matters:
     * UNRESOLVED_ISSUES means App Review raised something and the app is blocked on it.
     */
    public record ReviewSubmission(String state, String submittedDate) {

        private static final String BLOCKED = "UNRESOLVED_ISSUES";

        public boolean hasUnresolvedIssues() {
            return BLOCKED.equals(state);
        }
    }

    /**
     * The most recent review submission Apple has for this app on this platform.
     *
     * <p>Worth a second call because the version's own state does not always say the app is stuck:
     * verified live on a real rejected app (io.shikshanation.app), the version reads
     * READY_FOR_REVIEW while its submission reads UNRESOLVED_ISSUES. Going by the version alone,
     * an institute would be told their app is ready to submit when App Review has in fact bounced
     * it back.
     *
     * <p>Apple exposes the state and the date, but <b>not the reason</b> — the review's actual
     * message lives in Resolution Center and no endpoint returns it (checked against a real
     * UNRESOLVED_ISSUES submission: its items carry a state and nothing else). So the reason stays
     * something a person pastes in; this only makes sure the rejection itself is never missed.
     *
     * @return the newest submission for that platform, or null if there are none or the call failed.
     */
    public ReviewSubmission fetchLatestReviewSubmission(String ascAppId, String ascPlatform) {
        if (!StringUtils.hasText(ascAppId) || !StringUtils.hasText(ascPlatform)) {
            return null;
        }
        try {
            JsonNode body = get("/v1/apps/" + ascAppId + "/reviewSubmissions?limit=50");
            JsonNode best = null;
            String bestDate = "";
            for (JsonNode submission : body.path("data")) {
                JsonNode attributes = submission.path("attributes");
                if (!ascPlatform.equals(attributes.path("platform").asText(""))) {
                    continue;
                }
                String submitted = attributes.path("submittedDate").asText("");
                if (best == null || submitted.compareTo(bestDate) > 0) {
                    best = attributes;
                    bestDate = submitted;
                }
            }
            return best == null ? null
                    : new ReviewSubmission(best.path("state").asText(""), bestDate);
        } catch (Exception e) {
            log.warn("[AppStoreConnect] Review submission lookup failed for appId={} platform={}: {}",
                    ascAppId, ascPlatform, e.getMessage());
            return null;
        }
    }

    /** Result of a status lookup, or null if no app is registered in ASC for that bundle id. */
    public record AppStatus(String ascAppId, String appStoreState, String versionString,
                             String buildNumber, String createdDate) {
    }

    /**
     * @param bundleId    the app's bundle id.
     * @param ascPlatform IOS or MAC_OS — App Store Connect's own platform values.
     * @return the latest app-store-version info for that bundle id <em>on that platform</em>, or
     *         null if ASC has no app with the bundle id under *this credential's* Apple Developer
     *         account, or the lookup failed. A null here does not prove the app doesn't exist
     *         anywhere — only that it isn't visible to this specific account.
     */
    public AppStatus fetchStatus(String bundleId, String ascPlatform) {
        if (!StringUtils.hasText(bundleId) || !StringUtils.hasText(ascPlatform)) {
            return null;
        }
        try {
            JsonNode appsBody = get("/v1/apps?filter[bundleId]=" + bundleId);
            JsonNode apps = appsBody.path("data");
            if (!apps.isArray() || apps.isEmpty()) {
                return null;
            }
            String ascAppId = apps.get(0).path("id").asText(null);
            if (ascAppId == null) {
                return null;
            }

            // `sort` is rejected on this nested relationship route (verified against the live API
            // — it 400s with PARAMETER_ERROR.ILLEGAL), unlike the top-level /v1/appStoreVersions
            // collection where it's documented. So the "most recent" version is picked client-side
            // by comparing createdDate across the page, not trusted to arrive in a given order.
            // include=build resolves the CFBundleVersion in the same call; it's matched back to
            // THIS version specifically via its build relationship id — with limit>1, `included`
            // can contain builds for other versions too, so "first builds entry" would be wrong.
            //
            // filter[platform] is not optional here. One ASC app record holds the versions for
            // EVERY platform that bundle ships on, and Shiksha Nation and ZOE both ship iOS and
            // macOS under a single bundle id — verified live: io.zoeedtech.app is on iOS 2.5.5
            // while its Mac app is on 1.0.1 with a 1.0.2 still in PREPARE_FOR_SUBMISSION. Without
            // the filter, the Mac App Store row would report the iPhone app's version and state.
            JsonNode versionsBody = get("/v1/apps/" + ascAppId
                    + "/appStoreVersions?limit=50&include=build&filter[platform]=" + ascPlatform);
            JsonNode versions = versionsBody.path("data");
            if (!versions.isArray() || versions.isEmpty()) {
                return new AppStatus(ascAppId, noVersionsStateFor(ascAppId), "", "", "");
            }

            // "Most recently created version" is NOT the same question as "what's live right now" —
            // verified against a real multi-version app (io.vacademy.student.app): its newest
            // version by createdDate was an abandoned PREPARE_FOR_SUBMISSION draft, while an older
            // entry was the actual READY_FOR_SALE version still serving users. Naively picking the
            // newest createdDate would have reported a live, working app as "Draft" — actively
            // wrong for the one audience (an institute admin) asking "is my app working right now".
            //
            // So: prefer the most recent version that is actually READY_FOR_SALE (what's live),
            // and only fall back to the overall most recent version when nothing has ever gone
            // live yet (a brand-new app still in its first submission).
            JsonNode latest = selectVersion(versions);

            JsonNode attrs = latest.path("attributes");
            String buildRelId = latest.path("relationships").path("build").path("data").path("id").asText(null);
            String buildNumber = "";
            if (buildRelId != null) {
                for (JsonNode included : versionsBody.path("included")) {
                    if ("builds".equals(included.path("type").asText())
                            && buildRelId.equals(included.path("id").asText())) {
                        buildNumber = included.path("attributes").path("version").asText("");
                        break;
                    }
                }
            }
            return new AppStatus(
                    ascAppId,
                    stateOf(latest),
                    attrs.path("versionString").asText(""),
                    buildNumber,
                    attrs.path("createdDate").asText(""));
        } catch (Exception e) {
            log.warn("[AppStoreConnect] Status lookup failed for bundleId={}: {}", bundleId, e.getMessage());
            return null;
        }
    }

    /**
     * No versions came back for the platform asked about. That means one of two very different
     * things, and telling an institute the wrong one is worse than saying nothing:
     *
     * <ul>
     *   <li>the app record has no versions at all — a brand-new app still being prepared, which is
     *       genuinely PREPARE_FOR_SUBMISSION;</li>
     *   <li>the app ships on some other platform but not this one — the Mac App Store row for an
     *       iPhone-only app. That is NOT_REGISTERED, and calling it "Draft" would invent a Mac
     *       release nobody has started.</li>
     * </ul>
     *
     * <p>Costs one extra call, and only in the empty case.
     */
    private String noVersionsStateFor(String ascAppId) {
        try {
            JsonNode any = get("/v1/apps/" + ascAppId + "/appStoreVersions?limit=1");
            boolean hasVersionsOnSomePlatform = any.path("data").isArray() && !any.path("data").isEmpty();
            return hasVersionsOnSomePlatform ? "NOT_REGISTERED" : "PREPARE_FOR_SUBMISSION";
        } catch (Exception e) {
            log.warn("[AppStoreConnect] Could not tell a never-submitted app from a platform it "
                    + "does not ship on (appId={}): {}", ascAppId, e.getMessage());
            return "NOT_REGISTERED";
        }
    }

    /**
     * @param requiredState if non-null, only versions in this exact appStoreState are considered;
     *                      if null, every version is a candidate. Ties broken by createdDate.
     * @return the matching version with the latest createdDate, or null if none match.
     */
    private static JsonNode mostRecentByState(JsonNode versions, String requiredState) {
        JsonNode best = null;
        String bestCreatedDate = "";
        for (JsonNode version : versions) {
            if (requiredState != null && !requiredState.equals(stateOf(version))) {
                continue;
            }
            String createdDate = version.path("attributes").path("createdDate").asText("");
            if (best == null || createdDate.compareTo(bestCreatedDate) > 0) {
                best = version;
                bestCreatedDate = createdDate;
            }
        }
        return best;
    }

    /**
     * Which of an app's versions this platform's status should be read from.
     *
     * <p>"Most recently created" is NOT the question — see the note in {@link #fetchStatus}. The
     * live version wins; only when nothing has ever gone live does the newest one stand in.
     *
     * <p>Apple is retiring {@code appStoreState} in favour of {@code appVersionState}, and the two
     * spell the live state differently (READY_FOR_SALE vs READY_FOR_DISTRIBUTION). Both ship in
     * the same response today, so match on either rather than pinning to the one going away.
     *
     * <p>Package-private for the test that pins this against a captured live response.
     */
    static JsonNode selectVersion(JsonNode versions) {
        JsonNode live = mostRecentLive(versions);
        return live != null ? live : mostRecentByState(versions, null);
    }

    /** The most recent version that is actually live, under either spelling of that state. */
    private static JsonNode mostRecentLive(JsonNode versions) {
        JsonNode readyForSale = mostRecentByState(versions, "READY_FOR_SALE");
        JsonNode readyForDistribution = mostRecentByState(versions, "READY_FOR_DISTRIBUTION");
        if (readyForSale == null) {
            return readyForDistribution;
        }
        if (readyForDistribution == null) {
            return readyForSale;
        }
        return createdDateOf(readyForDistribution).compareTo(createdDateOf(readyForSale)) > 0
                ? readyForDistribution : readyForSale;
    }

    /**
     * The version's review/release state. {@code appVersionState} is the field Apple is moving to;
     * {@code appStoreState} is the one it is replacing. Both ship in the same response today, so
     * read the new one first and fall back rather than depending on the deprecated field.
     */
    static String stateOf(JsonNode version) {
        JsonNode attributes = version.path("attributes");
        String versionState = attributes.path("appVersionState").asText("");
        return versionState.isEmpty() ? attributes.path("appStoreState").asText("") : versionState;
    }

    private static String createdDateOf(JsonNode version) {
        return version.path("attributes").path("createdDate").asText("");
    }

    /* ------------------------------------------------------------------ internals */

    private JsonNode get(String path) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + token());
        RequestEntity<Void> request = new RequestEntity<>(headers, HttpMethod.GET, URI.create(BASE_URL + path));
        ResponseEntity<String> response = restTemplate.exchange(request, String.class);
        return objectMapper.readTree(response.getBody());
    }

    private synchronized String token() {
        long now = System.currentTimeMillis() / 1000;
        if (cachedToken != null && now < cachedTokenExpiresAtEpochSeconds - 30) {
            return cachedToken;
        }
        long exp = now + TOKEN_TTL_SECONDS;
        cachedToken = Jwts.builder()
                .setHeaderParam("kid", keyId)
                .setHeaderParam("typ", "JWT")
                .setIssuer(issuerId)
                .setIssuedAt(new Date(now * 1000))
                .setExpiration(new Date(exp * 1000))
                .claim("aud", "appstoreconnect-v1")
                .signWith(privateKey, SignatureAlgorithm.ES256)
                .compact();
        cachedTokenExpiresAtEpochSeconds = exp;
        return cachedToken;
    }

    private static PrivateKey parsePrivateKey(String p8) {
        try {
            String cleaned = p8
                    .replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "")
                    .replaceAll("\\s", "");
            byte[] der = Base64.getDecoder().decode(cleaned);
            KeyFactory keyFactory = KeyFactory.getInstance("EC");
            return keyFactory.generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (Exception e) {
            log.warn("[AppStoreConnect] Could not parse a p8 value as an EC private key: {}", e.getMessage());
            return null;
        }
    }
}
