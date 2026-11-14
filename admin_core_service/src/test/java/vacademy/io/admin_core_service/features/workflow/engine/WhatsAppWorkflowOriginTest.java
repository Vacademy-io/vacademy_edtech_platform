package vacademy.io.admin_core_service.features.workflow.engine;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.notification.dto.MessageOrigin;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.WhatsappRequest;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;

/**
 * A workflow's WhatsApp send tells notification-service which workflow it came from, so the
 * WhatsApp Inbox and the student's Communication tab can say "sent by workflow X". Without it every
 * workflow message landed as an anonymous "whatsapp-service" row.
 */
class WhatsAppWorkflowOriginTest {

    @Test
    @DisplayName("the node reads its workflow off the run context")
    void originFromContext() {
        MessageOrigin origin = SendWhatsAppNodeHandler.workflowOrigin(Map.of(
                "workflowId", "b7e1c2a0",
                WorkflowEngineService.WORKFLOW_NAME_KEY, "Shiksha Nation | UnlockX Registration WhatsApp"));

        assertEquals(new MessageOrigin("WORKFLOW", "b7e1c2a0", "Shiksha Nation | UnlockX Registration WhatsApp"),
                origin);
    }

    @Test
    @DisplayName("a run with no workflow id sends no origin")
    void noWorkflowNoOrigin() {
        assertNull(SendWhatsAppNodeHandler.workflowOrigin(Map.of("instituteId", "inst-1")));
        assertNull(SendWhatsAppNodeHandler.workflowOrigin(null));
    }

    @Test
    @DisplayName("the bridge puts the origin on the unified send options")
    void bridgeSendsOrigin() {
        NotificationService service = spy(new NotificationService());
        doReturn(null).when(service).sendUnified(any());
        WhatsappRequest request = new WhatsappRequest();
        request.setTemplateName("unlockx_registration1");
        request.setUserDetails(List.of(Map.of("918379090773", Map.of("1", "Omkar"))));

        service.sendWhatsappViaUnified(List.of(request), "inst-1", MessageOrigin.workflow("wf-1", "UnlockX"));

        ArgumentCaptor<UnifiedSendRequest> sent = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(service).sendUnified(sent.capture());
        UnifiedSendRequest.SendOptions options = sent.getValue().getOptions();
        assertEquals("whatsapp-bridge", options.getSource());
        assertEquals("WORKFLOW", options.getOriginType());
        assertEquals("wf-1", options.getOriginId());
        assertEquals("UnlockX", options.getOriginName());
    }

    @Test
    @DisplayName("a send with no origin serializes without the origin fields at all")
    void noOriginNoJsonFields() throws Exception {
        String json = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(
                UnifiedSendRequest.SendOptions.builder().source("whatsapp-bridge").build());

        assertFalse(json.contains("origin"), json);
    }

    @Test
    @DisplayName("every other caller of the bridge sends exactly what it did before")
    void bridgeWithoutOriginUnchanged() {
        NotificationService service = spy(new NotificationService());
        doReturn(null).when(service).sendUnified(any());
        WhatsappRequest request = new WhatsappRequest();
        request.setTemplateName("t");
        request.setUserDetails(List.of(Map.of("918379090773", Map.of())));

        service.sendWhatsappViaUnified(request, "inst-1");

        ArgumentCaptor<UnifiedSendRequest> sent = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(service).sendUnified(sent.capture());
        assertNull(sent.getValue().getOptions().getOriginType());
        assertNull(sent.getValue().getOptions().getOriginId());
        assertNull(sent.getValue().getOptions().getOriginName());
    }
}
