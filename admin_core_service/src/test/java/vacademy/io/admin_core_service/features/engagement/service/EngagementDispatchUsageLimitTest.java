package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.AuthorizeResult;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The autonomous send under an AI usage limit: skip this cycle, retry later, never demote. */
class EngagementDispatchUsageLimitTest {

    private EngagementActionRepository actions;
    private EngagementDispatcher dispatcher;
    private CreditClient credits;
    private EngagementDispatchJob job;
    private EngagementAction send;

    @BeforeEach
    void setUp() {
        actions = mock(EngagementActionRepository.class);
        EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        PolicyGate gate = mock(PolicyGate.class);
        dispatcher = mock(EngagementDispatcher.class);
        credits = mock(CreditClient.class);
        job = new EngagementDispatchJob(actions, engines, members, gate, dispatcher, credits);
        ReflectionTestUtils.setField(job, "batch", 100);
        ReflectionTestUtils.setField(job, "perMessageCredits", BigDecimal.ONE);
        ReflectionTestUtils.setField(job, "maxUnbilled", 25);

        send = new EngagementAction();
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
        when(credits.hasActiveCredits("i1")).thenReturn(true);
    }

    @Test
    void noLimitsSendsAsToday() {
        // mock default null, then NONE
        job.dispatch();
        when(credits.authorize(any(), any(), any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyBoolean()))
                .thenReturn(AuthorizeResult.ALLOW_NONE);
        job.dispatch();
        verify(actions, org.mockito.Mockito.times(2)).claimForDispatch(eq("a1"), eq("i1"), any());
        verify(actions, never()).rescheduleDueSend(anyString(), any(), any());
    }

    @Test
    void aBlockSkipsThisCycleAndRetriesLater() {
        Instant before = Instant.now();
        when(credits.authorize(eq("i1"), eq("engagement_message"), eq("engagement_message"),
                argThat(m -> "SYSTEM".equals(m.actorKind())), isNull(), eq(BigDecimal.ONE), eq(false)))
                .thenReturn(new AuthorizeResult(false, "BLOCK", Map.of("resets_at", "2099-01-01T00:00:00+05:30")));

        job.dispatch();

        verify(actions, never()).claimForDispatch(anyString(), anyString(), any());
        verify(actions, never()).demoteSendToTask(anyString(), anyString(), any());
        verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        verify(actions).rescheduleDueSend(eq("a1"), argThat(at -> {
            Duration d = Duration.between(before, at);
            return !d.isNegative() && d.compareTo(EngagementDispatchJob.LIMIT_RETRY_DELAY.plusSeconds(5)) <= 0
                    && d.compareTo(EngagementDispatchJob.LIMIT_RETRY_DELAY.minusSeconds(5)) >= 0;
        }), any());
    }

    @Test
    void aSoonerResetIsUsedAsTheRetryTime() {
        Instant reset = Instant.now().plus(Duration.ofMinutes(5));
        when(credits.authorize(any(), any(), any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyBoolean()))
                .thenReturn(new AuthorizeResult(false, "BLOCK", Map.of("resets_at", reset.toString())));

        job.dispatch();

        verify(actions).rescheduleDueSend(eq("a1"), eq(reset), any());
    }

    @Test
    void outOfCreditsStillDemotesBeforeTheGate() {
        when(credits.hasActiveCredits("i1")).thenReturn(false);
        job.dispatch();
        verify(actions).demoteSendToTask(eq("a1"), argThat(s -> s.startsWith("Out of credits")), any());
        verify(credits, never()).authorize(any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean());
    }
}
