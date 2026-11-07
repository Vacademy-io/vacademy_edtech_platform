package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * "AI Call Actions" is the vehicle for what AI agents promise on calls. An admin pausing or
 * archiving it from the engines page would silently stop every promised send, so the platform's
 * own engine refuses admin changes — except being set back to ACTIVE.
 */
class EngagementSystemEngineGuardTest {

    private EngagementEngineRepository engines;
    private EngagementMemberRepository members;
    private EngagementEngineService service;
    private EngagementEngine system;

    @BeforeEach
    void setUp() {
        engines = mock(EngagementEngineRepository.class);
        members = mock(EngagementMemberRepository.class);
        service = new EngagementEngineService(engines, members, mock(EngagementPromptVersionRepository.class),
                mock(EngagementTemplateProposalRepository.class), mock(EngagementReadDao.class));
        system = new EngagementEngine();
        system.setId("e1");
        system.setInstituteId("i1");
        system.setName("AI Call Actions");
        system.setStatus("ACTIVE");
        system.setCreatedBy(EngagementEngine.CREATED_BY_SYSTEM_AI_CALL);
        system.setChannels("{\"WHATSAPP\":{\"enabled\":true,\"auto\":true},\"EMAIL\":{\"enabled\":true,\"auto\":true}}");
        when(engines.findById("e1")).thenReturn(Optional.of(system));
        when(engines.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void pauseAndArchiveAreRefused() {
        assertThrows(VacademyException.class, () -> service.transition("e1", "i1", "PAUSED"));
        assertThrows(VacademyException.class, () -> service.transition("e1", "i1", "ARCHIVED"));
        assertEquals("ACTIVE", system.getStatus());
        verify(engines, never()).save(any());
    }

    @Test
    void itCanAlwaysBeSetBackToActive() {
        system.setStatus("PAUSED");
        // Its members are PAUSED by design, so the "enroll an audience first" gate must not apply.
        when(members.countByEngineIdAndStatus(anyString(), anyString())).thenReturn(0L);
        assertEquals("ACTIVE", service.transition("e1", "i1", "ACTIVE").getStatus());
    }

    @Test
    void autonomyAndPromptChangesAreRefused() {
        assertThrows(VacademyException.class, () -> service.setAutonomyKilled("e1", "i1", true));
        assertThrows(VacademyException.class, () -> service.editPrompt("e1", "i1", null, "admin"));
        assertFalse(Boolean.TRUE.equals(system.getAutoSendKilled()));
    }

    @Test
    void ordinaryEnginesAreUnaffected() {
        EngagementEngine own = new EngagementEngine();
        own.setId("e2");
        own.setInstituteId("i1");
        own.setStatus("ACTIVE");
        own.setCreatedBy("some-admin-user");
        when(engines.findById("e2")).thenReturn(Optional.of(own));
        assertFalse(own.isSystemManaged());
        assertEquals("PAUSED", service.transition("e2", "i1", "PAUSED").getStatus());
        assertTrue(service.setAutonomyKilled("e2", "i1", true).getAutoSendKilled());
    }
}
