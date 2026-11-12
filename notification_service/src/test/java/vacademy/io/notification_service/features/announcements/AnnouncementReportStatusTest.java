package vacademy.io.notification_service.features.announcements;

import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.announcements.service.AnnouncementService;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.sql.Timestamp;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Per-recipient email status precedence and rate guards used by the announcement report. */
class AnnouncementReportStatusTest {

    private static NotificationLogRepository.AnnouncementRecipientEmailRow row(
            String sendStatus, Boolean delivered, boolean opened, boolean clicked,
            Boolean bounced, Boolean rejected, Boolean complained) {
        Timestamp now = Timestamp.from(Instant.parse("2026-11-12T10:00:00Z"));
        return new NotificationLogRepository.AnnouncementRecipientEmailRow() {
            public String getUserId() { return "u1"; }
            public String getEmail() { return "a@b.com"; }
            public String getSendStatus() { return sendStatus; }
            public String getSendError() { return null; }
            public Timestamp getSentAt() { return now; }
            public Boolean getDelivered() { return delivered; }
            public Timestamp getOpenedAt() { return opened ? now : null; }
            public Timestamp getClickedAt() { return clicked ? now : null; }
            public Boolean getBounced() { return bounced; }
            public Boolean getRejected() { return rejected; }
            public Boolean getComplained() { return complained; }
        };
    }

    @Test
    void noEventsYetIsSent() {
        // BOOL_OR over zero events is NULL, not false
        assertEquals("SENT", AnnouncementService.emailStatusOf(row(null, null, false, false, null, null, null)));
    }

    @Test
    void clickedBeatsOpenedBeatsDelivered() {
        assertEquals("DELIVERED", AnnouncementService.emailStatusOf(row(null, true, false, false, false, false, false)));
        assertEquals("OPENED", AnnouncementService.emailStatusOf(row(null, true, true, false, false, false, false)));
        assertEquals("CLICKED", AnnouncementService.emailStatusOf(row(null, true, true, true, false, false, false)));
    }

    @Test
    void failuresBeatEngagement() {
        assertEquals("FAILED", AnnouncementService.emailStatusOf(row("FAILED", null, false, false, null, null, null)));
        assertEquals("BOUNCED", AnnouncementService.emailStatusOf(row(null, true, true, false, true, false, false)));
        assertEquals("COMPLAINED", AnnouncementService.emailStatusOf(row(null, true, true, true, false, false, true)));
    }

    @Test
    void rateIsZeroOnEmptyBase() {
        assertEquals(0.0, AnnouncementService.rate(5, 0));
        assertEquals(50.0, AnnouncementService.rate(1, 2));
    }
}
