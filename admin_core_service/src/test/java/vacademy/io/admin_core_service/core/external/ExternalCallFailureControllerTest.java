package vacademy.io.admin_core_service.core.external;

import org.junit.jupiter.api.Test;
import vacademy.io.common.external.VendorCallLog;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ExternalCallFailureControllerTest {

    private static Map<String, Object> posted() {
        Map<String, Object> body = new HashMap<>();
        body.put("occurredAt", "2026-11-19T06:00:00Z");
        body.put("vendor", "Live-Server.WATI.io");
        body.put("sourceService", "notification");
        body.put("operation", "send template");
        body.put("httpStatus", 429);
        body.put("error", null);
        body.put("request", "{\"body\":{\"template\":\"otp\"}}");
        body.put("response", "{\"status\":429}");
        return body;
    }

    @Test
    void aPostedFailureBecomesARow() {
        VendorCallLog.Failure f = ExternalCallFailureController.parse(posted());
        assertNotNull(f);
        assertEquals("live-server.wati.io", f.vendor());
        assertEquals("notification", f.sourceService());
        assertEquals(429, f.httpStatus());
        assertEquals("2026-11-19T06:00:00Z", f.at().toString());
        assertEquals("{\"status\":429}", f.response());
    }

    @Test
    void notAnIntegratedVendorOrNoSourceIsRefused() {
        Map<String, Object> body = posted();
        body.put("vendor", "example.com");
        assertNull(ExternalCallFailureController.parse(body));
        body = posted();
        body.remove("sourceService");
        assertNull(ExternalCallFailureController.parse(body));
    }

    @Test
    void bodiesThatAreNotJsonAreDropped() {
        Map<String, Object> body = posted();
        body.put("request", "not json");
        body.put("response", "x".repeat(13_000));
        VendorCallLog.Failure f = ExternalCallFailureController.parse(body);
        assertNotNull(f);
        assertNull(f.request());
        assertNull(f.response());
    }
}
