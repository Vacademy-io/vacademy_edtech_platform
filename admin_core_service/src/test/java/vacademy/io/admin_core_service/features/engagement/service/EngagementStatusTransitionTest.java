package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * F3 (E2E scenario S19): engine status changes follow the same allow-list the dashboard shows.
 * ARCHIVED is terminal — an archived engine set back to ACTIVE would message its old audience.
 */
class EngagementStatusTransitionTest {

    private EngagementEngineRepository engines;
    private EngagementEngineService service;
    private EngagementEngine engine;

    @BeforeEach
    void setUp() {
        engines = mock(EngagementEngineRepository.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        service = new EngagementEngineService(engines, members, mock(EngagementPromptVersionRepository.class),
                mock(EngagementTemplateProposalRepository.class), mock(EngagementReadDao.class));
        engine = new EngagementEngine();
        engine.setId("e1");
        engine.setInstituteId("i1");
        engine.setCreatedBy("admin-1");
        engine.setChannels("{\"EMAIL\":{\"enabled\":true}}");
        when(engines.findById("e1")).thenReturn(Optional.of(engine));
        when(engines.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(members.countByEngineIdAndStatus(anyString(), anyString())).thenReturn(5L);
    }

    @ParameterizedTest(name = "{0} -> {1} allowed")
    @CsvSource({
            "DRAFT, DRY_RUN", "DRAFT, ACTIVE", "DRAFT, ARCHIVED",
            "TEMPLATES_PENDING, DRY_RUN", "TEMPLATES_PENDING, ACTIVE", "TEMPLATES_PENDING, ARCHIVED",
            "DRY_RUN, ACTIVE", "DRY_RUN, PAUSED", "DRY_RUN, ARCHIVED",
            "ACTIVE, PAUSED",
            "PAUSED, ACTIVE", "PAUSED, ARCHIVED"})
    void allowedMoves(String from, String to) {
        engine.setStatus(from);
        assertEquals(to, service.transition("e1", "i1", to).getStatus());
    }

    @ParameterizedTest(name = "{0} -> {1} refused")
    @CsvSource({
            "ARCHIVED, ACTIVE", "ARCHIVED, DRY_RUN", "ARCHIVED, PAUSED", "ARCHIVED, DRAFT",
            "ACTIVE, ARCHIVED", "ACTIVE, DRAFT", "ACTIVE, DRY_RUN",
            "PAUSED, DRAFT", "DRY_RUN, DRAFT"})
    void refusedMoves(String from, String to) {
        engine.setStatus(from);
        VacademyException ex = assertThrows(VacademyException.class, () -> service.transition("e1", "i1", to));
        assertTrue(ex.getMessage().contains("can't move from " + from + " to " + to), ex.getMessage());
        assertEquals(from, engine.getStatus());
        verify(engines, never()).save(any());
    }

    @Test
    @DisplayName("S19: an archived engine says why it can't be reopened")
    void S19_archivedIsTerminal() {
        engine.setStatus("ARCHIVED");
        VacademyException ex = assertThrows(VacademyException.class, () -> service.transition("e1", "i1", "ACTIVE"));
        assertTrue(ex.getMessage().contains("Archived engines are closed"), ex.getMessage());
    }

    @Test
    @DisplayName("a repeated click (same status) is a no-op, not an error")
    void sameStatusIsNoOp() {
        engine.setStatus("ACTIVE");
        assertEquals("ACTIVE", service.transition("e1", "i1", "ACTIVE").getStatus());
        verify(engines, never()).save(any());
    }

    @Test
    @DisplayName("an unknown target status is still refused before the allow-list")
    void unknownStatus() {
        engine.setStatus("DRAFT");
        assertThrows(VacademyException.class, () -> service.transition("e1", "i1", "BOGUS"));
    }
}
