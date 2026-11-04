package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries.LiveMember;
import vacademy.io.admin_core_service.features.engagement.service.EngagementCallOutcomeService.Verdict;
import vacademy.io.admin_core_service.features.telephony.core.AiCallFollowThrough;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** A hot AI call reaches the team now, only for an engine's own agent. */
class EngagementCallOutcomeServiceTest {

    private EngagementReplyMemberQueries queries;
    private EngagementTeamAlertService alerts;
    private AiCallResultRepository results;
    private AiCallFollowThrough followThrough;
    private EngagementCallOutcomeService service;
    private final EngagementEngine engine = new EngagementEngine();
    private final EngagementMember member = new EngagementMember();
    private final LiveMember live = mock(LiveMember.class);

    @BeforeEach
    void setUp() {
        queries = mock(EngagementReplyMemberQueries.class);
        alerts = mock(EngagementTeamAlertService.class);
        results = mock(AiCallResultRepository.class);
        followThrough = mock(AiCallFollowThrough.class);
        EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        service = new EngagementCallOutcomeService(queries, engines, members, alerts, results);
        ReflectionTestUtils.setField(service, "followThrough", followThrough);
        engine.setId("e1");
        engine.setName("Engine One");
        member.setId("m1");
        when(live.getEngineId()).thenReturn("e1");
        when(live.getMemberId()).thenReturn("m1");
        when(engines.findById("e1")).thenReturn(Optional.of(engine));
        when(members.findById("m1")).thenReturn(Optional.of(member));
        when(queries.findLiveMembersOfLeadForAgent("i1", "r1", "u1", "agent1")).thenReturn(List.of(live));
        when(followThrough.createHotLeadFollowup(any(), any(), any(), any(), any(), any())).thenReturn("fu1");
    }

    private static AiCallResult call(String disposition, String followUp) {
        AiCallResult r = new AiCallResult();
        r.setId("res1");
        r.setCampaignId("agent1");
        r.setDisposition(disposition);
        r.setFollowUp(followUp);
        r.setPhoneNumber("+919000000001");
        r.setCustomerName("Asha");
        r.setAiSummary("Runs civil classes and asked for a demo.");
        Map<String, Object> qa = new LinkedHashMap<>();
        qa.put("Did they agree to a demo?", "Yes, today after 4 PM.");
        qa.put("Email address, if given", null);
        qa.put("Did they ask not to be called again?", false);
        r.setExtractedQa(qa);
        return r;
    }

    @Test
    @DisplayName("labels: any agent's wording for a booking or interest; a negative is never hot")
    void readsLabels() {
        assertEquals(Verdict.BOOKED, EngagementCallOutcomeService.verdict("Demo_Booked"));
        assertEquals(Verdict.BOOKED, EngagementCallOutcomeService.verdict("Counselling_Scheduled"));
        assertEquals(Verdict.BOOKED, EngagementCallOutcomeService.verdict("meeting fixed"));
        assertEquals(Verdict.INTERESTED, EngagementCallOutcomeService.verdict("Interested"));
        assertEquals(Verdict.INTERESTED, EngagementCallOutcomeService.verdict("Likely_Interested"));
        assertEquals(Verdict.NONE, EngagementCallOutcomeService.verdict("Not_Interested"));
        assertEquals(Verdict.NONE, EngagementCallOutcomeService.verdict("Demo_Cancelled"));
        assertEquals(Verdict.NONE, EngagementCallOutcomeService.verdict("Meeting_Declined"));
        assertEquals(Verdict.NONE, EngagementCallOutcomeService.verdict("Incomplete_Call"));
        assertEquals(Verdict.NONE, EngagementCallOutcomeService.verdict("Callback"));
        assertEquals(Verdict.NONE, EngagementCallOutcomeService.verdict(null));
    }

    @Test
    @DisplayName("a booked demo: team alert with what they said, a follow-up due now, SKIP corrected to CALL")
    void bookedDemoReachesTheTeam() {
        service.onCallEnded(call("Demo_Booked", "SKIP"), "r1", "u1", "i1");

        var detail = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(alerts).notifyCallOutcome(eq(engine), eq(member), eq("res1"), eq("Demo agreed: Asha"), detail.capture());
        assertTrue(detail.getValue().contains("Yes, today after 4 PM."), detail.getValue());
        assertTrue(detail.getValue().contains("Runs civil classes"), detail.getValue());
        assertTrue(detail.getValue().contains("follow-up"), detail.getValue());
        assertFalse(detail.getValue().contains("Email address"), detail.getValue());
        assertFalse(detail.getValue().contains("not to be called"), detail.getValue());
        verify(followThrough).createHotLeadFollowup(any(), eq("r1"), eq("u1"), eq("i1"), any(), contains("Confirm it"));
        verify(results).updateFollowUp(eq("res1"), eq("CALL"), startsWith("Confirm the demo"));
    }

    @Test
    @DisplayName("interested: the team is told; a CALL verdict stays as the analyser wrote it")
    void interestedReachesTheTeam() {
        service.onCallEnded(call("Interested", "CALL"), "r1", "u1", "i1");

        verify(alerts).notifyCallOutcome(eq(engine), eq(member), eq("res1"), eq("Interested: Asha"), any());
        verify(followThrough).createHotLeadFollowup(any(), any(), any(), any(), any(), contains("Call them"));
        verify(results, never()).updateFollowUp(any(), any(), any());
    }

    @Test
    @DisplayName("a lead not in this agent's engine (a bulk campaign) sends no email and changes nothing")
    void outsideAnEngineDoesNothing() {
        when(queries.findLiveMembersOfLeadForAgent(any(), any(), any(), any())).thenReturn(List.of());

        service.onCallEnded(call("Demo_Booked", "SKIP"), "r1", "u1", "i1");

        verifyNoInteractions(alerts, followThrough, results);
    }

    @Test
    @DisplayName("an ordinary outcome does not even look the lead up")
    void ordinaryOutcomeIsCheap() {
        service.onCallEnded(call("Incomplete", "SKIP"), "r1", "u1", "i1");

        verifyNoInteractions(queries, alerts, followThrough, results);
    }

    @Test
    @DisplayName("a missing id binds as an empty string, not an untyped null")
    void missingIdsBindEmpty() {
        service.onCallEnded(call("Interested", "CALL"), null, "u1", "i1");

        verify(queries).findLiveMembersOfLeadForAgent("i1", "", "u1", "agent1");
    }
}
