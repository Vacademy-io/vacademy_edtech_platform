package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** One open action per person, and no email drafted for someone who cannot receive it. */
class EngagementOpenActionAndEmailDecisionTest {

    private ContactResolver contacts;
    private EngagementBrainClient brain;
    private EngagementMemberRepository members;
    private EngagementActionRepository actions;
    private EngagementDecisionService service;
    private EngagementEngine engine;
    private EngagementMember member;

    @BeforeEach
    void setUp() {
        DataPointRegistry registry = mock(DataPointRegistry.class);
        contacts = mock(ContactResolver.class);
        PolicyGate gate = mock(PolicyGate.class);
        brain = mock(EngagementBrainClient.class);
        members = mock(EngagementMemberRepository.class);
        actions = mock(EngagementActionRepository.class);
        EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
        service = new EngagementDecisionService(registry, contacts, gate, brain, members, actions, prompts,
                mock(EngagementTemplateProposalRepository.class));
        ReflectionTestUtils.setField(service, "recentWindowDays", 14);
        ReflectionTestUtils.setField(service, "taskExpireHours", 72);
        ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
        ReflectionTestUtils.setField(service, "defaultFirstN", 5);
        EngagementPromptVersion prompt = new EngagementPromptVersion();
        prompt.setId("p1");
        prompt.setCompiledText("x");
        when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));
        when(registry.hydrate(any(), anyList(), anyList()))
                .thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
        when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
        when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
        when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        when(gate.scheduleSend(any(), any(), any())).thenAnswer(inv -> inv.getArgument(1));

        engine = new EngagementEngine();
        engine.setId("e1");
        engine.setInstituteId("i1");
        engine.setStatus("ACTIVE");
        engine.setCadenceHours(72);
        engine.setChannels("{\"EMAIL\":{\"enabled\":true},\"WHATSAPP\":{\"enabled\":true}}");
        member = new EngagementMember();
        member.setId("m1");
        member.setEngineId("e1");
        member.setInstituteId("i1");
        member.setUserId("u1");
        member.setStatus("ACTIVE");
        member.setNextActionAt(Instant.now());
        when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
    }

    private void subject(String email) {
        when(contacts.resolve(anyList())).thenReturn(List.of(
                Subject.builder().memberId("m1").userId("u1").phone("9000000001").email(email).build()));
    }

    private void brainChoosesEmail() {
        when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                new EngagementBrainClient.Decision("ACT", "SEND_MESSAGE", "EMAIL", "Hello there", null, null,
                        "cold first touch", 50, 0, null, null, null));
    }

    @Test
    @DisplayName("a person with an action still waiting gets no second one, and no LLM call")
    void pendingActionBlocksANewOne() {
        subject("a@test.local");
        when(actions.countPendingActions("m1")).thenReturn(1L);

        service.decideCohort(engine, List.of(member));

        verifyNoInteractions(brain);
        verify(actions, never()).save(any());
        verify(members).recordGateSleep(eq("m1"), any(), any(), any());
    }

    @Test
    @DisplayName("nothing waiting: the decision goes on and drafts the email as before")
    void nothingPendingDecides() {
        subject("a@test.local");
        brainChoosesEmail();

        service.decideCohort(engine, List.of(member));

        verify(actions).save(argThat((EngagementAction a) -> "TASK".equals(a.getKind()) && "EMAIL".equals(a.getChannel())));
    }

    @Test
    @DisplayName("the model chose EMAIL for someone with no address: a NO_OP with the reason, not a draft")
    void noAddressGetsNoDraft() {
        subject(null);
        brainChoosesEmail();

        service.decideCohort(engine, List.of(member));

        verify(actions).save(argThat((EngagementAction a) -> "NO_OP".equals(a.getKind())
                && a.getRationale().contains("no email address on file")));
        verify(actions, never()).save(argThat((EngagementAction a) -> "TASK".equals(a.getKind())));
    }

    @Test
    @DisplayName("email-only engine and no address: parked for a week with a note, no LLM")
    void emailOnlyNoAddressIsParked() {
        engine.setChannels("{\"EMAIL\":{\"enabled\":true}}");
        subject(null);

        service.decideCohort(engine, List.of(member));

        verifyNoInteractions(brain);
        verify(actions).save(argThat((EngagementAction a) -> "NO_OP".equals(a.getKind())
                && EngagementDecisionService.NO_EMAIL_ONLY_CHANNEL_NOTE.equals(a.getRationale())));
        var next = org.mockito.ArgumentCaptor.forClass(Instant.class);
        verify(members).recordDecision(eq("m1"), any(), any(), anyShort(), any(), next.capture());
        assertTrue(next.getValue().isAfter(Instant.now().plus(Duration.ofDays(6))));
    }
}
