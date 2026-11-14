package vacademy.io.community_service.feature.appregistry.build;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.community_service.feature.appregistry.service.AppRegistryService;
import vacademy.io.community_service.feature.appregistry.store.AppStoreConnectClient;
import vacademy.io.community_service.feature.appregistry.store.StoreCredentialResolver;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The dashboard's "iOS build": everything needed to go from an app registry record to a binary
 * in App Store Connect without a Mac on the operator's desk.
 *
 * <p>Reads only — the registry record is never written here. The dashboard saves records as
 * whole documents, so a server-side write would race the open editor (the store-sync trap). Run
 * history comes from GitHub Actions, the binary from App Store Connect, the plist from Firebase.
 */
@Slf4j
@Service
public class IosBuildService {

    static final String PBXPROJ = "frontend-learner-dashboard-app/ios/App/App.xcodeproj/project.pbxproj";
    private static final Pattern VERSION = Pattern.compile("^\\d+(\\.\\d+){0,2}$");
    private static final Pattern BUILD = Pattern.compile("^\\d{1,9}$");
    private static final Pattern BUNDLE = Pattern.compile("^[A-Za-z0-9.-]+$");
    private static final Pattern HOST = Pattern.compile("^[a-z0-9-]+\\.[a-z0-9.-]+$");
    private static final Pattern SAFE_DISPLAY = Pattern.compile("^[^\"\\\\<>&\\r\\n]{1,30}$");

    private final AppRegistryService registry;
    private final StoreCredentialResolver credentials;
    private final GitHubActionsClient github;
    private final FirebaseAppClient firebase;

    public IosBuildService(AppRegistryService registry, StoreCredentialResolver credentials,
                           GitHubActionsClient github, FirebaseAppClient firebase) {
        this.registry = registry;
        this.credentials = credentials;
        this.github = github;
        this.firebase = firebase;
    }

    /** What the record says about the iOS app, normalised. */
    record Brand(String bundleId, String host, String displayName, String targetName, String logoUrl,
                 String instituteId, String currentVersion) {
    }

    Brand brandOf(JsonNode record) {
        JsonNode ios = record.path("platforms").path("IOS");
        JsonNode fields = ios.path("fields");
        JsonNode basics = record.path("basics");
        String display = firstText(fields.path("app_name").asText(""), basics.path("displayName").asText(""),
                basics.path("name").asText(""));
        String host = fields.path("app_domain").asText("").trim().toLowerCase()
                .replaceFirst("^https?://", "").replaceFirst("/.*$", "");
        return new Brand(fields.path("bundle_id").asText("").trim(), host, display.trim(), targetNameFor(display),
                logoUrlOf(record), basics.path("instituteId").asText(null), ios.path("currentVersion").asText(""));
    }

    /** Xcode target names are created from the display name: letters, digits and single spaces. */
    static String targetNameFor(String display) {
        return display.replaceAll("[^A-Za-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    /** The 1024 iOS icon from Images & Assets, else the first uploaded source image. */
    static String logoUrlOf(JsonNode record) {
        for (JsonNode asset : record.path("assets")) {
            if ("ios_app_icon".equals(asset.path("specId").asText("")) && StringUtils.hasText(asset.path("url").asText(""))) {
                return asset.path("url").asText();
            }
        }
        JsonNode sources = record.path("sourceImages");
        return sources.isArray() && !sources.isEmpty() ? sources.get(0).path("url").asText("") : "";
    }

    public Map<String, Object> status(String appId) {
        JsonNode record = registry.get(appId);
        Brand brand = brandOf(record);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("bundleId", brand.bundleId());
        out.put("appHost", brand.host());
        out.put("displayName", brand.displayName());
        out.put("targetName", brand.targetName());
        out.put("logoUrl", brand.logoUrl());
        out.put("currentVersion", brand.currentVersion());
        out.put("workflowUrl", github.workflowUrl());

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("github", github.isConfigured());
        config.put("firebase", firebase.isConfigured());
        out.put("serverConfig", config);

        // Firebase
        Map<String, Object> fb = new LinkedHashMap<>();
        fb.put("project", firebase.project());
        if (firebase.isConfigured() && StringUtils.hasText(brand.bundleId())) {
            try {
                FirebaseAppClient.IosApp app = firebase.findIosApp(brand.bundleId());
                fb.put("registered", app != null);
                if (app != null) fb.put("appId", app.appId());
            } catch (Exception e) {
                fb.put("error", "Firebase lookup failed: " + e.getMessage());
            }
        }
        out.put("firebase", fb);

        // App Store Connect
        Map<String, Object> asc = new LinkedHashMap<>();
        AppStoreConnectClient client = null;
        try {
            client = credentials.resolveAppStoreConnect(brand.instituteId(), "IOS");
        } catch (Exception e) {
            // e.g. store_credential table not deployed: report it, keep the rest of the panel working
            asc.put("error", "Could not resolve the App Store Connect credential: " + e.getMessage());
        }
        asc.put("configured", client != null);
        if (client != null && StringUtils.hasText(brand.bundleId())) {
            try {
                String ascAppId = client.findAppId(brand.bundleId());
                asc.put("appId", ascAppId);
                if (ascAppId != null) {
                    List<AppStoreConnectClient.BuildInfo> builds = client.fetchRecentBuilds(ascAppId, 20);
                    asc.put("builds", builds.subList(0, Math.min(6, builds.size())));
                    asc.put("nextBuildNumber", nextBuildNumber(builds));
                    asc.put("consoleUrl", "https://appstoreconnect.apple.com/apps/" + ascAppId + "/distribution");
                }
            } catch (Exception e) {
                asc.put("error", "App Store Connect lookup failed: " + e.getMessage());
            }
        }
        out.put("appStoreConnect", asc);

        // Repository + runs
        Map<String, Object> repo = new LinkedHashMap<>();
        if (StringUtils.hasText(brand.bundleId())) {
            try {
                repo.put("targetOnMain", targetOnMain(brand.bundleId()));
                GitHubActionsClient.PullRequest pr = github.findTargetPr(brand.bundleId());
                if (pr != null) repo.put("pr", pr);
            } catch (Exception e) {
                repo.put("error", "GitHub lookup failed: " + e.getMessage());
            }
        }
        out.put("repo", repo);

        List<Map<String, Object>> runs = new ArrayList<>();
        try {
            List<GitHubActionsClient.Run> list = github.listRuns(appId, 8);
            for (int i = 0; i < list.size(); i++) {
                GitHubActionsClient.Run run = list.get(i);
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("run", run);
                // Steps only for the newest run (one extra call), or for any run still going.
                if (i == 0 || run.active()) {
                    row.put("steps", github.steps(run.id()));
                }
                runs.add(row);
            }
        } catch (Exception e) {
            out.put("runsError", "Could not read build runs: " + e.getMessage());
        }
        out.put("runs", runs);
        return out;
    }

    static int nextBuildNumber(List<AppStoreConnectClient.BuildInfo> builds) {
        long max = 0;
        for (AppStoreConnectClient.BuildInfo b : builds) {
            try {
                max = Math.max(max, Long.parseLong(b.version().trim()));
            } catch (NumberFormatException ignored) {
                // dotted build numbers ("1.0.3") are never produced by this pipeline
            }
        }
        return (int) max + 1;
    }

    private boolean targetOnMain(String bundleId) throws Exception {
        return github.fileContains(PBXPROJ, "PRODUCT_BUNDLE_IDENTIFIER = " + bundleId + ";");
    }

    public Map<String, Object> start(String appId, String version, String buildNumber) {
        if (!github.isConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Builds are not set up on the server yet (APP_BUILD_GITHUB_TOKEN is missing).");
        }
        JsonNode record = registry.get(appId);
        Brand brand = brandOf(record);
        List<String> missing = new ArrayList<>();
        if (!BUNDLE.matcher(brand.bundleId()).matches()) missing.add("iOS Bundle ID (Registration tab)");
        if (!HOST.matcher(brand.host()).matches()) missing.add("iOS App Domain, e.g. student.example.com (Registration tab)");
        if (brand.targetName().isEmpty()) missing.add("App Name");
        if (version == null || !VERSION.matcher(version.trim()).matches()) missing.add("a version like 1.0.0");
        if (buildNumber == null || !BUILD.matcher(buildNumber.trim()).matches()) missing.add("a whole-number build number");
        if (!missing.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Fill in first: " + String.join(", ", missing));
        }

        try {
            for (GitHubActionsClient.Run run : github.listRuns(appId, 5)) {
                if (run.active()) {
                    throw new VacademyException(HttpStatus.CONFLICT, "A build for this app is already running.");
                }
            }
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            log.warn("[IosBuild] could not check running builds for {}: {}", appId, e.getMessage());
        }

        Map<String, String> inputs = new LinkedHashMap<>();
        String requestId = UUID.randomUUID().toString().substring(0, 8);
        inputs.put("request_id", requestId);
        inputs.put("registry_app_id", appId);
        inputs.put("bundle_id", brand.bundleId());
        inputs.put("display_name", brand.displayName());
        inputs.put("app_host", brand.host());
        inputs.put("version", version.trim());
        inputs.put("build_number", buildNumber.trim());

        boolean onMain;
        try {
            onMain = targetOnMain(brand.bundleId());
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "Could not read the repository: " + e.getMessage());
        }
        if (!onMain) {
            // First build of a new app: the runner creates the Xcode target and opens a PR, and needs
            // the icon and this app's own Firebase plist to do it.
            if (!SAFE_DISPLAY.matcher(brand.displayName()).matches()) {
                // register-ios-app.sh pastes the name into flavor.config.ts and the plist XML as-is.
                throw new VacademyException(HttpStatus.BAD_REQUEST,
                        "App Name may not contain \" \\ < > & or line breaks — it is written into the app's config files.");
            }
            if (!StringUtils.hasText(brand.logoUrl())) {
                throw new VacademyException(HttpStatus.BAD_REQUEST,
                        "This app has no Xcode target yet, so the first build creates one — upload the 1024×1024 iOS icon in Images & Assets first.");
            }
            String plist;
            try {
                FirebaseAppClient.IosApp app = firebase.isConfigured() ? firebase.findIosApp(brand.bundleId()) : null;
                if (app == null) {
                    throw new VacademyException(HttpStatus.BAD_REQUEST,
                            "This app has no Xcode target yet and no Firebase iOS app — press \"Create Firebase app\" first.");
                }
                plist = firebase.configPlistBase64(app.appId());
            } catch (VacademyException e) {
                throw e;
            } catch (Exception e) {
                throw new VacademyException(HttpStatus.BAD_GATEWAY, "Could not read the Firebase config: " + e.getMessage());
            }
            inputs.put("new_target_name", brand.targetName());
            inputs.put("logo_url", brand.logoUrl());
            inputs.put("firebase_plist_b64", plist);
        }

        GitHubActionsClient.Dispatch dispatch;
        try {
            dispatch = github.dispatch(inputs);
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "GitHub refused to start the build: " + e.getMessage());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("requestId", requestId);
        out.put("createsTarget", !onMain);
        out.put("runId", dispatch.runId());
        out.put("runUrl", dispatch.htmlUrl());
        return out;
    }

    public Map<String, Object> createFirebaseApp(String appId) {
        if (!firebase.isConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Firebase is not set up on the server yet (FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is missing).");
        }
        Brand brand = brandOf(registry.get(appId));
        if (!BUNDLE.matcher(brand.bundleId()).matches()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Fill in the iOS Bundle ID first (Registration tab).");
        }
        try {
            FirebaseAppClient.IosApp app = firebase.findIosApp(brand.bundleId());
            boolean created = false;
            if (app == null) {
                app = firebase.createIosApp(brand.bundleId(), brand.displayName());
                created = true;
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("created", created);
            out.put("pending", app == null);
            out.put("appId", app == null ? null : app.appId());
            out.put("project", firebase.project());
            return out;
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "Firebase: " + e.getMessage());
        }
    }

    private static String firstText(String... values) {
        for (String v : values) {
            if (StringUtils.hasText(v)) return v;
        }
        return "";
    }
}
