package vacademy.io.admin_core_service.features.app_status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import vacademy.io.admin_core_service.features.app_status.dto.AppStatusResponse;
import vacademy.io.admin_core_service.features.app_status.service.AppStatusMapper;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The whole contract between what ops record in the health-check dashboard and what an institute
 * admin reads on Settings → App Status.
 *
 * <p>The payload is free-form jsonb written by another repo, so most of these cases are about what
 * the record does NOT contain: a platform nobody enabled, a rejection nobody wrote a reason for, a
 * build row left stale after a live store sync moved on without it. Every one of them is a case
 * where showing the wrong thing is worse than showing nothing.
 */
class AppStatusMapperTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode record(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("bad test fixture", e);
        }
    }

    /** An Android-only app whose store is serving 2.4.5 (245), with the history each case needs. */
    private static JsonNode android(String platformStatus, String versions, String submissions) {
        return record("{"
                + "\"id\":\"app-1\","
                + "\"basics\":{\"name\":\"Shiksha Nation\",\"displayName\":\"Shiksha Nation\","
                + "\"packageName\":\"com.vacademy.sn\",\"instituteId\":\"inst-1\"},"
                + "\"platforms\":{\"ANDROID\":{\"enabled\":true,"
                + "\"status\":\"" + platformStatus + "\","
                + "\"currentVersion\":\"2.4.5\",\"currentBuild\":\"245\","
                + "\"storeUrl\":\"https://play.google.com/store/apps/details?id=com.vacademy.sn\"}},"
                + "\"versions\":" + versions + ","
                + "\"submissions\":" + submissions
                + "}");
    }

    private static AppStatusResponse.PlatformStatus onlyPlatform(JsonNode record) {
        List<AppStatusResponse.PlatformStatus> platforms =
                AppStatusMapper.toRegisteredApp(record).getPlatforms();
        assertEquals(1, platforms.size(), "fixture should expose exactly one platform");
        return platforms.get(0);
    }

    @Nested
    @DisplayName("a rejection the live sync recorded")
    class SyncedRejection {

        private static AppStatusResponse.PlatformStatus platformWith(String rejectionJson, String history) {
            return AppStatusMapper.toRegisteredApp(record("{"
                    + "\"id\":\"app-1\",\"basics\":{\"packageName\":\"com.x.app\"},"
                    + "\"platforms\":{\"ANDROID\":{\"enabled\":true,\"status\":\"REJECTED\""
                    + (rejectionJson.isEmpty() ? "" : ",\"rejection\":" + rejectionJson)
                    + "}},"
                    + "\"versions\":" + history + ",\"submissions\":[]}"))
                    .getPlatforms().get(0);
        }

        @Test
        @DisplayName("the store's own reason reaches the institute")
        void syncedReasonIsShown() {
            AppStatusResponse.Rejection rejection = platformWith(
                    "{\"version\":\"1.0.4\",\"reason\":\"Package validation failed: missing capability\","
                            + "\"submittedAt\":\"2026-08-20\",\"decidedAt\":\"2026-08-22\"}",
                    "[]").getRejection();

            assertNotNull(rejection);
            assertEquals("Package validation failed: missing capability", rejection.getReason());
            assertEquals("1.0.4", rejection.getVersion());
            assertEquals("2026-08-20", rejection.getSubmittedAt());
        }

        @Test
        @DisplayName("a rejection with no reason still says the app was rejected, and when")
        void syncedRejectionWithoutReason() {
            // Apple's case: the API gives the state and the date, never the review's message.
            AppStatusResponse.Rejection rejection = platformWith(
                    "{\"version\":\"1.0.5\",\"reason\":\"\",\"submittedAt\":\"2026-05-31\",\"decidedAt\":\"\"}",
                    "[]").getRejection();

            assertNotNull(rejection);
            assertEquals("", rejection.getReason());
            assertEquals("1.0.5", rejection.getVersion());
            assertEquals("2026-05-31", rejection.getSubmittedAt());
        }

        @Test
        @DisplayName("a reason someone typed against the build wins over the bare synced one")
        void handWrittenReasonWins() {
            AppStatusResponse.Rejection rejection = platformWith(
                    "{\"version\":\"1.0.5\",\"reason\":\"\",\"submittedAt\":\"2026-05-31\",\"decidedAt\":\"\"}",
                    "[{\"platform\":\"ANDROID\",\"version\":\"1.0.5\",\"status\":\"REJECTED\","
                            + "\"rejectionReason\":\"Guideline 5.1.1 — account deletion missing\","
                            + "\"createdAt\":\"2026-05-31\"}]").getRejection();

            assertEquals("Guideline 5.1.1 — account deletion missing", rejection.getReason());
        }

        @Test
        @DisplayName("with nothing recorded anywhere it still says rejected, reason unknown")
        void noSourceAtAll() {
            AppStatusResponse.Rejection rejection = platformWith("", "[]").getRejection();

            assertNotNull(rejection);
            assertEquals("", rejection.getReason());
            assertEquals("", rejection.getVersion());
        }
    }

    @Nested
    @DisplayName("store id and release track")
    class AppIdAndTrack {

        private static AppStatusResponse.PlatformStatus platformOf(String platform, String fields) {
            JsonNode record = record("{"
                    + "\"id\":\"app-1\",\"basics\":{\"packageName\":\"com.hcca.app\"},"
                    + "\"platforms\":{\"" + platform + "\":{\"enabled\":true,\"status\":\"LIVE\""
                    + (fields.isEmpty() ? "" : ",\"fields\":" + fields)
                    + "}}}");
            List<AppStatusResponse.PlatformStatus> platforms =
                    AppStatusMapper.toRegisteredApp(record).getPlatforms();
            assertEquals(1, platforms.size());
            return platforms.get(0);
        }

        @Test
        @DisplayName("iOS reports its own bundle id, not the record's Android package name")
        void iosUsesBundleId() {
            assertEquals("io.hcca.app",
                    platformOf("IOS", "{\"bundle_id\":\"io.hcca.app\"}").getAppId());
        }

        @Test
        @DisplayName("Android reports its package name")
        void androidUsesPackageName() {
            assertEquals("com.hcca.app",
                    platformOf("ANDROID", "{\"package_name\":\"com.hcca.app\"}").getAppId());
        }

        @Test
        @DisplayName("Windows reports its package identity")
        void windowsUsesPackageIdentity() {
            assertEquals("12345Vidyayatan.HCCA",
                    platformOf("WINDOWS", "{\"package_identity\":\"12345Vidyayatan.HCCA\"}").getAppId());
        }

        @Test
        @DisplayName("a platform with no id of its own falls back to the record's package name")
        void fallsBackToBasics() {
            assertEquals("com.hcca.app", platformOf("ANDROID", "").getAppId());
        }

        @Test
        @DisplayName("the release track comes through verbatim — the catalogue owns the wording")
        void trackPassesThrough() {
            assertEquals("Closed testing",
                    platformOf("ANDROID", "{\"release_track\":\"Closed testing\"}").getTrack());
        }

        @Test
        @DisplayName("a track nobody recorded is empty, never guessed from the status")
        void trackNotRecorded() {
            assertEquals("", platformOf("ANDROID", "{\"package_name\":\"com.hcca.app\"}").getTrack());
        }

        @Test
        @DisplayName("a record written before platforms had fields at all still maps")
        void legacyRecordWithoutFields() {
            AppStatusResponse.PlatformStatus platform = platformOf("ANDROID", "");
            assertEquals("", platform.getTrack());
            assertEquals("com.hcca.app", platform.getAppId());
        }
    }

    @Nested
    @DisplayName("which platforms are shown at all")
    class PlatformSelection {

        @Test
        @DisplayName("a platform nobody turned on is registry bookkeeping, not a status")
        void disabledPlatformIsSkipped() {
            JsonNode rec = record("{\"basics\":{},\"platforms\":{"
                    + "\"ANDROID\":{\"enabled\":true,\"status\":\"LIVE\"},"
                    + "\"IOS\":{\"enabled\":false,\"status\":\"DRAFT\"},"
                    + "\"WINDOWS\":{\"status\":\"DRAFT\"}}}");

            List<AppStatusResponse.PlatformStatus> platforms =
                    AppStatusMapper.toRegisteredApp(rec).getPlatforms();

            assertEquals(1, platforms.size());
            assertEquals("ANDROID", platforms.get(0).getPlatform());
        }

        @Test
        @DisplayName("a platform key the UI has no icon for is dropped, not passed through")
        void unknownPlatformKeyIsDropped() {
            JsonNode rec = record("{\"basics\":{},\"platforms\":{"
                    + "\"LINUX\":{\"enabled\":true,\"status\":\"LIVE\"},"
                    + "\"IOS\":{\"enabled\":true,\"status\":\"LIVE\"}}}");

            List<AppStatusResponse.PlatformStatus> platforms =
                    AppStatusMapper.toRegisteredApp(rec).getPlatforms();

            assertEquals(1, platforms.size());
            assertEquals("IOS", platforms.get(0).getPlatform());
        }

        @Test
        @DisplayName("a lower-cased key is the same platform, and reaches the UI upper-cased")
        void lowercasePlatformKeyIsNormalised() {
            JsonNode rec = record("{\"basics\":{},\"platforms\":{"
                    + "\"android\":{\"enabled\":true,\"status\":\"LIVE\",\"currentVersion\":\"1.0.0\"}},"
                    + "\"versions\":[{\"platform\":\"android\",\"version\":\"1.1.0\","
                    + "\"status\":\"IN_REVIEW\",\"createdAt\":\"2026-08-01T00:00:00Z\"}]}");

            AppStatusResponse.PlatformStatus p = onlyPlatform(rec);

            assertEquals("ANDROID", p.getPlatform());
            // and the version rows, which spell it the same way, still match up
            assertNotNull(p.getPendingUpdate());
            assertEquals("1.1.0", p.getPendingUpdate().getVersion());
        }

        @Test
        @DisplayName("a record with no platforms node at all is an app with nothing to show")
        void missingPlatformsNode() {
            AppStatusResponse.RegisteredApp app =
                    AppStatusMapper.toRegisteredApp(record("{\"id\":\"a\",\"basics\":{\"name\":\"X\"}}"));

            assertEquals("X", app.getName());
            assertTrue(app.getPlatforms().isEmpty());
        }

        @Test
        @DisplayName("fields the registry never recorded come back empty, never null")
        void missingBasicsAreEmptyStrings() {
            AppStatusResponse.RegisteredApp app = AppStatusMapper.toRegisteredApp(record("{}"));

            assertEquals("", app.getId());
            assertEquals("", app.getName());
            assertEquals("", app.getDisplayName());
            assertEquals("", app.getPackageName());
        }

        @Test
        @DisplayName("an explicit JSON null reads the same as an absent field")
        void explicitNullsDoNotBlowUp() {
            JsonNode rec = record("{\"id\":null,\"basics\":{\"name\":null},\"platforms\":{"
                    + "\"IOS\":{\"enabled\":true,\"status\":null,\"currentVersion\":null,"
                    + "\"storeUrl\":null}}}");

            AppStatusResponse.PlatformStatus p = onlyPlatform(rec);

            assertEquals("NOT_REGISTERED", p.getStatus());
            assertEquals("", p.getCurrentVersion());
            assertEquals("", p.getStoreUrl());
        }
    }

    @Nested
    @DisplayName("rejection — why the store said no")
    class Rejections {

        @Test
        @DisplayName("the reason ops recorded on the build is what the institute reads")
        void reasonComesFromTheBuildRow() {
            JsonNode rec = android("REJECTED",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.0\",\"build\":\"250\","
                            + "\"status\":\"REJECTED\",\"rejectionReason\":\"Guideline 5.1.1 — account deletion missing\","
                            + "\"submittedAt\":\"2026-08-20\",\"reviewedAt\":\"2026-08-22\","
                            + "\"createdAt\":\"2026-08-20T10:00:00Z\"}]",
                    "[]");

            AppStatusResponse.Rejection rejection = onlyPlatform(rec).getRejection();

            assertNotNull(rejection);
            assertEquals("2.5.0", rejection.getVersion());
            assertEquals("250", rejection.getBuild());
            assertEquals("Guideline 5.1.1 — account deletion missing", rejection.getReason());
            assertEquals("2026-08-20", rejection.getSubmittedAt());
            assertEquals("2026-08-22", rejection.getDecidedAt());
        }

        @Test
        @DisplayName("rejected with no reason written down says so, rather than saying nothing")
        void rejectedWithNothingRecorded() {
            JsonNode rec = android("REJECTED", "[]", "[]");

            AppStatusResponse.Rejection rejection = onlyPlatform(rec).getRejection();

            assertNotNull(rejection, "an institute told 'Rejected' must be told what we know");
            assertEquals("", rejection.getReason());
            assertEquals("", rejection.getVersion());
        }

        @Test
        @DisplayName("a reason logged on the submission row instead of the build is still found")
        void reasonFallsBackToTheSubmissionRow() {
            JsonNode rec = android("REJECTED",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.0\",\"status\":\"REJECTED\","
                            + "\"rejectionReason\":\"\",\"createdAt\":\"2026-08-20T10:00:00Z\"}]",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.0\",\"status\":\"REJECTED\","
                            + "\"reason\":\"Metadata rejected — screenshots show a competitor\","
                            + "\"notes\":\"client keeps sending us the wrong PNGs\"}]");

            AppStatusResponse.Rejection rejection = onlyPlatform(rec).getRejection();

            assertNotNull(rejection);
            assertEquals("Metadata rejected — screenshots show a competitor", rejection.getReason());
        }

        @Test
        @DisplayName("ops notes about a client never cross into that client's dashboard")
        void internalNotesNeverLeak() {
            JsonNode rec = android("REJECTED", "[]",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.0\",\"status\":\"REJECTED\","
                            + "\"reason\":\"Guideline 2.1\",\"decidedAt\":\"2026-08-22\","
                            + "\"notes\":\"they never paid for the ASO work\"}]");

            AppStatusResponse.Rejection rejection = onlyPlatform(rec).getRejection();

            assertNotNull(rejection);
            assertEquals("Guideline 2.1", rejection.getReason());
            assertFalse(MAPPER.valueToTree(rejection).toString().contains("never paid"),
                    "submission notes are ops commentary and must not be serialised to the institute");
        }

        @Test
        @DisplayName("the newest rejected submission wins when several are on file")
        void newestRejectedSubmissionWins() {
            JsonNode rec = android("REJECTED", "[]",
                    "[{\"platform\":\"ANDROID\",\"status\":\"REJECTED\",\"reason\":\"old reason\","
                            + "\"decidedAt\":\"2026-06-01\"},"
                            + "{\"platform\":\"ANDROID\",\"status\":\"REJECTED\",\"reason\":\"latest reason\","
                            + "\"decidedAt\":\"2026-08-22\"},"
                            + "{\"platform\":\"IOS\",\"status\":\"REJECTED\",\"reason\":\"other platform\","
                            + "\"decidedAt\":\"2026-09-01\"}]");

            AppStatusResponse.Rejection rejection = onlyPlatform(rec).getRejection();

            assertNotNull(rejection);
            assertEquals("latest reason", rejection.getReason());
        }

        @Test
        @DisplayName("a rejection that has since been approved is history, not a banner")
        void supersededRejectionIsNotShown() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.4.0\",\"status\":\"REJECTED\","
                            + "\"rejectionReason\":\"Guideline 5.1.1\",\"createdAt\":\"2026-06-01T00:00:00Z\"},"
                            + "{\"platform\":\"ANDROID\",\"version\":\"2.4.5\",\"status\":\"LIVE\","
                            + "\"createdAt\":\"2026-07-01T00:00:00Z\"}]",
                    "[]");

            assertNull(onlyPlatform(rec).getRejection());
        }

        @Test
        @DisplayName("an update rejected while the old build keeps serving is still shown")
        void newestBuildRejectedWhileStoreStaysLive() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.1\",\"status\":\"REJECTED\","
                            + "\"rejectionReason\":\"Guideline 4.3 — spam\",\"createdAt\":\"2026-08-25T00:00:00Z\"}]",
                    "[]");

            AppStatusResponse.PlatformStatus p = onlyPlatform(rec);

            assertEquals("LIVE", p.getStatus(), "the store is still serving 2.4.5");
            assertNotNull(p.getRejection());
            assertEquals("Guideline 4.3 — spam", p.getRejection().getReason());
        }

        @Test
        @DisplayName("another platform's rejection is not this platform's problem")
        void rejectionIsPerPlatform() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"IOS\",\"version\":\"2.5.1\",\"status\":\"REJECTED\","
                            + "\"rejectionReason\":\"ITMS-91053\",\"createdAt\":\"2026-08-25T00:00:00Z\"}]",
                    "[]");

            assertNull(onlyPlatform(rec).getRejection());
        }
    }

    @Nested
    @DisplayName("pending update — where the promised release got to")
    class PendingUpdates {

        @Test
        @DisplayName("a build in review is reported with its notes and submission date")
        void buildInReview() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.1\",\"build\":\"251\","
                            + "\"status\":\"IN_REVIEW\",\"releaseNotes\":\"Attendance fixes\","
                            + "\"submittedAt\":\"2026-08-27\",\"otaStatus\":\"PENDING\","
                            + "\"createdAt\":\"2026-08-27T00:00:00Z\"}]",
                    "[]");

            AppStatusResponse.PendingUpdate update = onlyPlatform(rec).getPendingUpdate();

            assertNotNull(update);
            assertEquals("2.5.1", update.getVersion());
            assertEquals("251", update.getBuild());
            assertEquals("IN_REVIEW", update.getStatus());
            assertEquals("Attendance fixes", update.getReleaseNotes());
            assertEquals("2026-08-27", update.getSubmittedAt());
            assertEquals("PENDING", update.getOtaStatus());
        }

        @Test
        @DisplayName("nothing recorded means nothing pending")
        void noVersionsAtAll() {
            AppStatusResponse.PlatformStatus p = onlyPlatform(android("LIVE", "[]", "[]"));

            assertNull(p.getPendingUpdate());
            assertFalse(p.isUpdateAvailable());
        }

        @Test
        @DisplayName("the newest build already being live is not an update in flight")
        void newestBuildIsLive() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.4.5\",\"status\":\"LIVE\","
                            + "\"createdAt\":\"2026-07-01T00:00:00Z\"}]",
                    "[]");

            assertNull(onlyPlatform(rec).getPendingUpdate());
        }

        @Test
        @DisplayName("a build row left stale by a live store sync is not sold as pending")
        void staleBuildRowAfterStoreSync() {
            // The sync flipped the platform to LIVE on 2.5.1 without anyone editing the build row,
            // which still reads BUILD_PROCESSING. The store is serving it; it is not in flight.
            JsonNode rec = record("{\"basics\":{},\"platforms\":{\"ANDROID\":{\"enabled\":true,"
                    + "\"status\":\"LIVE\",\"currentVersion\":\"2.5.1\",\"currentBuild\":\"251\"}},"
                    + "\"versions\":[{\"platform\":\"ANDROID\",\"version\":\"2.5.1\","
                    + "\"status\":\"BUILD_PROCESSING\",\"createdAt\":\"2026-08-27T00:00:00Z\"}]}");

            assertNull(onlyPlatform(rec).getPendingUpdate());
        }

        @ParameterizedTest(name = "a {0} build is finished with, not pending")
        @ValueSource(strings = {"REMOVED", "SUSPENDED"})
        void terminalBuildsAreNotPending(String status) {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.1\",\"status\":\"" + status + "\","
                            + "\"createdAt\":\"2026-08-27T00:00:00Z\"}]",
                    "[]");

            assertNull(onlyPlatform(rec).getPendingUpdate());
        }

        @Test
        @DisplayName("a rejected build is both the rejection and the pending update")
        void rejectedBuildIsStillTheOneInFlight() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.1\",\"status\":\"REJECTED\","
                            + "\"rejectionReason\":\"Guideline 4.3\",\"createdAt\":\"2026-08-27T00:00:00Z\"}]",
                    "[]");

            AppStatusResponse.PlatformStatus p = onlyPlatform(rec);

            assertNotNull(p.getRejection());
            assertNotNull(p.getPendingUpdate());
            assertEquals("REJECTED", p.getPendingUpdate().getStatus());
        }

        @Test
        @DisplayName("an otaStatus nobody set reads NONE, not empty")
        void otaStatusDefaultsToNone() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.1\",\"status\":\"SUBMITTED\","
                            + "\"createdAt\":\"2026-08-27T00:00:00Z\"}]",
                    "[]");

            assertEquals("NONE", onlyPlatform(rec).getPendingUpdate().getOtaStatus());
        }
    }

    @Nested
    @DisplayName("update available — is there something newer than the store has")
    class UpdateAvailable {

        @Test
        @DisplayName("a strictly newer recorded build means an update is waiting")
        void newerBuildRecorded() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.1\",\"status\":\"APPROVED\","
                            + "\"createdAt\":\"2026-08-27T00:00:00Z\"}]",
                    "[]");

            assertTrue(onlyPlatform(rec).isUpdateAvailable());
        }

        @Test
        @DisplayName("the same version on both sides is not an update")
        void sameVersion() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.4.5\",\"status\":\"APPROVED\","
                            + "\"createdAt\":\"2026-08-27T00:00:00Z\"}]",
                    "[]");

            assertFalse(onlyPlatform(rec).isUpdateAvailable());
        }

        @Test
        @DisplayName("with nothing live to compare against, we do not guess")
        void noLiveVersion() {
            JsonNode rec = record("{\"basics\":{},\"platforms\":{\"ANDROID\":{\"enabled\":true,"
                    + "\"status\":\"DRAFT\",\"currentVersion\":\"\"}},"
                    + "\"versions\":[{\"platform\":\"ANDROID\",\"version\":\"1.0.0\","
                    + "\"status\":\"SUBMITTED\",\"createdAt\":\"2026-08-27T00:00:00Z\"}]}");

            assertFalse(onlyPlatform(rec).isUpdateAvailable());
        }

        @Test
        @DisplayName("2.10.0 is newer than 2.9.0 — version order is numeric, not alphabetical")
        void numericSegmentOrdering() {
            JsonNode rec = record("{\"basics\":{},\"platforms\":{\"ANDROID\":{\"enabled\":true,"
                    + "\"status\":\"LIVE\",\"currentVersion\":\"2.9.0\"}},"
                    + "\"versions\":[{\"platform\":\"ANDROID\",\"version\":\"2.10.0\","
                    + "\"status\":\"SUBMITTED\",\"createdAt\":\"2026-08-01T00:00:00Z\"},"
                    + "{\"platform\":\"ANDROID\",\"version\":\"2.9.0\",\"status\":\"LIVE\","
                    + "\"createdAt\":\"2026-08-20T00:00:00Z\"}]}");

            AppStatusResponse.PlatformStatus p = onlyPlatform(rec);

            assertTrue(p.isUpdateAvailable());
            assertNotNull(p.getPendingUpdate(), "2.10.0 is the newest build, despite the older date");
            assertEquals("2.10.0", p.getPendingUpdate().getVersion());
        }

        @Test
        @DisplayName("two rows of the same version fall back to which was recorded last")
        void createdAtBreaksTheTie() {
            JsonNode rec = android("LIVE",
                    "[{\"platform\":\"ANDROID\",\"version\":\"2.5.1\",\"build\":\"251\","
                            + "\"status\":\"REJECTED\",\"createdAt\":\"2026-08-20T00:00:00Z\"},"
                            + "{\"platform\":\"ANDROID\",\"version\":\"2.5.1\",\"build\":\"252\","
                            + "\"status\":\"IN_REVIEW\",\"createdAt\":\"2026-08-26T00:00:00Z\"}]",
                    "[]");

            AppStatusResponse.PendingUpdate update = onlyPlatform(rec).getPendingUpdate();

            assertNotNull(update);
            assertEquals("252", update.getBuild());
            assertEquals("IN_REVIEW", update.getStatus());
        }
    }

    @Nested
    @DisplayName("version comparison mirrors src/lib/version-compare.ts")
    class VersionCompare {

        @ParameterizedTest(name = "{0} vs {1} -> {2}")
        @CsvSource({
                "2.5.1, 2.4.5, 1",
                "2.4.5, 2.5.1, -1",
                "2.4.5, 2.4.5, 0",
                "'1.0', '1.0.0', 0",
                "2.10.0, 2.9.0, 1",
                "'2.5.1-rc2', '2.5.1', 0",
                "1.2.3, '1.2', 1",
                "'', '', 0",
                "'', 1.0.0, -1",
                "'rc', '0', 0",
        })
        void comparesLikeTheDashboardDoes(String a, String b, int expected) {
            assertEquals(expected, Integer.signum(AppStatusMapper.compareVersions(a, b)));
            assertEquals(-expected, Integer.signum(AppStatusMapper.compareVersions(b, a)));
        }
    }

    @Nested
    @DisplayName("payloads the registry should never produce, but might")
    class Malformed {

        @Test
        @DisplayName("a versions field that is not an array is ignored, not fatal")
        void versionsIsNotAnArray() {
            JsonNode rec = record("{\"basics\":{},\"platforms\":{\"ANDROID\":{\"enabled\":true,"
                    + "\"status\":\"LIVE\",\"currentVersion\":\"1.0.0\"}},\"versions\":{}}");

            AppStatusResponse.PlatformStatus p = onlyPlatform(rec);

            assertNull(p.getPendingUpdate());
            assertFalse(p.isUpdateAvailable());
        }

        @Test
        @DisplayName("junk entries inside the versions array are skipped one by one")
        void versionsArrayHoldsJunk() {
            JsonNode rec = android("LIVE",
                    "[null,\"nonsense\",42,{\"platform\":\"ANDROID\",\"version\":\"2.5.1\","
                            + "\"status\":\"SUBMITTED\",\"createdAt\":\"2026-08-27T00:00:00Z\"}]",
                    "[]");

            AppStatusResponse.PendingUpdate update = onlyPlatform(rec).getPendingUpdate();

            assertNotNull(update);
            assertEquals("2.5.1", update.getVersion());
        }

        @Test
        @DisplayName("a version row with no platform belongs to no platform")
        void versionRowWithoutPlatform() {
            JsonNode rec = android("LIVE",
                    "[{\"version\":\"2.5.1\",\"status\":\"SUBMITTED\","
                            + "\"createdAt\":\"2026-08-27T00:00:00Z\"}]",
                    "[]");

            assertNull(onlyPlatform(rec).getPendingUpdate());
        }
    }
}
