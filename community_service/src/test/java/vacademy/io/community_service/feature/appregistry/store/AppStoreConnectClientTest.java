package vacademy.io.community_service.feature.appregistry.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Which version of an app the status is read from, and which field says what state it is in.
 *
 * <p>The fixtures are real App Store Connect responses, captured 2026-08-31 from
 * {@code GET /v1/apps/6794024192/appStoreVersions?filter[platform]=MAC_OS} (ZOE Online School) —
 * an app whose newest version is an unsubmitted draft sitting above the one customers are actually
 * downloading. Reporting the draft would tell an institute their live Mac app is "Draft".
 */
class AppStoreConnectClientTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode versions(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("bad fixture", e);
        }
    }

    /** ZOE's Mac versions exactly as ASC returned them: a 1.0.2 draft newer than the live 1.0.1. */
    private static final String ZOE_MACOS = """
            [
              {"attributes":{"platform":"MAC_OS","versionString":"1.0.2",
                 "appStoreState":"PREPARE_FOR_SUBMISSION","appVersionState":"PREPARE_FOR_SUBMISSION",
                 "createdDate":"2026-08-25T19:31:17-07:00"}},
              {"attributes":{"platform":"MAC_OS","versionString":"1.0.1",
                 "appStoreState":"READY_FOR_SALE","appVersionState":"READY_FOR_DISTRIBUTION",
                 "createdDate":"2026-08-25T10:58:38-07:00"}},
              {"attributes":{"platform":"MAC_OS","versionString":"1.0",
                 "appStoreState":"READY_FOR_SALE","appVersionState":"READY_FOR_DISTRIBUTION",
                 "createdDate":"2026-08-18T21:59:47-07:00"}}
            ]
            """;

    @Test
    @DisplayName("the version customers can download wins over a newer unsubmitted draft")
    void picksTheLiveVersionNotTheNewest() {
        JsonNode chosen = AppStoreConnectClient.selectVersion(versions(ZOE_MACOS));

        assertEquals("1.0.1", chosen.path("attributes").path("versionString").asText());
    }

    @Test
    @DisplayName("of two live versions, the most recently created one is the current release")
    void picksTheNewestLiveVersion() {
        JsonNode chosen = AppStoreConnectClient.selectVersion(versions(ZOE_MACOS));

        assertEquals("READY_FOR_DISTRIBUTION", AppStoreConnectClient.stateOf(chosen));
    }

    @Test
    @DisplayName("an app that has never gone live still reports its newest version")
    void fallsBackToNewestWhenNothingIsLive() {
        JsonNode chosen = AppStoreConnectClient.selectVersion(versions("""
                [
                  {"attributes":{"versionString":"1.0.5","appVersionState":"READY_FOR_REVIEW",
                     "createdDate":"2026-04-03T00:00:00-07:00"}},
                  {"attributes":{"versionString":"1.0.4","appVersionState":"PREPARE_FOR_SUBMISSION",
                     "createdDate":"2026-03-01T00:00:00-07:00"}}
                ]
                """));

        assertEquals("1.0.5", chosen.path("attributes").path("versionString").asText());
    }

    @Test
    @DisplayName("READY_FOR_SALE still counts as live while Apple keeps sending the old field")
    void legacyLiveStateStillWins() {
        JsonNode chosen = AppStoreConnectClient.selectVersion(versions("""
                [
                  {"attributes":{"versionString":"2.0","appStoreState":"PREPARE_FOR_SUBMISSION",
                     "createdDate":"2026-08-30T00:00:00-07:00"}},
                  {"attributes":{"versionString":"1.9","appStoreState":"READY_FOR_SALE",
                     "createdDate":"2026-08-01T00:00:00-07:00"}}
                ]
                """));

        assertEquals("1.9", chosen.path("attributes").path("versionString").asText());
    }

    @Test
    @DisplayName("appVersionState is read in preference to the field Apple is retiring")
    void prefersTheNewStateField() {
        JsonNode version = versions("""
                {"attributes":{"appStoreState":"READY_FOR_SALE","appVersionState":"READY_FOR_DISTRIBUTION"}}
                """);

        assertEquals("READY_FOR_DISTRIBUTION", AppStoreConnectClient.stateOf(version));
    }

    @Test
    @DisplayName("a response carrying only the old field is still understood")
    void fallsBackToTheLegacyStateField() {
        JsonNode version = versions("{\"attributes\":{\"appStoreState\":\"IN_REVIEW\"}}");

        assertEquals("IN_REVIEW", AppStoreConnectClient.stateOf(version));
    }

    @Test
    @DisplayName("no versions for this platform selects nothing rather than guessing")
    void emptyListSelectsNothing() {
        assertNull(AppStoreConnectClient.selectVersion(versions("[]")));
    }

    @Test
    @DisplayName("a credential missing any of its three parts builds no client at all")
    void incompleteCredentialsBuildNothing() {
        assertNull(AppStoreConnectClient.of("", "KEY", "p8"));
        assertNull(AppStoreConnectClient.of("issuer", "", "p8"));
        assertNull(AppStoreConnectClient.of("issuer", "KEY", ""));
        // A well-formed set whose p8 is not an EC key is also "not configured", never a half-client.
        assertNull(AppStoreConnectClient.of("issuer", "KEY", "not-a-key"));
    }
}
