package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class EngagementAiCallPoolTest {

    private final AiAgentService agents = mock(AiAgentService.class);
    private final EngagementActionRepository actions = mock(EngagementActionRepository.class);
    private final EngagementAiCallPool pool = new EngagementAiCallPool(agents, actions);

    private static EngagementEngine engine(String channels) {
        EngagementEngine e = new EngagementEngine();
        e.setId("eng-1");
        e.setChannels(channels);
        return e;
    }

    @Test
    void channelOffNeedsNoPool() {
        assertDoesNotThrow(() -> pool.requirePool("inst", "{\"AI_CALL\":{\"enabled\":false}}"));
        assertDoesNotThrow(() -> pool.requirePool("inst", "{}"));
    }

    @Test
    void channelOnWithEmptyPoolIsRefused() {
        assertThrows(VacademyException.class,
                () -> pool.requirePool("inst", "{\"AI_CALL\":{\"enabled\":true,\"agentPool\":[]}}"));
        assertThrows(VacademyException.class,
                () -> pool.requirePool("inst", "{\"AI_CALL\":{\"enabled\":true}}"));
    }

    @Test
    void unknownOrDisabledAgentIsRefused() {
        when(agents.find("a1", "inst")).thenReturn(Optional.empty());
        assertThrows(VacademyException.class,
                () -> pool.requirePool("inst", "{\"AI_CALL\":{\"enabled\":true,\"agentPool\":[\"a1\"]}}"));
        AiAgent off = AiAgent.builder().id("a2").enabled(false).build();
        when(agents.find("a2", "inst")).thenReturn(Optional.of(off));
        assertThrows(VacademyException.class,
                () -> pool.requirePool("inst", "{\"AI_CALL\":{\"enabled\":true,\"agentPool\":[\"a2\"]}}"));
    }

    @Test
    void validPoolPasses() {
        when(agents.find("a1", "inst")).thenReturn(Optional.of(AiAgent.builder().id("a1").build()));
        assertDoesNotThrow(() -> pool.requirePool("inst", "{\"AI_CALL\":{\"enabled\":true,\"agentPool\":[\"a1\"]}}"));
    }

    @Test
    void nextRotatesThroughThePool() {
        EngagementEngine e = engine("{\"AI_CALL\":{\"enabled\":true,\"agentPool\":[\"a\",\"b\",\"c\"]}}");
        when(actions.countByEngineIdAndChannel(anyString(), anyString())).thenReturn(0L, 1L, 2L, 3L);
        assertEquals("a", pool.next(e));
        assertEquals("b", pool.next(e));
        assertEquals("c", pool.next(e));
        assertEquals("a", pool.next(e));
    }

    @Test
    void nextIsNullWithoutAPool() {
        assertNull(pool.next(engine("{\"AI_CALL\":{\"enabled\":true}}")));
    }
}
