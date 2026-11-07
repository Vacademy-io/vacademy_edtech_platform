package vacademy.io.notification_service.features.engagement_ledger.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.engagement_ledger.dto.LedgerBatchResponse;
import vacademy.io.notification_service.features.engagement_ledger.repository.EngagementContactRepository;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** B5 (S1, L10): one person's touches across all systems, phone and email together. */
class EngagementContactLedgerTest {

    private static EngagementContactRepository.ContactRow row(long touches, Instant lastHuman) {
        return new EngagementContactRepository.ContactRow() {
            public String getChannelId() { return "x"; }
            public Long getTouches() { return touches; }
            public Instant getLastHumanSentAt() { return lastHuman; }
        };
    }

    @Test
    @DisplayName("S1_phoneAndEmailAddUp: touches by phone and by email are one person's total; the latest inbox message wins")
    void S1_phoneAndEmailAddUp() {
        Instant early = Instant.parse("2026-10-28T10:00:00Z");
        Instant late = Instant.parse("2026-10-29T04:00:00Z");
        LedgerBatchResponse.ContactLedger c = EngagementLedgerService.contact(row(3, early), row(1, late));
        assertEquals(4, c.getTouches());
        assertEquals(late, c.getLastHumanSentAt());
    }

    @Test
    @DisplayName("no contact rows: zero touches, no human message")
    void none() {
        LedgerBatchResponse.ContactLedger c = EngagementLedgerService.contact(null, null);
        assertEquals(0, c.getTouches());
        assertNull(c.getLastHumanSentAt());
    }
}
