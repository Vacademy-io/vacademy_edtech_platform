package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Turning an agent off (or deleting it) cancels the calls still waiting for it, from any path. */
class AiAgentServiceDisableTest {

    private AiAgentRepository repo;
    private AiCallQueueItemRepository queue;
    private AiAgentSpeechWarmer warmer;
    private AiCallingSettingsMutator mutator;
    private AiAgentService service;
    private AiAgent stored;

    @BeforeEach
    void setUp() {
        repo = mock(AiAgentRepository.class);
        queue = mock(AiCallQueueItemRepository.class);
        warmer = mock(AiAgentSpeechWarmer.class);
        mutator = mock(AiCallingSettingsMutator.class);
        service = new AiAgentService(repo, warmer, queue, mutator);
        stored = AiAgent.builder().id("a-1").instituteId("inst-1").name("Riya").enabled(true)
                .direction("OUTBOUND").ttsModel("google").voice("hi-IN-Chirp3-HD-Achird").build();
        when(repo.findByIdAndInstituteId("a-1", "inst-1")).thenReturn(Optional.of(stored));
        when(repo.save(any(AiAgent.class))).thenAnswer(i -> i.getArgument(0));
        when(queue.cancelQueuedForAgent(anyString(), anyString(), anyString(), anyString())).thenReturn(4);
    }

    private static AiAgentDTO dto(Boolean enabled) {
        return AiAgentDTO.builder().id("a-1").instituteId("inst-1").name("Riya").enabled(enabled)
                .systemPrompt("You are Riya.").openingLine("Hi!").build();
    }

    @Test
    void turningAnAgentOffCancelsItsWaitingCallsAndSkipsTheWarm() {
        AiAgentService.SaveResult r = service.saveWithResult(dto(false));
        assertEquals(4, r.cancelledCalls());
        assertFalse(r.agent().getEnabled());
        verify(queue).cancelQueuedForAgent("inst-1", "a-1", "Riya", AiAgentService.CANCEL_REASON_DISABLED);
        verify(warmer, never()).warm(any());
    }

    @Test
    void savingAnEnabledAgentCancelsNothingAndWarms() {
        AiAgentService.SaveResult r = service.saveWithResult(dto(true));
        assertEquals(0, r.cancelledCalls());
        verify(queue, never()).cancelQueuedForAgent(any(), any(), any(), any());
        verify(warmer).warm(any());
    }

    @Test
    void savingAnAlreadyDisabledAgentDoesNotCancelAgain() {
        stored.setEnabled(false);
        assertEquals(0, service.saveWithResult(dto(false)).cancelledCalls());
        verify(queue, never()).cancelQueuedForAgent(any(), any(), any(), any());
    }

    @Test
    void deletingLeavesWaitingCallsToTheDrainJob() {
        // A deleted agent is a MISSING agent: workflow/bulk/manual calls keep dialling with the
        // fallback persona as before; API calls are canceled by the drain job at dial time.
        assertEquals(0, service.delete("a-1", "inst-1"));
        verify(queue, never()).cancelQueuedForAgent(any(), any(), any(), any());
        verify(repo).delete(stored);
    }

    @Test
    void aCancelFailureNeverFailsTheSave() {
        when(queue.cancelQueuedForAgent(anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new RuntimeException("db"));
        assertEquals(0, service.saveWithResult(dto(false)).cancelledCalls());
    }

    @Test
    void theRegistryBridgeRecordsTheApiActorAndDropsADisabledAgent() {
        service.saveWithResult(dto(false), "api:key1");
        verify(mutator).update(eq("inst-1"), any(), argThat(a -> "api:key1".equals(a.userId())));
        com.fasterxml.jackson.databind.node.ObjectNode data = new com.fasterxml.jackson.databind.ObjectMapper()
                .createObjectNode();
        data.putArray("campaigns").addObject().put("campaignId", "a-1").put("name", "Riya");
        data.withArray("campaigns").addObject().put("campaignId", "other").put("name", "Other");
        data.put("defaultCampaignId", "x");
        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<java.util.function.Consumer<com.fasterxml.jackson.databind.node.ObjectNode>> change =
                org.mockito.ArgumentCaptor.forClass(java.util.function.Consumer.class);
        verify(mutator).update(eq("inst-1"), change.capture(), any());
        change.getValue().accept(data);
        assertEquals(1, data.get("campaigns").size());
        assertEquals("other", data.get("campaigns").get(0).get("campaignId").asText());
        assertEquals("x", data.get("defaultCampaignId").asText(), "fields the bridge does not own are kept");
    }

    @Test
    void anEnabledAgentIsRegisteredOnce() {
        service.saveWithResult(dto(true));
        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<java.util.function.Consumer<com.fasterxml.jackson.databind.node.ObjectNode>> change =
                org.mockito.ArgumentCaptor.forClass(java.util.function.Consumer.class);
        verify(mutator).update(eq("inst-1"), change.capture(), any());
        com.fasterxml.jackson.databind.node.ObjectNode data = new com.fasterxml.jackson.databind.ObjectMapper()
                .createObjectNode();
        data.putArray("campaigns").addObject().put("campaignId", "a-1").put("name", "Old name");
        change.getValue().accept(data);
        assertEquals(1, data.get("campaigns").size());
        assertEquals("Riya", data.get("campaigns").get(0).get("name").asText());
        assertEquals("VACADEMY_AI", data.get("campaigns").get(0).get("provider").asText());
    }
}
