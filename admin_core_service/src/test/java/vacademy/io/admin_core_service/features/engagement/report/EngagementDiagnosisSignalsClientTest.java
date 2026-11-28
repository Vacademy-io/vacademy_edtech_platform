package vacademy.io.admin_core_service.features.engagement.report;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signals;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The signals client merges its chunked calls, the senders whose replies can't reach us too. */
class EngagementDiagnosisSignalsClientTest {

    private InternalClientUtils http;
    private EngagementReportSignalsClient client;

    @BeforeEach
    void setUp() {
        http = mock(InternalClientUtils.class);
        client = new EngagementReportSignalsClient();
        ReflectionTestUtils.setField(client, "internalClientUtils", http);
        ReflectionTestUtils.setField(client, "clientName", "admin_core_service");
        ReflectionTestUtils.setField(client, "notificationServerBaseUrl", "http://notification");
    }

    private void respond(String first, String... rest) {
        var stub = when(http.makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any()));
        stub = stub.thenReturn(ResponseEntity.ok(first));
        for (String body : rest) stub = stub.thenReturn(ResponseEntity.ok(body));
    }

    private static List<String> ids(int n) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < n; i++) out.add("a" + i);
        return out;
    }

    @Test
    void theSendersOfEveryChunkAreMerged() {
        respond("""
                {"inboundEmailEnabled":true,"unreachableSenders":["a@gmail.example","b@gmail.example"],
                 "actions":{"a0":{"channel":"EMAIL","sender":"a@gmail.example"}}}""", """
                {"inboundEmailEnabled":true,"unreachableSenders":["b@gmail.example","c@gmail.example"],
                 "actions":{"a1":{"channel":"EMAIL","sender":"c@gmail.example"}}}""");

        Signals s = client.fetch("inst", ids(EngagementReportSignalsClient.CHUNK + 1), 72);

        verify(http, times(2)).makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any());
        assertEquals(Set.of("a@gmail.example", "b@gmail.example", "c@gmail.example"), s.unreachableSenders());
        assertEquals("a@gmail.example", s.byActionId().get("a0").sender());
        assertEquals("c@gmail.example", s.byActionId().get("a1").sender());
    }

    @Test
    void anOlderServerWithoutTheFieldMeansNothingIsUnreachable() {
        respond("""
                {"inboundEmailEnabled":true,"actions":{"a0":{"channel":"EMAIL"}}}""");

        Signals s = client.fetch("inst", ids(1), 72);

        assertTrue(s.inboundEmailEnabled());
        assertTrue(s.unreachableSenders().isEmpty());
        assertEquals(null, s.byActionId().get("a0").sender());
    }

    @Test
    void aNewChunkAfterAnOldOneStillCounts() {
        respond("""
                {"inboundEmailEnabled":true,"actions":{}}""", """
                {"inboundEmailEnabled":true,"unreachableSenders":["c@gmail.example",""],"actions":{}}""");

        Signals s = client.fetch("inst", ids(EngagementReportSignalsClient.CHUNK + 1), 72);

        assertEquals(Set.of("c@gmail.example"), s.unreachableSenders());
    }
}
