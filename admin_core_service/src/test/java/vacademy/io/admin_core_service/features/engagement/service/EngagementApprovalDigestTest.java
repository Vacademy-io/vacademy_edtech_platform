package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Item;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Line;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Need;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Section;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigestDao.Candidate;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigestDao.Waiting;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

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

/** Every name, number and message here is invented. */
class EngagementApprovalDigestTest {

    private static final Instant NOW = Instant.parse("2026-11-12T04:00:00Z");
    private static final String INBOX = "https://x/inbox";

    private EngagementApprovalDigestDao dao;
    private EngagementEngineRepository engines;
    private EngagementMemberRepository members;
    private EngagementActionRepository actions;
    private EngagementCrmActionService crm;
    private EngagementPointsOfContact poc;
    private InstituteTimezoneService zones;
    private ContactResolver contacts;
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
        contacts = mock(ContactResolver.class);
        job = new EngagementApprovalDigestJob(dao, engines, members, actions, crm, poc, zones, contacts);
        ReflectionTestUtils.setField(job, "enabled", true);
        ReflectionTestUtils.setField(job, "hour", 9);
        ReflectionTestUtils.setField(job, "defaultFirstN", 5);
        ReflectionTestUtils.setField(job, "defaultHost", "dash.example.test");
        when(zones.getZone(anyString())).thenReturn(ZoneId.of("Asia/Kolkata"));
    }

    private static EngagementEngine engine(String id, String name, String channels, Integer firstN) {
        EngagementEngine e = new EngagementEngine();
        e.setId(id);
        e.setInstituteId("i1");
        e.setName(name);
        e.setChannels(channels);
        e.setFirstN(firstN);
        e.setNotifyUserIds("[\"u9\"]");
        return e;
    }

    private static EngagementEngine engine(String channels, Integer firstN) {
        return engine("e1", "Outreach", channels, firstN);
    }

    private static Waiting waiting(String kind, String channel, String type, boolean blocked, int n) {
        return new Waiting("e1", kind, channel, type, blocked, n, 2, NOW.minus(Duration.ofHours(30)));
    }

    private static Candidate cand(String id, String engineId, String memberId, String kind, String channel,
                                  String type, String rationale, String draft, int hoursAgo) {
        return new Candidate(id, engineId, memberId, kind, channel, type, false, rationale, draft, 50,
                NOW.minus(Duration.ofHours(hoursAgo)));
    }

    private static Item item(String id, Section s, String who, int hoursAgo) {
        return new Item(id, s, who, "Outreach", s == Section.REPLIED ? "Replied on WhatsApp" : "Needs your decision",
                "detail", null, NOW.minus(Duration.ofHours(hoursAgo)), EngagementApprovalDigest.taskLink(INBOX, id));
    }

    // ── Groups (counts) ──────────────────────────────────────────────────────

    @Test
    @DisplayName("a channel still short of its approvals is one line with how many more unlock it")
    void trialSaysHowManyMore() {
        EngagementEngine e = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}", null);
        when(actions.countApprovedSendsForChannel("e1", "EMAIL")).thenReturn(2L);
        Line l = job.lineFor(e, waiting("TASK", "EMAIL", "SEND_MESSAGE", false, 411), INBOX);
        assertEquals(Need.TRIAL, l.need());
        assertEquals(3, l.remaining());
        assertEquals("https://x/inbox?engine=e1&kind=TASK&channel=EMAIL", l.link());
        var n = EngagementApprovalDigest.build(List.of(), List.of(l), 0, INBOX, NOW);
        assertTrue(n.html().contains("<b>Outreach</b>: 411 emails waiting. Approve 3 more emails and it sends"
                + " the rest by itself."), n.html());
        assertTrue(n.html().contains("href=\"https://x/inbox?engine=e1&amp;kind=TASK&amp;channel=EMAIL\">Review them"),
                n.html());
        assertEquals("Outreach needs a few approvals to run by itself", n.title());
    }

    @Test
    @DisplayName("a channel that asks every time is counted in the short line at the bottom")
    void manualIsCountedAtTheBottom() {
        EngagementEngine e = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":false}}", null);
        Line l = job.lineFor(e, waiting("TASK", "EMAIL", "SEND_MESSAGE", false, 473), INBOX);
        assertEquals(Need.MANUAL, l.need());
        var n = EngagementApprovalDigest.build(List.of(), List.of(l), 454, null, NOW);
        assertTrue(n.html().contains("Also waiting: 473 emails on Outreach that need approval each time."), n.html());
        assertTrue(n.html().contains("454 drafts expired yesterday"), n.html());
        assertEquals("473 drafts are waiting for approval", n.title());
    }

    @Test
    @DisplayName("rows the engine will run by itself are not reported; blocked ones are")
    void graduatedRowsAreQuietUnlessBlocked() {
        EngagementEngine e = engine("{\"AI_CALL\":{\"enabled\":true}}", 3);
        when(crm.autoActions(e)).thenReturn(List.of(EngagementActionTypes.SCHEDULE_AI_CALL));
        when(actions.countApprovedCrmActions("e1", EngagementActionTypes.SCHEDULE_AI_CALL)).thenReturn(3L);
        assertNull(job.lineFor(e, waiting("TASK", null, EngagementActionTypes.SCHEDULE_AI_CALL, false, 200), INBOX));
        Line blocked = job.lineFor(e, waiting("TASK", null, EngagementActionTypes.SCHEDULE_AI_CALL, true, 4), INBOX);
        assertEquals(Need.BLOCKED, blocked.need());
        assertEquals("AI calls", blocked.what());
        assertEquals("https://x/inbox?engine=e1&filter=approvals&channel=AI_CALL", blocked.link());
    }

    @Test
    @DisplayName("first_n 0 means no approvals are needed")
    void zeroThresholdNeedsNothing() {
        EngagementEngine e = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}", 0);
        assertNull(job.lineFor(e, waiting("TASK", "EMAIL", "SEND_MESSAGE", false, 10), INBOX));
    }

    // ── Items (people) ───────────────────────────────────────────────────────

    @Test
    @DisplayName("a follow-up whose reason says the lead replied is a reply, quoted in their words")
    void followUpAfterAReplyIsAReply() {
        Candidate c = cand("t1", "e1", "m1", "TASK", null, EngagementActionTypes.CREATE_FOLLOWUP,
                "Sample Academy replied on WhatsApp saying \"Please share the fee for the weekend batch\". "
                        + "A counsellor should call them.", null, 23);
        Item i = EngagementApprovalDigest.classify(c, "Ravi Kumar", "Outreach", EngagementApprovalDigest.taskLink(INBOX, "t1"));
        assertNotNull(i);
        assertEquals(Section.REPLIED, i.section());
        assertEquals("Replied on WhatsApp", i.happened());
        assertEquals("“Please share the fee for the weekend batch”", i.detail());
        assertEquals("The engine suggests a follow-up.", i.next());
        assertEquals("https://x/inbox?task=t1", i.link());
    }

    @Test
    @DisplayName("a reason that says they have not replied is not a reply")
    void notRepliedIsNotAReply() {
        assertFalse(EngagementApprovalDigest.saysReplied("No one has replied in 5 days; follow up."));
        assertFalse(EngagementApprovalDigest.saysReplied("They have not yet replied to the brochure."));
        assertFalse(EngagementApprovalDigest.saysReplied("Follow up by email."));
        assertTrue(EngagementApprovalDigest.saysReplied("The lead replied by email asking for a demo."));
        assertNull(EngagementApprovalDigest.classify(cand("t2", "e1", "m1", "TASK", null,
                EngagementActionTypes.CREATE_FOLLOWUP, "Has not replied to two emails.", null, 3), null, "Outreach", null));
    }

    @Test
    @DisplayName("a paraphrased reply is shown as the reason, not dressed up as their words")
    void paraphraseIsNotQuoted() {
        Item i = EngagementApprovalDigest.classify(cand("t3", "e1", "m1", "TASK", "EMAIL", "SEND_MESSAGE",
                "They replied by email that they want a demo next week.", "Happy to set up a demo. Does Tuesday work?", 2),
                null, "Outreach", null);
        assertEquals("Replied by email", i.happened());
        assertEquals("They replied by email that they want a demo next week.", i.detail());
        assertEquals("The engine suggests an email: “Happy to set up a demo. Does Tuesday work?”", i.next());
    }

    @Test
    @DisplayName("an escalated reply says the engine will not answer, with the reason and the draft")
    void escalatedReply() {
        Item i = EngagementApprovalDigest.classify(cand("r1", "e1", "m1", "REPLY", "WHATSAPP", "SEND_MESSAGE",
                "Escalated (money): They ask for a discount on the yearly plan.", "Let me check with the team.", 5),
                "Meera", "Outreach", null);
        assertEquals(Section.REPLIED, i.section());
        assertEquals("Replied on WhatsApp", i.happened());
        assertEquals("They ask for a discount on the yearly plan.", i.detail());
        assertEquals("The engine will not answer this one by itself. Its draft: “Let me check with the team.”", i.next());
    }

    @Test
    @DisplayName("a hand-over is a decision; an ordinary draft is not an item")
    void handOverIsADecision() {
        Item i = EngagementApprovalDigest.classify(cand("h1", "e1", "m1", "TASK", null, EngagementActionTypes.ESCALATE,
                "Upset about a missed class; wants to speak to someone.", null, 8), null, "Outreach", null);
        assertEquals(Section.DECIDE, i.section());
        assertEquals("Handed over to you", i.happened());
        assertNull(EngagementApprovalDigest.classify(cand("d1", "e1", "m1", "TASK", "EMAIL", "SEND_MESSAGE",
                "First touch after the form fill.", "Hello!", 8), null, "Outreach", null));
    }

    @Test
    @DisplayName("long words are trimmed near 140 characters")
    void longQuoteIsTrimmed() {
        String longText = "word ".repeat(80).trim();
        Item i = EngagementApprovalDigest.classify(cand("t4", "e1", "m1", "TASK", null,
                EngagementActionTypes.CREATE_FOLLOWUP, "Lead replied on WhatsApp saying \"" + longText + "\"", null, 1),
                null, "Outreach", null);
        assertTrue(i.detail().length() <= EngagementApprovalDigest.QUOTE_CHARS + 3, i.detail());
        assertTrue(i.detail().endsWith("…”"), i.detail());
    }

    // ── The notice ───────────────────────────────────────────────────────────

    @Test
    @DisplayName("replies come first, then decisions, then trials, then the rest; oldest first within a section")
    void orderOfTheNotice() {
        Line trial = new Line("e2", "Second", "Follow-ups", Need.TRIAL, 2, 0, 3, NOW, "https://x/inbox?engine=e2");
        Line manual = new Line("e1", "Outreach", "Emails", Need.MANUAL, 7, 0, 0, NOW, null);
        List<Item> items = List.of(item("d1", Section.DECIDE, "Decider", 40), item("r1", Section.REPLIED, "Newer", 2),
                item("r2", Section.REPLIED, "Older", 20));
        var n = EngagementApprovalDigest.build(items, List.of(manual, trial), 0, INBOX, NOW);
        String h = n.html();
        int older = h.indexOf("Older"), newer = h.indexOf("Newer"), decider = h.indexOf("Decider");
        int trialAt = h.indexOf("<b>Second</b>"), rest = h.indexOf("Also waiting");
        assertTrue(older < newer && newer < decider && decider < trialAt && trialAt < rest, h);
        assertTrue(h.contains("2 people replied. Answer them first"), h);
        assertTrue(h.contains("href=\"https://x/inbox?task=r2\">Open this one"), h);
        assertTrue(h.contains("waiting 20 hours"), h);
        assertEquals("2 people replied — 3 items need you", n.title());
    }

    @Test
    @DisplayName("at most ten people are listed, the rest behind an 'and N more' link")
    void capAtTen() {
        List<Item> items = new ArrayList<>();
        for (int k = 0; k < 13; k++) items.add(item("r" + k, Section.REPLIED, "Person " + k, 30 - k));
        var n = EngagementApprovalDigest.build(items, List.of(), 0, INBOX, NOW);
        assertEquals(10, n.html().split("Open this one").length - 1, n.html());
        assertTrue(n.html().contains("And 3 more. <a href=\"https://x/inbox\">See all in the inbox</a>"), n.html());
        assertTrue(n.html().contains("Person 0") && !n.html().contains("Person 10<"), n.html());
        assertEquals("13 people replied and are waiting for you", n.title());
    }

    @Test
    @DisplayName("titles: one reply, decisions only")
    void titles() {
        assertEquals("1 person replied and is waiting for you", EngagementApprovalDigest.build(
                List.of(item("r", Section.REPLIED, "A", 1)), List.of(), 0, INBOX, NOW).title());
        assertEquals("2 items need your decision", EngagementApprovalDigest.build(
                List.of(item("a", Section.DECIDE, "A", 1), item("b", Section.DECIDE, "B", 1)), List.of(), 0, INBOX, NOW).title());
    }

    @Test
    @DisplayName("nothing waiting sends nothing")
    void nothingWaitingSendsNothing() {
        assertNull(EngagementApprovalDigest.build(List.of(), List.of(), 12, INBOX, NOW));
        when(dao.waiting(eq("i1"), any(), any())).thenReturn(List.of());
        assertFalse(job.sendFor("i1", NOW));
        verify(poc, never()).alertTeam(any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("people listed by name are taken out of the counts; links go to the exact task")
    void sendsItemsAndCounts() {
        EngagementEngine e = engine("{\"WHATSAPP\":{\"enabled\":true,\"auto\":false}}", null);
        when(engines.findByInstituteIdOrderByCreatedAtDesc("i1")).thenReturn(List.of(e));
        when(dao.adminPortalHost("i1")).thenReturn(null);
        when(dao.waiting(eq("i1"), any(), any())).thenReturn(List.of(
                new Waiting("e1", "REPLY", "WHATSAPP", "SEND_MESSAGE", false, 1, 0, NOW.minus(Duration.ofHours(4))),
                new Waiting("e1", "TASK", "WHATSAPP", "SEND_MESSAGE", false, 6, 0, NOW.minus(Duration.ofHours(9)))));
        when(dao.candidates(eq("i1"), any())).thenReturn(List.of(
                cand("r1", "e1", "m1", "REPLY", "WHATSAPP", "SEND_MESSAGE", "They ask when the next batch starts.",
                        "The next batch starts on Monday.", 4),
                cand("t1", "e1", "m2", "TASK", "WHATSAPP", "SEND_MESSAGE",
                        "Replied on WhatsApp saying \"call me after 6\".", "Sure, we will call after 6.", 9)));
        EngagementMember m1 = new EngagementMember();
        m1.setId("m1");
        when(members.findAllById(any())).thenReturn(List.of(m1));
        when(contacts.resolve(any())).thenReturn(List.of(Subject.builder().memberId("m1").name("Test Lead").build()));

        assertTrue(job.sendFor("i1", NOW));
        var title = ArgumentCaptor.forClass(String.class);
        var html = ArgumentCaptor.forClass(String.class);
        verify(poc).alertTeam(eq("i1"), eq(Set.of("u9")), title.capture(), html.capture(),
                eq("ENGAGEMENT_APPROVALS"), eq("i1:2026-11-12"));
        String h = html.getValue();
        assertEquals("2 people replied and are waiting for you", title.getValue());
        assertTrue(h.contains("<b>Test Lead</b> · Outreach"), h);
        assertTrue(h.contains("<b>A lead</b> · Outreach"), h);
        assertTrue(h.contains("https://dash.example.test/engagement-engines/inbox?task=r1"), h);
        assertTrue(h.contains("https://dash.example.test/engagement-engines/inbox?task=t1"), h);
        // 6 drafts minus the one listed by name.
        assertTrue(h.contains("Also waiting: 5 WhatsApp messages on Outreach that need approval each time."), h);
        assertFalse(h.contains("from people who replied"), h);
    }

    @Test
    @DisplayName("an institute hears only in its own morning hour")
    void onlyAtTheLocalHour() {
        when(members.institutesWithLiveEngines()).thenReturn(List.of("i1"));
        int localHour = Instant.now().atZone(ZoneId.of("Asia/Kolkata")).getHour();
        ReflectionTestUtils.setField(job, "hour", (localHour + 12) % 24);
        job.run();
        verify(dao, never()).waiting(any(), any(), any());
    }

    /**
     * Writes a realistic sample to the path in -Ddigest.sample.out, for a person to look at. Skipped
     * (passes) without it.
     */
    @Test
    @DisplayName("sample notice (written only when asked)")
    void writeSample() throws Exception {
        String out = System.getProperty("digest.sample.out");
        String inbox = "https://dash.example.test/engagement-engines/inbox";
        List<Item> items = new ArrayList<>();
        items.add(EngagementApprovalDigest.classify(cand("a1", "e3", "m1", "TASK", "WHATSAPP",
                EngagementActionTypes.CREATE_FOLLOWUP,
                "Example Coaching Centre replied on WhatsApp saying \"Yes interested, please call me tomorrow after 11 am "
                        + "and share the pricing for 300 students\". Create a follow-up for a counsellor.",
                null, 23), "Anil Mehta", "Voom sales", EngagementApprovalDigest.taskLink(inbox, "a1")));
        items.add(EngagementApprovalDigest.classify(cand("a2", "e3", "m2", "TASK", "WHATSAPP",
                EngagementActionTypes.CREATE_FOLLOWUP,
                "Sample Tutorials replied on WhatsApp saying \"We already use another app, what is different?\"",
                "Call to explain how the live classes and the test series work together.", 6),
                "Priya Nair", "Voom sales", EngagementApprovalDigest.taskLink(inbox, "a2")));
        items.add(EngagementApprovalDigest.classify(cand("a3", "e1", "m3", "REPLY", "WHATSAPP", "SEND_MESSAGE",
                "Escalated (pricing): Asks for a 40% discount if they sign up this week.",
                "Thanks for asking. Let me check with the team and get back to you today.", 15),
                "Kavita Joshi", "Telleo", EngagementApprovalDigest.taskLink(inbox, "a3")));
        items.add(EngagementApprovalDigest.classify(cand("a4", "e2", "m4", "REPLY", "EMAIL", "SEND_MESSAGE",
                "Asks whether recordings are kept after the course ends.",
                "Yes. Every recording stays in your library for 12 months after the course ends.", 3),
                null, "Vacademy", EngagementApprovalDigest.taskLink(inbox, "a4")));
        items.add(EngagementApprovalDigest.classify(cand("a5", "e1", "m5", "TASK", null, EngagementActionTypes.ESCALATE,
                "Upset that the demo call was missed twice; wants a senior person to call back.", null, 11),
                "Rahul Verma", "Telleo", EngagementApprovalDigest.taskLink(inbox, "a5")));
        List<Line> lines = List.of(
                new Line("e3", "Voom sales", "Emails", Need.TRIAL, 14, 0, 3, NOW,
                        EngagementApprovalDigest.groupLink(inbox, "e3", "EMAIL", "SEND_MESSAGE")),
                new Line("e3", "Voom sales", "Follow-ups", Need.TRIAL, 2, 0, 1, NOW,
                        EngagementApprovalDigest.groupLink(inbox, "e3", null, EngagementActionTypes.CREATE_FOLLOWUP)),
                new Line("e1", "Telleo", "AI calls", Need.BLOCKED, 8, 0, 0, NOW,
                        EngagementApprovalDigest.groupLink(inbox, "e1", null, EngagementActionTypes.SCHEDULE_AI_CALL)),
                new Line("e2", "Vacademy", "Emails", Need.MANUAL, 21, 0, 0, NOW,
                        EngagementApprovalDigest.groupLink(inbox, "e2", "EMAIL", "SEND_MESSAGE")));
        var n = EngagementApprovalDigest.build(items, lines, 4, inbox, NOW);
        assertEquals("4 people replied — 5 items need you", n.title());
        if (out == null || out.isBlank()) return;
        Files.writeString(Path.of(out), "<!doctype html><html><head><meta charset=\"utf-8\"><title>"
                + n.title() + "</title></head><body style=\"max-width:640px;margin:24px auto;padding:0 16px\">"
                + "<p style=\"font:600 16px Arial;color:#111\">Subject: " + n.title() + "</p><hr>"
                + n.html() + "</body></html>", StandardCharsets.UTF_8);
    }
}
