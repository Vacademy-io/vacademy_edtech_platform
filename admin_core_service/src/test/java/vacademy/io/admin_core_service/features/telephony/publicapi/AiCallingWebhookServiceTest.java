package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallWebhook;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallApiCallRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallWebhookRepository;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiCallingWebhookServiceTest {

    private AiCallApiCallRepository calls;
    private AiCallWebhookRepository hooks;
    private AiCallingApiViews views;

    @BeforeEach
    void setUp() {
        calls = mock(AiCallApiCallRepository.class);
        hooks = mock(AiCallWebhookRepository.class);
        views = mock(AiCallingApiViews.class);
        when(views.call(any(), anyBoolean())).thenReturn(Map.of("id", "call_1"));
        when(hooks.findById("inst-1")).thenReturn(Optional.of(AiCallWebhook.builder()
                .instituteId("inst-1").url("https://93.184.216.34/hook").secret("whsec_x").enabled(true).build()));
    }

    /** The service with HTTP replaced by a fixed answer. */
    private AiCallingWebhookService service(boolean ok) {
        return new AiCallingWebhookService(calls, hooks, views) {
            @Override
            Delivery deliver(AiCallWebhook w, String eventId, String type, Map<String, Object> data) {
                return new Delivery(ok, ok ? 200 : 500, ok ? null : "HTTP 500");
            }
        };
    }

    private static AiCallApiCall finished(int attempts) {
        return AiCallApiCall.builder().id("call_abc").instituteId("inst-1").agentId("a").phoneNumber("+91")
                .finalEvent("call.completed").webhookStatus("PENDING").webhookAttempts(attempts).build();
    }

    @Test
    void theSignatureIsHmacOfTimestampDotBody() throws Exception {
        String body = "{\"id\":\"evt_1\"}";
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("whsec_test".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String expected = HexFormat.of().formatHex(mac.doFinal(("1700000000." + body).getBytes(StandardCharsets.UTF_8)));
        assertEquals(expected, AiCallingWebhookService.sign("whsec_test", 1700000000L, body));
        assertNotEquals(expected, AiCallingWebhookService.sign("whsec_test", 1700000001L, body));
    }

    @Test
    void onlyPublicHttpsUrlsAreAccepted() {
        assertEquals("https://93.184.216.34/hook", AiCallingWebhookService.validateUrl("https://93.184.216.34/hook"));
        for (String bad : new String[]{"http://93.184.216.34/hook", "https://127.0.0.1/x", "https://10.0.0.5/x",
                "https://192.168.1.4/x", "https://169.254.169.254/latest", "https://100.64.0.1/x",
                "https://u:p@93.184.216.34/x", "ftp://93.184.216.34/x", "", "not a url"}) {
            assertThrows(AiCallingApiException.class, () -> AiCallingWebhookService.validateUrl(bad), bad);
        }
    }

    @Test
    void onlyStandardHttpsPortsAreAccepted() {
        assertThrows(AiCallingApiException.class, () -> AiCallingWebhookService.validateUrl("https://93.184.216.34:22/x"));
        assertThrows(AiCallingApiException.class, () -> AiCallingWebhookService.validateUrl("https://93.184.216.34:6443/x"));
        assertEquals("https://93.184.216.34:8443/x", AiCallingWebhookService.validateUrl("https://93.184.216.34:8443/x"));
    }

    @Test
    void aDeliveredEventIsRecordedDelivered() {
        AiCallApiCall c = finished(0);
        assertTrue(service(true).deliverOne(c));
        verify(calls).recordDelivery(eq("call_abc"), eq("DELIVERED"), eq(1), isNull(), eq(200), isNull(), any(Instant.class));
        verify(calls, never()).save(any());
    }

    @Test
    void failuresRetryOnTheScheduleThenGiveUp() {
        AiCallApiCall c = finished(0);
        Instant before = Instant.now();
        assertFalse(service(false).deliverOne(c));
        ArgumentCaptor<Instant> next = ArgumentCaptor.forClass(Instant.class);
        verify(calls).recordDelivery(eq("call_abc"), eq("PENDING"), eq(1), next.capture(), eq(500), eq("HTTP 500"), isNull());
        assertTrue(next.getValue().isAfter(before.plus(Duration.ofSeconds(50))));
        assertTrue(next.getValue().isBefore(before.plus(Duration.ofSeconds(70))));

        AiCallApiCall last = finished(AiCallingWebhookService.RETRY_AFTER.size());
        service(false).deliverOne(last);
        verify(calls).recordDelivery(eq("call_abc"), eq("FAILED"), eq(AiCallingWebhookService.RETRY_AFTER.size() + 1),
                isNull(), eq(500), eq("HTTP 500"), isNull());
    }

    @Test
    void theEventIdIsStableAcrossRetries() {
        AiCallApiCall c = finished(0);
        assertEquals("evt_abc", AiCallingWebhookService.eventId(c));
        assertEquals(AiCallingWebhookService.eventId(c), AiCallingWebhookService.eventId(finished(3)));
    }

    @Test
    void aCallFinishedWithoutAWebhookIsFinalisedWithNoDelivery() {
        when(hooks.findById("inst-1")).thenReturn(Optional.empty());
        AiCallApiCall c = AiCallApiCall.builder().id("call_x").instituteId("inst-1").agentId("a").phoneNumber("+91").build();
        when(views.state(c)).thenReturn(new AiCallingApiViews.State("no_answer", true, null, null, null, null, null));
        service(true).finalizeOne(c);
        verify(calls).finalizeIfOpen(eq("call_x"), eq("no_answer"), eq("call.not_connected"), any(Instant.class),
                eq("NONE"), isNull());
        verify(calls, never()).save(any());
    }

    @Test
    void aCallStillRunningIsOnlyMarkedChecked() {
        AiCallApiCall c = AiCallApiCall.builder().id("call_y").instituteId("inst-1").agentId("a").phoneNumber("+91").build();
        when(views.state(c)).thenReturn(new AiCallingApiViews.State("dialing", false, null, null, null, null, null));
        service(true).finalizeOne(c);
        verify(calls).markChecked("call_y");
        verify(calls, never()).finalizeIfOpen(any(), any(), any(), any(), any(), any());
        verify(calls, never()).save(any());
    }

    @Test
    void aBrokenEndpointStopsOnlyItsOwnInstituteInAPass() {
        when(hooks.findById("inst-2")).thenReturn(Optional.of(AiCallWebhook.builder()
                .instituteId("inst-2").url("https://93.184.216.35/hook").secret("whsec_y").enabled(true).build()));
        AiCallApiCall a1 = AiCallApiCall.builder().id("call_a1").instituteId("inst-1").finalEvent("call.completed").build();
        AiCallApiCall a2 = AiCallApiCall.builder().id("call_a2").instituteId("inst-1").finalEvent("call.completed").build();
        AiCallApiCall b1 = AiCallApiCall.builder().id("call_b1").instituteId("inst-2").finalEvent("call.completed").build();
        when(calls.findWebhooksDue(any(), anyInt(), anyInt())).thenReturn(List.of(a1, a2, b1));
        List<String> attempted = new CopyOnWriteArrayList<>();
        AiCallingWebhookService svc = new AiCallingWebhookService(calls, hooks, views) {
            @Override
            Delivery deliver(AiCallWebhook w, String eventId, String type, Map<String, Object> data) {
                attempted.add(eventId);
                boolean ok = "inst-2".equals(w.getInstituteId());
                return new Delivery(ok, ok ? 200 : null, ok ? null : "connection failed");
            }
        };
        svc.deliverPass();
        assertTrue(attempted.contains("evt_a1"));
        assertFalse(attempted.contains("evt_a2"), "inst-1 stops at its first failure");
        assertTrue(attempted.contains("evt_b1"), "inst-2 is delivered regardless");
    }
}
