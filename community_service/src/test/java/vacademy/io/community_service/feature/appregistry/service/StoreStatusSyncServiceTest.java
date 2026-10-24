package vacademy.io.community_service.feature.appregistry.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.community_service.feature.appregistry.entity.AppRegistration;
import vacademy.io.community_service.feature.appregistry.repository.AppRegistrationRepository;
import vacademy.io.community_service.feature.appregistry.store.AppStoreConnectClient;
import vacademy.io.community_service.feature.appregistry.store.GooglePlayClient;
import vacademy.io.community_service.feature.appregistry.store.PublicStoreListingClient;
import vacademy.io.community_service.feature.appregistry.store.StoreCredentialResolver;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Live store-status sync: which store gets asked about which app, and what the answer is turned
 * into before an institute admin reads it.
 *
 * <p>The case that matters most here is the Mac one. Shiksha Nation and ZOE ship iOS and macOS
 * under a single bundle id, so "ask App Store Connect about this bundle" is an ambiguous question
 * — and answering it with the iPhone app's version on the Mac App Store row is wrong in a way
 * nobody would notice from the dashboard.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StoreStatusSyncServiceTest {

    @Mock
    private AppRegistrationRepository repository;

    @Mock
    private StoreCredentialResolver storeCredentialResolver;

    @Mock
    private AppStoreConnectClient appStoreConnectClient;

    @Mock
    private PublicStoreListingClient publicStoreListingClient;

    @InjectMocks
    private StoreStatusSyncService service;

    /** An app shipped on iOS and macOS under one bundle id — the Shiksha Nation / ZOE shape. */
    private static AppRegistration appleApp(String id) {
        AppRegistration row = new AppRegistration();
        row.setId(id);
        row.setName("ZOE Edtech");
        row.setArchived(false);
        row.setPayload("""
                {"id":"%s","basics":{"instituteId":"inst-1","packageName":"com.zoeedtech.app"},
                 "platforms":{
                   "IOS":{"enabled":true,"status":"NOT_REGISTERED","fields":{"bundle_id":"io.zoeedtech.app"}},
                   "MACOS":{"enabled":true,"status":"NOT_REGISTERED","fields":{"bundle_id":"io.zoeedtech.app"}},
                   "WINDOWS":{"enabled":false,"status":"NOT_REGISTERED","fields":{}}}}
                """.formatted(id));
        return row;
    }

    @Nested
    @DisplayName("which platform the store is asked about")
    class PlatformRouting {

        @Test
        @DisplayName("the Mac row asks App Store Connect for MAC_OS, not for the iPhone build")
        void macOsIsAskedAboutAsMacOs() {
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect("inst-1", "MACOS"))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus("io.zoeedtech.app", "MAC_OS"))
                    .thenReturn(new AppStoreConnectClient.AppStatus(
                            "6794024192", "READY_FOR_DISTRIBUTION", "1.0.1", "6", "2026-08-25"));

            Map<String, Object> result = service.sync("app-1", "MACOS");

            assertEquals("LIVE", result.get("status"));
            assertEquals("1.0.1", result.get("version"));
            verify(appStoreConnectClient).fetchStatus("io.zoeedtech.app", "MAC_OS");
        }

        @Test
        @DisplayName("the iOS row asks for IOS, so one bundle id can answer twice with two versions")
        void iosIsAskedAboutAsIos() {
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect("inst-1", "IOS"))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus("io.zoeedtech.app", "IOS"))
                    .thenReturn(new AppStoreConnectClient.AppStatus(
                            "6794024192", "READY_FOR_DISTRIBUTION", "2.5.5", "5", "2026-08-25"));

            assertEquals("2.5.5", service.sync("app-1", "IOS").get("version"));
            verify(appStoreConnectClient).fetchStatus("io.zoeedtech.app", "IOS");
        }

        @Test
        @DisplayName("no credential for this institute is 'go and look', never a fabricated status")
        void noCredentialSyncsNothing() {
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString())).thenReturn(null);

            assertNull(service.sync("app-1", "MACOS"));
            verify(repository, never()).save(any());
        }

        @Test
        @DisplayName("a platform with no bundle id recorded is not guessed at from the package name")
        void missingIdentifierSyncsNothing() {
            AppRegistration row = appleApp("app-1");
            row.setPayload("""
                    {"basics":{"instituteId":"inst-1","packageName":"com.zoeedtech.app"},
                     "platforms":{"MACOS":{"enabled":true,"fields":{}}}}
                    """);
            when(repository.findById("app-1")).thenReturn(Optional.of(row));

            assertNull(service.sync("app-1", "MACOS"));
        }
    }

    /** An Android-only app, for the half of the sync that has no credential in prod at all. */
    private static AppRegistration androidApp(String id) {
        AppRegistration row = new AppRegistration();
        row.setId(id);
        row.setName("HCCA Learning");
        row.setArchived(false);
        row.setPayload("""
                {"id":"%s","basics":{"instituteId":"inst-2"},
                 "platforms":{
                   "ANDROID":{"enabled":true,"status":"NOT_REGISTERED","fields":{"package_name":"com.hcca.app"}}}}
                """.formatted(id));
        return row;
    }

    @Nested
    @DisplayName("the credential-free public listing fallback")
    class PublicListingFallback {

        @Test
        @DisplayName("an iOS app nothing can see is read from its public App Store page")
        void iosFallsBackToThePublicListing() {
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString())).thenReturn(null);
            when(publicStoreListingClient.lookupAppStore("io.zoeedtech.app")).thenReturn(
                    new PublicStoreListingClient.Listing("2.5.5", "2026-08-28T05:40:16Z",
                            "https://apps.apple.com/in/app/id6794024192", "ZOE Online School"));

            Map<String, Object> result = service.sync("app-1", "IOS");

            // Publicly downloadable is the one status this tier is entitled to assert.
            assertEquals("LIVE", result.get("status"));
            assertEquals("2.5.5", result.get("version"));
            assertEquals("PUBLIC_LISTING", result.get("source"));
        }

        @Test
        @DisplayName("Android — which has no credential anywhere in prod — is read from its Play page")
        void androidFallsBackToThePublicListing() {
            AppRegistration row = androidApp("app-2");
            when(repository.findById("app-2")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveGooglePlay("inst-2")).thenReturn(null);
            when(publicStoreListingClient.lookupPlayStore("com.hcca.app")).thenReturn(
                    new PublicStoreListingClient.Listing("1.0.4", "2026-08-22T12:47:26Z",
                            "https://play.google.com/store/apps/details?id=com.hcca.app", ""));

            Map<String, Object> result = service.sync("app-2", "ANDROID");

            assertEquals("LIVE", result.get("status"));
            assertEquals("1.0.4", result.get("version"));
            assertEquals("PUBLIC_LISTING", result.get("source"));
        }

        @Test
        @DisplayName("the Mac row is never answered publicly — that lookup returns the iPhone app")
        void macOsIsNeverAnsweredFromThePublicListing() {
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString())).thenReturn(null);

            assertNull(service.sync("app-1", "MACOS"));
            verify(publicStoreListingClient, never()).lookupAppStore(anyString());
            verify(repository, never()).save(any());
        }

        @Test
        @DisplayName("a public listing that finds nothing leaves the recorded status alone")
        void aPublicMissIsNotNotRegistered() {
            AppRegistration row = androidApp("app-2");
            when(repository.findById("app-2")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveGooglePlay(anyString())).thenReturn(null);
            when(publicStoreListingClient.lookupPlayStore(anyString())).thenReturn(null);

            assertNull(service.sync("app-2", "ANDROID"));
            verify(repository, never()).save(any());
        }

        @Test
        @DisplayName("a credential that can answer is still the authority — the public page isn't asked")
        void aWorkingCredentialWins() {
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect("inst-1", "IOS"))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus("io.zoeedtech.app", "IOS"))
                    .thenReturn(new AppStoreConnectClient.AppStatus(
                            "6794024192", "READY_FOR_DISTRIBUTION", "2.5.5", "5", "2026-08-25"));

            assertEquals("STORE_API", service.sync("app-1", "IOS").get("source"));
            verify(publicStoreListingClient, never()).lookupAppStore(anyString());
        }

        @Test
        @DisplayName("a credential that exists but cannot see the app still falls back")
        void aBlindCredentialStillFallsBack() {
            AppRegistration row = androidApp("app-2");
            GooglePlayClient playClient = org.mockito.Mockito.mock(GooglePlayClient.class);
            when(repository.findById("app-2")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveGooglePlay("inst-2")).thenReturn(playClient);
            when(playClient.fetchStatus("com.hcca.app")).thenReturn(null);
            when(publicStoreListingClient.lookupPlayStore("com.hcca.app")).thenReturn(
                    new PublicStoreListingClient.Listing("1.0.4", "", "https://play.google.com/x", ""));

            assertEquals("PUBLIC_LISTING", service.sync("app-2", "ANDROID").get("source"));
        }
    }

    @Nested
    @DisplayName("the scheduled sweep")
    class Sweep {

        @Test
        @DisplayName("visits every enabled platform of every live app, and no disabled one")
        void visitsEnabledPlatformsOnly() {
            AppRegistration row = appleApp("app-1");
            when(repository.findAllByOrderByNameAsc()).thenReturn(List.of(row));
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString()))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus(anyString(), anyString()))
                    .thenReturn(new AppStoreConnectClient.AppStatus("1", "READY_FOR_SALE", "1.0", "1", "2026-08-01"));

            StoreStatusSyncService.SweepResult result = service.syncAll();

            assertEquals(2, result.synced(), "IOS and MACOS are enabled; WINDOWS is not");
            verify(appStoreConnectClient).fetchStatus("io.zoeedtech.app", "IOS");
            verify(appStoreConnectClient).fetchStatus("io.zoeedtech.app", "MAC_OS");
        }

        @Test
        @DisplayName("an archived app is left alone")
        void archivedAppsAreSkipped() {
            AppRegistration row = appleApp("app-1");
            row.setArchived(true);
            when(repository.findAllByOrderByNameAsc()).thenReturn(List.of(row));

            StoreStatusSyncService.SweepResult result = service.syncAll();

            assertEquals(0, result.synced());
            assertEquals(0, result.skipped());
            verify(repository, never()).findById(anyString());
        }

        @Test
        @DisplayName("a platform with no credential counts as skipped, not as a failure")
        void uncredentialledPlatformsAreSkippedNotFailed() {
            AppRegistration row = appleApp("app-1");
            when(repository.findAllByOrderByNameAsc()).thenReturn(List.of(row));
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString())).thenReturn(null);

            StoreStatusSyncService.SweepResult result = service.syncAll();

            assertEquals(0, result.synced());
            assertEquals(2, result.skipped());
            assertEquals(0, result.failed());
        }

        @Test
        @DisplayName("one institute's broken credential does not cost every other institute its update")
        void oneFailureDoesNotStopTheSweep() {
            AppRegistration broken = appleApp("app-broken");
            AppRegistration healthy = appleApp("app-ok");
            when(repository.findAllByOrderByNameAsc()).thenReturn(List.of(broken, healthy));
            when(repository.findById("app-broken")).thenThrow(new RuntimeException("connection reset"));
            when(repository.findById("app-ok")).thenReturn(Optional.of(healthy));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString()))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus(anyString(), anyString()))
                    .thenReturn(new AppStoreConnectClient.AppStatus("1", "READY_FOR_SALE", "1.0", "1", "2026-08-01"));

            StoreStatusSyncService.SweepResult result = service.syncAll();

            assertEquals(2, result.failed(), "both platforms of the broken app");
            assertEquals(2, result.synced(), "both platforms of the healthy one, unaffected");
        }
    }

    @Nested
    @DisplayName("when the store has nothing to say")
    class UnknownToThisCredential {

        @Test
        @DisplayName("an app the credential cannot see is left alone, not marked Not Registered")
        void invisibleAppIsNotOverwritten() {
            // Vidyayatan's App Store Connect key cannot see Shiksha Nation's or ZOE's apps — they
            // live in a second Apple team. A sweep running under the wrong key must not rewrite a
            // verified Live release as Not Registered.
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString()))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus(anyString(), anyString())).thenReturn(null);

            assertNull(service.sync("app-1", "MACOS"));
            verify(repository, never()).save(any());
        }

        @Test
        @DisplayName("a sweep under a credential that sees nothing changes nothing at all")
        void sweepUnderTheWrongCredentialWritesNothing() {
            AppRegistration row = appleApp("app-1");
            when(repository.findAllByOrderByNameAsc()).thenReturn(List.of(row));
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString()))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus(anyString(), anyString())).thenReturn(null);

            StoreStatusSyncService.SweepResult result = service.syncAll();

            assertEquals(0, result.synced());
            assertEquals(2, result.skipped());
            verify(repository, never()).save(any());
        }
    }

    @Nested
    @DisplayName("rejections")
    class Rejections {

        private void appleReturns(String state, String version) {
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString()))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus(anyString(), anyString()))
                    .thenReturn(new AppStoreConnectClient.AppStatus("1", state, version, "1", "2026-08-01"));
        }

        @Test
        @DisplayName("App Review's unresolved issues outrank a version that still says ready")
        void unresolvedIssuesMakeItRejected() {
            // Verified live on io.shikshanation.app: the version reads READY_FOR_REVIEW while its
            // submission reads UNRESOLVED_ISSUES. Going by the version alone tells an institute
            // their app is ready to submit when Apple has bounced it back.
            appleReturns("READY_FOR_REVIEW", "1.0.5");
            when(appStoreConnectClient.fetchLatestReviewSubmission(anyString(), anyString()))
                    .thenReturn(new AppStoreConnectClient.ReviewSubmission(
                            "UNRESOLVED_ISSUES", "2026-05-31T13:15:08.29Z"));

            assertEquals("REJECTED", service.sync("app-1", "IOS").get("status"));

            ArgumentCaptor<AppRegistration> saved = ArgumentCaptor.forClass(AppRegistration.class);
            verify(repository).save(saved.capture());
            String payload = saved.getValue().getPayload();
            assertTrue(payload.contains("\"rejection\""), payload);
            assertTrue(payload.contains("2026-05-31T13:15:08.29Z"), payload);
            // Apple never hands over the review's message, so the reason stays empty rather than invented.
            assertTrue(payload.contains("\"reason\":\"\""), payload);
        }

        @Test
        @DisplayName("a live app is not re-rejected by a submission it has already superseded")
        void anOldRejectionDoesNotUnseatALiveRelease() {
            appleReturns("READY_FOR_DISTRIBUTION", "2.5.5");

            assertEquals("LIVE", service.sync("app-1", "IOS").get("status"));
            verify(appStoreConnectClient, never()).fetchLatestReviewSubmission(anyString(), anyString());
        }

        @Test
        @DisplayName("a rejected version records the rejection without a second call")
        void rejectedVersionIsEnough() {
            appleReturns("REJECTED", "1.0.6");

            assertEquals("REJECTED", service.sync("app-1", "IOS").get("status"));
            verify(appStoreConnectClient, never()).fetchLatestReviewSubmission(anyString(), anyString());
        }

        @Test
        @DisplayName("a resolved rejection stops being shown — it is cleared, not left behind")
        void resolvedRejectionIsCleared() {
            AppRegistration row = appleApp("app-1");
            row.setPayload(row.getPayload().replace(
                    "\"IOS\":{\"enabled\":true,\"status\":\"NOT_REGISTERED\"",
                    "\"IOS\":{\"enabled\":true,\"status\":\"REJECTED\","
                            + "\"rejection\":{\"version\":\"1.0.5\",\"reason\":\"old\"}"));
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), anyString()))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus(anyString(), anyString()))
                    .thenReturn(new AppStoreConnectClient.AppStatus("1", "READY_FOR_DISTRIBUTION", "1.0.6", "2", "2026-08-30"));

            service.sync("app-1", "IOS");

            ArgumentCaptor<AppRegistration> saved = ArgumentCaptor.forClass(AppRegistration.class);
            verify(repository).save(saved.capture());
            assertFalse(saved.getValue().getPayload().contains("\"reason\":\"old\""),
                    "a rejection the store has moved past must not linger on the institute's screen");
        }
    }

    @Nested
    @DisplayName("what gets written back")
    class Persistence {

        @Test
        @DisplayName("a synced status lands in the stored record, so the institute reads it without a second call")
        void syncPersistsIntoThePayload() {
            AppRegistration row = appleApp("app-1");
            when(repository.findById("app-1")).thenReturn(Optional.of(row));
            when(storeCredentialResolver.resolveAppStoreConnect(anyString(), eq("MACOS")))
                    .thenReturn(appStoreConnectClient);
            when(appStoreConnectClient.fetchStatus(anyString(), eq("MAC_OS")))
                    .thenReturn(new AppStoreConnectClient.AppStatus(
                            "6794024192", "READY_FOR_DISTRIBUTION", "1.0.1", "6", "2026-08-25"));

            service.sync("app-1", "MACOS");

            ArgumentCaptor<AppRegistration> saved = ArgumentCaptor.forClass(AppRegistration.class);
            verify(repository).save(saved.capture());
            String payload = saved.getValue().getPayload();
            assertTrue(payload.contains("\"status\":\"LIVE\""), payload);
            assertTrue(payload.contains("\"currentVersion\":\"1.0.1\""), payload);
            assertTrue(payload.contains("lastSyncedAt"), payload);
            // The iOS half of the same record must not have been touched by a Mac sync.
            assertTrue(payload.contains("\"IOS\":{\"enabled\":true,\"status\":\"NOT_REGISTERED\""), payload);
        }
    }

    @Nested
    @DisplayName("store state mapping")
    class StateMapping {

        @ParameterizedTest(name = "{0} -> {1}")
        @CsvSource({
                // appStoreState, the field Apple is retiring
                "READY_FOR_SALE, LIVE",
                "PREPARE_FOR_SUBMISSION, DRAFT",
                "IN_REVIEW, IN_REVIEW",
                "WAITING_FOR_REVIEW, SUBMITTED",
                "PENDING_DEVELOPER_RELEASE, APPROVED",
                "METADATA_REJECTED, REJECTED",
                "REMOVED_FROM_SALE, REMOVED",
                "PROCESSING_FOR_APP_STORE, BUILD_PROCESSING",
                // appVersionState, the field replacing it
                "READY_FOR_DISTRIBUTION, LIVE",
                "READY_FOR_REVIEW, READY_FOR_SUBMISSION",
                "PROCESSING_FOR_DISTRIBUTION, BUILD_PROCESSING",
                "ACCEPTED, APPROVED",
                "REPLACED_WITH_NEW_VERSION, REMOVED",
                // a platform this app record does not ship on
                "NOT_REGISTERED, NOT_REGISTERED",
                // anything unrecognised reads as "in flight, go and check"
                "SOMETHING_APPLE_ADDED_LAST_WEEK, SUBMITTED",
        })
        @DisplayName("both spellings of every Apple state map to one dashboard status")
        void appleStatesMap(String appleState, String expected) {
            assertEquals(expected, StoreStatusSyncService.mapAppStoreState(appleState));
        }
    }
}
