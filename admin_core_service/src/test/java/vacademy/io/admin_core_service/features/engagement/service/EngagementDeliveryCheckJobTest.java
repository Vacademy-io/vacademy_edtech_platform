package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** A WhatsApp send Meta later refuses must stop reading as delivered. */
class EngagementDeliveryCheckJobTest {

    private final ObjectMapper om = new ObjectMapper();

    @Test
    @DisplayName("a reported failure moves the matching SENT action to FAILED with Meta's reason")
    void marksFailed() throws Exception {
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        when(actions.markDeliveryFailed(any(), any(), any())).thenReturn(1);
        var job = new EngagementDeliveryCheckJob(mock(EngagementMemberRepository.class), actions,
                mock(EngagementInternalClients.class));
        var failures = om.readTree("[{\"correlationId\":\"a1\",\"errorCode\":\"131049\","
                + "\"errorMessage\":\"Error: This message was not delivered to maintain healthy ecosystem engagement. (code=131049)\"},"
                + "{\"correlationId\":\"other\",\"errorCode\":\"1\",\"errorMessage\":\"x\"}]");
        assertEquals(1, job.apply(Set.of("a1"), failures, Instant.now()));
        var reason = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(actions).markDeliveryFailed(eq("a1"), reason.capture(), any());
        verify(actions, never()).markDeliveryFailed(eq("other"), any(), any());
        assertTrue(reason.getValue().startsWith("Not delivered: This message was not delivered"), reason.getValue());
        assertTrue(reason.getValue().contains("another channel"), reason.getValue());
    }

    @Test
    @DisplayName("no failures, or a malformed answer, changes nothing")
    void nothing() throws Exception {
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        var job = new EngagementDeliveryCheckJob(mock(EngagementMemberRepository.class), actions,
                mock(EngagementInternalClients.class));
        assertEquals(0, job.apply(Set.of("a1"), om.readTree("[]"), Instant.now()));
        assertEquals(0, job.apply(Set.of("a1"), om.readTree("{}"), Instant.now()));
        assertEquals(0, job.apply(Set.of("a1"), null, Instant.now()));
        verifyNoInteractions(actions);
    }

    @Test
    @DisplayName("the sweep asks per institute with live engines and survives one failing")
    void sweepIsolated() throws Exception {
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        when(members.institutesWithLiveEngines()).thenReturn(List.of("i1", "i2"));
        when(actions.sentWhatsAppSince(eq("i1"), any())).thenReturn(List.of("a1"));
        when(actions.sentWhatsAppSince(eq("i2"), any())).thenReturn(List.of("b1"));
        when(clients.deliveryFailuresSince(eq("i1"), anyLong())).thenThrow(new IllegalStateException("down"));
        when(clients.deliveryFailuresSince(eq("i2"), anyLong())).thenReturn(om.readTree("[{\"correlationId\":\"b1\",\"errorMessage\":\"bad\"}]"));
        new EngagementDeliveryCheckJob(members, actions, clients).sweep();
        verify(actions).markDeliveryFailed(eq("b1"), any(), any());
    }
}
