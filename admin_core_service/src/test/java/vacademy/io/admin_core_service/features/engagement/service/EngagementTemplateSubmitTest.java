package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The first "Submit to Meta" must leave the proposal tracked, never back at USER_APPROVED. It used
 * to save the copy read before the SUBMITTED claim (open-session-in-view), which wrote
 * USER_APPROVED back: Meta got the template, but the poll never looked at it again and a failed
 * submit lost its reason.
 */
class EngagementTemplateSubmitTest {

    private final ObjectMapper om = new ObjectMapper();
    private EngagementTemplateProposalRepository proposals;
    private EngagementInternalClients clients;
    private EngagementTemplateProposalService service;

    private EngagementTemplateProposal proposal(String status) {
        EngagementTemplateProposal p = new EngagementTemplateProposal();
        p.setId("p1");
        p.setEngineId("e1");
        p.setInstituteId("i1");
        p.setName("demo_invite");
        p.setLanguage("en");
        p.setProposedBody("Hi {{1}}, would a 15-minute demo be useful this week?");
        p.setProposedCategory("MARKETING");
        p.setVariableNames("[\"name\"]");
        p.setSampleValues("[\"Asha\"]");
        p.setStatus(status);
        return p;
    }

    @BeforeEach
    void setUp() throws Exception {
        proposals = mock(EngagementTemplateProposalRepository.class);
        clients = mock(EngagementInternalClients.class);
        service = new EngagementTemplateProposalService(proposals, mock(EngagementEngineRepository.class),
                mock(EngagementPromptVersionRepository.class), mock(EngagementTemplateAdvisor.class), clients);
        when(proposals.findByIdAndInstituteId("p1", "i1")).thenReturn(
                Optional.of(proposal("USER_APPROVED")),
                Optional.of(proposal("SUBMITTED")),
                Optional.of(proposal("META_PENDING")));
        when(proposals.claimForSubmit(eq("p1"), eq("i1"), any())).thenReturn(1);
        when(clients.getWhatsAppTemplateByName(eq("i1"), anyString(), anyString())).thenReturn(null);
        when(clients.createWhatsAppTemplateDraft(any())).thenReturn(om.readTree("{\"id\":\"t1\"}"));
        when(clients.getWhatsAppTemplate("t1")).thenReturn(om.readTree("{\"status\":\"DRAFT\"}"));
        when(proposals.stampSubmittedTemplateId(eq("p1"), eq("i1"), eq("t1"), any())).thenReturn(1);
        when(proposals.reconcileFromMeta(eq("p1"), anyString(), any(), any(), any())).thenReturn(1);
    }

    @Test
    void firstSubmitStampsTheTemplateAndIsTracked() throws Exception {
        when(clients.submitWhatsAppTemplate("t1")).thenReturn(om.readTree("{\"status\":\"PENDING\"}"));

        EngagementTemplateProposal result = service.submit("p1", "i1", "admin-1");

        verify(proposals).stampSubmittedTemplateId(eq("p1"), eq("i1"), eq("t1"), any());
        verify(proposals, never()).save(any());
        verify(proposals).reconcileFromMeta(eq("p1"), eq("META_PENDING"), any(), any(), any());
        verify(proposals, never()).rollbackSubmit(anyString(), any(), anyString(), any());
        assertEquals("META_PENDING", result.getStatus());
    }

    @Test
    void aFailedSubmitKeepsItsReason() {
        when(clients.submitWhatsAppTemplate("t1")).thenThrow(new RuntimeException("WhatsApp is not connected"));

        assertThrows(VacademyException.class, () -> service.submit("p1", "i1", "admin-1"));

        verify(proposals).rollbackSubmit(eq("p1"), isNull(),
                argThat(reason -> reason.contains("WhatsApp is not connected")), any());
        verify(proposals, never()).save(any());
    }
}
