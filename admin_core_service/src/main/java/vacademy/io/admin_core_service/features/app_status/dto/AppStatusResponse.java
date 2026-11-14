package vacademy.io.admin_core_service.features.app_status.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * Read-only view of an institute's registered white-label apps and their per-platform store
 * status — returned by GET /admin-core-service/institute/app-registry/v1/status.
 *
 * <p>Registration itself (uploading icons, filling in store metadata, linking bundle/package
 * ids) stays an ops-only workflow in the health-check dashboard's App Registration module —
 * this endpoint is deliberately read-only so an institute admin can see where their app stands
 * without being able to edit a record that belongs to the platform team.
 *
 * <p>Beyond the current status it answers the two questions an institute actually asks when the
 * status is not a plain "Live": <em>why was it rejected</em> ({@link Rejection}) and <em>where is
 * the update we were promised</em> ({@link PendingUpdate}). Both are derived from the registry's
 * version/submission history rather than stored separately, so they cannot drift from what ops
 * sees in health-check.
 */
@Data
@Builder
public class AppStatusResponse {

    @JsonProperty("institute_id")
    private String instituteId;

    @JsonProperty("apps")
    private List<RegisteredApp> apps;

    @Data
    @Builder
    public static class RegisteredApp {
        @JsonProperty("id")
        private String id;

        @JsonProperty("name")
        private String name;

        @JsonProperty("display_name")
        private String displayName;

        @JsonProperty("package_name")
        private String packageName;

        @JsonProperty("platforms")
        private List<PlatformStatus> platforms;
    }

    @Data
    @Builder
    public static class PlatformStatus {
        /** ANDROID / IOS / WINDOWS / MACOS — matches the health-check dashboard's Platform enum. */
        @JsonProperty("platform")
        private String platform;

        @JsonProperty("enabled")
        private boolean enabled;

        /** One of the health-check dashboard's StoreStatus values (e.g. LIVE, IN_REVIEW, REJECTED). */
        @JsonProperty("status")
        private String status;

        /**
         * The store id this platform actually ships under — the Play package name, the Apple bundle
         * id, the Windows package identity. Worth showing next to the status because they differ
         * per platform (com.hcca.app on Play, io.hcca.app on the App Store), and because it is the
         * key everything else about the app — OTA targeting included — is keyed on.
         */
        @JsonProperty("app_id")
        private String appId;

        /**
         * Which store track the current build sits on, verbatim from the registry's
         * {@code release_track} field: "Closed testing", "TestFlight — external testers",
         * "Production"… Empty when ops has not recorded one.
         *
         * <p>Without it "Live" is ambiguous: an Android build live on the closed-testing track is
         * installable by twelve named testers and by nobody else, which is not what an institute
         * reads into that word.
         */
        @JsonProperty("track")
        private String track;

        @JsonProperty("store_url")
        private String storeUrl;

        @JsonProperty("current_version")
        private String currentVersion;

        @JsonProperty("current_build")
        private String currentBuild;

        @JsonProperty("released_at")
        private String releasedAt;

        @JsonProperty("last_synced_at")
        private String lastSyncedAt;

        /**
         * Set only while a rejection is worth acting on — the platform is currently rejected, or
         * the newest build recorded for it was. A rejection that has since been superseded by an
         * approved build is history, and showing it would just alarm the institute for nothing.
         */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        @JsonProperty("rejection")
        private Rejection rejection;

        /**
         * The newest build recorded for this platform that the store is not yet serving — the
         * update in flight. Null once the newest recorded build is the live one.
         */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        @JsonProperty("pending_update")
        private PendingUpdate pendingUpdate;

        /**
         * True when a strictly newer version exists than the one live on the store. Mirrors the
         * health-check dashboard's OTA / Build Check column so ops and the institute never read
         * two different answers off the same data.
         */
        @JsonProperty("update_available")
        private boolean updateAvailable;

        /**
         * The OTA bundle this app is being served right now. Unlike everything else here it is not
         * registry bookkeeping — it is read live from {@code ota_bundle_version}, so it says what
         * the installed app actually runs rather than what anyone wrote down.
         */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        @JsonProperty("ota")
        private OtaBundle ota;
    }

    /**
     * The over-the-air JavaScript bundle an installed app pulls on launch. The store version is
     * only the shell; this is the code inside it, and the two move independently — an app can sit
     * on store version 1.0.4 for months while its bundle ships weekly.
     */
    @Data
    @Builder
    public static class OtaBundle {
        @JsonProperty("version")
        private String version;

        /** When the bundle was published, not when the store released the shell around it. */
        @JsonProperty("published_at")
        private String publishedAt;

        @JsonProperty("release_notes")
        private String releaseNotes;

        /**
         * Installs on a native version below this floor never receive the bundle — so a low
         * store version and a high floor together mean "published, but not to these users".
         */
        @JsonProperty("min_native_version")
        private String minNativeVersion;

        @JsonProperty("force_update")
        private boolean forceUpdate;

        /**
         * True when the bundle serving this app targets no app in particular. It is still a real
         * answer to "what is my app running", but a shared bundle is rarely what a white-label app
         * is meant to be on, so the reader is told.
         */
        @JsonProperty("shared_bundle")
        private boolean sharedBundle;
    }

    /**
     * Why the store refused a build. Only the store's own cited reason is exposed — the registry's
     * internal {@code notes} field is ops commentary and deliberately stays on our side.
     */
    @Data
    @Builder
    public static class Rejection {
        @JsonProperty("version")
        private String version;

        @JsonProperty("build")
        private String build;

        /** The store's cited reason, as recorded by ops. Empty when the status is known but the reason was never written down. */
        @JsonProperty("reason")
        private String reason;

        @JsonProperty("submitted_at")
        private String submittedAt;

        @JsonProperty("decided_at")
        private String decidedAt;
    }

    /** A build that has been recorded but is not yet what the store serves. */
    @Data
    @Builder
    public static class PendingUpdate {
        @JsonProperty("version")
        private String version;

        @JsonProperty("build")
        private String build;

        /** Where that build currently stands — SUBMITTED, IN_REVIEW, APPROVED, BUILD_PROCESSING, REJECTED… */
        @JsonProperty("status")
        private String status;

        @JsonProperty("release_notes")
        private String releaseNotes;

        @JsonProperty("submitted_at")
        private String submittedAt;

        /** AVAILABLE / PENDING / NONE / FAILED — the Capacitor OTA bundle, when one is tracked. */
        @JsonProperty("ota_status")
        private String otaStatus;
    }
}
