package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementPointsOfContact;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** After an AI call: the summary on the timeline, and a callback when the lead asked for one. */
class AiCallFollowThroughTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private AiCallFollowThrough ft;
    private AiCallQueueService queue;
    private TimelineEventService timeline;
    private EngagementPointsOfContact poc;
    private LLMService llm;
    private final Instant callAt = Instant.parse("2026-10-29T12:30:00Z");

    @BeforeEach
    void setUp() {
        ft = new AiCallFollowThrough();
        queue = mock(AiCallQueueService.class);
        timeline = mock(TimelineEventService.class);
        poc = mock(EngagementPointsOfContact.class);
        llm = mock(LLMService.class);
        AiCallingSettingsService settings = mock(AiCallingSettingsService.class);
        when(settings.get(any())).thenReturn(AiCallingSettingsPojo.defaults());
        ReflectionTestUtils.setField(ft, "queueService", queue);
        ReflectionTestUtils.setField(ft, "timelineEventService", timeline);
        ReflectionTestUtils.setField(ft, "pointsOfContact", poc);
        ReflectionTestUtils.setField(ft, "llmService", llm);
        ReflectionTestUtils.setField(ft, "settingsService", settings);
        var ok = new vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.EnqueueResult();
        ok.setQueued(true);
        when(queue.enqueueAt(any(), any(), any(), any())).thenReturn(ok);
    }

    private AiCallResult result() {
        AiCallResult r = new AiCallResult();
        r.setId("res1");
        r.setCallLogId("log1");
        r.setCampaignId("agent1");
        r.setCustomerName("Priyanshu");
        r.setPhoneNumber("+919968858268");
        r.setAiSummary("Teacher interested in Tutezy; asked for a callback.");
        r.setCallStart(callAt);
        return r;
    }

    private void llmSays(String json) {
        var resp = mock(LLMService.LLMResponse.class);
        when(resp.getContent()).thenReturn(json);
        when(llm.generateChatCompletion(any())).thenReturn(resp);
    }

    @Test
    @DisplayName("the call summary lands on the lead's timeline, with the callback ask")
    void summaryNote() {
        AiCallResult r = result();
        r.setCallbackTimeText("in two days");
        llmSays("{\"at\": \"2026-10-31T18:00:00+05:30\"}");
        ft.afterCall(r, "resp1", "user1", "inst1");
        var desc = ArgumentCaptor.forClass(String.class);
        verify(timeline).logEvent(eq("AUDIENCE_RESPONSE"), eq("resp1"), eq("AI_CALL_SUMMARY"), any(), any(), any(),
                eq("AI call summary"), desc.capture(), any(), eq("user1"));
        assertTrue(desc.getValue().contains("Teacher interested"));
        assertTrue(desc.getValue().contains("Asked to be called back: in two days"), desc.getValue());
    }

    @Test
    @DisplayName("an exact callback time is scheduled as given")
    void exactTime() {
        AiCallResult r = result();
        r.setCallback(true);
        r.setCallbackAt(Instant.parse("2026-10-31T12:30:00Z"));
        ft.afterCall(r, "resp1", "user1", "inst1");
        var req = ArgumentCaptor.forClass(AiCallRequestDTO.class);
        verify(queue).enqueueAt(req.capture(), eq(Instant.parse("2026-10-31T12:30:00Z")), eq("res1"), isNull());
        assertEquals("agent1", req.getValue().getCampaignId());
        assertEquals("resp1", req.getValue().getResponseId());
        verifyNoInteractions(llm);
    }

    @Test
    @DisplayName("\"in two days\" is read by the model against the call time and scheduled")
    void relativeText() {
        AiCallResult r = result();
        r.setCallbackTimeText("2 din baad call karna");
        llmSays("{\"at\": \"2026-10-31T18:00:00+05:30\"}");
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(queue).enqueueAt(any(), eq(Instant.parse("2026-10-31T12:30:00Z")), eq("res1"), isNull());
        verify(timeline).logEvent(any(), eq("resp1"), eq("AI_CALLBACK"), any(), any(), any(), eq("Callback scheduled"), any(), any(), any());
    }

    @Test
    @DisplayName("no usable time: nothing is scheduled and the points of contact are told to call")
    void noTime() {
        AiCallResult r = result();
        r.setDisposition("Callback");
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(queue, never()).enqueueAt(any(), any(), any(), any());
        verify(poc).alert(eq("inst1"), eq("user1"), startsWith("Callback needs a time"), any(), eq("AI_CALLBACK"), eq("res1"));
    }

    @Test
    @DisplayName("a time the model puts in the past or years away is a misreading, not scheduled")
    void rejectsMisreading() {
        assertNull(ft.resolve("inst1", "yesterday", callAt, IST) );
        llmSays("{\"at\": \"2026-10-28T10:00:00+05:30\"}");
        assertNull(ft.resolve("inst1", "yesterday", callAt, IST));
        llmSays("{\"at\": \"2031-01-01T10:00:00+05:30\"}");
        assertNull(ft.resolve("inst1", "someday", callAt, IST));
        llmSays("{\"at\": null}");
        assertNull(ft.resolve("inst1", "maybe", callAt, IST));
        llmSays("not json");
        assertNull(ft.resolve("inst1", "tomorrow", callAt, IST));
    }

    @Test
    @DisplayName("a call that asked for no callback schedules nothing")
    void noCallbackAsked() {
        AiCallResult r = result();
        r.setDisposition("Interested");
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(queue, never()).enqueueAt(any(), any(), any(), any());
        verifyNoInteractions(poc);
    }

    @Test
    @DisplayName("callback detection: flag, time, text or the Callback disposition")
    void detection() {
        AiCallResult r = new AiCallResult();
        assertFalse(AiCallFollowThrough.wantsCallback(r));
        r.setDisposition("Call Back");
        assertTrue(AiCallFollowThrough.wantsCallback(r));
        r = new AiCallResult();
        r.setCallbackTimeText("kal");
        assertTrue(AiCallFollowThrough.wantsCallback(r));
    }
}
