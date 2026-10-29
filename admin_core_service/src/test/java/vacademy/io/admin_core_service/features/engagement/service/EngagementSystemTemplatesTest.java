package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiCallEngagementProvisioner;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** One dynamic template per institute and purpose: looked up first, created once, never per lead. */
class EngagementSystemTemplatesTest {

    private static final EngagementSystemTemplates.Kind K = EngagementSystemTemplates.Kind.MEETING_CONFIRMATION;
    private EngagementSystemTemplates svc;
    private EngagementTemplateProposalRepository repo;
    private EngagementTemplateProposalService proposalService;
    private EngagementChannelReadiness readiness;
    private vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository engines;

    private void liveEngine(String channels, String status) {
        var e = new vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine();
        e.setChannels(channels);
        e.setStatus(status);
        when(engines.findByInstituteIdOrderByCreatedAtDesc("i1")).thenReturn(List.of(e));
    }

    @BeforeEach
    void setUp() {
        svc = new EngagementSystemTemplates();
        repo = mock(EngagementTemplateProposalRepository.class);
        proposalService = mock(EngagementTemplateProposalService.class);
        readiness = mock(EngagementChannelReadiness.class);
        AiCallEngagementProvisioner provisioner = mock(AiCallEngagementProvisioner.class);
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute i = new Institute();
        i.setInstituteName("Tutezy");
        when(institutes.findById("i1")).thenReturn(Optional.of(i));
        when(provisioner.engineIdFor("i1")).thenReturn("sys-engine");
        when(repo.save(any())).thenAnswer(inv -> {
            EngagementTemplateProposal p = inv.getArgument(0);
            p.setId("p-new");
            return p;
        });
        ReflectionTestUtils.setField(svc, "proposals", repo);
        ReflectionTestUtils.setField(svc, "proposalService", proposalService);
        ReflectionTestUtils.setField(svc, "provisioner", provisioner);
        ReflectionTestUtils.setField(svc, "readiness", readiness);
        ReflectionTestUtils.setField(svc, "instituteRepository", institutes);
        engines = mock(vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository.class);
        ReflectionTestUtils.setField(svc, "engineRepository", engines);
        liveEngine("{\"WHATSAPP\":{\"enabled\":true,\"auto\":true}}", "ACTIVE");
        when(readiness.check("i1")).thenReturn(Map.of("WHATSAPP", new EngagementChannelReadiness.Readiness(true, null)));
    }

    private EngagementTemplateProposal row(String status) {
        EngagementTemplateProposal p = new EngagementTemplateProposal();
        p.setId("old");
        p.setName("meeting_confirmation_abc123");
        p.setLanguage("en");
        p.setStatus(status);
        p.setNotificationTemplateId("nt1");
        p.setVariableNames("[\"name\",\"institute\",\"meeting_time\",\"meeting_link\"]");
        return p;
    }

    @Test
    @DisplayName("an approved template of the institute, from any engine, is used as it is; nothing is created")
    void reusesApproved() {
        when(repo.findSystemTemplates("i1", K.purpose, "en")).thenReturn(List.of(row("META_APPROVED")));
        var s = svc.ensure("i1", K);
        assertTrue(s.usable());
        assertEquals("meeting_confirmation_abc123", s.name());
        verify(repo, never()).save(any());
        verifyNoInteractions(proposalService);
    }

    @Test
    @DisplayName("one still in review is waited for: a second is never started")
    void waitsForPending() {
        when(repo.findSystemTemplates("i1", K.purpose, "en")).thenReturn(List.of(row("META_PENDING")));
        var s = svc.ensure("i1", K);
        assertEquals(EngagementSystemTemplates.Status.PENDING, s.status());
        assertFalse(s.usable());
        verify(repo, never()).save(any());
    }

    @Test
    @DisplayName("none yet and WhatsApp set up: made once, with variables (not hard-coded text) and sent to Meta")
    void createsOnce() {
        when(repo.findSystemTemplates("i1", K.purpose, "en")).thenReturn(List.of());
        svc.ensure("i1", K);
        ArgumentCaptor<EngagementTemplateProposal> saved = ArgumentCaptor.forClass(EngagementTemplateProposal.class);
        verify(repo).save(saved.capture());
        EngagementTemplateProposal p = saved.getValue();
        assertEquals("sys-engine", p.getEngineId());
        assertEquals(K.purpose, p.getPurpose());
        assertEquals("UTILITY", p.getProposedCategory());
        assertTrue(p.getProposedBody().contains("{{1}}") && p.getProposedBody().contains("{{4}}"));
        assertTrue(p.getSampleValues().contains("Tutezy"), p.getSampleValues());
        assertTrue(p.getName().startsWith("meeting_confirmation_"));
        verify(proposalService).approve("p-new", "i1");
        verify(proposalService).submit("p-new", "i1", "system");
    }

    @Test
    @DisplayName("WhatsApp not set up for the institute: nothing is created")
    void noWhatsapp() {
        when(repo.findSystemTemplates("i1", K.purpose, "en")).thenReturn(List.of());
        when(readiness.check("i1")).thenReturn(Map.of("WHATSAPP", new EngagementChannelReadiness.Readiness(false, "NOT_SET_UP")));
        assertEquals(EngagementSystemTemplates.Status.UNAVAILABLE, svc.ensure("i1", K).status());
        verify(repo, never()).save(any());
    }

    @Test
    @DisplayName("an institute with WhatsApp but no engine using it never gets a template made behind its back")
    void noEngineNoTemplate() {
        when(repo.findSystemTemplates("i1", K.purpose, "en")).thenReturn(List.of());
        liveEngine("{\"EMAIL\":{\"enabled\":true}}", "ACTIVE");
        assertEquals(EngagementSystemTemplates.Status.UNAVAILABLE, svc.ensure("i1", K).status());
        liveEngine("{\"WHATSAPP\":{\"enabled\":true}}", "DRAFT");
        assertEquals(EngagementSystemTemplates.Status.UNAVAILABLE, svc.ensure("i1", K).status());
        verify(repo, never()).save(any());
    }

    @Test
    @DisplayName("both bodies are valid Meta templates: sequential placeholders, none at the start or end")
    void bodiesAreValid() {
        for (var k : EngagementSystemTemplates.Kind.values()) {
            assertNull(vacademy.io.admin_core_service.features.engagement.templates.WhatsAppTemplateRules.problem(k.body, null), k.name());
            assertEquals(k.variables.size(), k.samples.size());
        }
    }
}
