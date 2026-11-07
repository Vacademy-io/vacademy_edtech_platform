package vacademy.io.notification_service.features.engagement_ledger.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.notification_service.features.engagement_ledger.dto.ReportSignalsRequest;
import vacademy.io.notification_service.features.engagement_ledger.dto.ReportSignalsResponse;
import vacademy.io.notification_service.features.engagement_ledger.repository.EngagementReportSignalsDao;
import vacademy.io.notification_service.features.engagement_ledger.repository.EngagementReportSignalsDao.OutgoingRow;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** report-signals names each email's sender and the senders whose replies cannot reach us. */
class EngagementReportSignalsSendersTest {

    private static OutgoingRow row(String id, String action, String type, String sender) {
        return new OutgoingRow(id, action, type, "someone", Instant.parse("2026-11-04T06:00:00Z"), null, null,
                false, null, null, null, null, null, sender);
    }

    private static ReportSignalsRequest request(String... ids) {
        ReportSignalsRequest r = new ReportSignalsRequest();
        r.setInstituteId("inst");
        r.setActionIds(List.of(ids));
        return r;
    }

    private EngagementReportSignalsService service(EngagementReportSignalsDao dao) {
        Map<String, List<String>> dns = Map.of(
                "ses.example", List.of("10 inbound-smtp.us-east-1.amazonaws.com."),
                "gmail.example", List.of("5 gmail-smtp-in.l.google.com."));
        EngagementReportSignalsService service = new EngagementReportSignalsService(dao, new ObjectMapper(),
                new EngagementReplyReachabilityService(dns::get));
        ReflectionTestUtils.setField(service, "inboundEmailEnabled", true);
        return service;
    }

    @Test
    @DisplayName("email rows carry their sender; only email senders are looked up")
    void sendersOfEmailRows() {
        EngagementReportSignalsDao dao = mock(EngagementReportSignalsDao.class);
        when(dao.latestOutgoingByCorrelation(anyString(), anyCollection())).thenReturn(List.of(
                row("r1", "a1", "EMAIL", "ok@ses.example"),
                row("r2", "a2", "EMAIL", "hello@gmail.example"),
                row("r3", "a3", "EMAIL", null),
                row("r4", "a4", "WHATSAPP_MESSAGE_OUTGOING", "935184396337916")));
        when(dao.inboundWhatsApp(anyString(), anyCollection(), any(), any())).thenReturn(List.of());

        ReportSignalsResponse out = service(dao).reportSignals(request("a1", "a2", "a3", "a4"));

        assertEquals(List.of("hello@gmail.example"), out.getUnreachableSenders());
        assertEquals("ok@ses.example", out.getActions().get("a1").getSender());
        assertEquals("hello@gmail.example", out.getActions().get("a2").getSender());
        assertNull(out.getActions().get("a3").getSender());
        // A WhatsApp row's "sender" is the business number: not an email sender.
        assertNull(out.getActions().get("a4").getSender());
    }

    @Test
    @DisplayName("no actions: the field is present and empty")
    void noActions() {
        ReportSignalsResponse out = service(mock(EngagementReportSignalsDao.class)).reportSignals(request());

        assertTrue(out.getUnreachableSenders().isEmpty());
        assertTrue(out.getActions().isEmpty());
    }
}
