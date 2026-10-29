package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.booking.entity.BookingInstance;
import vacademy.io.admin_core_service.features.booking.service.MeetingBookingService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** The team hears about it: a meeting booked or moved, a lead who wants a person, a template Meta turned down. */
class EngagementTeamAlertsTest {

    private static UserDTO user(String id, String name, String email, String mobile) {
        UserDTO u = new UserDTO();
        u.setId(id);
        u.setFullName(name);
        u.setEmail(email);
        u.setMobileNumber(mobile);
        return u;
    }

    @Nested
    @DisplayName("points of contact")
    class Poc {
        private EngagementPointsOfContact poc;
        private NotificationService notifications;
        private EngagementSystemTemplates templates;

        @BeforeEach
        void setUp() {
            poc = new EngagementPointsOfContact();
            notifications = mock(NotificationService.class);
            AuthService auth = mock(AuthService.class);
            templates = mock(EngagementSystemTemplates.class);
            when(auth.requireUsersByInstituteAndRoles("i1", List.of("ADMIN")))
                    .thenReturn(List.of(user("a1", "Riya Jain", "riya@x.test", "9811111111")));
            when(auth.getUsersFromAuthServiceByUserIds(List.of("host1")))
                    .thenReturn(List.of(user("host1", "Host One", "host@x.test", null)));
            ReflectionTestUtils.setField(poc, "authService", auth);
            ReflectionTestUtils.setField(poc, "notificationService", notifications);
            ReflectionTestUtils.setField(poc, "systemTemplates", templates);
        }

        @Test
        @DisplayName("admins and the meeting's host are emailed and bell-alerted; WhatsApp goes to those with a number")
        void emailBellWhatsapp() {
            when(templates.ensure("i1", EngagementSystemTemplates.Kind.STAFF_MEETING_ALERT)).thenReturn(
                    new EngagementSystemTemplates.State(EngagementSystemTemplates.Status.APPROVED, "staff_meeting_alert_ab12cd", "en",
                            List.of("staff_name", "lead_name", "lead_phone", "meeting_time"), "nt"));
            int emailed = poc.alertAbout("i1", null, List.of("host1"), "Meeting scheduled with Asha", "<p>x</p>", "MEETING_SCHEDULED", "b1",
                    Map.of("lead_name", "Asha", "lead_phone", "+91 98", "meeting_time", "Fri 10:00"));
            assertEquals(2, emailed);
            verify(notifications).createSystemAlertAnnouncement(eq("i1"), eq(List.of("a1", "host1")), any(), any(), any(), any(), any(), any(),
                    eq("MEETING_SCHEDULED"), eq("b1"));
            var req = ArgumentCaptor.forClass(UnifiedSendRequest.class);
            verify(notifications, times(1)).sendUnified(req.capture());   // only Riya has a number
            assertEquals("staff_meeting_alert_ab12cd", req.getValue().getTemplateName());
            assertEquals("Riya", req.getValue().getRecipients().get(0).getVariables().get("staff_name"));
            assertEquals("Asha", req.getValue().getRecipients().get(0).getVariables().get("lead_name"));
        }

        @Test
        @DisplayName("staff template not approved yet: email and bell only")
        void noWhatsappUntilApproved() {
            when(templates.ensure(any(), any())).thenReturn(new EngagementSystemTemplates.State(
                    EngagementSystemTemplates.Status.PENDING, null, "en", List.of(), null));
            poc.alertAbout("i1", null, null, "t", "<p>x</p>", "K", "id", Map.of("lead_name", "A"));
            verify(notifications, never()).sendUnified(any());
            verify(notifications, atLeastOnce()).sendHtmlEmailViaUnified(any(), any(), any(), any(), any(), any(), any());
        }
    }

    @Nested
    @DisplayName("a meeting was booked or moved")
    class Meeting {
        private MeetingBookingService svc;
        private EngagementPointsOfContact poc;
        private EngagementSystemTemplates templates;
        private BookingInstance booking;

        @BeforeEach
        void setUp() {
            svc = mock(MeetingBookingService.class, CALLS_REAL_METHODS);
            poc = mock(EngagementPointsOfContact.class);
            templates = mock(EngagementSystemTemplates.class);
            ReflectionTestUtils.setField(svc, "pointsOfContact", poc);
            ReflectionTestUtils.setField(svc, "systemTemplates", templates);
            booking = new BookingInstance();
            booking.setId("b1");
            booking.setInstituteId("i1");
            booking.setAudienceResponseId("r1");
            booking.setInviteeUserId("u1");
            booking.setHostUserId("host1");
            booking.setInviteeName("Priyanshu <b>");
            booking.setInviteePhone("+919968858268");
            booking.setScheduledStartUtc(Timestamp.from(Instant.parse("2026-10-30T04:30:00Z")));
            when(templates.runsLiveEngine("i1")).thenReturn(true);
        }

        @Test
        @DisplayName("scheduled: the team and the host are told, lead text escaped, WhatsApp variables given")
        void scheduled() {
            svc.alertStaffAboutMeeting(booking, "Demo", ZoneId.of("Asia/Kolkata"), "scheduled", null);
            var body = ArgumentCaptor.forClass(String.class);
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, String>> wa = ArgumentCaptor.forClass(Map.class);
            verify(poc).alertAbout(eq("i1"), eq("u1"), eq(List.of("host1")), eq("Meeting scheduled with Priyanshu <b>"),
                    body.capture(), eq("MEETING_SCHEDULED"), eq("b1"), wa.capture());
            assertTrue(body.getValue().contains("Priyanshu &lt;b&gt;"), body.getValue());
            assertTrue(body.getValue().contains("30 Oct 2026 at 10:00"), body.getValue());
            assertEquals("Priyanshu <b>", wa.getValue().get("lead_name"));
        }

        @Test
        @DisplayName("rescheduled: says when it was")
        void rescheduled() {
            svc.alertStaffAboutMeeting(booking, "Demo", ZoneId.of("Asia/Kolkata"), "rescheduled", Instant.parse("2026-10-29T08:30:00Z"));
            var body = ArgumentCaptor.forClass(String.class);
            verify(poc).alertAbout(any(), any(), any(), any(), body.capture(), eq("MEETING_RESCHEDULED"), any(), any());
            assertTrue(body.getValue().contains("It was on"), body.getValue());
        }

        @Test
        @DisplayName("an institute without an engine, or a booking with no lead, tells nobody")
        void gated() {
            when(templates.runsLiveEngine("i1")).thenReturn(false);
            svc.alertStaffAboutMeeting(booking, "Demo", ZoneId.of("Asia/Kolkata"), "scheduled", null);
            when(templates.runsLiveEngine("i1")).thenReturn(true);
            booking.setAudienceResponseId(null);
            svc.alertStaffAboutMeeting(booking, "Demo", ZoneId.of("Asia/Kolkata"), "scheduled", null);
            verifyNoInteractions(poc);
        }
    }

    @Nested
    @DisplayName("Meta turns a template down")
    class Template {
        @Test
        @DisplayName("the admins are told which template, which engine and Meta's reason")
        void rejected() {
            EngagementTemplateProposalRepository proposals = mock(EngagementTemplateProposalRepository.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            var service = new EngagementTemplateProposalService(proposals, engines, mock(EngagementPromptVersionRepository.class),
                    mock(EngagementTemplateAdvisor.class), mock(EngagementInternalClients.class));
            EngagementPointsOfContact poc = mock(EngagementPointsOfContact.class);
            ReflectionTestUtils.setField(service, "pointsOfContact", poc);
            EngagementEngine e = new EngagementEngine();
            e.setId("e1");
            e.setName("Tutezy teachers");
            when(engines.findById("e1")).thenReturn(Optional.of(e));
            EngagementTemplateProposal p = new EngagementTemplateProposal();
            p.setId("p1");
            p.setEngineId("e1");
            p.setInstituteId("i1");
            p.setName("teacher_demo_intro_c0c6c3");
            ReflectionTestUtils.invokeMethod(service, "alertTemplateProblem", p, "rejected", "Variables look like spam <x>");
            var body = ArgumentCaptor.forClass(String.class);
            verify(poc).alert(eq("i1"), isNull(), eq("WhatsApp template rejected: teacher_demo_intro_c0c6c3"), body.capture(),
                    eq("ENGAGEMENT_TEMPLATE"), eq("p1"));
            assertTrue(body.getValue().contains("Tutezy teachers"), body.getValue());
            assertTrue(body.getValue().contains("Variables look like spam &lt;x&gt;"), body.getValue());
        }

        @Test
        @DisplayName("an institute-wide shared template says so, and that email carries on")
        void sharedTemplate() {
            var service = new EngagementTemplateProposalService(mock(EngagementTemplateProposalRepository.class),
                    mock(EngagementEngineRepository.class), mock(EngagementPromptVersionRepository.class),
                    mock(EngagementTemplateAdvisor.class), mock(EngagementInternalClients.class));
            EngagementPointsOfContact poc = mock(EngagementPointsOfContact.class);
            ReflectionTestUtils.setField(service, "pointsOfContact", poc);
            EngagementTemplateProposal p = new EngagementTemplateProposal();
            p.setId("p2");
            p.setInstituteId("i1");
            p.setName("meeting_confirmation_ab12cd");
            p.setPurpose("SYS:MEETING_CONFIRMATION");
            ReflectionTestUtils.invokeMethod(service, "alertTemplateProblem", p, "rejected", null);
            var body = ArgumentCaptor.forClass(String.class);
            verify(poc).alert(eq("i1"), isNull(), any(), body.capture(), any(), any());
            assertTrue(body.getValue().contains("shared"), body.getValue());
            assertTrue(body.getValue().contains("by email only"), body.getValue());
            assertTrue(body.getValue().contains("Meta gave no reason"), body.getValue());
        }
    }
}
