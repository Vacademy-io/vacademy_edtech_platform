package vacademy.io.admin_core_service.features.telephony.queue;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiVoiceBox;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiVoiceBoxRepository;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The failures of the bot VOICE_BOT_BASE_URL names reach the portal without a configured box. */
class VoiceBotFailurePullerTest {

    private static final String HEALTH = "https://bot.example.io/voice-bot-service/health";

    private final AiVoiceBoxRepository boxes = mock(AiVoiceBoxRepository.class);
    private final VoiceBotVendorFailureRecorder recorder = mock(VoiceBotVendorFailureRecorder.class);
    private final HttpClient http = mock(HttpClient.class);
    private final VoiceBotFailurePuller puller = new VoiceBotFailurePuller(boxes, recorder, http);

    @SuppressWarnings("unchecked")
    private void healthAnswers(int status, String body) throws Exception {
        HttpResponse<String> res = mock(HttpResponse.class);
        when(res.statusCode()).thenReturn(status);
        when(res.body()).thenReturn(body);
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn((HttpResponse) res);
    }

    @Test
    void healthUrlFromEitherFormOfTheBase() {
        assertEquals(HEALTH, VoiceBotFailurePuller.healthUrl("https://bot.example.io/voice-bot-service"));
        assertEquals(HEALTH, VoiceBotFailurePuller.healthUrl("https://bot.example.io/voice-bot-service/"));
        assertEquals(HEALTH, VoiceBotFailurePuller.healthUrl(" https://bot.example.io/ "));
        assertNull(VoiceBotFailurePuller.healthUrl(""));
        assertNull(VoiceBotFailurePuller.healthUrl(null));
        assertNull(VoiceBotFailurePuller.healthUrl("CONFIGURE_ME"));
    }

    @Test
    void theBotsFailuresAreHandedToTheRecorderOnEachRead() throws Exception {
        puller.botBaseUrl = "https://bot.example.io/voice-bot-service";
        when(boxes.findByEnabledTrue()).thenReturn(List.of(
                AiVoiceBox.builder().slug("default").baseUrl(AiVoiceBox.UNCONFIGURED_URL).enabled(true).build()));
        healthAnswers(200, """
                {"status":"ok","vendorFailures":[{"id":"vb-1-1","at":"2026-11-20T05:42:01Z",
                 "vendor":"tts.navana.ai","operation":"key 2","reason":"Key refused"}]}""");

        puller.poll();

        ArgumentCaptor<HttpRequest> sent = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http, times(VoiceBotFailurePuller.READS_PER_POLL)).send(sent.capture(), any());
        assertEquals(HEALTH, sent.getValue().uri().toString());
        ArgumentCaptor<JsonNode> failures = ArgumentCaptor.forClass(JsonNode.class);
        verify(recorder, times(VoiceBotFailurePuller.READS_PER_POLL))
                .record(eq(VoiceBotFailurePuller.SOURCE), failures.capture());
        assertEquals("tts.navana.ai", failures.getValue().get(0).get("vendor").asText());
    }

    @Test
    void aBoxAlreadyPollingTheSameBotIsLeftToIt() throws Exception {
        puller.botBaseUrl = "https://bot.example.io/voice-bot-service";
        when(boxes.findByEnabledTrue()).thenReturn(List.of(
                AiVoiceBox.builder().slug("default").baseUrl("https://bot.example.io").enabled(true).build()));

        puller.poll();

        verify(http, never()).send(any(), any());
    }

    @Test
    void nothingIsReadWhenNoBotIsConfigured() throws Exception {
        puller.botBaseUrl = "";
        puller.poll();
        verify(http, never()).send(any(), any());
    }

    @Test
    void anUnreachableOrFailingBotNeverThrowsAndRecordsNothing() throws Exception {
        puller.botBaseUrl = "https://bot.example.io/voice-bot-service";
        when(boxes.findByEnabledTrue()).thenReturn(List.of());
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenThrow(new IOException("connection refused"));
        puller.poll();
        verify(recorder, never()).record(any(), any());

        healthAnswers(503, "down");
        assertTrue(puller.readOnce(HEALTH).contains("503"));
        verify(recorder, never()).record(any(), any());
    }
}
