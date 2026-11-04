package vacademy.io.admin_core_service.features.booking.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.booking.entity.BookingInstance;
import vacademy.io.admin_core_service.features.engagement.service.EngagementSystemTemplates;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.institute.entity.Institute;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** A booking is confirmed on WhatsApp with the institute's shared template, unless the engine already did on WhatsApp. */
class SharedWhatsappConfirmationTest {

    private MeetingBookingService svc;
    private NotificationService notifications;
    private EngagementSystemTemplates templates;
    private BookingInstance booking;

    @BeforeEach
    void setUp() {
        svc = mock(MeetingBookingService.class, CALLS_REAL_METHODS);
        notifications = mock(NotificationService.class);
        templates = mock(EngagementSystemTemplates.class);
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute i = new Institute();
        i.setInstituteName("Tutezy");
        when(institutes.findById("i1")).thenReturn(Optional.of(i));
        ReflectionTestUtils.setField(svc, "notificationService", notifications);
        ReflectionTestUtils.setField(svc, "systemTemplates", templates);
        ReflectionTestUtils.setField(svc, "instituteRepository", institutes);
        booking = new BookingInstance();
        booking.setId("b1");
        booking.setInstituteId("i1");
        booking.setInviteeName("Priyanshu");
        booking.setInviteePhone("+919968858268");
        booking.setMeetLink("https://meet.google.com/abc-defg-hij");
        booking.setScheduledStartUtc(Timestamp.from(Instant.parse("2026-10-30T04:30:00Z")));
        when(templates.ensure(eq("i1"), eq(EngagementSystemTemplates.Kind.MEETING_CONFIRMATION))).thenReturn(
                new EngagementSystemTemplates.State(EngagementSystemTemplates.Status.APPROVED, "meeting_confirmation_ab12cd", "en",
                        List.of("name", "institute", "meeting_time", "meeting_link"), "nt1"));
    }

    private void confirm() {
        ReflectionTestUtils.invokeMethod(svc, "sendConfirmationWhatsapp", booking, "Demo", ZoneId.of("Asia/Kolkata"), null);
    }

    @Test
    @DisplayName("a page with no WhatsApp template of its own: the shared template goes out with name, time and link")
    void sendsSharedTemplate() {
        confirm();
        var req = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(notifications).sendUnified(req.capture());
        assertEquals("meeting_confirmation_ab12cd", req.getValue().getTemplateName());
        var vars = req.getValue().getRecipients().get(0).getVariables();
        assertEquals("Priyanshu", vars.get("name"));
        assertEquals("Tutezy", vars.get("institute"));
        assertEquals("https://meet.google.com/abc-defg-hij", vars.get("meeting_link"));
        assertTrue(vars.get("meeting_time").contains("30 Oct 2026 at 10:00"), vars.get("meeting_time"));
        assertEquals(1, vars.get("meeting_time").split("Asia/Kolkata", -1).length - 1, "the zone appears once");
    }

    @Test
    @DisplayName("when the engine confirms on WhatsApp itself, the template is not sent as a second message")
    void engineConfirmsItself() {
        MeetingBookingService.withEngineConfirmingOnWhatsapp(() -> {
            confirm();
            return null;
        });
        verifyNoInteractions(notifications);
    }

    @Test
    @DisplayName("template still in review, or no phone: nothing is sent")
    void notReadyOrNoPhone() {
        when(templates.ensure(any(), any())).thenReturn(new EngagementSystemTemplates.State(
                EngagementSystemTemplates.Status.PENDING, null, "en", List.of(), null));
        confirm();
        booking.setInviteePhone(null);
        when(templates.ensure(any(), any())).thenReturn(new EngagementSystemTemplates.State(
                EngagementSystemTemplates.Status.APPROVED, "x", "en", List.of(), "nt"));
        confirm();
        verifyNoInteractions(notifications);
    }
}
