package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.booking.dto.PublicBookingDTOs;
import vacademy.io.admin_core_service.features.booking.entity.BookingInstance;
import vacademy.io.admin_core_service.features.booking.entity.BookingPage;
import vacademy.io.admin_core_service.features.booking.repository.BookingInstanceRepository;
import vacademy.io.admin_core_service.features.booking.service.BookingPageService;
import vacademy.io.admin_core_service.features.booking.service.PublicBookingService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** The engine handles replies about an existing meeting, and new leads join their engines within a minute. */
class EngagementMeetingIntentTest {

    @Nested
    @DisplayName("reading the reply")
    class Reading {
        @Test
        @DisplayName("the quoted original below an email reply is ignored")
        void stripsQuote() {
            String reply = "Can we reschedule it to Monday 10 am.\n\nOn Thu, 29 Oct, 2026, 6:04 pm , <support@tutezy.ai> wrote:\n\n> Hi Priyanshu,\n> book your demo";
            assertEquals("Can we reschedule it to Monday 10 am.", EngagementMeetingIntentService.newPart(reply));
        }

        @Test
        @DisplayName("reschedule and cancel phrasings are recognised; ordinary replies are not")
        void patterns() {
            assertTrue(EngagementMeetingIntentService.RESCHEDULE.matcher("Can we reschedule it to Monday 10 am").find());
            assertTrue(EngagementMeetingIntentService.RESCHEDULE.matcher("can we do it at 4 pm instead").find());
            assertTrue(EngagementMeetingIntentService.CANCEL.matcher("Sorry, I can't make it tomorrow").find());
            assertFalse(EngagementMeetingIntentService.RESCHEDULE.matcher("Thanks, see you on Friday").find());
            assertFalse(EngagementMeetingIntentService.CANCEL.matcher("Thanks, see you on Friday").find());
        }
    }

    @Nested
    @DisplayName("handling")
    class Handling {
        private EngagementMeetingIntentService svc;
        private BookingInstanceRepository bookings;
        private PublicBookingService publicBooking;
        private EngagementMemberRepository members;
        private EngagementActionRepository actions;
        private BookingInstance meeting;
        private EngagementDispatcher dispatcher;
        private vacademy.io.admin_core_service.features.agent.service.LLMService llm;

        private void llmSays(String text) {
            var resp = mock(vacademy.io.admin_core_service.features.agent.service.LLMService.LLMResponse.class);
            when(resp.getContent()).thenReturn(text);
            when(llm.generateChatCompletion(any())).thenReturn(resp);
        }

        private java.util.List<EngagementAction> saved() {
            ArgumentCaptor<EngagementAction> c = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions, atLeastOnce()).save(c.capture());
            return c.getAllValues();
        }

        @BeforeEach
        void setUp() {
            svc = spy(new EngagementMeetingIntentService());
            bookings = mock(BookingInstanceRepository.class);
            publicBooking = mock(PublicBookingService.class);
            members = mock(EngagementMemberRepository.class);
            actions = mock(EngagementActionRepository.class);
            BookingPageService pages = mock(BookingPageService.class);
            ReflectionTestUtils.setField(svc, "bookingRepository", bookings);
            ReflectionTestUtils.setField(svc, "publicBookingService", publicBooking);
            ReflectionTestUtils.setField(svc, "memberRepository", members);
            ReflectionTestUtils.setField(svc, "actionRepository", actions);
            ReflectionTestUtils.setField(svc, "bookingPageService", pages);
            dispatcher = mock(EngagementDispatcher.class);
            llm = mock(vacademy.io.admin_core_service.features.agent.service.LLMService.class);
            ReflectionTestUtils.setField(svc, "dispatcher", dispatcher);
            ReflectionTestUtils.setField(svc, "llmService", llm);
            when(actions.claimForDispatch(any(), any(), any())).thenReturn(1);
            when(actions.findById(any())).thenAnswer(inv -> Optional.empty());
            when(dispatcher.dispatchClaimed(any(), any(), any(), eq(true))).thenAnswer(inv -> inv.getArgument(0));

            meeting = new BookingInstance();
            meeting.setId("b1");
            meeting.setInstituteId("i1");
            meeting.setBookingPageId("p1");
            meeting.setAudienceResponseId("r1");
            meeting.setInviteeName("Priyanshu Mishra");
            meeting.setManageToken("tok-1");
            meeting.setScheduledStartUtc(Timestamp.from(Instant.now().plus(1, ChronoUnit.DAYS)));
            BookingPage page = new BookingPage();
            page.setSlug("demo");
            page.setTimezone("Asia/Kolkata");
            when(pages.getOrThrow("p1")).thenReturn(page);
            when(bookings.findLiveBookingsOfPersonBetween(any(), any(), any(), any(), any(), any(), any()))
                    .thenReturn(List.of(meeting));
            when(members.claimHandledReply(any(), any(), any())).thenReturn(1);
            EngagementMember m = new EngagementMember();
            m.setId("m1");
            m.setEngineId("e1");
            when(members.findLatestForSubject(any(), any(), any())).thenReturn(Optional.of(m));
            when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
        }

        @Test
        @DisplayName("a free slot: the booking is moved and the engine records it")
        void reschedules() throws Exception {
            String monday = Instant.now().plus(4, ChronoUnit.DAYS).atOffset(java.time.ZoneOffset.ofHoursMinutes(5, 30))
                    .withHour(10).withMinute(0).withSecond(0).withNano(0).toString();
            doReturn(new EngagementMeetingIntentService.MeetingRequest("RESCHEDULE", monday))
                    .when(svc).readRequest(any(), any(), any(), any(), any());
            PublicBookingDTOs.PublicBookingViewDTO moved = new PublicBookingDTOs.PublicBookingViewDTO();
            moved.setStartTimeUtc(java.time.OffsetDateTime.parse(monday).toInstant().toString());
            when(publicBooking.reschedule(eq("tok-1"), any())).thenReturn(moved);

            assertTrue(svc.handle("i1", "EMAIL", null, "priyanshu@vidyayatan.com",
                    "Can we reschedule it to Monday 10 am.", "email:x"));

            ArgumentCaptor<PublicBookingDTOs.PublicRescheduleRequestDTO> req =
                    ArgumentCaptor.forClass(PublicBookingDTOs.PublicRescheduleRequestDTO.class);
            verify(publicBooking).reschedule(eq("tok-1"), req.capture());
            assertEquals(java.time.OffsetDateTime.parse(monday).toInstant(),
                    java.time.OffsetDateTime.parse(req.getValue().getStartTime()).toInstant());
            EngagementAction done = saved().stream().filter(a -> "RESCHEDULED".equals(a.getOutcome())).findFirst().orElseThrow();
            assertEquals("e1", done.getEngineId());
            assertEquals("DONE", done.getStatus());
            // and the lead is told, on the channel they wrote on, with the time
            ArgumentCaptor<EngagementAction> sent = ArgumentCaptor.forClass(EngagementAction.class);
            verify(dispatcher).dispatchClaimed(sent.capture(), isNull(), any(), eq(true));
            assertEquals("EMAIL", sent.getValue().getChannel());
            assertTrue(sent.getValue().getDraftBody().contains("Your meeting is now on"), sent.getValue().getDraftBody());
        }

        @Test
        @DisplayName("the confirmation is written in the language the lead used, and never carries a link it was not given")
        void confirmationInTheirLanguage() throws Exception {
            String monday = Instant.now().plus(4, ChronoUnit.DAYS).atOffset(java.time.ZoneOffset.ofHoursMinutes(5, 30)).toString();
            doReturn(new EngagementMeetingIntentService.MeetingRequest("RESCHEDULE", monday))
                    .when(svc).readRequest(any(), any(), any(), any(), any());
            PublicBookingDTOs.PublicBookingViewDTO moved = new PublicBookingDTOs.PublicBookingViewDTO();
            moved.setStartTimeUtc(java.time.OffsetDateTime.parse(monday).toInstant().toString());
            moved.setMeetLink("https://meet.google.com/abc-defg-hij");
            when(publicBooking.reschedule(eq("tok-1"), any())).thenReturn(moved);
            llmSays("Theek hai, aapki meeting move ho gayi. Link: https://meet.google.com/abc-defg-hij");
            assertTrue(svc.handle("i1", "WHATSAPP", "9968858268", null, "bhai meeting ko monday kar do", "w9"));
            ArgumentCaptor<EngagementAction> sent = ArgumentCaptor.forClass(EngagementAction.class);
            verify(dispatcher).dispatchClaimed(sent.capture(), isNull(), any(), eq(true));
            assertEquals("WHATSAPP", sent.getValue().getChannel());
            assertTrue(sent.getValue().getDraftBody().startsWith("Theek hai"), sent.getValue().getDraftBody());

            reset(dispatcher);
            when(dispatcher.dispatchClaimed(any(), any(), any(), eq(true))).thenAnswer(inv -> inv.getArgument(0));
            llmSays("Done! Join here: https://evil.example/phish");
            when(members.claimHandledReply(any(), any(), any())).thenReturn(1);
            assertTrue(svc.handle("i1", "WHATSAPP", "9968858268", null, "please move it to monday", "w10"));
            verify(dispatcher).dispatchClaimed(sent.capture(), isNull(), any(), eq(true));
            assertFalse(sent.getValue().getDraftBody().contains("evil.example"), sent.getValue().getDraftBody());
        }

        @Test
        @DisplayName("the slot is taken: a reply offering free slots waits in the inbox")
        void slotTaken() throws Exception {
            String t = Instant.now().plus(4, ChronoUnit.DAYS).atOffset(java.time.ZoneOffset.ofHoursMinutes(5, 30)).toString();
            doReturn(new EngagementMeetingIntentService.MeetingRequest("RESCHEDULE", t))
                    .when(svc).readRequest(any(), any(), any(), any(), any());
            when(publicBooking.reschedule(any(), any())).thenThrow(new VacademyException("This slot is no longer available."));
            assertTrue(svc.handle("i1", "EMAIL", null, "p@x.com", "can we reschedule to Monday 10 am", "email:y"));
            ArgumentCaptor<EngagementAction> sent = ArgumentCaptor.forClass(EngagementAction.class);
            verify(dispatcher).dispatchClaimed(sent.capture(), isNull(), any(), eq(true));
            assertNotNull(sent.getValue().getDraftBody());
            assertTrue(saved().stream().anyMatch(a -> "DONE".equals(a.getStatus())), "the ask is recorded");
        }

        @Test
        @DisplayName("no clear time: the engine asks when, in the language the lead used, instead of leaving a draft")
        void asksWhen() throws Exception {
            doReturn(new EngagementMeetingIntentService.MeetingRequest("RESCHEDULE", null))
                    .when(svc).readRequest(any(), any(), any(), any(), any());
            llmSays("Zaroor! Aapko meeting kab rakhni hai? Din aur time bata dijiye.");
            assertTrue(svc.handle("i1", "WHATSAPP", "9968858268", null, "can we reschedule my meeting", "w11"));
            ArgumentCaptor<EngagementAction> sent = ArgumentCaptor.forClass(EngagementAction.class);
            verify(dispatcher).dispatchClaimed(sent.capture(), isNull(), any(), eq(true));
            assertEquals("WHATSAPP", sent.getValue().getChannel());
            assertTrue(sent.getValue().getDraftBody().startsWith("Zaroor!"), sent.getValue().getDraftBody());
            verify(publicBooking, never()).reschedule(any(), any());
        }

        @Test
        @DisplayName("a cancellation goes to the team, nothing is cancelled automatically")
        void cancelGoesToTeam() throws Exception {
            doReturn(new EngagementMeetingIntentService.MeetingRequest("CANCEL", null))
                    .when(svc).readRequest(any(), any(), any(), any(), any());
            assertTrue(svc.handle("i1", "WHATSAPP", "9968858268", null, "Sorry I can't make it", "w1"));
            verify(publicBooking, never()).reschedule(any(), any());
            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions).save(saved.capture());
            assertTrue(saved.getValue().getRationale().startsWith("Wants to cancel"));
        }

        @Test
        @DisplayName("no upcoming meeting: not handled here, the normal reply flow takes it")
        void noMeeting() {
            when(bookings.findLiveBookingsOfPersonBetween(any(), any(), any(), any(), any(), any(), any())).thenReturn(List.of());
            assertFalse(svc.handle("i1", "EMAIL", null, "p@x.com", "can we reschedule to Monday", "email:z"));
            verify(members, never()).claimHandledReply(any(), any(), any());
        }

        @Test
        @DisplayName("a message already handled is not acted on twice")
        void dedup() {
            when(members.claimHandledReply(any(), any(), any())).thenReturn(0);
            assertTrue(svc.handle("i1", "EMAIL", null, "p@x.com", "can we reschedule to Monday", "email:z"));
            verifyNoInteractions(publicBooking);
        }
    }

    @Nested
    @DisplayName("booking from a reply")
    class Booking {
        private EngagementMeetingIntentService svc;
        private vacademy.io.admin_core_service.features.booking.service.MeetingBookingService meetings;
        private EngagementActionRepository actions;
        private EngagementEngine engine;
        private EngagementDispatcher dispatcher;

        @BeforeEach
        void setUp() {
            svc = spy(new EngagementMeetingIntentService());
            meetings = mock(vacademy.io.admin_core_service.features.booking.service.MeetingBookingService.class);
            actions = mock(EngagementActionRepository.class);
            BookingPageService pages = mock(BookingPageService.class);
            var responses = mock(vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository.class);
            ReflectionTestUtils.setField(svc, "meetingBookingService", meetings);
            ReflectionTestUtils.setField(svc, "actionRepository", actions);
            ReflectionTestUtils.setField(svc, "bookingPageService", pages);
            ReflectionTestUtils.setField(svc, "audienceResponseRepository", responses);
            ReflectionTestUtils.setField(svc, "publicBookingService", mock(PublicBookingService.class));
            dispatcher = mock(EngagementDispatcher.class);
            ReflectionTestUtils.setField(svc, "dispatcher", dispatcher);
            when(actions.claimForDispatch(any(), any(), any())).thenReturn(1);
            when(dispatcher.dispatchClaimed(any(), any(), any(), eq(true))).thenAnswer(inv -> inv.getArgument(0));
            BookingPage page = new BookingPage();
            page.setId("p1");
            page.setInstituteId("i1");
            page.setStatus("ACTIVE");
            page.setSlug("demo");
            page.setTitle("Demo");
            page.setHostUserId("host");
            page.setTimezone("Asia/Kolkata");
            when(pages.getOrThrow("p1")).thenReturn(page);
            var lead = new vacademy.io.admin_core_service.features.audience.entity.AudienceResponse();
            lead.setParentName("Priyanshu Mishra");
            lead.setParentEmail("priyanshu@vidyayatan.com");
            when(responses.findById("r1")).thenReturn(Optional.of(lead));
            when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
            engine = new EngagementEngine();
            engine.setId("e1");
            engine.setInstituteId("i1");
            engine.setChannels("{\"EMAIL\":{\"enabled\":true},\"bookingPageId\":\"p1\"}");
        }

        @Test
        @DisplayName("a clear free time: the engine books it on its page and records BOOKED")
        void books() throws Exception {
            String t = Instant.now().plus(4, ChronoUnit.DAYS).atOffset(java.time.ZoneOffset.ofHoursMinutes(5, 30))
                    .withHour(11).withMinute(0).withSecond(0).withNano(0).toString();
            doReturn(new EngagementMeetingIntentService.MeetingRequest("BOOK", t))
                    .when(svc).readBookingRequest(any(), any(), any(), any());
            assertTrue(svc.bookFromReply(engine, "m1", null, "r1", "EMAIL", "Please book the demo for Monday 11 am"));
            var req = ArgumentCaptor.forClass(vacademy.io.admin_core_service.features.booking.dto.MeetingBookingRequestDTO.class);
            verify(meetings).createBooking(req.capture(), any());
            assertEquals("p1", req.getValue().getBookingPageId());
            assertEquals("r1", req.getValue().getAudienceResponseId());
            assertEquals("priyanshu@vidyayatan.com", req.getValue().getInviteeEmail());
            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions, atLeastOnce()).save(saved.capture());
            assertTrue(saved.getAllValues().stream().anyMatch(a -> "BOOKED".equals(a.getOutcome())));
            ArgumentCaptor<EngagementAction> sent = ArgumentCaptor.forClass(EngagementAction.class);
            verify(dispatcher).dispatchClaimed(sent.capture(), isNull(), any(), eq(true));
            assertEquals("EMAIL", sent.getValue().getChannel());
            assertTrue(sent.getValue().getDraftBody().contains("booked"), sent.getValue().getDraftBody());
        }

        @Test
        @DisplayName("no booking page on the engine: not handled, the normal reply flow takes it")
        void noPage() {
            engine.setChannels("{\"EMAIL\":{\"enabled\":true}}");
            assertFalse(svc.bookFromReply(engine, "m1", null, "r1", "EMAIL", "Please book the demo for Monday 11 am"));
            verifyNoInteractions(meetings);
        }

        @Test
        @DisplayName("not bookable (taken / a meeting that day): free slots and the link wait in the inbox")
        void notBookable() throws Exception {
            String t = Instant.now().plus(4, ChronoUnit.DAYS).atOffset(java.time.ZoneOffset.ofHoursMinutes(5, 30)).toString();
            doReturn(new EngagementMeetingIntentService.MeetingRequest("BOOK", t))
                    .when(svc).readBookingRequest(any(), any(), any(), any());
            when(meetings.createBooking(any(), any())).thenThrow(new vacademy.io.common.exceptions.ConflictException("already has a meeting"));
            assertTrue(svc.bookFromReply(engine, "m1", null, "r1", "EMAIL", "book the demo for Monday 11 am"));
            ArgumentCaptor<EngagementAction> sent = ArgumentCaptor.forClass(EngagementAction.class);
            verify(dispatcher).dispatchClaimed(sent.capture(), isNull(), any(), eq(true));
            assertTrue(sent.getValue().getDraftBody().contains("booking-response?instituteId=i1&slug=demo"));
        }

        @Test
        @DisplayName("an ordinary reply is not treated as a booking request")
        void ordinary() {
            assertFalse(svc.bookFromReply(engine, "m1", null, "r1", "EMAIL", "Thanks, I will check and get back"));
        }
    }

    @Nested
    @DisplayName("intake")
    class Intake {
        @Test
        @DisplayName("a new lead in a targeted list joins; one already in an engine is left alone")
        void enrolsNewOnly() {
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementReadDao dao = mock(EngagementReadDao.class);
            EngagementEngineService service = mock(EngagementEngineService.class);
            EngagementEngine e = new EngagementEngine();
            e.setStatus("ACTIVE");
            e.setAudience("[{\"type\":\"AUDIENCE\",\"id\":\"list1\"},{\"type\":\"PACKAGE_SESSION\",\"id\":\"ps\"}]");
            when(members.institutesWithLiveEngines()).thenReturn(List.of("i1"));
            when(engines.findByInstituteIdOrderByCreatedAtDesc("i1")).thenReturn(List.of(e));
            when(dao.leadsSubmittedSince(eq(java.util.Set.of("list1")), any())).thenReturn(List.of(
                    new Object[]{"rNew", "list1", "i1", "u1"}, new Object[]{"rOld", "list1", "i1", "u2"}));
            when(members.responsesWithMembership(any())).thenReturn(List.of("rOld"));
            when(service.enrollNewLead(any(), any(), any(), any())).thenReturn(1);

            new EngagementIntakeSweepJob(engines, members, dao, service).sweep();

            verify(service).enrollNewLead("i1", "list1", "rNew", "u1");
            verify(service, never()).enrollNewLead(any(), any(), eq("rOld"), any());
        }
    }
}
