package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.lang.reflect.Method;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * expiresAt drives the near-expiry S3 rescue, which only mirrors recordings falling due within a
 * few days. Overstate the date and the rescue never fires — Zoom deletes the recording at its real
 * 30-day mark and it is gone for good. Counting from "now" was survivable while the sync only ever
 * saw a meeting's newest instance; it is not, now that the sweep reaches back over old ones.
 */
class ZoomRecordingExpiryTest {

    private static String expiryFor(MeetingRecordingDTO rec) throws Exception {
        Method m = ZoomRecordingService.class.getDeclaredMethod("expiryFor", MeetingRecordingDTO.class);
        m.setAccessible(true);
        return (String) m.invoke(null, rec);
    }

    @Test
    @DisplayName("expiry is 30 days after the recording was MADE, not after we saw it")
    void countsFromRecordingStart() throws Exception {
        String start = "2026-08-01T09:30:00Z";
        String got = expiryFor(MeetingRecordingDTO.builder().startTime(start).build());
        assertEquals(Instant.parse(start).plus(30, ChronoUnit.DAYS).toString(), got);
    }

    @Test
    @DisplayName("a 25-day-old recording reads as nearly due, so the rescue can still catch it")
    void oldRecordingIsNearlyDue() throws Exception {
        String start = Instant.now().minus(25, ChronoUnit.DAYS).toString();
        long daysLeft = ChronoUnit.DAYS.between(
                Instant.now(), Instant.parse(expiryFor(MeetingRecordingDTO.builder().startTime(start).build())));
        assertTrue(daysLeft <= 5,
                "25-day-old recording should be inside the 5-day rescue window, got " + daysLeft + "d");
    }

    @Test
    @DisplayName("falls back to now+30d when the start time is missing or unparseable")
    void fallsBackWhenNoUsableStart() throws Exception {
        for (String bad : new String[] { null, "", "   ", "not-a-timestamp" }) {
            long daysLeft = ChronoUnit.DAYS.between(
                    Instant.now(), Instant.parse(expiryFor(MeetingRecordingDTO.builder().startTime(bad).build())));
            assertTrue(daysLeft >= 29 && daysLeft <= 30, "expected ~30d for " + bad + ", got " + daysLeft);
        }
    }
}
