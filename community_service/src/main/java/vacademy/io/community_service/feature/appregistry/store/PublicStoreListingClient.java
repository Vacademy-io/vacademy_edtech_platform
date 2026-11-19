package vacademy.io.community_service.feature.appregistry.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.Instant;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The credential-free tier of store status: what the public sees on the store page.
 *
 * <p><b>Why this exists.</b> Every other client here needs a developer credential, and
 * {@code store_credential} carries none for Google Play at all — so "Check Status" answered
 * "manual action required" for every Android app and for every iOS app outside the one Apple team
 * whose key sits in the env vars. That is a sync button that never syncs.
 *
 * <p><b>What it is allowed to be.</b> This reads the same public listing any customer sees:
 * Apple's public iTunes Lookup endpoint, and the public Play store page. It never touches a
 * console, never reuses a browser session, and holds no credential — so it can only ever report
 * public facts: the published version, when the listing was last updated, its public URL, and the
 * fact that a listing is publicly visible at all. It cannot see drafts, submissions, review state
 * or rejections; those stay with the credentialed clients, which remain the authority whenever one
 * is configured (see {@code StoreStatusSyncService}).
 *
 * <p><b>Two things it deliberately refuses to do.</b>
 * <ul>
 *   <li><b>macOS.</b> Apple's lookup keys on bundle id and ignores the {@code entity} filter for a
 *       bundle that ships both — verified live: {@code io.shikshanationapp.com} returns
 *       {@code kind=software} v1.0.2 for {@code entity=macSoftware} too. Reporting that on a Mac
 *       App Store row is the same defect as a missing {@code filter[platform]}, so Mac (and
 *       Windows, which has no public equivalent) simply are not covered here.</li>
 *   <li><b>Turning a miss into "not registered".</b> A lookup finds nothing when the app is
 *       unpublished, when the storefront doesn't carry it, <i>or</i> when the id in our record is
 *       wrong. All three return null, which the caller treats as "not synced" — never as proof
 *       that no app exists.</li>
 * </ul>
 *
 * <p>The Play page's version lives in an undocumented numeric-keyed blob, so parsing can break
 * whenever Google reshapes that page. That is why a parse failure returns null and logs rather
 * than throwing: the row keeps whatever it had, and the worst case is the status going stale, not
 * wrong.
 */
@Component
@Slf4j
public class PublicStoreListingClient {

    private static final String APPLE_LOOKUP = "https://itunes.apple.com/lookup";
    private static final String PLAY_LISTING = "https://play.google.com/store/apps/details";

    /**
     * Storefronts to ask, in order. An app published only in India is invisible to the default US
     * storefront, and most of these brands are India-first.
     */
    private static final List<String> STOREFRONTS = List.of("IN", "US");

    /** Only an iPhone/iPad app answers for an IOS row; {@code mac-software} must not. */
    private static final String IOS_KIND = "software";

    /**
     * The Play listing page carries its data as a numeric-keyed JSON blob: 141 holds the version
     * string, 146 the "Updated on" date followed by its epoch seconds.
     */
    private static final Pattern PLAY_VERSION = Pattern.compile("\"141\":\\[\\[\\[\"([^\"]{1,40})\"]]");
    private static final Pattern PLAY_UPDATED = Pattern.compile("\"146\":\\[\\[\"[^\"]{4,40}\",\\[(\\d{9,12})");

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public PublicStoreListingClient() {
        this(defaultRestTemplate());
    }

    /** Test seam — the parsing is the part worth pinning, not the HTTP. */
    PublicStoreListingClient(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * A public store listing. {@code version} is what the store is serving right now; there is no
     * build number in either public source, and no review state — by construction.
     */
    public record Listing(String version, String releasedAt, String storeUrl, String name) {
    }

    /**
     * @param bundleId the iOS bundle id from the app record.
     * @return the public App Store listing, or null when no storefront carries it, the lookup
     *         fails, or the bundle resolves to something that is not an iOS app.
     */
    public Listing lookupAppStore(String bundleId) {
        if (!StringUtils.hasText(bundleId)) {
            return null;
        }
        for (String storefront : STOREFRONTS) {
            String url = UriComponentsBuilder.fromHttpUrl(APPLE_LOOKUP)
                    .queryParam("bundleId", bundleId)
                    .queryParam("country", storefront)
                    .queryParam("entity", "software")
                    .toUriString();
            try {
                String body = restTemplate.getForObject(url, String.class);
                Listing listing = parseAppleLookup(body);
                if (listing != null) {
                    return listing;
                }
            } catch (Exception e) {
                log.info("[PublicStoreListing] App Store lookup for {} in {} failed: {}",
                        bundleId, storefront, shortReason(e));
            }
        }
        return null;
    }

    /**
     * @param packageName the Android package name from the app record.
     * @return the public Play listing, or null when Play has no page for it (404) or the page no
     *         longer parses.
     */
    public Listing lookupPlayStore(String packageName) {
        if (!StringUtils.hasText(packageName)) {
            return null;
        }
        String url = UriComponentsBuilder.fromHttpUrl(PLAY_LISTING)
                .queryParam("id", packageName)
                .queryParam("hl", "en")
                .queryParam("gl", "IN")
                .toUriString();
        String body;
        try {
            body = restTemplate.getForObject(url, String.class);
        } catch (Exception e) {
            // A 404 here is the normal "this package has no public listing" answer, not a fault.
            log.info("[PublicStoreListing] Play listing for {} not readable: {}", packageName, shortReason(e));
            return null;
        }
        return parsePlayListing(body, packageName);
    }

    /* ------------------------------------------------------------------ parsing */

    Listing parseAppleLookup(String body) {
        if (!StringUtils.hasText(body)) {
            return null;
        }
        try {
            JsonNode results = objectMapper.readTree(body).path("results");
            if (!results.isArray() || results.isEmpty()) {
                return null;
            }
            JsonNode app = results.get(0);
            if (!IOS_KIND.equals(app.path("kind").asText(""))) {
                return null;
            }
            String version = app.path("version").asText("");
            if (version.isBlank()) {
                return null;
            }
            return new Listing(
                    version,
                    app.path("currentVersionReleaseDate").asText(""),
                    app.path("trackViewUrl").asText(""),
                    app.path("trackName").asText(""));
        } catch (Exception e) {
            log.info("[PublicStoreListing] App Store lookup response did not parse: {}", e.getMessage());
            return null;
        }
    }

    Listing parsePlayListing(String body, String packageName) {
        if (!StringUtils.hasText(body)) {
            return null;
        }
        Matcher version = PLAY_VERSION.matcher(body);
        if (!version.find()) {
            // Either Google reshaped the page or this package has no published release. Both mean
            // "we learned nothing", which must never be written back as a status.
            log.info("[PublicStoreListing] No version found on the Play listing for {} — page shape may have "
                    + "changed, leaving the recorded status untouched", packageName);
            return null;
        }
        Matcher updated = PLAY_UPDATED.matcher(body);
        String releasedAt = "";
        if (updated.find()) {
            try {
                releasedAt = Instant.ofEpochSecond(Long.parseLong(updated.group(1))).toString();
            } catch (NumberFormatException ignored) {
                // A missing date is not worth losing the version over.
            }
        }
        return new Listing(
                version.group(1),
                releasedAt,
                "https://play.google.com/store/apps/details?id=" + packageName,
                "");
    }

    /**
     * A failed store call carries its whole response body in {@code getMessage()} — for Play that
     * is an entire HTML error page, which would land in the logs verbatim on every miss.
     */
    private static String shortReason(Exception e) {
        if (e instanceof HttpStatusCodeException http) {
            return "HTTP " + http.getStatusCode().value();
        }
        String message = e.getMessage();
        if (message == null) {
            return e.getClass().getSimpleName();
        }
        return message.length() > 120 ? message.substring(0, 120) + "…" : message;
    }

    /**
     * Both endpoints are third-party and one of them returns a megabyte of HTML, so neither may be
     * allowed to hang a scheduled sweep on a socket with no timeout.
     */
    private static RestTemplate defaultRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(15_000);
        return new RestTemplate(factory);
    }
}
