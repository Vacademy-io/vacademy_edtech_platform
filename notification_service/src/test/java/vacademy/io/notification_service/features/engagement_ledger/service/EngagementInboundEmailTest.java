package vacademy.io.notification_service.features.engagement_ledger.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The engine's reply sweep reads inbound emails too (design T17), only the part the person wrote. */
class EngagementInboundEmailTest {

    @Test
    @DisplayName("newPart: the quoted thread, signatures and Outlook headers are cut")
    void newPartCutsQuotes() {
        assertEquals("Not interested, thanks.", EmailReplyText.newPart(
                "Not interested, thanks.\n\nOn Tue, 28 Oct 2026 at 10:02, Academy <hi@academy.in> wrote:\n> Reply STOP to stop"));
        assertEquals("What are the fees?", EmailReplyText.newPart(
                "What are the fees?\r\n\r\n-----Original Message-----\r\nFrom: Academy"));
        assertEquals("Call me tomorrow", EmailReplyText.newPart(
                "Call me tomorrow\n\nFrom: Academy <hi@academy.in>\nSent: Tuesday\nTo: me\nSubject: Course"));
        assertEquals("Yes please", EmailReplyText.newPart("Yes please\n--\nAsha\n9000000001"));
        assertEquals("ok", EmailReplyText.newPart("ok\n\nSent from my iPhone"));
        assertNull(EmailReplyText.newPart("> only quoted text"));
        assertNull(EmailReplyText.newPart(null));
        assertEquals(EmailReplyText.MAX_CHARS, EmailReplyText.newPart("a".repeat(5000)).length());
    }

    @Test
    @DisplayName("inbound-since: email rows only with includeEmail, carrying sender, subject, new text and Message-ID")
    void inboundSinceAddsEmails() {
        NotificationLogRepository repo = mock(NotificationLogRepository.class);
        EngagementLedgerService service = new EngagementLedgerService(repo, mock(InstituteInternalService.class));
        NotificationLogRepository.InboundEmailRow row = mock(NotificationLogRepository.InboundEmailRow.class);
        when(row.getFromAddress()).thenReturn(" Asha@Example.com ");
        when(row.getSubject()).thenReturn("Re: Course details");
        when(row.getPayload()).thenReturn("{\"body\":\"Unsubscribe me\\n\\nOn Mon, X wrote:\\n> hi\"}");
        when(row.getReceivedAt()).thenReturn(Timestamp.from(Instant.parse("2026-10-29T06:00:00Z")));
        when(row.getMessageId()).thenReturn("<m1@mail>");
        NotificationLogRepository.InboundEmailRow noId = mock(NotificationLogRepository.InboundEmailRow.class);
        when(noId.getFromAddress()).thenReturn("b@example.com");
        when(repo.findInboundEmailsSince(eq("i1"), any())).thenReturn(List.of(row, noId));

        List<Map<String, Object>> out = service.inboundSince("i1", Instant.now(), true);
        assertEquals(1, out.size());
        Map<String, Object> m = out.get(0);
        assertEquals("EMAIL", m.get("channel"));
        assertEquals("asha@example.com", m.get("email"));
        assertEquals("Re: Course details", m.get("subject"));
        assertEquals("Unsubscribe me", m.get("text"));
        assertEquals("<m1@mail>", m.get("wamid"));
        assertTrue(String.valueOf(m.get("receivedAt")).startsWith("2026-10-29T06:00"));

        service.inboundSince("i1", Instant.now());
        verify(repo, org.mockito.Mockito.times(1)).findInboundEmailsSince(any(), any());
    }

    @Test
    @DisplayName("inbound-since: without the flag the response is WhatsApp only, as before")
    void defaultIsWhatsAppOnly() {
        NotificationLogRepository repo = mock(NotificationLogRepository.class);
        EngagementLedgerService service = new EngagementLedgerService(repo, mock(InstituteInternalService.class));
        service.inboundSince("i1", Instant.now());
        verify(repo).findInboundRepliesSince(eq("i1"), any());
        verify(repo, never()).findInboundEmailsSince(any(), any());
    }
}
