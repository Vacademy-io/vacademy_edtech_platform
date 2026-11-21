package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** AI decisions are charged by their tokens; a charged message the provider refused is refunded once. */
class EngagementBillingJobTest {

    private EngagementActionRepository actions;
    private CreditClient credits;
    private EngagementBillingJob job;

    @BeforeEach
    void setUp() {
        actions = mock(EngagementActionRepository.class);
        credits = mock(CreditClient.class);
        job = new EngagementBillingJob(actions, credits);
        ReflectionTestUtils.setField(job, "batch", 50);
        ReflectionTestUtils.setField(job, "chargeDecisions", true);
        ReflectionTestUtils.setField(job, "perMessageCredits", BigDecimal.ONE);
    }

    private static EngagementAction decision(String id, String kind) {
        EngagementAction a = new EngagementAction();
        a.setId(id);
        a.setInstituteId("inst-1");
        a.setEngineId("eng-1");
        a.setMemberId("mem-1");
        a.setKind(kind);
        a.setLlmModel("some/model");
        a.setLlmTokensIn(2000);
        a.setLlmTokensOut(200);
        return a;
    }

    @Test
    @DisplayName("an AI decision is charged by its tokens, keyed by the action, and stamped when acknowledged")
    void chargesDecision() {
        when(actions.findUnbilledDecisions(50)).thenReturn(List.of(decision("a1", "NO_OP")));
        when(credits.deductAttributedTokenUsage(any(), any(), any(), anyInt(), anyInt(), any(), any(), any(), any(),
                any(), any(), any(), anyBoolean(), any())).thenReturn(true);

        assertEquals(1, job.chargeDecisions(Instant.now()));

        var metering = org.mockito.ArgumentCaptor.forClass(MeteringFields.class);
        verify(credits).deductAttributedTokenUsage(eq("inst-1"), eq("engagement_decision"), eq("some/model"),
                eq(2000), eq(200), isNull(), isNull(), eq("SYSTEM"), isNull(), contains("waited"), isNull(),
                eq("engagement-llm:a1"), eq(true), metering.capture());
        assertEquals("engagement_decision", metering.getValue().useCase());
        assertEquals("eng-1", metering.getValue().usageContext().get("engine_id"));
        verify(actions).markLlmBilled(eq("a1"), any());
    }

    @Test
    @DisplayName("a charge ai_service did not acknowledge stays unbilled for the next run")
    void unacknowledgedChargeRetries() {
        when(actions.findUnbilledDecisions(50)).thenReturn(List.of(decision("a1", "TASK"), decision("a2", "REPLY")));
        when(credits.deductAttributedTokenUsage(any(), any(), any(), anyInt(), anyInt(), any(), any(), any(), any(),
                any(), any(), eq("engagement-llm:a1"), anyBoolean(), any())).thenReturn(false);
        when(credits.deductAttributedTokenUsage(any(), any(), any(), anyInt(), anyInt(), any(), any(), any(), any(),
                any(), any(), eq("engagement-llm:a2"), anyBoolean(), any())).thenThrow(new RuntimeException("down"));

        assertEquals(0, job.chargeDecisions(Instant.now()));
        verify(actions, never()).markLlmBilled(any(), any());
    }

    @Test
    @DisplayName("a charged message that ended FAILED is refunded once, under the action id")
    void refundsRefusedSend() {
        EngagementAction a = decision("a1", "SEND");
        a.setChannel("WHATSAPP");
        when(actions.findChargedFailed(50)).thenReturn(List.of(a));
        when(actions.claimRefund(eq("a1"), any())).thenReturn(1);
        when(credits.refundUsage(any(), any(), any(), any())).thenReturn(true);

        assertEquals(1, job.refundRefusedSends(Instant.now()));
        verify(credits).refundUsage(eq("inst-1"), eq("a1"), eq(BigDecimal.ONE), contains("WHATSAPP"));
        verify(actions, never()).releaseRefund(any());
    }

    @Test
    @DisplayName("a refund another run already claimed is skipped; a failed refund gives its claim back")
    void refundClaimAndRelease() {
        EngagementAction taken = decision("a1", "SEND");
        EngagementAction failing = decision("a2", "SEND");
        when(actions.findChargedFailed(50)).thenReturn(List.of(taken, failing));
        when(actions.claimRefund(eq("a1"), any())).thenReturn(0);
        when(actions.claimRefund(eq("a2"), any())).thenReturn(1);
        when(credits.refundUsage(any(), eq("a2"), any(), any())).thenReturn(false);

        assertEquals(0, job.refundRefusedSends(Instant.now()));
        verify(credits, never()).refundUsage(any(), eq("a1"), any(), any());
        verify(actions).releaseRefund("a2");
    }

    @Test
    @DisplayName("with decision charging switched off, the run only does refunds")
    void decisionsSwitchOff() {
        ReflectionTestUtils.setField(job, "chargeDecisions", false);
        when(actions.findChargedFailed(50)).thenReturn(List.of());
        job.run();
        verify(actions, never()).findUnbilledDecisions(anyInt());
        verify(actions).findChargedFailed(50);
    }
}
