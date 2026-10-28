package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.dto.CreateEngineRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Editing, archiving and permanently deleting an engine. */
class EngagementEngineEditDeleteTest {

    private EngagementEngineRepository engines;
    private EngagementMemberRepository members;
    private EngagementEngineDeletionDao deletion;
    private EngagementReadDao readDao;
    private EngagementEngineService service;
    private EngagementEngine engine;

    @BeforeEach
    void setUp() {
        engines = mock(EngagementEngineRepository.class);
        members = mock(EngagementMemberRepository.class);
        readDao = mock(EngagementReadDao.class);
        deletion = mock(EngagementEngineDeletionDao.class);
        service = new EngagementEngineService(engines, members, mock(EngagementPromptVersionRepository.class),
                mock(EngagementTemplateProposalRepository.class), readDao);
        ReflectionTestUtils.setField(service, "deletionDao", deletion);
        engine = new EngagementEngine();
        engine.setId("e1");
        engine.setInstituteId("i1");
        engine.setName("Old");
        engine.setStatus("ACTIVE");
        engine.setCreatedBy("admin-1");
        engine.setAudience("[{\"type\":\"PACKAGE_SESSION\",\"id\":\"ps1\"}]");
        engine.setChannels("{\"EMAIL\":{\"enabled\":true}}");
        when(engines.findById("e1")).thenReturn(Optional.of(engine));
        when(engines.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    @DisplayName("edit changes only the fields sent")
    void editKeepsUnsentFields() {
        CreateEngineRequest req = new CreateEngineRequest();
        req.setName("  New name ");
        req.setCadenceHours(48);
        req.setHoldoutPct(150);
        EngagementEngine out = service.update("e1", "i1", req, "admin");
        assertEquals("New name", out.getName());
        assertEquals(48, out.getCadenceHours());
        assertEquals(100, out.getHoldoutPct());
        assertEquals("{\"EMAIL\":{\"enabled\":true}}", out.getChannels());
    }

    @Test
    @DisplayName("edit validates like create")
    void editValidates() {
        CreateEngineRequest blank = new CreateEngineRequest();
        blank.setName(" ");
        assertThrows(VacademyException.class, () -> service.update("e1", "i1", blank, "a"));
        CreateEngineRequest lang = new CreateEngineRequest();
        lang.setLanguage("fr");
        assertThrows(VacademyException.class, () -> service.update("e1", "i1", lang, "a"));
        CreateEngineRequest cadence = new CreateEngineRequest();
        cadence.setCadenceHours(0);
        assertThrows(VacademyException.class, () -> service.update("e1", "i1", cadence, "a"));
        CreateEngineRequest aud = new CreateEngineRequest();
        aud.setAudience("[{\"type\":\"ROLE\",\"id\":\"x\"}]");
        assertThrows(VacademyException.class, () -> service.update("e1", "i1", aud, "a"));
    }

    @Test
    @DisplayName("firstN -1 clears the override back to the default")
    void firstNClears() {
        engine.setFirstN(3);
        CreateEngineRequest req = new CreateEngineRequest();
        req.setFirstN(-1);
        assertNull(service.update("e1", "i1", req, "a").getFirstN());
    }

    @Test
    @DisplayName("a changed audience is re-resolved right away when the engine has members")
    void audienceChangeReconciles() {
        when(members.countByEngineIdAndStatus("e1", "ACTIVE")).thenReturn(4L);
        when(readDao.userIdsByPackageSession(anyString(), anyString())).thenReturn(List.of());
        CreateEngineRequest req = new CreateEngineRequest();
        req.setAudience("[{\"type\":\"PACKAGE_SESSION\",\"id\":\"ps2\"}]");
        service.update("e1", "i1", req, "a");
        verify(readDao).userIdsByPackageSession("ps2", "i1");
        verify(members).exitNotStampedBy(eq("e1"), anyString(), any());
    }

    @Test
    @DisplayName("the same audience sent again does not re-resolve")
    void sameAudienceNoReconcile() {
        when(members.countByEngineIdAndStatus("e1", "ACTIVE")).thenReturn(4L);
        CreateEngineRequest req = new CreateEngineRequest();
        req.setAudience("[{\"type\":\"PACKAGE_SESSION\",\"id\":\"ps1\"}]");
        service.update("e1", "i1", req, "a");
        verify(readDao, never()).userIdsByPackageSession(anyString(), anyString());
    }

    @Test
    @DisplayName("archived and system engines can't be edited")
    void editRefusals() {
        engine.setStatus("ARCHIVED");
        assertThrows(VacademyException.class, () -> service.update("e1", "i1", new CreateEngineRequest(), "a"));
        engine.setStatus("ACTIVE");
        engine.setCreatedBy(EngagementEngine.CREATED_BY_SYSTEM_AI_CALL);
        assertThrows(VacademyException.class, () -> service.update("e1", "i1", new CreateEngineRequest(), "a"));
    }

    @Test
    @DisplayName("another institute's engine can't be edited")
    void editOtherInstitute() {
        assertThrows(VacademyException.class, () -> service.update("e1", "i2", new CreateEngineRequest(), "a"));
    }

    @Test
    @DisplayName("archive works from ACTIVE (stopping is always allowed) and is idempotent")
    void archiveFromActive() {
        assertEquals("ARCHIVED", service.archive("e1", "i1").getStatus());
        assertEquals("ARCHIVED", service.archive("e1", "i1").getStatus());
    }

    @Test
    void archiveSystemEngineRefused() {
        engine.setCreatedBy(EngagementEngine.CREATED_BY_SYSTEM_AI_CALL);
        assertThrows(VacademyException.class, () -> service.archive("e1", "i1"));
    }

    @Test
    @DisplayName("permanent delete: only an engine that never reached anyone")
    void permanentDeleteGuards() {
        assertTrue(assertThrows(VacademyException.class, () -> service.deletePermanently("e1", "i1"))
                .getMessage().contains("Pause or archive"));
        engine.setStatus("ARCHIVED");
        when(deletion.countReachedPeople("e1")).thenReturn(2L);
        assertTrue(assertThrows(VacademyException.class, () -> service.deletePermanently("e1", "i1"))
                .getMessage().contains("already messaged"));
        when(deletion.countReachedPeople("e1")).thenReturn(0L);
        when(deletion.countTemplatesAtMeta("e1")).thenReturn(1L);
        assertTrue(assertThrows(VacademyException.class, () -> service.deletePermanently("e1", "i1"))
                .getMessage().contains("templates at Meta"));
        verify(deletion, never()).deleteEngineRows(anyString(), anyString());

        when(deletion.countTemplatesAtMeta("e1")).thenReturn(0L);
        engine.setStatus("DRAFT");
        service.deletePermanently("e1", "i1");
        verify(deletion).deleteEngineRows("e1", "i1");
    }
}
