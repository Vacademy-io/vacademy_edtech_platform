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
            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions, atLeastOnce()).save(saved.capture());
            EngagementAction last = saved.getValue();
            assertEquals("RESCHEDULED", last.getOutcome());
            assertEquals("e1", last.getEngineId());
            assertEquals("DONE", last.getStatus());
        }

        @Test
        @DisplayName("the slot is taken: a reply offering free slots waits in the inbox")
        void slotTaken() throws Exception {
            String t = Instant.now().plus(4, ChronoUnit.DAYS).atOffset(java.time.ZoneOffset.ofHoursMinutes(5, 30)).toString();
            doReturn(new EngagementMeetingIntentService.MeetingRequest("RESCHEDULE", t))
                    .when(svc).readRequest(any(), any(), any(), any(), any());
            when(publicBooking.reschedule(any(), any())).thenThrow(new VacademyException("This slot is no longer available."));
            assertTrue(svc.handle("i1", "EMAIL", null, "p@x.com", "can we reschedule to Monday 10 am", "email:y"));
            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions).save(saved.capture());
            assertEquals("OPEN", saved.getValue().getStatus());
            assertNotNull(saved.getValue().getDraftBody());
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
