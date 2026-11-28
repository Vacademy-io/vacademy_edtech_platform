package vacademy.io.admin_core_service.features.telephony.queue;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallQueueItem;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallLaneRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A waiting AI call whose agent was turned off or deleted is cancelled for EVERY trigger,
 * not only public API calls: before this a workflow / bulk / manual call dialled the contact
 * with the generic built-in persona.
 */
class AiCallQueueAgentRefusalTest {

    private static final String INST = "inst-1";

    private AiAgentRepository agents;
    private AiCallingSettingsService settingsService;
    private AiCallingSettingsPojo settings;
    private AiCallQueueDrainJob job;
    private final List<Object[]> rows = new ArrayList<>();

    @BeforeEach
    void setUp() {
        agents = mock(AiAgentRepository.class);
        settingsService = mock(AiCallingSettingsService.class);
        settings = new AiCallingSettingsPojo();
        when(settingsService.get(INST)).thenReturn(settings);
        when(agents.findIdNameEnabledByInstituteId(INST)).thenReturn(rows);
        job = new AiCallQueueDrainJob(mock(AiCallQueueItemRepository.class), mock(AiCallLaneRepository.class),
                mock(AiCallCapacityService.class), mock(AiCallQueueService.class), settingsService, agents);
    }

    private void agent(String id, String name, boolean enabled, String direction) {
        rows.add(new Object[]{id, name, enabled});
        when(agents.findByIdAndInstituteId(id, INST)).thenReturn(Optional.of(AiAgent.builder()
                .id(id).instituteId(INST).name(name).enabled(enabled).direction(direction).build()));
    }

    private static AiCallQueueItem item(String provider, String campaignId, String campaignName) {
        return AiCallQueueItem.builder().id("q-1").instituteId(INST).provider(provider)
                .campaignId(campaignId).campaignName(campaignName).build();
    }

    private void registry(String name, String id) {
        settings.getCampaigns().add(new AiCallingSettingsPojo.CampaignConfig(id, name, "OUTBOUND", "VACADEMY_AI"));
    }

    @Test
    void anEnabledAgentDials() {
        agent("a-1", "Riya", true, "OUTBOUND");
        for (CallTrigger t : CallTrigger.values()) {
            assertNull(job.agentRefusal(item("VACADEMY_AI", "a-1", null), t), t.name());
        }
    }

    @Test
    void aDisabledAgentIsRefusedForEveryTrigger() {
        agent("a-1", "Riya", false, "OUTBOUND");
        for (CallTrigger t : CallTrigger.values()) {
            assertNotNull(job.agentRefusal(item("VACADEMY_AI", "a-1", null), t), t.name());
        }
    }

    /** Non-API triggers: every trigger except API. */
    private static List<CallTrigger> nonApi() {
        return java.util.Arrays.stream(CallTrigger.values()).filter(t -> t != CallTrigger.API).toList();
    }

    @Test
    void aMissingAgentStillDialsWithTheFallbackPersonaForWorkflowBulkAndManual() {
        // Prod runs on this (an institute with no agents at all, a default naming no agent).
        for (CallTrigger t : nonApi()) {
            assertNull(job.agentRefusal(item("VACADEMY_AI", "gone", null), t), t.name());
        }
    }

    @Test
    void aMissingAgentIsStillCanceledForApiCallsAsBefore() {
        assertEquals(AiCallQueueDrainJob.AGENT_OFF, job.agentRefusal(item("VACADEMY_AI", "gone", null), CallTrigger.API));
        assertEquals(AiCallQueueDrainJob.AGENT_OFF, job.agentRefusal(item("VACADEMY_AI", null, null), CallTrigger.API));
    }

    @Test
    void aDefaultThatNamesNoAgentStillDials() {
        settings.setDefaultCampaignId("f724144e-0000-0000-0000-000000000000");
        for (CallTrigger t : nonApi()) {
            assertNull(job.agentRefusal(item("VACADEMY_AI", null, null), t), t.name());
            assertNull(job.agentRefusal(item("VACADEMY_AI", null, "Some old agent name"), t), t.name());
        }
    }

    @Test
    void aNameOnlyItemForATurnedOffAgentIsNotSwappedForTheDefault() {
        agent("a-1", "Riya", false, "OUTBOUND");
        agent("a-2", "Default", true, "OUTBOUND");
        settings.setDefaultCampaignId("a-2");
        String why = job.agentRefusal(item("VACADEMY_AI", null, "riya"), CallTrigger.AUTOMATION);
        assertNotNull(why);
        assertTrue(why.contains("riya"));
    }

    @Test
    void aNameResolvesThroughTheRegistry() {
        agent("a-1", "Riya", true, "OUTBOUND");
        registry("Riya", "a-1");
        assertNull(job.agentRefusal(item("VACADEMY_AI", null, "Riya"), CallTrigger.AUTOMATION));
    }

    @Test
    void theInstituteDefaultIsCheckedById() {
        agent("a-2", "Default", false, "OUTBOUND");
        settings.setDefaultCampaignId("a-2");
        assertNotNull(job.agentRefusal(item("VACADEMY_AI", null, null), CallTrigger.MANUAL));
        rows.clear();
        agent("a-2", "Default", true, "OUTBOUND");
        assertNull(job.agentRefusal(item("VACADEMY_AI", null, null), CallTrigger.MANUAL));
    }

    @Test
    void aDefaultHoldingAnAgentNameIsCheckedByName() {
        agent("a-2", "Jin AI", false, "OUTBOUND");
        settings.setDefaultCampaignId("Jin AI");
        for (CallTrigger t : nonApi()) {
            assertNotNull(job.agentRefusal(item("VACADEMY_AI", null, null), t), t.name());
        }
    }

    @Test
    void noCampaignAtAllIsLeftToPlaceCall() {
        assertNull(job.agentRefusal(item("VACADEMY_AI", null, null), CallTrigger.AUTOMATION));
    }

    @Test
    void otherProvidersAreNotChecked() {
        assertNull(job.agentRefusal(item("AAVTAAR", "aavtaar-campaign-7", null), CallTrigger.AUTOMATION));
        assertNull(job.agentRefusal(item("MOCK", "whatever", null), CallTrigger.AUTOMATION));
        verify(agents, never()).findIdNameEnabledByInstituteId(anyString());
    }

    @Test
    void anInboundOnlyAgentStillRefusesApiCallsOnly() {
        agent("a-1", "Reception", true, "INBOUND");
        assertNotNull(job.agentRefusal(item("VACADEMY_AI", "a-1", null), CallTrigger.API));
        assertNull(job.agentRefusal(item("VACADEMY_AI", "a-1", null), CallTrigger.AUTOMATION));
    }

    @Test
    void aFailedAgentLookupDoesNotCancel() {
        when(agents.findIdNameEnabledByInstituteId(INST)).thenThrow(new RuntimeException("db down"));
        assertNull(job.agentRefusal(item("VACADEMY_AI", "a-1", null), CallTrigger.AUTOMATION));
    }
}
