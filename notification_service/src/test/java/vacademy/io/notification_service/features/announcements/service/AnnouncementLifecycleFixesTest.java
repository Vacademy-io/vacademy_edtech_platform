package vacademy.io.notification_service.features.announcements.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.notification_service.features.announcements.entity.Announcement;
import vacademy.io.notification_service.features.announcements.entity.AnnouncementDashboardPin;
import vacademy.io.notification_service.features.announcements.entity.ScheduledMessage;
import vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus;
import vacademy.io.notification_service.features.announcements.client.AuthServiceClient;
import vacademy.io.notification_service.features.announcements.repository.*;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Approval of a "send now" announcement, switching an announcement off, dashboard pin windows and
 * the dashboard's setting values.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AnnouncementLifecycleFixesTest {

    // Every constructor dependency is mocked: @InjectMocks passes null for any that is not.
    @Mock private AnnouncementRepository announcementRepository;
    @Mock private RichTextDataRepository richTextDataRepository;
    @Mock private AnnouncementRecipientRepository recipientRepository;
    @Mock private AnnouncementMediumRepository mediumRepository;
    @Mock private ScheduledMessageRepository scheduledMessageRepository;
    @Mock private RecipientMessageRepository recipientMessageRepository;
    @Mock private MessageInteractionRepository messageInteractionRepository;
    @Mock private MessageReplyRepository messageReplyRepository;
    @Mock private NotificationLogRepository notificationLogRepository;
    @Mock private AnnouncementSystemAlertRepository systemAlertRepository;
    @Mock private AnnouncementDashboardPinRepository dashboardPinRepository;
    @Mock private AnnouncementDMRepository dmRepository;
    @Mock private AnnouncementStreamRepository streamRepository;
    @Mock private AnnouncementResourceRepository resourceRepository;
    @Mock private AnnouncementCommunityRepository communityRepository;
    @Mock private AnnouncementTaskRepository taskRepository;
    @Mock private AnnouncementAppOverlayRepository appOverlayRepository;
    @Mock private AnnouncementSchedulingService schedulingService;
    @Mock private AnnouncementProcessingService processingService;
    @Mock private InstituteAnnouncementSettingsService instituteSettingsService;
    @Mock private RecipientResolutionService recipientResolutionService;
    @Mock private AuthServiceClient authServiceClient;
    @InjectMocks private AnnouncementService service;

    private Announcement announcement(String id, AnnouncementStatus status) {
        Announcement a = new Announcement();
        a.setId(id);
        a.setTitle("t");
        a.setInstituteId("I1");
        a.setStatus(status);
        when(announcementRepository.findById(id)).thenReturn(Optional.of(a));
        when(announcementRepository.save(any(Announcement.class))).thenAnswer(inv -> inv.getArgument(0));
        return a;
    }

    // --- (a) approval of an immediate announcement delivers it ---

    @Test
    void approvingAnImmediateAnnouncementDeliversIt() {
        Announcement a = announcement("a1", AnnouncementStatus.PENDING_APPROVAL);
        when(scheduledMessageRepository.findByAnnouncementIdAndIsActive("a1", true)).thenReturn(Optional.empty());
        // Delivery skips anything still PENDING_APPROVAL, so record the status it is called with.
        AtomicReference<AnnouncementStatus> statusAtDelivery = new AtomicReference<>();
        doAnswer(inv -> {
            statusAtDelivery.set(a.getStatus());
            return null;
        }).when(processingService).processAnnouncementDelivery("a1");

        service.approveAnnouncement("a1", "ADMIN");

        verify(processingService).processAnnouncementDelivery("a1");
        assertThat(statusAtDelivery.get()).isNotNull().isNotEqualTo(AnnouncementStatus.PENDING_APPROVAL);
    }

    @Test
    void approvingAScheduledAnnouncementWaitsForTheSchedule() {
        Announcement a = announcement("a2", AnnouncementStatus.PENDING_APPROVAL);
        when(scheduledMessageRepository.findByAnnouncementIdAndIsActive("a2", true))
                .thenReturn(Optional.of(oneTimeSchedule()));

        service.approveAnnouncement("a2", "ADMIN");

        verify(processingService, never()).processAnnouncementDelivery(any());
        assertThat(a.getStatus()).isEqualTo(AnnouncementStatus.SCHEDULED);
    }

    private static ScheduledMessage oneTimeSchedule() {
        ScheduledMessage sm = new ScheduledMessage();
        sm.setScheduleType(vacademy.io.notification_service.features.announcements.enums.ScheduleType.ONE_TIME);
        sm.setTimezone("UTC");
        sm.setNextRunTime(LocalDateTime.now().plusDays(1));
        return sm;
    }

    // --- (c) switching an announcement off ---

    @Test
    void deactivatingCancelsItsSchedule() {
        announcement("a3", AnnouncementStatus.SCHEDULED);
        service.updateAnnouncementStatus("a3", AnnouncementStatus.INACTIVE);
        verify(schedulingService).cancelScheduledAnnouncement("a3");

        announcement("a4", AnnouncementStatus.ACTIVE);
        service.updateAnnouncementStatus("a4", AnnouncementStatus.EXPIRED);
        verify(schedulingService).cancelScheduledAnnouncement("a4");
    }

    @Test
    void reactivatingDoesNotTouchTheSchedule() {
        announcement("a5", AnnouncementStatus.INACTIVE);
        service.updateAnnouncementStatus("a5", AnnouncementStatus.ACTIVE);
        verify(schedulingService, never()).cancelScheduledAnnouncement(any());
    }

    // --- (b) dashboard pin window ---

    private static AnnouncementDashboardPin pin(int durationHours) {
        AnnouncementDashboardPin pin = new AnnouncementDashboardPin();
        pin.setPinDurationHours(durationHours);
        return pin;
    }

    @Test
    void pinUsesTheChosenStartAndEndInTheAnnouncementTimezone() {
        AnnouncementDashboardPin pin = pin(24);
        Map<String, Object> settings = new HashMap<>();
        // datetime-local values, as the dashboard sends them (no seconds, no offset)
        settings.put("pinStartTime", "2026-11-20T09:00");
        settings.put("pinEndTime", "2026-11-27T18:30");

        AnnouncementService.applyPinWindow(pin, settings, "Asia/Kolkata", LocalDateTime.of(2026, 11, 16, 0, 0));

        assertThat(pin.getPinStartTime()).isEqualTo(LocalDateTime.of(2026, 11, 20, 3, 30));
        assertThat(pin.getPinEndTime()).isEqualTo(LocalDateTime.of(2026, 11, 27, 13, 0));
        assertThat(pin.getPinDurationHours()).isEqualTo(177);
    }

    @Test
    void pinWithoutAnEndStillEndsAfterItsDuration() {
        AnnouncementDashboardPin pin = pin(48);
        LocalDateTime now = LocalDateTime.of(2026, 11, 16, 10, 0);

        AnnouncementService.applyPinWindow(pin, Map.of(), "UTC", now);

        assertThat(pin.getPinStartTime()).isEqualTo(now);
        assertThat(pin.getPinEndTime()).isEqualTo(now.plusHours(48));
    }

    @Test
    void pinEndBeforeStartIsRejected() {
        Map<String, Object> settings = Map.of("pinStartTime", "2026-11-20T09:00", "pinEndTime", "2026-11-20T08:00");
        assertThatThrownBy(() -> AnnouncementService.applyPinWindow(pin(24), settings, "UTC", LocalDateTime.now()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void dateTimesWithAnOffsetAreConvertedAndBlankIsNone() {
        assertThat(AnnouncementService.toUtcDateTime("2026-11-20T09:00:00+05:30", "UTC", "f"))
                .isEqualTo(LocalDateTime.of(2026, 11, 20, 3, 30));
        assertThat(AnnouncementService.toUtcDateTime("2026-11-20T09:00:00Z", "Asia/Kolkata", "f"))
                .isEqualTo(LocalDateTime.of(2026, 11, 20, 9, 0));
        assertThat(AnnouncementService.toUtcDateTime("", "UTC", "f")).isNull();
        assertThat(AnnouncementService.toUtcDateTime(null, "UTC", "f")).isNull();
        assertThatThrownBy(() -> AnnouncementService.toUtcDateTime("next week", "UTC", "f"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // --- (d) values the dashboard sends ---

    @Test
    void systemAlertPriorityWordsMapToNumbers() {
        assertThat(AnnouncementService.systemAlertPriority(Map.of("priority", "HIGH"))).isEqualTo(3);
        assertThat(AnnouncementService.systemAlertPriority(Map.of("priority", "medium"))).isEqualTo(2);
        assertThat(AnnouncementService.systemAlertPriority(Map.of("priority", "LOW"))).isEqualTo(1);
        // services send numbers
        assertThat(AnnouncementService.systemAlertPriority(Map.of("priority", 2))).isEqualTo(2);
        assertThat(AnnouncementService.systemAlertPriority(Map.of("priority", "3"))).isEqualTo(3);
        assertThat(AnnouncementService.systemAlertPriority(Map.of("priority", 9))).isEqualTo(3);
        assertThat(AnnouncementService.systemAlertPriority(Map.of())).isEqualTo(1);
        assertThat(AnnouncementService.systemAlertPriority(null)).isEqualTo(1);
    }

    @Test
    void pinPositionIsMatchedWithoutCase() {
        List<String> allowed = List.of("top", "middle", "bottom");
        assertThat(AnnouncementService.getStringSetting(Map.of("position", "MIDDLE"), "position", "top", allowed))
                .isEqualTo("middle");
        assertThat(AnnouncementService.getStringSetting(Map.of("position", "BOTTOM"), "position", "top", allowed))
                .isEqualTo("bottom");
        assertThat(AnnouncementService.getStringSetting(Map.of("position", "sideways"), "position", "top", allowed))
                .isEqualTo("top");
    }
}
