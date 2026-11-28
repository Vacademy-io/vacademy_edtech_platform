package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.call_intelligence.core.CallIntelligenceEnqueueService;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.entity.CallIntelligence;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallWebhook;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallWebhookRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.HumanCallApiCallRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class HumanCallWebhookServiceTest {

    private HumanCallApiCallRepository calls;
    private AiCallWebhookRepository hooks;
    private HumanCallViews views;
    private CallIntelligenceEnqueueService intelligence;
    private final List<String> sent = new ArrayList<>();

    @BeforeEach
    void setUp() {
        calls = mock(HumanCallApiCallRepository.class);
        hooks = mock(AiCallWebhookRepository.class);
        views = mock(HumanCallViews.class);
        intelligence = mock(CallIntelligenceEnqueueService.class);
        when(views.view(any(HumanCallApiCall.class))).thenReturn(Map.of("id", "hcall_1"));
        when(hooks.findById("inst-1")).thenReturn(Optional.of(AiCallWebhook.builder().instituteId("inst-1")
                .url("https://93.184.216.34/hook").secret("whsec_x").enabled(true).build()));
    }

    /** The service with the HTTP send replaced by a fixed answer (the AI sender is reused as is). */
    private HumanCallWebhookService service(boolean ok) {
        AiCallingWebhookService sender = new AiCallingWebhookService(null, hooks, null) {
            @Override
            Delivery deliver(AiCallWebhook w, String eventId, String type, Map<String, Object> data) {
                sent.add(eventId + " " + type);
                return new Delivery(ok, ok ? 200 : 500, ok ? null : "HTTP 500");
            }
        };
        return new HumanCallWebhookService(calls, hooks, views, sender, intelligence);
    }

    private static HumanCallApiCall row(boolean analyze) {
        return HumanCallApiCall.builder().id("hcall_abc").instituteId("inst-1").counsellorUserId("c-1")
                .phoneNumber("+919876543210").callLogId("log-1").analysisRequested(analyze)
                .createdAt(Instant.now()).build();
    }

    private static TelephonyCallLog recorded() {
        return TelephonyCallLog.builder().id("log-1").status("COMPLETED").recordingStorageKey("file-1").build();
    }

    @Test
    void aConnectedCallQueuesHumanCallCompleted() {
        HumanCallApiCall c = row(false);
        when(views.state(c)).thenReturn(new HumanCallViews.State("completed", true, null, null, recorded(), Instant.now()));
        service(true).finalizeOne(c);
        verify(calls).finalizeIfOpen(eq("hcall_abc"), eq("completed"), eq("human_call.completed"), any(),
                eq("PENDING"), any());
        verify(calls, never()).markChecked(anyString());
    }

    @Test
    void aMissedCallQueuesNotConnectedAndNoAnalysisEvent() {
        HumanCallApiCall c = row(true);
        TelephonyCallLog l = TelephonyCallLog.builder().id("log-1").status("NO_ANSWER").build();
        HumanCallViews.State s = new HumanCallViews.State("no_answer", true, null, "counsellor", l, Instant.now());
        when(views.state(c)).thenReturn(s);
        service(true).finalizeOne(c);
        verify(calls).finalizeIfOpen(eq("hcall_abc"), eq("no_answer"), eq("human_call.not_connected"), any(),
                eq("PENDING"), any());
        verify(calls).finalizeAnalysisIfOpen(eq("hcall_abc"), any(), eq("NONE"), isNull());
        verifyNoInteractions(intelligence);
    }

    @Test
    void anOpenCallIsOnlyMarkedChecked() {
        HumanCallApiCall c = row(false);
        when(views.state(c)).thenReturn(new HumanCallViews.State("in_progress", false, null, null, null, null));
        service(true).finalizeOne(c);
        verify(calls).markChecked("hcall_abc");
        verify(calls, never()).finalizeIfOpen(any(), any(), any(), any(), any(), any());
    }

    @Test
    void noWebhookMeansNothingToSend() {
        when(hooks.findById("inst-1")).thenReturn(Optional.empty());
        HumanCallApiCall c = row(false);
        when(views.state(c)).thenReturn(new HumanCallViews.State("busy", true, null, null, null, Instant.now()));
        service(true).finalizeOne(c);
        verify(calls).finalizeIfOpen(eq("hcall_abc"), eq("busy"), eq("human_call.not_connected"), any(),
                eq("NONE"), isNull());
    }

    @Test
    void aRequestedAnalysisIsTriggeredOnceTheRecordingIsIn() {
        HumanCallApiCall c = row(true);
        c.setFinalizedAt(Instant.now());
        HumanCallViews.State s = new HumanCallViews.State("completed", true, null, null, recorded(), Instant.now());
        when(views.state(c)).thenReturn(s);
        when(intelligence.enqueueRequested("log-1")).thenReturn("QUEUED");
        service(true).finalizeOne(c);
        verify(intelligence).enqueueRequested("log-1");
        verify(calls).markAnalysisTriggered(eq("hcall_abc"), any());
        verify(calls, never()).finalizeAnalysisIfOpen(any(), any(), any(), any());
        verify(calls).markChecked("hcall_abc");
    }

    @Test
    void aFinishedAnalysisQueuesAnalysisReady() {
        HumanCallApiCall c = row(true);
        c.setFinalizedAt(Instant.now());
        c.setAnalysisTriggeredAt(Instant.now());
        HumanCallViews.State s = new HumanCallViews.State("completed", true, null, null, recorded(), Instant.now());
        when(views.state(c)).thenReturn(s);
        when(views.intelligence(any())).thenReturn(CallIntelligence.builder().status("COMPLETED").build());
        service(true).finalizeOne(c);
        verifyNoInteractions(intelligence);
        verify(calls).finalizeAnalysisIfOpen(eq("hcall_abc"), any(), eq("PENDING"), any());
    }

    @Test
    void deliveriesAreSignedEventsWithStableIdsPerSlot() {
        HumanCallApiCall c = row(true);
        c.setFinalEvent("human_call.completed");
        HumanCallWebhookService svc = service(true);
        assertTrue(svc.deliverOne(HumanCallWebhookService.Slot.CALL, c));
        assertTrue(svc.deliverOne(HumanCallWebhookService.Slot.ANALYSIS, c));
        assertEquals(List.of("evt_hc_abc human_call.completed", "evt_hca_abc human_call.analysis_ready"), sent);
        verify(calls).recordDelivery(eq("hcall_abc"), eq("DELIVERED"), eq(1), isNull(), eq(200), isNull(), any());
        verify(calls).recordAnalysisDelivery(eq("hcall_abc"), eq("DELIVERED"), eq(1), isNull(), eq(200), isNull(), any());
    }

    @Test
    void aFailedDeliveryIsRetriedOnTheAiScheduleThenGivenUp() {
        HumanCallApiCall c = row(false);
        c.setFinalEvent("human_call.not_connected");
        assertFalse(service(false).deliverOne(HumanCallWebhookService.Slot.CALL, c));
        verify(calls).recordDelivery(eq("hcall_abc"), eq("PENDING"), eq(1), any(Instant.class), eq(500),
                eq("HTTP 500"), isNull());
        c.setWebhookAttempts(AiCallingWebhookService.RETRY_AFTER.size());
        service(false).deliverOne(HumanCallWebhookService.Slot.CALL, c);
        verify(calls).recordDelivery(eq("hcall_abc"), eq("FAILED"), eq(AiCallingWebhookService.RETRY_AFTER.size() + 1),
                isNull(), eq(500), eq("HTTP 500"), isNull());
    }

    @Test
    void theWebhookAdvertisesHumanCallEvents() {
        AiCallingWebhookService svc = new AiCallingWebhookService(null, hooks, null);
        @SuppressWarnings("unchecked")
        List<String> events = (List<String>) svc.get("inst-1").get("events");
        assertTrue(events.containsAll(List.of("call.completed", "call.not_connected", "human_call.completed",
                "human_call.not_connected", "human_call.analysis_ready")), events.toString());
    }
}
