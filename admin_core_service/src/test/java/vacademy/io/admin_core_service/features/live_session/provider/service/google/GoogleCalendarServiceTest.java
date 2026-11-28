package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class GoogleCalendarServiceTest {

    @Test
    void timePart_keepsZeroSeconds() {
        // Calendar rejects "2026-10-27T10:30Z" with a bare 400; slots always start on a whole minute.
        Map<String, Object> part = GoogleCalendarService.timePart(Instant.parse("2026-10-27T10:30:00Z"), "Asia/Kolkata");
        assertEquals("2026-10-27T10:30:00Z", part.get("dateTime"));
        assertEquals("Asia/Kolkata", part.get("timeZone"));
    }

    @Test
    void timePart_dropsSubSecondPrecision() {
        Map<String, Object> part = GoogleCalendarService.timePart(Instant.parse("2026-10-27T10:30:15.123456Z"), null);
        assertEquals("2026-10-27T10:30:15Z", part.get("dateTime"));
        assertFalse(part.containsKey("timeZone"));
    }
}
