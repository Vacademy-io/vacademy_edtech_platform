package vacademy.io.notification_service.features.combot.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.notification_service.features.announcements.client.AdminCoreServiceClient;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.combot.action.service.FlowActionRouter;
import vacademy.io.notification_service.features.combot.constants.CombotConstants;
import vacademy.io.notification_service.features.combot.repository.ChannelFlowConfigRepository;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * Legacy ChannelFlowConfig routing keys an incoming reply on the template of the last message we
 * sent. Chatbot-flow rows now carry a payload (their template and flow, for the Inbox); they must
 * keep routing exactly as they did with none — Jumpstart still runs "none"-keyed legacy flows.
 */
class LegacyFlowTemplateRoutingTest {

    private CombotWebhookService service;

    @BeforeEach
    void setUp() {
        service = new CombotWebhookService(mock(InternalClientUtils.class), mock(NotificationLogRepository.class),
                mock(ChannelToInstituteMappingRepository.class), mock(ChannelFlowConfigRepository.class),
                new ObjectMapper(), mock(UserAnnouncementPreferenceService.class), mock(FlowActionRouter.class),
                mock(AdminCoreServiceClient.class));
    }

    private NotificationLog row(String source, String payload) {
        NotificationLog nl = new NotificationLog();
        nl.setSource(source);
        nl.setMessagePayload(payload);
        return nl;
    }

    @Test
    @DisplayName("a bot message, text or template, still reads as DEFAULT")
    void chatbotRowsReadAsDefault() {
        assertThat(service.legacyFlowTemplateOf(row("CHATBOT_FLOW", null)))
                .isEqualTo(CombotConstants.DEFAULT_TEMPLATE);
        assertThat(service.legacyFlowTemplateOf(row("CHATBOT_FLOW",
                "{\"originType\":\"CHATBOT_FLOW\",\"originId\":\"flow-1\"}")))
                .isEqualTo(CombotConstants.DEFAULT_TEMPLATE);
        assertThat(service.legacyFlowTemplateOf(row("CHATBOT_FLOW",
                "{\"templateName\":\"unlockx_school\",\"originType\":\"CHATBOT_FLOW\",\"originId\":\"flow-1\"}")))
                .isEqualTo(CombotConstants.DEFAULT_TEMPLATE);
    }

    @Test
    @DisplayName("a refused bot message still reads as UNKNOWN")
    void refusedChatbotRowReadsAsUnknown() {
        assertThat(service.legacyFlowTemplateOf(row("CHATBOT_FLOW",
                "{\"templateName\":\"unlockx_school\",\"deliveryStatus\":\"FAILED\",\"error\":\"x\"}")))
                .isEqualTo(CombotConstants.UNKNOWN_TEMPLATE);
    }

    @Test
    @DisplayName("every other sender reads its template off the payload as before")
    void otherRowsUnchanged() {
        assertThat(service.legacyFlowTemplateOf(row("whatsapp-service",
                "{\"templateName\":\"day_0_message\",\"originType\":\"WORKFLOW\",\"originId\":\"wf-1\"}")))
                .isEqualTo("day_0_message");
        assertThat(service.legacyFlowTemplateOf(row("COMBOT", "{\"template\":{\"name\":\"invite_template\"}}")))
                .isEqualTo("invite_template");
        assertThat(service.legacyFlowTemplateOf(row("whatsapp-service", null)))
                .isEqualTo(CombotConstants.DEFAULT_TEMPLATE);
    }
}
