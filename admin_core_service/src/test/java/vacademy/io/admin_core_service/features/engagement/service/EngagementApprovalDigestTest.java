package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Line;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Need;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigestDao.Waiting;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EngagementApprovalDigestTest {

    private static final Instant NOW = Instant.parse("2026-11-12T04:00:00Z");

    private EngagementApprovalDigestDao dao;
    private EngagementEngineRepository engines;
    private EngagementMemberRepository members;
    private EngagementActionRepository actions;
    private EngagementCrmActionService crm;
    private EngagementPointsOfContact poc;
    private InstituteTimezoneService zones;
    private EngagementApprovalDigestJob job;

    @BeforeEach
    void setUp() {
        dao = mock(EngagementApprovalDigestDao.class);
        engines = mock(EngagementEngineRepository.class);
        members = mock(EngagementMemberRepository.class);
        actions = mock(EngagementActionRepository.class);
        crm = mock(EngagementCrmActionService.class);
        poc = mock(EngagementPointsOfContact.class);
        zones = mock(InstituteTimezoneService.class);
        job = new EngagementApprovalDigestJob(dao, engines, members, actions, crm, poc, zones);
        ReflectionTestUtils.setField(job, "enabled", true);
        ReflectionTestUtils.setField(job, "hour", 9);
        ReflectionTestUtils.setField(job, "defaultFirstN", 5);
        ReflectionTestUtils.setField(job, "defaultHost", "dash.example.test");
        when(zones.getZone(anyString())).thenReturn(ZoneId.of("Asia/Kolkata"));
    }

    private static EngagementEngine engine(String channels, Integer firstN) {
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setInstituteId("i1");
        e.setName("Outreach");
        e.setChannels(channels);
        e.setFirstN(firstN);
        e.setNotifyUserIds("[\"u9\"]");
        return e;
    }

    private static Waiting waiting(String kind, String channel, String type, boolean blocked, int n) {
        return new Waiting("e1", kind, channel, type, blocked, n, 2, NOW.minus(Duration.ofHours(30)));
    }

    @Test
    @DisplayName("a channel still short of its approvals says how many more unlock it")
    void trialSaysHowManyMore() {
        EngagementEngine e = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}", null);
        when(actions.countApprovedSendsForChannel("e1", "EMAIL")).thenReturn(2L);
        Line l = job.lineFor(e, waiting("TASK", "EMAIL", "SEND_MESSAGE", false, 411));
        assertEquals(Need.TRIAL, l.need());
        assertEquals(3, l.remaining());
        var n = EngagementApprovalDigest.build(List.of(l), 0, "https://x/inbox", NOW);
        assertTrue(n.html().contains("Outreach: 411 emails waiting"), n.html());
        assertTrue(n.html().contains("Approve 3 more and the engine handles the rest by itself"), n.html());
        assertTrue(n.html().contains("2 lapse unsent within a day"), n.html());
        assertEquals("Engagement inbox: 411 drafts are waiting for you", n.title());
    }

    @Test
    @DisplayName("a channel not set to run on its own is named as the reason")
    void manualNamesTheSetting() {
        EngagementEngine e = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":false}}", null);
        Line l = job.lineFor(e, waiting("TASK", "EMAIL", "SEND_MESSAGE", false, 473));
        assertEquals(Need.MANUAL, l.need());
        var n = EngagementApprovalDigest.build(List.of(l), 454, null, NOW);
        assertTrue(n.html().contains("set Emails to \"Runs on its own\""), n.html());
        assertTrue(n.html().contains("454 drafts lapsed"), n.html());
    }

    @Test
    @DisplayName("rows the engine will run by itself are not reported; blocked ones are")
    void graduatedRowsAreQuietUnlessBlocked() {
        EngagementEngine e = engine("{\"AI_CALL\":{\"enabled\":true}}", 3);
        when(crm.autoActions(e)).thenReturn(List.of(EngagementActionTypes.SCHEDULE_AI_CALL));
        when(actions.countApprovedCrmActions("e1", EngagementActionTypes.SCHEDULE_AI_CALL)).thenReturn(3L);
        assertNull(job.lineFor(e, waiting("TASK", null, EngagementActionTypes.SCHEDULE_AI_CALL, false, 200)));
        Line blocked = job.lineFor(e, waiting("TASK", null, EngagementActionTypes.SCHEDULE_AI_CALL, true, 4));
        assertEquals(Need.BLOCKED, blocked.need());
        assertEquals("AI calls", blocked.what());
    }

    @Test
    @DisplayName("first_n 0 means no approvals are needed")
    void zeroThresholdNeedsNothing() {
        EngagementEngine e = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}", 0);
        assertNull(job.lineFor(e, waiting("TASK", "EMAIL", "SEND_MESSAGE", false, 10)));
    }

    @Test
    @DisplayName("replies lead the notice and the title")
    void repliesComeFirst() {
        Line reply = new Line("Outreach", "Emails", Need.REPLY, 1, 0, 0, NOW.minus(Duration.ofHours(50)));
        Line drafts = new Line("Outreach", "Emails", Need.TRIAL, 1, 0, 5, NOW);
        var n = EngagementApprovalDigest.build(List.of(reply, drafts), 0, "https://x/inbox", NOW);
        assertEquals("Engagement inbox: 1 reply and 1 draft are waiting for you", n.title());
        assertTrue(n.html().indexOf("1 person has replied") < n.html().indexOf("1 email waiting"), n.html());
        assertTrue(n.html().contains("waited 2 days"), n.html());
        assertTrue(n.html().contains("href=\"https://x/inbox\""), n.html());
    }

    @Test
    @DisplayName("nothing waiting sends nothing")
    void nothingWaitingSendsNothing() {
        assertNull(EngagementApprovalDigest.build(List.of(), 12, "https://x/inbox", NOW));
        when(dao.waiting(eq("i1"), any(), any())).thenReturn(List.of());
        assertFalse(job.sendFor("i1", NOW));
        verify(poc, never()).alertTeam(any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("the notice goes to the admins and the engines' contacts, with the inbox link")
    void sendsToTheTeam() {
        EngagementEngine e = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":false}}", null);
        when(engines.findByInstituteIdOrderByCreatedAtDesc("i1")).thenReturn(List.of(e));
        when(dao.waiting(eq("i1"), any(), any())).thenReturn(List.of(waiting("TASK", "EMAIL", "SEND_MESSAGE", false, 7)));
        when(dao.adminPortalHost("i1")).thenReturn(null);
        assertTrue(job.sendFor("i1", NOW));
        var html = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(poc).alertTeam(eq("i1"), eq(java.util.Set.of("u9")), eq("Engagement inbox: 7 drafts are waiting for you"),
                html.capture(), eq("ENGAGEMENT_APPROVALS"), eq("i1:2026-11-12"));
        assertTrue(html.getValue().contains("https://dash.example.test/engagement-engines/inbox"), html.getValue());
    }

    @Test
    @DisplayName("an institute hears only in its own morning hour")
    void onlyAtTheLocalHour() {
        when(members.institutesWithLiveEngines()).thenReturn(List.of("i1"));
        // The run reads the clock; whichever hour it is, a zone nine hours away from it is not asked.
        int localHour = Instant.now().atZone(ZoneId.of("Asia/Kolkata")).getHour();
        ReflectionTestUtils.setField(job, "hour", (localHour + 12) % 24);
        job.run();
        verify(dao, never()).waiting(any(), any(), any());
        assertNotNull(job);
    }
}
