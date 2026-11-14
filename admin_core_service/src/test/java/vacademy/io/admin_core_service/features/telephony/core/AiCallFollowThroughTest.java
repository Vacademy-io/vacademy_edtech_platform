package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.audience.dto.CloseLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.dto.CreateLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.dto.LeadFollowupDto;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadFollowupService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementCoordinationDao;
import vacademy.io.admin_core_service.features.engagement.service.EngagementPointsOfContact;
import vacademy.io.admin_core_service.features.engagement.service.EngagementSystemTemplates;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallActionRule;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** After an AI call: the summary on the timeline, and a callback when the lead asked for one. */
class AiCallFollowThroughTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private AiCallFollowThrough ft;
    private AiCallQueueService queue;
    private TimelineEventService timeline;
    private EngagementPointsOfContact poc;
    private LLMService llm;
    private LeadFollowupService followups;
    private LeadFollowupRepository followupRepo;
    private EngagementCoordinationDao coordination;
    private AiCallActionService actionService;
    private EngagementSystemTemplates templates;
    private vacademy.io.admin_core_service.features.booking.repository.BookingInstanceRepository bookings;
    private final Instant callAt = Instant.parse("2026-10-29T12:30:00Z");

    @BeforeEach
    void setUp() {
        ft = new AiCallFollowThrough();
        queue = mock(AiCallQueueService.class);
        timeline = mock(TimelineEventService.class);
        poc = mock(EngagementPointsOfContact.class);
        llm = mock(LLMService.class);
        AiCallingSettingsService settings = mock(AiCallingSettingsService.class);
        when(settings.get(any())).thenReturn(AiCallingSettingsPojo.defaults());
        ReflectionTestUtils.setField(ft, "queueService", queue);
        ReflectionTestUtils.setField(ft, "timelineEventService", timeline);
        ReflectionTestUtils.setField(ft, "pointsOfContact", poc);
        ReflectionTestUtils.setField(ft, "llmService", llm);
        ReflectionTestUtils.setField(ft, "settingsService", settings);
        followups = mock(LeadFollowupService.class);
        followupRepo = mock(LeadFollowupRepository.class);
        coordination = mock(EngagementCoordinationDao.class);
        ReflectionTestUtils.setField(ft, "leadFollowupService", followups);
        ReflectionTestUtils.setField(ft, "leadFollowupRepository", followupRepo);
        ReflectionTestUtils.setField(ft, "coordinationDao", coordination);
        bookings = mock(vacademy.io.admin_core_service.features.booking.repository.BookingInstanceRepository.class);
        when(bookings.findByAudienceResponseId(any())).thenReturn(java.util.List.of());
        ReflectionTestUtils.setField(ft, "bookingInstanceRepository", bookings);
        actionService = mock(AiCallActionService.class);
        templates = mock(EngagementSystemTemplates.class);
        InstituteRepository institutes = mock(InstituteRepository.class);
        var inst = new vacademy.io.common.institute.entity.Institute();
        inst.setInstituteName("Tutezy");
        when(institutes.findById("inst1")).thenReturn(java.util.Optional.of(inst));
        ReflectionTestUtils.setField(ft, "aiCallActionService", actionService);
        ReflectionTestUtils.setField(ft, "systemTemplates", templates);
        ReflectionTestUtils.setField(ft, "instituteRepository", institutes);
        when(actionService.createBuiltIn(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(queue.cancelForLead(any(), any(), any(), any())).thenReturn(1);
        when(poc.ownerFor("inst1", "user1")).thenReturn("counsellor1");
        LeadFollowupDto made = mock(LeadFollowupDto.class);
        when(made.getId()).thenReturn("fu1");
        when(followups.create(any(), any())).thenReturn(made);
        when(followupRepo.openIdsWithContentPrefix(any(), any())).thenReturn(java.util.List.of());
        var ok = new vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.EnqueueResult();
        ok.setQueued(true);
        when(queue.enqueueAt(any(), any(), any(), any())).thenReturn(ok);
    }

    private AiCallResult result() {
        AiCallResult r = new AiCallResult();
        r.setId("res1");
        r.setCallLogId("log1");
        r.setCampaignId("agent1");
        r.setCustomerName("Priyanshu");
        r.setPhoneNumber("+919968858268");
        r.setAiSummary("Teacher interested in Tutezy; asked for a callback.");
        r.setCallStart(callAt);
        return r;
    }

    private void llmSays(String json) {
        var resp = mock(LLMService.LLMResponse.class);
        when(resp.getContent()).thenReturn(json);
        when(llm.generateChatCompletion(any())).thenReturn(resp);
    }

    @Test
    @DisplayName("the call summary lands on the lead's timeline, with the callback ask")
    void summaryNote() {
        AiCallResult r = result();
        r.setCallbackTimeText("in two days");
        llmSays("{\"at\": \"2026-10-31T18:00:00+05:30\"}");
        ft.afterCall(r, "resp1", "user1", "inst1");
        var desc = ArgumentCaptor.forClass(String.class);
        // Activity & Notes reads the student's own events, like a counsellor's note
        verify(timeline).logEvent(eq("STUDENT"), eq("user1"), eq("NOTE"), any(), any(), any(),
                eq("AI call summary"), desc.capture(), any(), eq("user1"));
        assertTrue(desc.getValue().contains("Teacher interested"));
        assertTrue(desc.getValue().contains("Asked to be called back: in two days"), desc.getValue());
    }

    @Test
    @DisplayName("today with no time: an AI call two hours after this one and a same-day follow-up, no LLM")
    void todayWithoutTime() {
        AiCallResult r = result();
        r.setCallback(true);
        r.setCallbackTimeText("Today");
        ft.afterCall(r, "resp1", "user1", "inst1");
        var at = ArgumentCaptor.forClass(Instant.class);
        verify(queue).enqueueAt(any(), at.capture(), any(), any());
        assertEquals(callAt.plus(java.time.Duration.ofHours(2)), at.getValue());
        verifyNoInteractions(llm);
    }

    @Test
    @DisplayName("only a bare today skips the time reader: this evening still goes through it")
    void sameDayOnlyWhenBare() {
        for (String bare : new String[]{"Today", " aaj ", "aaj hi", "today itself", "\u0906\u091c"}) {
            assertTrue(AiCallFollowThrough.isSameDayWithoutTime(bare), bare);
        }
        for (String timed : new String[]{"today evening", "aaj shaam", "\u0906\u091c \u0936\u093e\u092e", "after one hour", "tomorrow", "", null}) {
            assertFalse(AiCallFollowThrough.isSameDayWithoutTime(timed), String.valueOf(timed));
        }
    }

    @Test
    @DisplayName("an exact callback time is scheduled as given")
    void exactTime() {
        AiCallResult r = result();
        r.setCallback(true);
        r.setCallbackAt(Instant.parse("2026-10-31T12:30:00Z"));
        ft.afterCall(r, "resp1", "user1", "inst1");
        var req = ArgumentCaptor.forClass(AiCallRequestDTO.class);
        verify(queue).enqueueAt(req.capture(), eq(Instant.parse("2026-10-31T12:30:00Z")), eq("res1"), isNull());
        assertEquals("agent1", req.getValue().getCampaignId());
        assertEquals("resp1", req.getValue().getResponseId());
        verifyNoInteractions(llm);
    }

    @Test
    @DisplayName("\"in two days\" is read by the model against the call time and scheduled")
    void relativeText() {
        AiCallResult r = result();
        r.setCallbackTimeText("2 din baad call karna");
        llmSays("{\"at\": \"2026-10-31T18:00:00+05:30\"}");
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(queue).enqueueAt(any(), eq(Instant.parse("2026-10-31T12:30:00Z")), eq("res1"), isNull());
        // the callback is on the Lead Journey, with a fixed event type the journey view icons
        verify(timeline).logJourneyEvent(eq("AUDIENCE_RESPONSE"), eq("resp1"), eq(LeadJourneyActionType.CALLBACK_REQUESTED),
                any(), any(), any(), eq("Asked to be called back"), contains("AI call is scheduled"), any(), eq("user1"));
        // and a CRM follow-up for the same time, owned by the counsellor: the reminder and the safety net
        var fu = ArgumentCaptor.forClass(CreateLeadFollowupRequest.class);
        verify(followups).create(fu.capture(), any());
        assertEquals(Instant.parse("2026-10-31T12:30:00Z"), fu.getValue().getScheduleTime().toInstant());
        assertTrue(fu.getValue().getContent().startsWith("AI callback:"), fu.getValue().getContent());
    }

    @Test
    @DisplayName("a lead who already has an open follow-up gets no second one; the AI call is still scheduled")
    void noSecondFollowup() {
        AiCallResult r = result();
        r.setCallbackAt(Instant.parse("2026-10-31T12:30:00Z"));
        when(coordination.openFollowups("inst1", "resp1")).thenReturn(1L);
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(followups, never()).create(any(), any());
        verify(queue).enqueueAt(any(), any(), any(), any());
    }

    @Test
    @DisplayName("a connected AI call closes the follow-up the engine made for the callback")
    void connectedCallClosesFollowup() {
        AiCallResult r = result();
        r.setStatus("completed");
        r.setAiSummary(null);
        when(followupRepo.openIdsWithContentPrefix("resp1", "AI callback:")).thenReturn(java.util.List.of("fu9"));
        ft.afterCall(r, "resp1", "user1", "inst1");
        var close = ArgumentCaptor.forClass(CloseLeadFollowupRequest.class);
        verify(followups).close(eq("fu9"), close.capture(), any());
        assertTrue(close.getValue().getCloserReason().contains("reached the lead"));
    }

    @Test
    @DisplayName("a call that did not connect leaves the follow-up open")
    void unconnectedLeavesFollowup() {
        AiCallResult r = result();
        r.setStatus("failed");
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(followups, never()).close(any(), any(), any());
    }

    @Test
    @DisplayName("no usable time: nothing is scheduled and the points of contact are told to call")
    void noTime() {
        AiCallResult r = result();
        r.setDisposition("Callback");
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(queue, never()).enqueueAt(any(), any(), any(), any());
        // a human decides when: a follow-up a day out, a journey event and an alert
        var fu = ArgumentCaptor.forClass(CreateLeadFollowupRequest.class);
        verify(followups).create(fu.capture(), any());
        assertTrue(fu.getValue().getContent().contains("No AI call is scheduled"));
        verify(timeline).logJourneyEvent(eq("AUDIENCE_RESPONSE"), eq("resp1"), eq(LeadJourneyActionType.CALLBACK_REQUESTED),
                any(), any(), any(), contains("no time"), any(), any(), eq("user1"));
        verify(poc).alert(eq("inst1"), eq("user1"), startsWith("Callback needs a time"), any(), eq("AI_CALLBACK"), eq("res1"));
    }

    @Test
    @DisplayName("a time the model puts in the past or years away is a misreading, not scheduled")
    void rejectsMisreading() {
        assertNull(ft.resolve("inst1", "yesterday", callAt, IST) );
        llmSays("{\"at\": \"2026-10-28T10:00:00+05:30\"}");
        assertNull(ft.resolve("inst1", "yesterday", callAt, IST));
        llmSays("{\"at\": \"2031-01-01T10:00:00+05:30\"}");
        assertNull(ft.resolve("inst1", "someday", callAt, IST));
        llmSays("{\"at\": null}");
        assertNull(ft.resolve("inst1", "maybe", callAt, IST));
        llmSays("not json");
        assertNull(ft.resolve("inst1", "tomorrow", callAt, IST));
    }

    @Test
    @DisplayName("a call that asked for no callback schedules nothing")
    void noCallbackAsked() {
        AiCallResult r = result();
        r.setDisposition("Interested");
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(queue, never()).enqueueAt(any(), any(), any(), any());
        verifyNoInteractions(poc);
    }

    @Test
    @DisplayName("callback detection: flag, time, text or the Callback disposition")
    void detection() {
        AiCallResult r = new AiCallResult();
        assertFalse(AiCallFollowThrough.wantsCallback(r));
        r.setDisposition("Call Back");
        assertTrue(AiCallFollowThrough.wantsCallback(r));
        r = new AiCallResult();
        r.setCallbackTimeText("kal");
        assertTrue(AiCallFollowThrough.wantsCallback(r));
    }

    private AiCallResult notInterested() {
        AiCallResult r = result();
        r.setDisposition("Not_Interested");
        r.setCustomerEmail("p@example.com");
        return r;
    }

    @Test
    @DisplayName("not interested: waiting calls are cancelled, the callback closed, thank-you by email and WhatsApp")
    void notInterestedThanks() {
        when(templates.ensure("inst1", EngagementSystemTemplates.Kind.NOT_INTERESTED_THANKS)).thenReturn(
                new EngagementSystemTemplates.State(EngagementSystemTemplates.Status.APPROVED, "thank_you_not_interested_ab12cd",
                        "en", java.util.List.of("name", "institute"), "nt1"));
        when(followupRepo.openIdsWithContentPrefix("resp1", "AI callback:")).thenReturn(java.util.List.of("fu1"));
        ft.afterCall(notInterested(), "resp1", "user1", "inst1");
        verify(queue).cancelForLead(eq("inst1"), eq("resp1"), eq("user1"), any());
        verify(followups).close(eq("fu1"), any(), any());
        var rules = ArgumentCaptor.forClass(AiCallActionRule.class);
        verify(actionService, times(2)).createBuiltIn(rules.capture(), eq("inst1"), any(), eq("user1"), eq("resp1"), any(), any(), any());
        var email = rules.getAllValues().stream().filter(x -> "EMAIL".equals(x.getChannel())).findFirst().orElseThrow();
        assertTrue(email.getMessageBody().contains("{{name}}"), "personal, not hard-coded to one lead");
        var wa = rules.getAllValues().stream().filter(x -> "WHATSAPP".equals(x.getChannel())).findFirst().orElseThrow();
        assertEquals("thank_you_not_interested_ab12cd", wa.getTemplate());
        assertEquals(java.util.List.of("{{name}}", "Tutezy"), wa.getTemplateParams());
        // and no callback is scheduled for someone who said no
        verify(queue, never()).enqueueAt(any(), any(), any(), any());
    }

    @Test
    @DisplayName("not interested while the WhatsApp template is still with Meta: email only, and the note says why")
    void notInterestedTemplatePending() {
        when(templates.ensure("inst1", EngagementSystemTemplates.Kind.NOT_INTERESTED_THANKS)).thenReturn(
                new EngagementSystemTemplates.State(EngagementSystemTemplates.Status.PENDING, null, "en", java.util.List.of(), null));
        ft.afterCall(notInterested(), "resp1", "user1", "inst1");
        var rules = ArgumentCaptor.forClass(AiCallActionRule.class);
        verify(actionService, times(1)).createBuiltIn(rules.capture(), any(), any(), any(), any(), any(), any(), any());
        assertEquals("EMAIL", rules.getValue().getChannel());
        verify(timeline).logEvent(eq("STUDENT"), eq("user1"), eq("NOTE"), any(), any(), any(), eq("Not interested: left alone"),
                contains("waits for Meta"), any(), eq("user1"));
    }

    @Test
    @DisplayName("an interested lead gets no thank-you and nothing is cancelled")
    void interestedUntouched() {
        AiCallResult r = result();
        r.setDisposition("Interested");
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(queue, never()).cancelForLead(any(), any(), any(), any());
        verify(actionService, never()).createBuiltIn(any(), any(), any(), any(), any(), any(), any(), any());
        verifyNoInteractions(templates);
    }

    private static String inTwoDays() {
        return java.time.OffsetDateTime.now(IST).plusDays(2).withNano(0).toString();
    }

    @Test
    @DisplayName("a demo agreed on the call with no booking tells the team it is not booked, and sets a follow-up")
    void demoAgreedNotBooked() {
        AiCallResult r = result();
        String iso = inTwoDays();
        r.setRawPayload("{\"meetingRequested\": true, \"meetingDatetimeIso\": \"" + iso + "\"}");
        ft.afterCall(r, "resp1", "user1", "inst1");
        var body = ArgumentCaptor.forClass(String.class);
        verify(poc).alert(eq("inst1"), eq("user1"), eq("Demo agreed on an AI call: Priyanshu"), body.capture(),
                eq("AI_DEMO"), eq("res1"));
        assertTrue(body.getValue().contains("NOT booked"), body.getValue());
        verify(timeline).logJourneyEvent(eq("AUDIENCE_RESPONSE"), eq("resp1"), eq(LeadJourneyActionType.REACHOUT),
                any(), any(), any(), eq("Demo agreed on the AI call"), contains("NOT booked"), any(), eq("user1"));
        var fu = ArgumentCaptor.forClass(CreateLeadFollowupRequest.class);
        verify(followups).create(fu.capture(), any());
        assertTrue(fu.getValue().getContent().startsWith("AI demo:"), fu.getValue().getContent());
        // due an hour before the demo
        assertEquals(java.time.OffsetDateTime.parse(iso).toInstant().minus(Duration.ofHours(1)),
                fu.getValue().getScheduleTime().toInstant());
        // a demo is not a callback: no AI call is queued
        verify(queue, never()).enqueueAt(any(), any(), any(), any());
    }

    @Test
    @DisplayName("a demo the booking page already holds is reported as booked")
    void demoAgreedBooked() {
        AiCallResult r = result();
        String iso = inTwoDays();
        r.setRawPayload("{\"meetingRequested\": true, \"meetingDatetimeIso\": \"" + iso + "\"}");
        var b = new vacademy.io.admin_core_service.features.booking.entity.BookingInstance();
        b.setStatus("CONFIRMED");
        b.setScheduledStartUtc(java.sql.Timestamp.from(java.time.OffsetDateTime.parse(iso).toInstant()));
        when(bookings.findByAudienceResponseId("resp1")).thenReturn(java.util.List.of(b));
        ft.afterCall(r, "resp1", "user1", "inst1");
        var body = ArgumentCaptor.forClass(String.class);
        verify(poc).alert(any(), any(), startsWith("Demo agreed"), body.capture(), eq("AI_DEMO"), any());
        assertTrue(body.getValue().contains("It is booked on the booking page"), body.getValue());
        assertFalse(body.getValue().contains("NOT booked"), body.getValue());
    }

    @Test
    @DisplayName("a day with no time of day is never reported as a booked midnight demo")
    void demoAgreedDayOnly() {
        AiCallResult r = result();
        String iso = java.time.LocalDate.now().plusDays(2) + "T00:00:00+05:30";
        r.setRawPayload("{\"meetingRequested\": true, \"meetingDatetimeIso\": \"" + iso + "\"}");
        var b = new vacademy.io.admin_core_service.features.booking.entity.BookingInstance();
        b.setStatus("CONFIRMED");
        b.setScheduledStartUtc(java.sql.Timestamp.from(java.time.OffsetDateTime.parse(iso).toInstant()));
        org.mockito.Mockito.lenient().when(bookings.findByAudienceResponseId("resp1")).thenReturn(java.util.List.of(b));
        ft.afterCall(r, "resp1", "user1", "inst1");
        var body = ArgumentCaptor.forClass(String.class);
        verify(poc).alert(any(), any(), startsWith("Demo agreed"), body.capture(), eq("AI_DEMO"), any());
        assertTrue(body.getValue().contains("no time of day fixed"), body.getValue());
        assertTrue(body.getValue().contains("NOT booked"), body.getValue());
        assertFalse(body.getValue().contains("12:00 AM"), body.getValue());
        assertTrue(AiCallFollowThrough.isDayOnly(java.time.OffsetDateTime.parse(iso)));
        assertFalse(AiCallFollowThrough.isDayOnly(java.time.OffsetDateTime.parse("2026-11-13T12:30:00+05:30")));
    }

    @Test
    @DisplayName("a call with no meeting in its report raises no demo alert")
    void noDemoNoAlert() {
        AiCallResult r = result();
        r.setRawPayload("{\"meetingRequested\": false, \"meetingDatetimeIso\": null}");
        ft.afterCall(r, "resp1", "user1", "inst1");
        r.setRawPayload(null);
        ft.afterCall(r, "resp1", "user1", "inst1");
        verify(poc, never()).alert(any(), any(), startsWith("Demo agreed"), any(), any(), any());
    }

    @Test
    @DisplayName("a demo whose time cannot be read still reaches the team")
    void demoAgreedNoTime() {
        AiCallResult r = result();
        r.setRawPayload("{\"meetingRequested\": true, \"meetingDatetimeIso\": \"tomorrow-ish\"}");
        ft.afterCall(r, "resp1", "user1", "inst1");
        var body = ArgumentCaptor.forClass(String.class);
        verify(poc).alert(any(), any(), startsWith("Demo agreed"), body.capture(), eq("AI_DEMO"), any());
        assertTrue(body.getValue().contains("a time that could not be read"), body.getValue());
    }
}
