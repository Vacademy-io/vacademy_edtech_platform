package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * R1 (test finding F1): a request to stop is honoured even when no engine auto-answers the
 * number — auto-reply off, kill switch on, or a dry-run engine all reach the same path, because
 * findAutoReplyCandidates returns nothing for them.
 */
class EngagementStopWithoutAutoReplyTest {

    private static final String INST = "inst-1";
    private static final String PHONE = "+91 90000 00002";
    private static final String PHONE10 = "9000000002";

    private EngagementMemberRepository members;
    private EngagementActionRepository actions;
    private EngagementReplyBrain brain;
    private EngagementDispatcher dispatcher;
    private EngagementReplyMemberQueries replyQueries;
    private EngagementReplyResponder responder;

    @BeforeEach
    void setUp() {
        members = mock(EngagementMemberRepository.class);
        actions = mock(EngagementActionRepository.class);
        brain = mock(EngagementReplyBrain.class);
        dispatcher = mock(EngagementDispatcher.class);
        replyQueries = mock(EngagementReplyMemberQueries.class);
        responder = new EngagementReplyResponder(members, mock(EngagementEngineRepository.class),
                mock(EngagementPromptVersionRepository.class), actions, brain, dispatcher);
        ReflectionTestUtils.setField(responder, "taskExpireHours", 72);
        ReflectionTestUtils.setField(responder, "leaseMinutes", 15);
        ReflectionTestUtils.setField(responder, "replyMemberQueries", replyQueries);
        when(members.findAutoReplyCandidates(eq(INST), eq(PHONE10), any())).thenReturn(List.of());
    }

    private static EngagementReplyMemberQueries.LiveMember live(String memberId, String engineId) {
        EngagementReplyMemberQueries.LiveMember m = mock(EngagementReplyMemberQueries.LiveMember.class);
        when(m.getMemberId()).thenReturn(memberId);
        when(m.getEngineId()).thenReturn(engineId);
        when(m.getCadenceHours()).thenReturn(72);
        return m;
    }

    @Test
    @DisplayName("R1: 'please stop messaging me' with auto-reply off opts the number out of every engine")
    void R1_stopWithoutAutoReply_optsOut() {
        List<EngagementReplyMemberQueries.LiveMember> found = List.of(live("m1", "e1"), live("m2", "e2"));
        when(replyQueries.findLiveMembersByPhone(INST, PHONE10)).thenReturn(found);
        when(members.claimHandledReply(eq(INST), eq("wamid.1"), any())).thenReturn(1);
        when(members.optOutByPhone(eq(INST), eq(PHONE10), any())).thenReturn(2);

        assertTrue(responder.handleReply(INST, PHONE, "please stop messaging me", "wamid.1"));

        verify(members).optOutByPhone(eq(INST), eq(PHONE10), any());
        verify(actions).save(argThat((EngagementAction a) -> "m1".equals(a.getMemberId())
                && "REPLY".equals(a.getKind()) && "OPEN".equals(a.getStatus())
                && a.getRationale().startsWith("Asked to stop messages — opted out of 2")));
        verifyNoInteractions(brain, dispatcher);
    }

    @Test
    @DisplayName("R1: a bare STOP is handled the same way (kill switch on / dry run reach this path too)")
    void R1_bareStop_optsOut() {
        List<EngagementReplyMemberQueries.LiveMember> found = List.of(live("m1", "e1"));
        when(replyQueries.findLiveMembersByPhone(INST, PHONE10)).thenReturn(found);
        when(members.claimHandledReply(eq(INST), eq("wamid.2"), any())).thenReturn(1);

        assertTrue(responder.handleReply(INST, PHONE, "STOP", "wamid.2"));
        verify(members).optOutByPhone(eq(INST), eq(PHONE10), any());
    }

    @Test
    @DisplayName("R1: the same message read by two sweeps opts out once and leaves one note")
    void R1_duplicateWamid_handledOnce() {
        List<EngagementReplyMemberQueries.LiveMember> found = List.of(live("m1", "e1"));
        when(replyQueries.findLiveMembersByPhone(INST, PHONE10)).thenReturn(found);
        when(members.claimHandledReply(eq(INST), eq("wamid.3"), any())).thenReturn(1, 0);

        assertTrue(responder.handleReply(INST, PHONE, "unsubscribe", "wamid.3"));
        assertFalse(responder.handleReply(INST, PHONE, "unsubscribe", "wamid.3"));

        verify(members, times(1)).optOutByPhone(any(), any(), any());
        verify(actions, times(1)).save(any());
    }

    @Test
    @DisplayName("R1: 'not interested' is not an opt-out — a human task, and the sweep is held off")
    void R1_stopMention_escalatesWithoutOptOut() {
        List<EngagementReplyMemberQueries.LiveMember> found = List.of(live("m1", "e1"), live("m2", "e2"));
        when(replyQueries.findLiveMembersByPhone(INST, PHONE10)).thenReturn(found);
        when(members.claimHandledReply(eq(INST), eq("wamid.4"), any())).thenReturn(1);

        assertTrue(responder.handleReply(INST, PHONE, "not interested right now", "wamid.4"));

        verify(members, never()).optOutByPhone(any(), any(), any());
        verify(actions).save(argThat((EngagementAction a) -> a.getRationale().startsWith("Escalated (stop-mention)")
                && a.getPriority().intValue() == 85));
        verify(members).markReplyHandled(eq("m1"), any(), any());
        verify(members).markReplyHandled(eq("m2"), any(), any());
    }

    @Test
    @DisplayName("an ordinary reply on an engine without auto-reply is left to the sweep, untouched")
    void ordinaryReply_untouched() {
        assertFalse(responder.handleReply(INST, PHONE, "What time is the class?", "wamid.5"));
        verify(members, never()).claimHandledReply(anyString(), anyString(), any());
        verifyNoInteractions(replyQueries, actions);
    }

    @Test
    @DisplayName("a STOP from a number no engine reaches does nothing (and does not consume the wamid)")
    void stopFromUnknownNumber_noop() {
        when(replyQueries.findLiveMembersByPhone(INST, PHONE10)).thenReturn(List.of());

        assertFalse(responder.handleReply(INST, PHONE, "STOP", "wamid.6"));
        verify(members, never()).claimHandledReply(anyString(), anyString(), any());
        verify(members, never()).optOutByPhone(any(), any(), any());
    }

    @Test
    @DisplayName("without the optional query bean the old behaviour is kept (no crash, nothing done)")
    void missingQueryBean_keepsOldBehaviour() {
        ReflectionTestUtils.setField(responder, "replyMemberQueries", null);
        assertFalse(responder.handleReply(INST, PHONE, "STOP", "wamid.7"));
        assertEquals(0, org.mockito.Mockito.mockingDetails(actions).getInvocations().size());
    }
}
