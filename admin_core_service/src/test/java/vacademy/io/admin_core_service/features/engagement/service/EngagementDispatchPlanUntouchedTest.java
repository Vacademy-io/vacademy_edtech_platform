package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Engagement messages are ALWAYS_CHARGED (no plan includes them): an empty wallet still demotes
 * the autonomous send, and the plan is never asked, even if it would say "covered".
 */
class EngagementDispatchPlanUntouchedTest {

    @Test
    void anEmptyWalletDemotesWithoutAskingThePlan() {
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        PolicyGate gate = mock(PolicyGate.class);
        EngagementDispatcher dispatcher = mock(EngagementDispatcher.class);
        CreditClient credits = mock(CreditClient.class);
        EngagementDispatchJob job = new EngagementDispatchJob(actions, engines, members, gate, dispatcher, credits);
        ReflectionTestUtils.setField(job, "batch", 100);
        ReflectionTestUtils.setField(job, "perMessageCredits", BigDecimal.ONE);
        ReflectionTestUtils.setField(job, "maxUnbilled", 25);

        EngagementAction send = new EngagementAction();
        send.setId("a1");
        send.setEngineId("e1");
        send.setMemberId("m1");
        send.setInstituteId("i1");
        send.setKind("SEND");
        send.setStatus("OPEN");
        send.setChannel("EMAIL");
        when(actions.findDueAutoSends(any(), anyInt())).thenReturn(List.of(send));
        when(actions.findUnbilledSent(anyInt())).thenReturn(List.of());
        EngagementEngine engine = new EngagementEngine();
        engine.setId("e1");
        engine.setStatus("ACTIVE");
        engine.setAutoSendKilled(false);
        engine.setChannels("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}");
        when(engines.findById("e1")).thenReturn(Optional.of(engine));
        EngagementMember member = new EngagementMember();
        member.setId("m1");
        member.setUserId("u1");
        member.setStatus("ACTIVE");
        when(members.findById("m1")).thenReturn(Optional.of(member));
        when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
        when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        when(credits.hasActiveCredits("i1")).thenReturn(false);
        when(credits.planCovers(any(), any(), any(), anyInt(), any(), any())).thenReturn(true);

        job.dispatch();

        verify(actions).demoteSendToTask(eq("a1"), argThat(s -> s.startsWith("Out of credits")), any());
        verify(credits, never()).planCovers(any(), any(), any(), anyInt(), any(), any());
        verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
    }
}
