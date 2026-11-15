package vacademy.io.admin_core_service.features.telephony.demo;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.common.institute.entity.Institute;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AiDemoCallServiceTest {

    private static final String INST = "inst-1";

    @Mock AiDemoCallRequestRepository repo;
    @Mock InstituteRepository instituteRepository;
    @Mock InstituteSettingService instituteSettingService;
    @Mock TelephonyCallLogRepository callLogRepo;

    AiDemoCallService service;

    @BeforeEach
    void setUp() {
        service = new AiDemoCallService(repo, instituteRepository, instituteSettingService, callLogRepo);
        when(instituteRepository.findById(INST)).thenReturn(Optional.of(mock(Institute.class)));
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
    }

    private void setting(Map<String, Object> data) {
        when(instituteSettingService.getSettingData(any(), eq("AI_DEMO_CALL_SETTING"))).thenReturn(data);
    }

    private void enabled() {
        setting(Map.of("enabled", true, "agentId", "agent-demo", "dialNumber", "+918035614126"));
    }

    private static TelephonyCallLog inbound(String from) {
        TelephonyCallLog row = mock(TelephonyCallLog.class);
        when(row.getId()).thenReturn("corr-1");
        when(row.getInstituteId()).thenReturn(INST);
        when(row.getDirection()).thenReturn("INBOUND");
        when(row.getFromNumber()).thenReturn(from);
        return row;
    }

    // phone and text helpers

    @Test
    void indianMobileAcceptsCommonSpellingsAndRejectsTheRest() {
        assertEquals("9876543210", AiDemoCallService.indianMobile("9876543210"));
        assertEquals("9876543210", AiDemoCallService.indianMobile("+91 98765 43210"));
        assertEquals("9876543210", AiDemoCallService.indianMobile("09876543210"));
        assertEquals("9876543210", AiDemoCallService.indianMobile("919876543210"));
        assertNull(AiDemoCallService.indianMobile("5876543210"));
        assertNull(AiDemoCallService.indianMobile("98765"));
        assertNull(AiDemoCallService.indianMobile("+1 415 555 0100"));
        assertNull(AiDemoCallService.indianMobile(null));
    }

    @Test
    void lastTenMatchesPlivoCallerIdFormats() {
        assertEquals("9876543210", AiDemoCallService.lastTen("919876543210"));
        assertEquals("9876543210", AiDemoCallService.lastTen("+919876543210"));
        assertNull(AiDemoCallService.lastTen("12345"));
    }

    @Test
    void cleanStripsPlaceholderBracesAndCaps() {
        assertEquals("A name B", AiDemoCallService.clean("A{{name}}B", 120));
        assertEquals("Sunrise School", AiDemoCallService.clean("  Sunrise   School ", 120));
        assertEquals(5, AiDemoCallService.clean("abcdefgh", 5).length());
        assertNull(AiDemoCallService.clean("   ", 10));
    }

    // settings

    @Test
    void builtInLanguagesCoverTheExhibitionList() {
        AiDemoCallSettings s = new AiDemoCallSettings();
        List<String> codes = s.effectiveLanguages().stream().map(AiDemoCallSettings.Language::getCode).toList();
        assertTrue(codes.containsAll(List.of("english", "hindi", "hinglish", "malayalam", "kannada", "tamil")));
        for (AiDemoCallSettings.Language l : s.effectiveLanguages()) {
            assertTrue(l.getOpeningLine().contains("{{institute_name}}"), l.getCode());
            assertTrue(l.getOpeningLine().contains("{{name}}"), l.getCode());
            assertNotNull(l.getVoice(), l.getCode());
        }
    }

    @Test
    void configuredLanguageInheritsBuiltInGapsAndKeepsOrder() {
        AiDemoCallSettings s = new AiDemoCallSettings();
        AiDemoCallSettings.Language tamil = new AiDemoCallSettings.Language();
        tamil.setCode("Tamil");
        tamil.setVoice("ta-IN-PallaviNeural");
        tamil.setTtsModel("edge");
        AiDemoCallSettings.Language english = new AiDemoCallSettings.Language();
        english.setCode("english");
        s.setLanguages(List.of(tamil, english));
        List<AiDemoCallSettings.Language> eff = s.effectiveLanguages();
        assertEquals(List.of("tamil", "english"), eff.stream().map(AiDemoCallSettings.Language::getCode).toList());
        assertEquals("ta-IN-PallaviNeural", eff.get(0).getVoice());
        assertEquals("edge", eff.get(0).getTtsModel());
        assertEquals("Tamil", eff.get(0).getLabel());
        assertTrue(eff.get(0).getOpeningLine().contains("{{institute_name}}"));
        assertEquals("ipsita", eff.get(1).getVoice());
    }

    // create request

    @Test
    void createRequestSupersedesOlderAndStoresLastTen() {
        enabled();
        AiDemoCallRequest r = service.createRequest(INST, "Anil Kumar", "Sunrise School",
                "+91 98765 43210", "Tamil", "qr", "1.2.3.4");
        verify(repo).supersedePending(INST, "9876543210");
        assertEquals("9876543210", r.getPhone());
        assertEquals("tamil", r.getLanguage());
        assertEquals(AiDemoCallRequest.PENDING, r.getStatus());
        assertTrue(r.getExpiresAt().after(r.getCreatedAt()));
    }

    @Test
    void createRequestRejectsWhenDisabledOrInvalid() {
        setting(Map.of("enabled", false));
        var paused = assertThrows(AiDemoCallService.DemoCallException.class,
                () -> service.createRequest(INST, "Anil", "Org", "9876543210", "tamil", null, null));
        assertEquals(409, paused.getStatus());

        enabled();
        assertEquals(400, assertThrows(AiDemoCallService.DemoCallException.class,
                () -> service.createRequest(INST, "Anil", "Org", "123", "tamil", null, null)).getStatus());
        assertEquals(400, assertThrows(AiDemoCallService.DemoCallException.class,
                () -> service.createRequest(INST, "Anil", "Org", "9876543210", "klingon", null, null)).getStatus());
        assertEquals(400, assertThrows(AiDemoCallService.DemoCallException.class,
                () -> service.createRequest(INST, "Anil", " ", "9876543210", "tamil", null, null)).getStatus());
        verify(repo, never()).save(any());
    }

    // bind on inbound

    private AiDemoCallRequest pending() {
        return AiDemoCallRequest.builder().id("req-1").instituteId(INST).phone("9876543210")
                .visitorName("Anil Kumar").organisation("Sunrise School").language("tamil")
                .status(AiDemoCallRequest.PENDING)
                .createdAt(Timestamp.from(Instant.now()))
                .expiresAt(Timestamp.from(Instant.now().plusSeconds(600))).build();
    }

    @Test
    void bindInboundClaimsTheCallersPendingRequest() {
        enabled();
        when(repo.findFirstByCallLogId("corr-1")).thenReturn(Optional.empty());
        when(repo.findFirstByInstituteIdAndPhoneAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                eq(INST), eq("9876543210"), eq("PENDING"), any())).thenReturn(Optional.of(pending()));
        when(repo.bind(eq("req-1"), eq("corr-1"), any())).thenReturn(1);

        var b = service.bindInbound(inbound("919876543210")).orElseThrow();
        assertEquals("agent-demo", b.agentId());
        assertEquals("tamil", b.language().getCode());
        assertEquals("Sunrise School", b.leadFields().get("institute name"));
    }

    @Test
    void bindInboundIsIdempotentForTheSameCall() {
        enabled();
        AiDemoCallRequest bound = pending();
        bound.setStatus(AiDemoCallRequest.CONNECTED);
        bound.setCallLogId("corr-1");
        when(repo.findFirstByCallLogId("corr-1")).thenReturn(Optional.of(bound));
        assertTrue(service.bindInbound(inbound("919876543210")).isPresent());
        verify(repo, never()).bind(any(), any(), any());
    }

    @Test
    void bindInboundSkipsOutboundUnknownLostRaceAndDisabled() {
        enabled();
        TelephonyCallLog out = inbound("919876543210");
        when(out.getDirection()).thenReturn("OUTBOUND");
        assertTrue(service.bindInbound(out).isEmpty());

        when(repo.findFirstByCallLogId(any())).thenReturn(Optional.empty());
        when(repo.findFirstByInstituteIdAndPhoneAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                any(), any(), any(), any())).thenReturn(Optional.empty());
        assertTrue(service.bindInbound(inbound("919876543210")).isEmpty());

        when(repo.findFirstByInstituteIdAndPhoneAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                any(), any(), any(), any())).thenReturn(Optional.of(pending()));
        when(repo.bind(any(), any(), any())).thenReturn(0);
        assertTrue(service.bindInbound(inbound("919876543210")).isEmpty());

        setting(Map.of("enabled", false));
        assertTrue(service.bindInbound(inbound("919876543210")).isEmpty());
    }

    @Test
    void bindInboundNeverThrows() {
        when(instituteSettingService.getSettingData(any(), any())).thenThrow(new RuntimeException("bad json"));
        assertTrue(service.bindInbound(inbound("919876543210")).isEmpty());
    }

    // rate limiter

    @Test
    void rateLimiterCapsPerPhoneButLetsASharedIpThrough() {
        AiDemoCallRateLimiter rl = new AiDemoCallRateLimiter();
        Instant t = Instant.parse("2026-11-20T10:00:00Z");
        for (int i = 0; i < AiDemoCallRateLimiter.PHONE_PER_10_MIN; i++) {
            assertTrue(rl.tryAcquire(INST, "9876543210", "10.0.0.1", t));
        }
        assertFalse(rl.tryAcquire(INST, "9876543210", "10.0.0.1", t));
        for (int i = 0; i < 20; i++) {
            assertTrue(rl.tryAcquire(INST, String.valueOf(9000000000L + i), "10.0.0.1", t));
        }
        assertTrue(rl.tryAcquire(INST, "9876543210", "10.0.0.1", t.plusSeconds(601)));
    }
}
