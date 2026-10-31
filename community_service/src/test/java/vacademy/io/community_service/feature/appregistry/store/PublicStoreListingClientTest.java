package vacademy.io.community_service.feature.appregistry.store;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The credential-free tier reads pages that belong to Apple and Google, so the only part worth
 * pinning is what this makes of their answers — including the answers that must produce nothing.
 *
 * <p>Every fixture below is a verbatim fragment of a real response captured on 2026-09-10, not an
 * invented shape: the Play listing's version lives in an undocumented numeric-keyed blob, and a
 * hand-written approximation of it would pass this test while failing in production.
 */
class PublicStoreListingClientTest {

    private final PublicStoreListingClient client = new PublicStoreListingClient();

    /** Real fragment of play.google.com/store/apps/details?id=com.hcca.app, trimmed either side. */
    private static final String PLAY_PAGE = """
            <html><body>…"140":[[["Education"]]],\
            "141":[[["1.0.4"]],[[[36]],[[[23,"6.0"]]]]],"146":[["Aug 22, 2026",[1787402846,941000000]]],\
            "155":[null,[null,null,5]]}]…</body></html>""";

    /** Real fragment of itunes.apple.com/lookup?bundleId=io.hcca.app&country=IN&entity=software. */
    private static final String APPLE_LOOKUP = """
            {"resultCount":1,"results":[{"kind":"software","trackId":6790100465,
             "trackName":"HCCA Learning","version":"1.0.1",
             "currentVersionReleaseDate":"2026-08-23T04:30:46Z",
             "trackViewUrl":"https://apps.apple.com/in/app/hcca-learning/id6790100465?uo=4"}]}""";

    @Nested
    @DisplayName("the public App Store lookup")
    class AppStore {

        @Test
        @DisplayName("reads the published version, its release date and the public listing URL")
        void readsThePublishedVersion() {
            PublicStoreListingClient.Listing listing = client.parseAppleLookup(APPLE_LOOKUP);

            assertEquals("1.0.1", listing.version());
            assertEquals("2026-08-23T04:30:46Z", listing.releasedAt());
            assertEquals("https://apps.apple.com/in/app/hcca-learning/id6790100465?uo=4", listing.storeUrl());
            assertEquals("HCCA Learning", listing.name());
        }

        @Test
        @DisplayName("an empty result set is 'nothing to say', not 'no such app'")
        void emptyResultSetIsNull() {
            assertNull(client.parseAppleLookup("{\"resultCount\":0,\"results\":[]}"));
        }

        @Test
        @DisplayName("a Mac-only bundle is refused, because an IOS row must not show a Mac version")
        void macSoftwareIsRefused() {
            String macResult = APPLE_LOOKUP.replace("\"kind\":\"software\"", "\"kind\":\"mac-software\"");

            assertNull(client.parseAppleLookup(macResult));
        }

        @Test
        @DisplayName("a broken or non-JSON response degrades to null rather than throwing")
        void garbageIsNull() {
            assertNull(client.parseAppleLookup("<html>we are down</html>"));
            assertNull(client.parseAppleLookup(""));
            assertNull(client.parseAppleLookup(null));
        }
    }

    @Nested
    @DisplayName("the public Play listing")
    class Play {

        @Test
        @DisplayName("reads the version and turns the 'Updated on' epoch into an instant")
        void readsTheVersionAndUpdatedDate() {
            PublicStoreListingClient.Listing listing = client.parsePlayListing(PLAY_PAGE, "com.hcca.app");

            assertEquals("1.0.4", listing.version());
            assertEquals("2026-08-22T12:47:26Z", listing.releasedAt());
            assertEquals("https://play.google.com/store/apps/details?id=com.hcca.app", listing.storeUrl());
        }

        @Test
        @DisplayName("keeps the version when only the date marker is missing")
        void versionSurvivesAMissingDate() {
            String noDate = PLAY_PAGE.replace("\"146\":", "\"999\":");

            PublicStoreListingClient.Listing listing = client.parsePlayListing(noDate, "com.hcca.app");

            assertEquals("1.0.4", listing.version());
            assertEquals("", listing.releasedAt());
        }

        @Test
        @DisplayName("a reshaped page reports nothing rather than a wrong version")
        void reshapedPageIsNull() {
            assertNull(client.parsePlayListing("<html>Google reshaped this page</html>", "com.hcca.app"));
            assertNull(client.parsePlayListing("", "com.hcca.app"));
            assertNull(client.parsePlayListing(null, "com.hcca.app"));
        }
    }
}
