package vacademy.io.admin_core_service.features.live_session.provider.manager;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Zoom meeting UUIDs are base64 and routinely contain "/" and "+". Addressing a recording
 * by a singly-encoded UUID makes Zoom route on the raw slash and answer for the wrong
 * resource (or 404), which is why the API contract requires DOUBLE encoding. Getting this
 * wrong is silent: the call succeeds and simply returns someone else's recording or none.
 */
class ZoomRecordingAddressingTest {

    private static String decodeOnce(String s) {
        return URLDecoder.decode(s, StandardCharsets.UTF_8);
    }

    @Test
    @DisplayName("a uuid containing / survives double-encoding and round-trips exactly")
    void slashUuidRoundTrips() {
        String uuid = "/cNetcfdQrmW0AuZKprKjw==";
        String encoded = ZoomMeetingManager.encodeUuid(uuid);
        assertFalse(encoded.contains("/"), "raw slash must not reach the path");
        assertEquals(uuid, decodeOnce(decodeOnce(encoded)));
    }

    @Test
    @DisplayName("a uuid containing // round-trips exactly")
    void doubleSlashUuidRoundTrips() {
        String uuid = "3MXm52O//TaaY1wB4DGIy0Q==";
        String encoded = ZoomMeetingManager.encodeUuid(uuid);
        assertFalse(encoded.contains("/"));
        assertEquals(uuid, decodeOnce(decodeOnce(encoded)));
    }

    @Test
    @DisplayName("a plain uuid with + and = round-trips exactly")
    void plainUuidRoundTrips() {
        String uuid = "uzMXY8XDTyeOyIjcPhYqnA==";
        assertEquals(uuid, decodeOnce(decodeOnce(ZoomMeetingManager.encodeUuid(uuid))));
    }

    @Test
    @DisplayName("encoding is genuinely double, not single")
    void encodingIsDouble() {
        String encoded = ZoomMeetingManager.encodeUuid("a/b");
        // single-encode would be "a%2Fb"; double-encode escapes the % as well
        assertEquals("a%252Fb", encoded);
    }
}
