package vacademy.io.admin_core_service.features.app_status.service;

import com.fasterxml.jackson.databind.JsonNode;
import vacademy.io.admin_core_service.features.app_status.dto.AppStatusResponse;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Turns one raw app-registry record (community_service's jsonb payload, written by the health-check
 * dashboard) into the institute-facing {@link AppStatusResponse.RegisteredApp}.
 *
 * <p>Pure and static on purpose: this is the whole contract between what ops record and what an
 * institute admin reads, it has more edge cases than the endpoint around it, and every one of them
 * is a case where showing the wrong thing is worse than showing nothing — so it is tested directly
 * rather than through a Spring context.
 *
 * <p>Two rules run through all of it. Nothing is invented: a field the registry never recorded
 * comes back empty, never guessed. And nothing internal leaks: the registry's submission
 * {@code notes} are ops commentary about a client, so only the store's own cited {@code reason}
 * crosses this boundary.
 */
public final class AppStatusMapper {

    private AppStatusMapper() {
    }

    /**
     * The dashboard's Platform enum. Anything else in the payload is skipped rather than passed
     * through — the institute UI keys its icons and labels off exactly these four, and an unknown
     * key would reach it as an undefined lookup.
     */
    private static final Set<String> KNOWN_PLATFORMS = Set.of("ANDROID", "IOS", "WINDOWS", "MACOS");

    private static final String LIVE = "LIVE";
    private static final String REJECTED = "REJECTED";

    /** Statuses that end a build's life. Neither is an update on its way to the institute. */
    private static final Set<String> TERMINAL = Set.of("REMOVED", "SUSPENDED");

    public static AppStatusResponse.RegisteredApp toRegisteredApp(JsonNode record) {
        JsonNode basics = record.path("basics");

        List<AppStatusResponse.PlatformStatus> platforms = new ArrayList<>();
        JsonNode platformsNode = record.path("platforms");
        platformsNode.fieldNames().forEachRemaining(rawKey -> {
            String platformKey = rawKey == null ? "" : rawKey.toUpperCase(Locale.ROOT);
            if (!KNOWN_PLATFORMS.contains(platformKey)) {
                return;
            }
            JsonNode p = platformsNode.path(rawKey);
            // An institute admin only cares about platforms actually turned on for this app —
            // a disabled platform is registry bookkeeping, not something to show as "status".
            if (!p.path("enabled").asBoolean(false)) {
                return;
            }
            platforms.add(toPlatformStatus(record, platformKey, p));
        });

        return AppStatusResponse.RegisteredApp.builder()
                .id(text(record, "id"))
                .name(text(basics, "name"))
                .displayName(text(basics, "displayName"))
                .packageName(text(basics, "packageName"))
                .platforms(platforms)
                .build();
    }

    private static AppStatusResponse.PlatformStatus toPlatformStatus(
            JsonNode record, String platformKey, JsonNode config) {

        String status = textOr(config, "status", "NOT_REGISTERED");
        String currentVersion = text(config, "currentVersion");
        List<JsonNode> versions = versionsFor(record, platformKey);
        JsonNode newest = versions.isEmpty() ? null : versions.get(0);

        return AppStatusResponse.PlatformStatus.builder()
                .platform(platformKey)
                .enabled(true)
                .status(status)
                .appId(appId(record, config))
                .track(text(config.path("fields"), "release_track"))
                .storeUrl(text(config, "storeUrl"))
                .currentVersion(currentVersion)
                .currentBuild(text(config, "currentBuild"))
                .releasedAt(text(config, "releasedAt"))
                .lastSyncedAt(text(config, "lastSyncedAt"))
                .rejection(rejection(record, config, platformKey, status, versions, newest))
                .pendingUpdate(pendingUpdate(newest, status, currentVersion))
                .updateAvailable(updateAvailable(newest, currentVersion))
                .build();
    }

    /**
     * The store id this platform ships under. Every store names it differently and the catalogue
     * keeps that naming, so the field is looked up under each of them before falling back to the
     * record's own package name — which is the Android one, and wrong for iOS on most apps.
     */
    private static String appId(JsonNode record, JsonNode config) {
        JsonNode fields = config.path("fields");
        for (String key : new String[]{"bundle_id", "package_name", "package_identity", "application_id"}) {
            String value = text(fields, key);
            if (!value.isEmpty()) {
                return value;
            }
        }
        return text(record.path("basics"), "packageName");
    }

    /* --------------------------------------------------------------- rejection */

    private static AppStatusResponse.Rejection rejection(
            JsonNode record, JsonNode config, String platformKey, String platformStatus,
            List<JsonNode> versions, JsonNode newest) {

        boolean newestRejected = newest != null && REJECTED.equals(text(newest, "status"));
        // A rejection three releases ago that has since been approved is history. It only stays
        // worth showing while the platform itself is rejected, or the newest build we know of was.
        if (!REJECTED.equals(platformStatus) && !newestRejected) {
            return null;
        }

        JsonNode source = newestRejected ? newest : firstRejected(versions);
        if (source != null) {
            String reason = text(source, "rejectionReason");
            if (reason.isEmpty()) {
                // Ops sometimes log the store's wording on the submission row instead of the build.
                reason = reasonFromSubmissions(record, platformKey, text(source, "version"));
            }
            return AppStatusResponse.Rejection.builder()
                    .version(text(source, "version"))
                    .build(text(source, "build"))
                    .reason(reason)
                    .submittedAt(text(source, "submittedAt"))
                    .decidedAt(text(source, "reviewedAt"))
                    .build();
        }

        JsonNode submission = newestRejectedSubmission(record, platformKey);
        if (submission != null) {
            return AppStatusResponse.Rejection.builder()
                    .version(text(submission, "version"))
                    .build(text(submission, "build"))
                    .reason(text(submission, "reason"))
                    .submittedAt(text(submission, "submittedAt"))
                    .decidedAt(text(submission, "decidedAt"))
                    .build();
        }

        // Nothing in the hand-kept history, but the live store sync may have recorded one — it
        // writes what the store said onto the platform itself. Checked after the version and
        // submission rows because those are where a human pastes the store's actual wording, and
        // Apple and Google never hand us that text through an API.
        JsonNode synced = config.path("rejection");
        if (synced.isObject()) {
            return AppStatusResponse.Rejection.builder()
                    .version(text(synced, "version"))
                    .build(text(synced, "build"))
                    .reason(text(synced, "reason"))
                    .submittedAt(text(synced, "submittedAt"))
                    .decidedAt(text(synced, "decidedAt"))
                    .build();
        }

        // The platform is flagged rejected but nobody wrote down a build or a reason. Say so with
        // an empty rejection rather than returning null — "rejected, reason not recorded yet" is
        // the honest answer, and it is the one that makes an institute ask us the right question.
        return AppStatusResponse.Rejection.builder()
                .version("").build("").reason("").submittedAt("").decidedAt("")
                .build();
    }

    private static JsonNode firstRejected(List<JsonNode> versions) {
        for (JsonNode v : versions) {
            if (REJECTED.equals(text(v, "status"))) {
                return v;
            }
        }
        return null;
    }

    private static String reasonFromSubmissions(JsonNode record, String platformKey, String version) {
        for (JsonNode s : submissionsFor(record, platformKey)) {
            if (!REJECTED.equals(text(s, "status"))) {
                continue;
            }
            String reason = text(s, "reason");
            if (!reason.isEmpty() && (version.isEmpty() || version.equals(text(s, "version")))) {
                return reason;
            }
        }
        return "";
    }

    private static JsonNode newestRejectedSubmission(JsonNode record, String platformKey) {
        JsonNode best = null;
        for (JsonNode s : submissionsFor(record, platformKey)) {
            if (!REJECTED.equals(text(s, "status"))) {
                continue;
            }
            if (best == null || decidedKey(s).compareTo(decidedKey(best)) > 0) {
                best = s;
            }
        }
        return best;
    }

    private static String decidedKey(JsonNode submission) {
        String decided = text(submission, "decidedAt");
        return decided.isEmpty() ? text(submission, "submittedAt") : decided;
    }

    /* ----------------------------------------------------------- pending update */

    private static AppStatusResponse.PendingUpdate pendingUpdate(
            JsonNode newest, String platformStatus, String currentVersion) {

        if (newest == null) {
            return null;
        }
        String versionStatus = text(newest, "status");
        if (LIVE.equals(versionStatus) || TERMINAL.contains(versionStatus)) {
            return null;
        }
        // A live sync can move the platform on without anyone editing the build row it came from.
        // When the store is already serving this exact version, the row is stale, not pending.
        if (LIVE.equals(platformStatus)
                && !currentVersion.isEmpty()
                && currentVersion.equals(text(newest, "version"))) {
            return null;
        }

        return AppStatusResponse.PendingUpdate.builder()
                .version(text(newest, "version"))
                .build(text(newest, "build"))
                .status(versionStatus)
                .releaseNotes(text(newest, "releaseNotes"))
                .submittedAt(text(newest, "submittedAt"))
                .otaStatus(textOr(newest, "otaStatus", "NONE"))
                .build();
    }

    private static boolean updateAvailable(JsonNode newest, String currentVersion) {
        if (newest == null || currentVersion.isEmpty()) {
            return false;
        }
        String latest = text(newest, "version");
        return !latest.isEmpty() && compareVersions(latest, currentVersion) > 0;
    }

    /* ---------------------------------------------------------------- utilities */

    /**
     * Newest first, by version then by recorded time — the same order the health-check dashboard's
     * OTA / Build Check uses, so "latest build" means one thing on both screens.
     */
    private static List<JsonNode> versionsFor(JsonNode record, String platformKey) {
        List<JsonNode> out = nodesForPlatform(record.path("versions"), platformKey);
        out.sort(Comparator
                .comparing((JsonNode v) -> text(v, "version"), AppStatusMapper::compareVersions)
                .thenComparing((JsonNode v) -> text(v, "createdAt"))
                .reversed());
        return out;
    }

    private static List<JsonNode> submissionsFor(JsonNode record, String platformKey) {
        return nodesForPlatform(record.path("submissions"), platformKey);
    }

    private static List<JsonNode> nodesForPlatform(JsonNode array, String platformKey) {
        List<JsonNode> out = new ArrayList<>();
        if (!array.isArray()) {
            return out;
        }
        for (JsonNode node : array) {
            if (node != null && node.isObject()
                    && platformKey.equals(text(node, "platform").toUpperCase(Locale.ROOT))) {
                out.add(node);
            }
        }
        return out;
    }

    /**
     * Numeric-segment version comparison, mirroring {@code src/lib/version-compare.ts} in the
     * health-check dashboard — including its leniency: a segment that isn't a number counts as 0,
     * and a missing segment counts as 0, so "1.0" and "1.0.0" are the same version.
     */
    public static int compareVersions(String a, String b) {
        int[] pa = segments(a);
        int[] pb = segments(b);
        int length = Math.max(pa.length, pb.length);
        for (int i = 0; i < length; i++) {
            int x = i < pa.length ? pa[i] : 0;
            int y = i < pb.length ? pb[i] : 0;
            if (x != y) {
                return Integer.compare(x, y);
            }
        }
        return 0;
    }

    private static int[] segments(String version) {
        if (version == null || version.isBlank()) {
            return new int[0];
        }
        String[] raw = version.split("[.\\-+]");
        int[] out = new int[raw.length];
        for (int i = 0; i < raw.length; i++) {
            out[i] = leadingInt(raw[i]);
        }
        return out;
    }

    /** JavaScript's parseInt takes the leading digits and ignores the rest ("5rc" -> 5, "rc" -> 0). */
    private static int leadingInt(String segment) {
        int end = 0;
        while (end < segment.length() && Character.isDigit(segment.charAt(end))) {
            end++;
        }
        if (end == 0) {
            return 0;
        }
        try {
            return Integer.parseInt(segment.substring(0, end));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String text(JsonNode node, String field) {
        return textOr(node, field, "");
    }

    private static String textOr(JsonNode node, String field, String fallback) {
        if (node == null) {
            return fallback;
        }
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return fallback;
        }
        String asText = value.asText(fallback);
        return asText == null ? fallback : asText;
    }
}
