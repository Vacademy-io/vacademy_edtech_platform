package vacademy.io.admin_core_service.features.telephony.demo;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AiDemoCallServiceTest {

    private static final String INST = "inst-1";
    private static final String AUD = "aud-1";
    private static final String DEMO_JSON = "{\"formAppearance\":{},\"tryAiCall\":{\"agentId\":\"agent-demo\"}}";

    @Mock AudienceResponseRepository audienceResponseRepository;
    @Mock AudienceRepository audienceRepository;
    @Mock TelephonyCallLogRepository callLogRepo;
    @Mock AudienceService audienceService;
    @InjectMocks AiDemoCallService service;

    private Audience audience;
    private AudienceResponse lead;

    @BeforeEach
    void setUp() {
        audience = mock(Audience.class);
        when(audience.getSettingJson()).thenReturn(DEMO_JSON);
        when(audienceRepository.findById(AUD)).thenReturn(Optional.of(audience));

        lead = mock(AudienceResponse.class);
        when(lead.getId()).thenReturn("lead-1");
        when(lead.getUserId()).thenReturn("user-1");
        when(lead.getAudienceId()).thenReturn(AUD);
        when(lead.getParentName()).thenReturn("Anil Kumar");
        when(lead.getSubmittedAt()).thenReturn(Timestamp.from(Instant.now().minusSeconds(60)));
        when(audienceResponseRepository.findById("lead-1")).thenReturn(Optional.of(lead));
        when(audienceService.getLeadCustomFields("lead-1")).thenReturn(
                Map.of("Full Name", "Anil Kumar", "Organisation", "Sunrise {{x}} School", "Language", "Tamil"));
    }

    private static TelephonyCallLog inbound(String from, String responseId) {
        TelephonyCallLog row = mock(TelephonyCallLog.class);
        when(row.getId()).thenReturn("corr-1");
        when(row.getInstituteId()).thenReturn(INST);
        when(row.getDirection()).thenReturn("INBOUND");
        when(row.getFromNumber()).thenReturn(from);
        when(row.getResponseId()).thenReturn(responseId);
        return row;
    }

    private void leadFound() {
        when(audienceResponseRepository.findLatestTryAiCallLead(eq(INST), eq("9876543210"), any()))
                .thenReturn(Optional.of(lead));
    }

    @Test
    void bindsCallerToTheirDemoLeadAndAttributesTheCall() {
        leadFound();
        var b = service.bindInbound(inbound("919876543210", null)).orElseThrow();
        assertEquals("agent-demo", b.agentId());
        assertEquals("tamil", b.language().code());
        assertEquals("kayal", b.language().voice());
        assertEquals("Anil Kumar", b.visitorName());
        assertFalse(b.organisation().contains("{"), "braces would read as bot placeholders");
        assertEquals(b.organisation(), b.leadFields().get("institute name"));
        verify(callLogRepo).attachLeadIfUnattributed("corr-1", "lead-1", "user-1");
    }

    @Test
    void neverOverwritesAnExistingAttribution() {
        leadFound();
        assertTrue(service.bindInbound(inbound("919876543210", "other-lead")).isPresent());
        verify(callLogRepo, never()).attachLeadIfUnattributed(any(), any(), any());
    }

    @Test
    void missingLanguageFallsBackToHinglishAndMissingAgentToNull() {
        leadFound();
        when(audienceService.getLeadCustomFields("lead-1")).thenReturn(Map.of("Organisation", "Sunrise"));
        when(audience.getSettingJson()).thenReturn("{\"tryAiCall\":{}}");
        var b = service.bindInbound(inbound("919876543210", null)).orElseThrow();
        assertEquals("hinglish", b.language().code());
        assertNull(b.agentId());
        assertEquals("Anil Kumar", b.visitorName());
    }

    @Test
    void skipsOutboundUnknownCallersAndNeverThrows() {
        TelephonyCallLog out = inbound("919876543210", null);
        when(out.getDirection()).thenReturn("OUTBOUND");
        assertTrue(service.bindInbound(out).isEmpty());

        when(audienceResponseRepository.findLatestTryAiCallLead(any(), any(), any())).thenReturn(Optional.empty());
        assertTrue(service.bindInbound(inbound("919876543210", null)).isEmpty());
        assertTrue(service.bindInbound(inbound("12345", null)).isEmpty());

        when(audienceResponseRepository.findLatestTryAiCallLead(any(), any(), any()))
                .thenThrow(new RuntimeException("db down"));
        assertTrue(service.bindInbound(inbound("919876543210", null)).isEmpty());
    }

    @Test
    void statusFollowsTheLeadsInboundCall() {
        assertEquals("PENDING", service.status("lead-1").orElseThrow());

        TelephonyCallLog call = mock(TelephonyCallLog.class);
        when(call.getCreatedAt()).thenReturn(Timestamp.from(Instant.now()));
        when(call.getStatus()).thenReturn("IN_PROGRESS");
        when(callLogRepo.findFirstByResponseIdAndDirectionOrderByCreatedAtDesc("lead-1", "INBOUND"))
                .thenReturn(Optional.of(call));
        assertEquals("CONNECTED", service.status("lead-1").orElseThrow());

        when(call.getStatus()).thenReturn("COMPLETED");
        assertEquals("ENDED", service.status("lead-1").orElseThrow());
    }

    @Test
    void statusRevealsNothingOutsideADemoList() {
        when(audience.getSettingJson()).thenReturn("{\"formAppearance\":{}}");
        assertTrue(service.status("lead-1").isEmpty());
        assertTrue(service.status("nope").isEmpty());
    }

    @Test
    void languageLookupAcceptsLabelOrCode() {
        assertEquals("malayalam", AiDemoCallLanguages.find(" Malayalam ").orElseThrow().code());
        assertEquals("kannada", AiDemoCallLanguages.find("kannada").orElseThrow().code());
        assertTrue(AiDemoCallLanguages.find("klingon").isEmpty());
        for (AiDemoCallLanguages.Language l : AiDemoCallLanguages.ALL) {
            assertTrue(l.openingLine().contains("{{institute_name}}"), l.code());
        }
    }

    @Test
    void lastTenMatchesPlivoCallerIdFormats() {
        assertEquals("9876543210", AiDemoCallService.lastTen("919876543210"));
        assertEquals("9876543210", AiDemoCallService.lastTen("+91 98765 43210"));
        assertNull(AiDemoCallService.lastTen("12345"));
    }
}
