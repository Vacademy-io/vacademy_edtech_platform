package vacademy.io.notification_service.features.webhook;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotFlowEngine;
import vacademy.io.notification_service.features.combot.action.service.FlowActionRouter;
import vacademy.io.notification_service.features.combot.repository.ChannelFlowConfigRepository;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.webhook.dto.UnifiedWebhookEvent;
import vacademy.io.notification_service.features.webhook.service.WebhookEventProcessor;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The status webhook is the only place the REAL outcome of an outbound WhatsApp message is known —
 * a provider 2xx at send time is a queue receipt, not a delivery. These cover the reconciliation
 * that carries that verdict back onto the row that sent the message.
 */
class WebhookDeliveryStatusReconcileTest {

    private NotificationLogRepository notificationLogRepository;
    private ChannelToInstituteMappingRepository channelMappingRepository;
    private WebhookEventProcessor processor;

    @BeforeEach
    void setUp() {
        notificationLogRepository = mock(NotificationLogRepository.class);
        channelMappingRepository = mock(ChannelToInstituteMappingRepository.class);

        when(notificationLogRepository.save(any(NotificationLog.class)))
                .thenAnswer(inv -> {
                    NotificationLog saved = inv.getArgument(0);
                    saved.setId("log-id");
                    return saved;
                });
        when(channelMappingRepository.findById(anyString())).thenReturn(Optional.empty());

        processor = new WebhookEventProcessor(
                notificationLogRepository,
                new ObjectMapper(),
                mock(FlowActionRouter.class),
                channelMappingRepository,
                mock(ChannelFlowConfigRepository.class),
                mock(ChatbotFlowEngine.class));
    }

    private UnifiedWebhookEvent.UnifiedWebhookEventBuilder event(UnifiedWebhookEvent.EventType type) {
        return UnifiedWebhookEvent.builder()
                .vendor("META")
                .channel(UnifiedWebhookEvent.Channels.WHATSAPP)
                .eventType(type)
                .phoneNumber("917999873846")
                .businessChannelId("1087323804474788")
                .timestamp(Instant.parse("2026-08-31T06:51:48Z"))
                .rawPayload(Map.of("statuses", "…"));
    }

    @Test
    @DisplayName("a failed status stamps the provider's verdict onto the row that sent the message")
    void failedStatusMarksOutboundRow() {
        processor.processEvent(event(UnifiedWebhookEvent.EventType.FAILED)
                .externalMessageId("wamid.FAILED_ONE")
                .errorCode("131042")
                .errorMessage("Business eligibility payment issue")
                .build());

        ArgumentCaptor<String> status = ArgumentCaptor.forClass(String.class);
        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.FAILED_ONE"), status.capture(),
                eq("131042"), eq("Business eligibility payment issue"),
                eq(Instant.parse("2026-08-31T06:51:48Z")));
        assertThat(status.getValue()).isEqualTo("FAILED");
    }

    @Test
    @DisplayName("delivered and read statuses are recorded too, so ticks reflect reality")
    void deliveredAndReadMarkOutboundRow() {
        processor.processEvent(event(UnifiedWebhookEvent.EventType.DELIVERED)
                .externalMessageId("wamid.DELIVERED_ONE").build());
        processor.processEvent(event(UnifiedWebhookEvent.EventType.READ)
                .externalMessageId("wamid.READ_ONE").build());

        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.DELIVERED_ONE"), eq("DELIVERED"), any(), any(), any());
        verify(notificationLogRepository).applyDeliveryStatusByProviderMessageId(
                eq("wamid.READ_ONE"), eq("READ"), any(), any(), any());
    }

    @Test
    @DisplayName("the event row itself records the verdict, so a later send row can still find it")
    void statusRowCarriesTheVerdict() {
        processor.processEvent(event(UnifiedWebhookEvent.EventType.DELIVERED)
                .externalMessageId("wamid.EARLY_ONE").build());

        ArgumentCaptor<NotificationLog> saved = ArgumentCaptor.forClass(NotificationLog.class);
        verify(notificationLogRepository).save(saved.capture());
        // Without this the verdict lives only inside the vendor's raw payload, and a send row
        // written after its own webhook (every blast does this) can never be back-filled.
        assertThat(saved.getValue().getDeliveryStatus()).isEqualTo("DELIVERED");
        assertThat(saved.getValue().getDeliveryUpdatedAt())
                .isEqualTo(Instant.parse("2026-08-31T06:51:48Z"));
    }

    @Test
    @DisplayName("an inbound reply is not a verdict and leaves the status columns alone")
    void replyRowCarriesNoDeliveryStatus() {
        processor.processEvent(event(UnifiedWebhookEvent.EventType.REPLY)
                .externalMessageId("wamid.INBOUND_ONE")
                .messageText("is the class today?")
                .build());

        ArgumentCaptor<NotificationLog> saved = ArgumentCaptor.forClass(NotificationLog.class);
        verify(notificationLogRepository).save(saved.capture());
        assertThat(saved.getValue().getDeliveryStatus()).isNull();
    }

    @Test
    @DisplayName("a status with no provider message id has nothing to join on and is skipped")
    void noProviderMessageIdSkipsReconciliation() {
        processor.processEvent(event(UnifiedWebhookEvent.EventType.DELIVERED)
                .externalMessageId(null).build());

        verify(notificationLogRepository, never())
                .applyDeliveryStatusByProviderMessageId(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a reconciliation failure never breaks webhook processing — the event is still logged")
    void reconciliationFailureIsSwallowed() {
        when(notificationLogRepository.applyDeliveryStatusByProviderMessageId(
                any(), any(), any(), any(), any()))
                .thenThrow(new RuntimeException("db unavailable"));

        assertThatCode(() -> processor.processEvent(event(UnifiedWebhookEvent.EventType.FAILED)
                .externalMessageId("wamid.BOOM")
                .errorCode("131042")
                .errorMessage("Business eligibility payment issue")
                .build()))
                .doesNotThrowAnyException();

        // The status row itself is what the Inbox reads; it must be saved regardless.
        verify(notificationLogRepository).save(any(NotificationLog.class));
    }

    @Test
    @DisplayName("an incoming reply is not a delivery status and must not touch outbound rows")
    void incomingReplyDoesNotReconcile() {
        processor.processEvent(event(UnifiedWebhookEvent.EventType.REPLY)
                .externalMessageId("wamid.INBOUND")
                .messageText("ok")
                .build());

        verify(notificationLogRepository, never())
                .applyDeliveryStatusByProviderMessageId(any(), any(), any(), any(), any());
    }
}
