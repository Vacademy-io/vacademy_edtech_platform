package vacademy.io.notification_service.features.combot;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.notification_service.features.announcements.client.AdminCoreServiceClient;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.combot.action.service.FlowActionRouter;
import vacademy.io.notification_service.features.combot.repository.ChannelFlowConfigRepository;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.combot.service.CombotWebhookService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Statuses for institutes wired to the Com.bot / Meta Cloud webhook land here rather than in
 * {@code WebhookEventProcessor}. They used to be stored as their own status rows and nothing else,
 * so the outbound row kept a null delivery_status and /unified-send/delivery-status answered PENDING
 * forever — the send dialog showed "accepted, awaiting confirmation" for messages WhatsApp had
 * already reported delivered. These cover the reconciliation that closes that gap.
 */
class CombotStatusReconcileTest {

    private NotificationLogRepository notificationLogRepository;
    private CombotWebhookService service;

    @BeforeEach
    void setUp() {
        notificationLogRepository = mock(NotificationLogRepository.class);
        when(notificationLogRepository.save(any(NotificationLog.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(notificationLogRepository.findTopByNotificationTypeAndSourceIdOrderByNotificationDateDesc(
                anyString(), anyString())).thenReturn(Optional.empty());
        when(notificationLogRepository.findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                anyString(), anyString())).thenReturn(Optional.empty());

        service = new CombotWebhookService(
                mock(InternalClientUtils.class),
                notificationLogRepository,
                mock(ChannelToInstituteMappingRepository.class),
                mock(ChannelFlowConfigRepository.class),
                new ObjectMapper(),
                mock(UserAnnouncementPreferenceService.class),
                mock(FlowActionRouter.class),
                mock(AdminCoreServiceClient.class));
    }

    private Map<String, Object> statusPayload(String messageId, String status) {
        return Map.of("statuses", List.of(Map.of(
                "id", messageId,
                "status", status,
                "recipient_id", "917999873846")));
    }

    @Test
    @DisplayName("a delivered status stamps DELIVERED on the row that sent the message")
    void deliveredStatusMarksOutboundRow() {
        service.processMessageStatusFromWebhook(statusPayload("wamid.DELIVERED_ONE", "delivered"), Map.of());

        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.DELIVERED_ONE"), eq("DELIVERED"), eq(null), eq(null), any());
    }

    @Test
    @DisplayName("sent and read are recorded too, so the panel can move past 'accepted'")
    void sentAndReadMarkOutboundRow() {
        service.processMessageStatusFromWebhook(statusPayload("wamid.SENT_ONE", "sent"), Map.of());
        service.processMessageStatusFromWebhook(statusPayload("wamid.READ_ONE", "read"), Map.of());

        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.SENT_ONE"), eq("SENT"), any(), any(), any());
        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.READ_ONE"), eq("READ"), any(), any(), any());
    }

    @Test
    @DisplayName("a failed status is stamped once, WITH its error code — never as a bare FAILED")
    void failedStatusCarriesTheErrorDetails() {
        Map<String, Object> payload = Map.of("statuses", List.of(Map.of(
                "id", "wamid.FAILED_ONE",
                "status", "failed",
                "recipient_id", "917999873846",
                "errors", List.of(Map.of(
                        "code", 131042,
                        "title", "Business eligibility payment issue")))));

        service.processMessageStatusFromWebhook(payload, Map.of());

        // Exactly one stamp: a bare FAILED from the status loop would win the monotonic guard in
        // the UPDATE and leave the outbound row with no error code to show the admin.
        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.FAILED_ONE"), eq("FAILED"), eq("131042"),
                eq("Business eligibility payment issue"), any());
    }

    @Test
    @DisplayName("the reason reaches the outbound row even when Meta sends only error_data.details")
    void failureReasonFallsBackToErrorDetails() {
        Map<String, Object> payload = Map.of("statuses", List.of(Map.of(
                "id", "wamid.DETAILS_ONLY",
                "status", "failed",
                "recipient_id", "917999873846",
                "errors", List.of(Map.of(
                        "code", 131049,
                        "error_data", Map.of("details",
                                "Message failed to send because of marketing limits"))))));

        service.processMessageStatusFromWebhook(payload, Map.of());

        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.DETAILS_ONLY"), eq("FAILED"), eq("131049"),
                eq("Message failed to send because of marketing limits"), any());
    }

    @Test
    @DisplayName("an unrecognised status word has no verdict to stamp and is left alone")
    void unknownStatusDoesNotReconcile() {
        service.processMessageStatusFromWebhook(statusPayload("wamid.WEIRD", "warped"), Map.of());

        verify(notificationLogRepository, never())
                .applyDeliveryStatusByProviderMessageId(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a reconciliation failure never breaks webhook processing")
    void reconciliationFailureIsSwallowed() {
        when(notificationLogRepository.applyDeliveryStatusByProviderMessageId(
                any(), any(), any(), any(), any()))
                .thenThrow(new RuntimeException("db unavailable"));

        assertThatCode(() -> service.processMessageStatusFromWebhook(
                statusPayload("wamid.BOOM", "delivered"), Map.of()))
                .doesNotThrowAnyException();

        verify(notificationLogRepository).save(any(NotificationLog.class));
    }

    @Test
    @DisplayName("the simple Com.bot status webhook reconciles the same way")
    void simpleStatusWebhookMarksOutboundRow() {
        service.processCombotStatusWebhook("wamid.SIMPLE", "917999873846", "delivered", Map.of());

        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.SIMPLE"), eq("DELIVERED"), eq(null), eq(null), any());
    }
}
