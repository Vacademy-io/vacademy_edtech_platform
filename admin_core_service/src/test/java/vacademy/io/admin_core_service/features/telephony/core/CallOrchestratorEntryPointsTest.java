package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityCallRecorder;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallResponseDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundCallInitiator;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.spi.dto.BridgeCallRequest;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationContext;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationPlan;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OutboundCallHandle;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The dashboard's click-to-call and the public API's counsellor call share one dial path.
 * The refactor that added the API path ({@link CallOrchestrator#assertCanDial}, {@link CallOrchestrator#dispatchPrepared}) must leave the
 * dashboard's {@link CallOrchestrator#connect} exactly as it was: the same INITIATED row
 * (no subject type), the same origination context, the same bridge request, the same
 * response. The API path differs only in who the counsellor is and the subject it files.
 * Real CallLifecycleTxOps, mocked edges (repositories, provider).
 */
class CallOrchestratorEntryPointsTest {

    private final TelephonyCallLogRepository logs = mock(TelephonyCallLogRepository.class);
    private final AudienceResponseRepository leads = mock(AudienceResponseRepository.class);
    private final TelephonyProviderRegistry registry = mock(TelephonyProviderRegistry.class);
    private final TelephonyConfigCache cache = mock(TelephonyConfigCache.class);
    private final OutboundOriginationResolver resolver = mock(OutboundOriginationResolver.class);
    private final OutboundCallInitiator initiator = mock(OutboundCallInitiator.class);
    private final CreditClient credits = mock(CreditClient.class);
    private final CallOrchestrator orchestrator = new CallOrchestrator();
    private final CallLifecycleTxOps tx;

    CallOrchestratorEntryPointsTest() {
        tx = new CallLifecycleTxOps();
        ReflectionTestUtils.setField(tx, "callLogRepo", logs);
        ReflectionTestUtils.setField(tx, "audienceResponseRepo", leads);
        ReflectionTestUtils.setField(tx, "registry", registry);
        ReflectionTestUtils.setField(tx, "userMobileResolver", mock(UserMobileResolver.class));
        ReflectionTestUtils.setField(tx, "configCache", cache);
        ReflectionTestUtils.setField(tx, "webhookBase", "https://hooks.example");
        ReflectionTestUtils.setField(orchestrator, "tx", tx);
        ReflectionTestUtils.setField(orchestrator, "registry", registry);
        ReflectionTestUtils.setField(orchestrator, "eventBus", mock(CallEventBus.class));
        ReflectionTestUtils.setField(orchestrator, "liveActivityCallRecorder", mock(LiveActivityCallRecorder.class));
        ReflectionTestUtils.setField(orchestrator, "circuitBreaker", mock(ProviderCircuitBreaker.class));
        ReflectionTestUtils.setField(orchestrator, "configCache", cache);
        ReflectionTestUtils.setField(orchestrator, "callLogRepo", logs);
        ReflectionTestUtils.setField(orchestrator, "creditClient", credits);
        ReflectionTestUtils.setField(orchestrator, "voiceCreditGateEnabled", true);

        InstituteTelephonyConfig cfg = InstituteTelephonyConfig.builder().instituteId("inst-1")
                .providerType("PLIVO").enabled(true).recordCalls(true).defaultSelectorKey("ROUND_ROBIN").build();
        when(cache.get("inst-1")).thenReturn(Optional.of(TelephonyConfigCache.Resolved.builder()
                .config(cfg).webhookToken("tok").enabledNumbers(List.of()).build()));
        when(registry.originationResolver("PLIVO")).thenReturn(resolver);
        when(registry.initiator("PLIVO")).thenReturn(initiator);
        when(registry.descriptor("PLIVO")).thenReturn(Optional.empty());
        when(resolver.resolve(any())).thenReturn(OriginationPlan.builder()
                .from("+919800000001").callerId("+918000000000").providerNumberId("num-1").build());
        when(initiator.initiate(any(), any())).thenReturn(OutboundCallHandle.builder().providerCallId("uuid-1").build());
        when(credits.readBalance("inst-1")).thenReturn(Optional.of(50.0));
        when(logs.findById(anyString())).thenAnswer(i -> Optional.of(TelephonyCallLog.builder()
                .id(i.getArgument(0)).status("INITIATED").build()));

        AudienceResponse lead = new AudienceResponse();
        lead.setId("resp-1");
        lead.setAudienceId("campaign-1");
        lead.setUserId("lead-user");
        lead.setParentMobile("+919876543210");
        when(leads.findById("resp-1")).thenReturn(Optional.of(lead));
        when(leads.isLeadInInstitute("resp-1", "inst-1")).thenReturn(true);
    }

    private static CustomUserDetails counsellor() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("c-1");
        dto.setUsername("c-1");
        dto.setAuthorities(List.of("TEACHER"));
        return new CustomUserDetails(dto);
    }

    private TelephonyCallLog insertedRow() {
        ArgumentCaptor<TelephonyCallLog> row = ArgumentCaptor.forClass(TelephonyCallLog.class);
        verify(logs, atLeastOnce()).save(row.capture());
        return row.getAllValues().get(0);
    }

    @Test
    void theDashboardPathIsUnchanged() {
        ConnectCallRequestDTO req = new ConnectCallRequestDTO();
        req.setInstituteId("inst-1");
        req.setResponseId("resp-1");
        req.setPreferredNumberId("num-1");
        ConnectCallResponseDTO resp = orchestrator.connect(req, counsellor());

        TelephonyCallLog row = insertedRow();
        assertEquals("c-1", row.getCounsellorUserId());
        assertEquals("lead-user", row.getUserId());
        assertEquals("resp-1", row.getResponseId());
        assertNull(row.getSubjectType(), "the dashboard never stored a subject type");
        assertNull(row.getSubjectId());
        assertEquals("OUTBOUND", row.getDirection());
        assertEquals("+919876543210", row.getToNumber());
        assertEquals("+919800000001", row.getFromNumber());
        assertEquals("num-1", row.getProviderNumberId());

        ArgumentCaptor<OriginationContext> ctx = ArgumentCaptor.forClass(OriginationContext.class);
        verify(resolver).resolve(ctx.capture());
        assertEquals("c-1", ctx.getValue().getCounsellorUserId());
        assertEquals("num-1", ctx.getValue().getPreferredNumberId());
        assertEquals("ROUND_ROBIN", ctx.getValue().getSelectorKey());

        ArgumentCaptor<BridgeCallRequest> bridge = ArgumentCaptor.forClass(BridgeCallRequest.class);
        verify(initiator).initiate(bridge.capture(), any());
        assertEquals("+919876543210", bridge.getValue().getTo());
        assertTrue(bridge.getValue().isRecord());
        assertEquals(row.getId(), bridge.getValue().getCorrelationId());
        assertEquals("https://hooks.example/admin-core-service/v1/telephony/webhook/status?provider=PLIVO&corr="
                + row.getId() + "&token=tok", bridge.getValue().getStatusCallbackUrl());

        assertEquals(row.getId(), resp.getCallLogId());
        assertEquals("QUEUED", resp.getStatus());
        assertEquals("resp-1", resp.getResponseId());
        assertEquals("+918000000000", resp.getCallerId());
        assertTrue(resp.isRealtimeEvents());
    }

    /** The API's sequence: credit gate, reserve (the tx part), then dispatch outside it. */
    private ConnectCallResponseDTO apiCall(String counsellor, CallLifecycleTxOps.DialTarget target) {
        orchestrator.assertCanDial("inst-1");
        CallOrchestrator.Prepared p = tx.prepareAndPersistForCounsellor("inst-1", counsellor, target);
        return orchestrator.dispatchPrepared(p);
    }

    @Test
    void theApiPathNamesTheCounsellorAndFilesAnApiContact() {
        ConnectCallResponseDTO resp = apiCall("c-7",
                new CallLifecycleTxOps.DialTarget(null, "pseudo-user", "+919876543210", "API_CONTACT", "hcall_1"));
        TelephonyCallLog row = insertedRow();
        assertEquals("c-7", row.getCounsellorUserId());
        assertEquals("pseudo-user", row.getUserId());
        assertNull(row.getResponseId());
        assertEquals("API_CONTACT", row.getSubjectType());
        assertEquals("hcall_1", row.getSubjectId());
        assertEquals(row.getId(), resp.getCallLogId());
        verify(initiator).initiate(any(), any());
        verifyNoInteractions(leads);
    }

    @Test
    void theProviderDialIsNeverInsideATransaction() throws Exception {
        // The API reserves the call under advisory locks in a transaction; the HTTP dial must
        // run after that commits, so neither the orchestrator's dial nor its gate is transactional.
        for (String name : new String[]{"dispatchPrepared", "assertCanDial", "connect"}) {
            for (java.lang.reflect.Method m : CallOrchestrator.class.getMethods()) {
                if (m.getName().equals(name)) {
                    assertNull(m.getAnnotation(org.springframework.transaction.annotation.Transactional.class), name);
                }
            }
        }
        assertNull(CallOrchestrator.class.getAnnotation(org.springframework.transaction.annotation.Transactional.class));
        assertNotNull(CallLifecycleTxOps.class.getMethod("prepareAndPersistForCounsellor", String.class, String.class,
                CallLifecycleTxOps.DialTarget.class).getAnnotation(org.springframework.transaction.annotation.Transactional.class));
    }

    @Test
    void aDispatchStoppedBeforeTheProviderClosesItsRow() {
        TelephonyCallLog initiated = TelephonyCallLog.builder().id("log-x").status("INITIATED").build();
        when(logs.findById("log-x")).thenReturn(Optional.of(initiated));
        tx.markFailedIfNotDispatched("log-x", "dispatch_failed");
        assertEquals("FAILED", initiated.getStatus());
        TelephonyCallLog answered = TelephonyCallLog.builder().id("log-y").status("IN_PROGRESS").build();
        when(logs.findById("log-y")).thenReturn(Optional.of(answered));
        tx.markFailedIfNotDispatched("log-y", "dispatch_failed");
        assertEquals("IN_PROGRESS", answered.getStatus());
    }

    @Test
    void bothPathsShareTheVoiceCreditGate() {
        when(credits.readBalance("inst-1")).thenReturn(Optional.of(0.0));
        ConnectCallRequestDTO req = new ConnectCallRequestDTO();
        req.setInstituteId("inst-1");
        req.setResponseId("resp-1");
        assertThrows(ConflictException.class, () -> orchestrator.connect(req, counsellor()));
        assertThrows(ConflictException.class, () -> orchestrator.assertCanDial("inst-1"));
        verifyNoInteractions(initiator);
        verify(logs, never()).save(any());
    }
}
