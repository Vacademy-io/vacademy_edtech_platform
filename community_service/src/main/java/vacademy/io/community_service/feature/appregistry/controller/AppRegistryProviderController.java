package vacademy.io.community_service.feature.appregistry.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.community_service.feature.appregistry.service.StoreStatusSyncService;

import java.util.Map;
import java.util.Set;

/**
 * Server-side half of the dashboard's StoreProvider abstraction.
 *
 * <p>This endpoint exists so the store credential never has to reach a browser: signing an App
 * Store Connect JWT or holding a Google service-account key client-side would expose the private
 * key to anyone with devtools.
 *
 * <p>All four platforms route through {@link StoreStatusSyncService}, which tries a credentialed
 * client first (resolved per institute — see {@code StoreCredentialResolver}) and then, for iOS
 * and Android only, the public store listing. When neither can answer — no credential and no
 * public listing, or the app record has no bundle/package/store id filled in, or
 * {@code getReviews} is requested (not implemented for any provider yet) — this answers
 * <b>501 Not Implemented</b> with a plain explanation. A dashboard that invents "Live" for a store
 * it can't actually reach is worse than one that says "go and look". The client renders that as
 * "Manual action required" and links to the right console.
 *
 * <p><b>Credentialed automation must use the official API and documented auth only</b> — Play
 * Developer API via a service account, App Store Connect via a JWT-signed .p8, Partner Center via
 * Azure AD. Never a scraped console session, a reused browser cookie, or an undocumented
 * privileged endpoint. The public-listing tier is not an exception to that rule: it holds no
 * credential, reads only the page any customer sees, and is therefore confined to public facts —
 * the published version, its date and its listing URL. See {@code PublicStoreListingClient} for
 * why it covers neither macOS nor Windows.
 */
@RestController
@RequestMapping("/community-service/super-admin/v1/app-registry/providers")
public class AppRegistryProviderController {

    private static final Map<String, String> CONSOLES = Map.of(
            "android", "https://play.google.com/console",
            "ios", "https://appstoreconnect.apple.com",
            "windows", "https://partner.microsoft.com/dashboard",
            "macos", "https://appstoreconnect.apple.com");

    /** Operations {@link StoreStatusSyncService#sync} can answer from one App Store Connect call. */
    private static final Set<String> LIVE_OPERATIONS = Set.of(
            "getAppStatus", "getLatestVersion", "getBuildStatus", "getReleaseStatus", "getSubmissionStatus");

    private final StoreStatusSyncService storeStatusSyncService;

    public AppRegistryProviderController(StoreStatusSyncService storeStatusSyncService) {
        this.storeStatusSyncService = storeStatusSyncService;
    }

    @GetMapping("/{platform}/{appId}/{operation}")
    public ResponseEntity<Map<String, Object>> operation(@RequestAttribute("user") CustomUserDetails user,
                                                         @PathVariable String platform,
                                                         @PathVariable String appId,
                                                         @PathVariable String operation) {
        SuperAdminAuthUtil.requireSuperAdmin(user);

        String platformKey = platform == null ? "" : platform.toLowerCase();
        String console = CONSOLES.get(platformKey);
        if (console == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "manual", false,
                    "message", "Unknown platform: " + platform));
        }

        if (LIVE_OPERATIONS.contains(operation)) {
            Map<String, Object> full = storeStatusSyncService.sync(appId, platform);
            if (full != null) {
                return ResponseEntity.ok(sliceFor(operation, full));
            }
        }

        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(Map.of(
                "manual", true,
                "operation", operation,
                "consoleUrl", console,
                "message", notConfiguredMessage(platformKey, operation)));
    }

    /**
     * Each provider operation is a different slice of the same App Store Connect lookup — one API
     * call already fetches everything {@code getAppStatus} needs, so the narrower operations just
     * pick out the fields the frontend's {@code ProviderResult<T>} type expects for that call
     * rather than re-fetching.
     */
    private static Map<String, Object> sliceFor(String operation, Map<String, Object> full) {
        return switch (operation) {
            case "getLatestVersion" -> Map.of("version", full.get("version"), "build", full.get("build"));
            case "getBuildStatus" -> Map.of("status", full.get("status"));
            case "getReleaseStatus" -> Map.of("status", full.get("status"), "releasedAt", full.get("releasedAt"));
            case "getSubmissionStatus" -> Map.of("status", full.get("status"));
            default -> full; // getAppStatus
        };
    }

    private static String notConfiguredMessage(String platformKey, String operation) {
        if ("getReviews".equals(operation)) {
            return "Review sync isn't implemented yet — check the store console directly.";
        }
        return switch (platformKey) {
            case "android" -> "Couldn't sync live status: no Play Developer credential is on file for this "
                    + "institute (add one via /store-credentials) AND the package has no public Play listing "
                    + "either — so the Package Name may be wrong, or the app isn't published. Check the store "
                    + "console and record the result in the dashboard.";
            case "windows" -> "Couldn't sync live status. Either no Partner Center credential is on file for "
                    + "this institute (add one via /store-credentials), the app's Store ID isn't filled in, or "
                    + "the account can't see this application — check the store console and record the result "
                    + "in the dashboard.";
            case "macos" -> "Couldn't sync live status. macOS needs a real App Store Connect credential — the "
                    + "public lookup keys on bundle id and hands back the iPhone app, which on a Mac row is just "
                    + "a wrong version number. Add a credential via /store-credentials, or record the result by "
                    + "hand from the console.";
            default -> "Couldn't sync live status: no App Store Connect credential can see this bundle AND it has "
                    + "no public App Store listing either — so the Bundle ID may be wrong, or the app isn't "
                    + "published yet. Check the store console and record the result in the dashboard.";
        };
    }
}
